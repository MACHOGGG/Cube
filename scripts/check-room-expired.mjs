/**
 * 局中小屋过期了（10-09 补充方案 7-13 第 14 条）：计分板说一句，给出回主页的路，不再一直挂着。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8997 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-room-expired.mjs http://localhost:8997/
 *
 * ── 那个病 ────────────────────────────────────────────────────
 *
 * 小屋在库里二十分钟没人动就过期（api/room.js 的 ROOM_TTL_S）。过期之后每一问都答 409 ended（墓碑还在的那
 * 二十四小时，10-11 方案 C-3）或者 404 noRoom（墓碑也过了），而局中
 * 那块计分板（ui/scoreboard.ts）对轮询失败一律「什么都不动」——这一种不是「这一下没问到」，是定论：
 * 交了卷的人永远停在等待页上，正打着的人打完也一样。
 *
 * 「过期」是用路由拦截做出来的：让那台设备此后问 /api/room 的每一句都答 ended（乙）或 noRoom（丙）——和库里那间屋
 * 真没了的时候服务器答的一字不差。等二十分钟不现实。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 *   ①（对照）一阵普通的失败（502）：照旧什么都不动——名单、《离开小屋》都还在，没有飘字。不然这一改
 *      就把「网抖一下」也变成了散场。
 *   ② 正打着的人：原地转成单人接着打——飘过「小屋已经结束了，正在独自游玩」，《离开小屋》撤了、《暂停》
 *      露出来，棋盘还在。
 *   ③ 已经交了卷、在等别人的人：等待页撤掉，一句「这个小屋已经结束了。」加一颗《主页》，按下去回主页。
 *   话是屋主散场那同一句（mpErrEnded，10-11 方案 C-3 第 3 条）：原先局中写「已过期」、大厅写「没有这个小屋
 *   号码」，同一件事三种说法。
 *   ④ 局中收到 seat（座位被同名的人在另一台设备上认领走了，10-15 补充 S4）：正打着的丁原地转单人、飘「您的位子
 *      已经被另一台设备认领了。」；交了卷在等的戊，等待页撤掉、说这一句、按《主页》回主页。原先服务器照样回 200，
 *      旧手机报分条条 403、屏幕上一个字都没有。
 *   ⑤ 启动时（本机拿着座位、重开网页直接进小屋页）服务器答 ended：落在设置页，说「这个小屋已经结束了。」、本机座位
 *      清掉。原先说的是「没有这个小屋号码」——屋子过期之后墓碑还在，服务器答的其实是 ended。
 *   ⑥ 重连页（启动那一问没打通，挂着「正在把您接回小屋」）之后收到 ended：同一句、座位清掉。
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
const D = await newPlayer('丁');
const E = await newPlayer('戊');
for (const [P, name] of [[B, '乙'], [C, '丙'], [D, '丁'], [E, '戊']]) {
  await toMultiplayer(P.page);
  await P.page.fill('#mpName', name);
  await P.page.fill('#mpCode', code);
  await P.page.waitForSelector('.mp-code', { timeout: 10000 });
}
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 5, { timeout: 15000 });
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar');
await A.page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
const up = (await boardUp(A.page)) && (await boardUp(B.page)) && (await boardUp(C.page)) && (await boardUp(D.page)) && (await boardUp(E.page));
check('（尺子）五个人的棋盘都出来了', up);
await B.page.waitForSelector('.mp-board-row', { timeout: 10000 });

// 丙先交卷：他在等甲和乙，盖着等待页。
await C.page.click('#finishBtn');
await C.page.waitForSelector('#finishConfirm', { timeout: 8000 });
await C.page.click('#mpFinishYes');
const cWaits = await C.page.waitForSelector('#mpWait', { timeout: 10000 }).then(() => true).catch(() => false);
check('（尺子）丙交了卷，等待页盖上了', cWaits);
// 戊也交卷（④ 用）。
await E.page.click('#finishBtn');
await E.page.waitForSelector('#finishConfirm', { timeout: 8000 });
await E.page.click('#mpFinishYes');
const eWaits = await E.page.waitForSelector('#mpWait', { timeout: 10000 }).then(() => true).catch(() => false);
check('（尺子）戊交了卷，等待页盖上了', eWaits);

// ── ① 对照：一阵普通的失败（502）什么都不动 ─────────────────────────────
await answerRoom(B.page, 502, 'upstream');
await B.page.waitForTimeout(3000);
const b0 = await look(B.page);
check('① 一阵 502：乙那边什么都没动（名单、《离开小屋》都在，没有飘字）', b0.board && b0.leave && b0.rows > 0 && b0.flyby.length === 0,
  JSON.stringify(b0));
await B.page.unroute('**/api/room');

// ── ② 正打着的人：原地转单人 ─────────────────────────────────────────────
await answerRoom(B.page, 409, 'ended');
const bSolo = await B.page.waitForFunction(() => !document.querySelector('#leaveRoomBtn'), { timeout: 8000 }).then(() => true).catch(() => false);
const b1 = await look(B.page);
check('② 小屋过期了（服务器答 ended），正打着的乙：飘过「小屋已经结束了，正在独自游玩」', b1.flyby.includes('小屋已经结束了，正在独自游玩'), JSON.stringify(b1.flyby));
check('② 原地转成单人：《离开小屋》撤了、名单撤了、《暂停》露出来，棋盘还在',
  bSolo && !b1.leave && b1.rows === 0 && b1.pauseShown && b1.board, JSON.stringify(b1));
check('② 没被一张遮罩糊住盘面', !b1.notice, b1.notice);

// ── ③ 交了卷在等的人：说一句，按下去回主页 ───────────────────────────────
await answerRoom(C.page, 404, 'noRoom');
const cTold = await C.page.waitForSelector('#roomLockedOut', { timeout: 8000 }).then(() => true).catch(() => false);
const c1 = await look(C.page);
check('③ 小屋过期了（墓碑也过了，noRoom），在等的丙：等待页撤了，一句「这个小屋已经结束了。」', cTold && !c1.wait && c1.notice === '这个小屋已经结束了。',
  JSON.stringify(c1));
check('③ 那颗键写的是《主页》', c1.noticeBtn === '主页', c1.noticeBtn);
if (cTold) await C.page.click('#roomLockedOk');
const cHome = await C.page.waitForSelector('.home-page', { timeout: 8000 }).then(() => true).catch(() => false);
check('③ 按下去回到主页', cHome);

// ── ④ 局中收到 seat：座位被同名的人在另一台设备上认领走了（10-15 补充 S4）────────────────────────
const SEAT_GONE = '您的位子已经被另一台设备认领了。';
await answerRoom(D.page, 403, 'seat');
const dSolo = await D.page.waitForFunction(() => !document.querySelector('#leaveRoomBtn'), { timeout: 8000 }).then(() => true).catch(() => false);
const d1 = await look(D.page);
check('④ 正打着的丁收到 seat：飘过「您的位子已经被另一台设备认领了。」', d1.flyby.includes(SEAT_GONE), JSON.stringify(d1.flyby));
check('④ 丁原地转成单人：《离开小屋》撤了、《暂停》露出来，棋盘还在', dSolo && !d1.leave && d1.pauseShown && d1.board, JSON.stringify(d1));
await answerRoom(E.page, 403, 'seat');
const eTold = await E.page.waitForSelector('#roomLockedOut', { timeout: 8000 }).then(() => true).catch(() => false);
const e1 = await look(E.page);
check('④ 交了卷在等的戊收到 seat：等待页撤了，说「您的位子已经被另一台设备认领了。」', eTold && !e1.wait && e1.notice === SEAT_GONE, JSON.stringify(e1));
check('④ 那颗键写的是《主页》', e1.noticeBtn === '主页', e1.noticeBtn);

// ── ⑤⑥ 本机拿着座位重开网页：启动那一问答 ended / 先没打通、重连页上再答 ended（10-15 补充 S4）──────────
const ENDED = '这个小屋已经结束了。';
const seatedNewcomer = async (label) => {
  const P = await newPlayer(label);
  await toMultiplayer(P.page);
  await P.page.fill('#mpName', label);
  await P.page.fill('#mpCode', code);
  await P.page.waitForSelector('.mp-code', { timeout: 10000 });
  const seat = await P.page.evaluate(() => localStorage.getItem('slides_mp_seat'));
  return { ...P, seat };
};
const homeMsg = (page) =>
  page.evaluate(() => ({
    msg: document.querySelector('#mpMsg')?.textContent?.trim() ?? null,
    seat: localStorage.getItem('slides_mp_seat'),
    reconnecting: Boolean(document.querySelector('#mpReconnectHint')),
  }));
{
  const F = await seatedNewcomer('己');
  check('⑤（尺子）己坐进了小屋，本机记着座位', Boolean(F.seat));
  await answerRoom(F.page, 409, 'ended');
  await F.page.reload({ waitUntil: 'load' });
  const told = await F.page.waitForFunction((t) => document.querySelector('#mpMsg')?.textContent?.trim() === t, ENDED, { timeout: 10000 })
    .then(() => true).catch(() => false);
  const f1 = await homeMsg(F.page);
  check('⑤ 启动时服务器答 ended：设置页上说「这个小屋已经结束了。」（不是「没有这个小屋号码」）', told, JSON.stringify(f1));
  check('⑤ 本机座位清掉了', f1.seat === null, String(f1.seat));
  await F.ctx.close();
}
{
  const G = await seatedNewcomer('庚');
  check('⑥（尺子）庚坐进了小屋，本机记着座位', Boolean(G.seat));
  await answerRoom(G.page, 502, 'upstream');
  await G.page.reload({ waitUntil: 'load' });
  const onReconnect = await G.page.waitForSelector('#mpReconnectHint', { timeout: 10000 }).then(() => true).catch(() => false);
  check('⑥（尺子）启动那一问没打通：挂着重连页', onReconnect);
  await G.page.unroute('**/api/room');
  await answerRoom(G.page, 409, 'ended');
  const told = await G.page.waitForFunction((t) => document.querySelector('#mpMsg')?.textContent?.trim() === t, ENDED, { timeout: 12000 })
    .then(() => true).catch(() => false);
  const g1 = await homeMsg(G.page);
  check('⑥ 重连页上收到 ended：设置页上说「这个小屋已经结束了。」', told, JSON.stringify(g1));
  check('⑥ 本机座位清掉了', g1.seat === null, String(g1.seat));
  await G.ctx.close();
}

check('全程零报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await A.ctx.close();
await B.ctx.close();
await C.ctx.close();
await D.ctx.close();
await E.ctx.close();
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
