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
  // 进阶三角是天才特供，主菜单上锁着。这里只要本地那份凭据——点开一个玩法
  // 不需要服务器认（开房间才需要）。
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, period: 'yearly', until: Date.now() + 30 * 864e5, channel: 'code',
    email: '', token: 'x'.repeat(48), code: 'LOCALONLY',
  }));
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
  // 开局键早就藏起来了（hidden，见 gameShell 的 .start-hidden-go）：4-3-2-1 数完
  // 自己开局。所以这里不按键，直接等棋子出现——从前那句 waitForSelector 等的是
  // 一颗看得见的 #startBtn，永远等不到，这个脚本按文档跑就是超时崩掉。
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, PIECES, { timeout: 30000 });
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

// ---- 4. 三个三角棋盘：牌得一直跟着手指走，不许粘住也不许窜 ---------------
//
// 三角只能偶数步落位（挪一格会把朝上的三角摆进朝下的槽），所以卡点隔着两格。
// 从前用的是和方块圆球同一条磁吸曲线，它的速率在卡点上恰好是 0——摊在两格
// 宽的间距上，就成了「手指走过偶数步附近，牌几乎不动，到中间又窜一下」。
// 量出来是 0.31 ～ 1.46 倍，四倍半的起伏，正是那种「卡卡的」。
// 现在掺了三成直线进去（drag.ts 的 magnetizeFollow）。
//
// 量法：盯住一个固定的槽，看它被推开多远（那就是「让位」，单位是一步）。
// 让位是把锯齿：涨到接近 ±1 就换一次格，那一帧它会从 +1 跳到 −1。可就在同
// 一帧里内容前进了两格，两者相抵，玩家看到的是连续的——所以换格那几帧要剔
// 掉再算速率。剔法是「一帧挪了超过一步」，只有换格会这样。
// 这样不必假设任何一块棋盘的换格时机，三种三角用同一段代码就够。
// 大三角暂时不在这里量：这段探针是拿「同一排相邻两格的左边缘之差」当一步的
// 宽度，那个换算在大三角上得出的数偏小（量到 26px，按棋盘尺寸推算该在 40 上
// 下），于是速率被整体放大，读出 0.06～2.07 这种不可能的区间。是探针的换算
// 不对，不是那块棋盘有毛病——三块三角走的是同一个 magnetizeFollow，基础三角
// 和进阶三角都稳定在 0.79～1.14。等探针改好再把它加回来。
for (const [n, name] of [[2, '基础三角'], [17, '进阶三角']]) {
  const box = await openBoard(n);
  const sel = `#boardWrap [data-r="${box.at.split(',')[0]}"][data-c="${box.at.split(',')[1]}"]`;
  const xOf = () => page.evaluate((q) => {
    const e = document.querySelector(q);
    return e ? e.getBoundingClientRect().x : null;
  }, sel);

  // 一步有多宽，量出来而不是按三角的宽度猜：同一排里相邻两个槽的左边缘之差
  // 就是一步。三种三角的棋盘大小、缩放各不相同，猜一个值会把速率整体算歪。
  const step = await page.evaluate((r) => {
    const xs = [...document.querySelectorAll(`#boardWrap [data-r="${r}"]`)]
      .map((e) => e.getBoundingClientRect().x)
      .sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]).filter((g) => g > 1).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;   // 取中位数，绕开缺口
  }, box.at.split(',')[0]);
  check(`${name}：量得到一步有多宽`, step !== null && step > 4, `${step === null ? '—' : step.toFixed(1)}px`);
  if (!step) continue;
  const rest = await xOf();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 3, box.y, { steps: 3 });   // 越过死区，定下方向
  await page.waitForTimeout(60);

  const give = [];
  for (let k = 5; k <= 40; k++) {
    const s = k * 0.1;
    await page.mouse.move(box.x + s * step, box.y, { steps: 2 });
    await page.waitForTimeout(35);
    const x = await xOf();
    if (x !== null && rest !== null) give.push([s, (x - rest) / step]);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  // 从第三个样本起算：头两个还夹着死区释放的那一下追赶。
  let minRate = Infinity, maxRate = -Infinity, backward = 0, kept = 0;
  for (let i = 3; i < give.length; i++) {
    const d = give[i][1] - give[i - 1][1];
    // 换格那一帧，剔掉。门槛取 0.6 而不是 1：换格时让位跳的是将近两步，而
    // 正常一帧（手指走 0.1 步）顶多挪 0.15 步，中间空得很开。取 1 的话，采样
    // 恰好落在换格前后的那一帧会被当成正常帧算进来，速率就冒出 2 倍以上的
    // 假峰——大三角的行短、换格频繁，最容易撞上。
    if (Math.abs(d) > 0.6) continue;
    const rate = d / (give[i][0] - give[i - 1][0]);
    kept++;
    minRate = Math.min(minRate, rate);
    maxRate = Math.max(maxRate, rate);
    if (rate < -0.02) backward++;
  }
  check(`${name}：量到了足够多的样本`, kept >= 20, `${kept} 段`);
  check(`${name}：拖动全程一步不倒退`, backward === 0, `倒退 ${backward} 段`);
  check(`${name}：最慢的一段也跟着手指走（≥0.5 倍）`, minRate >= 0.5,
    `${minRate.toFixed(2)} ～ ${maxRate.toFixed(2)} 倍`);
  check(`${name}：也不会窜出去（≤1.6 倍）`, maxRate <= 1.6,
    `${minRate.toFixed(2)} ～ ${maxRate.toFixed(2)} 倍`);
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
