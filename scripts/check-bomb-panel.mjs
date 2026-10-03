/**
 * 炸弹那一页：三排两格，一点就开（PR-20 / E17；第 18 推按设计图重做，E26 改写）。
 *
 *   node scripts/dev-server.mjs 8876 dist &
 *   node scripts/check-bomb-panel.mjs http://localhost:8876/
 *
 * 真开浏览器：颜色、对齐和「点一下有没有反应」都只在跑起来之后才量得到。
 *
 * ── 守的是什么 ────────────────────────────────────────────────
 *
 * ① **一点就开。** 中间那一档从前是一条宽的星爆徽记，点它只是把那条横杠换成两枚棋盘——
 *    也就是**两次点击**才开得了一局，而上下两行都是一次。这一条量的是：三排六格，**每一
 *    格点下去都真的进了一局**。（第 18 推没动这一条。）
 * ② **颜色按设计图**（第 18 推）：面板 --card-terracotta #CA6039；三排的底板——基础浅灰
 *    #A7A7A7、计时 --card-orange、进阶 --card-gray。量的是**画出来的那一块底板**（每一格
 *    svg 里挂着 .bomb-plate 的那一块）的计算后颜色，值从 style.css 读，门里不抄一份。色盲
 *    模式下一个都不变（方案：删掉 .bomb-panel 的色盲覆盖）。正中一颗白色八角星，aria-hidden，
 *    在面板正中。
 * ③ **格子是哪几副棋盘**：基础、计时两排是基础方块 / 基础小球，进阶那排是菱形方块 / 六边形小
 *    球。量的是 svg 的画布（每张图标文件的 viewBox 各不相同）和读屏名，格子上不再印徽记
 *    （从前定时那两枚印「100s」、进阶那两枚印「+++」，第 18 推撤了）。
 * ④ **面板左边那三个字**：「基础 / 计时 / 进阶」（四种语言），整个在面板左边外面、每个字
 *    和自己那一排上下居中（≤ 1px）、颜色是 --ink-soft、aria-hidden（每一格的读屏名里已经带
 *    着这一档）。面板里除了这三个字没有别的字。
 * ⑤ **经过、按下、键盘聚焦**：底板变 --card-red，加一圈 3px 白边，整格放大到 1.04；减弱动
 *    态效果时不放大。三种状态各量一遍。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
if (!base) {
  console.error('用法: node scripts/check-bomb-panel.mjs http://localhost:<端口>/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

/** 颜色都从 style.css 的 :root 读——门里不抄一份，抄一份就会和代码走散。 */
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const token = (name) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1] ?? '';
const HEX = {
  panel: token('--card-terracotta'),
  basic: token('--card-ash'),
  timed: token('--card-orange'),
  advanced: token('--card-gray'),
  red: token('--card-red'),
};
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
check('（尺子）五个颜色都从 style.css 读到了', Object.values(HEX).every((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
  Object.entries(HEX).map(([k, v]) => `${k}=${v}`).join(' '));
check('② 面板和三排底板就是设计图那几个值',
  HEX.panel.toUpperCase() === '#CA6039' && HEX.basic.toUpperCase() === '#A7A7A7' &&
    HEX.timed.toUpperCase() === '#F7821B' && HEX.advanced.toUpperCase() === '#4C4C4C' && HEX.red.toUpperCase() === '#BE411A',
  Object.values(HEX).join(' '));

/** 每张图标文件的画布：格子里是哪一副棋盘，就看它。 */
const viewBoxOf = (file) => /viewBox="([^"]+)"/.exec(readFileSync(new URL(`../src/assets/icons/${file}.svg`, import.meta.url), 'utf8'))?.[1] ?? '';
const VB = {
  square: viewBoxOf('base-square'),
  circle: viewBoxOf('base-circle'),
  diamond: viewBoxOf('layout-squareDiamond'),
  hex: viewBoxOf('layout-circleHex'),
};
check('（尺子）四张图标的画布都读到了，而且互不相同',
  Object.values(VB).every(Boolean) && new Set(Object.values(VB)).size === 4, Object.values(VB).join(' | '));

const LABELS = {
  zhHans: ['基础', '计时', '进阶'],
  zhHant: ['基礎', '計時', '進階'],
  en: ['Basic', 'Timed', 'Advanced'],
  fr: ['Base', 'Chrono', 'Avancée'],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 走到炸弹那一页（点开主菜单上那张炸弹卡）。 */
async function openPanel(width = 390, height = 844, lang = 'zhHans', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate((l) => {
    localStorage.setItem('slides_lang', l);
    localStorage.setItem('slides_know_how', '1');
    // 玩过一局才摆得出炸弹那一档（和 check-mode-axis 同一个前提）。
    localStorage.setItem('slides_played_square', '1');
  }, lang);
  await page.reload();
  await page.waitForSelector('.home-icon-btn, .home-bomb-card, .home-bomb-mini', { timeout: 25000 });
  /*
   * ⚠️ **用 `el.click()` 而不是 Playwright 的 `.click()`**。主菜单在手机档是一条鱼眼滚轴，
   * 炸弹那张卡在屏幕外——Playwright 会「滚进视口再点」，可那条轴不是普通滚动容器，滚不
   * 动，于是它重试到超时。这儿要量的是「点下去开不开」，不是卡在第几个位置。
   */
  await page.evaluate(() => document.querySelector('[data-reopen="bomb"]')?.click());
  await page.waitForSelector('.bomb-panel--big', { timeout: 10000 });
  // 等飞进来那一段落定（FLIP，380ms）。
  await page.waitForTimeout(700);
  return { ctx, page };
}

/** 量：面板、星、三排、每一格的底板颜色和画布、左边那三个字。 */
const MEASURE = () => {
  const p = document.querySelector('.bomb-panel--big');
  const pr = p.getBoundingClientRect();
  const rows = [...p.querySelectorAll(':scope > .bomb-row')];
  const star = p.querySelector('.bomb-star');
  const starSvg = star?.querySelector('svg');
  const sr = star?.getBoundingClientRect();
  const tiers = [...document.querySelectorAll('.bomb-pick .bomb-tier')];
  const tierBox = document.querySelector('.bomb-pick .bomb-tiers');
  return {
    panelBg: getComputedStyle(p).backgroundColor,
    panel: { l: pr.left, r: pr.right, t: pr.top, b: pr.bottom, cx: pr.left + pr.width / 2, cy: pr.top + pr.height / 2 },
    star: star
      ? {
          hidden: star.getAttribute('aria-hidden') === 'true',
          fill: starSvg?.querySelector('polygon') ? getComputedStyle(starSvg.querySelector('polygon')).fill : '',
          cx: sr.left + sr.width / 2, cy: sr.top + sr.height / 2, w: sr.width,
        }
      : null,
    rows: rows.map((r) => {
      const rr = r.getBoundingClientRect();
      return {
        cy: rr.top + rr.height / 2,
        cells: [...r.querySelectorAll('.bomb-chip')].map((c) => {
          const plate = c.querySelector('.bomb-plate');
          return {
            label: c.getAttribute('aria-label') || '',
            viewBox: c.querySelector('svg')?.getAttribute('viewBox') || '',
            plate: plate ? getComputedStyle(plate).fill : '(没有底板)',
            texts: [...c.querySelectorAll('text')].map((t) => t.textContent.trim()).filter(Boolean),
          };
        }),
      };
    }),
    tiers: tiers.map((t) => {
      const b = t.getBoundingClientRect();
      // 字本身的框（不是那一格）：用一个 Range 量文字。
      const range = document.createRange();
      range.selectNodeContents(t);
      const tb = range.getBoundingClientRect();
      return { text: t.textContent.trim(), cy: tb.top + tb.height / 2, r: tb.right, l: tb.left, color: getComputedStyle(t).color, cellCy: b.top + b.height / 2 };
    }),
    tiersHidden: tierBox?.getAttribute('aria-hidden') === 'true',
    inkSoft: getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim(),
    // 面板里所有看得见的字（svg 之外的文字节点）。
    words: [...p.querySelectorAll('*')]
      .filter((e) => !e.closest('svg'))
      .flatMap((e) => [...e.childNodes])
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()),
    vw: innerWidth,
  };
};

const hexToRgbStr = (hex) => {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};

// ── ②③④ 颜色、格子、左边那三个字（四种语言 × 两个尺寸；色盲另量一遍）────────
for (const [w, h] of [[390, 844], [360, 740]]) {
  for (const lang of Object.keys(LABELS)) {
    const tag = `${w}×${h} ${lang}`;
    const { ctx, page } = await openPanel(w, h, lang);
    const m = await page.evaluate(MEASURE);
    check(`${tag}：（尺子）那一页开出来了，三排`, m.rows.length === 3, String(m.rows.length));
    check(`${tag}：① 三排各两格`, m.rows.map((r) => r.cells.length).join(' ') === '2 2 2', m.rows.map((r) => r.cells.length).join(' '));
    check(`${tag}：② 面板是 --card-terracotta`, m.panelBg === rgb(HEX.panel), m.panelBg);
    const want = [HEX.basic, HEX.timed, HEX.advanced].map(rgb);
    const names = ['基础（浅灰）', '计时（--card-orange）', '进阶（--card-gray）'];
    for (let i = 0; i < 3; i++) {
      const plates = (m.rows[i]?.cells ?? []).map((c) => c.plate);
      check(`${tag}：② 第 ${i + 1} 排的底板是 ${names[i]}`, plates.length === 2 && plates.every((f) => f === want[i]), plates.join(' / '));
    }
    check(`${tag}：② 正中一颗白色八角星，aria-hidden`,
      !!m.star && m.star.hidden && m.star.fill === 'rgb(255, 255, 255)' &&
        Math.abs(m.star.cx - m.panel.cx) <= 1 && Math.abs(m.star.cy - m.panel.cy) <= 1,
      m.star ? `fill ${m.star.fill}，中心偏 ${(m.star.cx - m.panel.cx).toFixed(1)},${(m.star.cy - m.panel.cy).toFixed(1)}` : '没有星');
    const vbs = m.rows.map((r) => r.cells.map((c) => c.viewBox));
    check(`${tag}：③ 基础那排是基础方块 / 基础小球`, (vbs[0] ?? []).join('|') === `${VB.square}|${VB.circle}`, (vbs[0] ?? []).join(' | '));
    check(`${tag}：③ 计时那排是基础方块 / 基础小球`, (vbs[1] ?? []).join('|') === `${VB.square}|${VB.circle}`, (vbs[1] ?? []).join(' | '));
    check(`${tag}：③ 进阶那排是菱形方块 / 六边形小球`, (vbs[2] ?? []).join('|') === `${VB.diamond}|${VB.hex}`, (vbs[2] ?? []).join(' | '));
    const texts = m.rows.flatMap((r) => r.cells.flatMap((c) => c.texts));
    check(`${tag}：③ 格子上不再印徽记（100s / +++ 撤了）`, texts.length === 0, texts.join(' | ') || '（没有）');
    check(`${tag}：③ 每一格都有读屏名`, m.rows.every((r) => r.cells.every((c) => c.label.includes(' · '))));
    // ④ 左边那三个字
    check(`${tag}：④ 三个字是「${LABELS[lang].join(' / ')}」`, m.tiers.map((t) => t.text).join('/') === LABELS[lang].join('/'), m.tiers.map((t) => t.text).join(' / '));
    check(`${tag}：④ 都在面板左边外面`, m.tiers.length === 3 && m.tiers.every((t) => t.r <= m.panel.l - 4 && t.l >= 0),
      m.tiers.map((t) => `${t.l.toFixed(0)}–${t.r.toFixed(0)}`).join(' / ') + ` · 面板左沿 ${m.panel.l.toFixed(0)}`);
    const off = m.tiers.map((t, i) => Math.abs(t.cy - (m.rows[i]?.cy ?? -999)));
    check(`${tag}：④ 每个字和自己那一排上下居中（≤ 1px）`, off.length === 3 && off.every((d) => d <= 1), off.map((d) => d.toFixed(2)).join(' / '));
    check(`${tag}：④ 颜色是 --ink-soft`, m.tiers.every((t) => t.color === hexToRgbStr(m.inkSoft)), `${m.tiers[0]?.color} / ${m.inkSoft}`);
    check(`${tag}：④ 那一列 aria-hidden（格子的读屏名里已经带着这一档）`, m.tiersHidden);
    check(`${tag}：④ 面板里一个字都没有`, m.words.length === 0, m.words.join(' | ') || '（没有）');
    await ctx.close();
  }
}
// 色盲：颜色一个都不变。
{
  const { ctx, page } = await openPanel(390, 844, 'zhHans');
  const before = await page.evaluate(MEASURE);
  await page.evaluate(() => document.documentElement.setAttribute('data-cvd', '1'));
  await page.waitForTimeout(100);
  const after = await page.evaluate(MEASURE);
  const sig = (m) => JSON.stringify([m.panelBg, m.rows.map((r) => r.cells.map((c) => c.plate))]);
  check('② 色盲模式下面板和三排底板一个颜色都不变', sig(before) === sig(after), `${sig(before)} → ${sig(after)}`);
  await ctx.close();
}

// ── ⑤ 经过、按下、键盘聚焦 ─────────────────────────────────────
{
  const STATE = (sel) => {
    const c = document.querySelector(sel);
    const plate = c.querySelector('.bomb-plate');
    const cs = getComputedStyle(plate);
    const m = getComputedStyle(c).transform;
    // matrix(a, b, c, d, e, f)：a 就是横向放大倍数（没有旋转）。
    const sc = m === 'none' ? 1 : Number(m.slice(7, -1).split(',')[0]);
    return { fill: cs.fill, stroke: cs.stroke, sw: cs.strokeWidth, scale: sc, vfx: cs.vectorEffect };
  };
  const SEL = '.bomb-panel--big .bomb-row--timed .bomb-chip';
  const red = rgb(HEX.red);
  const okState = (s, scale) => s.fill === red && s.stroke === 'rgb(255, 255, 255)' && s.sw === '3px' && s.vfx === 'non-scaling-stroke' && Math.abs(s.scale - scale) < 0.001;
  for (const reduced of [false, true]) {
    const tag = reduced ? '（减弱动态效果）' : '';
    const scale = reduced ? 1 : 1.04;
    const { ctx, page } = await openPanel(390, 844, 'zhHans', { reduced });
    const rest = await page.evaluate(STATE, SEL);
    check(`⑤${tag} 平时：底板是那一排的颜色、没有白边、不放大`, rest.fill === rgb(HEX.timed) && (rest.stroke === 'none' || rest.sw === '0px') && rest.scale === 1, JSON.stringify(rest));
    await page.hover(SEL);
    await page.waitForTimeout(250);
    const hov = await page.evaluate(STATE, SEL);
    check(`⑤${tag} 鼠标经过：底板 --card-red、3px 白边、放大到 ${scale}`, okState(hov, scale), JSON.stringify(hov));
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    // 按下（不松手：松手就开局了）
    const box = await page.$eval(SEL, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.waitForTimeout(250);
    const down = await page.evaluate(STATE, SEL);
    check(`⑤${tag} 按下：底板 --card-red、3px 白边、放大到 ${scale}`, okState(down, scale), JSON.stringify(down));
    await ctx.close();
    // 键盘聚焦：先把焦点放在它前面那一格（基础那排的第二格），再按一下 Tab 走过来——
    // :focus-visible 只认键盘来的焦点，直接 el.focus() 量不到。
    const k = await openPanel(390, 844, 'zhHans', { reduced });
    await k.page.evaluate(() => document.querySelector('.bomb-panel--big .bomb-row--basic .bomb-chip:last-child').focus());
    await k.page.keyboard.press('Tab');
    await k.page.waitForTimeout(250);
    const focused = await k.page.evaluate((sel) => document.activeElement === document.querySelector(sel), SEL);
    const foc = await k.page.evaluate(STATE, SEL);
    check(`⑤${tag} 键盘聚焦：底板 --card-red、3px 白边、放大到 ${scale}`, focused && okState(foc, scale), `${focused ? '' : '（没 Tab 到）'}${JSON.stringify(foc)}`);
    await k.ctx.close();
  }
}

// ── ① 六枚每一枚点下去都真的进了一局 ──────────────────────────
//
// 这一条是整道门的重点，也是最容易写成空绿的一条：只量「有六枚」的话，中间那一层回到「点
// 一下才换成两枚」那个老写法照样绿——那一版屏幕上也是三行，只是中间那行点下去不开局。
// 所以逐枚点，每一枚都要真的离开主菜单、进到棋盘上。
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 2; col++) {
    const { ctx, page } = await openPanel();
    const panel = (await page.$('.bomb-panel--big')) ? '.bomb-panel--big' : '.bomb-panel';
    const found = await page.evaluate(
      ([sel, r, c]) => {
        const chips = document.querySelectorAll(`${sel} .bomb-row:nth-of-type(${r + 1}) .bomb-chip`);
        if (chips.length !== 2) return chips.length;
        chips[c].click();
        return 2;
      },
      [panel, row, col],
    );
    if (found !== 2) {
      check(`① 第 ${row + 1} 行第 ${col + 1} 枚：找得到`, false, `那一行有 ${found} 枚`);
      await ctx.close();
      continue;
    }
    // 进了一局：棋盘那一层出来了，而且主菜单不在了。
    const started = await page
      .waitForFunction(() => Boolean(document.querySelector('.board, #board, .game-page')) &&
        !document.querySelector('.mode-axis'), null, { timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    check(`① 第 ${row + 1} 行第 ${col + 1} 枚：点一下就进了一局`, started);
    await ctx.close();
  }
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);
