import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  PIN_RE,
  checkPin,
  entitlementOf,
  loadAccount,
  lockRemainingMs,
  normalizeEmail,
  rotateToken,
  saveAccount,
} from './_accounts.js';
import { storeConfigured } from './_store.js';

/**
 * Signing in to an account a redeemed code created.
 *
 * This is not how a card subscriber gets their subscription back — that is
 * api/subscription.js, which asks Creem about the address and needs no
 * passcode at all. This endpoint exists only for entitlements we granted
 * ourselves and therefore have to remember.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { email, password } = readBody(req);
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address) || !PIN_RE.test(String(password || ''))) {
    return send(res, 400, { error: 'invalid' });
  }

  const account = await loadAccount(address);
  // An address with no account and a wrong passcode get the same answer, so
  // this cannot be used to find out who has one.
  if (!account) return send(res, 401, { error: 'wrong' });

  const verdict = await checkPin(address, String(password), account);
  if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
  if (verdict === 'locked') {
    return send(res, 423, { error: 'locked', retryInMs: lockRemainingMs(account) });
  }
  if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });

  rotateToken(account);
  await saveAccount(address, account);
  return send(res, 200, entitlementOf(account, address));
}
