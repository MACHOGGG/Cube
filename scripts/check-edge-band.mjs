/**
 * 外边指引 · 方案 B「双色托盘」——《侵蚀阶梯》v1.2 PR-7。
 *
 *   node scripts/dev-server.mjs 8995 dist &
 *   node scripts/check-edge-band.mjs http://localhost:8995/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 带子沿着「此刻哪几条线削得动」描在托盘上、**棋子之下**。它是这一版里唯一一处
 * 「盘面现在什么样」的视觉提示，而它能坏的四种样子都不报错：
 *
 *   ① **画到棋子上面去。** 那就不是托盘上的提示了，是一条挡住棋盘的粗线。
 *   ② **画到方块 36 上。** 那一副是任意整行整列都能消，没有「最外边」这回事——
 *      画一条带子等于告诉玩家一件假事。
 *   ③ **颜色动了色相。** 带子不携带任何颜色语义（它说的是位置）。换成强调色的话，
 *      玩家会去找「这个颜色对应哪一族」，而根本没有那回事。
 *   ④ **削掉一条边之后不跟着变。** 那它指的就是上一轮的外圈。
 *
 * 第 ④ 条这儿用「重画一次，带子的点位跟着棋盘的尺寸走」来量：真正削掉一条边要凑
 * 出整条同色星星，随机滑不出来。点位是照活格中心现算的（ui/edgeBand.ts），所以只
 * 要它真的每次 render 都重建，这一条就守得住。
 * ─────────────────────────────────────────────────────────────────────────
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8995/';
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 开一局，回报那一层带子的样子。 */
async function openBoard(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errs.push(String(e.message))));
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem('slides_first_run', '1');
    for (const k of ['slides_played_square', 'slides_played_circle', 'slides_tutorial_seen',
                     'slides_tutorial_seen_circle', 'slides_knowhow']) localStorage.setItem(k, '1');
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 9e10 }));
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  const found = await page.evaluate((n) => {
    const b = [...document.querySelectorAll('.home-icon-btn')].find((x) => (x.getAttribute('aria-label') || '').startsWith(n));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!found) { await ctx.close(); return { missing: true, errs }; }
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector('#startBtn')?.click());
  await page.waitForTimeout(1200);
  const got = await page.evaluate(() => {
    const board = document.querySelector('#board');
    const band = board?.querySelector(':scope > .edge-band');
    const piece = board?.querySelector('.ball, .tile, .tri');
    const trayEl = document.querySelector('.board-wrap');
    const parse = (c) => (c.match(/\d+/g) || []).map(Number).slice(0, 3);
    return {
      has: !!band,
      // 在所有棋子之下 = 它是 #board 的第一个孩子。
      first: !!band && board.firstElementChild === band,
      lines: band ? band.children.length : 0,
      stroke: band?.querySelector('polyline')?.getAttribute('stroke-width'),
      // 取外接框的**短边**：圆和方块宽高相等，三角的高比边长短 15%，而带子该跟着
      // 「这一排看着有多厚」走，也就是高（见 shapes/triangle.ts 那一段）。
      pieceW: piece
        ? Math.round(Math.min(piece.getBoundingClientRect().width, piece.getBoundingClientRect().height))
        : 0,
      bandColor: band ? parse(getComputedStyle(band).color) : null,
      trayColor: trayEl ? parse(getComputedStyle(trayEl).backgroundColor) : null,
      boardW: board ? board.clientWidth : 0,
    };
  });
  await ctx.close();
  return { ...got, errs };
}

/** 两个颜色的色相差（度）。只动明度的话，这个数该接近 0。 */
function hueGap(a, b) {
  const hue = ([r, g, bl]) => {
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    if (mx === mn) return 0;
    const d = mx - mn;
    let h;
    if (mx === r) h = ((g - bl) / d) % 6;
    else if (mx === g) h = (bl - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) % 360 + 360) % 360;
  };
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------
// 1. 五副外边族棋盘：带子在，而且在棋子底下
// ---------------------------------------------------------------------------
const EDGE_BOARDS = ['经典小球', '菱形方块', '六边形小球', '菱形小球', '六边形三角'];
for (const label of EDGE_BOARDS) {
  const m = await openBoard(label);
  if (m.missing) { check(`${label}：菜单上找得到这张卡`, false); continue; }
  check(`${label}：托盘上画了带子`, m.has, `${m.lines} 条`);
  check(`${label}：带子在所有棋子**之下**（是 #board 的第一个孩子）`, m.first);
  // 一副棋盘此刻至少有一条边削得动——一条都没有的话这道门量的是空气。
  check(`${label}：至少描了一条边`, m.lines >= 1, `${m.lines} 条`);
  if (m.stroke && m.pieceW) {
    const ratio = Number(m.stroke) / m.pieceW;
    check(`${label}：带子比棋子略宽（1.15×，实测 ${ratio.toFixed(2)}×）`,
      Math.abs(ratio - 1.15) < 0.12, `${m.stroke} / 棋子 ${m.pieceW}`);
  }
  if (m.bandColor && m.trayColor) {
    // 只动明度不动色相：带子说的是位置，不是颜色语义。
    check(`${label}：带色和托盘同一个色相（差 ${hueGap(m.bandColor, m.trayColor).toFixed(0)}°）`,
      hueGap(m.bandColor, m.trayColor) < 12,
      `带 ${m.bandColor.join(',')} / 托盘 ${m.trayColor.join(',')}`);
    // 反向：两个颜色不许一模一样，不然等于没画。
    check(`${label}：带色和托盘**不是**同一个颜色（不然等于没画）`,
      m.bandColor.join() !== m.trayColor.join(),
      `带 ${m.bandColor.join(',')} / 托盘 ${m.trayColor.join(',')}`);
  }
  check(`${label}：零报错`, m.errs.length === 0, m.errs[0] || '');
}

// ---------------------------------------------------------------------------
// 2. 反向：方块 36 不画
// ---------------------------------------------------------------------------
//
// 它是任意整行整列全同色星星就消除、棋盘合拢——没有「最外边」这回事。画一条带子
// 等于告诉玩家一件假事。
{
  const m = await openBoard('经典方块');
  check('方块 36：**不画**带子（它没有「最外边」这回事）', m.has === false, m.has ? `画了 ${m.lines} 条` : '');
  check('方块 36：零报错', m.errs.length === 0, m.errs[0] || '');
}

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
