import { answer, configured, creem, emailOf, entitled, NOBODY, readBody, send } from './_creem.js';

/**
 * Is this player subscribed? Asked in two situations, and Creem is the only
 * one who answers either of them:
 *
 *   checkoutId  — they have just come back from paying. The order is
 *                 confirmed with Creem rather than believed from the query
 *                 string, which anyone can type.
 *   email       — they are signing in on another device, or reinstalling.
 *                 The address is the whole identity a web subscription has;
 *                 there is no password of ours to check, and none to lose.
 *
 * Note for whoever runs this: the email branch will confirm or deny that an
 * address has a subscription, which is the same thing every "forgot your
 * password" form in the world discloses. If that ever matters more than the
 * convenience does, the fix is to mail a one-time link to the address rather
 * than answering the browser directly — the client already treats this as a
 * single "did it work" call, so nothing above it would have to change.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!configured()) return send(res, 200, NOBODY);

  const { checkoutId, email } = readBody(req);
  try {
    if (checkoutId) return send(res, 200, await fromCheckout(checkoutId));
    if (email) return send(res, 200, await fromEmail(String(email).trim()));
    return send(res, 400, { error: 'missing' });
  } catch (err) {
    // A customer Creem has never heard of is a 404, and the honest answer to
    // "is this address subscribed" is simply no.
    if (err?.status === 404) return send(res, 200, NOBODY);
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

/** Sign in / restore: the address, then that customer's subscriptions. */
async function fromEmail(email) {
  const customer = await creem('/v1/customers', { query: { email } });
  if (!customer?.id) return NOBODY;
  const list = await creem(`/v1/customers/${encodeURIComponent(customer.id)}/subscriptions`, {
    query: { page_size: 50 },
  });
  const sub = (list?.items || []).find(entitled);
  if (!sub) return NOBODY;
  return answer(sub, customer.email || email);
}
