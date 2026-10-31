/**
 * 收尾逐一消除：一拍只消一组整线时，挑哪一组（10-31 方案推14 Z-B09 R2′，站长 D01 甲、D23）。六副棋盘共用。
 *
 *   ① 最长的先（一拍消得越多，越早收场）；
 *   ② 一样长时，**这一色星星在盘上剩得少的先**（D23：剩得少的那一色先清掉，盘上留下的颜色更少、更好凑）；
 *   ③ 再一样，按原扫描次序（方块先行后列、从上到下、从左到右；外边族照 outerEdges 的次序）——下标小的先。
 *
 * 只挑、不改任何状态（签名、收拢的行列由调用的那一头只给挑中的那一组记）。
 *
 * @param groups 这一拍够格的那几组（已按扫描次序排好）
 * @param starsOfColour 这一组那一色的星星此刻盘上一共几颗
 * @returns 要交的那一组的下标；groups 为空时回 -1
 */
export function pickLineGroup(groups: readonly (readonly unknown[])[], starsOfColour: (g: any) => number): number {
  let best = -1;
  let bestLen = -1;
  let bestStars = Infinity;
  for (let i = 0; i < groups.length; i++) {
    const len = groups[i].length;
    if (len < bestLen) continue;
    const stars = starsOfColour(groups[i]);
    if (len > bestLen || stars < bestStars) {
      best = i;
      bestLen = len;
      bestStars = stars;
    }
  }
  return best;
}
