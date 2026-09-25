/**
 * 竞赛小屋，在真界面上跑一遍（要 dev-server + Chromium）。
 *
 *   node scripts/dev-server.mjs 8923 dist
 *   node scripts/check-room-contest-ui.mjs http://localhost:8923/
 *
 * 服务端那三条规矩由 scripts/check-room-contest.mjs 守着（纯 node，在 CI 里）。
 * 这一道守的是**摆到真 DOM 上之后**才会出错的那几件：
 *
 *   · **《开竞赛》那颗键在，而且底下那一行小字在。** 这一行是「必须有字」的地方
 *     ——不写的话玩家按下去会发现自己没有棋盘，那正是站点原则里的「意料之外的
 *     界面」。
 *   · **主持人这一局不拿到棋盘**，改坐在实时榜单上，榜上**没有他自己**（列进去
 *     就是一行恒定 0 分挂在最后一名），那颗键上的字是《解散小屋》。
 *   · **二十个人的榜单摆得下。** api/room.js 开头那段注释早写着这件事要先办：
 *     「等名单和战绩图都摆得下二十个人之后，再把入口放出来——反过来先放入口，今
 *     晚就会有人开出一间二十人的屋子配着八人的排版」。实测过那个排版：榜单盒子
 *     长到 1322px 塞在 844px 的屏幕里，整块被挤出去（顶边 −138，滚都滚不回去），
 *     名单自己一格都不滚。修在 style.css 的 `.overlay--wait .mp-wait-stage`。
 *   · **普通八人屋一个字都没被碰。** 最后那一节是对照：屋主照旧拿得到棋盘。
 *
 * 十九个选手是直接打接口进来的（同源 fetch），不是开十九个浏览器——要量的是
 * 屏幕上摆不摆得下，不是十九台设备的联机。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8923/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];

/**
 * 一台开通了天才的手机，停在多人设置页上。
 *
 * `code` 要**每台一张不同的**：兑换码在一个 dev-server 进程里只能用一次
 * （CLAUDE.md 里记着这个坑）。这道门要开两台屋主（竞赛屋一台、对照的普通屋一台），
 * 第二台再兑 TESTMONTH 会拿到 `{"error":"code"}`，然后崩在「兑码没成」上——
 * 头一版就是这么红的，看着像小屋的 bug，其实是同一张码用了两回。
 */
async function hostPage(code = 'TESTMONTH') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    for (const [k, v] of Object.entries({
      slides_lang: 'zhHans', slides_intro_seen: '1', slides_played_square: '1',
      slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
    })) localStorage.setItem(k, v);
  });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  // 开屋要服务器认得的天才身份：兑一张 dev-server 自己种的测试码（和
  // check-multiplayer 同一个做法），再照 engine/account.ts 那样把权益写进本地。
  const granted = await p.evaluate(async (redeemCode) => {
    const r = await fetch('/api/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: redeemCode }),
    }).then((x) => x.json());
    if (!r.active) return r;
    localStorage.setItem('slides_genius', JSON.stringify({
      active: true, period: r.period, until: r.until, channel: 'code',
      email: r.email, token: r.token, code: r.code,
    }));
    return r;
  }, code);
  if (!granted.active) throw new Error(`兑码没成（${code}）：` + JSON.stringify(granted));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await p.click('#navProfile');
  await p.click('#multiRow');
  await p.waitForSelector('#mpCreate', { timeout: 15000 });
  return { ctx, p };
}

/** 屋主挑一个玩法（#mpPick 把他送回主菜单，点一张卡就是全屋的玩法）。 */
async function pickSquare(p) {
  await p.click('#mpPick');
  await p.waitForSelector('#roomPickBar', { timeout: 12000 });
  await p.evaluate(() => {
    [...document.querySelectorAll('.mode-axis > .home-icon-btn')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('方块'))
      ?.click();
  });
}

// ---- 1. 设置页：《开竞赛》和它底下那一行 ---------------------------------
const { ctx, p } = await hostPage();
{
  const look = await p.evaluate(() => {
    const c = document.querySelector('#mpContest');
    const o = document.querySelector('#mpCreate');
    const box = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      has: Boolean(c),
      contest: c ? box(c) : null,
      create: o ? box(o) : null,
      label: c?.textContent?.trim() ?? '',
      hints: [...document.querySelectorAll('.auth-hint--center')].map((e) => e.textContent.trim()),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check('多人设置页上有《开竞赛》', look.has, look.label);
  check('它看得见，而且和《开小屋》一样大（是同一件事的两个档）',
    look.contest && look.contest.w > 40 && look.contest.h > 20
      && Math.abs(look.contest.w - look.create.w) <= 1 && Math.abs(look.contest.h - look.create.h) <= 1,
    `${JSON.stringify(look.contest)} / ${JSON.stringify(look.create)}`);
  check('底下那一行说清了「20 人」和「你不下场」（必须有字的地方）',
    look.hints.some((h) => /20/.test(h) && /不下场|不参|主持/.test(h)),
    look.hints.join(' / '));
  check('设置页没有被撑出横向滚动', look.overflowX === 0, `${look.overflowX}px`);
}

// ---- 2. 二十个人的竞赛屋：主持人没有棋盘，榜上没有他自己，而且摆得下 ------
{
  await p.click('#mpContest');
  await p.waitForSelector('#mpPick', { timeout: 15000 });
  const code = await p.evaluate(() => document.body.textContent.match(/\b\d{4}\b/)?.[0]);
  check('竞赛屋开出来了，屋号在屏幕上', /^\d{4}$/.test(code || ''), String(code));
  const joined = await p.evaluate(async (code) => {
    const keys = [];
    for (let i = 1; i <= 19; i++) {
      const r = await fetch('/api/room', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'join', code, name: '选手' + String(i).padStart(2, '0'), seen: ['square', 'circle', 'triangle'] }),
      }).then((x) => x.json());
      if (r.playerToken) keys.push({ playerId: r.playerId, playerToken: r.playerToken });
    }
    window.__keys = keys;
    return keys.length;
  }, code);
  check('十九名选手都进来了（连主持人二十个，坐满）', joined === 19, `进了 ${joined} 个`);
  await p.waitForTimeout(1800);
  const roster = await p.evaluate(() => ({
    rows: document.querySelectorAll('.mp-player').length,
    seats: (document.body.textContent.match(/\d+\s*\/\s*20/) || [])[0] ?? '（没找到 n/20）',
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  check('小屋名单上二十个人都在，而且写着 /20', roster.rows === 20 && /20\s*\/\s*20/.test(roster.seats),
    `${roster.rows} 行 · ${roster.seats}`);
  check('小屋页没有被撑出横向滚动', roster.overflowX === 0, `${roster.overflowX}px`);

  await pickSquare(p);
  const onPanel = await p.waitForSelector('#mpWait', { timeout: 25000 }).then(() => true).catch(() => false);
  check('主持人被送上实时榜单（不是棋盘）', onPanel);
  // 十九个人各报一个分，榜单才有东西可排。
  await p.evaluate(async (code) => {
    const keys = window.__keys || [];
    for (let i = 0; i < keys.length; i++) {
      await fetch('/api/room', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'score', code, ...keys[i], score: (i + 1) * 37, finished: true, seconds: 20 + i, round: 1 }),
      });
    }
  }, code);
  await p.waitForTimeout(2500);
  const panel = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#mpWaitRows .mp-player')];
    const box = document.querySelector('#mpWaitRows');
    const stage = document.querySelector('.mp-wait-stage');
    const br = box.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const leave = document.querySelector('#mpWaitLeave').getBoundingClientRect();
    return {
      hasBoard: Boolean(document.querySelector('#boardWrap .tile')),
      rows: rows.length,
      top3: rows.slice(0, 3).map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      leaveLabel: document.querySelector('#mpWaitLeave').textContent.trim(),
      stage: { h: Math.round(sr.height), top: Math.round(sr.top), bottom: Math.round(sr.bottom) },
      boxH: Math.round(br.height),
      boxScrolls: box.scrollHeight - box.clientHeight,
      rowOverflowX: rows.reduce((m, e) => Math.max(m, e.scrollWidth - e.clientWidth), 0),
      leaveOnScreen: leave.top >= 0 && leave.bottom <= window.innerHeight,
      vh: window.innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check('主持人手上没有棋盘', panel.hasBoard === false);
  check('榜上是十九名选手，没有主持人自己', panel.rows === 19, `${panel.rows} 行`);
  check('榜按分数排（第一名是分最高的那个）', /选手19/.test(panel.top3[0] || ''), panel.top3.join(' | '));
  check('那颗键上写的是《解散小屋》（他按下去做的就是这件事）',
    panel.leaveLabel.includes('解散'), panel.leaveLabel);
  // 排版那三条。这一节就是 api/room.js 开头「先把排版摆好再放入口」那句话的门。
  check('整块榜单摆在屏幕里（不再被挤出去）',
    panel.stage.top >= 0 && panel.stage.bottom <= panel.vh + 1,
    `舞台 ${panel.stage.h}px：${panel.stage.top}→${panel.stage.bottom}，屏高 ${panel.vh}`);
  check('名单自己滚（十九行滚得到最后一名）', panel.boxScrolls > 100,
    `可滚 ${panel.boxScrolls}px（盒子 ${panel.boxH}px）`);
  check('《解散小屋》没被挤出屏幕', panel.leaveOnScreen);
  check('一行都没有横向溢出，整页也没有', panel.rowOverflowX === 0 && panel.overflowX === 0,
    `行 ${panel.rowOverflowX}px / 页 ${panel.overflowX}px`);
}
await ctx.close();

// ---- 3. 对照：普通八人屋照旧，屋主拿得到棋盘 ------------------------------
//
// 少了这一节，把《开小屋》也接成竞赛屋都是全绿的。
{
  const { ctx: c2, p: p2 } = await hostPage('TESTYEAR');
  await p2.click('#mpCreate');
  await p2.waitForSelector('#mpPick', { timeout: 15000 });
  const code = await p2.evaluate(() => document.body.textContent.match(/\b\d{4}\b/)?.[0]);
  const seats = await p2.evaluate(() => (document.body.textContent.match(/\d+\s*\/\s*\d+/) || [])[0]);
  check('普通屋还是 /8', /\/\s*8/.test(seats || ''), String(seats));
  await p2.evaluate(async (code) => {
    await fetch('/api/room', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'join', code, name: '客人', seen: ['square', 'circle', 'triangle'] }),
    });
  }, code);
  await p2.waitForTimeout(1500);
  await pickSquare(p2);
  const got = await p2.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 })
    .then(() => true).catch(() => false);
  check('普通屋照旧：屋主拿得到棋盘（这一改没碰八人屋）', got);
  await c2.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
