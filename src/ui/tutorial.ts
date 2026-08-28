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
// Third form [r, c, color, dotColor] is a fresh flavor tile with an
// *explicit* dot color, bypassing DOT_MAP — used where a beat needs to show
// a single matched group flip to visibly different colors from each other
// (see beat2Grid below), since DOT_MAP alone can only ever give every tile
// of a given front color the same one fixed result.
type Override = [number, number, number] | [number, number, 'D', number] | [number, number, number, number];
function withOverrides(overrides: Override[]): () => Grid {
  return () => {
    const g = baseGrid();
    for (const o of overrides) {
      if (o[2] === 'D') g[o[0]][o[1]] = td(o[3]);
      else if (o.length === 4) g[o[0]][o[1]] = { color: o[2] as number, face: 'F', dotColor: o[3] as number };
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
// Each of these 4 blue tiles is given its own explicit dot color (2 or 3,
// alternating) instead of relying on DOT_MAP — which would give all 4 the
// same fixed result — so the flip this beat teaches actually demonstrates
// what its own caption claims ("flips to a color chosen at random"): one
// matched group landing on more than one color, not a uniform repaint.
const beat2Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3], // beat 1's result, carried forward
  [1, 1, 0, 2], [1, 2, 0, 3], [2, 2, 0, 2], // 3 of a 2x2 already blue
  [2, 3, 0, 3], // the 4th, elsewhere in row 2 — the natural move is row 2 left by 1,
  // which carries (2,2)'s tile into (2,1) and (2,3)'s tile into (2,2) (verified
  // against an actual drag, not just hand-traced — a first attempt at this had
  // the resulting (2,1)/(2,2) dot colors backwards).
]);
const beat3Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3],
  [1, 1, 'D', 2], [1, 2, 'D', 3], [2, 1, 'D', 2], [2, 2, 'D', 3], // beat 2's result, already flipped
]);
const beat4Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3],
  [1, 1, 'D', 2], [1, 2, 'D', 3], [2, 1, 'D', 2], [2, 2, 'D', 3],
  [1, 3, 'D', 2], [1, 4, 'D', 2], // 2 more already-flipped magenta tiles
  [0, 0, 2], [0, 1, 2], // 2 fresh magenta tiles that can slide up to join them
]);
const beat5Grid = withOverrides([
  [4, 0, 'D', 3], [4, 1, 'D', 3], [4, 2, 'D', 3], [4, 3, 'D', 3], [4, 4, 'D', 3], // row 4, now entirely gold
  [1, 1, 'D', 2], [1, 2, 'D', 3], [2, 1, 'D', 2], [2, 2, 'D', 3], [1, 3, 'D', 2], [1, 4, 'D', 2],
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
  // autoTimer drives in-flight animation *sequencing* (e.g. the whole-line
  // bonus's hold-then-fade delay) and is never pause-aware. advanceTimer is
  // the separate, dedicated timer for the actual "move to the next beat"
  // step — kept apart so pausing can safely cancel a pending advance
  // without also cutting off a fade/reveal that's already mid-flight.
  let autoTimer: number | undefined;
  let advanceTimer: number | undefined;
  // Pausing only holds back the *automatic* move to the next beat — it
  // never interrupts an in-flight flip/bonus animation, since the useful
  // moment to pause is after a payoff has finished playing and the board
  // is just sitting there before advancing, not mid-animation.
  let paused = false;
  let advancePending = false;
  let highlightPopped = false;

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
        <button class="icon-btn" id="pauseBtn">${s.pause}</button>
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
  const pauseBtn = container.querySelector<HTMLButtonElement>('#pauseBtn')!;

  let dragAxis: 'row' | 'col' | null = null;
  let dragIndex = 0;
  let dragOffset = 0;
  let lastShift = 0;

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
    renderPatternGlow();
  }

  // Highlights a scoring pattern with a single glow outline that hugs the
  // whole group's bounding box — never one ring per tile — so it reads as
  // "this pattern" rather than a pile of separately blinking squares.
  function renderPatternGlow() {
    boardWrap.querySelectorAll('.tutorial-cell-glow').forEach((el) => el.remove());
    const beat = BEATS[beatIndex];
    if (!beat.targetCells.length || solved) return;
    // Only the glow's first appearance for this beat gets the zoom pop-in —
    // renderPatternGlow reruns on every drag frame too (fresh elements each
    // time), and popping in repeatedly mid-drag would read as jitter rather
    // than an announcement.
    const firstAppearance = !highlightPopped;
    highlightPopped = true;
    const rows = beat.targetCells.map(([r]) => r);
    const cols = beat.targetCells.map(([, c]) => c);
    const minR = Math.min(...rows), maxR = Math.max(...rows);
    const minC = Math.min(...cols), maxC = Math.max(...cols);
    const glow = document.createElement('div');
    glow.className = 'tutorial-cell-glow';
    if (firstAppearance) glow.classList.add('pop-in');
    glow.style.left = minC * cell + 'px';
    glow.style.top = minR * cell + 'px';
    glow.style.width = (maxC - minC + 1) * cell + 'px';
    glow.style.height = (maxR - minR + 1) * cell + 'px';
    glow.style.borderRadius = Math.round(cell * 0.16) + 'px';
    boardWrap.appendChild(glow);
  }

  // A ghost fully outside [low, high] is invisible; one that's just
  // crossed into range ramps up smoothly instead of popping in at full
  // ghost-opacity. Ported from square.ts's real drag preview so the
  // tutorial's own row/col drag shows the same wraparound-filler visual
  // the real square game does, instead of a tile just sliding off the
  // board edge into nothing.
  function edgeFade(x: number, low: number, high: number, range: number): number {
    const overshoot = x < low ? low - x : x > high ? x - high : 0;
    return Math.max(0, 1 - overshoot / range);
  }

  function renderDragGhosts() {
    if (!dragAxis) return;
    const span = DIM * cell;
    const fadeRange = cell * 0.4;
    const magPx = dragOffset * cell;
    const fadeAt = (x: number) => edgeFade(x, -cell, span, fadeRange);
    if (dragAxis === 'row') {
      const r = dragIndex;
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        for (let c = 0; c < DIM; c++) {
          if (removedCells.has(key(r, c))) continue;
          const x = c * cell + magPx + k * span;
          const fade = fadeAt(x);
          if (fade <= 0) continue;
          const ghost = makeTileEl(grid[r][c], r, c);
          ghost.classList.add('ghost');
          ghost.style.left = x + 'px';
          ghost.style.opacity = String(0.55 * fade);
          boardEl.appendChild(ghost);
        }
      }
    } else {
      const c = dragIndex;
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        for (let r = 0; r < DIM; r++) {
          if (removedCells.has(key(r, c))) continue;
          const y = r * cell + magPx + k * span;
          const fade = fadeAt(y);
          if (fade <= 0) continue;
          const ghost = makeTileEl(grid[r][c], r, c);
          ghost.classList.add('ghost');
          ghost.style.top = y + 'px';
          ghost.style.opacity = String(0.55 * fade);
          boardEl.appendChild(ghost);
        }
      }
    }
  }

  function showCheck() {
    checkEl.classList.add('show');
    setTimeout(() => checkEl.classList.remove('show'), 900);
  }

  function goToBeat(i: number) {
    clearTimeout(autoTimer);
    clearTimeout(advanceTimer);
    paused = false;
    advancePending = false;
    pauseBtn.textContent = s.pause;
    pauseBtn.classList.remove('active');
    solved = false;
    dragAxis = null;
    dragOffset = 0;
    removedCells = new Set();
    outlineTracker.reset();
    highlightPopped = false;
    beatIndex = Math.max(0, Math.min(BEATS.length - 1, i));
    grid = cloneGrid(BEATS[beatIndex].grid());
    stepLabelEl.textContent = `${beatIndex + 1} / ${BEATS.length}`;
    captionEl.textContent = s[BEATS[beatIndex].captionKey];
    prevBtn.style.visibility = beatIndex > 0 ? 'visible' : 'hidden';
    // A brief whole-board fade/settle so switching beats reads as a
    // transition rather than an instant cut — removed and re-added so the
    // animation restarts even though #board itself is a stable element
    // across renders (only its children get torn down and rebuilt).
    boardEl.classList.remove('beat-enter');
    render();
    void boardEl.offsetWidth;
    boardEl.classList.add('beat-enter');
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

  // The only two things that should ever auto-advance past a beat once its
  // payoff has played — routed through here so pausing can hold both back
  // uniformly instead of each call site needing its own pause check.
  function scheduleAutoAdvance(delay: number) {
    if (paused) {
      advancePending = true;
      return;
    }
    advanceTimer = window.setTimeout(advance, delay);
  }

  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? s.resume : s.pause;
    pauseBtn.classList.toggle('active', paused);
    if (paused) {
      // A beat with goal 'none' (or a payoff that already finished) may
      // already have a real timer ticking by the time the player reaches
      // for pause — cancel it and remember to reschedule on resume,
      // instead of only blocking *future* scheduleAutoAdvance calls.
      if (advanceTimer !== undefined) {
        clearTimeout(advanceTimer);
        advanceTimer = undefined;
        advancePending = true;
      }
    } else if (advancePending) {
      advancePending = false;
      scheduleAutoAdvance(400);
    }
  }

  // Checks whether the current beat's goal is already satisfied (used right
  // after entering a beat, and again after every drag) and plays the
  // matching payoff if so.
  function settleBeat() {
    const beat = BEATS[beatIndex];
    if (beat.goal === 'none') {
      scheduleAutoAdvance(1800);
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
      scheduleAutoAdvance(1400);
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
        scheduleAutoAdvance(1900);
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
    lastShift = 0;
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
    // Same per-detent tick the real square game gives on every whole-cell
    // shift crossed, not just on the final drop.
    const shift = Math.round(dragOffset);
    if (shift !== lastShift) {
      vibrate(6);
      lastShift = shift;
    }
    render();
    renderDragGhosts();
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
    clearTimeout(advanceTimer);
  }

  skipBtn.addEventListener('click', () => {
    cleanup();
    onDone();
  });
  prevBtn.addEventListener('click', () => {
    if (beatIndex > 0) goToBeat(beatIndex - 1);
  });
  nextBtn.addEventListener('click', advance);
  pauseBtn.addEventListener('click', togglePause);

  goToBeat(0);
}
