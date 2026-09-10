import { randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  PASS_RE,
  loadAccount,
  normalizeEmail,
  revokeTokens,
  saveAccount,
  unblock,
  clearFails,
} from './_accounts.js';
import { resolveEntitlement } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
import { bump, del, get, set, storeConfigured } from './_store.js';
import { mailConfigured, sendMail } from './_mail.js';

/**
 * 忘了密码的那条路——连错六次被锁死的，走的也是这一条。
 *
 * 两件事听着不一样，出路却是同一条：拿邮箱证明这个账号是自己的，然后设一把
 * 新的。所以这条路走完一定以「设了新密码」收尾——只解锁不重设，等于把玩家送
 * 回他本来就打不开的那把锁跟前。
 *
 * 原先这里只给 `blocked` 的账号发码，而 blocked 要连输错六次才会出现。于是一
 * 个老老实实「我忘了密码」的人根本走不进来，除非他自己想到「故意连错六次把
 * 自己锁死」——没有人会这么想。现在任何存在的账号都发。
 *
 * 验证码六位，30 分钟有效，猜错五次作废。**要一张码这件事本身，问不出任何东
 * 西**：有没有这个账号，回的话一模一样（都是 200 `{ sent: true }`），所以这
 * 条接口不能被拿来试探谁在玩。
 */

const CODE_TTL_S = 30 * 60;
const MAX_TRIES = 5;
const key = (email) => 'unlock:' + email;
/**
 * 猜了几次，单独存一个键。
 *
 * 从前这个数字是跟着验证码一起存的（pending.tries），改它要走「读出整个
 * pending → 判断 → 改一个字段 → 整个存回去」。三步之间隔着两次网络往返，同
 * 一瞬间打进来的几十个请求都会读到「才猜了 0 次」，于是这一批只被记成一
 * 次——5 次上限就此形同虚设，六位数字在 30 分钟里能被撞开的概率高得多。
 *
 * 分出来存，是为了能用 INCR：加一和读回是同一步（见 _store.js 的 bump），每
 * 个请求各拿到一个属于自己的号。发新码的时候把它删掉，上一轮猜掉的次数不算
 * 在这一轮头上。
 */
const triesKey = (email) => 'unlock:tries:' + email;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  const address = normalizeEmail(body.email);
  if (!EMAIL_RE.test(address)) return send(res, 400, { error: 'email' });

  return body.action === 'confirm'
    ? confirm(res, address, body)
    : request(res, req, address);
}

async function request(res, req, address) {
  // No provider, no code. Saying so lets the app point at the support
  // address instead of leaving the player waiting for mail that never sends.
  if (!mailConfigured()) return send(res, 503, { error: 'noMail' });

  // Two limits, because there are two different things worth stopping.
  //
  //   by address — 知道某个玩家邮箱的人，否则可以拿这个接口每隔几秒往他信
  //     箱里塞一封验证码。一小时三封，比一个真的没收到信的人所需要的还多。
  //   by caller  — and one machine cannot work through a list of addresses
  //     either, whoever they belong to.
  //
  // Both answer 429 rather than pretending to have sent it: a player who is
  // really waiting deserves to know why nothing arrived.
  if (await tooMany('unlock:to', address, 3, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (await tooMany('unlock:from', callerId(req), 10, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const account = await loadAccount(address);
  // 有账号就发。没有账号的地址不发，但回的话和发了一模一样——见文件顶上那段。
  if (account) {
    const code = String(randomInt(0, 1e6)).padStart(6, '0');
    await set(key(address), { code }, CODE_TTL_S);
    // 新码新账：上一张码猜掉的次数不跟着过来。
    await del(triesKey(address));
    await sendMail({
      to: address,
      subject: 'Slides — 验证码 / your code',
      // 不说「解锁」——绝大多数收到这封信的人只是忘了密码，没被锁过。
      text:
        `你的 Slides 验证码是 ${code}，30 分钟内有效。\n` +
        `输入后可以设置一个新的密码。如果这不是你本人操作，忽略这封邮件即可。\n\n` +
        `Your Slides code is ${code}. It is valid for 30 minutes and lets you set a\n` +
        `new passcode. If this was not you, you can ignore this message.`,
    });
  }
  return send(res, 200, { sent: true });
}

async function confirm(res, address, { code, password }) {
  // 和注册、改密码同一条规则（PASS_RE，正好 6 位，数字或字母）。
  //
  // 这里原来用的是 PIN_RE——4 到 6 位纯数字。于是走一趟「忘了密码，用邮箱
  // 解锁」，密码就被强制降级成一个四位数字，而且不分账户类型：花钱订阅的账户
  // 和内部码账户一视同仁。文案上也早就自相矛盾了，设置密码时写的是「密码
  // （6 位以上字符）」，解锁时却写「新密码（4～6 位数字）」。
  //
  // 一条通往「重设密码」的路，不该比正门更宽。
  const pin = String(password || '');
  if (!PASS_RE.test(pin)) return send(res, 400, { error: 'password' });

  // 先占掉一次机会，再去比对——次序反过来就是那道假门：几十个并发请求会一
  // 起通过「还没到 5 次」这一关，然后一起猜。占号是原子的，所以第 6 个请求
  // 拿到的就是 6，它连码是多少都不会去读。
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

  const account = await loadAccount(address);
  if (!account) return send(res, 400, { error: 'expired' });
  unblock(account, pin);
  // 账号对象上的 fails 归零了，另外那个计数键也要清——不然下一次输错密码，
  // 它会拿旧的次数接着往上数（见 _accounts.js 的 failKey）。
  await clearFails(address);
  // 走邮箱重设密码：这条路的前提就是「这个账号可能已经不只我一个人在用」，
  // 所以把所有设备上的令牌一并作废，只留刚验过邮箱的这一台。
  const issued = revokeTokens(account);
  await saveAccount(address, account);
  await del(key(address));
  await del(triesKey(address));
  /**
   * 到这一行为止，三件回不去的事都已经做完了：密码换成了新的、所有设备的
   * 令牌作废了、验证码从库里删掉了。**这一趟已经成功了。**
   *
   * 下面还要问一句「这个人此刻是不是天才」——内部码账号看本地到期日，刷卡
   * 订阅去问 Creem（和登录那一支同一个函数）。可那一问有两种答案是「不是
   * 失败、但也不是天才」：没有在续的订阅（如实答 active: false），以及压根
   * 问不出来（Creem 挂了、没配密钥）。
   *
   * 原先这两种都会把整趟说成失败：前者被前端读成 'network'，后者直接 502。
   * 而玩家看到失败一定会再点一次——这一次码已经没了，他收到的是「验证码已
   * 过期」，可他的密码明明早就是新的那一把了。他于是拿着一把自己不知道已经
   * 生效的新密码，被告知什么都没发生。这和 redeem.js 那次「码烧掉却没到账」
   * 是同一种病：先做不可逆的事，再做可能失败的事，然后拿后者的结果去汇报
   * 前者。
   *
   * 所以 reset: true 单独说一遍，它只回答「密码换好了没有」。权益答得出来
   * 就一并带上，答不出来也不影响这一句。
   */
  const done = { reset: true, email: address, token: issued };
  try {
    const { status, body } = await resolveEntitlement(address, account, issued);
    // token 一律用这台设备刚拿到的那一把：NOBODY 身上没有 token，让 body
    // 盖上去会把它抹掉，那台设备就白改了一次密码还得再登一次。
    return send(res, 200, status === 200 ? { ...done, ...body, token: issued } : done);
  } catch (err) {
    console.error('unlock entitlement lookup failed:', err?.message || err);
    return send(res, 200, done);
  }
}
