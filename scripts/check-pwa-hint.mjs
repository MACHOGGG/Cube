/**
 * 「登录后打的每一局都会存到云端，换设备也找得回。」——主屏版、iOS 浏览器里没登录的人（10-11 方案 B-14）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8987 dist
 *   node scripts/check-pwa-hint.mjs http://localhost:8987/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * iOS 上「添加到主屏幕」的那一版和 Safari 的存储是分开的，Safari 七天不和网站互动就会清掉脚本写下的存储。没
 * 登录的人换台设备、清一次浏览器，战绩就没了——从前屏幕上从没人告诉过他。规则在 engine/signInHint.ts，方案
 * 点名要量的五样：「standalone 未登录时出现、登录后消失、Safari 不足 3 局不出现、结算弹窗一天只出现一次、
 * 四语都在」。
 *
 *   ① 判定（记录页顶上那一行）：
 *      · 主屏版（iOS 的 navigator.standalone）没登录：有；登录了：没有；
 *      · 主屏版（display-mode: standalone——安卓、电脑装成应用的那一种）没登录：有；
 *      · iOS 浏览器（不是主屏版）：本机 2 局没有，3 局有；
 *      · 电脑浏览器（不是主屏版）：本机 5 局也没有。
 *   ② 记录页：四种语言那一句和方案上的原文一字不差；《登录》按下去开的是登录那一窗；
 *      几种尺寸上摆得下（字和键都在屏幕里、不压招牌和累计得分卡）；1000×700、1280×800 两种电脑窗口
 *      上加了这一行整页照旧不滑（它坐在累计得分卡旁边，见 style.css 的 .records-page--hint）。
 *   ③ 结算页（主屏版、没登录）：
 *      · 头一回结算在讲「综合分是怎么来的」（一次性的）：不说，也不算今天说过——两句一次性的话不挤一窗；
 *      · 下一局打完有那一句，本机记下今天（本机日期，不是 UTC）；
 *      · 当天再打一局：没有；记的那一天换成昨天（＝第二天）再打：又有了；
 *      · 登录了：没有；电脑浏览器（不是主屏版）：没有；
 *      · iOS 浏览器里：本机原有 1 局，这一局打完是 2 局——没有；再打一局（第 3 局）——有；
 *      · 横屏手机上抬头长到那一格摆不下：不说，也不算今天说过。
 *   ④ 结算页四种语言 × 几种尺寸（竖屏三种、横屏、电脑）：那一句一字不差；在窗里、在三颗键上面、
 *      不压键也不压抬头；**6-7 定的抬头和三颗键一个像素不动**（同一窗把那一句藏起来再量一遍，抬头和键
 *      的位置必须一样——多出来的那一行只能从中间那张图里让）；图还在（没被挤没）。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-pwa-hint.mjs http://localhost:8987/');
  process.exit(2);
}

/** 方案 B-14 上的原文（玩家拍板的那四句）。i18n.ts 里的 cloudSaveHint 必须是这四句。 */
const WANT = {
  zhHans: '登录后打的每一局都会存到云端，换设备也找得回。',
  zhHant: '登入後打的每一局都會存到雲端，換裝置也找得回。',
  en: 'Sign in and every game you play from then on is saved to the cloud — on any device.',
  // 冒号前是不换行空格 U+00A0（10-15 补充 S6：法文标点，check-fr-spacing 量）
  fr: 'Connectez-vous : chaque partie jouée ensuite est sauvegardée dans le cloud, sur tous vos appareils.',
};
const LANGS = Object.keys(WANT);
const HINT_DAY_KEY = 'slides_signin_hint_day';

const VERSION = /SCORING_RULES_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8'),
)[1];
/** 经典方块基础局那一份存档（和 check-records-rows 同一个键）。 */
const RUNS_KEY = `sugarcube_best_${VERSION}::runs`;
const SIGNED_IN = {
  active: true, channel: 'code', until: Date.UTC(2999, 0, 1),
  email: 'pwa-hint@example.com', token: 'probe-token',
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  — ${extra}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** iOS 主屏版：navigator.standalone 是 true。 */
const viaNavigator = () => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
/** 安卓 / 电脑装成应用的那一种：display-mode: standalone 这一条媒体查询成立（navigator.standalone 没有）。 */
const viaMediaQuery = () => {
  const orig = window.matchMedia.bind(window);
  window.matchMedia = (q) =>
    /display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
      : orig(q);
};

const runs = (n) => Array.from({ length: n }, (_, i) => ({
  at: Date.now() - (i + 1) * 3600e3, start: null, end: null,
  data: { shapeId: 'square', shapeFallback: '方块', modeKey: 'base', totalScore: 40 + i, at: Date.now() - (i + 1) * 3600e3 },
}));

/**
 * 开一台设备：语言、跳过开场和教学（这一台量的不是那些）、本机几局、登没登录——开机之前就写进去，只开一次页。
 * 开机那一次清档（engine/wipeOldRules.ts）只删《侵蚀阶梯》之前那一套键，现行这个键它不碰，所以局可以先放。
 * 只在这台设备头一回开页时写（sessionStorage 记一笔）：之后这一页里打的局、记的那一天都是被测的东西，
 * 不能被再写一遍盖掉。
 */
async function device({ w = 390, h = 844, ua, standalone, lang = 'zhHans', localRuns = 0, signedIn = false, taught = true }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', ...(ua ? { userAgent: ua } : {}) });
  if (standalone === 'navigator') await ctx.addInitScript(viaNavigator);
  if (standalone === 'media') await ctx.addInitScript(viaMediaQuery);
  await ctx.addInitScript(([l, key, r, s, t]) => {
    if (sessionStorage.getItem('pwa-hint-seeded')) return;
    sessionStorage.setItem('pwa-hint-seeded', '1');
    localStorage.setItem('slides_lang', l);
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle',
      'slides_played_square', 'slides_played_circle', 'slides_know_how', 'slides_played_finished']) localStorage.setItem(k, '1');
    // 「综合分是怎么来的」那一句讲过了（engine/firstPlay.ts 的 claimFirstTotalTip）：它在的那一窗不说登录提示，
    // 量「说不说、摆不摆得下」的那几台先把它讲掉。要量「头一回结算不说」的那一台不预设（taught: false）。
    if (t) localStorage.setItem('slides_played_totaltip', '1');
    if (r.length) localStorage.setItem(key, JSON.stringify(r));
    if (s) localStorage.setItem('slides_genius', JSON.stringify(s));
  }, [lang, RUNS_KEY, runs(localRuns), signedIn ? SIGNED_IN : null, taught]);
  // 战绩、榜单、交卷都在浏览器里拦下来：这一台量的是那一句，不是服务器。
  await ctx.route('**/api/scores', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: '', players: 0, rows: [], total: 0, runs: 0, best: {}, archive: [] }) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  return { ctx, page, errors };
}

async function openRecords(page) {
  await page.click('#navRecords');
  await page.waitForSelector('.records-page .records-rule, .records-page .records-row', { timeout: 10000 });
  await page.waitForTimeout(250);
}

const recordsHint = (page) => page.evaluate(() => {
  const row = document.getElementById('recordsHint');
  if (!row) return { shown: false };
  const box = (e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height }; };
  const text = row.querySelector('.records-hint-text');
  const btn = row.querySelector('#recordsHintBtn');
  return {
    shown: true,
    text: text?.textContent.trim() ?? '',
    btn: btn ? box(btn) : null,
    btnLabel: btn?.textContent.trim() ?? '',
    row: box(row),
    textBox: text ? box(text) : null,
    glass: box(document.querySelector('.records-page .home-head-glass')),
    total: box(document.getElementById('totalCard')),
    vw: innerWidth, vh: innerHeight,
    scroll: document.documentElement.scrollHeight - innerHeight,
  };
});

// ── ① 判定 ──────────────────────────────────────────────────────────────
console.log('① 记录页顶上那一行：谁看得到');
for (const c of [
  { tag: 'iOS 主屏版、没登录', o: { ua: IPHONE, standalone: 'navigator' }, want: true },
  { tag: 'iOS 主屏版、登录了', o: { ua: IPHONE, standalone: 'navigator', signedIn: true }, want: false },
  { tag: '装成应用（display-mode: standalone）、没登录', o: { standalone: 'media' }, want: true },
  { tag: '装成应用（display-mode: standalone）、登录了', o: { standalone: 'media', signedIn: true }, want: false },
  { tag: 'iOS 浏览器、本机 2 局', o: { ua: IPHONE, localRuns: 2 }, want: false },
  { tag: 'iOS 浏览器、本机 3 局', o: { ua: IPHONE, localRuns: 3 }, want: true },
  { tag: 'iOS 浏览器、本机 3 局、登录了', o: { ua: IPHONE, localRuns: 3, signedIn: true }, want: false },
  { tag: '电脑浏览器、本机 5 局', o: { w: 1280, h: 800, localRuns: 5 }, want: false },
]) {
  const { ctx, page, errors } = await device(c.o);
  await openRecords(page);
  const got = await recordsHint(page);
  check(`${c.tag}：${c.want ? '有' : '没有'}`, got.shown === c.want, JSON.stringify({ shown: got.shown }));
  check(`${c.tag}：没有页面报错`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ── ② 记录页：四语、登录键、摆得下 ──────────────────────────────────────
console.log('② 记录页：四种语言、《登录》、摆得下');
/**
 * 四种语言在 390×844 和电脑最矮那一档（1000×700，它要「整页照旧不滑」）各量一遍；更窄、更高的那几档只量最长的
 * 两种（法、英）——中文那两句在哪一档都比它们短。一档一台设备，全量的话这一节要两分钟。
 */
const RECORD_CASES = [
  ...LANGS.map((l) => [390, 844, l]), ...LANGS.map((l) => [1000, 700, l]),
  [320, 568, 'fr'], [320, 568, 'en'], [375, 667, 'fr'], [1280, 800, 'fr'],
];
for (const [w, h, lang] of RECORD_CASES) {
  {
    const desk = w >= 1000;
    const { ctx, page } = await device({ w, h, lang, ua: desk ? undefined : IPHONE, standalone: desk ? 'media' : 'navigator' });
    await openRecords(page);
    const g = await recordsHint(page);
    const tag = `${w}×${h} ${lang}`;
    check(`${tag}：那一句是方案上的原文`, g.text === WANT[lang], JSON.stringify(g.text));
    if (!g.shown) { await ctx.close(); continue; }
    const inView = (b) => b.l >= -0.5 && b.r <= g.vw + 0.5 && b.t >= -0.5 && b.b <= g.vh + 0.5;
    check(`${tag}：字和《登录》都在屏幕里`, inView(g.row) && inView(g.btn), JSON.stringify({ row: g.row, vw: g.vw, vh: g.vh }));
    check(`${tag}：《登录》至少 44 高（全站最小的点按尺寸）`, g.btn.h >= 43.5, JSON.stringify(g.btn));
    check(`${tag}：字没被挤到一个字一行（宽 ≥ 120）`, g.textBox.w >= 120, String(Math.round(g.textBox.w)));
    check(`${tag}：不压招牌`, g.row.t >= g.glass.b - 0.5, `${Math.round(g.row.t)} / ${Math.round(g.glass.b)}`);
    if (desk) {
      // 电脑：坐在累计得分卡旁边（同一行、在它右边），整页不滑。
      check(`${tag}：在累计得分卡右边、不叠`, g.row.l >= g.total.r - 0.5 && g.row.t >= g.total.t - 0.5 && g.row.b <= g.total.b + 0.5,
        JSON.stringify({ row: g.row, total: g.total }));
      check(`${tag}：整页照旧不滑`, g.scroll <= 1, `${g.scroll}px`);
    } else {
      check(`${tag}：在累计得分卡上面、不叠`, g.row.b <= g.total.t + 0.5, `${Math.round(g.row.b)} / ${Math.round(g.total.t)}`);
    }
    if (w === 390 && lang === 'zhHans') {
      // 《登录》开的是登录那一窗。
      await page.click('#recordsHintBtn');
      const opened = await page.waitForSelector('.auth-modal', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      check('《登录》按下去：开的是登录那一窗', opened);
    }
    await ctx.close();
  }
}

// ── ③ 结算页：一天一次、第二天再说、登录了不说、iOS 浏览器数到第 3 局 ──────────
async function startSquare(page) {
  await page.evaluate(() => document.querySelector('.home-icon-btn[data-first-playable="1"]')?.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, null, { timeout: 25000 });
  await page.waitForTimeout(500);
}
/** 开局就交卷（《结束游戏》），等结算页和那张图都到了。 */
async function finish(page) {
  await page.$eval('#stopBtn', (e) => e.click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.$eval('#pauseFinishBtn', (e) => e.click());
  await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
  await page.waitForFunction(() => { const i = document.getElementById('endShareImg'); return !!i && i.complete && i.naturalHeight > 0; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}
async function again(page) {
  await page.$eval('#restartBtn', (e) => e.click());
  await page.waitForFunction(() => !document.getElementById('endOverlay')?.classList.contains('show'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
}
const endHint = (page) => page.evaluate((key) => {
  const el = document.getElementById('endSignHint');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    shown: !!el && !el.hidden && el.getBoundingClientRect().height > 0,
    text: el?.textContent.trim() ?? '',
    day: localStorage.getItem(key),
    today: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
  };
}, HINT_DAY_KEY);

console.log('③ 结算页：一天一次');
{
  const { ctx, page, errors } = await device({ ua: IPHONE, standalone: 'navigator', taught: false });
  await startSquare(page);
  await finish(page);
  const t = await endHint(page);
  const tip = await page.evaluate(() => !!document.querySelector('#endBreakdown .end-row--tip'));
  check('头一回结算在讲「综合分是怎么来的」：不说登录提示（两句一次性的话不挤一窗）', tip && !t.shown, JSON.stringify({ tip, ...t }));
  check('头一回结算：也不算今天说过', t.day === null, String(t.day));
  await again(page);
  await finish(page);
  const a = await endHint(page);
  check('主屏版、没登录：下一局打完有那一句', a.shown && a.text === WANT.zhHans, JSON.stringify(a));
  check('记下的是本机的今天', a.day === a.today, JSON.stringify({ day: a.day, today: a.today }));
  await again(page);
  await finish(page);
  const b = await endHint(page);
  check('当天再打一局：没有', !b.shown, JSON.stringify(b));
  // 第二天：记的那一天是昨天。
  await page.evaluate((key) => {
    const d = new Date(Date.now() - 86_400_000);
    const p = (n) => String(n).padStart(2, '0');
    localStorage.setItem(key, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  }, HINT_DAY_KEY);
  await again(page);
  await finish(page);
  const c = await endHint(page);
  check('第二天再打：又有了', c.shown && c.text === WANT.zhHans, JSON.stringify(c));
  check('没有页面报错', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await device({ ua: IPHONE, standalone: 'navigator', signedIn: true });
  await startSquare(page);
  await finish(page);
  const e = await endHint(page);
  check('主屏版、登录了：结算页没有那一句', !e.shown, JSON.stringify(e));
  check('主屏版、登录了：也不记那一天', e.day === null, String(e.day));
  await ctx.close();
}
{
  const { ctx, page } = await device({ ua: IPHONE, localRuns: 1 });
  await startSquare(page);
  await finish(page);
  const f = await endHint(page);
  check('iOS 浏览器：本机 1 局＋这一局＝2 局，没有', !f.shown, JSON.stringify(f));
  await again(page);
  await finish(page);
  const g = await endHint(page);
  check('iOS 浏览器：第 3 局打完，有', g.shown && g.text === WANT.zhHans, JSON.stringify(g));
  await ctx.close();
}
{
  const { ctx, page } = await device({ w: 1280, h: 800, localRuns: 5 });
  await startSquare(page);
  await finish(page);
  const h = await endHint(page);
  check('电脑浏览器（不是主屏版）：结算页没有', !h.shown, JSON.stringify(h));
  await ctx.close();
}
{
  // 摆不下就不说、也不算今天说过（gameController 的 signHintFits）：横屏手机上把抬头那一栏人为撑高，左栏
  // 抬头和三颗键之间那一格就比那一句矮。
  const { ctx, page } = await device({ w: 844, h: 390, ua: IPHONE, standalone: 'navigator' });
  await page.addStyleTag({ content: '.overlay--end .modal .end-head { padding-bottom: 240px !important; }' });
  await startSquare(page);
  await finish(page);
  const k = await endHint(page);
  check('横屏、抬头长到那一格摆不下：不说', !k.shown, JSON.stringify(k));
  check('横屏、摆不下：也不算今天说过', k.day === null, String(k.day));
  await ctx.close();
}

// ── ④ 结算页四语 × 尺寸：摆得下、不挤 6-7 的抬头和三颗键 ───────────────────
console.log('④ 结算页：四种语言 × 几种尺寸');
const END_MEASURE = () => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, h: r.height }; };
  const modal = document.querySelector('#endOverlay .modal');
  const hint = document.getElementById('endSignHint');
  return {
    modal: box(modal),
    head: box(modal.querySelector('.end-head')),
    body: box(modal.querySelector('.end-body')),
    acts: box(modal.querySelector('.end-actions')),
    img: box(document.getElementById('endShareImg')),
    hint: hint.hidden ? null : box(hint),
    hintLines: hint.hidden ? 0 : Math.round(hint.getBoundingClientRect().height / parseFloat(getComputedStyle(hint).lineHeight)),
    vh: innerHeight,
  };
};
/** 同上：四种语言在 390×844 和横屏各量一遍，别的几档量最长的那两种（最窄那一档三种都量：中文少折一行，图让得少）。 */
const END_CASES = [
  ...LANGS.map((l) => [390, 844, l]), ...LANGS.map((l) => [844, 390, l]),
  [320, 568, 'fr'], [320, 568, 'en'], [320, 568, 'zhHans'], [375, 667, 'fr'], [1280, 800, 'fr'], [1280, 800, 'en'],
];
const table = [];
for (const [w, h, lang] of END_CASES) {
  {
    const desk = w >= 1000;
    const { ctx, page } = await device({ w, h, lang, ua: desk ? undefined : IPHONE, standalone: desk ? 'media' : 'navigator' });
    await startSquare(page);
    await finish(page);
    const tag = `${w}×${h} ${lang}`;
    const g = await endHint(page);
    check(`${tag}：那一句是方案上的原文`, g.shown && g.text === WANT[lang], JSON.stringify(g.text));
    const on = await page.evaluate(END_MEASURE);
    // 同一窗把那一句藏起来再量：抬头和三颗键的位置必须一样。
    await page.evaluate(() => { document.getElementById('endSignHint').hidden = true; });
    await page.waitForTimeout(80);
    const off = await page.evaluate(END_MEASURE);
    if (!on.hint) { await ctx.close(); continue; }
    const same = (a, b) => Math.abs(a.t - b.t) <= 0.5 && Math.abs(a.b - b.b) <= 0.5 && Math.abs(a.l - b.l) <= 0.5 && Math.abs(a.r - b.r) <= 0.5;
    check(`${tag}：整窗在屏幕里`, on.modal.t >= -0.5 && on.modal.b <= on.vh + 0.5, JSON.stringify(on.modal));
    check(`${tag}：抬头一个像素不动`, same(on.head, off.head), JSON.stringify({ on: on.head, off: off.head }));
    check(`${tag}：三颗键一个像素不动`, same(on.acts, off.acts), JSON.stringify({ on: on.acts, off: off.acts }));
    check(`${tag}：那一句在窗里、在三颗键上面`, on.hint.l >= on.modal.l - 0.5 && on.hint.r <= on.modal.r + 0.5 && on.hint.b <= on.acts.t + 0.5,
      JSON.stringify({ hint: on.hint, acts: on.acts }));
    check(`${tag}：不压抬头`, on.hint.t >= on.head.b - 0.5, `${Math.round(on.hint.t)} / ${Math.round(on.head.b)}`);
    if (!(w > h)) check(`${tag}：在战绩图那一块底下`, on.hint.t >= on.body.b - 0.5, `${Math.round(on.hint.t)} / ${Math.round(on.body.b)}`);
    // 图还在：让出去的只是那一行（和它的上边距），不是整张图。
    check(`${tag}：战绩图还在（≥ 没有那一句时的 40%）`, on.img.h >= off.img.h * 0.4 && on.img.h > 0, `${Math.round(on.img.h)} / ${Math.round(off.img.h)}`);
    table.push(`${tag.padEnd(16)} 那一句 ${on.hintLines} 行 · 图 ${Math.round(off.img.h)} → ${Math.round(on.img.h)}`);
    await ctx.close();
  }
}
console.log(table.map((r) => '   ' + r).join('\n'));

await browser.close();
console.log(`\n${fail ? '✗' : '✓'} check-pwa-hint：${pass} 条过、${fail} 条红`);
process.exit(fail ? 1 : 0);
