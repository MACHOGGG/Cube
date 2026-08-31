import { configured, creem, products, readBody, send } from './_creem.js';

/**
 * Open a Creem checkout for 「Slides 天才」 and hand back the URL to send the
 * player to. US$1.99 a month or US$4.99 a year, one price worldwide.
 *
 * The browser names a period, never a product: the ids live in this
 * function's environment, so the live and test catalogues are a Vercel
 * setting rather than a rebuild, and the site cannot be used to open a
 * checkout for anything we did not put on sale.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  // No key, or no products configured: the subscription is not on sale yet.
  // The paywall says exactly that rather than showing a broken button.
  if (!configured()) return send(res, 503, { error: 'notConfigured' });

  const { period, email, returnUrl } = readBody(req);
  const productId = products()[period === 'yearly' ? 'yearly' : 'monthly'];
  if (!productId) return send(res, 503, { error: 'notConfigured' });

  try {
    const checkout = await creem('/v1/checkouts', {
      method: 'POST',
      body: {
        product_id: productId,
        ...(isEmail(email) ? { customer: { email } } : {}),
        ...(sameSite(returnUrl, req) ? { success_url: returnUrl } : {}),
      },
    });
    if (!checkout?.checkout_url) return send(res, 502, { error: 'upstream' });
    return send(res, 200, { url: checkout.checkout_url });
  } catch (err) {
    // Vercel's runtime log is the only place this is visible; without it a
    // 502 here is indistinguishable from every other 502.
    console.error('checkout failed:', err?.message || err);
    return send(res, 502, { error: 'upstream' });
  }
}

const isEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Only ever send a player back to our own site. Creem will redirect to
 * whatever success_url it is given, so passing the browser's string through
 * unchecked would turn this endpoint into an open redirect.
 */
function sameSite(url, req) {
  if (typeof url !== 'string') return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  try {
    return new URL(url).host === String(host).split(',')[0].trim();
  } catch {
    return false;
  }
}
