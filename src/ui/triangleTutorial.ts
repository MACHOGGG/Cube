import '../shapes/triangle.css';
import { vibrate } from '../engine/haptics';
import { createOutlineTracker, applyScoreAnimations, spawnTriangleOutline } from '../engine/scoreOutline';
import { STRINGS, type I18nStrings, type Lang } from '../i18n';

// A scripted walkthrough of what's *different* about the triangle game (the
// player has already seen the base square tutorial's universal concepts by
// the time this runs) — 3 slide directions, the "31"/"13" big-triangle
// cluster, a pushed-out triangle re-entering with the opposite orientation,
// and a whole-line bonus turning its cells into blank (but still slidable)
// pieces.
// Like circleTutorial.ts, this doesn't reproduce triangle.ts's real per-line
// shift-with-wrap math (the trickiest, most bug-prone part of that board's
// whole implementation this project has had to fix repeatedly) — every beat
// is an independent authored snapshot, and any drag on the board simply
// confirms the current beat and reveals its pre-authored "after" state
// through the same match/flip/whole-line-bonus animations the real game
// uses. The one exception is the orientation beat, which has no "match" to
// confirm at all — it just shows a before/after pair on a short timer.

const ROW_LENS = [7, 9, 11, 11, 9, 7];
const LEFT_TRIM = [0, 0, 0, 1, 3, 5];
const GLOBAL_ROW_OFFSET = 3;
const COLORS = ['#3C4452', '#B23A3A', '#D89B1E', '#4C68B0'];

type Cell2 = [number, number];
function globalPosPure(r: number, c: number) {
  return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
}
// Verified (throwaway Node script) to have zero accidental run/big-triangle
// matches anywhere on the board: every one of the 3 real adjacency steps
// (cross/rowLeft/rowRight) changes (i+p) by exactly 1, so no 2 adjacent
// cells — hence no run-4 window or big-triangle cluster, all built from
// mutually-adjacent cells — can ever share a filler color.
function fillerColor(r: number, c: number): number {
  const { i, p } = globalPosPure(r, c);
  return (((i + p) % 4) + 4) % 4;
}

interface TTile {
  color: number;
  face: 'F' | 'D';
  dotColor: number;
}
// dotColor defaults to color (self-pair) for filler tiles and the
// orientation beat's traveling tile, neither of which ever shows a dot
// face — every beat that actually flips (see withActive below) passes an
// explicit dotColor instead of relying on this default.
function tf(color: number, dotColor: number = color): TTile {
  return { color, face: 'F', dotColor };
}
function td(dotColor: number): TTile {
  return { color: -1, face: 'D', dotColor };
}
// A whole-line bonus's tiles: no color on either face, just a dim neutral
// piece — matches triangle.ts's real BLANK sentinel (dotColor -1 can never
// come from td(), which only ever gets a real 0-3 palette index).
function blank(): TTile {
  return { color: -1, face: 'D', dotColor: -1 };
}
function isBlank(t: TTile): boolean {
  return t.dotColor === -1;
}
type Grid = TTile[][];
function key(r: number, c: number): string {
  return r + ',' + c;
}
function baseGrid(): Grid {
  const g: Grid = [];
  for (let r = 0; r < ROW_LENS.length; r++) {
    const row: TTile[] = [];
    for (let c = 0; c < ROW_LENS[r]; c++) row.push(tf(fillerColor(r, c)));
    g.push(row);
  }
  return g;
}
function withActive(cells: Cell2[], activeColor: number, dotColor: number = activeColor): () => Grid {
  return () => {
    const g = baseGrid();
    for (const [r, c] of cells) g[r][c] = tf(activeColor, dotColor);
    return g;
  };
}
function withDotLine(cells: Cell2[], dotColor: number): () => Grid {
  return () => {
    const g = baseGrid();
    for (const [r, c] of cells) g[r][c] = td(dotColor);
    return g;
  };
}

type Goal = 'any' | 'wholeLine' | 'none';
interface Beat {
  captionKey: keyof I18nStrings;
  grid: () => Grid;
  goal: Goal;
  targetCells: Cell2[];
}

// run-4 along row 0 (the board's top row, 7 cells)
const beat1Cells: Cell2[] = [[0, 0], [0, 1], [0, 2], [0, 3]];
// a "31"/"13" big-triangle cluster
const beat2Cells: Cell2[] = [[0, 0], [1, 0], [1, 1], [1, 2]];
// orientation demo: an up-pointing tile near one edge of row 0...
const orientBeforeCell: Cell2 = [0, 0]; // p=0, up
// ...reappearing down-oriented near the other edge once the delay fires
const orientAfterCell: Cell2 = [0, 5]; // p=5, down
// a real (if not the shortest possible) whole line, long enough to read
// clearly as "a whole line", from the row family (row 0)
const beat4Cells: Cell2[] = Array.from({ length: 7 }, (_, c) => [0, c] as Cell2);

// Real triangle.ts's per-color-group split is much closer to even than
// circle's (4 self-pairs + 5 other-color slots per group of 9, ~44% self)
// — so unlike circleTutorial, showing one self-pair here isn't a
// distortion: across these 2 flip beats, 1 self + 1 other is a fair
// microcosm of that near-even split. The orientation beat's dotColor is
// irrelevant (that tile never shows a dot face) and is left on its
// self-pairing default.
const BEATS: Beat[] = [
  { captionKey: 'triSlide', grid: withActive(beat1Cells, 1, 1), goal: 'any', targetCells: beat1Cells },
  { captionKey: 'triBigTriangle', grid: withActive(beat2Cells, 2, 0), goal: 'any', targetCells: beat2Cells },
  { captionKey: 'triFlipOrientation', grid: withActive([orientBeforeCell], 3), goal: 'none', targetCells: [orientBeforeCell] },
  { captionKey: 'triBlank', grid: withDotLine(beat4Cells, 0), goal: 'wholeLine', targetCells: beat4Cells },
];

export function renderTriangleTutorial(container: HTMLElement, lang: Lang, onDone: () => void) {
  const s = STRINGS[lang];
  let beatIndex = 0;
  let grid: Grid = BEATS[0].grid();
  let solved = false;
  let flipInCells = new Set<string>();
  const outlineTracker = createOutlineTracker();
  let autoTimer: number | undefined;
  let S = 0, H = 0, originX = 0, originY = 0;

  container.innerHTML = `
    <div class="app">
      <h1>Slides</h1>
      <p class="tutorial-step-label" id="stepLabel"></p>
      <p class="tutorial-caption" id="caption"></p>
      <div class="tutorial-board-wrap" id="boardWrap">
        <div class="tutorial-board" id="board"></div>
        <div class="tutorial-check" id="check"><svg viewBox="0 0 24 24"><path d="M4 13 L10 19 L20 6" fill="none" stroke="var(--accent-2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      </div>
      <div class="tutorial-controls">
        <button class="icon-btn" id="skipBtn">${s.skip}</button>
        <button class="icon-btn" id="prevBtn">${s.prev}</button>
        <button class="icon-btn" id="nextBtn">${s.next}</button>
      </div>
    </div>
  `;

  const boardWrap = container.querySelector<HTMLElement>('#boardWrap')!;
  const boardEl = container.querySelector<HTMLElement>('#board')!;
  const captionEl = container.querySelector<HTMLElement>('#caption')!;
  const stepLabelEl = container.querySelector<HTMLElement>('#stepLabel')!;
  const checkEl = container.querySelector<HTMLElement>('#check')!;
  const skipBtn = container.querySelector<HTMLButtonElement>('#skipBtn')!;
  const prevBtn = container.querySelector<HTMLButtonElement>('#prevBtn')!;
  const nextBtn = container.querySelector<HTMLButtonElement>('#nextBtn')!;

  function globalPos(r: number, c: number) {
    return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
  }
  function triGeometry(r: number, c: number): { pts: [number, number][] } {
    const { i, p } = globalPos(r, c);
    const up = p % 2 === 0;
    const j = up ? p / 2 : (p - 1) / 2;
    const xBase = (-i * S) / 2 + j * S;
    if (up) {
      return { pts: [[xBase, i * H], [xBase - S / 2, (i + 1) * H], [xBase + S / 2, (i + 1) * H]] };
    }
    return { pts: [[xBase + S / 2, (i + 1) * H], [xBase, i * H], [xBase + S, i * H]] };
  }
  function centroid(pts: [number, number][]): [number, number] {
    return [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
  }
  function layoutBoard() {
    const rect = boardWrap.getBoundingClientRect();
    const boardSize = Math.min(rect.width, rect.height);
    S = boardSize / 6.4;
    H = (S * Math.sqrt(3)) / 2;
    originX = boardSize / 2;
    originY = (boardSize - 6 * H) / 2 - GLOBAL_ROW_OFFSET * H;
    boardEl.style.width = boardSize + 'px';
    boardEl.style.height = boardSize + 'px';
  }
  function toScreen([x, y]: [number, number]): [number, number] {
    return [x + originX, y + originY];
  }

  function makeTriEl(tile: TTile, r: number, c: number): HTMLElement {
    const pts = triGeometry(r, c).pts.map(toScreen);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    const clip = 'polygon(' + pts.map((p) => `${(((p[0] - minX) / w) * 100).toFixed(2)}% ${(((p[1] - minY) / h) * 100).toFixed(2)}%`).join(',') + ')';

    const el = document.createElement('div');
    el.className = 'tri';
    el.style.left = minX + 'px';
    el.style.top = minY + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';

    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.clipPath = clip;
    fill.style.setProperty('-webkit-clip-path', clip);

    if (isBlank(tile)) {
      fill.style.background = 'var(--ink-faint)';
      fill.style.opacity = '0.35';
      el.appendChild(fill);
    } else if (tile.face === 'D') {
      const cen = centroid(pts);
      const DOT_SCALE = 0.6;
      const innerPts = pts.map(([x, y]) => [cen[0] + (x - cen[0]) * DOT_SCALE, cen[1] + (y - cen[1]) * DOT_SCALE] as [number, number]);
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.position = 'absolute';
      svg.style.left = '0';
      svg.style.top = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.overflow = 'visible';
      const poly = document.createElementNS(svgNS, 'polygon');
      poly.setAttribute('points', innerPts.map(([x, y]) => `${(((x - minX) / w) * 100).toFixed(2)},${(((y - minY) / h) * 100).toFixed(2)}`).join(' '));
      poly.setAttribute('fill', COLORS[tile.dotColor]);
      poly.setAttribute('stroke', '#1A1A1A');
      poly.setAttribute('stroke-width', '3.5');
      poly.setAttribute('stroke-linejoin', 'round');
      poly.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(poly);
      el.appendChild(fill);
      el.appendChild(svg);
    } else {
      fill.style.background = COLORS[tile.color];
      el.appendChild(fill);
    }
    el.dataset.r = String(r);
    el.dataset.c = String(c);
    return el;
  }

  function render() {
    layoutBoard();
    boardEl.innerHTML = '';
    const outlineEntries = outlineTracker.current();
    const pulseMs = new Map<string, number>();
    for (const { cells, elapsedMs } of outlineEntries) for (const [r, c] of cells) pulseMs.set(key(r, c), elapsedMs);
    for (let r = 0; r < ROW_LENS.length; r++) {
      for (let c = 0; c < ROW_LENS[r]; c++) {
        const el = makeTriEl(grid[r][c], r, c);
        applyScoreAnimations(el, flipInCells.has(key(r, c)), pulseMs.get(key(r, c)));
        boardEl.appendChild(el);
      }
    }
    flipInCells = new Set();
    for (const { cells, elapsedMs } of outlineEntries) {
      for (const [r, c] of cells) {
        spawnTriangleOutline(boardEl, triGeometry(r, c).pts.map(toScreen), elapsedMs);
      }
    }
    renderPatternGlow();
  }

  // Highlights a scoring pattern with a single glow outline that hugs the
  // whole group's own silhouette (the union of every one of its triangles'
  // vertices) — never one ring per triangle — so a 4-triangle diamond reads
  // as one diamond-shaped frame, not four overlapping blinking wedges.
  function renderPatternGlow() {
    boardWrap.querySelectorAll('.tutorial-cell-glow').forEach((el) => el.remove());
    const beat = BEATS[beatIndex];
    if (!beat.targetCells.length || solved) return;
    const allPts = beat.targetCells.flatMap(([r, c]) => triGeometry(r, c).pts.map(toScreen));
    const minX = Math.min(...allPts.map((p) => p[0]));
    const maxX = Math.max(...allPts.map((p) => p[0]));
    const minY = Math.min(...allPts.map((p) => p[1]));
    const maxY = Math.max(...allPts.map((p) => p[1]));
    const glow = document.createElement('div');
    glow.className = 'tutorial-cell-glow';
    glow.style.left = minX + 'px';
    glow.style.top = minY + 'px';
    glow.style.width = maxX - minX + 'px';
    glow.style.height = maxY - minY + 'px';
    glow.style.borderRadius = '10px';
    boardWrap.appendChild(glow);
  }

  function showCheck() {
    checkEl.classList.add('show');
    setTimeout(() => checkEl.classList.remove('show'), 900);
  }

  function goToBeat(i: number) {
    clearTimeout(autoTimer);
    solved = false;
    beatIndex = Math.max(0, Math.min(BEATS.length - 1, i));
    grid = BEATS[beatIndex].grid();
    stepLabelEl.textContent = `${beatIndex + 1} / ${BEATS.length}`;
    captionEl.textContent = s[BEATS[beatIndex].captionKey];
    prevBtn.style.visibility = beatIndex > 0 ? 'visible' : 'hidden';
    render();
    settleBeat();
  }

  function advance() {
    if (beatIndex >= BEATS.length - 1) {
      cleanup();
      onDone();
      return;
    }
    goToBeat(beatIndex + 1);
  }

  function settleBeat() {
    const beat = BEATS[beatIndex];
    if (beat.goal === 'none') {
      autoTimer = window.setTimeout(playOrientationSwap, 1400);
    } else if (beat.goal === 'wholeLine') {
      playWholeLineBonus(beat.targetCells);
    }
  }

  // Slides the tile from orientBeforeCell to orientAfterCell along a visible
  // path instead of teleporting, rotating it 180deg over the same span so
  // the up-pointing triangle visibly becomes down-pointing on arrival (an
  // up- and a down-triangle share the same S x H bounding box here, so
  // rotating one by a half-turn produces exactly the other's silhouette) —
  // making the "wraps to the other edge, flipped" rule something the player
  // watches happen rather than a jump-cut they have to take on faith.
  const ORIENT_SLIDE_MS = 1700;
  function playOrientationSwap() {
    solved = true;
    const activeColor = grid[orientBeforeCell[0]][orientBeforeCell[1]].color;
    const beforePts = triGeometry(orientBeforeCell[0], orientBeforeCell[1]).pts.map(toScreen);
    const afterPts = triGeometry(orientAfterCell[0], orientAfterCell[1]).pts.map(toScreen);
    const bXs = beforePts.map((p) => p[0]), bYs = beforePts.map((p) => p[1]);
    const aXs = afterPts.map((p) => p[0]), aYs = afterPts.map((p) => p[1]);
    const bMinX = Math.min(...bXs), bMinY = Math.min(...bYs);
    const bMaxX = Math.max(...bXs), bMaxY = Math.max(...bYs);
    const aMinX = Math.min(...aXs), aMinY = Math.min(...aYs);
    const w = bMaxX - bMinX, h = bMaxY - bMinY;

    // The source cell reverts to its plain filler tile right away: the
    // ghost element below carries the traveling color from here on.
    grid[orientBeforeCell[0]][orientBeforeCell[1]] = tf(fillerColor(orientBeforeCell[0], orientBeforeCell[1]));
    render();

    const ghost = document.createElement('div');
    ghost.className = 'tri';
    ghost.style.left = bMinX + 'px';
    ghost.style.top = bMinY + 'px';
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    ghost.style.zIndex = '5';
    ghost.style.transition = `transform ${ORIENT_SLIDE_MS}ms cubic-bezier(.4,0,.2,1)`;
    ghost.style.transform = 'translate(0px,0px) rotate(0deg)';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.clipPath =
      'polygon(' + beforePts.map((p) => `${(((p[0] - bMinX) / w) * 100).toFixed(2)}% ${(((p[1] - bMinY) / h) * 100).toFixed(2)}%`).join(',') + ')';
    fill.style.background = COLORS[activeColor];
    ghost.appendChild(fill);
    boardEl.appendChild(ghost);

    vibrate(10);
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${aMinX - bMinX}px, ${aMinY - bMinY}px) rotate(180deg)`;
    });

    autoTimer = window.setTimeout(() => {
      ghost.remove();
      grid[orientAfterCell[0]][orientAfterCell[1]] = tf(activeColor);
      flipInCells.add(key(orientAfterCell[0], orientAfterCell[1]));
      render();
      vibrate(15);
      showCheck();
      autoTimer = window.setTimeout(advance, 1400);
    }, ORIENT_SLIDE_MS);
  }

  function playMatch(cells: Cell2[]) {
    solved = true;
    outlineTracker.add([cells]);
    render();
    vibrate(15);
    setTimeout(() => {
      for (const [r, c] of cells) {
        const t = grid[r][c];
        // dotColor was fixed at creation (t.dotColor), like the real
        // triangle game — using t.color instead would force every flip to
        // self-pair, hiding the (~56% of the time) case where it doesn't.
        grid[r][c] = td(t.dotColor);
        flipInCells.add(key(r, c));
      }
      render();
      showCheck();
      autoTimer = window.setTimeout(advance, 1400);
    }, 750);
  }

  // Held long enough up front to actually register "the whole line is the
  // same reverse-face color" before anything starts fading, then a slow
  // fade to the resulting blank pieces, which are left on screen for a
  // while too — this is the moment the caption's "blank piece, still
  // slides" point needs to land, not something to blink past.
  function playWholeLineBonus(cells: Cell2[]) {
    solved = true;
    outlineTracker.add([cells]);
    render();
    vibrate([25, 40, 25]);
    autoTimer = window.setTimeout(() => {
      // Blank the cells and render the real (dim) result first, then lay
      // ghost copies of the old dot-colored tiles on top and fade *those*
      // out — reveals the blank piece already sitting beneath instead of
      // fading to an empty gap.
      const oldTiles = cells.map(([r, c]) => grid[r][c]);
      for (const [r, c] of cells) grid[r][c] = blank();
      render();
      cells.forEach(([r, c], i) => {
        const ghost = makeTriEl(oldTiles[i], r, c);
        ghost.classList.add('ghost');
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '1';
        boardEl.appendChild(ghost);
        ghost.style.transition = 'opacity 1s ease';
        requestAnimationFrame(() => { ghost.style.opacity = '0'; });
        setTimeout(() => ghost.remove(), 1050);
      });
      showCheck();
      setTimeout(() => {
        autoTimer = window.setTimeout(advance, 1900);
      }, 1050);
    }, 1900);
  }

  // Any drag confirms the current beat (see module comment) — except the
  // orientation beat, which has no drag at all and fires on its own timer.
  let dragging = false;
  let sx = 0, sy = 0;
  const DRAG_THRESHOLD = 10;

  function down(e: PointerEvent) {
    if (solved) return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    boardEl.setPointerCapture(e.pointerId);
  }
  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (solved) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    const beat = BEATS[beatIndex];
    if (beat.goal === 'any') playMatch(beat.targetCells);
  }
  boardEl.addEventListener('pointerdown', down);
  boardEl.addEventListener('pointerup', up);
  boardEl.addEventListener('pointercancel', () => { dragging = false; });

  const onResize = () => render();
  window.addEventListener('resize', onResize);

  function cleanup() {
    window.removeEventListener('resize', onResize);
    boardEl.removeEventListener('pointerdown', down);
    boardEl.removeEventListener('pointerup', up);
    clearTimeout(autoTimer);
  }

  skipBtn.addEventListener('click', () => {
    cleanup();
    onDone();
  });
  prevBtn.addEventListener('click', () => {
    if (beatIndex > 0) goToBeat(beatIndex - 1);
  });
  nextBtn.addEventListener('click', advance);

  goToBeat(0);
}
