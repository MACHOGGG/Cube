import { randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  clearFails,
  deleteAccount,
  loadAccount,
  normalizeEmail,
  saveAccount,
  tokenValid,
} from './_accounts.js';
import { compose, mailConfigured, mailLang, sendMail } from './_mail.js';
import { callerId, tooMany } from './_ratelimit.js';
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
      `你的 Slides 确认码是 ${c}，30 分钟内有效。\n` +
      `输入它就把账户换到这个邮箱。如果这不是你本人操作，忽略这封邮件即可——\n` +
      `码没输进去之前什么都不会变。`,
  },
  zhHant: {
    subject: 'Slides — 確認新信箱 / confirm your new address',
    body: (c) =>
      `你的 Slides 確認碼是 ${c}，30 分鐘內有效。\n` +
      `輸入它就把帳戶換到這個信箱。如果這不是你本人操作，忽略這封郵件即可——\n` +
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  const address = normalizeEmail(body.email);
  const wanted = normalizeEmail(body.newEmail);
  if (!EMAIL_RE.test(address) || !EMAIL_RE.test(wanted)) {
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
  // 要码到输码之间隔着 30 分钟，那头完全可能有人刚注册了这个地址。再看一遍。
  if (await loadAccount(wanted)) return send(res, 409, { error: 'taken' });

  /**
   * 搬家的顺序：**先在新地址写齐，最后才拆旧地址。**
   *
   * 中间任何一步摔了，玩家的账号在两个地址底下各有一份（同一把密码，两扇
   * 门——不好看，但他什么都没丢，再走一遍就好）。反过来先删旧的，摔在中间
   * 就是账号连同战绩一起消失。同 redeem.js 那次「码烧掉却没到账」。
   */
  await saveAccount(wanted, account);
  await renameScoreOwner(address, wanted);
  await deleteAccount(address);
  // 旧地址上那些跟着地址走的零碎：输错密码的计数、这张换邮箱的码。
  await clearFails(address);
  await del(key(address));
  await del(triesKey(address));

  // 令牌一把都没动：换的是门牌，不是钥匙，他这台设备照旧登着，别的设备也是。
  // 回的是**这台设备自己带来的那一把**，不是账号上最新签发的那一把——他在
  // 别处后登过一次的话，那两把不是同一个，拿最新的盖上去会把这台设备手里的
  // 抹掉（同 api/redeem.js 里那一处）。
  return send(res, 200, { moved: true, email: wanted, token: String(token) });
}
