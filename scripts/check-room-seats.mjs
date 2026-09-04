/**
 * 小屋的座位：谁能坐、谁能拿回、一共几把、屋主不在时大家看到什么。
 *
 *   node scripts/dev-server.mjs 8960 dist
 *   node scripts/check-room-seats.mjs http://localhost:8960/
 *
 *   · 小屋页写着「玩家 n/8」，每进来一个人数字跟着走；
 *   · 两个没取名字的人进同一间屋：名字自动变成「起个名字」「起个名字 2」；
 *   · 屋主的座位谁也认领不走：同名的人进来是新座位，屋主还是屋主；
 *   · 只剩最后一把椅子时三个人同时按《加入》：只进一个，另两个是「满了」；
 *   · 屋主 30 秒没动静：屋里的人看到「屋主等一下就来」；90 秒没动静：
 *     「屋主离家出走了，小屋暂时解散」，按 ok 回主菜单；
 *   · 没权限的客人在无限反转局里，屋主中途解散：弹《屋主离开，小屋暂时解散，
 *     等一会再来？》，按 ok 回主页，本机没存这一局的档。
 *
 * TESTMONTH 一台服务器只能兑一次——重跑请换端口重开服务器。这一支要等屋主
 * 「离家出走」的 90 秒，整趟两三分钟。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8960/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const api = (body) =>
  fetch(new URL('/api/room', BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function newPlayer(label, opts = {}) {
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
const seatOf = (P) => P.page.evaluate(() => JSON.parse(localStorage.getItem('slides_mp_seat') || 'null'));
const stateVia = async (P) => {
  const seat = await seatOf(P);
  return (await api({ action: 'state', code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken })).body;
};
const playersLabel = (P) => P.page.$eval('#mpPlayersLabel', (el) => el.textContent.trim()).catch(() => '');

// ---- 屋主开屋（不取名字），两个客人也不取名字 ------------------------------
const A = await newPlayer('host');
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
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
check('屋主一个人：写着 1/8', /1\/8/.test(await playersLabel(A)), await playersLabel(A));

const B = await newPlayer('guest1');
await B.page.click('#navProfile'); await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 10000 });
await B.page.fill('#mpCode', code); await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
const C = await newPlayer('guest2');
await C.page.click('#navProfile'); await C.page.click('#multiRow');
await C.page.waitForSelector('#mpCode', { timeout: 10000 });
await C.page.fill('#mpCode', code); await C.page.click('#mpJoin');
await C.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 3, { timeout: 8000 });
check('三个人：写着 3/8', /3\/8/.test(await playersLabel(A)), await playersLabel(A));
const st3 = await stateVia(A);
const names = st3.players.map((p) => p.name);
check('没取名字的两个客人：名字不一样（第二个带编号）', new Set(names).size === 3 && names.some((n) => / 2$/.test(n)), names.join(' / '));
check('屋主还是屋主', st3.host === (await seatOf(A)).playerId && st3.players.find((p) => p.isHost)?.name === names[0] || st3.players.filter((p) => p.isHost).length === 1);

// ---- 同名进来认领不走屋主的座位 --------------------------------------------
const hostName = st3.players.find((p) => p.isHost).name;
const hostSeat = await seatOf(A);
const impostor = await api({ action: 'join', code, name: hostName, avatar: { shape: 'circle', hue: 10 }, seen: [] });
check('拿着屋主的名字进来：是一把新椅子，不是认领', impostor.status === 200 && impostor.body.rejoined === false, JSON.stringify({ status: impostor.status, rejoined: impostor.body.rejoined }));
const st4 = await stateVia(A);
check('屋主没换人，座位钥匙还是原来那把', st4.host === hostSeat.playerId && (await api({ action: 'state', code, playerId: hostSeat.playerId, playerToken: hostSeat.playerToken })).status === 200);
check('同名的新座位带了编号', st4.players.some((p) => p.name === `${hostName} 2`), st4.players.map((p) => p.name).join(' / '));
check('四个人：4/8', await A.page.waitForFunction(() => /4\/8/.test(document.querySelector('#mpPlayersLabel')?.textContent || ''), { timeout: 5000 }).then(() => true).catch(() => false), await playersLabel(A));

// ---- 塞满：直接调接口坐到 7 个，最后一把椅子三个人同时抢 ----------------------
const filled = [];
for (let i = 0; i < 3; i++) filled.push(await api({ action: 'join', code, name: `填${i}`, avatar: { shape: 'square', hue: 40 + i }, seen: [] }));
check('坐到 7 个都进得来', filled.every((r) => r.status === 200), filled.map((r) => r.status).join(','));
const race = await Promise.all([0, 1, 2].map((i) => api({ action: 'join', code, name: `抢${i}`, avatar: { shape: 'triangle', hue: 100 + i }, seen: [] })));
const got = race.filter((r) => r.status === 200).length;
const full = race.filter((r) => r.status === 409 && r.body.error === 'full').length;
check('最后一把椅子三个人同时抢：只进一个，另两个是「满了」', got === 1 && full === 2, race.map((r) => `${r.status}:${r.body.error ?? 'ok'}`).join(' '));
const st8 = await stateVia(A);
check('屋里正好 8 个人', st8.players.filter((p) => !p.left).length === 8 && st8.seats === 8, `${st8.players.length}/${st8.seats}`);
check('屋主页上写着 8/8', await A.page.waitForFunction(() => /8\/8/.test(document.querySelector('#mpPlayersLabel')?.textContent || ''), { timeout: 5000 }).then(() => true).catch(() => false));
// 走一个，椅子空出来，再进一个进得来
const winner = race.find((r) => r.status === 200).body;
await api({ action: 'leave', code, playerId: winner.playerId, playerToken: winner.playerToken });
const after = await api({ action: 'join', code, name: '补位', avatar: { shape: 'square', hue: 200 }, seen: [] });
check('有人走了，椅子空出来，下一个进得来', after.status === 200, String(after.status));

// ---- 屋主不在：先是「等一下就来」，太久就是「离家出走」 -------------------------
// 屋主断网：轮询发不出去、也发不出 bye（等于锁了屏、进了电梯）。关掉浏览器不一样——
// 那会发 bye，屋里的人立刻看到「离家出走」。
await A.ctx.setOffline(true);
const awayShown = await B.page.waitForSelector('#hostAway', { timeout: 45000 }).then(() => true).catch(() => false);
check('屋主 30 秒没动静：客人看到「屋主等一下就来」', awayShown);
const awayText = await B.page.$eval('#hostAway .tag-line', (el) => el.textContent.trim()).catch(() => '');
check('那句话就是「屋主等一下就来」', awayText === '屋主等一下就来', awayText);
const goneShown = await B.page.waitForSelector('#roomCancelled', { timeout: 90000 }).then(() => true).catch(() => false);
check('屋主 90 秒没动静：换成「屋主离家出走了，小屋暂时解散」', goneShown);
const goneText = await B.page.$eval('#roomCancelled .tag-line', (el) => el.textContent.trim()).catch(() => '');
check('那句话就是「屋主离家出走了，小屋暂时解散」', goneText === '屋主离家出走了，小屋暂时解散', goneText);
await B.page.click('#roomCancelledOk');
await B.page.waitForTimeout(400);
check('按 ok → 回到多人设置页 / 主菜单，不再坐在旧小屋里', !(await B.page.$('.mp-code')) );
await A.ctx.close(); await B.ctx.close(); await C.ctx.close();

// ---- 没权限的客人在无限反转局里，屋主中途解散 --------------------------------
const H = await newPlayer('host2');
await H.page.evaluate(async () => {
  // 第二个屋主：直接写一份本地的天才权益（服务器那头开屋要 token，所以走屋主自己的内部码账号）
});
// 用刚才那个内部码账号（同一台服务器只兑一次）：把甲的权益复制给新屋主
await H.page.evaluate((g) => localStorage.setItem('slides_genius', JSON.stringify(g)), {
  active: true, period: granted.period, until: granted.until, channel: 'code', email: granted.email, token: granted.token, code: granted.code,
});
await H.page.reload({ waitUntil: 'load' }); await H.page.waitForSelector('#navProfile');
await H.page.click('#navProfile'); await H.page.click('#multiRow');
await H.page.waitForSelector('#mpCreate', { timeout: 10000 });
await H.page.fill('#mpName', '甲'); await H.page.click('#mpCreate');
await H.page.waitForSelector('.mp-code', { timeout: 10000 });
const code2 = await H.page.$eval('.mp-code', (e) => e.textContent.trim());
const G = await newPlayer('guest-free');
await G.page.click('#navProfile'); await G.page.click('#multiRow');
await G.page.waitForSelector('#mpCode', { timeout: 10000 });
await G.page.fill('#mpName', '乙'); await G.page.fill('#mpCode', code2); await G.page.click('#mpJoin');
await G.page.waitForSelector('.mp-code', { timeout: 10000 });
await H.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });
await H.page.click('#mpPick'); await H.page.waitForSelector('#roomPickBar', { timeout: 8000 });
await H.page.click('.home-icon-btn[aria-label="无限反转"]'); await H.page.waitForSelector('.flip-page', { timeout: 8000 });
await H.page.click('.flip-page .slot-pick-opt[data-family="square"]');
await G.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
await G.page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 20000 });
await H.page.waitForSelector('#leaveRoomBtn', { timeout: 25000 });
await H.page.waitForTimeout(1500);
// 屋主中途解散（局中那颗《解散小屋》→ 确认）
await H.page.$eval('#leaveRoomBtn', (el) => el.click());
await H.page.waitForSelector('#confirmLeaveYes, #mpLeaveYes, .confirm-leave .primary', { timeout: 5000 }).catch(() => {});
const yes = await H.page.$('#confirmLeaveYes') || await H.page.$('#mpLeaveYes') || await H.page.$('.confirm-leave .primary');
if (yes) await yes.click();
const lockedShown = await G.page.waitForSelector('#roomLockedOut', { timeout: 15000 }).then(() => true).catch(() => false);
check('没权限的客人：弹出《屋主离开，小屋暂时解散，等一会再来？》', lockedShown);
const lockedText = await G.page.$eval('#roomLockedOut .tag-line', (el) => el.textContent.trim()).catch(() => '');
check('那句话一字不差', lockedText === '屋主离开，小屋暂时解散，等一会再来？', lockedText);
check('弹出来的时候表已经停了', await G.page.$eval('#pauseOverlay', (el) => el.classList.contains('show')).catch(() => false));
await G.page.click('#roomLockedOk');
await G.page.waitForSelector('.home-page', { timeout: 8000 });
check('按 ok → 主页', await G.page.$('.home-page').then(Boolean));
check('没有结算页、没有存档', !(await G.page.$('#endOverlay.show')) && (await G.page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('_flip') && k.includes('runs')).length)) === 0);

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
