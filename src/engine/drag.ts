/**
 * Remaps a raw cell-unit drag distance so it "sticks" to each valid integer
 * slot and needs a deliberate push past the midpoint to let go — the
 * magnetic/detent feel every board's drag preview uses so a tile visibly
 * seats into a position instead of drifting past it unclear which slot it's
 * over. Never changes *where* a drag ultimately snaps (Math.round of the
 * output always matches Math.round of the input), only how it looks getting
 * there.
 */
export function magnetizeRawDist(x: number, power = 2.2): number {
  const nearest = Math.round(x);
  const t = (x - nearest) * 2; // distance to the nearest slot, rescaled to (-1, 1]
  const eased = Math.sign(t) * Math.abs(t) ** power;
  return nearest + eased / 2;
}

/**
 * 三角棋盘的跟手曲线：磁吸和「照直跟」按比例掺在一起。
 *
 * 为什么单靠 magnetizeRawDist 不够——它的速率是 power·|t|^(power−1)，在每个
 * 卡点上恰好等于 0。也就是说手指刚离开卡点的那一小段，牌是不动的；到两个卡
 * 点正中间又冲到最快。方块和圆球的卡点隔一格，这条「先粘住、再窜一下」的
 * 曲线在一格之内走完，读起来就是清脆的一声「咔」。
 *
 * 三角不一样：它的卡点隔着两格（一格的位移会把朝上的三角摆进朝下的槽里，
 * 所以只能偶数步落位）。同一条曲线摊在两格上，粘住的那段有两倍宽——量出来
 * 手指走过一个偶数步附近时，牌只跟着走 0.31 倍，到奇数步附近又变成 1.45
 * 倍。四倍半的速率起伏，就是「卡卡的、不丝滑」。
 *
 * 掺一点直线进去：速率从 (1−blend)·1 起步，最高 (1−blend) + blend·power。
 * blend = 0.3、power = 1.5 时是 0.70 ～ 1.15——始终跟着手指走，卡点的手感
 * 还在，只是不再有「停住」和「窜一下」。
 *
 * 关键是落位一步没变：掺出来的偏移量仍在 ±0.5 之内，所以 Math.round(结果)
 * 和 Math.round(原值) 永远相同，松手时提交的还是同一格。改的只是拖动过程中
 * 眼睛看到的位置。
 */
export function magnetizeFollow(x: number, power: number, blend: number): number {
  const nearest = Math.round(x);
  const eased = magnetizeRawDist(x, power) - nearest;
  return nearest + (1 - blend) * (x - nearest) + blend * eased;
}

export interface DragCallbacks {
  /**
   * The element `onStart`'s coordinates are measured from. Defaults to the
   * element the listeners are on, which is *not* the same thing: every board
   * listens on .board-wrap, so a touch that lands a little off the board
   * still counts, but .board-wrap centres its child and the board is only
   * flush with it when it happens to fill the wrapper exactly. Sizing the
   * board to the short side of a landscape row, or dropping a cleared column
   * from a square grid, leaves it inset — and a start point measured from
   * the wrapper then picks a cell one row or column off. Pass the board
   * element and the inset is measured, once per drag.
   */
  origin?: HTMLElement;
  /**
   * Optional: runs on pointer-down *before* isActive() is consulted, so a
   * board can make itself ready to be grabbed rather than turning the touch
   * away. Every board uses it to fast-forward a reveal still playing from
   * the previous move: a player who slides one line and immediately reaches
   * for the next was losing that second move to an animation, which reads
   * as the board ignoring them.
   */
  onBeforeStart?(): void;
  isActive(): boolean;
  /**
   * Pointer-down position in board-local pixels.
   *
   * 返回抓到的那一颗的行列，拖拽层就会在它身上做个记号——手指落下的那一刻
   * 先告诉玩家「你抓的是这一颗」，而不是等牌动起来才知道抓错了。不返回也行，
   * 那就没有记号，行为和以前一样。
   */
  onStart(x: number, y: number): Grab | void;
  /**
   * 还在死区里的时候，手指挪到哪就改抓哪。
   *
   * 抓哪一行原本是在手指落下的那一瞬间定死的，落点差两三个像素跨过格子边界
   * 就抓错了隔壁，而且要等牌动起来才发现。死区这几个像素里本来什么都还没发
   * 生，正是可以反悔的窗口：手指往正确的那一颗蹭一下，抓的就改过来了，记号
   * 也跟着走。返回新的行列，没抓到就 null。
   */
  onRegrab?(x: number, y: number): Grab | null;
  /** Called on every move once the drag has traveled past the lock threshold. */
  onDrag(dx: number, dy: number): void;
  /** Always called on release/cancel, even if the threshold was never crossed. */
  onEnd(dx: number, dy: number): void;
  /**
   * Optional: called instead of onStart when isActive() is false (usually
   * because the board is still mid-cascade from the previous move). Without
   * this, a touch during that window does nothing at all with zero
   * indication why — easy to read as "I set up a match and nothing
   * happened" when it was really just a move that landed a beat too early.
   */
  onRejected?(): void;
}

/** 抓到的那一颗在棋盘上的行列。八个玩法的棋子都带着 data-r / data-c，所以
 *  这一对数字足够在任何一副棋盘上把它找出来，不必知道那副棋盘长什么样。 */
export interface Grab {
  r: number;
  c: number;
}

/** 手指落下之后、拖拽真正开始之前，那一颗身上挂的记号。 */
const GRAB_CLASS = 'piece-grabbed';

/**
 * Wires the pointerdown/move/up/cancel lifecycle every board shares: capture
 * the pointer, hold off on committing to an axis/line until the drag clears a
 * small dead zone, then hand raw deltas to the shape so it can do its own
 * (very different) row/column or diagonal-line projection math.
 */
export function attachDrag(target: HTMLElement, cb: DragCallbacks, threshold = 11): () => void {
  let active = false;
  let locked = false;
  let sx = 0;
  let sy = 0;
  /** 现在挂着记号的那一颗，松开或者拖起来之后要摘掉。 */
  let marked: HTMLElement | null = null;

  /** 把记号挪到 g 那一颗身上。g 为空就只是摘掉。 */
  function mark(g: Grab | null | void) {
    const board = cb.origin ?? target;
    const next = g
      ? board.querySelector<HTMLElement>(`[data-r="${g.r}"][data-c="${g.c}"]`)
      : null;
    if (next === marked) return;
    marked?.classList.remove(GRAB_CLASS);
    next?.classList.add(GRAB_CLASS);
    marked = next;
  }

  function down(e: PointerEvent) {
    cb.onBeforeStart?.();
    if (!cb.isActive()) {
      cb.onRejected?.();
      return;
    }
    const rect = (cb.origin ?? target).getBoundingClientRect();
    active = true;
    locked = false;
    sx = e.clientX;
    sy = e.clientY;
    mark(cb.onStart(e.clientX - rect.left, e.clientY - rect.top));
    target.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!active) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!locked) {
      // 还在死区里：什么都还没发生，所以这几个像素是可以反悔的。手指蹭到隔壁
      // 那一颗，抓的就跟着改，记号也跟着走——落点差两三个像素抓错了行，不必
      // 等牌动起来才发现。
      if (Math.hypot(dx, dy) < threshold) {
        if (cb.onRegrab) {
          const rect = (cb.origin ?? target).getBoundingClientRect();
          mark(cb.onRegrab(e.clientX - rect.left, e.clientY - rect.top));
        }
        return;
      }
      locked = true;
      // 从这里开始整条线都在动，哪一颗被抓着已经看得一清二楚，记号该退场了。
      mark(null);
    }
    cb.onDrag(dx, dy);
  }

  function up(e: PointerEvent) {
    if (!active) return;
    active = false;
    mark(null);
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    cb.onEnd(locked ? dx : 0, locked ? dy : 0);
    locked = false;
  }

  // Pointer capture keeps the *drag* alive but does nothing to stop the page
  // scrolling underneath a finger. `touch-action: none` on the board covers
  // that in most browsers; this covers the rest, and iOS's rubber-band
  // overscroll, which touch-action does not suppress. Non-passive, or
  // preventDefault would be ignored. Only touchmove is cancelled — cancelling
  // touchstart would also suppress the pointer events this drag runs on.
  function blockScroll(e: TouchEvent) {
    if (active) e.preventDefault();
  }

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  target.addEventListener('touchmove', blockScroll, { passive: false });

  return () => {
    mark(null);
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    target.removeEventListener('touchmove', blockScroll);
  };
}
