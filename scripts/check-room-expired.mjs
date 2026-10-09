/**
 * 局中小屋过期了（10-09 补充方案 7-13 第 14 条）：计分板说一句，给出回主页的路，不再一直挂着。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8997 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-room-expired.mjs http://localhost:8997/
 *
 * ── 那个病 ────────────────────────────────────────────────────
 *
 * 小屋在库里二十分钟没人动就过期（api/room.js 的 ROOM_TTL_S）。过期之后每一问都答 404 noRoom，而局中
 * 那块计分板（ui/scoreboard.ts）对轮询失败一律「什么都不动」——这一种不是「这一下没问到」，是定论：
 * 交了卷的人永远停在等待页上，正打着的人打完也一样。
 *
 * 「过期」是用路由拦截做出来的：让那台设备此后问 /api/room 的每一句都答 404 noRoom——和库里那间屋
 * 真没了的时候服务器答的一字不差。等二十分钟不现实。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 *   ①（对照）一阵普通的失败（502）：照旧什么都不动——名单、《离开小屋》都还在，没有飘字。不然这一改
 *      就把「网抖一下」也变成了散场。
 *   ② 正打着的人：原地转成单人接着打——飘过「小屋已过期，正在独自游玩」，《离开小屋》撤了、《暂停》
 *      露出来，棋盘还在。
 *   ③ 已经交了卷、在等别人的人：等待页撤掉，一句「这间小屋已经过期了。」加一颗《主页》，按下去回主页。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-room-expired.mjs http://localhost:8997/');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];

async function newPlayer(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('gate_primed') === '1') return;
    sessionStorage.setItem('gate_primed', '1');
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`));
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
const boardUp = (page, ms = 25000) =>
  page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: ms })
    .then(() => true).catch(() => false);
/** 从此这台设备问 /api/room 的每一句都答 status（noRoom 就是库里那间屋没了）。 */
const answerRoom = (page, status, error) =>
  page.route('**/api/room', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) }));
const look = (page) =>
  page.evaluate(() => ({
    board: document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
    leave: Boolean(document.querySelector('#leaveRoomBtn')),
    rows: document.querySelectorAll('.mp-board-row').length,
    pauseShown: (() => {
      const b = document.querySelector('#stopBtn');
      return Boolean(b) && !b.hidden && b.getBoundingClientRect().width > 0;
    })(),
    flyby: [...document.querySelectorAll('.solo-flyby')].map((e) => e.textContent.trim()),
    wait: Boolean(document.querySelector('#mpWait')),
    notice: document.querySelector('#roomLockedOut .tag-line')?.textContent?.trim() ?? '',
    noticeBtn: document.querySelector('#roomLockedOut #roomLockedOk')?.textContent?.trim() ?? '',
    home: Boolean(document.querySelector('.home-page')),
  }));

// ── 一屋三人：甲开屋，乙、丙进来，甲挑方块开局 ─────────────────────────
const A = await newPlayer('甲');
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
const B = await newPlayer('乙');
const C = await newPlayer('丙');
for (const [P, name] of [[B, '乙'], [C, '丙']]) {
  await toMultiplayer(P.page);
  await P.page.fill('#mpName', name);
  await P.page.fill('#mpCode', code);
  await P.page.waitForSelector('.mp-code', { timeout: 10000 });
}
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 3, { timeout: 15000 });
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar');
await A.page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
const up = (await boardUp(A.page)) && (await boardUp(B.page)) && (await boardUp(C.page));
check('（尺子）三个人的棋盘都出来了', up);
await B.page.waitForSelector('.mp-board-row', { timeout: 10000 });

// 丙先交卷：他在等甲和乙，盖着等待页。
await C.page.click('#finishBtn');
await C.page.waitForSelector('#finishConfirm', { timeout: 8000 });
await C.page.click('#mpFinishYes');
const cWaits = await C.page.waitForSelector('#mpWait', { timeout: 10000 }).then(() => true).catch(() => false);
check('（尺子）丙交了卷，等待页盖上了', cWaits);

// ── ① 对照：一阵普通的失败（502）什么都不动 ─────────────────────────────
await answerRoom(B.page, 502, 'upstream');
await B.page.waitForTimeout(3000);
const b0 = await look(B.page);
check('① 一阵 502：乙那边什么都没动（名单、《离开小屋》都在，没有飘字）', b0.board && b0.leave && b0.rows > 0 && b0.flyby.length === 0,
  JSON.stringify(b0));
await B.page.unroute('**/api/room');

// ── ② 正打着的人：原地转单人 ─────────────────────────────────────────────
await answerRoom(B.page, 404, 'noRoom');
const bSolo = await B.page.waitForFunction(() => !document.querySelector('#leaveRoomBtn'), { timeout: 8000 }).then(() => true).catch(() => false);
const b1 = await look(B.page);
check('② 小屋过期了，正打着的乙：飘过「小屋已过期，正在独自游玩」', b1.flyby.includes('小屋已过期，正在独自游玩'), JSON.stringify(b1.flyby));
check('② 原地转成单人：《离开小屋》撤了、名单撤了、《暂停》露出来，棋盘还在',
  bSolo && !b1.leave && b1.rows === 0 && b1.pauseShown && b1.board, JSON.stringify(b1));
check('② 没被一张遮罩糊住盘面', !b1.notice, b1.notice);

// ── ③ 交了卷在等的人：说一句，按下去回主页 ───────────────────────────────
await answerRoom(C.page, 404, 'noRoom');
const cTold = await C.page.waitForSelector('#roomLockedOut', { timeout: 8000 }).then(() => true).catch(() => false);
const c1 = await look(C.page);
check('③ 小屋过期了，在等的丙：等待页撤了，一句「这间小屋已经过期了。」', cTold && !c1.wait && c1.notice === '这间小屋已经过期了。',
  JSON.stringify(c1));
check('③ 那颗键写的是《主页》', c1.noticeBtn === '主页', c1.noticeBtn);
if (cTold) await C.page.click('#roomLockedOk');
const cHome = await C.page.waitForSelector('.home-page', { timeout: 8000 }).then(() => true).catch(() => false);
check('③ 按下去回到主页', cHome);

check('全程零报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await A.ctx.close();
await B.ctx.close();
await C.ctx.close();
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
