export interface DragCallbacks {
  isActive(): boolean;
  /** Pointer-down position in board-local pixels. */
  onStart(x: number, y: number): void;
  /** Called on every move once the drag has traveled past the lock threshold. */
  onDrag(dx: number, dy: number): void;
  /** Always called on release/cancel, even if the threshold was never crossed. */
  onEnd(dx: number, dy: number): void;
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
    if (!cb.isActive()) return;
    const rect = target.getBoundingClientRect();
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

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);

  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
  };
}
