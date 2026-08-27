import '../shapes/square.css';
import { magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import { shuffle } from '../engine/rng';
import { STRINGS, type I18nStrings, type Lang } from '../i18n';

// A single scripted walkthrough of the square game's core mechanics, told as
// one continuous 4x4 board rather than a fresh random layout per step (the
// whole point being that the player recognizes "the same board from a
// moment ago", not a new flashcard each time). Every beat's starting grid
// below is hand-authored and was verified with a throwaway simulation
// script before being written here — see the shift math in each beat's
// comment. Colors are indices into a small palette that gets reshuffled
// every time the tutorial mounts (so replays don't look identical), but the
// *structure* (which cell holds which role) never changes, which is what
// the verified shift math depends on.
type Face = 'F' | 'D';
interface TTile {
  color: number;
  face: Face;
  dotColor: number;
}
function tf(color: number): TTile {
  return { color, face: 'F', dotColor: -1 };
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

const DIM = 4;
// role indices: 0=A(blue) 1=B(green) 2=MIX(magenta, A's back and the shared
// mixed-face color) 3=BONUS(gold, B's back) 4=filler(gray)
const COLOR_POOL = ['#4C7EAD', '#4A9573', '#AD5C82', '#D89B1E', '#9B958D', '#C46A4E'];
function rolledPalette(): string[] {
  return shuffle([...COLOR_POOL]).slice(0, 5);
}

interface Move {
  axis: 'row' | 'col';
  index: number;
  shift: number; // the one verified shift that completes this beat
}
interface Beat {
  captionKey: keyof I18nStrings;
  grid: () => Grid;
  move: Move | null; // null = reveal-only beat (no drag needed)
  targetCells: [number, number][]; // cells whose shared effColor marks success
  flipTo: number | null; // color index the target cells flip to once matched (null = already resolved, e.g. reveal beats)
  arrow: { row?: number; col?: number; dir: 'left' | 'right' | 'up' | 'down' } | null;
  revealDelayMs?: number; // for reveal-only beats, how long before auto-advance is offered
}

// ---------- beat 1: 2x2 ----------
// row2 before = [3,4,0,0], shift=-1 (drag left) -> [4,0,0,3], giving
// (1,1)(1,2)(2,1)(2,2) = 0,0,0,0. Verified.
function beat1Grid(): Grid {
  return [
    [tf(4), tf(1), tf(4), tf(1)],
    [tf(1), tf(0), tf(0), tf(4)],
    [tf(3), tf(4), tf(0), tf(0)],
    [tf(4), tf(1), tf(4), tf(1)],
  ];
}

// ---------- beat 2: 1x4 row, completed via a column drag ----------
// bakes in beat 1's result (cells (1,1)(1,2)(2,1)(2,2) already flipped to
// dotColor 2). col3 shift=+1 (drag down) -> row3 becomes [1,1,1,1]. Verified.
function beat2Grid(): Grid {
  return [
    [tf(4), tf(1), tf(4), tf(4)],
    [tf(4), td(2), td(2), tf(4)],
    [tf(3), td(2), td(2), tf(1)],
    [tf(1), tf(1), tf(1), tf(4)],
  ];
}

// ---------- beat 3: narrate the flip (reveal only, beat2's aftermath) ----------
function beat3Grid(): Grid {
  return [
    [tf(4), tf(1), tf(4), tf(4)],
    [tf(4), td(2), td(2), tf(4)],
    [tf(3), td(2), td(2), tf(4)],
    [td(3), td(3), td(3), td(3)],
  ];
}

// ---------- beat 4: mixed flavor+dot match, row3 (from beat2) left untouched ----------
// row0 shift=-1 (drag left) -> [4,4,2,2]; combined with row1's existing
// dotColor-2 cells at c2/c3 gives (0,2)(0,3)(1,2)(1,3) all effColor 2. Verified.
function beat4Grid(): Grid {
  return [
    [tf(2), tf(4), tf(4), tf(2)],
    [tf(4), tf(4), td(2), td(2)],
    [tf(3), td(2), td(2), tf(1)],
    [td(3), td(3), td(3), td(3)],
  ];
}

// ---------- beat 5: reveal the already-complete row3 as a whole-line bonus ----------
function beat5Grid(): Grid {
  return beat4Grid().map((row, r) => (r === 3 ? row.map(() => td(3)) : row));
}

function makeBeats(): Beat[] {
  return [
    {
      captionKey: 'beat1',
      grid: beat1Grid,
      move: { axis: 'row', index: 2, shift: -1 },
      targetCells: [
        [1, 1],
        [1, 2],
        [2, 1],
        [2, 2],
      ],
      flipTo: 2,
      arrow: { row: 2, dir: 'left' },
    },
    {
      captionKey: 'beat2',
      grid: beat2Grid,
      move: { axis: 'col', index: 3, shift: 1 },
      targetCells: [
        [3, 0],
        [3, 1],
        [3, 2],
        [3, 3],
      ],
      flipTo: 3,
      arrow: { col: 3, dir: 'down' },
    },
    {
      captionKey: 'beat3',
      grid: beat3Grid,
      move: null,
      targetCells: [],
      flipTo: null,
      arrow: null,
      revealDelayMs: 1400,
    },
    {
      captionKey: 'beat4',
      grid: beat4Grid,
      move: { axis: 'row', index: 0, shift: -1 },
      targetCells: [
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
      ],
      flipTo: 2,
      arrow: { row: 0, dir: 'left' },
    },
    {
      captionKey: 'beat5',
      grid: beat5Grid,
      move: null,
      targetCells: [
        [3, 0],
        [3, 1],
        [3, 2],
        [3, 3],
      ],
      flipTo: null,
      arrow: null,
      revealDelayMs: 1600,
    },
  ];
}

export function renderTutorial(container: HTMLElement, lang: Lang, onDone: () => void) {
  const s = STRINGS[lang];
  const beats = makeBeats();
  let palette = rolledPalette();
  let beatIndex = 0;
  let grid: Grid = cloneGrid(beats[0].grid());
  let cell = 0;
  let removedRow: number | null = null;

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
  const nextBtn = container.querySelector<HTMLButtonElement>('#nextBtn')!;

  let dragOffset = 0; // live preview offset in cell-units, along the beat's axis
  let solved = false;
  let detachDrag: (() => void) | null = null;
  let revealTimer: number | undefined;

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
    el.style.left = c * cell + 2 + 'px';
    el.style.top = r * cell + 2 + 'px';
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

  function render() {
    layout();
    boardEl.innerHTML = '';
    for (let r = 0; r < DIM; r++) {
      for (let c = 0; c < DIM; c++) {
        if (removedRow === r) continue;
        const el = makeTileEl(grid[r][c], r, c);
        const beat = beats[beatIndex];
        if (beat.move) {
          const { axis, index } = beat.move;
          if ((axis === 'row' && r === index) || (axis === 'col' && c === index)) {
            if (axis === 'row') el.style.left = c * cell + 2 + dragOffset * cell + 'px';
            else el.style.top = r * cell + 2 + dragOffset * cell + 'px';
          }
        }
        boardEl.appendChild(el);
      }
    }
    renderArrow();
  }

  function renderArrow() {
    // Appended to boardWrap, not boardEl: the board itself clips overflow
    // (so drag previews and the line-clear animation stay contained), but
    // that would also clip an arrow meant to sit just outside its edge.
    boardWrap.querySelectorAll('.tutorial-hint-arrow').forEach((el) => el.remove());
    const beat = beats[beatIndex];
    if (!beat.arrow) return;
    const glyphs = { left: '‹', right: '›', up: '⌃', down: '⌄' };
    const arrow = document.createElement('div');
    arrow.className = 'tutorial-hint-arrow';
    arrow.textContent = glyphs[beat.arrow.dir];
    if (beat.arrow.row !== undefined) {
      const r = beat.arrow.row;
      const onLeft = beat.arrow.dir === 'left';
      arrow.style.top = r * cell + cell / 2 - 11 + 'px';
      arrow.style.left = onLeft ? '-26px' : cell * DIM + 6 + 'px';
    } else if (beat.arrow.col !== undefined) {
      const c = beat.arrow.col;
      const onTop = beat.arrow.dir === 'up';
      arrow.style.left = c * cell + cell / 2 - 11 + 'px';
      arrow.style.top = onTop ? '-26px' : cell * DIM + 6 + 'px';
    }
    boardWrap.appendChild(arrow);
  }

  function showCheck() {
    checkEl.classList.add('show');
    setTimeout(() => checkEl.classList.remove('show'), 900);
  }

  function applyMoveToGrid(move: Move, shift: number) {
    const n = DIM;
    if (move.axis === 'row') {
      const row = grid[move.index];
      grid[move.index] = row.map((_, i) => row[(((i - shift) % n) + n) % n]);
    } else {
      const col = grid.map((row) => row[move.index]);
      const shifted = col.map((_, i) => col[(((i - shift) % n) + n) % n]);
      shifted.forEach((t, r) => (grid[r][move.index] = t));
    }
  }

  function checkSolved(beat: Beat): boolean {
    if (!beat.targetCells.length) return false;
    const vals = beat.targetCells.map(([r, c]) => eff(grid[r][c]));
    return vals.every((v) => v === vals[0]);
  }

  function flipTargets(beat: Beat) {
    if (beat.flipTo === null) return;
    for (const [r, c] of beat.targetCells) {
      grid[r][c] = td(beat.flipTo);
    }
  }

  function goToBeat(i: number) {
    clearTimeout(revealTimer);
    detachDrag?.();
    detachDrag = null;
    solved = false;
    dragOffset = 0;
    removedRow = null;
    beatIndex = Math.max(0, Math.min(beats.length - 1, i));
    grid = cloneGrid(beats[beatIndex].grid());
    stepLabelEl.textContent = `${beatIndex + 1} / ${beats.length}`;
    captionEl.textContent = s[beats[beatIndex].captionKey];
    render();
    wireBeat();
  }

  function advance() {
    if (beatIndex >= beats.length - 1) {
      onDone();
      return;
    }
    goToBeat(beatIndex + 1);
  }

  function wireBeat() {
    const beat = beats[beatIndex];
    if (!beat.move) {
      // reveal-only beat: beat3 just narrates over the board and waits for
      // "next"; beat5 additionally plays the whole-line bonus (glow, then
      // the row clears) since its target cells are already matching.
      if (beat.targetCells.length && checkSolved(beat)) {
        revealTimer = window.setTimeout(() => {
          const rows = new Set(beat.targetCells.map(([r]) => r));
          const boardTiles = Array.from(boardEl.querySelectorAll<HTMLElement>('.tile'));
          boardTiles.forEach((el) => {
            const r = Number(el.dataset.r);
            if (rows.has(r)) {
              el.style.transition = 'opacity .6s ease, transform .6s ease';
              el.style.opacity = '0';
              el.style.transform = 'scale(0.7)';
            }
          });
          vibrate([25, 40, 25]);
          setTimeout(() => {
            removedRow = [...rows][0];
            render();
          }, 620);
        }, beat.revealDelayMs ?? 1200);
      }
      return;
    }
    let dragging = false;
    let startX = 0;
    let startY = 0;
    function pos(e: PointerEvent) {
      return beat.move!.axis === 'row' ? (e.clientX - startX) / cell : (e.clientY - startY) / cell;
    }
    function down(e: PointerEvent) {
      if (solved) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      boardEl.setPointerCapture(e.pointerId);
    }
    function move(e: PointerEvent) {
      if (!dragging) return;
      dragOffset = magnetizeRawDist(pos(e));
      render();
    }
    function up(e: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      const shift = Math.round(pos(e));
      dragOffset = 0;
      if (shift !== 0) applyMoveToGrid(beat.move!, shift);
      render();
      if (checkSolved(beat)) {
        solved = true;
        vibrate(15);
        flipTargets(beat);
        render();
        showCheck();
        setTimeout(advance, 1000);
      }
    }
    boardEl.addEventListener('pointerdown', down);
    boardEl.addEventListener('pointermove', move);
    boardEl.addEventListener('pointerup', up);
    boardEl.addEventListener('pointercancel', up);
    detachDrag = () => {
      boardEl.removeEventListener('pointerdown', down);
      boardEl.removeEventListener('pointermove', move);
      boardEl.removeEventListener('pointerup', up);
      boardEl.removeEventListener('pointercancel', up);
    };
  }

  const onResize = () => render();
  window.addEventListener('resize', onResize);

  skipBtn.addEventListener('click', () => {
    window.removeEventListener('resize', onResize);
    clearTimeout(revealTimer);
    detachDrag?.();
    onDone();
  });
  nextBtn.addEventListener('click', () => {
    if (beatIndex >= beats.length - 1) {
      window.removeEventListener('resize', onResize);
      onDone();
    } else {
      goToBeat(beatIndex + 1);
    }
  });

  goToBeat(0);
}
