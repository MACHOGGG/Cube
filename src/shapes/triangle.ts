import './triangle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnTriangleOutline } from '../engine/scoreOutline';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame } from './types';

// Same Okabe–Ito colorblind-safe 6-hue set the square board offers, reused
// as-is (see square.ts for the palette rationale) so the toggle means the
// same thing on every board.
const PALETTES = {
  standard: ['#3C4452', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#E8E4DC'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;
const ROW_LENS = [7, 9, 11, 11, 9, 7];
const LEFT_TRIM = [0, 0, 0, 1, 3, 5]; // maps local col -> global position p = c + LEFT_TRIM[r]
const GLOBAL_ROW_OFFSET = 3; // local row r -> global big-triangle row i = r+3
const PER_COLOR = 9;
const MIN_LINE_BONUS_LEN = 3;

const GLYPH = `<svg viewBox="0 0 32 32"><polygon points="16,3 29,25 3,25" fill="#4C68B0"/><polygon points="16,29 4,9 28,9" fill="#D89B1E" opacity="0.9"/></svg>`;

interface Line {
  fam: 'A' | 'B' | 'R';
  cells: Cell[];
}

// ---------- diagonal line families (pure geometry, shared by every instance) ----------
// Every triangle has exactly 3 edges: two "row" edges (same i, sharing p±1 with the
// opposite orientation — family R, below) and one "cross" edge into the next i-band.
// Crucially the cross edge only ever runs *forward*: up(i,p) connects to down(i+1,p+1),
// and a down cell's only cross edge is that same one seen backward (to up(i-1,p-1)) —
// there is no separate "down cell's forward cross edge". A straight diagonal line is
// therefore not "same i-p" or "same i+p": it's a zigzag that alternates the cross edge
// with ONE of the two row edges. Alternating with the row-edge whose true geometric
// slope matches the cross edge's own +x lean gives one diagonal direction; alternating
// with the other row edge gives the mirror direction. (An earlier version grouped cells
// by a closed-form column formula that silently only ever picked up one triangle
// orientation — this walks the real adjacency instead, so it can't make that mistake.)
function globalToLocal(i: number, p: number): Cell | null {
  const r = i - GLOBAL_ROW_OFFSET;
  if (r < 0 || r >= ROW_LENS.length) return null;
  const c = p - LEFT_TRIM[r];
  if (c < 0 || c >= ROW_LENS[r]) return null;
  return [r, c];
}
function crossNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i + 1, p + 1) : globalToLocal(i - 1, p - 1);
}
// The neighbor sharing the same slope as an up-cell's own "p+1" edge — for a down
// cell that's its "p-1" neighbor, since a down triangle is the up triangle mirrored.
function rowRightNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i, p + 1) : globalToLocal(i, p - 1);
}
function rowLeftNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i, p - 1) : globalToLocal(i, p + 1);
}

function buildDiagonalFamily(fam: 'A' | 'B'): Line[] {
  const useRowRight = fam === 'B';
  const parent = new Map<string, string>();
  for (let r = 0; r < ROW_LENS.length; r++) for (let c = 0; c < ROW_LENS[r]; c++) parent.set(cellKey(r, c), cellKey(r, c));
  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }
  function union(a: string, b: string) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const neighborsOf = new Map<string, Cell[]>();
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const { i, p } = globalPosPure(r, c);
      const nbrs: Cell[] = [];
      const cross = crossNeighbor(i, p);
      const along = useRowRight ? rowRightNeighbor(i, p) : rowLeftNeighbor(i, p);
      if (cross) { nbrs.push(cross); union(cellKey(r, c), cellKey(cross[0], cross[1])); }
      if (along) { nbrs.push(along); union(cellKey(r, c), cellKey(along[0], along[1])); }
      neighborsOf.set(cellKey(r, c), nbrs);
    }
  const groups = new Map<string, Cell[]>();
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const root = find(cellKey(r, c));
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push([r, c]);
    }
  // Walk each group end-to-end into a single physically-ordered chain (starting
  // from an endpoint where possible) so that shifting the array by N positions
  // means sliding N real steps along the true line, same as the row family.
  const lines: Line[] = [];
  for (const group of groups.values()) {
    const setK = new Set(group.map(([r, c]) => cellKey(r, c)));
    const within = (r: number, c: number) => neighborsOf.get(cellKey(r, c))!.filter(([rr, cc]) => setK.has(cellKey(rr, cc)));
    const start = group.find(([r, c]) => within(r, c).length <= 1) ?? group[0];
    const ordered: Cell[] = [start];
    const seen = new Set([cellKey(start[0], start[1])]);
    let cur = start;
    for (;;) {
      const next = within(cur[0], cur[1]).find(([r, c]) => !seen.has(cellKey(r, c)));
      if (!next) break;
      ordered.push(next);
      seen.add(cellKey(next[0], next[1]));
      cur = next;
    }
    lines.push({ fam, cells: ordered });
  }
  return lines;
}

// (globalPos, defined further below alongside the rest of the render geometry, is
// identical to this — duplicated as a pure function here so line construction doesn't
// depend on render-time state and can run once at module load.)
function globalPosPure(r: number, c: number) {
  return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
}

function allLines(): Line[] {
  const lines: Line[] = [...buildDiagonalFamily('A'), ...buildDiagonalFamily('B')];
  // Third axis: a full horizontal row (up- and down-pointing triangles
  // interleaved). Adjacent triangles in a row are edge-sharing neighbors, so
  // this is a real third slide direction alongside the two diagonals, not
  // just a row/column convenience like the square board's.
  for (let r = 0; r < ROW_LENS.length; r++) {
    lines.push({ fam: 'R', cells: Array.from({ length: ROW_LENS[r] }, (_, c) => [r, c] as Cell) });
  }
  return lines;
}
const LINES = allLines();

// "31"/"13" big-triangle bonus shape: 3 small triangles of one orientation
// plus 1 of the other tile exactly into one triangle twice the size (the
// standard 4-way split of an equilateral triangle) — the closest analogue
// this board has to the square board's 2×2. An up-pointing big triangle is
// its apex cell plus the 3 consecutive same-row cells one band below,
// centered on the apex's forward cross-neighbor (up(i,p)'s only cross edge
// runs to down(i+1,p+1), which sits exactly at the middle of that trio); a
// down-pointing one is the mirror image, one band above.
function bigTriangleUp(r: number, c: number): Cell[] | null {
  const { i, p } = globalPosPure(r, c);
  if (p % 2 !== 0) return null;
  const a = globalToLocal(i + 1, p);
  const b = globalToLocal(i + 1, p + 1);
  const cc = globalToLocal(i + 1, p + 2);
  if (!a || !b || !cc) return null;
  return [[r, c], a, b, cc];
}
function bigTriangleDown(r: number, c: number): Cell[] | null {
  const { i, p } = globalPosPure(r, c);
  if (p % 2 === 0) return null;
  const a = globalToLocal(i - 1, p - 2);
  const b = globalToLocal(i - 1, p - 1);
  const cc = globalToLocal(i - 1, p);
  if (!a || !b || !cc) return null;
  return [[r, c], a, b, cc];
}
function allBigTriangles(): Cell[][] {
  const groups: Cell[][] = [];
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const up = bigTriangleUp(r, c);
      if (up) groups.push(up);
      const down = bigTriangleDown(r, c);
      if (down) groups.push(down);
    }
  return groups;
}
const BIG_TRIANGLES = allBigTriangles();

function lineFor(fam: 'A' | 'B' | 'R', r: number, c: number): Line {
  const line = LINES.find((l) => l.fam === fam && l.cells.some(([rr, cc]) => rr === r && cc === c));
  if (!line) throw new Error('lineFor: cell not found in any line');
  return line;
}

interface DragState {
  r: number;
  c: number;
  fam: 'A' | 'B' | 'R' | null;
  line: Line | null;
  dx: number;
  dy: number;
}

export function createTriangleGame(): ShapeGame {
  const bestKey = 'sugarcube_triangles_best';

  return {
    card: {
      id: 'triangle',
      name: '三角',
      desc: '沿斜线拖动 · 六边蜂窝三角',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack) {
      const refs = buildShell(container, {
        title: 'Slides · 三角',
        tagline: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平、左斜或右斜方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '沿任意一条水平、左斜或右斜方向的线拖动，一条线上连续 4 个同色（不分点/面）得 4 分；4 个三角拼成一个大三角（3 个同朝向 + 1 个反朝向，"31"/"13"）同色时同样得 4 分。得分方块翻成点面。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得 36 分，该线随后淡出并永久清空（棋盘六边形外形不变，但那几格从此不再参与拼图，经过的其他线也会相应变短）。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。全部方块都翻成点面（清空的格子不计入）时结束，结算当时的分数。',
        assumptions:
          '6 种口味色，每色 9 枚，共 54 枚（六边形三角拼接，六行 7/9/11/11/9/7 枚）；每种口味的点色分布为：其余 5 色各 1 枚、本色 4 枚。三个滑动方向——水平、左斜、右斜——每个方向都是 6 条线，长度分别为 7/7/9/9/11/11（与横向的行长完全对应），判分规则完全一致；斜向的一条线由上下两种三角交替组成，和横向的行一样。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = PALETTES[paletteName];
      let grid: Tile[][] = [];
      let S = 0,
        H = 0,
        originX = 0,
        originY = 0;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      let bonusedSignatures = new Set<string>();
      // Cells emptied by a whole-line dot-face bonus: unlike the square
      // grid (a rectangle, where removing a row/column still leaves a valid
      // smaller rectangle), this hexagon has no smaller hexagon to reflow
      // into, so a cleared line's cells are left permanently empty instead —
      // gone from rendering, matching, and every line (row or diagonal) that
      // passes through them, rather than the board itself changing shape.
      let removedCells = new Set<string>();

      function newTile(color: number, dotColor: number): Tile {
        return { id: nextTileId++, color, face: 'flavor', dotColor };
      }

      function shuffledDeck(): number[] {
        const deck: number[] = [];
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < PER_COLOR; i++) deck.push(c);
        return shuffle(deck);
      }

      // per color group of 9: the other 5 colors get 1 each (5) + the tile's
      // own color four times (4) = 9 — matches the physical set's back
      // distribution.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; k < COLORS.length; k++) if (k !== color) others.push(k);
          for (let i = 0; i < 4; i++) others.push(color);
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
        for (const cells of BIG_TRIANGLES) {
          const c0 = g[cells[0][0]][cells[0][1]].color;
          if (cells.every(([r, c]) => g[r][c].color === c0)) return true;
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

      // ---------- geometry: true up/down triangle vertices, from local (r,c) ----------
      function globalPos(r: number, c: number) {
        return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
      }

      function triGeometry(r: number, c: number): { up: boolean; pts: [number, number][] } {
        const { i, p } = globalPos(r, c);
        const up = p % 2 === 0;
        const j = up ? p / 2 : (p - 1) / 2;
        const xBase = (-i * S) / 2 + j * S;
        if (up) {
          const A: [number, number] = [xBase, i * H];
          const B: [number, number] = [xBase - S / 2, (i + 1) * H];
          const C: [number, number] = [xBase + S / 2, (i + 1) * H];
          return { up: true, pts: [A, B, C] };
        }
        const A: [number, number] = [xBase + S / 2, (i + 1) * H];
        const B: [number, number] = [xBase, i * H];
        const C: [number, number] = [xBase + S, i * H];
        return { up: false, pts: [A, B, C] };
      }

      function centroid(pts: [number, number][]): [number, number] {
        return [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
      }

      function layoutBoard() {
        const rect = refs.boardWrap.getBoundingClientRect();
        const boardSize = Math.min(rect.width, rect.height);
        S = boardSize / 6.4;
        H = (S * Math.sqrt(3)) / 2;
        originX = boardSize / 2;
        originY = (boardSize - 6 * H) / 2 - GLOBAL_ROW_OFFSET * H;
        refs.boardEl.style.width = boardSize + 'px';
        refs.boardEl.style.height = boardSize + 'px';
      }

      function toScreen([x, y]: [number, number]): [number, number] {
        return [x + originX, y + originY];
      }

      function makeTriEl(
        tile: Tile,
        r: number,
        c: number,
        opacityOverride?: number,
        offset?: [number, number],
      ): HTMLElement {
        const geo = triGeometry(r, c);
        const [offX, offY] = offset ?? [0, 0];
        const pts = geo.pts.map(toScreen).map(([x, y]) => [x + offX, y + offY] as [number, number]);
        const xs = pts.map((p) => p[0]),
          ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs),
          minY = Math.min(...ys);
        const maxX = Math.max(...xs),
          maxY = Math.max(...ys);
        const w = maxX - minX,
          h = maxY - minY;
        const clip =
          'polygon(' +
          pts.map((p) => `${(((p[0] - minX) / w) * 100).toFixed(2)}% ${(((p[1] - minY) / h) * 100).toFixed(2)}%`).join(',') +
          ')';

        const el = document.createElement('div');
        el.className = 'tri';
        el.style.left = minX + 'px';
        el.style.top = minY + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';

        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.style.clipPath = clip;
        fill.style.setProperty('-webkit-clip-path', clip);

        if (tile.face === 'dot') {
          const cenBase = toScreen(centroid(geo.pts));
          const cen: [number, number] = [cenBase[0] + offX, cenBase[1] + offY];
          // Equilateral triangle's incircle: diameter = S/√3, centered at the
          // centroid (which for an equilateral triangle *is* the incenter).
          const dsize = S / Math.sqrt(3);
          const dot = document.createElement('div');
          dot.className = 'dot-circle';
          dot.style.width = dsize + 'px';
          dot.style.height = dsize + 'px';
          dot.style.left = cen[0] - minX - dsize / 2 + 'px';
          dot.style.top = cen[1] - minY - dsize / 2 + 'px';
          dot.style.background = COLORS[tile.dotColor];
          el.appendChild(fill);
          el.appendChild(dot);
        } else {
          fill.style.background = COLORS[tile.color];
          el.appendChild(fill);
        }
        if (opacityOverride !== undefined) el.style.opacity = String(opacityOverride);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        return el;
      }

      function render() {
        layoutBoard();
        refs.boardEl.innerHTML = '';
        for (let r = 0; r < ROW_LENS.length; r++) {
          for (let c = 0; c < ROW_LENS[r]; c++) {
            if (removedCells.has(cellKey(r, c))) continue;
            refs.boardEl.appendChild(makeTriEl(grid[r][c], r, c));
          }
        }
        // One triangle-shaped outline per tile, not a bounding rectangle
        // around the whole group — adjacent tiles here alternate up/down
        // orientation, so their combined outline is a zigzag, not a clean
        // box, and a rectangle would highlight empty corners no tile
        // occupies.
        for (const { cells, elapsedMs } of outlineTracker.current()) {
          for (const [r, c] of cells) {
            spawnTriangleOutline(refs.boardEl, triGeometry(r, c).pts.map(toScreen), elapsedMs);
          }
        }
      }

      function anyRemoved(cells: Cell[]): boolean {
        return cells.some(([r, c]) => removedCells.has(cellKey(r, c)));
      }

      // ---------- matching engine ----------
      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const windowCells = cells.slice(i, i + 4);
            if (anyRemoved(windowCells)) continue;
            const c0 = effColor(grid[windowCells[0][0]][windowCells[0][1]]);
            if (!windowCells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
            if (mask && !windowCells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
            matches.push({ cells: windowCells, points: 4 });
          }
        }
        for (const cells of BIG_TRIANGLES) {
          if (anyRemoved(cells)) continue;
          const c0 = effColor(grid[cells[0][0]][cells[0][1]]);
          if (!cells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
          if (mask && !cells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
          matches.push({ cells, points: 4 });
        }
        return matches;
      }

      // A line only qualifies once every tile in it has flipped to its dot
      // face *and* those dot colors all match — a mix of flavor-face and
      // dot-face tiles no longer counts, even if their effective colors
      // happen to agree.
      function isFullDotMatch(cells: Cell[]): boolean {
        if (cells.some(([r, c]) => grid[r][c].face !== 'dot')) return false;
        const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
        return cells.every(([r, c]) => grid[r][c].dotColor === c0);
      }

      function findWholeLineBonuses(): Cell[][] {
        const found: Cell[][] = [];
        for (const line of LINES) {
          if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
          // A line missing any of its cells to an earlier bonus can never
          // qualify again — those cells aren't there to flip or match.
          if (anyRemoved(line.cells)) continue;
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

      // Flips the bonused line's tiles to their dot face (matching what the
      // player just saw complete) and then empties those cells for good —
      // see the note on removedCells above for why a hole, not a reflowed
      // smaller board, is this shape's version of square's line removal.
      function applyLineBonus(groups: Cell[][]) {
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const t = grid[r][c];
            if (t.face === 'flavor') t.face = 'dot';
            removedCells.add(cellKey(r, c));
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
        return grid.every((row, r) =>
          row.every((t, c) => removedCells.has(cellKey(r, c)) || t.face === 'dot'),
        );
      }

      function resetBoard() {
        grid = generateCleanBoard();
        bonusedSignatures = new Set();
        removedCells = new Set();
        outlineTracker.reset();
      }

      const controller = createGameController(refs, {
        bestKey,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        // Regular matches (run-of-4 and the big-triangle cluster) stay on
        // the board, so they get the persistent outline highlight, added
        // per cascade step so a chain reaction reveals one beat at a time.
        // A whole-line bonus instead empties its cells (see applyLineBonus)
        // — its own fade-out is that event's feedback, not outlined —
        // played in onCascadeStepRendered since the ghost must be appended
        // *after* this step's own render() or that render() would wipe it.
        onCascadeStep: ({ matchGroups }) => outlineTracker.add(matchGroups),
        onCascadeStepRendered: ({ lineBonusGroups }) => {
          if (lineBonusGroups.length) playRemovalFade(lineBonusGroups);
        },
      });

      const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const REMOVE_FADE_MS = 700;

      // Nothing else needs to move when a line empties (no reflow, per
      // removedCells above), so this is just a fade: the real render() has
      // already stopped drawing these cells by the time this runs, leaving
      // a clean gap immediately — a translucent copy of each tile (already
      // flipped to its dot face) fades out over that gap and removes itself.
      function playRemovalFade(groups: Cell[][]) {
        if (reduceMotion()) return;
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const ghost = makeTriEl(grid[r][c], r, c);
            ghost.classList.add('ghost');
            ghost.style.pointerEvents = 'none';
            refs.boardEl.appendChild(ghost);
            ghost.style.transition = `opacity ${REMOVE_FADE_MS}ms ease`;
            requestAnimationFrame(() => { ghost.style.opacity = '0'; });
            setTimeout(() => ghost.remove(), REMOVE_FADE_MS + 40);
          }
        }
      }

      // ---------- drag interaction ----------
      let drag: DragState | null = null;

      function cellAt(x: number, y: number): Cell {
        let best: Cell = [0, 0];
        let bestDist = Infinity;
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const cen = toScreen(centroid(triGeometry(r, c).pts));
            const dist = (cen[0] - x) ** 2 + (cen[1] - y) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              best = [r, c];
            }
          }
        return best;
      }

      // True per-index-step displacement (screen pixels) along each family's
      // line. A/B share a uniform S-pixel step (hypot(S/2,H)=S exactly, the
      // whole point of the u-centered coordinate system) regardless of row
      // width. A row's x-coordinate is an *exact* linear function of the
      // column — S/2 pixels per step — regardless of the up/down triangles'
      // zigzag in y, so (S/2, 0) is its true step vector and the zigzag
      // simply never enters the projection.
      function trueStepVector(fam: 'A' | 'B' | 'R'): [number, number] {
        if (fam === 'A') return [S / 2, H];
        if (fam === 'B') return [-S / 2, H];
        return [S / 2, 0];
      }

      // Pixels of the drag that point along this family's direction — used
      // only to pick the best-aligned family among the three (dividing by
      // |v| makes the comparison fair despite A/B and the row not sharing
      // one step magnitude).
      function scalarProjection(fam: 'A' | 'B' | 'R', dx: number, dy: number): number {
        const [ux, uy] = trueStepVector(fam);
        return (dx * ux + dy * uy) / Math.hypot(ux, uy);
      }

      // How many index-steps along this family's line the drag corresponds
      // to: the orthogonal-projection coefficient rawDist such that
      // rawDist*v best matches the raw drag vector, i.e. (drag·v)/|v|² — NOT
      // (drag·v)/|v|, which would leave every step read as if the player had
      // dragged the whole line's own step-length again on top of itself.
      function projectedSteps(fam: 'A' | 'B' | 'R', dx: number, dy: number): number {
        const [ux, uy] = trueStepVector(fam);
        const proj = dx * ux + dy * uy;
        return proj / (ux * ux + uy * uy);
      }

      // Every real tile in the line translates by the same rawDist*step
      // vector (exact for A/B, a smooth approximation of the row's zigzag
      // that's visually unnoticeable mid-drag and irrelevant the instant it
      // settles, since the final render() after release always uses the
      // real, non-approximated geometry). Wraparound ghosts one full line-
      // length before/after each real cell keep the line reading as an
      // unbroken loop while dragging, the same way the square and circle
      // boards already do, instead of the old clamp-at-the-ends behavior
      // that left overflow tiles stacked in place with nothing to show
      // where they were headed.
      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam || !d.line) return;
        const cells = d.line.cells;
        const n = cells.length;
        const rawDist = magnetizeRawDist(projectedSteps(d.fam, d.dx, d.dy));
        const [dirX, dirY] = trueStepVector(d.fam);

        // Every line here — row or either diagonal — runs from one hexagon
        // edge to the opposite edge, with no surrounding slack: unlike the
        // square board (a rectangle clipped cleanly by its container's own
        // overflow:hidden), there's no empty margin around a hex line for an
        // overshooting tile to sit in without visibly poking past the
        // hexagon's silhouette into the board element's padding. So real
        // tiles and their wraparound ghosts get only a hairline's tolerance
        // (float-jitter safety, not visual slack) past their line's own
        // [0, n-1] span, rather than the half-a-slot grace that's fine on a
        // board with room to spare.
        const EDGE_EPS = 0.03;
        for (let idx = 0; idx < n; idx++) {
          const [r, c] = cells[idx];
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (!el) continue;
          const curLeft = parseFloat(el.style.left);
          const curTop = parseFloat(el.style.top);
          el.style.left = curLeft + rawDist * dirX + 'px';
          el.style.top = curTop + rawDist * dirY + 'px';
          const pos = idx + rawDist;
          if (pos < -EDGE_EPS || pos > n - 1 + EDGE_EPS) el.style.opacity = '0';
        }

        for (let k = -1; k <= 1; k++) {
          if (k === 0) continue;
          for (let i = 0; i < n; i++) {
            const pos = i + rawDist + k * n;
            if (pos < -EDGE_EPS || pos > n - 1 + EDGE_EPS) continue;
            const [r0, c0] = cells[i];
            const offset: [number, number] = [(pos - i) * dirX, (pos - i) * dirY];
            const ghost = makeTriEl(grid[r0][c0], r0, c0, 0.42, offset);
            ghost.classList.add('ghost');
            refs.boardEl.appendChild(ghost);
          }
        }
      }

      function applyDrag() {
        const d = drag;
        if (!d || !d.fam || !d.line) return;
        const cells = d.line.cells;
        const n = cells.length;
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy));
        if (((shift % n) + n) % n === 0) return;
        const vals = cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[(((i - shift) % n) + n) % n]);
        cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        const mask = new Set<string>(cells.map(([r, c]) => cellKey(r, c)));
        controller.resolveMove(mask);
      }

      // A line with any emptied cell (from an earlier bonus — see
      // removedCells above) can't be dragged: there's nothing there to slide
      // into place. Checked once per line at family-selection time so
      // renderDragPreview/applyDrag never have to worry about holes.
      function lineIsPlayable(line: Line): boolean {
        return !anyRemoved(line.cells);
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onStart(x, y) {
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0 };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const candidates = (['A', 'B', 'R'] as const)
              .map((fam) => ({ fam, line: lineFor(fam, drag!.r, drag!.c) }))
              .filter(({ line }) => lineIsPlayable(line))
              .map(({ fam, line }) => ({ fam, line, proj: Math.abs(scalarProjection(fam, dx, dy)) }));
            if (!candidates.length) return; // started on/near a hole with no playable direction
            candidates.sort((a, b) => b.proj - a.proj);
            drag.fam = candidates[0].fam;
            drag.line = candidates[0].line;
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
