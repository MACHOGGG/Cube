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
 *
 * 10-09 补充方案 7-5 加的：
 *
 *   ②乙 **按住才算。** 键上写「按住不等了」、左边一个圆环（和《离开小屋》那一问的《按住离开》同
 *      一套，ui/holdToConfirm.ts），读屏念的辅助文案写着「或按 Enter」。点一下什么都不发生——这一
 *      局还在、等待页还在；按住 600ms 才结束这一局（③ 就是按住的）。
 *   ⑤ **被结束的人看到 mpRoundForced。** 丙（挂机、在线）的计分轮拨到 120、报上去之后屋主按住：
 *      他屏幕上飘过「屋主结束了这一局：您到刚才的 120 分已算进小屋总分。」，棋盘照旧开着，从此不再
 *      报分。
 *   ⑥ **回来时下一局已经开了，也认得出来。** 丁在屋主按之前断了网（切到别的应用、锁屏，iPhone 上
 *      都是这样：一下都不轮询），屋主按完、开了下一局之后才连上——`forced` 那一格早被下一局清掉
 *      了，他得从账上看出来（ui/scoreboard.ts 的 noticeForced）。他一分没打，飘的是前半句「屋主结
 *      束了这一局。」。
 *   ⑦ **两个人都看不到「离开太久了」**（mpRoundDropped）——从前下一局一开，被结束的人飘的正是这
 *      一句，而它是假话：他的分已经按当时的数记进去了。
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
    // 棋盘上方飘过的每一句话（ui/scoreboard.ts 的 flyby）都记一笔：它自己几秒就撤，等门去看的时候
    // 多半已经没了。观察的是 document，脚本跑在 <html> 出来之前也接得住。
    window.__flybys = [];
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList.contains('solo-flyby')) window.__flybys.push({ at: Date.now(), text: n.textContent });
      }
    }).observe(document, { childList: true, subtree: true });
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
/** 等待页那颗「不等了」此刻看不看得见、字是什么、有没有那个圆环、读屏念的辅助文案是什么。 */
const forceBtn = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('#mpWait #mpWaitForce');
    const hintId = b?.getAttribute('aria-describedby');
    return {
      there: Boolean(b),
      shown: Boolean(b && !b.hidden && b.offsetParent),
      text: b?.textContent?.trim() ?? '',
      ring: Boolean(b?.querySelector('svg.leave-ring .leave-ring-fill')),
      hint: hintId ? document.getElementById(hintId)?.textContent?.trim() ?? '' : '',
    };
  });
/** 在那颗键正中按住 `ms` 毫秒再松开。 */
async function holdOn(page, sel, ms) {
  const box = await page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}
/** 服务器眼里的这间屋（拿这一页自己的座位去问）。 */
const roomOf = (page) =>
  page.evaluate(async () => {
    const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || '{}');
    return fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'state', code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken }),
    }).then((x) => x.json());
  });
const myId = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('slides_mp_seat') || '{}').playerId);
/** 这一页报了几次分（ui/scoreboard.ts 的 report → action: score）。 */
function countScorePosts(page) {
  const at = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/room') && (r.postData() || '').includes('"action":"score"')) at.push(Date.now());
  });
  return at;
}
const flybys = (page) => page.evaluate(() => window.__flybys.map((f) => f.text));
const DROPPED = '离开太久了，这一局没算进小屋总分；您自己的记录里还在。';
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
const D = await newPlayer();
await joinRoom(D.page, '丁', code);
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 4, { timeout: 15000 });
const cPosts = countScorePosts(C.page);
const dPosts = countScorePosts(D.page);

await hostPicks(A.page);
const allUp = (await boardUp(A.page)) && (await boardUp(B.page)) && (await boardUp(C.page)) && (await boardUp(D.page));
check('（尺子）四个人的棋盘都出来了', allUp);
const cId = await myId(C.page);
const dId = await myId(D.page);

// 丙挂机，但手上有分：把他的计分轮拨到 120（计分板读的就是它，ui/scoreboard.ts 的 localScore），
// 等它报上去。丁在屋主按之前断网。
await C.page.evaluate(() => {
  document.getElementById('scoreReel').dataset.score = '120';
});
await C.page.waitForTimeout(1500);
const cOnServer = ((await roomOf(A.page)).players || []).find((p) => p.id === cId);
check('（尺子）丙的 120 分报上去了', cOnServer?.score === 120, JSON.stringify(cOnServer?.score));
await D.ctx.setOffline(true);

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
check('②乙 那颗键上的字是「按住不等了」，左边一个圆环', aBtn.text === '按住不等了' && aBtn.ring, `${aBtn.text} ring=${aBtn.ring}`);
check('②乙 读屏念的辅助文案写着键盘那条路（「或按 Enter」）', aBtn.hint === '按住这颗键，或按 Enter', aBtn.hint);

// ②乙 点一下：什么都不发生。
await A.page.click('#mpWaitForce');
await A.page.waitForTimeout(1800);
const afterTap = await roomOf(A.page);
check('②乙 点一下不算：这一局还没结束', afterTap.roundOver === false, String(afterTap.roundOver));
check('②乙 点一下不算：屋主还在等待页上', Boolean(await A.page.$('#mpWait')));

// ③ 屋主按住（600ms 才算，按 900）。
await holdOn(A.page, '#mpWaitForce', 900);
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

// ⑤ 丙看到那句话。
const FORCED_120 = '屋主结束了这一局：您到刚才的 120 分已算进小屋总分。';
const cTold = await C.page
  .waitForFunction((t) => window.__flybys.some((f) => f.text === t), FORCED_120, { timeout: 8000 })
  .then(() => true)
  .catch(() => false);
check('⑤ 被结束的丙看到「屋主结束了这一局：您到刚才的 120 分已算进小屋总分。」', cTold, JSON.stringify(await flybys(C.page)));
const cToldAt = await C.page.evaluate((t) => window.__flybys.find((f) => f.text === t)?.at ?? Date.now(), FORCED_120);

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

// ⑥ 丁连上网：下一局已经开了，forced 那一格早清掉了。
await D.ctx.setOffline(false);
const FORCED_0 = '屋主结束了这一局。';
const dTold = await D.page
  .waitForFunction((t) => window.__flybys.some((f) => f.text === t), FORCED_0, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check('⑥ 断网时被结束的丁，回来时下一局已开：看到「屋主结束了这一局。」（0 分，没有分数那半句）', dTold, JSON.stringify(await flybys(D.page)));
const dToldAt = await D.page.evaluate((t) => window.__flybys.find((f) => f.text === t)?.at ?? Date.now(), FORCED_0);
const dStill = await D.page.evaluate(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length);
check('⑥ 丁也没被拽走：他手上那一局照旧开着', dStill > 0, String(dStill));

// ⑦ 再等一个心跳多（计分板没动的时候四秒报一次）：谁都不该冒出「离开太久了」，被结束的人也不再报分。
await A.page.waitForTimeout(6000);
const cSaid = await flybys(C.page);
const dSaid = await flybys(D.page);
check('⑦ 丙一直没看到「离开太久了」', !cSaid.includes(DROPPED), JSON.stringify(cSaid));
check('⑦ 丁一直没看到「离开太久了」', !dSaid.includes(DROPPED), JSON.stringify(dSaid));
check('⑦ 丙那句话只说了一次', cSaid.filter((t) => t === FORCED_120).length === 1, JSON.stringify(cSaid));
// 认出来那一刻可能正好有一条在路上（那一条的回包就是认出来的那一次），之后一条都不该再发。
const cLater = cPosts.filter((t) => t > cToldAt + 300).length;
const dLater = dPosts.filter((t) => t > dToldAt + 300).length;
check('⑦ 丙认出来之后不再报分', cLater === 0, `${cLater} 条`);
check('⑦ 丁认出来之后不再报分', dLater === 0, `${dLater} 条`);
const r2 = await roomOf(A.page);
const c2 = (r2.players || []).find((p) => p.id === cId);
const d2 = (r2.players || []).find((p) => p.id === dId);
check('⑦（尺子）账上：丙第 1 局记了 120、丁记了 0（各 1 局）', c2?.total === 120 && c2?.rounds === 1 && d2?.total === 0 && d2?.rounds === 1,
  `丙 ${c2?.total}/${c2?.rounds} 丁 ${d2?.total}/${d2?.rounds}`);

for (const p of [A, B, C, D]) await p.ctx.close();
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
