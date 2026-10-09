import { randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  PAIR_KEY_RE,
  accountId,
  clearFails,
  createAccount,
  deleteAccount,
  loadAccount,
  normalizeEmail,
  tokenValid,
  unblock,
} from './_accounts.js';
import { compose, mailConfigured, mailLang, sendMail } from './_mail.js';
import { callerId, tooMany } from './_ratelimit.js';
import { redact } from './_redact.js';
import { renameScoreOwner } from './scores.js';
import { bump, del, get, set, storeConfigured } from './_store.js';

/**
 * 换一个邮箱。
 *
 * 邮箱在这个站里不只是「联系方式」——它就是账号本身：账号存在 acct:<邮箱>
 * 底下，云端战绩和排行榜上的成员也都是这个地址（见 _entitlement.js 的
 * identify、scores.js 的 who.id）。所以换邮箱是搬家，不是改一个字段。
 *
 * 两步，两样证据，缺一不可：
 *
 *   1. 令牌  —— 证明「现在这个账号是我的」。没有它，谁知道你邮箱就能把你的
 *      账号搬到他自己的地址底下。
 *   2. 寄到**新地址**的验证码 —— 证明「那个新地址也是我的」。
 *
 * 第 2 条不是走过场。少了它有两种坏事：打错一个字母，账号就搬到一个他打不
 * 开的地址上，从此《忘记密码》寄出去的信他永远收不到；更糟的是可以把自己的
 * 账号停在**别人**的地址上，那个人一走《忘记密码》就把这个账号连人带订阅拿
 * 走了。所以码寄给新地址，谁收得到谁说了算。
 *
 * 新地址上已经有账号的，一律回绝。合并两个账号是另一件事（谁的订阅算数、
 * 两份战绩怎么并），不该由「我想换个邮箱」这一下顺手决定。
 *
 * ── 免邮箱账号「绑定邮箱」也走这儿（10-09 补充方案 7-8）────────────────
 *
 * 免邮箱账号（api/handle.js）的 id 是 `hdl:` 加第一串的 sha256，不是邮箱。7-8 撤了「凭第一串重设
 * 第二串」，给这种账号的退路是绑定一个邮箱——而那件事和换邮箱**一模一样**：拿令牌证明账号是他
 * 的，码寄到那个邮箱证明邮箱是他的，然后把账号、云端战绩、昵称（连 nickidx）、榜上的位置整个搬
 * 到 `acct:<邮箱>` 底下（同一个 renameScoreOwner），拆掉旧的那一份。所以不另开一支，只是「现在
 * 这个地址」除了邮箱也认 `hdl:` 那把 id（accountId）。方案原话：「放在现有的 api/email.js 里做，
 * 不新增接口文件」。
 *
 * 只多两件事，都在 confirm 里搬家之前（见 `bound`）：第二串的哈希抹掉（两串从此不是凭据——旧
 * 的 `hdl:` 那一份也拆了，handle.js 再也找不到它），并且记下「这个邮箱验过了」
 * （emailVerifiedAt）。少了后一件，他头一次拿验证码登录时 signin.js 会把这个账号当成被抢注的
 * （没验过、身上又挂着一把别人设的密码），把他所有设备踢下线。
 *
 * 邮箱上已经有账号：照旧 409 `taken`（「这个邮箱已经有账号了」），不合并。
 */

const CODE_TTL_S = 30 * 60;
const key = (email) => 'chmail:' + email;

/**
 * 这张码猜错几次就作废。
 *
 * 六位数字只有一百万种，限速拦的是「一小时敲几次门」，不是「这张码被试了几
 * 次」——两件事。少了这个计数，坏人可以拿自己的账号申请搬到**别人**的地址
 * 上，然后在 30 分钟里慢慢撞那六位数；撞中了，他的账号就挂在受害者的邮箱底
 * 下，而受害者从此再也注册不了自己的邮箱——哪天他真去刷卡订阅，设密码那一
 * 步会被「这个地址已经有账号了」挡下来，钱花了却进不去。
 *
 * 《忘记密码》那条路（api/unlock.js）早就有这道闸，换邮箱这条路一直没抄这份
 * 作业。数字和键名都照它来，两条路是同一件事，没有理由各有一套。
 */
const MAX_TRIES = 5;
const triesKey = (email) => 'chmail:tries:' + email;

/** 换邮箱那封信，四种语言。挑哪一种、英文附一份，见 _mail.js 的 compose。 */
const MAIL = {
  en: {
    subject: 'Slides — confirm your new address',
    body: (c) =>
      `Your Slides confirmation code is ${c}. It is valid for 30 minutes and\n` +
      `moves your account to this address. If you did not ask for this, you can\n` +
      `ignore this message — nothing changes until the code is entered.`,
  },
  zhHans: {
    subject: 'Slides — 确认新邮箱 / confirm your new address',
    body: (c) =>
      `您的 Slides 确认码是 ${c}，30 分钟内有效。\n` +
      `输入它就把账号换到这个邮箱。如果这不是您本人操作，忽略这封邮件即可——\n` +
      `码没输进去之前什么都不会变。`,
  },
  zhHant: {
    subject: 'Slides — 確認新的信箱 / confirm your new address',
    body: (c) =>
      `您的 Slides 確認碼是 ${c}，30 分鐘內有效。\n` +
      `輸入它就把帳號換到這個信箱。如果這不是您本人操作，忽略這封郵件即可——\n` +
      `碼還沒輸進去之前什麼都不會變。`,
  },
  fr: {
    subject: 'Slides — confirmez votre nouvelle adresse / confirm your new address',
    body: (c) =>
      `Votre code de confirmation Slides est ${c}. Il est valable 30 minutes et\n` +
      `transfère votre compte vers cette adresse. Si vous n’êtes pas à l’origine\n` +
      `de cette demande, ignorez ce message : rien ne change tant que le code\n` +
      `n’est pas saisi.`,
  },
};

/**
 * 摔了也答一句 JSON（10-09 补充方案 7-13 第 3 条）。
 *
 * 下面这一支有几处是**故意抛**的（锁没抢到、码放回去之后、战绩搬家摔了要让玩家重来），可抛出去之后没人接：
 * 平台回一个连正文都没有的 500。客户端读不出一个它认得的词，从前一律当成「连不上网络」——他的网好得很，
 * 是我们这头抽了一下。现在兜在这儿：记一笔日志（只记出错的那句话，不记请求里的任何东西），回 502
 * `upstream`，和 checkout / portal / passcode 那几处同一个出口；客户端见 5xx 就说「服务器忙，不是您的网络」
 * （engine/account.ts 的 toResult）。
 */
export default async function handler(req, res) {
  try {
    return await handle(req, res);
  } catch (err) {
    console.error('[换邮箱 / 绑定邮箱]', err?.message || err);
    return send(res, 502, { error: 'upstream' });
  }
}

async function handle(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  const address = normalizeEmail(body.email);
  const wanted = normalizeEmail(body.newEmail);
  // 「现在这个地址」认邮箱，也认免邮箱账号那把 `hdl:` id（绑定邮箱，见文件头）。内部码的寄存处
  // （`code:` 开头）不认：那不是一个人，是一张码。要搬去的那一头只认邮箱。
  if (!accountId(address) || !EMAIL_RE.test(wanted)) {
    return send(res, 400, { error: 'email' });
  }
  if (address === wanted) return send(res, 400, { error: 'sameEmail' });

  // 先认人。两条路都要，而且都在做任何事之前——「这个地址有没有账号」本身
  // 就是不该白送出去的消息。
  const account = await loadAccount(address);
  // 'auth' 不是 'wrong'：这里根本没问密码，答「密码不对」会把玩家支到一个
  // 他改不动的地方去。这一句的意思是「这台设备的登录不作数了，重登一次」。
  if (!tokenValid(account, body.token)) return send(res, 401, { error: 'auth' });

  return body.action === 'confirm'
    ? confirm(res, address, wanted, account, body)
    : request(res, req, address, wanted, body.lang);
}

async function request(res, req, address, wanted, wantLang) {
  if (!mailConfigured()) return send(res, 503, { error: 'noMail' });

  // 两个桶，和 unlock.js 同一个道理：一个挡「拿这个接口往某个地址塞信」，
  // 一个挡「一台机器挨个地址试」。
  if (await tooMany('chmail:to', wanted, 3, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (await tooMany('chmail:from', callerId(req), 10, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  // 新地址上已经有账号：直说。这一句确实透露了「那个地址注册过」，可这里的
  // 提问人已经拿令牌证明了自己是某个账号的主人，而不知道这一句他就只能反复
  // 试——换来的是一句他看得懂的话，值。
  if (await loadAccount(wanted)) return send(res, 409, { error: 'taken' });

  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  await set(key(address), { code, to: wanted }, CODE_TTL_S);
  // 新码新账：上一张码被猜掉的次数不跟着过来（同 unlock.js）。
  await del(triesKey(address));
  await sendMail({ to: wanted, ...compose(MAIL, mailLang(wantLang), code) });
  return send(res, 200, { sent: true });
}

async function confirm(res, address, wanted, account, { code, token }) {
  // 先占掉一次机会，再去比对——次序反过来就是一道假门：同时打进来的几十个
  // 请求会一起通过「还没到 5 次」这一关，然后一起猜。bump 是一步做完的，
  // 所以第 6 个请求拿到的就是 6，它连码是多少都不会去读。
  const tries = await bump(triesKey(address), CODE_TTL_S);
  if (tries > MAX_TRIES) {
    await del(key(address));
    await del(triesKey(address));
    return send(res, 429, { error: 'expired' });
  }

  const pending = await get(key(address));
  if (!pending) return send(res, 400, { error: 'expired' });
  // 码是对着**当时那个新地址**发的。中途把 newEmail 换成别的再把码填进来，
  // 等于用 A 收到的码去认领 B——所以两样都要对上。
  if (pending.to !== wanted) return send(res, 400, { error: 'expired' });
  if (String(code || '').trim() !== pending.code) {
    return send(res, 401, { error: 'wrongCode' });
  }

  /**
   * 搬家的顺序：**先在新地址写齐，最后才拆旧地址。**
   *
   * 中间任何一步摔了，玩家的账号在两个地址底下各有一份（同一把密码，两扇
   * 门——不好看，但他什么都没丢）。反过来先删旧的，摔在中间就是账号连同战绩
   * 一起消失。同 redeem.js 那次「码烧掉却没到账」。
   *
   * **但「再走一遍就好」这句话曾经是假的，所以第一步套了补偿。**
   *
   * createAccount 用的是 SET ... NX：它一成功，新地址就被占住了。假如紧接着
   * renameScoreOwner 或 deleteAccount 摔了（Redis 抖一下就够），玩家看到的是
   * 「网络错误」，于是他重来一遍——而 request() 开头那句
   * `if (await loadAccount(wanted)) return send(res, 409, { error: 'taken' })`
   * 当场把他拦死：挡住他的正是他自己上一次的半成品。
   *
   * 而这一步卡住之后没有自助的出路：api/mint.js 只有 list 和 grant 两个动作，
   * **后台根本没有「删账号」这个操作**，只能进 Upstash 控制台手删一个键。所以
   * 摔了就把刚占住的新地址退回去，让「再走一遍」重新成立。
   */
  // 要码到输码之间隔着 30 分钟，那头完全可能有人刚注册了这个地址。
  //
  // 「再看一遍有没有人」和「写进去」是同一步（createAccount 用的是
  // SET ... NX）。从前是先 loadAccount 看一眼、再 saveAccount 写进去——中间
  // 隔着一次网络往返，恰好那一瞬间别人拿这个地址注册成功，他的账号就会被这
  // 次搬家整个盖掉，而他那边收到的是「注册成功」。
  //
  // 挡在搬家的第一步，所以拦下来的时候旧地址一个字都还没动：他的账号、战绩、
  // 榜上的名字全在原处，重来一次就好。
  if (!(await createAccount(wanted, bound(address, account)))) return send(res, 409, { error: 'taken' });

  /**
   * ⚠️ **退回新地址，只在这一步之内。**
   *
   * 原先这个 try 把下面那四步也一起包着，于是有一条路会真的弄坏东西：
   * `renameScoreOwner` **成功了**、紧接着 `deleteAccount(address)` 摔了（Redis 抖一
   * 下就够），catch 照旧把刚占住的新地址删掉——可榜上那些行已经改名成新地址了。结果
   * 是：账号还在旧地址（删失败了），战绩和排行榜上的成员名却指着一个**没有账号的地
   * 址**。玩家那边看到「出错了，重试」，重来一次 `renameScoreOwner(旧, 新)` 在旧地址
   * 底下什么也找不着——他的云端战绩和榜上的位置就这么没了，而两边都不报错。
   *
   * 所以回滚只守「改名之前」这一段：改名没成，新地址退回去，玩家重来一次，旧地址一个
   * 字都没动。改名一旦成了，**这次搬家就算成了**，后面那几步只是打扫。
   */
  try {
    await renameScoreOwner(address, wanted);
  } catch (err) {
    // 这一步本身再摔就没办法了，所以它不许把原来那个错误盖掉——玩家要看到的是
    // 「出错了，重试」，而不是一个来自收尾动作的第二个错误。
    await deleteAccount(wanted).catch(() => {});
    throw err;
  }

  /**
   * 从这一行起**绝不回滚、绝不抛**。
   *
   * 要搬的两样（账号、战绩）都已经在新地址上了，玩家这一趟是成功的。下面四步是打扫旧
   * 地址，每一步摔了的后果都只是「多一份、不好看」，而把这一趟说成失败的后果是他重来
   * 一遍、被自己上一次的半成品拦死（见上面那段 409 `taken`）。
   *
   * 账号没删掉的那一种要记一笔：旧地址底下会留着一份同样令牌的账号，谁在那个地址上登
   * 进去就拿得到他的权益和收件箱。后台没有「删账号」这个动作（mint.js 只有 list 和
   * grant），只能照着这行日志进 Upstash 手删一个键——所以这一行写的是**能删的那个键**，
   * 邮箱本身按 _redact.js 的规矩打成指纹。
   */
  const sweep = [
    ['旧地址上的账号没删掉（玩家已经搬好了，这一份要手删）', () => deleteAccount(address)],
    ['旧地址的失败计数没清掉', () => clearFails(address)],
    ['旧地址的换邮箱码没删掉', () => del(key(address))],
    ['旧地址的换邮箱猜测计数没删掉', () => del(triesKey(address))],
  ];
  for (const [what, step] of sweep) {
    try {
      await step();
    } catch (err) {
      console.error('换邮箱收尾：' + what, redact(address), err);
    }
  }

  // 令牌一把都没动：换的是门牌，不是钥匙，他这台设备照旧登着，别的设备也是（免邮箱账号绑定邮箱
  // 那一种，别的设备手里存的还是旧的 `hdl:` id——那一份已经拆了，它们下一次问权益就会掉线，和
  // 换邮箱时别的设备拿着旧地址是同一回事）。
  // 回的是**这台设备自己带来的那一把**，不是账号上最新签发的那一把——他在
  // 别处后登过一次的话，那两把不是同一个，拿最新的盖上去会把这台设备手里的
  // 抹掉（同 api/redeem.js 里那一处）。
  return send(res, 200, { moved: true, email: wanted, token: String(token) });
}

/**
 * 搬去新地址的那一份账号。邮箱换邮箱：原样。免邮箱账号绑定邮箱（`hdl:` 那一种，见文件头）：
 *
 *   · 第二串的哈希抹掉（`unblock(…, '')`：换盐、密钥成空串，顺带把输错次数和锁清零）——两串从这
 *     一刻起不是凭据；留着一份谁都用不上的密码哈希只有坏处，而且 signin.js 的 hasSecret 会认它。
 *   · `emailVerifiedAt` 记上此刻：码刚寄到这个邮箱、输对了，这就是「邮箱是他的」的证明。不记的话
 *     signin.js 把它当抢注清理（见那里的 `claimed`），他头一次拿验证码登录就把所有设备踢下线。
 *
 * 不改原来那一份：createAccount 写不成（409）的时候，旧账号一个字都不该动过。
 */
function bound(address, account) {
  if (!PAIR_KEY_RE.test(address)) return account;
  const moved = unblock({ ...account }, '');
  moved.emailVerifiedAt = Date.now();
  return moved;
}
