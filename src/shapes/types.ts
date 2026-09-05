export interface ShapeCardMeta {
  id: string;
  name: string;
  desc: string;
  bestKey: string;
  /** Inline SVG markup for the menu card glyph. */
  glyph: string;
}

import type { Lang } from '../i18n';
import type { TargetPattern } from '../engine/targets';

export interface ShapeGameOpts {
  /** Timed-challenge mode: run ends automatically after this many seconds. */
  timeLimitSec?: number;
  /** Bomb-challenge mode: red hazard tiles, instant game-over on a 4+ cluster. */
  bomb?: boolean;
  /** Localizes the shell chrome and dynamic end-of-run text; falls back to 'zhHans' if omitted. */
  lang?: Lang;
  /**
   * 随机得分目标：这一局老虎机转出来的那两个图案。
   *
   * 给了就换掉这个玩法自己那套得分图案——别的都不动（还是同一副棋盘、同样
   * 的滑法、同样的整行奖励），只有「拼成什么算分」变了，分数按
   * targets.ts 的 scoreOf 算。玩家的原话：「玩法就是三个基础图形的玩法只是
   * 得分的图形不同而已」。
   */
  targets?: readonly TargetPattern[];
  /**
   * 练习盘：小屋里等人看教学的那一屏底下摆的那块棋盘。真的棋盘、真的规
   * 则，只是不结算——打完了（翻完、死局）就静静再来一盘，不存档、不上榜、
   * 不报统计；读数和按键也都不画。
   */
  practice?: boolean;
  /**
   * 无限反转（只有基础方块和小球有）：图案得分翻面之后，一组里正面的翻成反
   * 面、反面的翻回正面，正反无限反转；反面同色连成一行 / 列不消除；没有
   * 「翻完了」这回事——一局只由计时结束（main.ts 给 120 秒）。
   */
  flip?: boolean;
  /**
   * 头一局那块教学条（见 ui/coachBar.ts）：棋盘底下一块小圆角矩形，把六条
   * 规则一条一条摆出来，玩家做到了哪一条就换下一条。
   *
   * 只有玩家头一回打开、被直接按进的那一局基础小球才给（main.ts 的
   * isFirstRun）——他这时候刚看完「怎么滑」的分镜，别的还一概不知道。
   */
  coach?: boolean;
  /** 教学条那六幅配图。不给就是网页版那一份；小红书版传摘掉三角的那一份。 */
  coachArt?: readonly string[];
}

export interface ShapeGame {
  card: ShapeCardMeta;
  /** Builds the game inside container and wires onBack; returns a destroy() to call when navigating away. */
  mount(container: HTMLElement, onBack: () => void, opts?: ShapeGameOpts): () => void;
}
