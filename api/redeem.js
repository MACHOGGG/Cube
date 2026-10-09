import { send, readBody } from './_creem.js';
import {
  accountId,
  codeHolder,
  entitlementOf,
  extend,
  isLifetime,
  loadAccount,
  newAccount,
  normalizeEmail,
  saveAccount,
  tokenValid,
  updateAccount,
} from './_accounts.js';
import { callerId, tooMany } from './_ratelimit.js';
import { redact } from './_redact.js';
import { set, storeConfigured, takeOnce } from './_store.js';

/** Uppercase, and dashes or spaces the player typed are not part of it. */
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Spending a code. One field, and it is the code.
 *
 * Where the month lands depends on what the browser already has:
 *
 *   signed in       — it is added to that account, so it is waiting on every
 *                     device the moment they next sign in there.
 *   not signed in   — it is held under the code itself, and the app asks for
 *                     an address next. Declining is allowed: the entitlement
 *                     works on this device either way, and the question comes
 *                     back until it is answered.
 *
 * A player who is *currently* subscribed is told to keep the code rather than
 * spend it — that check is on the device, where the answer is known, and it
 * is a courtesy rather than a defence: the only person a bypass costs is the
 * one who burned their own gift early.
 *
 * GETDEL takes the code in one step, so two people racing for the same code
 * cannot both win. An expired code is taken too, then refused and put back:
 * saying "expired" rather than "no such code" is the difference between an
 * answerable support question and an argument, and that only holds if the
 * same code still answers the same way the second time it is typed.
 */
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
    console.error('[redeem]', err?.message || err);
    return send(res, 502, { error: 'upstream' });
  }
}

async function handle(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  // Twenty tries an hour. A person typing a code off a card needs two or
  // three; a script walking the keyspace needs rather more than twenty.
  if (await tooMany('redeem', callerId(req), 20, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const { code, email, token } = readBody(req);
  const ticket = normalizeCode(code);
  if (ticket.length < 3) return send(res, 400, { error: 'code' });

  // An address and a token that check out mean the month goes to that
  // account. Anything short of that is treated as not signed in at all,
  // never as a reason to refuse — the code is still theirs to spend.
  //
  // tokenValid 走的是整串 token（一个账户可以同时在好几台设备上登着），不是只
  // 认最新那一枚。这里要是只比 account.token，玩家在手机上登一次，电脑上那台就
  // 被挤成「没登录」——码照样能兑，可那个月落到码自己名下，而不是他账户上，他
  // 换台设备就找不着了。
  const address = normalizeEmail(email);
  let account = null;
  // accountId 而不是 EMAIL_RE：免邮箱凭据账号（E38）的 id 不是邮箱。只认邮箱的话这一句
  // 会把他判成「没登录」，而下面那条路会把这个月记到码自己名下——他换台设备就找不着了，
  // **屏幕上却写着「兑换成功」**。见 _accounts.js 的 accountId。
  if (accountId(address) && token) {
    const found = await loadAccount(address);
    if (tokenValid(found, token)) account = found;
  }

  /**
   * ⚠️ **已经是终身天才的人，这张码一个字都不许动。**
   *
   * `extend()` 对终身账号是个 no-op（_accounts.js：「Adding time to forever is not an
   * error, it is simply nothing」），而上面那一步 `takeOnce` 是 GETDEL——码从库里拿走
   * 了。两件事合起来就是：**码烧掉、账上什么都没多、屏幕上写着「兑换成功」**。玩家下
   * 次想把它送给朋友时才发现它没了，而那时谁也查不出发生过什么。
   *
   * 这不是个边角情况：窗口期里「登录成功即送终身天才」（E11 / PR-12），所以**此刻每一
   * 个登着的人都是终身**，每一张内部码兑到自己账号上都会这样消失一张。
   *
   * 挡在 `takeOnce` **之前**，所以码还在库里，原样留着送人。答 409 `active` 而不是自造
   * 一个新词：界面上那句话早就写好了（i18n 的 `alreadyActive`：「你的订阅还在有效期内。
   * 这张码留着以后用，或者送人——它只能用一次」），而那正是要说的话。
   *
   * 文件顶上写着「A player who is *currently* subscribed is told to keep the code …
   * that check is on the device … a courtesy rather than a defence」——那句话仍然成立，
   * 这一道不是为了防谁，是为了**不把玩家的东西弄丢**。设备那一侧的提醒照旧留着（它答
   * 得更快、也更客气），这一道是兜底。
   */
  if (account && isLifetime(account)) return send(res, 409, { error: 'active' });

  const ticketDoc = await takeOnce('code:' + ticket);
  if (!ticketDoc) return send(res, 404, { error: 'code' });

  /**
   * 码已经被拿走了，但这几行还没写进账户——中间任何一步摔了，就得把码放回去。
   *
   * takeOnce 是 GETDEL：读和删是同一步，这样同一张码不会被两个人同时抢到。代
   * 价是从这一刻起码就不在库里了，而「加到账户上」是另外一次写。这两次写之间
   * 要是数据库抖一下、超时一次，玩家看到的是一句笼统的失败，可他那张码已经从
   * 系统里消失了——不能再兑，账户上也什么都没多，只能来找人工，而人工这边连
   * 查都查不到（库里已经没有这张码了）。
   *
   * 所以照 passcode.js 的 bind() 那个样子来：失败就把整份 ticketDoc 原样写
   * 回去。放回去这一步自己也可能失败，那就真没办法了——但它把「一定丢」变成
   * 了「两次都刚好摔了才丢」，而且日志里留得下痕迹。
   *
   * 过期的码也要放回去，理由是另一条：这个文件开头写着「说『已过期』而不是
   * 『查无此码』，是能答的客服问题和一场争执之间的差别」——可码在 takeOnce
   * 那一步就已经从库里拿走了。玩家把同一张过期码再输一遍（他一定会：第一遍
   * 多半以为自己打错了），得到的是「这张码不存在或已经用过」，两句话对不上；
   * 客服想查也查不到，库里已经没有这张码了。放回去之后，同一张过期码答的永
   * 远是同一句，而它本来就不会再值任何东西，放回去不多给谁一分钱。
   */
  const giveBack = async () => {
    try {
      await set('code:' + ticket, ticketDoc);
    } catch (err) {
      // ⚠️ **这一行有意写码的原文**，别「顺手」改成指纹（_redact.js 里也记着这件事）。
      // 走到这儿意味着码已经从库里拿走、又没放回去：谁都兑不了它，而有个玩家刚刚
      // 看到一句「这张码不存在或已经用过」。这一行是我们唯一还能凭它把那张码手工
      // 补给他的东西，指纹补不回来。码本身也不是个人信息。
      console.error('兑换码放不回去了', ticket, err);
    }
  };

  if (ticketDoc.expiresAt && Date.now() > ticketDoc.expiresAt) {
    await giveBack();
    return send(res, 410, { error: 'expired' });
  }

  const plan = ticketDoc.plan;

  /**
   * 留个痕：这张码什么时候、被谁用掉的。
   *
   * 单独包一层，失败只记日志——权益在上一步就已经写进账户了，这一笔纯粹是
   * 留痕（眼下没有任何地方读它）。让它把异常抛出去的话，玩家会收到一句「网
   * 络错误，请重试」，而他的码其实已经兑成功了；再输一次，码已经从库里拿走
   * 了，于是又被告知「这张码不存在或已经用过」——两句话都对，合起来只会让人
   * confused 到写信来问「我到底兑上没有」。
   */
  const noteUsed = async (extra) => {
    try {
      await set('codeused:' + ticket, { at: Date.now(), plan, ...extra });
    } catch (err) {
      // 这一处相反，记指纹就够：权益已经写进账户了，没有谁在等人工补偿，而这张码
      // 到这一步还活着（它是刚被兑掉的那一张，`code:` 键没了、`codeused:` 键没写上）。
      console.error('兑换记录没写上（权益已经到账，不影响玩家）', redact(ticket), err);
    }
  };

  if (account) {
    // 加时长要走 updateAccount（带锁的读—改—写），不是 loadAccount + 改 +
    // saveAccount：同一个账号几乎同时兑两张码，朴素写法会让后写的那一份把前
    // 一次加的时长整个盖掉——两张码都吃掉了、两次都说成功，账号上却只多了一
    // 个月。见 _accounts.js 的 updateAccount。
    let saved;
    // 锁里那一份才是库里此刻的样子。上面那道终身闸看的是 takeOnce **之前**读到的快照，
    // 而这两步之间他完全可能刚在另一台设备上登录、刚被送了终身（grantLifetimeIfWindow）。
    // 不再看一眼的话，那一张码还是会无声无息地烧掉。
    let lifetime = false;
    try {
      saved = await updateAccount(address, (acct) => {
        if (isLifetime(acct)) {
          lifetime = true;
          return;
        }
        extend(acct, plan);
      });
    } catch (err) {
      await giveBack();
      throw err;
    }
    if (!saved.ok) {
      // 没加上就得把码放回去，不然玩家白丢一张。放回去之后重试一次就成了。
      await giveBack();
      throw new Error(saved.busy ? '账号正忙，这一次没加上（码已放回）' : '账号不见了（码已放回）');
    }
    if (lifetime) {
      // 和上面那道闸同一句话。码放回去——它一分钱的价值都没损失，而玩家可以送人。
      await giveBack();
      return send(res, 409, { error: 'active' });
    }
    account = saved.account;
    await noteUsed({ email: address });
    // token 回这台设备自己带来的那一把。entitlementOf 给的是 account.token
    // ——「最新签发的那一把」，他要是后来在别处又登过一次，那两把就不是同一
    // 个；拿最新的盖上去会把这台设备手里的抹掉，等于兑一次码把自己顶下线。
    return send(res, 200, { ...entitlementOf(account, address), token: String(token), kind: 'code' });
  }

  // Nobody to attach it to yet. It lives under the code, and the token below
  // is the only thing that can claim what it became.
  const holder = codeHolder(ticket);
  const fresh = newAccount('', 'code');
  extend(fresh, plan);
  fresh.unbound = true;
  try {
    await saveAccount(holder, fresh);
  } catch (err) {
    await giveBack();
    throw err;
  }
  await noteUsed();

  return send(res, 200, { ...entitlementOf(fresh, ''), kind: 'code', code: ticket });
}
