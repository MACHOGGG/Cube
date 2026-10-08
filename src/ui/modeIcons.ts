/**
 * 「这一局是什么」→ 摆哪一张图（10-08 方案 3-F-4：图标唯一映射）。
 *
 * 方案原话：「图标唯一映射 iconFor(modeId)：第二层选择与 startStage 倒数页都从它取图标，删倒
 * 数页写死的旧图标（方块计时炸弹那组错位从根上消掉）。映射不碰主菜单缩图。」
 *
 * modeId 就是种子码编号表里的一行（engine/seedCode.ts 的 SeedVariant：玩法 ＋ 棋盘）——分享卡、
 * 种子码、今日榜认的都是这一对，「这一局是什么」用不着再发明第三种说法。
 *
 * 从前倒数页的图是它自己拼的：gameIcon(棋盘, 是否计时) 再加一颗炸弹徽记（modeBadges）。
 *
 *   · 计时局摆 timedOption 那支秒表——那是计时还是居中挑选窗时候的图。挑选窗 2026-09 改成整页
 *     （ui/timedMode.ts）之后那一页摆的是灰底的基础方块 / 基础小球，倒数页还在摆秒表。
 *   · 炸弹那一页一格是「这副棋盘 ＋ 那一排颜色的底板」（基础浅灰、计时橙、进阶深灰），倒数页摆
 *     的却是灰底的棋盘 ＋ 一颗炸弹徽记；计时炸弹则是秒表 ＋ 徽记——方块计时炸弹那一局，按下去
 *     的是一块橙底的方块，倒数那几秒看见的是一支绿脸的秒表和一颗砖红的徽记。
 *
 * 现在两头都问这一个函数：第二层上那一格画的是 iconFor(这一行)，倒数页摆的也是
 * iconFor(这一行)，按下去的是哪一张，倒数时就是哪一张。
 *
 * **不管主菜单。** 主菜单上那几张卡（基础底图、布局图、沙漏、炸弹图标、电脑端那块炸弹面板、老虎
 * 机……）照旧从 homeIcons.ts 各自取（方案 3-D-5：炸弹缩图不动）。主菜单是「挑哪一种玩法」，第
 * 二层和倒数页是「这一局」，两件事。
 *
 * 门：check-mode-icons（逐玩法从第二层按下去，量倒数页那张图和按下去那一格是同一张）。
 */
import type { BombTier } from '../engine/bomb';
import type { SeedMode } from '../engine/seedCode';
import { bombBoard, gameIcon } from './homeIcons';
import { CTL_TIER_ADVANCED, CTL_TIER_BASIC, CTL_TIER_TIMED } from './ctlIcons';

/** 一局是什么：玩法 ＋ 棋盘（和 SeedVariant 同形，棋盘是 shapes/*.ts 的 card.id）。 */
export interface ModeId {
  mode: SeedMode;
  board: string;
}

/** 炸弹那三种玩法（不带棋盘问 iconFor 的，只有它们）。 */
export type BombMode = 'bomb' | 'bombTimed' | 'bombAdv';

/** 炸弹那一页的三档各是编号表里的哪一种玩法。 */
export const BOMB_MODE: Record<BombTier, BombMode> = {
  basic: 'bomb',
  timed: 'bombTimed',
  advanced: 'bombAdv',
};

/** 反过来：三种炸弹玩法各是哪一档——一档一个底板颜色。 */
const BOMB_TIER: Partial<Record<SeedMode, BombTier>> = {
  bomb: 'basic',
  bombTimed: 'timed',
  bombAdv: 'advanced',
};

/** 三档各自那一枚小图标（ctlIcons 那一套圆盘，10-08 方案 3-G）。 */
const TIER_ICON: Record<BombTier, string> = {
  basic: CTL_TIER_BASIC,
  timed: CTL_TIER_TIMED,
  advanced: CTL_TIER_ADVANCED,
};

/**
 * 这一局的那张图。
 *
 * 棋盘自己那张脸（gameIcon：基础玩法的底图、布局玩法的布局图）；炸弹三档再把底板换成那一档的
 * 颜色（bombBoard，颜色挂在底板自己身上，外面是不是炸弹那一页的一排都一样）。计时、无限反转、
 * 步步为营、老虎机这几种局，它们的第二层摆的就是棋盘自己那张脸，所以这儿也是。
 *
 * 不带棋盘、只说「哪一种炸弹」：那一档自己的那枚小图标——炸弹那一页左边那一列（10-08 方案 3-G：
 * 「『基础/计时/进阶』删文字、各配小图标……图标源即 3-F-4 的 iconFor」）。
 */
export function iconFor(id: ModeId): string;
export function iconFor(id: { mode: BombMode }): string;
export function iconFor(id: { mode: SeedMode; board?: string }): string {
  const tier = BOMB_TIER[id.mode];
  if (id.board === undefined) return tier ? TIER_ICON[tier] : '';
  const glyph = gameIcon(id.board);
  return tier ? bombBoard(glyph, tier) : glyph;
}
