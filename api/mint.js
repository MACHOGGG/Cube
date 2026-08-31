import { timingSafeEqual } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { isPlan } from './_accounts.js';
import { mintCodes } from './_codes.js';
import { storeConfigured } from './_store.js';

/**
 * Minting codes, for whoever runs this game and nobody else.
 *
 * There is no admin screen and this is deliberately not one: it is a single
 * call that hands back a list of codes, so a batch can be minted from a phone
 * on the way to writing an email, without a laptop or a terminal anywhere.
 *
 *   POST /api/mint
 *   { "token": "...", "plan": "year", "count": 50 }
 *   { "token": "...", "plan": "month", "count": 2, "expiresInDays": 7 }
 *
 * `expiresInDays` is the difference between the two kinds of batch. A code
 * minted without it never goes stale — that is the pool to test with and to
 * hand out by hand. A code minted with it has to be used inside that window,
 * which is what makes "here are two free months, they expire in a week" mean
 * anything at all.
 *
 * The expiry is stored as a date on the code rather than as a key lifetime,
 * so a player who is late is told their code expired instead of being told
 * it never existed — the difference between an answerable support question
 * and an argument.
 */
const MAX_PER_CALL = 200;

/** Compared in constant time: a token check that leaks its own progress is
 *  a token check an attacker can walk one character at a time. */
function tokenOk(given) {
  const want = process.env.ADMIN_TOKEN || '';
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { token, plan, count, expiresInDays } = readBody(req);
  // The same answer whether the token is wrong or was never configured, so
  // this cannot be used to find out whether minting is switched on.
  if (!tokenOk(token)) return send(res, 401, { error: 'wrong' });
  if (!isPlan(plan)) return send(res, 400, { error: 'plan' });

  const wanted = Math.max(1, Math.min(MAX_PER_CALL, Number(count) || 1));
  const days = Number(expiresInDays) || 0;
  const expiresAt = days > 0 ? Date.now() + days * 24 * 3600e3 : undefined;

  const minted = await mintCodes(plan, wanted, expiresAt, { source: 'mint' });

  return send(res, 200, {
    plan,
    count: minted.length,
    ...(expiresAt ? { expiresAt } : {}),
    codes: minted,
  });
}
