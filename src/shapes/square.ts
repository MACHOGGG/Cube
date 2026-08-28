import './square.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { floodFillSameColor } from '../engine/floodfill';
import type { BoardSnapshot, SnapshotCell } from '../engine/shareCard';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
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

const BOARD_DIM = 6;

const GLYPH = `<svg viewBox="0 0 32 32"><rect x="2" y="2" width="12" height="12" rx="3" fill="#C46A4E"/><rect x="18" y="2" width="12" height="12" rx="3" fill="#4A9573"/><rect x="2" y="18" width="12" height="12" rx="3" fill="#4C7EAD"/><rect x="18" y="18" width="12" height="12" rx="3" fill="#AD5C82"/></svg>`;

interface DragState {
  r: number;
  c: number;
  axis: 'row' | 'col' | null;
  dx: number;
  dy: number;
  cell: number;
  lastShift: number;
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
      const refs = buildShell(container, {
        title: 'Slides · 方块',
        tagline: '拖动一整行或一整列 · 拼出同色图案 · 翻成点面继续联通',
        startBody: '拖动整行/整列拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '只有 2×2 或一整条 1×4 / 4×1 的同色图案才能得分（4分，超过 4 个则按实际数量得分，且与该图案相邻的同色方块也会一并计入），得分方块翻成点面继续联通。同一局中，与刚得分的同一局部图案完全相同（同样的位置与颜色）不会连续再次得分。当整行或整列都翻成点面且点色相同时，额外得该行/列长度的平方分，该行/列随后淡出消失，两侧方块滑动收拢补位。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。当棋盘上所有方块都翻成点面时，挑战结束，结算当时的分数。',
        assumptions:
          '默认为降饱和的柔和配色；点击"色盲友好配色"可切换为 Okabe–Ito 标准色盲友好色系。6 种颜色各 6 枚，共 36 枚；每种颜色的点色分布为：其余 5 色各 1 枚、本色 1 枚。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = PALETTES[paletteName];

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
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const key = cellKey(r, c);
            const el = makeTileEl(grid[r][c], r, c, CELL);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key), true);
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            refs.boardEl.appendChild(el);
          }
        }
        flipInCells = new Set();
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

      function squareNeighbors(r: number, c: number): Cell[] {
        const out: Cell[] = [];
        if (r > 0) out.push([r - 1, c]);
        if (r < rows - 1) out.push([r + 1, c]);
        if (c > 0) out.push([r, c - 1]);
        if (c < cols - 1) out.push([r, c + 1]);
        return out;
      }
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }

      // A qualifying seed (2x2 or a straight run-of-4 window) expands via
      // flood fill to the full connected same-color region before scoring —
      // a longer run (5, 6, ...) or any extra same-color tile touching the
      // seed folds into the same match, worth the region's own size (never
      // less than the 4-cell minimum). Two overlapping seed windows inside
      // one longer run flood-fill to the exact same final region, so the
      // existing per-cascade-step tile-id dedup in scoring.ts collapses them
      // into a single scored match rather than double-counting it.
      function pushExpandedMatch(matches: Match[], seed: Cell[], mask: Set<string> | null) {
        if (!cellsSameColor(seed) || !touches(seed, mask)) return;
        const region = floodFillSameColor(seed, effColorAt, squareNeighbors);
        matches.push({ cells: region, points: Math.max(4, region.length) });
      }

      function findMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (let r = 0; r < rows - 1; r++)
          for (let c = 0; c < cols - 1; c++) {
            pushExpandedMatch(
              matches,
              [
                [r, c],
                [r, c + 1],
                [r + 1, c],
                [r + 1, c + 1],
              ],
              mask,
            );
          }
        for (let r = 0; r < rows; r++)
          for (let c = 0; c <= cols - 4; c++) {
            pushExpandedMatch(
              matches,
              [
                [r, c],
                [r, c + 1],
                [r, c + 2],
                [r, c + 3],
              ],
              mask,
            );
          }
        for (let c = 0; c < cols; c++)
          for (let r = 0; r <= rows - 4; r++) {
            pushExpandedMatch(
              matches,
              [
                [r, c],
                [r + 1, c],
                [r + 2, c],
                [r + 3, c],
              ],
              mask,
            );
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
        const allDot = grid.length > 0 && grid.every((row) => row.every((t) => t.face === 'dot'));
        return allDot || rows === 0 || cols === 0;
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) live.push({ cell: [r, c], tile: grid[r][c] });
        return live;
      }

      function findStuckGroups(): Cell[][] {
        return findStuckColorGroups(liveTiles());
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
        grid = generateCleanBoard();
        outlineTracker.reset();
        stuckKeys = null;
      }

      const controller = createGameController(refs, {
        bestKey: opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: '方块',
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
        if (!drag || !drag.axis) return;
        const cell = drag.cell;
        // A light tick each time the drag crosses into a new whole-cell
        // shift — the discrete, physical "click" of passing a detent, felt
        // (haptics) rather than only inferred from the drag's positional
        // easing.
        const rawShift = drag.axis === 'row' ? drag.dx / cell : drag.dy / cell;
        const shift = Math.round(rawShift);
        if (shift !== drag.lastShift) {
          vibrate(6);
          drag.lastShift = shift;
        }
        if (drag.axis === 'row') {
          const r = drag.r;
          const span = cols * cell;
          // Magnetized in cell-units then scaled back to pixels: each tile
          // sticks near its current slot and needs a decisive push past the
          // midpoint to let go, instead of drifting continuously with the
          // pointer — the same "kept a slot" feel the row/col drag physically
          // ought to have.
          const magDx = magnetizeRawDist(drag.dx / cell) * cell;
          for (let c = 0; c < cols; c++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) el.style.left = c * cell + magDx + 'px';
          }
          const fadeRange = cell * 0.4;
          for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            for (let c = 0; c < cols; c++) {
              const x = c * cell + magDx + k * span;
              const fade = edgeFade(x, -cell, span, fadeRange);
              if (fade <= 0) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.55 * fade);
              ghost.classList.add('ghost');
              ghost.style.left = x + 'px';
              refs.boardEl.appendChild(ghost);
            }
          }
        } else {
          const c = drag.c;
          const span = rows * cell;
          const magDy = magnetizeRawDist(drag.dy / cell) * cell;
          for (let r = 0; r < rows; r++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) el.style.top = r * cell + magDy + 'px';
          }
          const fadeRange = cell * 0.4;
          for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            for (let r = 0; r < rows; r++) {
              const y = r * cell + magDy + k * span;
              const fade = edgeFade(y, -cell, span, fadeRange);
              if (fade <= 0) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.55 * fade);
              ghost.classList.add('ghost');
              ghost.style.top = y + 'px';
              refs.boardEl.appendChild(ghost);
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
      function applyDrag(): boolean {
        if (!drag || !drag.axis) return false;
        if (drag.axis === 'row') {
          const shift = Math.round(drag.dx / drag.cell);
          if (shift === 0) return false;
          const r = drag.r,
            n = cols;
          grid[r] = grid[r].map((_, i) => grid[r][(((i - shift) % n) + n) % n]);
          const mask = new Set<string>();
          for (let c = 0; c < cols; c++) mask.add(cellKey(r, c));
          controller.resolveMove(mask);
          return true;
        } else {
          const shift = Math.round(drag.dy / drag.cell);
          if (shift === 0) return false;
          const c = drag.c,
            n = rows;
          const colVals = grid.map((row) => row[c]);
          const shifted = colVals.map((_, i) => colVals[(((i - shift) % n) + n) % n]);
          for (let r = 0; r < rows; r++) grid[r][c] = shifted[r];
          const mask = new Set<string>();
          for (let r = 0; r < rows; r++) mask.add(cellKey(r, c));
          controller.resolveMove(mask);
          return true;
        }
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onRejected: () => vibrate(15),
        onStart(x, y) {
          const c = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
          const r = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
          drag = { r, c, axis: null, dx: 0, dy: 0, cell: CELL, lastShift: 0 };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.axis) drag.axis = Math.abs(dx) > Math.abs(dy) ? 'row' : 'col';
          renderDragPreview();
        },
        onEnd(dx, dy) {
          let moved = false;
          if (drag) {
            drag.dx = dx;
            drag.dy = dy;
            moved = applyDrag();
          }
          drag = null;
          // A resolved move already re-rendered (and, for a line bonus, is
          // mid-way through its own fade/collapse transition) — rendering
          // again here would erase that before a single frame of it paints.
          // Only a no-op drag (shift === 0) needs this to snap the preview's
          // manual style tweaks back to a clean rest state.
          if (!moved) render();
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
