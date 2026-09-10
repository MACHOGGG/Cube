import { answer, configured, creem, emailOf, entitled, NOBODY, readBody, send } from './_creem.js';
import {
  SECRET_RE,
  checkPin,
  loadAccount,
  lockRemainingMs,
  normalizeEmail,
  issueToken,
  tokenValid,
  saveAccount,
} from './_accounts.js';
import { resolveEntitlement } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
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

  // 限速。这个接口谁都能打（它本来就是「还没登录的人来问」的那个口），每一
  // 次都要读一次库，有几条路还要替调用方去打一次 Creem——不挡的话，一个循环
  // 就能把 Creem 那边的额度替我们用光，也能拿密码一路撞过去。
  //
  // 两个桶，因为两件事要挡的东西不一样：
  //
  //   粗的那个管住整个接口。正常玩家每开一次网页问一次（见 engine/
  //     subscription.ts 的 refreshEntitlement），所以一小时 120 次对一个真人
  //     绰绰有余，对一个脚本立刻见底。挡在最前面，checkoutId 那条也一起挡。
  //   细的那个只数「拿密码来登录」那一条（见 fromEmail）。撞密码是这里唯一
  //     值钱的事，而真人一次登录只按一两下。账号那头本来就有锁定计数，可那
  //     是按账号数的——脚本挨个换邮箱就绕过去了，这一层挡的正是这一种。
  //
  // 拿令牌来的那条路不进细桶：那是每次开网页都会走的一条，真人走得最勤。
  // storeConfigured() 那半句和 redeem.js 一个道理：没有库就没有计数器，这一
  // 步不能因为数不了就把人全挡在外面。
  if (storeConfigured() && (await tooMany('sub', callerId(req), 120, 3600))) {
    return send(res, 429, { error: 'tooMany' });
  }

  const { checkoutId, email, password, token, action } = readBody(req);
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
        acct.inboxUnseen = 0;
        await saveAccount(who, acct);
      }
      return send(res, 200, { ok: true });
    }
    if (checkoutId) {
      // Settling an order is Creem's answer by definition — there is nobody
      // else to ask, so without the key this branch cannot run at all.
      if (!configured()) return send(res, 503, { error: 'notConfigured' });
      return send(res, 200, await fromCheckout(checkoutId));
    }
    if (email) return await fromEmail(req, res, String(email), password, token);
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
async function fromEmail(req, res, rawEmail, password, token) {
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
      if (!tokenValid(account, token)) return send(res, 401, { error: 'wrong' });
      // 答复里回给这台设备它自己那一把，而不是「最新签发的那一把」：几台设
      // 备各拿各的，谁也别把谁挤掉。
      issued = String(token);
    } else {
      if (!SECRET_RE.test(String(password || ''))) return send(res, 401, { error: 'wrong' });
      // 一小时二十次密码。真人登录一次按一两下；账号自己的锁定计数是按账号
      // 数的，脚本换个邮箱就重新开始，这一道按来路数，换邮箱绕不过去。
      if (await tooMany('subpw', callerId(req), 20, 3600)) {
        return send(res, 429, { error: 'tooMany' });
      }
      const verdict = await checkPin(address, String(password), account);
      if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
      if (verdict === 'locked') {
        return send(res, 423, { error: 'locked', retryInMs: lockRemainingMs(account) });
      }
      if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });
      // 拿密码登录：**添**一把新的给这台设备，别的设备手里那几把照旧有效
      // （见 _accounts.js 的 issueToken）。从前这里是换发——手机上登录一次
      // 就把电脑上那台顶下线了，那台下次去看排行榜只会被告知「请重新登录」。
      issued = issueToken(account);
      await saveAccount(address, account);
    }
  }

  // 两条路各归各，只写一遍（api/_entitlement.js 的 resolveEntitlement）：内部码
  // 账号看我们自己记的到期日，刷卡订阅去问 Creem。这儿凭刚验过的密码 / 令牌
  // 可以拿这个邮箱去问，那是这一支和别处唯一该不一样的地方。
  const { status, body } = await resolveEntitlement(address, account, issued);

  /**
   * 「他是谁」和「他是不是天才」是两个问题，答案要分开给。
   *
   * 密码验过了，令牌也签发了——**这个人已经登录成功了**，哪怕他此刻一份在续
   * 的订阅都没有。可 resolveEntitlement 在那种情况下答的是 NOBODY，而 NOBODY
   * 身上没有 token 也没有 email：前端于是既拿不到身份、又看到 active: false，
   * 只能报「这个邮箱名下没有有效的订阅」，把人挡在他自己的账号外面。
   *
   * 那个账号里有他的云端战绩、有寄给他的内部码。进不去还会连环：兑码要令牌，
   * 没登录就兑不到这个邮箱名下，只会另起一个跟他邮箱无关的身份。
   *
   * 所以密码对了就把身份一并给出去。active 照旧如实——不是天才就不是天才。
   */
  if (status === 200 && account && issued) {
    return send(res, 200, { email: address, ...body, token: issued });
  }
  return send(res, status, body);

}
