/**
 * 教学呼吸灯跟得上盘面：改窗口、开关色盲、拖一下放回去、方块整行合拢、小球放大之后，亮着的那几枚还是对的（10-14 方案 D-5；
 * 10-31 方案推15 Z-C06 建门）。
 *
 *   node scripts/dev-server.mjs 8xxx dist &
 *   node scripts/check-coach-sync.mjs http://localhost:8xxx/
 *
 * 灯的状态只有一份（engine/coachHint.ts 的 CoachGlowState），棋盘每次重画按它「重挂」、不重算。所以这几件事里，不动盘面的
 * （改窗口、色盲、拖了又放回原处）之后亮的那几枚必须和之前一模一样；动了盘面的（整行合拢、放大）之后重算，亮的那几枚要合
 * 规矩——同一色、A / B / C 是那 N 枚（至少一枚色块），D 是那一色在场的全部星星、一枚色块都不亮，E 判成外边时同 D、判成
 * 图案时同 B。只读屏幕（位置、data-face、颜色，和 check-coach-aim 同一套，scripts/lib/coachScreen.mjs）：**不读 data-id、
 * 不问游戏状态**，正式包里没有开发接口。连锁演着时灯是熄的（现行设计），读屏等连锁走完、灯重新挂上再读。
 *
 * 色盲开着时颜色读的是 backgroundColor（纹理在 background-image 上，engine/cvdTexture.ts），不截图取像素；开 / 关两次读出来
 * 的**同色分组**必须相同（颜色值本来就换了一套）。原先方案里的「切 Pro」删掉了：局中那颗开关是锁着的（10-15 K-4）。
 *
 * 夹具同 check-coach-budget：不用 unlockAll，只写语言和 slides_cvd_offer；新人先打小球教学局、走到结算，方块那张卡出现了
 * 再打方块教学局（方块是第二副基础棋盘，只讲 D：场上星星够了才开口）。
 */
import { chromium } from 'playwright';
import esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initCoachScreen, HINT_OF, ruleOf, litOf, nameOf, model, shift, clearing, colorOf, faceOf, dragMove, settle, waitLit, firstStepOf, edgeStepOf } from './lib/coachScreen.mjs';

const BASE = process.argv[2];
if (!BASE) {
  console.log('用法: node scripts/check-coach-sync.mjs <dev-server 地址>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const tmp = mkdtempSync(join(tmpdir(), 'slides-coach-sync-'));
for (const [name, entry] of [['i18n', 'i18n.ts'], ['edge', 'engine/outerEdge.ts']]) {
  esbuild.buildSync({ entryPoints: [join(root, 'src', entry)], bundle: true, format: 'esm', platform: 'node', outfile: join(tmp, name + '.mjs'), logLevel: 'silent' });
}
const { tutorialRules } = await import(pathToFileURL(join(tmp, 'i18n.mjs')).href);
const { outerEdges, EDGE_MIN } = await import(pathToFileURL(join(tmp, 'edge.mjs')).href);
rmSync(tmp, { recursive: true, force: true });
initCoachScreen({ outerEdges, EDGE_MIN, tutorialRules });

let seed = 1031;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  try {
    if (sessionStorage.getItem('cs_primed') !== '1') {
      sessionStorage.setItem('cs_primed', '1');
      localStorage.clear();
    }
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_cvd_offer', '1');
  } catch {
    /* 无痕 */
  }
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#homeGrid [data-card="circle"]', { timeout: 30000 });

const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** 同色分组（颜色值换成「第几种颜色」，按格子的先后编号）：色盲开关前后颜色值换了一套，分组不许变。 */
const partition = (o) => {
  const ids = new Map();
  return o.at.slice().sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => {
    const key = v.face + ':' + v.color;
    if (!ids.has(key)) ids.set(key, ids.size);
    return `${k}=${v.face[0]}${ids.get(key)}`;
  }).join(' ');
};
/** 亮着的那几枚合不合规矩（见文件头）。回问题清单；不亮回 null（这一副没解，不判）。 */
function rulesOf(o, shape) {
  const lit = litOf(o);
  if (!lit.length) return null;
  const at = new Map(o.at);
  const rule = ruleOf(o, shape);
  const kind = rule >= 0 ? HINT_OF[rule] : 'best';
  const colors = [...new Set(lit.map((k) => at.get(k).color))];
  const bad = [];
  if (colors.length !== 1) bad.push(`亮了 ${colors.length} 种颜色`);
  const allStars = lit.every((k) => at.get(k).face === 'dot');
  const edgeLike = kind === 'edge' || (kind === 'best' && allStars && lit.length !== o.n);
  if (edgeLike) {
    const stars = o.at.filter(([, v]) => v.face === 'dot' && v.color === colors[0]).map(([k]) => k).sort();
    if (!allStars) bad.push('外边那一种亮了色块');
    if (lit.join(' ') !== stars.join(' ')) bad.push(`没亮全那一色的星星（亮 ${lit.length}、在场 ${stars.length}）`);
  } else {
    if (lit.length !== o.n) bad.push(`亮了 ${lit.length} 枚，图案是 ${o.n} 枚`);
    if (!lit.some((k) => at.get(k).face === 'flavor')) bad.push('一枚色块都没有');
  }
  return { bad, rule: nameOf(rule), n: lit.length };
}
async function readLit(shape) {
  let o = await settle(page, shape);
  o = await waitLit(page, shape, o);
  return o;
}
async function pauseToggleCvd() {
  await page.$eval('#stopBtn', (e) => e.click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.$eval('#cvdBtn', (e) => e.click());
  await page.$eval('#continueBtn', (e) => e.click());
  await page.waitForFunction(() => !document.querySelector('#pauseOverlay.show'), null, { timeout: 8000 });
  await frame();
}
/** 拖一下再放回原处：按在一条线的头一枚上，沿线拖出去一格、再拖回来、松手（这一下不算一步，盘面不动）。 */
async function dragBack(o) {
  const at = new Map(o.at);
  const line = o.slide.find((l) => l.length >= 3) ?? o.slide[0];
  const p0 = at.get(line[0]);
  const p1 = at.get(line[1]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(p0.x + ((p1.x - p0.x) * k) / 8, p0.y + ((p1.y - p0.y) * k) / 8);
  for (let k = 7; k >= 0; k--) await page.mouse.move(p0.x + ((p1.x - p0.x) * k) / 8, p0.y + ((p1.y - p0.y) * k) / 8);
  await page.mouse.up();
  await frame();
}
/** 不动盘面的一件事之前、之后各读一次：亮的那几枚、同色分组一模一样。 */
async function same(name, shape, act, { byPartition = false } = {}) {
  const a = await readLit(shape);
  await act(a);
  const b = await readLit(shape);
  const la = litOf(a).join(' ');
  const lb = litOf(b).join(' ');
  check(`${name}：亮的那几枚一模一样`, la === lb && la.length > 0, `前 [${la}] 后 [${lb}]`);
  if (byPartition) check(`${name}：同色分组一模一样（颜色值换了一套，分组不许变）`, partition(a) === partition(b));
  else {
    const at = new Map(a.at);
    const bt = new Map(b.at);
    const ca = [...new Set(litOf(a).map((k) => at.get(k).color))].join();
    const cb = [...new Set(litOf(b).map((k) => bt.get(k).color))].join();
    check(`${name}：还是同一色`, ca === cb, `${ca} → ${cb}`);
  }
  const r = rulesOf(b, shape);
  check(`${name}：亮的那几枚合规矩（${r?.rule ?? '—'}）`, !!r && r.bad.length === 0, r ? r.bad.join('；') : '没亮');
  return b;
}
/**
 * 对照算不到底时的退路（方块的外边是整行整列、6 格，对照在 OR_CAP 里常常搜不完）：一步贪心——这一步就能消掉一条外边的
 * 先挑；不然挑让「最接近填满的那条边」更近一格的（只看星星够填那条边的颜色）。只是给门挑步子，不当答案用。
 */
function greedyEdge(o, shape) {
  const m = model(o, shape);
  const S = m.keys.map((_, i) => i);
  const stars = new Map();
  for (const p of m.P) if (p.face === 'dot') stars.set(p.color, (stars.get(p.color) ?? 0) + 1);
  const need = (T) => {
    let best = Infinity;
    for (const [k, n] of stars) {
      for (const e of m.edges) {
        if (!e.length || e.length > n) continue;
        let cnt = 0;
        for (const c of e) if (faceOf(m, T, c) === 'dot' && colorOf(m, T, c) === k) cnt++;
        best = Math.min(best, e.length - cnt);
      }
    }
    return best;
  };
  const h0 = need(S);
  if (!Number.isFinite(h0)) return null;
  let closer = null;
  for (const [li, sh] of m.moves) {
    shift(m, S, li, sh);
    const clears = clearing(m, S).length > 0;
    const h = need(S);
    shift(m, S, li, m.slide[li].length - sh);
    if (clears) return { line: li, shift: sh };
    if (!closer && h < h0) closer = { line: li, shift: sh };
  }
  return closer;
}
/** 顺着对照走一步（外边优先：放大、整行合拢都要消外边）；对照没有就一步贪心，再没有就随手滑。 */
async function stepToward(o, shape) {
  let mv = edgeStepOf(o, shape) ?? greedyEdge(o, shape) ?? firstStepOf(o, shape, 'group');
  if (!mv) {
    const m = model(o, shape);
    if (!m.moves.length) return false;
    const [line, s] = m.moves[Math.floor(rnd() * m.moves.length)];
    mv = { line, shift: s };
  }
  await dragMove(page, o, mv.line, mv.shift);
  return true;
}
const sizeOf = (shape) => page.evaluate((sh) => {
  const els = [...document.querySelectorAll(sh === 'circle' ? '#boardWrap .ball[data-r]' : '#boardWrap .tile[data-r]')].filter((e) => e.dataset.face !== 'blank');
  const rows = new Set(els.map((e) => e.dataset.r)).size;
  const cols = new Set(els.map((e) => e.dataset.c)).size;
  const w = els[0]?.getBoundingClientRect().width ?? 0;
  return { rows, cols, w: Math.round(w * 10) / 10 };
}, shape);

// ── 小球教学局 ─────────────────────────────────────────────────────────────
await page.$eval('#homeGrid [data-card="circle"]', (e) => e.click());
await page.waitForFunction(() => !document.querySelector('#startOverlay.show') && document.querySelector('#boardWrap .ball'), null, { timeout: 60000 });
let o = await readLit('circle');
check('（尺子）小球教学局一开局就亮着（A）', litOf(o).length > 0 && ruleOf(o, 'circle') === 0, `${nameOf(ruleOf(o, 'circle'))} 亮 ${litOf(o).length} 枚`);
await same('小球 · 窗口 390×844 → 1280×800', 'circle', async () => { await page.setViewportSize({ width: 1280, height: 800 }); await frame(); });
await same('小球 · 窗口 1280×800 → 390×844', 'circle', async () => { await page.setViewportSize({ width: 390, height: 844 }); await frame(); });
await same('小球 · 开色盲', 'circle', () => pauseToggleCvd(), { byPartition: true });
await same('小球 · 关色盲', 'circle', () => pauseToggleCvd(), { byPartition: true });
await same('小球 · 拖一下再放回原处', 'circle', (a) => dragBack(a));
// 顺着外边走，走到「消掉外边之后整体放大」那一步（棋子变大）。
let zoomed = false;
let s0 = await sizeOf('circle');
for (let step = 0; step < 80 && !zoomed; step++) {
  if (await page.$('#endOverlay.show')) break;
  o = await readLit('circle');
  if (!(await stepToward(o, 'circle'))) break;
  o = await readLit('circle');
  const s1 = await sizeOf('circle');
  if (s1.w > s0.w + 0.5) {
    zoomed = true;
    const r = rulesOf(o, 'circle');
    check(`小球 · 消外边之后整体放大（棋子 ${s0.w} → ${s1.w}px）：亮的那几枚合规矩（${r?.rule ?? '—'}）`, !r || r.bad.length === 0, r ? r.bad.join('；') || `亮 ${r.n} 枚` : '这一副没亮（没解，不判）');
  }
  s0 = s1;
}
check('（尺子）小球教学局里走到了放大那一步', zoomed);
// 走到结算 → 主菜单（方块那张卡出来）。
if (!(await page.$('#endOverlay.show'))) {
  await page.$eval('#stopBtn', (e) => e.click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.$eval('#pauseFinishBtn', (e) => e.click());
  await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
}
await page.$eval('#endOverlay.show #endBackBtn', (e) => e.click());
await page.waitForSelector('#homeGrid [data-card="square"]', { timeout: 15000 });

// ── 方块教学局（第二副：只讲 D）──────────────────────────────────────────────
await page.$eval('#homeGrid [data-card="square"]', (e) => e.click());
await page.waitForFunction(() => !document.querySelector('#startOverlay.show') && document.querySelector('#boardWrap .tile'), null, { timeout: 60000 });
let collapsed = false;
let litSeen = false;
let d0 = await sizeOf('square');
let squareSteps = 0;
let squareOver = false;
for (let step = 0; step < 250 && !collapsed; step++) {
  squareSteps = step;
  if (await page.$('#endOverlay.show')) {
    squareOver = true;
    break;
  }
  o = await readLit('square');
  if (litOf(o).length && !litSeen) {
    litSeen = true;
    await same('方块 · 拖一下再放回原处', 'square', (a) => dragBack(a));
    await same('方块 · 开色盲', 'square', () => pauseToggleCvd(), { byPartition: true });
    await same('方块 · 关色盲', 'square', () => pauseToggleCvd(), { byPartition: true });
    o = await readLit('square');
  }
  if (!(await stepToward(o, 'square'))) break;
  o = await readLit('square');
  const d1 = await sizeOf('square');
  if (d1.rows < d0.rows || d1.cols < d0.cols) {
    collapsed = true;
    const r = rulesOf(o, 'square');
    check(`方块 · 整行合拢（${d0.rows}×${d0.cols} → ${d1.rows}×${d1.cols}）：亮的那几枚合规矩（${r?.rule ?? '—'}）`, !r || r.bad.length === 0, r ? r.bad.join('；') || `亮 ${r.n} 枚` : '这一副没亮（没解，不判）');
  }
  d0 = d1;
}
check('（尺子）方块教学局里亮过灯（D 开口了）', litSeen);
const starMax = Math.max(0, ...Object.values((o?.at ?? []).filter(([, v]) => v.face === 'dot').reduce((acc, [, v]) => ({ ...acc, [v.color]: (acc[v.color] ?? 0) + 1 }), {})));
check('（尺子）方块教学局里走到了整行合拢那一步', collapsed, collapsed ? '' : `走了 ${squareSteps} 步${squareOver ? '、这一局已经结束' : ''}，同色星星最多 ${starMax} 颗、盘面 ${d0.rows}×${d0.cols}`);
check('一路没有页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(fails ? `\n${fails} 条没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
