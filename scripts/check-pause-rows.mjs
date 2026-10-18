/**
 * 暂停面板的「声音」「振动」两行，和手机横屏矮屏的左右两栏（10-18 补充 M-3；要 dev-server + Chromium）。
 *
 *   node scripts/dev-server.mjs 8937 dist
 *   node scripts/check-pause-rows.mjs http://localhost:8937/
 *
 * 从前局中关不了声音（只有个人主页那一颗；小红书那一版哪儿都关不掉），振动不受任何设置管；暂停面板在手机
 * 横屏、高 ≤560 时一列本来就装不下。这一道量六件事：
 *   1. 手机竖屏：按键按 id 依次是 怎么玩、色盲、Pro、声音、振动、再来一局、结束游戏、继续；行距和改之前一样
 *      （组内 8、组间 20）。
 *   2. 振动那一行只在能振动的设备上有：电脑（鼠标）没有；删掉 navigator.vibrate 的手机（模拟 iPhone）也没有。
 *   3. 声音那一行和个人主页那一颗是同一个设置：在这儿关了，个人主页那颗也是关的；再开一局还是关的。
 *   4. 振动那一行真的管振动：没存过时走一步收到 8；关掉之后再走一步一次都没收到。
 *   5. 手机横屏四种尺寸 × 四语 × 局中 / 倒数页借面板两种：开关一栏在标题左边，三颗键在标题下面，三块两两
 *      不相交，《继续》和左栏最后一颗开关都整颗在首屏内（不用滚）。
 *   6. 小红书预览页：按键依次是 怎么玩、色盲、声音、振动、再来一局、结束游戏、继续（没有 Pro）；横屏
 *      640×360 两栏照第 5 条量一遍。
 *
 * 第 5 条要是哪一档出了首屏，方案原话是「停下回报，不要自己缩字或改间距」——这一道照实报红。
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { ensurePreview } from '../xhs/ensurePreview.mjs';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-pause-rows.mjs http://localhost:8937/');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const crosses = (a, b) => Boolean(a && b) && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right - 0.5 && b.left < a.right - 0.5;
const r0 = (b) => (b ? `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}×${Math.round(b.height)}` : '没有');

const PRESET = {
  slides_intro_seen: '1', slides_cvd_offer: '1',
  slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
  slides_played_square: '1', slides_played_circle: '1', slides_played_finished: '1',
  slides_played_bomb: '1', slides_played_slot: '1', slides_played_flip: '1', slides_played_puzzle: '1',
  slides_played_timed: '1', slides_played_layout: '1', slides_played_totaltip: '1',
};

/**
 * 一台设备。`noVibrate`：删掉 navigator.vibrate（iPhone 上就没有这个接口）。`stub`：换成记账的桩，每振一下
 * 记进 window.__vib。
 */
async function device({ w = 390, h = 844, mobile = true, lang = 'zhHans', noVibrate = false, stub = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(([l, kv]) => {
    if (sessionStorage.getItem('pause_gate') === '1') return;
    sessionStorage.setItem('pause_gate', '1');
    localStorage.setItem('slides_lang', l);
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, [lang, PRESET]);
  if (noVibrate) {
    await ctx.addInitScript(() => {
      try { delete Navigator.prototype.vibrate; } catch {}
      try { delete navigator.vibrate; } catch {}
    });
  }
  if (stub) {
    await ctx.addInitScript(() => {
      window.__vib = [];
      try { navigator.vibrate = (p) => (window.__vib.push(p), true); } catch {}
    });
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await home(p);
  return { ctx, p };
}
async function home(p) {
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await p.waitForTimeout(300);
}
/** 开方块，倒数不等，直接按下那颗藏起来的开局键（和 xhs/check-story 同一个做法），再按暂停。 */
async function pauseInGame(p) {
  await p.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 20000 });
  await p.waitForTimeout(500);
  await p.click('#stopBtn');
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.waitForTimeout(250);
}
/** 开方块，倒数时按倒数页那颗《暂停》：借的是同一块面板（.pause--pre）。 */
async function pauseInCount(p) {
  await p.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
  await p.waitForSelector('#startOverlay.show #startPauseBtn', { timeout: 15000 });
  await p.waitForTimeout(250);
  await p.click('#startPauseBtn');
  await p.waitForSelector('#pauseOverlay.show.pause--pre', { timeout: 8000 });
  await p.waitForTimeout(250);
}
const ids = (p) => p.$$eval('#pauseOverlay .modal button', (e) => e.map((b) => b.id));
/** 面板上那几行之间的竖向间距（只数露出来的行）。 */
const rowGaps = (p) => p.evaluate(() => {
  const rows = [...document.querySelectorAll('#pauseOverlay .modal .btn-row')].filter((r) => r.getBoundingClientRect().height > 0);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    out.push(Math.round(rows[i].getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().bottom));
  }
  return out;
});
/** 横屏两栏那几块的位置。 */
const LAYOUT = () => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
  };
  const set = document.querySelector('#pauseOverlay .pause-set');
  const switches = [...set.querySelectorAll('.btn-row')].filter((e) => e.getBoundingClientRect().height > 0);
  return {
    title: r(document.querySelector('#pauseOverlay .modal > h2')),
    set: r(set),
    go: r(document.querySelector('#pauseOverlay .pause-go')),
    lastSwitch: r(switches[switches.length - 1]),
    cont: r(document.querySelector('#continueBtn')),
    note: (() => { const n = document.querySelector('#proNote'); return !!n && !n.hidden && n.getBoundingClientRect().height > 0; })(),
    vh: innerHeight,
    vw: innerWidth,
  };
};
const inView = (b, vw, vh) => !!b && b.top >= -0.5 && b.left >= -0.5 && b.bottom <= vh + 0.5 && b.right <= vw + 0.5;

// ── 1. 手机竖屏：按键次序、行距 ─────────────────────────────────────────────────────
for (const [w, h] of [[390, 844], [320, 568]]) {
  const { ctx, p } = await device({ w, h });
  await pauseInGame(p);
  const got = await ids(p);
  const want = ['howBtn', 'cvdBtn', 'proBtn', 'soundBtn', 'vibrateBtn', 'pauseRestartBtn', 'pauseFinishBtn', 'continueBtn'];
  check(`${w}×${h} 手机竖屏：按键依次是 怎么玩、色盲、Pro、声音、振动、再来一局、结束游戏、继续`,
    JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const gaps = await rowGaps(p);
  // 开关那一组 5 行（行间 8），再是两颗出口（20），最后《继续》（20）。
  const wantGaps = [8, 8, 8, 8, 20, 20];
  check(`${w}×${h} 手机竖屏：行距和改之前一样（组内 8、组间 20）`, JSON.stringify(gaps) === JSON.stringify(wantGaps), JSON.stringify(gaps));
  await ctx.close();
}

// ── 2. 振动那一行只在能振动的设备上有 ─────────────────────────────────────────────────
{
  const { ctx, p } = await device({ w: 1280, h: 860, mobile: false });
  await pauseInGame(p);
  const got = await ids(p);
  check('电脑（鼠标）：没有振动那一行，声音那一行在', !got.includes('vibrateBtn') && got.includes('soundBtn'), JSON.stringify(got));
  await ctx.close();
}
{
  const { ctx, p } = await device({ noVibrate: true });
  await pauseInGame(p);
  const got = await ids(p);
  const api = await p.evaluate(() => typeof navigator.vibrate);
  check('手机但没有 navigator.vibrate（iPhone）：没有振动那一行', api === 'undefined' && !got.includes('vibrateBtn') && got.includes('soundBtn'),
    `navigator.vibrate 是 ${api} · ${JSON.stringify(got)}`);
  await ctx.close();
}

// ── 3. 声音：这儿关了，个人主页那颗也是关的；再开一局还是关的 ───────────────────────────
{
  const { ctx, p } = await device();
  await pauseInGame(p);
  const before = await p.$eval('#soundBtn', (e) => e.getAttribute('aria-checked'));
  await p.click('#soundBtn');
  await p.waitForTimeout(100);
  const after = await p.evaluate(() => ({
    stored: localStorage.getItem('slides_sound'),
    checked: document.querySelector('#soundBtn')?.getAttribute('aria-checked'),
  }));
  check('声音那一行：本来开着；按一下 slides_sound 变 "0"、aria-checked="false"',
    before === 'true' && after.stored === '0' && after.checked === 'false', JSON.stringify({ before, ...after }));
  await home(p);
  await p.click('#navProfile');
  await p.waitForSelector('#soundRow', { timeout: 10000 });
  const row = await p.$eval('#soundRow', (e) => e.getAttribute('aria-checked'));
  check('退出这一局去个人主页：#soundRow 也是关的', row === 'false', String(row));
  await home(p);
  await pauseInGame(p);
  const again = await p.$eval('#soundBtn', (e) => e.getAttribute('aria-checked'));
  check('再开一局：暂停面板那一行还是关的', again === 'false', String(again));
  await ctx.close();
}

// ── 4. 振动那一行真的管振动 ─────────────────────────────────────────────────────────
// 电脑、鼠标操作（和 check-smooth-touch 同一套桩）：vibrate() 不按设备拦，只看这个设置。
{
  const { ctx, p } = await device({ w: 1280, h: 860, mobile: false, stub: true });
  await p.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 20000 });
  await p.waitForTimeout(600);
  /** 拖一手：从某一枚往旁边拖一格多一点。落下了（收到 8）就停，最多换六枚。 */
  const step = async () => {
    const tiles = await p.$$eval('#boardWrap .tile', (els) => els.map((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, d: b.width };
    }).filter((t) => t.d > 0));
    const v0 = await p.evaluate(() => window.__vib.length);
    for (let t = 0; t < 6; t++) {
      const from = tiles[(t * 5) % tiles.length];
      const [dx, dy] = t % 2 ? [0, from.d * 1.15] : [from.d * 1.15, 0];
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await p.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
        await p.waitForTimeout(16);
      }
      await p.mouse.up();
      await p.waitForTimeout(900);
      const v = await p.evaluate((k) => window.__vib.slice(k), v0);
      if (v.includes(8)) return v;
    }
    return p.evaluate((k) => window.__vib.slice(k), v0);
  };
  const first = await step();
  check('振动没存过（当开着）：走一步，桩收到 8', first.includes(8), JSON.stringify(first));
  await p.click('#stopBtn');
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  // 电脑上那一行不渲染（canVibrate 是 false）——设置本身仍然管着 vibrate()。从这台设备拨不到它，就照它存的
  // 那一把键写进去、刷新这一局，等于在手机上按了那一行。
  await p.evaluate(() => localStorage.setItem('slides_vibrate', '0'));
  await home(p);
  await p.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 20000 });
  await p.waitForTimeout(600);
  const second = await step();
  check('关掉之后再走一步：桩一次都没收到', second.length === 0, JSON.stringify(second));
  await ctx.close();
}
// 手机上真按那一行：aria-checked 跟着变、存下 "0"。
{
  const { ctx, p } = await device({ stub: true });
  await pauseInGame(p);
  const before = await p.$eval('#vibrateBtn', (e) => e.getAttribute('aria-checked'));
  await p.click('#vibrateBtn');
  await p.waitForTimeout(100);
  const after = await p.evaluate(() => ({
    stored: localStorage.getItem('slides_vibrate'),
    checked: document.querySelector('#vibrateBtn')?.getAttribute('aria-checked'),
  }));
  check('手机上按振动那一行：本来开着；按一下 slides_vibrate === "0"、aria-checked="false"',
    before === 'true' && after.stored === '0' && after.checked === 'false', JSON.stringify({ before, ...after }));
  await ctx.close();
}

// ── 5. 手机横屏矮屏：左右两栏 ─────────────────────────────────────────────────────────
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
for (const [w, h, vib] of [[568, 320, false], [640, 360, true], [667, 375, true], [844, 390, true]]) {
  for (const lang of LANGS) {
    for (const mode of ['局中', '倒数页']) {
      const tag = `${w}×${h} ${lang} ${mode}`;
      const { ctx, p } = await device({ w, h, lang, noVibrate: !vib });
      if (mode === '局中') await pauseInGame(p);
      else await pauseInCount(p);
      const m = await p.evaluate(LAYOUT);
      const got = await ids(p);
      await ctx.close();
      if (lang === 'zhHans') {
        check(`${tag}：（尺子）${vib ? '有' : '没有'}振动那一行${mode === '局中' ? '，Pro 那一行露着说明' : ''}`,
          got.includes('vibrateBtn') === vib && (mode !== '局中' || m.note), `${JSON.stringify(got)} · 说明 ${m.note}`);
      }
      const cols = !!m.set && !!m.title && !!m.go && m.set.right <= m.title.left + 0.5 && m.go.top >= m.title.bottom - 0.5 &&
        !crosses(m.set, m.title) && !crosses(m.set, m.go) && !crosses(m.title, m.go);
      check(`${tag}：开关一栏在标题左边、三颗键在标题下面，三块不相交`, cols,
        `开关 ${r0(m.set)} · 标题 ${r0(m.title)} · 键 ${r0(m.go)}`);
      check(`${tag}：《继续》和左栏最后一颗开关都整颗在首屏内`, inView(m.cont, m.vw, m.vh) && inView(m.lastSwitch, m.vw, m.vh),
        `继续 ${r0(m.cont)} · 最后一颗开关 ${r0(m.lastSwitch)} / 屏高 ${m.vh}`);
    }
  }
}

// ── 6. 小红书预览页 ───────────────────────────────────────────────────────────────────
{
  await ensurePreview();
  const PAGE = pathToFileURL(join(here, '..', 'xhs', 'preview.html')).href;
  for (const [w, h] of [[390, 844], [640, 360]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    // 头一回打开直接落进那局小球（xhs/src/main.ts 的 firstScreen），棋盘上就有那颗暂停。
    await p.goto(PAGE);
    await p.waitForFunction(() => document.querySelectorAll('#boardWrap .ball').length > 0, { timeout: 30000 });
    await p.waitForTimeout(600);
    await p.click('#stopBtn');
    await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
    await p.waitForTimeout(250);
    const got = await ids(p);
    if (w < h) {
      const want = ['howBtn', 'cvdBtn', 'soundBtn', 'vibrateBtn', 'pauseRestartBtn', 'pauseFinishBtn', 'continueBtn'];
      check('小红书：按键依次是 怎么玩、色盲、声音、振动、再来一局、结束游戏、继续（没有 Pro）',
        JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
    } else {
      const m = await p.evaluate(LAYOUT);
      const cols = !!m.set && !!m.title && !!m.go && m.set.right <= m.title.left + 0.5 && m.go.top >= m.title.bottom - 0.5 &&
        !crosses(m.set, m.title) && !crosses(m.set, m.go) && !crosses(m.title, m.go);
      check(`小红书 ${w}×${h}：开关一栏在标题左边、三颗键在标题下面，三块不相交`, cols,
        `开关 ${r0(m.set)} · 标题 ${r0(m.title)} · 键 ${r0(m.go)}`);
      check(`小红书 ${w}×${h}：《继续》和左栏最后一颗开关都整颗在首屏内`, inView(m.cont, m.vw, m.vh) && inView(m.lastSwitch, m.vw, m.vh),
        `继续 ${r0(m.cont)} · 最后一颗开关 ${r0(m.lastSwitch)} / 屏高 ${m.vh}`);
    }
    await ctx.close();
  }
}

check('页面没有报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
