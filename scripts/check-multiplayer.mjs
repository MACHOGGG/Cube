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
check('房主用内部码开通天才', granted.active === true, granted.period || JSON.stringify(granted));
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');

// ---- a non-subscriber is offered the paywall, not an error --------------
await B.page.click('#navProfile');
await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCreate', { timeout: 10000 });
// 按下去才知道按不动，是白按一次。所以这颗键自己要说清楚：一把小锁，加一块
// 半尺寸（主菜单上锁着的玩法是 80px，这里 40px）的天才招牌。
const gate = await B.page.$eval('#mpCreate', (el) => {
  const size = (sel) => {
    const e = el.querySelector(sel);
    return e ? Math.round(e.getBoundingClientRect().height) : 0;
  };
  return { locked: el.classList.contains('genius-cta--locked'), lock: size('.cta-lock'), crest: size('.genius-logo') };
});
check('没订阅的人，《开房间》上挂着锁和天才招牌', gate.locked && gate.lock > 0 && gate.crest > 0,
  JSON.stringify(gate));
check('招牌是主菜单那块的一半（40px 上下）', Math.abs(gate.crest - 40) <= 2, `${gate.crest}px`);
await B.page.click('#mpCreate');
const paywall = await B.page.waitForSelector('.genius-modal', { timeout: 5000 }).catch(() => null);
check('非天才点开房间，看到的是付费墙而不是报错', !!paywall);
check('而且没有真的开出房间来', (await B.page.$('.mp-code')) === null);
if (paywall) await B.page.click('#geniusClose');

// ---- the host opens a room ---------------------------------------------
await A.page.click('#navProfile');
await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
// 招牌对开通了的人同样成立：那是他才有的权利。变的只有那把锁。
const opened = await A.page.$eval('#mpCreate', (el) => ({
  locked: el.classList.contains('genius-cta--locked'),
  lock: !!el.querySelector('.cta-lock'),
  crest: !!el.querySelector('.genius-logo'),
}));
check('开通了的人，锁没了，招牌还在', opened.locked === false && opened.lock === false && opened.crest === true,
  JSON.stringify(opened));
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

// 交座位这件事，房间页和结算页上是同一颗键，就该是同一个说法——两个名字会让
// 人以为是两回事，于是谁也不敢按。这里记下房间页上的写法，等结算页出来再比。
const roomLeaveLabel = await A.page.$eval('#mpLeave', (e) => e.textContent.trim());

await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });
const roster = await A.page.$$eval('.mp-player', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
check('房主那边看到两个人', roster.length === 2, roster.join(' / '));
check('房主有房主标记，客人没有',
  (await A.page.$$eval('.mp-badge', (e) => e.length)) === 1);
check('只有房主看得到开局入口', (await B.page.$('#mpPick')) === null && (await A.page.$('#mpPick')) !== null);

// ---- the host goes to the home page and picks a board there -------------
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
const pickBanner = await A.page.$eval('.room-pick-title', (e) => e.textContent.trim());
check('房主到了主菜单，横幅上写着「你为 <房号> 房间选择」',
  pickBanner.includes(code) && pickBanner.startsWith('你为'), pickBanner);
// 横幅从两行减成一行：那句「点哪个玩法全房间就跟着玩」的说明去掉了，红色
// 的大字自己就说清楚了这件事。
check('横幅只剩这一行，说明那行没了', (await A.page.$('.room-pick-hint')) === null);
check('屏幕外框亮起房主提示',
  await A.page.evaluate(() => document.body.classList.contains('is-room-host')));
// 一局刚打完、房主被送回来挑下一个玩法的时候，走人的路原来只剩「先回房间页
// 再点离开」。横幅上这颗小键把那一步省了。
check('房主的横幅上有一颗《离开房间》', (await A.page.$('#roomPickLeave')) !== null);
// The second base card is the circle — the same board the old .mp-mode
// button chose, so the seeding check below is comparing the same thing.
await A.page.$$eval('.home-icon-btn', (els) => els[1].click());

await Promise.all([
  A.page.waitForSelector('.mp-countdown-page .cd-window', { timeout: 8000 }),
  B.page.waitForSelector('.mp-countdown-page .cd-window', { timeout: 8000 }),
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

// 一场同步竞赛暂停不了——别人的钟不会跟着停。所以那个位置让给了真正走得掉的
// 出口，而且按下去要先问一句。
const inRun = await A.page.evaluate(() => ({
  pause: !!document.querySelector('#stopBtn'),
  leave: !!document.querySelector('#leaveRoomBtn'),
}));
check('多人局进行中没有《暂停》，改成《离开房间》', inRun.pause === false && inRun.leave === true,
  JSON.stringify(inRun));
await A.page.click('#leaveRoomBtn');
await A.page.waitForSelector('#leaveRoomConfirm', { timeout: 5000 });
check('打到一半按离开，也先问一句', true);
// 这一局还要接着打下去，所以选「留下」。
await A.page.click('#mpLeaveNo');
await A.page.waitForTimeout(200);
check('选留下就什么都没发生，牌还在手里',
  (await A.page.$('#leaveRoomConfirm')) === null && (await A.page.$('#boardWrap')) !== null);
if (sigA !== sigB) {
  const a = sigA.split(','), b = sigB.split(',');
  console.log('   首个不同处:', a.findIndex((v, i) => v !== b[i]));
}
check('开局不需要再按「开始」', (await A.page.$eval('#startOverlay', (e) => e.classList.contains('show'))) === false);

// ---- a third, unseeded run must NOT match -------------------------------
const C = await newPlayer('solo');
await C.page.$$eval('.home-icon-btn', (els) => els[1].click());
// 单人开局页是 3、2、1 数完自己开局的，那颗键藏在后面不给点；测试不必陪着
// 等三秒，直接替它按下去，验的是「按下去之后棋盘真的起来了」。
await C.page.waitForSelector('#startBtn', { timeout: 10000, state: 'attached' });
await C.page.$eval('#startBtn', (el) => el.click());
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

// ---- 一局打完：结算页上三条路，每一条都得走得通 -------------------------
// 这里守的是一个真出现过的死局：一局结束后回房间，房间页是新建的，它闭包里
// 「已经打过第几局」归零，于是刚打完的那一局被当成新的一局重开，人被扔回一
// 块死棋盘，再点主页又来一次，出不去。
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

const endButtons = (p) =>
  p.$$eval('#endOverlay button', (els) =>
    els.filter((e) => e.offsetParent !== null).map((e) => e.id));
const hostBtns = await endButtons(A.page);
const guestBtns = await endButtons(B.page);
check('房主的结算页有：主页、再来、离开房间',
  ['endBackBtn', 'restartBtn', 'endLeaveRoomBtn'].every((id) => hostBtns.includes(id)),
  hostBtns.join(' '));
check('客人的结算页有离开房间，没有开不了的《再来》',
  guestBtns.includes('endLeaveRoomBtn') && !guestBtns.includes('restartBtn'),
  guestBtns.join(' '));

const endLeaveLabel = await A.page.$eval('#endLeaveRoomBtn', (e) => e.textContent.trim());
check('房间页和结算页上那颗键是同一个说法', endLeaveLabel === roomLeaveLabel,
  `房间页「${roomLeaveLabel}」· 结算页「${endLeaveLabel}」`);

// 客人的《主页》：回房间等下一局。
await B.page.click('#endBackBtn');
const guestBack = await B.page.waitForSelector('.mp-code', { timeout: 12000 })
  .then(() => true).catch(() => false);
check('客人点主页回到房间，没有被重开的那一局卡住', guestBack);
if (guestBack) {
  check('房间没散，房号还是那个', (await B.page.$eval('.mp-code', (e) => e.textContent.trim())) === code);
  check('房间里看得到累计总分', (await B.page.$$eval('.mp-player-total', (e) => e.length)) === 2);
}

// 房主的《主页》：回主菜单，横幅还挂着——那就是「回主页继续玩」。
await A.page.click('#endBackBtn');
await A.page.waitForSelector('#roomPickBar', { timeout: 12000 });
check('房主点主页回到主菜单，还能为整房挑下一个玩法',
  await A.page.evaluate(() => document.body.classList.contains('is-room-host')));

// 第二局，用来验《再来》。
await A.page.$$eval('.home-icon-btn', (els) => els[0].click());
await Promise.all([
  A.page.waitForFunction(() => document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length > 0, { timeout: 20000 }),
  B.page.waitForFunction(() => document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length > 0, { timeout: 20000 }),
]);
for (const P of [A, B]) {
  await P.page.click('#finishBtn');
  await P.page.waitForSelector('#endOverlay.show', { timeout: 8000 });
}

// 《再来》：房主用同一个玩法立刻再开一局，客人也得被带进去——他自己是没法
// 开局的，而倒计时是房间页在听的，他这会儿不在房间页上。
await A.page.click('#restartBtn');
const intoNextRound = (p) =>
  p.waitForFunction(() => {
    const tiles = document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length;
    return tiles > 0 && !document.getElementById('endOverlay')?.classList.contains('show');
  }, { timeout: 30000 }).then(() => true).catch(() => false);
const [hostIn, guestIn] = await Promise.all([intoNextRound(A.page), intoNextRound(B.page)]);
check('房主点《再来》直接开出下一局', hostIn);
check('客人也被带进这一局（没留在上一局的结算页）', guestIn);

for (const P of [A, B]) {
  await P.page.click('#finishBtn');
  await P.page.waitForSelector('#endOverlay.show', { timeout: 8000 });
}

// 《离开房间》：交座位，出一张截止此刻的竞赛排名。
await B.page.click('#endLeaveRoomBtn');
// 交座位之前先问一句——四个出口都问，这里也不例外。
await B.page.waitForSelector('#leaveRoomConfirm', { timeout: 5000 });
check('离开之前先问一句', true);
await B.page.click('#mpLeaveYes');
const rankPage = await B.page.waitForSelector('#mpFinalCard', { timeout: 12000 })
  .then(() => true).catch(() => false);
check('离开房间后出竞赛排名', rankPage);
if (rankPage) {
  check('排名页的标题是《竞赛排名》',
    (await B.page.$eval('.home-sub', (e) => e.textContent.trim())) === '竞赛排名',
    await B.page.$eval('.home-sub', (e) => e.textContent.trim()));
  check('排名里有两个人，自己那一行被标出来',
    (await B.page.$$eval('#mpFinalRows .mp-player', (e) => e.length)) === 2 &&
      (await B.page.$$eval('#mpFinalRows .mp-player--me', (e) => e.length)) === 1);
  const drawn = await B.page.waitForFunction(
    () => document.getElementById('mpFinalCard')?.naturalWidth > 0, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  check('竞赛排名图渲染出来了', drawn);
  await B.page.click('#mpFinalDone');
  check('看完排名回到主菜单',
    await B.page.waitForSelector('.home-page', { timeout: 8000 }).then(() => true).catch(() => false));
}

// ---- 房主散场：整间房的总战绩 -------------------------------------------
await A.page.click('#endBackBtn');
await A.page.waitForSelector('#roomPickBar', { timeout: 12000 });
await A.page.click('#navProfile');
await A.page.click('#multiRow');
await A.page.waitForSelector('#mpEnd', { timeout: 12000 });
await A.page.click('#mpEnd');
await A.page.waitForSelector('#mpFinalCard', { timeout: 12000 });
check('散场时出总战绩', (await A.page.$$eval('#mpFinalRows .mp-player', (e) => e.length)) >= 1);
const finalCard = await A.page.waitForFunction(
  () => document.getElementById('mpFinalCard')?.naturalWidth > 0, { timeout: 8000 },
).then(() => true).catch(() => false);
check('总战绩图渲染出来了', finalCard);

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
