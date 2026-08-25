import type { Cell } from './types';

export const SCORE_OUTLINE_MS = 5000;

export interface OutlineGroup {
  cells: Cell[];
  elapsedMs: number;
}

export interface OutlineTracker {
  /** Registers one move's worth of scored groups, all sharing the same start time so they animate in sync. */
  add(groups: Cell[][]): void;
  /** Still-active groups with how long each has been showing, purging any that have finished. Call once per render(). */
  current(): OutlineGroup[];
  reset(): void;
}

/**
 * Tracks the black-outline "you just scored this" highlight shown around
 * each matched/bonused group of cells: five seconds, flashing three times,
 * then gone. Persistent (not fire-and-forget DOM timers) for the same reason
 * the per-tile flash used a timestamp map — a board re-render mid-animation
 * (e.g. the very next move, since streaks reward scoring again quickly)
 * must be able to resume every still-active outline exactly where it was.
 */
export function createOutlineTracker(): OutlineTracker {
  let active: { cells: Cell[]; startTime: number }[] = [];

  return {
    add(groups) {
      const now = Date.now();
      for (const cells of groups) active.push({ cells, startTime: now });
    },
    current() {
      const now = Date.now();
      active = active.filter((o) => now - o.startTime < SCORE_OUTLINE_MS);
      return active.map((o) => ({ cells: o.cells, elapsedMs: now - o.startTime }));
    },
    reset() {
      active = [];
    },
  };
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Appends one outline overlay element into container, resuming its animation at elapsedMs if this is a re-render of an already-showing outline. */
export function spawnOutlineEl(container: HTMLElement, rect: PixelRect, elapsedMs: number): void {
  const el = document.createElement('div');
  el.className = 'score-outline';
  el.style.left = rect.left + 'px';
  el.style.top = rect.top + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
  el.style.animationDelay = -(elapsedMs / 1000) + 's';
  container.appendChild(el);
}
