/**
 * 主菜单每张卡底下那行小字。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么另立一张表，不用玩法自己的名字
 *
 * 玩法本来就有名字（i18n.ts 里的 shapeName* 那一组，「大三角」「七色圆球」
 * 之类），那套名字要出现在开局页、战绩图、排行榜上，是正式称呼。菜单上这
 * 行小字不是称呼，是记号：玩家一眼扫过十三张图，要能认出哪张是哪张，所以
 * 越短越好，而且是玩家自己点名的那一套说法——
 *
 *   「经典方块、经典小球、经典三角、多人、计时、炸弹、菱形方块、六边形小
 *     球、六边形三角、老虎机、无限反转、菱形小球、V字三角」
 *
 * 有三个和正式名字不一样（六边形三角 / 菱形小球 / V字三角，正式名字是大三
 * 角 / 七色圆球 / 进阶三角）。两套并存是有意的：改正式名字会牵动战绩图、
 * 排行榜和存档里的历史记录，而这里要的只是菜单上认得出来。
 *
 * 键就用玩法自己的 id，另外四个板块（多人、计时、炸弹、老虎机、无限反转）
 * 各给一个自己的键。
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
    circleSeven: '菱形小球',
    triangleAdvanced: 'V字三角',
  },
};

/** 这张卡的小字。认不出的键就不给字——宁可少一行，也不摆个英文键上去。 */
export function menuTag(lang: Lang, key: string): string {
  return TAGS[lang][key as MenuTagKey] ?? '';
}
