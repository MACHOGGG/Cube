/**
 * 老内核体检台——在新浏览器上装成 Chrome 61 的样子，跑一遍这一版。
 *
 *   node xhs/check-oldkernel.mjs            # 五个玩法各打一局 + 走一遍不是棋盘的那几屏
 *   node xhs/check-oldkernel.mjs square     # 只跑一个
 *   node xhs/check-oldkernel.mjs screens    # 只走成绩页那一条路
 *   node xhs/check-oldkernel.mjs daily      # 只走每日挑战那一路（第 19 推）
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
import { ensurePreview } from './ensurePreview.mjs';


// 读的是产物 preview.html，它不提交、也不会自己重出——过期了就在这儿重出一次
// （理由在 ensurePreview.mjs 的文件头：不这么做，这道门会在旧样式上全绿）。
ensurePreview();
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

/**
 * Chrome 61 没有 `el.style.translate` / `el.style.scale`（104）：赋值只是往 JS 对象上挂一个
 * 没人读的字段，不报错、不生效。
 *
 * 这两样没法像上面那些接口一样「删掉」：新内核上它们是浏览器自己拦下来的命名属性，不
 * 在原型上，`delete` 删不着（试过：删完 `'translate' in el.style` 还是 true，赋值照样生
 * 效）。所以给 `el.style` 套一层 Proxy——对它来说这两个名字不存在：原型链上有人补了（降
 * 级层的 installTransformShim）就交给那个人，没人补就和 61 一样只挂个字段。别的属性原
 * 样透过去。`rotate` 一起藏起来，它没人补，正好当尺子：赋了值，样式里什么都没有。
 *
 * 少了这一层，拖动时那一行的「压扁」和两边的晃动在这台体检台上照样画得出来——用的是新
 * 内核自己的 translate / scale，而老手机上它们一下都不动，门却是绿的。
 */
const HIDE_TRANSFORM_PROPS = `
(() => {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
  if (!desc || !desc.get) return;
  const HIDE = { translate: 1, scale: 1, rotate: 1 };
  const shimOf = (k) => Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, k);
  const cache = new WeakMap();
  Object.defineProperty(HTMLElement.prototype, 'style', {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      const real = desc.get.call(this);
      let px = cache.get(real);
      if (px) return px;
      const expando = {};
      px = new Proxy(real, {
        get(t, k) {
          if (typeof k === 'string' && HIDE[k]) {
            const acc = shimOf(k);
            return acc && acc.get ? acc.get.call(t) : expando[k];
          }
          const v = Reflect.get(t, k, t);
          return typeof v === 'function' ? v.bind(t) : v;
        },
        set(t, k, v) {
          if (typeof k === 'string' && HIDE[k]) {
            const acc = shimOf(k);
            if (acc && acc.set) acc.set.call(t, v);
            else expando[k] = v;
            return true;
          }
          return Reflect.set(t, k, v, t);
        },
        has(t, k) {
          if (typeof k === 'string' && HIDE[k]) return Boolean(shimOf(k));
          return Reflect.has(t, k);
        },
      });
      cache.set(real, px);
      return px;
    },
    set: desc.set,
  });
})();
`;

const MODES = {
  square: { name: '基础方块', card: 0 },
  circle: { name: '基础小球', card: 1 },
  bomb: { name: '炸弹', card: 2, pick: true },
  slot: { name: '老虎机', card: 3, slot: true },
  flip: { name: '无限反转', card: 4, pick: true },
  /**
   * 最后这一档不是玩法，是**不是棋盘的那几屏**：成绩与说明页 → 战绩详情 →
   * 《怎么玩》（分镜动画第 14 推下线了，那一屏不再走）。
   *
   * 补这一档的理由：这台体检台原先只走五个游戏局面，那三四屏一次都没在「接口
   * 被摘掉」的状态下画出来过。今天它们碰巧没事（用到的接口补丁层都补上了），
   * 可往后谁在成绩页、战绩详情、规则弹窗里顺手用一个新写法（一个 `Object
   * .fromEntries` 就够），五道门会**全绿**，而老手机上的玩家一点成绩页就是白
   * 屏——后台连一条报错都留不下，因为那条路根本没人测过。
   *
   * 它借方块那一局开路：战绩详情要有一条真的战绩才点得开，而战绩是打完一局才
   * 写进 localStorage 的。所以这一档先照 card 0 打一局（和 square 那一档一模
   * 一样的走法），打完从结算页退回主菜单，再往那几屏走。
   */
  screens: { name: '成绩页 → 战绩详情 → 怎么玩', card: 0, screens: true },
};

const only = process.argv[2];
// 'daily' 不在 MODES 里：每日挑战那一路在循环后面单独跑（见文件末尾）。
const list = only ? (only === 'daily' ? [] : [only]) : Object.keys(MODES);

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
  await ctx.addInitScript(HIDE_TRANSFORM_PROPS);
  // 两台体检台都先把「教学看过了」这一格填上：第一次进游戏会自动弹那五条
  // 规则（xhs/src/tutorial.ts），弹出来就挡住棋盘，后面的拖动和量尺寸全做
  // 不了。这一屏本身单独测（check-oldcss 的「怎么玩」那一屏，和
  // 教学那支专门的脚本），不靠这里顺带。
  await ctx.addInitScript(`try {
  // 教学那两处都先填上「看过了」，否则体检台点开方块 / 小球会落在分镜动画上，
  // 等不到棋盘。教学本身另有专门的脚本测（check-story）和 check-oldcss 的
  // 「方块分镜动画」那一屏。
  localStorage.setItem('slides.xhs.story.square', '1');
  localStorage.setItem('slides.xhs.story.circle', '1');
} catch (e) {}`);
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
    // translate / scale：降级层的垫片补上了（第 14 推）；rotate 没人补，赋值不进样式
    xfShim: 'translate' in document.body.style && 'scale' in document.body.style,
    rotateGone: (() => {
      const el = document.createElement('div');
      el.style.rotate = '5deg';
      return !/rotate/.test(el.getAttribute('style') || '');
    })(),
  }));
  say(
    stripped.at && stripped.flat && stripped.matchAll && stripped.trimStart &&
      stripped.replaceChildren && stripped.getAnimations && stripped.ro,
    '七个补丁都装上了',
    JSON.stringify(stripped),
  );
  say(!stripped.fromEntries && !stripped.replaceAll, '没补的仍然缺着（说明删干净了）');
  say(stripped.rotateGone, '（尺子）el.style 上那几个单独的变换属性真的藏起来了（rotate 赋值进不了样式）');
  say(stripped.xfShim, 'el.style.translate / scale 降级层补上了（第 14 推）');

  // 主菜单
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  // 跳过最上面那张《每日挑战》（第 19 推）：这儿按下标点的是玩法卡，下标从方块数起。
  const cards = await p.$$('.home-icon-btn:not(.home-icon-btn--daily)');
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
  // 拖的时候记下棋子身上每一次样式变化：被拖那一行的「压扁」、两边的晃动，在老内核上
  // 只能走 transform（第 14 推的垫片）。记的是 style 属性的变化，不是某一拍的截面——
  // 晃动是弹簧，手一停就回去了，截面要看运气。
  await p.evaluate(() => {
    const rec = { writes: 0, xf: 0, squash: 0, indiv: 0, els: new Set() };
    const host = document.querySelector('#boardWrap');
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target;
        if (!el.matches || !el.matches('.tile, .ball')) continue;
        rec.writes++;
        const css = el.getAttribute('style') || '';
        if (/(^|;)\s*transform\s*:[^;]*(translate|scale)/.test(css)) {
          rec.xf++;
          rec.els.add(el);
        }
        // scale( 只有拖动那一下的「压扁」会写（消行后的滑动写的是 translate），所以它
        // 单独数：方块那一副消一次行也会写 transform，光数 transform 分不出是谁写的。
        if (/(^|;)\s*transform\s*:[^;]*scale\(/.test(css)) rec.squash++;
        if (/(^|;)\s*(translate|scale)\s*:/.test(css)) rec.indiv++;
      }
    });
    mo.observe(host, { attributes: true, attributeFilter: ['style'], subtree: true });
    window.__xfStop = () => {
      mo.disconnect();
      return { writes: rec.writes, xf: rec.xf, squash: rec.squash, els: rec.els.size, indiv: rec.indiv };
    };
  });
  for (let i = 0; i < 10; i++) {
    const row = 0.12 + (i % 6) * 0.15;
    await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * row);
    await p.mouse.down();
    await p.mouse.move(box.x + box.w * 0.5 + (i % 2 ? 62 : -62), box.y + box.h * row, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(280);
  }
  say(errs.length === before, '拖了十下没抛错', errs.slice(before, before + 2).join(' | '));
  await p.waitForTimeout(1500);
  // 「手松开之后清得掉」不在这儿量：每一步落定棋盘都整个重画，旧的那些棋子连同身上的
  // 变换一起扔掉了——故意让垫片永远不清，这里照样全绿（试过）。清不清得掉在
  // scripts/check-downlevel.mjs 第 9 节拿假的 CSSStyleDeclaration 量。
  const xf = await p.evaluate(() => (window.__xfStop ? window.__xfStop() : null));
  say(Boolean(xf) && xf.writes > 20, '（尺子）拖的时候棋子身上的样式真的在变', JSON.stringify(xf));
  say(Boolean(xf) && xf.squash > 0 && xf.els >= 3 && xf.indiv === 0,
    '拖动时的压扁 / 晃动在老内核上照样画出来（走 transform，第 14 推）', JSON.stringify(xf));

  // 顶上那两块：拖过之后《拼出得分》或《得分图案》里得有一个动了，说明这十下真
  // 的走进了游戏逻辑，不只是没抛错而已。
  //
  // 这一条原先读的是 `#hud-perf` 和 `#hud-time`，还拿「用时不是 0:00」当尺子。那
  // 两个东西 2026-09 都没有了（《侵蚀阶梯》v1.2 PR-7：顶排从三格变两块，《行动有
  // 效率》在任何界面都不存在，钟只有计时那一档才画、摆在暂停键上方）。于是这一条
  // 量的是两个查不到的选择器，**永远红**，而红的不是它守的那件事。
  //
  // 现在量的是这一版真有的两样：刻度环的段数（每翻一枚熄一段，engine/erosion.ts）
  // 和《拼出得分》那个数。两个里有一个动了就算走进去了。
  const hudAfter = await p.evaluate(() => ({
    score: document.querySelector('#scoreReel')?.textContent.trim() || '',
    // 刻度环上还亮着几段：熄掉的那些 class 里带 --off
    lit: document.querySelectorAll('#patternBlock [class*="tick"]:not([class*="off"])').length,
    block: !!document.querySelector('#patternBlock'),
  }));
  say(hudAfter.block && (hudAfter.score !== '' && hudAfter.score !== '0'),
    '这十下真的进了游戏（读数在走）', JSON.stringify(hudAfter));

  // 转横屏，看棋盘会不会跟着重排（ResizeObserver 补丁的正戏）
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(1500);
  const land = await p.evaluate(() => {
    const b = document.querySelector('.board');
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
  });
  // **下限和上限一样要紧**。原先这一条只写了「不超出屏幕」，于是棋盘塌成
  // 0×0 的时候它照样绿——0 当然既不超宽也不超高。真出过这一幕：降级层那份
  // 五栏兜底把横屏教学条那套新版式的列宽盖掉，棋盘那一列算成 0px，控制台刷
  // 出 `<svg> attribute width: A negative value is not valid. ("-4")`（0 减掉
  // 五道缝再除以六列 = −4.17），而这一行一声不吭，红的是下面那条「全程零报
  // 错」——查了半天才查到真凶。40px 的门槛照竖屏那一条（fit.w > 40）写。
  say(land.w > 40 && land.h > 40 && land.h <= land.vh && land.w <= land.vw,
    '转横屏后棋盘还在屏幕里，而且没塌', JSON.stringify(land));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(1200);

  // 结算 + 战绩图（getAnimations / replaceChildren 都在这条路上）
  //
  // 这一局有可能**已经自己结束了**——尤其老虎机：这一局只认转出来的那两个
  // 图案，十下瞎拖很容易把场面拖到「再也凑不出来」，游戏就自己结算了。那是
  // 一局正常走完，不是毛病；但结算页一盖上来，暂停键就点不着了
  // （overlay 挡住），从前这里会卡在那颗按钮上直到超时。
  //
  // 所以先看结算页在不在：在了就别再按《完成》。
  const ended = await p.$eval('#endOverlay', (e) => e.classList.contains('show')).catch(() => false);
  if (!ended) {
    // 收尾是两步：《完成》搬进了暂停面板，现在叫《结束游戏》。
    await p.click('#stopBtn');
    await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
    await p.click('#pauseFinishBtn');
    await p.waitForTimeout(2600);
  }
  // 要看的是**结算页真的盖上来了**，不是「页面里有这么个按钮」——那三颗键
  // 从头到尾都在 DOM 里，只查得到它就等于什么也没查。从前这条就是这么写的，
  // 结果结算页压根没出来（画图那一步抛了错），它照样绿着，红的是下一行那颗
  // 点不着的《分享》，报的还是「棋盘挡住了」——查了半天才查到真凶。
  const endUp = await p.$eval('#endOverlay', (e) => e.classList.contains('show')).catch(() => false);
  const shareBtn = endUp ? await p.$('#shareBtn') : null;
  say(endUp && !!shareBtn, '打得完，结算页出来了', (ended ? '（这一局自己打完了，没按《结束游戏》）' : '') + (endUp ? '' : ' 结算页没盖上来：' + errs.slice(-2).join(' | ')));
  // 结算页那一句「综合得分怎么算」：只摆头一回，而这一档是新开的上下文——这是它这辈子
  // 第一张结算页。这一版从前没接 shouldTeachTotal（第 14 推），这一句一次都没摆过。
  // 只在基础方块那一档量：老虎机、无限反转不乘步数系数，本来就不讲这一句。
  if (endUp && key === 'square') {
    const tip = await p.$eval('#endOverlay', (e) => (e.querySelector('.end-row--tip') || {}).textContent || '').catch(() => '');
    say(tip.trim().length > 0, '头一回的结算页上摆着「综合得分怎么算」那一句（第 14 推）', tip.trim().slice(0, 40));
  }
  if (shareBtn) {
    await shareBtn.click();
    await p.waitForTimeout(2000);
    const img = await p.evaluate(() => {
      const i = document.querySelector('#shareImage');
      return { src: (i?.getAttribute('src') || '').slice(0, 22), h: i?.naturalHeight ?? 0 };
    });
    say(img.src.indexOf('data:image/png') === 0 && img.h > 100, '战绩图画得出来', JSON.stringify(img));
  }

  // ── 不是棋盘的那几屏（只有 screens 这一档走）──────────────────────
  //
  // 一路按下去，每一屏都**量它真的立起来了**，不是「DOM 里有这么个节点」：
  // 老内核上这几屏出事的样子是「JS 抛错 → 这一屏半张脸」，节点在不在说明不了
  // 问题。所以战绩详情量那张图解码出来没有、《怎么玩》量五条规则连配图画出来没有。
  if (mode.screens) {
    // 结算页那会儿分享窗口还盖着（上面点过《分享》），先收起来再退。
    if (await p.$('#shareCloseBtn')) {
      await p.click('#shareCloseBtn');
      await p.waitForTimeout(600);
    }
    // 退回主菜单：结算页上那颗《返回主页》。按文字找，和 check-oldcss 同一招
    // ——那几颗键的 id 换过，文字没换。
    for (const btn of await p.$$('.endcard button, .modal button, #endOverlay button')) {
      const t = ((await btn.textContent()) || '').trim();
      if (/菜单|返回|主页/.test(t)) {
        await btn.click();
        break;
      }
    }
    await p.waitForTimeout(1400);

    // ① 成绩与说明页
    const navOk = await p.$('#xhsProfile');
    say(!!navOk, '底排那颗《成绩与说明》还在');
    if (navOk) {
      await p.click('#xhsProfile');
      await p.waitForTimeout(1200);
    }
    const prof = await p.evaluate(() => ({
      page: !!document.querySelector('.xhs-profile'),
      total: (document.querySelector('.total-card-value') || {}).textContent || '',
      rows: document.querySelectorAll('.records-row').length,
      how: !!document.querySelector('.xhs-how'),
    }));
    // 累计得分是从 localStorage 里那几条战绩算出来的——它有数，说明刚打完这一
    // 局真的存进去、又读出来了（存/读这条路上有 JSON、有 Object 遍历）。
    say(prof.page && prof.how && prof.rows >= 1 && prof.total !== '',
      '成绩与说明页画出来了（有战绩行、有《怎么玩》）', JSON.stringify(prof));

    // ② 战绩详情：那张图是现画的 canvas，老内核上最容易在这儿栽
    if (prof.rows >= 1) {
      await p.$eval('.records-row', (e) => e.click());
      await p.waitForTimeout(2200);
      const sheet = await p.evaluate(() => {
        const img = document.querySelector('.xhs-run-img');
        return {
          page: !!document.querySelector('.xhs-run-sheet'),
          src: ((img && img.getAttribute('src')) || '').slice(0, 22),
          h: (img && img.naturalHeight) || 0,
          back: !!document.querySelector('#runBack'),
        };
      });
      say(sheet.page && sheet.src.indexOf('data:image/png') === 0 && sheet.h > 100,
        '战绩详情页出来了，图也画得出来', JSON.stringify(sheet));
      if (sheet.back) {
        await p.click('#runBack');
        await p.waitForTimeout(1000);
      }
    }

    // ③ 《怎么玩》那一屏（五条规则 + 配图）
    if (await p.$('.xhs-how')) {
      await p.click('.xhs-how');
      await p.waitForTimeout(1000);
    }
    const how = await p.evaluate(() => ({
      modal: !!document.querySelector('.howto-modal, .howto-ov'),
      // 要排掉 .tut-rule--extra：那是五条底下另起的一节（炸弹、无限反转各一条附
      // 注），不是规则本身。从前这儿没排，而上面那一条写的是 `>= 5`——五条加两条
      // 附注是 7，照样 ≥ 5，于是这个选择器松了也没人发现。
      rules: document.querySelectorAll('.howto-ov .tut-rule:not(.tut-rule--extra), .howto-list .tut-rule:not(.tut-rule--extra)').length,
      arts: document.querySelectorAll('.howto-ov .tut-rule:not(.tut-rule--extra) .tut-rule-art').length,
      story: document.querySelectorAll('.howto-story').length,
    }));
    // 五条，不是六条（教学 2026-09 改成玩家亲笔的五条）。这儿量的是「每一条都配了
    // 图」，所以条数和幅数要**相等**，不是各自 ≥5——错位的时候两个数都还 ≥5。
    say(how.modal && how.rules === 5 && how.arts === 5,
      '《怎么玩》五条规则连配图都画出来了', JSON.stringify(how));

    // ④ 分镜动画：从前这儿接着点一颗分镜键、量它立没立起来。第 14 推那两段下线了
    // （还在教旧规则），《怎么玩》上不该再有进去的键。
    say(how.story === 0, '《怎么玩》上不再摆分镜键（第 14 推下线）', JSON.stringify(how));
  }

  say(errs.length === 0, '全程零报错', errs.slice(0, 3).join(' | '));
  await ctx.close();
}

/*
 * ── 每日挑战（第 19 推）────────────────────────────────────────────────────
 *
 * 方案的门：「小红书旧内核下日期数字可见」。再加上一件只有这一端才有的事：每日挑战二十天一圈，
 * 有一半的日子轮到的棋盘主菜单上没有（菱形方块、六边圆球、七色圆球、六边蜂窝 54——xhs/src/main.ts
 * 的 ALL_GAMES）。它们在网页端打过无数局，可从没在「接口被摘掉」的状态下开过一局——所以这儿每
 * 一副都用输种子那条路开一次、拖几下，零报错才算。计时、定时炸弹、进阶炸弹这三档同理（这一端主
 * 菜单上没有它们的入口）。
 */
if (!only || only === 'daily') {
  console.log('\n==== 每日挑战（老内核） ====');
  const SC = await import('../api/_seedcode.js');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(STRIP);
  await ctx.addInitScript(HIDE_TRANSFORM_PROPS);
  await ctx.addInitScript(`try {
  localStorage.setItem('slides.xhs.story.square', '1');
  localStorage.setItem('slides.xhs.story.circle', '1');
} catch (e) {}`);
  await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text());
  });
  await p.goto(page404);
  await p.waitForSelector('.home-icon-btn--daily', { timeout: 30000 });
  await p.waitForTimeout(600);
  const card = await p.evaluate(() => {
    const btn = document.querySelector('.home-icon-btn--daily');
    const t = btn && btn.querySelector('text.daily-date');
    const r = t && t.getBoundingClientRect();
    const cs = t && getComputedStyle(t);
    const first = document.querySelector('.home-grid .home-row');
    return {
      first: !!first && first.querySelectorAll('.home-icon-btn').length === 1 && !!first.querySelector('.home-icon-btn--daily'),
      date: t ? t.textContent.trim() : '',
      w: r ? r.width : 0,
      h: r ? r.height : 0,
      fill: cs ? cs.fill : '',
      font: cs ? cs.fontFamily : '',
    };
  });
  // 本机时间的北京日期：这一端用本机的钟（方案原话）。
  const today = new Date(Date.now() + 8 * 3600e3).getUTCDate();
  say(card.first, '每日挑战在最上面那一行、那一行只有它');
  say(card.date === String(today) && card.w > 4 && card.h > 4, '老内核下日期数字画得出来（有字、有大小）', JSON.stringify(card));
  say(!!card.fill && card.fill !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(card.fill), '日期数字的颜色算得出来（不是 none / 透明）', card.fill);

  /** 进每日挑战那一页，敲一串码（不给就按《今日挑战》），数完开局，拖几下。 */
  const playSeed = async (code, label) => {
    await p.evaluate(() => document.querySelector('.home-icon-btn--daily').click());
    await p.waitForSelector('#dailyPlay', { timeout: 8000 });
    if (code) {
      await p.fill('#seedInput', code);
      await p.evaluate(() => document.querySelector('#seedGo').click());
    } else {
      await p.evaluate(() => document.querySelector('#dailyPlay').click());
    }
    await p.waitForTimeout(800);
    // 七色圆球那一天：竖着的手机先「请横屏」——转过来再数。
    const turn = await p.evaluate(() => {
      const t = document.querySelector('#dailyTurn');
      return !!t && !t.hidden;
    });
    if (turn) {
      await p.setViewportSize({ width: 844, height: 390 });
      await p.waitForTimeout(600);
    }
    const ok = await p
      .waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    say(ok, `${label}：棋盘摆出来了`);
    if (ok) {
      await p.waitForTimeout(1200);
      const before = errs.length;
      const box = await p.evaluate(() => {
        const r = document.querySelector('#boardWrap').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
      });
      for (let i = 0; i < 4; i++) {
        const dx = i % 2 ? box.w * 0.18 : -box.w * 0.18;
        await p.mouse.move(box.x, box.y);
        await p.mouse.down();
        await p.mouse.move(box.x + dx, box.y, { steps: 6 });
        await p.mouse.up();
        await p.waitForTimeout(500);
      }
      say(errs.length === before, `${label}：拖了几下没抛错`, errs.slice(before, before + 2).join(' | '));
    }
    if (turn) await p.setViewportSize({ width: 390, height: 844 });
    // 回主菜单：重开预览页最干净（这一页打到一半没有《退出》那一条路可走）。
    await p.goto(page404);
    await p.waitForSelector('.home-icon-btn--daily', { timeout: 30000 });
    await p.waitForTimeout(400);
  };

  await playSeed('', '今日挑战');
  const extra = [
    [2, '菱形方块'], [3, '六边圆球'], [4, '七色圆球'], [5, '六边蜂窝 54'],
    [6, '计时（方块）'], [10, '定时炸弹（方块）'], [12, '进阶炸弹（菱形方块）'],
  ];
  for (const [v, name] of extra) {
    await playSeed(SC.encodeSeed(SC.DEAL_VERSION, v, 31337 + v), `输种子开一局 ${name}`);
  }
  say(errs.length === 0, '每日挑战这一路全程零报错', errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
