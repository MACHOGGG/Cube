/**
 * 得分图示摆在哪儿。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-legend.mjs http://localhost:8817/
 *
 * 玩家定的规矩：
 *   竖屏——一条，上下居中在读数和棋盘中间那段空当里；
 *   横屏——劈成两半竖着贴在棋盘左右两边，各自上下居中。这是为了把上面那一
 *     条的高度还给棋盘（横屏里棋盘是被高度卡住的）；
 *   两个例外——七色圆球和进阶三角横过来是宽度吃满的，两边没有空当，图示留
 *     在棋盘上方。
 *
 * 光看「有没有画出来」是不够的：摆错位置的图示照样画得出来，只是压在棋盘上
 * 或者掉到屏幕外面。所以这里量的是它和棋盘、和四周那几颗键的实际位置关系。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const SHAPES = ['方块', '圆球', '三角', '菱形方块', '六边圆球', '大三角', '七色圆球', '进阶三角'];
// 横屏里图示留在上方的两个玩法（gameShell 的 PATTERNS_ON_TOP）。
const ON_TOP = new Set(['七色圆球', '进阶三角']);

const seed = () => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'LEGEND',
  }));
};

const MEASURE = () => {
  const R = (n) => Math.round(n * 10) / 10;
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: R(r.left), t: R(r.top), r: R(r.right), b: R(r.bottom) }; };
  const wrap = document.querySelector('.app--game .board-wrap');
  const hud = document.querySelector('.app--game .hud');
  if (!wrap || !hud) return null;
  const icons = [...document.querySelectorAll('.pattern-icon')]
    .filter((e) => e.getBoundingClientRect().width > 0)
    .map(box);
  // 四周那几颗键：读数格和控制键。图示压在它们上面也算摆错。
  const chips = [...document.querySelectorAll('.app--game .hud-cell, .app--game .controls .icon-btn')].map(box);
  return { wrap: box(wrap), hud: box(hud), icons, chips, vw: innerWidth, vh: innerHeight };
};

async function openGame(page, shape) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  const found = await page.$$eval('.home-icon-btn', (els, n) => {
    const hit = els.find((e) => (e.getAttribute('aria-label') || '') === n);
    if (!hit) return false;
    hit.click();
    return true;
  }, shape);
  if (!found) return false;
  const ok = await page
    .waitForFunction(
      () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
      { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (ok) await page.waitForTimeout(1000);
  return ok;
}

const overlaps = (a, c) => a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
const inView = (a, m) => a.l >= -0.5 && a.t >= -0.5 && a.r <= m.vw + 0.5 && a.b <= m.vh + 0.5;
const midY = (a) => (a.t + a.b) / 2;

for (const shape of SHAPES) {
  for (const [tag, vp] of [['竖屏', { width: 390, height: 844 }], ['横屏', { width: 844, height: 390 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(seed);
    const page = await ctx.newPage();
    const ok = await openGame(page, shape);
    const m = ok ? await page.evaluate(MEASURE) : null;
    await ctx.close();
    const name = `${shape} ${tag}`;
    if (!m || !m.icons.length) {
      check(`${name}：量得到图示`, false, ok ? '一个图示都没有' : '开不起来');
      continue;
    }

    check(`${name}：图示都在屏幕里`, m.icons.every((a) => inView(a, m)));
    check(
      `${name}：图示没压在棋盘上`,
      m.icons.every((a) => !overlaps(a, m.wrap)),
      `${m.icons.filter((a) => overlaps(a, m.wrap)).length} 枚压着`,
    );
    check(
      `${name}：图示没压在读数和按钮上`,
      m.icons.every((a) => m.chips.every((c) => !overlaps(a, c))),
    );

    if (tag === '横屏' && !ON_TOP.has(shape)) {
      const left = m.icons.filter((a) => a.r <= m.wrap.l + 0.5);
      const right = m.icons.filter((a) => a.l >= m.wrap.r - 0.5);
      check(
        `${name}：劈成两半贴在棋盘两边`,
        left.length > 0 && right.length > 0 && left.length + right.length === m.icons.length,
        `左 ${left.length} 枚 · 右 ${right.length} 枚 · 共 ${m.icons.length} 枚`,
      );
      // 两边各自上下居中：图示那一摞的中线要落在棋盘的中线上。
      const band = (g) => (Math.min(...g.map((a) => a.t)) + Math.max(...g.map((a) => a.b))) / 2;
      const wantY = midY(m.wrap);
      for (const [side, g] of [['左', left], ['右', right]]) {
        if (!g.length) continue;
        check(`${name}：${side}边那一摞上下居中`, Math.abs(band(g) - wantY) <= 2,
          `差 ${Math.round((band(g) - wantY) * 10) / 10}px`);
      }
    } else {
      // 竖屏，以及横屏那两个例外：图示在棋盘上方。
      check(`${name}：图示在棋盘上方`, m.icons.every((a) => a.b <= m.wrap.t + 0.5));
      const top = Math.min(...m.icons.map((a) => a.t));
      const bot = Math.max(...m.icons.map((a) => a.b));
      if (tag === '横屏') {
        // 那两个例外横过来是宽度吃满的，棋盘几乎顶到上下两边，图示和棋盘之
        // 间只剩一个间距——没有空当可居中，量了也只是在量内边距。
        console.log(`SKIP  ${name}：棋盘几乎顶满，上方没有空当可居中  余 ${Math.round(m.wrap.t - bot)}px`);
        continue;
      }
      const gapAbove = top - m.hud.b;
      const gapBelow = m.wrap.t - bot;
      // 只在真的有空当可分的时候要求居中：地板占满整列的时候（七色圆球竖屏）
      // 两边的空当本来就只有一个 gap，无所谓居中。
      const slack = gapAbove + gapBelow;
      if (slack > 24) {
        check(`${name}：上下居中在读数和棋盘之间`, Math.abs(gapAbove - gapBelow) <= 3,
          `上 ${Math.round(gapAbove)}px · 下 ${Math.round(gapBelow)}px`);
      } else {
        console.log(`SKIP  ${name}：读数和棋盘之间没有空当可居中  共 ${Math.round(slack)}px`);
      }
    }
  }
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
