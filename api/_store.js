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
