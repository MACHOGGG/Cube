/**
 * 步数系数——《侵蚀阶梯》v1.2 §5，综合分那一头**唯一**的乘数。
 *
 * 单独一个文件，不留在 gameController 里：那个文件一路 import 到 Vite 的
 * `import.meta.glob`（图标那一套），拿 esbuild 打成 node 能跑的东西会当场炸。纯函
 * 数拆出来，门（scripts/check-step-coef.mjs）就能直接量它——`erosion.ts`、
 * `outerEdge.ts`、`puzzleScore.ts` 都是这么摆的。
 */

export interface StepCoefInput {
  /** 这副棋盘的基准步数（engine/erosion.ts 的表，§2）。 */
  par: number;
  /** 这一局清掉了几枚。 */
  cleared: number;
  /** 全盘一共几枚。 */
  tiles: number;
  /** 这一局走了几步。 */
  moves: number;
  /** 这一档乘不乘它。不乘就恒 1（见下面那段）。 */
  apply: boolean;
}

/**
 * **步数系数**——《侵蚀阶梯》v1.2 §5，综合分那一头唯一的乘数。
 *
 * ```
 * 效率比 x = (par × 已清格数 ÷ 全盘格数) ÷ 实际步数     （清盘时 x = par ÷ 步数）
 * 步数系数 = max(1, x)²          综合分 = round(拼出分 × 步数系数)
 * ```
 *
 * 三件事写在这儿，别在别处再推一遍：
 *
 * · **有下限 1，没有上限。** 走得比基准多不扣分——扣分的话，一局打得久反而越打
 *   越亏，玩家会学会「打到一半就退出」。走得比基准少才加分，而且是平方，所以
 *   「少走一步」在接近基准时最值钱。
 * · **按清掉的比例折算基准。** 清了一半盘面就只跟半个基准比；不折算的话，开局两
 *   步就退出的人效率比会高得离谱。
 * · **一步没走 = 一分不加**（moves 0 时回 1）：除以 0 的那一下会得到 Infinity，
 *   round(分 × Infinity) 是 NaN，结算页上是一片空白。
 *
 * 不乘的三档（`apply` 为假）各有各的理由：老虎机按「完成几次目标」给奖励，步步为
 * 营的步数**本来就是它的资源**（再乘一次等于罚两遍），无限反转一局固定 100 秒、步
 * 数多少不说明什么。
 */
export function stepCoefFor({ par, cleared, tiles, moves, apply }: StepCoefInput): number {
  if (!apply) return 1;
  if (moves <= 0 || tiles <= 0) return 1;
  const x = ((par * cleared) / tiles) / moves;
  return Math.max(1, x) ** 2;
}
