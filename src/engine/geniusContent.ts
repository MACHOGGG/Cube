import { isGenius } from './subscription';

/**
 * 「Slides 天才」到底买到什么——只有这一张表，所以付费墙、主菜单和天才特供那一屏
 * 永远不会各说一套。
 *
 * 表里的东西都已经做好了、都能玩。这是刻意的：买下去当天就解锁的订阅，和一个「以
 * 后会有」的承诺是两回事。
 *
 * **2026-09（《侵蚀阶梯》v1.2 PR-6）换了一位。** V 形（`triangleAdvanced`）那副棋盘
 * 删了，六边蜂窝 54（card id `triangleBig`，代码在 `shapes/triangle.ts`——两副三角
 * 2026-09 对调过身份，认 id 不认文件名）接上它的位置。
 *
 * **10-09 补充方案第一部分第 10 条（3-C-5）又加了两位：菱形方块、六边形小球。**原先这两副
 * 是刻意留在外面的（「两族各有一副自己的『+』布局，没有哪一族整族变成一扇锁着的门」）；
 * 玩家改了主意——「和其他『更多布局』一样需要天才」。于是更多布局四副全在这张表里，免费
 * 的是两副经典棋盘，以及计时、炸弹、多人那几档。
 *
 * ⚠️ 进阶炸弹开在菱形方块和六边形小球上，**照旧免费**：这张表锁的是「这副棋盘的基础玩
 * 法」，炸弹挑战整页是免费的（bombMode.ts 那一页不问锁）。输代号开一局走的 main.ts 的
 * seedLocked 也照这个口径——只在基础玩法那一档问这张表。
 */
export const GENIUS_LAYOUTS: readonly string[] = ['squareDiamond', 'circleHex', 'circleSeven', 'triangleBig'];

/** True when this board is behind the subscription and the player is not. */
export function isLayoutLocked(cardId: string): boolean {
  return GENIUS_LAYOUTS.includes(cardId) && !isGenius();
}
