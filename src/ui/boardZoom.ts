import { ZOOM_BACK_MS, ZOOM_HOLD_MS, zoomFrom, type Fit } from '../engine/liveFit';

/**
 * 「剩下的部分长大了」那一下动画——五副外边族共用。
 *
 * ── 为什么要倒着做 ──────────────────────────────────────────────
 *
 * 一拍消除走完，`render()` 画出来的已经是**放大之后**的棋盘了。直接换上去，玩家看到的是
 * 「上一帧还没看清，棋子就跳大了」——跳变不是动画，而玩家只会觉得「闪了一下」。
 *
 * 所以换上去的同一拍先给棋盘压一个变换，让它看起来和上一帧一模一样（`zoomFrom`），停
 * `ZOOM_HOLD_MS` 让他看清是哪几枚消掉了，再用方块那条 easing 在 `ZOOM_BACK_MS` 里回到不
 * 变换——于是看见的是「剩下的部分长大了」。
 *
 * ── 五副共用一份，不是各写一遍 ──────────────────────────────────
 *
 * 这个仓库为「同一件事手写了十六遍」写过一整篇文件头注释。这一下动画有四个容易写错的地
 * 方（强制一帧、取消时机、落点修正、Chrome 61 不认哪些 API），抄五遍就是五份各错各的。
 */

/** 方块消行那条 easing：慢起、最后一小段「吸」上去（见 square.ts 的 COLLAPSE_SLIDE_EASING）。 */
const EASING = 'cubic-bezier(0.5, 0, 0.18, 1.4)';

/** 取消那一刻棋盘上压着的变换。落点要照它往回换算。 */
export interface ZoomSnapshot {
  ax: number;
  ay: number;
  s: number;
}

export interface BoardZoom {
  /** 记下「玩家此刻看到的那一帧」。连锁每一拍开头（`onCascadeStep`）调。 */
  mark(fit: Fit): void;
  /** 这一拍 `render()` 之后调。该放大就先倒回去，再长过来。 */
  play(fit: Fit): void;
  /**
   * 取消正在跑的那一下，并交出**取消那一刻**棋盘上压着的变换。
   *
   * 每一次 `layoutBoard()` 都要调它：底板尺寸或者活格框一变，手上这个变换就是按旧数算
   * 的，留着只会把新这一帧推到一个莫名的位置上。
   */
  cancel(): ZoomSnapshot | null;
  /** 页面离开时把定时器收干净。 */
  dispose(): void;
}

/**
 * 从 `getComputedStyle().transform` 那个字符串里把缩放和平移抠出来。
 *
 * ⚠️ **不用 `DOMMatrix`，也不用单独的 `scale` / `translate` 属性。** 这一份代码要跑在
 * **Chrome 61** 上（小红书那一端，见 CLAUDE.md）：`DOMMatrix` 那会儿还叫 `WebKitCSSMatrix`、
 * 构造函数不收字符串，而 `scale` 作为独立的 CSS 属性要到 Chrome 104。两样都是「本地好好
 * 的、真机上整块棋盘不动」那种坏法——而降级层拦不住它，因为它不报错。
 *
 * 字符串只有两种形状：`none`，或者 `matrix(a, b, c, d, e, f)`。我们自己压上去的变换只有
 * 平移和等比缩放，所以 a === d === 缩放、e / f 是平移，b 和 c 恒为 0。
 */
export function parseMatrix(transform: string): ZoomSnapshot | null {
  const m = /^matrix\(([^)]+)\)$/.exec(transform.trim());
  if (!m) return null;
  const n = m[1].split(',').map((x) => parseFloat(x));
  if (n.length < 6 || n.some((x) => !Number.isFinite(x))) return null;
  const s = n[0];
  if (!(s > 0)) return null;
  return { ax: n[4], ay: n[5], s };
}

export function createBoardZoom(el: HTMLElement, reduceMotion: () => boolean): BoardZoom {
  /** 上一帧（玩家此刻看到的那一个）。`mark` 填，`play` 用完就扔。 */
  let seen: Fit | null = null;
  const timers: number[] = [];

  const clearTimers = () => {
    while (timers.length) window.clearTimeout(timers.pop());
  };

  const clearTransform = () => {
    el.style.transition = '';
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.willChange = '';
  };

  return {
    mark(fit) {
      seen = fit;
    },

    play(fit) {
      const from = seen;
      seen = null;
      if (!from || reduceMotion()) return;
      const t = zoomFrom(from, fit);
      /*
       * 只在**真的长大了**的那一拍动（`scale < 1`：要先缩回去，才好长过来）。
       *
       * 两种不动的情形：
       *
       *   · `scale ≈ 1`——这一拍没放大，多数拍都是。压一个恒等变换也要花一次合成，而且会把
       *     别的动画（翻面的替身、消除的淡出）挤到另一层上去。
       *   · `scale > 1`——盘面**缩回去了**。只有一种时候会发生：最后一枚也消掉了，活格框没
       *     了，`fitLive` 退回「按整副棋盘摆、zoom 1」。那一拍盘上一枚棋子都没有，却要把一
       *     块空底板从 6.6 倍缩回来——没有任何东西可看，纯粹白花一次合成。逐帧量出来的，
       *     见决策文件那一条。
       */
      if (t.scale >= 1 - 1e-4) return;
      clearTimers();
      el.style.transformOrigin = '0 0';
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transform = `translate3d(${t.ax}px, ${t.ay}px, 0) scale(${t.scale})`;
      /*
       * 逼浏览器现在就把上面那一句算掉。
       *
       * 不读这一下的话，这一帧里设的两次 transform（倒回去、再回到原位）会被合并成「什么
       * 都没发生」——过渡从来不会开始，玩家看到的就是跳变。读 `offsetWidth` 是最便宜的那
       * 种强制回流，而且 Chrome 61 也认。
       */
      void el.offsetWidth;
      timers.push(window.setTimeout(() => {
        el.style.transition = `transform ${ZOOM_BACK_MS}ms ${EASING}`;
        el.style.transform = 'translate3d(0, 0, 0) scale(1)';
        // 过渡结束之后把那几句样式摘掉：留着 `will-change: transform` 会让这一层一直占着
        // 合成器的内存，而棋盘这一层上还有翻面、淡出好几样动画要用。
        timers.push(window.setTimeout(clearTransform, ZOOM_BACK_MS + 60));
      }, ZOOM_HOLD_MS));
    },

    cancel() {
      clearTimers();
      /*
       * ⚠️ **这儿不许清掉 `seen`。**
       *
       * 一拍消除的次序是：`onCascadeStep`（`mark`）→ `render()` → `layoutBoard()`
       * （`cancel`）→ `onCascadeStepRendered`（`play`）。`cancel` 一清，`play` 拿到的就永远
       * 是 null——**整个动画成了死代码，而且一声不响**：盘面照旧画对、放大照旧生效，只是跳
       * 着变，没有人会看出少了一段动画。第一版就是这样写的，是逐帧量 transform 才看出来的。
       *
       * `seen` 只由 `play`（用掉）和 `dispose`（收摊）清。
       */
      // 没压过变换就别去问 getComputedStyle——那一问会逼一次样式重算，而 layoutBoard 每一
      // 帧都调一次 cancel()。
      if (!el.style.transform) return null;
      const snap = parseMatrix(window.getComputedStyle(el).transform);
      clearTransform();
      return snap;
    },

    dispose() {
      clearTimers();
      seen = null;
    },
  };
}
