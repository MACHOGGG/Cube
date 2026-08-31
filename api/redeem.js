import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  PIN_RE,
  checkPin,
  entitlementOf,
  extend,
  loadAccount,
  lockRemainingMs,
  newAccount,
  normalizeEmail,
  rotateToken,
  saveAccount,
} from './_accounts.js';
import { set, storeConfigured, takeOnce } from './_store.js';

/** Uppercase, and dashes or spaces the player typed are not part of it. */
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Spending a code: a month or a year of 「Slides 天才」, attached to an
 * address and a passcode so it survives a new phone.
 *
 * Two things about the order of operations here matter.
 *
 * The passcode is checked *before* the code is spent. If the address already
 * has an account, whoever is typing has to prove it is theirs first —
 * otherwise a stranger could burn their own code onto someone else's
 * address, or worse, quietly attach themselves to it.
 *
 * The code is then taken with GETDEL, which reads and deletes in one step.
 * Two people racing to redeem the same code cannot both win, however close
 * together they press the button.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { code, email, password } = readBody(req);
  const address = normalizeEmail(email);
  const pin = String(password || '');
  const ticket = normalizeCode(code);
  if (!EMAIL_RE.test(address)) return send(res, 400, { error: 'email' });
  if (!PIN_RE.test(pin)) return send(res, 400, { error: 'password' });
  if (ticket.length < 6) return send(res, 400, { error: 'code' });

  let account = await loadAccount(address);
  if (account) {
    const verdict = await checkPin(address, pin, account);
    if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
    if (verdict === 'locked') {
      return send(res, 423, { error: 'locked', retryInMs: lockRemainingMs(account) });
    }
    if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });
  } else {
    account = newAccount(pin);
  }

  const ticketDoc = await takeOnce('code:' + ticket);
  if (!ticketDoc) return send(res, 404, { error: 'code' });

  extend(account, ticketDoc.plan === 'year' ? 'year' : 'month');
  rotateToken(account);
  await saveAccount(address, account);
  // Kept only so a support question about a code has an answer.
  await set('codeused:' + ticket, { email: address, at: Date.now(), plan: ticketDoc.plan });

  return send(res, 200, entitlementOf(account, address));
}
