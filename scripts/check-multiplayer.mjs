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

// 房间局的那一排只有两块：左边一整条实时排名，右边一颗《离开房间》。
// 《暂停》没有——一场同步竞赛暂停不了，别人的钟不会跟着停；《完成》也没有。
const inRun = await A.page.evaluate(() => {
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    pause: !!document.querySelector('#stopBtn'),
    rank: box('.mp-rank'),
    leave: box('#leaveRoomBtn'),
    finish: box('#finishBtn'),
  };
});
check('多人局进行中没有《暂停》', inRun.pause === false);
// 左边一半是名单，右边一半分给《离开房间》和《完成》——所以名单差不多是
// 两颗键加起来那么宽。
check('左边一半是排名，右边一半是两颗键',
  !!inRun.rank && !!inRun.leave && !!inRun.finish &&
    inRun.rank.x < inRun.leave.x && inRun.leave.x < inRun.finish.x &&
    Math.abs(inRun.rank.w - (inRun.leave.w + inRun.finish.w)) <= 24,
  `排名 ${inRun.rank?.w}px · 离开 ${inRun.leave?.w}px · 完成 ${inRun.finish?.w}px`);
check('两颗键一样宽', Math.abs((inRun.leave?.w ?? 0) - (inRun.finish?.w ?? -1)) <= 1);
// 名单要和右边那颗键一样高——它们是同一排里的两块，不是一块压着另一块。
check('排名和《离开房间》一样高，站在同一排',
  Math.abs((inRun.rank?.h ?? 0) - (inRun.leave?.h ?? -1)) <= 1,
  `${inRun.rank?.h}px / ${inRun.leave?.h}px`);
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

// ---- 交卷：先问一句，再等别人 -------------------------------------------
//
// 房间局的《完成》不是「结束」那么简单：交出去的分数就是名次，所以先问；问
// 的这几秒钟要停着、牌要盖上，不然犹豫就成了「多看几眼盘面还不吃时间」。
const inRunLeaveLabel = await A.page.$eval('#leaveRoomBtn', (e) => e.getAttribute('aria-label').trim());
check('房间页和局中那颗键是同一个说法', inRunLeaveLabel === roomLeaveLabel,
  `房间页「${roomLeaveLabel}」· 局中「${inRunLeaveLabel}」`);

await A.page.click('#finishBtn');
await A.page.waitForSelector('#finishConfirm', { timeout: 6000 });
const asked = await A.page.evaluate(() => ({
  q: document.querySelector('#finishConfirm .tag-line')?.textContent.trim(),
  opaque: document.querySelector('#finishConfirm')?.classList.contains('opaque'),
  clock: document.getElementById('hud-time')?.textContent,
}));
check('按《完成》先问一句《完成了吗？》', asked.q === '完成了吗？', asked.q);
check('问的时候牌是盖上的（这一层不透明）', asked.opaque === true);
await A.page.waitForTimeout(2200);
const stillHeld = await A.page.evaluate(() => document.getElementById('hud-time')?.textContent);
check('犹豫的这段时间不计入用时', stillHeld === asked.clock, `${asked.clock} → ${stillHeld}`);
await A.page.click('#mpFinishNo');
await A.page.waitForFunction(() => !document.getElementById('finishConfirm'), { timeout: 5000 });
check('选《否》回到牌局，什么都没交出去',
  (await A.page.$('#boardWrap .ball, #boardWrap .tile')) !== null &&
    (await A.page.evaluate(() => !document.getElementById('endOverlay')?.classList.contains('show'))));

// 选《是》：交卷，然后是一页「等别人」——和开局那一幕同一张脸，只是下半屏
// 换成了还在动的名单。
await A.page.click('#finishBtn');
await A.page.waitForSelector('#finishConfirm', { timeout: 6000 });
await A.page.click('#mpFinishYes');
const waitUp = await A.page.waitForSelector('#mpWait', { timeout: 12000 })
  .then(() => true).catch(() => false);
check('交卷之后进入等待页', waitUp);
if (waitUp) {
  await A.page.waitForTimeout(1500);
  const wait = await A.page.evaluate(() => ({
    marks: document.querySelectorAll('#mpWait .start-mark').length,
    rows: document.querySelectorAll('#mpWaitRows .mp-player').length,
    ticks: document.querySelectorAll('#mpWaitRows .mp-tick').length,
    leave: !!document.querySelector('#mpWaitLeave'),
  }));
  check('等待页上方是玩法图 + 那扇多人的门', wait.marks === 2, `${wait.marks} 张`);
  check('等待页下方是全房的实时名单', wait.rows === 2, `${wait.rows} 行`);
  check('交了卷的人有一个勾，还在打的没有', wait.ticks === 1, `${wait.ticks} 个勾`);
  check('等待页上留了一条走得掉的路', wait.leave);
  // 局中那份名单也认这个勾——「他交了」这件事在哪儿看都该长一个样。
  check('局中的名单上也给交了卷的人挂勾',
    (await B.page.$$eval('.mp-rank .mp-tick', (e) => e.length)) === 1);
}

// 另一个人也交卷：等待页撤掉，底下的结算页露出来。
await B.page.click('#finishBtn');
await B.page.waitForSelector('#finishConfirm', { timeout: 6000 });
await B.page.click('#mpFinishYes');
// 两边各自撤掉自己那一层——各自的下一次轮询到了才撤，所以要分别等。
const waitGone = (await Promise.all([A, B].map((P) =>
  P.page.waitForFunction(() => !document.getElementById('mpWait'), { timeout: 20000 })
    .then(() => true).catch(() => false)))).every(Boolean);
check('所有人都交了，等待页撤掉', waitGone);
check('底下就是结算页',
  await A.page.evaluate(() => document.getElementById('endOverlay')?.classList.contains('show')));

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

// 客人的《主页》：回房间等下一局。这里守的是一个真出现过的死局——回房间时
// 房间页是新建的，闭包里「打过第几局」归零，刚打完的那一局会被当成新的一局
// 重开，人被扔回一块死棋盘。
await B.page.click('#endBackBtn');
const guestBack = await B.page.waitForSelector('.mp-code', { timeout: 12000 })
  .then(() => true).catch(() => false);
check('客人点主页回到房间，没有被重开的那一局卡住', guestBack);
if (guestBack) {
  check('房间没散，房号还是那个', (await B.page.$eval('.mp-code', (e) => e.textContent.trim())) === code);
  check('房间里看得到累计总分', (await B.page.$$eval('.mp-player-total', (e) => e.length)) === 2);
  check('房间页上也给交了卷的人挂勾',
    (await B.page.$$eval('#mpPlayers .mp-tick', (e) => e.length)) >= 1);
}

// 《再来》：房主用同一个玩法立刻再开一局，客人也得被带进去——他自己开不了
// 局，而倒计时是房间页在听的，他这会儿不在房间页上。
//
// 这一颗以前会偶发地按不动：服务器要等所有人都报了「打完了」才让开下一局，
// 而上报是每半秒一次，结算页一出来就点，那半秒里点下去只会拿到 409，代码又
// 把结果丢了，屏幕上什么都不会发生。现在结算页本身就是等到服务器说这一局结
// 束了才露出来的（上面那段等待页），所以按到的时候一定已经可以开局。
await A.page.click('#restartBtn');
const intoNextRound = (p) =>
  p.waitForFunction(() => {
    const tiles = document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length;
    return tiles > 0 && !document.getElementById('endOverlay')?.classList.contains('show');
  }, { timeout: 30000 }).then(() => true).catch(() => false);
const [hostIn, guestIn] = await Promise.all([intoNextRound(A.page), intoNextRound(B.page)]);
check('房主点《再来》直接开出下一局', hostIn);
check('客人也被带进这一局（没留在上一局的结算页）', guestIn);

// ---- 房主走了：其他人得到一句话和一颗《ok》 -----------------------------
await A.page.click('#leaveRoomBtn');
await A.page.waitForSelector('#leaveRoomConfirm', { timeout: 5000 });
check('房主打到一半按离开，问的是《解散房间？》',
  (await A.page.$eval('#leaveRoomConfirm .tag-line', (e) => e.textContent.trim())) === '解散房间？',
  await A.page.$eval('#leaveRoomConfirm .tag-line', (e) => e.textContent.trim()));
await A.page.click('#mpLeaveYes');
check('房主离开也出一张竞赛排名',
  await A.page.waitForSelector('#mpFinalCard', { timeout: 12000 }).then(() => true).catch(() => false));

const cancelled = await B.page.waitForSelector('#roomCancelled', { timeout: 20000 })
  .then(() => true).catch(() => false);
check('房主一走，还在打的人收到《房间被取消》', cancelled);
if (cancelled) {
  check('那句话就是《Ohno！房间被取消》',
    (await B.page.$eval('#roomCancelled .tag-line', (e) => e.textContent.trim())) === 'Ohno！房间被取消',
    await B.page.$eval('#roomCancelled .tag-line', (e) => e.textContent.trim()));
  check('底下只有一颗《ok》',
    (await B.page.$$eval('#roomCancelled button', (els) => els.map((e) => e.id))).join() === 'roomCancelledOk');
  await B.page.click('#roomCancelledOk');
  check('按下《ok》回到主菜单',
    await B.page.waitForSelector('.home-page', { timeout: 8000 }).then(() => true).catch(() => false));
}

// ---- 客人自己走：一张截止此刻的竞赛排名 ---------------------------------
// 上面那一间已经散了，另开一间来验客人这条路。
await A.page.click('#mpFinalDone');
await A.page.waitForSelector('.home-page', { timeout: 8000 });
await A.page.click('#navProfile');
await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code2 = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
check('房主还能再开一间房', /^\d{4}$/.test(code2) && code2 !== code, code2);
await B.page.click('#navProfile');
await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 10000 });
await B.page.fill('#mpCode', code2);
await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForSelector('#mpPick', { timeout: 12000 });
check('一局都还没打，房间页上就还没有《散场》', (await A.page.$('#mpEnd')) === null);

// ---- 建议横着玩的玩法：房间里也是从 4 数起 -------------------------------
//
// 单人那边是本地数四秒，这边数的是服务器给的开赛时刻——所以服务器留的提前量
// 也得跟着多一秒，否则屏幕上那个「4」只站得住半秒就跳走了。两边的名单必须是
// 同一份：客户端在 startStage.ts 的 LANDSCAPE_MODES，服务器在 room.js 的
// WIDE_MODES。
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
const wideIdx = await A.page.$$eval('.home-icon-btn', (els) =>
  els.findIndex((e) => /七色圆球/.test(e.getAttribute('aria-label') || '')));
check('房主的主菜单上有七色圆球（天才特供，他开着）', wideIdx >= 0, `第 ${wideIdx} 张`);
const pickedAt = Date.now();
await A.page.$$eval('.home-icon-btn', (els, i) => els[i].click(), wideIdx);
// 数字在窗口里只待一秒出头就被清掉，两次之间还有一小段空当，所以不能「等它
// 出现、再回头去读」——读的那一刻它可能已经不在了。让浏览器自己在它出现的
// 那一帧把字取下来。
const firstDigit = (P) => P.page.waitForFunction(
  () => document.querySelector('.mp-countdown-page .cd-digit')?.textContent || null,
  { timeout: 12000 },
).then((h) => h.jsonValue());
const firstDigits = await Promise.all([A, B].map(firstDigit));
check('房间里的七色圆球，两端都从 4 数起', firstDigits.every((d) => d === '4'),
  firstDigits.join(' / '));
// 光看见一个 4 还不够：三秒半的提前量第一帧也会算出 4，只是它半秒就跳走。
// 真正能分辨的是整段等待有多长——从按下玩法到棋盘起来，普通玩法三秒半上下，
// 这两个玩法要四秒半。
await Promise.all([A, B].map((P) => P.page.waitForFunction(
  () => document.querySelectorAll('#boardWrap .ball').length > 0, { timeout: 20000 })));
const waited = Date.now() - pickedAt;
check('开赛的提前量给到了四秒半（普通玩法是三秒半）', waited >= 4200 && waited < 7000,
  `${waited}ms`);

// 客人从局中走人：交座位，出一张截止此刻的竞赛排名。
await B.page.click('#leaveRoomBtn');
await B.page.waitForSelector('#leaveRoomConfirm', { timeout: 5000 });
check('客人打到一半按离开，问的是《是否离开？》',
  (await B.page.$eval('#leaveRoomConfirm .tag-line', (e) => e.textContent.trim())) === '是否离开？',
  await B.page.$eval('#leaveRoomConfirm .tag-line', (e) => e.textContent.trim()));
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
}

// 有人走掉，还在打的那一边的名单要跟着少一行——它是一份实时的名单，不是开局
// 时拍的一张照片。
const shrank = await A.page.waitForFunction(
  () => document.querySelectorAll('.mp-board-row').length === 1, { timeout: 10000 },
).then(() => true).catch(() => false);
check('客人走了，房主局中的名单实时少一行', shrank,
  `还剩 ${await A.page.$$eval('.mp-board-row', (e) => e.length)} 行`);

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
