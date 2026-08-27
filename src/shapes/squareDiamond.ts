import './square.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, applyScoreAnimations } from '../engine/scoreOutline';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame, ShapeGameOpts } from './types';

// Same 6x6, 36-tile deck as the base square game (see square.ts for the
// palette/back-face rationale — reused verbatim here, including its "1
// self-pair" back-face rule, since the user only asked for a different
// *look and slide directions*, not a different color rule). What's
// different: the board is displayed rotated 45° into a diamond silhouette,
// and instead of sliding along the grid's own rows/columns, the player
// slides along the *screen*-horizontal diagonal (r+c fixed — the classic
// "checkerboard rotated 45°" family, with row lengths 1/2/3/4/5/6/5/4/3/2/1)
// or along the grid's original row/column (which, once the whole board is
// rotated, reads as one of the two screen-diagonal directions) — three
// families total, exactly the same "three sliding directions" shape every
// other board in this game already has, just realized with squares instead
// of triangles/circles. A cleared line is left permanently blank in place
// (like triangle/circle) rather than removed-and-collapsed (like the base
// square game) — with three overlapping families sharing cells, there's no
// sensible way to reflow a smaller board without corrupting the other two
// families' lines.
const PALETTES = {
  standard: ['#C46A4E', '#9C8A3D', '#4A9573', '#4C7EAD', '#8067A8', '#AD5C82'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;
const BOARD_DIM = 6;
const MIN_LINE_BONUS_LEN = 3;
const BLANK = -1;

const GLYPH = `<svg viewBox="0 0 32 32"><rect x="12" y="2" width="8" height="8" fill="#C46A4E" transform="rotate(45 16 6)"/><rect x="22" y="12" width="8" height="8" fill="#4A9573" transform="rotate(45 26 16)"/><rect x="12" y="22" width="8" height="8" fill="#4C7EAD" transform="rotate(45 16 26)"/><rect x="2" y="12" width="8" height="8" fill="#AD5C82" transform="rotate(45 6 16)"/></svg>`;

type Fam = 'ROW' | 'A' | 'B';
interface Line {
  fam: Fam;
  cells: Cell[];
}

function buildLines(): Line[] {
  const lines: Line[] = [];
  for (let d1 = 0; d1 <= 2 * (BOARD_DIM - 1); d1++) {
    const cells: Cell[] = [];
    for (let r = Math.max(0, d1 - (BOARD_DIM - 1)); r <= Math.min(BOARD_DIM - 1, d1); r++) cells.push([r, d1 - r]);
    lines.push({ fam: 'ROW', cells });
  }
  for (let r = 0; r < BOARD_DIM; r++) lines.push({ fam: 'A', cells: Array.from({ length: BOARD_DIM }, (_, c) => [r, c] as Cell) });
  for (let c = 0; c < BOARD_DIM; c++) lines.push({ fam: 'B', cells: Array.from({ length: BOARD_DIM }, (_, r) => [r, c] as Cell) });
  return lines;
}
const LINES = buildLines();

function lineFor(fam: Fam, r: number, c: number): Line {
  const line = LINES.find((l) => l.fam === fam && l.cells.some(([rr, cc]) => rr === r && cc === c));
  if (!line) throw new Error('lineFor: cell not found in any line');
  return line;
}

// One step along ROW (r+c fixed, r increasing) is screen-horizontal; one
// step along A (r fixed, c increasing) or B (c fixed, r increasing) is a
// screen-diagonal (see the module comment for the 45°-rotation derivation).
function famVector(fam: Fam, k: number): [number, number] {
  if (fam === 'ROW') return [-2 * k, 0];
  if (fam === 'A') return [k, k];
  return [-k, k];
}
function scalarProjection(fam: Fam, dx: number, dy: number, k: number): number {
  const [ux, uy] = famVector(fam, k);
  return (dx * ux + dy * uy) / Math.hypot(ux, uy);
}
function projectedSteps(fam: Fam, dx: number, dy: number, k: number): number {
  const [ux, uy] = famVector(fam, k);
  const proj = dx * ux + dy * uy;
  return proj / (ux * ux + uy * uy);
}

interface DragState {
  r: number;
  c: number;
  fam: Fam | null;
  line: Line | null;
  dx: number;
  dy: number;
  k: number;
  lastShift: number;
}

export function createSquareDiamondGame(): ShapeGame {
  const bestKey = 'sugarcube_square_diamond_best';

  return {
    card: {
      id: 'squareDiamond',
      name: '菱形方块',
      desc: '36 格菱形 · 斜向与水平滑动',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const refs = buildShell(container, {
        title: 'Slides · 菱形方块',
        tagline: '沿水平或两条斜线方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平或斜线方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '沿水平方向或两条斜线方向拖动整条线，一条线上连续 4 个同色（不分点/面）得 4 分；2×2 的同色小方块同样得 4 分。得分方块翻成点面。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得 36 分，该线随后变为空白——保留在棋盘原位，可以继续正常参与拖动和补位，但不会再对任何得分产生贡献。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。全部方块都翻成点面或变为空白时结束，结算当时的分数。',
        assumptions:
          '6 种颜色各 6 枚，共 36 枚（菱形棋盘，十一行 1/2/3/4/5/6/5/4/3/2/1 枚）；每种颜色的点色分布为：其余 5 色各 1 枚、本色 1 枚。三个滑动方向——水平、以及棋盘原本的两条斜线——判分规则完全一致。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = PALETTES[paletteName];
      let grid: Tile[][] = [];
      let k = 0,
        boardLeft = 0,
        boardTop = 0,
        cellSize = 0;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      let bonusedSignatures = new Set<string>();
      function isBlank(t: Tile): boolean {
        return t.color === BLANK;
      }
      function anyBlank(cells: Cell[]): boolean {
        return cells.some(([r, c]) => isBlank(grid[r][c]));
      }
      let flipInCells = new Set<string>();

      function newTile(color: number, dotColor: number): Tile {
        return { id: nextTileId++, color, face: 'flavor', dotColor };
      }

      function shuffledDeck(): number[] {
        const deck: number[] = [];
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < BOARD_DIM; i++) deck.push(c);
        return shuffle(deck);
      }

      // Same rule as the base square game: shuffle a full permutation of
      // all 6 colors (including this group's own) across its 6 tiles — 5
      // land on the other 5 colors one each, and exactly 1 keeps its own
      // color as the dot (a "self" tile).
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const assignments = shuffle([
            ...Array.from({ length: COLORS.length }, (_, k2) => k2).filter((k2) => k2 !== color),
            color,
          ]);
          const indices: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) indices.push(idx);
          });
          indices.forEach((idx, i) => {
            dotColors[idx] = assignments[i];
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
        for (const line of LINES) {
          const colors = line.cells.map(([r, c]) => g[r][c].color);
          for (let i = 0; i + 3 < colors.length; i++) {
            if (colors[i] === colors[i + 1] && colors[i] === colors[i + 2] && colors[i] === colors[i + 3]) return true;
          }
        }
        for (let r = 0; r < BOARD_DIM - 1; r++)
          for (let c = 0; c < BOARD_DIM - 1; c++) {
            const c0 = g[r][c].color;
            if (c0 === g[r][c + 1].color && c0 === g[r + 1][c].color && c0 === g[r + 1][c + 1].color) return true;
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

      // Screen position from a 45° rotation of the plain (r,c) grid — see
      // the module comment for the derivation (r+c fixed reads as pure
      // horizontal, r or c fixed reads as one of the two diagonals).
      function layoutBoard() {
        const rect = refs.boardWrap.getBoundingClientRect();
        const S = Math.min(rect.width, rect.height);
        cellSize = S / 8.2;
        k = cellSize / Math.SQRT2;
        boardLeft = S / 2;
        boardTop = S / 2;
        refs.boardEl.style.width = S + 'px';
        refs.boardEl.style.height = S + 'px';
      }

      function cellCenter(r: number, c: number): [number, number] {
        const mid = (BOARD_DIM - 1) / 2;
        return [boardLeft + (c - r) * k, boardTop + (c + r - 2 * mid) * k];
      }

      function makeTileEl(tile: Tile, r: number, c: number, opacity?: number): HTMLElement {
        const [cx, cy] = cellCenter(r, c);
        const size = cellSize * 0.92;
        const el = document.createElement('div');
        el.className = 'tile';
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = cx - size / 2 + 'px';
        el.style.top = cy - size / 2 + 'px';
        if (isBlank(tile)) {
          el.style.background = 'var(--ink-faint)';
          el.style.opacity = '0.35';
        } else if (tile.face === 'dot') {
          el.style.background = 'transparent';
          const dot = document.createElement('div');
          dot.className = 'dot-circle';
          const dsize = Math.round(size * 0.72);
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
        const outlineEntries = outlineTracker.current();
        const pulseMs = new Map<string, number>();
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) pulseMs.set(cellKey(r, c), elapsedMs);
        }
        for (let r = 0; r < BOARD_DIM; r++) {
          for (let c = 0; c < BOARD_DIM; c++) {
            const key = cellKey(r, c);
            const el = makeTileEl(grid[r][c], r, c);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key), true);
            refs.boardEl.appendChild(el);
          }
        }
        flipInCells = new Set();
      }

      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const windowCells = cells.slice(i, i + 4);
            if (anyBlank(windowCells)) continue;
            const c0 = effColor(grid[windowCells[0][0]][windowCells[0][1]]);
            if (!windowCells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
            if (mask && !windowCells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
            matches.push({ cells: windowCells, points: 4 });
          }
        }
        for (let r = 0; r < BOARD_DIM - 1; r++)
          for (let c = 0; c < BOARD_DIM - 1; c++) {
            const cells: Cell[] = [
              [r, c],
              [r, c + 1],
              [r + 1, c],
              [r + 1, c + 1],
            ];
            if (anyBlank(cells)) continue;
            const c0 = effColor(grid[r][c]);
            if (!cells.every(([rr, cc]) => effColor(grid[rr][cc]) === c0)) continue;
            if (mask && !cells.some(([rr, cc]) => mask.has(cellKey(rr, cc)))) continue;
            matches.push({ cells, points: 4 });
          }
        return matches;
      }

      function isFullDotMatch(cells: Cell[]): boolean {
        if (cells.some(([r, c]) => grid[r][c].face !== 'dot')) return false;
        const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
        return cells.every(([r, c]) => grid[r][c].dotColor === c0);
      }

      function findWholeLineBonuses(): Cell[][] {
        const found: Cell[][] = [];
        for (const line of LINES) {
          if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
          if (anyBlank(line.cells)) continue;
          if (!isFullDotMatch(line.cells)) continue;
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
            pendingBlankSnapshot.set(cellKey(r, c), t.dotColor);
            t.color = BLANK;
            t.dotColor = BLANK;
          }
        }
      }

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches: findRunMatches,
          findLineBonuses: findWholeLineBonuses,
          bonusPointsPerLine: 36,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
        };
      }

      function isGameOver(): boolean {
        return grid.every((row) => row.every((t) => isBlank(t) || t.face === 'dot'));
      }

      function countUnfinished(): number {
        let n = 0;
        for (const row of grid) for (const t of row) if (!isBlank(t) && t.face === 'flavor') n++;
        return n;
      }

      function resetBoard() {
        grid = generateCleanBoard();
        bonusedSignatures = new Set();
        outlineTracker.reset();
      }

      const controller = createGameController(refs, {
        bestKey: opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        timeLimitSec: opts?.timeLimitSec,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        countUnfinished,
        onCascadeStep: ({ matchGroups }) => outlineTracker.add(matchGroups),
        onCascadeStepRendered: ({ lineBonusGroups }) => {
          if (lineBonusGroups.length) {
            playBlankTransition(lineBonusGroups, pendingBlankSnapshot);
            pendingBlankSnapshot = new Map();
          }
        },
        onCommit: (matchGroups) => {
          for (const cells of matchGroups) for (const [r, c] of cells) flipInCells.add(cellKey(r, c));
        },
      });

      const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const REMOVE_FADE_MS = 700;
      let pendingBlankSnapshot = new Map<string, number>();

      function playBlankTransition(groups: Cell[][], snapshot: Map<string, number>) {
        if (reduceMotion()) return;
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const dotColor = snapshot.get(cellKey(r, c));
            if (dotColor === undefined) continue;
            const fakeTile: Tile = { id: -1, color: 0, face: 'dot', dotColor };
            const ghost = makeTileEl(fakeTile, r, c);
            ghost.classList.add('ghost');
            ghost.style.pointerEvents = 'none';
            ghost.style.opacity = '1';
            refs.boardEl.appendChild(ghost);
            ghost.style.transition = `opacity ${REMOVE_FADE_MS}ms ease`;
            requestAnimationFrame(() => { ghost.style.opacity = '0'; });
            setTimeout(() => ghost.remove(), REMOVE_FADE_MS + 40);
          }
        }
      }

      let drag: DragState | null = null;

      function cellAt(x: number, y: number): Cell {
        let best: Cell = [0, 0];
        let bestDist = Infinity;
        for (let r = 0; r < BOARD_DIM; r++)
          for (let c = 0; c < BOARD_DIM; c++) {
            const [cx, cy] = cellCenter(r, c);
            const dist = (cx - x) ** 2 + (cy - y) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              best = [r, c];
            }
          }
        return best;
      }

      const FADE_RANGE = 0.4;
      const edgeOpacity = (pos: number, n: number) => {
        const overshoot = pos < 0 ? -pos : pos > n - 1 ? pos - (n - 1) : 0;
        return Math.max(0, 1 - overshoot / FADE_RANGE);
      };

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam || !d.line) return;
        const cells = d.line.cells;
        const n = cells.length;
        const size = cellSize * 0.92;
        const [dirX, dirY] = famVector(d.fam, d.k);
        const rawDist = magnetizeRawDist(projectedSteps(d.fam, d.dx, d.dy, d.k));
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.k));
        if (shift !== d.lastShift) {
          vibrate(6);
          d.lastShift = shift;
        }
        for (let i = 0; i < n; i++) {
          const [r, c] = cells[i];
          const [cx, cy] = cellCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + rawDist * dirX + 'px';
            el.style.top = cy - size / 2 + rawDist * dirY + 'px';
            el.style.opacity = String(edgeOpacity(i + rawDist, n));
          }
        }
        for (let kk = -1; kk <= 1; kk++) {
          if (kk === 0) continue;
          for (let i = 0; i < n; i++) {
            const pos = i + rawDist + kk * n;
            const fade = edgeOpacity(pos, n);
            if (fade <= 0) continue;
            const [r0, c0] = cells[i];
            const [baseX, baseY] = cellCenter(r0, c0);
            const shiftedX = baseX + (pos - i) * dirX;
            const shiftedY = baseY + (pos - i) * dirY;
            const ghost = makeTileEl(grid[r0][c0], r0, c0, 0.55 * fade);
            ghost.style.left = shiftedX - size / 2 + 'px';
            ghost.style.top = shiftedY - size / 2 + 'px';
            ghost.classList.add('ghost');
            refs.boardEl.appendChild(ghost);
          }
        }
      }

      function applyDrag(): boolean {
        const d = drag;
        if (!d || !d.fam || !d.line) return false;
        const cells = d.line.cells;
        const n = cells.length;
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.k));
        if (((shift % n) + n) % n === 0) return false;
        const vals = cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[(((i - shift) % n) + n) % n]);
        cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        const mask = new Set<string>(cells.map(([r, c]) => cellKey(r, c)));
        controller.resolveMove(mask);
        return true;
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onRejected: () => vibrate(15),
        onStart(x, y) {
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0, k, lastShift: 0 };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const candidates = (['ROW', 'A', 'B'] as const).map((fam) => ({
              fam,
              line: lineFor(fam, drag!.r, drag!.c),
              proj: Math.abs(scalarProjection(fam, dx, dy, drag!.k)),
            }));
            candidates.sort((a, b) => b.proj - a.proj);
            drag.fam = candidates[0].fam;
            drag.line = candidates[0].line;
          }
          renderDragPreview();
        },
        onEnd(dx, dy) {
          let moved = false;
          if (drag && drag.fam) {
            drag.dx = dx;
            drag.dy = dy;
            moved = applyDrag();
          }
          drag = null;
          if (!moved) render();
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
      refs.buttons.endBack.addEventListener('click', () => {
        destroy();
        onBack();
      });

      refs.buttons.extra['paletteBtn'].addEventListener('click', (e) => {
        paletteName = paletteName === 'standard' ? 'colorblind' : 'standard';
        COLORS = PALETTES[paletteName];
        (e.currentTarget as HTMLElement).classList.toggle('active', paletteName === 'colorblind');
        renderLegend();
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
