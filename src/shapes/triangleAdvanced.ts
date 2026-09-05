import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeFollow } from '../engine/drag';
import { createDragChain, pressScale, BOARD_FORCE, type DragChain } from '../engine/dragChain';
import { vibrate } from '../engine/haptics';
import { floorBox, observeBoardSize, squareFloor } from '../engine/boardResize';
import { colorblindOn, onColorblindChange, themedPalette } from '../engine/palettePref';
import { playMove, seatLine } from '../engine/juice';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnTriangleOutline, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { extendRunInLine } from '../engine/matchGrowth';
import { roundTriClip, roundTriPath } from '../engine/roundTri';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintIcons, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import { dealBalancedDeck, spreadDotColors } from '../engine/orientationDeal';
import { STRINGS as MATCH_LABELS, STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
import type { ShapeGame, ShapeGameOpts } from './types';

// The V-shaped advanced triangle board: 49 triangles in two arms that meet
// along one continuous bottom row, 7 colors x 7 tiles, and the same back-face
// rule as the other advanced layouts (a tile's dot face is never its own
// color). Scoring, sliding, the low-opacity wraparound refill, flipping and
// clearing all behave exactly as in the other triangle games.
//
// What the V changes is reach, not rules: the notch splits every row above
// the bottom into two independent lines, so sliding the left arm's top row
// leaves the right arm's top row untouched — while the bottom row, being one
// unbroken run, still slides as a single line across the whole board.
/** 拖动时预览跟手的曲线，见 drag.ts 的 magnetizeFollow。
 *  三角只能偶数步落位，卡点隔着两格，纯磁吸会在卡点附近把牌粘住不动——
 *  掺三成直线进去，速率就稳在 0.70～1.15 之间。落位一步没变。 */
const MAGNET_POWER = 1.5;
const MAGNET_BLEND = 0.3;

const PALETTES = {
  standard: ['#2F8A96', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#8A5A44', '#EDEDED'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#8A5A44', '#EDEDED'],
} as const;

/**
 * The V board, written as each row's cells in *global slot* numbers (slot
 * parity decides orientation: even = up, odd = down). The top three rows are
 * the V's two separate arms with the notch between them; the bottom row is
 * one continuous run joining them. 6+6 per arm row and 13 along the bottom
 * makes 49 cells — 7 colors, 7 tiles each.
 *
 * Every row is drawn half a cell further left than the one above it (the
 * shared triangle-grid shear), so the *slots* that keep an edge running
 * straight differ per side: the left arm steps 2 slots right each row, while
 * the right arm keeps the very same slots. Under that shear the mirror of a
 * cell (i, p) sits at (i, 20 + 2i − p), which is exactly why the right arm
 * is [14, 19] and not [13, 18] — that offset is what makes it a true mirror
 * of the left arm, orientation included (it opens on an up-triangle and ends
 * on a down-triangle, the reverse of the left arm), instead of a copy of it
 * shifted sideways. The notch narrows one cell per side per row — 7 slots
 * across the top, then 5, then 3 — and the bottom row runs straight through
 * what is left of it.
 *
 * Because a row's cells are grouped into *runs*, the two arms are simply two
 * different horizontal lines: sliding the left arm's top row can't touch the
 * right arm's, while the bottom row — a single run — slides as one.
 */
const ROW_RUNS: readonly (readonly [start: number, end: number])[][] = [
  [[1, 6], [14, 19]],
  [[3, 8], [14, 19]],
  [[5, 10], [14, 19]],
  [[7, 19]],
];
/** Global slot of each row's local column c. */
const SLOTS: number[][] = ROW_RUNS.map((runs) =>
  runs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)),
);
const ROW_LENS = SLOTS.map((row) => row.length);
const GLOBAL_ROW_OFFSET = 0;
const PER_COLOR = 7;
const MIN_LINE_BONUS_LEN = 3;
// Slot order is row-major over SLOTS, matching boardFromDeck's own walk — so
// this indexes the deck directly. A slot points up when its global position
// p is even (see triGeom).
const SLOT_IS_UP: boolean[] = SLOTS.flatMap((row) => row.map((p) => p % 2 === 0));

const GLYPH = `<svg viewBox="0 0 32 32"><path d="M3 7 H11 L16 21 L21 7 H29 L20 27 H12 Z" fill="none" stroke="#4C68B0" stroke-width="2.4" stroke-linejoin="round"/><path d="${roundTriPath([[8, 11], [11, 17], [5, 17]])}" fill="#D89B1E"/><path d="${roundTriPath([[24, 11], [27, 17], [21, 17]])}" fill="#B23A3A"/></svg>`;

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
    labelKey: 'labelBigTriangle',
    cells: [[0, 0], [1, 0], [1, 1], [1, 2]].map(([i, p]) => ({ kind: 'poly' as const, points: iconTri(i, p) })),
  },
];

interface Line {
  fam: 'A' | 'B' | 'R';
  cells: Cell[];
}

function globalToLocal(i: number, p: number): Cell | null {
  const r = i - GLOBAL_ROW_OFFSET;
  if (r < 0 || r >= SLOTS.length) return null;
  const c = SLOTS[r].indexOf(p);
  return c < 0 ? null : [r, c];
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
  return { i: r + GLOBAL_ROW_OFFSET, p: SLOTS[r][c] };
}

function allLines(): Line[] {
  const lines: Line[] = [...buildDiagonalFamily('A'), ...buildDiagonalFamily('B')];
  // One horizontal line per *run* — so each arm of the V is its own line and
  // slides on its own, while the bottom row (a single run) slides whole.
  for (let r = 0; r < ROW_RUNS.length; r++) {
    let c = 0;
    for (const [a, b] of ROW_RUNS[r]) {
      const len = b - a + 1;
      lines.push({ fam: 'R', cells: Array.from({ length: len }, (_, k) => [r, c + k] as Cell) });
      c += len;
    }
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
  dx: number;
  dy: number;
  lastShift: number;
  /** The splash's inter-piece physics. Triangles interlock and swap by
   *  pairs rather than sliding, so the chain runs in pair units and drives
   *  each pair's "give" nudge — the ripple — instead of real travel. */
  chain: DragChain | null;
}

export function createTriangleAdvancedGame(): ShapeGame {
  const bestKey = 'sugarcube_triangle_advanced_best';

  return {
    card: {
      id: 'triangleAdvanced',
      name: '进阶三角',
      desc: 'V 形 49 块 · 左右两臂各自滑动',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const lang = opts?.lang ?? 'zhHans';
      const refs = buildShell(container, {
        lang,
        practice: !!opts?.practice,
        shapeId: 'triangleAdvanced',
        timed: !!opts?.timeLimitSec,
        title: `Slides · ${shapeName(lang, 'triangleAdvanced', '进阶三角')}`,
        wideBoard: true,
        // 进阶三角's two-armed V is far wider than tall — unplayable in a phone's
        // portrait column, so this screen asks for landscape and lays
        // itself out for it.
        landscape: true,
        tagline: SHELL[lang].taglineVBoard,
        startBody: SHELL[lang].shellStartBody,
        patternIcons: renderPatternHintIcons(PATTERNS, lang),
      });

      const pickPalette = (): readonly string[] =>
        themedPalette(PALETTES[colorblindOn() ? 'colorblind' : 'standard']);
      let COLORS: readonly string[] = pickPalette();
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

      // Balanced across up/down slots rather than plain-shuffled — see
      // orientationDeal.ts for why a triangle board needs that.
      function shuffledDeck(): number[] {
        return dealBalancedDeck(SLOT_IS_UP, COLORS.length, PER_COLOR);
      }

      // Per color group of 5: the other 4 colors get 1 each, and one of
      // those 4 (picked round-robin below, then shuffled into a random slot)
      // gets a 2nd copy to fill the 5th spot — this tile's own color never
      // appears as its dot color.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        const groups: { slots: number[]; pool: number[] }[] = [];
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; others.length < PER_COLOR; k++) others.push((color + 1 + (k % (COLORS.length - 1))) % COLORS.length);
          shuffle(others);
          const slots: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) slots.push(idx);
          });
          groups.push({ slots, pool: others });
        }
        return spreadDotColors(groups, (slot) => SLOT_IS_UP[slot], dotColors);
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
        return globalPosPure(r, c);
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

      // The V is much wider than it is tall, so its box is measured from the
      // cells themselves (in S units) and scaled to whatever room the column
      // gives — rather than assuming a square pyramid the way the other
      // triangle boards can.
      const UNIT_EXTENT = (() => {
        let minX = Infinity;
        let maxX = -Infinity;
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const { i, p } = globalPosPure(r, c);
            const up = p % 2 === 0;
            const j = up ? p / 2 : (p - 1) / 2;
            const xBase = -i / 2 + j;
            const xs = up ? [xBase - 0.5, xBase + 0.5] : [xBase, xBase + 1];
            minX = Math.min(minX, ...xs);
            maxX = Math.max(maxX, ...xs);
          }
        return { minX, maxX, w: maxX - minX };
      })();

      function layoutBoard() {
        const rect = floorBox(refs.boardWrap);
        const width = rect.width || 320;
        const byWidth = width / (UNIT_EXTENT.w + 0.3);
        // The panel is a hard ceiling in both orientations now, so the
        // smaller of the two constraints wins and the whole V is on screen
        // either way.
        const byHeight = (rect.height || 320) / (ROW_LENS.length * (Math.sqrt(3) / 2));
        S = Math.min(byWidth, byHeight);
        H = (S * Math.sqrt(3)) / 2;
        const height = ROW_LENS.length * H;
        originX = -UNIT_EXTENT.minX * S + (width - UNIT_EXTENT.w * S) / 2;
        originY = 0;
        refs.boardEl.style.width = width + 'px';
        refs.boardEl.style.height = height + 'px';
        refs.boardWrap.style.aspectRatio = 'auto';
        // 传棋盘元素自己的框，不是 V 画出来的那块：地板收得比元素还小的话，
        // 元素会顶出地板。横屏时 V 撑满整格的宽，收不成正方形；竖屏时收得成。
        squareFloor(refs.boardWrap, width, height);
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
        // 尖角磨圆——三副三角棋盘、教学、图示用的是同一条轮廓（roundTri.ts），
        // 圆角的深浅只在那儿定义一次：玩家在教学里看熟的形状，进了棋盘不该变
        // 成另一个样子。
        const clip = roundTriClip(pts, { minX, minY, w, h });

        const el = document.createElement('div');
        el.className = 'tri';
        el.style.left = minX + 'px';
        el.style.top = minY + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';

        // The parent wears the same silhouette so its white ground shows as
        // an edge around the inset fill — see .tri in triangle.css.
        el.style.clipPath = clip;
        el.style.setProperty('-webkit-clip-path', clip);

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
          const poly = document.createElementNS(svgNS, 'path');
          // 尖角磨圆，和外面那圈轮廓同一条（见 engine/roundTri.ts）——里外两层
          // 的圆角要是一个磨了一个没磨，小三角看着就像贴歪了。
          poly.setAttribute(
            'd',
            roundTriPath(ringPts.map(([x, y]) => [((x - minX) / w) * 100, ((y - minY) / h) * 100] as [number, number])),
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
          const poly = document.createElementNS(svgNS, 'path');
          // 尖角磨圆，和外面那圈轮廓同一条（见 engine/roundTri.ts）——里外两层
          // 的圆角要是一个磨了一个没磨，小三角看着就像贴歪了。
          poly.setAttribute(
            'd',
            roundTriPath(innerPts.map(([x, y]) => [((x - minX) / w) * 100, ((y - minY) / h) * 100] as [number, number])),
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
        // 先在一张「离屏的纸」上把这一帧的棋子全摆好，再一次性换上去。
        //
        // 从前是先把棋盘清空，再一枚一枚往里塞。塞四十九次就是四十九次改动，
        // 手机上每一次都可能让浏览器把这块重新算一遍；一步棋走完正好要重画整
        // 副棋盘，玩家看到的就是「移动结束时轻轻闪一下」。DocumentFragment 不
        // 在页面上，往它里面塞多少次都不惊动页面，最后那一下 appendChild 才是
        // 唯一一次真正的改动。
        const frag = document.createDocumentFragment();
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
            frag.appendChild(el);
          }
        }
        refs.boardEl.innerHTML = '';
        refs.boardEl.appendChild(frag);
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
            matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelRun4 });
          }
        }
        for (const cells of BIG_TRIANGLES) {
          if (qualifies(cells, mask)) matches.push({ cells, points: 4, label: MATCH_LABELS[lang].labelBigTriangle });
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

      function findStuckGroups(clearedDotColors: ReadonlySet<number>): Cell[][] {
        // 反面自己只靠整线得分，这副棋盘最短的整线是 3 枚（见 findWholeLineBonuses）。
        return findStuckColorGroups(liveTiles(), clearedDotColors, undefined, MIN_LINE_BONUS_LEN);
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
        lang,
        practice: !!opts?.practice,
        bestKey: opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: shapeName(lang, 'triangleAdvanced', '进阶三角'),
        shapeId: 'triangleAdvanced',
        modeKey: opts?.timeLimitSec ? 'timed' : 'base',
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

      // Every drag moves one whole line — for a horizontal drag that line is
      // the arm's own run, which is what keeps the two arms independent.
      function activeCells(d: DragState): Cell[] {
        return d.line!.cells;
      }

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam) return;
        const cells = activeCells(d);
        const n = cells.length;
        const half = magnetizeFollow(projectedSteps(d.fam, d.dx, d.dy) / 2, MAGNET_POWER, MAGNET_BLEND);
        const shift = 2 * Math.round(half);
        if (shift !== d.lastShift) {
          vibrate(6);
          playMove(); // ...and a tick, so a long slide reads as a run of detents
          d.lastShift = shift;
        }
        // The give ripples down the line pair by pair (the splash's
        // integrator, in pair units) instead of nudging the whole line as
        // one rigid unit.
        const [dirX, dirY] = trueStepVector(d.fam);
        const stepLen = Math.hypot(dirX, dirY);
        const chain = d.chain;
        const giveAt = (idx: number) => {
          const pairHalf = chain ? chain.at(Math.floor(idx / 2)) : half;
          // Undamped: the give is what the line does between detents, so
          // anything less than 1:1 is the board lagging the finger. It used
          // to be scaled to 0.6 to tame a wobble that came from the
          // inter-piece simulation, and with that turned down to near
          // nothing (see BOARD_FORCE) the damping was only costing
          // responsiveness — measured, a triangle followed a 29px drag by
          // 17px where the square followed it by 23px and the ball by 30px,
          // which is exactly the "not very sensitive" the boards felt. The
          // clamp is one whole step, which is the midpoint to the next
          // even configuration, so the preview still cannot run past what
          // release would commit.
          const residual = 2 * pairHalf - shift;
          return Math.max(-1, Math.min(1, residual));
        };
        const fillerSize = Math.abs(shift);

        for (let idx = 0; idx < n; idx++) {
          const [r, c] = cells[idx];
          const sourceIdx = fillerAwareSource(idx, shift, n);
          const [sr, sc] = cells[sourceIdx];
          const isFiller = shift > 0 ? idx < fillerSize : idx >= n - fillerSize;
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) el.remove();
          const give = giveAt(idx);
          const fresh = makeTriEl(grid[sr][sc], r, c, isFiller ? FILLER_OPACITY : undefined, [give * dirX, give * dirY]);
          if (chain) fresh.style.scale = pressScale(chain.press(Math.floor(idx / 2)), dirX / stepLen, dirY / stepLen, BOARD_FORCE);
          refs.boardEl.appendChild(fresh);
        }
        // The bands above and below get carried a little and sprung home.
        if (chain) {
          const inLine = new Set(cells.map(([r, c]) => cellKey(r, c)));
          for (let r = 0; r < ROW_LENS.length; r++) {
            const nudge = chain.side(Math.abs(r - d.r));
            if (!nudge) continue;
            for (let c = 0; c < ROW_LENS[r]; c++) {
              if (inLine.has(cellKey(r, c))) continue;
              const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
              if (el) el.style.translate = `${nudge * dirX}px ${nudge * dirY}px`;
            }
          }
        }
      }

      function applyDrag(): boolean {
        const d = drag;
        if (!d || !d.fam) return false;
        const cells = activeCells(d);
        const n = cells.length;
        const shift = 2 * Math.round(projectedSteps(d.fam, d.dx, d.dy) / 2);
        if (((shift % n) + n) % n === 0) return false;
        const vals = cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[fillerAwareSource(i, shift, n)]);
        cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        const mask = new Set<string>(cells.map(([r, c]) => cellKey(r, c)));
        seatLine(refs.boardEl, mask);
        const [vx, vy] = trueStepVector(d.fam);
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
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0, lastShift: 0, chain: null };
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
            const candidates = (['A', 'B', 'R'] as const)
              .map((fam) => ({ fam, line: lineFor(fam, drag!.r, drag!.c), proj: Math.abs(scalarProjection(fam, dx, dy)) }))
              .sort((a, b) => b.proj - a.proj);
            drag.fam = candidates[0].fam;
            drag.line = candidates[0].line;
            const cells = activeCells(drag);
            const grabbed = cells.findIndex(([r, c]) => r === drag!.r && c === drag!.c);
            drag.chain = createDragChain({
              n: Math.max(1, Math.ceil(cells.length / 2)),
              grabbed: Math.max(0, Math.floor(Math.max(0, grabbed) / 2)),
              force: BOARD_FORCE,
              onFrame: renderDragPreview,
            });
          }
          const d = drag;
          if (!d.fam || !d.chain) return;
          d.chain.drive(magnetizeFollow(projectedSteps(d.fam, dx, dy) / 2, MAGNET_POWER, MAGNET_BLEND));
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
          d.chain.settle(Math.round(projectedSteps(d.fam, dx, dy) / 2), () => {
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
