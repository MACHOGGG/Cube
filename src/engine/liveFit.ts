/**
 * 消除之后，剩下的部分整体放大——五副外边族共用的那一点算术。
 *
 * ── 为什么要它 ──────────────────────────────────────────────────
 *
 * 方块这件事是白送的：它消的是整行整列，`rows`/`cols` 真的变小，`computeCell()` 一算
 * `CELL` 就变大，剩下的棋子自己就撑满了底板。
 *
 * 外边族不是。它消的是最外边那一条，格子**离场**（《侵蚀阶梯》v1.2 §3），可行数列数一个
 * 没少——`R = S / 14` 这种写法里 14 是写死的，于是晚盘上棋盘缩成中间一小团，四周一圈空地
 * 板，而棋子一直是开局那么大。PR-3 当时的说法是「棋盘一圈圈变小」，玩家 2026-10 推翻了
 * 它：**和方块一样，剩下的部分整体放大，没有上限。**
 *
 * ── 两件事，两个函数 ───────────────────────────────────────────
 *
 *   · `fitLive()` —— 这一帧该用多大的单位、锚在哪儿。
 *   · `zoomFrom()` —— 刚放大的那一下，先把新这一帧**倒回**旧的样子，好让它动画着长过来。
 *
 * 纯算术，不碰 DOM，不认棋盘——所以 `scripts/check-live-fit.mjs` 能把它单独拎出来验，进得
 * 了 CI。五副棋盘各自的几何（小球的 2c−r、菱形的 c±r、六边的立方坐标、三角的朝向）都留在
 * 棋盘自己那儿：这儿只收「换算成一个单位之后，横竖各占多少」。
 */

/** 一个方向上占多少，单位是「一个 unit」。 */
export interface Span {
  min: number;
  max: number;
}

export interface FitBox {
  x: Span;
  y: Span;
}

export interface FitInput {
  /**
   * **整副棋盘**（每一格都还在）的外接框，含棋子轮廓，单位是「一个 unit」。
   *
   * 它是那把**基准尺**：开局时 `live` 和它一样，于是 zoom 正好是 1，排版和放大这件事落地
   * 之前像素级一致。这一点是硬要求（玩家：开局不许动），所以基准不是底板，而是它。
   */
  full: FitBox;
  /** 此刻还在盘上的那些格子的外接框，同一把尺。一格都不剩就给 null。 */
  live: FitBox | null;
  /** 不放大时的那个单位：小球的 R、菱形方块的 cellSize、三角的边长……。 */
  unit0: number;
  /**
   * 不放大时的锚点——**棋盘自己老式那几行原样算出来的那一对**。
   *
   * 收它而不是收「底板多大、自己居中」，是为了把每副棋盘**有意**的偏移原样留着：六边三角
   * 那一副的 `originY` 上挂着一个 `GLOBAL_ROW_OFFSET * H`，照底板居中会把它抹掉，而那是
   * 玩家调过的半格。放大之后活格框的中心落在「整副棋盘的中心从前落的那一点」上，于是任何
   * 这类偏移都跟着走。
   */
  originX0: number;
  originY0: number;
  /** 《无限反转》那一局：一格都不会离场，所以不放大（而且它的 live 永远等于 full）。 */
  frozen?: boolean;
}

export interface Fit {
  /** 放大多少倍。开局、空盘、无限反转都是 1。 */
  zoom: number;
  /** 这一帧该用的单位 = `unit0 × zoom`。 */
  unit: number;
  /**
   * 这一帧的锚点。棋盘那头照这一句摆：
   *
   *   一枚棋子的中心 = (originX + unit × qx, originY + unit × qy)
   *
   * 其中 (qx, qy) 就是算 `full` / `live` 用的那把尺上的坐标。
   *
   * 开局（`live` 和 `full` 一样）时它**等于传进来的 `originX0` / `originY0`**，一个像素都
   * 不差——所以「放大」这件事落地之前的排版原样成立。
   */
  originX: number;
  originY: number;
}

const span = (s: Span): number => s.max - s.min;
const mid = (s: Span): number => (s.min + s.max) / 2;

/**
 * 这一帧用多大的单位、锚在哪儿。
 *
 * **zoom 是两个外接框的比**，不是「活格框和底板的比」：
 *
 *   zoom = min(整副棋盘横向占多少 ÷ 此刻横向占多少, 竖向同理)
 *
 * 取整副棋盘当分子而不是底板，有两个好处，都要紧：
 *
 *   · **开局一个像素都不动。** 小球那副开局横向占底板 99%、竖向 87%，照底板算开局就会被
 *     放大 1.01 倍——那正是玩家说的「开局不许动」。
 *   · **放大之后也不会出界。** 放大到头的时候活格框正好占满「整副棋盘从前占的那块」，而
 *     那一块本来就在底板里。
 *
 * 锚点同理，照的是**整副棋盘从前的中心**，不是底板的中心：
 *
 *   新锚点 = 老锚点 + unit0 × 整副框中心 − unit × 活格框中心
 *
 * 也就是「把活格框的中心摆到整副棋盘的中心从前落的那一点上」。这样每副棋盘**有意**的偏移
 * （六边三角那个 `GLOBAL_ROW_OFFSET * H`）原样跟着走，而照底板居中会把它抹平。开局时两个
 * 中心是同一个，于是新锚点恒等于老锚点。
 *
 * **没有上限**（玩家 2026-10 拍板）。所以最后剩一枚球的时候，那一枚会撑满整块底板——那不
 * 是 bug，是定下来的样子。
 *
 * 两个不放大的情形，zoom 回 1、锚点回老锚点（也就是和放大这件事落地之前一模一样）：
 *
 *   · 《无限反转》（`frozen`）：那一局翻过去还能翻回来，一格都不离场。
 *   · 空盘（`live === null`）：没有活格可以居中，而这一帧马上就要被结算页盖住了。
 */
export function fitLive(input: FitInput): Fit {
  const { full, live, unit0, originX0, originY0, frozen } = input;
  const usable = frozen ? null : live;
  let zoom = 1;
  if (usable) {
    const lw = span(usable.x);
    const lh = span(usable.y);
    // 两个都要 > 0：一条线上只剩一枚的时候某一边可能是 0（只有轮廓那点宽度），除下去是
    // Infinity，unit 跟着成 Infinity，整副棋盘当场消失在屏幕外。
    if (lw > 0 && lh > 0) {
      zoom = Math.max(1, Math.min(span(full.x) / lw, span(full.y) / lh));
    }
  }
  const unit = unit0 * zoom;
  // 摆正中的是**活格那个框**（没有活格就是整副棋盘那个框）。
  const box = usable ?? full;
  return {
    zoom,
    unit,
    originX: originX0 + unit0 * mid(full.x) - unit * mid(box.x),
    originY: originY0 + unit0 * mid(full.y) - unit * mid(box.y),
  };
}

/**
 * 刚放大的那一下，把**新这一帧**倒回**旧的样子**。
 *
 * `render()` 画出来的已经是放大之后的棋盘了。直接换上去，玩家看到的是「上一帧还没来得及
 * 看，棋子就跳大了」。所以换上去的同一拍先给 `#board` 压一个变换，让它看起来和上一帧一模
 * 一样，停一下，再动画着回到不变换——于是看见的是「剩下的部分长大了」。
 *
 * 要的是一个 `A + s·p` 让新坐标落回旧坐标。两边都是 `origin + unit × q`，所以：
 *
 *   A + s·(Oₙ + uₙ·q) = Oₒ + uₒ·q   对任何 q 成立
 *   ⟹ s = uₒ / uₙ，  A = Oₒ − s·Oₙ
 *
 * 写进 CSS 就是 `translate3d(ax, ay, 0) scale(s)` ＋ `transform-origin: 0 0`——**次序和那个
 * 原点都不能换**：transform 是从右往左作用的，`scale` 在右边才是「先缩放再平移」，而
 * `transform-origin` 不是 0 0 的话浏览器会自己再补一对平移，上面那两行就不成立了。
 */
export function zoomFrom(prev: Fit, next: Fit): { ax: number; ay: number; scale: number } {
  const scale = next.unit > 0 ? prev.unit / next.unit : 1;
  return {
    ax: prev.originX - scale * next.originX,
    ay: prev.originY - scale * next.originY,
    scale,
  };
}

/**
 * 放大之后停多久（毫秒），然后用多久长回去。
 *
 * 两个数加起来必须 ≤ `BONUS_GAP_MS`（1250，见 engine/gameController.ts 的 beat）——那是连锁两拍之间的间
 * 隔。超出去的话下一拍的消除会压在这一拍的放大动画上，而动画一被打断就是「棋子吸附过
 * 去」那种难看的跳。
 */
export const ZOOM_HOLD_MS = 700;
export const ZOOM_BACK_MS = 480;
