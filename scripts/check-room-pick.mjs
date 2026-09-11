/**
 * 屋主去主菜单挑玩法的那几分钟，小屋那边还听不听得见他。
 *
 *   node scripts/dev-server.mjs 8981 dist
 *   node scripts/check-room-pick.mjs http://localhost:8981/
 *
 * 玩家报的两件事，其实是同一个根：
 *
 *   · 「屋主一段时间没选择就变成了这个」——客人那边弹出《屋主等一下就来》。
 *     小屋页那条一秒一轮的轮询就是「我还在」的凭据（api/room.js 的 state 顺
 *     手写 lastSeen），屋主一离开小屋页，凭据就断了，三十秒（AWAY_MS）后屋
 *     里所有人都以为他不在了。
 *   · 「催屋主的功能在选择玩法的时候不显示，全都累积在回小屋里才显示」——
 *     掉球那套动画本来只挂在小屋页上。
 *
 * 所以这道门盯的是：屋主停在主菜单上四十秒（AWAY_MS 三十秒 + 余量），客人
 * 那边**不该**出现 #hostAway；这期间客人按的每一下，都该落在主菜单那块招牌
 * 里（画布出现 + 上面真的画了东西）。
 *
 * TESTMONTH 一台服务器只能兑一次——重跑请换端口重开服务器。整趟约一分钟。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8981/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function newPlayer(label) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} page error] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page, label };
}

// ---- 屋主开通 + 开屋，客人进来 ---------------------------------------------
const A = await newPlayer('host');
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return r;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until,
    channel: 'code', email: r.email, token: r.token, code: r.code }));
  return r;
});
check('屋主开通天才', granted.active === true);
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');
await A.page.click('#navProfile'); await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());

const B = await newPlayer('guest');
await B.page.click('#navProfile'); await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 10000 });
await B.page.fill('#mpCode', code); await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });
check('两个人都在屋里', true);

// ---- 屋主去主菜单挑玩法 -----------------------------------------------------
const pick = await A.page.waitForSelector('#mpPick', { timeout: 8000 }).catch(() => null);
if (pick) await pick.click();
else await A.page.click('.mp-host-acts button');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
check('屋主到了主菜单，横幅在', true);

// ---- 客人一路催，屋主那块招牌上要当场掉东西 ---------------------------------
const nudge = await B.page.waitForSelector('#mpNudge', { timeout: 8000 }).catch(() => null);
check('客人这一屏有《催屋主》', Boolean(nudge));
for (let i = 0; i < 6; i++) {
  await nudge.click();
  await B.page.waitForTimeout(120);
}
// 掉球是异步的（按服务器记的时刻摊开，最多 950ms），再加一轮心跳（4s）
const rained = await A.page
  .waitForFunction(() => {
    const c = document.querySelector('.home-head-glass canvas');
    if (!c) return false;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;  // 有一个像素不透明
    return false;
  }, { timeout: 12000 })
  .then(() => true)
  .catch(() => false);
check('屋主在主菜单上，催他的球当场掉进招牌里', rained);

// ---- 屋主在主菜单上停够 AWAY_MS，客人那边不能判他不在 -----------------------
console.log('  （停在主菜单 40 秒，看客人那边会不会弹《屋主等一下就来》）');
const wentAway = await B.page
  .waitForSelector('#hostAway', { timeout: 40000 })
  .then(() => true)
  .catch(() => false);
check('屋主还在挑玩法：客人那边没有《屋主等一下就来》', !wentAway);
const stillSeated = await B.page.$$eval('.mp-player', (els) => els.length);
check('客人还好端端坐在小屋里', stillSeated === 2, `${stillSeated} 行`);

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);
