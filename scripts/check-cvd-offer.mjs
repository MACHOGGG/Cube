/**
 * 第一次倒数页上那颗「色盲友好配色」开关（10-18 补充 M-2；要 dev-server + Chromium）。
 *
 *   node scripts/dev-server.mjs 8936 dist
 *   node scripts/check-cvd-offer.mjs http://localhost:8936/ [--only=7,8]
 *
 * 站长定的：第一次看到 4-3-2-1 倒数页时页上出现一颗开关，那一次数完、真正开局之后，以后的倒数页都没有；
 * 老玩家也看一次；小红书首局没有倒数，那一版是第一次见到倒数页时出现。挂着「请把手机转过来」的那一页不摆、
 * 也不记（engine/firstPlay.ts 的 cvdOfferDue，ui/startStage.ts 的 cvdOfferHtml）。
 *
 * 这一道量九件事：
 *   1. 摆得下：六种尺寸 × 四种语言，开关整颗在屏内，不压玩法图、倒数窗、底下那两颗键；竖屏上半屏那张图和
 *      「同一页没有开关」时一个像素都没挪（它放进了倒数那一半，没进 extra）；横屏图、倒数、两颗键还在一行。
 *      老虎机那一页（上半屏是那台机器）不摆、不记——横屏时它本来就排不进一行，见那一节。
 *   2. 拨它立刻生效，倒数页上按《暂停》，面板里那颗也是对的。
 *   3. 倒数中途按《退出》不算见过：下次照样摆。
 *   4. 数完才算见过：之后每一页倒数（含每日挑战）都没有它。
 *   5. 每日挑战先开也一样。
 *   6. 转手机那一页不摆、不记（七色圆球；每日挑战竖着拿手机的七色圆球那天）。
 *   7. 小屋：选手那台倒数页上有它，不压上一局的总分榜，最后一名滚得到，数完记下。
 *   8. 小红书：首局那局小球没有它、也不记；第二局（第一次见到倒数页）有，数完记下。
 *   9. 尺子：换成「看见就记」，第 3 条必须红。
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import * as SC from '../api/_seedcode.js';
import { ensurePreview } from '../xhs/ensurePreview.mjs';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-cvd-offer.mjs http://localhost:8936/');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
/** --only=7,8：只跑这几节（本地调一节用；CI 全跑）。 */
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',').map(Number);
const want = (n) => !ONLY || ONLY.includes(n);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 两个矩形相不相交（贴边不算）。 */
const crosses = (a, b) => Boolean(a && b) && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right - 0.5 && b.left < a.right - 0.5;
/** 竖直方向上有没有重叠（「在同一行」）。 */
const sameRow = (a, b) => Boolean(a && b) && a.top < b.bottom && b.top < a.bottom;
const r0 = (b) => (b ? `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}×${Math.round(b.height)}` : '没有');

/** 一张倒数页上量的那几样（屏幕坐标）。 */
const LOOK = () => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
  };
  const off = document.querySelector('#cvdOfferBtn');
  return {
    offer: r(off),
    checked: off ? off.getAttribute('aria-checked') : null,
    // 上半屏那一格：玩法图（.start-mark），老虎机那一局是那台机器。
    mark: r(document.querySelector('.start-emblem .start-mark, .start-emblem .slot-machine')),
    emblem: r(document.querySelector('.start-emblem')),
    cd: r(document.querySelector('.cd-window')),
    count: r(document.querySelector('.start-count')),
    actions: r(document.querySelector('.start-actions')),
    acts: [...document.querySelectorAll('.start-actions .start-act')].map(r),
    vw: innerWidth,
    vh: innerHeight,
    shape: document.querySelector('.app--game')?.getAttribute('data-shape') ?? null,
  };
};
const offerKey = (p, key = 'slides_cvd_offer') => p.evaluate((k) => localStorage.getItem(k), key);

/** 编号表那几行（api/_seedcode.js）：1 = 基础圆球，4 = 七色圆球。 */
const codeOf = (row, seed) => {
  const c = SC.encodeSeed(SC.DEAL_VERSION, row, seed);
  return c.slice(0, 4) + '-' + c.slice(4);
};

/**
 * 一台设备。`pre` 是开机前写进存储的那几把键（不写 slides_cvd_offer 就是「没见过那颗开关」——这道门
 * 量的就是它，所以除了真要的几把，一概不预设）。
 */
async function device({ w = 390, h = 844, lang = 'zhHans', pre = {}, ruler = false } = {}) {
  const mobile = w < 800 || h < 500;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(([l, kv]) => {
    if (sessionStorage.getItem('cvd_gate') === '1') return;
    sessionStorage.setItem('cvd_gate', '1');
    localStorage.setItem('slides_lang', l);
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, [lang, pre]);
  if (ruler) {
    // 尺子（第 9 条）：把「数完才记」换成「看见就记」——开关一挂上 DOM 就写下记号。这就是把 gameShell
    // 里那一句 markCvdOfferDone() 挪到搭页面时的效果，不用另出一个包。
    await ctx.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('#cvdOfferBtn')) localStorage.setItem('slides_cvd_offer', '1');
      }).observe(document, { childList: true, subtree: true });
    });
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await home(p);
  return { ctx, p };
}
async function home(p) {
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await p.waitForTimeout(300);
}
/** 主菜单上点一张玩法卡（第一张是方块；跳过最上面那张《每日挑战》）。 */
async function openCard(p, idx = 0) {
  await p.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els, i) => els[i].click(), idx);
  await p.waitForSelector('#startOverlay.show #startCount', { timeout: 15000 });
  await p.waitForTimeout(250);
}
async function openByLabel(p, re) {
  const ok = await p.$$eval('.home-icon-btn', (els, src) => {
    const b = els.find((e) => new RegExp(src).test(e.getAttribute('aria-label') || ''));
    b?.click();
    return !!b;
  }, re.source);
  if (!ok) return false;
  await p.waitForSelector('#startOverlay.show #startCount', { timeout: 15000 });
  await p.waitForTimeout(250);
  return true;
}
/** 等这一页倒数数完、棋盘摆出来。 */
const waitBoard = (p, ms = 9000) =>
  p.waitForFunction(() => !document.querySelector('#startOverlay.show, .daily-page--count, .mp-countdown-page') &&
      document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0, { timeout: ms })
    .then(() => true).catch(() => false);

const PLAYED = {
  slides_intro_seen: '1', slides_played_square: '1', slides_played_circle: '1', slides_played_finished: '1',
  slides_played_bomb: '1', slides_played_slot: '1', slides_played_flip: '1', slides_played_puzzle: '1',
  slides_played_timed: '1', slides_played_layout: '1',
  slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
};
const GENIUS = JSON.stringify({ active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'CVDCHK' });

// ── 1. 摆得下 ──────────────────────────────────────────────────────────────────────
//
// 清空存储进网页、打开方块（首局教学局）。竖屏四种（电脑那一档也是竖着排的）量「上半屏一个像素都没挪」：
// 同一台设备先记一次「已经见过」量一遍，再删掉那把键量一遍——开关是搭页面那一刻读的。
const SIZES = [[390, 844], [360, 640], [320, 568], [1440, 900], [640, 360], [568, 320]];
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
const landscape = (w, h) => w > h && h <= 560;
if (want(1)) for (const [w, h] of SIZES) {
  for (const lang of LANGS) {
    const tag = `${w}×${h} ${lang}`;
    const { ctx, p } = await device({ w, h, lang });
    await p.evaluate(() => localStorage.setItem('slides_cvd_offer', '1'));
    await openCard(p);
    const base = await p.evaluate(LOOK);
    await home(p);
    await p.evaluate(() => localStorage.removeItem('slides_cvd_offer'));
    await openCard(p);
    const m = await p.evaluate(LOOK);
    await ctx.close();
    if (lang === 'zhHans') {
      check(`${tag}：（尺子）没见过的那一页有开关、见过的那一页没有，开的是方块`,
        !base.offer && !!m.offer && m.shape === 'square', `开的是 ${m.shape}`);
    }
    if (!m.offer) { check(`${tag}：倒数页上有那颗开关`, false); continue; }
    check(`${tag}：开关是关着的（aria-checked="false"）`, m.checked === 'false', String(m.checked));
    const inView = m.offer.top >= -0.5 && m.offer.left >= -0.5 && m.offer.bottom <= m.vh + 0.5 && m.offer.right <= m.vw + 0.5;
    const hits = [['玩法图', m.mark], ['倒数窗', m.cd], ...m.acts.map((a, i) => [`第 ${i + 1} 颗键`, a])].filter(([, b]) => crosses(m.offer, b)).map(([n]) => n);
    check(`${tag}：开关整颗在屏内，不压玩法图、倒数窗、底下的键`, inView && hits.length === 0,
      `开关 ${r0(m.offer)} / 屏 ${m.vw}×${m.vh}${hits.length ? ' · 压着 ' + hits.join('、') : ''}`);
    if (!landscape(w, h)) {
      const same = ['top', 'left', 'width', 'height'].every((k) => Math.abs(base.mark[k] - m.mark[k]) <= 1);
      check(`${tag}：上半屏那张玩法图没挪（和没有开关时差 ≤1px）`, same, `没开关 ${r0(base.mark)} ｜ 有开关 ${r0(m.mark)}`);
    } else {
      const row = sameRow(m.emblem, m.count) && sameRow(m.count, m.actions) && sameRow(m.emblem, m.actions) &&
        m.emblem.right <= m.count.left + 0.5 && m.count.right <= m.actions.left + 0.5;
      check(`${tag}：横屏图、倒数（连同开关）、两颗键在一行`, row,
        `图 ${r0(m.emblem)} · 倒数 ${r0(m.count)} · 键 ${r0(m.actions)}`);
    }
  }
}

// 老虎机那一页（上半屏是那台机器）：不摆、不记，留到下一个倒数页（gameShell.ts 的 cvdOffered）。
//
// 方案原先要在这一页横屏两种尺寸上量开关排不排得进一行，排不进就停下回报。量过（10-18）：这一页手机横屏时
// 本来就排不进一行——机器比玩法图宽一截，《退出》一直折在第二行；再挂一颗开关，568×320 上倒数那一格也折
// 下去、开关落在屏幕外（y 360 / 屏高 320）、《退出》露出一半。所以这一页不摆。这一节守的是「真的没摆、数
// 完也没记、下一页照样摆」，并把这一页没有开关时的摆位打出来备查。
if (want(1)) for (const [w, h] of [[640, 360], [568, 320]]) {
  const { ctx, p } = await device({ w, h, pre: { ...PLAYED, slides_genius: GENIUS } });
  await p.click('#navProfile');
  await p.waitForSelector('#randomRow', { timeout: 10000 });
  await p.click('#randomRow');
  await p.waitForSelector('#slotGo', { timeout: 8000 });
  await p.click('#slotGo');
  await p.waitForSelector('.slot-pick-opt', { timeout: 8000 });
  await p.click('.slot-pick-opt[data-family="square"]');
  await p.waitForSelector('#startOverlay .slot-machine', { timeout: 8000 });
  await p.waitForTimeout(300);
  const m = await p.evaluate(LOOK);
  const tag = `老虎机 ${w}×${h}`;
  check(`${tag}：上半屏是那台机器的这一页没有开关`, !m.offer,
    `机器 ${r0(m.emblem)} · 倒数 ${r0(m.count)} · 键 ${r0(m.actions)}`);
  const began = await waitBoard(p, 15000);
  const key = await offerKey(p);
  check(`${tag}：数完开了局，记号没写`, began && key === null, `开局 ${began} · 记号 ${key}`);
  await home(p);
  await openCard(p);
  check(`${tag}：接着开方块，开关出现了`, !!(await p.$('#cvdOfferBtn')));
  await ctx.close();
}

// ── 2. 拨它：立刻生效；倒数页上按《暂停》，面板里那颗也对 ──────────────────────────
if (want(2)) {
  const { ctx, p } = await device();
  await openCard(p);
  await p.click('#cvdOfferBtn');
  await p.waitForTimeout(150);
  const now = await p.evaluate(() => ({
    cvd: document.documentElement.getAttribute('data-cvd'),
    stored: localStorage.getItem('slides_colorblind'),
    checked: document.querySelector('#cvdOfferBtn')?.getAttribute('aria-checked'),
  }));
  check('倒数时拨它：<html> 当场 data-cvd="1"、存下 slides_colorblind=1、它自己 aria-checked="true"',
    now.cvd === '1' && now.stored === '1' && now.checked === 'true', JSON.stringify(now));
  await p.click('#startPauseBtn');
  await p.waitForSelector('#pauseOverlay.show', { timeout: 5000 });
  const inPanel = await p.$eval('#cvdBtn', (e) => e.getAttribute('aria-checked'));
  check('再按倒数页的《暂停》：面板里那颗色盲开关也是开着的', inPanel === 'true', String(inPanel));
  await ctx.close();
}

// ── 3. 倒数中途按《退出》：不算见过，下次照样摆（第 9 条的尺子量的就是这一条）─────────
async function exitKeepsOffer(ruler) {
  const { ctx, p } = await device({ ruler });
  await openCard(p);
  const had = !!(await p.$('#cvdOfferBtn'));
  await p.click('#startBackBtn');
  await p.waitForSelector('.home-icon-btn', { timeout: 10000 });
  await p.waitForTimeout(300);
  const key = await offerKey(p);
  await openCard(p);
  const again = !!(await p.$('#cvdOfferBtn'));
  await ctx.close();
  return { had, key, again };
}
if (want(3)) {
  const r = await exitKeepsOffer(false);
  check('倒数中途按《退出》：记号没写（slides_cvd_offer 还是空的）', r.had && r.key === null, JSON.stringify(r));
  check('回主菜单再开一局：开关还在', r.again, JSON.stringify(r));
}

// ── 4. 数完才算见过：之后每一页倒数（含每日挑战）都没有它 ──────────────────────────
if (want(4)) {
  const { ctx, p } = await device({ pre: PLAYED });
  await openCard(p);
  const had = !!(await p.$('#cvdOfferBtn'));
  const began = await waitBoard(p);
  const key = await offerKey(p);
  check('让倒数数完：开了局，记号写下（slides_cvd_offer === "1"）', had && began && key === '1', `开局 ${began} · 记号 ${key}`);
  const seen = [];
  for (const idx of [0, 1]) {
    await home(p);
    await openCard(p, idx);
    seen.push(!!(await p.$('#cvdOfferBtn')));
  }
  await home(p);
  await p.click('.home-icon-btn--daily');
  await p.waitForSelector('#dailyPlay', { timeout: 10000 });
  await p.click('#dailyPlay');
  await p.waitForSelector('.daily-page--count', { timeout: 5000 });
  seen.push(!!(await p.$('#cvdOfferBtn')));
  await home(p);
  await p.click('.home-icon-btn--daily');
  await p.waitForSelector('#seedInput', { timeout: 10000 });
  await p.fill('#seedInput', codeOf(1, 777));
  await p.click('#seedGo');
  await p.waitForSelector('.daily-page--count', { timeout: 5000 });
  seen.push(!!(await p.$('#cvdOfferBtn')));
  await ctx.close();
  check('之后再开方块、小球、今日挑战、输代号那一局：倒数页上都没有开关', seen.every((x) => !x), JSON.stringify(seen));
}

// ── 5. 每日挑战先开：倒数页有开关，数完记下 ─────────────────────────────────────────
// 电脑那一档（鼠标）：不会撞上「七色圆球那天竖着拿手机」那一页，今天是哪一副都一样量。
if (want(5)) {
  const { ctx, p } = await device({ w: 1280, h: 860, pre: PLAYED });
  await p.click('.home-icon-btn--daily');
  await p.waitForSelector('#dailyPlay', { timeout: 10000 });
  await p.click('#dailyPlay');
  await p.waitForSelector('.daily-page--count', { timeout: 5000 });
  await p.waitForTimeout(200);
  const m = await p.evaluate(LOOK);
  const hits = [['图', m.mark], ['倒数窗', m.cd], ...m.acts.map((a, i) => [`第 ${i + 1} 颗键`, a])].filter(([, b]) => crosses(m.offer, b)).map(([n]) => n);
  check('先开每日挑战：倒数页上有开关，不压图、倒数窗、《退出》', !!m.offer && hits.length === 0,
    `开关 ${r0(m.offer)}${hits.length ? ' · 压着 ' + hits.join('、') : ''}`);
  await p.click('#cvdOfferBtn');
  await p.waitForTimeout(150);
  const flipped = await p.evaluate(() => ({
    cvd: document.documentElement.getAttribute('data-cvd'),
    checked: document.querySelector('#cvdOfferBtn')?.getAttribute('aria-checked'),
  }));
  check('每日挑战那一页拨它也当场生效', flipped.cvd === '1' && flipped.checked === 'true', JSON.stringify(flipped));
  const began = await waitBoard(p);
  const after = await p.evaluate(() => ({
    key: localStorage.getItem('slides_cvd_offer'),
    cvd: document.documentElement.getAttribute('data-cvd'),
    panel: document.querySelector('#cvdBtn')?.getAttribute('aria-checked'),
  }));
  check('每日挑战数完：开了局、记号写下，棋盘那一层的色盲开关也是开着的',
    began && after.key === '1' && after.cvd === '1' && after.panel === 'true', JSON.stringify({ began, ...after }));
  await ctx.close();
}

// ── 6. 转手机那一页不摆、不记 ───────────────────────────────────────────────────────
if (want(6)) {
  const { ctx, p } = await device({ pre: { ...PLAYED, slides_genius: GENIUS } });
  const opened = await openByLabel(p, /^菱形小球/);
  const m = opened ? await p.evaluate(LOOK) : null;
  const hint = opened && !!(await p.$('#startOverlay .rotate-hint'));
  check('七色圆球（竖屏 390×844）：倒数页底下挂着「把手机转过来」、没有开关',
    opened && m.shape === 'circleSeven' && hint && !m.offer, opened ? `开的是 ${m.shape} · 提示 ${hint} · 开关 ${!!m.offer}` : '没找到那张卡');
  const began = opened && (await waitBoard(p, 12000));
  check('七色圆球数完开了局，记号没写', began && (await offerKey(p)) === null, `开局 ${began} · 记号 ${await offerKey(p)}`);
  // 每日挑战竖着拿手机的七色圆球那一天：那一句露着，同样不摆。
  await home(p);
  await p.click('.home-icon-btn--daily');
  await p.waitForSelector('#seedInput', { timeout: 10000 });
  await p.fill('#seedInput', codeOf(4, 424242));
  await p.click('#seedGo');
  await p.waitForSelector('.daily-page--count', { timeout: 5000 });
  await p.waitForTimeout(200);
  const daily = await p.evaluate(() => ({
    turn: !document.querySelector('#dailyTurn')?.hidden,
    offer: !!document.querySelector('#cvdOfferBtn'),
  }));
  check('输代号开七色圆球、竖着拿手机：「请横屏」露着、没有开关', daily.turn && !daily.offer, JSON.stringify(daily));
  const dailyBegan = await waitBoard(p, 12000);
  check('那一局数完，记号还是没写', dailyBegan && (await offerKey(p)) === null, `开局 ${dailyBegan} · 记号 ${await offerKey(p)}`);
  await home(p);
  await openCard(p);
  check('接着开方块：开关出现了', !!(await p.$('#cvdOfferBtn')));
  await ctx.close();
}

// ── 7. 小屋：选手那台倒数页上有它，不压总分榜，数完记下 ────────────────────────────
//
// 屋主在真页面上开屋（兑 dev-server 自己种的 TESTMONTH），两名选手打接口坐进来（同源 fetch）。第一局整局走
// 接口：开局、三人交卷——要的是第二局倒数页上那张「上一局的总分榜」（第一局没有总分，那张榜不摆）。第一局收
// 掉之后，两名选手各开一台真页面（390×844、844×390）凭座位回到屋里，存储里除了座位、语言、教学看过、打过两
// 张基础卡，什么都没有——就是「没见过那颗开关的人」。屋主从接口开第二局。
if (want(7)) {
  const hctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const hp = await hctx.newPage();
  hp.on('pageerror', (e) => errs.push(e.message));
  await hp.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); },
    { slides_lang: 'zhHans', slides_cvd_offer: '1', ...PLAYED });
  await hp.goto(BASE, { waitUntil: 'load' });
  await hp.waitForSelector('#navProfile', { timeout: 20000 });
  const granted = await hp.evaluate(async () => {
    const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
    if (r.active) {
      localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
    }
    return r.active === true;
  });
  check('（尺子）屋主兑码开通', granted);
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
  const host = await hp.evaluate(() => JSON.parse(localStorage.getItem('slides_mp_seat') || '{}'));
  const seats = [];
  for (const name of ['乙', '丙']) {
    const r = await api({ action: 'join', code, name, seen: ['square', 'circle', 'triangle'] });
    if (r.json?.playerToken) seats.push({ playerId: r.json.playerId, playerToken: r.json.playerToken });
  }
  check('（尺子）两名选手坐进来了', seats.length === 2, `${seats.length} 名`);
  const hostKey = { playerId: host.playerId, playerToken: host.playerToken };
  const s1 = await api({ action: 'start', code, ...hostKey, mode: 'square' });
  check('（尺子）第一局开起来了', s1.status === 200, String(s1.status));
  // 等过了开赛那一刻再交卷：倒数还没数完就交，服务器那一格记成 0 分（这一局也收不掉）。
  const startAt = Number(s1.json?.startAt ?? s1.json?.state?.startAt) || Date.now() + 6000;
  await hp.waitForTimeout(Math.max(0, startAt - Date.now()) + 1500);
  for (const [i, k] of [hostKey, ...seats].entries()) {
    await api({ action: 'score', code, ...k, score: 40 + i * 13, finished: true, seconds: 30 + i, round: 1 });
  }
  const guests = [];
  for (const [i, size] of [[390, 844], [844, 390]].entries()) {
    // 竖着进小屋（横屏那一档的主菜单底排没有《个人主页》那颗键），进了屋再按要量的尺寸摆——等于进屋之后
    // 把手机转过来。
    const gctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const g = await gctx.newPage();
    g.on('pageerror', (e) => errs.push(e.message));
    await g.addInitScript(([c, seat]) => {
      if (sessionStorage.getItem('cvd_gate') === '1') return;
      sessionStorage.setItem('cvd_gate', '1');
      for (const [k, v] of Object.entries({
        slides_lang: 'zhHans', slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
        slides_played_square: '1', slides_played_circle: '1',
      })) localStorage.setItem(k, v);
      localStorage.setItem('slides_mp_seat', JSON.stringify({ code: c, playerId: seat.playerId, playerToken: seat.playerToken, at: Date.now() }));
    }, [code, seats[i]]);
    await g.goto(BASE, { waitUntil: 'load' });
    // 存着座位的设备一打开就回到屋里（main.ts 那句 `resume && currentRoom()`），不经过主菜单。
    await g.waitForSelector('.mp-code', { timeout: 20000 });
    await g.setViewportSize({ width: size[0], height: size[1] });
    guests.push({ size, gctx, g });
  }
  await guests[0].g.waitForTimeout(1500);
  const s2 = await api({ action: 'start', code, ...hostKey, mode: 'square' });
  check('（尺子）第二局开起来了', s2.status === 200, String(s2.status));
  const measured = await Promise.all(guests.map(async ({ size, g }) => {
    const up = await g.waitForSelector('.mp-countdown-page .mp-cd-row', { timeout: 20000 }).then(() => true).catch(() => false);
    if (!up) return { size, m: null };
    await g.waitForTimeout(150);
    // 小屋这一屏是一整页往下排的（手机横屏时倒数窗和上一局的总分榜本来就在首屏以下，要滚——没有开关时也
    // 这样），所以量的是方案那两条：开关不和总分榜、玩法图、倒数窗相交；开关和最后一名都滚得到。
    const m = await g.evaluate(`(() => {
      const look = (${LOOK})();
      const board = document.querySelector('.mp-cd-board');
      const rows = board.querySelectorAll('.mp-cd-row');
      const rect = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
      const shown = (e) => { e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return b.top >= -0.5 && b.bottom <= innerHeight + 0.5 && b.left >= -0.5 && b.right <= innerWidth + 0.5; };
      const off = document.querySelector('#cvdOfferBtn');
      const offerReach = !!off && shown(off);
      const last = rows[rows.length - 1];
      const lastReach = shown(last);
      const lb = last.getBoundingClientRect();
      const bb = board.getBoundingClientRect();
      const lastIn = lastReach && lb.top >= bb.top - 1 && lb.bottom <= bb.bottom + 1;
      scrollTo(0, 0);
      return { ...look, board: rect(board), rows: rows.length, offerReach, lastIn };
    })()`);
    return { size, m };
  }));
  for (const { size: [w, h], m } of measured) {
    const tag = `小屋选手 ${w}×${h}`;
    check(`${tag}：（尺子）倒数页上摆出了上一局的总分榜`, !!m && m.rows === 3, m ? `${m.rows} 行` : '没等到');
    if (!m) continue;
    check(`${tag}：倒数页上有那颗开关`, !!m.offer && m.checked === 'false', String(m.checked));
    if (!m.offer) continue;
    const hits = [['总分榜', m.board], ['玩法图', m.mark], ['倒数窗', m.cd]].filter(([, b]) => crosses(m.offer, b)).map(([n]) => n);
    check(`${tag}：开关不压总分榜、玩法图、倒数窗，滚得到、整颗露得出来`, m.offerReach && hits.length === 0,
      `开关 ${r0(m.offer)} · 榜 ${r0(m.board)}${hits.length ? ' · 压着 ' + hits.join('、') : ''}`);
    check(`${tag}：滚到底，最后一名整行露得出来`, m.lastIn);
  }
  const marks = await Promise.all(guests.map(async ({ g }) => {
    const began = await waitBoard(g, 15000);
    return { began, key: await offerKey(g) };
  }));
  check('小屋两台选手：数完开了局，各自写下记号', marks.every((x) => x.began && x.key === '1'), JSON.stringify(marks));
  for (const { gctx } of guests) await gctx.close();
  await hctx.close();
}

// ── 8. 小红书：首局那局小球没有它、也不记；第二局有，数完记下 ──────────────────────
if (want(8)) {
  await ensurePreview();
  const PAGE = pathToFileURL(join(here, '..', 'xhs', 'preview.html')).href;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE);
  // 首屏：直接落进那局小球（xhs/src/main.ts 的 firstScreen，noCountdown）。
  const first = await p.waitForFunction(() => document.querySelectorAll('#boardWrap .ball').length > 0, { timeout: 30000 })
    .then(() => true).catch(() => false);
  const firstLook = await p.evaluate(() => ({
    offer: !!document.querySelector('#cvdOfferBtn'),
    key: localStorage.getItem('slides.xhs.cvdOffer'),
    web: localStorage.getItem('slides_cvd_offer'),
  }));
  check('小红书首屏那局小球：落进棋盘，没有开关，也没写 slides.xhs.cvdOffer',
    first && !firstLook.offer && firstLook.key === null && firstLook.web === null, JSON.stringify({ first, ...firstLook }));
  // 回主菜单（第二次打开就是主菜单），开第二局：第一次见到倒数页。
  await p.goto(PAGE);
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  await p.waitForTimeout(400);
  // 跳过最上面那张《每日挑战》：第一张玩法卡是方块。
  await p.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
  const up = await p.waitForSelector('#startOverlay.show #startCount', { timeout: 15000 }).then(() => true).catch(() => false);
  const second = up ? await p.evaluate(LOOK) : null;
  check('小红书第二局：倒数页上有那颗开关，整颗在屏内、不压图和倒数窗',
    !!second?.offer && !crosses(second.offer, second.mark) && !crosses(second.offer, second.cd) &&
      second.offer.bottom <= second.vh + 0.5 && second.offer.top >= -0.5,
    second ? `开关 ${r0(second.offer)}` : '没等到倒数页');
  const began = up && (await waitBoard(p, 12000));
  const key = await offerKey(p, 'slides.xhs.cvdOffer');
  check('小红书第二局数完：记号写在 slides.xhs.cvdOffer 那一把', began && key === '1', `开局 ${began} · 记号 ${key}`);
  await ctx.close();
}

// ── 9. 尺子：换成「看见就记」，第 3 条必须红 ─────────────────────────────────────────
if (want(9)) {
  const r = await exitKeepsOffer(true);
  check('（尺子）换成「看见就记」：第 3 条那两项红了（按《退出》之后记号已经写下、再开没有开关）',
    r.had && (r.key === '1' || !r.again), JSON.stringify(r));
}

check('页面没有报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
