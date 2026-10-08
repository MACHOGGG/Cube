/**
 * 倒数页那张图 ＝ 第二层上按下去的那一格（10-08 方案 3-F-4：图标唯一映射 iconFor）。
 *
 *   node scripts/dev-server.mjs 8968 dist
 *   node scripts/check-mode-icons.mjs http://localhost:8968/
 *
 * 方案原话：「图标唯一映射 iconFor(modeId)：第二层选择与 startStage 倒数页都从它取图标，删倒数
 * 页写死的旧图标（方块计时炸弹那组错位从根上消掉）。映射不碰主菜单缩图。验收：逐玩法开一遍倒数
 * 页比对。」
 *
 * 从前倒数页自己拼图：计时局摆一支绿脸的秒表（那是计时还是居中挑选窗时候的图），炸弹局摆灰底的
 * 棋盘 ＋ 一颗砖红的炸弹徽记——计时那一页按下去的是灰底的方块，炸弹那一页按下去的是一块那一排颜
 * 色底板的方块（计时那一排是橙的），倒数那几秒看见的却是另一组图。
 *
 * 这一道就照方案说的做：一个玩法一个玩法地从第二层按下去，量按下去的那一格和倒数页上那张图是不
 * 是同一张。没有第二层的（基础、布局）从主菜单那张卡按下去——那张卡就是它的挑选层。
 *
 * 「同一张」怎么量：图里每一笔（rect / circle / path…）的形状属性 ＋ 它此刻真正画出来的填色
 * （getComputedStyle 的 fill）。填色要量画出来的那一个：炸弹那一格的底板颜色是样式给的，不在属
 * 性里——光比属性，橙底和灰底是同一张图。
 *
 * 倒数页上只许有这一张图（单人局）：从前的炸弹徽记是并排的第二张，现在没有了。
 * 老虎机那一局倒数页摆的是那台机器，不摆图（ui/startStage.ts 的 emblem），那一条只量「是机器、
 * 不是别的图」。每日挑战那一局摆今天那张图，在 check-count-stage 里量。
 *
 * 手机 390×844 全量；电脑 1280×800 量计时和炸弹（错位就出在这两样上）。天才身份写在本地缓存里
 * （无限反转、步步为营、老虎机、菱形小球那几张要开通才按得动）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-mode-icons.mjs http://localhost:8968/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const SEED = `
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  localStorage.setItem('slides_played_square', '1');
  localStorage.setItem('slides_played_circle', '1');
  localStorage.setItem('slides_played_finished', '1');
  for (const k of ['bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout']) localStorage.setItem('slides_played_' + k, '1');
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'ICONCHK' }));
  // 一张图的指纹：每一笔的形状属性 ＋ 画出来的填色。装在页面里（evaluate 传进去的函数是序列化
  // 过去的，引用不到这个文件里的东西）。
  window.__iconPrint = (svg) => {
    if (!svg) return null;
    const keys = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'd', 'points', 'transform'];
    return [...svg.querySelectorAll('rect, circle, ellipse, path, polygon, polyline, line')]
      .map((el) => el.tagName + '(' + keys.map((k) => el.getAttribute(k) ?? '').join('|') + ')' + getComputedStyle(el).fill)
      .join('\\n');
  };
`;

/** 倒数页上此刻的样子：那一排图有几张、第一张的指纹、是不是那台老虎机。 */
const COUNTDOWN = () => {
  const marks = [...document.querySelectorAll('#startOverlay .start-marks > .start-mark')];
  const art = document.querySelector('#startOverlay .start-mark-art > svg');
  return {
    marks: marks.length,
    print: window.__iconPrint(art),
    machine: !!document.querySelector('#startOverlay .slot-machine'),
  };
};

/** 两个指纹的第一处不同（印出来好认是哪一笔、哪个颜色）。 */
const firstDiff = (a, b) => {
  if (!a || !b) return `${a ? '' : '按下去那一格没量到'}${b ? '' : '倒数页没量到'}`;
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `第 ${i + 1} 笔：${(x[i] ?? '（没有）').slice(-60)} ｜ ${(y[i] ?? '（没有）').slice(-60)}`;
  }
  return '';
};

for (const [w, h, label, full] of [[390, 844, '手机 390×844', true], [1280, 800, '电脑 1280×800', false]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
  await ctx.addInitScript(SEED);
  const errs = [];
  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE);
    await p.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 20000 });
    await p.waitForTimeout(400);
    return p;
  };
  /** 主菜单上那张卡（按读屏名的开头认）。 */
  const card = (p, name) =>
    p.evaluate((name) => {
      const b = [...document.querySelectorAll('.home-icon-btn')].find((e) => (e.getAttribute('aria-label') || '').startsWith(name));
      if (!b) return false;
      b.click();
      return true;
    }, name);
  /**
   * 量一条路：`pick(p)` 走到挑选层、返回那一格的选择器；量它的指纹，按下去，到倒数页再量。
   */
  const run = async (name, pick, { slot = false } = {}) => {
    const p = await open();
    let sel = null;
    try {
      sel = await pick(p);
    } catch (e) {
      sel = null;
      errs.push(`${name}：${e.message}`);
    }
    if (!sel) {
      check(`${label}：${name}——（尺子）走到了挑选层、找到了那一格`, false);
      await p.close();
      return;
    }
    const before = await p.evaluate((sel) => window.__iconPrint(document.querySelector(sel)?.querySelector('svg')), sel);
    await p.evaluate((sel) => document.querySelector(sel).click(), sel);
    await p.waitForSelector('#startOverlay', { timeout: 10000 });
    await p.waitForTimeout(150);
    const cd = await p.evaluate(COUNTDOWN);
    await p.close();
    if (slot) {
      check(`${label}：${name}——倒数页摆的是那台老虎机，没有别的图`, cd.machine && cd.marks === 0, JSON.stringify({ machine: cd.machine, marks: cd.marks }));
      return;
    }
    check(`${label}：${name}——倒数页上只有一张图（没有并排的徽记）`, cd.marks === 1, `${cd.marks} 张`);
    check(`${label}：${name}——倒数页那张图就是按下去的那一格`, !!before && before === cd.print, firstDiff(before, cd.print));
  };

  /** 第二层（整页）上那一格：.slot-pick-opt[data-family=…]。 */
  const pageOpt = (menuName, family) => async (p) => {
    if (!(await card(p, menuName))) throw new Error(`主菜单上没有「${menuName}」`);
    await p.waitForSelector(`.slot-pick-opt[data-family="${family}"]`, { timeout: 8000 });
    await p.waitForTimeout(250);
    return `.slot-pick-opt[data-family="${family}"]`;
  };
  /** 主菜单那张卡本身（没有第二层的玩法）。 */
  const menuCard = (menuName) => async (p) => {
    const idx = await p.evaluate((name) => {
      const all = [...document.querySelectorAll('.home-icon-btn')];
      const i = all.findIndex((e) => (e.getAttribute('aria-label') || '').startsWith(name) && !e.classList.contains('home-icon-btn--locked'));
      if (i >= 0) all[i].setAttribute('data-icon-check', '1');
      return i;
    }, menuName);
    if (idx < 0) throw new Error(`主菜单上没有能按的「${menuName}」`);
    return '[data-icon-check="1"]';
  };
  /** 炸弹挑选层上那一格：第 row 排（0 基础、1 计时、2 进阶）第 col 格。 */
  const bombChip = (row, col) => async (p) => {
    await p.evaluate(() => document.querySelector('[data-reopen="bomb"]').click());
    await p.waitForSelector('.center-pick--in .bomb-chip', { timeout: 8000 });
    await p.waitForTimeout(500);
    const ok = await p.evaluate(({ row, col }) => {
      const chip = document.querySelectorAll('.center-pick .bomb-row')[row]?.querySelectorAll('.bomb-chip')[col];
      if (!chip) return false;
      chip.setAttribute('data-icon-check', '1');
      return true;
    }, { row, col });
    if (!ok) throw new Error(`炸弹挑选层没有第 ${row + 1} 排第 ${col + 1} 格`);
    return '[data-icon-check="1"]';
  };

  if (full) {
    // 没有第二层的：主菜单那张卡就是挑选层（基础两副、能按的布局）。
    for (const name of ['方块', '圆球', '菱形方块', '六边圆球', '七色圆球', '大三角']) await run(`主菜单「${name}」`, menuCard(name));
  }
  for (const fam of ['square', 'circle']) await run(`计时挑战 · ${fam}`, pageOpt('计时挑战', fam));
  if (full) {
    for (const fam of ['square', 'circle']) await run(`无限反转 · ${fam}`, pageOpt('无限反转', fam));
    for (const fam of ['square', 'circle']) await run(`步步为营 · ${fam}`, pageOpt('步步为营', fam));
    for (const fam of ['square', 'circle']) await run(`老虎机模式 · ${fam}`, pageOpt('老虎机模式', fam), { slot: true });
  }
  const TIERS = ['基础', '计时', '进阶'];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) await run(`炸弹 · ${TIERS[row]}第 ${col + 1} 格`, bombChip(row, col));
  }
  check(`${label}：全程零报错`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
