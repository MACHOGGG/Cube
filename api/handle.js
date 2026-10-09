import { send, readBody } from './_creem.js';
import {
  checkPin,
  createAccount,
  issueToken,
  loadAccount,
  lockRemainingMs,
  newAccount,
  PAIR_RE,
  pairKey,
  updateAccount,
} from './_accounts.js';
import { isCommonFirst } from './_commonpairs.js';
import { grantLifetimeIfWindow, resolveEntitlement } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
import { storeConfigured } from './_store.js';

/**
 * 没有邮箱也进得来：两串自己取的凭据（E38）。
 *
 * 第一串当账号 id（全站唯一），第二串当密码。两串都是「大小写敏感的字母 + 数字、
 * 8 到 64 位」（`PAIR_RE`），玩家自己记在纸上或者截图存下来。
 *
 * ── 没有「重设第二串」（10-09 补充方案 7-8，玩家选乙）────────────────
 *
 * 从前这里有一支 `reset`：**只凭第一串**就能重设第二串。而第一串必须唯一、注册撞名时如实答
 * 409 `taken`，等于一个可以挨个试的「这串有没有人用」接口——两件事合起来，**知道第一串的人
 * 就能接管这个账号**。当初的理由是「没有邮箱就没有第二条通道，而忘了第二串就永远进不去对一
 * 个免费账号更糟」，界面上如实告知（「第一串是你的钥匙」）。
 *
 * 玩家 10-09 换了选择：撤掉重设，第二串成为真正的密码；想有退路的人登录之后**绑定一个邮箱**
 * （api/email.js：码寄到那个邮箱，验过就把整个账号搬到 `acct:<邮箱>` 底下，两串作废）。现在：
 *
 *   · `reset` 回 410（还会打到这儿的只剩旧标签页）；
 *   · 第二串照旧有每个账号「错 4 次锁 4 小时」（`checkPin`）、scrypt、锁期只放一个请求去比对；
 *   · 注册时太常见的第一串（`12345678`、`password1`……几百条，_commonpairs.js）答 400 `common`
 *     ——第一串照旧可以被挨个试出来，取一个人人都会先试的，等于让外人拿它把你锁在门外。
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

/** 注册那一支的限速桶（'signup'）：「不要任何凭据就能写库」。从前重设第二串也数它（7-8 撤了）。 */
const SIGNUP_PER_HOUR = 10;

/**
 * 整个接口按来路的上限，两支（注册、登录）共享。
 *
 * 它挡的**不是**「猜某一个账号的第二串」——那件事由 `checkPin` 按账号计数管着（见
 * `signin` 那一段），按来路数在那上面帮不上忙。它挡的是另一件：**拿着一份第一串的名单
 * 挨个去把别人锁掉**。
 *
 * 文件顶上写过，第一串是可以枚举的（注册撞名如实答 409）。而对任意一个第一串连错 4
 * 次，那个账号就锁 4 小时。所以不限速的话，一台机器可以用很小的代价把所有已知的第一
 * 串**一起**锁掉——主人打不开，而他看到的只是「锁了，4 小时后再试」，根本不知道为什
 * 么。30 次/小时换算过来是「一小时最多能骚扰 7 个账号」，而真人一小时按不到 30 次
 * （登一次 1 下，登不上再注册 1 下）。
 *
 * 和 `SIGNUP_PER_HOUR` 是两个桶，不是一个：那一个数的是「写库」（注册），这一个数的是「敲
 * 门」，连登录一起数。两个都要过。
 */
const PAIR_CALLS_PER_HOUR = 30;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  // 重设第二串撤了（10-09 补充方案 7-8，见文件头）。410 而不是落到下面当成一次登录：那样旧标签页
  // 上按《重设》的人会看到「这两串对不上」，而他明明没打错——这条路是不在了。
  if (body.action === 'reset') return send(res, 410, { error: 'gone' });
  const first = String(body.first ?? '');
  // 形状先验，再记账：一个连格式都不对的请求不该吃掉配额，而这一步不花钞（纯正则）。
  if (!PAIR_RE.test(first)) return send(res, 400, { error: 'badPair' });
  if (await tooMany('pairin', callerId(req), PAIR_CALLS_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  if (body.action === 'register') return register(req, res, first, body);
  return signin(res, first, body);
}

async function register(req, res, first, { second }) {
  if (!PAIR_RE.test(String(second ?? ''))) return send(res, 400, { error: 'badPair' });
  // 太常见的第一串（见文件头）。和形状那一道一样排在记账之前：查一张表，不花钞。
  if (isCommonFirst(first)) return send(res, 400, { error: 'common' });
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
  // 这一支不进 `signup` 那个桶：它不写库，而「一直猜某一个账号的第二串」由 `checkPin`
  // 按账号计数管着（错 4 次锁 4 小时，而且一个锁期只放一个请求去比对——见 _accounts.js
  // 的 pinWinKey），比按来路数准得多。
  //
  // 处理器顶上那道 `pairin` 它照样要过，挡的是另一件事（把别人挨个锁掉），理由写在
  // PAIR_CALLS_PER_HOUR 上。
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

  /**
   * 添一把，不作废别的：手机上登一次不该把平板上那一把弄掉。
   *
   * 带锁的读—改—写（`updateAccount`），不是 `saveAccount` 那样整份覆盖。这一句看着只是
   * 往令牌环里加一项，写回去的却是**整份账号**，而它和别处的写是并发的：后台这一瞬间
   * 往他收件箱里塞一张码（mint.js 的 addToInbox）、他自己在另一台设备上兑了一张码
   * （redeem.js 加时长），都会被这一份「登录那一刻读到的」旧快照盖回去——**而两边都答
   * 成功**。这个坑在 redeem.js 和 subscription.js 上都记着，照同一套来。
   *
   * 上面 `checkPin` 已经把失败计数那几个字段写进库了（patchCounters），所以这儿锁里重
   * 新读的那一份是最新的，不会把刚归零的 fails 又顶回去。
   */
  let issued;
  const locked = await updateAccount(id, (a) => {
    issued = issueToken(a);
  });
  if (!locked.ok) {
    // 到这一行令牌还没发出去，什么不可逆的事都没做，照实说一句让他再按一次。
    return send(res, locked.busy ? 503 : 401, { error: locked.busy ? 'busy' : 'wrong' });
  }
  const after = (await grantLifetimeIfWindow(id, locked.account)) || locked.account;
  return answer(res, id, after, issued);
}

/**
 * 两支共用的回包。
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
