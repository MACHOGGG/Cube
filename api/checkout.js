import { configured, creem, mode, products, readBody, send } from './_creem.js';
import { callerId, tooMany } from './_ratelimit.js';
import { storeConfigured } from './_store.js';

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
  // GET /api/checkout — 「这套东西到底配好了没有」，一个网址就能问。
  //
  // 存在的理由是一次真事：收单方的审核说「订阅结不了账」，而后台里密钥、商品
  // 都填着，从外面看不出是哪一环空的。要查只能翻 Vercel 的运行日志，或者拿
  // 一张真卡去点一遍。现在打开这个网址就有答案：四个布尔加一个 test/live。
  //
  // 回的全是「有没有」，没有一个字是密钥或商品 id 本身——那两样都还在这个函
  // 数的环境变量里，浏览器拿不到。
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

  // 按来路数一道。
  //
  // 这是全站最后一个「碰钱、却一次都没限过速」的接口——同样碰钱碰账号的
  // subscription / redeem / unlock / email / passcode / portal / mint 全都限了。
  // 它不要登录、不要任何验证，每调一次就真的去敲一次 Creem 的下单接口：一个
  // 跑坏的脚本就能把 Creem 给商户的调用额度打满，那段时间里真想订阅的玩家看
  // 到的是「服务器出了点问题」，钱付不出去。请求体里那个邮箱也不做归属校验
  // （开单本来就不需要证明这个地址是谁的），于是它还可能被当成往任意邮箱发
  // 「完成购买」提醒的跳板。
  //
  // 浏览器那头早就写好了收到 429 该说什么（engine/creem.ts 把它翻成 tooMany，
  // ui/subscribe.ts 显示成「试得太多了」）——前后端当初说好了要限速，服务端
  // 这一步一直空着。
  //
  // storeConfigured() 那半句和 redeem.js / subscription.js 一个道理：没有库就
  // 没有计数器，这一步不能因为数不了就把人全挡在外面——付钱这条路尤其不能。
  if (storeConfigured() && (await tooMany('checkout', callerId(req), 20, 3600))) {
    return send(res, 429, { error: 'tooMany' });
  }

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
