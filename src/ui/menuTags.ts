/**
 * 主菜单每张卡底下那行小字——**也是这副棋盘在全站的名字**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一套是玩家自己点名的说法：
 *
 *   「经典方块、经典小球、经典三角、多人、计时、炸弹、菱形方块、六边形小
 *     球、六边形三角、老虎机、无限反转、菱形小球、V字三角」
 *
 * 原先它只是菜单上的记号，棋盘另有一套「正式名字」（i18n.ts 里的 shapeName*：
 * 大三角 / 七色圆球 / 进阶三角 / 方块 / 圆球……），开局页、结算页、分享卡、排
 * 行榜、主菜单卡的读屏名用那一套。两套并存的理由是「改正式名字会牵动存档里的
 * 历史记录」——其实不会：存档和榜单里存的是 id，名字每次现查。并存的代价倒是真
 * 的：同一副棋盘眼睛看到「六边形三角」，读屏念「大三角」，规则书写「Big
 * triangle」。
 *
 * 10-09 补充方案第一部分第 5 条（玩家：「全部一起统一，以 menuTags.ts 现有名字为
 * 准」）之后，那八条 shapeName* 删了，ui/shapeLabels.ts 的 shapeName() 直接取这
 * 张表——一副棋盘只剩这一个名字。门：check-rules-counts 第 ⑤ 节。
 *
 * 键就用玩法自己的 id，另外几个板块（多人、计时、炸弹、老虎机、无限反转、步步
 * 为营）各给一个自己的键。triangle / triangleAdvanced 两副已经删了，键留着：旧战
 * 绩、旧分享卡里还带着这两个 id。
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { Lang } from '../i18n';

export type MenuTagKey =
  | 'square'
  | 'circle'
  | 'triangle'
  | 'multiplayer'
  | 'timed'
  | 'bomb'
  | 'squareDiamond'
  | 'circleHex'
  | 'triangleBig'
  | 'slot'
  | 'flip'
  | 'puzzle'
  | 'circleSeven'
  | 'triangleAdvanced';

const TAGS: Record<Lang, Record<MenuTagKey, string>> = {
  en: {
    square: 'Classic Squares',
    circle: 'Classic Balls',
    triangle: 'Classic Triangles',
    multiplayer: 'Multiplayer',
    timed: 'Timed',
    bomb: 'Bombs',
    squareDiamond: 'Diamond Squares',
    circleHex: 'Hex Balls',
    triangleBig: 'Hex Triangles',
    slot: 'Slot Machine',
    flip: 'Endless Flip',
    puzzle: 'Step by step',
    circleSeven: 'Diamond Balls',
    triangleAdvanced: 'V Triangle',
  },
  fr: {
    square: 'Carrés classiques',
    circle: 'Billes classiques',
    triangle: 'Triangles classiques',
    multiplayer: 'Multijoueur',
    timed: 'Chrono',
    bomb: 'Bombes',
    squareDiamond: 'Carrés losange',
    circleHex: 'Billes hexagone',
    triangleBig: 'Triangles hexagone',
    slot: 'Machine à sous',
    flip: 'Retournement infini',
    puzzle: 'Pas à pas',
    circleSeven: 'Billes losange',
    triangleAdvanced: 'Triangle en V',
  },
  zhHant: {
    square: '經典方塊',
    circle: '經典小球',
    triangle: '經典三角',
    multiplayer: '多人',
    timed: '計時',
    bomb: '炸彈',
    squareDiamond: '菱形方塊',
    circleHex: '六邊形小球',
    triangleBig: '六邊形三角',
    slot: '老虎機',
    flip: '無限反轉',
    puzzle: '步步為營',
    circleSeven: '菱形小球',
    triangleAdvanced: 'V字三角',
  },
  zhHans: {
    square: '经典方块',
    circle: '经典小球',
    triangle: '经典三角',
    multiplayer: '多人',
    timed: '计时',
    bomb: '炸弹',
    squareDiamond: '菱形方块',
    circleHex: '六边形小球',
    triangleBig: '六边形三角',
    slot: '老虎机',
    flip: '无限反转',
    puzzle: '步步为营',
    circleSeven: '菱形小球',
    triangleAdvanced: 'V字三角',
  },
};

/** 这张卡的小字。认不出的键就不给字——宁可少一行，也不摆个英文键上去。 */
export function menuTag(lang: Lang, key: string): string {
  return TAGS[lang][key as MenuTagKey] ?? '';
}
