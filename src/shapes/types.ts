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
}

export interface ShapeGame {
  card: ShapeCardMeta;
  /** Builds the game inside container and wires onBack; returns a destroy() to call when navigating away. */
  mount(container: HTMLElement, onBack: () => void, opts?: ShapeGameOpts): () => void;
}
