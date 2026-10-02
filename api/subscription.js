import { answer, configured, creem, emailOf, entitled, NOBODY, readBody, send } from './_creem.js';
import { loadAccount, normalizeEmail, tokenValid, updateAccount } from './_accounts.js';
import { grantLifetimeIfWindow, resolveEntitlement } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
import { storeConfigured } from './_store.js';

/**
 * Is this player subscribed? Asked in two situations, and Creem is the only
 * one who answers either of them:
 *
 *   checkoutId  — they have just come back from paying. The order is
 *                 confirmed with Creem rather than believed from the query
 *                 string, which anyone can type.
 *   email       — a device that has already signed in once, asking again on
 *                 launch. The proof is the **登录令牌**, nothing else. The
 *                 address alone was never proof of anything: it is printed on
 *                 the receipt and known to everyone the player has written to,
 *                 so answering it handed the subscription to whoever typed it.
 *
 * 拿密码走这一路那一支**撤了**（E37，见 fromEmail 里那段）。真正的登录如今只有两条
 * 路：邮箱验证码（api/signin.js）和两串免邮箱凭据（api/handle.js），两条都发令牌，
 * 而这个接口只负责认那把令牌。
 *
 * What the token does NOT do is decide whether the subscription is paid
 * up — Creem still answers that, every time, and an account here with a
 * lapsed subscription behind it gets nothing. It only decides who may ask.
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

  // 限速。这个接口谁都能打（它本来就是「还没登录的人来问」的那个口），每一
  // 次都要读一次库，有几条路还要替调用方去打一次 Creem——不挡的话，一个循环
  // 就能把 Creem 那边的额度替我们用光，也能拿密码一路撞过去。
  //
  // 只剩一个桶了。从前另有一个细桶（`subpw`）专数「拿密码来登录」那一条，而密码那
  // 一支已经撤了（见 fromEmail 里那段）：现在这一路只认令牌，而令牌是 24 字节随机
  // 数，没有「撞」这回事可挡。
  //
  // 粗的这个管住整个接口。正常玩家每开一次网页问一次（见 engine/subscription.ts 的
  // refreshEntitlement），所以一小时 120 次对一个真人绰绰有余，对一个脚本立刻见底。
  // 挡在最前面，checkoutId 那条也一起挡。
  //
  // storeConfigured() 那半句和 redeem.js 一个道理：没有库就没有计数器，这一步不能
  // 因为数不了就把人全挡在外面。
  if (storeConfigured() && (await tooMany('sub', callerId(req), 120, 3600))) {
    return send(res, 429, { error: 'tooMany' });
  }

  const { checkoutId, email, token, action } = readBody(req);
  try {
    // 「我看过了」——玩家点开内部码弹窗时说一声，主菜单那块提示就该收起来。
    //
    // 只清计数，一张码都不动：看过不等于用过。身份还是拿 token 认，和别处
    // 一样——没有它，任何人报一个邮箱就能把别人的提示按掉。
    if (action === 'seenInbox') {
      if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });
      const who = normalizeEmail(email);
      const acct = who ? await loadAccount(who) : null;
      if (!tokenValid(acct, token)) return send(res, 401, { error: 'wrong' });
      if (acct.inboxUnseen) {
        // 带锁的读—改—写（updateAccount），不是朴素的整份覆盖。这一下写的是整
        // 份账号，而它和后台给他发码（api/mint.js 的 grant）是并发的：覆盖写会
        // 拿点开弹窗那一刻读到的旧 inbox 盖回去——玩家「看一眼」这个动作，反而
        // 把别人刚寄给他的几张码抹掉了，两边都不报错。
        const saved = await updateAccount(who, (a) => {
          a.inboxUnseen = 0;
        });
        // 没抢到锁就不清这个计数：弹窗上那个小红点多挂一会儿，比吃掉几张码好。
        if (!saved.ok) return send(res, saved.busy ? 503 : 401, { error: saved.busy ? 'busy' : 'wrong' });
      }
      return send(res, 200, { ok: true });
    }
    if (checkoutId) {
      // Settling an order is Creem's answer by definition — there is nobody
      // else to ask, so without the key this branch cannot run at all.
      if (!configured()) return send(res, 503, { error: 'notConfigured' });
      return send(res, 200, await fromCheckout(checkoutId));
    }
    if (email) return await fromEmail(res, String(email), token);
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
 * Sign in / restore: 认那把登录令牌，然后才去问 Creem。
 *
 * ── 拿密码走这一路那一支撤了（E37，2026-10-02）───────────────
 *
 * 原先这儿有两条：带 `token` 的走令牌，不带的就拿 `password` 去 `checkPin`。密码这件
 * 事整个取消之后，那一支是一条**只剩下被猜的价值**的路：
 *
 *   · 验证码登录开出来的账号（api/signin.js），密钥是空串，没有密码可以对。
 *   · 还剩着一把密码的账号，那把密码是旧的 `passcode.js` 时代设的——而设它的人只证明
 *     了「我有一个结账 id / 一张内部码的令牌」，没证明那个邮箱是他的。signin.js 里那段
 *     抢注清理正是为这一类写的，它第一次验成功就把那把密码抹掉。
 *   · 界面上也早就没有输密码的框了（E37 前半，`src/ui/subscribe.ts`）。
 *
 * 所以留着它只有坏处：一个谁都能打的、按账号计数、每次烧一轮 scrypt 的猜测入口。撤掉
 * 之后这一路只认令牌，而令牌是 24 字节随机数，没有「撞」这回事。
 *
 * ── 一句话答三件事 ─────────────────────────────────────────
 *
 * 「这个地址没有账号」「没带令牌」「令牌不对」三种，答的是同一句 401 `wrong`，而且走的
 * 是同一行代码、同一次读库。从前这三种要靠一段专门的诱饵（`burnGuess` 烧一轮 scrypt、
 * 空走一遍限速桶）才长得一样，就是为了不让外面的人拿一份邮箱名单挨个打过来查出「哪些
 * 是本站用户」。现在它们天然一样，那段诱饵连同 `burnGuess` / `checkPin` / `SECRET_RE`
 * 一起撤了——**不是不要那条规矩了，是不再需要装样子**。
 *
 * 顺带没了的：`needsPasscode`（「订阅是活的、却还没设过密码」那一句）。它只在「这个地
 * 址没有账号」的时候由 `resolveEntitlement` 给出来，而那种请求现在在上面就 401 了。
 * 客户端那一侧还认得它（src/engine/creem.ts），留着不碍事——这一推只改服务端。
 */
async function fromEmail(res, rawEmail, token) {
  // Without the store there are no accounts to check against, and a check
  // that cannot run must not be treated as a check that passed.
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });
  const address = normalizeEmail(rawEmail);
  // let 而不是 const：下面送终身天才那一句会把库里此刻那一份换进来。
  let account = await loadAccount(address);

  // 令牌是这一路唯一的凭据。`tokenValid` 自己兼顾了「没账号」和「没带令牌」两种
  // （见 _accounts.js），所以这一行就是上面说的「一句话答三件事」。
  if (!tokenValid(account, token)) return send(res, 401, { error: 'wrong' });
  // 答复里回给这台设备它自己那一把，而不是「最新签发的那一把」：几台设备各拿各的，
  // 谁也别把谁挤掉。也正因为不换发，这一路不写库——每次开网页都走它，写一次等于把
  // 别处刚写进去的东西（兑码加的时长、后台寄的码）置于险地。
  const issued = String(token);

  /**
   * 窗口期：登录成功即送终身天才（《侵蚀阶梯》E11 / PR-12）。
   *
   * 必须在身份证明成立之后——上面那一行验过登录令牌，走到这儿就等于「这个人是这个邮箱
   * 的主人」。邮箱地址本身不是证据，它印在收据上，谁都知道得到（CLAUDE.md 那条铁律）。
   *
   * 摆在 resolveEntitlement 之前：写完再问权益，这一次就能看到自己是天才；反过来要等
   * 下一次启动，而玩家会以为没生效。
   *
   * 窗口没开时这一句是 no-op（grantWindowOpen() 为假，函数第一行原地返回），而且它永远
   * 返回一份账号，不会把 account 弄成 undefined。
   */
  account = await grantLifetimeIfWindow(address, account);

  // 两条路各归各，只写一遍（api/_entitlement.js 的 resolveEntitlement）：内部码
  // 账号看我们自己记的到期日，刷卡订阅去问 Creem。这儿凭刚验过的令牌可以拿这个邮箱
  // 去问，那是这一支和别处唯一该不一样的地方。
  const { status, body } = await resolveEntitlement(address, account, issued);

  /**
   * 「他是谁」和「他是不是天才」是两个问题，答案要分开给。
   *
   * 令牌验过了——**这个人已经登录成功了**，哪怕他此刻一份在续的订阅都没有。可
   * resolveEntitlement 在那种情况下答的是 NOBODY，而 NOBODY 身上没有 token 也没有
   * email：前端于是既拿不到身份、又看到 active: false，只能报「这个邮箱名下没有有效的
   * 订阅」，把人挡在他自己的账号外面。
   *
   * 那个账号里有他的云端战绩、有寄给他的内部码。进不去还会连环：兑码要令牌，没登录就
   * 兑不到这个邮箱名下，只会另起一个跟他邮箱无关的身份。
   *
   * 所以令牌对了就把身份一并给出去。active 照旧如实——不是天才就不是天才。
   */
  if (status === 200) return send(res, 200, { email: address, ...body, token: issued });
  return send(res, status, body);
}
