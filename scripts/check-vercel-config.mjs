/**
 * vercel.json：schema 认得的那几样、两个慢接口的时限、全站的五条安全响应头（10-08 方案第五批第 1 条；
 * frame 那两条是 10-09 补充方案第一部分第 7 条）。
 *
 *   node scripts/check-vercel-config.mjs
 *
 * 纯读文件，零点几秒，进得了 CI。
 *
 * 方案原话：「vercel.json：functions 给 api/mint.js、api/scores.js 配 maxDuration（Hobby 档上限 60
 * 秒，玩家已确认是免费档）；安全响应头：X-Content-Type-Options: nosniff、Referrer-Policy、
 * Permissions-Policy 全站加；frame 策略（XFO / frame-ancestors）先确认小红书 WebView/壳的嵌入需求
 * 再定，别一刀切把自己的壳拦了；记住 schema 校验：不写注释、不写不认识的顶层字段。」
 *
 * 这份文件写错了不报在本地：dev-server 不读它，`npm run build` 也不读它，**只有推上去 Vercel 部署
 * 的那一刻才校验**——多一个它不认识的顶层字段（比如想写个 "//comment" 当注释），整份配置作废，部
 * 署直接失败（CLAUDE.md 开头那一条）。而推送就是上线。所以这道门在本地替 Vercel 先挑一遍：
 *
 *   ① 是合法 JSON；顶层字段都是 Vercel 认得的（KNOWN 那张表——真要用一个表里没有的新字段，先查
 *      文档确认它在 schema 里，再加进表）；整份文件里没有一个看着像注释的键；
 *   ② functions 只配了 api/mint.js、api/scores.js 两个，文件都在，maxDuration 是 1–60 的整数
 *      （Hobby 档上限 60；写 61 部署直接失败）；
 *   ③ 全站（source "/(.*)"）那一条带着 nosniff、Referrer-Policy、Permissions-Policy；
 *   ④ Permissions-Policy 关掉的能力，站里一处都没在用——关掉自己在用的东西，屏幕上不报错，只是
 *      那个功能悄悄没了（比如关了 clipboard-write，发码页的《复制》就按不动了）；
 *   ⑤ frame 策略：全站 `X-Frame-Options: SAMEORIGIN` ＋ `Content-Security-Policy: frame-ancestors 'self'`，
 *      而且只在全站那一条里写一次。
 *
 * ⑤ 原先量的是「还**没有**」：第五批的方案说先确认小红书的壳会不会嵌我们再定。10-09 补充方案第一部分
 * 第 7 条确认了——小红书版是 zip 离线跑的，Builder Hub 和 `/xhs/` 预览都不会用 iframe 嵌 play-slides.com
 * ——所以照加。两条一起写：老浏览器只认 X-Frame-Options，新的认 CSP 的 frame-ancestors（两条都在时以
 * 它为准）。CSP 这一条**只写 frame-ancestors 一项**：这一个头里每多写一项（script-src、style-src……）
 * 都会真的去拦东西，而站里有内联脚本、内联样式、Creem 和统计的外链——拦错了屏幕上不报错，只是那
 * 一块悄悄没了。要收紧别的，另开一条、逐项量过再加。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① schema 认得的样子 ────────────────────────────────────────────────────
let cfg = null;
try {
  cfg = JSON.parse(read('vercel.json'));
} catch (err) {
  check('① vercel.json 是合法 JSON', false, String(err.message));
}
if (cfg) check('① vercel.json 是合法 JSON', true);
/** Vercel 项目配置认得的顶层字段（openapi.vercel.sh/vercel.json）。 */
const KNOWN = new Set([
  '$schema', 'buildCommand', 'cleanUrls', 'crons', 'devCommand', 'framework', 'functions', 'git', 'github',
  'headers', 'ignoreCommand', 'images', 'installCommand', 'outputDirectory', 'public', 'redirects', 'regions',
  'functionFailoverRegions', 'rewrites', 'routes', 'trailingSlash', 'env', 'build', 'builds', 'name', 'version',
]);
const top = Object.keys(cfg || {});
const unknown = top.filter((k) => !KNOWN.has(k));
check('① 顶层字段都是 Vercel 认得的', cfg && unknown.length === 0, unknown.length ? `不认得：${unknown.join(' / ')}` : top.join(' '));
const commentKeys = [];
(function walk(v, path) {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (/^(\/\/|#|_|comment)/i.test(k)) commentKeys.push(`${path}.${k}`);
      walk(x, `${path}.${k}`);
    }
  }
})(cfg, '');
check('① 整份文件里没有看着像注释的键（"//…"、"_…"、"comment…"）', commentKeys.length === 0, commentKeys.join(' / '));

// ── ② 两个慢接口的时限 ─────────────────────────────────────────────────────
const fns = cfg?.functions || {};
const fnKeys = Object.keys(fns).sort();
check('② functions 只配了 api/mint.js、api/scores.js', fnKeys.join() === 'api/mint.js,api/scores.js', fnKeys.join(' / ') || '没有');
for (const f of fnKeys) {
  const d = fns[f]?.maxDuration;
  check(`② ${f}：文件在，maxDuration 是 1–60 的整数（Hobby 档上限 60）`, existsSync(join(root, f)) && Number.isInteger(d) && d >= 1 && d <= 60,
    `${existsSync(join(root, f)) ? '在' : '文件不在'} · ${d}`);
}
// 重建榜单的预算得比时限短（api/scores.js 的 REBUILD_BUDGET_MS，第五批第 2 条）
const budget = Number((read('api/scores.js').match(/const REBUILD_BUDGET_MS = ([\d_]+);/) || [])[1]?.replace(/_/g, ''));
check('② 重建榜单一批的时间预算比 scores.js 的时限短，留得出余量', budget > 0 && budget <= (fns['api/scores.js']?.maxDuration ?? 0) * 1000 - 10_000,
  `${budget} ms vs ${fns['api/scores.js']?.maxDuration} s`);

// ── ③ 全站三条安全头 ───────────────────────────────────────────────────────
const all = (cfg?.headers || []).find((h) => h.source === '/(.*)');
const hv = (name) => all?.headers?.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
check('③ 有一条管全站的（source "/(.*)"）', Boolean(all));
check('③ X-Content-Type-Options: nosniff', hv('X-Content-Type-Options') === 'nosniff', String(hv('X-Content-Type-Options')));
check('③ Referrer-Policy: strict-origin-when-cross-origin', hv('Referrer-Policy') === 'strict-origin-when-cross-origin', String(hv('Referrer-Policy')));
const pp = hv('Permissions-Policy') || '';
check('③ Permissions-Policy 写了', pp.length > 0, pp);

// ── ④ 关掉的能力站里没在用 ─────────────────────────────────────────────────
/** 能力 → 站里用它时代码长什么样。 */
const USES = {
  camera: /getUserMedia|mediaDevices/,
  microphone: /getUserMedia|mediaDevices/,
  geolocation: /navigator\.geolocation/,
  payment: /PaymentRequest/,
  'clipboard-write': /navigator\.clipboard/,
  'clipboard-read': /navigator\.clipboard\.read/,
  'web-share': /navigator\.share|navigator\.canShare/,
  fullscreen: /requestFullscreen/,
  'screen-wake-lock': /wakeLock/,
  accelerometer: /DeviceMotion|devicemotion|Accelerometer/,
  gyroscope: /DeviceOrientation|deviceorientation|Gyroscope/,
};
const off = [...pp.matchAll(/([a-z-]+)=\(\)/g)].map((m) => m[1]);
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(root, p)).isDirectory() ? walk(p) : /\.(ts|js|mjs|html)$/.test(f) ? [p] : [];
});
const files = [...walk('src'), ...walk('xhs/src'), 'index.html', ...readdirSync(join(root, 'public')).filter((f) => f.endsWith('.html')).map((f) => `public/${f}`)];
check('④ 尺子：Permissions-Policy 里认出了关掉的那几样，站里的源码也读到了', off.length >= 1 && files.length > 50, `${off.join(' ')} · ${files.length} 个文件`);
const clash = [];
for (const feat of off) {
  const re = USES[feat];
  if (!re) {
    clash.push(`${feat}（这道门不认得它——先在 USES 里写上「站里用它时长什么样」）`);
    continue;
  }
  const users = files.filter((f) => re.test(read(f)));
  if (users.length) clash.push(`${feat} ← ${users.join(', ')}`);
}
check('④ 关掉的能力，站里一处都没在用', clash.length === 0, clash.join(' / '));
// 反向对照：发码页在用剪贴板——要是有人把 clipboard-write 也关了，上面那条认得出来
check('④ 尺子：发码页确实在用剪贴板（关 clipboard-write 会被上面那条拦下）', USES['clipboard-write'].test(read('public/mint.html')));

// ── ⑤ frame 策略：同源才许嵌 ───────────────────────────────────────────────
check('⑤ X-Frame-Options: SAMEORIGIN', hv('X-Frame-Options') === 'SAMEORIGIN', String(hv('X-Frame-Options')));
check("⑤ Content-Security-Policy 只有 frame-ancestors 'self' 一项（多写一项就会真的去拦东西）",
  hv('Content-Security-Policy') === "frame-ancestors 'self'", String(hv('Content-Security-Policy')));
// 只在全站那一条里写一次：别的 source 再写一份，两份不一样的时候浏览器取哪一份说不准。
const frameHeaders = (cfg) => (cfg?.headers || []).flatMap((h) => (h.headers || [])
  .filter((x) => /^x-frame-options$/i.test(x.key) || /^content-security-policy$/i.test(x.key))
  .map((x) => `${h.source} → ${x.key}`));
const frames = frameHeaders(cfg);
check('⑤ 这两条只在全站那一条里各写一次', frames.length === 2 && frames.every((f) => f.startsWith('/(.*) →')), frames.join(' / '));
// 反面尺子：别的 source 里多写一份，上一条认得出来。
check('⑤（反面尺子）另一条 source 里再写一份 X-Frame-Options，上一条会红',
  frameHeaders({ headers: [...cfg.headers, { source: '/xhs/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }] }).length === 3);

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
