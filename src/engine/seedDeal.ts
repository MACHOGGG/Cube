/**
 * 种子码和发牌之间的那一步：老虎机的目标从种子里抽（第 19 推）。
 *
 * 老虎机那一局有两样是随机的——这一局认哪一个得分图案，和那一副牌。方案原话是「老虎机目
 * 标先从种子里抽，再发牌」：种下 `'s1:' + 码` 那条流，**头一下**抽目标，后面接着从同一条流
 * 里发牌。于是一串码说得清整局，输进去的人拿到的是同一个目标、同一副牌。
 *
 * 不放进 seedCode.ts：那一份要和服务器那一份（api/_seedcode.js）一行对一行，而服务器用不
 * 着「抽目标」——它不发牌，只核对每日挑战那一串码。
 */
import { drawOne, type Family, type TargetPattern } from './targets';
import { random as seededRandom, seedRandom } from './rng';
import {
  VARIANTS,
  dealSeed,
  decodeSeed,
  randomSeed,
  roomSeed,
  variantForGame,
  type SeedRun,
  type SeedSource,
  type SeedVariant,
} from './seedCode';
import { MODE_SECONDS } from './modeClock';
import type { ShapeGameOpts } from '../shapes/types';

/**
 * 这串码的老虎机目标：种上，头一下抽目标。
 *
 * **会把全局那条流种成这一串**（rng.ts 只有一条流）——之后紧接着发牌的话，发出来的就是这串
 * 码的那一副。控制器开局时还会再种一遍、再抽一遍（gameController 的 plantSeed），同一串码同
 * 一个起点，所以先在这儿抽一次不碍事。
 */
export function slotTargetOf(code: string, family: Family): TargetPattern | null {
  seedRandom(dealSeed(code));
  return drawOne(family, seededRandom);
}

/**
 * 一串新的随手码，头一下抽出来的正好是这个目标。
 *
 * 给老虎机的「再来一局」用：从前（第 19 推之前）再来一局就是同一个图案、换一副牌，这一条
 * 不改；可第 19 推起每一局都用种子发牌，而目标是从种子里抽的——随手换一串码，那串码抽出来
 * 的多半是另一个图案，分享卡上印的那串码就还原不了这一局。所以挑一串「头一下就是这个目标」
 * 的：一族才七八个图案，平均试七八次就中；两千次都不中（不会发生）就 null，由调用的那一头
 * 退回不印码。
 */
export function seedForTarget(variant: number, target: TargetPattern): string | null {
  for (let i = 0; i < 2000; i++) {
    const code = randomSeed(variant);
    if (slotTargetOf(code, target.family)?.id === target.id) return code;
  }
  return null;
}

/**
 * 小屋那一局的种子码（第 19 推）：房间给的那串字符串（match.seed）换算成一串种子码，同一间
 * 屋同一局人人算出同一串。
 *
 * **两处要算出同一串**：倒数那一屏（ui/multiplayer.ts，「大家一样」那一档要在那儿把老虎机
 * 转出来）和开棋盘那一句（main.ts 的 startMultiplayerRun）。两处各写一遍换算，哪天改了一
 * 边，屏幕上转出来的目标和手里要凑的就是两个——所以只写在这儿。
 *
 * 编号表里没有这一局（不该发生）就拿第 0 行当个载体：牌照样人人相同，只是 variant 是 -1，
 * 调用的那一头据此不印码。
 */
export function roomCodeFor(
  matchSeed: string,
  board: string,
  flip: boolean,
  slot: boolean,
): { code: string; variant: number } {
  const variant = variantForGame(flip ? 'flip' : 'base', board, slot);
  return { code: roomSeed(matchSeed, Math.max(0, variant)), variant };
}

/**
 * 一串码开出来的那一局（第 19 推）：哪副棋盘、带哪几个开关。
 *
 * 输进来的码和每日挑战都走这儿——码自己知道是哪个玩法、哪副棋盘（seedCode.ts 的 VARIANTS），
 * 所以不用再问玩家「哪个玩法」。开关和主菜单上那几条路开出来的一模一样（main.ts 的 showMenu /
 * showTimedMode / showFlipMode / showPuzzleMode / 炸弹那一页），于是同一串码从这儿开和从菜单
 * 开（再由控制器随手抽到同一串）发出来的是同一局——variantForGame 倒推回来是同一行，门
 * check-seed-code 逐行量这件事。
 *
 * 不含 lang 和教学那几个字段：那些归调用的那一头（网页版、小红书版各有各的教学规矩）。
 */
export interface SeedGame {
  /** 棋盘的 id（card.id）。 */
  board: string;
  /** 编号表里的那一行（玩法 + 棋盘）。 */
  variant: SeedVariant;
  opts: ShapeGameOpts;
}

export function seedGameOf(code: string, source: SeedSource, daily?: string): SeedGame | null {
  const dec = decodeSeed(code);
  if (!dec.ok) return null;
  const variant = VARIANTS[dec.variant];
  const seed: SeedRun = { code: dec.code, source, daily };
  const board = variant.board;
  switch (variant.mode) {
    case 'base':
      return { board, variant, opts: { seed } };
    case 'timed':
      return { board, variant, opts: { seed, timeLimitSec: MODE_SECONDS } };
    case 'bomb':
    case 'bombAdv':
      return { board, variant, opts: { seed, bomb: true } };
    case 'bombTimed':
      return { board, variant, opts: { seed, bomb: true, timeLimitSec: MODE_SECONDS } };
    case 'slot': {
      // 目标从这串码里抽（和老虎机那一页、和控制器开局时抽的是同一下）。
      const family: Family = board === 'circle' ? 'circle' : 'square';
      const target = slotTargetOf(dec.code, family);
      if (!target) return null;
      return { board, variant, opts: { seed, target } };
    }
    case 'flip':
      return { board, variant, opts: { seed, flip: true, timeLimitSec: MODE_SECONDS } };
    case 'puzzle':
      return { board, variant, opts: { seed, steps: true } };
  }
  return null;
}
