/**
 * 头一回打开这个网站的那条路，从头走一遍。
 *
 *   node scripts/dev-server.mjs 8976 dist
 *   node scripts/check-first-play.mjs http://localhost:8976/
 *   node scripts/check-first-play.mjs http://localhost:8977/ 1440x900   ← 电脑宽屏整套再跑一遍
 *
 * （两遍各要一台自己的服务器：三角那一节要兑一张 TESTMONTH，一台服务器里一张码只兑得动
 * 一次。）
 *
 * 盯着玩家 2026-09 点名的四件事：
 *
 *   · 一步一步出现（10-31 方案推12 起替掉原先的软锁）——新人主菜单上只有小球；小球那局教学走到结算页，
 *     方块出现在它前面、亮着；方块那局走到结算页，每日挑战、多人、计时、炸弹出现。
 *   · 教学条——他玩的第一个基础玩法从第 1 条讲起，五段进度（2026-10 第二轮从四段改
 *     的，一步一条），第 1 条说的是
 *     「色块得分后会变成星星」。
 *
 *     四段不是五段：规则改成五条之前那六条里，第 6 条（综合得分）挪去了结算页，第 1、2 条
 *     按玩家的要求并成了一步（「第一第二条教学内容在进度条上合并为一条」，
 *     下面那条断言验的就是这一步摆着两条）。进度条一段一步，不是一段一条。
 *   · 三角——得分变成星星之后，那圈灰色圆角边框一直在（和消掉之后的空三角
 *     同一圈）。
 *
 * 这支脚本每一段都从 localStorage.clear() 重新做人，所以顺序无关，单跑也行。
 *
 * **主菜单上那几下为什么不用 `page.click()`。** 手机竖屏的主菜单 2026-09 改成了
 * 鱼眼轴（ui/modeAxis.ts）：十四张卡是绝对定位的，一次只有中间那几张在屏幕上，
 * 别的在视口外几百像素处待着。Playwright 的 `click()` 会先「滚动到可见」再按，
 * 而轴是自己管位置的（滚不动），于是它一直等到超时——门红的不是代码，是这把尺
 * 子。改成在页面里直接 `el.click()`：合成的这一下照样冒泡到轴和首玩期那道拦截
 * 上，量的还是同一件事。（check-knowhow 先踩过同一个坑。）
 */
import { chromium } from 'playwright';
import { afterRestart } from './lib/afterRestart.mjs';
const BASE = process.argv[2] || 'http://localhost:8976/';
/**
 * 屏幕多大。默认手机竖屏；给 `1440x900` 就整套在电脑宽屏上跑一遍（第 14 推：宽屏那一
 * 版的炸弹卡漏了首玩锁，而这道门从前只在手机上跑，量不到）。
 */
const [VW, VH] = (process.argv[3] || '390x844').split('x').map(Number);
const WIDE = VW >= 1000;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };
console.log(`（${VW}×${VH}${WIDE ? '，电脑宽屏' : ''}）`);
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, isMobile: !WIDE, hasTouch: !WIDE });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
// 全新的人：只定语言，别的一格不填
await page.addInitScript(() => localStorage.setItem('slides_lang', 'zhHans'));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

// ── 一步一步出现（10-31 方案推12 Z-J02，替掉原先那道「软锁」）──────────────────────────
//
// 原先新人面前十三张全摆、除两张基础卡都挂锁，按到锁着的那几张会抖一下、冒一个指路的箭头。站长 10-30 改成没解锁的
// 玩法**根本不出现**：第 1 步只有小球（＋《我会玩》），小球那局教学走到结算页 → 方块出现在小球前面，方块那局教学走到
// 结算页 → 每日挑战、多人、计时、炸弹出现。这一节就沿着这条路走一遍（细的在 check-menu-stages）。
const cardsNow = () => page.evaluate(() => [...document.querySelectorAll('#homeGrid [data-card]')].map((c) => c.dataset.card));
/** 暂停 →《结束游戏》→ 结算页 →《首页》→ 主菜单。 */
const finishToMenu = async () => {
  await page.waitForFunction(() => !document.querySelector('#startOverlay.show') && document.querySelectorAll('.tile, .ball, .tri').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.$eval('#stopBtn', (e) => e.click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.$eval('#pauseFinishBtn', (e) => e.click());
  await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
  await page.$eval('#endBackBtn', (e) => e.click());
  await page.waitForSelector('.home-page', { timeout: 15000 });
  await page.waitForTimeout(500);
};
{
  const m = await page.evaluate(() => ({
    knowHow: !!document.querySelector('.know-how-btn'),
    locked: document.querySelectorAll('.home-icon-btn--locked').length,
    upHint: !!document.querySelector('.home-up-hint'),
    glow: [...new Set([...document.querySelectorAll('.home-icon-btn--glow')].map((b) => b.getAttribute('aria-label')))],
  }));
  check('新人进来：只有小球一张＋《我会玩》', (await cardsNow()).join() === 'circle' && m.knowHow, `${(await cardsNow()).join()} · ${JSON.stringify(m)}`);
  check('没有挂锁的卡、没有指路的箭头（没到的卡根本不摆）', m.locked === 0 && !m.upHint, JSON.stringify(m));
  check('小球亮着', m.glow.join() === '经典小球', JSON.stringify(m.glow));
}
await page.$eval('#homeGrid [data-card="circle"]', (e) => e.click());
check('小球是头一局教学（从第 1 条讲起）', await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 25000 }).then(() => true).catch(() => false));
await finishToMenu();
{
  const m = await page.evaluate(() => {
    const sq = document.querySelector('#homeGrid [data-card="square"]');
    const ci = document.querySelector('#homeGrid [data-card="circle"]');
    return { left: !!sq && !!ci && sq.getBoundingClientRect().left < ci.getBoundingClientRect().left, glow: !!sq?.classList.contains('home-icon-btn--glow') };
  });
  check('小球走到结算页 → 两张：方块在左、亮光', (await cardsNow()).join() === 'square,circle' && m.left && m.glow, `${(await cardsNow()).join()} · ${JSON.stringify(m)}`);
}
await page.$eval('#homeGrid [data-card="square"]', (e) => e.click());
await page.waitForFunction(() => !document.querySelector('#startOverlay.show'), null, { timeout: 30000 });
check('方块是第二局教学（has-coach，条子等星星够了才开口）', !!(await page.$('.app--game.has-coach')));
await finishToMenu();
{
  const cards = await cardsNow();
  check('方块走到结算页 → 6 张（每日挑战、多人、计时、炸弹出现）', cards.join() === 'daily,square,circle,multiplayer,timed,bomb', cards.join());
  if (WIDE) {
    const rows = await page.evaluate(() => new Set([...document.querySelectorAll('#homeGrid [data-card]')].map((c) => Math.round(c.getBoundingClientRect().top))).size);
    check('宽屏：两排', rows === 2, String(rows));
  }
  const kind = await page.evaluate(() =>
    document.querySelector('.home-bomb-card') ? 'card' : document.querySelector('.home-bomb-mini') ? 'mini' : null);
  check(`（尺子）这块屏幕上的炸弹是${WIDE ? '宽版那一整块（.home-bomb-card）' : '窄版那一颗'}`, WIDE ? kind === 'card' : kind === 'mini', String(kind));
  await page.$eval('.home-bomb-card, .home-bomb-mini', (e) => e.click());
  const bombPage = await page.waitForSelector('.bomb-page', { timeout: 5000 }).then(() => true).catch(() => false);
  check('炸弹那张按得开（炸弹那一页）', bombPage);
}

// ── 头一局的教学条 ────────────────────────────────────────────────────
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('slides_lang', 'zhHans'); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$eval('.home-icon-btn[aria-label="经典小球"]', (e) => e.click());
await page.waitForTimeout(600);
if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 25000 });
await page.waitForTimeout(600);
const coach = await page.evaluate(() => ({
  segs: document.querySelectorAll('.coach-seg').length,
  rows: [...document.querySelectorAll('.coach-row:not([hidden]) .coach-text')].map((e) => e.textContent.trim()),
}));
/*
 * 2026-10 第二轮：**五段，一步一条**（玩家点名）。
 *
 * 上一版是四段、第 1 步摆两条——这两条断言钉的就是那个样子，所以那一轮改完它们当场红，
 * 而**红得对**。拆开的理由记在《侵蚀阶梯决策》第 8 推那一条：第 2 条讲的「星星还能再
 * 用」合着的时候没有自己的那一下可做，两条共用「得两次分」，而第二次得分完全可能一颗
 * 星都没碰到。第 15 推又定了「一次只显示一条」（ui/coachBar.ts 的 PLAN_STEPS），这两条
 * 断言照旧成立。
 *
 * 「一段一步」那条规矩一个字没改，只是步数从四变成五；所以这儿照旧钉死一个数，不写
 * `>= 4`——数字本身就是玩家要的那件事。
 */
check('教学条：五段进度（一段一步）', coach.segs === 5, String(coach.segs));
check('第 1 步只摆第 1 条（一步一条）', coach.rows.length === 1, JSON.stringify(coach.rows.map((t) => t.slice(0, 12))));
/**
 * 第 1 条就是玩家原话那一句，逐字对。
 *
 * 原先这儿找的是子串「变成星星」——而 2026-09 规则改成五条之后，第 1 条的原话是「色块
 * 拼出得分图案会得分翻面，**变成其他颜色的星星**」，中间多了四个字，这条断言从那天起
 * 就一直红着（这道门不在 CI 里，所以没人看见）。
 *
 * 换成逐字比而不是换一个新子串：子串改一次就要跟一次，而这五句是玩家亲笔、改一个字都
 * 要回决策文档 §8 的（check-coach 那头也是逐字钉的）。
 */
// 10-11 方案 B-8.2（玩家 Q5 定案）改成「…就翻面，变成星星」：星星不一定是别的颜色。决策文档 §8、check-coach 一起改了。
// 2026-10-29 站长换成自己的原话，10-31 起教学条句末一律不带句号（10-31 整合版 Z-C01、附录甲 §18）。
check('第 1 条就是站长原话那一句',
  coach.rows[0] === '同色的色块或星星连起得分图案可以得分', coach.rows[0]);

// ── 教学只活在一局里（10-31 方案推06 Z-C04，站长 10-22）────────────────────────
//
// 「每一局游戏都是从结算页面时结束，因此教学内容结算后点击再来一次之后就不再是教学内容了」。原先两颗《再来一局》
// 都把条子拨回第 1 条（coach.reset()）、一句话提示一直摆到离开、has-coach 一直挂着。两颗键各量一遍，一句话提示也
// 量一遍。量的是倒数数完、新的一局真开起来之后的样子（重开也先数 4-3-2-1，Z-C05）。
/** 暂停 →《结束游戏》→ 结算页。 */
const finishRun = async () => {
  await page.$eval('#stopBtn', (e) => e.click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.$eval('#pauseFinishBtn', (e) => e.click());
  await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
  await page.waitForTimeout(400);
};
const coachGone = () => page.evaluate(() => {
  const b = document.querySelector('.coach-bar');
  return { hidden: !b || b.hidden, text: (b?.textContent || '').trim(), hasCoach: !!document.querySelector('.app--game.has-coach') };
});
const checkGone = (tag, g) => {
  check(`${tag}：下一局没有教学条（hidden、空的）`, g.hidden && g.text === '', JSON.stringify(g));
  check(`${tag}：.app--game 上不再有 has-coach（排版回到平时那一档）`, !g.hasCoach, JSON.stringify(g));
};
await finishRun();
await page.$eval('#restartBtn', (e) => e.click());
await afterRestart(page);
checkGone('结算页《再来一局》', await coachGone());
// 另起一局：还是头一回（上一局走到结算页只记了小球，这回点方块就是「第二副基础棋盘」那一路，条子要等星星够了才开口，
// 量不准「有没有」）——所以清掉重来，再点一次小球。
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('slides_lang', 'zhHans'); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$eval('.home-icon-btn[aria-label="经典小球"]', (e) => e.click());
await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 25000 });
check('（尺子）另起的这一局头一局有教学条', !!(await page.$('.app--game.has-coach')));
await page.$eval('#stopBtn', (e) => e.click());
await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
await page.$eval('#pauseRestartBtn', (e) => e.click());
await page.waitForSelector('#restartYes', { timeout: 8000 });
await page.$eval('#restartYes', (e) => e.click());
await afterRestart(page);
checkGone('暂停面板《再来一局》', await coachGone());
// 一句话提示：计时挑战（免费的，首玩锁撤了才点得开）。
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['square', 'circle']) localStorage.setItem('slides_played_' + k, '1');
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$eval('.home-icon-btn[aria-label^="计时挑战"]', (e) => e.click());
await page.waitForSelector('.timed-page #timedShapes', { timeout: 20000 });
await page.$eval('#timedShapes .slot-pick-opt[data-family="square"]', (e) => e.click());
await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 25000 });
const tip0 = await coachGone();
check('（尺子）计时头一局摆着那一句话提示', !tip0.hidden && tip0.text !== '' && tip0.hasCoach, JSON.stringify(tip0));
await finishRun();
await page.$eval('#restartBtn', (e) => e.click());
await afterRestart(page);
checkGone('一句话提示（计时）结算页《再来一局》', await coachGone());

// ── 三角那圈灰边 ──────────────────────────────────────────────────────
//
// ⚠️ 这一节 2026-10 修过一次量法，记在这儿：原先点的是 `aria-label="三角"` 那张卡，而
// **基础三角 2026-09 就删掉了**（《侵蚀阶梯》v1.2 PR-6：「删三角、六边三角天才化」）。
// 于是这道门从那天起每一次都崩在 `page.$eval` 上——崩在断言跑完之前，所以它上面那十几
// 条看着全绿，而这三条一次都没跑过。一道会崩的门比没有门更糟：它看着像在守着。
//
// 现在点的是《大三角》。它是天才限定，所以先兑一张 TESTMONTH——**一台 dev-server 里一
// 张码只兑得动一次**（CLAUDE.md 那几个坑的第一个），这道门因此要一台自己的服务器。
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['square', 'circle']) localStorage.setItem('slides_played_' + k, '1');
  // 《大三角》是更多布局，主菜单第 5 步才出现（10-31 方案推12），而且要登着（下面兑码）。
  for (const [k, v] of Object.entries({ slides_played_migrated_v1: '1', slides_played_stage: '5', slides_played_stage_shown: '5', slides_played_tier3: '1', slides_played_tier4: '1' })) localStorage.setItem(k, v);
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.evaluate(async () => {
  const r = await fetch('/api/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }),
  }).then((x) => x.json());
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code,
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
const triCard = await page.$('.home-icon-btn[aria-label="六边形三角"]');
check('（尺子）菜单上找得到那张三角的卡', !!triCard, triCard ? '六边形三角' : '一张都没有');
if (!triCard) {
  console.log('\n没有三角那张卡，下面三条就没有意义——先看 ui/menu.ts 摆了哪几张。');
  await browser.close();
  process.exit(1);
}
await page.$eval('.home-icon-btn[aria-label="六边形三角"]', (e) => e.click());
await page.waitForTimeout(600);
if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
await page.waitForFunction(() => document.querySelectorAll('.tri').length > 0, { timeout: 25000 });
await page.waitForTimeout(900);
/**
 * 先逼出几个星星面来，才有东西可看。
 *
 * 这一段原来是照着 `.board` 的外框算落点，在同一条竖线上横滑 40 下，然后直
 * 接断言。实测三次里有两次一颗星都出不来——查下来不是运气：那些跑次里棋盘
 * 从头到尾一个格子都没动过。外框是在入场动画还没停稳的时候量的，量到的是
 * 一个还在变的矩形，于是之后每一下都滑在棋盘外面，滑多少下都一样。
 *
 * 现在改成从真正的棋子身上起手：每一下都现读一枚 .tri 的中心，棋盘在哪、多
 * 大、有没有动画都不影响。方向也补齐三条（三角能沿三条线拖），而且每滑一下
 * 就看一眼，出星星就停。
 */
const starCount = () => page.evaluate(() => document.querySelectorAll('.tri line').length);
/** 现读第 i 枚棋子的中心——不缓存，棋盘动过也不会算错。 */
const triCenter = (i) =>
  page.evaluate((n) => {
    const els = document.querySelectorAll('.tri');
    if (!els.length) return null;
    const r = els[n % els.length].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, i);
// 三角能沿这三条线拖，六个方向各来一份。
const DIRS = [
  [1, 0], [-1, 0],
  [0.5, 0.87], [-0.5, -0.87],
  [0.5, -0.87], [-0.5, 0.87],
];
let drags = 0;
let moved = false;
const boardSig = () =>
  page.evaluate(() => [...document.querySelectorAll('.tri path')].map((e) => e.getAttribute('fill')).join(','));
const sig0 = await boardSig();
outer: for (const span of [90, 140, 60]) {
  for (let i = 0; i < 25; i++) {
    for (const [dx, dy] of DIRS) {
      const c = await triCenter(i);
      if (!c) break outer;
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + dx * span, c.y + dy * span, { steps: 6 });
      await page.mouse.up();
      drags++;
      await page.waitForTimeout(170);
      if (await starCount()) break outer;
    }
  }
}
moved = (await boardSig()) !== sig0;
check('滑得动这副棋盘（滑不动的话下面两条就没在验渲染）', moved, `滑了 ${drags} 下`);
await page.waitForTimeout(1200);
const tri = await page.evaluate(() => {
  // 星星面认「有三笔线」；那圈灰边是同一块 svg 里一条带 stroke 的 path。
  const stars = [...document.querySelectorAll('.tri')].filter((el) => el.querySelector('line'));
  return { stars: stars.length, withRing: stars.filter((el) => el.querySelector('path[stroke]')).length };
});
check('三角上真的出现了星星面', tri.stars > 0, `${JSON.stringify(tri)} · 滑了 ${drags} 下`);
check('每一枚星星面都戴着那圈灰边', tri.stars > 0 && tri.withRing === tri.stars, JSON.stringify(tri));

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
