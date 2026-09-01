import {
  answer, configured, creem, emailOf, entitled, NOBODY, periodOf, readBody, send,
} from './_creem.js';
import {
  SECRET_RE,
  checkPin,
  ensureGiftCodes,
  entitlementOf,
  liveGifts,
  loadAccount,
  normalizeEmail,
  rotateToken,
  saveAccount,
} from './_accounts.js';
import { storeConfigured } from './_store.js';

/**
 * Is this player subscribed? Asked in two situations, and Creem is the only
 * one who answers either of them:
 *
 *   checkoutId  — they have just come back from paying. The order is
 *                 confirmed with Creem rather than believed from the query
 *                 string, which anyone can type.
 *   email       — they are signing in on another device, or reinstalling.
 *                 The address plus the password set on the way back from
 *                 the checkout (api/passcode.js). The address alone was
 *                 never proof of anything: it is printed on the receipt and
 *                 known to everyone the player has written to, so answering
 *                 it handed the subscription to whoever typed it.
 *
 * What the password does NOT do is decide whether the subscription is paid
 * up — Creem still answers that, every time, and an account here with a
 * lapsed subscription behind it gets nothing. It only decides who may ask.
 *
 * An address that has a live subscription but no password yet is answered
 * with `needsPasscode`, so the app can walk that player through setting one
 * instead of leaving them locked out of what they paid for. That does
 * disclose that the address is a subscriber — the same thing every "forgot
 * your password" form discloses — which is a fair trade for not stranding
 * someone whose tab closed before the password window appeared.
 *
 * Note where the `configured()` check is, and where it is not. It used to be
 * the first line of the handler, which meant a deployment missing its Creem
 * key answered every sign-in with a flat "not subscribed" — including the
 * 内部码 accounts, whose entitlement lives in our own store and has nothing to
 * do with Creem. A 200 saying "you are not a subscriber" is not a degraded
 * answer, it is a wrong one: the player reads it as their code having died
 * and writes in about it, while the logs stay clean. So the check now sits on
 * each branch that actually needs Creem, and says 503 — "we could not answer"
 * — which the app shows as try again later.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });

  const { checkoutId, email, password, token } = readBody(req);
  try {
    if (checkoutId) {
      // Settling an order is Creem's answer by definition — there is nobody
      // else to ask, so without the key this branch cannot run at all.
      if (!configured()) return send(res, 503, { error: 'notConfigured' });
      return send(res, 200, await fromCheckout(checkoutId));
    }
    if (email) return await fromEmail(res, String(email), password, token);
    return send(res, 400, { error: 'missing' });
  } catch (err) {
    // A customer Creem has never heard of is a 404, and the honest answer to
    // "is this address subscribed" is simply no.
    if (err?.status === 404) return send(res, 200, NOBODY);
    console.error('subscription lookup failed:', err?.message || err);
    return send(res, 502, { error: 'upstream' });
  }
}

/** Settle a checkout the player has just returned from. */
async function fromCheckout(checkoutId) {
  const checkout = await creem('/v1/checkouts', { query: { checkout_id: String(checkoutId) } });
  if (checkout?.status !== 'completed') return NOBODY;
  // Depending on the endpoint Creem nests the subscription or names its id.
  const sub =
    typeof checkout.subscription === 'string'
      ? await creem('/v1/subscriptions', { query: { subscription_id: checkout.subscription } })
      : checkout.subscription;
  if (!entitled(sub)) return NOBODY;
  return answer(sub, emailOf(checkout) ?? emailOf(sub));
}

/**
 * Sign in / restore: the password first, then Creem.
 *
 * The order matters. Asking Creem first and the password second would answer
 * "is this address a subscriber" to anyone who asked, before any proof at
 * all; checking the password first means a stranger's guess costs them a
 * scrypt round and a place in the lockout counter, and tells them nothing.
 */
async function fromEmail(res, rawEmail, password, token) {
  // Without the store there are no accounts to check against, and a check
  // that cannot run must not be treated as a check that passed.
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });
  const address = normalizeEmail(rawEmail);
  const account = await loadAccount(address);

  // A token stands in for the password on a device that has already used
  // it once. It is checked against the account rather than trusted, it is
  // not rotated here (that would sign the other devices out on every launch),
  // and it grants nothing on its own — Creem is still asked below.
  let issued;
  if (account) {
    if (token) {
      if (!account.token || String(token) !== account.token) {
        return send(res, 401, { error: 'wrong' });
      }
    } else {
      if (!SECRET_RE.test(String(password || ''))) return send(res, 401, { error: 'wrong' });
      const verdict = await checkPin(address, String(password), account);
      if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
      if (verdict === 'locked') return send(res, 423, { error: 'locked' });
      if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });
      // A password sign-in issues a fresh token, which retires the one any
      // other device was holding.
      issued = rotateToken(account);
      await saveAccount(address, account);
    }
  }

  // A redeemed code's entitlement is ours, not Creem's — Creem has never
  // heard of this person. Answering from the account is not a shortcut here,
  // it is the only correct source. Doing it after the credential check means
  // one endpoint serves both kinds and the browser never has to guess which
  // it is holding — which it could not do anyway, since a card password of
  // six digits and a code's six-digit passcode look identical.
  if (account?.kind === 'code') {
    return send(res, 200, {
      ...entitlementOf(account, address),
      kind: 'code',
      gifts: await liveGifts(account),
    });
  }

  // Here, and not a line earlier: everything above answers from our own
  // store, so a code account signs in normally whatever state Creem's key is
  // in. From this point on Creem is the only one who knows, and not being
  // able to ask is a server fault rather than a verdict about this player.
  if (!configured()) return send(res, 503, { error: 'notConfigured' });

  const customer = await creem('/v1/customers', { query: { email: address } });
  if (!customer?.id) return send(res, 200, NOBODY);
  const list = await creem(`/v1/customers/${encodeURIComponent(customer.id)}/subscriptions`, {
    query: { page_size: 50 },
  });
  const sub = (list?.items || []).find(entitled);
  if (!sub) return send(res, 200, NOBODY);

  // Subscribed, but no password was ever set — the tab closed before the
  // window appeared, or the subscription predates passwords existing. Say so
  // rather than handing the subscription over: the app sends them to set one.
  if (!account) return send(res, 200, { ...NOBODY, needsPasscode: true });

  // Minted on the first sign-in that sees a yearly subscription, which is
  // what gets them to someone who subscribed before the gift existed. The
  // account remembers them, so signing in again hands back the same two
  // rather than printing a fresh pair every launch.
  await ensureGiftCodes(address, account, periodOf(sub));
  return send(res, 200, {
    ...answer(sub, customer.email || address, issued || account.token),
    gifts: await liveGifts(account),
  });
}
