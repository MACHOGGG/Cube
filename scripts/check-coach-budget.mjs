/**
 * 教学呼吸灯的时间预算：慢手机上一步走完，灯多久亮（10-14 方案 D-5 第 2 条；10-31 方案推15 Z-C06 建门）。
 *
 *   node scripts/dev-server.mjs 8xxx dist &
 *   node scripts/check-coach-budget.mjs http://localhost:8xxx/
 *
 * 搜索拆成每段 ≤ SLICE_MS（3ms）在空闲时跑，算完才亮（engine/coachHint.ts 的 createSliceRunner）。每一段在性能时间线上标
 * 一笔 `coach-search`（markSlice）——这道门只量这一种任务，棋盘重画、动画不算。从前那几处注释（coachHint.ts、
 * check-coach-aim.mjs）一直说「有 check-coach-budget 量着」，仓库里其实没有这道门（10-31 方案 G13）。
 *
 * 夹具：**不用 unlockAll**（它预设了两张基础卡「打过」，教学条就不出了），只写语言和 slides_cvd_offer（头一局倒数页那颗
 * 色盲开关出过），不预设任何「教学看过」「打过」键（CLAUDE.md 坑四）。新人主菜单上只有小球（主菜单一步一步出现第 1 步），
 * 所以照真流程：先打小球教学局、走到结算 → 回主菜单，方块那张卡出现（第 2 步）→ 再打方块教学局。
 *
 * CDP 把 CPU 降速 6 倍（Emulation.setCPUThrottlingRate）。页面里一开始就挂 PerformanceObserver 收 `coach-search`（buffered；
 * 不能事后 getEntriesByName——每 500 段会被清掉），再挂一个 MutationObserver 记棋盘上「灯从全熄到亮起」的那一刻
 * （performance.now()）。每一步顺着对照给的路走（scripts/lib/coachScreen.mjs，和 check-coach-aim 同一套读屏走子法），按此刻
 * 条子上是哪一条（A–E；五条讲完之后到结算算 E）分开记。
 *
 * 断言（门线是方案定的，6 倍降速下，执行者不许放宽；超了停下回报，不回头改推05 的搜索预算）：
 *   ① 每一段 coach-search 的 duration ≤ 8ms——**只报不判**（站长 11-01，待修）：建门那一跑就过不了（6 倍降速下 800 来段里十来段
 *      超，最长 20ms 上下，中位 3.4ms；三成是某一次搜索的头一段）。门线没动，照量、照打，只是不判红；查清那几段为什么长、
 *      修好之后改回判红（CLAUDE.md《已知例外》那一段）；
 *   ② 每一步：从这一步第一段 coach-search 的 startTime（连锁走完、开始重算）到灯亮的时长，只量灯最后亮了的那些步，按条
 *      分开：A、B、C、E 每一条中位 ≤ 2000ms、最长 ≤ 4000ms；D 只记、不判红（方块 D 的重算本来就贵）。A 必须量到；
 *   ③ 首个局面（倒数结束、牌一发下来，亮的就是 A）：从棋盘出现到第一盏灯算进 A；另单独打印，目标 ≤ 1000ms，只报不判。
 * 量完打出 ① 的最大值、② 每一条的中位 / 90 分位 / 最长、≤ 1000ms 的占几成。
 */
import { chromium } from 'playwright';
import esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initCoachScreen, ORACLE, HINT_OF, ruleOf, model, dragMove, firstStepOf, edgeStepOf } from './lib/coachScreen.mjs';

const BASE = process.argv[2];
if (!BASE) {
  console.log('用法: node scripts/check-coach-budget.mjs <dev-server 地址>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = Number(process.env.BUDGET_STEPS ?? 40);
const THROTTLE = 6;

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const tmp = mkdtempSync(join(tmpdir(), 'slides-coach-budget-'));
for (const [name, entry] of [['i18n', 'i18n.ts'], ['edge', 'engine/outerEdge.ts']]) {
  esbuild.buildSync({ entryPoints: [join(root, 'src', entry)], bundle: true, format: 'esm', platform: 'node', outfile: join(tmp, name + '.mjs'), logLevel: 'silent' });
}
const { tutorialRules } = await import(pathToFileURL(join(tmp, 'i18n.mjs')).href);
const { outerEdges, EDGE_MIN } = await import(pathToFileURL(join(tmp, 'edge.mjs')).href);
rmSync(tmp, { recursive: true, force: true });
initCoachScreen({ outerEdges, EDGE_MIN, tutorialRules });

let seed = 20261031;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  try {
    if (sessionStorage.getItem('cb_primed') !== '1') {
      sessionStorage.setItem('cb_primed', '1');
      localStorage.clear();
    }
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_cvd_offer', '1');
  } catch {
    /* 无痕 */
  }
  const cb = { measures: [], glowOn: [], boardAt: null, lit: 0 };
  window.__cb = cb;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'coach-search') cb.measures.push([e.startTime, e.duration]);
    }).observe({ type: 'measure', buffered: true });
  } catch {
    /* 没有就量不到——下面 ① 的尺子会红 */
  }
  const scan = () => {
    const n = document.querySelectorAll('#boardWrap .coach-glow').length;
    if (n > 0 && cb.lit === 0) cb.glowOn.push(performance.now());
    cb.lit = n;
    if (cb.boardAt === null && !document.querySelector('#startOverlay.show') && document.querySelector('#boardWrap .tile, #boardWrap .ball')) {
      cb.boardAt = performance.now();
    }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#homeGrid [data-card="circle"]', { timeout: 30000 });
check('（尺子）新人主菜单上只有小球那一张（第 1 步）', (await page.$$eval('#homeGrid [data-card]', (els) => els.map((e) => e.dataset.card).join())) === 'circle');
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

/** 每一条的亮灯时长（ms）。 */
const lat = { A: [], B: [], C: [], D: [], E: [] };
const firsts = [];
const barOf = (text, shape) => {
  const i = tutorialRules('zhHans', shape).indexOf(text);
  return i >= 0 ? 'ABCDE'[i] : 'E'; // 五条讲完之后、到结算为止：E 那一种（亮步数少的那一下）
};

async function playCoach(card, shape) {
  await page.evaluate(() => { window.__cb.boardAt = null; });
  const g0 = await page.evaluate(() => window.__cb.glowOn.length);
  await page.$eval(`#homeGrid [data-card="${card}"]`, (e) => e.click());
  await page.waitForFunction(() => window.__cb.boardAt !== null, null, { timeout: 90000 });
  const first = await page.waitForFunction((g) => {
    const cb = window.__cb;
    return cb.glowOn.length > g ? { boardAt: cb.boardAt, glow: cb.glowOn[g], text: document.querySelector('.coach-bar .coach-text')?.textContent ?? '' } : false;
  }, g0, { polling: 200, timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  if (first) {
    const ms = first.glow - first.boardAt;
    firsts.push({ shape, ms, bar: barOf(first.text, shape) });
    lat[barOf(first.text, shape)].push(ms);
  }
  let moved = 0;
  for (let step = 0; step < STEPS; step++) {
    if (await page.$('#endOverlay.show')) break;
    const o = await page.evaluate(ORACLE, { shape });
    const rule = ruleOf(o, shape);
    const kind = rule >= 0 ? HINT_OF[rule] : 'best';
    const litStars = o.at.filter(([, v]) => v.lit).every(([, v]) => v.face === 'dot');
    let mv = kind === 'edge' || (kind === 'best' && litStars) ? edgeStepOf(o, shape) : firstStepOf(o, shape, 'group');
    if (!mv) {
      const m = model(o, shape);
      if (!m.moves.length) break;
      const [line, s] = m.moves[Math.floor(rnd() * m.moves.length)];
      mv = { line, shift: s };
    }
    const t = await page.evaluate(() => performance.now());
    await dragMove(page, o, mv.line, mv.shift);
    moved++;
    // 等：灯亮了（算出这一步第一段搜索到灯亮的时长）；或者这一步搜完了没亮（最后一段之后 2.5 秒还黑着）；或者结算了。
    const r = await page.waitForFunction((t0) => {
      const cb = window.__cb;
      const ms = cb.measures.filter(([s]) => s >= t0);
      const glow = cb.glowOn.find((x) => x >= t0);
      if (glow !== undefined && ms.length && ms[0][0] <= glow) {
        return { kind: 'lit', lat: glow - ms[0][0], text: document.querySelector('.coach-bar .coach-text')?.textContent ?? '' };
      }
      if (document.querySelector('#endOverlay.show')) return { kind: 'over' };
      // 这一步之后根本没搜（方块是第二副，D 开口之前没有条子、也就没有灯）：3 秒没见到一段搜索就走。
      if (!ms.length && performance.now() - t0 > 3000) return { kind: 'idle' };
      if (ms.length && cb.lit === 0) {
        const [s, d] = ms[ms.length - 1];
        if (performance.now() - (s + d) > 2500) return { kind: 'dark' };
      }
      return false;
    }, t, { polling: 250, timeout: 30000 }).then((h) => h.jsonValue()).catch(() => ({ kind: 'timeout' }));
    if (r.kind === 'lit') lat[barOf(r.text, shape)].push(r.lat);
    if (r.kind === 'over') break;
  }
  // 走到结算（主菜单下一步要它）。
  if (!(await page.$('#endOverlay.show'))) {
    await page.$eval('#stopBtn', (e) => e.click());
    await page.waitForSelector('#pauseOverlay.show', { timeout: 15000 });
    await page.$eval('#pauseFinishBtn', (e) => e.click());
    await page.waitForSelector('#endOverlay.show', { timeout: 30000 });
  }
  await page.$eval('#endOverlay.show #endBackBtn', (e) => e.click());
  await page.waitForSelector('.home-page', { timeout: 30000 });
  await page.waitForTimeout(800);
  return moved;
}

const t0 = Date.now();
const movedCircle = await playCoach('circle', 'circle');
const cards = await page.$$eval('#homeGrid [data-card]', (els) => els.map((e) => e.dataset.card));
check('（尺子）小球教学局走到结算之后，方块那张卡出现了（第 2 步）', cards.includes('square'), cards.join());
const movedSquare = cards.includes('square') ? await playCoach('square', 'square') : 0;
const measures = await page.evaluate(() => window.__cb.measures);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await browser.close();

const q = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const f = (x) => (Number.isFinite(x) ? Math.round(x) : '—');
const maxSlice = Math.max(0, ...measures.map(([, d]) => d));
// 每一次搜索的头一段：和上一段隔了 50ms 以上（一次搜索里各段首尾相接，MessageChannel 一让就接着跑）。头一段要把盘面抄一份、
// 建走法表（prepareMoves），最重。
const sorted = [...measures].sort((a, b) => a[0] - b[0]);
const firstOf = sorted.map(([s0], i) => i === 0 || s0 - (sorted[i - 1][0] + sorted[i - 1][1]) > 50);
const over = sorted.filter(([, d]) => d > 8);
const overFirst = sorted.filter(([, d], i) => d > 8 && firstOf[i]).length;
console.log(`\n${THROTTLE} 倍降速：小球走了 ${movedCircle} 步、方块 ${movedSquare} 步，${((Date.now() - t0) / 1000).toFixed(0)} 秒；搜索一共 ${measures.length} 段`);
console.log(`首个局面（棋盘出现 → 第一盏灯）：${firsts.map((x) => `${x.shape} ${f(x.ms)}ms（${x.bar}）`).join('，') || '没量到'}（目标 ≤ 1000ms，只报不判）`);
console.log('条    步数   中位    p90    最长   ≤1000ms');
for (const b of 'ABCDE') {
  const xs = lat[b];
  const fast = xs.length ? `${Math.round((xs.filter((x) => x <= 1000).length / xs.length) * 100)}%` : '—';
  console.log(`${b}   ${String(xs.length).padStart(5)}  ${String(f(median(xs))).padStart(5)}  ${String(f(q(xs, 0.9))).padStart(5)}  ${String(f(Math.max(...xs, -Infinity))).padStart(5)}   ${fast}`);
}
check('（尺子）性能时间线上收到了 coach-search', measures.length > 0, `${measures.length} 段`);
console.log(`① 超过 8ms 的段：${over.length} / ${measures.length}（其中 ${overFirst} 段是某一次搜索的头一段）；最长的几段 ${[...over].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([, d]) => d.toFixed(1)).join(' / ') || '—'} ms；中位 ${median(measures.map(([, d]) => d)).toFixed(2)}ms`);
// 只报不判（站长 11-01）：修好之后把下面这一行换回 check(…, maxSlice <= 8, …)。
console.log(`${maxSlice <= 8 ? 'PASS' : '待修'}  ① 每一段 coach-search ≤ 8ms（${THROTTLE} 倍降速；已知例外，只报不判）  最长 ${maxSlice.toFixed(2)}ms`);
check('② A 量到了（至少一步）', lat.A.length > 0, `${lat.A.length} 步`);
for (const b of 'ABCE') {
  const xs = lat[b];
  if (!xs.length) {
    if (b !== 'A') console.log(`      ${b}：这两局没量到（不判）`);
    continue;
  }
  check(`② ${b}：亮灯时长中位 ≤ 2000ms、最长 ≤ 4000ms`, median(xs) <= 2000 && Math.max(...xs) <= 4000, `中位 ${f(median(xs))} · 最长 ${f(Math.max(...xs))}（${xs.length} 步）`);
}
check('一路没有页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(fails ? `\n${fails} 条没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
