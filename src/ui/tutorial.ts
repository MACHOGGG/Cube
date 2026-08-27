import '../shapes/square.css';
import { magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import { createOutlineTracker, applyScoreAnimations } from '../engine/scoreOutline';
import { STRINGS, type I18nStrings, type Lang } from '../i18n';

// A scripted walkthrough of the square game's mechanics, told as one 5x5
// board that visibly carries its story forward from step to step (never a
// fresh random layout). Unlike the very first version of this tutorial, the
// player isn't limited to one pre-picked row/column per step: any row or
// column can be dragged, a persistent highlight box just marks *a* region
// worth aiming for, and a generic scanner recognizes a match wherever one
// actually forms — so a player who scores "the wrong way" still gets full,
// real credit (same flip/glow animation the real square game uses) instead
// of being told to try again.
type Face = 'F' | 'D';
interface TTile {
  color: number;
  face: Face;
  dotColor: number;
}
// Every tile's eventual back color is fixed at creation time (mirrors the
// real game: a tile's dot color is decided when the deck is built, not when
// it happens to flip) — 0(blue) backs to 2(magenta), 1(green) backs to
// 3(gold), and the rest self-pair. This lets *any* match the player forms,
// scripted or incidental, flip to a well-defined color.
const DOT_MAP: Record<number, number> = { 0: 2, 1: 3, 2: 2, 3: 3, 4: 4, 5: 5 };
function tf(color: number): TTile {
  return { color, face: 'F', dotColor: DOT_MAP[color] };
}
function td(dotColor: number): TTile {
  return { color: -1, face: 'D', dotColor };
}
function eff(t: TTile): number {
  return t.face === 'D' ? t.dotColor : t.color;
}
type Grid = TTile[][];
function cloneGrid(g: Grid): Grid {
  return g.map((row) => row.map((t) => ({ ...t })));
}
function key(r: number, c: number): string {
  return r + ',' + c;
}

const DIM = 5;
// A checkerboard of two neutral fillers (4/5) so no untouched cell can ever
// accidentally line up into a false match — every beat below only writes
// the specific cells its own story needs, leaving the rest of this base
// alone.
function cb(r: number, c: number): number {
  return (r + c) % 2 === 0 ? 4 : 5;
}
function baseGrid(): Grid {
  const g: Grid = [];
  for (let r = 0; r < DIM; r++) {
    const row: TTile[] = [];
    for (let c = 0; c < DIM; c++) row.push(tf(cb(r, c)));
    g.push(row);
  }
  return g;
}
type Override = [number, number, number] | [number, number, 'D', number];
function withOverrides(overrides: Override[]): () => Grid {
  return () => {
    const g = baseGrid();
    for (const o of overrides) {
      if (o[2] === 'D') g[o[0]][o[1]] = td(o[3]);
      else g[o[0]][o[1]] = tf(o[2] as number);
    }
    return g;
  };
}

// Each beat's starting grid was verified with a throwaway simulation script
// (checked: no unintended match exists before the move, and the intended
// move — one of possibly several valid ones — produces exactly the pattern
// that beat teaches) before being written here.
const beat1Grid = withOverrides([
  [4, 0, 1], [4, 1, 1], [4, 2, 1], // 3 of 4 already green in row 4
  [0, 3, 1], // the 4th green tile, elsewhere in column 3
]);
const beat2Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3], // beat 1's result, carried forward
  [1, 1, 0], [1, 2, 0], [2, 2, 0], // 3 of a 2x2 already blue
  [2, 3, 0], // the 4th, elsewhere in row 2
]);
const beat3Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3],
  [1, 1, 'D', 2], [1, 2, 'D', 2], [2, 1, 'D', 2], [2, 2, 'D', 2], // beat 2's result, already flipped
]);
const beat4Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3],
  [1, 1, 'D', 2], [1, 2, 'D', 2], [2, 1, 'D', 2], [2, 2, 'D', 2],
  [1, 3, 'D', 2], [1, 4, 'D', 2], // 2 more already-flipped magenta tiles
  [0, 0, 2], [0, 1, 2], // 2 fresh magenta tiles that can slide up to join them
]);
const beat5Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3], [4, 4, 'D', 3], // row 4, now entirely gold
  [1, 1, 'D', 2], [1, 2, 'D', 2], [2, 1, 'D', 2], [2, 2, 'D', 2], [1, 3, 'D', 2], [1, 4, 'D', 2],
  [0, 0, 'D', 2], [0, 1, 'D', 2],
]);

type Goal = 'any' | 'mixed' | 'wholeLine' | 'none';
interface Beat {
  captionKey: keyof I18nStrings;
  grid: () => Grid;
  goal: Goal;
  targetCells: [number, number][];
}
const BEATS: Beat[] = [
  { captionKey: 'run4', grid: beat1Grid, goal: 'any', targetCells: [[4, 0], [4, 1], [4, 2], [4, 3]] },
  { captionKey: 'twoByTwo', grid: beat2Grid, goal: 'any', targetCells: [[1, 1], [1, 2], [2, 1], [2, 2]] },
  { captionKey: 'flip', grid: beat3Grid, goal: 'none', targetCells: [] },
  { captionKey: 'mixedFace', grid: beat4Grid, goal: 'mixed', targetCells: [[0, 3], [0, 4], [1, 3], [1, 4]] },
  { captionKey: 'wholeLine', grid: beat5Grid, goal: 'wholeLine', targetCells: [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4]] },
];

interface FoundMatch {
  cells: [number, number][];
}
function scan2x2(grid: Grid): FoundMatch[] {
  const found: FoundMatch[] = [];
  for (let r = 0; r < DIM - 1; r++)
    for (let c = 0; c < DIM - 1; c++) {
      const cells: [number, number][] = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
      const vals = cells.map(([rr, cc]) => eff(grid[rr][cc]));
      if (vals.every((v) => v === vals[0])) found.push({ cells });
    }
  return found;
}
function scanRun4(grid: Grid): FoundMatch[] {
  const found: FoundMatch[] = [];
  for (let r = 0; r < DIM; r++)
    for (let start = 0; start + 3 < DIM; start++) {
      const cells: [number, number][] = [0, 1, 2, 3].map((i) => [r, start + i] as [number, number]);
      const vals = cells.map(([rr, cc]) => eff(grid[rr][cc]));
      if (vals.every((v) => v === vals[0])) found.push({ cells });
    }
  for (let c = 0; c < DIM; c++)
    for (let start = 0; start + 3 < DIM; start++) {
      const cells: [number, number][] = [0, 1, 2, 3].map((i) => [start + i, c] as [number, number]);
      const vals = cells.map(([rr, cc]) => eff(grid[rr][cc]));
      if (vals.every((v) => v === vals[0])) found.push({ cells });
    }
  return found;
}
// A match with no still-flavor cell is one that's already fully resolved
// from an earlier beat sitting in view (e.g. beat 1's row) — not a new event.
function hasFreshCell(grid: Grid, cells: [number, number][]): boolean {
  return cells.some(([r, c]) => grid[r][c].face === 'F');
}
function hasMixedFaces(grid: Grid, cells: [number, number][]): boolean {
  return new Set(cells.map(([r, c]) => grid[r][c].face)).size > 1;
}
function findQualifyingMatch(grid: Grid, goal: Goal): FoundMatch | null {
  if (goal === 'none' || goal === 'wholeLine') return null;
  const all = [...scan2x2(grid), ...scanRun4(grid)].filter((m) => hasFreshCell(grid, m.cells));
  if (goal === 'mixed') return all.find((m) => hasMixedFaces(grid, m.cells)) ?? null;
  return all[0] ?? null;
}
function findWholeLine(grid: Grid): [number, number][] | null {
  for (let r = 0; r < DIM; r++) {
    const cells: [number, number][] = Array.from({ length: DIM }, (_, c) => [r, c]);
    if (cells.every(([rr, cc]) => grid[rr][cc].face === 'D')) {
      const colors = cells.map(([rr, cc]) => grid[rr][cc].dotColor);
      if (colors.every((v) => v === colors[0])) return cells;
    }
  }
  for (let c = 0; c < DIM; c++) {
    const cells: [number, number][] = Array.from({ length: DIM }, (_, r) => [r, c]);
    if (cells.every(([rr, cc]) => grid[rr][cc].face === 'D')) {
      const colors = cells.map(([rr, cc]) => grid[rr][cc].dotColor);
      if (colors.every((v) => v === colors[0])) return cells;
    }
  }
  return null;
}
function rowShift(grid: Grid, r: number, shift: number) {
  const n = grid[r].length;
  grid[r] = grid[r].map((_, i) => grid[r][(((i - shift) % n) + n) % n]);
}
function colShift(grid: Grid, c: number, shift: number) {
  const n = grid.length;
  const col = grid.map((row) => row[c]);
  const shifted = col.map((_, i) => col[(((i - shift) % n) + n) % n]);
  shifted.forEach((t, r) => (grid[r][c] = t));
}

export function renderTutorial(container: HTMLElement, lang: Lang, onDone: () => void) {
  const s = STRINGS[lang];
  let beatIndex = 0;
  let grid: Grid = cloneGrid(BEATS[0].grid());
  let cell = 0;
  let removedCells = new Set<string>();
  let flipInCells = new Set<string>();
  let solved = false;
  const outlineTracker = createOutlineTracker();
  let autoTimer: number | undefined;

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

  let dragAxis: 'row' | 'col' | null = null;
  let dragIndex = 0;
  let dragOffset = 0;

  function layout() {
    const rect = boardWrap.getBoundingClientRect();
    cell = Math.floor(rect.width / DIM);
    boardEl.style.width = cell * DIM + 'px';
    boardEl.style.height = cell * DIM + 'px';
  }

  function makeTileEl(t: TTile, r: number, c: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tile';
    const size = cell - 4;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    let left = c * cell + 2;
    let top = r * cell + 2;
    if (dragAxis === 'row' && r === dragIndex) left += dragOffset * cell;
    if (dragAxis === 'col' && c === dragIndex) top += dragOffset * cell;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    if (t.face === 'D') {
      el.style.background = 'transparent';
      const dot = document.createElement('div');
      dot.className = 'dot-circle';
      const dsize = Math.round(size * 0.86);
      dot.style.width = dsize + 'px';
      dot.style.height = dsize + 'px';
      dot.style.background = palette[t.dotColor];
      el.appendChild(dot);
    } else {
      el.style.background = palette[t.color];
    }
    el.dataset.r = String(r);
    el.dataset.c = String(c);
    return el;
  }

  const PALETTE_POOL = ['#4C7EAD', '#4A9573', '#AD5C82', '#D89B1E', '#9B958D', '#C46A4E'];
  const palette = PALETTE_POOL; // index-stable: 0..5 map directly, no reshuffle needed for correctness

  function render() {
    layout();
    boardEl.innerHTML = '';
    const outlineEntries = outlineTracker.current();
    const pulseMs = new Map<string, number>();
    for (const { cells, elapsedMs } of outlineEntries) for (const [r, c] of cells) pulseMs.set(key(r, c), elapsedMs);
    for (let r = 0; r < DIM; r++) {
      for (let c = 0; c < DIM; c++) {
        if (removedCells.has(key(r, c))) continue;
        const el = makeTileEl(grid[r][c], r, c);
        applyScoreAnimations(el, flipInCells.has(key(r, c)), pulseMs.get(key(r, c)), true);
        boardEl.appendChild(el);
      }
    }
    flipInCells = new Set();
    renderHighlightBox();
  }

  function renderHighlightBox() {
    boardWrap.querySelectorAll('.tutorial-highlight-box').forEach((el) => el.remove());
    const beat = BEATS[beatIndex];
    if (!beat.targetCells.length || solved) return;
    const rs = beat.targetCells.map(([r]) => r);
    const cs = beat.targetCells.map(([, c]) => c);
    const minR = Math.min(...rs);
    const maxR = Math.max(...rs);
    const minC = Math.min(...cs);
    const maxC = Math.max(...cs);
    const box = document.createElement('div');
    box.className = 'tutorial-highlight-box';
    box.style.left = minC * cell + 'px';
    box.style.top = minR * cell + 'px';
    box.style.width = (maxC - minC + 1) * cell + 'px';
    box.style.height = (maxR - minR + 1) * cell + 'px';
    boardWrap.appendChild(box);
  }

  function showCheck() {
    checkEl.classList.add('show');
    setTimeout(() => checkEl.classList.remove('show'), 900);
  }

  function goToBeat(i: number) {
    clearTimeout(autoTimer);
    solved = false;
    dragAxis = null;
    dragOffset = 0;
    removedCells = new Set();
    outlineTracker.reset();
    beatIndex = Math.max(0, Math.min(BEATS.length - 1, i));
    grid = cloneGrid(BEATS[beatIndex].grid());
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

  // Checks whether the current beat's goal is already satisfied (used right
  // after entering a beat, and again after every drag) and plays the
  // matching payoff if so.
  function settleBeat() {
    const beat = BEATS[beatIndex];
    if (beat.goal === 'none') {
      autoTimer = window.setTimeout(advance, 1800);
      return;
    }
    if (beat.goal === 'wholeLine') {
      const found = findWholeLine(grid);
      if (found) playWholeLineBonus(found);
      return;
    }
    const m = findQualifyingMatch(grid, beat.goal);
    if (m) playMatch(m.cells);
  }

  function playMatch(cells: [number, number][]) {
    solved = true;
    outlineTracker.add([cells]);
    render();
    vibrate(15);
    setTimeout(() => {
      for (const [r, c] of cells) {
        grid[r][c] = td(grid[r][c].dotColor);
        flipInCells.add(key(r, c));
      }
      render();
      showCheck();
      autoTimer = window.setTimeout(advance, 1400);
    }, 750);
  }

  // Held clearly before the fade starts (long enough to read "the whole row
  // is now the same flipped color"), then a slow fade, then the resulting
  // gap stays on screen for a while before moving on — a whole-line bonus is
  // the biggest moment in the game and was reading as a blink-and-miss-it
  // flash at the old, much shorter timings.
  function playWholeLineBonus(cells: [number, number][]) {
    solved = true;
    outlineTracker.add([cells]);
    render();
    vibrate([25, 40, 25]);
    autoTimer = window.setTimeout(() => {
      const tiles = Array.from(boardEl.querySelectorAll<HTMLElement>('.tile'));
      tiles.forEach((el) => {
        const r = Number(el.dataset.r);
        const c = Number(el.dataset.c);
        if (cells.some(([rr, cc]) => rr === r && cc === c)) {
          el.style.transition = 'opacity 1s ease, transform 1s ease';
          el.style.opacity = '0';
          el.style.transform = 'scale(0.7)';
        }
      });
      showCheck();
      setTimeout(() => {
        for (const [r, c] of cells) removedCells.add(key(r, c));
        render();
        autoTimer = window.setTimeout(advance, 1900);
      }, 1050);
    }, 1900);
  }

  // ---------- free-form drag: any row or column, like the real square game ----------
  let dragging = false;
  let sx = 0;
  let sy = 0;
  let startR = 0;
  let startC = 0;

  function down(e: PointerEvent) {
    if (solved) return;
    const rect = boardEl.getBoundingClientRect();
    startR = Math.min(DIM - 1, Math.max(0, Math.floor((e.clientY - rect.top) / cell)));
    startC = Math.min(DIM - 1, Math.max(0, Math.floor((e.clientX - rect.left) / cell)));
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    boardEl.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!dragAxis) {
      if (Math.hypot(dx, dy) < 8) return;
      dragAxis = Math.abs(dx) > Math.abs(dy) ? 'row' : 'col';
      dragIndex = dragAxis === 'row' ? startR : startC;
    }
    dragOffset = magnetizeRawDist((dragAxis === 'row' ? dx : dy) / cell);
    render();
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    if (!dragAxis) return;
    const shift = Math.round(dragOffset);
    dragOffset = 0;
    if (shift !== 0) {
      if (dragAxis === 'row') rowShift(grid, dragIndex, shift);
      else colShift(grid, dragIndex, shift);
    }
    dragAxis = null;
    render();
    settleBeat();
  }
  boardEl.addEventListener('pointerdown', down);
  boardEl.addEventListener('pointermove', move);
  boardEl.addEventListener('pointerup', up);
  boardEl.addEventListener('pointercancel', up);

  const onResize = () => render();
  window.addEventListener('resize', onResize);

  function cleanup() {
    window.removeEventListener('resize', onResize);
    boardEl.removeEventListener('pointerdown', down);
    boardEl.removeEventListener('pointermove', move);
    boardEl.removeEventListener('pointerup', up);
    boardEl.removeEventListener('pointercancel', up);
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
