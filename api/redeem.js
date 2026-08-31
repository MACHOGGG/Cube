import { send, readBody } from './_creem.js';
import { codeHolder, entitlementOf, extend, newAccount, saveAccount } from './_accounts.js';
import { set, storeConfigured, takeOnce } from './_store.js';

/** Uppercase, and dashes or spaces the player typed are not part of it. */
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Spending a code. One field, and it is the code.
 *
 * A code is a thing that unlocks, and it should unlock the moment it is
 * typed. It used to ask for an address and a passcode in the same window,
 * which turned a gift into a registration form and buried the one field that
 * mattered among two that did not. Attaching an address is worth doing — it
 * is what carries the month onto a new phone — but it is a separate question,
 * asked separately, right after this one succeeds.
 *
 * Until it is asked, the entitlement lives under the code itself, and the
 * token returned here is what proves the holder is the one who redeemed it.
 * Guessing a code buys nothing: it is deleted the moment it is spent, and
 * attaching an address to what it became needs this token too.
 *
 * GETDEL reads and deletes in one step, so two people racing to redeem the
 * same code cannot both win, however close together they press the button.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const ticket = normalizeCode(readBody(req).code);
  if (ticket.length < 6) return send(res, 400, { error: 'code' });

  const ticketDoc = await takeOnce('code:' + ticket);
  if (!ticketDoc) return send(res, 404, { error: 'code' });

  // No password yet — there is nobody to check one against. The account is
  // created unlocked, keyed by the code, and the token below is the only
  // thing that can claim it.
  const holder = codeHolder(ticket);
  const account = newAccount('', 'code');
  extend(account, ticketDoc.plan === 'year' ? 'year' : 'month');
  account.unbound = true;
  await saveAccount(holder, account);
  // Kept only so a support question about a code has an answer.
  await set('codeused:' + ticket, { at: Date.now(), plan: ticketDoc.plan });

  return send(res, 200, { ...entitlementOf(account, ''), kind: 'code', code: ticket });
}
