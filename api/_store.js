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
const memoryAllowed = () => process.env.ALLOW_MEMORY_STORE === '1';

export const storeConfigured = () => remote() || memoryAllowed();

/**
 * A single Redis command. Upstash's REST endpoint takes the command as a
 * JSON array and answers {result} or {error}.
 */
async function command(args) {
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
export const del = (key) => command(['DEL', key]);

/**
 * 加一，并把加完的那个数拿回来——加和读是同一步，中间没有缝。
 *
 * 「先读出来看看到了几次，再判断，再加一写回去」这个写法，在一台机器上看着
 * 没问题，放到并发里就是一道假门：三步之间隔着两次网络往返，同一瞬间打进来
 * 的几十个请求会读到同一个旧值，于是这一批只被记成一次。猜验证码、猜密码那
 * 两处的次数上限，靠的正是这个计数（api/unlock.js、api/_accounts.js）——上
 * 限被这样绕过去，等于没有上限。
 *
 * INCR 是 Redis 自己那一步：加一，返回新值。每个请求各拿到一个属于自己的
 * 号，超号的当场退回，比对根本轮不上。
 *
 * ttl 只在这个键刚落地那一下压（返回 1 的时候）。每次都压的话，一直猜的人
 * 会把窗口一路往后顺延，反倒是猜得越勤活得越久。
 */
export async function bump(key, ttl) {
  const n = Number(await command(['INCR', key])) || 0;
  if (n === 1 && ttl) await command(['EXPIRE', key, ttl]);
  return n;
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
