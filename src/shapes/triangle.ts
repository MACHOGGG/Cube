import './triangle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnTriangleOutline, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { floodFillSameColor } from '../engine/floodfill';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintRow, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame, ShapeGameOpts } from './types';

// Same Okabe–Ito colorblind-safe 6-hue set the square board offers, reused
// as-is (see square.ts for the palette rationale) so the toggle means the
// same thing on every board.
const PALETTES = {
  standard: ['#3C4452', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#9B958D'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;
const ROW_LENS = [7, 9, 11, 11, 9, 7];
const LEFT_TRIM = [0, 0, 0, 1, 3, 5]; // maps local col -> global position p = c + LEFT_TRIM[r]
const GLOBAL_ROW_OFFSET = 3; // local row r -> global big-triangle row i = r+3
const PER_COLOR = 9;
const MIN_LINE_BONUS_LEN = 3;

const GLYPH = `<svg viewBox="0 0 32 32"><polygon points="16,3 29,25 3,25" fill="#4C68B0"/><polygon points="16,29 4,9 28,9" fill="#D89B1E" opacity="0.9"/></svg>`;

// The board's 2 seed patterns (see findRunMatches/BIG_TRIANGLES below),
// built with the exact same up/down triangle geometry snapshotBoard() uses
// (global row i, global position p), drawn as blank outlines for the
// in-HUD pattern hint.
const ICON_H = Math.sqrt(3) / 2;
function iconTri(i: number, p: number): [number, number][] {
  const up = p % 2 === 0;
  const j = up ? p / 2 : (p - 1) / 2;
  const xBase = -i / 2 + j;
  return up
    ? [[xBase, i * ICON_H], [xBase - 0.5, (i + 1) * ICON_H], [xBase + 0.5, (i + 1) * ICON_H]]
    : [[xBase + 0.5, (i + 1) * ICON_H], [xBase, i * ICON_H], [xBase + 1, i * ICON_H]];
}
const PATTERNS: PatternDef[] = [
  {
    label: '1×4',
    cells: [0, 1, 2, 3].map((p) => ({ kind: 'poly' as const, points: iconTri(0, p) })),
  },
  {
    label: '大三角',
    cells: [[0, 0], [1, 0], [1, 1], [1, 2]].map(([i, p]) => ({ kind: 'poly' as const, points: iconTri(i, p) })),
  },
];

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
  lastShift: number;
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
    mount(container, onBack, opts?: ShapeGameOpts) {
      const refs = buildShell(container, {
        title: 'Slides · 三角',
        tagline: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平、左斜或右斜方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '沿任意一条水平、左斜或右斜方向的线拖动，一条线上连续 4 个同色（不分点/面）得 4 分，超过 4 个则按实际数量得分，且与该图案相邻的同色三角也会一并计入；4 个三角拼成一个大三角（3 个同朝向 + 1 个反朝向，"31"/"13"）同色时同样适用。得分方块翻成点面。同一局中，与刚得分的同一局部图案完全相同（同样的位置与颜色）不会连续再次得分。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得该线长度的平方分，该线随后淡出并永久清空（棋盘六边形外形不变，但那几格从此不再参与拼图，经过的其他线也会相应变短）。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。全部方块都翻成点面（清空的格子不计入）时结束，结算当时的分数。',
        assumptions:
          '6 种口味色，每色 9 枚，共 54 枚（六边形三角拼接，六行 7/9/11/11/9/7 枚）；每种口味的点色分布为：其余 5 色各 1 枚、本色 4 枚。三个滑动方向——水平、左斜、右斜——每个方向都是 6 条线，长度分别为 7/7/9/9/11/11（与横向的行长完全对应），判分规则完全一致；斜向的一条线由上下两种三角交替组成，和横向的行一样。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
        patternHint: renderPatternHintRow(PATTERNS),
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
      // A whole-line dot-face bonus doesn't remove its cells: same as
      // circle's blank ball (see circle.ts), a bonused triangle just loses
      // its color for good (the BLANK sentinel) while staying a real,
      // slidable tile — this hexagon has no smaller hexagon to reflow into,
      // so there's nothing to gain by punching a permanent hole, and
      // leaving it in play means later drags can still move it out of the
      // way of the cells around it.
      const BLANK = -1;
      function isBlank(t: Tile): boolean {
        return t.color === BLANK;
      }
      function anyBlank(cells: Cell[]): boolean {
        return cells.some(([r, c]) => isBlank(grid[r][c]));
      }
      // Cells whose flip to their dot face just landed (set in onCommit,
      // consumed and cleared by the very next render()) — those cells get a
      // one-shot .flip-in animation class so the flip itself has motion
      // instead of the face silently swapping.
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

        if (isBlank(tile)) {
          // Spent: a hollow outline, not a filled dim triangle — this
          // palette's own muted gray (#9B958D) sits too close to a dim fill
          // to read as reliably different at a glance (same fix already
          // applied to circleHex's blank balls). No fill at all reads
          // unambiguously as "an empty slot" in any palette, while the
          // outline still shows a piece is here and still slides with its
          // line.
          const cen = centroid(pts);
          const RING_SCALE = 0.88;
          const ringPts = pts.map(([x, y]) => [cen[0] + (x - cen[0]) * RING_SCALE, cen[1] + (y - cen[1]) * RING_SCALE] as [number, number]);
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('viewBox', '0 0 100 100');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.style.position = 'absolute';
          svg.style.left = '0';
          svg.style.top = '0';
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.overflow = 'visible';
          const poly = document.createElementNS(svgNS, 'polygon');
          poly.setAttribute(
            'points',
            ringPts.map(([x, y]) => `${(((x - minX) / w) * 100).toFixed(2)},${(((y - minY) / h) * 100).toFixed(2)}`).join(' '),
          );
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke', 'var(--ink-faint)');
          poly.setAttribute('stroke-width', '3.5');
          poly.setAttribute('stroke-linejoin', 'round');
          poly.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(poly);
          el.appendChild(svg);
        } else if (tile.face === 'dot') {
          // A same-size same-shape triangle read as "still the front, just a
          // different color" — the dot face needs its own distinct glyph.
          // A smaller triangle (same orientation, shrunk toward the
          // centroid) reads clearly as "the back" without the clutter of a
          // small inscribed circle, and a near-black stroke marks it unambiguously
          // as the flipped face. Built as an SVG polygon (fill + stroke
          // together, exactly the technique spawnTriangleOutline already
          // uses for the score highlight) rather than a clip-path div, since
          // clip-path can't render a clean border following a triangular
          // silhouette.
          const cen = centroid(pts);
          const DOT_SCALE = 0.6;
          const innerPts = pts.map(([x, y]) => [cen[0] + (x - cen[0]) * DOT_SCALE, cen[1] + (y - cen[1]) * DOT_SCALE] as [number, number]);
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('viewBox', '0 0 100 100');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.style.position = 'absolute';
          svg.style.left = '0';
          svg.style.top = '0';
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.overflow = 'visible';
          const poly = document.createElementNS(svgNS, 'polygon');
          poly.setAttribute(
            'points',
            innerPts.map(([x, y]) => `${(((x - minX) / w) * 100).toFixed(2)},${(((y - minY) / h) * 100).toFixed(2)}`).join(' '),
          );
          poly.setAttribute('fill', COLORS[tile.dotColor]);
          poly.setAttribute('stroke', '#1A1A1A');
          poly.setAttribute('stroke-width', '3.5');
          poly.setAttribute('stroke-linejoin', 'round');
          poly.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(poly);
          el.appendChild(fill);
          el.appendChild(svg);
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
        const outlineEntries = outlineTracker.current();
        const pulseMs = new Map<string, number>();
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) pulseMs.set(cellKey(r, c), elapsedMs);
        }
        for (let r = 0; r < ROW_LENS.length; r++) {
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const key = cellKey(r, c);
            const el = makeTriEl(grid[r][c], r, c);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key));
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            refs.boardEl.appendChild(el);
          }
        }
        flipInCells = new Set();
        // One triangle-shaped outline per tile, not a bounding rectangle
        // around the whole group — adjacent tiles here alternate up/down
        // orientation, so their combined outline is a zigzag, not a clean
        // box, and a rectangle would highlight empty corners no tile
        // occupies.
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) {
            spawnTriangleOutline(refs.boardEl, triGeometry(r, c).pts.map(toScreen), elapsedMs);
          }
        }
      }

      // Each triangle touches exactly 3 others edge-to-edge: the cross edge
      // into the next i-band, and its two in-row neighbors — see the LINES
      // family comment above for why these three (not a closed-form column
      // rule) are the real adjacency. Used to expand a qualifying seed match
      // (a run-4 window or a 31/13 big-triangle) into its full connected
      // same-color region.
      function triNeighbors(r: number, c: number): Cell[] {
        const { i, p } = globalPosPure(r, c);
        const out: Cell[] = [];
        for (const cand of [crossNeighbor(i, p), rowLeftNeighbor(i, p), rowRightNeighbor(i, p)]) {
          if (cand && !isBlank(grid[cand[0]][cand[1]])) out.push(cand);
        }
        return out;
      }
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }
      function pushExpandedMatch(matches: Match[], seed: Cell[], mask: Set<string> | null) {
        if (anyBlank(seed)) return;
        const c0 = effColor(grid[seed[0][0]][seed[0][1]]);
        if (!seed.every(([r, c]) => effColor(grid[r][c]) === c0)) return;
        if (mask && !seed.some(([r, c]) => mask.has(cellKey(r, c)))) return;
        const region = floodFillSameColor(seed, effColorAt, triNeighbors);
        matches.push({ cells: region, points: Math.max(4, region.length) });
      }

      // ---------- matching engine ----------
      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            pushExpandedMatch(matches, cells.slice(i, i + 4), mask);
          }
        }
        for (const cells of BIG_TRIANGLES) {
          pushExpandedMatch(matches, cells, mask);
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
          // A line with any already-blanked cell can never qualify again —
          // a blank has no color to agree with the rest of the line.
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

      // Flips the bonused line's tiles to their dot face (matching what the
      // player just saw complete), stashes that dot color for the fade
      // transition (see pendingBlankSnapshot below — grid is about to be
      // overwritten, so this is the last point that still has it), and then
      // blanks the cells for good.
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
        return grid.every((row) => row.every((t) => isBlank(t) || t.face === 'dot'));
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const t = grid[r][c];
            if (!isBlank(t)) live.push({ cell: [r, c], tile: t });
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
        const H = Math.sqrt(3) / 2;
        const raw: RawCell[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const tile = grid[r][c];
            const { i, p } = globalPos(r, c);
            const up = p % 2 === 0;
            const j = up ? p / 2 : (p - 1) / 2;
            const xBase = -i / 2 + j;
            const points: [number, number][] = up
              ? [[xBase, i * H], [xBase - 0.5, (i + 1) * H], [xBase + 0.5, (i + 1) * H]]
              : [[xBase + 0.5, (i + 1) * H], [xBase, i * H], [xBase + 1, i * H]];
            raw.push({ kind: 'poly', points, face: isBlank(tile) ? 'blank' : tile.face, color: COLORS[effColor(tile)] });
          }
        return packSnapshot(raw);
      }

      function highlightStuck(cells: Cell[] | null) {
        stuckKeys = cells ? new Set(cells.map(([r, c]) => cellKey(r, c))) : null;
      }

      function resetBoard() {
        grid = generateCleanBoard();
        bonusedSignatures = new Set();
        outlineTracker.reset();
        stuckKeys = null;
      }

      const controller = createGameController(refs, {
        bestKey: opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: '三角',
        timeLimitSec: opts?.timeLimitSec,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        findStuckGroups,
        countRemainingTiles,
        snapshotBoard,
        highlightStuck,
        // Regular matches (run-of-4 and the big-triangle cluster) stay on
        // the board, so they get the persistent outline highlight, added
        // per cascade step so a chain reaction reveals one beat at a time.
        // A whole-line bonus instead blanks its cells (see applyLineBonus)
        // — its own fade transition is that event's feedback, not outlined
        // — played in onCascadeStepRendered since the ghost must be
        // appended *after* this step's own render() or that render() would
        // wipe it.
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
      // Captured by applyLineBonus (the only point that still has the old
      // dot color, right before overwriting it to BLANK) and consumed here
      // once render() has painted the new blank state, so the fade shows
      // the *old* dot-colored look dissolving into the *new* blank tile
      // already sitting beneath it, rather than fading to an empty gap.
      let pendingBlankSnapshot = new Map<string, number>();

      function playBlankTransition(groups: Cell[][], snapshot: Map<string, number>) {
        if (reduceMotion()) return;
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const dotColor = snapshot.get(cellKey(r, c));
            if (dotColor === undefined) continue;
            const fakeTile: Tile = { id: -1, color: 0, face: 'dot', dotColor };
            const ghost = makeTriEl(fakeTile, r, c);
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

      // Unlike square's tiles or circle's balls, a triangle's own shape
      // depends on which slot it's in — every line here strictly alternates
      // up/down from one cell to the next (confirmed: no line on this board
      // ever has two consecutive same-orientation cells). Up and down
      // triangles are mirror images, not translations of each other, so
      // sliding a *fixed* clip-path element sideways by raw pixels (as an
      // earlier version of this did) puts the wrong silhouette at half the
      // positions it passes through — it only ever looked right again once
      // the drag settled and a real render() rebuilt every shape from
      // scratch, which is exactly the "shape/position changes, or the move
      // seems to snap back" effect players were seeing mid-drag.
      //
      // The fix: never move a shaped element. Each of the n slots in the
      // line keeps its own fixed shape+position (from its own true
      // geometry) always — only *which tile's color* renders in that slot
      // changes, via the same modular remap applyDrag will commit on
      // release (so the preview can never show a configuration release
      // wouldn't). This also makes the line a genuine cyclic buffer: every
      // slot is always populated by construction, so there's no "overflow"
      // and thus no wraparound ghosts needed at all.
      //
      // A *shift* by itself still leaves a residual problem every line here
      // shares: every line has an ODD number of cells (7/9/11 — a hexagon
      // built from small triangles can't have an even-length row or
      // diagonal), and an odd-length cycle can't be perfectly 2-colored —
      // so ordinary rotation always mismatches some tiles' orientation once
      // content wraps from one end to the other. The fix used here has two
      // parts: (1) the "moving unit" — the tiles that stay within the
      // line's own span, not wrapping — only ever settles on an EVEN shift,
      // which (given strict alternation) *always* keeps every one of those
      // tiles correctly oriented; (2) the wrapped tiles ("filler", shown
      // dimmed as a preview of what's flowing in) always mismatch by
      // exactly one step under an even shift, but adjacent slots always
      // alternate orientation too — so swapping which of each ADJACENT PAIR
      // of filler slots gets which tile's content exactly cancels that
      // mismatch. The filler region's size always equals the (even) shift,
      // so it always splits into whole pairs with nothing left over.
      function fillerAwareSource(idx: number, shift: number, n: number): number {
        const plain = (((idx - shift) % n) + n) % n;
        if (shift === 0) return plain;
        const fillerSize = Math.abs(shift);
        const regionStart = shift > 0 ? 0 : n - fillerSize;
        const inFiller = shift > 0 ? idx < fillerSize : idx >= regionStart;
        if (!inFiller) return plain;
        const localIdx = idx - regionStart;
        const partnerIdx = regionStart + (localIdx % 2 === 0 ? localIdx + 1 : localIdx - 1);
        return (((partnerIdx - shift) % n) + n) % n;
      }

      const FILLER_OPACITY = 0.55;

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam || !d.line) return;
        const cells = d.line.cells;
        const n = cells.length;
        // Magnetize toward the nearest EVEN step (halve, snap, double) so
        // the "moving unit" only ever settles at an orientation-preserving
        // shift — odd intermediate positions are passed through smoothly
        // while dragging but are never a stable rest point. A gentler power
        // than the other boards' per-step snap (each detent here is twice
        // as far apart, so the same curve would otherwise pull noticeably
        // harder over that longer stretch and feel forced rather than guided).
        const half = magnetizeRawDist(projectedSteps(d.fam, d.dx, d.dy) / 2, 1.5);
        const shift = 2 * Math.round(half);
        // A light tick each time the drag crosses into a new suitable
        // (even) configuration — the discrete, physical "click" of passing
        // a detent, felt (haptics) and not just inferred from the drag's
        // subtler positional easing.
        if (shift !== d.lastShift) {
          vibrate(6);
          d.lastShift = shift;
        }
        // The small leftover distance from that nearest snap point: near
        // zero almost all the time (magnetizeRawDist sticks close to even
        // integers), growing toward ±1 only while passing through the
        // midpoint to the next suitable slot — used as a tiny same-shape
        // nudge so a slot's content still visibly "gives" a little instead
        // of teleporting.
        // Damped a bit further than a per-step board would need: a detent
        // spacing twice as wide means the same raw residual swings the
        // "give" over twice the pixel distance, which read as a much
        // bigger, harder wobble than the softened curve above alone fixed.
        const residual = (2 * half - shift) * 0.6;
        const [dirX, dirY] = trueStepVector(d.fam);
        const offset: [number, number] = [residual * dirX, residual * dirY];
        const fillerSize = Math.abs(shift);

        for (let idx = 0; idx < n; idx++) {
          const [r, c] = cells[idx];
          const sourceIdx = fillerAwareSource(idx, shift, n);
          const [sr, sc] = cells[sourceIdx];
          const isFiller = shift > 0 ? idx < fillerSize : idx >= n - fillerSize;
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) el.remove();
          refs.boardEl.appendChild(makeTriEl(grid[sr][sc], r, c, isFiller ? FILLER_OPACITY : undefined, offset));
        }
      }

      // Returns whether it actually resolved a move (and thus already
      // re-rendered at least once) — the caller needs this so it doesn't
      // blindly render() again right after, which would wipe out a cascade
      // step's ghost/flip/highlight elements before they ever get a frame
      // painted (resolveMove no longer settles synchronously — see
      // gameController's stepper-driven reveal).
      function applyDrag(): boolean {
        const d = drag;
        if (!d || !d.fam || !d.line) return false;
        const cells = d.line.cells;
        const n = cells.length;
        // Same even-rounding as the preview (magnetizeRawDist's contract —
        // Math.round(magnetize(x)) === Math.round(x) — holds identically
        // when applied to x/2, so the plain, unmagnetized value already
        // agrees with whatever the preview last displayed).
        const shift = 2 * Math.round(projectedSteps(d.fam, d.dx, d.dy) / 2);
        if (((shift % n) + n) % n === 0) return false;
        const vals = cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[fillerAwareSource(i, shift, n)]);
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
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0, lastShift: 0 };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const candidates = (['A', 'B', 'R'] as const)
              .map((fam) => ({ fam, line: lineFor(fam, drag!.r, drag!.c), proj: Math.abs(scalarProjection(fam, dx, dy)) }))
              .sort((a, b) => b.proj - a.proj);
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
          // A resolved move already re-rendered on its own (and may still be
          // mid-reveal) — rendering again here would erase that before a
          // frame of it paints. Only a no-op drag needs this to snap the
          // preview's manual style tweaks back to a clean rest state.
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
