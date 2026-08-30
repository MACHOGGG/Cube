import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { createDragChain, pressScale, BOARD_FORCE, type DragChain } from '../engine/dragChain';
import { vibrate } from '../engine/haptics';
import { playMove, seatLine } from '../engine/juice';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import type { BoardSnapshot, SnapshotCell } from '../engine/shareCard';
import { renderPatternHintRow, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import { BOMB_RED_HEX, BOMB_HAZARD_PENALTY, BOMB_HAZARD_REASON } from '../engine/bomb';
import { STRINGS as MATCH_LABELS, STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
import type { ShapeGame, ShapeGameOpts } from './types';

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

// Bomb mode reuses the exact same 6-color deck as the base game — same
// color count, same 6-tiles-per-color — it doesn't drop colors or reserve
// extra board slots for red. It just reinterprets slot 0 (each palette's
// own reddish hue) as the hazard color: those 6 tiles never flip, and no
// other tile is ever assigned red as its dot color.
const BOMB_PALETTES = {
  standard: PALETTES.standard.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
  colorblind: PALETTES.colorblind.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
} as const;
const RED_IDX = 0;

const BOARD_DIM = 6;

const GLYPH = `<svg viewBox="0 0 32 32"><rect x="2" y="2" width="12" height="12" rx="3" fill="#C46A4E"/><rect x="18" y="2" width="12" height="12" rx="3" fill="#4A9573"/><rect x="2" y="18" width="12" height="12" rx="3" fill="#4C7EAD"/><rect x="18" y="18" width="12" height="12" rx="3" fill="#AD5C82"/></svg>`;

// The board's two seed patterns (see findMatches below) — a 2x2 block and a
// straight run of 4 — drawn as blank outlines for the in-HUD pattern hint.
const PATTERNS: PatternDef[] = [
  {
    label: '2×2',
    cells: [
      { kind: 'rect', cx: 0, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 1, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 0, cy: 1, half: 0.42 },
      { kind: 'rect', cx: 1, cy: 1, half: 0.42 },
    ],
  },
  {
    label: '1×4',
    cells: [
      { kind: 'rect', cx: 0, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 1, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 2, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 3, cy: 0, half: 0.42 },
    ],
  },
];

interface DragState {
  r: number;
  c: number;
  axis: 'row' | 'col' | null;
  dx: number;
  dy: number;
  cell: number;
  lastShift: number;
  /** The splash's inter-piece physics, driving every frame of the preview. */
  chain: DragChain | null;
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
    mount(container, onBack, opts?: ShapeGameOpts) {
      const isBomb = !!opts?.bomb;
      const lang = opts?.lang ?? 'zhHans';
      const refs = buildShell(container, {
        lang,
        title: `Slides · ${shapeName(lang, 'square', '方块')}`,
        tagline: isBomb ? SHELL[lang].taglineRowCol + ' · ' + SHELL[lang].taglineBomb : SHELL[lang].taglineRowCol,
        startBody: SHELL[lang].shellStartBody,
        extraControls: [{ id: 'paletteBtn', label: SHELL[lang].colorblindBtn }],
        patternHint: renderPatternHintRow(PATTERNS, lang),
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = isBomb ? BOMB_PALETTES[paletteName] : PALETTES[paletteName];

      let rows = BOARD_DIM;
      let cols = BOARD_DIM;
      let grid: Tile[][] = [];
      let CELL = 0;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      // Stashed by findLineBonusGroups() for applyLineBonus() to consume in
      // the same cascade pass — see the comment on applyLineBonus below.
      let pendingRowClears: number[] = [];
      let pendingColClears: number[] = [];
      // Cells whose flip to their dot face just landed (set in onCommit,
      // consumed and cleared by the very next render()) — those cells get a
      // one-shot .flip-in animation class so the flip itself has motion
      // instead of the face silently swapping.
      let flipInCells = new Set<string>();
      // Cells GameController told us (via highlightStuck) to draw the red
      // "this can never score again" glow around, right before ending the run.
      let stuckKeys: Set<string> | null = null;

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
      // real printed card). Per front-color group of 6 tiles: 5 of them get
      // the other 5 colors, one each (a clean permutation — no two tiles in
      // the group share a dot color), and exactly 1 keeps its own color as
      // the dot (a same-color "self" tile) — the same "some self-pairs per
      // front-color group" pattern circle (1 self per 7) and triangle (4
      // self per 9) use, just with square's own count (1 self per 6).
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const assignments = shuffle([
            ...Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== color),
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

      // ---------- bomb mode: red hazard tiles ----------
      // Same deck as the base game (6 colors x 6 tiles = 36) — shuffledDeck()
      // already reads from COLORS, which is BOMB_PALETTES here, so it needs
      // no bomb-specific variant.

      // Per non-red front-color group of 6: the other 4 non-red colors get 1
      // dot-color slot each, and the tile's own front color gets 2 (1 "own
      // share" + 1 extra) to fill out the 6th slot — red is excluded from
      // every dot-color pool since red tiles never flip and never need one,
      // and a normal tile flipping to a "red" back would be confusable with
      // an actual hazard tile.
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

      // General 4-directional connected-component check for red tiles —
      // used both to reject an initial deal that already starts lost and to
      // watch for the same condition forming live as the player drags.
      function redClusterKeys(g: Tile[][], minSize: number): Set<string> {
        const found = new Set<string>();
        const R = g.length,
          C = g[0].length;
        const seen = new Set<string>();
        for (let r = 0; r < R; r++)
          for (let c = 0; c < C; c++) {
            if (g[r][c].color !== RED_IDX) continue;
            const startKey = cellKey(r, c);
            if (seen.has(startKey)) continue;
            const comp: string[] = [];
            const stack: Cell[] = [[r, c]];
            seen.add(startKey);
            while (stack.length) {
              const [cr, cc] = stack.pop()!;
              comp.push(cellKey(cr, cc));
              const neighbors: Cell[] = [
                [cr - 1, cc],
                [cr + 1, cc],
                [cr, cc - 1],
                [cr, cc + 1],
              ];
              for (const [nr, nc] of neighbors) {
                if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
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
          if (isBomb && tile.color === RED_IDX) {
            const mark = document.createElement('div');
            mark.className = 'hazard-mark';
            mark.textContent = '!';
            mark.style.fontSize = Math.round(size * 0.55) + 'px';
            el.appendChild(mark);
          }
        }
        if (opacity !== undefined) el.style.opacity = String(opacity);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.dataset.id = String(tile.id);
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
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const key = cellKey(r, c);
            const el = makeTileEl(grid[r][c], r, c, CELL);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key), true);
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            if (warnKeys?.has(key)) el.classList.add('hazard-warn');
            refs.boardEl.appendChild(el);
          }
        }
        flipInCells = new Set();
      }

      // ---------- matching engine ----------
      // A match only ever grows along its *own* seed shape's regular
      // directions — never a generic same-color flood fill. A straight
      // run-of-4 only extends further along that same row/column (so a
      // same-color tile hanging off the side never folds in); a 2x2 block
      // only extends by a full extra row or column at a time (so "3 wide,
      // 2 deep, plus one stray tile" stops at the 3x2 rectangle, not the
      // stray tile too). Two overlapping seed windows inside one longer run
      // (or one bigger rectangle) converge on the exact same final region,
      // so the existing per-cascade-step tile-id dedup in scoring.ts still
      // collapses them into a single scored match rather than double-
      // counting it.
      function cellsSameColor(cells: Cell[]): boolean {
        const c0 = effColor(grid[cells[0][0]][cells[0][1]]);
        // Red hazard tiles are obstacles, not a matchable color — never a
        // valid seed even though they'd otherwise pass the same-color check.
        if (isBomb && c0 === RED_IDX) return false;
        return cells.every(([r, c]) => effColor(grid[r][c]) === c0);
      }
      function touches(cells: Cell[], mask: Set<string> | null): boolean {
        if (!mask) return true;
        return cells.some(([r, c]) => mask.has(cellKey(r, c)));
      }
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }

      function extendRunHoriz(r: number, cStart: number, cEnd: number): Cell[] {
        const color = effColorAt(r, cStart);
        let lo = cStart;
        let hi = cEnd;
        while (lo - 1 >= 0 && effColorAt(r, lo - 1) === color) lo--;
        while (hi + 1 < cols && effColorAt(r, hi + 1) === color) hi++;
        const cells: Cell[] = [];
        for (let c = lo; c <= hi; c++) cells.push([r, c]);
        return cells;
      }
      function extendRunVert(c: number, rStart: number, rEnd: number): Cell[] {
        const color = effColorAt(rStart, c);
        let lo = rStart;
        let hi = rEnd;
        while (lo - 1 >= 0 && effColorAt(lo - 1, c) === color) lo--;
        while (hi + 1 < rows && effColorAt(hi + 1, c) === color) hi++;
        const cells: Cell[] = [];
        for (let r = lo; r <= hi; r++) cells.push([r, c]);
        return cells;
      }
      function rowSpanMatches(r: number, c0: number, c1: number, color: number): boolean {
        for (let c = c0; c <= c1; c++) if (effColorAt(r, c) !== color) return false;
        return true;
      }
      function colSpanMatches(c: number, r0: number, r1: number, color: number): boolean {
        for (let r = r0; r <= r1; r++) if (effColorAt(r, c) !== color) return false;
        return true;
      }
      function extendRect(r0: number, c0: number, r1: number, c1: number): Cell[] {
        const color = effColorAt(r0, c0);
        let grew = true;
        while (grew) {
          grew = false;
          if (r0 - 1 >= 0 && rowSpanMatches(r0 - 1, c0, c1, color)) { r0--; grew = true; }
          if (r1 + 1 < rows && rowSpanMatches(r1 + 1, c0, c1, color)) { r1++; grew = true; }
          if (c0 - 1 >= 0 && colSpanMatches(c0 - 1, r0, r1, color)) { c0--; grew = true; }
          if (c1 + 1 < cols && colSpanMatches(c1 + 1, r0, r1, color)) { c1++; grew = true; }
        }
        const cells: Cell[] = [];
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push([r, c]);
        return cells;
      }

      function findMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (let r = 0; r < rows - 1; r++)
          for (let c = 0; c < cols - 1; c++) {
            const seed: Cell[] = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
            if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
            const region = extendRect(r, c, r + 1, c + 1);
            matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelBlock22 });
          }
        for (let r = 0; r < rows; r++)
          for (let c = 0; c <= cols - 4; c++) {
            const seed: Cell[] = [[r, c], [r, c + 1], [r, c + 2], [r, c + 3]];
            if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
            const region = extendRunHoriz(r, c, c + 3);
            matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelRun4 });
          }
        for (let c = 0; c < cols; c++)
          for (let r = 0; r <= rows - 4; r++) {
            const seed: Cell[] = [[r, c], [r + 1, c], [r + 2, c], [r + 3, c]];
            if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
            const region = extendRunVert(c, r, r + 3);
            matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelRun4 });
          }
        return matches;
      }

      // A line only qualifies once every tile in it has flipped to its dot
      // face *and* those dot colors all match — a mix of flavor-face and
      // dot-face tiles no longer counts, even if their effective colors
      // happen to agree.
      function isFullDotMatch(tiles: Tile[]): boolean {
        if (tiles.some((t) => t.face !== 'dot')) return false;
        const c0 = tiles[0].dotColor;
        return tiles.every((t) => t.dotColor === c0);
      }

      function findLineBonusGroups(): Cell[][] {
        const rowClears: number[] = [];
        for (let r = 0; r < rows; r++) {
          if (isFullDotMatch(grid[r])) rowClears.push(r);
        }
        const colClears: number[] = [];
        for (let c = 0; c < cols; c++) {
          const column = grid.map((row) => row[c]);
          if (isFullDotMatch(column)) colClears.push(c);
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
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: true,
          isTerminalAfterLineBonus: () => rows === 0 || cols === 0,
        };
      }

      function isGameOver(): boolean {
        // Red hazard tiles never flip by design — in bomb mode the "cleared"
        // condition is every *non-red* tile reaching its dot face, or the
        // run wouldn't be able to end this way at all.
        const allDot =
          grid.length > 0 &&
          grid.every((row) => row.every((t) => t.face === 'dot' || (isBomb && t.color === RED_IDX)));
        return allDot || rows === 0 || cols === 0;
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            // Red hazard tiles are permanent obstacles, not something the
            // player is expected to ever flip — excluded from stalemate
            // detection and the end-of-run "left on the board" penalty.
            if (isBomb && grid[r][c].color === RED_IDX) continue;
            live.push({ cell: [r, c], tile: grid[r][c] });
          }
        return live;
      }

      function findStuckGroups(clearedDotColors: ReadonlySet<number>): Cell[][] {
        return findStuckColorGroups(liveTiles(), clearedDotColors);
      }

      function countRemainingTiles() {
        return countRemainingTilesFn(liveTiles());
      }

      function highlightStuck(cells: Cell[] | null) {
        stuckKeys = cells ? new Set(cells.map(([r, c]) => cellKey(r, c))) : null;
      }

      function snapshotBoard(): BoardSnapshot {
        const cells: SnapshotCell[] = [];
        const half = 0.5 / BOARD_DIM - 0.01;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const t = grid[r][c];
            cells.push({
              kind: 'rect',
              cx: (c + 0.5) / BOARD_DIM,
              cy: (r + 0.5) / BOARD_DIM,
              half,
              face: t.face,
              color: COLORS[effColor(t)],
            });
          }
        return { cells };
      }

      function resetBoard() {
        rows = BOARD_DIM;
        cols = BOARD_DIM;
        grid = isBomb ? generateCleanBombBoard() : generateCleanBoard();
        outlineTracker.reset();
        stuckKeys = null;
      }

      const controller = createGameController(refs, {
        lang,
        bestKey: isBomb ? bestKey + '_bomb' : opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: shapeName(lang, 'square', '方块'),
        shapeId: 'square',
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
        // Line-bonus cells are removed from the board a moment later (see
        // applyLineBonus), so their coordinates aren't safe to outline —
        // the fade+collapse transition already gives that event its own
        // feedback. Only 2x2/straight-4 matches, which stay in place, get
        // the outline highlight. A bonus step's DOM still shows its
        // pre-removal state when this fires (render() for this step hasn't
        // run yet), so this is also where the "before" snapshot for that
        // transition gets captured.
        onCascadeStep: ({ matchGroups, lineBonusGroups }) => {
          outlineTracker.add(matchGroups, MULTI_GROUP_STAGGER_MS);
          if (lineBonusGroups.length) pendingCollapseSnapshot = captureTileSnapshots();
        },
        onCascadeStepRendered: ({ lineBonusGroups }) => {
          if (lineBonusGroups.length && pendingCollapseSnapshot) {
            playCollapseTransition(pendingCollapseSnapshot);
            pendingCollapseSnapshot = null;
          }
        },
        onCommit: (matchGroups) => {
          for (const cells of matchGroups) for (const [r, c] of cells) flipInCells.add(cellKey(r, c));
        },
      });

      // ---------- drag interaction ----------
      let drag: DragState | null = null;

      // A ghost fully outside [low, high] (the same generous one-cell
      // margin the old hard cutoff used) is invisible; one that's just
      // crossed into range ramps up smoothly over a short distance instead
      // of popping in at full ghost-opacity — same idea in reverse as it
      // exits the other side.
      function edgeFade(x: number, low: number, high: number, range: number): number {
        const overshoot = x < low ? low - x : x > high ? x - high : 0;
        return Math.max(0, 1 - overshoot / range);
      }

      function renderDragPreview() {
        render();
        if (!drag || !drag.axis || !drag.chain) return;
        const cell = drag.cell;
        const chain = drag.chain;
        // Each tile rides its own lagged travel from the chain (the splash's
        // integrator, engine/dragChain.ts): a wave down the line, contact
        // squash, and the neighbouring lines carried a little and sprung home.
        if (drag.axis === 'row') {
          const r = drag.r;
          const span = cols * cell;
          const fadeRange = cell * 0.4;
          for (let c = 0; c < cols; c++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) {
              el.style.left = c * cell + chain.at(c) * cell + 'px';
              el.style.scale = pressScale(chain.press(c), 1, 0, BOARD_FORCE);
            }
          }
          for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            for (let c = 0; c < cols; c++) {
              const x = c * cell + chain.at(c) * cell + k * span;
              const fade = edgeFade(x, -cell, span, fadeRange);
              if (fade <= 0) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.55 * fade);
              ghost.classList.add('ghost');
              ghost.style.left = x + 'px';
              refs.boardEl.appendChild(ghost);
            }
          }
          for (let r2 = 0; r2 < rows; r2++) {
            if (r2 === r) continue;
            const nudge = chain.side(Math.abs(r2 - r));
            if (!nudge) continue;
            for (let c = 0; c < cols; c++) {
              const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r2}"][data-c="${c}"]`);
              if (el) el.style.translate = `${nudge * cell}px 0`;
            }
          }
        } else {
          const c = drag.c;
          const span = rows * cell;
          const fadeRange = cell * 0.4;
          for (let r = 0; r < rows; r++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) {
              el.style.top = r * cell + chain.at(r) * cell + 'px';
              el.style.scale = pressScale(chain.press(r), 0, 1, BOARD_FORCE);
            }
          }
          for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            for (let r = 0; r < rows; r++) {
              const y = r * cell + chain.at(r) * cell + k * span;
              const fade = edgeFade(y, -cell, span, fadeRange);
              if (fade <= 0) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.55 * fade);
              ghost.classList.add('ghost');
              ghost.style.top = y + 'px';
              refs.boardEl.appendChild(ghost);
            }
          }
          for (let c2 = 0; c2 < cols; c2++) {
            if (c2 === c) continue;
            const nudge = chain.side(Math.abs(c2 - c));
            if (!nudge) continue;
            for (let r = 0; r < rows; r++) {
              const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c2}"]`);
              if (el) el.style.translate = `0 ${nudge * cell}px`;
            }
          }
        }
      }

      // ---------- line-clear collapse transition ----------
      // A whole-line bonus removes tiles from the board (see applyLineBonus
      // above), which would otherwise make survivors silently teleport to
      // their new position on the very next render(). Captured just before
      // the move, then diffed against the post-move DOM: cleared tiles get a
      // brief fade-out ghost at their old spot, and survivors that moved
      // freeze at their old spot and slide into their real one right after —
      // fade, *then* collapse, matching a real row of blocks being cleared
      // and the remaining ones sliding together to close the gap.
      const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const COLLAPSE_FADE_MS = 700;
      const COLLAPSE_SLIDE_MS = 480;
      // A gentle ease-in that snaps shut with a small overshoot right at the
      // end — survivors drift together slowly at first, then the last bit of
      // the gap "snaps" closed like a magnet grabbing hold, instead of a flat
      // constant-feel ease.
      const COLLAPSE_SLIDE_EASING = 'cubic-bezier(0.5, 0, 0.18, 1.4)';

      interface TileSnapshot { left: number; top: number; color: string }

      function captureTileSnapshots(): Map<number, TileSnapshot> {
        const map = new Map<number, TileSnapshot>();
        refs.boardEl.querySelectorAll<HTMLElement>('.tile[data-id]').forEach((el) => {
          const id = Number(el.dataset.id);
          const dot = el.querySelector<HTMLElement>('.dot-circle');
          const color = (dot ? dot.style.background : el.style.background) || 'var(--ink-faint)';
          map.set(id, { left: parseFloat(el.style.left), top: parseFloat(el.style.top), color });
        });
        return map;
      }

      // Snapshotted in onCascadeStep (still pre-removal DOM) and consumed by
      // onCascadeStepRendered right after that same step's render() — one
      // bonus step at a time, now that a chain reaction reveals its steps
      // one beat apart instead of all landing in the same render().
      let pendingCollapseSnapshot: Map<number, TileSnapshot> | null = null;

      function playCollapseTransition(before: Map<number, TileSnapshot>) {
        const seenIds = new Set<number>();
        const flipEls: HTMLElement[] = [];
        refs.boardEl.querySelectorAll<HTMLElement>('.tile[data-id]').forEach((el) => {
          const id = Number(el.dataset.id);
          seenIds.add(id);
          const prev = before.get(id);
          if (!prev) return;
          const dx = prev.left - parseFloat(el.style.left);
          const dy = prev.top - parseFloat(el.style.top);
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
          el.style.transition = 'none';
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          flipEls.push(el);
        });

        const removedIds: number[] = [];
        before.forEach((_, id) => { if (!seenIds.has(id)) removedIds.push(id); });

        const slideNow = () => {
          if (!flipEls.length) return;
          void refs.boardEl.offsetHeight; // commit the frozen transform before transitioning away from it
          requestAnimationFrame(() => {
            flipEls.forEach((el) => {
              el.style.transition = `transform ${COLLAPSE_SLIDE_MS}ms ${COLLAPSE_SLIDE_EASING}`;
              el.style.transform = '';
            });
          });
        };

        if (!removedIds.length) {
          slideNow();
          return;
        }
        removedIds.forEach((id) => {
          const prev = before.get(id)!;
          // A whole-line bonus only ever fires once every cell in that line
          // is already dot-faced (see isFullDotMatch), so what the player
          // just saw complete — and what should visibly disappear — is the
          // dot face: a transparent tile with an inset colored circle, not
          // a solid-fill square (which reads as the *front* of that color).
          const ghost = document.createElement('div');
          ghost.className = 'tile';
          const size = CELL - 4;
          ghost.style.width = size + 'px';
          ghost.style.height = size + 'px';
          ghost.style.left = prev.left + 'px';
          ghost.style.top = prev.top + 'px';
          ghost.style.pointerEvents = 'none';
          const dot = document.createElement('div');
          dot.className = 'dot-circle';
          const dsize = Math.round(size * 0.86);
          dot.style.width = dsize + 'px';
          dot.style.height = dsize + 'px';
          dot.style.background = prev.color;
          ghost.appendChild(dot);
          refs.boardEl.appendChild(ghost);
          if (reduceMotion()) { ghost.remove(); return; }
          ghost.style.transition = `opacity ${COLLAPSE_FADE_MS}ms ease`;
          requestAnimationFrame(() => { ghost.style.opacity = '0'; });
          setTimeout(() => ghost.remove(), COLLAPSE_FADE_MS + 40);
        });
        if (reduceMotion()) return; // final render() already shows the settled state
        setTimeout(slideNow, COLLAPSE_FADE_MS);
      }

      // Returns whether it actually resolved a move (and thus already
      // re-rendered at least once) — the caller needs this so it doesn't
      // blindly render() again right after, which would wipe out a cascade
      // step's ghost/flip/highlight elements before they ever get a frame
      // painted.
      // Checked right after a drag lands, before normal move resolution —
      // red tiles are never removed or flipped (see findMatches/applyLineBonus
      // guards above), so the only way their adjacency ever changes is a row/
      // column shift landing two clusters next to each other.
      function checkBombHazard(): boolean {
        if (!isBomb || !hasRedCluster(grid)) return false;
        render();
        controller.forceEnd(BOMB_HAZARD_REASON, BOMB_HAZARD_PENALTY, '炸弹惩罚');
        return true;
      }

      function applyDrag(): boolean {
        if (!drag || !drag.axis) return false;
        if (drag.axis === 'row') {
          const shift = Math.round(drag.dx / drag.cell);
          if (shift === 0) return false;
          const r = drag.r,
            n = cols;
          grid[r] = grid[r].map((_, i) => grid[r][(((i - shift) % n) + n) % n]);
          if (checkBombHazard()) return true;
          const mask = new Set<string>();
          for (let c = 0; c < cols; c++) mask.add(cellKey(r, c));
          seatLine(refs.boardEl, mask);
          controller.resolveMove(mask, shift > 0 ? 0 : 180);
          return true;
        } else {
          const shift = Math.round(drag.dy / drag.cell);
          if (shift === 0) return false;
          const c = drag.c,
            n = rows;
          const colVals = grid.map((row) => row[c]);
          const shifted = colVals.map((_, i) => colVals[(((i - shift) % n) + n) % n]);
          for (let r = 0; r < rows; r++) grid[r][c] = shifted[r];
          if (checkBombHazard()) return true;
          const mask = new Set<string>();
          for (let r = 0; r < rows; r++) mask.add(cellKey(r, c));
          seatLine(refs.boardEl, mask);
          controller.resolveMove(mask, shift > 0 ? 90 : -90);
          return true;
        }
      }

      const detachDrag = attachDrag(refs.boardWrap, {
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
          // x/y arrive relative to boardWrap, but the board is only flush
          // with it while the grid is still square. .board-wrap centres its
          // child, computeCell() sizes the board at CELL x cols/rows, and
          // removeLines() really does drop a column from the array — so from
          // the first whole-line bonus onward the board sits inset, half a
          // cell further right per cleared column and per cleared row.
          //
          // Assuming a zero origin meant the grabbed column drifted with it:
          // one column cleared and the right half of every cell already
          // picked its neighbour, two and every press did. Measure the real
          // inset instead — it costs one rect per drag, not per frame.
          const wrap = refs.boardWrap.getBoundingClientRect();
          const board = refs.boardEl.getBoundingClientRect();
          const bx = x - (board.left - wrap.left);
          const by = y - (board.top - wrap.top);
          const c = Math.min(cols - 1, Math.max(0, Math.floor(bx / CELL)));
          const r = Math.min(rows - 1, Math.max(0, Math.floor(by / CELL)));
          drag = { r, c, axis: null, dx: 0, dy: 0, cell: CELL, lastShift: 0, chain: null };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.axis) {
            drag.axis = Math.abs(dx) > Math.abs(dy) ? 'row' : 'col';
            drag.chain = createDragChain({
              n: drag.axis === 'row' ? cols : rows,
              grabbed: drag.axis === 'row' ? drag.c : drag.r,
              force: BOARD_FORCE,
              onFrame: renderDragPreview,
            });
          }
          const raw = drag.axis === 'row' ? dx / drag.cell : dy / drag.cell;
          // A light tick each time the drag crosses into a new whole-cell
          // shift — the discrete, physical "click" of passing a detent.
          const shift = Math.round(raw);
          if (shift !== drag.lastShift) {
            vibrate(6);
            playMove();
            drag.lastShift = shift;
          }
          drag.chain?.drive(magnetizeRawDist(raw));
        },
        onEnd(dx, dy) {
          const d = drag;
          if (!d || !d.axis || !d.chain) {
            drag = null;
            if (!controller.resolving) render();
            return;
          }
          d.dx = dx;
          d.dy = dy;
          // The chain carries the line the rest of the way into its slot —
          // the tail keeps swinging for a beat, exactly like the splash —
          // and only then does the move resolve.
          d.chain.settle(Math.round((d.axis === 'row' ? dx : dy) / d.cell), () => {
            d.chain?.stop();
            const moved = applyDrag();
            drag = null;
            // A resolved move already re-rendered (and, for a line bonus, is
            // mid-way through its own fade/collapse transition). Only a
            // no-op drag needs this render to snap the preview clean.
            if (!moved) render();
          });
        },
      });

      const onResize = () => {
        if (!drag && controller.started) render();
      };
      window.addEventListener('resize', onResize);

      refs.buttons.extra['paletteBtn'].addEventListener('click', (e) => {
        paletteName = paletteName === 'standard' ? 'colorblind' : 'standard';
        COLORS = isBomb ? BOMB_PALETTES[paletteName] : PALETTES[paletteName];
        (e.currentTarget as HTMLElement).classList.toggle('active', paletteName === 'colorblind');
        renderLegend();
        if (controller.started) render();
      });

      function destroy() {
        drag?.chain?.stop();
        drag = null;
        controller.destroy();
        detachDrag();
        window.removeEventListener('resize', onResize);
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

      // the board stays empty until Start is pressed — nothing is generated
      // or shown ahead of time — but the legend can render immediately.
      renderLegend();

      return destroy;
    },
  };
}
