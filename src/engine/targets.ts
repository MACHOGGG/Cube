/**
 * 随机得分目标：二十个图案，和它们之间「不能同时出现」的关系。
 *
 * 玩法是这样的：先挑三角／小球／方块，用最基础的那套布局；4-3-2-1 之前老虎
 * 机转两个图案出来，这一局就只有这两个算分，别的一律不算。
 *
 * ── 格子怎么记 ──────────────────────────────────────────────
 *
 * 每个图案是一串 [行, 列]，左上角对齐到 (0,0)。列的单位按族不同：
 *
 *   · 方块 3x：一列就是一个方块。规规矩矩的方格。
 *   · 小球 2x：一列是半个直径。同一行里相邻两颗差 2，下一行错开 1——六角
 *     密堆本来就是这样，不用半格就写不出「上面一颗、下面两颗」。
 *   · 三角 1x：一列是半个三角的宽，因为朝上和朝下的三角是互相咬合的。朝向
 *     不能从行列算出来（同一列在相邻两行可以都朝下，见 11），所以逐块记。
 *
 * 这些数不是照着图猜的，是从玩家给的那二十个 SVG 里量出来的（量的是每一块的
 * 中心，再按各族的格距归一）。改图案就改这张表，别处不用动。
 */

export type Family = 'square' | 'circle' | 'triangle';
/** 三角朝上还是朝下。别的两族没有朝向。 */
export type Facing = 'U' | 'D';
export type TargetCell = readonly [row: number, col: number, facing?: Facing];

export interface TargetPattern {
  /** 玩家给的编号，也是图标文件名：src/assets/icons/target-<id>.svg */
  id: string;
  family: Family;
  cells: readonly TargetCell[];
}

/** 拼出来要几枚。 */
export const sizeOf = (p: TargetPattern): number => p.cells.length;

/**
 * 这个图案值多少分：枚数² ÷ 2，向上取整。
 *
 * 玩家定的：3 枚 5 分、4 枚 8 分、5 枚 13 分。多一枚难的不是多一点，所以分
 * 数是平方着长的；除以二是把它压回和别处得分同一个量级（整行奖励那边用的是
 * 长度的平方，没有除）。
 */
export const scoreOf = (p: TargetPattern): number => Math.ceil((p.cells.length ** 2) / 2);

const T = (id: string, family: Family, cells: readonly TargetCell[]): TargetPattern =>
  ({ id, family, cells });

export const TARGETS: readonly TargetPattern[] = [
  // ---- 三角 ----------------------------------------------------------
  T('11', 'triangle', [[0, 0, 'U'], [0, 1, 'D'], [0, 2, 'U'], [1, 0, 'D'], [1, 2, 'D']]),
  T('12', 'triangle', [[0, 0, 'U'], [1, 0, 'D']]),
  T('13', 'triangle', [[0, 0, 'U'], [0, 1, 'D'], [0, 2, 'U'], [0, 3, 'D']]),
  T('14', 'triangle', [[0, 0, 'U'], [0, 1, 'D'], [0, 2, 'U']]),
  T('15', 'triangle', [[0, 1, 'U'], [1, 0, 'U'], [1, 1, 'D'], [1, 2, 'U']]),
  // ---- 小球（列是半个直径）--------------------------------------------
  T('21', 'circle', [[0, 1], [0, 3], [1, 0], [1, 2]]),
  T('22', 'circle', [[0, 1], [1, 0], [1, 2], [2, 1]]),
  T('23', 'circle', [[0, 1], [1, 0], [1, 2]]),
  T('24', 'circle', [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]]),
  T('25', 'circle', [[0, 0], [0, 4], [1, 1], [1, 3]]),
  T('26', 'circle', [[0, 1], [0, 3], [1, 0], [1, 4], [2, 1], [2, 3]]),
  T('27', 'circle', [[0, 0], [0, 2], [0, 4], [0, 6]]),
  // ---- 方块 ----------------------------------------------------------
  T('31', 'square', [[0, 0], [0, 2], [1, 1], [1, 3]]),
  T('32', 'square', [[0, 0], [0, 1], [0, 2]]),
  T('33', 'square', [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]]),
  T('34', 'square', [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]]),
  T('35', 'square', [[0, 0], [1, 0], [2, 0], [2, 1]]),
  T('36', 'square', [[0, 0], [0, 1], [0, 2], [0, 3]]),
  T('37', 'square', [[0, 0], [0, 1], [1, 0], [1, 1]]),
  T('38', 'square', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]),
];

export const targetById = (id: string): TargetPattern | undefined =>
  TARGETS.find((t) => t.id === id);

export const targetsOf = (family: Family): TargetPattern[] =>
  TARGETS.filter((t) => t.family === family);

/**
 * 玩家点名不能同时出现的几对。
 *
 * 这一张是他自己定的，照抄。里面有几对不是包含关系（36 和 31 谁也不含谁），
 * 那是玩法上的取舍，不是几何——所以只能照抄，算不出来。
 */
const SAID: readonly (readonly [string, string])[] = [
  ['11', '14'], ['12', '11'], ['12', '15'], ['13', '14'], ['11', '13'],
  ['21', '22'], ['23', '21'], ['23', '22'], ['23', '24'], ['25', '26'],
  ['32', '36'], ['32', '38'], ['36', '38'],
  ['36', '31'], ['33', '37'], ['34', '35'],
];

/**
 * 一个图案装得进另一个吗——把小的那个平移一遍，看是不是大的的一部分。
 *
 * 装得进就不能同时转出来：那样拼好大的，小的白送。玩家给的表里漏了三组
 * （15 含 14、33 含 32、34 含 32），与其手工补，不如照几何算——图案以后改
 * 了，这里跟着就对，不会忘。
 */
export function contains(big: TargetPattern, small: TargetPattern): boolean {
  if (big.family !== small.family || small.cells.length >= big.cells.length) return false;
  const key = (r: number, c: number, f?: Facing) => `${r},${c},${f ?? ''}`;
  const have = new Set(big.cells.map(([r, c, f]) => key(r, c, f)));
  for (const [ar, ac] of big.cells) {
    const [sr, sc] = small.cells[0];
    const dr = ar - sr;
    const dc = ac - sc;
    if (small.cells.every(([r, c, f]) => have.has(key(r + dr, c + dc, f)))) return true;
  }
  return false;
}

/** 所有不能同时出现的对，编号小的在前。 */
export function exclusions(): Set<string> {
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const out = new Set(SAID.map(([a, b]) => pair(a, b)));
  for (const a of TARGETS) {
    for (const b of TARGETS) {
      if (a !== b && contains(a, b)) out.add(pair(a.id, b.id));
    }
  }
  return out;
}

const EXCLUDED = exclusions();

/** 这两个能不能一起转出来。 */
export const compatible = (a: string, b: string): boolean =>
  a !== b && !EXCLUDED.has(a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * 转两个出来。
 *
 * 先随机挑第一个，再从「和它不冲突的」里挑第二个——不是抽两个再检查，那样
 * 抽到冲突的组合就得重来，而且越冲突的图案越容易被漏掉。
 */
export function drawPair(family: Family, rand: () => number = Math.random): [TargetPattern, TargetPattern] | null {
  const pool = targetsOf(family);
  if (pool.length < 2) return null;
  const order = [...pool].sort(() => rand() - 0.5);
  for (const first of order) {
    const mates = pool.filter((p) => compatible(first.id, p.id));
    if (mates.length) return [first, mates[Math.floor(rand() * mates.length)]];
  }
  return null;
}
