/**
 * 把一行/一列拖出版图很远之后，那条线还在不在。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8818 dist
 *   node scripts/check-drag-far.mjs http://localhost:8818/
 *
 * 玩家报的是「鼠标从版图里拉一行出去之后，会卡顿或者跳格」。查出来的是这么
 * 回事：补位的影子原先钉在本尊左右固定的几轮上（方块 ±2 轮，小球和菱形
 * ±1 轮）。手指拖得比那还远，本尊早被裁在版图外、或者淡成全透明，最远的影
 * 子也还在更远处——版图里这一行就空了，再拖回来又凭空冒出来。
 *
 * 为什么只有电脑端撞得到：手机上版图差不多占满屏幕，两个版图宽根本拖不到；
 * 电脑上版图只占窗口的三分之一，鼠标一路拖过去很轻松就超过了。所以这个门开
 * 的是 1920 宽的窗口，并且从版图最左边起拖——够得着两轮以外。
 *
 * 这个门要开浏览器，所以留在本地手跑，不进 CI（见 ci.yml 开头那段）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8818/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const PIECES = '#boardWrap .tile, #boardWrap .ball, #boardWrap .tri';
const ctx = await browser.newContext({ viewport: { width: 1920, height: 900 } });
await ctx.addInitScript(() => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_first_run', '1');
  // 菱形方块和七色圆球是天才特供，主菜单上锁着。点开一个玩法只要本地这份凭
  // 据（开小屋才要服务器认）。
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, period: 'yearly', until: Date.now() + 30 * 864e5, channel: 'web',
    email: '', token: 'x'.repeat(48), code: 'LOCALONLY',
  }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));

/** 开一局，返回版图的位置和它这一行有几颗。 */
async function openBoard(label) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(300);
  const hit = await page.$$eval('.home-icon-btn', (els, want) => {
    const i = els.findIndex((e) => (e.getAttribute('aria-label') || '').trim() === want);
    if (i < 0) return false;
    els[i].click();
    return true;
  }, label);
  if (!hit) throw new Error(`主菜单上找不到读屏名叫《${label}》的卡`);
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, PIECES, { timeout: 30000 });
  await page.waitForTimeout(700);
  // 抓的是「最靠左的那一颗」，不是版图左边缘那个点：小球和菱形的棋子摆成圆
  // 的、菱形的，版图的左边缘那儿根本没有棋子，从那儿按下去抓不到任何一条线。
  return page.evaluate((sel) => {
    const w = document.getElementById('boardWrap').getBoundingClientRect();
    const ps = [...document.querySelectorAll(sel)];
    const mid = w.y + w.height / 2;
    // 先挑靠版图中腰那一带的（上下半格之内），再取里面最靠左的那一颗。
    const rects = ps.map((e) => e.getBoundingClientRect());
    const cell = Math.min(...rects.map((r) => r.width));
    const band = rects.filter((r) => Math.abs(r.y + r.height / 2 - mid) < cell * 0.5);
    const pick = (band.length ? band : rects).reduce((a, b) => (a.x <= b.x ? a : b));
    return { x: w.x, y: w.y, w: w.width, h: w.height, n: ps.length,
             grabX: pick.x + pick.width / 2, grabY: pick.y + pick.height / 2 };
  }, PIECES);
}

/**
 * 从版图最左边抓一颗，一路拖到窗口右边，每隔一段数一次「被拖的那条线，自己
 * 那几个窝里还剩几个有东西」。
 *
 * 数整副版图是不行的——空掉的只是一条线，六分之一，混在三十几颗里看不出来
 * （试过：旧代码下整副也还剩九成，这道门照样全绿）。所以先记下每一颗静止时
 * 的窝，再看被拖那条线的窝里此刻有没有东西（本尊或影子都算）。这正是玩家看
 * 的那件事：那一行还在不在。
 *
 * 哪几颗算「被拖的那条线」不写死：拖了一段之后，位置真的变了的那几颗就是。
 * 各副棋盘的线方向不一样（方块按行，小球按三个方向的斜线），这么认一律管用。
 */
/**
 * 这条线上两个窝之间有多远。
 *
 * 量的必须是窝距，不是棋子本身的宽——菱形方块那副棋子是斜过来的，一个窝
 * 62px 宽而棋子只有 40px，拿半个棋子宽当判定半径，线正好停在两个窝中间的
 * 那一帧就一个都算不上，量出来是「整条线没了」。这不是游戏的毛病，是尺子
 * 拿错了。
 */
function pitch(lane) {
  let best = Infinity;
  for (let i = 0; i < lane.length; i++)
    for (let j = i + 1; j < lane.length; j++)
      best = Math.min(best, Math.hypot(lane[i].x - lane[j].x, lane[i].y - lane[j].y));
  return Number.isFinite(best) ? best : 1;
}

async function sweep(geo) {
  const cy = geo.grabY;
  const startX = geo.grabX;
  const endX = 1916;
  const counts = [];
  // 静止时每一颗的窝。
  await page.evaluate((sel) => {
    window.__home = [...document.querySelectorAll(sel)].map((e) => {
      const r = e.getBoundingClientRect();
      return { k: `${e.dataset.r},${e.dataset.c}`, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
    });
  }, PIECES);
  await page.mouse.move(startX, cy);
  await page.mouse.down();
  let lane = null;
  for (let x = startX; x <= endX; x += 8) {
    await page.mouse.move(x, cy);
    await page.waitForTimeout(9);
    // 拖开一格多之后定下这条线是哪几颗——再早还在死区里，什么都没动。
    if (lane === null && x - startX > 90) {
      lane = await page.evaluate((sel) => {
        const now = new Map([...document.querySelectorAll(sel)].map((e) => {
          const r = e.getBoundingClientRect();
          return [`${e.dataset.r},${e.dataset.c}`, { x: r.x + r.width / 2, y: r.y + r.height / 2 }];
        }));
        return window.__home
          .filter((h) => { const n = now.get(h.k); return n && Math.hypot(n.x - h.x, n.y - h.y) > 3; })
          .map((h) => ({ x: h.x, y: h.y, w: h.w }));
      }, PIECES);
    }
    // 每隔一段取一次样，最后一下无论如何补一次——七色圆球那副一轮 592px，
    // 1920 宽的窗口只够拖两轮出头，取样点卡在 160 的倍数上会正好差一点。
    if (lane && (Math.round(x - startX) % 160 < 8 || x + 8 > endX)) {
      const seen = await page.evaluate(({ sel, lane, reach }) => {
        const wrap = document.getElementById('boardWrap');
        const live = [...wrap.querySelectorAll(sel)]
          .filter((e) => Number(getComputedStyle(e).opacity) > 0.02)
          .map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        // 一个窝算「有东西」：半个窝距之内有任何一枚（本尊或影子）。
        return lane.filter((h) => live.some((p) => Math.hypot(p.x - h.x, p.y - h.y) < reach)).length;
      }, { sel: PIECES, lane, reach: pitch(lane) * 0.5 });
      counts.push([Math.round((x - startX) / geo.w * 100) / 100, seen, lane.length]);
    }
  }
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(350);
  return counts;
}

// 五副会用「环绕影子」补位的棋盘。三角那三副走的是另一条路（循环缓冲，
// fillerAwareSource），每个格子永远有内容，怎么拖都不会空，所以不在这儿。
for (const label of ['方块', '圆球', '菱形方块', '六边圆球', '七色圆球']) {
  let geo;
  try {
    geo = await openBoard(label);
  } catch (e) {
    check(`${label}：开得起来`, false, String(e.message));
    continue;
  }
  const counts = await sweep(geo);
  const far = counts.filter(([rounds]) => rounds >= 2);
  const size = counts[0]?.[2] ?? 0;
  // 允许空一个：线的两头总有一枚正卡在版图边缘淡进淡出。空到一半以上就是整
  // 条线没了——那正是这个门要拦的（旧代码在两轮开外只剩两三成）。
  const floor = Math.max(1, size - 1);
  const worst = far.length ? Math.min(...far.map(([, n]) => n)) : -1;
  check(
    `${label}：拖出两轮以外，被拖的那条线还是满的`,
    far.length > 0 && worst >= floor,
    far.length ? `最少 ${worst}/${size} 个窝有东西（底线 ${floor}）` : `窗口不够宽，一轮 ${geo.w.toFixed(0)}px`,
  );
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
