/**
 * 库这一层的两道保险（10-15 补充 S7，L-4 ⑦⑧）。
 *
 *   node scripts/check-store-guard.mjs
 *
 * 不起服务器、不连真库：直接叫 api/_store.js，和一个接口的 handler（api/room.js）。
 *
 * ⑦ 部署环境里不认内存库。原先只要 ALLOW_MEMORY_STORE=1 就启用进程内那一份：谁在 Vercel 后台手滑填了它，线上就
 *    悄悄跑在「每个实例各一份」的内存库上——兑换码、小屋、帐号刚好常常能用，然后丢掉某个人的东西。现在 VERCEL_ENV
 *    是 production / preview 时填了也当没填：storeConfigured() 为假、接口回 503 notConfigured、日志写一次（不管
 *    问几次）。本地、CI、`vercel dev`（development）照旧放行。
 *
 * ⑧ bump（限速和猜码计数都靠它）加一和压期限一趟做完。原先 INCR、EXPIRE 两趟：EXPIRE 那一趟摔了，bump 直接抛错、
 *    请求跟着失败，而那个计数键永远不过期——那个限速桶从此每个窗口都是满的。量的是：
 *      · EXPIRE 那一条命令摔了（门里在它之前抛一次错），bump 照样回数、键照样会过期；
 *      · 以前漏下期限的键（只有 INCR、没有 EXPIRE），下一次 bump 顺手补上期限；
 *      · 那一头不认 EVAL：退回原来的两步，照样数、照样会过期；
 *      · （尺子）窗口里照常数数，过了窗口从 1 重新数。
 *    「过了窗口」靠拨 Date.now（内存库的过期就是拿它比的）。
 *
 * ⑨ hsetUnless（10-15 补充 S5，L-3 ④）：hash 里守卫那几格一格都不在才写，看和写一步。小屋报分靠它挡「快照读完之后插进来
 *    一整次开下一局」。量：守卫不在写、在就不写；那一头不认 EVAL 时退回两步，结果一样。
 *
 * 撤掉改法：⑦ 那几条红（部署环境照样认开关、回 200），⑧ 前两条红（抛错；永不过期）。
 */
process.env.ALLOW_MEMORY_STORE = '1';
delete process.env.VERCEL_ENV;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const store = await import('../api/_store.js');
const room = (await import('../api/room.js')).default;

const call = async (body) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await room({ method: 'POST', headers: { 'x-forwarded-for': '198.18.0.9' }, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};

// ── ⑦ 部署环境里不认 ALLOW_MEMORY_STORE ─────────────────────────────────────────
{
  const logged = [];
  const realErr = console.error;
  console.error = (...a) => logged.push(a.map(String).join(' '));
  const seen = {};
  try {
    for (const env of ['production', 'preview']) {
      process.env.VERCEL_ENV = env;
      seen[env] = { configured: store.storeConfigured(), answer: await call({ action: 'state', code: '1234' }) };
      await call({ action: 'state', code: '1234' });
    }
  } finally {
    console.error = realErr;
    delete process.env.VERCEL_ENV;
  }
  for (const env of ['production', 'preview']) {
    const { configured, answer } = seen[env];
    check(`⑦ VERCEL_ENV=${env}：填了 ALLOW_MEMORY_STORE 也当没配库`, configured === false, String(configured));
    check(`⑦ VERCEL_ENV=${env}：接口回 503 notConfigured`, answer.status === 503 && answer.body.error === 'notConfigured',
      `${answer.status} ${answer.body.error ?? ''}`);
  }
  const lines = logged.filter((l) => l.includes('ALLOW_MEMORY_STORE'));
  check('⑦ 日志只写一次（问了四次）', lines.length === 1, JSON.stringify(logged.slice(0, 4)));
  process.env.VERCEL_ENV = 'development';
  const dev = store.storeConfigured();
  delete process.env.VERCEL_ENV;
  check('⑦（尺子）vercel dev（development）、本地、CI（不设）照旧放行', dev === true && store.storeConfigured() === true);
}

// ── ⑧ bump：加一和压期限一趟做完 ────────────────────────────────────────────────
const realNow = Date.now;
const later = (s) => {
  const at = realNow() + s * 1000;
  Date.now = () => at;
};
try {
  // EXPIRE 那一条摔了
  globalThis.__storeHook = async (args) => {
    if (String(args[0]).toUpperCase() === 'EXPIRE') throw new Error('store 503（门里注入的）');
  };
  let n = null;
  let threw = '';
  try {
    n = await store.bump('guard:a', 60);
  } catch (err) {
    threw = String(err?.message || err);
  }
  globalThis.__storeHook = undefined;
  check('⑧ EXPIRE 那一条摔了：bump 照样回数（不抛）', n === 1 && !threw, threw || String(n));
  later(61);
  const after = await store.bump('guard:a', 60);
  Date.now = realNow;
  check('⑧ EXPIRE 那一条摔了：这个键照样会过期（过了窗口从 1 重新数）', after === 1, String(after));

  // 以前漏下期限的键：只有 INCR、没有 EXPIRE（直接发一条 INCR 摆出来）
  await store.set('guard:b', 5);
  const fixed = await store.bump('guard:b', 60);
  later(61);
  const fresh = await store.bump('guard:b', 60);
  Date.now = realNow;
  check('⑧ 没有期限的老键：下一次 bump 顺手补上期限', fixed === 6 && fresh === 1, `${fixed} → 过了窗口 ${fresh}`);

  // 那一头不认 EVAL：退回 INCR + EXPIRE 两步，照样数、照样会过期
  globalThis.__storeHook = async (args) => {
    if (String(args[0]).toUpperCase() === 'EVAL') throw new Error('ERR unknown command（门里注入的）');
  };
  const viaTwo = [await store.bump('guard:d', 60), await store.bump('guard:d', 60)];
  globalThis.__storeHook = undefined;
  later(61);
  viaTwo.push(await store.bump('guard:d', 60));
  Date.now = realNow;
  check('⑧ 那一头不认 EVAL：退回两步，照样数（1、2）、照样会过期（过了窗口 1）', viaTwo.join(',') === '1,2,1', viaTwo.join(','));

  // 尺子：窗口里照常数数，期限不顺延
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push(await store.bump('guard:c', 60));
  later(30);
  seq.push(await store.bump('guard:c', 60));
  later(61);
  seq.push(await store.bump('guard:c', 60));
  Date.now = realNow;
  check('⑧（尺子）窗口里 1、2、3、4，期限从第一下算、不顺延，过了窗口从 1 重新数', seq.join(',') === '1,2,3,4,1', seq.join(','));
} finally {
  Date.now = realNow;
  globalThis.__storeHook = undefined;
}

// ── ⑨ hsetUnless：守卫那几格一格都不在才写（10-15 补充 S5，L-3 ④；小屋报分用它） ─────────────────
{
  const key = 'guard:room';
  await store.hset(key, 'meta', { round: 1 });
  const clean = await store.hsetUnless(key, 'r:a', { score: 5 }, 'ls:2', 'le:end');
  await store.hset(key, 'ls:2', { at: Date.now() });
  const guarded = await store.hsetUnless(key, 'r:b', { score: 7 }, 'ls:2', 'le:end');
  const after = await store.hgetall(key);
  check('⑨ 守卫都不在：写了、回 true', clean === true && after['r:a']?.score === 5, `${clean} ${JSON.stringify(after['r:a'])}`);
  check('⑨ 有一格守卫在：没写、回 false', guarded === false && after['r:b'] === undefined, `${guarded} ${JSON.stringify(after['r:b'])}`);
  // 那一头不认 EVAL：退回「HMGET 看一眼 → HSET」，结果一样
  globalThis.__storeHook = async (args) => {
    if (String(args[0]).toUpperCase() === 'EVAL') throw new Error('ERR unknown command（门里注入的）');
  };
  const viaTwoBlocked = await store.hsetUnless(key, 'r:c', { score: 9 }, 'ls:2', 'le:end');
  const viaTwoOk = await store.hsetUnless(key, 'r:d', { score: 11 }, 'ls:3', 'le:end');
  globalThis.__storeHook = undefined;
  const two = await store.hgetall(key);
  check('⑨ 不认 EVAL：退回两步，守卫在就不写、不在就写', viaTwoBlocked === false && two['r:c'] === undefined &&
    viaTwoOk === true && two['r:d']?.score === 11, `${viaTwoBlocked} ${viaTwoOk} ${JSON.stringify(two['r:d'])}`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
