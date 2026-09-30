/**
 * 随机得分目标：二十个图案。
 *
 * 玩法是这样的：先挑小球／方块，用最基础的那套布局；4-3-2-1 之前老虎机转
 * **一个**图案出来，这一局就只有它算分，别的一律不算。
 *
 * ── 一个，不是一对（《侵蚀阶梯》v1.2 PR-8）──────────────────
 *
 * 从前一局转两个，于是这张表还带着一张「哪两个不能同时出现」的互斥表（玩家
 * 点名的十六对，加上几何算出来的包含关系），以及一个「先抽一个、再从合得来
 * 的里抽第二个」的 drawPair。一局只认一个图案之后，「同时出现」这件事不存
 * 在了，那一整套跟着退役：drawOne 在该族里等概率抽，不查任何互斥（PR-8 明文
 * 「不查 exclusions」）。
 *
 * 换来的是另一件事：目标会**变小**。全局翻面数走到侵蚀阶梯的每一道坎上
 * （s₄ / s₄+s₃ / s₄+s₃+s₂，见 engine/erosion.ts），目标就少一枚，下限 1；
 * 判定收的是「目标的任意仍相连 k 子形」，子形怎么枚举见 targetMatch.ts 的
 * erodedShapes。
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

/**
 * 拼成几枚值多少分：枚数² ÷ 2，向上取整。
 *
 * 玩家定的：3 枚 5 分、4 枚 8 分、5 枚 13 分。多一枚难的不是多一点，所以分
 * 数是平方着长的；除以二是把它压回和别处得分同一个量级（整行奖励那边用的是
 * 长度的平方，没有除）。
 *
 * 收的是**枚数**，不是图案：侵蚀之后拼成的是目标的 k 子形，分要按拼成的那几枚
 * 算（《侵蚀阶梯》v1.2 PR-8）。按目标原来有几枚算的话，图案降到 1 枚之后随便一
 * 枚同色都能拿到五枚那一档的分。
 */
export const scoreForSize = (n: number): number => Math.ceil(Math.max(1, n) ** 2 / 2);

/** 这个图案一枚不少地拼出来值多少分。 */
export const scoreOf = (p: TargetPattern): number => scoreForSize(p.cells.length);

/**
 * 侵蚀到第 level 级（4→3→2→1）时，这个目标还剩几枚：每降一级少一枚，**下限 1**
 * （《侵蚀阶梯》v1.2 PR-8）。
 *
 * 和基础玩法的 1×N 是同一根阶梯、同一套段数——降级的时机由 engine/erosion.ts 一
 * 处说了算，这儿只把「第几级」翻译成「几枚」。两枚的图案降到第 2 级就已经是 1 枚
 * 了，再降也还是 1 枚：下限不是保护性写法，是玩法本身（一枚之后没有更小的图案）。
 */
export const sizeAtLevel = (p: TargetPattern, level: number): number =>
  Math.max(1, p.cells.length - (4 - Math.max(1, Math.min(4, Math.round(level)))));

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
 * 转一个出来：这一族里等概率随机（《侵蚀阶梯》v1.2 PR-8）。
 *
 * 不查任何互斥表——一局只认一个图案，「这两个不能同时出现」无从发生。
 *
 * 抽的时候只从那条流里读**一个**数。这一点是硬的：小屋里选「大家拼同一个图案」
 * 时，这里咬的是全屋共用的那条种子流（main.ts 传进来的 seededRandom），而后面
 * 发牌用的是同一条流——多读一个数或少读一个数，苹果和安卓拿到的棋盘就不是同
 * 一副，排名却还按「同一局」来比。从前那一版洗一遍牌再挑，读几个数由 Fisher–
 * Yates 的循环长度决定（一族七个图案就读七个），现在是一个，改这儿的时候别退
 * 回去。
 */
export function drawOne(family: Family, rand: () => number = Math.random): TargetPattern | null {
  const pool = targetsOf(family);
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}
