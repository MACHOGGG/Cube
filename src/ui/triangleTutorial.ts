import '../shapes/triangle.css';
import { vibrate } from '../engine/haptics';
import { createOutlineTracker, applyScoreAnimations, spawnTriangleOutline } from '../engine/scoreOutline';
import { STRINGS, type I18nStrings, type Lang } from '../i18n';

// A scripted walkthrough of what's *different* about the triangle game (the
// player has already seen the base square tutorial's universal concepts by
// the time this runs) — 3 slide directions, the "31"/"13" big-triangle
// cluster, and a whole-line bonus turning its cells into blank (but still
// slidable) pieces. Unlike the earlier version of this tutorial, the board
// is shown once in full at the very start and then the camera itself pans
// and zooms between each beat's own corner of the board (see setCamera)
// rather than the player always seeing the whole thing at once — each beat
// only needs its own small patch of triangles legible, and at this board's
// real proportions a patch read at full-board zoom is too small to see the
// per-triangle outline this version also adds (see .tutorial-board .tri
// .fill in style.css).
// Like circleTutorial.ts, this doesn't reproduce triangle.ts's real per-line
// shift-with-wrap math (the trickiest, most bug-prone part of that board's
// whole implementation this project has had to fix repeatedly) — every beat
// is an independent authored snapshot, and any drag on the board simply
// confirms the current beat and reveals its pre-authored "after" state
// through the same match/flip/whole-line-bonus animations the real game
// uses.

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
// Each cell gets its own dot color (cycled from dotColors) rather than one
// shared value — real triangle.ts assigns dot color per physical tile, so a
// matched group's flip result is never uniformly one color; the flip-demo
// beat specifically exists to show that variety.
function withActiveVaried(cells: Cell2[], activeColor: number, dotColors: number[]): () => Grid {
  return () => {
    const g = baseGrid();
    cells.forEach(([r, c], i) => {
      g[r][c] = tf(activeColor, dotColors[i % dotColors.length]);
    });
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

type Goal = 'any' | 'wholeLine' | 'flipZoom';
interface Beat {
  captionKey: keyof I18nStrings;
  grid: () => Grid;
  goal: Goal;
  targetCells: Cell2[];
  /** Which cells the camera centers on for this beat, and how tightly. */
  cameraCells: Cell2[];
  cameraScale: number;
}

// run-4 along row 0 (the board's top-left corner)
const beat1Cells: Cell2[] = [[0, 0], [0, 1], [0, 2], [0, 3]];
// a "31"/"13" big-triangle cluster, moved to the board's top-right corner
// (mirrors beat1's shape at the opposite edge — same up-triangle-on-top +
// 3-below construction, verified via globalPos: (0,6) is still p even i.e.
// up-pointing, same as the original (0,0) anchor).
const beat2Cells: Cell2[] = [[0, 6], [1, 6], [1, 7], [1, 8]];
// a whole line along the board's bottom row (row 5 mirrors row 0 exactly —
// same 7-cell length, opposite edge of the hexagon).
const beat4Cells: Cell2[] = Array.from({ length: 7 }, (_, c) => [5, c] as Cell2);
// The flip-zoom demo reuses beat2's own cells/position (that's the group
// whose flip it's explaining) with a fresh, varied dot-color assignment —
// 2 different "other" colors plus one self-pair among the 4, matching real
// triangle.ts's near-even self/other split (documented below).
const FLIP_DEMO_FRONT = 2;
const FLIP_DEMO_DOTS = [1, 3, 2, 0];

const BEATS: Beat[] = [
  {
    captionKey: 'triSlide',
    grid: withActive(beat1Cells, 1, 1),
    goal: 'any',
    targetCells: beat1Cells,
    cameraCells: beat1Cells,
    cameraScale: 2.3,
  },
  {
    captionKey: 'triBigTriangle',
    grid: withActive(beat2Cells, 2, 0),
    goal: 'any',
    targetCells: beat2Cells,
    cameraCells: beat2Cells,
    cameraScale: 2.3,
  },
  // Replaces the old orientation-wrap demo: zooms in tighter on the group
  // beat 2 just matched and walks through its flip — front color held,
  // then flipped to reveal each tile's own (varied) dot color, then back —
  // the same "look closely at one just-scored group's two faces" beat the
  // square tutorial's own flip explanation gives, at triangle's own scale.
  {
    captionKey: 'triFlipOrientation',
    grid: withActiveVaried(beat2Cells, FLIP_DEMO_FRONT, FLIP_DEMO_DOTS),
    goal: 'flipZoom',
    targetCells: beat2Cells,
    cameraCells: beat2Cells,
    cameraScale: 3.4,
  },
  {
    captionKey: 'triBlank',
    grid: withDotLine(beat4Cells, 0),
    goal: 'wholeLine',
    targetCells: beat4Cells,
    cameraCells: beat4Cells,
    cameraScale: 2.1,
  },
];

// A cell in row 4 sitting at the same *global* horizontal position as
// beat4Cells[3] (row 5) — not a strict game-adjacency neighbor, just a
// visually-adjacent "row directly above" cell, matching how
// circleTutorial.ts's own blank-move demo picks an illustrative neighbor
// rather than modeling real per-shape adjacency.
const BLANK_MOVE_FROM: Cell2 = beat4Cells[3];
const BLANK_MOVE_TO: Cell2 = [4, 5];

export function renderTriangleTutorial(container: HTMLElement, lang: Lang, onDone: () => void) {
  const s = STRINGS[lang];
  let beatIndex = 0;
  let grid: Grid = BEATS[0].grid();
  let solved = false;
  let flipInCells = new Set<string>();
  const outlineTracker = createOutlineTracker();
  let autoTimer: number | undefined;
  let S = 0, H = 0, originX = 0, originY = 0;
  // Bumped on every goToBeat — every deferred callback below (camera pans,
  // the flip-zoom sequence, the whole-line bonus, the blank-move demo) all
  // chain plain setTimeout calls and captures beatGen at schedule time, so
  // a player clicking prev/next mid-sequence doesn't leave a stale callback
  // free to mutate whatever beat is active by the time it fires.
  let beatGen = 0;
  let cameraScale = 1;
  let cameraFocus: [number, number] | null = null;

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
  function groupFocus(cells: Cell2[]): [number, number] {
    const pts = cells.flatMap(([r, c]) => triGeometry(r, c).pts.map(toScreen));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }

  // ---------- camera: pans/zooms #board itself via CSS transform ----------
  // transform-origin is pinned to 0 0 so the math is a plain "scale about
  // the origin, then translate" — translate(cx-fx*s, cy-fy*s) scale(s) maps
  // local point (fx,fy) to screen point (cx,cy), i.e. centers whatever
  // focus point on the board's own middle. scale 1 + focus = board's own
  // center is the identity (full board, untransformed).
  function applyCamera(durationMs: number) {
    const rect = boardWrap.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const cx = size / 2, cy = size / 2;
    const [fx, fy] = cameraFocus ?? [cx, cy];
    boardEl.style.transition = durationMs > 0 ? `transform ${durationMs}ms cubic-bezier(.4,0,.2,1)` : 'none';
    boardEl.style.transformOrigin = '0 0';
    boardEl.style.transform = `translate(${cx - fx * cameraScale}px, ${cy - fy * cameraScale}px) scale(${cameraScale})`;
  }
  function setCamera(scale: number, focus: [number, number] | null, durationMs = 900) {
    cameraScale = scale;
    cameraFocus = focus;
    applyCamera(durationMs);
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
    applyCamera(0);
  }

  // Highlights a scoring pattern with a single glow outline that hugs the
  // whole group's own silhouette. Appended to boardEl (not boardWrap) so it
  // rides along with the camera's own pan/zoom transform automatically,
  // exactly like the score outlines above — a glow living outside the
  // transformed element would drift out of sync with the (now zoomed)
  // triangles it's supposed to be marking.
  function renderPatternGlow() {
    boardEl.querySelectorAll('.tutorial-cell-glow').forEach((el) => el.remove());
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
    boardEl.appendChild(glow);
  }

  function showCheck(blink = false) {
    checkEl.classList.toggle('blink', blink);
    checkEl.classList.add('show');
    setTimeout(() => checkEl.classList.remove('show'), 900);
  }

  function goToBeat(i: number) {
    clearTimeout(autoTimer);
    beatGen++;
    solved = false;
    beatIndex = Math.max(0, Math.min(BEATS.length - 1, i));
    const beat = BEATS[beatIndex];
    grid = beat.grid();
    stepLabelEl.textContent = `${beatIndex + 1} / ${BEATS.length}`;
    captionEl.textContent = s[beat.captionKey];
    prevBtn.style.visibility = beatIndex > 0 ? 'visible' : 'hidden';
    setCamera(beat.cameraScale, groupFocus(beat.cameraCells), 900);
    render();
    settleBeat();
  }

  // The very first beat plays a one-time intro: the whole board shown
  // first (camera at identity), then a slow zoom into beat 0's corner with
  // the pattern glow blinking in — the "here's the whole board, now watch
  // this corner" framing the spec asks for. Never replayed on prev/next.
  function playIntroThenBeat0() {
    beatGen++;
    solved = false;
    beatIndex = 0;
    const beat = BEATS[0];
    grid = beat.grid();
    stepLabelEl.textContent = `1 / ${BEATS.length}`;
    captionEl.textContent = s[beat.captionKey];
    prevBtn.style.visibility = 'hidden';
    setCamera(1, null, 0);
    render();
    const gen = beatGen;
    autoTimer = window.setTimeout(() => {
      if (gen !== beatGen) return;
      setCamera(beat.cameraScale, groupFocus(beat.cameraCells), 1400);
      autoTimer = window.setTimeout(() => {
        if (gen !== beatGen) return;
        render(); // re-pop the glow with its blink-in class below
        showCheck(true);
        settleBeat();
      }, 1400);
    }, 1100);
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
    if (beat.goal === 'flipZoom') {
      autoTimer = window.setTimeout(() => playFlipZoomDemo(beat.targetCells), 900);
    } else if (beat.goal === 'wholeLine') {
      playWholeLineBonus(beat.targetCells);
    }
  }

  function playMatch(cells: Cell2[]) {
    solved = true;
    const gen = beatGen;
    outlineTracker.add([cells]);
    render();
    vibrate(15);
    setTimeout(() => {
      if (gen !== beatGen) return;
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

  // Zooms in tighter on a group that just scored (see beat index 2's
  // 'flipZoom' goal) and walks front → back → front: hold the front color
  // so the player registers what was just matched, flip to reveal each
  // tile's own (independently varied) dot color and hold that, then flip
  // back — the front/back correspondence is exactly what withActiveVaried
  // set up, never invented on the fly.
  function playFlipZoomDemo(cells: Cell2[]) {
    solved = true;
    const gen = beatGen;
    const frontTiles = cells.map(([r, c]) => grid[r][c]);
    autoTimer = window.setTimeout(() => {
      if (gen !== beatGen) return;
      for (const [r, c] of cells) {
        const t = grid[r][c];
        grid[r][c] = td(t.dotColor);
        flipInCells.add(key(r, c));
      }
      render();
      vibrate(15);
      autoTimer = window.setTimeout(() => {
        if (gen !== beatGen) return;
        cells.forEach(([r, c], i) => {
          grid[r][c] = frontTiles[i];
          flipInCells.add(key(r, c));
        });
        render();
        vibrate(10);
        showCheck();
        autoTimer = window.setTimeout(advance, 1400);
      }, 2000);
    }, 2000);
  }

  // Held long enough up front to actually register "the whole line is the
  // same reverse-face color" before anything starts fading, then a slow
  // fade to the resulting blank pieces, which are left on screen for a
  // while too — this is the moment the caption's "blank piece, still
  // slides" point needs to land, not something to blink past. Finishes by
  // handing off to playBlankMoveDemo rather than advancing straight away,
  // so the player also sees a blank piece actually get dragged.
  function playWholeLineBonus(cells: Cell2[]) {
    solved = true;
    const gen = beatGen;
    outlineTracker.add([cells]);
    render();
    vibrate([25, 40, 25]);
    autoTimer = window.setTimeout(() => {
      if (gen !== beatGen) return;
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
        if (gen !== beatGen) return;
        autoTimer = window.setTimeout(() => playBlankMoveDemo(), 900);
      }, 1050);
    }, 1900);
  }

  // Demonstrates that a blank triangle still occupies a real cell and can
  // still be dragged: slides BLANK_MOVE_FROM's blank piece into
  // BLANK_MOVE_TO (swapping places with whatever real tile is there), via
  // the same ghost-element slide technique circleTutorial.ts's own
  // blank-ball demo uses.
  const BLANK_SLIDE_MS = 900;
  function playBlankMoveDemo() {
    const gen = beatGen;
    const [fr, fc] = BLANK_MOVE_FROM;
    const [tr, tc] = BLANK_MOVE_TO;
    const fromTile = grid[fr][fc];
    const toTile = grid[tr][tc];
    const fromPts = triGeometry(fr, fc).pts.map(toScreen);
    const toPts = triGeometry(tr, tc).pts.map(toScreen);
    const fXs = fromPts.map((p) => p[0]), fYs = fromPts.map((p) => p[1]);
    const tXs = toPts.map((p) => p[0]), tYs = toPts.map((p) => p[1]);
    const fMinX = Math.min(...fXs), fMinY = Math.min(...fYs);
    const tMinX = Math.min(...tXs), tMinY = Math.min(...tYs);

    // Reuses the beat's own established camera framing (already covering
    // both the blanked bottom row and the row just above it) rather than
    // panning in tighter on just these 2 cells — a closer zoom here mostly
    // just fills the frame with a single blank tile's flat interior, well
    // past the point its own triangular silhouette is still visible.

    autoTimer = window.setTimeout(() => {
      if (gen !== beatGen) return;
      const el1 = boardEl.querySelector<HTMLElement>(`.tri[data-r="${fr}"][data-c="${fc}"]`);
      const el2 = boardEl.querySelector<HTMLElement>(`.tri[data-r="${tr}"][data-c="${tc}"]`);
      el1?.remove();
      el2?.remove();
      const ghostFrom = makeTriEl(fromTile, fr, fc);
      const ghostTo = makeTriEl(toTile, tr, tc);
      ghostFrom.style.transition = ghostTo.style.transition = `transform ${BLANK_SLIDE_MS}ms cubic-bezier(.4,0,.2,1)`;
      ghostFrom.style.zIndex = ghostTo.style.zIndex = '5';
      boardEl.appendChild(ghostFrom);
      boardEl.appendChild(ghostTo);
      vibrate(10);
      requestAnimationFrame(() => {
        ghostFrom.style.transform = `translate(${tMinX - fMinX}px, ${tMinY - fMinY}px)`;
        ghostTo.style.transform = `translate(${fMinX - tMinX}px, ${fMinY - tMinY}px)`;
      });
      autoTimer = window.setTimeout(() => {
        if (gen !== beatGen) return;
        grid[fr][fc] = toTile;
        grid[tr][tc] = fromTile;
        ghostFrom.remove();
        ghostTo.remove();
        render();
        showCheck();
        autoTimer = window.setTimeout(advance, 1400);
      }, BLANK_SLIDE_MS + 80);
    }, 700);
  }

  // Any drag confirms the current beat (see module comment).
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

  const onResize = () => {
    render();
  };
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

  playIntroThenBeat0();
}
