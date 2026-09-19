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
import type { CoachPlan } from '../ui/coachBar';

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
   * 「翻完了」这回事——一局只由计时结束（main.ts 的 FLIP_SECONDS，60 秒）。
   */
  flip?: boolean;
  /**
   * 《真正解密 · 步步为营》（见 engine/puzzleScore.ts）：开局手里 8 步，走一步
   * 扣 1，得分退回 1；上一步也得分再退 1，这一步消掉整线再退 1，不封顶。
   *
   * **没有钟**——步数就是命。步数用完、或者能消的都消完，这一局就结算，而结算
   * 看的是**终局盘面**（被消除 × 10 + 星星 × 5，再乘有效得分率），不是一路攒下
   * 来的分。所以扣 1 退 1 这一条是它的骨架：孤立的一次得分只够回本，手里的步数
   * 只能靠「连得上」和「消边」长出来。
   *
   * 只有三个基础玩法有。
   */
  steps?: boolean;
  /**
   * 头一局那块教学条（见 ui/coachBar.ts）：棋盘底下一块小圆角矩形，把六条
   * 规则一条一条摆出来，玩家做到了哪一条就换下一条。
   *
   * 只有玩家头一回打开、被直接按进的那一局基础小球才给（main.ts 的
   * isFirstRun）——他这时候刚看完「怎么滑」的分镜，别的还一概不知道。
   */
  coach?: boolean;
  /** 教学条那六幅配图。不给就按这一局的图形现算；小红书版传摘掉三角的那一份。 */
  coachArt?: readonly string[];
  /**
   * 教学条按哪一种排法走（见 ui/coachBar.ts）：
   *   'first'  头一局小球——从第 1 条起，跟着玩家一条一条走。
   *   'second' 头一回玩方块——先不出声，10 秒没得分才摆出第 2 条，得分后自
   *            己往下播完。
   * 不给就是 'first'。
   *
   * 类型直接引 coachBar 那份，不在这儿再手抄一遍 `'first' | 'second'`：抄出
   * 来的那一份和注释一起过期过——注释上一版写的是 `'square'`，而真正传进去
   * 的一直是 `'second'`（src/main.ts、xhs/src/main.ts 两个调用点），于是照
   * 注释去全仓搜 `'square'` 的人什么都搜不到。取值只有一处定义，就没有第二
   * 份会走样。
   */
  coachPlan?: CoachPlan;
  /**
   * 炸弹 / 无限反转 / 老虎机头一回进来时的那一句提示：同一块条子，一句话加
   * 一幅图，15 秒后自己走掉。给了它就不摆六条规则。
   */
  coachTip?: { text: string; art: string };

  /**
   * 不数 4-3-2-1，直接开局。只给小红书那一版的头一局小球用，见
   * ui/gameShell.ts 的 ShellMeta.noCountdown。
   */
  noCountdown?: boolean;

  /**
   * 结算页那对指路的光要不要亮（见 engine/gameController.ts 的
   * shouldLeadOut）。结算页真的露面了才会被叫到——各版自己拿自己那份记录
   * 答，网页版和小红书版的记录是分开存的。
   */
  shouldLeadOut?: () => boolean;
  /**
   * 头一回看见结算页时，明细底下补一句「综合得分怎么算」（见 engine/firstPlay.ts
   * 的 claimFirstTotalTip）。六条规矩的最后一条从棋盘底下挪到了那儿。
   */
  shouldTeachTotal?: () => boolean;
}

export interface ShapeGame {
  card: ShapeCardMeta;
  /** Builds the game inside container and wires onBack; returns a destroy() to call when navigating away. */
  mount(container: HTMLElement, onBack: () => void, opts?: ShapeGameOpts): () => void;
}
