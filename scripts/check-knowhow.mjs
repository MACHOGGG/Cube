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
 *   ① 按下去**立刻**跳过引导——10-31 方案推12 起主菜单一步一步出现（engine/menuStage.ts），《我会玩》＝直接到第 3 步：
 *     每日挑战、方块、小球、多人、计时、炸弹六张摆出来，那圈指路的光撤掉，按钮自己也不该再在（引导没在拦却摆着一颗
 *     跳过引导的按钮，正是玩家点名不要的「意料之外的界面」）。按钮只在第 1、2 步摆，在那一排卡的正下方（不再是轴
 *     上的分界线）。
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
/** 第 3 步网页主菜单上几张（每日挑战、方块、小球、多人、计时、炸弹）。钉死而不是从页面上数：哪天一张卡悄悄不见了，这儿会红。 */
const CARDS = 6;
/** 第 3 步小红书主菜单上几张（每日挑战＋六张玩法卡）。 */
const XHS_CARDS = 7;

const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 一台全新的手机：没有任何存档，只设语言。
 *
 * **只在头一次导航清空**（拿 sessionStorage 当哨兵）。`addInitScript` 是每次导航都跑的，写成无条件
 * `localStorage.clear()` 就会在刷新那一步把刚才按下的《我会玩》连带清掉。
 */
async function freshPage(ctx, preset = {}) {
  const page = await ctx.newPage();
  await page.addInitScript((kv) => {
    if (sessionStorage.getItem('gate_primed') === '1') return;
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    sessionStorage.setItem('gate_primed', '1');
  }, preset);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(400);
  return page;
}
const cardsOf = (p) => p.evaluate(() => [...document.querySelectorAll('#homeGrid [data-card]')].map((c) => c.dataset.card));
const glowOf = (p) => p.evaluate(() => [...document.querySelectorAll('#homeGrid .home-icon-btn--glow')].map((c) => c.dataset.card));
/** 在页面里派发 click（手机主菜单第 3 步起是鱼眼轴，离焦点远的卡吃不到指针事件——见 check-mode-axis）。 */
const tap = (p, card) => p.$eval(`#homeGrid [data-card="${card}"]`, (e) => e.click()).then(() => true).catch(() => false);

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
ctx.on('page', (p) => p.on('pageerror', (e) => errs.push(e.message)));

// ── 1. 新人一进来：第 1 步，摆着那颗按钮 ──────────────────────────────
let page = await freshPage(ctx);
{
  const seen = await page.evaluate(() => {
    const b = document.querySelector('.know-how-btn');
    const r = b?.getBoundingClientRect();
    const row = document.querySelector('.home-row--intro')?.getBoundingClientRect();
    return {
      text: b?.textContent?.trim() || '', h: r?.height || 0, w: r?.width || 0,
      cx: r ? r.left + r.width / 2 : 0, top: r?.top ?? -1, rowBottom: row?.bottom ?? 1e9, vw: document.documentElement.clientWidth,
      divider: !!document.querySelector('.axis-divider'),
    };
  });
  check('新人的主菜单（第 1 步）上有《我会玩》', seen.text === '我会玩', JSON.stringify(seen.text));
  check('热区不小于 44px 高', seen.h >= 44, `${seen.h.toFixed(1)}px`);
  check('宽只有字那么宽（不是横贯整屏的一条）', seen.w > 0 && seen.w <= 140, `${seen.w.toFixed(1)}px`);
  check('在那一排卡的正下方、居中', seen.top >= seen.rowBottom - 0.5 && Math.abs(seen.cx - seen.vw / 2) <= 2, JSON.stringify(seen));
  check('不再是轴上的分界线', !seen.divider);
  check('第 1 步只有小球一张、亮着', (await cardsOf(page)).join() === 'circle' && (await glowOf(page)).join() === 'circle',
    `${(await cardsOf(page)).join()} · 亮 ${(await glowOf(page)).join()}`);
}

// ── 2. 按下去：直接到第 3 步 ───────────────────────────────────────
{
  await page.evaluate(() => document.querySelector('.know-how-btn').click());
  await page.waitForTimeout(700);
  const cards = await cardsOf(page);
  check(`按完：第 3 步 ${CARDS} 张`, cards.length === CARDS, cards.join());
  check('按完按钮自己不在了', !(await page.$('.know-how-btn')));
  check('按完那圈指路的光也撤了', (await glowOf(page)).length === 0, (await glowOf(page)).join());
  check('slides_played_stage = 3', (await page.evaluate(() => localStorage.getItem('slides_played_stage'))) === '3');
  check('按完计时挑战按得开（找得到这张卡）', await tap(page, 'timed'));
  await page.waitForSelector('.slot-pick-opt, .timed-page', { timeout: 15000 }).catch(() => {});
  check('计时那一页开了', !(await page.$('#homeGrid')));
}

// ── 3. 刷新之后还是第 3 步 ─────────────────────────────────────────
{
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(500);
  check('刷新之后按钮不再出现', !(await page.$('.know-how-btn')));
  check(`刷新之后仍是 ${CARDS} 张`, (await cardsOf(page)).length === CARDS);
}

// ── 4. 关键的那一半：自带的教学**照旧** ─────────────────────────────
{
  await tap(page, 'circle');
  const coach = await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 30000 }).then(() => true).catch(() => false);
  check('按过《我会玩》，头一回开小球照样有教学条', coach);
}
await page.close();

// ── 5. 第 3 步的人不该摆这颗按钮 ──────────────────────────────────
{
  const p2 = await freshPage(ctx, { slides_played_circle: '1', slides_played_square: '1' });
  check('打过小球、方块两局的人（第 3 步）看不到这颗按钮', !(await p2.$('.know-how-btn')) && (await cardsOf(p2)).length === CARDS);
  await p2.close();
}
{
  const p2 = await freshPage(ctx, { slides_played_circle: '1' });
  check('第 2 步（打过小球）还摆着这颗按钮', !!(await p2.$('.know-how-btn')) && (await cardsOf(p2)).join() === 'square,circle', (await cardsOf(p2)).join());
  await p2.close();
}

// ── 6. 小红书那一版：第 1、2 步有按钮，按下去到第 3 步 ────────────────────────
if (XHS) {
  console.log('\n---- 小红书版 ----');
  const file = 'file://' + (XHS.startsWith('/') ? XHS : process.cwd() + '/' + XHS);
  for (const [name, preset, n] of [
    ['第 1 步（头一局小球没打完）', { 'slides.xhs.firstRun': '1' }, 1],
    ['第 2 步（头一局小球打完了）', { 'slides.xhs.firstRun': '1', 'slides.xhs.story.circle': '1' }, 2],
  ]) {
    for (const [w, h] of [[390, 844], [320, 568]]) {
      const vctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
      const p3 = await vctx.newPage();
      p3.on('pageerror', (e) => errs.push(`xhs ${w}×${h}: ` + e.message));
      await p3.addInitScript((kv) => {
        if (sessionStorage.getItem('gate_primed') === '1') return;
        sessionStorage.setItem('gate_primed', '1');
        localStorage.clear();
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
      }, preset);
      await p3.goto(file, { waitUntil: 'load' });
      await p3.waitForSelector('.home-icon-btn', { timeout: 30000 }).catch(() => {});
      await p3.waitForTimeout(600);
      const at = await p3.evaluate(() => {
        const kh = document.querySelector('.know-how-btn');
        const row = document.querySelector('.home-row--intro');
        const nav = document.querySelector('.home-nav');
        const r = (el) => (el ? el.getBoundingClientRect() : null);
        return {
          n: document.querySelectorAll('#xhsGrid .home-icon-btn').length,
          text: kh?.textContent?.trim() ?? '', kh: r(kh), row: r(row), nav: r(nav), vh: innerHeight, next: kh?.previousElementSibling === row,
        };
      });
      const tag = `小红书 ${name} ${w}×${h}`;
      check(`${tag}：${n} 张卡＋《我会玩》`, at.n === n && at.text === '我会玩', JSON.stringify({ n: at.n, text: at.text }));
      if (at.kh && at.row && at.nav) {
        check(`${tag}：按钮紧跟在那一排下面、热区 ≥44`, at.next && at.kh.top >= at.row.bottom - 0.5 && at.kh.height >= 44, JSON.stringify(at.kh));
        check(`${tag}：首屏看得见、不压底排`, at.kh.bottom <= Math.min(at.vh, at.nav.top) + 0.5, `按钮底 ${at.kh.bottom.toFixed(1)} / 底排顶 ${at.nav.top.toFixed(1)}`);
      }
      if (w === 390) {
        await p3.evaluate(() => document.querySelector('.know-how-btn')?.click());
        await p3.waitForTimeout(800);
        const after = await p3.evaluate(() => ({
          btn: !!document.querySelector('.know-how-btn'),
          n: document.querySelectorAll('#xhsGrid .home-icon-btn').length,
          stage: localStorage.getItem('slides.xhs.stage'),
        }));
        check(`${tag}：按完到第 3 步（${XHS_CARDS} 张、按钮不在）`, !after.btn && after.n === XHS_CARDS && after.stage === '3', JSON.stringify(after));
      }
      await vctx.close();
    }
  }
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
if (errs.length) fail++;
await browser.close();
process.exit(fail ? 1 : 0);
