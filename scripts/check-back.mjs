/**
 * 浏览器 / 手机的返回键 = 回站内的上一屏（见 src/engine/backNav.ts）。
 *
 *   node scripts/dev-server.mjs 8901 dist
 *   node scripts/check-back.mjs http://localhost:8901/
 *
 * 用 Playwright 的 goBack 模拟按返回，逐屏核对落点：个人主页回主菜单；天才特供
 * 的页回个人主页；弹窗（规则、语言、排行榜、炸弹挑图形）只关弹窗；游戏开局页回主
 * 菜单、打着先暂停、暂停着再按继续、结算页回主菜单；教学回挑选页；小屋里先问
 * 《要不要离开》、屋主在主菜单挑玩法时回小屋；主菜单再按才真的离开网站；刷新
 * 之后这一套照旧。横屏再走一遍主要几条。
 *
 * TESTMONTH 一台服务器只能兑一次——重跑请换端口重开服务器。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8901/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function open(viewport) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    localStorage.setItem('slides_intro_seen', '1');
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  return { ctx, page };
}
const back = async (page, ms = 400) => {
  await page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const has = (page, sel) => page.$(sel).then(Boolean);
const shown = (page, sel) => page.$eval(sel, (el) => el.classList.contains('show')).catch(() => false);
const navShown = (page) => page.$eval('.home-nav', (n) => getComputedStyle(n).display !== 'none').catch(() => false);

async function commonRounds(tag, viewport) {
  const { ctx, page } = await open(viewport);
  check(`${tag} 刚打开在主菜单：只有根，没有哨兵（返回就是浏览器自己的退出）`, (await page.evaluate(() => history.state?.slides)) === 'root');

  // 个人主页 → 返回 → 主菜单
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 8000 });
  check(`${tag} 进了个人主页：哨兵立起来了`, (await page.evaluate(() => history.state?.slides)) === 'guard');
  await back(page);
  check(`${tag} 个人主页按返回 → 主菜单`, (await has(page, '.home-page')) && !(await has(page, '.profile-page')));
  check(`${tag} 回到主菜单之后哨兵撤了`, (await page.evaluate(() => history.state?.slides)) === 'root');

  // 个人主页 → 老虎机模式介绍页 → 返回 → 个人主页 → 返回 → 主菜单
  await page.click('#navProfile');
  await page.waitForSelector('#randomRow', { timeout: 8000 });
  await page.click('#randomRow');
  await page.waitForFunction(() => !document.querySelector('.profile-page'), { timeout: 8000 });
  await back(page);
  check(`${tag} 天才特供的页按返回 → 个人主页`, await has(page, '.profile-page'));
  await back(page);
  check(`${tag} 再按 → 主菜单`, await has(page, '.home-page'));

  // 弹窗：规则 → 返回只关窗
  await page.click('#navProfile');
  await page.waitForSelector('#rulesRow', { timeout: 8000 });
  await page.click('#rulesRow');
  await page.waitForSelector('.rules-modal', { timeout: 5000 });
  await back(page);
  check(`${tag} 规则窗按返回 → 只关窗，人还在个人主页`, !(await has(page, '.rules-modal')) && (await has(page, '.profile-page')));
  // 弹窗：语言
  await page.click('#langRow');
  await page.waitForSelector('#langSwitchCloseBtn', { timeout: 5000 });
  await back(page);
  check(`${tag} 语言窗按返回 → 只关窗`, !(await has(page, '#langSwitchCloseBtn')) && (await has(page, '.profile-page')));
  await back(page);
  check(`${tag} 关完窗再按 → 主菜单`, await has(page, '.home-page'));

  // 记录与排名 → 排名弹窗 → 返回关弹窗（底排回来）→ 返回主菜单
  await page.click('#navRecords');
  await page.waitForSelector('#ranksPanel', { timeout: 8000 });
  await page.click('#ranksPanel');
  await page.waitForSelector('.center-pick--in', { timeout: 5000 });
  await back(page, 900);
  check(`${tag} 排名弹窗按返回 → 弹窗关、底排导航回来、还在记录页`,
    !(await has(page, '.center-pick')) && (await navShown(page)) && (await has(page, '#ranksPanel')));
  await back(page);
  check(`${tag} 记录页按返回 → 主菜单`, await has(page, '.home-page'));

  // 主菜单上的炸弹挑图形弹窗 → 返回只关弹窗
  await page.click('[data-reopen="bomb"]');
  await page.waitForSelector('.center-pick--in', { timeout: 5000 });
  await back(page, 900);
  check(`${tag} 炸弹挑图形弹窗按返回 → 只关弹窗，还在主菜单`, !(await has(page, '.center-pick')) && (await has(page, '.home-page')));
  // 弹窗自己关掉（点外面）之后，主菜单上的哨兵也该撤——下一下返回就是退出。
  await page.click('[data-reopen="bomb"]');
  await page.waitForSelector('.center-pick--in', { timeout: 5000 });
  check(`${tag} 主菜单开着弹窗：哨兵在`, (await page.evaluate(() => history.state?.slides)) === 'guard');
  await page.mouse.click(8, 8);
  await page.waitForFunction(() => !document.querySelector('.center-pick'), { timeout: 5000 });
  await page.waitForTimeout(500);
  check(`${tag} 点外面关掉弹窗之后：哨兵撤了`, (await page.evaluate(() => history.state?.slides)) === 'root');

  // 游戏：开局页按返回 → 主菜单
  await page.$$eval('.home-icon-btn', (els) => els[0].click());
  await page.waitForSelector('#startOverlay.show', { timeout: 10000 });
  await back(page);
  check(`${tag} 开局页按返回 → 主菜单`, (await has(page, '.home-page')) && !(await has(page, '#startOverlay')));

  // 游戏：打着按返回 → 暂停；再按 → 继续；完成 → 结算页按返回 → 主菜单
  await page.$$eval('.home-icon-btn', (els) => els[0].click());
  await page.waitForSelector('#startOverlay.show', { timeout: 10000 });
  await page.waitForFunction(() => {
    const so = document.querySelector('#startOverlay');
    return so && !so.classList.contains('show') && document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0;
  }, { timeout: 20000 });
  await back(page);
  check(`${tag} 打着按返回 → 暂停页盖上，棋盘还在`, (await shown(page, '#pauseOverlay')) && (await has(page, '#boardWrap')));
  await back(page);
  check(`${tag} 暂停着再按 → 继续，暂停页撤掉`, !(await shown(page, '#pauseOverlay')) && (await has(page, '#boardWrap')));
  await page.$eval('#finishBtn', (el) => el.click());
  await page.waitForSelector('#endOverlay.show', { timeout: 10000 });
  await back(page, 600);
  check(`${tag} 结算页按返回 → 主菜单`, (await has(page, '.home-page')) && !(await has(page, '#endOverlay')));

  // 教学：挑选页 → 教学 → 返回 → 挑选页 → 返回 → 主菜单
  await page.click('#navProfile');
  await page.waitForSelector('#howToRow', { timeout: 8000 });
  await page.click('#howToRow');
  await page.waitForSelector('.tut-pick', { timeout: 8000 });
  await page.$$eval('.tut-shape-btn', (els) => els[0].click());
  await page.waitForSelector('.story-tut', { timeout: 8000 });
  await back(page);
  check(`${tag} 教学里按返回 → 挑选页`, (await has(page, '.tut-pick')) && !(await has(page, '.story-tut')));
  await back(page);
  check(`${tag} 挑选页按返回 → 主菜单`, await has(page, '.home-page'));

  return { ctx, page };
}

// ---- 竖屏：全套 --------------------------------------------------------------
const P = await commonRounds('竖屏', { width: 390, height: 844 });

// ---- 刷新之后照旧 ------------------------------------------------------------
await P.page.click('#navProfile');
await P.page.waitForSelector('.profile-page', { timeout: 8000 });
await P.page.reload({ waitUntil: 'load' });
await P.page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await P.page.waitForTimeout(500);
check('刷新回来落在主菜单：哨兵撤了，历史里只剩根', (await P.page.evaluate(() => history.state?.slides)) === 'root');
await P.page.click('#navProfile');
await P.page.waitForSelector('.profile-page', { timeout: 8000 });
await back(P.page);
check('刷新之后个人主页按返回照旧回主菜单', await has(P.page, '.home-page'));

// ---- 主菜单再按：真的离开网站（回到进站前那一页）-----------------------------
await back(P.page, 800);
check('主菜单按返回 → 离开网站（回到进站前的那一页）', P.page.url() === 'about:blank', P.page.url());
await P.ctx.close();

// ---- 小屋 ------------------------------------------------------------------
{
  const { ctx, page } = await open({ width: 390, height: 844 });
  await page.click('#navProfile');
  await page.waitForSelector('#multiRow', { timeout: 8000 });
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate', { timeout: 8000 });
  await back(page);
  check('多人设置页（从个人主页进）按返回 → 个人主页', await has(page, '.profile-page'));

  const granted = await page.evaluate(async () => {
    const r = await fetch('/api/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }),
    }).then((x) => x.json());
    if (!r.active) return r;
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
    return r;
  });
  check('（用内部码开通，才能开小屋）', granted.active === true, JSON.stringify(granted).slice(0, 80));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('#multiRow', { timeout: 8000 });
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate', { timeout: 8000 });
  await page.fill('#mpName', '甲');
  await page.click('#mpCreate');
  await page.waitForSelector('#mpLeave', { timeout: 10000 });
  await back(page);
  check('小屋里按返回 → 弹《解散小屋？》，人还在小屋', (await has(page, '#leaveRoomConfirm')) && (await has(page, '#mpLeave')));
  await back(page);
  check('再按返回 → 那一问收起，人还在小屋', !(await has(page, '#leaveRoomConfirm')) && (await has(page, '#mpLeave')));
  // 屋主去主菜单挑玩法 → 返回 → 回小屋
  await page.click('#mpPick');
  await page.waitForSelector('.room-pick-bar', { timeout: 8000 });
  await back(page);
  check('屋主在主菜单挑玩法时按返回 → 回小屋', await has(page, '#mpLeave'), await page.evaluate(() => document.body.innerText.slice(0, 60)));
  // 真的走：按键 → 问 → 是 → 多人设置页
  await page.click('#mpLeave');
  await page.waitForSelector('#mpLeaveYes', { timeout: 5000 });
  await page.click('#mpLeaveYes');
  await page.waitForSelector('#mpCreate', { timeout: 10000 });
  check('解散之后回到多人设置页，返回键接着回个人主页', true);
  await back(page);
  check('多人设置页按返回 → 个人主页', await has(page, '.profile-page'));
  await ctx.close();
}

// ---- 横屏、大屏：全套再走一遍 ---------------------------------------------------
const L = await commonRounds('横屏', { width: 844, height: 390 });
await L.ctx.close();
const W = await commonRounds('大屏', { width: 1280, height: 800 });
await W.ctx.close();

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
