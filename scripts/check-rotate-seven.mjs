/**
 * 七色圆球转屏之后、还没碰它之前，棋盘在不在地板里。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-rotate-seven.mjs http://localhost:8815/
 *
 * 这个玩法比别的多一件事：菱形要顺着屏幕最长那条边躺，所以每次排版都要先问
 * 一句「现在是横的还是竖的」。问错了，菱形就照着上一个方向摆，一半在地板外
 * 面——而且要等玩家碰一下棋盘才会重排，所以「刚转过来还没操作」那一段时间里
 * 它就那么歪着。
 *
 * 所以这里量三次：转之前、转之后什么都不碰、再碰一下。第二次和第三次不一样
 * 就是那个 bug。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
const TOL = 1;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 棋子的并集有没有戳出地板，以及菱形是躺着还是立着。
const MEASURE = () => {
  const wrap = document.querySelector('.app--game .board-wrap');
  if (!wrap) return null;
  const w = wrap.getBoundingClientRect();
  const balls = [...wrap.querySelectorAll('.ball')].filter((b) => {
    const q = b.getBoundingClientRect();
    return q.width > 0 && q.height > 0;
  });
  if (!balls.length) return null;
  let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
  for (const b of balls) {
    const q = b.getBoundingClientRect();
    L = Math.min(L, q.left); T = Math.min(T, q.top);
    R = Math.max(R, q.right); B = Math.max(B, q.bottom);
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    n: balls.length,
    over: r1(Math.max(w.left - L, w.top - T, R - w.right, B - w.bottom)),
    floor: `${Math.round(w.width)}×${Math.round(w.height)}`,
    // 棋子铺开的那一块是宽的还是高的——菱形躺着就是宽的。
    lying: R - L >= B - T,
    span: `${Math.round(R - L)}×${Math.round(B - T)}`,
    win: `${window.innerWidth}×${window.innerHeight}`,
  };
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
  // 七色圆球在订阅墙后面。这里直接把权益写进去，不去兑一张码——码是一次性
  // 的，兑一次少一张，这个脚本就变成「一轮服务器只能跑一次」了。要验的是排
  // 版，不是那道门（那道门有 check-creem-gate 和 check-bind-race 管）。
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'ROTCHECK',
  }));
});
const page = await ctx.newPage();
// ---- 竖屏开一局 --------------------------------------------------------
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
const opened = await page.$$eval('.home-icon-btn', (els) => {
  const hit = els.find((e) => (e.getAttribute('aria-label') || '').startsWith('七色圆球'));
  if (!hit) return false;
  hit.click();
  return true;
});
check('点得开七色圆球', opened);
if (!opened) { await browser.close(); process.exit(1); }
await page.waitForFunction(() => document.querySelectorAll('#boardWrap .ball').length > 0, { timeout: 25000 });
await page.waitForTimeout(1200);

const before = await page.evaluate(MEASURE);
console.log('   竖屏开局：', JSON.stringify(before));
check('竖屏：棋子都在地板里', before && before.over <= TOL, before ? `越界 ${before.over}px` : '量不到');
check('竖屏：菱形立着（高的那一头顺着屏幕的长边）', before && !before.lying, before?.span);

// ---- 转成横屏，什么都不碰 ----------------------------------------------
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(1500);
const land = await page.evaluate(MEASURE);
console.log('   转横屏、没操作：', JSON.stringify(land));
check('转成横屏、还没碰它：棋子都在地板里', land && land.over <= TOL, land ? `越界 ${land.over}px` : '量不到');
check('转成横屏、还没碰它：菱形躺下了', land && land.lying, land?.span);

// ---- 碰一下（一次真实的拖拽）再量 --------------------------------------
const box = await page.$eval('.app--game .board-wrap', (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x + 40, box.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(900);
const touched = await page.evaluate(MEASURE);
console.log('   碰过之后：', JSON.stringify(touched));
check('碰过之后：棋子都在地板里', touched && touched.over <= TOL, touched ? `越界 ${touched.over}px` : '量不到');

// ---- 再转回竖屏，还是什么都不碰 ----------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1500);
const back = await page.evaluate(MEASURE);
console.log('   转回竖屏、没操作：', JSON.stringify(back));
check('转回竖屏、还没碰它：棋子都在地板里', back && back.over <= TOL, back ? `越界 ${back.over}px` : '量不到');
check('转回竖屏、还没碰它：菱形又立起来了', back && !back.lying, back?.span);


// ---- 真机那一下：转屏时 window 的尺寸慢半拍 --------------------------------
// 桌面 Chromium 的 setViewportSize 是原子的——尺寸和重排同一刻生效，所以上面
// 那几步在这儿永远是绿的，真机上却不是。iOS 转屏时外面那圈浏览器边框还在动画
// 里，innerWidth/innerHeight 报的还是旧的，而页面已经按新尺寸重排完了。排版
// 要是去问 window，就会拿着新的地板、旧的方向，把菱形照上一个方向摆下去；等
// 那两个数追上来，也没有任何事件会再触发一次重排。所以这里把它们按住不放，
// 逼出真机的那一下。
await page.evaluate(() => {
  window.__lag = { w: window.innerWidth, h: window.innerHeight };
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => window.__lag.w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => window.__lag.h });
});
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(1500);
const lag = await page.evaluate(MEASURE);
console.log('   窗口慢半拍 + 转横屏、没操作：', JSON.stringify(lag));
check('窗口尺寸慢半拍也照样躺下（排版只认地板，不问 window）', lag && lag.lying, lag?.span);
check('窗口尺寸慢半拍：棋子都在地板里', lag && lag.over <= TOL, lag ? `越界 ${lag.over}px` : '量不到');
// 菱形躺下之后该把地板铺满——立着摆的话这个数会掉到一半以下，光看「在不在
// 地板里」是抓不住的（立着的菱形又窄又高，怎么摆都不越界）。
const spanW = lag ? Number(lag.span.split('×')[0]) : 0;
const floorW = lag ? Number(lag.floor.split('×')[0]) : 1;
check('躺下之后铺开的宽度对得上地板（不是缩在中间那一条）',
  spanW / floorW > 0.6, `${spanW}/${floorW} = ${(spanW / floorW).toFixed(2)}`);

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
