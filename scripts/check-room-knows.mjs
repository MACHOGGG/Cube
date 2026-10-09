/**
 * 小屋开局前那一问「会 XXX 的规则吗？」——答了「会」就记下来，下一局不再为他多等四秒（2026-10-08
 * 方案 2-10）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8996 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-room-knows.mjs http://localhost:8996/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 屋里有人没看过这一族的教学，服务器开局时就多留四秒（ASK_MS）：全屋的倒数从 8 数起，那四秒里
 * 他的设备问他「会不会」。从前他答「会」只是收起这一问——本机不记、服务器也不知道（座位上的 seen
 * 没变），于是**每一局**都这样：全屋多等四秒，他每一局都被同一个问题问一遍。
 *
 *   ①（尺子）第一局：客人没看过方块的教学，服务器多留了四秒（countFrom 比基础多 4），他被问了。
 *   ①乙 他按了手机的返回键：那一问收起，**不算答「会」**——本机不记，这一局照打（10-09 补充方案
 *      7-13 第 11 条；原先返回键等于答「会」，一按就记成「看过了」，以后再也不问）。
 *   ② 第二局同一族：服务器照旧多留四秒、照旧问他（返回键那一下服务器也没被告知「看过了」）；这一
 *      回他答「会」：本机记下「方块看过了」。
 *   ③ 第三局同一族：服务器不再多留四秒，他也不再被问。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-room-knows.mjs http://localhost:8996/');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** @param seen 预设「看过教学」——屋主预设（这一台问的不是他），客人**不预设**（问的就是他）。 */
async function newPlayer(seen) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((pre) => {
    if (sessionStorage.getItem('gate_primed') === '1') return;
    sessionStorage.setItem('gate_primed', '1');
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    if (pre) for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle']) localStorage.setItem(k, '1');
  }, seen);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}
const toMultiplayer = async (page) => {
  await page.$eval('#navProfile', (e) => e.click());
  await page.waitForSelector('#multiRow', { timeout: 10000 });
  await page.$eval('#multiRow', (e) => e.click());
  await page.waitForSelector('#mpCreate', { timeout: 10000 });
};
const hostPicksSquare = async (page) => {
  await page.click('#mpPick');
  await page.waitForSelector('#roomPickBar');
  await page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
};
const boardUp = (page, ms = 25000) =>
  page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: ms })
    .then(() => true).catch(() => false);
const finish = async (page) => {
  await page.click('#finishBtn');
  await page.waitForSelector('#finishConfirm', { timeout: 8000 });
  await page.click('#mpFinishYes');
};
/** 服务器这一局让大家从几数起。 */
const countFrom = (page) =>
  page.evaluate(async () => {
    const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || '{}');
    const r = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'state', code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken }),
    }).then((x) => x.json());
    return { round: r.round, countFrom: r.countFrom };
  });

const A = await newPlayer(true);
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return false;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
  return true;
});
check('（尺子）TESTMONTH 兑到了开屋的权限', granted);
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');
await toMultiplayer(A.page);
await A.page.fill('#mpName', '甲');
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());

const B = await newPlayer(false);
check('（尺子）客人这台设备没看过方块的教学', (await B.page.evaluate(() => localStorage.getItem('slides_tutorial_seen'))) === null);
await toMultiplayer(B.page);
await B.page.fill('#mpName', '乙');
await B.page.fill('#mpCode', code);
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 15000 });

// ── ① 第一局 ─────────────────────────────────────────────────────────────
await hostPicksSquare(A.page);
const asked1 = await B.page.waitForSelector('#mpKnowAsk', { timeout: 15000 }).then(() => true).catch(() => false);
const r1 = await countFrom(A.page);
check('①（尺子）第一局：客人被问了「会不会」', asked1);
check('①（尺子）第一局：服务器多留了四秒（从 8 数起）', r1.round === 1 && r1.countFrom === 8, JSON.stringify(r1));

/** 一局打完，两边回到小屋页。 */
const playOut = async (label) => {
  const up = (await boardUp(A.page)) && (await boardUp(B.page));
  check(`（尺子）${label}两边的棋盘都出来了`, up);
  await finish(A.page);
  await finish(B.page);
  const home = await A.page
    .waitForFunction(() => !document.querySelector('#mpWait') && Boolean(document.querySelector('#mpPick')), { timeout: 30000 })
    .then(() => true).catch(() => false);
  check(`（尺子）${label}打完，屋主回到小屋页`, home);
};

// ── ①乙 按手机的返回键：只收起，不算答「会」 ─────────────────────────────────
if (asked1) {
  // 哨兵是这一层画到屏幕上之后才推的（见 engine/backNav.ts 的 arm）：按返回之前先等它立好。
  await B.page.waitForTimeout(150);
  await B.page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  await B.page.waitForTimeout(400);
}
check('①乙 按返回键：那一问收起了', !(await B.page.$('#mpKnowAsk')));
check('①乙 按返回键不算答「会」：本机没记「方块看过了」', (await B.page.evaluate(() => localStorage.getItem('slides_tutorial_seen'))) === null);
await playOut('第一局');

// ── ② 第二局同一族：照旧问；这回答「会」 ───────────────────────────────────
await hostPicksSquare(A.page);
const asked2 = await B.page.waitForSelector('#mpKnowAsk', { timeout: 15000 }).then(() => true).catch(() => false);
const r2 = await countFrom(A.page);
check('② 第二局：返回键那一下服务器也没被当成「看过了」，照旧多留四秒（从 8 数起）', r2.round === 2 && r2.countFrom === 8, JSON.stringify(r2));
check('② 第二局：客人照旧被问', asked2);
if (asked2) await B.page.click('#mpKnowYes');
await B.page.waitForTimeout(800);
check('② 答了「会」：本机记下了「方块看过了」', (await B.page.evaluate(() => localStorage.getItem('slides_tutorial_seen'))) === '1');
await playOut('第二局');

// ── ③ 第三局同一族 ───────────────────────────────────────────────────────
await hostPicksSquare(A.page);
await A.page.waitForTimeout(1500);
const r3 = await countFrom(A.page);
check('③ 第三局：服务器不再多留四秒（从 4 数起）', r3.round === 3 && r3.countFrom === 4, JSON.stringify(r3));
const asked3 = await B.page.waitForSelector('#mpKnowAsk', { timeout: 4000 }).then(() => true).catch(() => false);
check('③ 第三局：客人不再被问', !asked3);

await A.ctx.close();
await B.ctx.close();
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
