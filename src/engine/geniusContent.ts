import { entitlement, signedInEmail } from './subscription';

/**
 * 更多布局是哪几副——只有这一张表，所以主菜单、个人主页、输代号永远不会各说一套。原先它是「Slides 天才」买到什么
 * 那张表（下面几段是那时的来历）；天才层 2026-10 取消之后，它是「登录才能玩的那几副」（见文件末）。
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
 * 法」。10-31 方案推12 起进阶炸弹另有一把锁（advancedBombLock，同样是没登录才锁）。
 */
export const GENIUS_LAYOUTS: readonly string[] = ['squareDiamond', 'circleHex', 'circleSeven', 'triangleBig'];

/**
 * 「天才」层 2026-10 取消了（10-31 方案推12 Z-J02 E，10-14 F-1）：表里这四副更多布局、进阶炸弹那一排，**登录就能玩**。
 * 锁只剩一种——没登录（`'signIn'`，点了开登录窗）。判定只写在这儿，主菜单的布局卡、炸弹页最下面那一排、输代号
 * （main.ts 的 seedLocked）、个人主页那块面板都问这两个函数；**每日挑战那一局永远不问**（F-1 e）。
 *
 * 「已登录」按本机那份登录缓存算（D49 Q25）：令牌失效、本机仍显示登着的人照「已登录」放行——要服务器的那几个动作
 * 自己会说「登录已过期」（10-11 方案 A-12）。表的名字、文件名不改：别处的门按 GENIUS_LAYOUTS 这个名字读它。
 */
export type ContentLock = null | 'signIn';

/**
 * 本机看来登着没有：有邮箱（邮箱账号；免邮箱账号那一位放的是 `hdl:` 那把 id），或者兑过一张内部码（`code`）。
 *
 * 不只问 signedInEmail()：兑了码、没绑邮箱的人（`acct:code:<码>` 那一种）原先是天才、更多布局都开着，天才层取消之后要是
 * 只认邮箱，他们会一觉醒来四副布局全挂上锁——可他们明明登着（cloudScores 的 auth() 也认 code）。不要求令牌：令牌失效的
 * 人照样算（Q25）。主菜单、炸弹页、输代号、个人主页、深色界面、记录页、开小屋，凡是「要登录」的都问它。
 */
export function isSignedIn(): boolean {
  return !!signedInEmail() || !!entitlement().code;
}
const signedIn = isSignedIn;

/** 这副棋盘（基础玩法那一档）锁着没有：四副更多布局，没登录锁着；别的棋盘永远不锁。 */
export function layoutLock(cardId: string): ContentLock {
  return GENIUS_LAYOUTS.includes(cardId) && !signedIn() ? 'signIn' : null;
}

/** 进阶炸弹（开在菱形方块、六边形小球上那一排）锁着没有：没登录锁着（F-1 f）。 */
export function advancedBombLock(): ContentLock {
  return signedIn() ? null : 'signIn';
}
