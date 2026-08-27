import '../shapes/triangle.css';
import { vibrate } from '../engine/haptics';
import { createOutlineTracker, applyScoreAnimations, spawnTriangleOutline } from '../engine/scoreOutline';
import { STRINGS, type I18nStrings, type Lang } from '../i18n';

// A scripted walkthrough of what's *different* about the triangle game (the
// player has already seen the base square tutorial's universal concepts by
// the time this runs) — 3 slide directions, the "31"/"13" big-triangle
// cluster, a pushed-out triangle re-entering with the opposite orientation,
// and a whole-line bonus leaving a permanent gap instead of a blank piece.
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
function tf(color: number): TTile {
  return { color, face: 'F', dotColor: color };
}
function td(dotColor: number): TTile {
  return { color: -1, face: 'D', dotColor };
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
function withActive(cells: Cell2[], activeColor: number): () => Grid {
  return () => {
    const g = baseGrid();
    for (const [r, c] of cells) g[r][c] = tf(activeColor);
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

const BEATS: Beat[] = [
  { captionKey: 'triSlide', grid: withActive(beat1Cells, 1), goal: 'any', targetCells: beat1Cells },
  { captionKey: 'triBigTriangle', grid: withActive(beat2Cells, 2), goal: 'any', targetCells: beat2Cells },
  { captionKey: 'triFlipOrientation', grid: withActive([orientBeforeCell], 3), goal: 'none', targetCells: [orientBeforeCell] },
  { captionKey: 'triHole', grid: withDotLine(beat4Cells, 0), goal: 'wholeLine', targetCells: beat4Cells },
];

export function renderTriangleTutorial(container: HTMLElement, lang: Lang, onDone: () => void) {
  const s = STRINGS[lang];
  let beatIndex = 0;
  let grid: Grid = BEATS[0].grid();
  let removedCells = new Set<string>();
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

    if (tile.face === 'D') {
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
        if (removedCells.has(key(r, c))) continue;
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
    renderHighlightBox();
  }

  function renderHighlightBox() {
    boardWrap.querySelectorAll('.tutorial-highlight-box').forEach((el) => el.remove());
    const beat = BEATS[beatIndex];
    if (!beat.targetCells.length || solved) return;
    const allPts = beat.targetCells.flatMap(([r, c]) => triGeometry(r, c).pts.map(toScreen));
    const minX = Math.min(...allPts.map((p) => p[0]));
    const maxX = Math.max(...allPts.map((p) => p[0]));
    const minY = Math.min(...allPts.map((p) => p[1]));
    const maxY = Math.max(...allPts.map((p) => p[1]));
    const box = document.createElement('div');
    box.className = 'tutorial-highlight-box';
    box.style.left = minX + 'px';
    box.style.top = minY + 'px';
    box.style.width = maxX - minX + 'px';
    box.style.height = maxY - minY + 'px';
    boardWrap.appendChild(box);
  }

  function showCheck() {
    checkEl.classList.add('show');
    setTimeout(() => checkEl.classList.remove('show'), 900);
  }

  function goToBeat(i: number) {
    clearTimeout(autoTimer);
    solved = false;
    removedCells = new Set();
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
      autoTimer = window.setTimeout(playOrientationSwap, 1200);
    } else if (beat.goal === 'wholeLine') {
      playWholeLineBonus(beat.targetCells);
    }
  }

  function playOrientationSwap() {
    solved = true;
    const activeColor = grid[orientBeforeCell[0]][orientBeforeCell[1]].color;
    grid[orientBeforeCell[0]][orientBeforeCell[1]] = tf(fillerColor(orientBeforeCell[0], orientBeforeCell[1]));
    grid[orientAfterCell[0]][orientAfterCell[1]] = tf(activeColor);
    flipInCells.add(key(orientAfterCell[0], orientAfterCell[1]));
    render();
    vibrate(15);
    showCheck();
    autoTimer = window.setTimeout(advance, 1400);
  }

  function playMatch(cells: Cell2[]) {
    solved = true;
    outlineTracker.add([cells]);
    render();
    vibrate(15);
    setTimeout(() => {
      for (const [r, c] of cells) {
        const t = grid[r][c];
        grid[r][c] = td(t.color);
        flipInCells.add(key(r, c));
      }
      render();
      showCheck();
      autoTimer = window.setTimeout(advance, 1100);
    }, 550);
  }

  function playWholeLineBonus(cells: Cell2[]) {
    solved = true;
    outlineTracker.add([cells]);
    render();
    vibrate([25, 40, 25]);
    autoTimer = window.setTimeout(() => {
      const tris = Array.from(boardEl.querySelectorAll<HTMLElement>('.tri'));
      tris.forEach((el) => {
        const r = Number(el.dataset.r);
        const c = Number(el.dataset.c);
        if (cells.some(([rr, cc]) => rr === r && cc === c)) {
          el.style.transition = 'opacity .6s ease, transform .6s ease';
          el.style.opacity = '0';
          el.style.transform = 'scale(0.7)';
        }
      });
      showCheck();
      setTimeout(() => {
        for (const [r, c] of cells) removedCells.add(key(r, c));
        render();
        autoTimer = window.setTimeout(advance, 900);
      }, 620);
    }, 900);
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
