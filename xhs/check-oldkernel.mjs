/**
 * 老内核体检台——在新浏览器上装成 Chrome 61 的样子，跑一遍这一版。
 *
 *   node xhs/check-oldkernel.mjs            # 五个玩法各打一局
 *   node xhs/check-oldkernel.mjs square     # 只跑一个
 *
 * 为什么要有这个：小工具的最低内核是 Android 8.1 那一档的 Chrome / WebView
 * 61，手边没有那样的真机，小红书的审核也要几天。但「缺哪些接口」是查得到
 * 的事实，所以可以反过来做——拿一个新内核，把 Chrome 61 **没有**的那些接口
 * 一个个删掉，再跑一遍。删干净了还能玩，就说明代码没踩到那些坑。
 *
 * 它测得到的：JS 接口缺失（一踩就抛错的那类）。
 * 它测不到的：CSS 的降级（认不得的声明会被整条丢掉，页面不报错只是散架）、
 *            真机的性能和字体。那两样要靠 xhs/src/baseline.css 和真机。
 *
 * 删接口的时机很关键：用 addInitScript，在页面任何脚本之前跑，所以模块顶层
 * 的代码（有几个模块加载时就调 flatMap）也在缺接口的环境里执行。
 *
 * 跑之前要先出一次包和预览页（这两个脚本读的是 xhs/preview.html，
 * 那是构建产物，不在仓库里）：
 *
 *   npm run check:xhs        ← 三步一起跑，平时用这个
 *
 * 只想单独跑这一个的话，先手动来两步：
 *
 *   npm run build:xhs && node xhs/preview.mjs
 *   node xhs/check-oldkernel.mjs
 *
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page404 = pathToFileURL(join(here, 'preview.html')).href;

/**
 * Chrome 61 没有的接口清单，括号里是它真正落地的版本。
 * 在页面里把它们删掉——补丁没补上的话，代码一碰就抛错。
 */
const STRIP = `
(() => {
  const del = (obj, name) => { try { delete obj[name]; } catch (e) {} };
  const A = Array.prototype, S = String.prototype;
  // Array
  del(A, 'at');            // 92
  del(A, 'flat');          // 69
  del(A, 'flatMap');       // 69
  del(A, 'findLast');      // 97
  del(A, 'findLastIndex'); // 97
  del(A, 'toSorted');      // 110
  del(A, 'toReversed');    // 110
  del(A, 'with');          // 110
  // String
  del(S, 'at');            // 92
  del(S, 'matchAll');      // 73
  del(S, 'trimStart');     // 66
  del(S, 'trimEnd');       // 66
  del(S, 'replaceAll');    // 85
  // Object
  del(Object, 'fromEntries'); // 73
  del(Object, 'hasOwn');      // 93
  // Promise
  del(Promise, 'allSettled'); // 76
  del(Promise, 'any');        // 85
  // 全局
  del(window, 'ResizeObserver');  // 64
  del(window, 'queueMicrotask');  // 71
  del(window, 'structuredClone'); // 98
  del(window, 'reportError');     // 95
  // DOM
  if (window.Element) {
    del(Element.prototype, 'replaceChildren'); // 86
    del(Element.prototype, 'getAnimations');   // 84
    del(Element.prototype, 'toggleAttribute'); // 69
  }
  if (window.Document) del(Document.prototype, 'getAnimations'); // 84
  // globalThis（71）故意**不**删：Playwright 自己跟页面说话就靠它，删了以后
  // 连测试脚本都跑不起来，测的就不是这一版了。产物里一次都没用到它
  //（构建后 grep 过），所以留着不影响这次体检的结论。
})();
`;

const MODES = {
  square: { name: '基础方块', card: 0 },
  circle: { name: '基础小球', card: 1 },
  bomb: { name: '炸弹', card: 2, pick: true },
  slot: { name: '老虎机', card: 3, slot: true },
  flip: { name: '无限反转', card: 4, pick: true },
};

const only = process.argv[2];
const list = only ? [only] : Object.keys(MODES);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails = 0;
const say = (ok, text, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + text + (extra ? '  ' + extra : ''));
};

for (const key of list) {
  const mode = MODES[key];
  if (!mode) {
    console.log('不认识的玩法：' + key);
    continue;
  }
  console.log('\n==== ' + mode.name + '（老内核） ====');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript(STRIP);
  // 顺便把样式降级层也强制打开：真的 Chrome 61 上这两件事是同时发生的
  // （接口缺、CSS 新写法也缺），分开测就漏了它们凑在一起的那一份。
  // CSS 那边逐个盒子的对照在 xhs/check-oldcss.mjs。
  await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text());
  });
  await p.goto(page404);

  // 确认接口真的被删了（补丁只补该补的，别的照旧缺着）
  const stripped = await p.evaluate(() => ({
    // 这几个补丁应该补上
    at: typeof [].at === 'function',
    flat: typeof [].flat === 'function',
    matchAll: typeof ''.matchAll === 'function',
    trimStart: typeof ''.trimStart === 'function',
    replaceChildren: typeof document.body.replaceChildren === 'function',
    getAnimations: typeof document.body.getAnimations === 'function',
    ro: typeof window.ResizeObserver === 'function',
    // 这几个没补，应该还是缺的（说明删的动作生效了）
    fromEntries: typeof Object.fromEntries === 'function',
    replaceAll: typeof ''.replaceAll === 'function',
  }));
  say(
    stripped.at && stripped.flat && stripped.matchAll && stripped.trimStart &&
      stripped.replaceChildren && stripped.getAnimations && stripped.ro,
    '七个补丁都装上了',
    JSON.stringify(stripped),
  );
  say(!stripped.fromEntries && !stripped.replaceAll, '没补的仍然缺着（说明删干净了）');

  // 主菜单
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  const cards = await p.$$('.home-icon-btn');
  say(cards.length >= 5, '主菜单五张卡都画出来了', cards.length + ' 张');
  await cards[mode.card].click();
  await p.waitForTimeout(800);

  // 形状选择 / 老虎机滚筒
  if (mode.pick) {
    const opts = await p.$$('.shape-pick-opt, .slot-pick-opt, .flip-pick-opt, button');
    const shape = await p.$('[data-family="square"]');
    if (shape) await shape.click();
    else if (opts.length) await opts[0].click();
    await p.waitForTimeout(700);
  }
  if (mode.slot) {
    const shape = await p.$('.slot-pick-opt[data-family="square"]');
    say(!!shape, '老虎机里有方块可选');
    if (shape) await shape.click();
    // 滚筒转完要几秒
    await p.waitForTimeout(9000);
  }

  const started = await p.$('#startBtn');
  if (started) {
    await p.$eval('#startBtn', (e) => e.click());
  }
  const boardOk = await p
    .waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  say(boardOk, '棋盘摆出来了');
  if (!boardOk) {
    say(false, '后面的没法测', errs.slice(0, 2).join(' | '));
    await ctx.close();
    continue;
  }
  await p.waitForTimeout(1200);

  // 棋盘尺寸：ResizeObserver 补丁不灵的话，这里会是 0 或者溢出屏幕
  const fit = await p.evaluate(() => {
    const b = document.querySelector('.board');
    const panel = document.querySelector('#boardWrap') || b.parentElement;
    const r = b.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), pw: Math.round(pr.width), ph: Math.round(pr.height) };
  });
  say(fit.w > 40 && fit.w <= fit.pw + 2 && fit.h <= fit.ph + 2, '棋盘摆得下这块地板', JSON.stringify(fit));

  // 真拖十下——at() 补丁不灵的话第一下就抛错
  const box = await p.$eval('.board', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const before = errs.length;
  for (let i = 0; i < 10; i++) {
    const row = 0.12 + (i % 6) * 0.15;
    await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * row);
    await p.mouse.down();
    await p.mouse.move(box.x + box.w * 0.5 + (i % 2 ? 62 : -62), box.y + box.h * row, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(280);
  }
  say(errs.length === before, '拖了十下没抛错', errs.slice(before, before + 2).join(' | '));

  // 顶上那三个读数：拖过之后至少得分/有效得分率/用时有一个动了，
  // 说明这十下真的走进了游戏逻辑，不只是没抛错而已。
  const hud = await p.evaluate(() => ({
    score: document.querySelector('.score-cell')?.textContent.trim().replace(/\s+/g, ' ') || '',
    perf: document.querySelector('#hud-perf')?.textContent.trim() || '',
    time: document.querySelector('#hud-time')?.textContent.trim() || '',
  }));
  say(hud.time !== '' && hud.time !== '0:00', '这十下真的进了游戏（读数在走）', JSON.stringify(hud));

  // 转横屏，看棋盘会不会跟着重排（ResizeObserver 补丁的正戏）
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(1500);
  const land = await p.evaluate(() => {
    const b = document.querySelector('.board');
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
  });
  say(land.h <= land.vh && land.w <= land.vw, '转横屏后棋盘还在屏幕里', JSON.stringify(land));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(1200);

  // 结算 + 战绩图（getAnimations / replaceChildren 都在这条路上）
  await p.click('#finishBtn');
  await p.waitForTimeout(2600);
  const shareBtn = await p.$('#shareBtn');
  say(!!shareBtn, '打得完，结算页出来了');
  if (shareBtn) {
    await shareBtn.click();
    await p.waitForTimeout(2000);
    const img = await p.evaluate(() => {
      const i = document.querySelector('#shareImage');
      return { src: (i?.getAttribute('src') || '').slice(0, 22), h: i?.naturalHeight ?? 0 };
    });
    say(img.src.indexOf('data:image/png') === 0 && img.h > 100, '战绩图画得出来', JSON.stringify(img));
  }

  say(errs.length === 0, '全程零报错', errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
