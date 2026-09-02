/**
 * 在棋盘上找「转出来的那两个图案」。
 *
 * 这一层只管一件事：给一个图案和一副棋盘，说出它在哪儿拼成了。八个玩法各自
 * 的 findMatches 不受影响——随机得分目标是另一套判分，走的是这里。
 *
 * ── 三族的格子怎么对上 ──────────────────────────────────────
 *
 * targets.ts 里的图案记的是「几何坐标」：行，加上以半格为单位的列。棋盘用的
 * 却是各自的行列号，两者不是一回事，差在每一族的排布上：
 *
 *   方块：一样。(行+dr, 列+dc)。
 *
 *   小球：棋盘是个 28 颗的三角（第 r 行有 r+1 颗），第 c 颗的横坐标是
 *         2c − r（半径为单位）。所以几何上往右挪 dc 个半径、往下挪 dr 行，
 *         列号只挪 (dc + dr) / 2。要求 dc + dr 是偶数——七个图案各自的
 *         (行+列) 奇偶都一致，所以整体平移一下总能落在格子上。
 *
 *   三角：棋盘按 (行 r, 位置 p) 记，p 是偶数就朝上（见 shapes/triangle.ts
 *         的 iconTri）。每一行还整体左移半格，所以几何列 g 和 p 的关系是
 *         g = p − r − 1，反过来 p = p0 + dg + dr。朝向不用另存——p 的奇偶
 *         就是朝向，图案里记的那一份只是用来核对，核对不上说明图读错了。
 *
 * 这三条不是推的，是拿玩家给的二十个 SVG 逐个验过的：三角五个图案的朝向都能
 * 由 p 的奇偶推出来，小球七个图案的 (行+列) 奇偶各自一致。
 */
import type { Cell, Tile } from './types';
import { effColor } from './types';
import type { Family, TargetPattern } from './targets';

/** 判定要问棋盘的那几件事。八个玩法各自实现，这一层不关心棋盘怎么画的。 */
export interface BoardView {
  /** 这个格子在不在棋盘上。 */
  has(r: number, c: number): boolean;
  /** 这一枚现在是什么颜色——翻过的看点色，没翻的看正面色。 */
  tileAt(r: number, c: number): Tile | null;
  /** 从哪些格子起手去试。给全盘就行，重复的由调用方去重。 */
  cells(): Cell[];
}

/** 把图案的一格（几何坐标）落到棋盘的行列上。落不上就返回 null。 */
function place(
  family: Family,
  anchor: Cell,
  dr: number,
  dg: number,
): Cell | null {
  const [r0, c0] = anchor;
  if (family === 'square') return [r0 + dr, c0 + dg];
  if (family === 'triangle') return [r0 + dr, c0 + dg + dr];
  // 小球：几何上挪 dg 个半径、dr 行，列号只挪一半。
  const sum = dg + dr;
  if (sum % 2 !== 0) return null;
  return [r0 + dr, c0 + sum / 2];
}

/**
 * 这个图案在棋盘上拼成的所有地方。
 *
 * 三条都要满足，缺一不可：
 *   · 每一格都在棋盘上；
 *   · 这些格子现在是同一个颜色；
 *   · 里面至少还有一枚是正面。
 *
 * 最后一条是整个计分体系的老规矩（见 scoring.ts）：一次得分总要翻掉点什么，
 * 否则同一片已经翻好的图案可以推来推去反复计分。
 */
export function findTargetAt(
  view: BoardView,
  pattern: TargetPattern,
  anchor: Cell,
): Cell[] | null {
  const [br, bg] = pattern.cells[0];
  const out: Cell[] = [];
  let color = -1;
  let anyFront = false;
  for (const [pr, pg] of pattern.cells) {
    const at = place(pattern.family, anchor, pr - br, pg - bg);
    if (!at || !view.has(at[0], at[1])) return null;
    const tile = view.tileAt(at[0], at[1]);
    if (!tile) return null;
    const c = effColor(tile);
    if (color === -1) color = c;
    else if (c !== color) return null;
    if (tile.face === 'flavor') anyFront = true;
    out.push(at);
  }
  return anyFront ? out : null;
}

/** 这个图案在整副棋盘上拼成的所有地方（可能有重叠，调用方自己挑）。 */
export function findTargets(view: BoardView, pattern: TargetPattern): Cell[][] {
  const out: Cell[][] = [];
  for (const anchor of view.cells()) {
    const hit = findTargetAt(view, pattern, anchor);
    if (hit) out.push(hit);
  }
  return dedupe(out);
}

/** 同一片格子被不同起手点找到好几遍，只留一份。 */
function dedupe(groups: Cell[][]): Cell[][] {
  const seen = new Set<string>();
  const out: Cell[][] = [];
  for (const g of groups) {
    const key = g
      .map(([r, c]) => `${r},${c}`)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}
