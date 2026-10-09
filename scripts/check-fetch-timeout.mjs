/**
 * 前端的每一个请求都有超时（10-09 补充方案 7-13 第 13 条）。
 *
 *   node scripts/check-fetch-timeout.mjs
 *
 * 纯 node：把 src/engine/fetchTimeout.ts 和一个真调用处（engine/account.ts）各自打成一包，假 fetch
 * 想挂就挂、想断就断。不开浏览器，进得了 CI。
 *
 * ── 那个病 ────────────────────────────────────────────────────
 *
 * fetch 自己没有超时。网络卡在半路（电梯里、地铁换乘、Wi-Fi 认证页挡着）的时候请求既不成也不败，能
 * 挂好几分钟：键一直转、「处理中…」一直挂着，小屋的轮询停在那一下不往下走。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 *   ① 挂住不回的请求，到点就放弃：抛 TypeError（和断网同一类，调用处原来怎么接断网就怎么接它），
 *      而且请求本身被 abort 了（AbortController 那一路）。
 *   ② 没有 AbortController 的老内核（Chrome 66 以前）：照样到点放弃，只是不带 signal。
 *   ③ 正常回包原样透传；断网的错原样透传（不被换成「超时」）；默认等 15 秒。
 *   ④ 接到真调用处上：换邮箱那一问（account.ts）遇上挂住的请求，到点答 network（不是一直挂着）。
 *   ⑤ 源码：src/ 里除了 fetchTimeout.ts，不许再有裸的 fetch(；也不许用 AbortSignal.timeout（Chrome 103）；
 *      helper 里不用 Promise 的 finally（Chrome 63）。
 */
import { readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { build } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'fetch-timeout-'));
const bundle = async (entry, out) => {
  await build({
    entryPoints: [new URL('../' + entry, import.meta.url).pathname],
    bundle: true, format: 'esm', outfile: join(dir, out), logLevel: 'error',
  });
  return import(join(dir, out));
};

/** 假 fetch 这一回怎么答：'hang'（永远不回）、'offline'（断网）、或者一个回包。最后一次收到的 init 记下来。 */
let mode = 'hang';
let lastInit = null;
globalThis.fetch = (url, init) => {
  lastInit = init;
  if (mode === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
  if (mode === 'hang') {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true, status: 200, json: async () => mode, text: async () => '' }), 10));
};

const { fetchWithTimeout, FETCH_TIMEOUT_MS } = await bundle('src/engine/fetchTimeout.ts', 'ft.mjs');
const settle = async (p) => {
  const t0 = Date.now();
  try {
    return { ok: true, value: await p, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, err, ms: Date.now() - t0 };
  }
};

// ── ① 挂住不回：到点放弃 ──────────────────────────────────────
{
  mode = 'hang';
  const r = await settle(fetchWithTimeout('/api/x', { method: 'POST' }, 80));
  check('① 挂住不回的请求，到点就放弃（不是一直等）', !r.ok && r.ms >= 70 && r.ms < 1500, `${r.ms}ms`);
  check('① 抛的是 TypeError（和断网同一类，调用处照接断网那样接）', !r.ok && r.err instanceof TypeError, String(r.err));
  check('① 请求带着 signal，到点那一下真的 abort 了', Boolean(lastInit?.signal) && lastInit.signal.aborted === true);
  check('①（尺子）原来的 init 照旧带过去（method 还在）', lastInit?.method === 'POST');
}

// ── ② 没有 AbortController 的老内核 ───────────────────────────
{
  const saved = globalThis.AbortController;
  delete globalThis.AbortController;
  try {
    mode = 'hang';
    const r = await settle(fetchWithTimeout('/api/x', {}, 80));
    check('② 没有 AbortController：照样到点放弃', !r.ok && r.err instanceof TypeError && r.ms < 1500, `${r.ms}ms ${r.err}`);
    check('② 而且不带 signal（没有那个东西可带）', lastInit && !('signal' in lastInit));
  } finally {
    globalThis.AbortController = saved;
  }
}

// ── ③ 正常回包、断网原样透传；默认 15 秒 ────────────────────────
{
  mode = 'fine';
  const r = await settle(fetchWithTimeout('/api/x', {}, 500));
  check('③ 正常回包原样透传', r.ok && r.value.status === 200 && (await r.value.json()) === 'fine');
  mode = 'offline';
  const o = await settle(fetchWithTimeout('/api/x', {}, 500));
  check('③ 断网的错原样透传（不被换成「超时」）', !o.ok && o.err instanceof TypeError && o.err.message === 'Failed to fetch', String(o.err));
  check('③ 默认等 15 秒', FETCH_TIMEOUT_MS === 15000, String(FETCH_TIMEOUT_MS));
}

// ── ④ 接到真调用处上 ──────────────────────────────────────────
{
  // 真调用处用的是默认的 15 秒。门不等 15 秒：把「15 秒」那一个计时器换成 60 毫秒，别的计时器原样。
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms === FETCH_TIMEOUT_MS ? 60 : ms, ...rest);
  const store = new Map([['slides_genius', JSON.stringify({ active: true, channel: 'code', email: 'stall@example.com', token: 'T' })]]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.window = { location: { protocol: 'https:', hostname: 'play-slides.com', search: '', origin: 'https://play-slides.com', pathname: '/' }, history: { replaceState() {} }, addEventListener() {}, dispatchEvent() {} };
  globalThis.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
  try {
    const acct = await bundle('src/engine/account.ts', 'account.mjs');
    mode = 'hang';
    // 外面再兜一层三秒：改坏了（调用处绕过 helper）的话这一问永远不回，门要红在这儿，不是跟着挂住。
    const stuck = new Promise((_, reject) => realSetTimeout(() => reject(new Error('三秒了还挂着')), 3000));
    const r = await settle(Promise.race([acct.requestEmailChange('stall@example.com', 'T', 'next@example.com', 'zhHans'), stuck]));
    check('④ 换邮箱那一问遇上挂住的请求：到点答 network，不是一直挂着', r.ok && r.value?.reason === 'network' && r.ms < 2000,
      `${r.ms}ms ${JSON.stringify(r.value ?? String(r.err))}`);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

// ── ⑤ 源码 ────────────────────────────────────────────────────
{
  const strip = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  const walk = (d) =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const root = new URL('../src/', import.meta.url).pathname;
  const files = walk(root);
  const bare = [];
  const timeoutApi = [];
  for (const f of files) {
    const code = strip(readFileSync(f, 'utf8'));
    const rel = f.slice(root.length);
    if (rel !== 'engine/fetchTimeout.ts' && /(^|[^\w.])fetch\(/.test(code)) bare.push(rel);
    if (/AbortSignal\.timeout/.test(code)) timeoutApi.push(rel);
  }
  check(`⑤ src/ 里 ${files.length} 个文件，除了 fetchTimeout.ts 没有一处裸的 fetch(`, bare.length === 0, bare.join(' '));
  check('⑤ 没有一处用 AbortSignal.timeout（Chrome 103 才有）', timeoutApi.length === 0, timeoutApi.join(' '));
  const helper = strip(readFileSync(join(root, 'engine/fetchTimeout.ts'), 'utf8'));
  check('⑤ helper 里不用 Promise 的 finally（Chrome 63 才有）', !/\.finally\(/.test(helper));
  check('（尺子）真的扫到了一批文件、helper 里真有 fetch(', files.length > 50 && /fetch\(/.test(helper), `${files.length} 个`);
  // 反向对照：往一个文件里塞一句裸 fetch，⑤ 要抓得到（注释里的不算）。
  const probe = strip("const r = await fetch('/api/x');\n// fetch('/in/a/comment')\n");
  check('（反向对照）一句裸 fetch 抓得到、注释里的不算', /(^|[^\w.])fetch\(/.test(probe) && !/in\/a\/comment/.test(probe));
}

console.log(fail ? `\n${fail} 条红` : '\n全部通过');
process.exit(fail ? 1 : 0);
