/**
 * 返回键在小屋里、局中、等待页上做什么（见 src/engine/backNav.ts）——两台浏览器真开一间屋。
 *
 *   node scripts/dev-server.mjs 8902 dist
 *   node scripts/check-back-room.mjs http://localhost:8902/
 *
 * 客人在小屋里 / 倒数里 / 局中 / 交卷等待页上按返回都是先问《要不要离开》，再按一下收
 * 起那一问、人还在原地；《会不会规则》那一问按返回等于答《会》；《完成了吗？》按返回
 * 等于《否》；屋主散场后那张战绩卡按返回回多人设置页。顺带验几扇窗：锁着的卡开的订
 * 阅窗、配色窗、内部码窗，按返回只关窗；主菜单老虎机卡进的挑图形页按返回回主菜单。
 *
 * TESTMONTH 一台服务器只能兑一次——重跑请换端口重开服务器。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8902/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const back = async (page, ms = 400) => {
  // 哨兵是这一屏画到屏幕上之后才推的（见 backNav.ts 的 arm）：按返回之前先等它立好。
  await page.waitForTimeout(150);
  await page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const has = (page, sel) => page.$(sel).then(Boolean);
const shown = (page, sel) => page.$eval(sel, (el) => el.classList.contains('show')).catch(() => false);

async function newPlayer(label, unseen = []) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript((skip) => {
    const keys = { square: 'slides_tutorial_seen', circle: 'slides_tutorial_seen_circle', triangle: 'slides_tutorial_seen_triangle' };
    for (const [fam, k] of Object.entries(keys)) if (!skip.includes(fam)) localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
  }, unseen);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} page error] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}

const A = await newPlayer('host');
const B = await newPlayer('guest', ['circle']);

// ---- 没开通的人：锁着的卡开的是订阅窗，返回只关窗 --------------------------------
await B.page.$$eval('.home-icon-btn--locked', (els) => els[0].click());
await B.page.waitForSelector('.genius-modal', { timeout: 5000 });
await back(B.page);
check('锁着的卡开的订阅窗按返回 → 关窗，人还在主菜单', !(await has(B.page, '.genius-modal')) && (await has(B.page, '.home-page')));

// ---- 屋主开通 ---------------------------------------------------------------------
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return r;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
  return r;
});
check('（屋主用内部码开通）', granted.active === true, JSON.stringify(granted).slice(0, 60));
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile', { timeout: 20000 });

// ---- 开通了的人：老虎机卡 → 挑图形页 → 返回 → 主菜单 --------------------------------
await A.page.click('[aria-label^="老虎机模式"]');
await A.page.waitForFunction(() => !document.querySelector('.home-page'), { timeout: 8000 });
await back(A.page);
check('主菜单老虎机卡进的挑图形页按返回 → 主菜单', await has(A.page, '.home-page'));

// ---- 个人主页里的几扇窗 -------------------------------------------------------------
await A.page.click('#navProfile');
await A.page.waitForSelector('#paletteRow', { timeout: 8000 });
await A.page.click('#paletteRow');
await A.page.waitForSelector('body > .overlay.show', { timeout: 5000 });
await back(A.page);
check('配色窗按返回 → 只关窗', !(await has(A.page, 'body > .overlay.show')) && (await has(A.page, '.profile-page')));
await A.page.click('#insiderRow');
await A.page.waitForSelector('body > .overlay.show', { timeout: 5000 });
await back(A.page);
check('内部码窗按返回 → 只关窗', !(await has(A.page, 'body > .overlay.show')) && (await has(A.page, '.profile-page')));

// ---- 开屋、进屋 ---------------------------------------------------------------------
await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 8000 });
await A.page.fill('#mpName', '甲');
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
await B.page.click('#navProfile');
await B.page.waitForSelector('#multiRow', { timeout: 8000 });
await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 8000 });
await B.page.fill('#mpName', '乙');
await B.page.fill('#mpCode', code);
await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
check('客人进了屋', (await B.page.$eval('.mp-code', (e) => e.textContent.trim())) === code);

// 客人在小屋里按返回 → 问；再按 → 收起
await back(B.page);
check('客人在小屋里按返回 → 弹《是否离开？》', (await has(B.page, '#leaveRoomConfirm')) && (await has(B.page, '#mpLeave')));
await back(B.page);
check('再按 → 收起那一问，人还在小屋', !(await has(B.page, '#leaveRoomConfirm')) && (await has(B.page, '#mpLeave')));

// ---- 屋主挑圆球开局；客人没看过圆球教学，先被问《会不会规则》 -----------------------
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
await A.page.$$eval('.home-icon-btn', (els) => els[1].click());
await B.page.waitForSelector('#mpKnowAsk', { timeout: 12000 });
await back(B.page);
check('《会不会规则》按返回 → 等于答《会》，那一问收起', !(await has(B.page, '#mpKnowAsk')));
await B.page.waitForSelector('.mp-countdown-page, #boardWrap', { timeout: 8000 });
check('答完之后客人进倒数（或已开局）', (await has(B.page, '.mp-countdown-page')) || (await has(B.page, '#boardWrap')));

// 屋主在倒数里按返回 → 问；再按 → 收起
await A.page.waitForSelector('.mp-countdown-page, #boardWrap', { timeout: 12000 });
await back(A.page);
check('倒数里按返回 → 弹《解散小屋？》', await has(A.page, '#leaveRoomConfirm'));
await back(A.page);
check('再按 → 收起那一问，倒数照走 / 局照开', !(await has(A.page, '#leaveRoomConfirm')) && ((await has(A.page, '.mp-countdown-page')) || (await has(A.page, '#boardWrap'))));

// ---- 局中 ----------------------------------------------------------------------------
await A.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
await B.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
await B.page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 15000 });
await back(B.page);
check('客人局中按返回 → 弹《是否离开？》，不暂停、不退', (await has(B.page, '#leaveRoomConfirm')) && (await has(B.page, '#boardWrap')) && !(await shown(B.page, '#pauseOverlay')));
await back(B.page);
check('再按 → 收起，接着打', !(await has(B.page, '#leaveRoomConfirm')) && (await has(B.page, '#boardWrap')));

// 《完成了吗？》按返回 = 否
await B.page.$eval('#finishBtn', (el) => el.click());
await B.page.waitForSelector('#finishConfirm', { timeout: 5000 });
await back(B.page);
check('《完成了吗？》按返回 → 等于《否》，接着打', !(await has(B.page, '#finishConfirm')) && !(await shown(B.page, '#endOverlay')));
// 真交卷 → 等待页 → 返回 = 问离开
await B.page.$eval('#finishBtn', (el) => el.click());
await B.page.waitForSelector('#mpFinishYes', { timeout: 5000 });
await B.page.click('#mpFinishYes');
await B.page.waitForSelector('#mpWait', { timeout: 10000 });
await back(B.page);
check('交卷等待页按返回 → 弹《是否离开？》，等待页还在', (await has(B.page, '#leaveRoomConfirm')) && (await has(B.page, '#mpWait')));
await back(B.page);
check('再按 → 收起，还在等待页', !(await has(B.page, '#leaveRoomConfirm')) && (await has(B.page, '#mpWait')));

// 屋主也交卷 → 这一局结束 → 两边回小屋
await A.page.$eval('#finishBtn', (el) => el.click());
await A.page.waitForSelector('#mpFinishYes', { timeout: 5000 });
await A.page.click('#mpFinishYes');
await A.page.waitForSelector('#mpLeave', { timeout: 20000 });
await B.page.waitForSelector('#mpLeave', { timeout: 20000 });
check('一局打完两边都回到小屋页', true);

// 屋主解散 → 战绩卡 → 返回 → 多人设置页；客人那边也是战绩卡 → 返回 → 多人设置页
await A.page.click('#mpLeave');
await A.page.waitForSelector('#mpLeaveYes', { timeout: 5000 });
await A.page.click('#mpLeaveYes');
await A.page.waitForSelector('#mpFinalDone', { timeout: 15000 });
await back(A.page);
check('屋主看战绩卡时按返回 → 多人设置页', await has(A.page, '#mpCreate'));
await B.page.waitForSelector('#mpFinalDone', { timeout: 15000 });
await back(B.page);
check('客人看战绩卡时按返回 → 多人设置页', await has(B.page, '#mpCreate'));

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
