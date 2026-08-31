import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  codeHolder,
  entitlementOf,
  extend,
  loadAccount,
  newAccount,
  normalizeEmail,
  saveAccount,
} from './_accounts.js';
import { callerId, tooMany } from './_ratelimit.js';
import { set, storeConfigured, takeOnce } from './_store.js';

/** Uppercase, and dashes or spaces the player typed are not part of it. */
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Spending a code. One field, and it is the code.
 *
 * Where the month lands depends on what the browser already has:
 *
 *   signed in       — it is added to that account, so it is waiting on every
 *                     device the moment they next sign in there.
 *   not signed in   — it is held under the code itself, and the app asks for
 *                     an address next. Declining is allowed: the entitlement
 *                     works on this device either way, and the question comes
 *                     back until it is answered.
 *
 * A player who is *currently* subscribed is told to keep the code rather than
 * spend it — that check is on the device, where the answer is known, and it
 * is a courtesy rather than a defence: the only person a bypass costs is the
 * one who burned their own gift early.
 *
 * GETDEL takes the code in one step, so two people racing for the same code
 * cannot both win. An expired code is taken too and then refused: it was
 * never going to be worth anything again, and saying "expired" rather than
 * "no such code" is the difference between an answerable support question
 * and an argument.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  // Twenty tries an hour. A person typing a code off a card needs two or
  // three; a script walking the keyspace needs rather more than twenty.
  if (await tooMany('redeem', callerId(req), 20, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const { code, email, token } = readBody(req);
  const ticket = normalizeCode(code);
  if (ticket.length < 3) return send(res, 400, { error: 'code' });

  // An address and a token that check out mean the month goes to that
  // account. Anything short of that is treated as not signed in at all,
  // never as a reason to refuse — the code is still theirs to spend.
  const address = normalizeEmail(email);
  let account = null;
  if (EMAIL_RE.test(address) && token) {
    const found = await loadAccount(address);
    if (found && found.token && String(token) === found.token) account = found;
  }

  const ticketDoc = await takeOnce('code:' + ticket);
  if (!ticketDoc) return send(res, 404, { error: 'code' });
  if (ticketDoc.expiresAt && Date.now() > ticketDoc.expiresAt) {
    return send(res, 410, { error: 'expired' });
  }

  const plan = ticketDoc.plan;
  if (account) {
    extend(account, plan);
    await saveAccount(address, account);
    await set('codeused:' + ticket, { at: Date.now(), plan, email: address });
    return send(res, 200, { ...entitlementOf(account, address), kind: 'code' });
  }

  // Nobody to attach it to yet. It lives under the code, and the token below
  // is the only thing that can claim what it became.
  const holder = codeHolder(ticket);
  const fresh = newAccount('', 'code');
  extend(fresh, plan);
  fresh.unbound = true;
  await saveAccount(holder, fresh);
  await set('codeused:' + ticket, { at: Date.now(), plan });

  return send(res, 200, { ...entitlementOf(fresh, ''), kind: 'code', code: ticket });
}
