import { timingSafeEqual } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { addToInbox, isPlan, listAccounts, loadAccount, normalizeEmail, updateAccount } from './_accounts.js';
import { codeKey, mintCodes } from './_codes.js';
import { del, storeConfigured } from './_store.js';
import { callerId, tooMany } from './_ratelimit.js';

/**
 * Minting codes, for whoever runs this game and nobody else.
 *
 * There is no admin screen and this is deliberately not one: it is a single
 * call that hands back a list of codes, so a batch can be minted from a phone
 * on the way to writing an email, without a laptop or a terminal anywhere.
 *
 *   POST /api/mint
 *   { "token": "...", "plan": "year", "count": 50 }
 *   { "token": "...", "plan": "month", "count": 2, "expiresInDays": 7 }
 *
 * `expiresInDays` is the difference between the two kinds of batch. A code
 * minted without it never goes stale — that is the pool to test with and to
 * hand out by hand. A code minted with it has to be used inside that window,
 * which is what makes "here are two free months, they expire in a week" mean
 * anything at all.
 *
 * The expiry is stored as a date on the code rather than as a key lifetime,
 * so a player who is late is told their code expired instead of being told
 * it never existed — the difference between an answerable support question
 * and an argument.
 */
const MAX_PER_CALL = 200;
/**
 * 一个来源一小时最多敲多少次门。
 *
 * 这个接口能批量发码、也能列出全部玩家的邮箱，是站里权限最高的一处，全靠
 * ADMIN_TOKEN 挡着。密码比对本身是等长比较（tokenOk），可从前没有失败计数、
 * 也没有任何锁——理论上可以不受限制地一直猜。redeem 和 unlock 早就接了限速
 * （_ratelimit.js），这里补上，用的是同一套。
 *
 * 二十次是给真人留的余量：管理员一次发一批码、看一眼名单，一小时用不了几次。
 * 排在验令牌之前，所以猜密码的人先撞上它。
 */
const CALLS_PER_HOUR = 20;

/** Compared in constant time: a token check that leaks its own progress is
 *  a token check an attacker can walk one character at a time. */
function tokenOk(given) {
  const want = process.env.ADMIN_TOKEN || '';
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  // 先限速，再验令牌：挡的正是「一直猜这个令牌」。
  if (await tooMany('mint', callerId(req), CALLS_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const body = readBody(req);
  const { token, plan, count, expiresInDays, action, emails } = body;
  // The same answer whether the token is wrong or was never configured, so
  // this cannot be used to find out whether minting is switched on.
  if (!tokenOk(token)) return send(res, 401, { error: 'wrong' });

  // 列出所有开了账户的玩家。名单是 saveAccount 顺手维护的那份（见
  // _accounts.js 的 INDEX_KEY）：一次 HGETALL 就把人和筛选要用的字段全拿到，
  // 不用挨个去查账户本体，也一样秘密都不带出来。
  if (action === 'list') {
    const index = await listAccounts();
    const now = Date.now();
    const players = Object.entries(index).map(([email, row]) => ({
      email,
      kind: row.kind,
      plan: row.plan ?? null,
      until: row.until || 0,
      createdAt: row.createdAt || 0,
      blocked: Boolean(row.blocked),
      news: Boolean(row.news),
      inbox: row.inbox || 0,
      /** 现在有没有权限。刷卡的人权限在 Creem 那边，这里读不到，所以
       *  kind==='card' 一律当作有——他有账户就是因为付过款。 */
      active: row.kind === 'card' ? true : (row.until || 0) > now,
    }));
    players.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return send(res, 200, { players, count: players.length });
  }

  // 给指定的几个玩家各发一批码。
  if (action === 'grant') {
    if (!isPlan(plan)) return send(res, 400, { error: 'plan' });
    const list = (Array.isArray(emails) ? emails : []).map(normalizeEmail).filter(Boolean);
    if (!list.length) return send(res, 400, { error: 'emails' });
    const per = Math.max(1, Math.min(MAX_PER_CALL, Number(count) || 1));
    const days = Number(expiresInDays) || 0;
    const expiresAt = days > 0 ? Date.now() + days * 24 * 3600e3 : undefined;

    const sent = [];
    for (const address of list) {
      // 没有这个账户就跳过，不报错整批失败：勾了一个刚被删掉的人，不该让
      // 另外九个人也收不到码。这一步还挡住了「白造一批没人知道的码」——下一行
      // mintCodes 一跑就在库里落下真能兑的东西，得先确认收件人还在。
      if (!(await loadAccount(address))) {
        sent.push({ email: address, error: 'noAccount' });
        continue;
      }
      const codes = await mintCodes(plan, per, expiresAt, { source: 'grant', to: address });
      // 带锁的读—改—写，和 redeem.js 那句 `updateAccount(address, (acct) =>
      // extend(acct, plan))` 同一条路。朴素的 loadAccount + 改 + saveAccount 会
      // 被同一瞬间的另一次写整份盖掉：玩家自己正在兑码、或者后台对同一个人连点
      // 两次，后写的赢，先写的那一批码就此消失，两边还都显示「成功」。
      const saved = await updateAccount(address, (acct) => addToInbox(acct, codes, plan, expiresAt));
      if (!saved.ok) {
        // 码已经造出来了，收件箱却没写进去（busy = 约一秒八都没抢到锁）。把这
        // 一批撤回去。
        //
        // 不撤的后果不是「记错人名下」，是**留在库里没人知道归谁**：谁知道这串
        // 字就能兑，而后台的发码记录里没有它。两个实际问题——账对不平（「我到底
        // 发了多少张年卡」查不出来），以及后台看到 busy 多半会重试，于是又造一
        // 批，重试几次就是几批孤儿码。
        //
        // 撤不掉也不要紧，照 redeem.js 的 giveBack() 那个样子：记一笔日志就过，
        // 绝不往上抛。抛出去会让整批发码中断，勾了十个人，另外九个也收不到。
        await Promise.all(
          codes.map(async (code) => {
            try {
              await del(codeKey(code));
            } catch (err) {
              console.error('这张码撤不回去了（留在库里没人知道归谁）', code, err);
            }
          }),
        );
        sent.push({ email: address, error: saved.busy ? 'busy' : 'noAccount' });
        continue;
      }
      sent.push({ email: address, codes });
    }
    return send(res, 200, { plan, per, ...(expiresAt ? { expiresAt } : {}), sent });
  }

  if (!isPlan(plan)) return send(res, 400, { error: 'plan' });

  const wanted = Math.max(1, Math.min(MAX_PER_CALL, Number(count) || 1));
  const days = Number(expiresInDays) || 0;
  const expiresAt = days > 0 ? Date.now() + days * 24 * 3600e3 : undefined;

  const minted = await mintCodes(plan, wanted, expiresAt, { source: 'mint' });

  return send(res, 200, {
    plan,
    count: minted.length,
    ...(expiresAt ? { expiresAt } : {}),
    codes: minted,
  });
}
