/**
 * 方块（6×6）的棋盘模型——只有规则，没有画面。
 *
 * 网页版的 src/shapes/square.ts 把规则和 DOM 画面写在一起；小游戏没有 DOM，
 * 所以把规则单独抄出来放在这儿：发牌、整行整列循环滑动、2×2 与 1×4 的得分
 * 图案、整行整列同色反面消掉、全翻完即结束、死局判定。计分连锁
 * （src/engine/scoring.ts）和死局判定（src/engine/stalemate.ts）直接用网页版
 * 的那两个文件，不另写一份——两边永远是同一套规则。
 *
 * 每一处都照 square.ts 抄的，改规则请两边一起改。
 */
import type { Cell, Match, Tile } from '../../src/engine/types';
import { cellKey, effColor } from '../../src/engine/types';
import { shuffle } from '../../src/engine/rng';
import { createCascadeStepper, type CascadeConfig, type CascadeStepper } from '../../src/engine/scoring';
import {
  countRemainingTiles,
  findStuckColorGroups,
  type LiveTile,
  type RemainingTileCounts,
} from '../../src/engine/stalemate';

export const BOARD_DIM = 6;
/** 同 square.ts 的 standard 配色（六种色相至少隔 50°，正面和自己的反面不会认混）。 */
export const PALETTE: readonly string[] = ['#C46A4E', '#9C8A3D', '#4A9573', '#4C7EAD', '#8067A8', '#AD5C82'];

/** 加分气泡上写的名字：2×2、1×4、整线，以及没名字时的兜底。 */
export interface BoardLabels {
  block22: string;
  run4: string;
  line: string;
  pattern: string;
}

export interface SquareBoard {
  readonly rows: number;
  readonly cols: number;
  tileAt(r: number, c: number): Tile;
  /** 重新发一副干净的牌（开局没有现成的三连 / 2×2）。 */
  deal(): void;
  /** 整行 / 整列循环滑 by 格（正数向右 / 向下）。返回这一线的格子——连锁从这儿找起。 */
  shift(axis: 'row' | 'col', index: number, by: number): Set<string>;
  /** 一次滑动之后的整条连锁（得分 → 翻面 → 整线 → 再判），一拍一拍地给。 */
  cascade(mask: Set<string>): CascadeStepper;
  /** 全翻完了，或整块棋盘都消没了。 */
  isGameOver(): boolean;
  /** 再也翻不动了：[] 是还活着，否则是每种颜色剩下的正面（画红光用）。 */
  stuckGroups(): Cell[][];
  /** 结束时还留在盘上的：没翻过的几枚（扣分用）、翻过但没消掉的几枚。 */
  remaining(): RemainingTileCounts;
}

export function createSquareBoard(labels: BoardLabels): SquareBoard {
  let rows = BOARD_DIM;
  let cols = BOARD_DIM;
  let grid: Tile[][] = [];
  let nextTileId = 0;
  // findLineBonuses 找到的整行 / 整列，留给同一拍里的 applyLineBonus 消掉
  // （同 square.ts：先翻面再一起拿掉，行列号才不会被前一组的删除改乱）。
  let pendingRowClears: number[] = [];
  let pendingColClears: number[] = [];

  function newTile(color: number, dotColor: number): Tile {
    return { id: nextTileId++, color, face: 'flavor', dotColor };
  }

  // ---- 发牌（同 square.ts）-----------------------------------------------
  // 六种颜色各六枚，正好一副实体牌。
  function shuffledDeck(): number[] {
    const deck: number[] = [];
    for (let c = 0; c < PALETTE.length; c++) for (let i = 0; i < BOARD_DIM; i++) deck.push(c);
    return shuffle(deck);
  }

  // 每一枚的反面颜色发牌时就定死（像印好的牌）：同一正面色的六枚里，五枚各
  // 拿其余五色之一（互不重复），一枚拿自己的颜色（「自配」）。
  function assignDotColors(deck: number[]): number[] {
    const dotColors = new Array<number>(deck.length);
    for (let color = 0; color < PALETTE.length; color++) {
      const assignments = shuffle([
        ...Array.from({ length: PALETTE.length }, (_, k) => k).filter((k) => k !== color),
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

  // 开局盘上不能有现成的三连（横、竖、斜）或 2×2——那是白送的分。
  function hasInitialClump(g: Tile[][]): boolean {
    const R = g.length;
    const C = g[0].length;
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
        if (r <= R - 3 && c <= C - 3 && col(r, c) === col(r + 1, c + 1) && col(r, c) === col(r + 2, c + 2)) return true;
        if (r <= R - 3 && c >= 2 && col(r, c) === col(r + 1, c - 1) && col(r, c) === col(r + 2, c - 2)) return true;
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
    rows = BOARD_DIM;
    cols = BOARD_DIM;
    pendingRowClears = [];
    pendingColClears = [];
  }

  // ---- 滑动（同 square.ts 的 applyDrag）----------------------------------
  function shift(axis: 'row' | 'col', index: number, by: number): Set<string> {
    const mask = new Set<string>();
    if (axis === 'row') {
      const r = index;
      const n = cols;
      grid[r] = grid[r].map((_, i) => grid[r][(((i - by) % n) + n) % n]);
      for (let c = 0; c < cols; c++) mask.add(cellKey(r, c));
    } else {
      const c = index;
      const n = rows;
      const colVals = grid.map((row) => row[c]);
      const shifted = colVals.map((_, i) => colVals[(((i - by) % n) + n) % n]);
      for (let r = 0; r < rows; r++) grid[r][c] = shifted[r];
      for (let r = 0; r < rows; r++) mask.add(cellKey(r, c));
    }
    return mask;
  }

  // ---- 得分图案（同 square.ts）--------------------------------------------
  // 图案只沿自己的方向长：1×4 只顺着那一行 / 列延长，2×2 只整行整列地扩成更
  // 大的矩形——从不做「同色一片全算」的泛洪。
  function effColorAt(r: number, c: number): number {
    return effColor(grid[r][c]);
  }
  function cellsSameColor(cells: Cell[]): boolean {
    const c0 = effColorAt(cells[0][0], cells[0][1]);
    return cells.every(([r, c]) => effColorAt(r, c) === c0);
  }
  function touches(cells: Cell[], mask: Set<string> | null): boolean {
    if (!mask) return true;
    return cells.some(([r, c]) => mask.has(cellKey(r, c)));
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
        matches.push({ cells: region, points: Math.max(4, region.length), label: labels.block22 });
      }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c <= cols - 4; c++) {
        const seed: Cell[] = [[r, c], [r, c + 1], [r, c + 2], [r, c + 3]];
        if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
        const region = extendRunHoriz(r, c, c + 3);
        matches.push({ cells: region, points: Math.max(4, region.length), label: labels.run4 });
      }
    for (let c = 0; c < cols; c++)
      for (let r = 0; r <= rows - 4; r++) {
        const seed: Cell[] = [[r, c], [r + 1, c], [r + 2, c], [r + 3, c]];
        if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
        const region = extendRunVert(c, r, r + 3);
        matches.push({ cells: region, points: Math.max(4, region.length), label: labels.run4 });
      }
    return matches;
  }

  // ---- 整行 / 整列奖励（同 square.ts）------------------------------------
  // 一整线全是反面、反面颜色又都一样才算——正面和反面混着的不算，哪怕有效
  // 颜色碰巧一致。
  function isFullDotMatch(tiles: Tile[]): boolean {
    if (tiles.some((t) => t.face !== 'dot')) return false;
    const c0 = tiles[0].dotColor;
    return tiles.every((t) => t.dotColor === c0);
  }
  function findLineBonuses(): Cell[][] {
    const rowClears: number[] = [];
    for (let r = 0; r < rows; r++) if (isFullDotMatch(grid[r])) rowClears.push(r);
    const colClears: number[] = [];
    for (let c = 0; c < cols; c++) if (isFullDotMatch(grid.map((row) => row[c]))) colClears.push(c);
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
  function applyLineBonus() {
    removeLines(pendingRowClears, pendingColClears);
    pendingRowClears = [];
    pendingColClears = [];
  }

  function cascadeConfig(): CascadeConfig {
    return {
      tileAt: (r, c) => grid[r][c],
      findMatches,
      findLineBonuses,
      onLineBonus: applyLineBonus,
      resetMaskOnLineBonus: true,
      isTerminalAfterLineBonus: () => rows === 0 || cols === 0,
    };
  }

  function liveTiles(): LiveTile[] {
    const live: LiveTile[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) live.push({ cell: [r, c], tile: grid[r][c] });
    return live;
  }

  return {
    get rows() {
      return rows;
    },
    get cols() {
      return cols;
    },
    tileAt: (r, c) => grid[r][c],
    deal,
    shift,
    cascade: (mask) => createCascadeStepper(cascadeConfig(), mask, { pattern: labels.pattern, line: labels.line }),
    isGameOver: () =>
      (grid.length > 0 && grid.every((row) => row.every((t) => t.face === 'dot'))) || rows === 0 || cols === 0,
    // 反面自己只靠整行 / 整列得分，行列会随消除变短——门槛跟着当前较短的边长走。
    stuckGroups: () => findStuckColorGroups(liveTiles(), new Set(), undefined, Math.min(rows, cols)),
    remaining: () => countRemainingTiles(liveTiles()),
  };
}
