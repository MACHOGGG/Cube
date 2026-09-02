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

async function newPlayer(label, unseen = []) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  // unseen 里写的那几族，这台设备当作「没看过教学」——开局前那一句
  //《会……的规则吗？》就是照这个判断要不要问的。
  await ctx.addInitScript((skip) => {
    const keys = {
      square: 'slides_tutorial_seen',
      circle: 'slides_tutorial_seen_circle',
      triangle: 'slides_tutorial_seen_triangle',
    };
    for (const [fam, k] of Object.entries(keys)) {
      if (!skip.includes(fam)) localStorage.setItem(k, '1');
    }
    localStorage.setItem('slides_lang', 'zhHans');
  }, unseen);
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
// 客人没看过圆球那一族的教学：留给底下那一段验「开局前问一句」。
const B = await newPlayer('guest', ['circle']);

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
check('屋主用内部码开通天才', granted.active === true, granted.period || JSON.stringify(granted));
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
check('屋主开出房间，拿到四位房号', /^\d{4}$/.test(code), code);

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
check('屋主那边看到两个人', roster.length === 2, roster.join(' / '));
check('屋主有屋主标记，客人没有',
  (await A.page.$$eval('.mp-badge', (e) => e.length)) === 1);
check('只有屋主看得到开局入口', (await B.page.$('#mpPick')) === null && (await A.page.$('#mpPick')) !== null);

// ---- the host goes to the home page and picks a board there -------------
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
const pickBanner = await A.page.$eval('.room-pick-title', (e) => e.textContent.trim());
check('屋主到了主菜单，横幅上写着「你为 <房号> 房间选择」',
  pickBanner.includes(code) && pickBanner.startsWith('你为'), pickBanner);
// 横幅从两行减成一行：那句「点哪个玩法全房间就跟着玩」的说明去掉了，红色
// 的大字自己就说清楚了这件事。
check('横幅只剩这一行，说明那行没了', (await A.page.$('.room-pick-hint')) === null);
check('屏幕外框亮起屋主提示',
  await A.page.evaluate(() => document.body.classList.contains('is-room-host')));
// 一局刚打完、屋主被送回来挑下一个玩法的时候，走人的路原来只剩「先回房间页
// 再点离开」。横幅上这颗小键把那一步省了。
check('屋主的横幅上有一颗《离开房间》', (await A.page.$('#roomPickLeave')) !== null);
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
// 屋主的小屋页上只剩一颗《解散小屋》——对屋主来说「走」和「散」本来就是同
// 一件事，两颗键说的是同一个后果。局中那颗仍写《离开小屋》：那一刻按下去
// 是把这一局交出去，不是把屋子拆了。所以这里查的不再是「两处一模一样」，
// 而是「两处各自说对了自己那件事」。
check('屋主的小屋页上那颗键写《解散小屋》', roomLeaveLabel === '解散小屋', roomLeaveLabel);
check('局中那颗仍写《离开小屋》', inRunLeaveLabel === '离开小屋', inRunLeaveLabel);

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

// 另一个人也交卷：这一局结束，两边都直接回小屋——不出结算页。
//
// 小屋里的一局是一晚上里的一段，不是一个完整的故事：结算页问的《再来一局？》
// 《回主页？》都不是这里该问的问题，真正在等的只有屋主挑下一场。
await B.page.click('#finishBtn');
await B.page.waitForSelector('#finishConfirm', { timeout: 6000 });
await B.page.click('#mpFinishYes');
const backInRoom = (await Promise.all([A, B].map((P) =>
  P.page.waitForFunction(() => !!document.querySelector('.mp-code') && !document.getElementById('mpWait'),
    { timeout: 25000 }).then(() => true).catch(() => false)))).every(Boolean);
check('一局打完，两边都直接回到小屋', backInRoom);
check('没有弹结算页',
  !(await A.page.evaluate(() => document.getElementById('endOverlay')?.classList.contains('show'))));
check('小屋里看得到累计总分', (await A.page.$$eval('.mp-player-total', (e) => e.length)) === 2);
check('小屋号码还是那个', (await A.page.$eval('.mp-code', (e) => e.textContent.trim())) === code);

// 客人在小屋里能做的只有两件事：催，或者走。
const guestArea = await B.page.evaluate(() => ({
  nudge: !!document.querySelector('#mpNudge'),
  leave: !!document.querySelector('#mpLeave'),
  pick: !!document.querySelector('#mpPick'),
}));
check('客人的小屋里只有《催屋主》和《离开小屋》',
  guestArea.nudge && guestArea.leave && !guestArea.pick, JSON.stringify(guestArea));
check('屋主的小屋里只剩《挑下一个玩法》，散场并进了底下那颗《解散小屋》',
  await A.page.evaluate(() => !!document.querySelector('#mpPick') && !document.querySelector('#mpEnd')));
// 两句被拿掉的话：小屋页不再解释棋盘，也不再报人数上限。
const roomWords = await A.page.evaluate(() => document.querySelector('.mp-page')?.textContent || '');
check('小屋页上没有《所有人拿到完全一样的棋盘》', !roomWords.includes('完全一样的棋盘'));
check('小屋页上没有「最多 N 个人」', !/最多\s*\d+\s*个人/.test(roomWords));
check('分享那一句写的是《把这四位数字给朋友，邀请加入小屋》',
  roomWords.includes('把这四位数字给朋友，邀请加入小屋'));

// 坐在小屋里什么都不做，也不该被判成掉线。
//
// 这一条守的是一个真出现过的毛病：从前只有交分数那条路会告诉服务器「我还
// 在」，而两局之间的小屋页根本不交分数——所有人坐着不动，十二秒之后每个人
// 都成了「不在」，屋里挂出一句《屋主正在修电缆》，网络一点问题都没有。
// 等 34 秒，比现在的 AWAY_MS（30 秒）还长一点：短于它的话，这条自检就只是
// 在证明「没到上限」，把心跳整个删掉也照样绿。慢半分钟换一条真的守得住东西
// 的自检，值。
await B.page.waitForTimeout(34000);
const quiet = await B.page.evaluate(() => ({
  away: !!document.querySelector('#hostAway'),
  gone: !!document.querySelector('#roomCancelled'),
}));
check('在小屋里坐半分多钟，没有人被当成掉线', !quiet.away && !quiet.gone, JSON.stringify(quiet));

// 催屋主：屋主那块标题玻璃上会多出一张画布，里面掉着图形。
// 验的是「画布上真的画了东西」——不是「画布挂上去了」：一张空画布也能挂住，
// 那样这条自检就永远是绿的，什么也没证明。
// 画布是进小屋就挂上的（空的），所以这里量的是「上面还没画东西」，
// 不是「画布还不在」。
const painted = () => A.page.evaluate(() => {
  const c = document.querySelector('canvas.title-rain');
  if (!c || !c.width) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
});
check('还没人催的时候，标题上是空的', !(await painted()));
for (let i = 0; i < 3; i++) {
  await B.page.click('#mpNudge');
  await B.page.waitForTimeout(120);
}
const rained = await A.page.waitForFunction(() => {
  const c = document.querySelector('canvas.title-rain');
  if (!c || !c.width) return false;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
}, { timeout: 15000 }).then(() => true).catch(() => false);
check('客人一催，屋主的标题框里掉下东西', rained);

// 屋主挑下一场：回主菜单选一个玩法，整屋跟着开。
await A.page.click('#mpPick');
await A.page.waitForSelector('.home-icon-btn', { timeout: 15000 });
// 挑圆球——客人这台设备没看过圆球那一族的教学（见 newPlayer 的 unseen），
// 所以下面这一整段才有东西可验。
const circleIdx = await A.page.$$eval('.home-icon-btn', (els) =>
  els.findIndex((e) => (e.getAttribute('aria-label') || '') === '圆球'));
await A.page.$$eval('.home-icon-btn', (els, i) => els[i].click(), circleIdx);

// ---- 开局前问一句：会不会这个玩法的规则 --------------------------------
const rulesAsked = await B.page.waitForSelector('#mpKnowAsk', { timeout: 15000 })
  .then(() => true).catch(() => false);
check('没看过教学的人，开局前被问一句', rulesAsked);
if (rulesAsked) {
  check('问的是这个玩法的名字',
    (await B.page.$eval('#mpKnowAsk .tag-line', (e) => e.textContent.trim())) === '会圆球的规则吗？',
    await B.page.$eval('#mpKnowAsk .tag-line', (e) => e.textContent.trim()));
  check('两颗键：会 / 不会，教我',
    (await B.page.$$eval('#mpKnowAsk .start-act', (els) => els.map((e) => e.textContent.trim())))
      .join('|') === '不会，教我|会');
  // 说「不会」：自己去看教学，屋里其他人等着。
  await B.page.click('#mpKnowNo');
  const learningPage = await A.page.waitForSelector('.mp-learn-spin', { timeout: 20000 })
    .then(() => true).catch(() => false);
  check('有人去学，别人看到「稍等」那一屏', learningPage);
  if (learningPage) {
    check('那句话就是《小屋里有人在学习，稍等》',
      (await A.page.$eval('.mp-learn-line', (e) => e.textContent.trim())) === '小屋里有人在学习，稍等',
      await A.page.$eval('.mp-learn-line', (e) => e.textContent.trim()));
    // 那只转圈的标识是真的画出来了（不是一个空盒子），而且真的在转。
    const spin = await A.page.evaluate(() => {
      const box = document.querySelector('.mp-learn-spin');
      const svg = box?.querySelector('svg');
      return {
        paths: svg ? svg.querySelectorAll('path').length : 0,
        turning: box ? getComputedStyle(box).animationName : '',
        p3: /color\(/.test(box?.innerHTML || ''),
      };
    });
    check('底下是那只加载标识，画得出来', spin.paths > 30, `${spin.paths} 条路径`);
    check('它绕着自己的中心在转', spin.turning === 'mp-learn-turn', spin.turning);
    // 旧安卓不认 color(display-p3 …)，认不得的话整条 fill 作废、图变空白。
    check('标识里没有留下 display-p3 的颜色', !spin.p3);
    // 干等的这一屏底下不该还挂着《个人主页 / 记录与排名》：按下去就等于走出
    // 小屋，而人家学完这一屏随时会自己翻页。两种写法（:has() 和根上那个类）
    // 都要真的生效，所以量的是它到底看不看得见。
    const navGone = await A.page.evaluate(() => {
      const nav = document.querySelector('.home-nav');
      if (!nav) return true;
      const r = nav.getBoundingClientRect();
      return getComputedStyle(nav).display === 'none' || r.width === 0 || r.height === 0;
    });
    check('等人学教学的那一屏，底下那排图标收起来了', navGone);
  }
  check('学的人这会儿在教学里', await B.page.$('.story-tut, .tut-stage, .app') !== null);

  // 学完了：服务器把开赛时刻重新盖一遍，全屋一起从 4 数起。
  // 这里直接替这台设备说一声「学完了」，省掉真把整段教学放完的两分钟——
  // 走的是和教学结束时同一个接口、同一份身份。
  await B.page.evaluate(async () => {
    // 座位存在 localStorage 里（见 src/engine/room.ts 的 loadSeat：装成 App
    // 之后 sessionStorage 一关就空，屋主回来会变成自己小屋里的客人）。
    const seat = JSON.parse(
      localStorage.getItem('slides_mp_seat') ?? sessionStorage.getItem('slides_mp_seat'),
    );
    await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'learn', learning: false, ...seat }),
    });
  });
  const resumed = await A.page.waitForFunction(
    () => !!document.querySelector('.mp-countdown-page .cd-window') && !document.querySelector('.mp-learn-spin'),
    { timeout: 20000 },
  ).then(() => true).catch(() => false);
  check('学完了，等的人回到 4-3-2-1', resumed);
}

const intoNextRound = (p) =>
  p.waitForFunction(() => {
    const tiles = document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length;
    return tiles > 0;
  }, { timeout: 40000 }).then(() => true).catch(() => false);
check('屋主挑完下一场，自己进了局', await intoNextRound(A.page));

// 客人这会儿还停在教学页上——这一段没有真把整段教学放完，而是替他按了
// 「学完了」。真的看完教学的人会被 onLearnTutorial 的收尾直接送回小屋；
// 这里手动走一遍那条路（刷新 → 多人游玩 → 凭存下来的座位回屋），
// 好接上后面「屋主走了」的剧情。
await B.page.goto(BASE, { waitUntil: 'load' });
await B.page.waitForSelector('#navProfile', { timeout: 20000 });
await B.page.click('#navProfile');
await B.page.click('#multiRow');
check('客人回到小屋后被带进这一局', await intoNextRound(B.page));

// ---- 屋主走了：其他人得到一句话和一颗《ok》 -----------------------------
await A.page.click('#leaveRoomBtn');
await A.page.waitForSelector('#leaveRoomConfirm', { timeout: 5000 });
check('屋主打到一半按离开，问的是《解散小屋？》',
  (await A.page.$eval('#leaveRoomConfirm .tag-line', (e) => e.textContent.trim())) === '解散小屋？',
  await A.page.$eval('#leaveRoomConfirm .tag-line', (e) => e.textContent.trim()));
await A.page.click('#mpLeaveYes');
check('屋主离开也出一张竞赛排名',
  await A.page.waitForSelector('#mpFinalCard', { timeout: 12000 }).then(() => true).catch(() => false));

const cancelled = await B.page.waitForSelector('#roomCancelled', { timeout: 20000 })
  .then(() => true).catch(() => false);
check('屋主一走，还在打的人收到《小屋被取消》', cancelled);
if (cancelled) {
  check('那句话就是《Ohno！小屋被取消》',
    (await B.page.$eval('#roomCancelled .tag-line', (e) => e.textContent.trim())) === 'Ohno！小屋被取消',
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
check('屋主还能再开一间房', /^\d{4}$/.test(code2) && code2 !== code, code2);
await B.page.click('#navProfile');
await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 10000 });
await B.page.fill('#mpCode', code2);
await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForSelector('#mpPick', { timeout: 12000 });
check('一局都还没打，房间页上就还没有《散场》', (await A.page.$('#mpEnd')) === null);

// ---- 建议横着玩的玩法：房间里也是从 5 数起 -------------------------------
//
// 单人那边是本地数五秒，这边数的是服务器给的开赛时刻——所以服务器留的提前量
// 也得跟着多一秒，否则屏幕上那个「5」只站得住半秒就跳走了。两边的名单必须是
// 同一份：客户端在 startStage.ts 的 LANDSCAPE_MODES，服务器在 room.js 的
// WIDE_MODES。
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
const wideIdx = await A.page.$$eval('.home-icon-btn', (els) =>
  els.findIndex((e) => /七色圆球/.test(e.getAttribute('aria-label') || '')));
check('屋主的主菜单上有七色圆球（天才特供，他开着）', wideIdx >= 0, `第 ${wideIdx} 张`);
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
check('房间里的七色圆球，两端都从 5 数起', firstDigits.every((d) => d === '5'),
  firstDigits.join(' / '));
// 光看见一个 5 还不够：四秒半的提前量第一帧也会算出 5，只是它半秒就跳走。
// 真正能分辨的是整段等待有多长——从按下玩法到棋盘起来，普通玩法四秒半上下，
// 这两个玩法要五秒半。
await Promise.all([A, B].map((P) => P.page.waitForFunction(
  () => document.querySelectorAll('#boardWrap .ball').length > 0, { timeout: 20000 })));
const waited = Date.now() - pickedAt;
check('开赛的提前量给到了五秒半（普通玩法是四秒半）', waited >= 5200 && waited < 8000,
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
  check('排名页的标题是《小屋战绩》（和散场那张同一句）',
    (await B.page.$eval('.home-sub', (e) => e.textContent.trim())) === '小屋战绩',
    await B.page.$eval('.home-sub', (e) => e.textContent.trim()));
  check('排名里有两个人，自己那一行被标出来',
    (await B.page.$$eval('#mpFinalRows .mp-player', (e) => e.length)) === 2 &&
      (await B.page.$$eval('#mpFinalRows .mp-player--me', (e) => e.length)) === 1);
  const drawn = await B.page.waitForFunction(
    () => document.getElementById('mpFinalCard')?.naturalWidth > 0, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  check('竞赛排名图渲染出来了', drawn);
}

// 有人走掉：名单上留着他，只是标成「走了」。
//
// 从前这里是「名单少一行」——座位一删，这个人连同他打出来的分数就从所有人的
// 屏幕上消失，最后那张竞赛排名图上也没有他。三个人打了一晚上，图上只剩两个。
// 「他中途走了」是这场比赛的一部分，不是一件要抹掉的事。
const marked = await A.page.waitForFunction(
  () => document.querySelectorAll('.mp-board-row').length === 2 &&
        document.querySelectorAll('.mp-board-row--left').length === 1,
  { timeout: 12000 },
).then(() => true).catch(() => false);
check('客人走了，人还在名单上，只是标成走了', marked,
  `${await A.page.$$eval('.mp-board-row', (e) => e.length)} 行，` +
  `${await A.page.$$eval('.mp-board-row--left', (e) => e.length)} 个标记`);

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
