/**
 * 教学期间：呼吸灯指对了地方，而且**一下都不拦操作**（E23）。
 *
 *   node scripts/dev-server.mjs 8xxx dist &
 *   node scripts/check-coach-aim.mjs http://localhost:8xxx/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一道，而且为什么它必须开浏览器
 *
 * 教学条本身那条线由 check-coach 管（纯 node、假时钟、自带小 DOM）。这一道管的是那块
 * 假 DOM 量不到的两件事：
 *
 *   ① **灯真的亮在那样东西上。** 类挂没挂得上，假 DOM 答得了；「挂上之后那个元素真的
 *      在动画」要问 `getComputedStyle(el).animationName`，而这需要真的 CSS。两处差一个
 *      选择器就会出现「类挂着、屏幕上什么都没亮」——代码看着对，玩家什么也没看见。
 *   ② **绝不拦操作。** 这是玩家 2026-09-30 点名的那一句（E23）。灯做成盖一层蒙版也能
 *      「亮」，而那一层会把手指吃掉：教学期间棋子拖不动，而且不报任何错。所以这一道
 *      **真的拖一枚棋子**，拖完看盘面变没变。
 *
 * ⚠️ 这一道**什么键都不许预设**（除了语言）。CLAUDE.md 里那五个坑的第四个说的就是
 * 它：预设 `slides_tutorial_seen` 会让 `firstTimeIn` 认成「玩过了」，教学条整个不出
 * 现——而这一道要验的正是它，屏幕上却什么都不报。
 *
 * ── 第 4 条那一步怎么验 ────────────────────────────────────────────
 *
 * 「讲到第 4 条就点亮外边指引带子」要走到那一步，得在浏览器里真的得两次分、再把侵蚀阶
 * 梯降一级——一局随机发牌里凑不出确定的路。所以这一道**不走那条路**，分工是：
 *
 *   · 哪一步挂哪个类  →  check-coach（纯 node、假时钟，逐步对一张表）
 *   · 类挂上之后真的亮不亮、亮了拦不拦手  →  这一道（手动把类挂上去量）
 *
 * 分开量而不是硬凑一局，是因为「硬凑」出来的那一局本身会变成最脆的一环：发牌一换它就
 * 红，而红的是运气不是代码。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.log('用法: node scripts/check-coach-aim.mjs <dev-server 地址>');
  process.exit(1);
}

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
// 语言钉成简体中文（文案那几条按中文量）。**除此之外一个键都不设**，见文件头。
await page.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
  } catch (e) { /* 无痕模式 */ }
});
await page.goto(BASE, { waitUntil: 'load' });

// ── ① 头一回打开 → 主菜单 → 点《经典小球》→ 开局，教学条在 ──────────
//
// 挑小球不挑方块：外边指引那条带子只有外边族那几副棋盘才画（方块 36 是任意整行整列都
// 能消，没有「最外边」这回事），而下面第 ④ 节要量的正是那条带子。
await page.waitForSelector('.mode-axis .home-icon-btn', { timeout: 30000 });
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelectorAll('.mode-axis > .home-icon-btn')[1].click());
await page.waitForTimeout(1200);
const startBtn = await page.$('#startBtn');
check('（尺子）进到了开局页', !!startBtn);
if (startBtn) await page.evaluate(() => document.querySelector('#startBtn').click());
await page.waitForFunction(
  () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
  { timeout: 25000 },
);
await page.waitForTimeout(900);
const bar = await page.$('.coach-bar');
check('头一回玩就有那块教学条（什么键都没预设）', !!bar);
if (!bar) {
  console.log('\n条子都没出来，下面几条没有意义——先看 engine/firstPlay.ts 那一路。');
  await browser.close();
  process.exit(1);
}

const look = () => page.evaluate(() => {
  const stage = document.querySelector('.app--game');
  const texts = [...document.querySelectorAll('.coach-row')]
    .filter((r) => !r.hidden)
    .map((r) => r.querySelector('.coach-text').textContent.trim());
  const anim = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return '（没有这个元素）';
    const cs = getComputedStyle(el);
    // reduced-motion 下不跑动画，改成一发静态的 drop-shadow——两样都算「亮着」。
    return cs.animationName !== 'none' ? cs.animationName : (cs.filter !== 'none' ? 'filter:' + cs.filter : 'none');
  };
  return {
    cls: [...stage.classList].filter((c) => c.startsWith('coach-aim')),
    texts,
    pattern: anim('.hud-block--pattern'),
    band: anim('.edge-band'),
    hasBand: !!document.querySelector('.edge-band'),
  };
});

const first = await look();
check('（尺子）条子上真的摆着字', first.texts.length > 0, first.texts.join(' / ').slice(0, 60));
check('头一步点的是《得分图案》那一块', first.cls.includes('coach-aim') && !first.cls.includes('coach-aim--edge'),
  first.cls.join(' ') || '（一个都没挂）');
check('而且它**真的在亮**（算出来的样式里有动画或光晕）', first.pattern !== 'none', first.pattern);

// ── ② 绝不拦操作：条子亮着的时候，真的拖一枚棋子 ──────────────────
//
// 量的是**盘面变没变**，不是「拖动事件有没有发出去」。事件照常发得出去，而被一层蒙版
// 吃掉的时候，棋子一动不动——那才是玩家会遇到的样子。
/**
 * 盘面指纹：每一枚的**位置 ＋ 颜色**。
 *
 * 只记颜色不够——滑一下是把一条线上的颜色整体挪一格，DOM 里那几个节点很可能原地不动只
 * 换了样式，而有些棋盘干脆是整条线一起换位。位置和颜色一起记，挪了就一定看得出来。
 */
const fingerprint = () => page.evaluate(() =>
  [...document.querySelectorAll('#boardWrap .tile, #boardWrap .ball')]
    .map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.left)},${Math.round(r.top)}:${getComputedStyle(e).backgroundColor}:${e.className}`;
    })
    .join('|'));
/**
 * 从**一枚真的棋子**身上往右拖两格。
 *
 * 两处起手点的坑，都真的踩过：
 *
 *   · 不能从棋盘正中起手：小球那副盘的正中未必落在一枚球上（实测 elementFromPoint 打到
 *     的是 `.board` 本身），从空处起手拖不动任何东西。
 *   · 也不能认准某一枚：盘上第 0 枚是左上角那一枚，它那条线往右可能本来就推不动（这一
 *     局实测就是）。
 *
 * 两种情况量出来都是「盘面没变」，而那说的是起手点不对，不是教学条拦了手——同一个读数
 * 配两种天差地别的原因，正是这道门最容易骗到自己的地方。所以下面那个 `dragUntilMoved`
 * 换着棋子试几枚，有一枚动了就算证明了「手势通得过去」。一层蒙版拦着的话，**哪一枚都
 * 不会动**。
 */
const dragAPiece = async (nth) => {
  const at = await page.evaluate((n) => {
    const all = [...document.querySelectorAll('#boardWrap .tile, #boardWrap .ball')];
    const el = all[Math.min(n, all.length - 1)];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, step: r.width };
  }, nth);
  if (!at) return false;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(at.x + (k * at.step * 2) / 10, at.y);
  await page.mouse.up();
  await page.waitForTimeout(800);
  return true;
};
/** 换着棋子试，有一枚动了就算过。回传试了几枚、哪一枚动的。 */
const dragUntilMoved = async (tries = [5, 9, 2, 13, 0, 20]) => {
  const from = await fingerprint();
  for (const n of tries) {
    if (!(await dragAPiece(n))) continue;
    const now = await fingerprint();
    if (now !== from) return { moved: true, n };
  }
  return { moved: false, n: -1 };
};

const before = await fingerprint();
const box = await page.evaluate(() => {
  const b = document.querySelector('#boardWrap');
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
});
// 手指落在**一枚棋子**的正中：这一下碰到的必须是那一枚，不是盖在上面的什么东西。
const hit = await page.evaluate(() => {
  const el0 = document.querySelector('#boardWrap .tile, #boardWrap .ball');
  if (!el0) return null;
  const r = el0.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return el
    ? { tag: el.tagName, cls: el.className.toString().slice(0, 60), isPiece: !!el.closest('.tile, .ball') }
    : null;
});
check('手指落在一枚棋子上，碰到的就是那一枚（不是盖在上面的一层）',
  !!hit && hit.isPiece, hit ? `${hit.tag}.${hit.cls}` : '（什么都没碰到）');

check('（尺子）盘面上真的有棋子', before.length > 0, `${before.split('|').length} 枚`);
const moved1 = await dragUntilMoved();
check('教学条亮着的时候，棋子照样拖得动（E23「绝不拦操作」）', moved1.moved,
  moved1.moved ? `第 ${moved1.n} 枚拖动了` : '挨个试过都没动');

// ── ③ 第 4 条那一支：类挂上去，带子真的亮，而且照旧不吃手势 ──────────
//
// 为什么手动挂类，见文件头。这一节量的是**接线**：选择器对不对得上、亮起来之后那条带子
// 会不会忽然开始吃手势。哪一步该挂它由 check-coach 管。
const edge = await page.evaluate(() => {
  const stage = document.querySelector('.app--game');
  stage.classList.remove('coach-aim');
  stage.classList.add('coach-aim--edge');
  const band = document.querySelector('.edge-band');
  if (!band) return { has: false };
  const cs = getComputedStyle(band);
  const pat = getComputedStyle(document.querySelector('.hud-block--pattern'));
  return {
    has: true,
    anim: cs.animationName !== 'none' ? cs.animationName : (cs.filter !== 'none' ? 'filter:' + cs.filter : 'none'),
    pe: cs.pointerEvents,
    glow: cs.getPropertyValue('--glow').trim(),
    patternOff: pat.animationName === 'none',
  };
});
check('（尺子）这一局真的画了外边指引那条带子', edge.has === true);
if (edge.has) {
  check('挂上 coach-aim--edge，带子真的亮了', edge.anim !== 'none', edge.anim);
  check('亮着的时候照旧不吃手势（pointer-events: none）', edge.pe === 'none', edge.pe);
  check('光色换成了《色卡》那支奶油（不借 --glow 那支偏红的）',
    /246|F6E2C0/i.test(edge.glow), edge.glow || '（没设）');
  check('这一支亮的时候，《得分图案》那一块灭着（两支灯互斥）', edge.patternOff === true);
}
// 带子亮着，棋子照样拖得动——「绝不拦操作」在两支灯底下都要成立。换一枚拖，免得
// 上一把刚好把这一枚推到了边上。
const moved2 = await dragUntilMoved();
check('带子亮着的时候，棋子也照样拖得动', moved2.moved,
  moved2.moved ? `第 ${moved2.n} 枚拖动了` : '挨个试过都没动');

// ── ④ 两支灯互斥，而且条子底下那一块不在棋盘上 ────────────────────
const geom = await page.evaluate(() => {
  const b = document.querySelector('#boardWrap').getBoundingClientRect();
  const c = document.querySelector('.coach-bar').getBoundingClientRect();
  const pe = getComputedStyle(document.querySelector('.edge-band') || document.body).pointerEvents;
  return { overlap: !(c.top >= b.bottom - 1 || c.bottom <= b.top + 1), bandPE: pe };
});
check('教学条摆在棋盘外面（没压着盘）', !geom.overlap, geom.overlap ? '压上了' : '不压');
check('外边指引那条带子不吃手势（pointer-events: none）', geom.bandPE === 'none', geom.bandPE);

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
