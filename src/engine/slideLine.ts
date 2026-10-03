/**
 * 一条线滑 shift 格之后，每一格换成谁（第 14 推）。
 *
 * ── 原先是什么样 ──────────────────────────────────────────────
 *
 * 五副外边族棋盘（小球、六边小球、七色小球、菱形方块、大三角）的 applyDrag 各写一遍
 *
 *   vals.map((_, i) => vals[(((i - shift) % n) + n) % n])
 *
 * 大三角另有一套 fillerAwareSource（偶数步 + 绕回来那一段两两交换）。两件事谁都没管：
 *
 *   · **线上活格不到两枚。** 外边族的格子会离场，一条线可能只剩一枚、甚至一枚不剩。
 *     n = 1 时滑多少都是原样，可 applyDrag 照样往下走、照样记一步；n = 0 时
 *     `shift % 0` 是 NaN，连「转了整圈」那一句都拦不住——「拖空线白扣一步」。
 *   · **换出来的不是一个排列。** 大三角长滑（奇数长的线滑过 n − 1 格）时，
 *     fillerAwareSource 把同一枚分给了两格，另一枚凭空消失——「长滑会复制或丢棋子」。
 *     盘面上多一枚、少一枚，不报错，只是这一局从此是另一副牌。
 *
 * ── 现在 ──────────────────────────────────────────────────────
 *
 *   · n < 2：回 null——这一下不算一步。
 *   · 算出来的来源不是 0…n−1 各一次：回 null——宁可这一步不算，不许盘面上多一枚、少一枚。
 *   · 大三角的步数先夹在 ±(n − 1) 以内（clampOddShift），夹完就永远是排列（门里遍历过
 *     n = 1…11、步数 −40…40）。上面那道排列校验是第二层：哪天来源函数又被改坏，坏的那
 *     一步被拦下来，而不是改掉盘面。
 *
 * 纯函数，不碰 DOM：门（scripts/check-slide-line.mjs、check-endgame-residue.mjs）直接
 * 打包它来喂。
 */

/** 滑完之后第 i 格的东西从哪一格来。 */
export type SourceOf = (i: number, shift: number, n: number) => number;

/** 普通的循环：整条线首尾相接，转 shift 格。四副小球 / 菱形用这个。 */
export const rotateSource: SourceOf = (i, shift, n) => (((i - shift) % n) + n) % n;

/**
 * 大三角那一套（从 src/shapes/triangle.ts 的闭包里搬出来的，一字没改）。
 *
 * 那一副的每条线都是一正一倒交替，奇数步会把朝向弄反，所以只停在偶数步；绕回来那一段
 * （filler）按相邻两格配对交换，正好把那一步的朝向错位抵消掉。为什么这样就对，见
 * triangle.ts 里 `renderDragPreview` 上面那一大段。
 *
 * ⚠️ 它只在 |shift| ≤ n − 1 时给得出排列（n 是奇数时；偶数长的线怎么滑都行）——绕回来那
 * 一段比整条线还长，配对就配到线外面去了。所以调它之前先过 clampOddShift。
 *
 * src/engine/residueSearch.ts 穷举残局用的也是这一个（从前它抄了一份，因为原件在闭包
 * 里拿不到；check-endgame-residue.mjs 第 6 节钉着两份一字不差）。
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

/**
 * 奇数长的线，步数夹在 ±(n − 1) 以内。
 *
 * 大三角的线都是奇数长（7 / 9 / 11，格子离场之后什么长度都有），步数又只取偶数——n − 1
 * 正好是偶数，夹完还是偶数步，朝向照旧对。手指拖得再远，这条线最多也就是「整条换一
 * 遍」，再往外拖没有新的摆法，只会让 fillerAwareSource 配到线外面去。
 */
export function clampOddShift(shift: number, n: number): number {
  if (n % 2 === 0 || n < 1) return shift;
  const lim = n - 1;
  return Math.max(-lim, Math.min(lim, shift));
}

/** 0…n−1 各出现一次。 */
export function isPermutation(idx: readonly number[], n: number): boolean {
  if (idx.length !== n) return false;
  const seen: boolean[] = [];
  for (const j of idx) {
    if (!Number.isInteger(j) || j < 0 || j >= n || seen[j]) return false;
    seen[j] = true;
  }
  return true;
}

/**
 * 滑完之后每一格的来源；这一下不该算一步就回 null（活格不到两枚、转了整圈、算出来的
 * 不是排列）。
 */
export function slideSources(n: number, shift: number, source: SourceOf = rotateSource): number[] | null {
  if (n < 2) return null;
  if (!Number.isFinite(shift) || ((shift % n) + n) % n === 0) return null;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(source(i, shift, n));
  return isPermutation(idx, n) ? idx : null;
}

/**
 * 一条线滑 shift 格之后的样子；null 的意思是「这一下不算一步」，调用方原样不动、不记步。
 */
export function slideLine<T>(vals: readonly T[], shift: number, source: SourceOf = rotateSource): T[] | null {
  const idx = slideSources(vals.length, shift, source);
  return idx ? idx.map((j) => vals[j]) : null;
}
