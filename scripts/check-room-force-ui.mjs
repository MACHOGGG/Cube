/**
 * 屋主等待页上那颗「不等了」：只给屋主、按了这一局就结束、屋主照常开下一局（2026-10-08 方案 2-6）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8992 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-room-force-ui.mjs http://localhost:8992/
 *
 * 服务端那一半（替谁交卷、交成什么、记账）由 check-room-force 量，这一台量的是**页面上**：
 *
 *   ① 客人交了卷在等：他的等待页上**没有**这颗键（只有屋主能替别人交卷）。
 *   ② 屋主交了卷在等：他的等待页上有这颗键，字是「不等了」。
 *   ③ 屋主按下去：屋主和先交卷的那位客人都回到小屋页（这一局结束了），挂机那一位**没被拽走**
 *      ——他手上那一局照旧开着（正打着的人不该被拽走，ui/scoreboard.ts 那条老规矩）。
 *   ④ 屋主照常挑下一局，开得起来。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-room-force-ui.mjs http://localhost:8992/');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function newPlayer() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    // 预设「看过教学」：量的是等待页，不是头一局的教学条（CLAUDE.md「跑门时的坑」）。
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}
async function giveGenius(page) {
  const ok = await page.evaluate(async () => {
    const r = await fetch('/api/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'TESTMONTH' }),
    }).then((x) => x.json());
    if (!r.active) return false;
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
    return true;
  });
  check('（尺子）TESTMONTH 兑到了开屋的权限', ok);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#navProfile');
}
const openRoom = async (page, name) => {
  await page.click('#navProfile');
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate');
  await page.fill('#mpName', name);
  await page.click('#mpCreate');
  await page.waitForSelector('.mp-code', { timeout: 10000 });
  return page.$eval('.mp-code', (e) => e.textContent.trim());
};
const joinRoom = async (page, name, code) => {
  await page.click('#navProfile');
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate');
  await page.fill('#mpName', name);
  await page.fill('#mpCode', code);
  await page.waitForSelector('.mp-code', { timeout: 10000 });
};
const hostPicks = async (page) => {
  await page.click('#mpPick');
  await page.waitForSelector('#roomPickBar');
  await page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
};
const boardUp = (page, ms = 20000) =>
  page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: ms })
    .then(() => true).catch(() => false);
const finish = async (page) => {
  await page.click('#finishBtn');
  await page.waitForSelector('#finishConfirm', { timeout: 8000 });
  await page.click('#mpFinishYes');
};
/** 等待页那颗「不等了」此刻看不看得见、字是什么。 */
const forceBtn = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('#mpWait #mpWaitForce');
    return { there: Boolean(b), shown: Boolean(b && !b.hidden && b.offsetParent), text: b?.textContent?.trim() ?? '' };
  });
const onRoomPage = (page) =>
  page.waitForFunction(() => !document.querySelector('#mpWait') && Boolean(document.querySelector('#mpLeave')), { timeout: 20000 })
    .then(() => true).catch(() => false);

const A = await newPlayer();
await giveGenius(A.page);
const code = await openRoom(A.page, '甲');
const B = await newPlayer();
await joinRoom(B.page, '乙', code);
const C = await newPlayer();
await joinRoom(C.page, '丙', code);
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 3, { timeout: 15000 });

await hostPicks(A.page);
const allUp = (await boardUp(A.page)) && (await boardUp(B.page)) && (await boardUp(C.page));
check('（尺子）三个人的棋盘都出来了', allUp);

// ① 客人先交卷：他的等待页上没有这颗键。
await finish(B.page);
await B.page.waitForSelector('#mpWait', { timeout: 10000 }).catch(() => {});
await B.page.waitForTimeout(1500);
const bBtn = await forceBtn(B.page);
check('①（尺子）客人交了卷，等待页盖上了', Boolean(await B.page.$('#mpWait')));
check('① 客人的等待页上没有「不等了」', !bBtn.there, JSON.stringify(bBtn));

// ② 屋主交卷：他的等待页上有。
await finish(A.page);
await A.page.waitForSelector('#mpWait', { timeout: 10000 }).catch(() => {});
await A.page.waitForTimeout(1500);
const aBtn = await forceBtn(A.page);
check('② 屋主的等待页上有「不等了」，看得见', aBtn.there && aBtn.shown, JSON.stringify(aBtn));
check('② 那颗键上的字是「不等了」', aBtn.text === '不等了', aBtn.text);

// ③ 屋主按下去。
await A.page.click('#mpWaitForce');
const aBack = await onRoomPage(A.page);
check('③ 屋主回到了小屋页（这一局结束了）', aBack);
const bBack = await onRoomPage(B.page);
check('③ 先交卷的客人也回到了小屋页', bBack);
await C.page.waitForTimeout(1500);
const cStill = await C.page.evaluate(() => ({
  board: document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length,
  wait: Boolean(document.querySelector('#mpWait')),
  room: Boolean(document.querySelector('#mpLeave')),
}));
check('③ 挂机那一位没被拽走：他手上那一局照旧开着', cStill.board > 0 && !cStill.room, JSON.stringify(cStill));

// ④ 屋主照常挑下一局。
await hostPicks(A.page);
const next = await boardUp(A.page, 25000);
check('④ 下一局开得起来（屋主的棋盘出来了）', next);
const round = await A.page.evaluate(async () => {
  const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || '{}');
  const r = await fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'state', code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken }),
  }).then((x) => x.json());
  return r.round ?? null;
});
check('④ 服务器上是第 2 局', round === 2, String(round));

for (const p of [A, B, C]) await p.ctx.close();
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
