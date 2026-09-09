import { configured, creem, mode, products, readBody, send } from './_creem.js';

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
  // GET is a self-check, openable in a browser: is this deployment actually
  // able to sell anything, and out of which catalogue?
  //
  // It exists because the two ways this can be broken are invisible from the
  // outside and identical to each other. Either the environment has no Creem
  // settings at all — and the paywall then says, correctly but unhelpfully,
  // that the subscription is not open yet — or it has *test* settings, and
  // the checkout page opens and looks completely normal and no card on earth
  // can complete it. Both read as "the subscription doesn't work", and
  // guessing which one it is from the outside is not possible.
  //
  // Nothing secret is returned. The key never appears; what comes back is
  // whether one is set, which catalogue its prefix points at, and whether
  // the two product ids are filled in — all of which the paywall's own
  // behaviour already reveals, one click at a time.
  if (req.method === 'GET') {
    const { monthly, yearly } = products();
    return send(res, 200, {
      configured: configured(),
      mode: configured() ? mode() : null,
      monthly: Boolean(monthly),
      yearly: Boolean(yearly),
      sellable: Boolean(configured() && monthly && yearly),
    });
  }
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
    // Vercel's runtime log is the only place the whole Creem message is
    // visible; without it a 502 here is indistinguishable from every other
    // 502.
    console.error('checkout failed:', err?.message || err);
    // Creem 的状态码跟着回给浏览器。这不是秘密——密钥走的是请求头，商品 id
    // 本来就是浏览器点哪个套餐决定的，回去的只有「Creem 拒了，它说 404」。
    // 有了它，出问题的那一刻在浏览器的网络面板里就看得出是哪一类：
    //
    //   404 / 403  这个商品 id 在这把密钥的那本目录里不存在——十有八九是
    //              test 的 id 配了 live 的密钥，或者反过来（见 _creem.js 的
    //              base()：走哪个域名是按密钥前缀选的）。
    //   401        密钥本身不对。
    //   5xx        Creem 自己出问题了，等一会儿再试。
    return send(res, 502, { error: 'upstream', upstreamStatus: err?.status ?? 0 });
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
