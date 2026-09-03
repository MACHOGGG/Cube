/**
 * 小屋：中途进来的人，和走了又回来的人。
 *
 *   node scripts/dev-server.mjs 8817 dist      （内存版，TESTMONTH 只能兑一次）
 *   node scripts/check-room-rejoin.mjs http://localhost:8817/
 *
 * 三台浏览器。甲开屋、乙进来，甲开一局方块；局打到一半丙拿着房号进来——
 * 服务器现在放他进来，他坐在等待页上看实时排行（三行：甲乙丙），不进这一
 * 局；甲乙交卷之后等待页放下来，甲开第二局，丙这才入局。
 *
 * 第二局打到一半乙按《离开》走了，关掉浏览器；换一台浏览器、还叫「乙」进同
 * 一间屋——拿回的是原来那把椅子（名单上还是三个人，不是四个；「已离开」的
 * 牌子摘掉），这一局也先坐等待页，第三局入局。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
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
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} page error] ${e.message}`));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page, label };
}
async function joinAs(P, name, code) {
  await P.page.click('#navProfile');
  await P.page.click('#multiRow');
  await P.page.waitForSelector('#mpCode', { timeout: 10000 });
  await P.page.fill('#mpName', name);
  await P.page.fill('#mpCode', code);
  await P.page.click('#mpJoin');
}
const hasBoard = (P) => P.page.evaluate(() => document.querySelectorAll('#boardWrap .tile').length > 0);
const waitBoard = (P) =>
  P.page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 40000 });
/** 屋主去主菜单替整屋挑《方块》。 */
async function hostPicksSquare(A) {
  await A.page.waitForSelector('#mpPick', { timeout: 20000 });
  await A.page.click('#mpPick');
  await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
  await A.page.$$eval('.home-icon-btn', (els) => els.find((e) => e.getAttribute('aria-label') === '方块')?.click());
}
async function finish(P) {
  await P.page.click('#finishBtn');
  const yes = await P.page.waitForSelector('#mpFinishYes', { timeout: 5000 }).catch(() => null);
  if (yes) await yes.click();
}
/** 等待页上的名单：名字、有没有「已离开」的牌子。 */
const waitRows = (P) =>
  P.page.$$eval('#mpWaitRows .mp-player', (els) =>
    els.map((e) => ({
      name: e.querySelector('.mp-player-name')?.textContent.trim(),
      left: e.classList.contains('mp-player--left') || Boolean(e.querySelector('.mp-badge--left')),
    })),
  );

const A = await newPlayer('甲');
const B = await newPlayer('乙');
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return r;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until,
    channel: 'code', email: r.email, token: r.token, code: r.code }));
  return r;
});
check('屋主用内部码开通天才', granted.active === true);
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');
await A.page.click('#navProfile'); await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
await A.page.fill('#mpName', '甲'); await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
await joinAs(B, '乙', code);
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });

// ---- 第一局：丙中途进来 ----------------------------------------------------
await hostPicksSquare(A);
await waitBoard(A); await waitBoard(B);
const C = await newPlayer('丙');
await joinAs(C, '丙', code);
const cWait = await C.page.waitForSelector('#mpWait', { timeout: 12000 }).then(() => true).catch(() => false);
check('局打到一半进来的人：进的是等待页，不是棋盘', cWait && !(await hasBoard(C)));
await C.page.waitForTimeout(1500);
const rows1 = await waitRows(C);
check('等待页上是实时排行：甲乙丙三行', rows1.length === 3 && ['甲', '乙', '丙'].every((n) => rows1.some((r) => r.name === n)),
  rows1.map((r) => r.name).join('/'));
// 甲乙交卷：这一局不等丙。
await finish(A); await finish(B);
const cLobby = await C.page.waitForSelector('#mpWait', { state: 'detached', timeout: 20000 }).then(() => true).catch(() => false);
check('甲乙交卷了，丙的等待页放下来（这一局没等他）', cLobby);
check('丙回到小屋页', await C.page.waitForSelector('.mp-code', { timeout: 8000 }).then(() => true).catch(() => false));

// ---- 第二局：丙入局；乙中途走人 ------------------------------------------
await hostPicksSquare(A);
await waitBoard(A); await waitBoard(B);
const cPlays = await waitBoard(C).then(() => true).catch(() => false);
check('下一局开始，丙入局', cPlays);
await B.page.click('#leaveRoomBtn');
await B.page.waitForSelector('#mpLeaveYes', { timeout: 5000 });
await B.page.click('#mpLeaveYes');
await B.page.waitForSelector('#mpFinalCard', { timeout: 12000 });
await B.ctx.close();
// 换一台浏览器，还叫乙。
const B2 = await newPlayer('乙·回来');
await joinAs(B2, '乙', code);
const b2Wait = await B2.page.waitForSelector('#mpWait', { timeout: 12000 }).then(() => true).catch(() => false);
check('乙走了又回来：局还在打，先坐等待页', b2Wait && !(await hasBoard(B2)));
await B2.page.waitForTimeout(1500);
const rows2 = await waitRows(B2);
check('拿回的是原来那把椅子：名单上还是三个人，不是四个', rows2.length === 3, rows2.map((r) => r.name).join('/'));
check('乙那一行的「已离开」摘掉了', rows2.some((r) => r.name === '乙') && !rows2.find((r) => r.name === '乙')?.left);
await finish(A); await finish(C);
check('甲丙交卷了，乙的等待页放下来',
  await B2.page.waitForSelector('#mpWait', { state: 'detached', timeout: 20000 }).then(() => true).catch(() => false));
await A.page.waitForSelector('#mpPick', { timeout: 20000 });
const aRows = await A.page.$$eval('#mpPlayers .mp-player', (els) =>
  els.map((e) => ({ name: e.querySelector('.mp-player-name')?.textContent.trim(), left: e.classList.contains('mp-player--left') })));
check('屋主的名单上：三个人，乙不再标「已离开」',
  aRows.length === 3 && aRows.some((r) => r.name === '乙' && !r.left), JSON.stringify(aRows));

// ---- 第三局：乙入局 --------------------------------------------------------
await hostPicksSquare(A);
await waitBoard(A); await waitBoard(C);
check('第三局开始，回来的乙入局', await waitBoard(B2).then(() => true).catch(() => false));

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
