import { vibrate } from '../engine/haptics';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import type { Lang } from '../i18n';

// A 4-row x 9-column letter grid, styled like the game's own tiles. Only 4
// of the 9 columns are draggable (vertically, one column at a time — same
// physics as square.ts's own column drag: magnetizeRawDist snap feel, and a
// pixel-based edgeFade wraparound ghost fill identical in spirit to the real
// board's). Each row belongs to one language and is *almost* fully spelled
// at rest; exactly one letter per row is missing, sitting one row away in
// its own draggable column. Dragging that column down by one step (wrapping
// row 3 back to row 0) delivers the missing letter into place and completes
// that row's spelling, entering that language. The four columns' rest
// states are chosen so each also happens to satisfy a *different* row at
// rest — dragging one column to solve its own language necessarily breaks
// whatever other row it was contributing to, which is intentional: only one
// language can be "solved" at a time.
type Cell = { kind: 'char'; text: string; lang: Lang } | { kind: 'filler'; colorIdx: number };

const LANG_COLOR: Record<Lang, string> = {
  en: '#2F9E52',
  fr: '#AD5C82',
  zhHant: '#4C68B0',
  zhHans: '#6B6560',
};
const FILLER_COLORS = [LANG_COLOR.en, LANG_COLOR.fr, LANG_COLOR.zhHant, LANG_COLOR.zhHans];

const ROWS = 4;
const COLS = 9;
const DRAG_COLS = [1, 2, 7, 8];
const ROW_LANG: Lang[] = ['zhHans', 'fr', 'en', 'zhHant'];
const ROW_WORD: string[][] = [
  ['简', '体', '中', '文'],
  ['F', 'R', 'A', 'N', 'Ç', 'A', 'I', 'S'],
  ['E', 'N', 'G', 'L', 'I', 'S', 'H'],
  ['繁', '體', '中', '文'],
];
const ROW_START = [5, 0, 2, 1];

function ch(text: string, lang: Lang): Cell {
  return { kind: 'char', text, lang };
}
function fillerAt(row: number, col: number): Cell {
  return { kind: 'filler', colorIdx: (row + col) % FILLER_COLORS.length };
}

function buildGrid(): Cell[][] {
  const f = fillerAt;
  return [
    [f(0, 0), f(0, 1), ch('A', 'fr'), f(0, 3), f(0, 4), ch('简', 'zhHans'), ch('体', 'zhHans'), ch('中', 'zhHans'), f(0, 8)],
    [ch('F', 'fr'), ch('R', 'fr'), f(1, 2), ch('N', 'fr'), ch('Ç', 'fr'), ch('A', 'fr'), ch('I', 'fr'), ch('S', 'fr'), f(1, 8)],
    [f(2, 0), ch('繁', 'zhHant'), ch('E', 'en'), ch('N', 'en'), ch('G', 'en'), ch('L', 'en'), ch('I', 'en'), f(2, 7), ch('H', 'en')],
    [f(3, 0), f(3, 1), ch('體', 'zhHant'), ch('中', 'zhHant'), ch('文', 'zhHant'), f(3, 5), f(3, 6), f(3, 7), ch('文', 'zhHans')],
  ];
}

export function renderLanguageSelect(container: HTMLElement, onSelect: (lang: Lang) => void) {
  container.innerHTML = `
    <div class="app lang-select-page">
      <h1 class="lang-title">Slides</h1>
      <p class="lang-instructions">拖动带箭头的列，拼出你的语言</p>
      <div class="lang-board" id="langBoard"></div>
    </div>
  `;
  const board = container.querySelector<HTMLElement>('#langBoard');
  if (!board) throw new Error('languageSelect: #langBoard not found');

  const grid = buildGrid();
  let settled = false;

  const colEls: HTMLElement[] = [];
  const cellEls: HTMLElement[][] = Array.from({ length: ROWS }, () => []);

  function paintCell(el: HTMLElement, cell: Cell) {
    if (cell.kind === 'filler') {
      el.style.background = FILLER_COLORS[cell.colorIdx];
      el.textContent = '';
    } else {
      el.style.background = LANG_COLOR[cell.lang];
      el.textContent = cell.text;
    }
  }

  for (let c = 0; c < COLS; c++) {
    const colEl = document.createElement('div');
    colEl.className = 'lang-col';
    const isDrag = DRAG_COLS.includes(c);

    const arrowSlot = document.createElement('div');
    arrowSlot.className = 'lang-col-arrow-slot';
    if (isDrag) {
      colEl.classList.add('lang-col--drag');
      arrowSlot.classList.add('lang-col-arrow');
      arrowSlot.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3v15M6 12l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    colEl.appendChild(arrowSlot);

    for (let r = 0; r < ROWS; r++) {
      const cellEl = document.createElement('div');
      cellEl.className = 'lang-cell';
      paintCell(cellEl, grid[r][c]);
      colEl.appendChild(cellEl);
      cellEls[r][c] = cellEl;
    }
    board.appendChild(colEl);
    colEls[c] = colEl;
  }

  // Same pixel-based edge fade square.ts's own column drag uses: a ghost
  // fully outside [low, high] is invisible, one just past the edge ramps in
  // over `range` instead of popping in at full ghost opacity.
  function edgeFade(y: number, low: number, high: number, range: number): number {
    const overshoot = y < low ? low - y : y > high ? y - high : 0;
    return Math.max(0, 1 - overshoot / range);
  }

  function stepFor(c: number): number {
    const first = cellEls[0][c].getBoundingClientRect();
    const second = cellEls[1][c].getBoundingClientRect();
    return second.top - first.top;
  }

  for (const c of DRAG_COLS) {
    const colEl = colEls[c];
    let dy = 0;

    function clearGhosts() {
      colEl.querySelectorAll('.lang-cell.ghost').forEach((g) => g.remove());
    }

    function renderDragPreview() {
      const step = stepFor(c);
      const cellH = cellEls[0][c].getBoundingClientRect().height;
      const span = step * ROWS;
      const magDy = magnetizeRawDist(dy / step) * step;

      for (let r = 0; r < ROWS; r++) cellEls[r][c].style.transform = `translateY(${magDy}px)`;

      clearGhosts();
      const fadeRange = step * 0.4;
      for (let k = -1; k <= 1; k++) {
        if (k === 0) continue;
        for (let r = 0; r < ROWS; r++) {
          const baseTop = r * step;
          const y = baseTop + magDy + k * span;
          const fade = edgeFade(y, -step, span - step, fadeRange);
          if (fade <= 0) continue;
          const ghost = document.createElement('div');
          ghost.className = 'lang-cell ghost';
          paintCell(ghost, grid[r][c]);
          ghost.style.position = 'absolute';
          ghost.style.left = '0';
          ghost.style.top = baseTop + 'px';
          ghost.style.width = '100%';
          ghost.style.height = cellH + 'px';
          ghost.style.transform = `translateY(${y - baseTop}px)`;
          ghost.style.opacity = String(0.55 * fade);
          ghost.style.pointerEvents = 'none';
          colEl.appendChild(ghost);
        }
      }
    }

    function applyShift() {
      const step = stepFor(c);
      const shift = Math.round(dy / step);
      clearGhosts();
      for (let r = 0; r < ROWS; r++) cellEls[r][c].style.transform = '';
      if (shift === 0) return;
      const n = ROWS;
      const colVals = grid.map((row) => row[c]);
      const shifted = colVals.map((_, i) => colVals[(((i - shift) % n) + n) % n]);
      for (let r = 0; r < ROWS; r++) {
        grid[r][c] = shifted[r];
        paintCell(cellEls[r][c], grid[r][c]);
      }
      vibrate(10);
      checkCompletion();
    }

    attachDrag(colEl, {
      isActive: () => !settled,
      onStart() {
        dy = 0;
        colEl.classList.add('lang-col--active');
      },
      onDrag(_dx, ddy) {
        dy = ddy;
        renderDragPreview();
      },
      onEnd(_dx, ddy) {
        dy = ddy;
        applyShift();
        colEl.classList.remove('lang-col--active');
      },
    });
  }

  function checkCompletion() {
    for (let r = 0; r < ROWS; r++) {
      const word = ROW_WORD[r];
      const start = ROW_START[r];
      let ok = true;
      for (let i = 0; i < word.length; i++) {
        const cell = grid[r][start + i];
        if (cell.kind !== 'char' || cell.text !== word[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      settled = true;
      vibrate(24);
      for (let i = 0; i < word.length; i++) cellEls[r][start + i].classList.add('lang-cell--solved');
      setTimeout(() => onSelect(ROW_LANG[r]), 420);
      return;
    }
  }
}
