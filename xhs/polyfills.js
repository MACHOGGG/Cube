/*
 * Chrome 61 能力补丁——**只有小红书这一版加载它**，而且是在别的代码之前。
 *
 * 小工具的最低内核是 Android 8.1 那一档的 Chrome / WebView 61（规范见
 * .claude/skills/minitool-zip-builder/references/device-capabilities.md）。
 * 打包时 esbuild 会把**语法**降到 es2017，但**接口**它不管：代码里写
 * `chain.at(3)`，esbuild 原样留着，到了 Chrome 61 上就是
 * 「chain.at is not a function」——一抛错，整段逻辑当场断掉。
 *
 * 这个文件补的就是那些接口。清单（括号里是它真正落地的 Chrome 版本）：
 *
 *   Array.prototype.at              (92)  ← 最要命的一个，见下
 *   Array.prototype.flat / flatMap  (69)
 *   String.prototype.matchAll       (73)
 *   String.prototype.trimStart/End  (66)
 *   Element.prototype.replaceChildren (86)
 *   Element.prototype.getAnimations   (84)
 *   ResizeObserver                  (64)
 *
 * 为什么 at() 最要命：方块和小球的拖动过程里，每一帧都要算补位块的位置，
 * 算式就是 `c * cell + chain.at(c) * cell`（src/shapes/square.ts、
 * circle.ts）。Chrome 61 上第一次拖动就抛错，**拖动整个不能用**——而这一版
 * 除了拖动没有别的玩法。
 *
 * 为什么 ResizeObserver 不能只补个空壳：棋盘是靠它来「地板尺寸变了 → 重新
 * 摆盘」的（src/engine/boardResize.ts 开头那段注释说了这是唯一诚实的信号）。
 * 补空壳的话不报错，但横竖屏一转棋盘就摆不正。所以这里是真补：一个轮询的
 * 实现，加上 resize / orientationchange 立刻校一次。
 *
 * 规矩：
 *   · 全部先判断「有没有」，有就不动——新内核上这个文件等于不存在。
 *   · 挂到原型上一律用 defineProperty 且不可枚举，免得 for...in 数组时多出
 *     一个 key（原生的就是不可枚举的）。
 *   · 只用 Chrome 61 本来就有的东西写（const / 箭头函数 / class 都行，
 *     它是 ES2017 内核）。
 *
 * 这个文件不进 Vite，构建时由 xhs/build.mjs 直接拼到 app.js 最前面——
 * 必须比任何模块的顶层代码先跑（有几个模块在加载时就调 flatMap）。
 */
(function () {
  'use strict';

  /** 挂一个不可枚举的方法，已经有的就不碰。 */
  const def = (obj, name, fn) => {
    if (obj && !obj[name]) {
      Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });
    }
  };

  const A = Array.prototype;
  const S = String.prototype;

  // ---- Array.prototype.at (Chrome 92) --------------------------------------
  // 拖动每一帧都在用。负数从末尾数，越界给 undefined——和原生一致。
  def(A, 'at', function (index) {
    const len = this.length;
    let i = Math.trunc(index) || 0;
    if (i < 0) i += len;
    return i < 0 || i >= len ? undefined : this[i];
  });
  def(S, 'at', function (index) {
    const len = this.length;
    let i = Math.trunc(index) || 0;
    if (i < 0) i += len;
    return i < 0 || i >= len ? undefined : this.charAt(i);
  });

  // ---- Array.prototype.flat / flatMap (Chrome 69) --------------------------
  // 三角/六边的格位表在**模块加载时**就调 flatMap（triangle.ts 顶上那句
  // `ROW_LENS.flatMap(...)`），所以这个文件必须比模块先跑。
  def(A, 'flat', function (depth) {
    const d = depth === undefined ? 1 : Math.floor(Number(depth)) || 0;
    const out = [];
    const walk = (arr, left) => {
      for (let i = 0; i < arr.length; i++) {
        if (!(i in arr)) continue; // 稀疏数组的空洞照原生的规矩跳过
        const v = arr[i];
        if (left > 0 && Array.isArray(v)) walk(v, left - 1);
        else out.push(v);
      }
    };
    walk(this, d);
    return out;
  });
  def(A, 'flatMap', function (fn, thisArg) {
    return A.map.call(this, fn, thisArg).flat(1);
  });

  // ---- String.prototype.matchAll (Chrome 73) -------------------------------
  // 只有一处在用（src/ui/customIcons.ts 扫 SVG 里的 id），走的是 for...of，
  // 所以返回一个迭代器就够——这里用数组自己的迭代器。
  def(S, 'matchAll', function (re) {
    const flags = re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g';
    const rx = new RegExp(re.source, flags);
    const out = [];
    const text = String(this);
    let m;
    while ((m = rx.exec(text)) !== null) {
      out.push(m);
      // 空匹配会让 lastIndex 停在原地，手动推一格，否则死循环。
      if (m[0] === '') rx.lastIndex++;
    }
    return out[Symbol.iterator]();
  });

  // ---- String.prototype.trimStart / trimEnd (Chrome 66) --------------------
  // anime.js 内部在用（读 CSS 变量的值时削掉前面的空格）。
  def(S, 'trimStart', function () {
    return String(this).replace(/^[\s﻿ ]+/, '');
  });
  def(S, 'trimEnd', function () {
    return String(this).replace(/[\s﻿ ]+$/, '');
  });

  if (typeof Element !== 'undefined') {
    const E = Element.prototype;

    // ---- Element.replaceChildren (Chrome 86) -------------------------------
    // 得分时那块「+N」的牌子每次先清空再填（src/engine/scoreReel.ts）。
    def(E, 'replaceChildren', function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (let i = 0; i < arguments.length; i++) {
        const node = arguments[i];
        this.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
      }
    });

    // ---- Element.getAnimations (Chrome 84) ---------------------------------
    // 翻面动画开始前要把这一块上还没放完的动画掐掉（src/engine/plankFlip.ts）。
    // Chrome 61 有 element.animate()，只是没有「问它身上有哪些动画」这一步，
    // 所以这里把 animate() 包一层，自己记账；放完的顺手扔掉，不留垃圾。
    if (!E.getAnimations && typeof E.animate === 'function') {
      const LEDGER = new WeakMap();
      const nativeAnimate = E.animate;
      E.animate = function () {
        const anim = nativeAnimate.apply(this, arguments);
        let list = LEDGER.get(this);
        if (!list) { list = []; LEDGER.set(this, list); }
        list.push(anim);
        const drop = () => {
          const at = list.indexOf(anim);
          if (at >= 0) list.splice(at, 1);
        };
        if (anim.finished && typeof anim.finished.then === 'function') {
          anim.finished.then(drop, drop);
        } else {
          anim.addEventListener('finish', drop);
          anim.addEventListener('cancel', drop);
        }
        return anim;
      };
      def(E, 'getAnimations', function () {
        return (LEDGER.get(this) || []).slice();
      });
    }
  }

  // ---- ResizeObserver (Chrome 64) ------------------------------------------
  // 棋盘、老虎机滚筒、教学页都靠它「地板变了就重排」。原生的是布局一变就
  // 回调；这里做不到那么准，改成定时量一遍 + 转屏/改窗口时立刻量一遍。
  // 100ms 的节奏对「转屏后把棋盘摆正」来说足够，而量的元素从来只有个位数。
  if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
    const WATCHED = []; // { ro, el, w, h }
    let timer = null;

    const measure = (el) => {
      const r = el.getBoundingClientRect();
      // 取整到 0.5px：安卓上的亚像素抖动会让宽高每帧都差一点点，
      // 不收一下就会无休止地重排。
      return [Math.round(r.width * 2) / 2, Math.round(r.height * 2) / 2];
    };

    const sweep = () => {
      // 同一个 observer 这一轮量出来的变化并成一次回调——和原生一致。
      const batches = new Map();
      for (const rec of WATCHED) {
        const [w, h] = measure(rec.el);
        if (w === rec.w && h === rec.h) continue;
        rec.w = w;
        rec.h = h;
        const entry = {
          target: rec.el,
          contentRect: rec.el.getBoundingClientRect(),
          borderBoxSize: [{ inlineSize: w, blockSize: h }],
          contentBoxSize: [{ inlineSize: w, blockSize: h }],
        };
        const list = batches.get(rec.ro);
        if (list) list.push(entry);
        else batches.set(rec.ro, [entry]);
      }
      batches.forEach((entries, ro) => {
        try {
          ro._cb(entries, ro);
        } catch (e) {
          /* 一个观察者出错不该带塌其他的 */
        }
      });
    };

    const start = () => {
      if (timer === null && WATCHED.length) timer = window.setInterval(sweep, 100);
    };
    const stop = () => {
      if (timer !== null && !WATCHED.length) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    // 转屏和改窗口是「一定会变」的时刻，不等那 100ms。等一帧再量，
    // 让浏览器先把新的排版算完。
    const soon = () => window.requestAnimationFrame(sweep);
    window.addEventListener('resize', soon);
    window.addEventListener('orientationchange', soon);

    class ResizeObserverShim {
      constructor(cb) {
        this._cb = cb;
      }
      observe(el) {
        if (!el || WATCHED.some((r) => r.ro === this && r.el === el)) return;
        // 原生的会在开始观察时先回调一次；这里记 -1 让第一轮必定算「变了」。
        WATCHED.push({ ro: this, el: el, w: -1, h: -1 });
        start();
        soon();
      }
      unobserve(el) {
        for (let i = WATCHED.length - 1; i >= 0; i--) {
          if (WATCHED[i].ro === this && WATCHED[i].el === el) WATCHED.splice(i, 1);
        }
        stop();
      }
      disconnect() {
        for (let i = WATCHED.length - 1; i >= 0; i--) {
          if (WATCHED[i].ro === this) WATCHED.splice(i, 1);
        }
        stop();
      }
    }
    window.ResizeObserver = ResizeObserverShim;
  }
})();
