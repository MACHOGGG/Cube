/**
 * 三角（54 枚小三角摆成一个六边形）的棋盘模型——只有规则，没有画面。
 *
 * 和方块、小球一样，是从网页版 src/shapes/triangle.ts 里把规则单独抄出来的：
 * 那边规则和 DOM 写在一起，这边没有 DOM。计分连锁（engine/scoring.ts）、死局
 * 判定（engine/stalemate.ts）、开局发牌（engine/orientationDeal.ts）直接用网
 * 页版那几个文件，两边永远同一套规则。
 *
 * 这副棋盘最不一样的三处，也是它比另外两副难写的地方：
 *
 *   · 每一枚有朝向。一枚三角是朝上还是朝下，由它坐在哪个位置决定；相邻两枚
 *     必定一上一下。朝上和朝下是镜像，不是平移。
 *   · 所以只能偶数步滑。每条线上的格子严格上下交替，而每条线的长度都是奇数
 *     （7 / 9 / 11——小三角拼成的六边形，行和斜线都不可能是偶数长），奇数长
 *     的环没法两染色，所以「转一格」一定会把某些枚的朝向对错位。偶数步就不
 *     会——玩家拖一下滑的是两枚，这就是这副棋盘的「一步」。
 *   · 就算偶数步，绕回来的那一段（下面的 filler）还是差一步。相邻两个位置的
 *     朝向本来就相反，所以把绕回来那段里每相邻两个位置的内容对调一下，正好
 *     抵消——见 fillerAwareSource。
 *
 * 每一处都照 triangle.ts 抄的，改规则请两边一起改。
 */
import type { Cell, Match, Tile } from '../../src/engine/types';
import { cellKey, effColor } from '../../src/engine/types';
import { shuffle } from '../../src/engine/rng';
import { dealBalancedDeck, spreadDotColors } from '../../src/engine/orientationDeal';
import { createCascadeStepper, type CascadeConfig, type CascadeStepper } from '../../src/engine/scoring';
import { extendRunInLine } from '../../src/engine/matchGrowth';
import {
  countRemainingTiles,
  findStuckColorGroups,
  type LiveTile,
  type RemainingTileCounts,
} from '../../src/engine/stalemate';
import type { Board, BoardLabels, BoardLine } from './board';

/** 同 triangle.ts 的 standard 配色（六种色相）。 */
export const TRIANGLE_PALETTE: readonly string[] = [
  '#2F8A96',
  '#B23A3A',
  '#D89B1E',
  '#4C68B0',
  '#2F9E52',
  '#9B958D',
];

/** 六排，每排几枚——摆出来是一个六边形。 */
const ROW_LENS = [7, 9, 11, 11, 9, 7];
/** 本地列 c → 大三角里的位置 p = c + LEFT_TRIM[r]。 */
const LEFT_TRIM = [0, 0, 0, 1, 3, 5];
/** 本地行 r → 大三角里的行 i = r + 3。 */
const GLOBAL_ROW_OFFSET = 3;
const PER_COLOR = 9;
/** 最短的整线是 3 枚——比这更短的线不给整线奖励。 */
const MIN_LINE_BONUS_LEN = 3;
/** 消掉之后留在原地的空位：颜色记成 -1。 */
const BLANK = -1;

/** 位置 p 是偶数的那一枚朝上。发牌要按朝向配平，所以先把这张表算出来。 */
const SLOT_IS_UP: boolean[] = ROW_LENS.flatMap((len, r) =>
  Array.from({ length: len }, (_, c) => (c + LEFT_TRIM[r]) % 2 === 0),
);

function globalPos(r: number, c: number): { i: number; p: number } {
  return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
}
function globalToLocal(i: number, p: number): Cell | null {
  const r = i - GLOBAL_ROW_OFFSET;
  if (r < 0 || r >= ROW_LENS.length) return null;
  const c = p - LEFT_TRIM[r];
  if (c < 0 || c >= ROW_LENS[r]) return null;
  return [r, c];
}

/** 这一枚朝上吗。 */
function isUp(r: number, c: number): boolean {
  return globalPos(r, c).p % 2 === 0;
}

// ---- 三条滑动方向 ---------------------------------------------------------
//
// 一枚三角有三条边：两条在同一排（左右邻居，朝向相反），一条通向上下相邻的那
// 一排。关键是那条「跨排边」只往前走：up(i,p) 连到 down(i+1,p+1)，而朝下那一
// 枚的跨排边就是同一条反着看——朝下的没有它自己另外的跨排边。所以一条直的斜
// 线不是「i-p 相同」也不是「i+p 相同」，而是跨排边和某一条同排边交替走出来的
// 折线。跟哪一条同排边交替，就走出哪一个斜方向。
type Fam = 'A' | 'B' | 'R';

function crossNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i + 1, p + 1) : globalToLocal(i - 1, p - 1);
}
function rowRightNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i, p + 1) : globalToLocal(i, p - 1);
}
function rowLeftNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i, p - 1) : globalToLocal(i, p + 1);
}

interface Line {
  id: string;
  fam: Fam;
  cells: Cell[];
}

/**
 * 顺着真正的邻接关系把一族斜线走出来。
 *
 * 先并查集分组（跨排边 + 选定的那条同排边），再从一头走到另一头排成一串——
 * 排好顺序，「把数组挪 N 位」才等于「沿着这条线真的滑了 N 步」。
 */
function buildDiagonalFamily(fam: 'A' | 'B'): Line[] {
  const useRowRight = fam === 'B';
  const parent = new Map<string, string>();
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) parent.set(cellKey(r, c), cellKey(r, c));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const neighborsOf = new Map<string, Cell[]>();
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const { i, p } = globalPos(r, c);
      const nbrs: Cell[] = [];
      const cross = crossNeighbor(i, p);
      const along = useRowRight ? rowRightNeighbor(i, p) : rowLeftNeighbor(i, p);
      if (cross) {
        nbrs.push(cross);
        union(cellKey(r, c), cellKey(cross[0], cross[1]));
      }
      if (along) {
        nbrs.push(along);
        union(cellKey(r, c), cellKey(along[0], along[1]));
      }
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
  let n = 0;
  for (const group of groups.values()) {
    const setK = new Set(group.map(([r, c]) => cellKey(r, c)));
    const within = (r: number, c: number) =>
      neighborsOf.get(cellKey(r, c))!.filter(([rr, cc]) => setK.has(cellKey(rr, cc)));
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
    lines.push({ id: fam + n++, fam, cells: ordered });
  }
  return lines;
}

const LINES: Line[] = (() => {
  const out: Line[] = [...buildDiagonalFamily('A'), ...buildDiagonalFamily('B')];
  // 第三条方向：一整排（朝上朝下交错）。同排相邻两枚是真的共边邻居，所以这
  // 是货真价实的第三个滑动方向，不是方块那种「行列」的方便说法。
  for (let r = 0; r < ROW_LENS.length; r++)
    out.push({ id: 'R' + r, fam: 'R', cells: Array.from({ length: ROW_LENS[r] }, (_, c) => [r, c] as Cell) });
  return out;
})();

/**
 * 三个方向在画面上的单位向量。
 *
 * 三个方向的「一步」都是两枚（见文件开头：只能偶数步），而两枚正好走过 2 个
 * 单位——和方块、小球的一步一样长，所以主循环那套「走了几个 STEP_UNITS 就滑
 * 几步」原封不动就能用。
 */
const FAM_VEC: Record<Fam, [number, number]> = {
  R: [1, 0],
  A: [0.5, Math.sqrt(3) / 2],
  B: [-0.5, Math.sqrt(3) / 2],
};

// ---- 「31」/「13」大三角 ---------------------------------------------------
//
// 三枚同朝向 + 一枚反朝向，正好拼成一个两倍大的三角（等边三角形的标准四分）
// ——这副棋盘上最接近方块那个 2×2 的形状。朝上的大三角是「顶上那一枚 + 下面
// 一排连着的三枚」，朝下的是它的镜像。
function bigTriangleUp(r: number, c: number): Cell[] | null {
  const { i, p } = globalPos(r, c);
  if (p % 2 !== 0) return null;
  const a = globalToLocal(i + 1, p);
  const b = globalToLocal(i + 1, p + 1);
  const d = globalToLocal(i + 1, p + 2);
  return a && b && d ? [[r, c], a, b, d] : null;
}
function bigTriangleDown(r: number, c: number): Cell[] | null {
  const { i, p } = globalPos(r, c);
  if (p % 2 === 0) return null;
  const a = globalToLocal(i - 1, p - 2);
  const b = globalToLocal(i - 1, p - 1);
  const d = globalToLocal(i - 1, p);
  return a && b && d ? [[r, c], a, b, d] : null;
}
const BIG_TRIANGLES: Cell[][] = (() => {
  const groups: Cell[][] = [];
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const up = bigTriangleUp(r, c);
      if (up) groups.push(up);
      const down = bigTriangleDown(r, c);
      if (down) groups.push(down);
    }
  return groups;
})();

/**
 * 偶数步之下，绕回来那一段该从哪儿取内容。
 *
 * 没绕回来的那些照常取（挪 shift 位）。绕回来的那一段（长度正好等于 shift，
 * 所以一定能两两配对）里，每相邻两个位置对调一下取法——相邻位置朝向本来就相
 * 反，对调正好把那一步的错位抵消掉。
 */
export function fillerAwareSource(idx: number, shift: number, n: number): number {
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

export function createTriangleBoard(labels: BoardLabels): Board {
  let grid: Tile[][] = [];
  let nextTileId = 0;
  /** 已经拿过整线奖励的那几条线（按棋子身份记），同一条不给第二次。 */
  let bonusedSignatures = new Set<string>();
  let pendingBonus: Cell[][] = [];

  const isBlank = (t: Tile): boolean => t.color === BLANK;
  const anyBlank = (cells: readonly Cell[]): boolean => cells.some(([r, c]) => isBlank(grid[r][c]));
  const effColorAt = (r: number, c: number): number => effColor(grid[r][c]);
  const isLiveCell = (r: number, c: number): boolean => !isBlank(grid[r][c]);

  function newTile(color: number, dotColor: number): Tile {
    return { id: nextTileId++, color, face: 'flavor', dotColor };
  }

  // ---- 发牌（同 triangle.ts）----------------------------------------------
  // 不是随便洗——正面色和反面色都要在「朝上的位置」和「朝下的位置」之间摊匀，
  // 否则一副牌里某个颜色可能全落在朝上的格子里，那个颜色就永远凑不出大三角。
  // 怎么摊见 engine/orientationDeal.ts，两边用的是同一份。
  const shuffledDeck = (): number[] => dealBalancedDeck(SLOT_IS_UP, TRIANGLE_PALETTE.length, PER_COLOR);

  // 同一正面色的九枚里：其余五色各一枚（5）+ 自己的颜色四枚（4）= 9，和实体
  // 牌的背面分布一样。
  function assignDotColors(deck: number[]): number[] {
    const dotColors = new Array<number>(deck.length);
    const groups: { slots: number[]; pool: number[] }[] = [];
    for (let color = 0; color < TRIANGLE_PALETTE.length; color++) {
      const others: number[] = [];
      for (let k = 0; k < TRIANGLE_PALETTE.length; k++) if (k !== color) others.push(k);
      for (let i = 0; i < 4; i++) others.push(color);
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
      for (let c = 0; c < ROW_LENS[r]; c++) row.push(newTile(deck[idx], dots[idx++]));
      g.push(row);
    }
    return g;
  }

  /** 开局盘上不能有现成的四连或大三角——那是白送的分。 */
  function hasInitialClump(g: Tile[][]): boolean {
    for (const line of LINES) {
      const colors = line.cells.map(([r, c]) => g[r][c].color);
      for (let i = 0; i + 3 < colors.length; i++)
        if (colors[i] === colors[i + 1] && colors[i] === colors[i + 2] && colors[i] === colors[i + 3]) return true;
    }
    for (const cells of BIG_TRIANGLES) {
      const c0 = g[cells[0][0]][cells[0][1]].color;
      if (cells.every(([r, c]) => g[r][c].color === c0)) return true;
    }
    return false;
  }

  function deal(): void {
    let g: Tile[][];
    let tries = 0;
    do {
      nextTileId = 0;
      g = boardFromDeck(shuffledDeck());
      tries++;
    } while (hasInitialClump(g) && tries < 500);
    grid = g;
    bonusedSignatures = new Set();
    pendingBonus = [];
  }

  // ---- 滑动 ---------------------------------------------------------------
  /**
   * 把一条线滑 by 步。
   *
   * 注意 by 的单位是「步」不是「枚」：这副棋盘一步是两枚（文件开头说了为什么
   * 只能偶数），所以这儿把它乘二。方块和小球一步就是一枚，那两副乘一。主循环
   * 那边只管「手指走了几个 STEP_UNITS」，三副棋盘同一段代码。
   */
  function shiftLine(id: string, by: number): Set<string> {
    const line = LINES.find((l) => l.id === id);
    const mask = new Set<string>();
    if (!line) return mask;
    const n = line.cells.length;
    const shift = 2 * by;
    if (((shift % n) + n) % n !== 0) {
      const vals = line.cells.map(([r, c]) => grid[r][c]);
      const shifted = vals.map((_, i) => vals[fillerAwareSource(i, shift, n)]);
      line.cells.forEach(([r, c], i) => {
        grid[r][c] = shifted[i];
      });
    }
    for (const [r, c] of line.cells) mask.add(cellKey(r, c));
    return mask;
  }

  // ---- 得分图案（同 triangle.ts）------------------------------------------
  // 两个：沿着任一条线的四连（可以顺着那条线继续延长），以及大三角——大三角
  // 是个闭合的形状，一步也不扩，永远就是它自己那四枚。
  function qualifies(seed: readonly Cell[], mask: Set<string> | null): boolean {
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
    for (const cells of BIG_TRIANGLES)
      if (qualifies(cells, mask)) matches.push({ cells, points: 4, label: labels.bigTriangle });
    return matches;
  }

  // ---- 整线奖励（同 triangle.ts）------------------------------------------
  // 一整条线全翻到反面、反面颜色又都一样才算——正反混着的不算，哪怕有效颜色
  // 碰巧一致。已经拿过奖励的那条线不给第二次（按棋子身份记，不是按位置）。
  function isFullDotMatch(cells: readonly Cell[]): boolean {
    if (cells.some(([r, c]) => grid[r][c].face !== 'dot')) return false;
    const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
    return cells.every(([r, c]) => grid[r][c].dotColor === c0);
  }
  function findLineBonuses(): Cell[][] {
    const found: Cell[][] = [];
    for (const line of LINES) {
      if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
      // 线上只要有一个空位就再也不算了——空位没有颜色可以和别人一致。
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
  /** 拿掉的那几枚变成空位留在原地——这副棋盘的形状从头到尾不变。 */
  function applyLineBonus(): void {
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
    for (let r = 0; r < ROW_LENS.length; r++)
      for (let c = 0; c < ROW_LENS[r]; c++) {
        const t = grid[r][c];
        if (!isBlank(t)) live.push({ cell: [r, c], tile: t });
      }
    return live;
  }

  return {
    kind: 'triangle',
    palette: TRIANGLE_PALETTE,
    rows: ROW_LENS.length,
    cellsInRow: (r) => ROW_LENS[r],
    tileAt: (r, c) => grid[r][c],
    isBlankAt: (r, c) => isBlank(grid[r][c]),
    pointsUp: isUp,
    // 一枚的重心，单位是「半边长」（边长 = 2 个单位，和另外两副一样）。朝上
    // 的重心偏下、朝下的偏上，所以两者的 y 差着 √3/3——一排里的重心是锯齿状
    // 的，这是三角形拼图本来的样子，不是算错了。
    centerOf: (r, c) => {
      const { i, p } = globalPos(r, c);
      const up = p % 2 === 0;
      const j = up ? p / 2 : (p - 1) / 2;
      const xBase = -i + j * 2;
      return up
        ? [xBase, (Math.sqrt(3) * (3 * i + 2)) / 3]
        : [xBase + 1, (Math.sqrt(3) * (3 * i + 1)) / 3];
    },
    // 包围盒按真正的三个顶点算，不按重心——重心在三角里是偏的，按重心算会把
    // 顶上那一排的尖和最底下那一排的底切掉。
    extent: () => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let r = 0; r < ROW_LENS.length; r++)
        for (let c = 0; c < ROW_LENS[r]; c++) {
          const { i, p } = globalPos(r, c);
          const up = p % 2 === 0;
          const j = up ? p / 2 : (p - 1) / 2;
          const xBase = -i + j * 2;
          const top = Math.sqrt(3) * i;
          const bottom = Math.sqrt(3) * (i + 1);
          const pts: [number, number][] = up
            ? [[xBase, top], [xBase - 1, bottom], [xBase + 1, bottom]]
            : [[xBase + 1, bottom], [xBase, top], [xBase + 2, top]];
          for (const [x, y] of pts) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      return { minX, minY, w: maxX - minX, h: maxY - minY };
    },
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
    // 反面自己只靠整线得分，这副棋盘最短的整线是 3 枚。
    stuckGroups: () => findStuckColorGroups(liveTiles(), new Set(), undefined, MIN_LINE_BONUS_LEN),
    remaining: (): RemainingTileCounts => countRemainingTiles(liveTiles()),
  };
}
