/**
 * The small amount of shared state the app genuinely cannot do without:
 * multiplayer rooms, and the accounts a redeemed code creates.
 *
 * Subscriptions still have no database — those are read from Creem or from
 * a store receipt, every time, so there is no second copy of them to fall
 * out of step. What lives here is only what is inherently shared: a room
 * four phones are looking at, and a code that must be spendable exactly once.
 *
 * Redis over REST (Upstash, or Vercel KV — same protocol, different env
 * names), because a serverless function cannot hold a socket open between
 * invocations. No SDK: it is one fetch per command, which keeps the
 * dependency list where it is.
 *
 * Rooms are stored as a Redis *hash*, one field per player, never as one
 * blob. Four phones report scores at the same time, and a read-modify-write
 * of a single JSON document would drop most of them; writing only your own
 * field cannot lose anyone else's.
 */
import { randomBytes } from 'node:crypto';
import { redact } from './_redact.js';

const url = () =>
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const token = () =>
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

/**
 * The in-memory fallback below is never reached by accident. On Vercel each
 * invocation may land on a different instance, so a room or a redeem code
 * kept in one process's memory would work exactly often enough to look
 * fine and then lose someone's code. So it has to be asked for by name:
 * ALLOW_MEMORY_STORE=1, which `vercel dev` and the test harness set and a
 * deployment does not. With neither that nor a real Redis, the endpoints
 * report that the feature is not open rather than half-working.
 */
const remote = () => Boolean(url() && token());
/**
 * 部署出去的那一份（`VERCEL_ENV` 是 production 或 preview）一律不认 ALLOW_MEMORY_STORE（10-15 补充 S7，L-4 ⑦）。
 * 原先只看这个开关：谁在 Vercel 后台手滑填了它，线上就悄悄跑在各实例各一份的内存库上——兑换码、小屋、帐号「刚好常常
 * 能用」，然后丢掉某个人的东西。现在部署环境里填了也当没填：storeConfigured() 为假、接口回 503 notConfigured，日志
 * 写一次。本地、CI、`vercel dev`（VERCEL_ENV 是 development）都没有这两个值，照旧放行。
 * ⚠️ VERCEL_ENV 要在 Vercel 项目设置里勾着「Automatically expose System Environment Variables」才会注入；没勾的话
 * 这道保险不起作用——和原先一样，不会更糟。
 */
const deployed = () => ['production', 'preview'].includes(process.env.VERCEL_ENV || '');
let warnedDeployed = false;
const memoryAllowed = () => {
  if (process.env.ALLOW_MEMORY_STORE !== '1') return false;
  if (!deployed()) return true;
  if (!warnedDeployed) {
    warnedDeployed = true;
    console.error('部署环境里不认 ALLOW_MEMORY_STORE（按没配库处理，接口回 notConfigured）');
  }
  return false;
};

export const storeConfigured = () => remote() || memoryAllowed();

/**
 * A single Redis command. Upstash's REST endpoint takes the command as a
 * JSON array and answers {result} or {error}.
 */
async function command(args) {
  // **只给门用**（check-room-join-rollback，10-15 补充 S4）：内存库下可以在任一条命令之前插一手、让它抛错，量「库
  // 中途摔了」那几条路。只在 ALLOW_MEMORY_STORE=1 时生效——部署出去的那一份不认这个开关，globalThis 上也不会有它。
  if (memoryAllowed() && globalThis.__storeHook) await globalThis.__storeHook(args);
  if (!remote()) return memory(args);
  const res = await fetch(url(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.map(String)),
  });
  if (!res.ok) {
    const err = new Error(`store ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

/**
 * A stand-in for `vercel dev`, where there may be no Redis to talk to. It
 * lives in one process's memory and is emphatically not the real thing —
 * every serverless instance would have its own — but it lets the whole
 * multiplayer and redeem flow be exercised locally without an account.
 */
const mem = new Map();
const expiries = new Map();
function memory(args) {
  // EVAL 的第二个参数是脚本、不是键，所以在按键处理过期之前单独接走（见 delIfSame）。
  if (String(args[0]).toUpperCase() === 'EVAL') return memoryEval(args);
  const [rawCmd, key, ...rest] = args;
  const cmd = String(rawCmd).toUpperCase();
  const due = expiries.get(key);
  if (due !== undefined && due < Date.now()) {
    mem.delete(key);
    expiries.delete(key);
  }
  switch (cmd) {
    case 'GET':
      return mem.get(key) ?? null;
    case 'SET': {
      const exIndex = rest.findIndex((v) => String(v).toUpperCase() === 'EX');
      const nx = rest.some((v) => String(v).toUpperCase() === 'NX');
      if (nx && mem.has(key)) return null;
      mem.set(key, rest[0]);
      if (exIndex >= 0) expiries.set(key, Date.now() + Number(rest[exIndex + 1]) * 1000);
      return 'OK';
    }
    case 'DEL':
      return mem.delete(key) ? 1 : 0;
    // 一批键一个都不在才一起写进去，有一个已经在就一个都不写（见 msetnx）。真 Redis 那头是
    // 一条命令原子做完的；这里单进程内存，一个 case 里查完再写，中间没有别人插得进来。
    case 'MSETNX': {
      const pairs = [key, ...rest];
      for (let i = 0; i < pairs.length; i += 2) {
        const k = pairs[i];
        const d = expiries.get(k);
        if (d !== undefined && d < Date.now()) {
          mem.delete(k);
          expiries.delete(k);
        }
        if (mem.has(k)) return 0;
      }
      for (let i = 0; i < pairs.length; i += 2) mem.set(pairs[i], pairs[i + 1]);
      return 1;
    }
    case 'GETDEL': {
      const v = mem.get(key) ?? null;
      mem.delete(key);
      return v;
    }
    case 'HSET': {
      const h = mem.get(key) instanceof Map ? mem.get(key) : new Map();
      for (let i = 0; i < rest.length; i += 2) h.set(String(rest[i]), rest[i + 1]);
      mem.set(key, h);
      return 1;
    }
    case 'HSETNX': {
      const h = mem.get(key) instanceof Map ? mem.get(key) : new Map();
      if (h.has(String(rest[0]))) return 0;
      h.set(String(rest[0]), rest[1]);
      mem.set(key, h);
      return 1;
    }
    case 'HGET': {
      const h = mem.get(key);
      return h instanceof Map ? (h.get(String(rest[0])) ?? null) : null;
    }
    case 'HGETALL': {
      const h = mem.get(key);
      if (!(h instanceof Map)) return [];
      return [...h.entries()].flat();
    }
    // 和真 Redis 一样：问几个字段回几格，按问的顺序，不在的那一格是 null。
    case 'HMGET': {
      const h = mem.get(key);
      return rest.map((f) => (h instanceof Map ? (h.get(String(f)) ?? null) : null));
    }
    // 同 INCR，只是数字住在一个 hash 字段里。单进程内存，一个 case 里读了再
    // 写中间没有别人插得进来，同样是一步。
    case 'HINCRBY': {
      const h = mem.get(key) instanceof Map ? mem.get(key) : new Map();
      const next = (Number(h.get(String(rest[0])) ?? 0) || 0) + Number(rest[1]);
      h.set(String(rest[0]), String(next));
      mem.set(key, h);
      return next;
    }
    case 'HDEL': {
      const h = mem.get(key);
      if (!(h instanceof Map)) return 0;
      return h.delete(String(rest[0])) ? 1 : 0;
    }
    case 'EXPIRE':
      expiries.set(key, Date.now() + Number(rest[0]) * 1000);
      return 1;
    // 真 Redis 那头 INCR 是一条命令一次做完的；这里是单进程内存，一个 case
    // 里读了再写中间没有别人插得进来，同样是一步。
    case 'INCR': {
      const next = (Number(mem.get(key) ?? 0) || 0) + 1;
      mem.set(key, String(next));
      return next;
    }
    // 排行榜就是一个有序集合。用 Map 冒充：成员 → 分数，读的时候再排。真的
    // Redis 那头是 O(log n) 的跳表，这里是 O(n log n) 的一次排序——本地跑
    // 测试够用，也只在这里用。
    case 'ZADD': {
      const z = mem.get(key) instanceof Map ? mem.get(key) : new Map();
      // 只认 GT（比原来高才写）这一个修饰符，因为只用得上它。
      const gt = String(rest[0]).toUpperCase() === 'GT';
      const pairs = gt ? rest.slice(1) : rest;
      let changed = 0;
      for (let i = 0; i < pairs.length; i += 2) {
        const score = Number(pairs[i]);
        const member = String(pairs[i + 1]);
        if (gt && z.has(member) && z.get(member) >= score) continue;
        z.set(member, score);
        changed++;
      }
      mem.set(key, z);
      return changed;
    }
    case 'ZREM': {
      const z = mem.get(key);
      if (!(z instanceof Map)) return 0;
      let removed = 0;
      for (const m of rest) if (z.delete(String(m))) removed++;
      return removed;
    }
    case 'ZSCORE': {
      const z = mem.get(key);
      if (!(z instanceof Map)) return null;
      const v = z.get(String(rest[0]));
      return v === undefined ? null : String(v);
    }
    case 'ZREVRANK': {
      const z = mem.get(key);
      if (!(z instanceof Map)) return null;
      const member = String(rest[0]);
      if (!z.has(member)) return null;
      const order = [...z.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
      return order.findIndex(([m]) => m === member);
    }
    case 'ZCARD': {
      const z = mem.get(key);
      return z instanceof Map ? z.size : 0;
    }
    case 'ZRANGE': {
      const z = mem.get(key);
      if (!(z instanceof Map)) return [];
      const flags = rest.slice(2).map((v) => String(v).toUpperCase());
      const rev = flags.includes('REV');
      const scores = flags.includes('WITHSCORES');
      let order = [...z.entries()].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
      if (rev) order = [...z.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
      const start = Number(rest[0]);
      const stop = Number(rest[1]);
      const slice = order.slice(start, stop < 0 ? order.length + stop + 1 : stop + 1);
      return scores ? slice.flatMap(([m, sc]) => [m, String(sc)]) : slice.map(([m]) => m);
    }
    // SCAN：内存这一份一次就把合乎模式的键全给出去、游标直接回 0（真 Redis 是一批一批地翻，规矩
    // 允许一次给完）。模式只用得上 `前缀*` 那一种，照 glob 的写法转一下就够了（见 scanKeys）。
    // 这儿的 `key` 是游标，不是键——上面那几行按键清过期的话碰不到任何东西，无害。
    case 'SCAN': {
      const at = rest.findIndex((v) => String(v).toUpperCase() === 'MATCH');
      const glob = at >= 0 ? String(rest[at + 1]) : '*';
      const re = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      const now = Date.now();
      const keys = [];
      for (const k of mem.keys()) {
        const d = expiries.get(k);
        if (d !== undefined && d < now) continue;
        if (re.test(String(k))) keys.push(String(k));
      }
      return ['0', keys];
    }
    default:
      throw new Error('unsupported command in the in-memory store: ' + cmd);
  }
}

const encode = (value) => JSON.stringify(value);
const decode = (raw) => {
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
};

export const get = async (key) => decode(await command(['GET', key]));
export const set = (key, value, ttl) =>
  command(ttl ? ['SET', key, encode(value), 'EX', ttl] : ['SET', key, encode(value)]);
/**
 * 只有这个键还空着才写得进去——查和写是同一步。
 *
 * 「先 get 看看有没有人，再 set 写进去」这个写法，在一台机器上看着没问题，放
 * 到并发里就是一道假门：两步之间隔着一次网络往返，同一瞬间打进来的两个请求
 * 都会读到「没人」，于是两个都写，后写的那份把先写的整个盖掉。
 *
 * 开账号那三条路（passcode 的 bind / create、email 的确认换邮箱）栽的正是这
 * 个。实测：一家人共用一个邮箱，两个人各拿一张码前后脚点「绑定」——两边手机
 * 上都显示成功，两张码都被吃掉，而库里只留得下后写的那一份；先操作那个人码
 * 没了、权益没了，手里那个登录令牌当场作废。
 *
 * SET ... NX 是 Redis 自己那一步：没人才写，写成了回 "OK"，已经有人回 nil。
 * 和小屋抢房号用的 HSETNX 是同一个道理，只是那边住在 hash 里。
 *
 * ttl（秒）是给**锁**用的：一把没有期限的锁，只要持有者中途摔了（函数超时、
 * 实例被回收），那个键就永远占着，后面谁也进不来——比它要修的并发问题更糟。
 * 当「开账号」这种一次性占位用时不给 ttl，那就是永久的，本来也该永久。
 *
 * @returns 写进去了 true；这个键上已经有人 false。
 */
export const setnx = async (key, value, ttl) =>
  (await command(
    ttl ? ['SET', key, encode(value), 'NX', 'EX', ttl] : ['SET', key, encode(value), 'NX'],
  )) !== null;
export const del = (key) => command(['DEL', key]);
/**
 * 一批键**一个都不在**才一起写进去（MSETNX），回 true；只要有一个已经在，就一个都不写，回 false。
 * 没有过期时间。
 *
 * 发码用它把一整批码一步写进库（_codes.js 的 mintCodes，10-08 方案第五批第 2 条）：原先一张码
 * 两次往返（先 GET 看有没有人、再 SET），一批两百张就是四百次，管理员页上发一批大的会超时。
 * 「不许盖掉别人那张还没兑的码」这一条照旧守着，而且比原先更严——查和写是同一步。
 */
export const msetnx = async (entries) =>
  Number(await command(['MSETNX', ...entries.flatMap(([k, v]) => [k, encode(v)])])) === 1;

/**
 * 键上**还是这个值**才删——比和删是同一步。给锁放手用（见 withLock）。
 *
 * 优先 EVAL（Upstash / Vercel KV 都认 Lua）：GET 和 DEL 在 Redis 里一口气做完，中间谁都插不进
 * 来。万一那一头不认 EVAL（报错），退回「GET → 比 → DEL」三步：中间隔着两次往返，这一缝里键
 * 恰好过期、又恰好被别人抢到，删的就还是别人的锁——窗口只有两次往返那么宽，而且只在 EVAL 不
 * 可用时才存在，比从前「无条件 DEL」那一整段（见 withLock）窄得多。
 *
 * @returns 删了 true；键上已经不是这个值（或者没了）false。
 */
const DEL_IF_SAME = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
export async function delIfSame(key, value) {
  const want = encode(value);
  try {
    return Number(await command(['EVAL', DEL_IF_SAME, 1, key, want])) === 1;
  } catch {
    if ((await command(['GET', key])) !== want) return false;
    return Number(await command(['DEL', key])) === 1;
  }
}

/**
 * hash 里那一格**还是这个值**才删——比和删是同一步。delIfSame 的 hash 字段版（10-11 方案 C-2）。
 *
 * 小屋满了、收「掉线的人那把椅子」用它（room.js 的 claimSeat）。原先是无条件 HDEL：两个人同时按《加入》，读
 * 到的是同一份旧快照，先到的那个删掉掉线的人那把椅子、当场坐上去；后到的那个照着旧快照再删一遍——删掉的已经
 * 是先到的那个人刚坐上的椅子，然后自己坐上去。一把椅子两个人，屋里人数超过上限（实测 10 次里 10 次）。现在只
 * 有「椅子上还是那个掉线的人」才删。
 *
 * 退路和 delIfSame 一样：那一头不认 EVAL 就退回「HGET → 比 → HDEL」，窗口两次往返那么宽。
 *
 * @returns 删了 true；那一格已经不是这个值（或者没了）false。
 */
const HDEL_IF_SAME =
  "if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then return redis.call('HDEL', KEYS[1], ARGV[1]) else return 0 end";
export async function hdelIfSame(key, field, value) {
  const want = encode(value);
  try {
    return Number(await command(['EVAL', HDEL_IF_SAME, 1, key, field, want])) === 1;
  } catch {
    if ((await command(['HGET', key, field])) !== want) return false;
    return Number(await command(['HDEL', key, field])) === 1;
  }
}

/** 内存库只认得 delIfSame、hdelIfSame、bump 那三段脚本：它本来就是单进程，一个函数里做完，同样是一步。 */
function memoryEval(args) {
  const [, script, , key, ...argv] = args;
  if (script !== DEL_IF_SAME && script !== HDEL_IF_SAME && script !== BUMP) throw new Error('memory store: unknown script');
  const due = expiries.get(key);
  if (due !== undefined && due < Date.now()) {
    mem.delete(key);
    expiries.delete(key);
  }
  if (script === BUMP) {
    const next = (Number(mem.get(key) ?? 0) || 0) + 1;
    mem.set(key, String(next));
    if (next === 1 || !expiries.has(key)) expiries.set(key, Date.now() + Number(argv[0]) * 1000);
    return next;
  }
  if (script === HDEL_IF_SAME) {
    const [field, want] = argv;
    const h = mem.get(key);
    if (!(h instanceof Map) || h.get(String(field)) !== want) return 0;
    h.delete(String(field));
    return 1;
  }
  const [want] = argv;
  if (mem.get(key) !== want) return 0;
  mem.delete(key);
  expiries.delete(key);
  return 1;
}

/**
 * 一把短命的锁，圈住一段「读出来—算—写回去」。
 *
 * 这一段本来长在 _accounts.js 的 updateAccount 里，只有账号用得上。现在抽到这
 * 里，因为**同一种病不止一处**：任何存成「一份 JSON 大文档」的东西，只要有两
 * 条路会读它、改它、整份写回去，后写的那一份就会把前一次的结果整个盖掉。已经
 * 咬过人的两处——
 *
 *   · 账号（acct:<邮箱>）：一个人几乎同时兑两张码，两张都真的被吃掉、两次都
 *     说成功，账号上只多了一个月。
 *   · 战绩（stats:<id>）：玩家交卷的同一瞬间管理员点了《重建榜单》，重建读整
 *     份、只改 best、写整份回去——`total` 和 `runs` 跟着回退，而重建永远不重算
 *     这两个数，**再重建一次也救不回来**。
 *
 * 抄第二份锁是不行的：抄了以后调 TTL、调重试次数就要改两处，而漏改的那一处
 * 会安静地按旧参数跑。所以这里只有一份。
 *
 * 为什么必须是整段进锁，不是「写之前重读一次」：写之前重读只把窗口从几十次
 * 往返缩到一次，没关上。而且对 best 这种「从存档算出来的」值，重读也救不了
 * ——算完之后还要撤榜上榜，中间只要松过锁，新交的那一局就溜进了存档，而 best
 * 已经按旧存档算完了。实测过四个版本，只有整段进锁的那一版三个数都对。
 *
 * 锁自带 TTL（LOCK_TTL_S）：持有者中途摔了（函数超时、实例被回收），最多锁住
 * 这么久，绝不会把一个键永久焊死。抢不到就等一下重试，等够 LOCK_TRIES 次才回
 * busy——调用方该把已经拿走的东西放回去（见 api/redeem.js 的 giveBack）。
 *
 * @param lockKey 锁自己的键。和被保护的那个键一一对应，别和数据键同名。
 * @param run 抢到锁之后跑的那一段。它的返回值原样放在 value 里。
 * @returns { ok: true, value } 跑完了；{ ok: false, busy: true } 一直没抢到。
 *          run 自己抛出来的异常照旧往上抛（锁在那之前已经放掉了）。
 */
/** 锁最多活这么久。比任何一次「读—改—写」都长得多，又短到卡住了也能自愈。 */
export const LOCK_TTL_S = 10;
/** 抢不到就等一下再来，最多这么多次（约 1.8 秒）。 */
const LOCK_TRIES = 30;
const LOCK_WAIT_MS = 60;
const napMs = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withLock(lockKey, run) {
  for (let i = 0; i < LOCK_TRIES; i++) {
    /**
     * 锁上记一枚只有这一次知道的随机串（2026-10-08 方案 1-5）。
     *
     * 从前放锁是无条件 `del(lockKey)`。这一段要是跑过了 LOCK_TTL_S（函数冷启动、库抖了几
     * 下），锁早就自己过期了，而别人在这期间已经拿到了**他的**锁、正在读—改—写——这边一
     * 句 DEL 删掉的是**他的**锁，第三个人立刻又进来了。两个人同时在锁里，后写的那份旧快照
     * 盖掉新数据，正是这把锁要防的那件事。现在只删「还是我那一枚」的锁（delIfSame）。
     */
    const mine = { at: Date.now(), token: randomBytes(12).toString('hex') };
    if (await setnx(lockKey, mine, LOCK_TTL_S)) {
      try {
        return { ok: true, value: await run() };
      } finally {
        // 放锁失败也不要紧：它自己有 TTL，最多十秒后自己消失。已经不是我的锁（过期了、
        // 别人拿着）就什么都不删——那一枚归他放。
        try {
          await delIfSame(lockKey, mine);
        } catch (err) {
          // 锁的名字里带着账号 id（statsLockKey 那一类就是「前缀 + 邮箱」），原样写进日志就
          // 是一行明文邮箱（第 14 推）。写指纹：要对账时把同一把锁的名字算一遍去 grep。
          console.error('锁没放掉（十秒后自己过期）', redact(lockKey), err);
        }
      }
    }
    await napMs(LOCK_WAIT_MS);
  }
  return { ok: false, busy: true };
}

/**
 * 加一，并把加完的那个数拿回来——加和读是同一步，中间没有缝。
 *
 * 「先读出来看看到了几次，再判断，再加一写回去」这个写法，在一台机器上看着
 * 没问题，放到并发里就是一道假门：三步之间隔着两次网络往返，同一瞬间打进来
 * 的几十个请求会读到同一个旧值，于是这一批只被记成一次。猜验证码、猜密码那
 * 两处的次数上限，靠的正是这个计数（api/_unlock_legacy.js——原来的 unlock.js——、api/_accounts.js）——上
 * 限被这样绕过去，等于没有上限。
 *
 * INCR 是 Redis 自己那一步：加一，返回新值。每个请求各拿到一个属于自己的
 * 号，超号的当场退回，比对根本轮不上。
 *
 * ttl 只在这个键刚落地那一下压（返回 1 的时候）。每次都压的话，一直猜的人
 * 会把窗口一路往后顺延，反倒是猜得越勤活得越久。
 *
 * 加一和压期限写成一段 Lua，一趟做完（10-15 补充 S7，L-4 ⑧）。原先是 INCR、EXPIRE 两趟：EXPIRE 那一趟摔了，
 * bump 直接抛错、整个请求跟着失败，而那个计数键**永远不过期**——限速桶从此每个窗口都是满的，那个人（那个网络）
 * 被永久挡在门外。脚本里顺手给「没有期限」的键补上（TTL == -1：以前漏下期限的那些）。那一头不认 EVAL（报错）
 * 时退回原来的两步，同 delIfSame 的退路。
 */
const BUMP =
  "local n = redis.call('INCR', KEYS[1]) if n == 1 or redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n";
export async function bump(key, ttl) {
  if (!ttl) return Number(await command(['INCR', key])) || 0;
  try {
    return Number(await command(['EVAL', BUMP, 1, key, ttl])) || 0;
  } catch {
    const n = Number(await command(['INCR', key])) || 0;
    if (n === 1) await command(['EXPIRE', key, ttl]);
    return n;
  }
}

/** Read and delete in one step, so a code cannot be spent twice at once. */
export const takeOnce = async (key) => decode(await command(['GETDEL', key]));

export const hset = (key, field, value) => command(['HSET', key, field, encode(value)]);
/** 只要一个字段。排行榜的名字表是全站一张大 hash，为搬一个人的名字去
 *  hgetall 一遍，读回来的是所有玩家。 */
export const hget = async (key, field) => decode(await command(['HGET', key, field]));
/** Returns true when the field was created — how a room claims its code. */
export const hsetnx = async (key, field, value) =>
  (await command(['HSETNX', key, field, encode(value)])) === 1;
export const hdel = (key, field) => command(['HDEL', key, field]);
/**
 * 给 hash 里的一个数字加一点，并把加完的那个数拿回来——加和读是同一步。
 *
 * 和 bump 是同一个道理（见它上面那段），区别只在这个数住在 hash 里：所以读
 * 整间屋（hgetall）的时候它顺带就回来了，不必为它多跑一趟。小屋那头「被催了
 * 多少下」正是这样一个数——每台设备一秒问一次屋子的状态，为这一个数字多发
 * 一条命令，八个人就是每秒八条。
 */
export const hincrby = async (key, field, by = 1) =>
  Number(await command(['HINCRBY', key, field, by])) || 0;
export const expire = (key, ttl) => command(['EXPIRE', key, ttl]);

/**
 * 排行榜：一个有序集合，成员是玩家，分数是他的成绩。
 *
 * 用 Redis 自己的这套结构，而不是读一整张表回来在函数里排：一张榜将来有多
 * 少人是不知道的，而「取前五十名」和「我排第几」在有序集合里都是一步就出
 * 来的事。
 */
/** GT：只有比榜上原来的成绩高才写进去。名次只上不下，除非真的打得更好。 */
export const zaddIfHigher = (key, score, member) =>
  command(['ZADD', key, 'GT', String(Math.round(score)), member]);
/** 覆盖式写入——累计分这种「重算之后就是它」的数用这个。 */
export const zadd = (key, score, member) =>
  command(['ZADD', key, String(Math.round(score)), member]);
/** 从榜上撤下一个人。不在榜上也不算错。 */
export const zrem = (key, member) => command(['ZREM', key, member]);
export const zscore = async (key, member) => {
  const raw = await command(['ZSCORE', key, member]);
  return raw === null || raw === undefined ? null : Number(raw);
};
/** 从高到低数，第几名（0 起）。不在榜上就是 null。 */
export const zrevrank = async (key, member) => {
  const raw = await command(['ZREVRANK', key, member]);
  return raw === null || raw === undefined ? null : Number(raw);
};
export const zcard = async (key) => Number(await command(['ZCARD', key])) || 0;

/** 前 n 名，从高到低，[{ member, score }]。 */
export async function zTop(key, n) {
  const flat = await command(['ZRANGE', key, '0', String(Math.max(0, n - 1)), 'REV', 'WITHSCORES']);
  const out = [];
  if (Array.isArray(flat)) {
    // Upstash 有时给 [m, s, m, s]，有时给 [[m, s], …]——两种都收。
    if (flat.length && Array.isArray(flat[0])) {
      for (const [m, sc] of flat) out.push({ member: String(m), score: Number(sc) });
    } else {
      for (let i = 0; i < flat.length; i += 2) {
        out.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
      }
    }
  }
  return out;
}

/**
 * 一个 hash 里的指定几格，和 hgetall 同一个样子（{ 字段: 解好的值 }），只是只有问到的那几格；
 * 库里没有的那一格不出现在结果里（和 hgetall 读不到它时一样）。
 *
 * 排行榜一页只画五十行，原先为了这五十个名字把整张名字表（全站每个玩家一行）hgetall 回来——
 * 人越多越慢、越贵，用到的只有那五十个（10-09 补充方案 7-13 第 7 条）。
 */
export async function hmget(key, fields) {
  const list = [...new Set(fields.map(String))];
  if (!list.length) return {};
  const flat = await command(['HMGET', key, ...list]);
  const out = {};
  if (Array.isArray(flat)) {
    list.forEach((field, i) => {
      if (flat[i] !== null && flat[i] !== undefined) out[field] = decode(flat[i]);
    });
  }
  return out;
}

/**
 * 库里名字合这个模式的所有键（SCAN，一批一批地翻，10-11 方案 A-5）。
 *
 * 重建榜单原先只算「总榜前 5000 名 ＋ 留过名字的人」，于是只打过 0 分局、又没起昵称的人从来不在名单
 * 上——他在某张榜上那一行 0 分，「全部清空」也清不掉。所以改成按 `stats:*` 把每一个交过卷的人都找
 * 出来。
 *
 * SCAN 给的顺序是乱的、同一个键可能出现两次（Redis 的规矩），这里只去重；要排序（重建分批续跑靠
 * 「按 id 排好序 + 算到了谁」）由调用方做。
 */
export async function scanKeys(match, count = 1000) {
  const out = new Set();
  let cursor = '0';
  do {
    const reply = await command(['SCAN', cursor, 'MATCH', match, 'COUNT', String(count)]);
    const [next, keys] = Array.isArray(reply) ? reply : ['0', []];
    for (const k of Array.isArray(keys) ? keys : []) out.add(String(k));
    cursor = String(next ?? '0');
  } while (cursor !== '0');
  return [...out];
}

/** The whole hash, as a plain object with every value already parsed. */
export async function hgetall(key) {
  const flat = await command(['HGETALL', key]);
  const out = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = decode(flat[i + 1]);
  } else if (flat && typeof flat === 'object') {
    for (const [k, v] of Object.entries(flat)) out[k] = decode(v);
  }
  return out;
}
