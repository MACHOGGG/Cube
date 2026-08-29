import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { extendRunInLine, growParallelogram } from '../engine/matchGrowth';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintRow, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import { BOMB_RED_HEX, BOMB_HAZARD_PENALTY, BOMB_HAZARD_REASON } from '../engine/bomb';
import { STRINGS as MATCH_LABELS } from '../i18n';
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

// Bomb mode reuses the exact same 6-color, 6-per-color deck as the base
// square-diamond game — same formula square.ts itself uses. It reinterprets
// slot 0 (this palette's own reddish hue, same PALETTES as square.ts) as
// the hazard color: those 6 tiles never flip, and no other tile is ever
// assigned red as its dot color.
const BOMB_PALETTES = {
  standard: PALETTES.standard.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
  colorblind: PALETTES.colorblind.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
} as const;
const RED_IDX = 0;

const GLYPH = `<svg viewBox="0 0 32 32"><rect x="12" y="2" width="8" height="8" fill="#C46A4E" transform="rotate(45 16 6)"/><rect x="22" y="12" width="8" height="8" fill="#4A9573" transform="rotate(45 26 16)"/><rect x="12" y="22" width="8" height="8" fill="#4C7EAD" transform="rotate(45 16 26)"/><rect x="2" y="12" width="8" height="8" fill="#AD5C82" transform="rotate(45 6 16)"/></svg>`;

// The board's 3 seed patterns (see findRunMatches/rhombus22Right/diamond121
// below), positioned with the same (r,c) -> screen transform snapshotBoard()
// uses, drawn as blank outlines for the in-HUD pattern hint. Offsets are
// copied verbatim from rhombus22Right/diamond121's own cell lists.
function iconPos(r: number, c: number): [number, number] {
  return [c - r, c + r];
}
// All three icons share one scale (ICON_EXTENT) so their tiles come out the
// same size and the 1-2-1 reads as *spread out* rather than as a shrunken
// 2+2. Tiles are drawn upright, not on a 45deg rotation: this board arranges
// *upright* rounded squares in a diamond lattice (every other screen row
// offset by half a pitch), so a rotated icon tile wouldn't look like
// anything actually on the board. half = 0.5 makes neighbouring tiles meet
// corner to corner, which is the clearest way to show that offset lattice at
// icon size.
const ICON_HALF = 0.5;
const ICON_EXTENT = 5; // the widest pattern (1-2-1) spans 4 units plus a tile
const iconTile = (r: number, c: number) => {
  const [cx, cy] = iconPos(r, c);
  return { kind: 'rect' as const, cx, cy, half: ICON_HALF };
};
const PATTERNS: PatternDef[] = [
  {
    label: '1×4',
    extent: ICON_EXTENT,
    cells: [0, 1, 2, 3].map((c) => iconTile(0, c)),
  },
  {
    label: '2+2',
    extent: ICON_EXTENT,
    // The right-hand parallelogram of TWO_PLUS_TWO_BASES, cell for cell:
    // two neighbours on one screen row, two more half a tile to the right
    // on the next.
    cells: ([[0, 1], [0, 2], [1, 0], [1, 1]] as const).map(([r, c]) => iconTile(r, c)),
  },
  {
    label: '1-2-1',
    extent: ICON_EXTENT,
    // Drawn a touch larger and pulled in from its true 2-cell spread: at
    // icon size the real gaps read as four unrelated dots rather than one
    // diamond.
    cells: ([[0, 0], [2, 0], [0, 2], [2, 2]] as const).map(([r, c]) => {
      const [cx, cy] = iconPos(r, c);
      return { kind: 'rect' as const, cx: cx * 0.72, cy: cy * 0.72, half: ICON_HALF * 1.3 };
    }),
  },
];

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

// The two mirrored "2+2" parallelograms — see findRunMatches.
const TWO_PLUS_TWO_BASES: readonly [[number, number], [number, number]][] = [
  [[0, 1], [1, -1]],
  [[1, -1], [1, 0]],
];

// The board's "121" bonus shape. This board's screen mapping is
// cx=c-r, cy=c+r (iconPos above) — *every* unit grid step (row or column)
// changes cy by exactly 1, unlike circle.ts's own triangular lattice (whose
// ballCenter only moves cy on a row step, not a column step). That extra
// structure is what let circle.ts's 4-cell diamond121 chain
// ([[r,c],[r+1,c],[r+1,c+1],[r+2,c+1]]) come out symmetric; copied onto
// *this* board the same offsets drift the shape sideways as it goes down
// (verified: screen x ends up 0,-1,0,-1 for the old chain, not the
// symmetric 0/±1/0 a real diamond needs). Since every step here moves cy,
// there is in fact no 4-cell *chain* of touching cells that reads as a
// bigger symmetric diamond on this lattice — the compact one (the literal
// 2×2 square below, in findRunMatches) is already the only symmetric
// diamond a chain of touching cells can form here. "121" is instead built
// from the 4 *corners* one ring further out — top (r,c), the two points 2
// steps away along each grid axis (r+2,c) and (r,c+2), and the bottom
// (r+2,c+2) opposite the top — which does verify as symmetric (screen x:
// 0, ±2, 0) and reads as the bigger hollow "1-2-1" diamond, even though its
// 4 cells don't touch each other (there's a live tile in between each pair,
// just not required to match).
function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_DIM && c >= 0 && c < BOARD_DIM;
}
function diamond121(r: number, c: number): Cell[] | null {
  const cells: Cell[] = [[r, c], [r + 2, c], [r, c + 2], [r + 2, c + 2]];
  return cells.every(([rr, cc]) => inBounds(rr, cc)) ? cells : null;
}
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
      const isBomb = !!opts?.bomb;
      const lang = opts?.lang ?? 'zhHans';
      const BASE_HINT =
        '沿水平方向或两条斜线方向拖动整条线，一条线上连续 4 个同色（不分点/面）得 4 分，同一条线上连得更长则按实际数量得分，但线外的同色方块不会被计入；同色的"2+2"（同一横排相邻 2 个，加上下一排错开半格的 2 个，左右两种错法都算）沿同一方向扩大，同样按扩大后的数量得分；同色的"121"菱形（比"22"更大一圈，四个角上下左右对称）固定得 4 分。得分方块翻成点面。得分图案必须至少含 1 个仍是正面的方块——全部都已经是点面的图案不再得分，所以把同一组已翻面的方块反复滑回原样是刷不到分的。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得该线长度的平方分，该线随后变为空白——保留在棋盘原位，可以继续正常参与拖动和补位，但不会再对任何得分产生贡献。连续多步得分会逐步加成：第 1 步 ×1，第 2 步 ×1.5，第 3 步 ×2，第 4 步 ×2.5，以此类推每多连一步就多 0.5 倍，一旦某步没得分就重新从 ×1 计数。结束时棋盘上每留下 1 个仍是正面的方块，综合得分再 ×95%。';
      const hint = isBomb
        ? '红色为危险色：中央带白色"!"标记，永不翻面，不参与配对计分——只是需要避开聚集的障碍块。任意时刻场上 3 个红色方块相互边相连时，这几个方块会闪烁描边预警；一旦达到 4 个及以上相互边相连，将立即结束挑战并扣 100 分。' +
          BASE_HINT +
          '全部非红色方块都翻成点面或变为空白时结束，结算当时的分数。'
        : BASE_HINT + '全部方块都翻成点面或变为空白时结束，结算当时的分数。';
      const assumptions = isBomb
        ? '颜色数量与非炸弹版完全一致：6 种颜色各 6 枚，共 36 枚（菱形棋盘，十一行 1/2/3/4/5/6/5/4/3/2/1 枚），其中一种颜色固定替换为危险红色（不随色盲友好配色切换），该颜色的 6 枚全部是永不翻面的危险方块。其余 5 种正常颜色各 6 枚，点色分布为：其余 4 色各 1 枚、本色 2 枚——红色不会出现在任何方块的点色（反面）上。三个滑动方向——水平、以及棋盘原本的两条斜线——判分规则完全一致。'
        : '6 种颜色各 6 枚，共 36 枚（菱形棋盘，十一行 1/2/3/4/5/6/5/4/3/2/1 枚）；每种颜色的点色分布为：其余 5 色各 1 枚、本色 1 枚。三个滑动方向——水平、以及棋盘原本的两条斜线——判分规则完全一致。';
      const refs = buildShell(container, {
        lang,
        title: 'Slides · 菱形方块',
        tagline: isBomb
          ? '沿水平或两条斜线方向拖动整条线 · 避免红色方块 4 连'
          : '沿水平或两条斜线方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平或斜线方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint,
        assumptions,
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
        patternHint: renderPatternHintRow(PATTERNS),
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = isBomb ? BOMB_PALETTES[paletteName] : PALETTES[paletteName];
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
      let stuckKeys: Set<string> | null = null;

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

      // ---------- bomb mode: red hazard tiles ----------
      // Same deck as the base game (6 colors x 6 tiles = 36) — shuffledDeck()
      // already reads from COLORS, which is BOMB_PALETTES here, so it needs
      // no bomb-specific variant.

      // Per non-red front-color group of 6: the other 4 non-red colors get 1
      // dot-color slot each, and the tile's own front color gets 2 (1 "own
      // share" + 1 extra) to fill out the 6th slot — red is excluded from
      // every dot-color pool since red tiles never flip and never need one.
      function assignBombDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length).fill(RED_IDX);
        for (let color = 0; color < COLORS.length; color++) {
          if (color === RED_IDX) continue;
          const others = Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== color && k !== RED_IDX);
          const pool = shuffle([...others, color, color]);
          const indices: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) indices.push(idx);
          });
          indices.forEach((idx, i) => {
            dotColors[idx] = pool[i];
          });
        }
        return dotColors;
      }

      function boardFromBombDeck(deck: number[]): Tile[][] {
        const dots = assignBombDotColors(deck);
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

      function redClusterKeys(g: Tile[][], minSize: number): Set<string> {
        const found = new Set<string>();
        const seen = new Set<string>();
        for (let r = 0; r < BOARD_DIM; r++)
          for (let c = 0; c < BOARD_DIM; c++) {
            if (g[r][c].color !== RED_IDX) continue;
            const startKey = cellKey(r, c);
            if (seen.has(startKey)) continue;
            const comp: string[] = [];
            const stack: Cell[] = [[r, c]];
            seen.add(startKey);
            while (stack.length) {
              const [cr, cc] = stack.pop()!;
              comp.push(cellKey(cr, cc));
              const neighbors: Cell[] = [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]];
              for (const [nr, nc] of neighbors) {
                if (!inBounds(nr, nc)) continue;
                const key = cellKey(nr, nc);
                if (seen.has(key) || g[nr][nc].color !== RED_IDX) continue;
                seen.add(key);
                stack.push([nr, nc]);
              }
            }
            if (comp.length >= minSize) for (const k of comp) found.add(k);
          }
        return found;
      }

      // A 4-cluster ends the run outright; a 3-cluster is one drag away
      // from it, so render() pulses those tiles as an early warning.
      function hasRedCluster(g: Tile[][]): boolean {
        return redClusterKeys(g, 4).size > 0;
      }

      function generateCleanBombBoard(): Tile[][] {
        let g: Tile[][];
        let tries = 0;
        do {
          g = boardFromBombDeck(shuffledDeck());
          tries++;
        } while ((hasInitialClump(g) || hasRedCluster(g)) && tries < 500);
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
        const warnKeys = isBomb ? redClusterKeys(grid, 3) : null;
        for (let r = 0; r < BOARD_DIM; r++) {
          for (let c = 0; c < BOARD_DIM; c++) {
            const key = cellKey(r, c);
            const el = makeTileEl(grid[r][c], r, c);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key), true);
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            if (warnKeys?.has(key)) el.classList.add('hazard-warn');
            refs.boardEl.appendChild(el);
          }
        }
        flipInCells = new Set();
      }

      // A match only ever grows along its *own* seed shape's regular
      // directions (see matchGrowth.ts) — never a generic same-color flood
      // fill. A run-4 only extends further along that same line; a 2x2 or
      // rhombus cluster only extends by a full extra row/column of its own
      // parallelogram; a 121 diamond doesn't extend at all — it always
      // scores exactly its own 4 cells.
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }
      function isLiveCell(r: number, c: number): boolean {
        return inBounds(r, c) && !isBlank(grid[r][c]);
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
      // The 4 cells of the unit parallelogram at (r,c) spanned by du/dv.
      function parallelogramCells(r: number, c: number, du: [number, number], dv: [number, number]): Cell[] {
        return ([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(
          ([u, v]) => [r + u * du[0] + v * dv[0], c + u * du[1] + v * dv[1]] as Cell,
        );
      }

      function boundedPositionAt(r: number, c: number, du: [number, number], dv: [number, number]) {
        return (u: number, v: number): Cell | null => {
          const cell: Cell = [r + u * du[0] + v * dv[0], c + u * du[1] + v * dv[1]];
          return inBounds(cell[0], cell[1]) ? cell : null;
        };
      }

      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const seed = cells.slice(i, i + 4);
            if (!qualifies(seed, mask)) continue;
            const region = extendRunInLine(cells, i, i + 3, effColorAt, isLiveCell);
            matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelRun4 });
          }
        }
        for (let r = 0; r < BOARD_DIM; r++)
          for (let c = 0; c < BOARD_DIM; c++) {
            // "2+2": two neighbours in one screen row, plus two more in the
            // next row offset half a tile — mirrored left and right. Both
            // are parallelograms on this lattice (basis [0,1]/[1,-1] and
            // [1,-1]/[1,0]), so they grow the same way a run or a block
            // does. Note this is *not* the compact grid 2x2, which this
            // board's 45deg mapping draws as a 1-2-1 diamond rather than
            // anything a player would read as "two rows of two".
            for (const [du, dv] of TWO_PLUS_TWO_BASES) {
              const seed = parallelogramCells(r, c, du, dv);
              if (seed.every(([rr, cc]) => inBounds(rr, cc)) && qualifies(seed, mask)) {
                const region = growParallelogram(boundedPositionAt(r, c, du, dv), effColorAt, isLiveCell);
                matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelBlock22 });
              }
            }
            const d = diamond121(r, c);
            if (d && qualifies(d, mask)) {
              matches.push({ cells: d, points: 4, label: MATCH_LABELS[lang].label121 });
            }
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
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
        };
      }

      function isGameOver(): boolean {
        return grid.every((row) => row.every((t) => isBlank(t) || t.face === 'dot' || (isBomb && t.color === RED_IDX)));
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < BOARD_DIM; r++)
          for (let c = 0; c < BOARD_DIM; c++) {
            const t = grid[r][c];
            if (isBlank(t)) continue;
            if (isBomb && t.color === RED_IDX) continue;
            live.push({ cell: [r, c], tile: t });
          }
        return live;
      }

      function findStuckGroups(clearedDotColors: ReadonlySet<number>): Cell[][] {
        return findStuckColorGroups(liveTiles(), clearedDotColors);
      }

      function countRemainingTiles() {
        return countRemainingTilesFn(liveTiles());
      }

      function snapshotBoard(): BoardSnapshot {
        const mid = (BOARD_DIM - 1) / 2;
        const raw: RawCell[] = [];
        for (let r = 0; r < BOARD_DIM; r++)
          for (let c = 0; c < BOARD_DIM; c++) {
            const t = grid[r][c];
            raw.push({
              kind: 'rect',
              cx: c - r,
              cy: c + r - 2 * mid,
              half: 0.47,
              rotateDeg: 45,
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
        lang,
        bestKey: isBomb ? bestKey + '_bomb' : opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: '菱形方块',
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

      // Checked right after a drag lands, before normal move resolution —
      // red tiles are never removed or flipped (see qualifies/findWholeLineBonuses
      // guards above), so the only way their adjacency ever changes is a
      // line shift landing two clusters next to each other.
      function checkBombHazard(): boolean {
        if (!isBomb || !hasRedCluster(grid)) return false;
        render();
        controller.forceEnd(BOMB_HAZARD_REASON, BOMB_HAZARD_PENALTY, '炸弹惩罚');
        return true;
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
      // Leaving from the start screen goes exactly where the in-game back
      // button goes — the home page, or the picker this game came from.
      refs.buttons.startBack.addEventListener('click', () => {
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
