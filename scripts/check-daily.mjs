/**
 * 主菜单那张《每日挑战》（第 19 推）：七天的图和字、北京零点换日、电脑端那一排、首玩期。
 *
 *   node scripts/dev-server.mjs 8974 dist &
 *   node scripts/check-daily.mjs http://localhost:8974/
 *
 * 方案的门：「北京时间 23:59:59→00:00:00 准确换日（种子、数字、颜色同时换）」「7 天星期与配色
 * 对应」，电脑宽屏「1440×900 下居中、各行等距、一屏放得下」（10-09 补充方案 7-12 起它并进基础那一排的
 * 最左边，⑥ 照新口径量五种分辨率，顺带量 7-17 的炸弹卡）。「首玩期间也显示」那一条 10-08 方
 * 案 3-D-1 改了（玩家拍板「完成任意一局（含教程局）后出现」），⑤ 量新的那一条。手机鱼眼那
 * 一站（默认聚焦、居中、同尺寸、等距、导轨、热区）在 check-mode-axis 的第 10 节。
 *
 * ── 钟是假的 ──────────────────────────────────────────────────────────────
 * 用 Playwright 的 page.clock 把页面的钟拨到想要的那一刻。网页端的「今天」按服务器的钟算
 * （engine/dailyClock.ts 会对首页发一个 HEAD，读回包头的 Date）——门里把那个 HEAD 拦掉，页面
 * 于是用（假的）本机钟，和量「换日」要的一样。不拦的话，dev-server 回的是真时间，假钟白拨。
 *
 * ── 七天的颜色怎么对 ──────────────────────────────────────────────────────
 * 每一天该是哪个颜色，从那一天的图标文件里读（src/assets/icons/daily-N.svg 里那一串 display-p3），
 * 用公开的那两段矩阵换成 sRGB——和 customIcons.ts 的 sRGBOnly 同一个算法——再和页面上画出来的
 * 点比。这样量的是「周一画的真是 daily-1 那个文件」，而不是「周一是个红色」。奶白那天（周六）
 * 点是白的，所以字用 --card-gray、描边用白色；别的六天白字、rgba(0,0,0,.25) 的描边。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import * as SC from '../api/_seedcode.js';

const BASE = process.argv[2] || 'http://localhost:8974/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];

// ---- 每一天该是什么颜色：从文件里读 ------------------------------------------
const P3_TO_SRGB = [
  [1.2249401763, -0.2249401763, 0.0],
  [-0.0420569547, 1.0420569547, 0.0],
  [-0.0196375546, -0.0786360456, 1.0982736001],
];
function p3ToRgb(r, g, b) {
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const lin = [toLin(r), toLin(g), toLin(b)];
  const v = P3_TO_SRGB.map((row) => Math.round(Math.min(1, Math.max(0, toGam(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))) * 255));
  return `rgb(${v[0]}, ${v[1]}, ${v[2]})`;
}
/** 那个文件里画点的颜色（16 个点用的那一种；底板那一种是纸色，出现一次）。 */
function dotColorOf(weekday) {
  const svg = readFileSync(new URL(`../src/assets/icons/daily-${weekday}.svg`, import.meta.url), 'utf8');
  const counts = new Map();
  for (const m of svg.matchAll(/fill="color\(display-p3 ([\d.]+) ([\d.]+) ([\d.]+)\)"/g)) {
    const k = p3ToRgb(+m[1], +m[2], +m[3]);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
const WANT_DOT = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((w) => [w, dotColorOf(w)]));
check('（尺子）七个文件各读出一个点的颜色，而且七个两两不同', new Set(Object.values(WANT_DOT)).size === 7, JSON.stringify(WANT_DOT));

/**
 * 一台手机，钟拨到 `at`，HEAD 拦掉；`played` 决定是不是首玩期——打过的人也**打完过一局**
 * （slides_played_finished，10-08 方案 3-D-1 起《每日挑战》只给打完过一局的人摆）。`wait` 为假就
 * 不等那张卡（⑤ 量的正是「它不在」）。
 */
async function pageAt(at, { width = 390, height = 844, mobile = true, played = true, lang = 'zhHans', wait = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(
    ({ played, lang }) => {
      if (sessionStorage.getItem('daily_gate') === '1') return;
      sessionStorage.setItem('daily_gate', '1');
      localStorage.clear();
      localStorage.setItem('slides_lang', lang);
      localStorage.setItem('slides_intro_seen', '1');
      if (played) {
        localStorage.setItem('slides_played_square', '1');
        localStorage.setItem('slides_played_circle', '1');
        localStorage.setItem('slides_played_finished', '1');
      }
    },
    { played, lang },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/*', (route) => (route.request().method() === 'HEAD' ? route.abort() : route.continue()));
  await page.clock.install({ time: at });
  await page.goto(BASE, { waitUntil: 'load' });
  if (wait) await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  else await page.waitForSelector('.mode-axis .home-icon-btn, .home-row .home-icon-btn', { timeout: 20000 });
  return { ctx, page };
}

/** 那张卡此刻画的是什么。 */
const cardNow = (page, sel = '.home-icon-btn--daily') =>
  page.evaluate((sel) => {
    const btn = document.querySelector(sel);
    const svg = btn?.querySelector('svg[data-daily-weekday]');
    const text = svg?.querySelector('text.daily-date');
    const counts = new Map();
    for (const el of svg ? svg.querySelectorAll('ellipse, circle') : []) {
      const f = getComputedStyle(el).fill;
      counts.set(f, (counts.get(f) || 0) + 1);
    }
    const dot = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const tb = text?.getBoundingClientRect();
    return {
      aria: btn?.getAttribute('aria-label') ?? '',
      tag: btn?.querySelector('.home-icon-tag')?.textContent?.trim() ?? '',
      weekday: Number(svg?.getAttribute('data-daily-weekday')),
      day: Number(svg?.getAttribute('data-daily-day')),
      date: text?.textContent?.trim() ?? '',
      fill: text ? getComputedStyle(text).fill : '',
      stroke: text ? getComputedStyle(text).stroke : '',
      font: text ? getComputedStyle(text).fontFamily : '',
      weight: text ? getComputedStyle(text).fontWeight : '',
      paint: text ? getComputedStyle(text).paintOrder : '',
      visible: !!tb && tb.width > 2 && tb.height > 2,
      dot,
      locked: btn?.classList.contains('home-icon-btn--locked') ?? null,
    };
  }, sel);

const NOON = (day) => SC.dayStartOf(day) + 12 * 3600e3;
const GRAY = 'rgb(76, 76, 76)';
const WHITE = 'rgb(255, 255, 255)';

// ── ① 七天：星期几 → 那个文件、那个颜色，日期数字、读屏 ────────────────────
{
  const monday = SC.dayIndexOf(Date.UTC(2026, 9, 5, 4)); // 北京 2026-10-05，周一
  for (let k = 0; k < 7; k++) {
    const day = monday + k;
    const want = k + 1;
    const { ctx, page } = await pageAt(NOON(day));
    const c = await cardNow(page);
    const dateNum = 5 + k;
    check(`① 10 月 ${dateNum} 日：画的是星期 ${want} 那一张（daily-${want}）`, c.weekday === want && c.day === day, `${c.weekday} / ${c.day}`);
    check(`① 10 月 ${dateNum} 日：点是 daily-${want}.svg 里那个颜色`, c.dot === WANT_DOT[want], `${c.dot} / ${WANT_DOT[want]}`);
    check(`① 10 月 ${dateNum} 日：日期数字 ${dateNum}、看得见`, c.date === String(dateNum) && c.visible, `${c.date} ${c.visible}`);
    const cream = want === 6;
    check(
      `① 10 月 ${dateNum} 日：${cream ? '奶白那天深灰字、白描边' : '白字、rgba(0,0,0,.25) 描边'}`,
      cream ? c.fill === GRAY && c.stroke === WHITE : c.fill === WHITE && /rgba\(0, 0, 0, 0\.25\)/.test(c.stroke),
      `${c.fill} / ${c.stroke}`,
    );
    check(`① 10 月 ${dateNum} 日：Fraunces 600、描边垫在字下面（paint-order: stroke）`, /Fraunces/.test(c.font) && c.weight === '600' && /^stroke/.test(c.paint), `${c.font} ${c.weight} ${c.paint}`);
    check(`① 10 月 ${dateNum} 日：读屏念「每日挑战，10 月 ${dateNum} 日」，卡底下写「每日挑战」`, c.aria === `每日挑战，10 月 ${dateNum} 日` && c.tag === '每日挑战', `${c.aria} / ${c.tag}`);
    await ctx.close();
  }
}

// ── ② 英文那一句（月份念名字）──────────────────────────────────────────────
{
  const { ctx, page } = await pageAt(NOON(SC.dayIndexOf(Date.UTC(2026, 9, 3, 4))), { lang: 'en' });
  const c = await cardNow(page);
  check('② 英文读屏：「Daily Challenge, October 3」，卡底下「Daily Challenge」', c.aria === 'Daily Challenge, October 3' && c.tag === 'Daily Challenge', `${c.aria} / ${c.tag}`);
  await ctx.close();
}

// ── ③ 北京零点换日：图、数字、颜色、种子一起换 ─────────────────────────────
{
  // 北京 2026-10-03（周六，奶白）23:59:5x → 10-04（周日，绿）。
  const sat = SC.dayIndexOf(Date.UTC(2026, 9, 3, 4));
  const midnight = SC.dayStartOf(sat + 1);
  const { ctx, page } = await pageAt(midnight - 8000);
  await page.clock.pauseAt(midnight - 1000);
  const before = await cardNow(page);
  check('③ 23:59:59：还是 10 月 3 日（周六、奶白、深灰字）', before.date === '3' && before.weekday === 6 && before.fill === GRAY && before.dot === WANT_DOT[6], JSON.stringify(before));
  await page.clock.runFor(1500);
  const after = await cardNow(page);
  check('③ 00:00:00 过一拍：图、数字、颜色一起换成 10 月 4 日（周日、绿、白字）', after.date === '4' && after.weekday === 7 && after.fill === WHITE && after.dot === WANT_DOT[7], JSON.stringify(after));
  check('③ 读屏那一句也跟着换', after.aria === '每日挑战，10 月 4 日', after.aria);
  // 种子也换了：点进去按《今日挑战》，开的是 10 月 4 日那一副。前后两天的玩法在轮换表里一定不
  // 一样（check-seed-code ⑤ 钉着「挨着的两天不是同一族棋盘」），所以按棋盘 id 就分得开。
  // 钟从这儿起照常走（暂停着的话，换页那 120ms 的淡出永远走不完）。
  await page.clock.resume();
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#dailyPlay', { timeout: 8000 });
  await page.click('#dailyPlay');
  const shape = await page
    .waitForFunction(() => document.querySelector('.app--game')?.getAttribute('data-shape') || '', { timeout: 12000 })
    .then((h) => h.jsonValue())
    .catch(() => '');
  const want = SC.VARIANTS[SC.dailyVariant(sat + 1)].board;
  const was = SC.VARIANTS[SC.dailyVariant(sat)].board;
  check(`③ 换日之后按《今日挑战》：开的是 10 月 4 日那一副（${want}，不是 3 日那副 ${was}）`, shape === want && want !== was, String(shape));
  await ctx.close();
}

// ── ④ 切回前台时重算 ────────────────────────────────────────────────────────
{
  // 定时器在后台会被压住、锁屏会停：切回前台那一下现算，不信定时器。这儿让钟**跳**过零点（不
  // 走定时器），再发一次 visibilitychange。
  const sat = SC.dayIndexOf(Date.UTC(2026, 9, 3, 4));
  const { ctx, page } = await pageAt(SC.dayStartOf(sat + 1) - 5 * 60e3);
  await page.clock.pauseAt(SC.dayStartOf(sat + 1) - 4 * 60e3);
  const before = await cardNow(page);
  await page.clock.setFixedTime(SC.dayStartOf(sat + 1) + 3 * 3600e3);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(200);
  const after = await cardNow(page);
  check('④ 钟跳过了零点、切回前台：当场换成第二天', before.date === '3' && after.date === '4' && after.weekday === 7, `${before.date} → ${after.date}`);
  await ctx.close();
}

// ── ⑤ 一局都还没打完的人没有这张卡；打完一局（头一局那个带教学条的也算）它才出现 ─────────
//
// 10-08 方案 3-D-1，玩家拍板：「完成任意一局（含教程局）后出现」。从前（第 19 推）这一节量的是
// 「首玩期间也亮着、点得开」——新人打开菜单第一眼看见的是一张「今天这一局」，可他连规矩都还没
// 见过。现在：
//   a. 新人（首玩期、一局没打完）：手机轴上和电脑那一排里都没有它；轴的第一站是两张基础卡；
//   b. 同一个人真打一局——点开方块、暂停、《结束游戏》，结算页出来，按《首页》回去——它出现在最
//      上面（轴的第一站，单独一张）；
//   c. 改版之前打完过的人（本地只有结算页那颗光的钥匙 slides_played_endcard）照样有它；
//   d. 存不进 localStorage（无痕窗口）的人照样有它——宁可多摆，不要永远不摆。
{
  const t = NOON(SC.dayIndexOf(Date.now()));
  // a. 手机：首玩期
  const { ctx, page } = await pageAt(t, { played: false, wait: false });
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => ({
    daily: document.querySelectorAll('.home-icon-btn--daily').length,
    cards: document.querySelectorAll('.mode-axis > .home-icon-btn').length,
    locked: document.querySelectorAll('.mode-axis > .home-icon-btn--locked').length,
    first: [...document.querySelectorAll('.mode-axis > .home-icon-btn')].slice(0, 2).map((e) => (e.getAttribute('aria-label') || '').split(' ·')[0]),
  }));
  check('⑤a 首玩期（尺子）：轴摆出来了、别的玩法锁着', a.cards > 0 && a.locked > 0, `${a.cards} 张 / 锁着 ${a.locked}`);
  check('⑤a 一局都还没打完：手机轴上没有每日挑战', a.daily === 0, `${a.daily} 张`);
  check('⑤a 轴的头两张是两张基础卡（第一站不再是单独一张）', a.first.join(' ') === '经典方块 经典小球', a.first.join(' / '));
  // b. 真打一局：点开方块、暂停、结束游戏、回首页。
  await page.$$eval('.mode-axis > .home-icon-btn:not(.home-icon-btn--locked)', (els) => els[0].click());
  await page.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await page.$eval('#startBtn', (e) => e.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, null, { timeout: 30000 });
  // 钟是假的：倒数那几拍要它走。
  await page.clock.runFor(5000);
  await page.waitForTimeout(300);
  await page.$eval('#stopBtn', (e) => e.click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.$eval('#pauseFinishBtn', (e) => e.click());
  const ended = await page.waitForSelector('#endOverlay.show', { timeout: 15000 }).then(() => true).catch(() => false);
  check('⑤b（尺子）那一局真的打完了：结算页出来了', ended);
  await page.$eval('#endBackBtn', (e) => e.click());
  const back = await page.waitForSelector('.mode-axis .home-icon-btn--daily', { timeout: 15000 }).then(() => true).catch(() => false);
  const b = await page.evaluate(() => {
    const axisCards = [...document.querySelectorAll('.mode-axis > .home-icon-btn')];
    return { daily: document.querySelectorAll('.home-icon-btn--daily').length, firstIsDaily: axisCards[0]?.classList.contains('home-icon-btn--daily') ?? false };
  });
  check('⑤b 打完一局回到主菜单：每日挑战出现了，在轴的第一站', back && b.daily === 1 && b.firstIsDaily, JSON.stringify(b));
  await ctx.close();
  // a'. 电脑那一排：首玩期也没有它
  {
    const { ctx, page } = await pageAt(t, { played: false, wait: false, width: 1440, height: 900, mobile: false });
    await page.waitForTimeout(400);
    const w = await page.evaluate(() => ({
      daily: document.querySelectorAll('.home-icon-btn--daily').length,
      firstRow: [...(document.querySelector('.home-grid > .home-row')?.children ?? [])].map((e) => (e.getAttribute('aria-label') || '').split(' ·')[0]),
    }));
    check('⑤a 电脑：一局都还没打完，最上面那一排不是每日挑战', w.daily === 0 && w.firstRow.join(' ') === '经典方块 经典小球', JSON.stringify(w));
    await ctx.close();
  }
  // c. 改版之前就打完过的人：只有结算页那颗光的钥匙
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('daily_gate') === '1') return;
      sessionStorage.setItem('daily_gate', '1');
      localStorage.clear();
      localStorage.setItem('slides_lang', 'zhHans');
      localStorage.setItem('slides_intro_seen', '1');
      localStorage.setItem('slides_played_square', '1');
      localStorage.setItem('slides_played_endcard', '1');
    });
    const page = await ctx.newPage();
    await page.route('**/*', (route) => (route.request().method() === 'HEAD' ? route.abort() : route.continue()));
    await page.goto(BASE, { waitUntil: 'load' });
    const has = await page.waitForSelector('.home-icon-btn--daily', { timeout: 15000 }).then(() => true).catch(() => false);
    check('⑤c 改版之前打完过的人（只有 slides_played_endcard）照样有每日挑战', has);
    await ctx.close();
  }
  // d. localStorage 用不了
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      const boom = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
    });
    const page = await ctx.newPage();
    await page.route('**/*', (route) => (route.request().method() === 'HEAD' ? route.abort() : route.continue()));
    await page.goto(BASE, { waitUntil: 'load' });
    const has = await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 }).then(() => true).catch(() => false);
    check('⑤d localStorage 用不了：宁可多摆——每日挑战在', has);
    await ctx.close();
  }
}

// ── ⑤e 首玩锁还在的时候也没有这张卡（10-09 补充方案 6-6）──────────────────────────────
//
// 方案原话：「新手拦截和引导期间（首玩锁生效时），主菜单不渲染今日挑战卡；删掉 menu.ts 的
// dailyBtn.dataset.firstPlayable = '1'。和 3-D-1『完成任意一局后才出现』合并成同一个判定。」
// 两条大多数时候是同一件事，量不一样的那一种人：**打完过一局**（slides_played_finished），可两张
// 基础卡一张都没开过、也没按《我会玩》——比如只在别人的小屋里打完过一局。按 3-D-1 他该有，按 6-6
// 他还在首玩期：没有这张卡，首玩引导也就不会指到它身上（轴上能按的只剩两张基础卡）。尺子：同一个
// 人按了《我会玩》，锁撤了，卡就出来——不然「没有」可能只是这一页根本没画出来。
{
  const t = NOON(SC.dayIndexOf(Date.now()));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('daily_gate') === '1') return;
    sessionStorage.setItem('daily_gate', '1');
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem('slides_played_finished', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/*', (route) => (route.request().method() === 'HEAD' ? route.abort() : route.continue()));
  await page.clock.install({ time: t });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(400);
  const e = await page.evaluate(() => ({
    daily: document.querySelectorAll('.home-icon-btn--daily').length,
    locked: document.querySelectorAll('.mode-axis > .home-icon-btn--locked').length,
    open: [...document.querySelectorAll('.mode-axis > .home-icon-btn:not(.home-icon-btn--locked)')].map((b) => (b.getAttribute('aria-label') || '').split(' ·')[0]),
    knowHow: !!document.querySelector('.know-how-btn'),
  }));
  check('⑤e 首玩锁还在（尺子）：别的玩法锁着、《我会玩》在', e.locked > 0 && e.knowHow, JSON.stringify(e));
  check('⑤e 打完过一局、可首玩锁还在：没有每日挑战', e.daily === 0, `${e.daily} 张`);
  check('⑤e 轴上按得动的只有两张基础卡（首玩引导不会指到别处）', e.open.join(' ') === '经典方块 经典小球', e.open.join(' / '));
  // 尺子：按了《我会玩》，锁撤了，卡就出来。
  await page.evaluate(() => document.querySelector('.know-how-btn').click());
  const after = await page.waitForSelector('.mode-axis .home-icon-btn--daily', { timeout: 8000 }).then(() => true).catch(() => false);
  check('⑤e（尺子）按了《我会玩》锁撤了，每日挑战出来了', after);
  await ctx.close();
}

// ── ⑥ 电脑宽屏：每日挑战在基础那一排的最左边，三张一样大、等距、整排居中；三排一屏放下 ─────
//
// 10-09 补充方案 7-12：每日挑战不再单独占最上面一排（第 19 推那样），并进「经典方块、经典小球」那一排的
// 最左边；图标回到第 19 推之前的大小（--home-card-cap 那道算式改回 (100svh − 356) / 3.11）。方案在五种分
// 辨率上实测过：都是三排、一屏放下，卡片区底边离底排 23–160px。这一节五种都量：
//   · 第一排正好三张，每日挑战在最左，后两张是两副基础棋盘；
//   · 三张一样大（图那一格 ≤0.5px）、两道缝一样宽（≤1px）、整排居中（≤1px）；
//   · 各行等距（≤1px）、不用滚、最后一排压不到底排。
// 同一节顺带量 7-17 的炸弹卡（方案：「放在 check-daily 量三排的那一节旁边」）：卡里是一枚 svg、没有
// .bomb-panel；图那一格是方的（宽高差 ≤2px），和同一排的计时那张宽、高各差 ≤2px。
// 首玩期这一排只有两张基础卡，归 ⑤a。
{
  const SIZES = [[1440, 900], [1920, 1080], [1366, 768], [1280, 800], [1536, 864]];
  for (const [W, H] of SIZES) {
    const { ctx, page } = await pageAt(NOON(SC.dayIndexOf(Date.now())), { width: W, height: H, mobile: false });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.home-grid > .home-row')];
      const first = rows[0];
      const cards = first ? [...first.querySelectorAll(':scope > .home-icon-btn, :scope > .home-bomb-card')] : [];
      const art = (el) => (el.querySelector('.home-icon-art') ?? el).getBoundingClientRect();
      const arts = cards.map(art);
      const boxes = rows.map((r) => r.getBoundingClientRect());
      const nav = document.querySelector('.home-nav-dock, .home-nav')?.getBoundingClientRect();
      const lastBottom = Math.max(...[...document.querySelectorAll('.home-grid .home-icon-btn, .home-grid .home-bomb-card')].map((e) => e.getBoundingClientRect().bottom));
      const bomb = document.querySelector('.home-grid .home-bomb-card');
      const timed = document.querySelector('.home-grid .home-icon-btn--timed');
      const ba = bomb ? art(bomb) : null;
      const ta = timed ? art(timed) : null;
      const bArt = bomb?.querySelector('.home-icon-art');
      return {
        rows: rows.length,
        names: cards.map((e) => (e.getAttribute('aria-label') || '').split(' ·')[0]),
        firstIsDaily: cards[0]?.classList.contains('home-icon-btn--daily') ?? false,
        dailies: document.querySelectorAll('.home-icon-btn--daily').length,
        ws: arts.map((a) => +a.width.toFixed(2)),
        hs: arts.map((a) => +a.height.toFixed(2)),
        cardGaps: cards.slice(1).map((c, i) => +(c.getBoundingClientRect().left - cards[i].getBoundingClientRect().right).toFixed(2)),
        rowMid: cards.length ? (cards[0].getBoundingClientRect().left + cards[cards.length - 1].getBoundingClientRect().right) / 2 : null,
        vwMid: document.documentElement.clientWidth / 2,
        gaps: boxes.slice(1).map((b, i) => +(b.top - boxes[i].bottom).toFixed(2)),
        scroll: document.documentElement.scrollHeight,
        vh: window.innerHeight,
        lastBottom,
        navTop: nav?.top ?? null,
        bomb: bomb ? {
          svgs: bArt ? bArt.querySelectorAll(':scope > svg').length : 0,
          panels: bomb.querySelectorAll('.bomb-panel').length,
          w: ba.width, h: ba.height,
        } : null,
        timed: ta ? { w: ta.width, h: ta.height } : null,
      };
    });
    const tag = `⑥ ${W}×${H}`;
    check(`${tag}：一共三排（每日挑战不再单独占一排）`, m.rows === 3, `${m.rows} 排`);
    check(`${tag}：第一排是 每日挑战 · 经典方块 · 经典小球，每日挑战在最左`,
      m.firstIsDaily && m.dailies === 1 && m.names.length === 3 && m.names[1] === '经典方块' && m.names[2] === '经典小球', m.names.join(' / '));
    check(`${tag}：三张一样大（≤0.5px）`, m.ws.length === 3 && m.ws[0] > 40 && Math.max(...m.ws) - Math.min(...m.ws) <= 0.5 && Math.max(...m.hs) - Math.min(...m.hs) <= 0.5,
      `${m.ws.join(' / ')} × ${m.hs.join(' / ')}`);
    check(`${tag}：等间距（两道缝差 ≤1px）、整排居中（≤1px）`,
      m.cardGaps.length === 2 && Math.abs(m.cardGaps[0] - m.cardGaps[1]) <= 1 && m.rowMid !== null && Math.abs(m.rowMid - m.vwMid) <= 1,
      `缝 ${m.cardGaps.join(' / ')}，中线 ${m.rowMid?.toFixed(2)} / ${m.vwMid}`);
    check(`${tag}：各行等距（排与排之间的缝一样，≤1px）`, m.gaps.length === 2 && Math.max(...m.gaps) - Math.min(...m.gaps) <= 1, m.gaps.join(' / '));
    check(`${tag}：一屏放得下（不用滚，最后一排压不到底排）`, m.scroll <= m.vh && m.navTop !== null && m.lastBottom <= m.navTop,
      `scrollHeight ${m.scroll} / 屏高 ${m.vh}，最后一排底 ${m.lastBottom.toFixed(1)} / 底排顶 ${m.navTop?.toFixed(1)}（余 ${m.navTop !== null ? (m.navTop - m.lastBottom).toFixed(0) : '—'}）`);
    check(`${tag}：卡回到原来那么大（第 19 推之前的算式，宽 ≥ 130）`, m.ws[0] >= 130, `${m.ws[0]}`);
    check(`${tag}：炸弹卡里是一枚 svg，没有 .bomb-panel（7-17）`, !!m.bomb && m.bomb.svgs === 1 && m.bomb.panels === 0, JSON.stringify(m.bomb));
    check(`${tag}：炸弹卡是方的（宽高差 ≤2px），和计时那张宽、高各差 ≤2px`,
      !!m.bomb && !!m.timed && Math.abs(m.bomb.w - m.bomb.h) <= 2 && Math.abs(m.bomb.w - m.timed.w) <= 2 && Math.abs(m.bomb.h - m.timed.h) <= 2,
      `炸弹 ${m.bomb?.w.toFixed(1)}×${m.bomb?.h.toFixed(1)} / 计时 ${m.timed?.w.toFixed(1)}×${m.timed?.h.toFixed(1)}`);
    await ctx.close();
  }
}

// ── ⑦ 挑码那一页的《今日挑战》：高一倍、字号不变（10-08 方案 3-F-3）───────────────
//
// 方案原话：「今日挑战《开始》按钮尺寸 ×2，文字字号不变。」翻的是高：宽已经是这一页内容的最宽
// （.profile-pill--wide 封在 268px，再宽手机上就出屏了）。尺子是**同一颗药丸不带那一条**：把它克
// 隆一份、摘掉 daily-play 这个类和 id，插在同一个父元素里量——同一段字、同一个外层宽度，量出来的
// 就是「没改之前它多高」。顺带量这一页还摆得下：《今日挑战》到那一格种子都在《退出》上面。
for (const [width, height, mobile, label] of [[390, 844, true, '手机 390×844'], [360, 640, true, '手机 360×640'], [1280, 800, false, '电脑 1280×800']]) {
  const { ctx, page } = await pageAt(NOON(SC.dayIndexOf(Date.now())), { width, height, mobile });
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#dailyPlay', { timeout: 8000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const btn = document.querySelector('#dailyPlay');
    const ref = btn.cloneNode(true);
    ref.removeAttribute('id');
    ref.classList.remove('daily-play');
    ref.style.margin = '0 auto';
    btn.parentElement.appendChild(ref);
    const b = btn.getBoundingClientRect();
    const r = ref.getBoundingClientRect();
    const out = {
      h: b.height, w: b.width, refH: r.height, refW: r.width,
      font: getComputedStyle(btn).fontSize, refFont: getComputedStyle(ref).fontSize,
    };
    ref.remove();
    const exit = document.querySelector('#dailyBack')?.getBoundingClientRect();
    const form = document.querySelector('#seedForm')?.getBoundingClientRect();
    return { ...out, top: b.top, bottom: b.bottom, vh: innerHeight, formBottom: form?.bottom ?? null, exitTop: exit?.top ?? null };
  });
  check(`⑦ ${label}：（尺子）同一颗药丸不带那一条量到了高度`, m.refH > 20 && m.refH < 70, `${m.refH.toFixed(1)}px`);
  check(`⑦ ${label}：《今日挑战》的高是它的两倍（±1px）`, Math.abs(m.h - 2 * m.refH) <= 1, `${m.h.toFixed(1)} / 2×${m.refH.toFixed(1)}`);
  check(`⑦ ${label}：字号不变、宽不变`, m.font === m.refFont && Math.abs(m.w - m.refW) <= 0.5, `${m.font} / ${m.refFont}；宽 ${m.w.toFixed(1)} / ${m.refW.toFixed(1)}`);
  check(`⑦ ${label}：这一页还摆得下——整颗在屏里，那一格种子在《退出》上面`,
    m.top >= 0 && m.bottom <= m.vh && m.formBottom !== null && m.exitTop !== null && m.formBottom <= m.exitTop,
    `药丸 ${m.top.toFixed(0)}–${m.bottom.toFixed(0)}，种子底 ${m.formBottom?.toFixed(0)} / 《退出》顶 ${m.exitTop?.toFixed(0)}`);
  await ctx.close();
}

// ── ⑧ 倒数那一幕：手机的返回键和《退出》去同一个地方（挑码那一页，10-09 补充方案 7-13 第 12 条）──────
//
// 原先《退出》回挑码页，返回键却走整页那一条回了主菜单。量三件事：数到一半按返回 → 挑码页（不是主菜
// 单），而且那一局没在背后数完开出来；《退出》→ 同一个地方（尺子）；回到挑码页再按返回 → 主菜单（整页那
// 一条没被这一层吃掉）。
{
  const { ctx, page } = await pageAt(NOON(SC.dayIndexOf(Date.now())));
  const where = () =>
    page.evaluate(() => ({
      count: Boolean(document.querySelector('.daily-page--count')),
      pick: Boolean(document.querySelector('#dailyPlay')),
      home: Boolean(document.querySelector('.home-icon-btn--daily')),
      board: Boolean(document.querySelector('#boardWrap .tile, #boardWrap .ball')),
    }));
  const pressBack = async () => {
    // 哨兵是这一层画到屏幕上之后才推的（见 engine/backNav.ts 的 arm）：按返回之前先等它立好。
    await page.waitForTimeout(150);
    await page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  };
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#dailyPlay', { timeout: 8000 });
  await page.click('#dailyPlay');
  await page.waitForSelector('.daily-page--count', { timeout: 8000 });
  await pressBack();
  const a = await where();
  check('⑧ 数到一半按返回键：回到挑码那一页（不是主菜单）', a.pick && !a.count && !a.home, JSON.stringify(a));
  await page.waitForTimeout(5000);
  const a2 = await where();
  check('⑧ 而且那一局没在背后数完开出来（倒数停了）', a2.pick && !a2.board, JSON.stringify(a2));
  await page.click('#dailyPlay');
  await page.waitForSelector('.daily-page--count', { timeout: 8000 });
  await page.click('.daily-page--count #dailyBack');
  await page.waitForTimeout(300);
  const b = await where();
  check('⑧（尺子）屏幕上的《退出》去的也是挑码那一页', b.pick && !b.count && !b.home, JSON.stringify(b));
  await pressBack();
  const c = await where();
  check('⑧ 回到挑码页之后再按返回键：回主菜单（整页那一条没被吃掉）', c.home && !c.pick, JSON.stringify(c));
  await ctx.close();
}

check('全程零报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
