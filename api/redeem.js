import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  codeHolder,
  entitlementOf,
  extend,
  loadAccount,
  newAccount,
  normalizeEmail,
  saveAccount,
  tokenValid,
} from './_accounts.js';
import { callerId, tooMany } from './_ratelimit.js';
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
 * cannot both win. An expired code is taken too and then refused: it was
 * never going to be worth anything again, and saying "expired" rather than
 * "no such code" is the difference between an answerable support question
 * and an argument.
 */
export default async function handler(req, res) {
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
  if (EMAIL_RE.test(address) && token) {
    const found = await loadAccount(address);
    if (tokenValid(found, token)) account = found;
  }

  const ticketDoc = await takeOnce('code:' + ticket);
  if (!ticketDoc) return send(res, 404, { error: 'code' });
  if (ticketDoc.expiresAt && Date.now() > ticketDoc.expiresAt) {
    return send(res, 410, { error: 'expired' });
  }

  const plan = ticketDoc.plan;

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
   */
  const giveBack = async () => {
    try {
      await set('code:' + ticket, ticketDoc);
    } catch (err) {
      console.error('兑换码放不回去了', ticket, err);
    }
  };

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
      console.error('兑换记录没写上（权益已经到账，不影响玩家）', ticket, err);
    }
  };

  if (account) {
    extend(account, plan);
    try {
      await saveAccount(address, account);
    } catch (err) {
      await giveBack();
      throw err;
    }
    await noteUsed({ email: address });
    return send(res, 200, { ...entitlementOf(account, address), kind: 'code' });
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
