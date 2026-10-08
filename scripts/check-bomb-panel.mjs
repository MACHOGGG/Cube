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
 * ④ **面板左边那一列：三枚小图标，没有字**（10-08 方案 3-G：「『基础/计时/进阶』删文字、各
 *    配小图标」）。从前那一列是三个字（四种语言各一套）；现在一档一枚 ctlIcons 那一套圆盘
 *    （iconFor({ mode }) 取的），三枚互不相同、四种语言一模一样，整个在面板左边外面、每一枚和
 *    自己那一排上下居中（≤ 1px）、记号是 --ink-soft、aria-hidden（每一格的读屏名里已经带着这
 *    一档）。面板里、那一列里一个字都没有。
 * ⑤ **经过、按下、键盘聚焦**：底板变 --card-red，加一圈 3px 白边，整格放大到 1.04；减弱动
 *    态效果时不放大。三种状态各量一遍。
 * ⑥ **一整页，和老虎机那一页同一副版式**（10-08 方案 3-G：「炸弹选择改全屏第二层——复用老虎
 *    机/步步为营现成的第二层组件，不新写层；整层放大到与老虎机层一致版式」）：骨架是
 *    .slot-page ＋ .start-stage ＋ .slot-pick-area，主菜单不在底下垫着（不再是压暗主菜单上的一扇
 *    窗）；页底那颗《退出》和老虎机那一页那颗在同一个地方、一样大；一格不小于老虎机那一页一
 *    张图的七成五（从前那扇窗里 87 对 156）；整块摆得下——不出屏、压不到《退出》。手机两档、电
 *    脑一档，横屏矮屏一档。
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

const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 走到炸弹那一页（点开主菜单上那张炸弹卡）。 */
async function openPanel(width = 390, height = 844, lang = 'zhHans', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', isMobile: width < 800, hasTouch: width < 800 });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate((l) => {
    localStorage.setItem('slides_lang', l);
    localStorage.setItem('slides_know_how', '1');
    // 玩过一局才摆得出炸弹那一档（和 check-mode-axis 同一个前提）。
    localStorage.setItem('slides_played_square', '1');
    localStorage.setItem('slides_played_finished', '1');
  }, lang);
  await page.reload();
  await page.waitForSelector('.home-icon-btn, .home-bomb-card, .home-bomb-mini', { timeout: 25000 });
  /*
   * ⚠️ **用 `el.click()` 而不是 Playwright 的 `.click()`**。主菜单在手机档是一条鱼眼滚轴，
   * 炸弹那张卡在屏幕外——Playwright 会「滚进视口再点」，可那条轴不是普通滚动容器，滚不
   * 动，于是它重试到超时。这儿要量的是「点下去开不开」，不是卡在第几个位置。
   */
  await page.evaluate(() => document.querySelector('.home-bomb-mini, .home-bomb-card')?.click());
  await page.waitForSelector('.bomb-page .bomb-panel', { timeout: 10000 });
  // 换页那一下（softSwap：旧的淡出、新的托上来）落定。
  await page.waitForTimeout(600);
  return { ctx, page };
}

/** 量：面板、星、三排、每一格的底板颜色和画布、左边那三个字。 */
const MEASURE = () => {
  const p = document.querySelector('.bomb-page .bomb-panel');
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
      // 那一枚图标本身的框（不是那一格）。
      const svg = t.querySelector('svg');
      const ib = (svg ?? t).getBoundingClientRect();
      const mark = svg?.querySelector('path, circle:not(:first-child)');
      return {
        text: t.textContent.trim(),
        icon: svg ? svg.outerHTML : '',
        glyph: !!svg && svg.classList.contains('ctl-glyph'),
        w: ib.width,
        cy: ib.top + ib.height / 2, r: ib.right, l: ib.left,
        color: mark ? getComputedStyle(mark).stroke : '',
      };
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

// ── ②③④ 颜色、格子、左边那一列小图标（四种语言 × 两个尺寸；色盲另量一遍）────────
let tierIcons = null;
for (const [w, h] of [[390, 844], [360, 740]]) {
  for (const lang of LANGS) {
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
    // ④ 左边那一列：三枚小图标，没有字
    check(`${tag}：④ 三枚小图标（ctlIcons 那一套圆盘），互不相同`,
      m.tiers.length === 3 && m.tiers.every((t) => t.glyph) && new Set(m.tiers.map((t) => t.icon)).size === 3,
      m.tiers.map((t) => (t.glyph ? '圆盘' : '不是')).join(' / '));
    check(`${tag}：④ 那一列一个字都没有（三个字撤了）`, m.tiers.every((t) => t.text === ''), m.tiers.map((t) => t.text).join(' | ') || '（没有）');
    // 四种语言一模一样：图标不跟语言走（「省掉一组四语文案」）。
    const sig = m.tiers.map((t) => t.icon).join('\n');
    if (tierIcons === null) tierIcons = sig;
    check(`${tag}：④ 和别的语言是同三枚`, sig === tierIcons);
    check(`${tag}：④ 都在面板左边外面`, m.tiers.length === 3 && m.tiers.every((t) => t.r <= m.panel.l - 4 && t.l >= 0),
      m.tiers.map((t) => `${t.l.toFixed(0)}–${t.r.toFixed(0)}`).join(' / ') + ` · 面板左沿 ${m.panel.l.toFixed(0)}`);
    const off = m.tiers.map((t, i) => Math.abs(t.cy - (m.rows[i]?.cy ?? -999)));
    check(`${tag}：④ 每一枚和自己那一排上下居中（≤ 1px）`, off.length === 3 && off.every((d) => d <= 1), off.map((d) => d.toFixed(2)).join(' / '));
    check(`${tag}：④ 记号是 --ink-soft（和从前那三个字一个颜色）`, m.tiers.every((t) => t.color === hexToRgbStr(m.inkSoft)), `${m.tiers[0]?.color} / ${m.inkSoft}`);
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
  const SEL = '.bomb-page .bomb-row--timed .bomb-chip';
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
    await k.page.evaluate(() => document.querySelector('.bomb-page .bomb-row--basic .bomb-chip:last-child').focus());
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
    const panel = '.bomb-page .bomb-panel';
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
    // 进了一局：棋盘那一层出来了，而且炸弹那一页不在了。
    const started = await page
      .waitForFunction(() => Boolean(document.querySelector('.board, #board, .game-page, #startOverlay')) &&
        !document.querySelector('.mode-axis') && !document.querySelector('.bomb-page'), null, { timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    check(`① 第 ${row + 1} 行第 ${col + 1} 枚：点一下就进了一局`, started);
    await ctx.close();
  }
}

// ── ⑥ 一整页，和老虎机那一页同一副版式 ─────────────────────────────
//
// 尺子是同一块屏幕上的老虎机那一页（主菜单「老虎机模式」→ 挑图形那一页）：《退出》在哪、多大，一张
// 图多大。天才身份写在本地缓存里（老虎机要开通才按得进去）。
const LAYOUT = () => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const chip = document.querySelector('.bomb-page .bomb-chip');
  return {
    page: !!document.querySelector('.app.slot-page.bomb-page > .start-stage > .start-count.slot-pick-area .bomb-panel'),
    menu: !!document.querySelector('.mode-axis, .home-grid, .center-pick'),
    exit: box(document.querySelector('.slot-page .page-exit')),
    panel: box(document.querySelector('.bomb-page .bomb-panel')),
    tiers: box(document.querySelector('.bomb-page .bomb-tiers')),
    chip: box(chip),
    opt: box(document.querySelector('.slot-pick-opt')),
    vw: document.documentElement.clientWidth,
    vh: innerHeight,
    scrollW: document.documentElement.scrollWidth,
  };
};
for (const [w, h, label] of [[390, 844, '手机 390×844'], [360, 640, '手机 360×640'], [1280, 800, '电脑 1280×800'], [844, 390, '横屏 844×390']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800 || h < 500, hasTouch: w < 800 || h < 500 });
  await ctx.addInitScript(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
    localStorage.setItem('slides_played_square', '1');
    localStorage.setItem('slides_played_finished', '1');
    for (const k of ['bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout']) localStorage.setItem('slides_played_' + k, '1');
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'BOMBCHK' }));
  });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 25000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.home-icon-btn')].find((b) => (b.getAttribute('aria-label') || '').startsWith('老虎机模式'))?.click());
  await page.waitForSelector('.slot-pick-opt', { timeout: 10000 });
  await page.waitForTimeout(600);
  const slot = await page.evaluate(LAYOUT);
  await page.goto(base);
  await page.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 25000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.home-bomb-mini, .home-bomb-card')?.click());
  await page.waitForSelector('.bomb-page .bomb-chip', { timeout: 10000 });
  await page.waitForTimeout(600);
  const bomb = await page.evaluate(LAYOUT);
  await ctx.close();
  check(`⑥ ${label}：（尺子）老虎机那一页量到了《退出》和一张图`, !!slot.exit && !!slot.opt, JSON.stringify({ exit: slot.exit, opt: slot.opt }));
  check(`⑥ ${label}：一整页（.slot-page 骨架），主菜单不在底下垫着`, bomb.page && !bomb.menu);
  check(`⑥ ${label}：《退出》和老虎机那一页那颗同一个地方、一样大（≤1px）`,
    !!bomb.exit && !!slot.exit && ['l', 't', 'w', 'h'].every((k) => Math.abs(bomb.exit[k] - slot.exit[k]) <= 1),
    `炸弹 ${JSON.stringify(bomb.exit)} ｜ 老虎机 ${JSON.stringify(slot.exit)}`);
  check(`⑥ ${label}：一格不小于老虎机那一页一张图的七成五`, !!bomb.chip && !!slot.opt && bomb.chip.w >= slot.opt.w * 0.75,
    `一格 ${bomb.chip?.w.toFixed(1)} ｜ 老虎机一张 ${slot.opt?.w.toFixed(1)}（${bomb.chip && slot.opt ? ((bomb.chip.w / slot.opt.w) * 100).toFixed(0) : '?'}%）`);
  const fits = !!bomb.panel && !!bomb.tiers && !!bomb.exit &&
    bomb.tiers.l >= 0 && bomb.panel.r <= bomb.vw && bomb.panel.t >= 0 && bomb.panel.b <= bomb.vh && bomb.scrollW <= bomb.vw &&
    // 《退出》要么在面板底下（竖屏、电脑：面板底边离它上沿 ≥ 16），要么在面板右边（矮横屏：它站到右边去了）。
    (bomb.panel.b <= bomb.exit.t - 16 || bomb.panel.r <= bomb.exit.l - 16);
  check(`⑥ ${label}：整块摆得下——不出屏、压不到《退出》`, fits,
    `面板 ${bomb.panel ? `${bomb.panel.l.toFixed(0)}–${bomb.panel.r.toFixed(0)} × ${bomb.panel.t.toFixed(0)}–${bomb.panel.b.toFixed(0)}` : '没有'}，《退出》${bomb.exit ? `${bomb.exit.l.toFixed(0)},${bomb.exit.t.toFixed(0)}` : '没有'}，屏 ${bomb.vw}×${bomb.vh}`);
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);
