/**
 * 锁只许持锁的那一位放：跑超时的那一段，放手时不许删掉别人的锁（2026-10-08 方案 1-5）。
 *
 *   node scripts/check-lock-owner.mjs
 *
 * 不起服务器、不连 Redis：一半用进程内那一份库（ALLOW_MEMORY_STORE），一半把 Upstash 的 REST
 * 接口换成一个假 fetch——内存库自己实现了那一段脚本，光量它证明不了真库那头的 EVAL 写对了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * api/_store.js 的 withLock 从前在 finally 里**无条件** `del(lockKey)`。锁有 LOCK_TTL_S（10 秒）
 * 的期限：被圈住的那一段要是跑过了这个数（函数冷启动、库抖了几下），锁早就自己过期了，别人在
 * 这期间已经拿到了锁、正在「读—改—写」——这边那一句 DEL 删掉的是**他的**锁，第三个人立刻又进
 * 来了。两个人同时在锁里，后写的那份旧快照盖掉新数据：账号上的兑码、战绩上的一局，正是这把锁
 * 要防的那件事。而这种事不报错，只是偶尔「少了一样东西」。
 *
 * 现在锁上记一枚随机串，放手只删「还是我那一枚」的（delIfSame：Upstash 走 EVAL，比和删一步做
 * 完；那一头不认 EVAL 才退回 GET → 比 → DEL）。
 *
 *   ① 持锁超时、别人拿到了锁：我放手时他的锁还在。
 *   ② 正常放手：自己的锁删掉了（量程——不然 ① 在「谁的锁都不删」时也绿）。
 *   ③ delIfSame 本身：值对不上不删、对上才删。
 *   ④ 真库那条路：发出去的是 EVAL、一个键、带着那一枚值；EVAL 报错时退回三步照样只删自己的。
 *   ⑤ 源码：withLock 的 finally 里不再有裸 `del(lockKey)`。
 */
process.env.ALLOW_MEMORY_STORE = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const store = await import('../api/_store.js');
const { withLock, setnx, get, del, delIfSame } = store;

// ── ① 持锁超时，别人拿到了锁：我放手时不许删他的 ───────────────────────────
{
  const KEY = 'lock:gate-timeout';
  let theirs = null;
  const r = await withLock(KEY, async () => {
    // 摆出「这一段跑过了 LOCK_TTL_S」：我的锁到期消失，另一位紧接着拿到了锁。
    await del(KEY);
    theirs = { at: Date.now(), token: 'someone-else' };
    const got = await setnx(KEY, theirs, 10);
    check('① 量程：另一位真的拿到了锁', got === true);
    return 'done';
  });
  check('① 量程：我这一段跑完了', r.ok === true && r.value === 'done', JSON.stringify(r));
  const left = await get(KEY);
  check('① 我放手之后，他的锁还在（没被我删掉）', left && left.token === 'someone-else', JSON.stringify(left));
  // 他照常放他自己的。
  check('① 他自己放得掉', (await delIfSame(KEY, theirs)) === true && (await get(KEY)) === null);
}

// ── ② 正常放手：自己的锁删掉了 ──────────────────────────────────────────────
{
  const KEY = 'lock:gate-normal';
  let inside = null;
  await withLock(KEY, async () => {
    inside = await get(KEY);
  });
  check('② 量程：锁里记着一枚随机串', Boolean(inside && typeof inside.token === 'string' && inside.token.length >= 16),
    JSON.stringify(inside));
  check('② 正常跑完：自己的锁删掉了', (await get(KEY)) === null);
  // 两次拿到的不是同一枚（不然「只删我那一枚」就没有意义）。
  let again = null;
  await withLock(KEY, async () => {
    again = await get(KEY);
  });
  check('② 每次拿锁都是一枚新的', again && inside && again.token !== inside.token, `${inside?.token} / ${again?.token}`);
  // run 抛异常：锁照样放掉，异常照样往上抛。
  let threw = false;
  try {
    await withLock(KEY, async () => {
      throw new Error('boom');
    });
  } catch (err) {
    threw = err.message === 'boom';
  }
  check('② 里面抛了异常：照样往上抛', threw);
  check('② 而且锁照样放掉了', (await get(KEY)) === null);
}

// ── ③ delIfSame 本身 ─────────────────────────────────────────────────────────
{
  const KEY = 'lock:gate-direct';
  const a = { at: 1, token: 'aaa' };
  const b = { at: 2, token: 'bbb' };
  await setnx(KEY, a, 10);
  check('③ 值对不上：不删', (await delIfSame(KEY, b)) === false && (await get(KEY))?.token === 'aaa');
  check('③ 值对上：删掉', (await delIfSame(KEY, a)) === true && (await get(KEY)) === null);
  check('③ 键已经没了：不删、不报错', (await delIfSame(KEY, a)) === false);
}

// ── ④ 真库那条路（Upstash REST），用一个假 fetch 顶着 ────────────────────────
{
  process.env.KV_REST_API_URL = 'https://fake-upstash.example';
  process.env.KV_REST_API_TOKEN = 'fake';
  const kv = new Map();
  const seen = [];
  let evalBroken = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const args = JSON.parse(init.body);
    seen.push(args);
    const [cmd, ...rest] = args;
    const ok = (result) => ({ ok: true, status: 200, json: async () => ({ result }) });
    switch (String(cmd).toUpperCase()) {
      case 'SET': {
        const [key, value, ...opt] = rest;
        if (opt.map((x) => x.toUpperCase()).includes('NX') && kv.has(key)) return ok(null);
        kv.set(key, value);
        return ok('OK');
      }
      case 'GET':
        return ok(kv.get(rest[0]) ?? null);
      case 'DEL':
        return ok(kv.delete(rest[0]) ? 1 : 0);
      case 'EVAL': {
        if (evalBroken) return { ok: true, status: 200, json: async () => ({ error: 'ERR unknown command EVAL' }) };
        const [script, numkeys, key, want] = rest;
        // 照真 Redis 的样子跑那一段脚本的意思：一个键、一个参数，比上了才删。
        if (numkeys !== '1' || !/redis\.call\('GET', KEYS\[1\]\) == ARGV\[1\]/.test(script)) {
          return { ok: true, status: 200, json: async () => ({ error: 'ERR bad script' }) };
        }
        if (kv.get(key) !== want) return ok(0);
        kv.delete(key);
        return ok(1);
      }
      default:
        return { ok: true, status: 200, json: async () => ({ error: 'ERR unexpected ' + cmd }) };
    }
  };
  try {
    const KEY = 'lock:gate-remote';
    let theirs = null;
    await withLock(KEY, async () => {
      kv.delete(KEY); // 过期
      theirs = { at: Date.now(), token: 'remote-other' };
      await setnx(KEY, theirs, 10);
    });
    const evals = seen.filter((a) => String(a[0]).toUpperCase() === 'EVAL');
    check('④ 真库：放手走的是 EVAL（比和删一步）', evals.length === 1, `${evals.length} 条 EVAL`);
    check('④ 真库：EVAL 带一个键、键名对、参数是那一枚值',
      evals[0] && evals[0][2] === '1' && evals[0][3] === KEY && /"token":"[0-9a-f]{24}"/.test(evals[0][4]),
      JSON.stringify(evals[0]?.slice(2)));
    check('④ 真库：他的锁还在', JSON.parse(kv.get(KEY) || 'null')?.token === 'remote-other', String(kv.get(KEY)));
    check('④ 真库：没有任何一条裸 DEL 打到这把锁上',
      !seen.some((a) => String(a[0]).toUpperCase() === 'DEL' && a[1] === KEY));

    // EVAL 不可用：退回 GET → 比 → DEL，照样只删自己的。
    evalBroken = true;
    seen.length = 0;
    const KEY2 = 'lock:gate-fallback';
    await withLock(KEY2, async () => {
      kv.delete(KEY2);
      await setnx(KEY2, { at: Date.now(), token: 'fallback-other' }, 10);
    });
    check('④ EVAL 报错时退回三步：他的锁还在', JSON.parse(kv.get(KEY2) || 'null')?.token === 'fallback-other', String(kv.get(KEY2)));
    const KEY3 = 'lock:gate-fallback-own';
    await withLock(KEY3, async () => {});
    check('④ EVAL 报错时退回三步：自己的锁照样放得掉', !kv.has(KEY3));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
}

// ── ⑤ 源码：finally 里不再有裸 del(lockKey) ─────────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../api/_store.js', import.meta.url), 'utf8');
  // 去掉注释再量：注释里正好写着从前那一句 `del(lockKey)`（说明它为什么不行）。
  const body = src
    .slice(src.indexOf('export async function withLock'), src.indexOf('export async function bump'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  check('⑤ withLock 放手用的是 delIfSame', /delIfSame\(lockKey, mine\)/.test(body));
  check('⑤ withLock 里没有裸 del(lockKey)', !/\bdel\(lockKey\)/.test(body));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
