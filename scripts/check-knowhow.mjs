/**
 * 新手拦截底下那颗《我会玩》。
 *
 *   node scripts/dev-server.mjs 8953 dist
 *   node scripts/check-knowhow.mjs http://localhost:8953/ xhs/preview.html
 *
 * 第二个参数是小红书那一版的预览页，给了就连着验——玩家要的是「**所有版本**的
 * 新手拦截下方」，两端各写一遍断言迟早会漏一端。**注意**：预览页是
 * `npm run preview:xhs` 单独出的（`build:xhs` 不重出），不先跑它这一半量的是上
 * 一版。
 *
 * 玩家 2026-09 定的那一条有两半，而且两半会互相打架，所以要一起量：
 *
 *   ① 按下去**立刻**跳过所有引导的锁——主菜单不再只让点基础方块和基础小球，
 *     那圈指路的光也撤掉，按钮自己也不该再在（引导没在拦却摆着一颗跳过引导的
 *     按钮，正是玩家点名不要的「意料之外的界面」）。
 *   ② **每个玩法头一回进去自带的教学照旧**（玩家原话：「第一次点击开每个玩法
 *     还是会触发自带的教学」）。这一条最容易被顺手做掉：把「跳过引导」实现成
 *     「把所有 firstTimeIn 都记成已看过」就一次性把教学条也关了，而且不会报
 *     错、不会白屏——只是新人从此再也没人教。所以这道门专门去看教学条还在不在。
 *
 * 另外量两件小事：它是真的跳过了（刷新之后还算跳过，不是这一屏的临时状态）、
 * 它的热区不小于 44px（看着小不等于按着小）。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8953/';
const XHS = process.argv[3] || '';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 一台全新的手机：没有任何存档，只把语言和开场动画跳过。
 *
 * **只在头一次导航清空**（拿 sessionStorage 当哨兵）。`addInitScript` 是每次导
 * 航都跑的，写成无条件 `localStorage.clear()` 就会在刷新那一步把刚才按下的
 * 《我会玩》连带清掉——这道门第一版正是这样，于是「刷新之后还算跳过」红了两
 * 条，而后面「教学条照旧」那一条反倒变成假绿（它量的是没按过的状态）。
 */
async function freshPage(ctx) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (sessionStorage.getItem('gate_primed') === '1') return;
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    sessionStorage.setItem('gate_primed', '1');
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(400);
  return page;
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
ctx.on('page', (p) => p.on('pageerror', (e) => errs.push(e.message)));

// ── 1. 新人一进来：拦着，而且摆着那颗按钮 ───────────────────────────
let page = await freshPage(ctx);
{
  const seen = await page.evaluate(() => {
    const b = document.querySelector('.know-how-btn');
    const r = b?.getBoundingClientRect();
    const glow = document.querySelectorAll('.home-icon-btn--glow').length;
    return { text: b?.textContent?.trim() || '', h: r?.height || 0, w: r?.width || 0, top: r?.top ?? -1, glow };
  });
  check('新人的主菜单上有《我会玩》', seen.text === '我会玩', JSON.stringify(seen.text));
  check('热区不小于 44px（看着小，按着不小）', seen.h >= 44, `${seen.h.toFixed(1)}px 高 × ${seen.w.toFixed(1)}px 宽`);
  check('这时候两张基础卡还镶着光', seen.glow === 2, `${seen.glow} 张`);

  // 它摆在整张菜单的下方，而且在法务那五条链接**之上**——那五条要留在最底下
  // （收单方的审核要一眼看见）。
  const order = await page.evaluate(() => {
    const b = document.querySelector('.know-how-btn');
    const legal = document.querySelector('.home-legal');
    const grid = document.querySelector('.home-grid');
    if (!b || !legal || !grid) return null;
    return {
      belowGrid: b.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom - 1,
      aboveLegal: b.getBoundingClientRect().bottom <= legal.getBoundingClientRect().top + 1,
    };
  });
  check('摆在菜单下方、法务链接之上', order?.belowGrid === true && order?.aboveLegal === true, JSON.stringify(order));

  // 拦着：按一张不该点的卡，不会开局。
  await page.click('.home-icon-btn[aria-label^="菱形方块"]').catch(() => {});
  await page.waitForTimeout(900);
  const stillMenu = await page.evaluate(() => !!document.querySelector('.home-grid'));
  check('按别的玩法开不起来（锁在拦着）', stillMenu);
}

// ── 2. 按下去：锁、光、按钮自己，一起撤掉 ────────────────────────────
{
  await page.click('.know-how-btn');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    btn: !!document.querySelector('.know-how-btn'),
    glow: document.querySelectorAll('.home-icon-btn--glow').length,
    menu: !!document.querySelector('.home-grid'),
  }));
  check('按完按钮自己不在了', after.btn === false);
  check('按完那圈指路的光也撤了', after.glow === 0, `${after.glow} 张`);
  check('按完还在主菜单上（不是跳到别处去了）', after.menu);

  // 真的解锁了：刚才按不开的那一张现在按得开。
  await page.click('.home-icon-btn[aria-label^="菱形方块"]');
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #startBtn').length > 0,
    { timeout: 15000 },
  ).catch(() => {});
  const opened = await page.evaluate(
    () => !document.querySelector('.home-grid') || !!document.querySelector('#startBtn'),
  );
  check('刚才按不开的那一张现在开得了', opened);
}

// ── 3. 刷新之后还算跳过（记住了，不是这一屏的临时状态）─────────────
{
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    btn: !!document.querySelector('.know-how-btn'),
    glow: document.querySelectorAll('.home-icon-btn--glow').length,
  }));
  check('刷新之后按钮不再出现', after.btn === false);
  check('刷新之后光也不再出现', after.glow === 0, `${after.glow} 张`);
}

// ── 4. 关键的那一半：自带的教学**照旧** ─────────────────────────────
//
// 按过《我会玩》的人第一次点开基础方块，棋盘底下那块教学条还是要在。把「跳过
// 引导」实现成「把 firstTimeIn 全记成已看过」就会在这儿露出来。
{
  await page.click('.home-icon-btn[aria-label^="方块"]');
  await page.waitForTimeout(900);
  if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 });
  await page.waitForTimeout(1500);
  const coach = await page.evaluate(() => {
    const el = document.querySelector('.coach-bar');
    return { there: !!el, text: (el?.textContent || '').slice(0, 20) };
  });
  check('按过《我会玩》，头一回开方块照样有教学条', coach.there, JSON.stringify(coach.text));
}
await page.close();

// ── 5. 引导没在拦的时候，不该摆这颗按钮 ─────────────────────────────
{
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    if (sessionStorage.getItem('gate_primed') === '1') return;
    sessionStorage.setItem('gate_primed', '1');
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    // 已经打过一局方块：锁本来就该撤了（lockedForFirstPlay 判的是这两把钥匙）。
    localStorage.setItem('slides_played_square', '1');
  });
  await p2.goto(BASE, { waitUntil: 'load' });
  await p2.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await p2.waitForTimeout(400);
  const shown = await p2.evaluate(() => !!document.querySelector('.know-how-btn'));
  check('打过一局的人看不到这颗按钮（锁本来就撤了）', shown === false);
  await p2.close();
}

// ── 6. 小红书那一版 ─────────────────────────────────────────────────
//
// 那一版的「新手拦截」不是锁——五张卡一直点得开，压暗只是路标（xhs/src/menu.ts
// 的 dim）。所以这儿量的是「压暗撤没撤」，不是「开不开得了」。
if (XHS) {
  console.log('\n---- 小红书版 ----');
  const p3 = await ctx.newPage();
  p3.on('pageerror', (e) => errs.push('xhs: ' + e.message));
  await p3.addInitScript(() => {
    localStorage.clear();
    // 头一局小球已经打过 → 直接进主菜单；方块还没打过 → 压暗还在。
    localStorage.setItem('slides.xhs.firstRun', '1');
  });
  await p3.goto('file://' + (XHS.startsWith('/') ? XHS : process.cwd() + '/' + XHS), { waitUntil: 'load' });
  // 等卡片，不是等一个固定的毫秒数：那一版开机有一段开场动画，写死 2500ms 会在
  // 动画还没播完时量到一张空页面，然后红得莫名其妙（这道门第一版就是这样）。
  await p3.waitForSelector('.home-icon-btn', { timeout: 30000 }).catch(() => {});
  await p3.waitForTimeout(600);
  const dimmedNow = () =>
    p3.evaluate(() => [...document.querySelectorAll('.home-icon-btn')].filter((e) => /dim/.test(e.className)).length);
  const shot = await p3.evaluate(() => {
    const b = document.querySelector('.know-how-btn');
    const r = b?.getBoundingClientRect();
    return { text: b?.textContent?.trim() || '', h: r?.height || 0, cards: document.querySelectorAll('.home-icon-btn').length };
  });
  const dim0 = await dimmedNow();
  check('小红书版主菜单上也有《我会玩》', shot.text === '我会玩', JSON.stringify({ 文字: shot.text, 卡: shot.cards, 压暗: dim0 }));
  check('小红书版热区不小于 44px', shot.h >= 44, `${shot.h.toFixed(1)}px`);
  check('小红书版这时候确实压着暗（拦截在生效）', dim0 > 0, `${dim0} 张`);
  if (shot.text === '我会玩') {
    await p3.click('.know-how-btn');
    await p3.waitForTimeout(800);
    const after = await p3.evaluate(() => ({
      btn: !!document.querySelector('.know-how-btn'),
      cards: document.querySelectorAll('.home-icon-btn').length,
    }));
    check('小红书版按完按钮自己不在了', after.btn === false);
    check('小红书版按完压暗撤了', (await dimmedNow()) === 0, `压暗 ${dim0} → ${await dimmedNow()}`);
    check('小红书版按完还在主菜单上', after.cards >= 4, `${after.cards} 张卡`);
  }
  await p3.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
