/**
 * 《无限反转》这一批改动 + iOS 后台暂停 + 小屋里的无限反转卡，逐条核对。
 *
 *   node scripts/dev-server.mjs 8930 dist
 *   node scripts/check-flip-batch.mjs http://localhost:8930/
 *
 *   · 主菜单那张卡进挑图形页，《退出》和返回键都回主菜单（不是个人主页）；
 *   · 个人主页《更多玩法》是陈列页：圆角框里那张四层翻面的图 + 名字，《退出》回个人主页；
 *   · 开局页：摆的是挑的那个图形（不是秒表），倒数底下一块「图标 + 连击减弱 / 没有时间奖励」；
 *   · 一局 60 秒；切到后台立刻暂停，回来按《继续》接着打；
 *   · 结算页没有《用时系数》那一行；
 *   · 屋主替小屋挑玩法时按到这张卡：只提示「不是小屋玩法」，人还在主菜单。
 *
 * TESTMONTH 一台服务器只能兑一次——重跑请换端口重开服务器。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8930/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const has = (page, sel) => page.$(sel).then(Boolean);
const shown = (page, sel) => page.$eval(sel, (el) => el.classList.contains('show')).catch(() => false);
const back = async (page, ms = 500) => {
  await page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.addInitScript(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
  localStorage.setItem('slides_intro_seen', '1');
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
// 开通天才（内存版服务器的 TESTMONTH），无限反转那张卡才按得开。
await page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

const FLIP_CARD = '.home-icon-btn[aria-label="无限反转"]';
check('主菜单上有《无限反转》那张卡，而且没锁', (await has(page, FLIP_CARD)) && !(await has(page, `${FLIP_CARD}.home-icon-btn--locked`)));

// 1. 主菜单 → 挑图形页 → 《退出》→ 主菜单
await page.click(FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
check('挑图形页那句规矩写的是 60 秒', (await page.$eval('.flip-tagline', (el) => el.textContent)).includes('60'));
await page.click('#flipBack');
await page.waitForTimeout(300);
check('挑图形页《退出》→ 主菜单（不是个人主页）', (await has(page, '.home-page')) && !(await has(page, '.profile-page')));

// 2. 主菜单 → 挑图形页 → 返回键 → 主菜单
await page.click(FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
await page.waitForTimeout(120);
check('挑图形页立着哨兵', (await page.evaluate(() => history.state?.slides)) === 'guard');
await back(page);
check('挑图形页按返回键 → 主菜单', (await has(page, '.home-page')) && !(await has(page, '.profile-page')));

// 3. 个人主页《更多玩法》是陈列页
await page.click('#navProfile');
await page.waitForSelector('#moreModesRow', { timeout: 8000 });
await page.click('#moreModesRow');
await page.waitForSelector('.modes-page', { timeout: 8000 });
check('《更多玩法》是陈列页，不是挑图形页', !(await has(page, '.flip-page')));
check('陈列页里一个圆角框，装着无限反转那张图', (await has(page, '.modes-page .lay-card[data-mode="flip"] .lay-thumb svg')));
// 这一页现在并排陈列两张卡：老虎机模式和无限反转（玩家定的，见任务 #444）。
// 从前只有无限反转一张，所以这里取的是第一个 .lay-name——那一版它就是无限反转。
check(
  '两张卡并排：老虎机模式和无限反转',
  (await page.$$eval('.modes-page .lay-name', (els) => els.map((e) => e.textContent.trim()).join('|'))) === '老虎机模式|无限反转',
  await page.$$eval('.modes-page .lay-name', (els) => els.map((e) => e.textContent.trim()).join('|')),
);
check(
  '无限反转那张框底下写着它自己的名字',
  (await page.$eval('.modes-page .lay-card[data-mode="flip"] .lay-name', (el) => el.textContent.trim())) === '无限反转',
);
check('陈列页的图不能按（没有按钮）', !(await has(page, '.modes-page .lay-card button')));
await page.click('#backBtn');
await page.waitForTimeout(300);
check('陈列页《退出》→ 个人主页', await has(page, '.profile-page'));
await page.click('#moreModesRow');
await page.waitForSelector('.modes-page', { timeout: 8000 });
await page.waitForTimeout(120);
await back(page);
check('陈列页按返回键 → 个人主页', await has(page, '.profile-page'));
await back(page);
check('个人主页再按返回键 → 主菜单', await has(page, '.home-page'));

// 4. 开局页：图形 + 说明块；60 秒；后台暂停；结算页没有用时系数
await page.click(FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
await page.click('.slot-pick-opt[data-family="square"]');
await page.waitForSelector('#startOverlay.show', { timeout: 8000 });
check('开局页倒数底下有那块说明：图标 + 文字', (await has(page, '#startOverlay .flip-hint .flip-hint-icon svg')) && (await has(page, '#startOverlay .flip-hint-copy')));
const hint = await page.$eval('#startOverlay .flip-hint-copy', (el) => el.textContent.trim());
check('说明写的是连击减弱 ×1.5、没有时间奖励', hint.includes('×1.5') && hint.includes('时间'), hint);
const markHtml = await page.$eval('#startOverlay .start-marks', (el) => el.innerHTML);
// 玩家给的 SVG 里每个 id 都带着文件名前缀（customIcons.ts）：base-square-… 是方块那张，timed-… 是秒表。
check('开局页摆的是方块那张图，不是秒表', markHtml.includes('base-square-') && !markHtml.includes('timed'), markHtml.slice(0, 80));
const hintBox = await page.$eval('#startOverlay .flip-hint', (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, vh: innerHeight, vw: innerWidth }; });
check('说明块在屏幕里', hintBox.top >= 0 && hintBox.bottom <= hintBox.vh && hintBox.w <= hintBox.vw, JSON.stringify(hintBox));
await page.screenshot({ path: '/tmp/claude-0/-home-user-Cube/31e4410f-1c28-5dc5-871f-485b2d55eb01/scratchpad/flip-start.png' });
await page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 15000 });
await page.waitForTimeout(300);
const clock = await page.$eval('#hud-time', (el) => el.textContent.trim());
check('一局 60 秒（开打时钟上是 1:00 / 0:59）', /^(1:00|0:5\d)$/.test(clock), clock);

// 切到后台：立刻暂停
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(200);
check('切到后台 → 暂停页盖上', await shown(page, '#pauseOverlay'));
const clockPaused = await page.$eval('#hud-time', (el) => el.textContent.trim());
await page.waitForTimeout(1500);
check('暂停着的时候钟不走', (await page.$eval('#hud-time', (el) => el.textContent.trim())) === clockPaused, clockPaused);
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(200);
check('回到前台不自动继续——还是暂停页，等玩家按《继续》', await shown(page, '#pauseOverlay'));
await page.click('#continueBtn');
await page.waitForTimeout(200);
check('按《继续》→ 接着打', !(await shown(page, '#pauseOverlay')));
// 再切一次：已经暂停着的不重复处理；结算之后也不暂停
await page.click('#finishBtn');
await page.waitForSelector('#endOverlay.show', { timeout: 8000 });
const rows = await page.$$eval('#endBreakdown .end-row', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
check('结算页没有《用时系数》那一行', !rows.some((r) => r.includes('用时系数')), rows.join(' | '));
check('结算页还有得分率那一行', rows.some((r) => r.includes('有效得分率')));
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(200);
check('结算页上切到后台不会盖暂停页', !(await shown(page, '#pauseOverlay')));
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
await page.click('#endBackBtn');
await page.waitForTimeout(300);
check('结算页《主页》→ 挑图形页（从哪儿来回哪儿）', await has(page, '.flip-page'));
await page.click('#flipBack');
await page.waitForTimeout(300);
check('再《退出》→ 主菜单', await has(page, '.home-page'));

// 5. 屋主替小屋挑玩法：按到无限反转进挑图形页（小屋那圈粉边还在），《退出》回主菜单，横幅还在
//    （挑完真开局的那条路在 check-room-flip.mjs 里，那儿有两台浏览器）
await page.click('#navProfile');
await page.waitForSelector('#multiRow', { timeout: 8000 });
await page.click('#multiRow');
await page.waitForSelector('#mpCreate', { timeout: 8000 });
await page.fill('#mpName', '甲');
await page.click('#mpCreate');
await page.waitForSelector('#mpPick', { timeout: 15000 });
await page.click('#mpPick');
await page.waitForSelector('#roomPickBar', { timeout: 8000 });
await page.click(FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
check('屋主挑玩法时按无限反转：进挑图形页，小屋那圈粉边还在', await page.evaluate(() => document.body.classList.contains('is-room-host')));
check('没有一个人开进局里', !(await has(page, '.app--game')));
await page.click('#flipBack');
await page.waitForTimeout(300);
check('挑图形页《退出》→ 主菜单，替小屋挑玩法的横幅还在', (await has(page, '.home-page')) && (await has(page, '#roomPickBar')));

check('一路没有页面报错', errors.length === 0, errors.join(' / '));
await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
