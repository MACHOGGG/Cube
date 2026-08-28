import '../shapes/circle.css';
import { vibrate } from '../engine/haptics';
import { createOutlineTracker, applyScoreAnimations, spawnOutlineEl } from '../engine/scoreOutline';
import { STRINGS, type I18nStrings, type Lang } from '../i18n';

// A scripted walkthrough of what's *different* about the circle game — the
// player has already seen the base square tutorial's universal concepts
// (drag to match, scored tiles flip, a whole line pays out big) by the time
// this runs, so this one only covers circle-specific content: 3 slide
// directions instead of 2, the "22"/"121" cluster patterns, and the
// post-line-bonus blank ball. Unlike the square tutorial, each beat is an
// independent authored snapshot (no shift math is reproduced here — see the
// module comment in circleTutorial's sibling triangleTutorial.ts for why):
// any drag gesture on the board simply confirms the current beat and reveals
// its pre-authored "after" state through the exact same match/flip/whole-
// line-bonus animations the real circle game uses.
interface CTile {
  color: number; // -1 = blank
  face: 'F' | 'D';
  dotColor: number;
}
const BLANK = -1;
function tf(color: number, dotColor: number): CTile {
  return { color, face: 'F', dotColor };
}
function td(dotColor: number): CTile {
  return { color: BLANK, face: 'D', dotColor };
}
function tblank(): CTile {
  return { color: BLANK, face: 'D', dotColor: BLANK };
}
function isBlank(t: CTile): boolean {
  return t.color === BLANK && t.face === 'D' && t.dotColor === BLANK;
}
type Grid = CTile[][];
function key(r: number, c: number): string {
  return r + ',' + c;
}

const ROWS = 7; // same triangular packing as circle.ts (row r has r+1 balls)
const COLORS = ['#C0666B', '#DDA857', '#7A9C4A', '#4F72C4'];

function cellValid(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c <= r;
}
// Verified (throwaway Node script) to have zero accidental run/cluster
// matches anywhere on the board on its own — every beat starts from this
// same clean base and overrides only the handful of cells its own story
// needs, exactly like the square tutorial's checkerboard filler.
function fillerColor(r: number, c: number): number {
  return (2 * r + 3 * c) % 4;
}
function baseGrid(): Grid {
  const g: Grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row: CTile[] = [];
    for (let c = 0; c <= r; c++) row.push(tf(fillerColor(r, c), fillerColor(r, c)));
    g.push(row);
  }
  return g;
}
type Cell2 = [number, number];
// dotColor defaults to activeColor only for call sites that don't care (the
// filler base and the orientation-style "never actually shown" cases don't
// exist here, but keeping the default self-pairing implicit would silently
// reintroduce the very bug this was fixed for — see BEATS below, which
// always passes an explicit dotColor for every beat that actually flips).
function withActive(cells: Cell2[], activeColor: number, dotColor: number): () => Grid {
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
// The blank-move beat picks up right where the whole-line bonus beat left
// off visually — these cells need to *already* be blank on entry, not
// dot-faced again (this beat's grid is its own fresh snapshot, per this
// tutorial's usual "no carry-forward" design, so it has to be told the
// post-bonus state explicitly rather than inheriting it).
function withBlank(cells: Cell2[]): () => Grid {
  return () => {
    const g = baseGrid();
    for (const [r, c] of cells) g[r][c] = tblank();
    return g;
  };
}

// 'sequence': one drag steps through several pattern groups in turn (each
// gets its own highlight-blink-check-flip beat) instead of needing a
// separate drag per pattern. 'blankMove': a scripted swap demonstrating
// that a blank ball still occupies a real cell and can still be dragged.
type Goal = 'any' | 'wholeLine' | 'sequence' | 'blankMove';
interface Beat {
  captionKey: keyof I18nStrings;
  grid: () => Grid;
  goal: Goal;
  targetCells: Cell2[];
  sequenceGroups?: Cell2[][];
}
// run-4 along row 6 (the board's longest row)
const runCells: Cell2[] = [[6, 0], [6, 1], [6, 2], [6, 3]];
// a "22" rhombus cluster
const clusterCells: Cell2[] = [[1, 0], [1, 1], [2, 1], [2, 2]];
// a "121" diamond (1/2/1 balls across 3 rows) — same shape as circle.ts's
// own diamond121(r, c) = [[r,c],[r+1,c],[r+1,c+1],[r+2,c+1]], at r=3,c=3.
// Verified (throwaway Node script) that with only these 4 cells overridden,
// this is the *only* qualifying pattern anywhere on the board — some nearby
// origins accidentally extend into a real filler cell that already shares
// the override color, forming an unrelated second cluster right next to
// the intended one. The three groups (runCells/clusterCells/diamondCells)
// don't share any cell, so all three can sit on one board at once for the
// combined intro beat below.
const diamondCells: Cell2[] = [[3, 3], [4, 3], [4, 4], [5, 4]];
// A 4th, independent pattern reused just for the flip-teaching beat — its
// own beat has a fresh baseGrid() (circle tutorial beats never carry state
// forward, see the module comment), so reusing runCells' position here
// doesn't collide with anything from the combined intro beat.
const flipTeachCells: Cell2[] = runCells;
// a compact whole-line (row 2, length 3) already fully dot-faced
const wholeLineCells: Cell2[] = [[2, 0], [2, 1], [2, 2]];

function withOverrides(entries: [Cell2[], number, number][]): () => Grid {
  return () => {
    const g = baseGrid();
    for (const [cells, color, dotColor] of entries) {
      for (const [r, c] of cells) g[r][c] = tf(color, dotColor);
    }
    return g;
  };
}

// Real circle.ts assigns each tile's dot color at creation time, and a
// tile's own front color is the *rare* outcome (1 self pair per 7, the
// other 3 colors get 2 slots each) — so these flips are each given an
// explicit, distinct *other* color rather than defaulting to a self-pair;
// showing 0 self-pairs across a handful of draws is in fact the single most
// likely outcome of the real distribution (~63% for 3 draws), not a
// distortion of it. Front colors (and therefore which matches exist
// pre-flip) are chosen freely — only which color each flip reveals
// underneath follows that rule.
const BEATS: Beat[] = [
  {
    captionKey: 'circleClusterIntro',
    grid: withOverrides([
      [runCells, 2, 0],
      [clusterCells, 1, 3],
      [diamondCells, 0, 1],
    ]),
    goal: 'sequence',
    // Shown as the dashed highlight box *before* the first drag — without
    // this, renderHighlightBox's `!cells.length` guard skipped drawing
    // anything at all until playSequence's own per-group highlight kicked
    // in mid-reveal, leaving the player with zero visual cue to drag in the
    // first place. The union's bounding box spans all three patterns, which
    // is exactly what the reveal is about to walk through.
    targetCells: [...runCells, ...clusterCells, ...diamondCells],
    sequenceGroups: [runCells, clusterCells, diamondCells],
  },
  { captionKey: 'circleFlipTeach', grid: withActive(flipTeachCells, 3, 1), goal: 'any', targetCells: flipTeachCells },
  { captionKey: 'circleBlank', grid: withDotLine(wholeLineCells, 3), goal: 'wholeLine', targetCells: wholeLineCells },
  { captionKey: 'circleBlankMove', grid: withBlank(wholeLineCells), goal: 'blankMove', targetCells: wholeLineCells },
];

function findWholeLine(grid: Grid, cells: Cell2[]): boolean {
  if (cells.some(([r, c]) => grid[r][c].face !== 'D' || isBlank(grid[r][c]))) return false;
  const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
  return cells.every(([r, c]) => grid[r][c].dotColor === c0);
}

export function renderCircleTutorial(container: HTMLElement, lang: Lang, onDone: () => void) {
  const s = STRINGS[lang];
  let beatIndex = 0;
  let grid: Grid = BEATS[0].grid();
  let solved = false;
  let flipInCells = new Set<string>();
  const outlineTracker = createOutlineTracker();
  let autoTimer: number | undefined;
  // Bumped on every goToBeat. playMatch/playSequence/playWholeLineBonus/
  // playBlankMove all chain plain setTimeout calls for their own internal
  // step timing (not the single `autoTimer` goToBeat clears) — a player
  // clicking prev/next mid-animation doesn't cancel those, so a stale
  // callback can fire later and mutate whatever beat is active *then*
  // instead of the one it was scheduled for. Each such callback captures
  // `beatGen` at schedule time and bails if it no longer matches.
  let beatGen = 0;
  let R = 0, rowH = 0, boardTop = 0, boardLeft = 0;
  // Overrides which cells the highlight box tracks — used only while a
  // 'sequence' beat is stepping through its groups one at a time (null
  // everywhere else, where beat.targetCells is the whole story).
  let activeHighlightCells: Cell2[] | null = null;
  let highlightBlink = false;
  // The flip-teach beat plays a bigger, slower flip so the transformation
  // itself is unmistakable, instead of the same quick flip every other
  // scoring beat uses.
  let flipEmphasisCells: Set<string> | null = null;

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

  function layout() {
    const rect = boardWrap.getBoundingClientRect();
    const S = Math.min(rect.width, rect.height);
    R = S / (2 * ROWS);
    rowH = R * Math.sqrt(3);
    const totalH = (ROWS - 1) * rowH + 2 * R;
    boardTop = (S - totalH) / 2;
    boardLeft = S / 2;
    boardEl.style.width = S + 'px';
    boardEl.style.height = S + 'px';
  }
  function ballCenter(r: number, c: number): [number, number] {
    const cx = boardLeft + (c - r / 2) * 2 * R;
    const cy = boardTop + R + r * rowH;
    return [cx, cy];
  }

  function makeBallEl(t: CTile, r: number, c: number): HTMLElement {
    const [cx, cy] = ballCenter(r, c);
    const size = R * 1.86;
    const el = document.createElement('div');
    el.className = 'ball';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.left = cx - size / 2 + 'px';
    el.style.top = cy - size / 2 + 'px';
    if (isBlank(t)) {
      el.style.background = 'var(--ink-faint)';
      el.style.opacity = '0.35';
    } else if (t.face === 'D') {
      el.style.background = 'transparent';
      const starSize = Math.round(size * 0.95);
      const color = COLORS[t.dotColor];
      el.innerHTML =
        `<svg viewBox="0 0 24 24" width="${starSize}" height="${starSize}">` +
        `<g stroke="${color}" stroke-width="5.5" stroke-linecap="round">` +
        `<line x1="12" y1="2.5" x2="12" y2="21.5"/>` +
        `<line x1="4" y1="6.75" x2="20" y2="17.25"/>` +
        `<line x1="20" y1="6.75" x2="4" y2="17.25"/>` +
        `</g></svg>`;
    } else {
      el.style.background = COLORS[t.color];
    }
    el.dataset.r = String(r);
    el.dataset.c = String(c);
    return el;
  }

  function render() {
    layout();
    boardEl.innerHTML = '';
    const outlineEntries = outlineTracker.current();
    const pulseMs = new Map<string, number>();
    for (const { cells, elapsedMs } of outlineEntries) for (const [r, c] of cells) pulseMs.set(key(r, c), elapsedMs);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= r; c++) {
        if (!cellValid(r, c)) continue;
        const el = makeBallEl(grid[r][c], r, c);
        applyScoreAnimations(el, flipInCells.has(key(r, c)), pulseMs.get(key(r, c)));
        boardEl.appendChild(el);
      }
    }
    flipInCells = new Set();
    const size = R * 1.86;
    for (const { cells, elapsedMs } of outlineEntries) {
      for (const [r, c] of cells) {
        const [cx, cy] = ballCenter(r, c);
        spawnOutlineEl(boardEl, { left: cx - size / 2, top: cy - size / 2, width: size, height: size }, elapsedMs, 'circle');
      }
    }
    // Flip-teach's emphasis ring is its own overlay element rather than a
    // class on the ball itself — the ball already carries an inline
    // `animation` (flip-in + score-pulse, set by applyScoreAnimations), and
    // a second class-based `animation` on the same element would just
    // silently replace it rather than play alongside it.
    if (flipEmphasisCells) {
      for (const k of flipEmphasisCells) {
        const [r, c] = k.split(',').map(Number);
        const [cx, cy] = ballCenter(r, c);
        const ring = document.createElement('div');
        ring.className = 'flip-emphasis-ring';
        ring.style.left = cx - size / 2 + 'px';
        ring.style.top = cy - size / 2 + 'px';
        ring.style.width = size + 'px';
        ring.style.height = size + 'px';
        boardEl.appendChild(ring);
      }
    }
    renderHighlightBox();
  }

  function renderHighlightBox() {
    boardWrap.querySelectorAll('.tutorial-highlight-box').forEach((el) => el.remove());
    const beat = BEATS[beatIndex];
    const cells = activeHighlightCells ?? beat.targetCells;
    // solved only suppresses the *normal* (beat.targetCells) highlight, once
    // that beat's one target has been matched. During a 'sequence' beat,
    // solved is already true for the whole sequence (it's what blocks a
    // second drag from re-entering it) — activeHighlightCells is what
    // actually tracks whether a group is being highlighted right now, and
    // must keep working regardless of solved.
    const suppressed = activeHighlightCells === null && solved;
    if (!cells.length || suppressed) return;
    const size = R * 1.86;
    const pts = cells.map(([r, c]) => ballCenter(r, c));
    const minX = Math.min(...pts.map((p) => p[0])) - size / 2;
    const maxX = Math.max(...pts.map((p) => p[0])) + size / 2;
    const minY = Math.min(...pts.map((p) => p[1])) - size / 2;
    const maxY = Math.max(...pts.map((p) => p[1])) + size / 2;
    const box = document.createElement('div');
    box.className = 'tutorial-highlight-box';
    if (highlightBlink) box.classList.add('blink-in');
    box.style.left = minX + 'px';
    box.style.top = minY + 'px';
    box.style.width = maxX - minX + 'px';
    box.style.height = maxY - minY + 'px';
    boardWrap.appendChild(box);
  }

  // `blink` plays a snappier double-flash before settling — used when the
  // combined pattern-intro beat confirms each of its groups in turn, so the
  // "yes, that one too" moment reads clearly instead of blending into the
  // single quiet pop every other beat's checkmark uses.
  function showCheck(blink = false) {
    checkEl.classList.toggle('blink', blink);
    checkEl.classList.add('show');
    setTimeout(() => checkEl.classList.remove('show'), 900);
  }

  function goToBeat(i: number) {
    clearTimeout(autoTimer);
    beatGen++;
    solved = false;
    activeHighlightCells = null;
    highlightBlink = false;
    flipEmphasisCells = null;
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
    if (beat.goal === 'wholeLine' && findWholeLine(grid, beat.targetCells)) {
      playWholeLineBonus(beat.targetCells);
    }
  }

  // `emphasis`: the flip-teach beat wants its one flip to be unmistakable —
  // a longer pre-flip pause to build anticipation, and an expanding ring
  // overlay (.flip-emphasis-ring, see style.css) around the cells about to
  // flip. flipEmphasisCells must be set *before* this render() call, not
  // after — render() is what actually reads it to spawn the ring elements.
  // `onDone`: lets a caller (playSequence) chain its own step after this
  // flip's payoff instead of always auto-advancing to the next beat.
  function playMatch(cells: Cell2[], opts?: { emphasis?: boolean; onDone?: () => void }) {
    solved = true;
    const gen = beatGen;
    outlineTracker.add([cells]);
    if (opts?.emphasis) flipEmphasisCells = new Set(cells.map(([r, c]) => key(r, c)));
    render();
    vibrate(15);
    setTimeout(() => {
      if (gen !== beatGen) return;
      for (const [r, c] of cells) {
        const t = grid[r][c];
        // A tile's dot color was decided when it was created (t.dotColor),
        // exactly like the real circle game — reusing t.color here would
        // force every flip to be a same-color self-pair, which is the rare
        // case in the real game, not the rule.
        grid[r][c] = td(t.dotColor);
        flipInCells.add(key(r, c));
      }
      render();
      showCheck();
      flipEmphasisCells = null;
      if (opts?.onDone) {
        autoTimer = window.setTimeout(opts.onDone, 900);
      } else {
        autoTimer = window.setTimeout(advance, 1400);
      }
    }, opts?.emphasis ? 1300 : 750);
  }

  // The combined pattern-intro beat: reveals each group in sequenceGroups
  // one after another (highlight blinks in, checkmark blinks, flips) inside
  // this single beat, instead of needing a separate drag per pattern.
  function playSequence(groups: Cell2[][], idx = 0) {
    solved = true;
    const gen = beatGen;
    if (idx >= groups.length) {
      autoTimer = window.setTimeout(advance, 900);
      return;
    }
    const cells = groups[idx];
    activeHighlightCells = cells;
    highlightBlink = true;
    render();
    vibrate(10);
    setTimeout(() => {
      if (gen !== beatGen) return;
      outlineTracker.add([cells]);
      render();
      setTimeout(() => {
        if (gen !== beatGen) return;
        for (const [r, c] of cells) {
          const t = grid[r][c];
          grid[r][c] = td(t.dotColor);
          flipInCells.add(key(r, c));
        }
        activeHighlightCells = null;
        render();
        showCheck(true);
        playSequence(groups, idx + 1);
      }, 650);
    }, 500);
  }

  function playWholeLineBonus(cells: Cell2[]) {
    solved = true;
    const gen = beatGen;
    outlineTracker.add([cells]);
    render();
    vibrate([25, 40, 25]);
    autoTimer = window.setTimeout(() => {
      if (gen !== beatGen) return;
      for (const [r, c] of cells) grid[r][c] = tblank();
      render();
      showCheck();
      autoTimer = window.setTimeout(advance, 1900);
    }, 1600);
  }

  // Scripted swap demonstrating a blank ball still occupies a real cell and
  // still drags: slides wholeLineCells[0]'s blank ball to an adjacent cell
  // (swapping places with whatever's already there), via the same ghost-
  // element slide triangleTutorial.ts's orientation-swap beat uses, rather
  // than requiring the player to land a precise real drag on a demo whose
  // whole point is just to be watched.
  const BLANK_MOVE_FROM: Cell2 = wholeLineCells[0];
  const BLANK_MOVE_TO: Cell2 = [3, 0];
  const BLANK_SLIDE_MS = 900;
  function playBlankMove() {
    solved = true;
    const gen = beatGen;
    render();
    const [fr, fc] = BLANK_MOVE_FROM;
    const [tr, tc] = BLANK_MOVE_TO;
    const fromTile = grid[fr][fc];
    const toTile = grid[tr][tc];
    const size = R * 1.86;
    const [fx, fy] = ballCenter(fr, fc);
    const [tx, ty] = ballCenter(tr, tc);

    function ghostFor(tile: CTile, r: number, c: number, x: number, y: number): HTMLElement {
      const ghost = makeBallEl(tile, r, c); // r/c only for the dataset — position set explicitly below
      ghost.style.left = x - size / 2 + 'px';
      ghost.style.top = y - size / 2 + 'px';
      ghost.style.transition = `left ${BLANK_SLIDE_MS}ms cubic-bezier(.4,0,.2,1), top ${BLANK_SLIDE_MS}ms cubic-bezier(.4,0,.2,1)`;
      ghost.style.zIndex = '5';
      return ghost;
    }
    const el1 = document.querySelector<HTMLElement>(`.ball[data-r="${fr}"][data-c="${fc}"]`);
    const el2 = document.querySelector<HTMLElement>(`.ball[data-r="${tr}"][data-c="${tc}"]`);
    el1?.remove();
    el2?.remove();
    const ghostBlank = ghostFor(fromTile, fr, fc, fx, fy);
    const ghostOther = ghostFor(toTile, tr, tc, tx, ty);
    boardEl.appendChild(ghostBlank);
    boardEl.appendChild(ghostOther);
    vibrate(10);
    requestAnimationFrame(() => {
      ghostBlank.style.left = tx - size / 2 + 'px';
      ghostBlank.style.top = ty - size / 2 + 'px';
      ghostOther.style.left = fx - size / 2 + 'px';
      ghostOther.style.top = fy - size / 2 + 'px';
    });
    autoTimer = window.setTimeout(() => {
      if (gen !== beatGen) return;
      grid[fr][fc] = toTile;
      grid[tr][tc] = fromTile;
      ghostBlank.remove();
      ghostOther.remove();
      render();
      showCheck();
      autoTimer = window.setTimeout(advance, 1400);
    }, BLANK_SLIDE_MS + 80);
  }

  // Any drag confirms the current beat — see the module comment: this
  // tutorial doesn't reproduce circle.ts's real per-line shift math, it just
  // reveals each beat's pre-authored "after" state through the same reveal
  // animation a real match would use.
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
    if (beat.goal === 'any') playMatch(beat.targetCells, { emphasis: beat.captionKey === 'circleFlipTeach' });
    else if (beat.goal === 'sequence' && beat.sequenceGroups) playSequence(beat.sequenceGroups);
    else if (beat.goal === 'blankMove') playBlankMove();
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
