import { send, readBody } from './_creem.js';
import {
  checkPin,
  clearFails,
  createAccount,
  issueToken,
  loadAccount,
  lockRemainingMs,
  newAccount,
  PAIR_RE,
  pairKey,
  revokeTokens,
  saveAccount,
  unblock,
  updateAccount,
} from './_accounts.js';
import { grantLifetimeIfWindow, resolveEntitlement } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
import { storeConfigured } from './_store.js';

/**
 * 没有邮箱也进得来：两串自己取的凭据（E38）。
 *
 * 第一串当账号 id（全站唯一），第二串当密码。两串都是「大小写敏感的字母 + 数字、
 * 8 到 64 位」（`PAIR_RE`），玩家自己记在纸上或者截图存下来。
 *
 * ⚠️⚠️ **这条路的真正钥匙是第一串，不是第二串。** 玩家 2026-10-01 在知情的前提下拍的
 * 板，界面上也如实告知，但代码里必须写明白，免得后来的人以为这是个疏漏去「修」它：
 *
 *   · 第一串**必须唯一**，所以注册撞名时服务端如实答 409 `taken`——那就等于一个可以
 *     挨个试的「这串有没有人用」接口，第一串因此是**最容易被外人知道**的那一串。
 *   · 而下面 `reset` 那一支**只凭第一串**就能重设第二串。两件事合起来：知道第一串的
 *     人就能接管这个账号。
 *
 * 这不是没想过别的做法，是没有更好的：没有邮箱就没有「证明这个账号是你的」的第二条
 * 通道，而「忘了第二串就永远进不去」对一个免费账号来说更糟。所以代价明写在界面上
 * （「第一串是你的钥匙，别告诉任何人」），由玩家自己决定取一串多难猜的。
 *
 * ── 三件实现上的约定 ────────────────────────────────────────
 *
 * ① **第一串算 sha256 当 key**（`pairKey`）。直接拿原文当 id 会被 `normalizeEmail` 的
 *    `.toLowerCase()` 把大小写吃掉——而界面上明写着「区分大小写」。详见 _accounts.js
 *    的 `pairKey`。顺带的好处是服务端从此存不回第一串的明文，而它也确实不需要。
 *
 * ② **不许封号**（`checkPin` 的 `block: false`）。封号是一道只有「拿邮箱证明自己」才解
 *    得开的门（api/unlock.js），而这种账号没有邮箱。只留锁 4 小时那一档。
 *
 * ③ **不进后台名单。** `saveAccount` / `createAccount` 里那道 `EMAIL_RE` 闸自己就挡
 *    住了（`hdl:` 开头的 key 过不去），不用在这儿再做什么——写在这儿是为了说明那是
 *    **有意**的，不是漏了：名单是「所有玩家邮箱」，而这种账号没有邮箱可列。
 */

/** 限速复用注册那个桶：两条路都是「不要任何凭据就能写库」，该共享一个上限。 */
const SIGNUP_PER_HOUR = 10;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  const first = String(body.first ?? '');
  if (!PAIR_RE.test(first)) return send(res, 400, { error: 'badPair' });

  if (body.action === 'register') return register(req, res, first, body);
  if (body.action === 'reset') return reset(req, res, first, body);
  return signin(res, first, body);
}

async function register(req, res, first, { second }) {
  if (!PAIR_RE.test(String(second ?? ''))) return send(res, 400, { error: 'badPair' });
  if (await tooMany('signup', callerId(req), SIGNUP_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const id = pairKey(first);
  const account = newAccount(String(second), 'code');
  // 查和写是同一步（SET NX）。写不成就是这一串已经有人在用——如实说，因为玩家必须换
  // 一串才走得下去；含糊其辞的代价是他对着一句「出错了」反复试同一串。
  // 这一句也正是文件顶上那条「第一串可被枚举」的来处。
  if (!(await createAccount(id, account))) return send(res, 409, { error: 'taken' });

  const issued = account.token;
  // 身份这一刻成立（这一串是他刚取的），所以写得了那份终身天才。窗口关着是 no-op。
  const after = (await grantLifetimeIfWindow(id, account)) || account;
  return answer(res, id, after, issued);
}

async function signin(res, first, { second }) {
  // 这一支不限速：`checkPin` 自己按账号计数（错 4 次锁 4 小时），比按来路限速准——
  // 真正要挡的是「一直猜某一个账号的第二串」，而那个计数就挂在那个账号上。
  const id = pairKey(first);
  const account = await loadAccount(id);
  // 这一串没人用过。答得和「第二串不对」一样——否则这一支也成了一个枚举接口，而注册
  // 那一支已经不得不是一个了，没必要再多一个。
  if (!account) return send(res, 401, { error: 'wrong' });

  const verdict = await checkPin(id, String(second ?? ''), account, { block: false });
  if (verdict === 'locked') {
    return send(res, 423, { error: 'locked', retryInMs: lockRemainingMs(account) });
  }
  if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });

  // 添一把，不作废别的：手机上登一次不该把平板上那一把弄掉。
  const issued = issueToken(account);
  await saveAccount(id, account);
  const after = (await grantLifetimeIfWindow(id, account)) || account;
  return answer(res, id, after, issued);
}

/**
 * 忘了第二串：凭第一串重设。
 *
 * **这一支会把所有设备的令牌一并作废**（`revokeTokens`），和 api/unlock.js 同一个道
 * 理，但在这儿还多一层意思：这条路谁都走得通（只要知道第一串），所以真被别人走了一
 * 趟，原主人会在下一次打开时发现自己掉线了——那是他唯一能察觉的信号。换成「添一把令
 * 牌」的话，别人接管了账号而本人一无所知。
 */
async function reset(req, res, first, { newSecond }) {
  if (!PAIR_RE.test(String(newSecond ?? ''))) return send(res, 400, { error: 'badPair' });
  if (await tooMany('signup', callerId(req), SIGNUP_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const id = pairKey(first);
  let issued;
  // 带锁的读—改—写，不是朴素的整份覆盖：同一瞬间别处写进去的东西（后台发的收件箱）
  // 不该被一份旧快照盖回去。
  const locked = await updateAccount(id, (a) => {
    // unblock 换盐换哈希、把两个计数归零。免邮箱账号走不到 blocked，但锁（lockUntil）
    // 走得到，而重设之后那把锁该一起开掉——他刚证明过自己握着第一串。
    unblock(a, String(newSecond));
    issued = revokeTokens(a);
  });
  if (!locked.ok) {
    // 到这一行什么不可逆的事都没做，照实说，他重来一次就好。
    return send(res, locked.busy ? 503 : 401, { error: locked.busy ? 'busy' : 'wrong' });
  }
  // 另外那个计数键也要清——不然下一次输错，它会拿旧的次数接着往上数
  // （见 _accounts.js 的 failKey）。
  await clearFails(id);
  const after = (await grantLifetimeIfWindow(id, locked.account)) || locked.account;
  return answer(res, id, after, issued);
}

/**
 * 三支共用的回包。
 *
 * `id` 就是 `pairKey(first)`，客户端把它存进 `Entitlement.email` ——`identify`、
 * `cloudScores` 的 `auth()`、`api/scores.js`、`api/room.js` 全链路认的都是那一位，所以
 * 这种账号在它们眼里和一个邮箱账号没有区别，一行代码都不用改。
 *
 * **第一串的原文不在回包里**，服务端也没有（只有 sha256）。界面上要显示的那一份由客户
 * 端自己存（`Entitlement.handle`）。
 *
 * 权益答不出来也不算这一趟失败：账号已经开出来 / 令牌已经发出去了（和 unlock.js 末尾
 * 那段同一个道理）。
 */
async function answer(res, id, account, issued) {
  const done = { ok: true, id, token: issued };
  try {
    const { status, body } = await resolveEntitlement(id, account, issued);
    return send(res, 200, status === 200 ? { ...done, ...body, token: issued } : done);
  } catch (err) {
    console.error('handle entitlement lookup failed:', err?.message || err);
    return send(res, 200, done);
  }
}
