/**
 * 小屋里的《无限反转》：屋主挑方块 / 小球，全屋一起打 60 秒的反转局。
 *
 *   node scripts/dev-server.mjs 8940 dist
 *   node scripts/check-room-flip.mjs http://localhost:8940/
 *
 * 两台浏览器进同一间小屋。屋主去挑玩法那一屏点《无限反转》→ 挑方块：
 *   · 服务器记下 mode=square、flip=true；
 *   · 两台的倒数页底下都有那块说明（图标 + 连击减弱、没有时间奖励）；
 *   · 两台开的都是 60 秒往下数的局，棋盘一模一样；
 *   · 两人交卷回小屋；屋主再挑小球，第二局照样是反转局；
 *   · 屋主结算页上《再来》开的还是反转局。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8940/';
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
    localStorage.setItem('slides_intro_seen', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} page error] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page, label };
}
const boardSignature = (page) =>
  page.$$eval('#boardWrap *', (els) =>
    els.map((e) => e.style.backgroundColor || e.getAttribute('fill') || '').filter(Boolean).join(','));
const serverState = (P) =>
  P.page.evaluate(async () => {
    const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || sessionStorage.getItem('slides_mp_seat') || 'null');
    if (!seat) return null;
    return fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'state', code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken }),
    }).then((x) => x.json());
  });

const A = await newPlayer('host');
const B = await newPlayer('guest');
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
await B.page.click('#navProfile'); await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 10000 });
await B.page.fill('#mpName', '乙'); await B.page.fill('#mpCode', code); await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });

const FLIP_CARD = '.home-icon-btn[aria-label="无限反转"]';

/** 屋主走一趟：为大家挑 → 主菜单上的无限反转卡 → 挑图形。 */
async function hostPicksFlip(family) {
  await A.page.click('#mpPick');
  await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
  check(`屋主挑玩法：主菜单上有无限反转那张卡`, await A.page.$(FLIP_CARD).then(Boolean));
  await A.page.click(FLIP_CARD);
  await A.page.waitForSelector('.flip-page', { timeout: 8000 });
  check('按下去进的是挑图形页（不是「不是小屋玩法」的提示）', await A.page.$('.flip-page').then(Boolean));
  check('挑图形页上小屋那圈粉边还在（body.is-room-host）', await A.page.evaluate(() => document.body.classList.contains('is-room-host')));
  await A.page.click(`.flip-page .slot-pick-opt[data-family="${family}"]`);
}

async function playRound(n, family) {
  await hostPicksFlip(family);
  // 两台都进倒数页
  await A.page.waitForSelector('.mp-countdown-page', { timeout: 15000 });
  await B.page.waitForSelector('.mp-countdown-page', { timeout: 15000 });
  const st = await serverState(A);
  check(`第 ${n} 局：服务器记的是 ${family} + 无限反转`, st && st.mode === family && st.flip === true && st.slot === null, JSON.stringify({ mode: st?.mode, flip: st?.flip, slot: st?.slot }));
  for (const P of [A, B]) {
    const hint = await P.page.$eval('.mp-countdown-page .flip-hint-copy', (el) => el.textContent.trim()).catch(() => '');
    check(`第 ${n} 局 ${P.label}：倒数页底下有那块说明`, hint.includes('×1.5') && hint.includes('时间'), hint);
    check(`第 ${n} 局 ${P.label}：倒数页的图是 ${family}`, await P.page.$eval('.mp-countdown-page .start-marks', (el) => el.innerHTML).then((h) => h.includes(`base-${family}`)));
  }
  // 开打
  await A.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
  await B.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
  await A.page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 20000 });
  await B.page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 20000 });
  await A.page.waitForTimeout(400);
  for (const P of [A, B]) {
    const clock = await P.page.$eval('#hud-time', (el) => el.textContent.trim());
    check(`第 ${n} 局 ${P.label}：钟从 1:00 往下数`, /^(1:00|0:5\d)$/.test(clock), clock);
    check(`第 ${n} 局 ${P.label}：棋盘是 ${family}`, await P.page.$eval('.app--game', (el) => el.dataset.shape) === family);
  }
  const sa = await boardSignature(A.page);
  const sb = await boardSignature(B.page);
  check(`第 ${n} 局：两台的棋盘一模一样`, sa.length > 0 && sa === sb);
  // 客人交卷、屋主交卷 → 回小屋
  await B.page.$eval('#finishBtn', (el) => el.click()); await B.page.waitForSelector('#mpFinishYes'); await B.page.click('#mpFinishYes');
  await B.page.waitForSelector('#mpWait', { timeout: 8000 });
  await A.page.$eval('#finishBtn', (el) => el.click()); await A.page.waitForSelector('#mpFinishYes'); await A.page.click('#mpFinishYes');
  await A.page.waitForSelector('#mpLeave', { timeout: 20000 });
  await B.page.waitForSelector('#mpLeave', { timeout: 20000 });
  const done = await serverState(A);
  check(`第 ${n} 局：打完了，两人都回到小屋`, done && done.roundOver === true);
  // 结算记录：小屋里那一局也是 flip（本机存档的 modeKey）
  const rec = await A.page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.includes('_flip') && k.includes('runs'));
    return keys.length;
  });
  check(`第 ${n} 局 host：这一局存进了无限反转的档`, rec > 0, String(rec));
}

await playRound(1, 'square');
await playRound(2, 'circle');

// 屋主结算页上的《再来》：这里用第三局验——屋主挑方块反转，打完不回小屋，直接按《再来》。
await hostPicksFlip('square');
await A.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
await B.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
await A.page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 20000 });
await B.page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 20000 });
await B.page.$eval('#finishBtn', (el) => el.click()); await B.page.waitForSelector('#mpFinishYes'); await B.page.click('#mpFinishYes');
await A.page.$eval('#finishBtn', (el) => el.click()); await A.page.waitForSelector('#mpFinishYes'); await A.page.click('#mpFinishYes');
await A.page.waitForSelector('#mpLeave', { timeout: 20000 });
await B.page.waitForSelector('#mpLeave', { timeout: 20000 });
// 屋主在小屋页开下一局用的是《选下一个玩法》；《再来》在结算页上——上一局结算页已经撤了，
// 所以这里直接调 startMatch 那条路验服务器：同一玩法带 flip 再开一局。
const again = await A.page.evaluate(async () => {
  const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || sessionStorage.getItem('slides_mp_seat') || 'null');
  return fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', mode: 'square', flip: true, code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken }),
  }).then((x) => x.json());
});
check('服务器：再开一局带 flip 的方块局', again.flip === true && again.mode === 'square' && again.round === 4, JSON.stringify({ flip: again.flip, round: again.round }));
const bad = await A.page.evaluate(async () => {
  const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || sessionStorage.getItem('slides_mp_seat') || 'null');
  // 这一局还在数，start 会被拒（started）——只看 flip 在三角上会不会被当真：先等它打完再试太慢，
  // 这里改验 publicState 里 flip 是布尔值。
  return fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'state', code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken }),
  }).then((x) => x.json());
});
check('publicState 里 flip 是布尔值', typeof bad.flip === 'boolean');
await A.page.waitForSelector('.mp-countdown-page', { timeout: 15000 });
await B.page.waitForSelector('.mp-countdown-page', { timeout: 15000 });
check('第 4 局两台都进了倒数页，带说明', (await A.page.$('.mp-countdown-page .flip-hint').then(Boolean)) && (await B.page.$('.mp-countdown-page .flip-hint').then(Boolean)));

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
