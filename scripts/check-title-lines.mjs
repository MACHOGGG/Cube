/**
 * 全站标题不带横线，主菜单底排不带硬边（10-08 方案 3-K）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8965 dist
 *   node scripts/check-title-lines.mjs http://localhost:8965/
 *
 * 方案原话：「所有 title 板块的横线移除（svgTitle.ts 及标题相关样式里搜 SVG 线段/border-bottom）；主菜单底部
 * 硬边框一并去掉（菜单/bottomNav 样式里搜 border 确认后删；语义分隔需要留白就改 margin）。一次截图验收所有
 * 页面标题。」
 *
 * 撤掉的是三样（style.css）：
 *   · 招牌「Slides」字底下那道 3px 的线（.home-title 的 border-bottom；横屏那一档 2px）。七页共用这一块招牌：
 *     主菜单、成绩与排名、个人主页、多人小屋（两处）、天才特供那几页、小屋的卡。小红书那一版也是它。
 *   · 邀请窗抬头底下那道 2px 的下划线（.invite-title，第 14 推加的）。
 *   · 主菜单底排那块圆角板外面那圈 `0 0 0 1px` 的描边（.home-nav-dock）。
 * 线占的地方都并进了外边距：招牌、邀请窗一像素没变高，底下的东西都不用挪。
 *
 * ── 量什么 ─────────────────────────────────────────────────────────
 *
 * ① 招牌：七页里能直接走到的那几页（主菜单、成绩与排名、个人主页、多人小屋、天才特供四页），手机 390×844、
 *    横屏 844×390（走 .home-page--wide 那一档）、电脑 1280×800 各一遍：
 *    · 「Slides」那个字四边都没有线（computed border 宽 0），没有下划线（text-decoration），::before /
 *      ::after 没画东西，没有 inset 的阴影线；
 *    · 招牌整块里没有任何「横线一样的东西」：看得见的 border、高 ≤ 4 宽 ≥ 20 的色条、<hr>、SVG 里又宽又扁的
 *      线段。**玻璃那块自己的轮廓（inset 1px 的一圈）不算**——它是那块玻璃的边，四边一起，不是横线；方案要撤
 *      的是「横线」；
 *    · 线的那一截还在：字（内容框的底）到底下那句 tagline 的上沿，手机 / 电脑 15px（原先 4 内边距 ＋ 3 线 ＋
 *      2 外边距 ＋ 6），横屏那一档 9px（2 ＋ 2 ＋ 2 ＋ 3）。量的是排出来的位置，不是读 CSS 里写的数——这样
 *      「并进去的外边距被一条更具体的规则盖掉了」也逃不过（邀请窗那边就真撞上了这件事，见下面 ②）。
 * ② 邀请窗（没登录，个人主页那颗《成为 Slides 天才》）：抬头四边没有线；抬头的字到底下那一块（吉祥物和货单）
 *    还是 20px（原先 10 内边距 ＋ 2 线 ＋ 8）。
 *    这个 20 有来历：原先那条规则写的是 `.invite-title { margin: 0 0 var(--gap-md) }`，可通用的 `.modal h2
 *    { margin: 0 0 8px }` 比它高一级，屏幕上一直是 8。撤线的头一版只写了 `.invite-title`，并进去的外边距照
 *    样被盖掉，整扇窗矮了 12px、上下各缩 6——什么都不报，是截图逐像素比出来的。所以这一条量位置。
 * ③ 底排那块圆角板：box-shadow 里没有「只有扩散、没有模糊」的那种描边层（`0 0 0 Npx`），四边没有 border；
 *    可它还得看得出是一块板——底下那层软投影还在，底色和页面底色不一样。浅色、深色、色盲三套主题各量一遍
 *    （描边要是只在某一套主题里加回来，也是红）。
 * ④ 别的标题：游戏规则、联系与特别感谢、隐私政策、累计得分点开的那张大卡，各页上看得见的 h1 / h2 / h3 和 class 里带 title 的
 *    元素都按 ① 第一条量。结算弹窗的抬头归 check-end-design 管（3-I 那一版本来就没有线）。
 *
 * 每一条都带尺子：页真的打开了、元素真的量到了，量不到就是红，不是空绿。
 *
 * 改坏法：拿 3-K 之前那一版（5b54c3d）构建跑这道门——七页招牌那条线、邀请窗那条线、底排那一圈都红；把邀
 * 请窗那条规则的前缀 .invite-modal 去掉再跑——「还隔着 20px」那一条红。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8965/';
const MODES = ['浅色', '深色', '色盲'];
const TOL = 0.6;

let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  — ${extra}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 开通天才只兑一次码（一台服务器上同一张码只能兑一次），之后各上下文抄那份。天才特供那几页要它。 */
let genius = null;
async function openCtx(w, h, { signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript(([g, signed]) => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    if (g && signed) localStorage.setItem('slides_genius', g);
  }, [genius, signedIn]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 25000 });
  if (signedIn && !genius) {
    genius = await page.evaluate(async () => {
      const r = await fetch('/api/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }),
      }).then((x) => x.json());
      const g = JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code });
      localStorage.setItem('slides_genius', g);
      return g;
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 25000 });
  }
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

async function setMode(page, mode) {
  await page.evaluate((m) => {
    const h = document.documentElement;
    h.setAttribute('data-theme', m === '深色' ? 'dark' : 'light');
    if (m === '色盲') h.setAttribute('data-cvd', '1');
    else h.removeAttribute('data-cvd');
  }, mode);
  await page.waitForTimeout(80);
}

/**
 * 在页面里量「线」。scope 里每个看得见的元素：四边 border、::before / ::after、inset 的阴影线、细色条、<hr>、
 * SVG 里又宽又扁的线段。titles 是要按「标题本身」量的那几个（再加量下划线和 text-decoration）。
 * 返回每一处线的说明；空数组就是干净的。
 */
const LINES = ([scopeSel, titleSel, skipRingSel]) => {
  const scope = document.querySelector(scopeSel);
  if (!scope) return { found: false, lines: [] };
  const visible = (c) => !!c && c !== 'transparent' && !/rgba?\([^)]*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c);
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const lines = [];
  const borders = (cs, who) => {
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(cs[`border${side}Width`]) || 0;
      if (w > 0 && cs[`border${side}Style`] !== 'none' && cs[`border${side}Style`] !== 'hidden' && visible(cs[`border${side}Color`])) {
        lines.push(`${who}：border-${side.toLowerCase()} ${w}px ${cs[`border${side}Color`]}`);
      }
    }
  };
  const insetLine = (cs, who) => {
    // inset 的阴影线：`inset 0 -2px 0 色` 一类（纵向有偏移、没有模糊）。玻璃那块的 `inset 0 0 0 1px` 一圈是四边
    // 一起的轮廓，不是横线——由调用方点名跳过。
    for (const layer of (cs.boxShadow || '').split(/,(?![^(]*\))/)) {
      if (!/inset/.test(layer)) continue;
      const nums = (layer.match(/-?[\d.]+px/g) || []).map(parseFloat);
      if (nums.length >= 2 && nums[1] !== 0 && (nums[2] || 0) <= 1) lines.push(`${who}：inset 阴影线 ${layer.trim()}`);
    }
  };
  for (const el of [scope, ...scope.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) continue;
    const who = name(el);
    const inSvg = el.closest('svg') && el.tagName.toLowerCase() !== 'svg';
    if (inSvg) {
      // SVG 里又宽又扁的线段（方案点名「搜 SVG 线段」）
      const tag = el.tagName.toLowerCase();
      if (['line', 'polyline', 'path', 'rect'].includes(tag) && r.width >= 20 && r.height <= 4) lines.push(`${who}：SVG 横线段 ${Math.round(r.width)}×${r.height.toFixed(1)}`);
      continue;
    }
    if (el.tagName.toLowerCase() === 'hr') lines.push(`${who}：<hr>`);
    borders(cs, who);
    if (!(skipRingSel && el.matches(skipRingSel))) insetLine(cs, who);
    if (r.height > 0 && r.height <= 4 && r.width >= 20 && (visible(cs.backgroundColor) || cs.backgroundImage !== 'none')) {
      lines.push(`${who}：细色条 ${Math.round(r.width)}×${r.height}`);
    }
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      const h = parseFloat(ps.height);
      const w = parseFloat(ps.width);
      const filled = visible(ps.backgroundColor) || ps.backgroundImage !== 'none';
      if (filled && Number.isFinite(h) && h > 0 && h <= 4 && (!Number.isFinite(w) || w >= 20)) lines.push(`${who}${pseudo}：画了一道 ${ps.width}×${ps.height}`);
      borders(ps, who + pseudo);
    }
  }
  const titles = titleSel ? [...scope.querySelectorAll(titleSel)].filter((t) => getComputedStyle(t).display !== 'none') : [];
  for (const t of titles) {
    const cs = getComputedStyle(t);
    if (/underline|overline|line-through/.test(cs.textDecorationLine)) lines.push(`${name(t)}：text-decoration ${cs.textDecorationLine}`);
  }
  return { found: true, titles: titles.length, lines };
};

/** 招牌：字的内容框底到 tagline 上沿的距离（排出来的位置）。 */
const MAST = () => {
  const t = document.querySelector('.home-head .home-title');
  const sub = document.querySelector('.home-head .home-sub');
  if (!t || !sub) return null;
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  const contentBottom = r.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
  // 横屏矮屏（≤ 480 高）上只有主菜单走 .home-page--wide 那一档（字小一号、线原先 2px），别的页还是平常那一档
  const low = matchMedia('(orientation: landscape) and (max-height: 480px)').matches;
  return { gap: sub.getBoundingClientRect().top - contentBottom, wideLow: low && !!t.closest('.home-page--wide') };
};

const tap = (page, sel) => page.$eval(sel, (el) => el.click());
const fromProfile = (rowSel, pageSel) => async (page) => {
  await page.click('#navProfile');
  await page.waitForSelector(rowSel, { timeout: 10000 });
  await page.click(rowSel);
  await page.waitForSelector(pageSel, { timeout: 10000 });
};
const MAST_PAGES = [
  { n: '主菜单', open: async () => {}, ready: '.home-page' },
  { n: '成绩与排名', open: (p) => p.click('#navRecords'), ready: '.records-page' },
  { n: '个人主页', open: (p) => p.click('#navProfile'), ready: '.profile-page' },
  { n: '多人小屋', open: (p) => tap(p, '.home-icon-btn[aria-label="多人游玩"]'), ready: '.mp-page--home' },
  { n: '天才特供 · 更多得分目标', open: fromProfile('#moreTargetsRow', '.tgt-page'), ready: '.tgt-page' },
  { n: '天才特供 · 更多布局', open: fromProfile('#moreLayoutsRow', '.lay-page'), ready: '.lay-page' },
  { n: '天才特供 · 世界排名', open: fromProfile('#worldRankRow', '.rank-page'), ready: '.rank-page' },
  { n: '天才特供 · 更多玩法', open: fromProfile('#moreModesRow', '.modes-page'), ready: '.modes-page' },
];
const SIZES = [
  { n: '手机 390×844', w: 390, h: 844 },
  { n: '横屏 844×390', w: 844, h: 390 },
  { n: '电脑 1280×800', w: 1280, h: 800 },
];
/** 字到 tagline：平常那一档 4 ＋ 3 ＋ 2 ＋ 6，横屏矮屏上主菜单那一档 2 ＋ 2 ＋ 2 ＋ 3。 */
const GAP = { normal: 15, wideLow: 9 };

// ── ① 招牌 ──────────────────────────────────────────────────────────────
console.log('\n① 招牌（七页共用的那一块）');
for (const size of SIZES) {
  for (const pg of MAST_PAGES) {
    const { ctx, page, errors } = await openCtx(size.w, size.h);
    const tag = `${size.n} ${pg.n}`;
    try {
      await pg.open(page);
      await page.waitForSelector(`${pg.ready} .home-head .home-title`, { timeout: 10000 });
      await page.waitForTimeout(250);
      const res = await page.evaluate(LINES, ['.app .home-head', '.home-title, .home-sub', '.home-head-glass']);
      check(`${tag}：招牌在、「Slides」在（尺子）`, res.found && res.titles >= 1, `${res.titles ?? 0} 个`);
      check(`${tag}：招牌里没有线`, res.found && res.lines.length === 0, res.lines.join(' ｜ '));
      const m = await page.evaluate(MAST);
      const want = m && m.wideLow ? GAP.wideLow : GAP.normal;
      check(`${tag}：线那一截还在——字到 tagline ${want}px${m && m.wideLow ? '（横屏主菜单那一档）' : ''}`, !!m && Math.abs(m.gap - want) <= TOL, m ? `${m.gap.toFixed(2)}px` : '量不到');
    } catch (e) {
      check(`${tag}：打开`, false, e.message.split('\n')[0]);
    }
    check(`${tag}：没有页面错误`, errors.length === 0, errors.join(' ｜ '));
    await ctx.close();
  }
}

// ── ② 邀请窗 ─────────────────────────────────────────────────────────────
console.log('\n② 邀请窗');
{
  const { ctx, page, errors } = await openCtx(390, 844, { signedIn: false });
  try {
    await page.click('#navProfile');
    await page.waitForSelector('#becomeGeniusBtn', { timeout: 10000 });
    await page.click('#becomeGeniusBtn');
    await page.waitForSelector('.invite-modal .invite-title', { timeout: 5000 });
    await page.waitForTimeout(250);
    for (const mode of MODES) {
      await setMode(page, mode);
      const res = await page.evaluate(LINES, ['.invite-modal', '.invite-title', null]);
      const titleOnly = res.lines.filter((l) => l.startsWith('h2'));
      check(`${mode} 邀请窗：抬头在（尺子）`, res.found && res.titles === 1, `${res.titles ?? 0} 个`);
      check(`${mode} 邀请窗：抬头没有线`, titleOnly.length === 0, titleOnly.join(' ｜ '));
    }
    await setMode(page, '浅色');
    const gap = await page.evaluate(() => {
      const t = document.querySelector('.invite-modal .invite-title');
      const body = document.querySelector('.invite-modal .invite-body');
      const cs = getComputedStyle(t);
      const r = t.getBoundingClientRect();
      return body.getBoundingClientRect().top - (r.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth));
    });
    check('邀请窗：抬头的字到吉祥物和货单那一块还隔着 20px（线和垫着它的那一截并进了外边距）', Math.abs(gap - 20) <= TOL, `${gap.toFixed(2)}px`);
  } catch (e) {
    check('邀请窗：打开', false, e.message.split('\n')[0]);
  }
  check('邀请窗：没有页面错误', errors.length === 0, errors.join(' ｜ '));
  await ctx.close();
}

// ── ③ 底排 ───────────────────────────────────────────────────────────────
console.log('\n③ 主菜单底排那块圆角板');
for (const size of [SIZES[0], SIZES[2]]) {
  const { ctx, page, errors } = await openCtx(size.w, size.h);
  for (const mode of MODES) {
    await setMode(page, mode);
    const d = await page.evaluate(() => {
      const dock = document.querySelector('.home-nav-dock');
      if (!dock) return null;
      const cs = getComputedStyle(dock);
      const layers = (cs.boxShadow === 'none' ? '' : cs.boxShadow).split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
      const nums = (s) => (s.match(/-?[\d.]+px/g) || []).map(parseFloat);
      // 「只有扩散、没有偏移和模糊」的那一层就是一圈描边
      const rings = layers.filter((s) => { const n = nums(s); return n.length >= 4 && n[0] === 0 && n[1] === 0 && n[2] === 0 && n[3] > 0; });
      const soft = layers.filter((s) => { const n = nums(s); return !/inset/.test(s) && (n[2] || 0) >= 8; });
      const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`border${s}Width`]) || 0);
      const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const a = rgb(cs.backgroundColor);
      const b = rgb(getComputedStyle(document.body).backgroundColor);
      const r = dock.getBoundingClientRect();
      return { rings, soft: soft.length, bw, delta: a.length === 3 && b.length === 3 ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : -1, shown: r.width > 0 && r.height > 0 };
    });
    const tag = `${size.n} ${mode}`;
    check(`${tag}：底排在（尺子）`, !!d && d.shown);
    if (!d) continue;
    check(`${tag}：底排没有那圈硬边（box-shadow 里没有只扩散的那一层）`, d.rings.length === 0, d.rings.join(' ｜ '));
    check(`${tag}：底排四边没有 border`, d.bw.every((w) => w === 0), d.bw.join('/'));
    check(`${tag}：底排还看得出是一块板（软投影在、底色和页面不一样）`, d.soft >= 1 && d.delta >= 12, `软投影 ${d.soft} 层，底色差 ${d.delta}`);
  }
  check(`${size.n} 底排：没有页面错误`, errors.length === 0, errors.join(' ｜ '));
  await ctx.close();
}

// ── ④ 别的标题 ───────────────────────────────────────────────────────────
console.log('\n④ 别的窗和页上的标题');
const TITLE_SEL = 'h1, h2, h3, [class*="title"]';
const OTHERS = [
  { n: '游戏规则', open: fromProfile('#rulesRow', '.rules-modal'), scope: '.rules-modal' },
  // 联系与特别感谢、游戏规则、隐私政策用的是同一扇 .rules-modal（ui/accountPage.ts），一次只开一扇
  { n: '联系与特别感谢', open: fromProfile('#contactThanksRow', '.rules-modal'), scope: '.rules-modal' },
  { n: '隐私政策', open: fromProfile('[data-legal="privacy"]', '.rules-modal'), scope: '.rules-modal' },
  {
    n: '累计得分（点开的大卡）',
    open: async (p) => {
      await p.click('#navRecords');
      await p.waitForSelector('#totalCard', { timeout: 10000 });
      await p.click('#totalCard');
      await p.waitForSelector('.total-card--big .total-card-title', { timeout: 10000 });
    },
    scope: '.total-card--big',
  },
];
for (const o of OTHERS) {
  const { ctx, page, errors } = await openCtx(390, 844);
  try {
    await o.open(page);
    await page.waitForTimeout(300);
    for (const mode of MODES) {
      await setMode(page, mode);
      // 只量标题本身（窗里的输入框、行与行之间的分隔都不是标题）：把标题挑出来，一个一个当 scope 量
      const res = await page.evaluate(([scopeSel, sel]) => {
        const scope = document.querySelector(scopeSel);
        if (!scope) return null;
        const ts = [...scope.querySelectorAll(sel)].filter((t) => {
          const cs = getComputedStyle(t);
          const r = t.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        });
        return ts.map((t, i) => { t.dataset.titleProbe = String(i); return i; });
      }, [o.scope, TITLE_SEL]);
      check(`${o.n} ${mode}：窗在、标题量到了（尺子）`, Array.isArray(res) && res.length >= 1, Array.isArray(res) ? `${res.length} 个标题` : '没打开');
      if (!Array.isArray(res) || !res.length) continue;
      const lines = [];
      for (const i of res) {
        const r = await page.evaluate(LINES, [`${o.scope} [data-title-probe="${i}"]`, `[data-title-probe="${i}"]`, null]);
        // LINES 的 titleSel 是在 scope 里面找的，标题自己就是 scope——text-decoration 单独量
        const deco = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).textDecorationLine, `${o.scope} [data-title-probe="${i}"]`);
        if (/underline|overline|line-through/.test(deco)) r.lines.push(`text-decoration ${deco}`);
        lines.push(...r.lines);
      }
      check(`${o.n} ${mode}：标题上没有线`, lines.length === 0, lines.join(' ｜ '));
    }
  } catch (e) {
    check(`${o.n}：打开`, false, e.message.split('\n')[0]);
  }
  check(`${o.n}：没有页面错误`, errors.length === 0, errors.join(' ｜ '));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} 条过，${fail} 条红`);
process.exit(fail ? 1 : 0);
