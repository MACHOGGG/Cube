/**
 * 棋子有没有戳出底下那块板子。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-board-fit.mjs http://localhost:8815/
 *
 * 量的是两个框：底板（.board-wrap，游戏页里那块圆角面板）和棋子们的并集。
 * 后者不许越过前者——一枚方块压在板子边缘外面，看上去就是「这个游戏没做完」。
 *
 * 为什么要一个脚本而不是看一眼：八个玩法 × 两个方向 = 十六种，而每一种都要
 * 等 4-3-2-1 数完、等 ResizeObserver 把布局定下来才量得准。眼睛看得过来，
 * 但看不住——改一次圆角、动一下间距，十六种里总有一种会悄悄越界。
 *
 * 容差 0.5px：亚像素的取整不算越界，肉眼也看不见。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
const TOL = 0.5;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 一枚棋子有没有戳出地板。
 *
 * 比的不是两个方框——那是这个 bug 藏了这么久的原因。地板是个圆角矩形，棋盘
 * 却是照着整格算满的：角上那枚方块的方框在地板的方框之内（差 2px），它的角
 * 却落在圆角那道弧的外面。量方框永远量不出来，眼睛一看就是「这个游戏没做完」。
 *
 * 所以这里逐个角地算：半径 R 的圆角，圆心在 (R, R)；棋子离这个角最近的那个
 * 点是 (a, b)；它被切到，当且仅当 a < R 且 b < R 且 (R−a)² + (R−b)² > R²。
 * 棋子自己的圆角也算进去——它最外那个点沿对角线往里缩 r(1 − 1/√2)。
 */
const MEASURE = () => {
  const wrap = document.querySelector('.app--game .board-wrap');
  if (!wrap) return null;
  const w = wrap.getBoundingClientRect();
  const cs = getComputedStyle(wrap);
  const R = [
    parseFloat(cs.borderTopLeftRadius) || 0,
    parseFloat(cs.borderTopRightRadius) || 0,
    parseFloat(cs.borderBottomRightRadius) || 0,
    parseFloat(cs.borderBottomLeftRadius) || 0,
  ];
  const pieces = [...wrap.querySelectorAll('.tile, .ball, .tri')];
  if (!pieces.length) return null;
  const pull = (parseFloat(getComputedStyle(pieces[0]).borderTopLeftRadius) || 0) * (1 - Math.SQRT1_2);

  // 越界多少：正数是戳出去了，负数是还有余量。
  let worst = -Infinity;
  let where = '';
  const note = (over, tag) => {
    if (over > worst) { worst = over; where = tag; }
  };
  for (const p of pieces) {
    const q = p.getBoundingClientRect();
    if (q.width <= 0 || q.height <= 0) continue;
    // 先看方框：戳出地板的方框是最直白的一种越界。
    note(w.left - q.left, '左');
    note(w.top - q.top, '上');
    note(q.right - w.right, '右');
    note(q.bottom - w.bottom, '下');
    // 再看四个圆角。
    const near = [
      [q.left - w.left + pull, q.top - w.top + pull, R[0], '左上角'],
      [w.right - q.right + pull, q.top - w.top + pull, R[1], '右上角'],
      [w.right - q.right + pull, w.bottom - q.bottom + pull, R[2], '右下角'],
      [q.left - w.left + pull, w.bottom - q.bottom + pull, R[3], '左下角'],
    ];
    for (const [a, b, r, tag] of near) {
      if (!(r > 0) || a >= r || b >= r) continue;
      // 圆心到那个点的距离超过 R 就是戳出去了；差多少就是越界多少。
      const d = Math.hypot(r - a, r - b);
      note(d - r, tag);
    }
  }
  return {
    n: pieces.length,
    worst: Math.round(worst * 10) / 10,
    where,
    radius: R.map((r) => Math.round(r)).join('/'),
    floor: { w: Math.round(w.width), h: Math.round(w.height) },
  };
};

const ALL_VIEWPORTS = [
  { key: 'portrait', name: '竖屏 390×844', width: 390, height: 844 },
  { key: 'landscape', name: '横屏 844×390', width: 844, height: 390 },
  { key: 'small', name: '小竖屏 360×640', width: 360, height: 640 },
];
// 第二个参数可以只挑一档跑（portrait / landscape / small）。十六种全跑一遍
// 要好几分钟，改一处样式想立刻看一眼的时候用得上。
const want = process.argv[3];
const VIEWPORTS = want ? ALL_VIEWPORTS.filter((v) => v.key === want) : ALL_VIEWPORTS;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

  const labels = await page.$$eval('.home-icon-btn', (els) =>
    els.map((e) => e.getAttribute('aria-label') || ''));

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    // 多人游玩不是一个棋盘，它是一整套流程（check-multiplayer 管那一头）。
    if (!label || label === '多人游玩') continue;
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
    await page.$$eval('.home-icon-btn', (els, k) => els[k].click(), i);
    // 炸弹那几张点开是「选个形状」的窗口，不是直接开局——挑第一个。天才特供
    // 那两张点开是订阅墙，那一档这里跳过（没订阅的人本来也进不去）。
    await page.waitForTimeout(500);
    // 有的卡片点开不是开局，是先让你挑一个形状。两种挑法都在这儿接住：
    //   · 弹一个居中的窗（进阶炸弹那几张）；
    //   · 原地摊开成三张小卡（定时炸弹）——摊开之后主菜单上多出
    //     「定时炸弹 · 方块」这样的按钮，认前缀就找得到。
    const chip = await page.$('.center-pick .bomb-chip, .center-pick .center-pick-opt:not(.center-pick-opt--locked)');
    if (chip) {
      await chip.click();
      await page.waitForTimeout(400);
    } else {
      const opened = await page.$$eval(
        '.home-icon-btn',
        (els, prefix) => {
          const hit = els.find((e) => (e.getAttribute('aria-label') || '').startsWith(prefix + ' · '));
          if (!hit) return false;
          hit.click();
          return true;
        },
        label,
      );
      if (opened) await page.waitForTimeout(400);
    }
    const started = await page
      .waitForFunction(
        () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
        { timeout: 25000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!started) {
      // 订阅墙拦下来的不算失败——它本来就不该让没订阅的人进去。
      // 天才特供那两张点开是订阅墙。没订阅进不去是对的，不算失败。
      const paywall = await page.evaluate(() =>
        Boolean(document.querySelector('.overlay.show, .center-pick')) &&
        !document.querySelector('.app--game'));
      if (paywall) {
        console.log(`SKIP  ${vp.name} · ${label}：订阅墙拦着，没订阅进不去`);
        continue;
      }
      check(`${vp.name} · ${label}：开得起来`, false, '棋盘没出现');
      continue;
    }
    // 布局是 ResizeObserver 定下来的，可能要多等一两帧。
    await page.waitForTimeout(900);
    const m = await page.evaluate(MEASURE);
    if (!m) {
      check(`${vp.name} · ${label}：量得到`, false, '找不到底板或棋子');
      continue;
    }
    check(
      `${vp.name} · ${label}：棋子都在底板里`,
      m.worst <= TOL,
      m.worst > TOL
        ? `${m.where}越界 ${m.worst}px · 圆角 ${m.radius} · 底板 ${m.floor.w}×${m.floor.h} · ${m.n} 枚`
        : `余量 ${-m.worst}px（最紧的是${m.where}）· 圆角 ${m.radius}`,
    );
  }
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
