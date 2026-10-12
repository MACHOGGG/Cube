import type { Cell } from './types';
import { reducedMotion } from './reducedMotion';

export const SCORE_OUTLINE_MS = 2500;

export interface OutlineGroup {
  cells: Cell[];
  elapsedMs: number;
}

export interface OutlineTracker {
  /**
   * Registers one move's worth of scored groups. With staggerMs omitted (or
   * zero) every group shares the same start time and animates in sync; a
   * positive staggerMs gives each subsequent group a start time that many ms
   * later than the previous one (an initially-negative elapsed time, which
   * both applyScoreAnimations and the spawnOutline* helpers already read as
   * a forward CSS animation-delay), so a single action that scores several
   * groups at once flashes them in a quick visible sequence instead of all
   * at once.
   */
  add(groups: Cell[][], staggerMs?: number): void;
  /** Still-active groups with how long each has been showing, purging any that have finished. Call once per render(). */
  current(): OutlineGroup[];
  reset(): void;
}

/** Default stagger step between simultaneously-scored groups from one action (item 6: "先后的闪烁提示"). */
export const MULTI_GROUP_STAGGER_MS = 180;

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
    add(groups, staggerMs = 0) {
      const now = Date.now();
      groups.forEach((cells, i) => active.push({ cells, startTime: now + i * staggerMs }));
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
 *
 * `glow`: square has no separate score-outline overlay (a hard rectangle
 * around a whole matched group read as a UI selection box, not a natural
 * highlight) — its scored tiles get this bolder variant instead, which
 * bakes a brightness/box-shadow glow into the same per-tile pulse so the
 * tile itself visibly lights up. Circle and triangle keep the plain scale
 * pulse alongside their own shape-hugging outline overlay.
 */
export function applyScoreAnimations(
  el: HTMLElement,
  isFlip: boolean,
  pulseElapsedMs: number | undefined,
  glow = false,
  coachLit = false,
): void {
  const pulseClass = glow ? 'score-pulse-glow' : 'score-pulse';
  /*
   * 教学的呼吸灯（10-11 方案 D-4，修 D-0 的第 4 个根因）：
   *
   *   · 减弱动态效果时**不写行内动画**。行内的 animation 压得过样式表里每一条 `@media (prefers-reduced-motion)`，
   *     原先翻面＋脉冲那一段在这一档照样跑；现在只挂类，样式表那一档自己把它们关掉、亮着的那几枚给静止光晕。
   *   · 亮着的那一枚要写行内动画时，把 `glow-pulse-coach` 接在列表**最后**。原先行内那一句压过 `.coach-glow`：刚翻
   *     成星星、正好该亮的那一枚，光被它盖掉，要等下一次重画才亮。
   */
  if (coachLit) el.classList.add('coach-glow');
  if (reducedMotion()) {
    if (isFlip) el.classList.add('flip-in');
    else if (pulseElapsedMs !== undefined) el.classList.add(pulseClass);
    return;
  }
  const parts: string[] = [];
  const delays: string[] = [];
  if (isFlip) {
    parts.push('flip-in 300ms ease-out both');
    delays.push('0s');
  }
  if (pulseElapsedMs !== undefined) {
    parts.push(`${pulseClass} 2.5s ease-in-out 1 both`);
    delays.push(`${-(pulseElapsedMs / 1000)}s`);
  }
  if (coachLit && parts.length) {
    parts.push(COACH_GLOW_ANIM);
    delays.push('0s');
  }
  if (parts.length > 1) {
    el.style.animation = parts.join(', ');
    el.style.animationDelay = delays.join(', ');
  } else if (isFlip) {
    el.classList.add('flip-in');
  } else if (pulseElapsedMs !== undefined) {
    el.classList.add(pulseClass);
    el.style.animationDelay = -(pulseElapsedMs / 1000) + 's';
  }
}

/** 教学呼吸灯那一条动画（和 style.css 的 `.coach-glow` 同一句：名字、时长、曲线、无限循环）。 */
export const COACH_GLOW_ANIM = 'glow-pulse-coach 2.2s ease-in-out infinite';

/**
 * 不重画、就地点亮 / 熄掉一枚（棋盘结算之后挂灯走这一条，见 D-4「重画只重挂不重算」）。
 *
 * 只挂类不够：这一枚身上要是还有行内的动画列表（刚翻面那一下写的，见 applyScoreAnimations），它压得过 `.coach-glow`
 * 那一条——灯就要等下一次重画才亮（D-0 根因 4）。所以有列表的，把呼吸灯那一条接到最后 / 从列表里摘掉。
 */
export function setCoachLit(el: HTMLElement, on: boolean): void {
  el.classList.toggle('coach-glow', on);
  const anim = el.style.animation;
  if (!anim || reducedMotion()) return;
  const parts = anim.split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
  const delays = (el.style.animationDelay || '').split(',').map((x) => x.trim()).filter(Boolean);
  const at = parts.findIndex((x) => x.startsWith('glow-pulse-coach'));
  if (on && at < 0) {
    while (delays.length < parts.length) delays.push('0s');
    parts.push(COACH_GLOW_ANIM);
    delays.push('0s');
  } else if (!on && at >= 0) {
    parts.splice(at, 1);
    if (at < delays.length) delays.splice(at, 1);
  } else return;
  el.style.animation = parts.join(', ');
  el.style.animationDelay = delays.join(', ');
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
