import './square.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag } from '../engine/drag';
import type { CascadeConfig } from '../engine/scoring';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame } from './types';

// Two selectable palettes, both with 6 hues spaced at least ~50-60° apart on
// the hue wheel so no two colors (or a tile's front vs. its own dot) can be
// mistaken for each other at a glance.
//
// "standard": muted / higher-grayscale for a calmer, less neon candy look —
// optimized for normal color vision only.
//
// "colorblind": the Okabe–Ito qualitative palette, a published, widely-used
// reference set (e.g. Nature/Science figure guidelines) empirically checked
// to stay distinguishable under protanopia, deuteranopia and tritanopia. Left
// at its original saturation on purpose — desaturating it would shrink the
// margin that makes it CVD-safe.
const PALETTES = {
  standard: ['#C46A4E', '#9C8A3D', '#4A9573', '#4C7EAD', '#8067A8', '#AD5C82'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;

const BOARD_DIM = 6;
const LINE_BONUS = 6;
const FLASH_MS = 550;

const GLYPH = `<svg viewBox="0 0 32 32"><rect x="2" y="2" width="12" height="12" rx="3" fill="#C46A4E"/><rect x="18" y="2" width="12" height="12" rx="3" fill="#4A9573"/><rect x="2" y="18" width="12" height="12" rx="3" fill="#4C7EAD"/><rect x="18" y="18" width="12" height="12" rx="3" fill="#AD5C82"/></svg>`;

interface DragState {
  r: number;
  c: number;
  axis: 'row' | 'col' | null;
  dx: number;
  dy: number;
  cell: number;
}

export function createSquareGame(): ShapeGame {
  const bestKey = 'sugarcube_best';

  return {
    card: {
      id: 'square',
      name: '方块',
      desc: '拖动整行/整列 · 6×6 棋盘',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack) {
      const refs = buildShell(container, {
        title: '方糖谜题',
        tagline: '拖动一整行或一整列 · 拼出同色图案 · 翻成点面继续联通',
        startBody: '拖动整行/整列拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '只有 2×2 或一整条 1×4 / 4×1 的同色图案才能得分（4分），得分方块翻成点面继续联通。整行或整列凑齐同一种颜色（不分点/面）额外得 6 分，该行/列随后移出棋盘。连续多步得分会自动叠加倍率：连续 2 步 ×2，连续 3 步 ×3，以此类推，中断则重新计数。当棋盘上所有方块都翻成点面时，挑战结束，结算当时的分数。',
        assumptions:
          '默认为降饱和的柔和配色；点击"色盲友好配色"可切换为 Okabe–Ito 标准色盲友好色系。6 种颜色各 6 枚，共 36 枚，翻面点色保证与本身正面色不同。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = PALETTES[paletteName];

      let rows = BOARD_DIM;
      let cols = BOARD_DIM;
      let grid: Tile[][] = [];
      let CELL = 0;
      let nextTileId = 0;
      const flashStarts = new Map<number, number>();
      // Stashed by findLineBonusGroups() for applyLineBonus() to consume in
      // the same cascade pass — see the comment on applyLineBonus below.
      let pendingRowClears: number[] = [];
      let pendingColClears: number[] = [];

      function newTile(color: number, dotColor: number): Tile {
        return { id: nextTileId++, color, face: 'flavor', dotColor };
      }

      function shuffledDeck(): number[] {
        // exactly 6 tiles of each of the 6 colors = 36, matching the physical set
        const deck: number[] = [];
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < BOARD_DIM; i++) deck.push(c);
        return shuffle(deck);
      }

      // Pre-assigns each tile's future dot color at generation time (like a
      // real printed card). For every front color there are exactly 6 tiles
      // but only 5 other colors to draw from, so within a color group we
      // hand out a shuffled permutation of those 5 to the first 5 tiles (all
      // different from each other and from their own front) and only the
      // unavoidable 6th tile has to reuse one of the 5 — with only 5 valid
      // choices for 6 tiles this one repeat is a pigeonhole-principle floor,
      // not a bug.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const others = shuffle(
            Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== color),
          );
          const indices: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) indices.push(idx);
          });
          indices.forEach((idx, i) => {
            dotColors[idx] = others[i % others.length];
          });
        }
        return dotColors;
      }

      function boardFromDeck(deck: number[]): Tile[][] {
        const dots = assignDotColors(deck);
        const g: Tile[][] = [];
        for (let r = 0; r < BOARD_DIM; r++) {
          const row: Tile[] = [];
          for (let c = 0; c < BOARD_DIM; c++) {
            const idx = r * BOARD_DIM + c;
            row.push(newTile(deck[idx], dots[idx]));
          }
          g.push(row);
        }
        return g;
      }

      function hasInitialClump(g: Tile[][]): boolean {
        const R = g.length,
          C = g[0].length;
        const col = (r: number, c: number) => g[r][c].color;
        for (let r = 0; r < R; r++)
          for (let c = 0; c < C; c++) {
            if (c <= C - 3 && col(r, c) === col(r, c + 1) && col(r, c) === col(r, c + 2)) return true;
            if (r <= R - 3 && col(r, c) === col(r + 1, c) && col(r, c) === col(r + 2, c)) return true;
            if (
              r <= R - 2 &&
              c <= C - 2 &&
              col(r, c) === col(r, c + 1) &&
              col(r, c) === col(r + 1, c) &&
              col(r, c) === col(r + 1, c + 1)
            )
              return true;
            if (r <= R - 3 && c <= C - 3 && col(r, c) === col(r + 1, c + 1) && col(r, c) === col(r + 2, c + 2))
              return true;
            if (r <= R - 3 && c >= 2 && col(r, c) === col(r + 1, c - 1) && col(r, c) === col(r + 2, c - 2))
              return true;
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

      function computeCell(): number {
        const rect = refs.boardWrap.getBoundingClientRect();
        const avail = Math.min(rect.width, rect.height);
        return Math.floor(Math.min(avail / cols, avail / rows));
      }

      function layoutBoard() {
        CELL = computeCell();
        refs.boardEl.style.width = CELL * cols + 'px';
        refs.boardEl.style.height = CELL * rows + 'px';
      }

      function makeTileEl(tile: Tile, r: number, c: number, cell: number, opacity?: number): HTMLElement {
        const el = document.createElement('div');
        el.className = 'tile';
        const size = cell - 4;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = c * cell + 2 + 'px';
        el.style.top = r * cell + 2 + 'px';
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
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const tile = grid[r][c];
            const el = makeTileEl(tile, r, c, CELL);
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
      function cellsSameColor(cells: Cell[]): boolean {
        const c0 = effColor(grid[cells[0][0]][cells[0][1]]);
        return cells.every(([r, c]) => effColor(grid[r][c]) === c0);
      }
      function touches(cells: Cell[], mask: Set<string> | null): boolean {
        if (!mask) return true;
        return cells.some(([r, c]) => mask.has(cellKey(r, c)));
      }

      function findMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (let r = 0; r < rows - 1; r++)
          for (let c = 0; c < cols - 1; c++) {
            const cells: Cell[] = [
              [r, c],
              [r, c + 1],
              [r + 1, c],
              [r + 1, c + 1],
            ];
            if (cellsSameColor(cells) && touches(cells, mask)) matches.push({ cells, points: 4 });
          }
        for (let r = 0; r < rows; r++)
          for (let c = 0; c <= cols - 4; c++) {
            const cells: Cell[] = [
              [r, c],
              [r, c + 1],
              [r, c + 2],
              [r, c + 3],
            ];
            if (cellsSameColor(cells) && touches(cells, mask)) matches.push({ cells, points: 4 });
          }
        for (let c = 0; c < cols; c++)
          for (let r = 0; r <= rows - 4; r++) {
            const cells: Cell[] = [
              [r, c],
              [r + 1, c],
              [r + 2, c],
              [r + 3, c],
            ];
            if (cellsSameColor(cells) && touches(cells, mask)) matches.push({ cells, points: 4 });
          }
        return matches;
      }

      function findLineBonusGroups(): Cell[][] {
        const rowClears: number[] = [];
        for (let r = 0; r < rows; r++) {
          const c0 = effColor(grid[r][0]);
          if (grid[r].every((t) => effColor(t) === c0)) rowClears.push(r);
        }
        const colClears: number[] = [];
        for (let c = 0; c < cols; c++) {
          const c0 = effColor(grid[0][c]);
          let full = true;
          for (let r = 0; r < rows; r++)
            if (effColor(grid[r][c]) !== c0) {
              full = false;
              break;
            }
          if (full) colClears.push(c);
        }
        pendingRowClears = rowClears;
        pendingColClears = colClears;
        const groups: Cell[][] = [];
        for (const r of rowClears) groups.push(Array.from({ length: cols }, (_, c) => [r, c] as Cell));
        for (const c of colClears) groups.push(Array.from({ length: rows }, (_, r) => [r, c] as Cell));
        return groups;
      }

      function removeLines(rowClears: number[], colClears: number[]) {
        if (rowClears.length) {
          const keep = new Set(Array.from({ length: rows }, (_, i) => i));
          rowClears.forEach((r) => keep.delete(r));
          grid = Array.from(keep)
            .sort((a, b) => a - b)
            .map((r) => grid[r]);
          rows = grid.length;
        }
        if (colClears.length && rows > 0) {
          const keep = new Set(Array.from({ length: cols }, (_, i) => i));
          colClears.forEach((c) => keep.delete(c));
          grid = grid.map((row) =>
            Array.from(keep)
              .sort((a, b) => a - b)
              .map((c) => row[c]),
          );
          cols = grid[0] ? grid[0].length : 0;
        }
      }

      // findLineBonusGroups() and applyLineBonus() are always called back to
      // back within the same cascade pass (see resolveCascade), so stashing
      // the raw row/col indices here — rather than re-deriving them from the
      // Cell[][] groups — lets the flip-then-batch-remove happen against the
      // one consistent pre-removal grid, exactly like the original single-
      // shape prototype.
      function applyLineBonus(_groups: Cell[][]) {
        const rowClears = pendingRowClears;
        const colClears = pendingColClears;
        rowClears.forEach((r) => grid[r].forEach((t) => { if (t.face === 'flavor') t.face = 'dot'; }));
        colClears.forEach((c) => {
          for (let r = 0; r < rows; r++) {
            const t = grid[r][c];
            if (t.face === 'flavor') t.face = 'dot';
          }
        });
        removeLines(rowClears, colClears);
      }

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches,
          findLineBonuses: findLineBonusGroups,
          bonusPointsPerLine: LINE_BONUS,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: true,
          continueAfterLineBonus: true,
          isTerminalAfterLineBonus: () => rows === 0 || cols === 0,
        };
      }

      function isGameOver(): boolean {
        const allDot = grid.length > 0 && grid.every((row) => row.every((t) => t.face === 'dot'));
        return allDot || rows === 0 || cols === 0;
      }

      function resetBoard() {
        rows = BOARD_DIM;
        cols = BOARD_DIM;
        grid = generateCleanBoard();
        flashStarts.clear();
      }

      const controller = createGameController(refs, { bestKey, resetBoard, render, isGameOver, buildCascadeConfig });

      // ---------- drag interaction ----------
      let drag: DragState | null = null;

      function renderDragPreview() {
        render();
        if (!drag || !drag.axis) return;
        const cell = drag.cell;
        if (drag.axis === 'row') {
          const r = drag.r;
          const span = cols * cell;
          for (let c = 0; c < cols; c++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) el.style.left = c * cell + drag.dx + 'px';
          }
          for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            for (let c = 0; c < cols; c++) {
              const x = c * cell + drag.dx + k * span;
              if (x < -cell || x > span) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.42);
              ghost.classList.add('ghost');
              ghost.style.left = x + 'px';
              refs.boardEl.appendChild(ghost);
            }
          }
        } else {
          const c = drag.c;
          const span = rows * cell;
          for (let r = 0; r < rows; r++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) el.style.top = r * cell + drag.dy + 'px';
          }
          for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            for (let r = 0; r < rows; r++) {
              const y = r * cell + drag.dy + k * span;
              if (y < -cell || y > span) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.42);
              ghost.classList.add('ghost');
              ghost.style.top = y + 'px';
              refs.boardEl.appendChild(ghost);
            }
          }
        }
      }

      function applyDrag() {
        if (!drag || !drag.axis) return;
        if (drag.axis === 'row') {
          const shift = Math.round(drag.dx / drag.cell);
          if (shift === 0) return;
          const r = drag.r,
            n = cols;
          grid[r] = grid[r].map((_, i) => grid[r][(((i - shift) % n) + n) % n]);
          const mask = new Set<string>();
          for (let c = 0; c < cols; c++) mask.add(cellKey(r, c));
          controller.resolveMove(mask);
        } else {
          const shift = Math.round(drag.dy / drag.cell);
          if (shift === 0) return;
          const c = drag.c,
            n = rows;
          const colVals = grid.map((row) => row[c]);
          const shifted = colVals.map((_, i) => colVals[(((i - shift) % n) + n) % n]);
          for (let r = 0; r < rows; r++) grid[r][c] = shifted[r];
          const mask = new Set<string>();
          for (let r = 0; r < rows; r++) mask.add(cellKey(r, c));
          controller.resolveMove(mask);
        }
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver,
        onStart(x, y) {
          const c = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
          const r = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
          drag = { r, c, axis: null, dx: 0, dy: 0, cell: CELL };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.axis) drag.axis = Math.abs(dx) > Math.abs(dy) ? 'row' : 'col';
          renderDragPreview();
        },
        onEnd(dx, dy) {
          if (drag) {
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

      refs.buttons.extra['paletteBtn'].addEventListener('click', (e) => {
        paletteName = paletteName === 'standard' ? 'colorblind' : 'standard';
        COLORS = PALETTES[paletteName];
        (e.currentTarget as HTMLElement).classList.toggle('active', paletteName === 'colorblind');
        renderLegend();
        if (controller.started) render();
      });

      function destroy() {
        controller.destroy();
        detachDrag();
        window.removeEventListener('resize', onResize);
      }

      refs.buttons.back.addEventListener('click', () => {
        destroy();
        onBack();
      });

      // the board stays empty until Start is pressed — nothing is generated
      // or shown ahead of time — but the legend can render immediately.
      renderLegend();

      return destroy;
    },
  };
}
