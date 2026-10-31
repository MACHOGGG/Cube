/**
 * 主菜单一步一步出现（10-31 方案推12 Z-J02，站长 10-30：没解锁的玩法不出现，排布顺序不改）。要 dev-server + Chromium。
 *
 *   node scripts/dev-server.mjs 8943 dist      （兑 TESTMONTH 一次——一台新服务器）
 *   node scripts/check-menu-stages.mjs http://localhost:8943/ [--only=1,4]
 *
 * **什么都不预设，只设语言**（每一节自己从头做人；要别的状态的那几节明写它预设了什么）。
 *
 *   1  第 1 步：只有小球一张、居中（卡中心与视口中线差 ≤2）、边长 = min(40vw,176,22vh) ±1；《我会玩》在卡下方；没有轴。
 *      390×844、320×568、1440×900、1000×700、844×390 各一遍；整组在招牌与底排之间竖向居中（±8）。
 *   2  小球教学局倒数中退出 / 开打后刷新 → 仍是第 1 步；走到结算 → 第 2 步：方块在左、亮光、带 --arrive；再进主菜单一次 → 没有 --arrive。
 *   3  方块教学局走到结算 → 第 3 步 6 张（手机 4 排：每日挑战、炸弹各落单；宽屏 2 排各居中）；有 role=status 念到四个名字。
 *   4  打完一局计时 → 第 4 步；另起：打完一局每日挑战 / 一局炸弹 / 输代号开一局老虎机，都只升到第 4 步；小屋里打完一局（真屋主，
 *      兑 TESTMONTH）也升到第 4 步；进屋不打、小屋就散了 → 不升。
 *   5  打完一局无限反转 → 第 5 步；没登录时四副布局有锁、没有 .center-pick-genius、点了出登录窗；登录回来锁撤、没有 --arrive。
 *   6  《我会玩》→ 第 3 步、按钮不在、刷新还是第 3 步；小球头一回点开仍有教学条。
 *   7  只升不降：第 5 步再清掉 slides_played_tier4 → 仍是 5。
 *   8  老玩家迁移：只有 slides_tutorial_seen_circle → 2；slides_played_bomb → 4；本机一局上线以前的老虎机 → 5；哨兵在时改旧键不再
 *      迁移；已有 slides_played_stage = '1'、没有哨兵时预设 slides_tutorial_seen → 仍是 1（只写哨兵）。
 *   9  新人按顺序：第 1 步时预设 tier3 → 仍 1；补上小球、方块两键开机 → 4。本机一局上线以后的小屋局 → 只多一把 tier3，步数不跳。
 *  10  小屋学规则不跳步（推19 之前先用「直接写 slides_tutorial_seen_circle、slides_tutorial_seen 再刷新」代替那条流程）：仍是第 1 步。
 *  11  减弱动态：--arrive 那张图没有 animation、有静止的 filter。
 *  12  手机第 4 步刚解锁：轴的焦点仍在上次那一项（不自动滚到新卡那一排，站长答复 ⑤）。
 *  13  存不进（setItem 抛错）→ 13 张全摆。
 *  14  屋主替整屋挑玩法：第 3 步的屋主看得到老虎机、无限反转、布局。
 *  15  老虎机介绍页（个人主页进）：第 3 步没有《开始》，第 4 步起有。
 *  16  一路零脚本报错。
 *  17  小红书（预览页）：第 1 → 2 → 3 步，slides.xhs. 前缀的键写对，不碰网页的键。
 *
 * 变异（手跑，写进提交说明）：让 syncMenuStage 也读 slides_tutorial_seen* → 第 10 节红；把「按顺序」换成「最高一步」→ 第 9 节红。
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import * as SC from '../api/_seedcode.js';
import { ensurePreview } from '../xhs/ensurePreview.mjs';

const BASE = (process.argv[2] || 'http://localhost:8943/').replace(/\/*$/, '/');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',').map(Number);
const want = (n) => !ONLY || ONLY.includes(n);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 本推上线那一刻（engine/menuStage.ts 的 MENU_STAGE_SINCE）。 */
const SINCE = Date.UTC(2026, 9, 31, 16, 0, 0);
/** 老虎机那一本存档的键（square 的 bestKey + suffixFor('base', { slot: true })，engine/runKey.ts）。 */
const SLOT_BOOK = 'sugarcube_best_slot_ero1';
const ROOM_BOOK = 'sugarcube_best_ero1';
/** 第 3 步的老玩家（迁移过、小球方块都打过）。 */
const STAGE3 = { slides_played_migrated_v1: '1', slides_played_stage: '3', slides_played_stage_shown: '3', slides_played_circle: '1', slides_played_square: '1', slides_played_finished: '1', slides_cvd_offer: '1' };

/**
 * 开一台设备。`preset` 只在这台设备第一次加载时写一次（sessionStorage 记着）——之后的刷新、开机读到的是页面自己写下的那一份，
 * 不会被夹具又盖回去。
 */
async function device(vp = [390, 844], preset = {}, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp[0], height: vp[1] },
    isMobile: vp[0] < 720 && vp[1] > vp[0],
    hasTouch: vp[0] < 720 && vp[1] > vp[0],
    ...(opts.reducedMotion ? { reducedMotion: 'reduce' } : {}),
  });
  if (opts.noStore) {
    await ctx.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new Error('QuotaExceededError');
      };
    });
  } else {
    await ctx.addInitScript((kv) => {
      if (sessionStorage.getItem('ms_primed') === '1') return;
      sessionStorage.setItem('ms_primed', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, { slides_lang: 'zhHans', ...preset });
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-page .home-icon-btn, .home-page .home-bomb-card', { timeout: 30000 });
  await p.waitForTimeout(500);
  return { ctx, p };
}
const stageOf = (p) => p.evaluate(() => localStorage.getItem('slides_played_stage'));
const cardsOf = (p) => p.evaluate(() => [...document.querySelectorAll('#homeGrid [data-card]')].map((c) => c.dataset.card));
const arriving = (p) => p.evaluate(() => [...document.querySelectorAll('#homeGrid .home-icon-btn--arrive')].map((c) => c.dataset.card));
/** 回主菜单（结算页那颗《首页》，或者整页的《退出》）。 */
async function toMenu(p) {
  for (let i = 0; i < 4; i++) {
    if (await p.$('.home-page')) break;
    const end = await p.$('#endOverlay.show #endBackBtn');
    if (end) await p.$eval('#endOverlay.show #endBackBtn', (e) => e.click());
    else {
      const exit = await p.$('.page-exit');
      if (exit) await p.$eval('.page-exit', (e) => e.click());
    }
    await p.waitForTimeout(600);
  }
  await p.waitForSelector('.home-page', { timeout: 15000 });
  await p.waitForTimeout(500);
}
/** 等开打（倒数数完、棋盘有子）→ 暂停 →《结束游戏》→ 结算页。 */
async function finishRun(p) {
  await p.waitForFunction(() => !document.querySelector('#startOverlay.show') && document.querySelectorAll('.tile, .ball, .tri').length > 0, null, { timeout: 40000 });
  await p.waitForTimeout(400);
  await p.$eval('#stopBtn', (e) => e.click());
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.$eval('#pauseFinishBtn', (e) => e.click());
  await p.waitForSelector('#endOverlay.show', { timeout: 15000 });
  await p.waitForTimeout(400);
}
const tap = (p, card) => p.$eval(`#homeGrid [data-card="${card}"]`, (e) => e.click());
/** 一张卡：点它、打到结算、回主菜单。 */
async function playCard(p, card) {
  await tap(p, card);
  await finishRun(p);
  await toMenu(p);
}
/** 整页挑图形那几页（计时、无限反转、步步为营、老虎机）：点卡、挑方块、打到结算、回主菜单。 */
async function playPicker(p, card) {
  await tap(p, card);
  await p.waitForSelector('.slot-pick-opt[data-family="square"]', { timeout: 15000 });
  await p.waitForTimeout(card === 'slot' ? 3500 : 300);
  await p.$eval('.slot-pick-opt[data-family="square"]', (e) => e.click());
  await finishRun(p);
  await toMenu(p);
}

// ── 1. 第 1 步：只有小球，居中 ────────────────────────────────────────────────────
if (want(1)) {
  for (const vp of [[390, 844], [320, 568], [1440, 900], [1000, 700], [844, 390]]) {
    const { ctx, p } = await device(vp);
    const m = await p.evaluate(() => {
      const card = document.querySelector('#homeGrid [data-card]');
      const r = card?.getBoundingClientRect();
      const kh = document.querySelector('.know-how-btn')?.getBoundingClientRect();
      const head = document.querySelector('.home-head')?.getBoundingClientRect();
      const nav = document.querySelector('.home-nav-dock, .home-nav')?.getBoundingClientRect();
      return {
        cards: [...document.querySelectorAll('#homeGrid [data-card]')].map((c) => c.dataset.card),
        cx: r ? r.left + r.width / 2 : null, w: r?.width, top: r?.top, cardBottom: r ? r.top + card.querySelector('.home-icon-art').getBoundingClientRect().height : null,
        groupBottom: kh ? kh.bottom : null, khTop: kh?.top, khH: kh?.height,
        headBottom: head?.bottom, navTop: nav?.top, axis: !!document.querySelector('.mode-axis'),
        vw: document.documentElement.clientWidth, vh: innerHeight,
      };
    });
    const tag = `1 ${vp[0]}×${vp[1]}`;
    const side = Math.min(0.4 * vp[0], 176, 0.22 * vp[1]);
    check(`${tag}：只有小球一张`, m.cards.join() === 'circle', m.cards.join());
    check(`${tag}：卡在正中（差 ≤2）`, Math.abs(m.cx - m.vw / 2) <= 2, `${(m.cx - m.vw / 2).toFixed(1)}px`);
    check(`${tag}：边长 = min(40vw,176,22vh) ±1`, Math.abs(m.w - side) <= 1, `${m.w?.toFixed(1)} vs ${side.toFixed(1)}`);
    check(`${tag}：《我会玩》在卡下方，热区 ≥44 高`, m.khTop > m.cardBottom && m.khH >= 44, `kh ${m.khTop?.toFixed(0)} · 卡底 ${m.cardBottom?.toFixed(0)} · 高 ${m.khH}`);
    check(`${tag}：没有轴`, !m.axis);
    const mid = (m.headBottom + m.navTop) / 2;
    const groupMid = (m.top + m.groupBottom) / 2;
    check(`${tag}：整组在招牌与底排之间竖向居中（±8）`, Math.abs(groupMid - mid) <= 8, `组中 ${groupMid.toFixed(0)} · 中线 ${mid.toFixed(0)}`);
    await ctx.close();
  }
}

// ── 2、3、4（计时）、5：同一台手机，一步一步打上去 ─────────────────────────────────────
if (want(2) || want(3) || want(4) || want(5)) {
  const { ctx, p } = await device([390, 844]);
  // 2. 倒数中退出、开打后刷新都不升
  await tap(p, 'circle');
  await p.waitForSelector('#startOverlay.show', { timeout: 20000 });
  await p.$eval('#startBackBtn', (e) => e.click());
  await toMenu(p);
  check('2 小球倒数中按《<》：仍是第 1 步', (await cardsOf(p)).join() === 'circle', (await cardsOf(p)).join());
  await tap(p, 'circle');
  await p.waitForFunction(() => !document.querySelector('#startOverlay.show'), null, { timeout: 30000 });
  await p.waitForTimeout(600);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  await p.waitForTimeout(500);
  check('2 开打后刷新：仍是第 1 步', (await cardsOf(p)).join() === 'circle' && (await stageOf(p)) === '1', `${(await cardsOf(p)).join()} · ${await stageOf(p)}`);
  await playCard(p, 'circle');
  const s2 = await p.evaluate(() => {
    const sq = document.querySelector('#homeGrid [data-card="square"]');
    const ci = document.querySelector('#homeGrid [data-card="circle"]');
    return {
      cards: [...document.querySelectorAll('#homeGrid [data-card]')].map((c) => c.dataset.card),
      left: sq && ci ? sq.getBoundingClientRect().left < ci.getBoundingClientRect().left : false,
      glow: !!sq?.classList.contains('home-icon-btn--glow'),
      arrive: !!sq?.classList.contains('home-icon-btn--arrive'),
      ciGlow: !!ci?.classList.contains('home-icon-btn--glow'),
    };
  });
  check('2 小球走到结算 → 第 2 步：方块、小球两张', s2.cards.join() === 'square,circle', s2.cards.join());
  check('2 方块在左、亮光、带 --arrive；小球熄光', s2.left && s2.glow && s2.arrive && !s2.ciGlow, JSON.stringify(s2));
  check('2 slides_played_stage = 2', (await stageOf(p)) === '2', String(await stageOf(p)));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  await p.waitForTimeout(400);
  check('2 再进主菜单一次：没有 --arrive', (await arriving(p)).length === 0, (await arriving(p)).join());

  // 3. 方块走到结算 → 第 3 步
  await playCard(p, 'square');
  await p.waitForTimeout(300);
  const s3 = await p.evaluate(() => ({
    cards: [...document.querySelectorAll('#homeGrid [data-card]')].map((c) => c.dataset.card),
    solo: [...document.querySelectorAll('#homeGrid .axis-col--solo')].map((c) => c.dataset.card),
    arrive: [...document.querySelectorAll('#homeGrid .home-icon-btn--arrive')].map((c) => c.dataset.card),
    status: [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' | '),
    names: [...document.querySelectorAll('#homeGrid .home-icon-btn--arrive')].map((c) => c.querySelector('.home-icon-tag')?.textContent ?? ''),
  }));
  check('3 方块走到结算 → 第 3 步 6 张（照今天的次序）', s3.cards.join() === 'daily,square,circle,multiplayer,timed,bomb', s3.cards.join());
  check('3 手机 4 排：每日挑战、炸弹各落单', s3.solo.join() === 'daily,bomb', s3.solo.join());
  check('3 新出来的四张带 --arrive', s3.arrive.join() === 'daily,multiplayer,timed,bomb', s3.arrive.join());
  check('3 role=status 念到四个名字', s3.names.length === 4 && s3.names.every((n) => n && s3.status.includes(n)) && s3.status.startsWith('新玩法已出现：'), s3.status);

  // 4. 计时 → 第 4 步
  if (want(4) || want(5)) {
    await playPicker(p, 'timed');
    const c4 = await cardsOf(p);
    check('4 打完一局计时 → 第 4 步（老虎机、无限反转、步步为营出现）', (await stageOf(p)) === '4' && ['slot', 'flip', 'puzzle'].every((k) => c4.includes(k)) && !c4.includes('squareDiamond'), `${await stageOf(p)} · ${c4.join()}`);
  }
  // 5. 无限反转 → 第 5 步，没登录布局挂锁
  if (want(5)) {
    await playPicker(p, 'flip');
    const s5 = await p.evaluate(() => ({
      cards: [...document.querySelectorAll('#homeGrid [data-card]')].length,
      locked: [...document.querySelectorAll('#homeGrid .home-icon-btn--locked')].map((c) => c.dataset.card),
      genius: document.querySelectorAll('.center-pick-genius').length,
      label: document.querySelector('#homeGrid [data-card="squareDiamond"]')?.getAttribute('aria-label'),
    }));
    check('5 打完一局无限反转 → 第 5 步 13 张', (await stageOf(p)) === '5' && s5.cards === 13, `${await stageOf(p)} · ${s5.cards}`);
    check('5 没登录：四副布局挂锁、没有天才招牌', s5.locked.join() === 'squareDiamond,circleHex,circleSeven,triangleBig' && s5.genius === 0, JSON.stringify(s5));
    check('5 读屏名后半是「登录后可用」', /· 登录后可用$/.test(s5.label ?? ''), s5.label);
    await tap(p, 'squareDiamond');
    const auth = await p.waitForSelector('#authMailForm', { timeout: 8000 }).then(() => true).catch(() => false);
    check('5 点锁着的布局：出登录窗', auth);
    // 登录回来（本机登录缓存写上、重画）：锁撤、不演浮出。
    await p.evaluate(() => localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', code: 'GATEUNLOCK', until: 4102444800000 })));
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.home-page', { timeout: 30000 });
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => ({ locked: document.querySelectorAll('#homeGrid .home-icon-btn--locked').length, arrive: document.querySelectorAll('#homeGrid .home-icon-btn--arrive').length }));
    check('5 登录回来：锁撤了、没有 --arrive', after.locked === 0 && after.arrive === 0, JSON.stringify(after));
  }
  await ctx.close();
}

// ── 3（宽屏）：第 3 步两排、各排居中 ────────────────────────────────────────────────
if (want(3)) {
  const { ctx, p } = await device([1440, 900], STAGE3);
  const rows = await p.evaluate(() => {
    const out = {};
    for (const c of document.querySelectorAll('#homeGrid [data-card]')) {
      const r = c.getBoundingClientRect();
      const k = Math.round(r.top);
      (out[k] ??= []).push([r.left, r.right]);
    }
    return Object.values(out).map((xs) => (Math.min(...xs.map((x) => x[0])) + Math.max(...xs.map((x) => x[1]))) / 2);
  });
  check('3 宽屏第 3 步：两排', rows.length === 2, String(rows.length));
  check('3 宽屏：每一排居中（±2）', rows.every((c) => Math.abs(c - 720) <= 2), rows.map((c) => c.toFixed(1)).join(','));
  await ctx.close();
}

// ── 4：每日挑战 / 炸弹 / 输代号老虎机 / 小屋，各自都只升到第 4 步 ────────────────────────────
if (want(4)) {
  // 每日挑战（今日那一局）
  {
    const { ctx, p } = await device([390, 844], STAGE3);
    await tap(p, 'daily');
    await p.waitForSelector('#dailyPlay', { timeout: 15000 });
    await p.$eval('#dailyPlay', (e) => e.click());
    await finishRun(p);
    await toMenu(p);
    check('4 打完一局每日挑战 → 第 4 步（不跳到 5）', (await stageOf(p)) === '4', String(await stageOf(p)));
    await ctx.close();
  }
  // 炸弹（基础那一档）
  {
    const { ctx, p } = await device([390, 844], STAGE3);
    await tap(p, 'bomb');
    await p.waitForSelector('.bomb-chip[data-tier="basic"][data-board="square"]', { timeout: 15000 });
    await p.$eval('.bomb-chip[data-tier="basic"][data-board="square"]', (e) => e.click());
    await finishRun(p);
    await toMenu(p);
    check('4 打完一局炸弹 → 第 4 步', (await stageOf(p)) === '4', String(await stageOf(p)));
    await ctx.close();
  }
  // 输代号开一局老虎机（代号局一律记第 3 步那一档，站长答复 ②）
  {
    const slotRow = SC.VARIANTS.findIndex((v) => v.mode === 'slot' && v.board === 'square');
    const code = slotRow >= 0 ? SC.encodeSeed(SC.DEAL_VERSION, slotRow, 12345) : null;
    const { ctx, p } = await device([390, 844], STAGE3);
    await tap(p, 'daily');
    await p.waitForSelector('#seedInput', { timeout: 15000 });
    if (code) {
      await p.fill('#seedInput', code);
      await p.$eval('#seedGo', (e) => e.click());
      await finishRun(p);
      await toMenu(p);
    }
    check('4 输代号开一局老虎机 → 只到第 4 步', !!code && (await stageOf(p)) === '4', `${code} · ${await stageOf(p)}`);
    await ctx.close();
  }
  // 小屋：真屋主（兑 TESTMONTH）开屋，第 3 步的客人凭座位进屋、打完一局 → 第 4 步；另一位坐着不打、小屋散了 → 不升。
  {
    const host = await device([390, 844], STAGE3);
    const hp = host.p;
    const granted = await hp.evaluate(async () => {
      const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
      if (r.active) localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
      return r.active === true;
    });
    check('4（尺子）屋主兑码登录', granted);
    await hp.reload({ waitUntil: 'load' });
    await hp.waitForSelector('#navProfile', { timeout: 20000 });
    await hp.click('#navProfile');
    await hp.click('#multiRow');
    await hp.waitForSelector('#mpCreate', { timeout: 15000 });
    await hp.fill('#mpName', '甲');
    await hp.click('#mpCreate');
    await hp.waitForSelector('.mp-code', { timeout: 10000 });
    const code = await hp.$eval('.mp-code', (e) => e.textContent.trim());
    const api = (body) => hp.evaluate(async (b) => {
      const r = await fetch('/api/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, body);
    const hostSeat = await hp.evaluate(() => JSON.parse(localStorage.getItem('slides_mp_seat') || '{}'));
    const hostKey = { playerId: hostSeat.playerId, playerToken: hostSeat.playerToken };
    // 14. 屋主替整屋挑玩法：第 3 步的屋主看得到老虎机、无限反转、布局（站长答复 ③）。
    if (want(14)) {
      await hp.$eval('#mpPick', (e) => e.click());
      await hp.waitForSelector('.home-page', { timeout: 15000 });
      await hp.waitForTimeout(500);
      const picked = await cardsOf(hp);
      check('14 第 3 步的屋主替整屋挑玩法：老虎机、无限反转、布局都在', ['slot', 'flip', 'squareDiamond', 'triangleBig'].every((k) => picked.includes(k)), picked.join());
      check('14 挑玩法那一屏不演浮出、不记「画过第几步」', (await arriving(hp)).length === 0 && (await hp.evaluate(() => localStorage.getItem('slides_played_stage_shown'))) === '3');
    }
    const seats = [];
    for (const name of ['乙', '丙']) {
      const r = await api({ action: 'join', code, name, seen: ['square', 'circle', 'triangle'] });
      if (r.json?.playerToken) seats.push({ playerId: r.json.playerId, playerToken: r.json.playerToken });
    }
    check('4（尺子）两位客人坐进来了', seats.length === 2, String(seats.length));
    const guests = [];
    for (const seat of seats) {
      const gctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const g = await gctx.newPage();
      g.on('pageerror', (e) => errs.push(e.message));
      await g.addInitScript(([c, st, pre]) => {
        if (sessionStorage.getItem('ms_primed') === '1') return;
        sessionStorage.setItem('ms_primed', '1');
        localStorage.clear();
        for (const [k, v] of Object.entries({ slides_lang: 'zhHans', ...pre })) localStorage.setItem(k, v);
        localStorage.setItem('slides_mp_seat', JSON.stringify({ code: c, playerId: st.playerId, playerToken: st.playerToken, at: Date.now() }));
      }, [code, seat, STAGE3]);
      await g.goto(BASE, { waitUntil: 'load' });
      await g.waitForSelector('.mp-code', { timeout: 20000 });
      guests.push({ gctx, g });
    }
    const s1 = await api({ action: 'start', code, ...hostKey, mode: 'square' });
    check('4（尺子）这一局开起来了', s1.status === 200, String(s1.status));
    // 乙打完：倒数数完、开打，按《完成》→ 确认。丙只是坐着（不交卷）。
    const g1 = guests[0].g;
    await g1.waitForFunction(() => document.querySelectorAll('.tile, .ball, .tri').length > 0 && !document.querySelector('#startOverlay.show'), null, { timeout: 40000 });
    await g1.waitForTimeout(800);
    await g1.$eval('#finishBtn', (e) => e.click());
    await g1.waitForSelector('#mpFinishYes', { timeout: 8000 });
    await g1.$eval('#mpFinishYes', (e) => e.click());
    await g1.waitForTimeout(1500);
    check('4 小屋里打完一局 → 第 4 步', (await stageOf(g1)) === '4', String(await stageOf(g1)));
    // 屋主散场：丙这一局一下都没打（也没交卷）——不升。
    await api({ action: 'end', code, ...hostKey });
    await guests[1].g.waitForTimeout(4000);
    check('4 进屋不打、小屋散了 → 不升（仍是第 3 步）', (await stageOf(guests[1].g)) === '3' && (await guests[1].g.evaluate(() => localStorage.getItem('slides_played_tier3'))) === null,
      `${await stageOf(guests[1].g)} · tier3 ${await guests[1].g.evaluate(() => localStorage.getItem('slides_played_tier3'))}`);
    for (const x of guests) await x.gctx.close();
    await host.ctx.close();
  }
}

// ── 6. 《我会玩》→ 第 3 步 ─────────────────────────────────────────────────────────
if (want(6)) {
  const { ctx, p } = await device([390, 844]);
  await p.$eval('.know-how-btn', (e) => e.click());
  await p.waitForTimeout(600);
  const c = await cardsOf(p);
  check('6 按《我会玩》→ 第 3 步 6 张、按钮不在', c.length === 6 && !(await p.$('.know-how-btn')) && (await stageOf(p)) === '3', `${c.join()} · ${await stageOf(p)}`);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  check('6 刷新后仍是第 3 步', (await cardsOf(p)).length === 6);
  await tap(p, 'circle');
  const coach = await p.waitForSelector('.coach-bar:not([hidden])', { timeout: 30000 }).then(() => true).catch(() => false);
  check('6 小球头一回点开仍有教学条', coach);
  await ctx.close();
}

// ── 7. 只升不降 ───────────────────────────────────────────────────────────────────
if (want(7)) {
  const { ctx, p } = await device([390, 844], { ...STAGE3, slides_played_stage: '5', slides_played_stage_shown: '5', slides_played_tier3: '1', slides_played_tier4: '1' });
  await p.evaluate(() => localStorage.removeItem('slides_played_tier4'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  await p.waitForTimeout(300);
  check('7 第 5 步清掉 tier4 → 仍是 5（13 张）', (await stageOf(p)) === '5' && (await cardsOf(p)).length === 13, `${await stageOf(p)} · ${(await cardsOf(p)).length}`);
  await ctx.close();
}

// ── 8. 老玩家迁移 ─────────────────────────────────────────────────────────────────
if (want(8)) {
  const slotRun = { at: SINCE - 864e5, data: { at: SINCE - 864e5, shapeId: 'square', modeKey: 'base', slot: true, totalScore: 10, rules: 'ero1' }, start: null, end: null };
  const cases = [
    ['只有 slides_tutorial_seen_circle → 2', { slides_tutorial_seen_circle: '1' }, '2'],
    ['slides_played_bomb → 4', { slides_played_bomb: '1' }, '4'],
    ['本机一局上线以前的老虎机 → 5', { [SLOT_BOOK + '::runs']: JSON.stringify([slotRun]) }, '5'],
    ['哨兵在时改旧键不再迁移（第 1 步的人写了 slides_played_bomb）', { slides_played_migrated_v1: '1', slides_played_stage: '1', slides_played_bomb: '1' }, '1'],
    ['已有 slides_played_stage=1、没有哨兵，预设 slides_tutorial_seen → 仍是 1', { slides_played_stage: '1', slides_tutorial_seen: '1' }, '1'],
  ];
  for (const [name, pre, want8] of cases) {
    const { ctx, p } = await device([390, 844], pre);
    const st = await stageOf(p);
    const sentinel = await p.evaluate(() => localStorage.getItem('slides_played_migrated_v1'));
    check(`8 ${name}`, st === want8 && sentinel === '1', `${st} · 哨兵 ${sentinel}`);
    await ctx.close();
  }
}

// ── 9. 新人按顺序 ─────────────────────────────────────────────────────────────────
if (want(9)) {
  {
    const { ctx, p } = await device([390, 844]);
    await p.evaluate(() => localStorage.setItem('slides_played_tier3', '1'));
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.home-page', { timeout: 30000 });
    check('9 第 1 步时有 tier3 → 仍是 1（证据记着，不跳）', (await stageOf(p)) === '1', String(await stageOf(p)));
    await p.evaluate(() => {
      localStorage.setItem('slides_played_circle', '1');
      localStorage.setItem('slides_played_square', '1');
    });
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.home-page', { timeout: 30000 });
    check('9 补上小球、方块两键开机 → 一次到第 4 步', (await stageOf(p)) === '4', String(await stageOf(p)));
    await ctx.close();
  }
  {
    const late = SINCE + 864e5;
    const roomRun = { at: late, data: { at: late, shapeId: 'square', modeKey: 'base', room: true, totalScore: 10, rules: 'ero1' }, start: null, end: null };
    const { ctx, p } = await device([390, 844], { [ROOM_BOOK + '::runs']: JSON.stringify([roomRun]) });
    const m = await p.evaluate(() => ({ stage: localStorage.getItem('slides_played_stage'), t3: localStorage.getItem('slides_played_tier3') }));
    check('9 本机一局上线以后的小屋局（新人）：只多一把 tier3，步数不跳', m.stage === '1' && m.t3 === '1', JSON.stringify(m));
    await ctx.close();
  }
}

// ── 10. 小屋学规则不跳步（推19 之前的代替流程）───────────────────────────────────────────
if (want(10)) {
  const { ctx, p } = await device([390, 844]);
  check('10（尺子）全新设备开机一次：第 1 步、哨兵写上', (await stageOf(p)) === '1' && (await p.evaluate(() => localStorage.getItem('slides_played_migrated_v1'))) === '1');
  await p.evaluate(() => {
    localStorage.setItem('slides_tutorial_seen_circle', '1');
    localStorage.setItem('slides_tutorial_seen', '1');
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  await p.waitForTimeout(300);
  check('10 学规则写了 slides_tutorial_seen*，刷新再开机：仍是第 1 步、只有小球', (await stageOf(p)) === '1' && (await cardsOf(p)).join() === 'circle', `${await stageOf(p)} · ${(await cardsOf(p)).join()}`);
  await ctx.close();
}

// ── 11. 减弱动态 ──────────────────────────────────────────────────────────────────
if (want(11)) {
  const { ctx, p } = await device([390, 844], { slides_played_migrated_v1: '1', slides_played_stage: '2', slides_played_stage_shown: '1', slides_played_circle: '1' }, { reducedMotion: true });
  const m = await p.evaluate(() => {
    const art = document.querySelector('#homeGrid .home-icon-btn--arrive .home-icon-art');
    const svg = art?.querySelector('svg');
    return { has: !!art, anim: art ? getComputedStyle(art).animationName : '', svgAnim: svg ? getComputedStyle(svg).animationName : '', filter: svg ? getComputedStyle(svg).filter : '' };
  });
  check('11 减弱动态：新卡那张图没有 animation、有静止的光', m.has && m.anim === 'none' && m.svgAnim === 'none' && /drop-shadow/.test(m.filter), JSON.stringify(m));
  await ctx.close();
}

// ── 12. 手机第 4 步刚解锁：焦点不动 ────────────────────────────────────────────────────
if (want(12)) {
  const { ctx, p } = await device([390, 844], STAGE3);
  await p.evaluate(() => sessionStorage.setItem('slides_axis_focus', 'timed'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  await p.waitForTimeout(600);
  await p.evaluate(() => localStorage.setItem('slides_played_tier3', '1'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  await p.waitForTimeout(900);
  const m = await p.evaluate(() => {
    const host = document.querySelector('#homeGrid').getBoundingClientRect();
    const mid = host.top + host.height / 2;
    let best = null;
    for (const c of document.querySelectorAll('#homeGrid [data-card]')) {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (!best || d < best.d) best = { d, card: c.dataset.card };
    }
    return { stage: localStorage.getItem('slides_played_stage'), saved: sessionStorage.getItem('slides_axis_focus'), nearest: best?.card };
  });
  check('12 升到第 4 步后，轴还停在上次那一项（计时那一排）', m.stage === '4' && m.saved === 'timed' && ['multiplayer', 'timed'].includes(m.nearest), JSON.stringify(m));
  await ctx.close();
}

// ── 13. 存不进 → 全部摆出来 ───────────────────────────────────────────────────────────
if (want(13)) {
  const { ctx, p } = await device([390, 844], {}, { noStore: true });
  check('13 localStorage 写不进：13 张全摆', (await cardsOf(p)).length === 13, String((await cardsOf(p)).length));
  await ctx.close();
}

// ── 15. 老虎机介绍页的《开始》 ──────────────────────────────────────────────────────────
if (want(15)) {
  for (const [st, has] of [['3', false], ['4', true]]) {
    const { ctx, p } = await device([390, 844], { ...STAGE3, slides_played_stage: st, slides_played_stage_shown: st, ...(st === '4' ? { slides_played_tier3: '1' } : {}) });
    await p.click('#navProfile');
    await p.waitForSelector('#randomRow', { timeout: 15000 });
    await p.$eval('#randomRow', (e) => e.click());
    await p.waitForTimeout(1200);
    const go = !!(await p.$('#slotGo'));
    check(`15 第 ${st} 步：老虎机介绍页${has ? '有' : '没有'}《开始》`, go === has, String(go));
    await ctx.close();
  }
}

// ── 17. 小红书：三步 ─────────────────────────────────────────────────────────────────
if (want(17)) {
  ensurePreview();
  const here = dirname(fileURLToPath(import.meta.url));
  const PAGE = pathToFileURL(join(here, '..', 'xhs', 'preview.html')).href;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE);
  // 第一次打开直接落进那局小球（firstScreen）；不打到结算就退出来，看得到第 1 步。
  await p.waitForSelector('#startOverlay, .app--game', { timeout: 40000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => history.back());
  await p.waitForTimeout(800);
  if (!(await p.$('.home-page'))) {
    await p.goto(PAGE);
    await p.waitForTimeout(1500);
  }
  const xs = (q) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.getAttribute('aria-label') ?? ''), q);
  const onMenu = !!(await p.$('.home-page'));
  if (onMenu) {
    check('17 小红书第 1 步：只有小球＋《我会玩》', (await xs('#xhsGrid .home-icon-btn')).length === 1 && !!(await p.$('.know-how-btn')), (await xs('#xhsGrid .home-icon-btn')).join());
  } else {
    check('17（尺子）小红书退出头一局之后回到主菜单', false);
  }
  // 小球打到结算 → 第 2 步。
  await p.goto(PAGE);
  await p.waitForSelector('.app--game', { timeout: 40000 });
  await finishRun(p);
  await p.$eval('#endBackBtn', (e) => e.click());
  await p.waitForSelector('.home-page', { timeout: 15000 });
  await p.waitForTimeout(500);
  const s2 = await p.evaluate(() => ({
    n: document.querySelectorAll('#xhsGrid .home-icon-btn').length,
    glow: [...document.querySelectorAll('#xhsGrid .home-icon-btn--glow')].map((e) => e.getAttribute('aria-label')),
    kh: !!document.querySelector('.know-how-btn'),
    stage: localStorage.getItem('slides.xhs.stage'),
  }));
  check('17 小红书小球走到结算 → 第 2 步：两张、方块亮、《我会玩》在', s2.n === 2 && s2.glow.length === 1 && /方块/.test(s2.glow[0]) && s2.kh && s2.stage === '2', JSON.stringify(s2));
  // 方块打到结算 → 第 3 步。
  await p.$$eval('#xhsGrid .home-icon-btn', (e) => e[0].click());
  await finishRun(p);
  await p.$eval('#endBackBtn', (e) => e.click());
  await p.waitForSelector('.home-page', { timeout: 15000 });
  await p.waitForTimeout(500);
  const s3 = await p.evaluate(() => ({
    n: document.querySelectorAll('#xhsGrid .home-icon-btn').length,
    soon: document.querySelectorAll('#xhsGrid .xhs-soon-tag').length,
    dim: document.querySelectorAll('.home-icon-btn--dim').length,
    kh: !!document.querySelector('.know-how-btn'),
    stage: localStorage.getItem('slides.xhs.stage'),
    web: Object.keys(localStorage).filter((k) => k.startsWith('slides_played_stage') || k.startsWith('slides_played_tier')),
  }));
  check('17 小红书方块走到结算 → 第 3 步：7 张、「进阶入口」牌子在、没有压暗、没有《我会玩》', s3.n === 7 && s3.soon === 4 && s3.dim === 0 && !s3.kh && s3.stage === '3', JSON.stringify(s3));
  check('17 小红书只写 slides.xhs. 那几把，不碰网页的键', s3.web.length === 0, s3.web.join());
  await ctx.close();
}

check('16 一路零脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
