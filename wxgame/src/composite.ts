/**
 * 一局打完的综合得分——照 src/engine/gameController.ts 的算法抄的（那个文件
 * 连着计时器和页面，搬不动；改公式请两边一起改）：
 *
 *   综合 = 得分 × 用时系数 × (1 + 有效得分率) × 0.95^没翻的枚数
 */

/** 时间说话的分量：离 1 有多远，放大一倍半。单人和小屋同一条规矩。 */
export const TIME_GAIN = 1.5;
/** 结束时每留一枚没翻的正面，综合得分乘一次它。 */
export const UNFLIPPED_SCALE = 0.95;

/**
 * 用时系数：开局 2，五分钟内直线落到 1，之后越掉越慢、慢慢贴向 0.5；再按
 * TIME_GAIN 放大离 1 的距离。数出来是：秒杀 2.5，两分半 1.75，五分钟 1，
 * 七分半 0.53，十分钟 0.35。
 */
export function timeMultiplierFor(elapsedSec: number, gain = TIME_GAIN): number {
  const t = Math.max(0, elapsedSec);
  const base = t <= 300 ? 2 - t / 300 : 0.5 + 0.5 * Math.exp(-(t - 300) / 150);
  return 1 + gain * (base - 1);
}

export interface CompositeInput {
  score: number;
  elapsedSec: number;
  /** 有效得分率，0-100。 */
  ratePercent: number;
  neverFlipped: number;
}

export interface CompositeResult {
  total: number;
  timeMult: number;
  bonusMult: number;
  unflippedScale: number;
}

export function compositeScore(i: CompositeInput): CompositeResult {
  const timeMult = timeMultiplierFor(i.elapsedSec);
  const bonusMult = 1 + i.ratePercent / 100;
  const unflippedScale = UNFLIPPED_SCALE ** i.neverFlipped;
  const total = Math.max(0, Math.round(i.score * timeMult * bonusMult * unflippedScale));
  return { total, timeMult, bonusMult, unflippedScale };
}
