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
    case 'HGETALL': {
      const h = mem.get(key);
      if (!(h instanceof Map)) return [];
      return [...h.entries()].flat();
    }
    case 'HDEL': {
      const h = mem.get(key);
      if (!(h instanceof Map)) return 0;
      return h.delete(String(rest[0])) ? 1 : 0;
    }
    case 'EXPIRE':
      expiries.set(key, Date.now() + Number(rest[0]) * 1000);
      return 1;
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

/** Read and delete in one step, so a code cannot be spent twice at once. */
export const takeOnce = async (key) => decode(await command(['GETDEL', key]));

export const hset = (key, field, value) => command(['HSET', key, field, encode(value)]);
/** Returns true when the field was created — how a room claims its code. */
export const hsetnx = async (key, field, value) =>
  (await command(['HSETNX', key, field, encode(value)])) === 1;
export const hdel = (key, field) => command(['HDEL', key, field]);
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
