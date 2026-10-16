/**
 * 《Pro》在真界面上（10-15 补充 S10：K-4）：固定翻色真的照那一圈翻、只在单人局、开局那一刻定；轮盘摆得下、不碰东西。
 *
 *   node scripts/dev-server.mjs 8980 dist
 *   node scripts/check-pro-wheel.mjs http://localhost:8980/ --part=core     # ①③④⑤⑥⑦⑧（CI e 片）
 *   node scripts/check-pro-wheel.mjs http://localhost:8972/ --part=layout   # ⑥⑨⑩（CI c 片）
 *   （不给 --part 就两半都跑。core 要开小屋，小屋有限速——一半一台新服务器。）
 *
 * 源码那一半（发牌那一行一个字不动、改写不取随机数、只有单人入口给 proAllowed）由 check-pro.mjs 守着，
 * 「Pro 局正面、取数个数和 Pro 关一样，每一枚反面 = 下一色」由 check-seed-golden ⑧ 在 node 里逐枚量。这一道量的是
 * 摆到真 DOM 上才看得出的那几件：
 *   ① 对应关系：开着 Pro 开经典小球，走一手得分，每一枚新翻成星星的反面 = 图例里的下一色。用小球不用方块（方案写的
 *     是方块）：随手发的 6×6 方块很少有「滑一格就凑出 1×4」的一手，实测连开六局一手都找不到；小球四色、凑三个，
 *     头一局就有。对应关系六副是同一个函数（engine/proCycle.ts），check-seed-golden ⑧ 在 node 里六副逐枚量过。
 *   ③ 尺子：Pro 关着同样走一手，翻出来的星星**不全是**下一色（不然 ① 什么也没量）。
 *   ④ 只在单人局：开着 Pro，每日挑战、输代号、小屋（两个上下文）都没有 data-pro-run、轮盘藏着；结束之后本机存档里
 *     那一局没有 pro；暂停面板写的是「每日挑战、代号局和小屋局不用 Pro」。
 *   ⑤ 非 Pro 发牌逐枚不变：Math.random 换成同一条序列，Pro 开 / 关开局的正面逐枚相同、种子码相同；同一串代号 Pro 开 /
 *     关各开一次走同一手，翻出来的星星逐枚相同。
 *   ⑥ 箭头：真局里每走一手核一次「淡掉的箭头 = 场上一枚正面都不剩的颜色」；另把 ui/proWheel.ts 打包进页面，喂一份假的
 *     ProView，量淡掉的下标、transition 0.4s、减弱动态时 0s。
 *   ⑦ 局中锁住：开打后 #proBtn[aria-disabled="true"]，点一下 aria-checked 和 slides_pro 都不变、说明对；开局倒数那一屏
 *     的暂停里拨得动，拨开之后开局就是 Pro 局。
 *   ⑧ 结算页标题后面有「Pro」、记录页那一行有「Pro」，不溢出；非 Pro 局都没有。
 *   ⑨ 不重叠：一串视口（竖屏、电脑、横屏）——轮盘露着时不碰任何一枚棋子、HUD、暂停键、计时药丸、教学条，整个在视口里，
 *     露着就 ≥ 48；竖屏棋盘尺寸和 Pro 关时一样（±1px）；电脑上和分数牌对称（中心之和 = 视口宽 ±2）。
 *   ⑩ 跟调色板：局中拨色盲友好，轮盘每一色 = 图例里这一圈那几色；深色主题下色块不用 multiply。
 * 每一段都断言零脚本报错。
 */
import { chromium } from 'playwright';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';

const BASE = process.argv.find((a) => /^https?:/.test(a)) || 'http://localhost:8980/';
const PART = (process.argv.find((a) => a.startsWith('--part=')) || '').slice(7) || 'all';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const I18N = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
/** zhHans 那一块里某个键的值（四个语言块的顺序是 en、fr、zhHant、zhHans）。 */
const zh = (key) => [...I18N.matchAll(new RegExp(`^ {4}${key}: '([^']+)',$`, 'gm'))].map((m) => m[1])[3];

const PLAYED = { slides_lang: 'zhHans', slides_intro_seen: '1' };
for (const k of ['square', 'circle', 'finished', 'bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout', 'totaltip']) PLAYED['slides_played_' + k] = '1';
for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) PLAYED[k] = '1';

/** 开一个新上下文。`pro` 预设 slides_pro；`fresh` 为真时什么「玩过」都不预设（要看头一局那块教学条）。 */
async function open({ w = 390, h = 844, pro = true, fresh = false, genius = true, motion, theme, rand } = {}) {
  const mobile = w < 1000;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, reducedMotion: motion });
  const errs = [];
  await ctx.addInitScript(
    ({ played, pro, fresh, genius, theme, rand }) => {
      if (sessionStorage.getItem('pw_init')) return;
      sessionStorage.setItem('pw_init', '1');
      const base = fresh ? { slides_lang: 'zhHans', slides_intro_seen: '1' } : played;
      for (const [k, v] of Object.entries(base)) localStorage.setItem(k, v);
      if (pro) localStorage.setItem('slides_pro', '1');
      if (theme) localStorage.setItem('slides_theme', theme);
      // 进阶那几副要天才：只在本机缓存里写一份（开小屋要真的兑码，见 ④）。
      if (genius) localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 365 * 864e5 }));
      window.__vib = [];
      try {
        navigator.vibrate = (p) => (window.__vib.push(p), true);
      } catch {}
      if (rand != null) {
        // ⑤：Math.random 换成一条写死的序列（mulberry32），Pro 开 / 关两次开局取到的是同一串数。
        let a = rand >>> 0;
        Math.random = () => {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
    },
    { played: PLAYED, pro, fresh, genius, theme, rand },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  return { ctx, page, errs };
}

/** 主菜单上点一张卡（在页面里 click：鱼眼轴上离焦点远的卡坐在视口外面，page.click 会滚不进来）。 */
async function tapCard(page, label) {
  const ok = await page.evaluate((name) => {
    const b = [...document.querySelectorAll('.home-icon-btn')].find((x) => (x.getAttribute('aria-label') || '').split(' · ')[0] === name);
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!ok) throw new Error(`主菜单上没有「${label}」`);
}

/** 等棋盘上真的有棋子、开局那一幕走完。 */
async function waitBoard(page) {
  await page.waitForSelector('.app--game .board-wrap', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0 && !document.querySelector('#startOverlay.show'), null, { timeout: 25000 });
  await page.waitForTimeout(700);
}

async function playCard(page, label) {
  await tapCard(page, label);
  // 计时挑战那一张先进挑图形那一页
  if (label === '计时挑战') {
    await page.waitForSelector('.slot-pick-opt[data-family="square"]', { timeout: 10000 });
    await page.click('.slot-pick-opt[data-family="square"]');
  }
  await waitBoard(page);
}

async function seeded(page, code) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#seedInput', { timeout: 8000 });
  await page.fill('#seedInput', code.slice(0, 4) + '-' + code.slice(4));
  await page.click('#seedGo');
  await waitBoard(page);
}

const hex = (s) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
  return m ? '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('') : String(s || '').toLowerCase();
};

/** 盘面：每一枚的 id、位置、正反面、颜色（正面读底色，反面读 data-dot-color），外加图例那几色、HUD 那一块要几枚。 */
const board = (page) =>
  page.evaluate(() => {
    const hx = (s) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
      return m ? '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('') : String(s || '').toLowerCase();
    };
    const CLEAR = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
    const colorOf = (el) => {
      if (el.dataset.face === 'dot') return hx(el.dataset.dotColor || el.querySelector('svg [stroke]')?.getAttribute('stroke') || '');
      const own = getComputedStyle(el).backgroundColor;
      if (!CLEAR(own)) return hx(own);
      for (const kid of el.querySelectorAll('*')) {
        const bg = getComputedStyle(kid).backgroundColor;
        if (!CLEAR(bg)) return hx(bg);
        const f = kid.getAttribute && kid.getAttribute('fill');
        if (f && f !== 'none' && !CLEAR(f)) return hx(f);
      }
      return '';
    };
    const svg = document.querySelector('.hud-block--pattern .pat-icon > svg');
    return {
      legend: [...document.querySelectorAll('#legend .swatch')].map((s) => hx(s.style.background || getComputedStyle(s).backgroundColor)),
      need: svg ? [...svg.children].filter((e) => e.tagName !== 'defs').length : 4,
      cells: [...document.querySelectorAll('#boardWrap [data-r][data-c]')]
        .map((e) => {
          const b = e.getBoundingClientRect();
          return {
            id: e.dataset.id || `${e.dataset.r},${e.dataset.c}`,
            at: `${e.dataset.r},${e.dataset.c}`,
            face: e.dataset.face || '',
            color: colorOf(e),
            bomb: Boolean(e.querySelector('.hazard-mark')),
            x: Math.round(b.left + b.width / 2),
            y: Math.round(b.top + b.height / 2),
            w: Math.round(b.width),
          };
        })
        .sort((a, b) => (a.at < b.at ? -1 : 1)),
    };
  });

const sig = (b) => b.cells.map((q) => `${q.at}:${q.face}:${q.color}`).join('|');
/** 等盘面静下来：隔 250ms 读两次一模一样（最多 4 秒）。 */
async function still(page) {
  let prev = await board(page);
  for (let t = 0; t < 16; t++) {
    await page.waitForTimeout(250);
    const cur = await board(page);
    if (sig(cur) === sig(prev)) return cur;
    prev = cur;
  }
  return prev;
}

// 「滑一格就凑出得分组」的找法（check-smooth-touch ⑦ 那一套的精简版：按屏幕上的位置和颜色在本地算）。
const lineThrough = (cells, p, ux, uy) => {
  const tol = Math.max(6, (p.w || 20) * 0.5);
  return cells
    .filter((q) => q.face !== 'blank' && Math.abs((q.x - p.x) * uy - (q.y - p.y) * ux) <= tol)
    .map((q) => ({ q, t: (q.x - p.x) * ux + (q.y - p.y) * uy }))
    .sort((a, b) => a.t - b.t)
    .map((o) => o.q);
};
const neighbours = (cells, p) => {
  const ds = cells.filter((q) => q !== p && q.face !== 'blank').map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) }));
  if (!ds.length) return [];
  const min = Math.min(...ds.map((o) => o.d));
  return ds.filter((o) => o.d < min * 1.05).map(({ q, d }) => ({ ux: (q.x - p.x) / d, uy: (q.y - p.y) / d, d }));
};
const scoring = (cells, lines, need) => {
  const by = new Map(cells.map((p) => [p.at, p]));
  for (const line of lines) {
    const seq = line.map((at) => by.get(at)).filter(Boolean);
    for (let i = 0; i + need <= seq.length; i++) {
      const win = seq.slice(i, i + need);
      if (win.some((p) => p.face === 'blank' || !p.color || p.bomb)) continue;
      if (win.every((p) => p.color === win[0].color) && win.some((p) => p.face === 'flavor')) return true;
    }
  }
  return false;
};
function scoringDrag(cells, need) {
  const lines = [];
  const seen = new Set();
  for (const p of cells) {
    for (const n of neighbours(cells, p)) {
      const line = lineThrough(cells, p, n.ux, n.uy).map((q) => q.at);
      const k = [...line].sort().join('|');
      if (line.length >= need && !seen.has(k)) {
        seen.add(k);
        lines.push(line);
      }
    }
  }
  for (const p of cells) {
    if (p.face === 'blank') continue;
    for (const n of neighbours(cells, p)) {
      const seats = lineThrough(cells, p, n.ux, n.uy);
      if (seats.length < 2) continue;
      const after = cells.map((q) => ({ ...q }));
      const seat = new Map(after.map((q) => [q.at, q]));
      seats.forEach((from, i) => {
        const to = seat.get(seats[(i + 1) % seats.length].at);
        to.face = from.face;
        to.color = from.color;
        to.bomb = from.bomb;
      });
      // after 一并交回：小球那几副没有 data-id，滑完之后哪一格是原来哪一枚，只能照这份模拟认。
      if (scoring(after, lines, need)) return { x: p.x, y: p.y, dx: n.ux * n.d * 1.15, dy: n.uy * n.d * 1.15, after };
    }
  }
  return null;
}
async function drag(page, d) {
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(d.x + (d.dx * i) / 8, d.y + (d.dy * i) / 8);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** 暂停面板：开、关。 */
async function pause(page) {
  await page.evaluate(() => document.querySelector('#stopBtn')?.click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
}
async function resume(page) {
  await page.evaluate(() => document.querySelector('#continueBtn')?.click());
  await page.waitForFunction(() => !document.querySelector('#pauseOverlay.show'), null, { timeout: 8000 });
}
/** 暂停 → 结束游戏，等结算页。 */
async function finish(page) {
  await pause(page);
  await page.evaluate(() => document.querySelector('#pauseFinishBtn')?.click());
  await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
}
/** 本机存档里最新的那一局（各个 ::runs 里 at 最大的）。 */
const latestRun = (page) =>
  page.evaluate(() => {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.endsWith('::runs')) continue;
      try {
        for (const r of JSON.parse(localStorage.getItem(k)) || []) if (!best || (r.data?.at ?? 0) > (best.data?.at ?? 0)) best = r;
      } catch {}
    }
    return best;
  });
const proState = (page) =>
  page.evaluate(() => {
    const w = document.querySelector('#proWheel');
    const r = w?.getBoundingClientRect();
    return {
      run: document.querySelector('.app--game')?.getAttribute('data-pro-run') ?? null,
      shown: !!w && !w.hidden && !!r && r.width > 0 && getComputedStyle(w).display !== 'none',
    };
  });

/**
 * 开着 / 关着 Pro 打一手得分，回「新翻成星星的那几枚：原来是图例里第几色、翻成了第几色」。找不到能得分的一手就
 * 《再来一局》（最多六回）。顺手在每一手之后核一次 ⑥ 的箭头。
 */
async function scoreOnce(page, arrowsLog) {
  for (let round = 0; round < 6; round++) {
    const before = await still(page);
    const want = scoringDrag(before.cells, before.need);
    if (want) {
      const dots0 = before.cells.filter((q) => q.face === 'dot').length;
      await drag(page, want);
      // 得分那一拍先亮一下再翻（控制器排了一拍），盘面会静上半秒多——光靠 still() 会在翻面之前就收工。所以先等
      // 星星真的多出来（最多 4 秒），再等它静下来。
      await page
        .waitForFunction((n) => document.querySelectorAll('#boardWrap [data-face="dot"]').length > n, dots0, { timeout: 4000 })
        .catch(() => {});
      const after = await still(page);
      if (arrowsLog) arrowsLog.push(await arrowsVsBoard(page));
      const was = new Map(want.after.map((q) => [q.at, q]));
      const flipped = after.cells
        .filter((q) => q.face === 'dot' && was.get(q.at)?.face === 'flavor')
        .map((q) => ({ from: before.legend.indexOf(was.get(q.at).color), to: before.legend.indexOf(q.color) }));
      if (flipped.length) return { legend: before.legend, flipped };
    }
    // 这一副找不到一手能得分的：重开一局。
    await pause(page);
    await page.evaluate(() => document.querySelector('#pauseRestartBtn')?.click());
    await page.waitForTimeout(300);
    // 《再来一局》先问一句
    await page.evaluate(() => {
      const yes = [...document.querySelectorAll('.overlay.show button')].find((b) => /再来|重新开始|确定|是/.test(b.textContent || '') && b.id !== 'pauseRestartBtn');
      yes?.click();
    });
    await page.waitForFunction(() => !document.querySelector('#pauseOverlay.show'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  return { legend: [], flipped: [] };
}

/** ⑥ 真局里：淡掉的箭头下标 = 场上一枚正面都不剩的那几色在这一圈里的下标。 */
const arrowsVsBoard = (page) =>
  page.evaluate(() => {
    const hx = (s) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
      return m ? '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('') : String(s || '').toLowerCase();
    };
    const items = [...document.querySelectorAll('#proWheel .wh-item')].map((g) => hx(g.firstElementChild?.getAttribute('fill')));
    const off = [...document.querySelectorAll('#proWheel .wh-arrow')].filter((g) => g.classList.contains('wh-arrow--off')).map((g) => Number(g.dataset.i));
    const live = new Set(
      [...document.querySelectorAll('#boardWrap [data-face="flavor"]')]
        .filter((e) => !e.querySelector('.hazard-mark'))
        .map((e) => hx(getComputedStyle(e).backgroundColor)),
    );
    const want = items.map((c, i) => (live.has(c) ? -1 : i)).filter((i) => i >= 0);
    return { off: off.join(','), want: want.join(','), n: items.length };
  });

const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ═══════════════════════════ core ═══════════════════════════
if (PART === 'core' || PART === 'all') {
  // ① 对应关系（小球）＋ ⑥ 真局里的箭头
  {
    const { ctx, page, errs } = await open({ pro: true });
    await playCard(page, '经典小球');
    const st = await proState(page);
    check('① 开着 Pro 开经典小球：.app--game 上挂着 data-pro-run="1"、轮盘露着', st.run === '1' && st.shown, JSON.stringify(st));
    const arrows = [];
    const r = await scoreOnce(page, arrows);
    const n = r.legend.length;
    const wrong = r.flipped.filter((f) => f.from < 0 || f.to !== (f.from + 1) % n);
    check('① 走一手得分：每一枚新翻成星星的反面 = 图例里的下一色（至少 3 枚）', r.flipped.length >= 3 && wrong.length === 0,
      `${r.flipped.length} 枚：${r.flipped.map((f) => `${f.from}→${f.to}`).join(' ')}`);
    const bad = arrows.filter((a) => a.off !== a.want || a.n !== 4);
    check('⑥ 真局里每走一手：淡掉的箭头 = 场上一枚正面都不剩的那几色', arrows.length > 0 && bad.length === 0, JSON.stringify(arrows));
    check('①⑥ 零脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // ③ 尺子：Pro 关
  {
    const { ctx, page, errs } = await open({ pro: false });
    await playCard(page, '经典小球');
    const st = await proState(page);
    check('③ Pro 关着：没有 data-pro-run，轮盘藏着', st.run === null && !st.shown, JSON.stringify(st));
    const r = await scoreOnce(page, null);
    const n = r.legend.length;
    const allNext = r.flipped.length > 0 && r.flipped.every((f) => f.to === (f.from + 1) % n);
    check('③（尺子）Pro 关着走一手得分：翻出来的星星不全是下一色', r.flipped.length >= 3 && !allNext, r.flipped.map((f) => `${f.from}→${f.to}`).join(' '));
    check('③ 零脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // ④ 只在单人局：每日挑战、输代号
  {
    const { ctx, page, errs } = await open({ pro: true });
    await page.click('.home-icon-btn--daily');
    await page.waitForSelector('#dailyPlay', { timeout: 8000 });
    await page.click('#dailyPlay');
    await waitBoard(page);
    let st = await proState(page);
    check('④ 开着 Pro 打今日挑战：没有 data-pro-run、轮盘藏着', st.run === null && !st.shown, JSON.stringify(st));
    await pause(page);
    const note = await page.evaluate(() => ({ t: document.querySelector('#proNote')?.textContent, hidden: document.querySelector('#proNote')?.hidden, dis: document.querySelector('#proBtn')?.getAttribute('aria-disabled') }));
    check('④ 今日挑战的暂停面板：Pro 那颗锁着，写的是「每日挑战、代号局和小屋局不用 Pro」', note.t === zh('proNotHereNote') && !note.hidden && note.dis === 'true', JSON.stringify(note));
    await resume(page);
    await finish(page);
    let run = await latestRun(page);
    check('④ 今日挑战结束之后：本机存档里那一局没有 pro', !!run && run.data?.pro === undefined && run.data?.seedSource === 'daily', JSON.stringify({ pro: run?.data?.pro, src: run?.data?.seedSource }));
    await seeded(page, '4A4TYZXZ');
    st = await proState(page);
    check('④ 开着 Pro 输代号开局：没有 data-pro-run、轮盘藏着', st.run === null && !st.shown, JSON.stringify(st));
    await finish(page);
    run = await latestRun(page);
    check('④ 代号局结束之后：本机存档里那一局没有 pro', !!run && run.data?.pro === undefined && run.data?.seedSource === 'entered', JSON.stringify({ pro: run?.data?.pro, src: run?.data?.seedSource }));
    check('④ 每日、代号那一段零脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // ④ 只在单人局：小屋（两个上下文，两边都开着 Pro）
  {
    const A = await open({ w: 420, h: 900, pro: true, genius: false });
    const B = await open({ w: 420, h: 900, pro: true, genius: false });
    const granted = await A.page.evaluate(async () => {
      const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
      if (!r.active) return r;
      localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
      return r;
    });
    check('④（夹具）屋主用内部码开通天才', granted.active === true, JSON.stringify(granted).slice(0, 120));
    await A.page.reload({ waitUntil: 'load' });
    await A.page.waitForSelector('#navProfile');
    await A.page.click('#navProfile');
    await A.page.click('#multiRow');
    await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
    await A.page.fill('#mpName', '甲');
    await A.page.click('#mpCreate');
    await A.page.waitForSelector('.mp-code', { timeout: 10000 });
    const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
    await B.page.click('#navProfile');
    await B.page.click('#multiRow');
    await B.page.waitForSelector('#mpCode', { timeout: 10000 });
    await B.page.fill('#mpName', '乙');
    await B.page.fill('#mpCode', code);
    await B.page.waitForSelector('.mp-code', { timeout: 10000 });
    await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, null, { timeout: 8000 });
    await A.page.click('#mpPick');
    await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
    await tapCard(A.page, '经典方块');
    for (const P of [A, B]) await waitBoard(P.page);
    const sa = await proState(A.page);
    const sb = await proState(B.page);
    check('④ 小屋局（屋主、客人都开着 Pro）：两台都没有 data-pro-run、轮盘都藏着', sa.run === null && !sa.shown && sb.run === null && !sb.shown, JSON.stringify({ sa, sb }));
    const sigA = await A.page.$$eval('#boardWrap [data-r][data-c]', (els) => els.map((e) => e.style.background).join(','));
    const sigB = await B.page.$$eval('#boardWrap [data-r][data-c]', (els) => els.map((e) => e.style.background).join(','));
    check('④ 小屋局两台的牌一模一样（正面）', sigA === sigB && sigA.length > 0);
    check('④ 小屋那一段零脚本报错', A.errs.length === 0 && B.errs.length === 0, [...A.errs, ...B.errs].slice(0, 3).join(' | '));
    await A.ctx.close();
    await B.ctx.close();
  }
  // ⑤ 非 Pro 发牌逐枚不变
  {
    const fronts = async (pro) => {
      const { ctx, page, errs } = await open({ pro, rand: 20261014 });
      await playCard(page, '经典方块');
      const b = await board(page);
      const st = await proState(page);
      await finish(page);
      const run = await latestRun(page);
      await ctx.close();
      return { cells: b.cells.map((q) => `${q.at}:${q.face}:${q.color}`).join('|'), seed: run?.data?.seed, run: st.run, errs };
    };
    const on = await fronts(true);
    const off = await fronts(false);
    check('⑤（尺子）同一条 Math.random：一局是 Pro 局、一局不是', on.run === '1' && off.run === null, `${on.run} / ${off.run}`);
    check('⑤ Pro 开 / 关：开局的正面逐枚相同', on.cells === off.cells && on.cells.length > 0);
    check('⑤ Pro 开 / 关：种子码相同', !!on.seed && on.seed === off.seed, `${on.seed} / ${off.seed}`);
    // 同一串代号 Pro 开 / 关：走同一手，翻出来的星星逐枚相同。代号挑金标表里小球那一行（base/circle）的三串，用头一串
    // 「有一手能得分」的（翻出来的星星才有东西可比）。
    const stars = async (pro, code) => {
      const { ctx, page, errs } = await open({ pro });
      await seeded(page, code);
      const before = await still(page);
      const want = scoringDrag(before.cells, before.need);
      if (want) {
        const dots0 = before.cells.filter((q) => q.face === 'dot').length;
        await drag(page, want);
        await page
          .waitForFunction((n) => document.querySelectorAll('#boardWrap [data-face="dot"]').length > n, dots0, { timeout: 4000 })
          .catch(() => {});
      }
      const after = await still(page);
      await ctx.close();
      return { want: !!want, sig: sig(after), dots: after.cells.filter((q) => q.face === 'dot').length, errs };
    };
    let s1 = null;
    let s2 = null;
    let used = '';
    for (const code of ['44000008', '44KAA4PA', '47ZZZZZP']) {
      s1 = await stars(true, code);
      if (!s1.want) continue;
      s2 = await stars(false, code);
      used = code;
      break;
    }
    check('⑤ 同一串代号 Pro 开 / 关各开一次、走同一手：盘面（连翻出来的星星）逐枚相同',
      !!s2 && s1.want && s1.dots > 0 && s1.sig === s2.sig, used ? `${used}：翻出 ${s1.dots} 枚` : '三串码都找不到一手能得分的');
    s2 ??= { errs: [] };
    check('⑤ 零脚本报错', [on, off, s1, s2].every((x) => x.errs.length === 0), [...on.errs, ...off.errs, ...s1.errs, ...s2.errs].slice(0, 3).join(' | '));
  }
  // ⑦ 局中锁住；开局倒数那一屏拨得动
  {
    const { ctx, page, errs } = await open({ pro: true });
    await playCard(page, '经典方块');
    await pause(page);
    const before = await page.evaluate(() => ({ c: document.querySelector('#proBtn')?.getAttribute('aria-checked'), d: document.querySelector('#proBtn')?.getAttribute('aria-disabled'), k: localStorage.getItem('slides_pro'), note: document.querySelector('#proNote')?.textContent, hidden: document.querySelector('#proNote')?.hidden }));
    // 在页面里点：Playwright 把 aria-disabled 当成「点不了」，会一直等它变回可点。
    await page.evaluate(() => document.querySelector('#proBtn')?.click());
    const after = await page.evaluate(() => ({ c: document.querySelector('#proBtn')?.getAttribute('aria-checked'), k: localStorage.getItem('slides_pro') }));
    check('⑦ 开打之后暂停：#proBtn 是 aria-disabled="true"，说明露着、写的是「本局开打后不能改，下一局生效」',
      before.d === 'true' && !before.hidden && before.note === zh('proLockedNote'), JSON.stringify(before));
    check('⑦ 锁着点一下：aria-checked 和 slides_pro 都不变', before.c === 'true' && after.c === 'true' && before.k === '1' && after.k === '1', JSON.stringify({ before, after }));
    await ctx.close();
    // 开局倒数那一屏的暂停：还没开局，拨得动；拨开之后开局就是 Pro 局。
    const b = await open({ pro: false });
    await tapCard(b.page, '经典方块');
    await b.page.waitForSelector('#startPauseBtn', { timeout: 10000 });
    await b.page.click('#startPauseBtn');
    await b.page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
    const pre = await b.page.evaluate(() => document.querySelector('#proBtn')?.getAttribute('aria-disabled'));
    await b.page.click('#proBtn');
    const flipped = await b.page.evaluate(() => ({ c: document.querySelector('#proBtn')?.getAttribute('aria-checked'), k: localStorage.getItem('slides_pro') }));
    check('⑦ 开局倒数那一屏的暂停：开关没锁、拨得动', pre !== 'true' && flipped.c === 'true' && flipped.k === '1', JSON.stringify({ pre, flipped }));
    await b.page.click('#continueBtn');
    await waitBoard(b.page);
    const st = await proState(b.page);
    check('⑦ 倒数那一屏拨开之后开局：这一局就是 Pro 局', st.run === '1' && st.shown, JSON.stringify(st));
    check('⑦ 零脚本报错', errs.length === 0 && b.errs.length === 0, [...errs, ...b.errs].slice(0, 3).join(' | '));
    await b.ctx.close();
  }
  // ⑧ 结算页、记录页
  for (const pro of [true, false]) {
    const { ctx, page, errs } = await open({ pro });
    await playCard(page, '经典方块');
    await finish(page);
    await page.waitForTimeout(600);
    const end = await page.evaluate(() => {
      const tag = document.querySelector('#endOverlay .end-title .end-pro');
      const modal = document.querySelector('#endOverlay .modal')?.getBoundingClientRect();
      const r = tag?.getBoundingClientRect();
      return { has: !!tag, text: tag?.textContent, inside: !!r && !!modal && r.right <= modal.right + 0.5 && r.left >= modal.left - 0.5 };
    });
    const run = await latestRun(page);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#navRecords', { timeout: 20000 });
    await page.click('#navRecords');
    await page.waitForSelector('#recordsPanel', { timeout: 10000 });
    await page.waitForTimeout(400);
    const rec = await page.evaluate(() => {
      const tag = document.querySelector('#recordsPanel .records-row .records-row-pro');
      const row = tag?.closest('.records-row')?.getBoundingClientRect();
      const r = tag?.getBoundingClientRect();
      return { has: !!tag, inside: !!r && !!row && r.right <= row.right + 0.5 && r.width > 0 };
    });
    if (pro) {
      check('⑧ Pro 局：结算页标题后面挂着「Pro」，不溢出', end.has && end.text === 'Pro' && end.inside, JSON.stringify(end));
      check('⑧ Pro 局：本机存档那一局写着 pro: true', run?.data?.pro === true);
      check('⑧ Pro 局：记录页那一行有「Pro」，不溢出', rec.has && rec.inside, JSON.stringify(rec));
    } else {
      check('⑧ 非 Pro 局：结算页、记录页都没有「Pro」，存档里没有 pro', !end.has && !rec.has && run?.data?.pro === undefined, JSON.stringify({ end, rec, pro: run?.data?.pro }));
    }
    check(`⑧ ${pro ? 'Pro' : '非 Pro'} 那一段零脚本报错`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ═══════════════════════════ layout ═══════════════════════════
if (PART === 'layout' || PART === 'all') {
  // ⑥ 打包 proWheel.ts 进页面，喂假的 ProView：淡掉的下标对、transition 0.4s、减弱动态 0s
  {
    const out = buildSync({ entryPoints: [new URL('../src/ui/proWheel.ts', import.meta.url).pathname], bundle: true, format: 'iife', globalName: 'PW', write: false, logLevel: 'silent' });
    const js = out.outputFiles[0].text;
    for (const motion of ['no-preference', 'reduce']) {
      const { ctx, page, errs } = await open({ motion });
      const r = await page.evaluate(async (code) => {
        new Function(code + ';window.PW = PW;')();
        const app = document.createElement('div');
        app.className = 'app app--game';
        const host = document.createElement('div');
        host.className = 'pro-wheel';
        host.hidden = true;
        app.appendChild(host);
        document.body.appendChild(app);
        const w = window.PW.mountProWheel(host, 'label', null);
        const palette = ['#c96a4b', '#9b8a3a', '#4a9873', '#4a7fb3', '#8a6bb0', '#b05f86'];
        w.show({ shape: 'square', palette, cycle: [0, 2, 3, 4, 5], left: new Set([0, 2, 3, 4, 5]) });
        await new Promise((res) => setTimeout(res, 60));
        w.sync({ shape: 'square', palette, cycle: [0, 2, 3, 4, 5], left: new Set([0, 4]) });
        const arrows = [...host.querySelectorAll('.wh-arrow')];
        const off = arrows.filter((g) => g.classList.contains('wh-arrow--off')).map((g) => Number(g.dataset.i));
        const dur = getComputedStyle(arrows[0]).transitionDuration;
        const items = [...host.querySelectorAll('.wh-item')].map((g) => g.firstElementChild?.getAttribute('fill'));
        const aria = host.getAttribute('aria-label');
        w.destroy();
        return { off: off.join(','), dur, items: items.join(','), aria, hiddenAfter: host.hidden };
      }, js);
      if (motion === 'reduce') {
        check('⑥ 减弱动态：箭头淡出不走动画（transition 0s）', r.dur === '0s', r.dur);
      } else {
        // cycle [0,2,3,4,5]、还剩 0 和 4：从 2、3、5 出发的箭头（圈里的下标 1、2、4）淡掉
        check('⑥ 假 ProView：淡掉的是「场上一枚都不剩」那几色出发的箭头', r.off === '1,2,4', r.off);
        check('⑥ 箭头淡出 0.4s', r.dur === '0.4s', r.dur);
        check('⑥ 每一色按这一圈的次序取调色板（炸弹局去红：没有第 1 色）', r.items === '#c96a4b,#4a9873,#4a7fb3,#8a6bb0,#b05f86', r.items);
        check('⑥ 读屏名、destroy 之后藏起来', r.aria === 'label' && r.hiddenAfter === true, JSON.stringify(r));
      }
      check(`⑥ 打包那一段（${motion}）零脚本报错`, errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }

  // ⑨ 不重叠
  const VIEWS = [
    { w: 390, h: 844, cards: ['经典方块', '经典小球', '菱形小球'] },
    { w: 360, h: 740, cards: ['经典方块', '六边形三角'] },
    { w: 360, h: 640, cards: ['经典方块', '经典小球', '计时挑战'] },
    { w: 320, h: 568, cards: ['经典方块', '菱形方块'] },
    { w: 1440, h: 900, cards: ['经典方块', '六边形小球'] },
    { w: 1280, h: 720, cards: ['经典小球'] },
    { w: 1000, h: 561, cards: ['经典方块'] },
    { w: 844, h: 390, cards: ['经典方块', '菱形小球'] },
    { w: 667, h: 375, cards: ['经典小球'] },
  ];
  const measure = (page) =>
    page.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } : null;
      };
      const wheel = box(document.querySelector('#proWheel'));
      const desktop = matchMedia('(min-width: 1000px) and (min-height: 561px)').matches;
      const hud = desktop
        ? [box(document.querySelector('.hud-block--score')), box(document.querySelector('.hud-block--pattern'))]
        : [box(document.querySelector('.app--game .hud'))];
      return {
        wheel,
        corner: document.querySelector('#proWheel')?.classList.contains('pro-wheel--corner') ?? false,
        pieces: [...document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri')].map(box).filter(Boolean),
        others: [...hud, box(document.querySelector('#stopBtn')), box(document.querySelector('#timerPill')), box(document.querySelector('.coach-bar'))].filter(Boolean),
        floor: box(document.querySelector('#boardWrap')),
        score: box(document.querySelector('.hud-block--score')),
        vw: innerWidth,
        vh: innerHeight,
        desktop,
        portrait: !desktop && !matchMedia('(orientation: landscape) and (max-height: 560px)').matches,
      };
    });
  const hits = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  // 圆形的轮盘（叠在棋盘空角时）按圆量：圆心到棋子外接框的距离 ≥ 半径。
  const circleHits = (c, b) => {
    const cx = (c.l + c.r) / 2;
    const cy = (c.t + c.b) / 2;
    const dx = Math.max(b.l - cx, 0, cx - b.r);
    const dy = Math.max(b.t - cy, 0, cy - b.b);
    return Math.hypot(dx, dy) < c.w / 2 - 0.5;
  };
  for (const v of VIEWS) {
    for (const card of v.cards) {
      const on = await open({ w: v.w, h: v.h, pro: true });
      await playCard(on.page, card);
      const m = await measure(on.page);
      // 「棋盘尺寸和 Pro 关时一样」只在竖屏量（轮盘只在竖屏进文档流）；横屏、电脑不再多开一局 Pro 关的。
      const off = m.portrait ? await open({ w: v.w, h: v.h, pro: false }) : null;
      if (off) await playCard(off.page, card);
      const m0 = off ? await measure(off.page) : null;
      const tag = `⑨ ${v.w}×${v.h} ${card}`;
      if (m.wheel) {
        const piece = m.pieces.find((p) => (m.corner ? circleHits(m.wheel, p) : hits(m.wheel, p)));
        const other = m.others.find((o) => hits(m.wheel, o));
        const inView = m.wheel.l >= -0.5 && m.wheel.t >= -0.5 && m.wheel.r <= m.vw + 0.5 && m.wheel.b <= m.vh + 0.5;
        check(`${tag}：轮盘 ${Math.round(m.wheel.w)}px${m.corner ? '（空角）' : ''}，不碰棋子、HUD、暂停键、计时药丸、教学条，整个在视口里，≥48`,
          !piece && !other && inView && m.wheel.w >= 48, JSON.stringify({ wheel: m.wheel, piece, other }));
      } else {
        check(`${tag}：轮盘放不下就不显示（不是藏着一半）`, true, '藏起来了');
      }
      if (m.portrait && m0) {
        const same = m.floor && m0.floor && Math.abs(m.floor.w - m0.floor.w) <= 1 && Math.abs(m.floor.h - m0.floor.h) <= 1;
        check(`${tag}：竖屏棋盘尺寸和 Pro 关时一样（±1px）`, !!same, `${m.floor?.w}×${m.floor?.h} / ${m0.floor?.w}×${m0.floor?.h}`);
      }
      if (m.desktop && m.wheel && m.score) {
        const sum = (m.score.l + m.score.r) / 2 + (m.wheel.l + m.wheel.r) / 2;
        check(`${tag}：电脑上和分数牌对称`, Math.abs(sum - m.vw) <= 2, `中心之和 ${sum.toFixed(2)}，视口 ${m.vw}`);
      }
      const errs = [...on.errs, ...(off ? off.errs : [])];
      check(`${tag}：零脚本报错`, errs.length === 0, errs.slice(0, 3).join(' | '));
      await on.ctx.close();
      await off?.ctx.close();
    }
  }
  // ⑨ 头一局（教学条露着）：1000×561 电脑，轮盘缩到 136 贴栏底，或者藏起来——总之不碰教学条
  {
    const { ctx, page, errs } = await open({ w: 1000, h: 561, pro: true, fresh: true });
    await tapCard(page, '经典方块');
    await waitBoard(page);
    await page.waitForTimeout(1500);
    const m = await measure(page);
    const coach = await page.evaluate(() => {
      const c = document.querySelector('.coach-bar');
      return !!c && !c.hidden;
    });
    const ok = !m.wheel || (Math.round(m.wheel.w) === 136 && !m.others.some((o) => hits(m.wheel, o)));
    check('⑨ 1000×561 头一局（教学条露着）：轮盘 136 贴右栏底、不碰教学条（或者藏起来）', coach && ok, JSON.stringify({ coach, wheel: m.wheel }));
    check('⑨ 头一局那一段零脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ⑩ 跟调色板：局中拨色盲；深色主题不用 multiply
  {
    const { ctx, page, errs } = await open({ pro: true });
    await playCard(page, '经典方块');
    const read = () =>
      page.evaluate(() => {
        const hx = (s) => {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
          return m ? '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('') : String(s || '').toLowerCase();
        };
        return {
          legend: [...document.querySelectorAll('#legend .swatch')].map((s) => hx(s.style.background)),
          items: [...document.querySelectorAll('#proWheel .wh-item')].map((g) => hx(g.firstElementChild?.getAttribute('fill'))),
          blend: getComputedStyle(document.querySelector('#proWheel .wh-item')).mixBlendMode,
        };
      });
    const a = await read();
    await pause(page);
    await page.click('#cvdBtn');
    await resume(page);
    await page.waitForTimeout(300);
    const b = await read();
    check('⑩ 开局时：轮盘每一色 = 图例里那几色（不是炸弹局：整副调色板一圈）', sameArr(a.items, a.legend) && a.items.length === 6, JSON.stringify(a));
    check('⑩ 局中拨色盲友好：轮盘跟着换成色盲那一套', sameArr(b.items, b.legend) && !sameArr(b.items, a.items), JSON.stringify(b));
    check('⑩ 浅色主题：色块用 multiply 叠', a.blend === 'multiply', a.blend);
    check('⑩ 色盲那一段零脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
    const d = await open({ pro: true, theme: 'dark' });
    await playCard(d.page, '经典方块');
    const blend = await d.page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), blend: getComputedStyle(document.querySelector('#proWheel .wh-item')).mixBlendMode }));
    check('⑩ 深色主题：色块不用 multiply（normal）', blend.theme === 'dark' && blend.blend === 'normal', JSON.stringify(blend));
    check('⑩ 深色那一段零脚本报错', d.errs.length === 0, d.errs.slice(0, 3).join(' | '));
    await d.ctx.close();
  }
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
