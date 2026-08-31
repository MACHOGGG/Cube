import { configured, creem, readBody, send } from './_creem.js';

/**
 * A link into Creem's own customer portal, where a web subscriber cancels,
 * changes their card or fetches a receipt.
 *
 * The pricing document promises that a subscription can be cancelled at any
 * time; this is where that promise is kept. Creem hosts the page and owns
 * the billing record, so cancelling never passes through us — which is also
 * why there is nothing here to get out of step with what Creem thinks.
 *
 * The App Store and Google Play builds never call this: those subscriptions
 * are cancelled in the store's own account settings, as the stores require.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!configured()) return send(res, 503, { error: 'notConfigured' });

  const { email } = readBody(req);
  if (!email) return send(res, 400, { error: 'missing' });

  try {
    const customer = await creem('/v1/customers', { query: { email: String(email).trim() } });
    if (!customer?.id) return send(res, 404, { error: 'none' });
    const links = await creem('/v1/customers/billing', {
      method: 'POST',
      body: { customer_id: customer.id },
    });
    if (!links?.customer_portal_link) return send(res, 502, { error: 'upstream' });
    return send(res, 200, { url: links.customer_portal_link });
  } catch (err) {
    if (err?.status === 404) return send(res, 404, { error: 'none' });
    return send(res, 502, { error: 'upstream' });
  }
}
