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

/**
 * 点主菜单上的一张玩法卡。
 *
 * 手机竖屏的主菜单是那条鱼眼轴（`.mode-axis`），它铺满整幅宽、自己收手势，离焦
 * 点远的卡因此吃不到指针事件——Playwright 的 `page.click()` 会一路重试到超时，
 * 报「`#homeGrid` intercepts pointer events」。玩家在真机上是先滑到那一张再点，
 * 这道门量的不是轴（那是 check-mode-axis 的活），是「按下去之后会怎样」，所以
 * 直接在按钮上派发 click，不复刻滑动那一段。
 *
 * 找不到那张卡就返回 false（首玩期轴上只摆基础方块和基础小球两张，别的玩法根本
 * 不在 DOM 里）——调用方据此判断，而不是吞掉一个超时。
 */
async function clickCard(page, label) {
  const el = await page.$(`.home-icon-btn[aria-label^="${label}"]`);
  if (!el) return false;
  await el.evaluate((e) => e.click());
  return true;
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
    const glow = new Set([...document.querySelectorAll('.home-icon-btn--glow')].map((e) => e.dataset.stripIdx ?? e.getAttribute('aria-label'))).size;
    // 轴上这一项是被鱼眼缩放过的，屏幕上的高度＝版面高度 × 这一帧的 scale。量
    // 「热区够不够 44px」要看**版面**高度：它离中线远的时候本来就该小一圈，滑到
    // 中线上又会胀到 44×1.6。除掉 scale 才是那个不变量。
    const sc = Number((b?.style.transform.match(/scale\(([\d.]+)\)/) || [0, '1'])[1]) || 1;
    return {
      text: b?.textContent?.trim() || '',
      h: (r?.height || 0) / sc, w: (r?.width || 0) / sc, scale: sc,
      top: r?.top ?? -1, glow,
    };
  });
  check('新人的主菜单上有《我会玩》', seen.text === '我会玩', JSON.stringify(seen.text));
  check('热区不小于 44px（看着小，按着不小）', seen.h >= 44, `版面 ${seen.h.toFixed(1)}px 高 × ${seen.w.toFixed(1)}px 宽（这一帧 scale ${seen.scale}）`);
  /*
   * 带子上的东西摆了**两份**（无缝循环靠的就是这个，见 engine/marquee.ts），
   * 所以得按 data-strip-idx 去重。不去重的话这儿量出来是 4，而它并不是「多了
   * 两张发光的卡」，是同两张各有一个分身。
   */
  check('这时候两张基础卡还镶着光', seen.glow === 2, `${seen.glow} 张`);

  /**
   * 它在轴上的**位置**：两张基础卡之后、其余玩法之前。
   *
   * 口径 2026-09 第五轮定的（玩家原话：「在基础的方块、小球玩法下面写着『我会
   * 玩』，下面是其他的玩法」）。前两轮它先是页面下方的一颗按钮、又是浮在底排上
   * 方的一颗；现在它是**链条里的一环**，所以量的是「第几项」，不再是「在谁下面
   * 多少像素」——轴上每一项的屏幕位置随时在变，量像素等于量这一帧的运气。
   *
   * 热区那一条（上面）和「按下去解锁」那一条（下面）没变：它仍然是跳过引导的唯
   * 一出口。
   */
  const order = await page.evaluate(() => {
    const host = document.querySelector('.home-grid');
    const b = document.querySelector('.know-how-btn');
    if (!host || !b) return null;
    /*
     * 只看**真身那一份**。
     *
     * 带子（.mode-strip）把内容摆了两份，第二份是 `cloneNode` 出来的画（整个
     * aria-hidden）。两份一起数的话，十四张卡数出二十八张、两张发光的数出四张
     * ——都不是真的多了，是同一件东西的分身。
     */
    const copy = host.querySelector('.marquee-copy') || host;
    const cards = [...copy.children].filter((e) => e.classList.contains('home-icon-btn'));
    const box = b.closest('.axis-divider') || b;
    /*
     * 量的是「它夹在能玩的和锁着的之间」。用**布局坐标**（offsetTop）而不是屏幕
     * 坐标：带子每帧都在走，屏幕坐标量的是这一帧的运气。
     */
    const ly = (e) => e.offsetTop + e.offsetHeight / 2;
    const my = ly(box);
    const before = cards.filter((e) => ly(e) < my);
    const after = cards.filter((e) => ly(e) > my);
    return {
      onStrip: host.classList.contains('mode-strip'),
      before: before.map((e) => (e.getAttribute('aria-label') || '').split(' ·')[0]),
      afterLocked: after.length > 0 && after.every((e) => e.classList.contains('home-icon-btn--locked')),
      stations: cards.length,
      inStrip: box.parentElement === copy,
    };
  });
  check(
    '《我会玩》就在两张基础卡下面（上头只有它们俩）',
    order?.before.length === 2,
    `上头有 ${order?.before.join(' ') || '（空）'}`,
  );
  check('它下面那些玩法这会儿都锁着', order?.afterLocked === true);
  if (order?.onStrip) {
    check('带子那一路：它就排在带子里（跟着一起滑）', order?.inStrip === true);
    // 一份里十四张卡：分界线不算一站。
    check('带子上还是十四项', order?.stations === 14, `${order?.stations} 项`);
  }

  /**
   * 拦着：按一张不该点的卡，不会开局。
   *
   * 这一条的口径也是第五轮换的。上一版轴上只摆那两张，所以量的是「别的玩法根本
   * 不在菜单上」；现在**全摆出来了，只是挂着锁**（玩家：「转盘也可以看到所有内容
   * 只是有锁而已」）。于是两样都要量：它在（找得到、有锁），以及按下去开不了局。
   *
   * 少了前一半，「按不开」会在卡片压根不存在时自动通过，量的是空气；少了后一
   * 半，锁就只是一张图。
   */
  const lockedCard = await page.evaluate(() => {
    // **直接子元素**，不是后代：炸弹那张卡里嵌着九颗小片，其中一颗的名字也叫
    // 「进阶炸弹 · 菱形方块」——按后代找会先撞上它（它是画不是控件，自然没有
    // 锁），于是这一条会莫名其妙地红。
    // 带子把内容摆了两份，只看真身那一份（第二份是 aria-hidden 的克隆）。
    const host = document.querySelector('.home-grid');
    const copy = host.querySelector('.marquee-copy') || host;
    const el = [...copy.children].find(
      (e) =>
        e.classList.contains('home-icon-btn') &&
        (e.getAttribute('aria-label') || '').includes('菱形方块'),
    );
    return el ? { there: true, locked: el.classList.contains('home-icon-btn--locked') } : { there: false };
  });
  check('首玩期别的玩法也摆在菜单上，只是挂着锁', lockedCard.there === true && lockedCard.locked === true, JSON.stringify(lockedCard));
  const reachable = await clickCard(page, '菱形方块');
  await page.waitForTimeout(900);
  const stillMenu = await page.evaluate(() => !!document.querySelector('.home-grid'));
  check('按别的玩法开不起来（锁在拦着）', stillMenu);
}

// ── 2. 按下去：锁、光、按钮自己，一起撤掉 ────────────────────────────
{
  // 轴上那一项多半在屏幕外（它是第 3 项），Playwright 的 click 会等它「进视口」
  // 然后超时。轴不是滚动容器，滚不出来——直接派发一次 click，和玩家滑过去按那一
  // 下是同一条路。
  await page.evaluate(() => document.querySelector('.know-how-btn').click());
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    btn: !!document.querySelector('.know-how-btn'),
    glow: new Set([...document.querySelectorAll('.home-icon-btn--glow')].map((e) => e.dataset.stripIdx ?? e.getAttribute('aria-label'))).size,
    menu: !!document.querySelector('.home-grid'),
  }));
  check('按完按钮自己不在了', after.btn === false);
  check('按完那圈指路的光也撤了', after.glow === 0, `${after.glow} 张`);
  check('按完还在主菜单上（不是跳到别处去了）', after.menu);

  // 真的解锁了：刚才按不开的那一张现在按得开。
  check('按完菱形方块出现在菜单上了', await clickCard(page, '菱形方块'));
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
    glow: new Set([...document.querySelectorAll('.home-icon-btn--glow')].map((e) => e.dataset.stripIdx ?? e.getAttribute('aria-label'))).size,
  }));
  check('刷新之后按钮不再出现', after.btn === false);
  check('刷新之后光也不再出现', after.glow === 0, `${after.glow} 张`);
}

// ── 4. 关键的那一半：自带的教学**照旧** ─────────────────────────────
//
// 按过《我会玩》的人第一次点开基础方块，棋盘底下那块教学条还是要在。把「跳过
// 引导」实现成「把 firstTimeIn 全记成已看过」就会在这儿露出来。
{
  await clickCard(page, '方块');
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
    await p3.evaluate(() => document.querySelector('.know-how-btn').click());
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
