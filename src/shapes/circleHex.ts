import './circle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnOutlineEl, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { extendRunInLine, growParallelogram } from '../engine/matchGrowth';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintRow, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import { BOMB_RED_HEX, BOMB_HAZARD_PENALTY } from '../engine/bomb';
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

// Bomb mode drops two of the base six colors and appends red as a fixed
// hazard color — see RED_IDX below.
const BOMB_PALETTES = {
  standard: [...PALETTES.standard.slice(0, 4), BOMB_RED_HEX],
  colorblind: [...PALETTES.colorblind.slice(0, 4), BOMB_RED_HEX],
} as const;
const BOMB_NORMAL_COLORS = 4;
const RED_IDX = BOMB_NORMAL_COLORS;
// Same 6-per-color count as the base game; the rest of the 36 non-center
// cells (36 - 4*6 = 12) is filled with red hazard balls.
const BOMB_GROUP_SIZE = 6;

const GLYPH = `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="6.5" r="4.5" fill="#B23A3A"/><circle cx="25" cy="11" r="4.5" fill="#D89B1E"/><circle cx="25" cy="21" r="4.5" fill="#4C68B0"/><circle cx="16" cy="25.5" r="4.5" fill="#2F9E52"/><circle cx="7" cy="21" r="4.5" fill="#9B958D"/><circle cx="7" cy="11" r="4.5" fill="#3C4452"/></svg>`;

// The board's 3 seed patterns (see findRunMatches/CLUSTERS below), drawn
// with the same cube-coordinate transform snapshotBoard() uses, as blank
// outlines for the in-HUD pattern hint. Offsets are the same (dz,dx) pairs
// as RHOMBUS_B_OFFSETS/RHOMBUS_A_OFFSETS/DIAMOND_121_OFFSETS above.
function iconPos(dz: number, dx: number): [number, number] {
  return [2 * dx + dz, dz * Math.sqrt(3)];
}
const PATTERNS: PatternDef[] = [
  {
    label: '1×4',
    cells: [0, 1, 2, 3].map((dx) => {
      const [cx, cy] = iconPos(0, dx);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
  {
    label: '2+2',
    cells: ([[0, 0], [0, 1], [1, 0], [1, 1]] as const).map(([dz, dx]) => {
      const [cx, cy] = iconPos(dz, dx);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
  {
    label: '1-2-1',
    cells: ([[0, 0], [1, 0], [1, 1], [2, 1]] as const).map(([dz, dx]) => {
      const [cx, cy] = iconPos(dz, dx);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
];

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
      const isBomb = !!opts?.bomb;
      const BASE_HINT =
        '沿任意一条水平、左斜或右斜方向的线拖动，一条线上连续 4 个同色（不分点/面）得 4 分，同一条线上连得更长则按实际数量得分，但线外的同色方块不会被计入；同色的"22"菱形沿同一菱形方向扩大同样按扩大后的数量得分，"121"菱形固定得 4 分。得分方块翻成点面。同一局中，与刚得分的同一局部图案完全相同（同样的位置与颜色）不会连续再次得分。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得该线长度的平方分，该线的球随后变为空白球——保留在棋盘原位，可以继续正常参与拖动和补位，但不会再对任何得分产生贡献。棋盘正中心从一开始就是一颗空白球。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。';
      const hint = isBomb
        ? '红色为危险色：中央带白色"!"标记，永不翻面，不参与配对计分——只是需要避开聚集的障碍球。任意时刻场上 4 个及以上红色球相互边相连，将立即结束挑战并扣 100 分。' +
          BASE_HINT +
          '全部非红色方块都翻成点面或变为空白球时结束，结算当时的分数。'
        : BASE_HINT + '全部方块都翻成点面或变为空白球时结束，结算当时的分数。';
      const assumptions = isBomb
        ? '红色固定为同一种危险色，不随色盲友好配色切换。其余 4 种颜色各 6 枚，点色分布为：其余 3 色中的每一色至少 1 枚，凑满 6 枚（保证没有正反面同色的球出现）；另有 12 枚红色球，永不显示点色；正中心 1 颗永久空白球保持不变。三个滑动方向——水平、左斜、右斜——判分规则完全一致。'
        : '6 种口味色，每色 6 枚，共 36 枚，加正中心 1 颗永久空白球，共 37 格（六边形，七行 4/5/6/7/6/5/4 枚）；每种口味的点色分布为：其余 5 色中的每一色至少 1 枚，凑满 6 枚——保证没有正反面同色的球出现。三个滑动方向——水平、左斜、右斜——判分规则与基础圆球玩法完全一致。';
      const refs = buildShell(container, {
        title: 'Slides · 六边圆球',
        tagline: isBomb
          ? '沿水平、左斜或右斜方向拖动整条线 · 避免红色球 4 连'
          : '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平、左斜或右斜方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint,
        assumptions,
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
        patternHint: renderPatternHintRow(PATTERNS),
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = isBomb ? BOMB_PALETTES[paletteName] : PALETTES[paletteName];
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
      let stuckKeys: Set<string> | null = null;

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

      // ---------- bomb mode: red hazard tiles ----------
      function shuffledBombDeck(): number[] {
        const deck: number[] = [];
        for (let c = 0; c < BOMB_NORMAL_COLORS; c++) for (let i = 0; i < BOMB_GROUP_SIZE; i++) deck.push(c);
        const totalCells = ROW_LENS.reduce((a, b) => a + b, 0);
        const redCount = totalCells - 1 - deck.length; // -1 for the permanent center blank
        for (let i = 0; i < redCount; i++) deck.push(RED_IDX);
        return shuffle(deck);
      }

      // Same "cycle through the other normal colors, never self" rule as the
      // base game's own assignDotColors — just parameterized down to
      // BOMB_NORMAL_COLORS: cycling 4-1=3 other colors to fill 6 slots gives
      // each of them exactly 2 (no remainder, unlike the base game's 5-way
      // cycle into 6 slots which needs one color to repeat a 6th time).
      function assignBombDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length).fill(RED_IDX);
        for (let color = 0; color < BOMB_NORMAL_COLORS; color++) {
          const others: number[] = [];
          for (let k = 0; others.length < BOMB_GROUP_SIZE; k++) {
            others.push((color + 1 + (k % (BOMB_NORMAL_COLORS - 1))) % BOMB_NORMAL_COLORS);
          }
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

      function boardFromBombDeck(deck: number[]): Tile[][] {
        const dots = assignBombDotColors(deck);
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

      // The hex lattice's 6 unit directions in (Δx,Δz) cube-coordinate form
      // (Δy is implied) — the real edge-adjacency of this ball packing.
      const HEX_DELTAS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      function hexNeighbors(r: number, c: number): Cell[] {
        const { x, z } = localToCube(r, c);
        const out: Cell[] = [];
        for (const [dx, dz] of HEX_DELTAS) {
          const cell = cubeToLocal(x + dx, z + dz);
          if (cell) out.push(cell);
        }
        return out;
      }

      function hasRedCluster(g: Tile[][]): boolean {
        const seen = new Set<string>();
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            if (g[r][c].color !== RED_IDX) continue;
            const startKey = cellKey(r, c);
            if (seen.has(startKey)) continue;
            let size = 0;
            const stack: Cell[] = [[r, c]];
            seen.add(startKey);
            while (stack.length) {
              const [cr, cc] = stack.pop()!;
              size++;
              for (const [nr, nc] of hexNeighbors(cr, cc)) {
                const key = cellKey(nr, nc);
                if (seen.has(key) || g[nr][nc].color !== RED_IDX) continue;
                seen.add(key);
                stack.push([nr, nc]);
              }
            }
            if (size >= 4) return true;
          }
        return false;
      }

      function generateCleanBombBoard(): Tile[][] {
        let g: Tile[][];
        let tries = 0;
        do {
          g = boardFromBombDeck(shuffledBombDeck());
          tries++;
        } while ((hasInitialClump(g) || hasRedCluster(g)) && tries < 500);
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
          // A hollow ring, not a filled disc: the standard "标准" palette's
          // own muted gray/brown flavor color (#9B958D) sits too close to a
          // faint gray fill to read as reliably different at a glance — no
          // solid fill at all, in any palette, reads unambiguously as "an
          // empty slot" rather than "a dim colored ball".
          el.style.background = 'transparent';
          el.style.boxShadow = 'inset 0 0 0 3px var(--ink-faint)';
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
          if (isBomb && tile.color === RED_IDX) {
            const mark = document.createElement('div');
            mark.className = 'hazard-mark';
            mark.textContent = '!';
            mark.style.fontSize = Math.round(size * 0.5) + 'px';
            el.appendChild(mark);
          }
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
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
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

      // A match only ever grows along its *own* seed shape's regular
      // directions (see matchGrowth.ts) — never a generic same-color flood
      // fill. A run-4 only extends further along that same line; a 22
      // rhombus only extends by a full extra row/column of its own
      // parallelogram (expressed in cube-offset space, same as
      // RHOMBUS_B_OFFSETS/RHOMBUS_A_OFFSETS above, since this hex crop's
      // row-trimming makes a flat (r, c) step vector wrong); a 121 diamond
      // doesn't extend at all — it always scores exactly its own 4 cells.
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }
      function isLiveCell(r: number, c: number): boolean {
        return !isBlank(grid[r][c]);
      }
      function qualifies(seed: Cell[], mask: Set<string> | null): boolean {
        if (anyBlank(seed)) return false;
        const c0 = effColor(grid[seed[0][0]][seed[0][1]]);
        // Red hazard tiles are obstacles, not a matchable color.
        if (isBomb && c0 === RED_IDX) return false;
        if (!seed.every(([r, c]) => effColor(grid[r][c]) === c0)) return false;
        if (mask && !seed.some(([r, c]) => mask.has(cellKey(r, c)))) return false;
        return true;
      }

      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const seed = cells.slice(i, i + 4);
            if (!qualifies(seed, mask)) continue;
            const region = extendRunInLine(cells, i, i + 3, effColorAt, isLiveCell);
            matches.push({ cells: region, points: Math.max(4, region.length) });
          }
        }
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const { x: x0, z: z0 } = localToCube(r, c);
            const b = clusterFromCube(x0, z0, RHOMBUS_B_OFFSETS);
            if (b && qualifies(b, mask)) {
              // RHOMBUS_B_OFFSETS's (dz, dx) pairs are u*(dz=0,dx=1) + v*(dz=1,dx=0).
              const positionAt = (u: number, v: number): Cell | null => cubeToLocal(x0 + u, z0 + v);
              const region = growParallelogram(positionAt, effColorAt, isLiveCell);
              matches.push({ cells: region, points: Math.max(4, region.length) });
            }
            const a = clusterFromCube(x0, z0, RHOMBUS_A_OFFSETS);
            if (a && qualifies(a, mask)) {
              // RHOMBUS_A_OFFSETS's (dz, dx) pairs are u*(dz=0,dx=1) + v*(dz=1,dx=1).
              const positionAt = (u: number, v: number): Cell | null => cubeToLocal(x0 + u + v, z0 + v);
              const region = growParallelogram(positionAt, effColorAt, isLiveCell);
              matches.push({ cells: region, points: Math.max(4, region.length) });
            }
            const d = clusterFromCube(x0, z0, DIAMOND_121_OFFSETS);
            if (d && qualifies(d, mask)) {
              matches.push({ cells: d, points: 4 });
            }
          }
        return matches;
      }

      function isCenter(r: number, c: number): boolean {
        return r === CENTER_CELL[0] && c === CENTER_CELL[1];
      }

      function isFullDotMatch(cells: Cell[]): boolean {
        if (cells.some(([r, c]) => grid[r][c].face !== 'dot')) return false;
        const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
        return cells.every(([r, c]) => grid[r][c].dotColor === c0);
      }

      // The permanent center hole sits on exactly one line per family (the
      // row/axis that passes through the board's true center) — it never
      // holds a tile, so it must not count as "still needs a color to
      // agree with the rest of the line" the way an ordinary blank left
      // over from an earlier bonus does. Excluding it by its fixed
      // coordinates (not via isBlank, which can't tell the permanent hole
      // apart from a spent bonus cell — both just read color === BLANK)
      // lets those 3 lines bonus on their remaining real cells instead of
      // being permanently unscoreable.
      function findWholeLineBonuses(): Cell[][] {
        const found: Cell[][] = [];
        for (const line of LINES) {
          const cells = line.cells.filter(([r, c]) => !isCenter(r, c));
          if (cells.length < MIN_LINE_BONUS_LEN) continue;
          if (anyBlank(cells)) continue;
          if (!isFullDotMatch(cells)) continue;
          const sig = cells
            .map(([r, c]) => grid[r][c].id)
            .sort((a, b) => a - b)
            .join(',');
          if (bonusedSignatures.has(sig)) continue;
          bonusedSignatures.add(sig);
          found.push(cells);
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
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
        };
      }

      function isGameOver(): boolean {
        return grid.every((row) => row.every((t) => isBlank(t) || t.face === 'dot' || (isBomb && t.color === RED_IDX)));
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const t = grid[r][c];
            if (isBlank(t)) continue;
            if (isBomb && t.color === RED_IDX) continue;
            live.push({ cell: [r, c], tile: t });
          }
        return live;
      }

      function findStuckGroups(): Cell[][] {
        return findStuckColorGroups(liveTiles());
      }

      function countRemainingTiles() {
        return countRemainingTilesFn(liveTiles());
      }

      function snapshotBoard(): BoardSnapshot {
        const rowH = Math.sqrt(3);
        const raw: RawCell[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const t = grid[r][c];
            const { x, z } = localToCube(r, c);
            raw.push({
              kind: 'circle',
              cx: 2 * x + z,
              cy: rowH * z,
              r: 0.95,
              face: isBlank(t) ? 'blank' : t.face,
              color: COLORS[effColor(t)],
            });
          }
        return packSnapshot(raw);
      }

      function highlightStuck(cells: Cell[] | null) {
        stuckKeys = cells ? new Set(cells.map(([r, c]) => cellKey(r, c))) : null;
      }

      function resetBoard() {
        grid = isBomb ? generateCleanBombBoard() : generateCleanBoard();
        bonusedSignatures = new Set();
        outlineTracker.reset();
        stuckKeys = null;
      }

      const controller = createGameController(refs, {
        bestKey: isBomb ? bestKey + '_bomb' : opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: '六边圆球',
        timeLimitSec: opts?.timeLimitSec,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        findStuckGroups,
        countRemainingTiles,
        snapshotBoard,
        highlightStuck,
        onCascadeStep: ({ matchGroups }) => outlineTracker.add(matchGroups, MULTI_GROUP_STAGGER_MS),
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

      // Checked right after a drag lands, before normal move resolution —
      // red tiles are never removed or flipped (see qualifies/findWholeLineBonuses
      // guards above), so the only way their adjacency ever changes is a
      // line shift landing two clusters next to each other.
      function checkBombHazard(): boolean {
        if (!isBomb || !hasRedCluster(grid)) return false;
        render();
        controller.forceEnd('红色炸弹相连', BOMB_HAZARD_PENALTY, '炸弹惩罚');
        return true;
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
        if (checkBombHazard()) return true;
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
        COLORS = isBomb ? BOMB_PALETTES[paletteName] : PALETTES[paletteName];
        (e.currentTarget as HTMLElement).classList.toggle('active', paletteName === 'colorblind');
        renderLegend();
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
