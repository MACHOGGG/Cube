import { timingSafeEqual } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { addToInbox, isPlan, listAccounts, loadAccount, normalizeEmail, saveAccount } from './_accounts.js';
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

  const body = readBody(req);
  const { token, plan, count, expiresInDays, action, emails } = body;
  // The same answer whether the token is wrong or was never configured, so
  // this cannot be used to find out whether minting is switched on.
  if (!tokenOk(token)) return send(res, 401, { error: 'wrong' });

  // 列出所有开了账户的玩家。名单是 saveAccount 顺手维护的那份（见
  // _accounts.js 的 INDEX_KEY）：一次 HGETALL 就把人和筛选要用的字段全拿到，
  // 不用挨个去查账户本体，也一样秘密都不带出来。
  if (action === 'list') {
    const index = await listAccounts();
    const now = Date.now();
    const players = Object.entries(index).map(([email, row]) => ({
      email,
      kind: row.kind,
      plan: row.plan ?? null,
      until: row.until || 0,
      createdAt: row.createdAt || 0,
      blocked: Boolean(row.blocked),
      news: Boolean(row.news),
      inbox: row.inbox || 0,
      /** 现在有没有权限。刷卡的人权限在 Creem 那边，这里读不到，所以
       *  kind==='card' 一律当作有——他有账户就是因为付过款。 */
      active: row.kind === 'card' ? true : (row.until || 0) > now,
    }));
    players.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return send(res, 200, { players, count: players.length });
  }

  // 给指定的几个玩家各发一批码。
  if (action === 'grant') {
    if (!isPlan(plan)) return send(res, 400, { error: 'plan' });
    const list = (Array.isArray(emails) ? emails : []).map(normalizeEmail).filter(Boolean);
    if (!list.length) return send(res, 400, { error: 'emails' });
    const per = Math.max(1, Math.min(MAX_PER_CALL, Number(count) || 1));
    const days = Number(expiresInDays) || 0;
    const expiresAt = days > 0 ? Date.now() + days * 24 * 3600e3 : undefined;

    const sent = [];
    for (const address of list) {
      const account = await loadAccount(address);
      // 没有这个账户就跳过，不报错整批失败：勾了一个刚被删掉的人，不该让
      // 另外九个人也收不到码。
      if (!account) { sent.push({ email: address, error: 'noAccount' }); continue; }
      const codes = await mintCodes(plan, per, expiresAt, { source: 'grant', to: address });
      addToInbox(account, codes, plan, expiresAt);
      await saveAccount(address, account);
      sent.push({ email: address, codes });
    }
    return send(res, 200, { plan, per, ...(expiresAt ? { expiresAt } : {}), sent });
  }

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
