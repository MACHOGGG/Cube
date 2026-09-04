/**
 * 小球（28 颗，摆成一个三角）的棋盘模型——只有规则，没有画面。
 *
 * 和 squareBoard.ts 一样，是从网页版 src/shapes/circle.ts 里把规则单独抄出来
 * 的：那边规则和 DOM 写在一起，这边没有 DOM。计分连锁（engine/scoring.ts）和
 * 死局判定（engine/stalemate.ts）直接用网页版那两个文件，两边永远同一套规则。
 *
 * 这副棋盘和方块最不一样的两处：
 *
 *   · 格子是三角形排布的——第 r 排有 r+1 颗，一共 28 颗。所以没有「列」这回
 *     事，滑动的方向有三个：一横两斜（横排、左斜、右斜），三个方向互成 60°。
 *   · 整线得分不是把那一行从棋盘上拿掉（方块是那样），而是把那几颗变成空球
 *     留在原地——盘面的形状从头到尾不变。空球用 color = -1 记着。
 *
 * 每一处都照 circle.ts 抄的，改规则请两边一起改。
 */
import type { Cell, Match, Tile } from '../../src/engine/types';
import { cellKey, effColor } from '../../src/engine/types';
import { shuffle } from '../../src/engine/rng';
import { createCascadeStepper, type CascadeConfig, type CascadeStepper } from '../../src/engine/scoring';
import { extendRunInLine, growParallelogram } from '../../src/engine/matchGrowth';
import {
  countRemainingTiles,
  findStuckColorGroups,
  type LiveTile,
  type RemainingTileCounts,
} from '../../src/engine/stalemate';
import type { Board, BoardLabels, BoardLine } from './board';

/** 第 r 排有 r+1 颗，一共 7 排 28 颗。 */
export const CIRCLE_ROWS = 7;
const PER_COLOR = 7;
/** 最短的整线是 3 颗——比这更短的线不给整线奖励。 */
const MIN_LINE_BONUS_LEN = 3;
/** 消掉之后留在原地的那颗空球：颜色记成 -1。 */
const BLANK = -1;

/** 同 circle.ts 的 standard 配色（四种色相）。 */
export const CIRCLE_PALETTE: readonly string[] = ['#C0666B', '#DDA857', '#7A9C4A', '#4F72C4'];

/** 三个滑动方向：横排、左斜（c 固定）、右斜（r-c 固定）。 */
type Fam = 'R' | 'B' | 'A';

function cellValid(r: number, c: number): boolean {
  return r >= 0 && r < CIRCLE_ROWS && c >= 0 && c <= r;
}

function lineA(d: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = d; r < CIRCLE_ROWS; r++) cells.push([r, r - d]);
  return cells;
}
function lineB(e: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = e; r < CIRCLE_ROWS; r++) cells.push([r, e]);
  return cells;
}
function lineRow(r: number): Cell[] {
  const cells: Cell[] = [];
  for (let c = 0; c <= r; c++) cells.push([r, c]);
  return cells;
}

interface Line {
  id: string;
  fam: Fam;
  cells: Cell[];
}
const LINES: Line[] = (() => {
  const out: Line[] = [];
  for (let d = 0; d < CIRCLE_ROWS; d++) out.push({ id: 'A' + d, fam: 'A', cells: lineA(d) });
  for (let e = 0; e < CIRCLE_ROWS; e++) out.push({ id: 'B' + e, fam: 'B', cells: lineB(e) });
  for (let r = 0; r < CIRCLE_ROWS; r++) out.push({ id: 'R' + r, fam: 'R', cells: lineRow(r) });
  return out;
})();

/**
 * 三个方向在画面上的单位向量（以「一颗的半径」为单位，见 render 那边的摆法：
 * 中心 = ((c - r/2) * 2, r * √3)）。一步的物理长度三个方向都是 2，所以手指往
 * 哪边拖，就跟哪个方向的投影最大。
 */
const FAM_VEC: Record<Fam, [number, number]> = {
  R: [1, 0],
  B: [0.5, Math.sqrt(3) / 2],
  A: [-0.5, Math.sqrt(3) / 2],
};

/** 这一副棋盘的两块「小平行四边形」和一块「菱形」，同 circle.ts。 */
function rhombus22B(r: number, c: number): Cell[] | null {
  const cells: Cell[] = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
  return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
}
function rhombus22A(r: number, c: number): Cell[] | null {
  const cells: Cell[] = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c + 2]];
  return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
}
function diamond121(r: number, c: number): Cell[] | null {
  const cells: Cell[] = [[r, c], [r + 1, c], [r + 1, c + 1], [r + 2, c + 1]];
  return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
}
const CLUSTERS: Cell[][] = (() => {
  const groups: Cell[][] = [];
  for (let r = 0; r < CIRCLE_ROWS; r++)
    for (let c = 0; c <= r; c++) {
      const b = rhombus22B(r, c);
      if (b) groups.push(b);
      const a = rhombus22A(r, c);
      if (a) groups.push(a);
      const d = diamond121(r, c);
      if (d) groups.push(d);
    }
  return groups;
})();

export function createCircleBoard(labels: BoardLabels): Board {
  let grid: Tile[][] = [];
  let nextTileId = 0;
  /** 已经拿过整线奖励的那几条线（按棋子身份记），同一条不给第二次。 */
  let bonusedSignatures = new Set<string>();
  let pendingBonus: Cell[][] = [];

  const newTile = (color: number, dotColor: number): Tile => ({ id: nextTileId++, color, face: 'flavor', dotColor });
  const isBlank = (t: Tile) => t.color === BLANK;
  const anyBlank = (cells: Cell[]) => cells.some(([r, c]) => isBlank(grid[r][c]));
  const effColorAt = (r: number, c: number) => effColor(grid[r][c]);
  const isLiveCell = (r: number, c: number) => cellValid(r, c) && !isBlank(grid[r][c]);

  // ---- 发牌（同 circle.ts）------------------------------------------------
  function shuffledDeck(): number[] {
    const deck: number[] = [];
    for (let c = 0; c < CIRCLE_PALETTE.length; c++) for (let i = 0; i < PER_COLOR; i++) deck.push(c);
    return shuffle(deck);
  }
  // 同一正面色的七颗：其余三色各两颗（六颗）+ 自己的颜色一颗，正好七颗。
  function assignDotColors(deck: number[]): number[] {
    const dots = new Array<number>(deck.length);
    for (let color = 0; color < CIRCLE_PALETTE.length; color++) {
      const others: number[] = [];
      for (let k = 0; k < CIRCLE_PALETTE.length; k++) if (k !== color) others.push(k, k);
      others.push(color);
      shuffle(others);
      const idxs: number[] = [];
      deck.forEach((c, i) => {
        if (c === color) idxs.push(i);
      });
      idxs.forEach((idx, i) => {
        dots[idx] = others[i];
      });
    }
    return dots;
  }
  function boardFromDeck(deck: number[]): Tile[][] {
    const dots = assignDotColors(deck);
    const g: Tile[][] = [];
    let idx = 0;
    for (let r = 0; r < CIRCLE_ROWS; r++) {
      const row: Tile[] = [];
      for (let c = 0; c <= r; c++) row.push(newTile(deck[idx], dots[idx++]));
      g.push(row);
    }
    return g;
  }
  // 开局盘上不能有现成的四连或那三块图案——那是白送的分。
  function hasInitialClump(g: Tile[][]): boolean {
    for (const line of LINES) {
      const colors = line.cells.map(([r, c]) => g[r][c].color);
      for (let i = 0; i + 3 < colors.length; i++)
        if (colors[i] === colors[i + 1] && colors[i] === colors[i + 2] && colors[i] === colors[i + 3]) return true;
    }
    for (const cells of CLUSTERS) {
      const c0 = g[cells[0][0]][cells[0][1]].color;
      if (cells.every(([r, c]) => g[r][c].color === c0)) return true;
    }
    return false;
  }
  function deal() {
    let g: Tile[][];
    let tries = 0;
    do {
      g = boardFromDeck(shuffledDeck());
      tries++;
    } while (hasInitialClump(g) && tries < 500);
    grid = g;
    bonusedSignatures = new Set();
    pendingBonus = [];
  }

  // ---- 滑动 ---------------------------------------------------------------
  function shiftLine(id: string, by: number): Set<string> {
    const line = LINES.find((l) => l.id === id);
    const mask = new Set<string>();
    if (!line) return mask;
    const n = line.cells.length;
    const step = (((by % n) + n) % n);
    if (step !== 0) {
      const vals = line.cells.map(([r, c]) => grid[r][c]);
      const shifted = vals.map((_, i) => vals[(((i - by) % n) + n) % n]);
      line.cells.forEach(([r, c], i) => {
        grid[r][c] = shifted[i];
      });
    }
    for (const [r, c] of line.cells) mask.add(cellKey(r, c));
    return mask;
  }

  // ---- 得分图案（同 circle.ts）--------------------------------------------
  // 图案只沿自己的方向长：四连只顺着那条线延长，两块平行四边形只整排整排地
  // 扩，菱形 1-2-1 是个闭合的形状，一步也不扩，永远就是它自己那四颗。
  function qualifies(seed: Cell[], mask: Set<string> | null): boolean {
    if (anyBlank(seed)) return false;
    const c0 = effColorAt(seed[0][0], seed[0][1]);
    if (!seed.every(([r, c]) => effColorAt(r, c) === c0)) return false;
    if (mask && !seed.some(([r, c]) => mask.has(cellKey(r, c)))) return false;
    return true;
  }

  function findMatches(mask: Set<string> | null): Match[] {
    const matches: Match[] = [];
    for (const line of LINES) {
      const cells = line.cells;
      for (let i = 0; i + 3 < cells.length; i++) {
        const seed = cells.slice(i, i + 4);
        if (!qualifies(seed, mask)) continue;
        const region = extendRunInLine(cells, i, i + 3, effColorAt, isLiveCell);
        matches.push({ cells: region, points: Math.max(4, region.length), label: labels.run4 });
      }
    }
    for (let r = 0; r < CIRCLE_ROWS; r++)
      for (let c = 0; c <= r; c++) {
        const b = rhombus22B(r, c);
        if (b && qualifies(b, mask)) {
          const at = (u: number, v: number): Cell | null => (cellValid(r + v, c + u) ? [r + v, c + u] : null);
          const region = growParallelogram(at, effColorAt, isLiveCell);
          matches.push({ cells: region, points: Math.max(4, region.length), label: labels.block22 });
        }
        const a = rhombus22A(r, c);
        if (a && qualifies(a, mask)) {
          const at = (u: number, v: number): Cell | null =>
            cellValid(r + v, c + u + v) ? [r + v, c + u + v] : null;
          const region = growParallelogram(at, effColorAt, isLiveCell);
          matches.push({ cells: region, points: Math.max(4, region.length), label: labels.block22 });
        }
        const d = diamond121(r, c);
        if (d && qualifies(d, mask)) matches.push({ cells: d, points: 4, label: labels.diamond121 });
      }
    return matches;
  }

  // ---- 整线奖励（同 circle.ts）--------------------------------------------
  // 一整条线全翻到反面、反面颜色又都一样才算——正反混着的不算，哪怕有效颜色
  // 碰巧一致。已经拿过奖励的那条线不给第二次（按棋子身份记，不是按位置）。
  function isFullDotMatch(cells: Cell[]): boolean {
    if (cells.some(([r, c]) => grid[r][c].face !== 'dot')) return false;
    const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
    return cells.every(([r, c]) => grid[r][c].dotColor === c0);
  }
  function findLineBonuses(): Cell[][] {
    const found: Cell[][] = [];
    for (const line of LINES) {
      if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
      // 线上只要有一颗空球就再也不算了——空球没有颜色可以和别人一致。
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
    pendingBonus = found;
    return found;
  }
  /** 拿掉的那几颗变成空球留在原地——这副棋盘的形状从头到尾不变。 */
  function applyLineBonus() {
    for (const cells of pendingBonus)
      for (const [r, c] of cells) {
        const t = grid[r][c];
        if (t.face === 'flavor') t.face = 'dot';
        t.color = BLANK;
        t.dotColor = BLANK;
      }
    pendingBonus = [];
  }

  function liveTiles(): LiveTile[] {
    const live: LiveTile[] = [];
    for (let r = 0; r < CIRCLE_ROWS; r++)
      for (let c = 0; c <= r; c++) {
        const t = grid[r][c];
        if (!isBlank(t)) live.push({ cell: [r, c], tile: t });
      }
    return live;
  }

  return {
    kind: 'circle',
    palette: CIRCLE_PALETTE,
    get rows() {
      return CIRCLE_ROWS;
    },
    cellsInRow: (r) => r + 1,
    tileAt: (r, c) => grid[r][c],
    isBlankAt: (r, c) => isBlank(grid[r][c]),
    // 只有三角那副分朝向。
    pointsUp: () => true,
    // 一颗的中心，单位是半径的倍数：横向一步 2，纵向一排 √3，每往下一排整排
    // 往左错半步——这就是三角形堆球的摆法。
    centerOf: (r, c) => [(c - r / 2) * 2, r * Math.sqrt(3)],
    // 中心的 x 从 -(排数-1) 到 +(排数-1)，y 从 0 到 (排数-1)×√3；每颗还有 1
    // 个单位的半径要算进去，所以四边各往外让 1。
    extent: () => ({
      minX: -(CIRCLE_ROWS - 1) - 1,
      minY: -1,
      w: (CIRCLE_ROWS - 1) * 2 + 2,
      h: (CIRCLE_ROWS - 1) * Math.sqrt(3) + 2,
    }),
    linesThrough(r, c): BoardLine[] {
      return LINES.filter((l) => l.cells.some(([rr, cc]) => rr === r && cc === c)).map((l) => ({
        id: l.id,
        cells: l.cells,
        vec: FAM_VEC[l.fam],
      }));
    },
    shiftLine,
    deal,
    cascade: (mask) =>
      createCascadeStepper(
        {
          tileAt: (r, c) => grid[r][c],
          findMatches,
          findLineBonuses,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
        } satisfies CascadeConfig,
        mask,
        { pattern: labels.pattern, line: labels.line },
      ) as CascadeStepper,
    isGameOver: () => grid.every((row) => row.every((t) => isBlank(t) || t.face === 'dot')),
    // 反面自己只靠整线得分，这副棋盘最短的整线是 3 颗。
    stuckGroups: () => findStuckColorGroups(liveTiles(), new Set(), undefined, MIN_LINE_BONUS_LEN),
    remaining: (): RemainingTileCounts => countRemainingTiles(liveTiles()),
  };
}
