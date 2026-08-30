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
  isActive(): boolean;
  /** Pointer-down position in board-local pixels. */
  onStart(x: number, y: number): void;
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

/**
 * Wires the pointerdown/move/up/cancel lifecycle every board shares: capture
 * the pointer, hold off on committing to an axis/line until the drag clears a
 * small dead zone, then hand raw deltas to the shape so it can do its own
 * (very different) row/column or diagonal-line projection math.
 */
export function attachDrag(target: HTMLElement, cb: DragCallbacks, threshold = 8): () => void {
  let active = false;
  let locked = false;
  let sx = 0;
  let sy = 0;

  function down(e: PointerEvent) {
    if (!cb.isActive()) {
      cb.onRejected?.();
      return;
    }
    const rect = (cb.origin ?? target).getBoundingClientRect();
    active = true;
    locked = false;
    sx = e.clientX;
    sy = e.clientY;
    cb.onStart(e.clientX - rect.left, e.clientY - rect.top);
    target.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!active) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!locked) {
      if (Math.hypot(dx, dy) < threshold) return;
      locked = true;
    }
    cb.onDrag(dx, dy);
  }

  function up(e: PointerEvent) {
    if (!active) return;
    active = false;
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
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    target.removeEventListener('touchmove', blockScroll);
  };
}
