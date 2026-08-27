import './circle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnOutlineEl, applyScoreAnimations } from '../engine/scoreOutline';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame, ShapeGameOpts } from './types';

// A hex-cropped version of the ball board (37 cells: rows of 4/5/6/7/6/5/4
// instead of the base game's 28-cell triangle) with a permanent blank ball
// pinned at the exact center. Internally every cell is addressed by cube
// coordinates (x,y,z with x+y+z=0, each in [-3,3] — the standard hex-grid
// lattice, see redblobgames' hex-grid guide for the general technique) and
// only converted to a local (row, col) pair for storage/rendering — this is
// the same "address the infinite lattice, then crop a window" strategy
// triangle.ts uses for its own hex board, just applied to circle-packed
// balls instead of alternating up/down triangles (so there's no orientation
// concern here at all: any window of the lattice is playable as-is).
const PALETTES = {
  standard: ['#3C4452', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#9B958D'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;
const N = 3; // hex radius: rows of 2N+1-|z| for z=-N..N -> 4/5/6/7/6/5/4 = 37 cells
const ROW_LENS = [4, 5, 6, 7, 6, 5, 4];
const PER_COLOR = 6;
const MIN_LINE_BONUS_LEN = 3;
const CENTER_CELL: Cell = [3, 3]; // row 3 (z=0), col 3 -> cube (0,0,0), the hex's true center

const GLYPH = `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="6.5" r="4.5" fill="#B23A3A"/><circle cx="25" cy="11" r="4.5" fill="#D89B1E"/><circle cx="25" cy="21" r="4.5" fill="#4C68B0"/><circle cx="16" cy="25.5" r="4.5" fill="#2F9E52"/><circle cx="7" cy="21" r="4.5" fill="#9B958D"/><circle cx="7" cy="11" r="4.5" fill="#3C4452"/></svg>`;

type Fam = 'X' | 'Y' | 'Z';
interface Line {
  fam: Fam;
  cells: Cell[];
}

function lowerBoundForZ(z: number): number {
  return Math.max(-N, -z - N);
}
function localToCube(r: number, c: number): { x: number; y: number; z: number } {
  const z = r - N;
  const x = lowerBoundForZ(z) + c;
  return { x, y: -x - z, z };
}
function cubeToLocal(x: number, z: number): Cell | null {
  const y = -x - z;
  if (Math.abs(x) > N || Math.abs(y) > N || Math.abs(z) > N) return null;
  const r = z + N;
  if (r < 0 || r >= ROW_LENS.length) return null;
  const c = x - lowerBoundForZ(z);
  if (c < 0 || c >= ROW_LENS[r]) return null;
  return [r, c];
}

function allLines(): Line[] {
  const lines: Line[] = [];
  for (let r = 0; r < ROW_LENS.length; r++) lines.push({ fam: 'Z', cells: Array.from({ length: ROW_LENS[r] }, (_, c) => [r, c] as Cell) });
  for (let x = -N; x <= N; x++) {
    const cells: Cell[] = [];
    for (let z = -N; z <= N; z++) {
      const cell = cubeToLocal(x, z);
      if (cell) cells.push(cell);
    }
    if (cells.length) lines.push({ fam: 'X', cells });
  }
  for (let y = -N; y <= N; y++) {
    const cells: Cell[] = [];
    for (let z = -N; z <= N; z++) {
      const cell = cubeToLocal(-y - z, z);
      if (cell) cells.push(cell);
    }
    if (cells.length) lines.push({ fam: 'Y', cells });
  }
  return lines;
}
const LINES = allLines();

function lineFor(fam: Fam, r: number, c: number): Line {
  const line = LINES.find((l) => l.fam === fam && l.cells.some(([rr, cc]) => rr === r && cc === c));
  if (!line) throw new Error('lineFor: cell not found in any line');
  return line;
}

// The board's two non-linear bonus shapes, same rhombus/diamond patterns the
// base ball board uses (see circle.ts) — expressed here as (Δz,Δx) offsets
// from a cube-space anchor so the row-trimmed hex crop doesn't distort them
// (unlike the base board, this one's rows don't all start at the same local
// column, so a plain local (r,c) offset would silently pick the wrong real
// cells once trimming kicks in).
const RHOMBUS_B_OFFSETS: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
const RHOMBUS_A_OFFSETS: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 2]];
const DIAMOND_121_OFFSETS: [number, number][] = [[0, 0], [1, 0], [1, 1], [2, 1]];

function clusterFromCube(x0: number, z0: number, offsets: [number, number][]): Cell[] | null {
  const cells: Cell[] = [];
  for (const [dz, dx] of offsets) {
    const cell = cubeToLocal(x0 + dx, z0 + dz);
    if (!cell) return null;
    cells.push(cell);
  }
  return cells;
}
function allClusters(): Cell[][] {
  const groups: Cell[][] = [];
  for (let z0 = -N - 2; z0 <= N + 2; z0++)
    for (let x0 = -N - 2; x0 <= N + 2; x0++) {
      const b = clusterFromCube(x0, z0, RHOMBUS_B_OFFSETS);
      if (b) groups.push(b);
      const a = clusterFromCube(x0, z0, RHOMBUS_A_OFFSETS);
      if (a) groups.push(a);
      const d = clusterFromCube(x0, z0, DIAMOND_121_OFFSETS);
      if (d) groups.push(d);
    }
  return groups;
}
const CLUSTERS = allClusters();

function famVector(fam: Fam, R: number, rowH: number): [number, number] {
  // Row family (Z fixed, x steps) is pure horizontal; the other two are the
  // hex lattice's other two axes, each at the same 2R step magnitude.
  if (fam === 'X') return [R, rowH];
  if (fam === 'Y') return [-R, rowH];
  return [2 * R, 0];
}
function scalarProjection(fam: Fam, dx: number, dy: number, R: number, rowH: number): number {
  const [ux, uy] = famVector(fam, R, rowH);
  return (dx * ux + dy * uy) / Math.hypot(ux, uy);
}
function projectedSteps(fam: Fam, dx: number, dy: number, R: number, rowH: number): number {
  const [ux, uy] = famVector(fam, R, rowH);
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
  R: number;
  rowH: number;
  lastShift: number;
}

export function createCircleHexGame(): ShapeGame {
  const bestKey = 'sugarcube_circle_hex_best';

  return {
    card: {
      id: 'circleHex',
      name: '六边圆球',
      desc: '37 格六边形 · 中心空白球',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const refs = buildShell(container, {
        title: 'Slides · 六边圆球',
        tagline: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平、左斜或右斜方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '沿任意一条水平、左斜或右斜方向的线拖动，一条线上连续 4 个同色（不分点/面）得 4 分；同色的"22"菱形或"121"菱形同样得 4 分。得分方块翻成点面。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得 36 分，该线的球随后变为空白球——保留在棋盘原位，可以继续正常参与拖动和补位，但不会再对任何得分产生贡献。棋盘正中心从一开始就是一颗空白球。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。全部方块都翻成点面或变为空白球时结束，结算当时的分数。',
        assumptions:
          '6 种口味色，每色 6 枚，共 36 枚，加正中心 1 颗永久空白球，共 37 格（六边形，七行 4/5/6/7/6/5/4 枚）；每种口味的点色分布为：其余 5 色中的每一色至少 1 枚，凑满 6 枚——保证没有正反面同色的球出现。三个滑动方向——水平、左斜、右斜——判分规则与基础圆球玩法完全一致。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = PALETTES[paletteName];
      let grid: Tile[][] = [];
      let R = 0,
        rowH = 0,
        boardLeft = 0,
        boardTop = 0;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      let bonusedSignatures = new Set<string>();
      const BLANK = -1;
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
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < PER_COLOR; i++) deck.push(c);
        return shuffle(deck);
      }

      // Per color group of 6: cycle through the other 5 colors (one gets a
      // 2nd copy to fill out the 6th slot) — this tile's own color never
      // appears as its dot color, unlike the base ball game's "1 self-pair"
      // distribution.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; others.length < PER_COLOR; k++) others.push((color + 1 + (k % (COLORS.length - 1))) % COLORS.length);
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
        for (let r = 0; r < ROW_LENS.length; r++) {
          const row: Tile[] = [];
          for (let c = 0; c < ROW_LENS[r]; c++) {
            if (r === CENTER_CELL[0] && c === CENTER_CELL[1]) {
              row.push(newTile(BLANK, BLANK));
            } else {
              row.push(newTile(deck[idx], dots[idx]));
              idx++;
            }
          }
          g.push(row);
        }
        return g;
      }

      function hasInitialClump(g: Tile[][]): boolean {
        for (const line of LINES) {
          const colors = line.cells.map(([r, c]) => g[r][c].color);
          for (let i = 0; i + 3 < colors.length; i++) {
            if (colors[i] !== BLANK && colors[i] === colors[i + 1] && colors[i] === colors[i + 2] && colors[i] === colors[i + 3])
              return true;
          }
        }
        for (const cells of CLUSTERS) {
          const c0 = g[cells[0][0]][cells[0][1]].color;
          if (c0 !== BLANK && cells.every(([r, c]) => g[r][c].color === c0)) return true;
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

      // Screen position from cube coords (x steps 2R horizontally per unit,
      // z steps R horizontally + rowH vertically per unit — see the module
      // comment for how this was derived and verified against the 3 unit
      // step directions) — already centered on (0,0) by the hex's own
      // symmetry, so boardLeft/boardTop alone place the origin.
      function layoutBoard() {
        const rect = refs.boardWrap.getBoundingClientRect();
        const S = Math.min(rect.width, rect.height);
        R = S / 14;
        rowH = R * Math.sqrt(3);
        boardLeft = S / 2;
        boardTop = S / 2;
        refs.boardEl.style.width = S + 'px';
        refs.boardEl.style.height = S + 'px';
      }

      function ballCenter(r: number, c: number): [number, number] {
        const { x, z } = localToCube(r, c);
        return [boardLeft + 2 * R * x + R * z, boardTop + rowH * z];
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
        if (isBlank(tile)) {
          el.style.background = 'var(--ink-faint)';
          el.style.opacity = '0.35';
        } else if (tile.face === 'dot') {
          el.style.background = 'transparent';
          const starSize = Math.round(size * 0.95);
          const color = COLORS[tile.dotColor];
          el.innerHTML =
            `<svg viewBox="0 0 24 24" width="${starSize}" height="${starSize}">` +
            `<g stroke="${color}" stroke-width="5.5" stroke-linecap="round">` +
            `<line x1="12" y1="2.5" x2="12" y2="21.5"/>` +
            `<line x1="4" y1="6.75" x2="20" y2="17.25"/>` +
            `<line x1="20" y1="6.75" x2="4" y2="17.25"/>` +
            `</g></svg>`;
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
        for (let r = 0; r < ROW_LENS.length; r++) {
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const key = cellKey(r, c);
            const el = makeBallEl(grid[r][c], r, c);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key));
            refs.boardEl.appendChild(el);
          }
        }
        flipInCells = new Set();
        const size = R * 1.86;
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) {
            const [cx, cy] = ballCenter(r, c);
            spawnOutlineEl(refs.boardEl, { left: cx - size / 2, top: cy - size / 2, width: size, height: size }, elapsedMs, 'circle');
          }
        }
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
        for (const cells of CLUSTERS) {
          if (anyBlank(cells)) continue;
          const c0 = effColor(grid[cells[0][0]][cells[0][1]]);
          if (!cells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
          if (mask && !cells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
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
            const ghost = makeBallEl(fakeTile, r, c);
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
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const [cx, cy] = ballCenter(r, c);
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
        const size = d.R * 1.86;
        const [dirX, dirY] = famVector(d.fam, d.R, d.rowH);
        const rawDist = magnetizeRawDist(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH));
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH));
        if (shift !== d.lastShift) {
          vibrate(6);
          d.lastShift = shift;
        }
        for (let i = 0; i < n; i++) {
          const [r, c] = cells[i];
          const [cx, cy] = ballCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + rawDist * dirX + 'px';
            el.style.top = cy - size / 2 + rawDist * dirY + 'px';
            el.style.opacity = String(edgeOpacity(i + rawDist, n));
          }
        }
        for (let k = -1; k <= 1; k++) {
          if (k === 0) continue;
          for (let i = 0; i < n; i++) {
            const pos = i + rawDist + k * n;
            const fade = edgeOpacity(pos, n);
            if (fade <= 0) continue;
            const [r0, c0] = cells[i];
            const [baseX, baseY] = ballCenter(r0, c0);
            const shiftedX = baseX + (pos - i) * dirX;
            const shiftedY = baseY + (pos - i) * dirY;
            const ghost = makeBallEl(grid[r0][c0], r0, c0, 0.55 * fade);
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
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH));
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
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0, R, rowH, lastShift: 0 };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const candidates = (['X', 'Y', 'Z'] as const).map((fam) => ({
              fam,
              line: lineFor(fam, drag!.r, drag!.c),
              proj: Math.abs(scalarProjection(fam, dx, dy, drag!.R, drag!.rowH)),
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
