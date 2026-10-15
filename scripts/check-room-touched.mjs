/**
 * 小屋「有人动过」的续命：每台设备每分钟最多带一次（10-15 补充 S4，L-2 ⑥）。
 *
 *   node scripts/check-room-touched.mjs
 *
 * 纯 node：esbuild 打包 src/engine/room.ts，给一个假的 window（能派 pointerdown）、假的 fetch（记下每一次轮询带没带
 * touched）、可拨的 performance.now。
 *
 * 为什么要它：engine/room.ts 原先整页 pointerdown / keydown 都把 touched 置真，下一次轮询就带上——局中每一次拖动都是
 * pointerdown，于是每一拍轮询都带，服务器每拍多跑 EXPIRE + SET 两条命令（api/room.js 的 keepAlive），21 人屋一小时
 * 约七万条。小屋 TTL 二十分钟，一分钟续一次足够。
 *
 * 量的是：模块刚加载、一下都不点，120 次轮询一次都不带；然后连续 120 次「派一次 pointerdown → fetchState() → 钟走
 * 1 秒」，touched: true 恰好出现 2 次（第 1 拍、第 61 拍）。撤掉节流，后一条红（120 次全带）。
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const dir = mkdtempSync(join(tmpdir(), 'room-touched-'));
const out = join(dir, 'room.mjs');
await build({
  entryPoints: [join(ROOT, 'src/engine/room.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: out,
  logLevel: 'silent',
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_GA_ID': '""' },
});

// ── 假的那一圈：window 能派事件、本机存储、可拨的单调钟、记账的 fetch ─────────────────────
const listeners = new Map();
const win = {
  addEventListener: (t, fn) => (listeners.get(t) ?? listeners.set(t, []).get(t)).push(fn),
  removeEventListener: (t, fn) => listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn)),
  dispatch: (t) => (listeners.get(t) ?? []).forEach((fn) => fn({ type: t })),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: () => 0,
  clearInterval: () => {},
  location: { href: 'http://localhost/', origin: 'http://localhost' },
  navigator: { sendBeacon: () => true, onLine: true, userAgent: 'node' },
};
const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
let clock = 1_000_000;
const sent = [];
Object.assign(globalThis, {
  window: win,
  document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', documentElement: { setAttribute() {}, removeAttribute() {} } },
  // session 由模块加载时的 loadSeat() 从 localStorage 读出来，所以**在 import 之前**写进去
  localStorage: store({ slides_mp_seat: JSON.stringify({ code: '1234', playerId: 'p1', playerToken: 't1', at: Date.now() }) }),
  sessionStorage: store(),
  fetch: async (_url, init) => {
    const body = JSON.parse(init?.body || '{}');
    if (body.action === 'state') sent.push(Boolean(body.touched));
    return { ok: true, status: 200, json: async () => ({ code: '1234', players: [], serverNow: Date.now() }) };
  },
});
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true, writable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });

const R = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
check('（尺子）本机座位读进来了（currentRoom 有）', !!R.currentRoom?.());

// 先量「一下都不点」：模块刚加载、谁都没碰过页面，120 次轮询一次都不带。
for (let i = 0; i < 120; i++) {
  await R.fetchState();
  clock += 1000;
}
check('一下都不点：一次都不带', sent.length === 120 && sent.every((t) => !t), `${sent.filter(Boolean).length} 次`);

// 再量「每一拍都点着」：120 次「派一次 pointerdown → 轮询 → 钟走 1 秒」。
sent.length = 0;
for (let i = 0; i < 120; i++) {
  win.dispatch('pointerdown');
  await R.fetchState();
  clock += 1000;
}
const carried = sent.map((t, i) => (t ? i + 1 : 0)).filter(Boolean);
check('（尺子）120 次轮询都发出去了', sent.length === 120, String(sent.length));
check('每一拍都点着：touched 只在第 1 拍和第 61 拍带出去（一分钟最多一次）', carried.length === 2 && carried[0] === 1 && carried[1] === 61, carried.join(','));

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
