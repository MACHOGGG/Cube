/**
 * 挑形状那几屏：整块往上摆，而且四屏摆得一样（E20「选形状屏上移」）。
 *
 *   node xhs/check-pickup.mjs           # 要先出一次包和预览页，见下
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一道
 *
 * 这一端有四屏是「先挑方块还是小球」——炸弹（xhs/src/shapePick.ts）、老虎机、无限
 * 反转、步步为营（后三屏直接用网页版那几个页面）。四屏共用同一套骨架
 * `.app.slot-page > .start-stage > .start-count.slot-pick-area`，而那一块原先是
 * **上下居中**的：这几屏没有上半那块 `.start-emblem`，于是它一个人吃掉从招牌下沿到
 * 底排之间的全部高度，两张图被摆在 604px 的正中（390×844 上量到 314–480），上面空
 * 着整整一片，底下那颗《退出》却还钉在 726。玩家的话是「选形状屏上移」。
 *
 * 改动本身只有一条 CSS（xhs/src/pages.css），而它能坏的三种样子**都不报错**：
 *
 *   · 被别的规则压掉 / 写错选择器 —— 四屏照旧沉在下半截，屏幕上和改之前一模一样。
 *   · 只对上了其中一两屏 —— 四屏前后脚点开，一屏高一屏低，比四屏都低更显眼。
 *   · **漏了那道 `orientation: portrait`** —— 横屏那一档 `.start-count` 的高度是内容
 *     高、一点富余都没有，再加 10vh 的上内边距，底下那行标语会被顶出屏幕。
 *
 * 所以这一道量三件事：竖屏真的上去了、四屏一样高、横屏一个像素都没动。
 *
 * 第 18 推：《退出》换成全站统一的那颗（.page-exit，钉在屏幕上、离底 116）。量它的那几条跟
 * 着改——竖屏多量一条「是统一的那一颗」；横屏那条「还在屏高 57.2% 那个老位置」换成「整块
 * 在《退出》上面、不压它」（老位置是《退出》还在流里、排在图右边时的位置）。
 *
 * 跑之前要先出一次包和预览页（读的是 xhs/preview.html，那是构建产物，不在仓库里）：
 *
 *   npm run build:xhs && node xhs/preview.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePreview } from './ensurePreview.mjs';

const here = dirname(fileURLToPath(import.meta.url));
await ensurePreview();
const PAGE = pathToFileURL(join(here, 'preview.html')).href;

let fails = 0;
const say = (ok, name, extra = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

/** 主菜单上那四张卡的下标（和 xhs/src/menu.ts 的 CARDS 同序）。 */
const PICKS = [
  { i: 2, name: '炸弹' },
  { i: 3, name: '老虎机' },
  { i: 4, name: '无限反转' },
  { i: 5, name: '步步为营' },
];

async function measure(browser, w, h, idx) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  // 教学那两格先填上，免得点方块/小球落在分镜动画上（和 check-oldcss 同一个理由）。
  await ctx.addInitScript(`try {
    localStorage.setItem('slides.xhs.story.square', '1');
    localStorage.setItem('slides.xhs.story.circle', '1');
  } catch (e) {}`);
  const p = await ctx.newPage();
  await p.goto(PAGE);
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  await p.waitForTimeout(700);
  await p.$$eval('.home-icon-btn', (e, i) => e[i].click(), idx);
  // 老虎机那一屏进去先有一段转场，多等一会儿。
  await p.waitForTimeout(idx === 3 ? 1400 : 900);
  const m = await p.evaluate(() => {
    const box = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
        w: r.width, h: r.height };
    };
    const area = document.querySelector('.slot-pick-area');
    return {
      vh: window.innerHeight,
      // 那一截上内边距本身。几何那几条看的是结果，这一条看的是**原因**——横屏那一档
      // 多出 39px 之后整块只是往下挪了二十来像素，几何上还在「大概那个位置」，而规则
      // 其实已经漏到横屏去了。
      padTop: area ? Math.round(parseFloat(getComputedStyle(area).paddingTop)) : -1,
      // 尺子：这一屏真的画出了两张可点的图。量到的要是空气，下面几条全是空绿。
      opts: document.querySelectorAll('.slot-pick-opt').length,
      row: box('.slot-pick-row'),
      tag: box('.tag-line') || box('.slot-tagline'),
      // 《退出》第 18 推起是全站统一的那颗 .page-exit：钉在屏幕上，不在内容流里（从前是
      // 流里最底下那一行 .start-actions）。
      acts: box('.page-exit'),
      vw: window.innerWidth,
      stage: box('.start-stage'),
    };
  });
  await ctx.close();
  return m;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ── 竖屏 390×844：上去了，而且四屏一样 ──────────────────────────────
console.log('\n---- 竖屏 390×844 ----');
const tall = [];
for (const pick of PICKS) {
  const m = await measure(browser, 390, 844, pick.i);
  tall.push({ ...pick, ...m });
  say(m.opts === 2 && !!m.row && !!m.tag, `${pick.name}：（尺子）两张图和那行标语都在`, `${m.opts} 张`);
  if (!m.row || !m.tag) continue;
  const mid = (m.row.top + m.row.bottom) / 2;
  /**
   * 「上移」量成一个数：两张图的中心要落在屏高的 **28%–40%** 之间。
   *
   * 下界 40%：改之前量到的是 47.6%，而「居中」在任何屏高上都是 50% 上下——所以 40%
   * 这条线一过，就说明真的离开了「居中」那个摆法，不是差几个像素的抖动。
   * 上界 28%：再高就贴到招牌那一带去了（`.start-stage` 从 68 起），而且底下会空出
   * 大半屏。这一条拦的是「10vh 哪天被改成 30vh」。
   */
  say(mid / m.vh > 0.28 && mid / m.vh < 0.40,
    `${pick.name}：两张图落在屏高的 28%–40% 之间（原先是 47.6%，居中）`,
    `中心 ${Math.round(mid)} / ${m.vh} ＝ ${(mid / m.vh * 100).toFixed(1)}%`);
  say(m.row.top > m.stage.top + 20,
    `${pick.name}：没贴到顶上去（和 .start-stage 的上沿还隔着一道）`,
    `图顶 ${m.row.top} / 舞台顶 ${m.stage.top}`);
  say(!!m.acts && m.tag.bottom < m.acts.top - 40,
    `${pick.name}：标语和底下那颗《退出》之间留得下 40px`,
    m.acts ? `标语底 ${m.tag.bottom} / 键顶 ${m.acts.top}` : '没有《退出》');
  // 第 18 推：那颗《退出》是全站统一的那一颗——62px、水平正中、离底 116（安全区报 0 时）。
  say(!!m.acts && Math.abs(m.acts.w - 62) <= 0.5 && Math.abs(m.acts.h - 62) <= 0.5 &&
      Math.abs((m.acts.left + m.acts.right) / 2 - m.vw / 2) <= 1 && Math.abs(m.vh - m.acts.bottom - 116) <= 1,
    `${pick.name}：《退出》是统一的那一颗（62px、正中、离底 116）`,
    m.acts ? `${m.acts.w.toFixed(1)}×${m.acts.h.toFixed(1)}，中心 x ${((m.acts.left + m.acts.right) / 2).toFixed(1)}，离底 ${m.vh - m.acts.bottom}` : '没有');
  // 10vh ＝ 84px（844 高）。给 ±4px 的余量，别钉死一个像素。
  say(Math.abs(m.padTop - m.vh * 0.1) <= 4,
    `${pick.name}：上内边距就是那 10vh`, `${m.padTop}px（10vh ＝ ${Math.round(m.vh * 0.1)}px）`);
}
const tops = tall.filter((t) => t.row).map((t) => t.row.top);
say(tops.length === PICKS.length && Math.max(...tops) - Math.min(...tops) <= 12,
  '四屏摆得一样高（差不到 12px）', tops.join(' / '));

// ── 横屏 844×390：一个像素都不许跟着动 ──────────────────────────────
//
// 横屏走的是另一套排布（src/style.css 的 `landscape and max-height: 560px`）：
// `.start-count` 的高度收成内容高，一点富余都没有。那道 `orientation: portrait` 要是
// 漏了，这儿的标语会被顶出 `.start-stage` 去。
console.log('\n---- 横屏 844×390（这一档不该跟着改）----');
for (const pick of PICKS) {
  const m = await measure(browser, 844, 390, pick.i);
  say(m.opts === 2 && !!m.row && !!m.tag, `${pick.name}：（尺子）两张图和那行标语都在`, `${m.opts} 张`);
  if (!m.row || !m.tag) continue;
  say(m.tag.bottom <= m.stage.bottom,
    `${pick.name}：标语还在舞台里（没被上内边距顶出去）`,
    `标语底 ${m.tag.bottom} / 舞台底 ${m.stage.bottom}`);
  /**
   * 横屏这一档量**两件事**，缺一条就拦不住「漏了那道 orientation: portrait」。
   *
   * 几何那一条自己不够：横屏 10vh 只有 39px，`.start-count` 在那一档是 `flex: 0 0 auto`
   * ＋ 整行上下居中，加 39px 之后整块只往下挪二十来像素（57.2% → 62%），看着还「在那
   * 一带」。反证实测：只留几何那一条时，这个破坏一条都红不了。所以直接量那截内边距
   * 在不在——那才是规则本身。
   */
  say(m.padTop === 0,
    `${pick.name}：横屏没有那截上内边距（那道 orientation: portrait 还在）`, `${m.padTop}px`);
  const mid = (m.row.top + m.row.bottom) / 2;
  say(Math.abs(mid / m.vh - 0.572) < 0.025,
    `${pick.name}：还是横屏那个老位置（屏高的 57.2%）`,
    `中心 ${Math.round(mid)} / ${m.vh} ＝ ${(mid / m.vh * 100).toFixed(1)}%`);
  /*
   * 第 18 推：《退出》换成全站统一的那颗之后，横屏不能照竖屏的位置摆（离底 116 起，页底
   * 让出 194——390 高的横屏里两张图和标语就挤不下了，第一版量到整页被撑长 89px、《退出》
   * 压在标语和图上）。横屏它站到右边、上下居中（和改版前那颗键排在图右边是同一个排法）。
   * 量的是：它在右边、上下居中、和两张图、标语一个像素都不相交（左右还隔着 16px）。
   */
  const contentRight = Math.max(m.row.right, m.tag.right);
  say(!!m.acts && m.acts.left >= contentRight + 16 && Math.abs((m.acts.top + m.acts.bottom) / 2 - m.vh / 2) <= 1,
    `${pick.name}：横屏《退出》在右边、上下居中，不压两张图和标语`,
    m.acts ? `键 ${m.acts.left}–${m.acts.right} × ${m.acts.top}–${m.acts.bottom} / 内容右沿 ${contentRight}` : '没有《退出》');
  say(m.vh >= m.stage.bottom, `${pick.name}：横屏一屏装下（舞台底 ≤ 屏高）`, `${m.stage.bottom} / ${m.vh}`);
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
