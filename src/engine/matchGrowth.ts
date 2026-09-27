import type { Cell } from './types';
import { STRINGS, type Lang } from '../i18n';

/**
 * 得分气泡上那一句「几连」。**枚数是变的**（《侵蚀阶梯》v1.2 §2：图案 4→3→2→1），
 * 所以这一句现算，不再是写死的「4连」。八副棋盘共用这一处。
 */
export function runLabel(lang: Lang, n: number): string {
  return STRINGS[lang].labelRunN.replace('{n}', String(n));
}

/**
 * Two shared "grow a qualifying seed match, but only along its own regular
 * shape" helpers, replacing the old generic same-color flood fill every
 * shape used to call here. Flood fill was wrong: it happily folded in any
 * same-color tile touching the seed from *any* direction, so a straight
 * run-of-4 with an unrelated same-color tile poking off one side scored as
 * if that tile were part of the line, and a shape that stretches easily
 * (a 2x2 block, a rhombus cluster) could balloon into whatever oddly-shaped
 * blob of matching color happened to be connected to it. Both helpers below
 * only ever accept a *complete* next step of the seed's own shape family —
 * a longer straight line, or a bigger version of the same parallelogram —
 * never a partial or off-axis addition.
 */

/**
 * Extends a run-of-4 seed (a contiguous slice of an ordered line, e.g. one
 * of a board's row/diagonal LINES) outward in both directions along that
 * *same* line only, for as long as the color keeps matching — so "1x4"
 * becomes "1x5"/"1x6" when the line itself continues, but a same-color tile
 * one step off that line (on a different line entirely) is never reachable
 * and so never folds in.
 */
export function extendRunInLine(
  lineCells: Cell[],
  seedStart: number,
  seedEnd: number,
  effColorAt: (r: number, c: number) => number,
  isLive: (r: number, c: number) => boolean,
): Cell[] {
  const [sr, sc] = lineCells[seedStart];
  const color = effColorAt(sr, sc);
  let lo = seedStart;
  let hi = seedEnd;
  while (lo - 1 >= 0) {
    const [r, c] = lineCells[lo - 1];
    if (!isLive(r, c) || effColorAt(r, c) !== color) break;
    lo--;
  }
  while (hi + 1 < lineCells.length) {
    const [r, c] = lineCells[hi + 1];
    if (!isLive(r, c) || effColorAt(r, c) !== color) break;
    hi++;
  }
  return lineCells.slice(lo, hi + 1);
}

/*
 * `growParallelogram`（2×2 那一族图案的「长大」）**已经删掉**——《侵蚀阶梯》v1.2
 * §1.1：得分图案只剩同色 1×N 连线，2×2 / 2+2 / 1-2-1 / 大三角全部退役，连带它们
 * 各自的扩张规则。剩下的扩张只有一条：同一条线上往两头接着长（上面那个
 * extendRunInLine）。
 */

/**
 * 方块那副棋盘「一片得分区域能长多大」的三条规矩。
 *
 * 上面那两个函数是别的七副在用的；方块的行、列、矩形有更省事的写法（它是规整
 * 的网格，不必绕 LINES），一直长在 shapes/square.ts 那个工厂函数肚子里。搬到
 * 这里来只为一件事：让体检脚本（scripts/check-match-growth.mjs）量的是真件。
 * 从前它照着那几行手抄了一份副本去量，抄本永远是过的——真件改了、抄本没跟上，
 * 那道体检还照样报「全部通过」。
 *
 * 棋盘尺寸取的是函数而不是数：方块消掉一整行或一整列时 rows/cols 会当场变小
 * （见 square.ts 的 applyLineBonus），拿一个数存下来就会停在旧尺寸上。
 */
export interface SquareGrowthView {
  rows(): number;
  cols(): number;
  /** 这一格此刻算什么颜色（正面是它自己的色，反面是点色）。 */
  effColorAt(r: number, c: number): number;
}

export function squareGrowth(view: SquareGrowthView) {
  const { effColorAt } = view;

  /** 一条横的四连，沿着自己这一行往左右两头长到同色为止。 */
  function extendRunHoriz(r: number, cStart: number, cEnd: number): Cell[] {
    const color = effColorAt(r, cStart);
    const cols = view.cols();
    let lo = cStart;
    let hi = cEnd;
    while (lo - 1 >= 0 && effColorAt(r, lo - 1) === color) lo--;
    while (hi + 1 < cols && effColorAt(r, hi + 1) === color) hi++;
    const cells: Cell[] = [];
    for (let c = lo; c <= hi; c++) cells.push([r, c]);
    return cells;
  }

  /** 一条竖的四连，沿着自己这一列往上下两头长。 */
  function extendRunVert(c: number, rStart: number, rEnd: number): Cell[] {
    const color = effColorAt(rStart, c);
    const rows = view.rows();
    let lo = rStart;
    let hi = rEnd;
    while (lo - 1 >= 0 && effColorAt(lo - 1, c) === color) lo--;
    while (hi + 1 < rows && effColorAt(hi + 1, c) === color) hi++;
    const cells: Cell[] = [];
    for (let r = lo; r <= hi; r++) cells.push([r, c]);
    return cells;
  }

  /*
   * `extendRect`（一个 2×2 一次长一整行 / 一整列）连着它那两个跨度判断
   * （rowSpanMatches / colSpanMatches）一起删了——《侵蚀阶梯》v1.2 §1.1 把 2×2
   * 这一族图案退役了，方块那副现在只找同色 1×N 连线，没人再调它。
   *
   * 留着不会编译报错（它是工厂返回的一个字段，noUnusedLocals 管不到），但会骗
   * 下一个人：照着它以为 2×2 还在算分。
   */

  return { extendRunHoriz, extendRunVert };
}
