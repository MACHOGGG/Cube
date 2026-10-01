import { configured, creem, emailOf, entitled, periodOf, readBody, send } from './_creem.js';
import {
  burnGuess,
  checkPin,
  codeHolder,
  createAccount,
  EMAIL_RE,
  ensureGiftCodes,
  loadAccount,
  newAccount,
  normalizeEmail,
  PASS_RE,
  saveAccount,
  SECRET_RE,
  setNews,
  takeAccount,
  updateAccount,
} from './_accounts.js';
import { grantLifetimeIfWindow } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
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
 *   { register: true, email, password }  — nothing at all.
 *     注册。它不证明任何事，因为**没什么可证明的**：这一步是开一个还不存在的
 *     账号，而「这个地址上还没有人」本身就是唯一的前提（createAccount 的 SET NX
 *     就是在问这一句）。所以它和上面三条不一样，归它管的不是「谁可以要」，而是
 *     「这个地址还空着吗」。
 *
 *     为什么会有这条路：2026-10 把 Creem 的两个订阅商品暂时关掉，网页端改成
 *     「注册就解锁全部功能」（E11 / PR-12）。在那之前「注册」等于「订阅」——邮箱
 *     是 Creem 的结账页替我们收的，所以「只有邮箱和密码」这条路从来不存在，而
 *     界面上那颗《注册》键按下去是转回天才窗口，一个死圈。
 *
 *   { email, password, newPassword }    — the current password.
 *     Changing one already set. Nothing else can authorise this; a fresh
 *     checkout id will not overwrite an account that already has a password,
 *     or paying twice would be a way to take one over.
 *
 * Creem still owns the answer to "is this subscription paid up". Nothing
 * here grants an entitlement — it only decides who is allowed to ask.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  // No store, no accounts: say so rather than accepting a password that
  // would evaporate and lock the player out of what they just bought.
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { checkoutId, code, token, email, password, newPassword, news, register } = readBody(req);
  // 建账号的两条路都顺手带着「愿不愿意收信」。改密码那条不带——那不是回答这
  // 个问题的地方，顺手改掉别人的订阅偏好是不对的。
  if (checkoutId) return create(res, String(checkoutId), password, news === true);
  if (code) return bind(res, String(code), String(token || ''), email, password, news === true);
  // 注册那一支**认一个显式的旗子**，不认「有邮箱有密码、没有 newPassword」。后者
  // 和改密码那一支只差一个字段，哪天改密码的请求漏发了 newPassword，就会被当成
  // 注册，答回来一句「这个地址已经有人了」——而他要改的正是自己的密码。
  if (register === true) return signUp(req, res, email, password, news === true);
  return change(req, res, email, password, newPassword);
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
  if (!EMAIL_RE.test(address)) return send(res, 400, { error: 'invalid' });
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

/**
 * 注册：开一个账号，顺手把窗口期那份终身天才领走。
 *
 * ── 为什么不要任何凭据 ────────────────────────────────────────
 *
 * 另外三支都在回答「谁可以要」，这一支回答的是「这个地址还空着吗」——而那一问和写入
 * 是同一步（`createAccount` 的 SET NX）。所以这里没有令牌、没有结账 id、没有码可验，
 * 也不该假装有。
 *
 * 代价是它是整个 api/ 里唯一一个**不要凭据就能写库**的接口，所以限速是它唯一的门：
 * 按调用方记，一小时 10 次。10 而不是别处那个 20，是因为这一支还会消耗一样**全局稀
 * 缺**的东西（第一批 100 个名额）——按地址限速在这儿帮不上忙，每次注册本来就是一个
 * 新地址。10 对真人绰绰有余（一个人一辈子注册一次），对想一口气占掉一半名额的人则
 * 不够用。
 *
 * ── 先建账号，再领名额 ──────────────────────────────────────
 *
 * 顺序不能反。反过来是「先领号、再建账号」，而建账号可能输掉 SET NX（这个地址刚被
 * 别人占了），那个号就白烧了——第一批 100 个名额里凭空少一个，谁也查不出来去哪了。
 *
 * 领不到名额**不是失败**：账号照样开出来，只是不是天才。这是 CLAUDE.md 那条
 * 「『登着』和『是天才』是两件事」的直接后果——云端战绩、别人寄给他的内部码、改密
 * 码，全都挂在账号上，和权益无关。名额满了就回头去报错，等于把一个本来有用的账号
 * 也一起拒掉。
 *
 * 也因此这里不先问一句 `slotsLeft() > 0`：那是一次 check-then-act，和真正的领号之
 * 间隔着一次网络往返，问出来的数到动手时可能已经不是那个数了。`grantLifetimeIfWindow`
 * 自己是原子的（hincrby 领号、超了退号），让它去判，答案才算数。
 *
 * ── kind 必须是 'code' ─────────────────────────────────────
 *
 * 不是 'card'。权益记在我们自己库里的 `until` 上，正是这一支要写的那样东西。写成
 * 'card' 的后果在 `_entitlement.js:236` 那一支：Creem 没配的时候（而我们正要把那三
 * 个环境变量清掉）它对非 'code' 账号一律答 503，而 503 不带令牌——那个人从此登不进
 * 自己的账号。
 */
async function signUp(req, res, email, password, news) {
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address)) return send(res, 400, { error: 'invalid' });
  // 六位字母数字（_accounts.js 的 PASS_RE）。界面上那个框也写了 minlength/maxlength，
  // 但那只是提示，说了算的是这一行。
  if (!PASS_RE.test(String(password || ''))) return send(res, 400, { error: 'weak' });
  if (await tooMany('signup', callerId(req), 10, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const account = newAccount(String(password), 'code');
  setNews(account, news);
  if (!(await createAccount(address, account))) {
    // 已经有人了。**不合并**，理由和 bind 那一支一样：往一个已经存在的账号上做事，
    // 唯一诚实的前提是先证明那个账号是你的，而这个请求什么都没证明。答得和别的错不
    // 一样是故意的——界面要据此说「这个邮箱已经有账号了，去登录」，而不是让他对着
    // 一句含糊的失败反复试。
    //
    // 这句话确实透露了「这个地址有账号」，和任何一个《忘记密码》表单透露的是同一
    // 件事（见文件顶上那段），而含糊化的代价是把一个注册不了的人永久卡在门外。
    return send(res, 409, { error: 'exists' });
  }

  // 领名额。窗口没开、或者名额已经满了，它原地把这份账号还回来——上面说过，那不是
  // 失败。客户端接着会拿同一组凭据登录一次，那一次问到的权益才是屏幕上印的那个。
  await grantLifetimeIfWindow(address, account);

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

/** Changing a password, proven by the one it replaces. */
async function change(req, res, email, password, newPassword) {
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address) || !SECRET_RE.test(String(password || ''))) {
    return send(res, 400, { error: 'invalid' });
  }
  if (!PASS_RE.test(String(newPassword || ''))) return send(res, 400, { error: 'weak' });

  /**
   * 按**来路**再数一道，不只按账号。
   *
   * 账号那头的计数（checkPin）是按账号数的：错 4 次锁 4 小时，错 6 次封号。
   * 那道闸挡的是「有人在猜我的密码」，可它同时也是一把递到陌生人手里的锁：
   * 只要知道你的邮箱——这不难——发四次乱填的请求就能把你关在门外四个小时，
   * 而你自己一次都没输错过。《忘记密码》那条路解得开，可界面不会主动告诉被
   * 锁的人「这不是你的错，走那条路」。
   *
   * 登录那一支早就按来路数了（subscription.js 的 subpw），改密码和账号中心
   * 这两处一直没有。数一样多：真人改一次密码按一两下，脚本一小时二十次立刻
   * 见底。storeConfigured() 那半句和别处一个道理——没有库就没有计数器，不能
   * 因为数不了就把人全挡在外面。
   */
  if (storeConfigured() && (await tooMany('pwchange', callerId(req), 20, 3600))) {
    return send(res, 429, { error: 'tooMany' });
  }

  const account = await loadAccount(address);
  // Same answer for "no such account" as for "wrong password", so this
  // cannot be used to find out who has one. 时间也一样：有账号的那一路会真
  // 算一次 scrypt，这一路也烧同一份。
  if (!account) {
    burnGuess(password);
    return send(res, 401, { error: 'wrong' });
  }

  const verdict = await checkPin(address, String(password), account);
  if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
  if (verdict === 'locked') return send(res, 423, { error: 'locked' });
  if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });

  /**
   * 兜底是 **'code'**，不是 'card'。
   *
   * 这一行是全站**唯一**一条能在没有任何付款凭据的情况下造出 'card' 账号的路——另外
   * 那一处（上面的 create）要一笔 Creem 确认付过款的结账才走得到。
   *
   * 兜底写成 'card' 的后果：一个**没有 `kind` 字段的老账号**，改一次密码就被打成刷卡
   * 用户；而刷卡账号的权益按定义记在 Creem 那边，于是 `_entitlement.js` 那两处在
   * Creem 没配的时候（而那三个环境变量正要清掉）对他答 503，503 不带令牌——他从此登
   * 不进自己的账号。他做的只是改了个密码。
   *
   * 'code' 也正是 `newAccount` 自己的默认值（`_accounts.js:302`），所以这个兜底和
   * 「不传第二个参数」是同一个意思。有 `kind` 的照原样带过去，这一行只管缺的那种。
   */
  const fresh = newAccount(String(newPassword), account.kind || 'code');
  // A change keeps everything the account is worth — a redeemed code's
  // remaining time included — and replaces only the secret and its salt.
  // A change keeps what the account is worth and retires every token, so a
  // device someone else still holds stops working the moment you change it.
  //
  // 显式带过去的这几样，是 fresh 里有同名字段、会被它的出厂值盖掉的：
  //   until / plan  这个账号值多少钱——内部码剩下的时间、订阅的档位。
  //   news / newsAt 他愿不愿意收邮件，以及什么时候说的。改一把钥匙不该顺手
  //                 把这个意愿清成「不愿意」——_accounts.js 里那段注释讲得很
  //                 清楚：真被问起来，要拿得出「谁、什么时候、对什么说的同
  //                 意」。改密码把 newsAt 抹掉，那份底就没了。
  //   createdAt     注册时间。不带过去的话，一个老玩家改一次密码，发码页上
  //                 看就成了「今天刚注册」。
  //
  // 没带过去的是故意的：salt / hash / token / tokens 就是这次要换的东西（换
  // 钥匙，并把别人手上还留着的设备一起撤掉）；fails / lockUntil 归零也是对
  // 的——他刚用旧密码证明过自己是本人。blocked 走不到这儿（checkPin 判 blocked
  // 会先 423 返回），所以它取 fresh 的 false 不影响任何账号。
  //
  // 带锁的读—改—写（updateAccount），不是朴素的整份覆盖。上面那份 account 是
  // 进函数时读的快照，而这一句写回去的是整份账号：同一瞬间他在别处兑了一张码
  // （redeem 加时长）、或者后台给他发了码（mint 加收件箱），都会被 `until:
  // account.until` 这样的「显式带过去」按旧值盖回去——玩家刚兑上的一个月，因为
  // 他紧接着改了一次密码，就没了。
  //
  // 锁里那一份 a 就是库里此刻的样子，所以「要带过去的」不再是从 account 抄，而
  // 是**原地不动**：Object.assign(a, fresh, keep) 和原来那个 {...account,
  // ...fresh, ...keep} 展开出来一模一样，只是基准换成了新读的那一份。
  //
  // fresh 留在锁外面算是故意的：newAccount 要跑一次 scrypt（几十毫秒），不该占
  // 着锁烧。它带的 kind 来自 account 那份快照，和原来一样。
  const saved = await updateAccount(address, (a) => {
    const keep = {
      until: a.until,
      plan: a.plan,
      news: a.news,
      newsAt: a.newsAt,
      createdAt: a.createdAt,
    };
    Object.assign(a, fresh, keep);
  });
  if (!saved.ok) {
    // 和这个文件里别处同一条规矩：不因为失败的种类不同而说不一样的话。busy 例
    // 外——它和「密码不对」不是一回事，说错了玩家会去改密码，而他该做的是过一
    // 会儿再试。
    return send(res, saved.busy ? 503 : 401, { error: saved.busy ? 'busy' : 'wrong' });
  }
  return send(res, 200, { ok: true, email: address, token: saved.account.token });
}
