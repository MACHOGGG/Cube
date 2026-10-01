import { configured, creem, readBody, send } from './_creem.js';
import { loadAccount, normalizeEmail, tokenValid } from './_accounts.js';
import { callerId, tooMany } from './_ratelimit.js';
import { storeConfigured } from './_store.js';

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
 *
 * 身份用**登录令牌**证明，不是密码（E44）。
 *
 * 这件事非证明不可：这个链接后面是卡号后四位、付款记录和那颗退订键，光凭一个邮箱就
 * 打得开的话，知道某人邮箱的人就能把他的订阅退掉。
 *
 * 从前验的是密码。2026-10 的改制（E37）把密码整个取消了——登录改成邮箱验证码
 * （api/signin.js）或者两串免邮箱凭据（api/handle.js），两条路都只留下一样东西可以在
 * 之后的请求里拿出来用：那把登录令牌。它是**同样强的**证明（`issueToken` 发的是 24 字
 * 节随机，比六位密码难猜得多），而且是**唯一还存在的**证明。
 *
 * 顺带少了一个麻烦：验密码那条路会累计「错了几次」并在第 4 次锁账号 4 小时，于是它同
 * 时是一把递给陌生人的锁——知道你邮箱的人发四次乱填的请求就能把你关在门外。令牌对不上
 * 不计数，因为它不是人记得住、会打错的东西。
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!configured()) return send(res, 503, { error: 'notConfigured' });

  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { email, token } = readBody(req);
  const address = normalizeEmail(email);
  if (!address) return send(res, 400, { error: 'missing' });

  // 按来路数一道。令牌本身不值得猜（24 字节随机），这一道挡的是「拿一份地址名单挨个
  // 来问」——每问一次我们都要往 Creem 打两次 HTTP。
  if (await tooMany('portal', callerId(req), 20, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  // 没有这个账号、和令牌对不上，答同一句话——否则这一支就成了一个「谁在订阅」的查询
  // 接口。`tokenValid` 自己过期和多设备那串钥匙都管了（_accounts.js 的 tokenRing）。
  const account = await loadAccount(address);
  if (!account || !tokenValid(account, token)) return send(res, 401, { error: 'wrong' });

  try {
    const customer = await creem('/v1/customers', { query: { email: address } });
    if (!customer?.id) return send(res, 404, { error: 'none' });
    const links = await creem('/v1/customers/billing', {
      method: 'POST',
      body: { customer_id: customer.id },
    });
    if (!links?.customer_portal_link) return send(res, 502, { error: 'upstream' });
    return send(res, 200, { url: links.customer_portal_link });
  } catch (err) {
    if (err?.status === 404) return send(res, 404, { error: 'none' });
    console.error('portal failed:', err?.message || err);
    return send(res, 502, { error: 'upstream' });
  }
}
