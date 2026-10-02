import { configured, creem, emailOf, entitled, periodOf, readBody, send } from './_creem.js';
import {
  accountId,
  codeHolder,
  createAccount,
  EMAIL_RE,
  ensureGiftCodes,
  loadAccount,
  newAccount,
  normalizeEmail,
  PASS_RE,
  saveAccount,
  setNews,
  takeAccount,
} from './_accounts.js';
import { storeConfigured } from './_store.js';

/**
 * The password on a card subscription.
 *
 * Before this existed, naming the address was the whole of signing in: type
 * any subscriber's email and the site handed over their subscription. The
 * address is not a secret — it is printed on every receipt and known to
 * everyone they have ever written to — so it could never have been the proof.
 * This endpoint is where the proof gets set.
 *
 * Two ways in, and what each one proves:
 *
 *   { checkoutId, password }            — a checkout Creem confirms is paid.
 *     Only whoever came back from that payment holds the id, so holding it
 *     is the evidence that the address is theirs to claim. This is the one
 *     the app uses, the moment the player lands back from Creem.
 *
 *   { code, token, email, password }    — the token a redeemed code
 *     returned. It attaches an address to what the code granted, so the
 *     month or year travels to the player's next phone instead of living
 *     and dying in one browser.
 *
 *   { register: true, email, password }  — **撤了**，见文件末尾那段。
 *   { email, password, newPassword }    — **撤了**，见文件末尾那段。
 *
 * Creem still owns the answer to "is this subscription paid up". Nothing
 * here grants an entitlement — it only decides who is allowed to ask.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  // No store, no accounts: say so rather than accepting a password that
  // would evaporate and lock the player out of what they just bought.
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { checkoutId, code, token, email, password, news } = readBody(req);
  // 建账号的两条路都顺手带着「愿不愿意收信」。改密码那条不带——那不是回答这
  // 个问题的地方，顺手改掉别人的订阅偏好是不对的。
  if (checkoutId) return create(res, String(checkoutId), password, news === true);
  if (code) return bind(res, String(code), String(token || ''), email, password, news === true);
  // 注册那一支也撤了（见文件末尾那段），所以带 `register: true` 的请求落到下面那一行，
  // 和任何别的认不出来的请求一样答 400 `action`——而不是悄悄落到某一支上去。
  return send(res, 400, { error: 'action' });
}

/**
 * Attaching an address to what a code granted.
 *
 * The proof is the token the redemption returned, held only by the browser
 * that spent the code — guessing the code itself buys nothing, since the code
 * is deleted the moment it is spent and this needs the token as well.
 *
 * An address that already has an account is refused rather than merged: the
 * only honest way to add time to an existing account is to prove that account
 * is yours first, and this request carries no such proof. Nothing is lost by
 * refusing — the code's month is still there under its own key, and still
 * works on this device, so the player can attach it to another address or
 * write in.
 */
async function bind(res, rawCode, token, email, password, news) {
  const address = normalizeEmail(email);
  // 认 accountId 而不是 EMAIL_RE：免邮箱凭据账号（E38）的 id 不是邮箱，而他一样该绑得了
  // 一张内部码（见 _accounts.js 的 accountId）。
  if (!accountId(address)) return send(res, 400, { error: 'invalid' });
  if (!PASS_RE.test(String(password || ''))) return send(res, 400, { error: 'weak' });

  const holder = codeHolder(rawCode);

  // Look before claiming. A wrong token must not so much as touch the
  // entitlement — otherwise anyone who guessed a code could take it out of
  // its owner's hands for as long as it takes to put it back.
  const seen = await loadAccount(holder);
  if (!seen || !seen.token || token !== seen.token) {
    return send(res, 401, { error: 'wrong' });
  }

  // Now claim it, in one step that only one caller can win.
  //
  // This used to be four separate steps — read the holder, check the
  // address, write the account, delete the holder — with nothing stopping a
  // second request from starting its own read while the first was still
  // between them. On Upstash every one of those steps is an HTTP round trip,
  // so "between them" is a long time, and two requests could each have come
  // away with the same month under a different address. GETDEL closes it:
  // the loser gets null.
  const granted = await takeAccount(holder);
  // Gone between the look and the claim: another request won it and has
  // already bound it to an address. From here that is indistinguishable
  // from — and means the same thing as — a code that has been used.
  if (!granted) return send(res, 409, { error: 'code' });

  // Taken. From here every way out that is not success has to put it back,
  // or the player loses what the code gave them to a refusal.
  const giveBack = () => saveAccount(holder, granted);

  if (!granted.token || token !== granted.token) {
    await giveBack();
    return send(res, 401, { error: 'wrong' });
  }
  // Everything the code was worth moves across; only the secret is new.
  const account = newAccount(String(password), 'code');
  account.until = granted.until;
  account.plan = granted.plan;
  setNews(account, news);
  // 「这个地址有没有人」和「把账号写进去」是同一步（createAccount 用的是
  // SET ... NX）。从前是先 loadAccount 看一眼、再 saveAccount 写进去，两步
  // 之间隔着一次网络往返——一家人共用一个邮箱、两个人各拿一张码前后脚点
  // 《绑定》，两边都读到「没人」，于是两边都写，后写的把先写的整个盖掉：
  // 两张码都被吃掉，库里只剩一份，先操作那个人手里的令牌当场作废，而他那
  // 屏上写的是「成功」。见 _accounts.js 的 createAccount。
  let created = false;
  try {
    created = await createAccount(address, account);
  } catch (err) {
    await giveBack();
    throw err;
  }
  if (!created) {
    await giveBack();
    return send(res, 409, { error: 'exists' });
  }

  return send(res, 200, { ok: true, email: address, token: account.token });
}

/** First password, proven by the checkout the player has just come back from. */
async function create(res, checkoutId, password, news) {
  if (!PASS_RE.test(String(password || ''))) return send(res, 400, { error: 'weak' });
  if (!configured()) return send(res, 503, { error: 'notConfigured' });

  let address;
  let period;
  try {
    const checkout = await creem('/v1/checkouts', { query: { checkout_id: checkoutId } });
    if (checkout?.status !== 'completed') return send(res, 403, { error: 'unpaid' });
    const sub =
      typeof checkout.subscription === 'string'
        ? await creem('/v1/subscriptions', { query: { subscription_id: checkout.subscription } })
        : checkout.subscription;
    if (!entitled(sub)) return send(res, 403, { error: 'unpaid' });
    address = normalizeEmail(emailOf(checkout) ?? emailOf(sub) ?? '');
    // Which product they bought, so the two gift codes a yearly subscriber
    // gets can be minted the moment the account exists.
    period = periodOf(sub);
  } catch (err) {
    console.error('passcode create failed:', err?.message || err);
    return send(res, 502, { error: 'upstream' });
  }
  if (!EMAIL_RE.test(address)) return send(res, 502, { error: 'upstream' });

  const account = newAccount(String(password), 'card');
  account.period = period;
  setNews(account, news);
  // An address that already has a password keeps it. Otherwise a second
  // checkout — anyone's — would be a way to overwrite someone else's.
  //
  // 「已经有人就不写」和「写进去」必须是同一步，不能先查再写：两笔结账同一
  // 瞬间回来（同一个地址买两次、或者一家人共用一个邮箱），两边都会读到「没
  // 人」，于是后写的那份把先写的密码和令牌一起顶掉。见 bind 里那段。
  if (!(await createAccount(address, account))) return send(res, 409, { error: 'exists' });
  // A year is a long thing to buy on your own recommendation, so a yearly
  // subscriber gets two months to hand out. Minted here, where the account
  // first exists, and remembered on it so they are never minted twice.
  const gifts = await ensureGiftCodes(address, account, period);
  // Hand back the token with it, so the device that just chose the password
  // is signed in by that act and never asked for it again.
  return send(res, 200, {
    ok: true,
    email: address,
    token: account.token,
    ...(gifts?.length ? { gifts } : {}),
  });
}

/*
 * **改密码那一支撤了**（E37，2026-10 的改制）。
 *
 * 密码整个取消了：登录改成邮箱验证码（api/signin.js）或者两串免邮箱凭据
 * （api/handle.js），于是「改密码」这件事无从谈起——邮箱账号没有密码可改，免邮箱账号
 * 要换第二串走的是 handle.js 的 reset（凭第一串）。
 *
 * 撤的是这一支和它的分发，连同只有它在用的那四样 import（burnGuess / checkPin /
 * SECRET_RE / updateAccount）。`bind` / `create` 两支留着（老账号、在途标签页），所以
 * `PASS_RE` 还在用——`bind` 那条路还要设六位密码。
 */

/*
 * **注册那一支也撤了**（E37 的第二半，2026-10-02）。
 *
 * ── 它是一个抢注接口 ──────────────────────────────────────────
 *
 * 这一支不要任何凭据就能在任意一个邮箱上开出账号，而**开出来的那个账号带着一把它自
 * 己设的密码和一把它自己的令牌**。于是：
 *
 *   ① 外人拿 `someone@gmail.com` 注册一遍，密码是他设的。
 *   ② 真正的主人将来用验证码登录（signin.js 的 confirm）——那个地址上已经有账号了，
 *      confirm 只会「添一把令牌」，不会动那把密码。
 *   ③ 两个人从此都进得去这个账号：主人凭验证码，外人凭密码和那把一直没作废的令牌。
 *      云端战绩、排行榜上的名字、后台寄进来的内部码，外人全看得到、全改得了。
 *
 * 要紧的是**屏幕上一个字都不报**：主人登进去看到的是一个空账号（他本来也以为是新
 * 的），外人那一头更安静。这正是这个仓库最怕的那种毛病——看着一切正常。
 *
 * 邮箱是公开的（CLAUDE.md：「邮箱地址本身不是证据。它印在收据上，谁都知道得到」），
 * 所以这不是「要先猜中什么」才成立的攻击，批量注册一张邮箱表就是了。限速（一小时
 * 10 次）只决定他一天能占多少个，不决定他占不占得到。
 *
 * ── 为什么撤得掉：没有谁在用它 ────────────────────────────────
 *
 * 开账号这件事已经由 signin.js 的 confirm 顺手做了，而那条路**自带证明**（收得到那
 * 封信就是「这个邮箱是你的」）。客户端这一侧 `registerAccount` / `webRegister` 从
 * E37 的前半起就没有任何界面入口了，所以撤掉这一支不断任何一条活着的路。
 *
 * 撤的是这一支、它的分发，和只有它在用的三样 import（grantLifetimeIfWindow /
 * callerId / tooMany）。`EMAIL_RE` 还在用（`create` 那一支验 Creem 回的地址）。
 *
 * ⚠️ **不要「顺手」把它加回来。** 一个不要凭据就能写库的接口，在一个「邮箱 = 账号身
 * 份」的系统里，等于把别人的身份先占下来。真要再开注册，先想清楚新开的账号凭什么
 * 不能被主人的验证码路覆盖——signin.js 的 confirm 现在有一道「没验过邮箱的账号，
 * 第一次验成功时把旧凭据全清掉」，那才是让两条路共存的前提。
 */
