import './circle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag } from '../engine/drag';
import type { CascadeConfig } from '../engine/scoring';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame } from './types';

const COLORS = ['#C0666B', '#DDA857', '#7A9C4A', '#4F72C4'];
const ROWS = 7; // row r (0..6) has r+1 balls, total 28
const PER_COLOR = 7;
const MIN_LINE_BONUS_LEN = 3;
const FLASH_MS = 550;

const GLYPH = `<svg viewBox="0 0 32 32"><circle cx="16" cy="7" r="6" fill="#C0666B"/><circle cx="8" cy="20" r="6" fill="#DDA857"/><circle cx="24" cy="20" r="6" fill="#4F72C4"/></svg>`;

type Fam = 'A' | 'B' | 'R';

interface Line {
  fam: Fam;
  cells: Cell[];
}

// family A ("right-slant", visually down-right): fixed d = r - c
// family B ("left-slant", visually down-left): fixed e = c
// family R ("row", horizontal): fixed r, c runs 0..r
function lineA(d: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = d; r < ROWS; r++) cells.push([r, r - d]);
  return cells;
}
function lineB(e: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = e; r < ROWS; r++) cells.push([r, e]);
  return cells;
}
function lineRow(r: number): Cell[] {
  const cells: Cell[] = [];
  for (let c = 0; c <= r; c++) cells.push([r, c]);
  return cells;
}
function allLines(): Line[] {
  const lines: Line[] = [];
  for (let d = 0; d < ROWS; d++) lines.push({ fam: 'A', cells: lineA(d) });
  for (let e = 0; e < ROWS; e++) lines.push({ fam: 'B', cells: lineB(e) });
  for (let r = 0; r < ROWS; r++) lines.push({ fam: 'R', cells: lineRow(r) });
  return lines;
}
const LINES = allLines();

// The three diagonal/row directions of this triangular ball packing are
// exactly 60° apart, and one index-step along any of them is the same
// physical distance (2R) — a row of balls has no up/down alternation to
// zigzag around, unlike the triangle board's row direction.
function famVector(fam: Fam, R: number, rowH: number): [number, number] {
  if (fam === 'A') return [R, rowH];
  if (fam === 'B') return [-R, rowH];
  return [2 * R, 0];
}

// How many pixels of the drag point along this family's direction — used
// only to pick the best-aligned family (compares fairly here because all
// three vectors share the same magnitude 2R).
function scalarProjection(fam: Fam, dx: number, dy: number, R: number, rowH: number): number {
  const [ux, uy] = famVector(fam, R, rowH);
  return (dx * ux + dy * uy) / Math.hypot(ux, uy);
}

// How many index-steps along this family's line the drag corresponds to:
// the orthogonal-projection coefficient rawDist such that rawDist*v best
// matches the raw drag vector, i.e. (drag·v)/|v|² — NOT (drag·v)/|v|, which
// would leave every step this line's own magnitude (2R) too large, making a
// drag as short as one cell-width already read as if the player had dragged
// the full line around several times.
function projectedSteps(fam: Fam, dx: number, dy: number, R: number, rowH: number): number {
  const [ux, uy] = famVector(fam, R, rowH);
  const proj = dx * ux + dy * uy;
  return proj / (ux * ux + uy * uy);
}

interface DragState {
  r: number;
  c: number;
  fam: Fam | null;
  cells: Cell[];
  dx: number;
  dy: number;
  R: number;
  rowH: number;
}

export function createCircleGame(): ShapeGame {
  const bestKey = 'sugarcube_circles_best';

  return {
    card: {
      id: 'circle',
      name: '圆球',
      desc: '沿斜线拖动 · 三角堆叠圆球',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack) {
      const refs = buildShell(container, {
        title: '方糖谜题 · 圆球',
        tagline: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平、左斜或右斜方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '沿任意一条水平、左斜或右斜方向的线拖动，一条线上连续 4 个同色（不分点/面）得 4 分，得分方块翻成点面。一整条线（长度 ≥3）凑齐同一种颜色额外得 6 分（不移出棋盘）。全部翻成点面时结束，结算当时的分数。',
        assumptions:
          '4 种口味色，每色 7 枚，共 28 枚；每种口味的点色分布为：其余 3 色各 2 枚、本色 1 枚。三角堆叠结构有水平、左斜、右斜三个滑动方向，判分规则完全一致；2×2 图案在此结构下没有直接对应，本版本暂不实现。',
      });

      let grid: Tile[][] = [];
      let R = 0,
        rowH = 0,
        boardTop = 0,
        boardLeft = 0;
      let nextTileId = 0;
      const flashStarts = new Map<number, number>();
      let bonusedSignatures = new Set<string>();

      function newTile(color: number, dotColor: number): Tile {
        return { id: nextTileId++, color, face: 'flavor', dotColor };
      }

      function shuffledDeck(): number[] {
        const deck: number[] = [];
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < PER_COLOR; i++) deck.push(c);
        return shuffle(deck);
      }

      // per color group of 7: the other 3 colors get 2 each (6) + the tile's
      // own color once (7) — matches the physical set's back-color
      // distribution.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; k < COLORS.length; k++) if (k !== color) others.push(k, k);
          others.push(color);
          shuffle(others);
          const indices: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) indices.push(idx);
          });
          indices.forEach((idx, i) => {
            dotColors[idx] = others[i];
          });
        }
        return dotColors;
      }

      function boardFromDeck(deck: number[]): Tile[][] {
        const dots = assignDotColors(deck);
        const g: Tile[][] = [];
        let idx = 0;
        for (let r = 0; r < ROWS; r++) {
          const row: Tile[] = [];
          for (let c = 0; c <= r; c++) {
            row.push(newTile(deck[idx], dots[idx]));
            idx++;
          }
          g.push(row);
        }
        return g;
      }

      function hasInitialClump(g: Tile[][]): boolean {
        for (const line of LINES) {
          const colors = line.cells.map(([r, c]) => g[r][c].color);
          for (let i = 0; i + 3 < colors.length; i++) {
            if (colors[i] === colors[i + 1] && colors[i] === colors[i + 2] && colors[i] === colors[i + 3])
              return true;
          }
        }
        return false;
      }

      function generateCleanBoard(): Tile[][] {
        let g: Tile[][];
        let tries = 0;
        do {
          g = boardFromDeck(shuffledDeck());
          tries++;
        } while (hasInitialClump(g) && tries < 500);
        return g;
      }

      function renderLegend() {
        refs.legendEl.innerHTML = COLORS.map((hex) => `<span class="swatch" style="background:${hex}"></span>`).join('');
      }

      function layoutBoard() {
        const rect = refs.boardWrap.getBoundingClientRect();
        const S = Math.min(rect.width, rect.height);
        R = S / 14;
        rowH = R * Math.sqrt(3);
        const totalH = (ROWS - 1) * rowH + 2 * R;
        boardTop = (S - totalH) / 2;
        boardLeft = S / 2; // center x, per-row offset applied in position calc
        refs.boardEl.style.width = S + 'px';
        refs.boardEl.style.height = S + 'px';
      }

      function ballCenter(r: number, c: number): [number, number] {
        const cx = boardLeft + (c - r / 2) * 2 * R;
        const cy = boardTop + R + r * rowH;
        return [cx, cy];
      }

      function makeBallEl(tile: Tile, r: number, c: number, opacity?: number): HTMLElement {
        const [cx, cy] = ballCenter(r, c);
        const size = R * 1.86;
        const el = document.createElement('div');
        el.className = 'ball';
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = cx - size / 2 + 'px';
        el.style.top = cy - size / 2 + 'px';
        if (tile.face === 'dot') {
          el.style.background = 'transparent';
          const dot = document.createElement('div');
          dot.className = 'dot-circle';
          const dsize = Math.round(size * 0.86);
          dot.style.width = dsize + 'px';
          dot.style.height = dsize + 'px';
          dot.style.background = COLORS[tile.dotColor];
          el.appendChild(dot);
        } else {
          el.style.background = COLORS[tile.color];
        }
        if (opacity !== undefined) el.style.opacity = String(opacity);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        return el;
      }

      function render() {
        layoutBoard();
        refs.boardEl.innerHTML = '';
        const now = Date.now();
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c <= r; c++) {
            const tile = grid[r][c];
            const el = makeBallEl(tile, r, c);
            const start = flashStarts.get(tile.id);
            if (start !== undefined) {
              const elapsed = now - start;
              if (elapsed < FLASH_MS) {
                el.classList.add('flash');
                el.style.animationDelay = -(elapsed / 1000) + 's';
              } else {
                flashStarts.delete(tile.id);
              }
            }
            refs.boardEl.appendChild(el);
          }
        }
      }

      // ---------- matching engine ----------
      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const windowCells = cells.slice(i, i + 4);
            const c0 = effColor(grid[windowCells[0][0]][windowCells[0][1]]);
            if (!windowCells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
            if (mask && !windowCells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
            matches.push({ cells: windowCells, points: 4 });
          }
        }
        return matches;
      }

      function findWholeLineBonuses(): Cell[][] {
        const found: Cell[][] = [];
        for (const line of LINES) {
          if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
          const c0 = effColor(grid[line.cells[0][0]][line.cells[0][1]]);
          if (!line.cells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
          const sig = line.cells
            .map(([r, c]) => grid[r][c].id)
            .sort((a, b) => a - b)
            .join(',');
          if (bonusedSignatures.has(sig)) continue;
          bonusedSignatures.add(sig);
          found.push(line.cells);
        }
        return found;
      }

      function applyLineBonus(groups: Cell[][]) {
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const t = grid[r][c];
            if (t.face === 'flavor') t.face = 'dot';
          }
        }
      }

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches: findRunMatches,
          findLineBonuses: findWholeLineBonuses,
          bonusPointsPerLine: 6,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
          continueAfterLineBonus: false,
        };
      }

      function isGameOver(): boolean {
        return grid.every((row) => row.every((t) => t.face === 'dot'));
      }

      function resetBoard() {
        grid = generateCleanBoard();
        bonusedSignatures = new Set();
        flashStarts.clear();
      }

      const controller = createGameController(refs, { bestKey, resetBoard, render, isGameOver, buildCascadeConfig });

      // ---------- drag interaction ----------
      let drag: DragState | null = null;

      function cellAt(x: number, y: number): Cell {
        let r = Math.round((y - boardTop - R) / rowH);
        r = Math.max(0, Math.min(ROWS - 1, r));
        let c = Math.round((x - boardLeft) / (2 * R) + r / 2);
        c = Math.max(0, Math.min(r, c));
        return [r, c];
      }

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam) return;
        const n = d.cells.length;
        const size = d.R * 1.86;
        const [dirX, dirY] = famVector(d.fam, d.R, d.rowH);
        const rawDist = projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH);

        for (let i = 0; i < n; i++) {
          const [r, c] = d.cells[i];
          const [cx, cy] = ballCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + rawDist * dirX + 'px';
            el.style.top = cy - size / 2 + rawDist * dirY + 'px';
          }
        }
        for (let k = -1; k <= 1; k++) {
          if (k === 0) continue;
          for (let i = 0; i < n; i++) {
            const pos = i + rawDist + k * n;
            if (pos < -1 || pos > n) continue;
            const [r0, c0] = d.cells[i];
            const [baseX, baseY] = ballCenter(r0, c0);
            const shiftedX = baseX + (pos - i) * dirX;
            const shiftedY = baseY + (pos - i) * dirY;
            const ghost = makeBallEl(grid[r0][c0], r0, c0, 0.42);
            ghost.style.left = shiftedX - size / 2 + 'px';
            ghost.style.top = shiftedY - size / 2 + 'px';
            ghost.classList.add('ghost');
            refs.boardEl.appendChild(ghost);
          }
        }
      }

      function applyDrag() {
        const d = drag;
        if (!d || !d.fam) return;
        const n = d.cells.length;
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH));
        if (((shift % n) + n) % n === 0) return;
        const vals = d.cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[(((i - shift) % n) + n) % n]);
        d.cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        const mask = new Set<string>(d.cells.map(([r, c]) => cellKey(r, c)));
        controller.resolveMove(mask);
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver,
        onStart(x, y) {
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, cells: [], dx: 0, dy: 0, R, rowH };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const projA = scalarProjection('A', dx, dy, drag.R, drag.rowH);
            const projB = scalarProjection('B', dx, dy, drag.R, drag.rowH);
            const projR = scalarProjection('R', dx, dy, drag.R, drag.rowH);
            let fam: Fam = 'A';
            let best = Math.abs(projA);
            if (Math.abs(projB) > best) { fam = 'B'; best = Math.abs(projB); }
            if (Math.abs(projR) > best) { fam = 'R'; best = Math.abs(projR); }
            drag.fam = fam;
            drag.cells = fam === 'A' ? lineA(drag.r - drag.c) : fam === 'B' ? lineB(drag.c) : lineRow(drag.r);
          }
          renderDragPreview();
        },
        onEnd(dx, dy) {
          if (drag && drag.fam) {
            drag.dx = dx;
            drag.dy = dy;
            applyDrag();
          }
          drag = null;
          render();
        },
      });

      const onResize = () => {
        if (!drag && controller.started) render();
      };
      window.addEventListener('resize', onResize);

      function destroy() {
        controller.destroy();
        detachDrag();
        window.removeEventListener('resize', onResize);
      }

      refs.buttons.back.addEventListener('click', () => {
        destroy();
        onBack();
      });

      renderLegend();

      return destroy;
    },
  };
}
