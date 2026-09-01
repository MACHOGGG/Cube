import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { createDragChain, pressScale, BOARD_FORCE, type DragChain } from '../engine/dragChain';
import { vibrate } from '../engine/haptics';
import { floorBox, observeBoardSize, squareFloor } from '../engine/boardResize';
import { colorblindOn, onColorblindChange } from '../engine/palettePref';
import { playMove, seatLine } from '../engine/juice';
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
import { STRINGS as MATCH_LABELS, STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
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
const ICON_EXTENT = 4; // the widest pattern (1x4) spans 3 units plus a tile

/**
 * 1-2-1, as one list of offsets that both the scoring rule and its hint icon
 * read from.
 *
 * They used to be written out twice. When the rule was tightened to this
 * compact 2x2 the icon kept the old, looser shape — so the HUD spent three
 * days showing players a pattern that no longer scored. One definition is
 * the only way that stays fixed.
 *
 * In (r, c) it is a 2x2 block; on screen, where this board is the same
 * lattice turned 45 degrees (iconPos below), it comes out as the diamond the
 * name describes: one tile, then two, then one.
 */
const DIAMOND_121: readonly (readonly [number, number])[] = [[0, 0], [0, 1], [1, 0], [1, 1]];
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
    // Straight from DIAMOND_121, so the hint is the rule.
    cells: DIAMOND_121.map(([r, c]) => iconTile(r, c)),
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

// The board's "121" bonus shape: one tile, then two on the row below it,
// then one on the row below that — three *touching* screen rows, symmetric
// about the middle pair. This board's screen mapping is cx=c-r, cy=c+r
// (iconPos above), so a step down one screen row is a single grid step in
// either axis, and the four cells come out as the compact 2x2 block in grid
// space: (r,c) at the top, (r,c+1) and (r+1,c) flanking it half a pitch
// left and right on the next row, (r+1,c+1) closing it below. Screen x runs
// 0, +1/-1, 0 — symmetric — and screen y runs 0, 1, 1, 2, which is the
// "adjacent rows" part.
//
// It is deliberately *not* the same block spread one ring further out
// ((r,c), (r+2,c), (r,c+2), (r+2,c+2)): that is symmetric too, but it lands
// on screen rows 0, 2, 2, 4 — every other row, with a live tile in the gaps
// — which is not the shape the hint draws and not what a player reads as
// "1-2-1".
function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_DIM && c >= 0 && c < BOARD_DIM;
}
function diamond121(r: number, c: number): Cell[] | null {
  const cells: Cell[] = DIAMOND_121.map(([dr, dc]) => [r + dr, c + dc] as Cell);
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
  /** The splash's inter-piece physics, driving every frame of the preview. */
  chain: DragChain | null;
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
      const refs = buildShell(container, {
        lang,
        shapeId: 'squareDiamond',
        timed: !!opts?.timeLimitSec,
        bomb: isBomb,
        title: `Slides · ${shapeName(lang, 'squareDiamond', '菱形方块')}`,
        tagline: isBomb ? SHELL[lang].taglineDiagonal + ' · ' + SHELL[lang].taglineBomb : SHELL[lang].taglineDiagonal,
        startBody: SHELL[lang].shellStartBody,
        patternHint: renderPatternHintRow(PATTERNS, lang),
      });

      const pickPalette = (): readonly string[] =>
        (isBomb ? BOMB_PALETTES : PALETTES)[colorblindOn() ? 'colorblind' : 'standard'];
      let COLORS: readonly string[] = pickPalette();
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
        const rect = floorBox(refs.boardWrap);
        const S = Math.min(rect.width, rect.height);
        cellSize = S / 8.2;
        k = cellSize / Math.SQRT2;
        boardLeft = S / 2;
        boardTop = S / 2;
        refs.boardEl.style.width = S + 'px';
        refs.boardEl.style.height = S + 'px';
             // 图形已经按整格算满了，地板收成正方形不会动到它。
        squareFloor(refs.boardWrap, S, S);
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
              hazard: isBomb && !isBlank(t) && t.face === 'flavor' && t.color === RED_IDX,
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
        shapeName: shapeName(lang, 'squareDiamond', '菱形方块'),
        shapeId: 'squareDiamond',
        modeKey: isBomb ? (opts?.timeLimitSec ? 'bombTimed' : 'bomb') : opts?.timeLimitSec ? 'timed' : 'base',
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
        if (!d || !d.fam || !d.line || !d.chain) return;
        const cells = d.line.cells;
        const n = cells.length;
        const size = cellSize * 0.92;
        const [dirX, dirY] = famVector(d.fam, d.k);
        const stepLen = Math.hypot(dirX, dirY);
        const chain = d.chain;
        // Each tile rides its own lagged travel from the chain (the splash's
        // integrator) — the wave, the contact squash, the entrained sides.
        for (let i = 0; i < n; i++) {
          const off = chain.at(i);
          const [r, c] = cells[i];
          const [cx, cy] = cellCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + off * dirX + 'px';
            el.style.top = cy - size / 2 + off * dirY + 'px';
            el.style.opacity = String(edgeOpacity(i + off, n));
            el.style.scale = pressScale(chain.press(i), dirX / stepLen, dirY / stepLen, BOARD_FORCE);
          }
        }
        for (let kk = -1; kk <= 1; kk++) {
          if (kk === 0) continue;
          for (let i = 0; i < n; i++) {
            const off = chain.at(i);
            const pos = i + off + kk * n;
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
        // The parallel lines either side, carried a little and sprung home.
        const inLine = new Set(cells.map(([r, c]) => cellKey(r, c)));
        const lineCoord = (r: number, c: number) =>
          d.fam === 'ROW' ? r + c : d.fam === 'A' ? r : c;
        const own = lineCoord(d.r, d.c);
        for (let r = 0; r < BOARD_DIM; r++) {
          for (let c = 0; c < BOARD_DIM; c++) {
            if (inLine.has(cellKey(r, c))) continue;
            const nudge = chain.side(Math.abs(lineCoord(r, c) - own));
            if (!nudge) continue;
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) el.style.translate = `${nudge * dirX}px ${nudge * dirY}px`;
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
        seatLine(refs.boardEl, mask);
        const [vx, vy] = famVector(d.fam, d.k);
        const sign = Math.sign(shift) || 1;
        controller.resolveMove(mask, (Math.atan2(vy * sign, vx * sign) * 180) / Math.PI);
        return true;
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        origin: refs.boardEl,
        // A touch arriving mid-reveal runs the rest of it now rather than
        // being turned away — see GameController.hurry().
        onBeforeStart: () => controller.hurry(),
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onRejected: () => vibrate(15),
        onStart(x, y) {
          // A touch arriving while the previous line is still swinging ends
          // that settle right now instead of being swallowed — fast play was
          // losing whole moves to a wave that had not finished dying down.
          drag?.chain?.flush();
          if (controller.resolving) {
            drag = null;
            return;
          }
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0, k, lastShift: 0, chain: null };
          return { r: drag.r, c: drag.c };
        },
        /**
         * 还在死区里，手指挪到哪就改抓哪。
         *
         * 抓哪一颗原本是手指落下那一瞬间定死的，落点差两三个像素跨过边界就
         * 抓了隔壁，而且要等牌动起来才发现。死区这几个像素里什么都还没发生，
         * 正好是可以反悔的窗口。
         */
        onRegrab(x, y) {
          if (!drag) return null;
          const [r, c] = cellAt(x, y);
          drag.r = r;
          drag.c = c;
          return { r, c };
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
            const grabbed = drag.line.cells.findIndex(([r, c]) => r === drag!.r && c === drag!.c);
            drag.chain = createDragChain({
              n: drag.line.cells.length,
              grabbed: Math.max(0, grabbed),
              force: BOARD_FORCE,
              onFrame: renderDragPreview,
            });
          }
          const d = drag;
          if (!d.fam || !d.chain) return;
          const raw = projectedSteps(d.fam, dx, dy, d.k);
          const shift = Math.round(raw);
          if (shift !== d.lastShift) {
            vibrate(6);
            playMove();
            d.lastShift = shift;
          }
          d.chain.drive(magnetizeRawDist(raw));
        },
        onEnd(dx, dy) {
          const d = drag;
          if (!d || !d.fam || !d.chain) {
            drag = null;
            if (!controller.resolving) render();
            return;
          }
          d.dx = dx;
          d.dy = dy;
          d.chain.settle(Math.round(projectedSteps(d.fam, dx, dy, d.k)), () => {
            d.chain?.stop();
            const moved = applyDrag();
            drag = null;
            if (!moved) render();
          });
        },
      });

      const stopResize = observeBoardSize(refs.boardWrap, () => {
        if (!drag && controller.started) render();
      });

      function destroy() {
        drag?.chain?.stop();
        drag = null;
        controller.destroy();
        stopColorblind();
        detachDrag();
        stopResize();
      }

      refs.buttons.back?.addEventListener('click', () => {
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

      // Follows the app-wide setting (个人主页), so switching it mid-run
      // recolours the board under the player's finger rather than waiting
      // for the next game.
      const stopColorblind = onColorblindChange(() => {
        COLORS = pickPalette();
        renderLegend();
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
