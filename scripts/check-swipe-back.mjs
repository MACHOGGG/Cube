/**
 * 棋盘里的手指移动，会不会漏给浏览器。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-swipe-back.mjs http://localhost:8815/
 *
 * 安卓上横着一划会被浏览器当成「返回上一页」。挡住它的唯一办法是把 touchmove
 * 的默认行为吃掉——touch-action: none 不够，安卓的手势识别器不看它。
 *
 * 这里量的就是「吃掉了没有」：往棋盘里发一串真的触摸事件（走 CDP，不是
 * dispatchEvent 造的假事件），再在 window 上收一道，看 defaultPrevented。
 *
 * 两头都要验，缺一不可：
 *   · 棋盘里的移动，任何时候都得吃掉——包括这一刻棋盘并不收拖动的时候
 *     （上一步的连锁还在演、暂停、这一局已经结束）。从前那个 bug 就在这儿：
 *     只有正在拖的时候才吃，别的时候整串漏给浏览器。
 *   · 棋盘外的移动一个都不许吃——不然就成了「整页都不能动」，那是另一个 bug。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 收一道：window 冒泡阶段跑在棋盘那个监听器之后，读到的是最终结果。
const WATCH = () => {
  window.__moves = [];
  window.addEventListener('touchmove', (e) => {
    window.__moves.push(e.defaultPrevented);
  });
};

async function swipe(cdp, page, x, y, dx) {
  await page.evaluate(() => { window.__moves = []; });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 4, y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(120);
  return page.evaluate(() => window.__moves);
}

for (const vp of [
  { name: '竖屏 390×844', width: 390, height: 844 },
  { name: '横屏 844×390', width: 844, height: 390 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: true, isMobile: true,
  });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.$$eval('.home-icon-btn', (els) => els[0].click());
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
    { timeout: 25000 },
  );
  await page.waitForTimeout(900);
  await page.evaluate(WATCH);

  const board = await page.$eval('.app--game .board-wrap', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

  // 1) 正常在棋盘里横着划。
  let moves = await swipe(cdp, page, board.x, board.y, 60);
  check(`${vp.name}：棋盘里横划，每一下都拦住了`,
    moves.length > 0 && moves.every(Boolean), JSON.stringify(moves));

  // 2) 安卓真正会做的那一下：划到一半，浏览器认定这是它自己的手势，把指针
  //    收走（发一个 pointercancel），手指却还在屏幕上继续划。
  //
  //    从前那一版一旦收到 pointercancel，active 就落回 false，后面几帧的
  //    touchmove 全都不拦了——「返回上一页」正是在这几帧里走完的。所以这里
  //    先起一个正常的拖动，中途塞一个 pointercancel，再看剩下的拦不拦。
  await page.evaluate(() => { window.__moves = []; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: board.x, y: board.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: board.x + 12, y: board.y }] });
  await page.evaluate(() => {
    const wrap = document.querySelector('.app--game .board-wrap');
    wrap.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
  });
  for (let i = 2; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: board.x + i * 14, y: board.y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(120);
  const after = (await page.evaluate(() => window.__moves)).slice(1);
  check(`${vp.name}：浏览器中途抢走指针后，剩下的移动照样拦住`,
    after.length > 0 && after.every(Boolean), JSON.stringify(after));

  // 3) 棋盘外面（顶上那排读数）横划——这里一下都不许拦。
  const hud = await page.$eval('.app--game .stat, .app--game .hud, .app--game .controls', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }).catch(() => null);
  if (hud) {
    moves = await swipe(cdp, page, hud.x, hud.y, 60);
    check(`${vp.name}：棋盘外面横划，一下都没拦（没把整页锁死）`,
      moves.every((m) => m === false), JSON.stringify(moves));
  } else {
    console.log(`SKIP  ${vp.name}：找不到棋盘外的落点`);
  }
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
