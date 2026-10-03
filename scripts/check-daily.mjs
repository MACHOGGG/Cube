/**
 * 主菜单那张《每日挑战》（第 19 推）：七天的图和字、北京零点换日、电脑端那一排、首玩期。
 *
 *   node scripts/dev-server.mjs 8974 dist &
 *   node scripts/check-daily.mjs http://localhost:8974/
 *
 * 方案的门：「北京时间 23:59:59→00:00:00 准确换日（种子、数字、颜色同时换）」「7 天星期与配色
 * 对应」，电脑宽屏「1440×900 下居中、各行等距、一屏放得下」，以及「首玩期间也显示」。手机鱼眼那
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

/** 一台手机，钟拨到 `at`，HEAD 拦掉；`played` 决定是不是首玩期。 */
async function pageAt(at, { width = 390, height = 844, mobile = true, played = true, lang = 'zhHans' } = {}) {
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
      }
    },
    { played, lang },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/*', (route) => (route.request().method() === 'HEAD' ? route.abort() : route.continue()));
  await page.clock.install({ time: at });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
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

// ── ⑤ 首玩期：亮着、点得开 ─────────────────────────────────────────────────
{
  const { ctx, page } = await pageAt(NOON(SC.dayIndexOf(Date.now())), { played: false });
  const c = await cardNow(page);
  const others = await page.evaluate(() => document.querySelectorAll('.mode-axis > .home-icon-btn--locked').length);
  check('⑤ 首玩期：别的玩法锁着（尺子），每日挑战没锁', others > 0 && c.locked === false, `锁着 ${others} 张 / 每日挑战 locked=${c.locked}`);
  await page.click('.home-icon-btn--daily');
  const opened = await page.waitForSelector('.daily-page #dailyPlay', { timeout: 5000 }).then(() => true).catch(() => false);
  check('⑤ 首玩期：点得开每日挑战那一页（不被首玩期那道拦截拦下）', opened);
  await ctx.close();
}

// ── ⑥ 电脑宽屏 1440×900：最上面一排只有它、居中、一样大、各行等距、一屏放得下 ─────
{
  const { ctx, page } = await pageAt(NOON(SC.dayIndexOf(Date.now())), { width: 1440, height: 900, mobile: false });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.home-grid > .home-row')];
    const first = rows[0];
    const cards = first ? [...first.querySelectorAll(':scope > .home-icon-btn, :scope > .home-bomb-card')] : [];
    const art = (el) => (el.querySelector('.home-icon-art') ?? el).getBoundingClientRect();
    const d = first?.querySelector('.home-icon-btn--daily');
    const da = d ? art(d) : null;
    // 「一样大」拿基础方块那张比（第二排第一张）：同一个 --home-card-cap 收着。
    const sq = rows[1]?.querySelector('.home-icon-btn');
    const sa = sq ? art(sq) : null;
    const boxes = rows.map((r) => r.getBoundingClientRect());
    const gaps = boxes.slice(1).map((b, i) => +(b.top - boxes[i].bottom).toFixed(2));
    const nav = document.querySelector('.home-nav-dock, .home-nav')?.getBoundingClientRect();
    const lastBottom = Math.max(...[...document.querySelectorAll('.home-grid .home-icon-btn, .home-grid .home-bomb-card')].map((e) => e.getBoundingClientRect().bottom));
    return {
      rows: rows.length,
      firstCards: cards.length,
      isDaily: !!d && cards[0] === d,
      dCx: da ? da.left + da.width / 2 : null,
      vwMid: document.documentElement.clientWidth / 2,
      dW: da?.width ?? 0,
      sW: sa?.width ?? 0,
      gaps,
      scroll: document.documentElement.scrollHeight,
      vh: window.innerHeight,
      lastBottom,
      navTop: nav?.top ?? null,
    };
  });
  check('⑥ 1440×900：最上面那一排只有每日挑战一张', m.firstCards === 1 && m.isDaily, `${m.firstCards} 张`);
  check('⑥ 1440×900：它横着居中（≤1px）', m.dCx !== null && Math.abs(m.dCx - m.vwMid) <= 1, `${m.dCx?.toFixed(2)} / ${m.vwMid}`);
  check('⑥ 1440×900：和别的卡一样大（≤0.5px）', m.dW > 40 && Math.abs(m.dW - m.sW) <= 0.5, `${m.dW.toFixed(2)} / ${m.sW.toFixed(2)}`);
  check('⑥ 1440×900：各行等距（排与排之间的缝一样，≤1px）', m.gaps.length >= 3 && Math.max(...m.gaps) - Math.min(...m.gaps) <= 1, m.gaps.join(' / '));
  check('⑥ 1440×900：一屏放得下（不用滚，最后一排压不到底排）', m.scroll <= m.vh && m.navTop !== null && m.lastBottom <= m.navTop, `scrollHeight ${m.scroll} / 屏高 ${m.vh}，最后一排底 ${m.lastBottom.toFixed(1)} / 底排顶 ${m.navTop?.toFixed(1)}`);
  await ctx.close();
}

check('全程零报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
