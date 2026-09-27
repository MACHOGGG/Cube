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
 * 免费留下什么也是刻意的：方块留菱形方块、小球留六边圆球，两族各有一副自己的
 * 「+」布局，所以没有哪一族整族变成一扇锁着的门。三角那一族现在整族是天才特供
 * ——它本来也只剩一副棋盘，而且是最深的那一副。
 */
export const GENIUS_LAYOUTS: readonly string[] = ['circleSeven', 'triangleBig'];

/** True when this board is behind the subscription and the player is not. */
export function isLayoutLocked(cardId: string): boolean {
  return GENIUS_LAYOUTS.includes(cardId) && !isGenius();
}
