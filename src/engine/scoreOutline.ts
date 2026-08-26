import type { Cell } from './types';

export const SCORE_OUTLINE_MS = 2500;

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

/**
 * Applies this render's one-shot flip and/or ongoing score-pulse animations
 * to a tile/ball/tri element, combined correctly when both apply to the same
 * cell (the CSS `animation` shorthand can't just be set twice — the second
 * class would silently replace the first). `pulseElapsedMs` resumes the
 * pulse in sync with its score-outline if this is a re-render mid-flash.
 */
export function applyScoreAnimations(el: HTMLElement, isFlip: boolean, pulseElapsedMs: number | undefined): void {
  if (isFlip && pulseElapsedMs !== undefined) {
    el.style.animation = 'flip-in 300ms ease-out both, score-pulse 2.5s ease-in-out 1 both';
    el.style.animationDelay = `0s, ${-(pulseElapsedMs / 1000)}s`;
  } else if (isFlip) {
    el.classList.add('flip-in');
  } else if (pulseElapsedMs !== undefined) {
    el.classList.add('score-pulse');
    el.style.animationDelay = -(pulseElapsedMs / 1000) + 's';
  }
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Appends one rectangular (or, for round tiles, circular) outline overlay
 * into container, resuming its animation at elapsedMs if this is a
 * re-render of an already-showing outline. A plain rect border is the
 * *correct* shape here whenever the tile itself is a square/rectangle (the
 * square board's tiles, or a whole matched cluster of them) — border-radius
 * 50% turns the same element into a circle for round tiles, where a
 * bounding-box rectangle would otherwise highlight empty corners no tile
 * actually occupies.
 */
export function spawnOutlineEl(container: HTMLElement, rect: PixelRect, elapsedMs: number, shape: 'rect' | 'circle' = 'rect'): void {
  const el = document.createElement('div');
  el.className = 'score-outline';
  el.style.left = rect.left + 'px';
  el.style.top = rect.top + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
  el.style.animationDelay = -(elapsedMs / 1000) + 's';
  if (shape === 'circle') el.style.borderRadius = '50%';
  container.appendChild(el);
}

/**
 * A triangle-shaped outline: a bounding-box rectangle can't stand in for a
 * triangular tile the way it can for a square one (its corners would
 * highlight empty space no tile occupies), and CSS clip-path clips away a
 * border along with everything else outside the path, leaving no visible
 * stroke on the cut edges. An SVG polygon stroke has neither problem — it
 * traces exactly the tile's own three edges. `pts` are the tile's actual
 * screen-space vertices (board-local pixels), same source as the tile's own
 * rendering.
 */
export function spawnTriangleOutline(container: HTMLElement, pts: [number, number][], elapsedMs: number): void {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg') as SVGSVGElement;
  svg.classList.add('score-outline-tri');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.left = minX + 'px';
  svg.style.top = minY + 'px';
  svg.style.width = w + 'px';
  svg.style.height = h + 'px';

  const poly = document.createElementNS(svgNS, 'polygon');
  poly.setAttribute(
    'points',
    pts.map(([x, y]) => `${(((x - minX) / w) * 100).toFixed(2)},${(((y - minY) / h) * 100).toFixed(2)}`).join(' '),
  );
  poly.style.animationDelay = -(elapsedMs / 1000) + 's';
  svg.appendChild(poly);
  container.appendChild(svg);
}
