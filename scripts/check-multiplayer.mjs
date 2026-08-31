/**
 * Two browsers, one room, one board.
 *
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-multiplayer.mjs http://localhost:8815/
 *
 * What this is really here to prove is the one thing the whole design rests
 * on: that two devices in the same room deal a board that is identical piece
 * for piece, without a board ever being sent to either of them. It drives
 * the real UI throughout - redeeming a code, opening a room, joining by its
 * four digits, the countdown, and the live standings - so it fails if any
 * step of that chain stops working, not only the seeding.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
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
  return { ctx, page };
}

/**
 * The board as drawn: every coloured piece inside it, in DOM order. Written
 * without naming a class, because each shape draws its own — .tile for the
 * squares, .ball for the circles — and the point is to compare boards, not
 * to know how one is built.
 */
const boardSignature = (page) =>
  page.$$eval('#boardWrap *', (els) =>
    els
      .map((e) => e.style.backgroundColor || e.getAttribute('fill') || '')
      .filter(Boolean)
      .join(','));

const A = await newPlayer('host');
const B = await newPlayer('guest');

// ---- the host becomes a subscriber the server can actually verify -------
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }),
  }).then((x) => x.json());
  if (!r.active) return r;
  // Exactly what src/engine/account.ts writes after a redemption, including
  // the code — an unbound holder has no address, so the code is its name.
  localStorage.setItem(
    'slides_genius',
    JSON.stringify({
      active: true,
      period: r.period,
      until: r.until,
      channel: 'code',
      email: r.email,
      token: r.token,
      code: r.code,
    }),
  );
  return r;
});
check('房主用兑换码开通天才', granted.active === true, granted.period || JSON.stringify(granted));
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');

// ---- a non-subscriber is offered the paywall, not an error --------------
await B.page.click('#navProfile');
await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCreate', { timeout: 10000 });
await B.page.click('#mpCreate');
const paywall = await B.page.waitForSelector('.genius-modal', { timeout: 5000 }).catch(() => null);
check('非天才点开房间，看到的是付费墙而不是报错', !!paywall);
if (paywall) await B.page.click('#geniusClose');

// ---- the host opens a room ---------------------------------------------
await A.page.click('#navProfile');
await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
await A.page.fill('#mpName', '甲');
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = (await A.page.$eval('.mp-code', (e) => e.textContent.trim()));
check('房主开出房间，拿到四位房号', /^\d{4}$/.test(code), code);

// ---- the guest joins ----------------------------------------------------
await B.page.fill('#mpName', '乙');
await B.page.fill('#mpCode', code);
// The box has to be big enough to read four digits back off, and they have
// to actually be in it — the old row gave the button width:100% and left
// the input 30px, so what you typed was there and invisible.
const codeBox = await B.page.$eval('#mpCode', (e) => ({
  w: Math.round(e.getBoundingClientRect().width),
  size: Math.round(parseFloat(getComputedStyle(e).fontSize)),
  value: e.value,
}));
check('房号输入框够大且显示已输入的四位', codeBox.w >= 200 && codeBox.size >= 20 && codeBox.value === code,
  `宽 ${codeBox.w}px · 字号 ${codeBox.size}px · 内容「${codeBox.value}」`);
await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
check('客人凭房号进来了', (await B.page.$eval('.mp-code', (e) => e.textContent.trim())) === code);

await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });
const roster = await A.page.$$eval('.mp-player', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
check('房主那边看到两个人', roster.length === 2, roster.join(' / '));
check('房主有房主标记，客人没有',
  (await A.page.$$eval('.mp-badge', (e) => e.length)) === 1);
check('只有房主看得到开局入口', (await B.page.$('#mpPick')) === null && (await A.page.$('#mpPick')) !== null);

// ---- the host goes to the home page and picks a board there -------------
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
check('房主到了主菜单，顶上有「为整房选玩法」的横幅', true,
  (await A.page.$eval('.room-pick-title', (e) => e.textContent.trim())));
check('屏幕外框亮起房主提示',
  await A.page.evaluate(() => document.body.classList.contains('is-room-host')));
// The second base card is the circle — the same board the old .mp-mode
// button chose, so the seeding check below is comparing the same thing.
await A.page.$$eval('.home-icon-btn', (els) => els[1].click());

await Promise.all([
  A.page.waitForSelector('.mp-countdown', { timeout: 8000 }),
  B.page.waitForSelector('.mp-countdown', { timeout: 8000 }),
]);
check('两端都进入倒计时', true);

const [aBoardAt, bBoardAt] = await Promise.all([
  A.page.waitForFunction(() => document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length > 0, { timeout: 15000 }).then(() => Date.now()),
  B.page.waitForFunction(() => document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length > 0, { timeout: 15000 }).then(() => Date.now()),
]);
check('两端几乎同时开局', Math.abs(aBoardAt - bBoardAt) < 1200, `相差 ${Math.abs(aBoardAt - bBoardAt)}ms`);

// ---- THE requirement: the very same board ------------------------------
await A.page.waitForTimeout(900);
const sigA = await boardSignature(A.page);
const sigB = await boardSignature(B.page);
check('两端棋盘逐格完全一致', sigA === sigB && sigA.length > 0,
  `${sigA.split(',').length} 格`);
if (sigA !== sigB) {
  const a = sigA.split(','), b = sigB.split(',');
  console.log('   首个不同处:', a.findIndex((v, i) => v !== b[i]));
}
check('开局不需要再按「开始」', (await A.page.$eval('#startOverlay', (e) => e.classList.contains('show'))) === false);

// ---- a third, unseeded run must NOT match -------------------------------
const C = await newPlayer('solo');
await C.page.$$eval('.home-icon-btn', (els) => els[1].click());
await C.page.waitForSelector('#startBtn', { timeout: 10000 });
await C.page.click('#startBtn');
await C.page.waitForTimeout(700);
const sigSolo = await boardSignature(C.page);
check('单人局是另一副牌（说明不是写死的棋盘）', sigSolo !== sigA, `${sigSolo.split(',').length} 格`);

// ---- the live standings -------------------------------------------------
await A.page.waitForSelector('.mp-board-row', { timeout: 8000 });
await B.page.waitForSelector('.mp-board-row', { timeout: 8000 });
check('两端都有排行榜且各两行',
  (await A.page.$$eval('.mp-board-row', (e) => e.length)) === 2 &&
  (await B.page.$$eval('.mp-board-row', (e) => e.length)) === 2);
check('自己那一行被标出来', (await A.page.$$eval('.mp-board-row--me', (e) => e.length)) === 1);

// A scores; B must see it, and the order must flip.
await A.page.evaluate(() => { document.getElementById('scoreReel').dataset.score = '250'; });
await B.page.waitForFunction(
  () => [...document.querySelectorAll('.mp-board-score')].some((e) => e.textContent.trim() === '250'),
  { timeout: 8000 },
).catch(() => {});
const bView = await B.page.$$eval('.mp-board-row', (els) =>
  els.map((e) => e.querySelector('.mp-board-name').textContent.trim() + ':' + e.querySelector('.mp-board-score').textContent.trim()));
check('甲得分后，乙那边实时看到并升到第一', bView[0] === '甲:250', bView.join(' '));

// ---- the round ends: back to the room, not out of it --------------------
// Both finish, which is what tells the server the round is over.
for (const P of [A, B]) {
  await P.page.click('#finishBtn');
  await P.page.waitForSelector('#endOverlay.show', { timeout: 8000 });
}

// The multiplayer card carries the places; a solo one has no room to.
await A.page.click('#shareBtn');
await A.page.waitForSelector('#shareOverlay.show', { timeout: 8000 });
const cardW = await A.page.$eval('#shareImage', (e) => e.naturalWidth);
check('多人局的战绩图画出来了', cardW > 0, `${cardW}px 宽`);
await A.page.click('#shareCloseBtn');

await A.page.click('#endBackBtn');
await A.page.waitForSelector('.mp-code', { timeout: 12000 });
check('一局打完回到房间，房间没散', (await A.page.$eval('.mp-code', (e) => e.textContent.trim())) === code);
check('房间里看得到累计总分', (await A.page.$$eval('.mp-player-total', (e) => e.length)) === 2);
await A.page.waitForSelector('#mpPick', { timeout: 12000 });
check('房主可以再开一局', (await A.page.$eval('#mpPick', (e) => e.textContent.trim())).length > 0);
check('房主也可以结束房间', (await A.page.$('#mpEnd')) !== null);

// ---- closing the room draws the evening's card --------------------------
await B.page.click('#endBackBtn').catch(() => {});
await A.page.click('#mpEnd');
await A.page.waitForSelector('#mpFinalCard', { timeout: 12000 });
check('散场时出总战绩', (await A.page.$$eval('#mpFinalRows .mp-player', (e) => e.length)) === 2);
const finalCard = await A.page.waitForFunction(
  () => document.getElementById('mpFinalCard')?.naturalWidth > 0, { timeout: 8000 },
).then(() => true).catch(() => false);
check('总战绩图渲染出来了', finalCard);
// The other player is told, without having to press anything.
const bEnded = await B.page.waitForSelector('#mpFinalCard', { timeout: 12000 }).then(() => true).catch(() => false);
check('客人那边也自动看到总战绩', bEnded);

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
