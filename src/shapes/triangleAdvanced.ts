import './triangle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnTriangleOutline, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { extendRunInLine } from '../engine/matchGrowth';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintRow, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame, ShapeGameOpts } from './types';

// Same solid 5-row big-triangle board as triangleBig.ts (see that file for
// the full geometry/matching rationale — reused verbatim here, including
// its 5-color no-self-pair back-face rule, since the user only asked for a
// different *horizontal move*, not a different board or color scheme).
// What's different: dragging the horizontal ("row") direction on any row
// except the bottom one no longer cycles the whole row — only the segment
// from the touch point to the edge on the drag's own side cycles; the rest
// of that row is left completely untouched (not moved, not re-checked for
// matches). The two diagonal directions, and horizontal drags on the
// bottom row, are unchanged from triangleBig's whole-line behavior.
const PALETTES = {
  standard: ['#3C4452', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9'],
} as const;
const ROW_LENS = [1, 3, 5, 7, 9];
const LEFT_TRIM = [0, 0, 0, 0, 0];
const GLOBAL_ROW_OFFSET = 0;
const PER_COLOR = 5;
const MIN_LINE_BONUS_LEN = 3;
const BOTTOM_ROW = ROW_LENS.length - 1;

const GLYPH = `<svg viewBox="0 0 32 32"><polygon points="16,4 28,26 4,26" fill="none" stroke="#4C68B0" stroke-width="2.4"/><polygon points="16,13 22,24 10,24" fill="#D89B1E"/><line x1="4" y1="26" x2="28" y2="26" stroke="#B23A3A" stroke-width="2.4"/></svg>`;

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

function globalPosPure(r: number, c: number) {
  return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
}

function allLines(): Line[] {
  const lines: Line[] = [...buildDiagonalFamily('A'), ...buildDiagonalFamily('B')];
  // Row family cells are ordered left-to-right by increasing local column —
  // index i in this array IS local column i, which the horizontal
  // partial-segment drag below relies on directly.
  for (let r = 0; r < ROW_LENS.length; r++) {
    lines.push({ fam: 'R', cells: Array.from({ length: ROW_LENS[r] }, (_, c) => [r, c] as Cell) });
  }
  return lines;
}
const LINES = allLines();

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
  // Set only for a horizontal (R) drag on a non-bottom row: the cells from
  // the touch point to the edge on the drag's own side. null means "use the
  // whole line" (every other case — both diagonals, and horizontal drags on
  // the bottom row — keep triangleBig's original whole-line behavior).
  segment: Cell[] | null;
  dx: number;
  dy: number;
  lastShift: number;
}

export function createTriangleAdvancedGame(): ShapeGame {
  const bestKey = 'sugarcube_triangle_advanced_best';

  return {
    card: {
      id: 'triangleAdvanced',
      name: '进阶三角',
      desc: '整块大三角 · 横向分段滑动',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const refs = buildShell(container, {
        title: 'Slides · 进阶三角',
        tagline: '左斜/右斜整行滑动 · 横向仅拖动一段',
        startBody: '拖动斜线方向的整条线，或横向拖动其中一段三角，拼出同色图案。点击开始生成一局新的方糖阵势。',
        hint:
          '左斜、右斜两个方向拖动时，和大三角一样是整条线一起循环滑动；水平方向拖动时，最下面一行仍是整行循环，但其余每一行只有从你手指落点到拖动方向那一侧边缘的那一段会自己循环滑动，另一侧的三角完全不受影响、不会跟着移动。不论整行还是分段，连续 4 个同色（不分点/面）得 4 分，连得更长按实际数量得分，但线外/段外的同色三角不会被计入；4 个三角拼成一个大三角（3 个同朝向 + 1 个反朝向，"31"/"13"）同色时固定得 4 分。得分方块翻成点面。同一局中，与刚得分的同一局部图案完全相同（同样的位置与颜色）不会连续再次得分。当一整条线（或分段后的一段，长度 ≥3）都翻成点面且点色相同时，额外得该段长度的平方分，随后淡出并变为空白角——保留在棋盘原位，可以继续正常参与拖动和补位，但不会再对任何得分产生贡献。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。全部方块都翻成点面或变为空白角时结束，结算当时的分数。',
        assumptions:
          '5 种口味色，每色 5 枚，共 25 枚（一整块大三角，五行 1/3/5/7/9 枚）；每种口味的点色分布为：其余 4 色各 1 枚、另有 1 色额外再来 1 枚——保证没有正反面同色的三角出现，与七色圆球"反面绝不与正面同色"的原则一致。左斜、右斜两个方向，以及最下面一行的横向拖动，判分与移动规则和大三角完全一致；除最下面一行外，其余每一行的横向拖动只影响从落点到拖动方向那一侧边缘的一段。',
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
      // triangleBig — a bonused triangle just loses its color for good (the
      // BLANK sentinel) while staying a real, slidable tile.
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

      // Per color group of 5: the other 4 colors get 1 each, and one of
      // those 4 (picked round-robin below, then shuffled into a random slot)
      // gets a 2nd copy to fill the 5th spot — this tile's own color never
      // appears as its dot color.
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
        S = boardSize / 5.2;
        H = (S * Math.sqrt(3)) / 2;
        originX = boardSize / 2;
        originY = (boardSize - ROW_LENS.length * H) / 2 - GLOBAL_ROW_OFFSET * H;
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
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) {
            spawnTriangleOutline(refs.boardEl, triGeometry(r, c).pts.map(toScreen), elapsedMs);
          }
        }
      }

      // A match only ever grows along its *own* seed shape's regular
      // directions (see matchGrowth.ts) — never a generic same-color flood
      // fill. A run-4 only extends further along that same line; a 31/13
      // big-triangle doesn't extend at all — it always scores exactly its
      // own 4 cells.
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }
      function isLiveCell(r: number, c: number): boolean {
        return !isBlank(grid[r][c]);
      }
      function qualifies(seed: Cell[], mask: Set<string> | null): boolean {
        if (anyBlank(seed)) return false;
        const c0 = effColor(grid[seed[0][0]][seed[0][1]]);
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
        for (const cells of BIG_TRIANGLES) {
          if (qualifies(cells, mask)) matches.push({ cells, points: 4 });
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
        shapeName: '进阶三角',
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

      function trueStepVector(fam: 'A' | 'B' | 'R'): [number, number] {
        if (fam === 'A') return [S / 2, H];
        if (fam === 'B') return [-S / 2, H];
        return [S / 2, 0];
      }

      function scalarProjection(fam: 'A' | 'B' | 'R', dx: number, dy: number): number {
        const [ux, uy] = trueStepVector(fam);
        return (dx * ux + dy * uy) / Math.hypot(ux, uy);
      }

      function projectedSteps(fam: 'A' | 'B' | 'R', dx: number, dy: number): number {
        const [ux, uy] = trueStepVector(fam);
        const proj = dx * ux + dy * uy;
        return proj / (ux * ux + uy * uy);
      }

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

      // The active set of cells this drag actually moves: the touch-to-edge
      // segment for a non-bottom-row horizontal drag, or the whole line for
      // every other case (both diagonals; horizontal on the bottom row).
      function activeCells(d: DragState): Cell[] {
        return d.segment ?? d.line!.cells;
      }

      // fillerAwareSource's wraparound-pairing logic assumes the filler
      // region (|shift| cells) never exceeds the line's own length n — true
      // by construction for a full row/diagonal (dragging further than the
      // line's own span is a very long drag), but a touch-to-edge segment
      // can be as short as 1-2 cells, where even a modest drag easily
      // produces |shift| > n and corrupts the pairing (verified against a
      // real repro: a 3-cell segment ended up with a color that was never
      // in it). Clamping the segment's own shift to its own length keeps
      // fillerAwareSource's assumption true without touching the whole-line
      // path at all, which never needed this and stays exactly as before.
      function boundedShift(shift: number, n: number, isSegment: boolean): number {
        return isSegment ? Math.max(-n, Math.min(n, shift)) : shift;
      }

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam) return;
        const cells = activeCells(d);
        const n = cells.length;
        const half = magnetizeRawDist(projectedSteps(d.fam, d.dx, d.dy) / 2, 1.5);
        const shift = boundedShift(2 * Math.round(half), n, d.segment !== null);
        if (shift !== d.lastShift) {
          vibrate(6);
          d.lastShift = shift;
        }
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

      function applyDrag(): boolean {
        const d = drag;
        if (!d || !d.fam) return false;
        const cells = activeCells(d);
        const n = cells.length;
        const shift = boundedShift(2 * Math.round(projectedSteps(d.fam, d.dx, d.dy) / 2), n, d.segment !== null);
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
          drag = { r, c, fam: null, line: null, segment: null, dx: 0, dy: 0, lastShift: 0 };
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
            if (drag.fam === 'R' && drag.r !== BOTTOM_ROW) {
              // Row cells are ordered left-to-right by local column, and
              // drag.c IS that local column (LEFT_TRIM is all zero here),
              // so it indexes straight into the row's own cells array.
              const rowCells = drag.line.cells;
              const touchIdx = drag.c;
              drag.segment = dx >= 0 ? rowCells.slice(touchIdx) : rowCells.slice(0, touchIdx + 1);
            } else {
              drag.segment = null;
            }
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
