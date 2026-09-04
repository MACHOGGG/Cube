/**
 * 样式降级层的对照台——同一屏量两遍，比给出来的排版一不一样。
 *
 *   node xhs/check-oldcss.mjs
 *
 * CSS 这一层没法像 JS 那样「把接口删掉」来模拟老内核：删不掉浏览器认得 gap
 * 这件事。所以反过来——xhs/src/oldKernel.ts 留了个后门
 * （window.__SLIDES_OLD_KERNEL__），设成 true 就当所有能力都缺，整条降级路径
 * 在新浏览器上完整跑一遍。
 *
 * 于是可以这么比：
 *
 *   甲：正常渲染（浏览器自己认 gap / clamp / aspect-ratio）
 *   乙：强制走降级层（换算成 px、外边距、内边距百分比）
 *
 * 两边量同一批盒子，差得超过阈值就是降级层没给对。这不是「看着差不多」，
 * 是逐个盒子的坐标和尺寸。
 *
 * 量不到的：真机上的字体度量和性能。那两样只有真机说了算。
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(here, 'preview.html')).href;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails = 0;
const say = (ok, text, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + text + (extra ? '  ' + extra : ''));
};

/** 量一批盒子：选择器 → [{x,y,w,h}, ...]，全部四舍五入到整像素。 */
const MEASURE = (sels) => {
  const out = {};
  for (const sel of sels) {
    out[sel] = [].slice.call(document.querySelectorAll(sel)).map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  }
  out.__scroll = Math.round(document.documentElement.scrollHeight);
  return out;
};

/**
 * 会折行那种容器，它自己那个框在降级层里会宽出一整道缝——这是负外边距那套
 * 补法的必然结果（子项四周各加半道，容器四周各减半道，子项落回原位，容器
 * 的框比原来大一道）。这几个框都是透明的排版壳，没有底色也没有描边，看不见；
 * 真正要对上的是它们**里面**那些看得见的东西，那些照旧按 2px 卡。
 * 所以这里只放宽这几个壳自己的宽高，位置（x / y）仍然要对上。
 */
const WRAP_HOSTS = ['.app--game .pattern-hint', '.app--game .controls', '.xhs-share-bar'];

/** 两批量测比一比。差在 tol 之内算过。 */
function compare(label, a, b, tol) {
  let worst = 0;
  let where = '';
  const keys = Object.keys(a).filter((k) => k !== '__scroll');
  for (const k of keys) {
    if (a[k].length !== b[k].length) {
      say(false, `${label} · ${k} 个数对不上`, `新 ${a[k].length} / 降级 ${b[k].length}`);
      continue;
    }
    const isHost = WRAP_HOSTS.indexOf(k) >= 0;
    for (let i = 0; i < a[k].length; i++) {
      for (const f of ['x', 'y', 'w', 'h']) {
        // 壳自己的宽高按「差一道缝」算，位置照旧严格
        const limit = isHost && (f === 'w' || f === 'h') ? 70 : tol;
        const d = Math.abs(a[k][i][f] - b[k][i][f]);
        if (d <= limit) continue;
        if (d > worst) {
          worst = d;
          where = `${k}[${i}].${f} 新 ${a[k][i][f]} / 降级 ${b[k][i][f]}`;
        }
      }
    }
  }
  say(worst === 0, `${label}：两边排版一致（容差 ${tol}px）`, worst ? `最大差 ${worst}px @ ${where}` : '');
  const ds = Math.abs(a.__scroll - b.__scroll);
  say(ds <= tol * 3, `${label}：整页高度一致`, `新 ${a.__scroll} / 降级 ${b.__scroll}`);
}

/**
 * 走一遍：主菜单量一次，进一局方块再量一次。
 * `old` 为真时在页面任何脚本之前把后门打开。
 */
async function run(view, old) {
  const ctx = await browser.newContext({
    viewport: { width: view.w, height: view.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  if (old) await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(PAGE);
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  await p.waitForTimeout(900);

  const menu = await p.evaluate(MEASURE, [
    '.home-page',
    '.home-grid',
    '.home-row',
    '.home-icon-btn',
    '.home-icon-art',
    '.home-icon-tag',
    '.home-head-glass',
    '.home-nav-dock',
  ]);
  const menuShot = `${view.w}-${old ? 'old' : 'new'}-menu.png`;
  await p.screenshot({ path: join(here, '..', '.tmp-oldcss', menuShot), fullPage: true }).catch(() => {});

  // 进一局方块
  await p.$$eval('.home-icon-btn', (e) => e[0].click());
  await p.waitForTimeout(700);
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
    { timeout: 20000 },
  );
  await p.waitForTimeout(1400);
  const game = await p.evaluate(MEASURE, [
    '.app--game',
    '.app--game .hud',
    '.app--game .hud-cell',
    '.app--game .controls',
    '.app--game .controls .icon-btn',
    '.app--game .pattern-hint',
    '.app--game .pattern-icon',
    '.board-wrap',
    '.board',
  ]);
  const gameShot = `${view.w}-${old ? 'old' : 'new'}-game.png`;
  await p.screenshot({ path: join(here, '..', '.tmp-oldcss', gameShot) }).catch(() => {});

  // 底色：正在玩的时候该换成棋盘那个深色
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // 有没有东西横着顶出屏幕——负外边距那套补法最容易出的岔子就是这个
  const spill = await p.evaluate(() => {
    const bad = [];
    const all = document.querySelectorAll('.app *');
    for (let i = 0; i < all.length; i++) {
      const cs = getComputedStyle(all[i]);
      if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = all[i].getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < -1 || r.right > window.innerWidth + 1) {
        bad.push(all[i].className.toString().split(' ')[0] + ` [${Math.round(r.left)},${Math.round(r.right)}]`);
      }
    }
    return bad.slice(0, 4);
  });
  await ctx.close();
  return { menu, game, bg, errs, spill };
}

for (const view of [
  { name: '竖屏 390×844', w: 390, h: 844 },
  { name: '横屏 844×390', w: 844, h: 390 },
]) {
  console.log('\n==== ' + view.name + ' ====');
  const fresh = await run(view, false);
  const old = await run(view, true);
  say(old.errs.length === 0, '降级层跑起来零报错', old.errs.slice(0, 2).join(' | '));
  compare('主菜单', fresh.menu, old.menu, 2);
  compare('游戏页', fresh.game, old.game, 2);
  say(fresh.bg === old.bg, '局中底色一致（is-playing 那一条）', `新 ${fresh.bg} / 降级 ${old.bg}`);
  say(old.spill.length === 0, '降级层下没有东西横着顶出屏幕', old.spill.join(' | '));
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
