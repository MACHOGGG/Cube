/**
 * 暂停到底停住了没有：连锁、计时、判死局。
 *
 *   node scripts/dev-server.mjs 8971 dist
 *   node scripts/check-pause-freeze.mjs http://localhost:8971/      （只写端口号 8971 也认）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 玩家撞上的是这两件事：
 *
 *   · 滑出一步能连锁好几拍的棋，这时候手机来电（自动暂停）、或者手一抖按了
 *     暂停——遮罩盖上了，可连锁、加分、判死局都在遮罩背后接着跑，最后可能在
 *     他完全没看见的情况下自己弹出结算页。
 *   · 结算页上那个「用时」把暂停/切后台的那一段也算了进去。（用时从《侵蚀阶
 *     梯》§5 起不再计分，但它照旧记在战绩里、印在战绩图和记录页上，所以「暂
 *     停那一段不许算进去」这件事一点没变。）
 *
 * **开的是《计时挑战》，不是基础方块。** PR-7 之后基础局屏幕上干脆没有时间读数
 * 了——那是玩家定的（「留一个一直在涨、却不算分的数，只会让人以为快慢有用」，见
 * gameController 那段注释）。于是「表停了没有」只在唯一还有读数的那一档量得到：
 * 计时那一档，暂停药丸正上方那块 `#timerPill`。
 *
 * 这一条从前读的是顶排那个 `#hud-time`。那个 id 没被删，而是**改用了**：现在只
 * 在步步为营那一档生成，印的是余步（gameShell.ts 里那个三目）。在基础局里它根本
 * 不存在，于是这道门三条里有三条一直红着——红得没错（它有一条 `before !== ''` 的
 * 尺子挡着），但红的原因和被测的东西无关，而那样的红最后一定会被人关掉。
 *
 * 这一台不去点棋盘（各玩法的拖拽手感不一样，点不准），直接问引擎：暂停之
 * 后，那一拍的定时器还在不在、表还走不走。两件事各验一遍：
 *
 *   1. 暂停中：倒计时读数原地不动（等两秒再读一次，还是同一个数）。
 *   2. 暂停中：连锁那一拍被收起来了（controller 里没有在跑的 setTimeout），
 *      《继续》之后接着走完，分数照旧。
 *
 * 第 2 条靠的是把 window.setTimeout 记一笔账：暂停之前引擎排了几拍、暂停之
 * 后还剩几拍没被清掉。真要复现「连锁跑到一半按暂停」得先在棋盘上摆出连锁，
 * 那是各玩法自己的事；这里量的是引擎那一层——connect 上去的是同一套 beat。
 *
 * 4、5 两节是**拖到一半**（10-11 方案 B-4）：手指还按在棋盘上，暂停了 / 钟响了，然后才松手。原先六副棋盘都是先
 * 改网格、再交给控制器结算，而控制器遇到暂停直接回去——线挪了、步数没记、拼好的不结算，盘上还剩两枚预览的影子。
 *
 *   4. 基础方块：拖着走两格 → 暂停 → 松手。暂停中盘面一枚不动、没有多出来的影子；《继续》之后这一步落下去
 *      （盘面变了），交卷时步数是 1（结算页「步数系数（1步，……）」）。
 *   5. 计时方块：拖着走两格 → 钟响（假钟快进过 100 秒） → 松手。盘面一枚不动、没有多出来的影子。
 *
 * 这两节是真拖（鼠标的 pointer 事件，和手指走同一套 engine/drag.ts），认棋子靠方块身上那个 data-id。
 * ─────────────────────────────────────────────────────────────────────────
 */
import { chromium } from 'playwright';

// 收端口号（老写法）或者整个地址（ci-browser.mjs 给的是地址）。
const arg = process.argv[2] || '8971';
const BASE = /^\d+$/.test(arg) ? `http://127.0.0.1:${arg}` : arg.replace(/\/+$/, '');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

// 语言选好、三族教学都看过：直接落在主菜单上。
await p.addInitScript(() => {
  try {
    // 'zhHans'，不是 'zh-Hans'。写错的那一版等于没写：语言回落到英文，而这一台此前
    // 靠 `(it || els[0]).click()` 的兜底照样点到了第一张卡，所以一直没露出来。
    localStorage.setItem('slides_lang', 'zhHans');
    for (const k of ['square', 'circle', 'triangle']) localStorage.setItem('slides_tutorial_seen_' + k, '1');
    for (const k of ['square', 'circle', 'bomb', 'slot', 'flip', 'timed', 'layout', 'endcard']) {
      localStorage.setItem('slides_played_' + k, '1');
    }
  } catch {
    /* 无痕窗口：这一台跑不成，但产品照旧 */
  }
});

// 记一笔 setTimeout 的账，好数「还有几拍没到点」。
await p.addInitScript(() => {
  const live = new Set();
  const rawSet = window.setTimeout;
  const rawClear = window.clearTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    const id = rawSet.call(
      window,
      (...a) => {
        live.delete(id);
        return typeof fn === 'function' ? fn(...a) : undefined;
      },
      ms,
      ...rest,
    );
    live.add(id);
    return id;
  };
  window.clearTimeout = function (id) {
    live.delete(id);
    return rawClear.call(window, id);
  };
  window.__liveTimeouts = () => live.size;
});

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.home-icon-btn', { timeout: 40000 });

// 开一局《计时挑战》的方块：全站只有这一档屏幕上有时间读数（见开头那段）。
//
// 主菜单那张卡要**在页面里**自己 click()：主菜单是鱼眼滚轴，离焦点远的卡真的坐在
// 视口外面，page.click 会滚不进来、一直重试到超时。
// 认的是**类名**不是 aria-label：标签跟着语言变，类名不变（check-menu 也认这个）。
await p.$$eval('.home-icon-btn--timed', (els) => els[0]?.click());
await p.waitForSelector('.timed-page #timedShapes', { timeout: 30000 });
await p.$eval('#timedShapes .slot-pick-opt[data-family="square"]', (e) => e.click());
await p.waitForSelector('#startBtn', { state: 'attached', timeout: 30000 });
await p.$eval('#startBtn', (e) => e.click());
await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .cell').length > 0, { timeout: 40000 });
await p.waitForTimeout(2500);

// 读的是暂停药丸正上方那块（`#timerPill`）。`.catch(() => '')` 留着，但下面每一条
// 都带一条「读到的不是空」的尺子——读不到的时候要红，而且要红在「读不到」这件事上。
const clock = () => p.$eval('#timerPill', (e) => (e.textContent || '').trim()).catch(() => '');

// ---------------------------------------------------------------------------
// 1. 暂停中，秒表原地不动
// ---------------------------------------------------------------------------
const before = await clock();
// 尺子单独摆一条：读不到的时候「不走」是恒真的，而那正是这道门红了一整版的原因。
check('屏幕上真有一个时间读数可读（尺子）', before !== '', before || '（#timerPill 读不到）');
await p.$eval('#stopBtn', (e) => e.click());
await p.waitForTimeout(2600);
const during = await clock();
check('暂停中秒表不走', before !== '' && before === during, `按下前 ${before} → 停了 2.6 秒后 ${during}`);

// ---------------------------------------------------------------------------
// 2. 暂停中，引擎没有留着在跑的拍子
// ---------------------------------------------------------------------------
//
// 量的是「暂停之后又过了 3 秒，还有没有新的定时器落地」。连锁那一拍要是没被
// 收起来，它到点就会 run() 并且排下一拍——账上的数字会一直变。
const t1 = await p.evaluate(() => window.__liveTimeouts());
await p.waitForTimeout(3000);
const t2 = await p.evaluate(() => window.__liveTimeouts());
check('暂停中没有一直自我续命的拍子', Math.abs(t2 - t1) <= 2, `${t1} → ${t2}`);
check('暂停中没有自己弹出结算页', !(await p.$('#endPanel.show, .end-panel.show')), '');

// ---------------------------------------------------------------------------
// 3. 《继续》之后表接着走，而且没有把暂停那 5.6 秒补算进来
// ---------------------------------------------------------------------------
await p.$eval('#continueBtn', (e) => e.click());
await p.waitForTimeout(2200);
const after = await clock();
const secs = (t) => {
  const m = /(\d+):(\d+)/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
// **这一档是倒计时**，读数是往下走的，所以量的是「掉了多少」。（从前这一条按
// 正计时写成 after − before，换到计时那一档之后要跟着翻过来，不然永远是负数。）
const dropped = secs(before) - secs(after);
check('《继续》之后表接着走', Number.isFinite(dropped) && dropped > 0, `${before} → ${after}`);
check('暂停的那 5.6 秒没有被补算进来', Number.isFinite(dropped) && dropped <= 4, `掉了 ${dropped} 秒（放行 ≤4）`);

check('这一路零报错', errs.length === 0, errs.slice(0, 2).join(' | '));

// ---------------------------------------------------------------------------
// 4、5. 拖到一半暂停 / 钟响（10-11 方案 B-4）
// ---------------------------------------------------------------------------
const seed = () => {
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['square', 'circle', 'triangle']) localStorage.setItem('slides_tutorial_seen_' + k, '1');
  for (const k of ['square', 'circle', 'bomb', 'slot', 'flip', 'timed', 'layout', 'endcard', 'totaltip', 'finished']) {
    localStorage.setItem('slides_played_' + k, '1');
  }
};
/** 每一枚方块此刻坐在哪一格（data-id → 「行,列」）。 */
const seats = (page) => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('#boardWrap .tile[data-id]')].map((e) => [e.dataset.id, `${e.dataset.r},${e.dataset.c}`])));
/** 棋盘上一共几块（拖动预览的影子也是 .tile）。 */
const tiles = (page) => page.evaluate(() => document.querySelectorAll('#boardWrap .tile').length);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 第 2 行第 1 列那一枚按住，往右拖两格，不松手。 */
async function dragTwo(page) {
  const at = (r, c) => page.$eval(`#boardWrap .tile[data-r="${r}"][data-c="${c}"]`, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  const a = await at(2, 1);
  const pitch = (await at(2, 2)).x - a.x;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + (pitch * 2 * i) / 12, a.y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(200);
}
async function openSquare(page, timed) {
  if (timed) {
    await page.$$eval('.home-icon-btn--timed', (els) => els[0]?.click());
    await page.waitForSelector('.timed-page #timedShapes', { timeout: 30000 });
    await page.$eval('#timedShapes .slot-pick-opt[data-family="square"]', (e) => e.click());
    await page.waitForSelector('#startBtn', { state: 'attached', timeout: 30000 });
    await page.$eval('#startBtn', (e) => e.click());
  } else {
    await page.evaluate(() => document.querySelector('.home-icon-btn[data-first-playable="1"]')?.click());
  }
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile[data-id]').length > 0, null, { timeout: 40000 });
  await page.waitForTimeout(1200);
}

{
  const c4 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c4.addInitScript(seed);
  const q = await c4.newPage();
  const e4 = [];
  q.on('pageerror', (e) => e4.push(String(e)));
  await q.goto(BASE, { waitUntil: 'domcontentloaded' });
  await q.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await openSquare(q, false);
  const n0 = await tiles(q);
  const s0 = await seats(q);
  await dragTwo(q);
  await q.evaluate(() => document.getElementById('stopBtn').click());
  await q.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await q.mouse.up();
  await q.waitForTimeout(1500);
  check('4（尺子）拖之前盘上有一副方块', n0 >= 16 && Object.keys(s0).length === n0, `${n0} 块`);
  check('4 拖到一半暂停、松手：暂停中盘面一枚不动', same(await seats(q), s0));
  check('4 暂停中没有多出来的影子', (await tiles(q)) === n0, `${await tiles(q)} / ${n0}`);
  await q.evaluate(() => document.getElementById('continueBtn').click());
  await q.waitForTimeout(2500);
  check('4 《继续》之后这一步落下去了（盘面变了）', !same(await seats(q), s0));
  check('4 《继续》之后也没有影子', (await tiles(q)) === n0, `${await tiles(q)} / ${n0}`);
  await q.evaluate(() => document.getElementById('stopBtn').click());
  await q.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await q.evaluate(() => document.getElementById('pauseFinishBtn').click());
  await q.waitForSelector('#endOverlay.show', { timeout: 15000 });
  const steps = await q.$eval('#endBreakdown', (e) => (/（(\d+)步/.exec(e.textContent || '') || [])[1] ?? '');
  check('4 交卷：这一步记上了（步数 1）', steps === '1', `步数 ${steps || '读不到'}`);
  check('4 零报错', e4.length === 0, e4.slice(0, 2).join(' | '));
  await c4.close();
}
{
  const c5 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c5.addInitScript(seed);
  const q = await c5.newPage();
  const e5 = [];
  q.on('pageerror', (e) => e5.push(String(e)));
  // 计时那一档 100 秒：假钟装上，拖到一半的时候快进过去，不真等。
  await q.clock.install();
  await q.goto(BASE, { waitUntil: 'domcontentloaded' });
  await q.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await openSquare(q, true);
  const n0 = await tiles(q);
  const s0 = await seats(q);
  await dragTwo(q);
  await q.clock.fastForward(101_000);
  const rang = await q.waitForSelector('#endOverlay.show', { timeout: 15000 }).then(() => true).catch(() => false);
  await q.mouse.up();
  await q.waitForTimeout(1500);
  check('5（尺子）拖到一半钟响了：结算页出来了', rang);
  check('5 钟响之后松手：盘面一枚不动', same(await seats(q), s0));
  check('5 钟响之后松手：没有多出来的影子', (await tiles(q)) === n0, `${await tiles(q)} / ${n0}`);
  check('5 零报错', e5.length === 0, e5.slice(0, 2).join(' | '));
  await c5.close();
}

await browser.close();
console.log(fail ? `\n${fail} 项没过。` : '\n全部通过。');
process.exit(fail ? 1 : 0);
