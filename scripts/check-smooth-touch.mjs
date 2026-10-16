/**
 * 整页滚动不接平滑滚动：电脑、手机都是原生的（10-09 补充方案第一部分第 10 条 ＋ 6-8）。
 *
 *   node scripts/dev-server.mjs 8967 dist
 *   node scripts/check-smooth-touch.mjs http://localhost:8967/ [--part=touch|boards]
 *
 * 来历：2026-09 第八轮给整页滚动加了一层 Lenis 阻尼（engine/smoothScroll.ts），手机电脑都接。10-08
 * 方案 3-J 先把触屏摘掉（「移动端触摸列表一律不做 Lenis 式平滑滚动」），只留电脑的滚轮——这道门
 * 原先量的就是那一半：手机上没建、电脑上建了。10-09 玩家再拍板「电脑端滚轮那层平滑滚动**整个拿
 * 掉**」，6-8 又确认「GSAP、Lenis 都不进共享 src/」。所以 smoothScroll.ts 和它在小红书那边的空替身
 * 一起删了，lenis 也从依赖里撤了。
 *
 * 文件名照旧叫 smooth-touch：browser 那几片的清单按脚本路径认门（check-ci-browser ⑥），换名字等于撤
 * 一道、加一道，而它量的还是同一件事，只是口径从「触屏不接」放宽成「谁都不接」。
 *
 * 怎么看「建没建」：Lenis 一建出来就往 <html> 上挂一个 `lenis` 类（它自己的 updateClassName），原先
 * 的 ensure() 还往 <head> 里贴一段 `#lenis-styles`。
 *
 *   ① 手机 390×844（触屏）、② 电脑 1280×800（鼠标）：进个人主页（内容页，原先 start() 就是在这种页
 *      上去要阻尼的），滚轮滚一下——<html> 上没有 lenis 类、head 里没有那段样式；页面长过一屏的话，
 *      滚轮真的把它滚动了（尺子：「没有阻尼」不能是「根本滚不动」）。
 *   ③ 源码：package.json 不依赖 lenis / gsap；src/ 和 xhs/src/ 里没有一处 import 它们；smoothScroll.ts
 *      和它的替身都不在了，xhs/vite.config.ts 的 SWAP 表里也没有那一行。带反面尺子：一句
 *      `import Lenis from 'lenis'` 喂进同一个匹配器，必须认得出来。
 *   ④ 两根手指（10-11 方案 B-3）：经典方块里第一根手指拖着、第二根落下（CDP 发真的双触点），两根都抬起来、
 *      等收尾走完之后，页面上一个节点都不再长；打完回主菜单，requestAnimationFrame 的频率回到进局之前那么多。
 *      原先第二根手指落下照样走 onStart，第一根那条拖动链没人停，每一帧把整副棋盘重画一遍——量到过每秒多
 *      2196 个节点（36 枚 × 61 帧），离开这一局也停不下（engine/drag.ts、engine/dragChain.ts 的 chainSet）。
 *
 * 拖动层三节（10-15 补充 L-6，engine/drag.ts 和六副棋盘的 onBeforeStart）：
 *
 *   ⑤ 电脑上的右键：右键按住拖两格再松，哪一行都不动；右键按下、抬起没送到（Mac、Linux 一按右键就弹菜单，pointerup
 *      不来——这儿在捕获阶段吞掉那一条来摆），之后左键拖第 4 行，动的就是第 4 行。原先 down() 不看是哪个键：前一种第
 *      2 行滑了两格、记一步；后一种不按键挪鼠标第 2 行就跟着走，左键拖第 4 行动的还是第 2 行。
 *   ⑥ 指针捕获抛错：一条合成的触摸 pointerdown（指针 id 不存在）让 setPointerCapture 当场抛 NotFoundError，之后真拖
 *      照常动。原先这时 active 已经为真、没人放下，整局一枚都拖不动，暂停→继续、《再来一局》都救不回。
 *   ⑦ 得分之后 80ms 按下第二手，六副棋盘都接住（量法见那一节）。原先这一下被吞：快一点被吞、慢一点接住。
 *
 * 撤掉对应的改法，各节都红（⑤⑥ 换回旧 drag.ts，⑦ 换回旧的 onBeforeStart，六副一副不落）。
 */
import { chromium } from 'playwright';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-smooth-touch.mjs http://localhost:8967/');
  process.exit(2);
}
/**
 * `--part=touch`：只跑 ①–⑥（CI a 片）；`--part=boards`：只跑 ⑦ 六副棋盘那一节（三分多钟，CI 单放一片，免得 a 片一下子
 * 长出一截）；不给就全跑。DRAG_BOARDS=经典小球,…（逗号分开）只跑这几副，而且跳过 ⑤⑥——本地调门用。
 */
const PART = (process.argv.find((a) => a.startsWith('--part=')) || '').slice(7) || 'all';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ③ 源码先量（不用开浏览器）────────────────────────────────────────────────
const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
if (PART !== 'boards') {
  const pkg = JSON.parse(read('package.json'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const banned = Object.keys(deps).filter((d) => /^(lenis|@studio-freight\/lenis|gsap|@gsap\/.*)$/.test(d));
  check('③ package.json 不依赖 lenis / gsap', banned.length === 0, banned.join(' / ') || '干净');

  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(join(root, dir))) {
      const p = `${dir}/${f}`;
      if (statSync(join(root, p)).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(f)) files.push(p);
    }
  };
  walk('src');
  walk('xhs/src');
  check('（尺子）读到了两端的源码', files.length > 100, `${files.length} 个文件`);
  const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](?:lenis|@studio-freight\/lenis|gsap)(?:\/[^'"]*)?['"]/;
  const users = files.filter((f) => IMPORT.test(read(f)));
  check('③ src/ 和 xhs/src/ 里没有一处 import lenis / gsap', users.length === 0, users.join(' / ') || '干净');
  check('③（反面尺子）import Lenis / 它的样式 / gsap 喂进同一个匹配器都认得出来',
    IMPORT.test("import Lenis from 'lenis';") &&
      IMPORT.test("import lenisCss from 'lenis/dist/lenis.css?inline';") &&
      IMPORT.test("import { gsap } from 'gsap';"));

  const left = ['src/engine/smoothScroll.ts', 'xhs/src/stubs/smoothScroll.ts'].filter((p) => existsSync(join(root, p)));
  check('③ smoothScroll.ts 和小红书那边的替身都不在了', left.length === 0, left.join(' / ') || '都删了');
  check('③ xhs/vite.config.ts 的 SWAP 表里没有 smoothScroll 那一行', !/smoothScroll/.test(read('xhs/vite.config.ts')));
}

// ── ①② 真开一页量 ────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const SEED = `
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  localStorage.setItem('slides_played_square', '1');
  localStorage.setItem('slides_played_finished', '1');
`;
const PROBE = () => ({
  coarse: matchMedia('(pointer: coarse)').matches,
  fine: matchMedia('(pointer: fine)').matches,
  lenis: document.documentElement.classList.contains('lenis'),
  styles: !!document.getElementById('lenis-styles'),
  profile: !!document.querySelector('.profile-page'),
  y: window.scrollY,
  tall: document.documentElement.scrollHeight > window.innerHeight + 40,
});

if (PART !== 'boards') for (const [w, h, touch, label] of [[390, 844, true, '① 手机 390×844（触屏）'], [1280, 800, false, '② 电脑 1280×800（鼠标）']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
  await ctx.addInitScript(SEED);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 10000 });
  await page.waitForTimeout(600);
  const before = await page.evaluate(PROBE);
  await page.mouse.move(w / 2, h / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(700);
  const m = await page.evaluate(PROBE);
  await ctx.close();
  check(`${label}：（尺子）指点设备${touch ? '是粗的（触屏）' : '是细的（鼠标）'}`, touch ? m.coarse && !m.fine : m.fine && !m.coarse, JSON.stringify({ coarse: m.coarse, fine: m.fine }));
  check(`${label}：（尺子）进到了个人主页（原先会去要阻尼的那一种内容页）`, m.profile);
  check(`${label}：没有平滑滚动（<html> 上没有 lenis，head 里没有它那段样式）`, !m.lenis && !m.styles, JSON.stringify({ lenis: m.lenis, styles: m.styles }));
  if (before.tall) check(`${label}：（尺子）滚轮滚得动这一页（原生滚动还在）`, m.y > before.y, `${before.y} → ${m.y}`);
  else console.log(`NOTE  ${label}：这一页没长过一屏，「滚得动」那一条无从量，不假装查过`);
  check(`${label}：零报错`, errs.length === 0, errs.slice(0, 2).join(' | '));
}

// ── ④ 两根手指（10-11 方案 B-3）─────────────────────────────────────────────
if (PART !== 'boards') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(SEED + `
    for (const k of ['square', 'circle', 'triangle']) localStorage.setItem('slides_tutorial_seen_' + k, '1');
    localStorage.setItem('slides_played_totaltip', '1');
    // requestAnimationFrame 记一笔账；页面上新添的节点也记一笔。
    window.__raf = 0;
    const rawRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return rawRaf(cb); };
    window.__added = 0;
    new MutationObserver((recs) => { for (const r of recs) window.__added += r.addedNodes.length; })
      .observe(document, { childList: true, subtree: true });
  `);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(2500);
  /** 一秒里 requestAnimationFrame 叫了几次、页面上添了几个节点。 */
  const rate = async () => {
    const a = await page.evaluate(() => [window.__raf, window.__added]);
    await page.waitForTimeout(1000);
    const b = await page.evaluate(() => [window.__raf, window.__added]);
    return { raf: b[0] - a[0], added: b[1] - a[1] };
  };
  const menu0 = await rate();
  await page.evaluate(() => document.querySelector('.home-icon-btn[data-first-playable="1"]')?.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile[data-id]').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const at = (r, c) => page.$eval(`#boardWrap .tile[data-r="${r}"][data-c="${c}"]`, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  const a = await at(1, 1);
  const b = await at(4, 4);
  const pitch = (await at(1, 2)).x - a.x;
  const cdp = await ctx.newCDPSession(page);
  const tp = (id, x, y) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 });
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  // 第一根手指按住第 1 行，往右拖一格半。
  await touch('touchStart', [tp(0, a.x, a.y)]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [tp(0, a.x + (pitch * 1.5 * i) / 8, a.y)]);
    await page.waitForTimeout(16);
  }
  const f0 = a.x + pitch * 1.5;
  // 第二根手指落在第 4 行，两根一起挪一挪。
  await touch('touchStart', [tp(0, f0, a.y), tp(1, b.x, b.y)]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [tp(0, f0, a.y), tp(1, b.x, b.y + (pitch * i) / 6)]);
    await page.waitForTimeout(16);
  }
  // 先抬第二根，再抬第一根（touchPoints 列的是还按着的那几根）。
  await touch('touchEnd', [tp(0, f0, a.y)]);
  await page.waitForTimeout(80);
  await touch('touchEnd', []);
  await page.waitForTimeout(1800);
  const still = await rate();
  check('④ 两根手指都抬起来、收尾走完：页面上一个节点都不再长', still.added === 0, `1 秒里添了 ${still.added} 个、raf ${still.raf} 次`);
  // 打完回主菜单。
  await page.evaluate(() => document.getElementById('stopBtn').click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('pauseFinishBtn').click());
  await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
  await page.evaluate(() => document.getElementById('endBackBtn').click());
  await page.waitForSelector('.home-icon-btn', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const menu1 = await rate();
  check('④ 回到主菜单：requestAnimationFrame 的频率回到进局之前（没有链还在跑）', menu1.raf <= menu0.raf + 5,
    `进局之前 ${menu0.raf} 次/秒 → 回来之后 ${menu1.raf} 次/秒`);
  check('④ 零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── ⑤⑥⑦ 拖动层（10-15 补充 L-6）─────────────────────────────────────────────
//
// 三样都用种子码开局（每日挑战那一页敲一串码，api/_seedcode.js 的 encodeSeed）：同一串码同一副牌，量得出「哪一行动了」，
// 也让快慢两遍走的是同一局。电脑 1280×860、鼠标。
{
  const SC = await import('../api/_seedcode.js');
  const ONLY = process.env.DRAG_BOARDS ? process.env.DRAG_BOARDS.split(',') : null;
  const BOARDS_ONLY = PART === 'boards';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('drag_gate') === '1') return;
    sessionStorage.setItem('drag_gate', '1');
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['square', 'circle', 'finished', 'bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout', 'totaltip']) {
      localStorage.setItem('slides_played_' + k, '1');
    }
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 365 * 864e5 }));
  });
  // 每冒一个「+N」气泡（engine/scoreReel.ts 的 showGain）记一笔：⑦ 的尺子拿它认「这一手真得了分」。分数那一格
  // （#scoreReel 的 dataset.score）要等那一串动画走完才写，盘面静下来的那一刻常常还没写上。
  await ctx.addInitScript(() => {
    window.__gains = 0;
    // 震动记一笔（门里看「这一下是不是被拒了」用：onRejected 和兜底那一句都是 vibrate(15)）。
    window.__vib = [];
    try {
      navigator.vibrate = (p) => (window.__vib.push(p), true);
    } catch {}
    const watch = () => new MutationObserver((recs) => {
      for (const rec of recs) {
        for (const n of rec.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.classList.contains('gain-pop')) window.__gains++;
          else window.__gains += n.querySelectorAll('.gain-pop').length;
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.documentElement) watch();
    else document.addEventListener('DOMContentLoaded', watch, { once: true });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

  /** 开一局种子码（编号表第 variant 行）。 */
  const openSeeded = async (variant, rand) => {
    const code = SC.encodeSeed(SC.DEAL_VERSION, variant, rand);
    await page.evaluate(() => sessionStorage.removeItem('drag_gate')).catch(() => {});
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.click('.home-icon-btn--daily');
    await page.waitForSelector('#seedInput', { timeout: 8000 });
    await page.fill('#seedInput', code.slice(0, 4) + '-' + code.slice(4));
    await page.click('#seedGo');
    await page.waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(1800);
    return code;
  };
  /** 每一枚的位置和颜色（bot-selfcheck 那一把尺子的精简版）。 */
  const snap = () =>
    page.evaluate(() => {
      const CLEAR = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
      const colorOf = (el) => {
        const own = getComputedStyle(el).backgroundColor;
        if (!CLEAR(own)) return own;
        for (const kid of el.querySelectorAll('*')) {
          const bg = getComputedStyle(kid).backgroundColor;
          if (!CLEAR(bg)) return bg;
          const f = kid.getAttribute && kid.getAttribute('fill');
          if (f && f !== 'none') return f;
        }
        return '';
      };
      return [...document.querySelectorAll('#boardWrap [data-r][data-c]')].map((e) => {
        const b = e.getBoundingClientRect();
        return { r: Number(e.dataset.r), c: Number(e.dataset.c), x: b.left + b.width / 2, y: b.top + b.height / 2, color: colorOf(e) };
      }).sort((a, b) => a.r - b.r || a.c - b.c);
    });
  const at = (cells, r, c) => cells.find((p) => p.r === r && p.c === c);
  /** 哪几行的颜色变了。 */
  const rowsChanged = (a, b) => {
    const rows = new Set();
    for (const p of a) if (at(b, p.r, p.c)?.color !== p.color) rows.add(p.r);
    return [...rows].sort();
  };
  const drag = async (from, dx, dy, button = 'left') => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button });
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button });
  };
  /** 结束这一局（暂停 → 结束游戏），读存档里最新那一局走了几步。 */
  const endAndMoves = async () => {
    await page.evaluate(() => document.querySelector('#stopBtn')?.click());
    await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('#pauseFinishBtn')?.click());
    await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
    return page.evaluate(() => {
      let latest = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !/::runs$/.test(k)) continue;
        try {
          for (const r of JSON.parse(localStorage.getItem(k) || '[]')) if (!latest || r.at > latest.at) latest = r;
        } catch {}
      }
      return latest ? { moves: latest.moves ?? latest.data?.moves, score: latest.totalScore ?? latest.data?.totalScore } : null;
    });
  };

  if (!ONLY && !BOARDS_ONLY) {
    // ⑤ 鼠标右键（L-6 ①）。原先 down() 不看是哪个键：右键按住拖两格，第 2 行就滑了两格；右键按下之后 pointerup 没来
    //   （Mac、Linux 一按下就弹菜单——这儿用捕获阶段吞掉那一条 pointerup 来摆），之后左键拖第 4 行，动的是第 2 行。
    await openSeeded(0, 31337);
    const s0 = await snap();
    const pitch = at(s0, 2, 1).x - at(s0, 2, 0).x;
    await drag(at(s0, 2, 1), pitch * 2, 0, 'right');
    await page.waitForTimeout(900);
    const s1 = await snap();
    check('⑤（尺子）量到了一副方块（6 × 6）', s0.length === 36 && pitch > 20, `${s0.length} 枚，一格 ${Math.round(pitch)}px`);
    check('⑤ 右键按住拖两格再松：哪一行都没动', rowsChanged(s0, s1).length === 0, `动了第 ${rowsChanged(s0, s1).join('、')} 行`);
    await page.evaluate(() => {
      window.__eatRightUp = (e) => {
        if (e.button === 2) e.stopImmediatePropagation();
      };
      window.addEventListener('pointerup', window.__eatRightUp, true);
    });
    const r2 = at(s1, 2, 1);
    await page.mouse.move(r2.x, r2.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.evaluate(() => window.removeEventListener('pointerup', window.__eatRightUp, true));
    // 不按键、只挪鼠标：原先第 2 行就跟着走。
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(r2.x + (pitch * i) / 6, r2.y);
      await page.waitForTimeout(16);
    }
    await drag(at(s1, 4, 1), pitch * 1.2, 0);
    await page.waitForTimeout(900);
    const s2 = await snap();
    const moved = rowsChanged(s1, s2);
    check('⑤ 右键按下、抬起没送到，再左键拖第 4 行：动的就是第 4 行（只有它）', moved.length === 1 && moved[0] === 4,
      `动了第 ${moved.join('、') || '（没有）'} 行`);

    // ⑥ 指针捕获抛错（L-6 ②）：一条合成的触摸 pointerdown（指针 id 不存在）让 setPointerCapture 当场抛 NotFoundError。
    //   原先这时 active 已经为真、没人放下：之后真的拖一枚都不动。
    const s3 = await snap();
    const threw = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      let caught = false;
      const spy = (e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          caught = true;
        }
      };
      el.addEventListener('pointerdown', spy, { once: true });
      el.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 4242, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
      return caught;
    }, at(s3, 3, 2));
    await page.waitForTimeout(500);
    await drag(at(s3, 1, 1), pitch * 1.2, 0);
    await page.waitForTimeout(900);
    const s4 = await snap();
    const moved2 = rowsChanged(s3, s4);
    check('⑥（尺子）那一条合成的 pointerdown 真让 setPointerCapture 抛了错', threw);
    check('⑥ 捕获抛错之后：真拖第 1 行照常动（只有它）', moved2.length === 1 && moved2[0] === 1, `动了第 ${moved2.join('、') || '（没有）'} 行`);
  }

  // ⑦ 得分之后 80ms 按下第二步（L-6 ③）：六副棋盘各一次。原先松手之后那条链还要收尾最多 260ms，新的一下按下时
  //   onBeforeStart 里的 hurry() 先跑、那时还没有连锁可快进；onStart 里 flush() 把收尾收完才 resolveMove，得分的话
  //   resolving 为真，这一下被 `drag = null` 吞掉——快一点被吞、慢一点接住。
  //   量法：同一串码开两遍。慢的那一遍每一手都等盘面静下来：第一手挑一手「滑一格就凑出得分组」的（照屏幕上的位置和
  //   颜色、按《怎么玩》那条规矩在本地算，bot-selfcheck 那一把尺子的精简版），第二手随手滑一格；记下每一手按在哪、往
  //   哪拖，**第一手真得了分的那一对就停**（得分之后盘面会削、会放大，再往后两遍就不是同一副了）。快的那一遍把同样的
  //   几手照原样重放，只是第一手松手 80ms 就按第二手。
  //   怎么认「接住了」：控制器每落下一步就震一下 8（gameController 的 resolveMove：「这一步落下了，得没得分都震」），
  //   得分震 15、整线震 [25, 40, 25]，被拒也震 15。所以快的那一遍每一对都要有两下 8；最后那一对第一手的 8 后面跟着
  //   得分那一震（尺子：那一对真是「得分之后」）。原先最后那一对只有一下 8：第二手被吞了。
  const lineThrough = (cells, p, ux, uy) => {
    const tol = Math.max(6, (p.w || 20) * 0.5);
    return cells
      .filter((q) => q.face !== 'blank' && Math.abs((q.x - p.x) * uy - (q.y - p.y) * ux) <= tol)
      .map((q) => ({ q, t: (q.x - p.x) * ux + (q.y - p.y) * uy }))
      .sort((a, b) => a.t - b.t)
      .map((o) => o.q);
  };
  const neighbours = (cells, p) => {
    const ds = cells.filter((q) => q !== p && q.face !== 'blank').map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) }));
    if (!ds.length) return [];
    const min = Math.min(...ds.map((o) => o.d));
    return ds.filter((o) => o.d < min * 1.05).map(({ q, d }) => ({ ux: (q.x - p.x) / d, uy: (q.y - p.y) / d, d }));
  };
  /** 这副盘面上此刻有没有成立的得分组：同色连成一线、长度等于 HUD 那一块的枚数、里头至少一枚色块、没有活炸弹。 */
  const scoring = (cells, lines, need) => {
    const by = new Map(cells.map((p) => [p.at, p]));
    for (const line of lines) {
      const seq = line.map((at) => by.get(at)).filter(Boolean);
      for (let i = 0; i + need <= seq.length; i++) {
        const win = seq.slice(i, i + need);
        if (win.some((p) => p.face === 'blank' || !p.color || p.bomb)) continue;
        if (win.every((p) => p.color === win[0].color) && win.some((p) => p.face === 'flavor')) return true;
      }
    }
    return false;
  };
  /** 挑一手「顺着拖的方向挪一格就凑出得分组」的；挑不到就回 null。 */
  const scoringDrag = (cells, need) => {
    const lines = [];
    const seenLine = new Set();
    for (const p of cells) {
      for (const n of neighbours(cells, p)) {
        const line = lineThrough(cells, p, n.ux, n.uy).map((q) => q.at);
        const k = [...line].sort().join('|');
        if (line.length >= need && !seenLine.has(k)) {
          seenLine.add(k);
          lines.push(line);
        }
      }
    }
    for (const p of cells) {
      if (p.face === 'blank') continue;
      for (const n of neighbours(cells, p)) {
        const seats = lineThrough(cells, p, n.ux, n.uy);
        if (seats.length < 2) continue;
        const after = cells.map((q) => ({ ...q }));
        const seat = new Map(after.map((q) => [q.at, q]));
        seats.forEach((from, i) => {
          const to = seat.get(seats[(i + 1) % seats.length].at);
          to.face = from.face;
          to.color = from.color;
          to.bomb = from.bomb;
        });
        if (scoring(after, lines, need)) return { x: p.x, y: p.y, dx: n.ux * n.d * 1.15, dy: n.uy * n.d * 1.15 };
      }
    }
    return null;
  };
  const fullSnap = () =>
    page.evaluate(() => {
      const CLEAR = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
      const colorOf = (el) => {
        if (el.dataset.face === 'dot') {
          return el.dataset.dotColor || el.querySelector('svg [stroke]')?.getAttribute('stroke') || el.querySelector('svg')?.getAttribute('stroke') || '';
        }
        const own = getComputedStyle(el).backgroundColor;
        if (!CLEAR(own)) return own;
        for (const kid of el.querySelectorAll('*')) {
          const bg = getComputedStyle(kid).backgroundColor;
          if (!CLEAR(bg)) return bg;
          const f = kid.getAttribute && kid.getAttribute('fill');
          if (f && f !== 'none' && !CLEAR(f)) return f;
        }
        return '';
      };
      const svg = document.querySelector('.hud-block--pattern .pat-icon > svg');
      return {
        need: svg ? [...svg.children].filter((e) => e.tagName !== 'defs').length : 0,
        score: Number(document.querySelector('#scoreReel')?.dataset.score) || 0,
        gains: window.__gains || 0,
        cells: [...document.querySelectorAll('#boardWrap [data-r][data-c]')].map((e) => {
          const b = e.getBoundingClientRect();
          return {
            at: `${e.dataset.r},${e.dataset.c}`, face: e.dataset.face || '', color: colorOf(e),
            bomb: Boolean(e.querySelector('.hazard-mark')),
            x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width),
          };
        }).sort((a, b) => (a.at < b.at ? -1 : 1)),
      };
    });
  const BOARDS = [[0, '经典方块'], [1, '经典小球'], [2, '菱形方块'], [3, '六边形小球'], [4, '七色小球'], [5, '六边形三角']];
  const PAIRS = 6;
  const vibSince = (n) => page.evaluate((k) => window.__vib.slice(k), n);
  const vibCount = () => page.evaluate(() => window.__vib.length);
  const scoredBuzz = (v) => v === 15 || Array.isArray(v);
  for (const [variant, name] of PART === 'touch' ? [] : BOARDS) {
    if (ONLY && !ONLY.includes(name)) continue;
    const rand = 777000 + variant * 31;
    await openSeeded(variant, rand);
    let seed = 1 + variant * 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const sig = (snap) => snap.cells.map((q) => `${q.at}:${q.face}:${q.color}`).join('|');
    /** 等盘面静下来：隔 250ms 读两次一模一样（最多等 4 秒）。连锁、翻面、放大都走完才算。 */
    const still = async () => {
      let prev = await fullSnap();
      for (let t = 0; t < 16; t++) {
        await page.waitForTimeout(250);
        const cur = await fullSnap();
        if (sig(cur) === sig(prev)) return cur;
        prev = cur;
      }
      return prev;
    };
    const randomDrag = (snap) => {
      const pool = snap.cells.filter((q) => q.face !== 'blank');
      const p = pool[Math.floor(rnd() * pool.length)];
      const ns = neighbours(snap.cells, p);
      const n = ns[Math.floor(rnd() * ns.length)];
      return { x: p.x, y: p.y, dx: n.ux * n.d * 1.15, dy: n.uy * n.d * 1.15 };
    };
    /** 拖一手、等它结算完；没落下（没震那一下 8）就换一手再拖，最多六回。 */
    const commit = async (first) => {
      let snap = await still();
      for (let t = 0; t < 6; t++) {
        const d = t === 0 && first ? first : randomDrag(snap);
        const v0 = await vibCount();
        await drag(d, d.dx, d.dy);
        await page.waitForTimeout(300);
        const after = await still();
        const v = await vibSince(v0);
        if (v.includes(8)) return { d, scored: v.some(scoredBuzz) };
        snap = after;
      }
      return null;
    };
    // 慢的那一遍。
    const plan = [];
    let picked = 0;
    let lastScored = false;
    for (let i = 0; i < PAIRS && !lastScored; i++) {
      const s0 = await still();
      if (await page.$('#endOverlay.show')) break;
      const want = scoringDrag(s0.cells, s0.need);
      if (want) picked++;
      const a = await commit(want);
      if (!a) break;
      lastScored = a.scored;
      const b = await commit(null);
      if (!b) break;
      plan.push([a.d, b.d]);
    }
    // 快的那一遍：同一串码、同样的几手，第一手松手 80ms 就按第二手。
    await openSeeded(variant, rand);
    const pairs = [];
    for (const [a, b] of plan) {
      await still();
      const v0 = await vibCount();
      await drag(a, a.dx, a.dy);
      await page.waitForTimeout(80);
      await drag(b, b.dx, b.dy);
      await page.waitForTimeout(300);
      await still();
      const v = await vibSince(v0);
      const eights = v.reduce((acc, x, k) => (x === 8 ? [...acc, k] : acc), []);
      const aScored = eights.length > 0 && v.slice(eights[0] + 1, eights[1] ?? v.length).some(scoredBuzz);
      pairs.push({ eights: eights.length, aScored, v });
      if (process.env.DRAG_DEBUG) console.log(`DEBUG ${name}: ${JSON.stringify(v)}`);
    }
    await endAndMoves();
    const last = pairs[pairs.length - 1];
    check(`⑦ ${name}（尺子）慢的那一遍挑到了一手得分的第一手，快的那一遍那一对第一手也真得了分`,
      lastScored && !!last?.aScored, `挑中得分手 ${picked} 回，${plan.length} 对，最后一对：${JSON.stringify(last?.v)}`);
    check(`⑦ ${name}：第一手松手 80ms 就按第二手——每一对的两手都落下了（各震一下 8）`,
      pairs.length > 0 && pairs.every((p) => p.eights >= 2), pairs.map((p) => p.eights).join(' / '));
  }
  check('⑤⑥⑦ 零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
