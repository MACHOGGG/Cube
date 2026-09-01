/**
 * 手指落下之后、牌动起来之前的那一小段。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-drag.mjs http://localhost:8815/
 *
 * 抓哪一颗原本是在手指落下那一瞬间定死的，而且在拖出死区之前屏幕上什么都不
 * 变——落点差两三个像素跨过格子边界就抓了隔壁，人要等牌动起来才发现。现在
 * 有两件事：按下就在那一颗身上挂个记号，以及死区里还能改抓。
 *
 * 第三条是给「改抓」留的岗哨，也是这里最要紧的一条：从格子正中按下、在死区
 * 里往前走一小段，那是一笔划的开头，不是改抓，抓的绝不能跟着变。死区一旦调
 * 得比半个格子还大，这条就会红。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
await ctx.addInitScript(() => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));

const PIECES = '#boardWrap .tile, #boardWrap .ball, #boardWrap .tri';
const marked = () => page.$$eval('.piece-grabbed', (els) => els.map((e) => `${e.dataset.r},${e.dataset.c}`));

/** 开一局，返回中间那一颗的位置和大小。 */
async function openBoard(n) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.$$eval('.home-icon-btn', (els, i) => els[i].click(), n);
  await page.waitForSelector('#startBtn', { timeout: 15000, state: 'attached' });
  await page.$eval('#startBtn', (el) => el.click());
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, PIECES, { timeout: 20000 });
  await page.waitForTimeout(700);
  return page.$$eval(PIECES, (els) => {
    const e = els[Math.floor(els.length / 2)];
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, at: `${e.dataset.r},${e.dataset.c}` };
  });
}

// ---- 1. 按下就知道抓的是哪一颗 --------------------------------------------
{
  const box = await openBoard(0);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(110);
  const on = await marked();
  check('按下去就在那一颗身上挂了记号', on.length === 1 && on[0] === box.at, `${on} vs ${box.at}`);

  // ---- 4. 拖出死区，整条线都在动了，记号退场 ----
  await page.mouse.move(box.x + box.w * 1.5, box.y, { steps: 8 });
  await page.waitForTimeout(120);
  check('拖起来之后记号退场', (await marked()).length === 0);
  await page.mouse.up();
  await page.waitForTimeout(600);
  check('松开之后不留痕迹', (await marked()).length === 0);
}

// ---- 2. 落在边界附近：死区里蹭一下就能改抓 --------------------------------
{
  const box = await openBoard(0);
  const edgeY = box.y + box.h / 2 - 3; // 离下边界 3px，正是最容易抓错的落点
  await page.mouse.move(box.x, edgeY);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const first = await marked();
  await page.mouse.move(box.x, edgeY + 8); // 还在死区里，越过那条边界
  await page.waitForTimeout(90);
  const second = await marked();
  check('落在边界附近时，死区里蹭一下能改抓',
    first.length === 1 && second.length === 1 && first[0] !== second[0], `${first} → ${second}`);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

// ---- 3. 一笔划的开头不算改抓 ----------------------------------------------
//
// 这一条是上一条的反面，也是真正的边界条件：从格子正中按下往前走，那是这一
// 笔的开头。死区（11px）必须明显小于半个格子，否则每一次正常拖动都会在开头
// 把抓的换掉——那比抓错还糟，因为它连「你按的是哪一颗」都不作数了。
for (const [name, idx] of [['方块', 0], ['三角', 2]]) {
  const box = await openBoard(idx);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const at0 = await marked();
  await page.mouse.move(box.x + 10, box.y);
  await page.waitForTimeout(90);
  const at10 = await marked();
  await page.mouse.up();
  await page.waitForTimeout(300);
  check(`${name}：从正中按下、死区里走 10px，抓的不变`,
    String(at0) === String(at10) && at0.length === 1,
    `格宽 ${Math.round(box.w)}px · ${at0} → ${at10}`);
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
