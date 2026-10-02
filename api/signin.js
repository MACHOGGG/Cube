import { randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import {
  clearFails,
  createAccount,
  EMAIL_RE,
  hasSecret,
  issueToken,
  loadAccount,
  newAccount,
  normalizeEmail,
  revokeTokens,
  setNews,
  unblock,
  updateAccount,
} from './_accounts.js';
import { grantLifetimeIfWindow, resolveEntitlement } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
import { bump, del, get, set, storeConfigured } from './_store.js';
import { compose, mailLang, sendMail } from './_mail.js';

/**
 * 注册 / 登录 —— 一条路，一个邮箱，一张六位验证码。
 *
 * 2026-10 的改制（E37）：取消密码，也取消「订阅」这件事。玩家留一个邮箱，收一张码，
 * 打进来就进去了；这个地址上没有账号就当场开一个，有就是登录。两件事在界面上是同一
 * 颗键，在这儿也是同一条路——**因为玩家分不出自己是哪一种，也不该要他分**。
 *
 * ── 和 api/unlock.js 的三处不同 ──────────────────────────────
 *
 * 照着 unlock 的结构写（限速、bump 计数、六位码、30 分钟），但有三处是故意不一样的：
 *
 * ① **地址上没有账号也要发。** unlock 只给已有账号的地址发信，因为它是「找回密码」，
 *    给陌生地址发等于替人确认「这个地址有号」。这一支是注册兼登录，**给所有合法地址都
 *    发**，所以没有那个顾虑。
 *
 * ② **发信失败如实回报**（E51）。unlock 吞掉失败、照答 `sent: true`，理由正是上面那
 *    条：它只给有账号的地址发，失败与否会泄露「这个地址有没有账号」。这一支给谁都发，
 *    失败和账号存不存在**毫无关系**，所以如实说不透露任何东西。吞掉反而有害：Resend
 *    的额度一满，所有人都收不到码，而界面上看不出任何异常——玩家只会以为自己邮箱坏
 *    了。回 `{ sent: false, reason: 'mailDown' }`，界面据此引导他去免邮箱那条路。
 *
 * ③ **登录不踢别的设备。** unlock 那条路会 `revokeTokens`（它的前提是「这个账号可能
 *    已经不只我一个人在用」）。这一支是日常登录：`issueToken` 只是往那串钥匙上**添一
 *    把**，手机上登一次不该把平板上那一把弄掉。
 *
 *    **一个例外**：这个地址从来没验过、身上却挂着一把别人设的密码——那正是 unlock 那条
 *    路的前提，所以照它办，旧令牌一并作废。见 `confirm` 里 `claimed` 那一段。
 *
 * ── 为什么回包里要带 created ─────────────────────────────────
 *
 * 「要不要问他愿不愿意收 Slides 的更新邮件」只该问一次，而「这一次是第一次」只有服务
 * 端知道。所以这一位由服务端说，界面照它决定摆不摆那个勾选框——老玩家重新登录时
 * `news` 一个字不动，更不该拿一个出厂不勾的框去把他当初勾过的意愿抹掉。
 */

const CODE_TTL_S = 30 * 60;
const MAX_TRIES = 5;
const key = (email) => 'signin:' + email;
/**
 * 猜了几次，单独存一个键，用 INCR（见 _store.js 的 bump）。
 *
 * 和验证码存在一起的话，改它要走「读整份 → 判断 → 改一个字段 → 整份写回」，三步之间
 * 隔着两次网络往返；同一瞬间打进来的几十个请求都会读到「才猜了 0 次」，于是整批只被
 * 记成一次——5 次上限形同虚设。这个坑在 unlock.js 上记着，照同一套来。
 */
const triesKey = (email) => 'signin:tries:' + email;

/**
 * 验证码那封信，四种语言。挑哪一种、以及「非英文时英文永远附一份」，见 _mail.js 的
 * compose——所有发信的地方共用那一条规矩。
 *
 * 不说「注册」也不说「登录」：收到它的人自己不知道是哪一种，而这封信也不需要他知道。
 */
const MAIL = {
  en: {
    subject: 'Slides — your code',
    body: (c) =>
      `Your Slides code is ${c}. It is valid for 30 minutes.\n` +
      `If this was not you, you can ignore this message.`,
  },
  zhHans: {
    subject: 'Slides — 验证码 / your code',
    body: (c) =>
      `你的 Slides 验证码是 ${c}，30 分钟内有效。\n` +
      `如果这不是你本人操作，忽略这封邮件即可。`,
  },
  zhHant: {
    subject: 'Slides — 驗證碼 / your code',
    body: (c) =>
      `你的 Slides 驗證碼是 ${c}，30 分鐘內有效。\n` +
      `如果這不是你本人操作，忽略這封郵件即可。`,
  },
  fr: {
    subject: 'Slides — votre code / your code',
    body: (c) =>
      `Votre code Slides est ${c}. Il est valable 30 minutes.\n` +
      `Si ce n’est pas vous, ignorez ce message.`,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  // 没有地方存账号，就别收一张会蒸发的验证码。
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  const address = normalizeEmail(body.email);
  if (!EMAIL_RE.test(address)) return send(res, 400, { error: 'email' });

  return body.action === 'confirm'
    ? confirm(res, address, body)
    : request(res, req, address, body.lang);
}

async function request(res, req, address, wantLang) {
  const lang = mailLang(wantLang);

  // 两道限速，挡的是两件不一样的事（和 unlock.js 同一组参数）：
  //
  //   by address —— 知道某人邮箱的人，否则可以拿这个接口往他信箱里一直塞验证码。
  //     一小时三封，比一个真的没收到信的人需要的还多。
  //   by caller  —— 一台机器也不许拿着一份地址名单挨个来要码。
  //
  // 两道都答 429 而不是假装发了：真在等信的人有权知道为什么什么都没来。
  if (await tooMany('signin:to', address, 3, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (await tooMany('signin:from', callerId(req), 10, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  await set(key(address), { code }, CODE_TTL_S);
  // 新码新账：上一张码猜掉的次数不跟着过来。
  await del(triesKey(address));

  /**
   * 发不出去就说发不出去（E51）。
   *
   * `sendMail` 在没配 Resend（`mailConfigured()` 为假）和真发失败两种情况下都回假，
   * 对玩家而言是同一件事「这条路现在走不通」，所以不分开报。界面收到 `mailDown`
   * 留在填邮箱那一屏，提示他改走免邮箱那条路——那条路不依赖任何外部服务。
   *
   * ⚠️ 码**照旧写进库里**，不因为信没发出去就删掉：真实情况里「Resend 回了错但信其
   * 实寄到了」是有的，删掉码的话那张寄到的码反而成了废纸。多留 30 分钟不花钞。
   */
  const sent = await sendMail({ to: address, ...compose(MAIL, lang, code) });
  return send(res, 200, sent ? { sent: true } : { sent: false, reason: 'mailDown' });
}

async function confirm(res, address, { code, news }) {
  // 先占掉一次机会，再去比对——次序反过来就是那道假门：几十个并发请求会一起通过
  // 「还没到 5 次」这一关，然后一起猜。占号是原子的，所以第 6 个请求拿到的就是 6，
  // 它连码是多少都不会去读（照 unlock.js 那一段）。
  const tries = await bump(triesKey(address), CODE_TTL_S);
  if (tries > MAX_TRIES) {
    await del(key(address));
    await del(triesKey(address));
    return send(res, 429, { error: 'expired' });
  }

  const pending = await get(key(address));
  if (!pending) return send(res, 400, { error: 'expired' });
  if (String(code || '').trim() !== pending.code) {
    return send(res, 401, { error: 'wrongCode' });
  }

  /**
   * 码对上了。这一刻之后才分「注册」和「登录」——而分法只有一条：这个地址上有没有账号。
   *
   * 注册那一支的密钥是**空串**，因为这种账号没有密码。空串不会把老的密码登录路径捅
   * 开：`api/subscription.js` 那一支如今对谁都答 401（E37），而在它还认密码的年代，
   * `SECRET_RE = /^.{4,128}$/` 本来也挡着空串。
   */
  const existing = await loadAccount(address);
  const created = !existing;

  if (created) {
    const fresh = newAccount('', 'code');
    // 「愿不愿意收 Slides 的更新邮件」只在建账号这一刻记一次，连同时刻一起（setNews）。
    setNews(fresh, news === true);
    // 这张码就是「这个地址是他的」的证明，所以新账号一出生就带着这一位。下面
    // `claimed` 那一段解释它为什么要存下来。
    fresh.emailVerifiedAt = Date.now();
    // 查和写是同一步（SET NX）。同一个人两台设备同时打码进来，只有一台写得成；输的
    // 那台落到下面那条「已有账号」的路上，读到的就是赢家写的那一份，两台都登得进去
    // ——而赢家那一份已经带着 emailVerifiedAt，所以 `claimed` 不会误判成抢注。
    if (await createAccount(address, fresh)) {
      // newAccount 自己就发了第一把令牌（tokens 里正是那一把），不用再 issueToken。
      return finish(res, address, fresh, fresh.token, true);
    }
  }

  /**
   * 已有账号这一支：带锁的读—改—写，不是「读出来、改、整份写回」。
   *
   * 原先这儿是 `loadAccount` → `issueToken` → `saveAccount`，三步之间隔着两次网络往
   * 返。后台这一瞬间往他收件箱里塞一张码（mint.js 的 addToInbox）、或者他自己在另一台
   * 设备上同时登录，那份旧快照写回去就把人家刚写进去的东西整个盖掉——**而两边都答
   * 「成功」**。这个坑在 redeem.js 的「加时长」那一段上记着，照同一套来。
   */
  let issued;
  let claimed = false;
  const got = await updateAccount(address, (a) => {
    /**
     * ⚠️ **抢注清理**：这个地址从来没有凭「收到过一张寄到它的码」证明过自己，而它身上
     * 却挂着一把密码——那把密码是**别人**设的。
     *
     * 旧的 `api/passcode.js` 有一支 `register: true`：不要任何凭据，拿任意邮箱加一个
     * 自选密码就开得出账号（那一支在 2026-10-02 撤了，文件末尾记着为什么）。`bind` 那
     * 一支也类似：手里有一张内部码的令牌，就能把它绑到任意一个邮箱上并设一把密码。两
     * 条路都只证明了「我有某样东西」，**没有**证明「这个邮箱是我的」。
     *
     * 于是真正的主人第一次拿验证码登录时，账号已经存在了。从前这一步只是「添一把令
     * 牌」——两个人从此都进得去：主人凭验证码，抢注的人凭他自己那把密码和一直没作废
     * 的令牌。云端战绩、排行榜上的名字、后台寄进来的内部码，他全看得到。**而屏幕上一
     * 个字都不报。**
     *
     * 所以第一次验成功时把旧凭据整个清掉：换盐、把密码抹成空串（`unblock(a, '')`，顺
     * 带两个计数归零、解封），旧令牌全作废另发一把（`revokeTokens`）。
     *
     * 两个条件都要满足，少一个都会误伤：
     *
     *   · 没有 emailVerifiedAt —— 没验过。有了就不再清，否则每次登录都把别的设备踢
     *     下线。这一位因此必须存下来，不能当场算。
     *   · hasSecret —— 身上真有一把密码。验证码开出来的老账号（密钥是空串）一把密码
     *     也没有，它的令牌都是本人的，清掉只是白白把他另一台设备弄下线。
     *
     * 代价照实说：真有人被抢注过，清理这一下会把**抢注者和主人**的设备一起踢掉，而主
     * 人手上本来也没有能用的令牌（他正在登录）。老的刷卡账号（kind 'card'）第一次走这
     * 条路也会被清掉密码——那把密码如今没有任何入口在用（subscription.js 一律 401），
     * 所以不损失什么。
     */
    if (!a.emailVerifiedAt && hasSecret(a)) {
      claimed = true;
      unblock(a, '');
      issued = revokeTokens(a);
    } else {
      /**
       * 日常登录：添一把令牌，**不是把别的都作废**（见文件顶上第 ③ 条）。`issueToken`
       * 自己管那串钥匙的上限和年限（_accounts.js 的 MAX_TOKENS / TOKEN_TTL_MS）。
       */
      issued = issueToken(a);
    }
    if (!a.emailVerifiedAt) a.emailVerifiedAt = Date.now();
  });

  if (!got.ok) {
    /**
     * ⚠️ **码不删。** 到这一行为止，一件不可逆的事都没做成：令牌没发出去，账号没动过。
     * 删掉码的话他重输同一张码会被告知「已过期」，而他什么都没做错——他只能回头再要一
     * 封，而要码那道限速是一小时三封。照实说一句「正忙」，让他原地再按一次。
     *
     * 两种不成都答同一句 503「正忙」：
     *
     *   busy    —— 抢不到锁（约一秒八次都没抢到）。原地再按一次就好。
     *   missing —— 理论上到不了（上面刚 loadAccount 读到过它），真到了就是有人在这两步之
     *     间把账号删了。重来那一次会走上面注册那一支，自己就好了。
     *
     * 都**不许**答「码过期」：那句话会把他支去要一张新码，而要码那道限速是一小时三封——
     * 而他手里这张明明还好着。客户端认得 503（engine/creem.ts 的 codeFailure → 'unavailable'
     * 「服务器暂时答不上来」），那正是此刻的实情。
     */
    return send(res, 503, { error: 'busy' });
  }

  // 清理那一下之后，账号对象上的 fails 归零了，可「错了几次」还另有一个 Redis 计数键
  // （见 _accounts.js 的 failKey）。不清的话下一次输错会接着旧的次数往上数。
  if (claimed) await clearFails(address);

  return finish(res, address, got.account, issued, created);
}

/**
 * 三件不可逆的事都做完之后那一段，两支共用。
 *
 * `created` 由调用方说，不在这儿算：它的意思是「这一趟是不是第一次」，而界面拿它决定
 * 要不要摆那个「愿不愿意收更新邮件」的勾选框（见文件顶上那段）。
 */
async function finish(res, address, account, issued, created) {
  await del(key(address));
  await del(triesKey(address));

  /**
   * 身份已经成立（这张码是寄到这个地址的），所以这儿才写得了那份终身天才。
   * 窗口关着时这一句是 no-op（见 _entitlement.js 的 grantWindowOpen）。
   *
   * 摆在 resolveEntitlement 之前：写完再问权益，这一次登录就看得到自己是天才；反过来
   * 要等下一次启动，而玩家会以为没生效。
   */
  const after = (await grantLifetimeIfWindow(address, account)) || account;

  /**
   * 到这一行为止**三件回不去的事都做完了**：账号开出来了（如果是新的）、令牌发出去
   * 了、验证码从库里删掉了。所以下面那一问答不出来也不能把整趟说成失败——那正是
   * unlock.js 里记着的那个坑：先做不可逆的事，再做可能失败的事，然后拿后者的结果去
   * 汇报前者，玩家于是再点一次，而码已经没了。
   */
  const done = { ok: true, email: address, token: issued, created };
  try {
    const { status, body } = await resolveEntitlement(address, after, issued);
    // token 一律用这台设备刚拿到的那一把：答不出权益时的 NOBODY 身上没有 token，
    // 让 body 盖上去会把它抹掉，那台设备就白收了一次验证码。
    return send(res, 200, status === 200 ? { ...done, ...body, token: issued } : done);
  } catch (err) {
    console.error('signin entitlement lookup failed:', err?.message || err);
    return send(res, 200, done);
  }
}
