import { randomBytes, randomInt } from 'node:crypto';
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
import { atLimit, callerId, countHit, tooMany } from './_ratelimit.js';
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
/** 一个邮箱一小时最多寄出去这么多封（只数寄出去的，见 request）。 */
const TO_ALL_PER_HOUR = 10;

/**
 * 一张票（`challenge`）：这一次要码的人自己的凭据。
 *
 * ── 原先是什么样 ──────────────────────────────────────────────
 *
 * 码存在 `signin:<邮箱>` 底下，猜测次数存在 `signin:tries:<邮箱>` 底下——**按地址，不按
 * 这一次**。而这个接口对谁都发信（它是注册兼登录，没有「这个地址有没有号」可藏）。两件
 * 事合起来，任何知道某人邮箱的人都能把他挡在门外，而且不需要任何凭据：
 *
 *   ① 他正在读信的时候，外人替他要一张新码——`set` 把他那张**覆盖**掉。他照着信上那六
 *      位数打进来，得到「验证码不对」。
 *   ② 或者外人拿他的地址乱猜 5 次：`tries > MAX_TRIES` 那一支会**把码删掉**。他手里那张
 *      当场作废，答的是「验证码已过期」。
 *   ③ 他回头再要一张，而要码那道限速是一小时三封——外人也在用同一个桶。
 *
 * 全程他看不出任何异常，只会觉得「这个网站的验证码是坏的」。
 *
 * ── 现在 ────────────────────────────────────────────────────
 *
 * 要码那一趟当场发一张票（8 字节随机数，16 位十六进制），码和计数都存在**这张票**底下，
 * 而票只回给要码的那台设备。外人于是只能破坏自己那一张：
 *
 *   signin:<邮箱>:<票>          这一张码
 *   signin:tries:<邮箱>:<票>    这一张猜了几次
 *
 * ⚠️ **票绝不能带冒号，邮箱也不能**（`EMAIL_RE` 从 2026-10-02 起禁止冒号）。不然
 * `signin:` + 邮箱 拼出来的键会和别的键撞上——比如一个叫 `tries:受害者@x.com` 的地址，
 * `signin:tries:受害者@x.com` 正好是受害者那个计数键。门里有一条专钉这件事。
 *
 * ⚠️ 不带票的那条路**留着**，但只对「这一次上线之前就发出去的码」有用：那些码存在老键
 * （`signin:<邮箱>`）底下，而从这一刻起没有任何地方再往老键里写。它们自己 30 分钟后过
 * 期，于是这条过渡路自己就消失了——不用记一个「上线时间 + 30 分钟」的常数（那种常数一定
 * 会被忘在代码里）。过渡期里它和从前一样可被破坏，那是这条路的全部代价。
 */
const CHALLENGE_RE = /^[0-9a-f]{16}$/;
const newChallenge = () => randomBytes(8).toString('hex');

const key = (email, ticket) => 'signin:' + email + (ticket ? ':' + ticket : '');
/**
 * 猜了几次，单独存一个键，用 INCR（见 _store.js 的 bump）。
 *
 * 和验证码存在一起的话，改它要走「读整份 → 判断 → 改一个字段 → 整份写回」，三步之间
 * 隔着两次网络往返；同一瞬间打进来的几十个请求都会读到「才猜了 0 次」，于是整批只被
 * 记成一次——5 次上限形同虚设。这个坑在 unlock.js 上记着，照同一套来。
 */
const triesKey = (email, ticket) => 'signin:tries:' + email + (ticket ? ':' + ticket : '');

/**
 * 只管 `confirm` 的那一道限速。
 *
 * `TRY_PER_CALLER` 按来路数，挡的是我们自己的资源（每次 confirm 都要读一次库）。它无条件
 * 地数，编的票也算——那种请求除了耗我们一次往返什么也做不到，而这一道正是用来限它的。
 *
 * **从前还有一道按邮箱数的 `signin:guess`（一小时 15 次），2026-10-08 撤了（方案 1-2）。**
 * 它只数「真有码可猜」的那几次，挡住了「拿编的票烧额度」；可它挡不住**拿真票烧**：外人
 * 自己替受害者的地址要三张票（要码那道按「邮箱 + 来路」给每个来路三封）、每张乱猜 5 次，
 * 正好 15 次——受害者拿着信里那串**对的**码打进来，答的是 429。知道邮箱就能把人锁在门外
 * 一小时，正是这几道门要防的那件事。
 *
 * 撤了之后防猜码靠的是：每张票 5 次（MAX_TRIES，超了这张票作废）×「一个地址一小时最多出
 * 去十封信」（request 里的 `signin:toAll`）＝ 一个地址一小时至多被真猜 50 次，对一百万种
 * 六位码是二万分之一；外加按来路 30 次。门是 check-signin-challenge 的 ⑦。
 */
const TRY_PER_CALLER = 30;

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
      `您的 Slides 验证码是 ${c}，30 分钟内有效。\n` +
      `如果这不是您本人操作，忽略这封邮件即可。`,
  },
  zhHant: {
    subject: 'Slides — 驗證碼 / your code',
    body: (c) =>
      `您的 Slides 驗證碼是 ${c}，30 分鐘內有效。\n` +
      `如果這不是您本人操作，忽略這封郵件即可。`,
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
    ? confirm(res, req, address, body)
    : request(res, req, address, body.lang);
}

async function request(res, req, address, wantLang) {
  const lang = mailLang(wantLang);

  // 三道限速，挡的是三件不一样的事：
  //
  //   by address + caller —— 一个来路替同一个邮箱一小时最多要三封，比一个真的没收到信的
  //     人需要的还多。**按「邮箱 + 来路」数，不按邮箱数**（第 14 推）：原先按邮箱一小时
  //     三封，谁都能替一个地址连要三封，主人这一小时就一封都要不到了——不用猜码，只要知
  //     道他的邮箱。现在外人耗光的只是他自己那一份。
  //   by address —— 同一个邮箱一小时总共十封，换多少个来路都一样。挡的是一个人换着来路
  //     往别人信箱里一直灌验证码。**只数真的寄出去的**（2026-10-08 方案 1-2）：先查不记
  //     （atLimit），信发成了才记一笔（countHit，在下面 sendMail 之后）。从前每来一次就记，
  //     Resend 那头一挂，玩家点几下《重发》就把自己这一小时的十封烧光了，而那几封一封都没
  //     出去。它同时是猜码那一侧的上限（见 TRY_PER_CALLER 上面那段）：一小时最多十张有效票。
  //   by caller  —— 一台机器也不许拿着一份地址名单挨个来要码。
  //
  // 都答 429 而不是假装发了：真在等信的人有权知道为什么什么都没来。
  const caller = callerId(req);
  if (await tooMany('signin:to', `${address}|${caller}`, 3, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (await atLimit('signin:toAll', address, TO_ALL_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (await tooMany('signin:from', caller, 10, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  const ticket = newChallenge();
  await set(key(address, ticket), { code }, CODE_TTL_S);
  /*
   * 这儿原先还有一句 `del(triesKey(address))`——「新码新账：上一张码猜掉的次数不跟着
   * 过来」。**那一句现在不能有，而且本来就是上面说的那条破坏路的一半**：它按地址清，于
   * 是任何人替别人要一次码，就把那个人已经攒下的猜测次数抹掉了。
   *
   * 换成按票之后它也不必要了：这张票是刚生出来的，它自己那个计数键还不存在，`bump` 从
   * 1 开始数（见 _store.js）。别的票的计数一个都不许动。
   */

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
  // 寄出去了才算这个邮箱一封（见上面「by address」那一条）。
  if (sent) await countHit('signin:toAll', address, 3600);
  /*
   * 票**两种情况都回**，连发信失败那一种。
   *
   * 理由和上面那段 ⚠️ 一样：Resend 回了错而信其实寄到了，是真会发生的事，所以码照旧留在
   * 库里。既然码可能在他手上，那把能用它的钥匙也得在他手上——不然那张寄到的码成了废纸。
   * 界面此刻留在填邮箱那一屏（E51），用不上它；它只是不该被我们弄丢。
   */
  return send(res, 200, sent
    ? { sent: true, challenge: ticket }
    : { sent: false, reason: 'mailDown', challenge: ticket });
}

async function confirm(res, req, address, { code, news, challenge }) {
  /**
   * 下面几步的**次序是这道门的全部内容**，每一步往后挪一位都会把某个人的东西弄坏：
   *
   *   ① 票的形状。编得不对就是这张票不存在，和「码过期」同一句话——不另给一个错，免得
   *      外面的人能从回包里分出「票对不对」和「码对不对」。空着是另一回事（过渡路）。
   *   ② 按来路限速。挡我们自己的资源，所以要在读库之前，而且编的票也算。
   *   ③ 占掉这张票的一次机会（`bump`，原子）。**先占号再比对**——次序反过来就是那道假
   *      门：几十个并发请求会一起通过「还没到 5 次」这一关，然后一起猜（照 unlock.js）。
   *   ④ 把码读出来。没有就是这张票不存在或者过期了。
   *   ⑤ 比对。（从前 ④ 和比对之间还有一道按邮箱的 `signin:guess`，2026-10-08 撤了——它能
   *      被外人拿真票烧光，把拿着对的码的主人挡在门外，见 TRY_PER_CALLER 上面那段。）
   */
  const ticket = String(challenge ?? '');
  if (ticket && !CHALLENGE_RE.test(ticket)) return send(res, 400, { error: 'expired' });

  if (await tooMany('signin:try', callerId(req), TRY_PER_CALLER, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const tries = await bump(triesKey(address, ticket), CODE_TTL_S);
  if (tries > MAX_TRIES) {
    // 删的是**这一张**票的码和计数，别人那几张一个字都不动。
    await del(key(address, ticket));
    await del(triesKey(address, ticket));
    return send(res, 429, { error: 'expired' });
  }

  const pending = await get(key(address, ticket));
  if (!pending) return send(res, 400, { error: 'expired' });

  if (String(code || '').trim() !== pending.code) {
    return send(res, 401, { error: 'wrongCode' });
  }

  /**
   * 码对上了。这一刻之后才分「注册」和「登录」——而分法只有一条：这个地址上有没有账号。
   *
   * 注册那一支的密钥是**空串**，因为这种账号没有密码。空串不会把老的密码登录路径捅
   * 开：`api/subscription.js` 那一支如今对谁都答 401（E37），而在它还认密码的年代，
   * `SECRET_RE = /^.{4,128}$/` 本来也挡着空串（那个常量后来没了调用方，10-08 方案第五批第 7 条删了）。
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
      return finish(res, address, fresh, fresh.token, true, ticket);
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

  return finish(res, address, got.account, issued, created, ticket);
}

/**
 * 三件不可逆的事都做完之后那一段，两支共用。
 *
 * `created` 由调用方说，不在这儿算：它的意思是「这一趟是不是第一次」，而界面拿它决定
 * 要不要摆那个「愿不愿意收更新邮件」的勾选框（见文件顶上那段）。
 */
async function finish(res, address, account, issued, created, ticket) {
  // 只删**这一张**票。同一个人连点两下《寄给我》会有两张票，另一张照旧有效到 30 分钟
  // 过期——两张码都是寄给他的，谁也没多拿什么。而且这儿也没法枚举别的票（库里没有
  // SCAN），所以「顺手都清掉」压根做不到，不是没想。
  await del(key(address, ticket));
  await del(triesKey(address, ticket));

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
