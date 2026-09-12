import { configured, creem, readBody, send } from './_creem.js';
import { SECRET_RE, burnGuess, checkPin, loadAccount, normalizeEmail } from './_accounts.js';
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
 * The password is checked here for the same reason it is checked on sign-in,
 * and it matters more: behind this link are the card's last four digits, the
 * payment history and the cancel button. An address alone opening it would
 * let anyone who knows a subscriber's email cancel their subscription.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!configured()) return send(res, 503, { error: 'notConfigured' });

  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { email, password } = readBody(req);
  const address = normalizeEmail(email);
  if (!address) return send(res, 400, { error: 'missing' });

  // 按来路再数一道。理由和 passcode.js 的 change 一模一样：账号那头的锁定计
  // 数（错 4 次锁 4 小时）挡得住猜密码的人，可它同时也是一把递给陌生人的
  // 锁——知道你邮箱的人发四次乱填的请求就能把你关在自己的账号外面四小时。
  if (storeConfigured() && (await tooMany('portal', callerId(req), 20, 3600))) {
    return send(res, 429, { error: 'tooMany' });
  }

  // Same proof as signing in. An account that does not exist and a wrong
  // password get the same answer, so this cannot be used to find subscribers.
  const account = await loadAccount(address);
  if (!account || !SECRET_RE.test(String(password || ''))) {
    // 连花掉的时间也对齐，别让快慢把「这个地址有没有账号」说出去。
    burnGuess(password);
    return send(res, 401, { error: 'wrong' });
  }
  const verdict = await checkPin(address, String(password), account);
  if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
  if (verdict === 'locked') return send(res, 423, { error: 'locked' });
  if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });

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
