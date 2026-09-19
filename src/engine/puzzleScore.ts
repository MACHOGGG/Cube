/**
 * 《真正解密 · 步步为营》这一局的两条规矩：步数怎么进怎么出，和最后那个综合
 * 得分怎么算。
 *
 * 纯算术，不碰 DOM 也不碰棋盘——所以 scripts/check-puzzle.mjs 能把它单独拎
 * 出来验（打包一下直接跑，不用开浏览器，进得了 CI）。
 *
 * **规矩钉在这儿，玩法本身还没接线。** 这一份（实施指令的 PR-1）只改这个文件
 * 和它那道门；gameController、八副棋盘、主菜单都还没有一个字。真接上那天
 * （PR-2）把这一段改成实话。
 *
 * 这个玩法和别的都不一样的地方：**没有钟**。别的局是「在多少时间里能打多少
 * 分」，这一局是「手里这几步能把这副盘面变成什么样」。所以底下两件事都得重
 * 写，不能沿用。
 */

/**
 * 开局手里有几步。
 *
 * 八步是玩家定的。为什么不是三、也不是十：三太紧，开局摸不清盘面就没了；十
 * 只让最菜的那一档（随机乱走）少死一点，对会玩的人没区别（模拟四档机器人跑
 * 出来的早死率 100/45–55/65–80% → 75/30/35%，谨慎那一档两个数一样）。八让
 * 开局那三步真的要想。
 */
export const PUZZLE_START_STEPS = 8;
/** 走一步扣几步。每一个动作都要付账，得分的那一步也不例外。 */
export const PUZZLE_STEP_COST = 1;
/**
 * 得分的那一步退几步回来。
 *
 * 注意是「那一步」退一次，不是「连锁几拍退几次」。一步引发的连锁有三拍也只
 * 退这一次——玩家说的是一次**行动**的回报，不是一拍的回报。
 *
 * 一退一扣，所以**孤立的一次得分只够回本**（净 0）。手里的步数长不出来，得
 * 靠下面那两条。这是这套经济的骨架。
 */
export const PUZZLE_STEP_REWARD = 1;
/**
 * 上一步也得分，再退一步。
 *
 * 这一条是玩家手里唯一的「利息」：净变化从 0 变成 +1。所以这个玩法**奖励的是
 * 「连着得分」，不是「得分多」**——一步没得分链子就断，下一次得分又只够回本。
 * 教学、文案、结算页都该指向这一句。
 *
 * 注意它退的是**步数**，不是分数：这一局没有连击倍率（玩家原话「没有连击机
 * 制」），`multiplier` 和连锁的每拍系数一律 1。
 */
export const PUZZLE_STREAK_BONUS = 1;
/**
 * 这一步消掉了一整条线（《外边消除》落地后就是「此刻的最外边」），再退一步。
 *
 * 判据是连锁里任意一拍有整线奖励（`step.lineBonusGroups.length > 0`），今天和
 * 将来是同一个字段，规则换了这儿不用改。
 */
export const PUZZLE_EDGE_BONUS = 1;

// 没有封顶常数。玩家明确否掉了《封顶》这条规则——**不要「为了安全」偷偷加一
// 个**。门里有一条哨兵：步步得分 100 步之后手里必须正好 107 步（= 8 + 99）。

/**
 * 每一枚棋子在结算时值多少分。
 *
 * 分数不再是「你一路滑出了多少分」，而是「你把这副盘面变成了什么样」——这是
 * 这一局和别的玩法最根本的差别。所以结算看的是**终局盘面**：
 *
 *   · 被消除掉的（整线奖励带走的那些）最值钱：10 分。它要求先把一整条线凑成
 *     同色星星，是这副盘上最难的一件事。
 *   · 还在盘上、已经翻成星星的：5 分。翻面是得过分的凭据，一枚星星就是一次成
 *     功的行动留下的痕迹。
 *   · 还是正面、一次没动过的：0 分。不倒扣——这一局本来就是步数用完才结束，盘
 *     上必然剩一堆没碰过的，罚它等于罚所有人（别的玩法那条 0.95^未翻面在这儿
 *     必须去掉，见下面 puzzleComposite）。
 *
 * 10 和 5 是玩家定的暂定值。
 */
export const PUZZLE_CLEARED_POINTS = 10;
export const PUZZLE_STAR_POINTS = 5;

/**
 * 这一局的结束理由。
 *
 * 和别处的结束理由一样，中文原文只当**查表的钥匙**，从不直接摆给玩家看
 * （runRecord.ts 的 REASON_LABEL_KEY 把它翻成四种语言）。写成常数而不是在
 * gameController 和 runRecord 各抄一遍字面量：抄出来的两份一旦差一个字，
 * 结算页上就会冒出这句中文原文——四种语言里有三种是错的。
 */
export const PUZZLE_STEPS_OUT_REASON = '步数用完了';

/** 结算时数出来的那副盘面。 */
export interface PuzzleBoardTally {
  /**
   * 被消除掉的枚数。
   *
   * **每副棋盘自己数**，不许用「开局枚数 − 现在还剩几枚」一刀切：三副盘上
   * 「被消除」长得不一样——方块是真的把格子拿走、两侧收拢；小球消完留一枚空白
   * 球在原位；三角留一个空洞。一刀切在小球和三角上会数成 0。
   */
  cleared: number;
  /** 结束时还在盘上、已经翻成星星（反面朝上）的枚数。 */
  stars: number;
  /** 有效得分率 0–100（engine/performance.ts 的那一个，八副棋盘共用）。 */
  ratePercent: number;
}

/**
 * 这一局的综合得分。
 *
 *   (被消除 × 10 + 星星 × 5) × (1 + 有效得分率/100)
 *
 * 别的玩法那个四项连乘（原始得分 × 时间系数 × (1+得分率) × 0.95^未翻面）在这
 * 儿有两项是坏的：**时间系数**——不限时间了，快慢不再是本事；**未翻面惩罚**
 * ——步数耗尽是常态，盘上剩三十枚没翻的会把系数压到两成，等于把所有人一起砸
 * 到底。留下来的只有有效得分率。
 *
 * ⚠️ 别把 HUD 上那个《有效得分率》和「多少步里得了分」混为一谈：前者是**按行
 * 动加权**的（普通图案 1、长图案 2、整线 3，见 engine/performance.ts），后者是
 * 按步数数的。两个数不相等。
 *
 * 步数那本账的支点也**不是「一半」**（那是起手 3、得分退 2 那一版的说法）：孤
 * 立得分只够回本，所以把每一步得分看成独立事件、概率 p，从不消边时不进不退的
 * 条件是 p + p² = 1，也就是 **p ≈ 0.618**（黄金分割）。得分能扎堆成串时
 * p ≈ 0.5 就够，得分里有两成是消边时 p ≈ 0.58 站得住。
 */
export function puzzleComposite(tally: PuzzleBoardTally): number {
  const base = tally.cleared * PUZZLE_CLEARED_POINTS + tally.stars * PUZZLE_STAR_POINTS;
  const rate = Math.max(0, tally.ratePercent) / 100;
  return Math.max(0, Math.round(base * (1 + rate)));
}

/** 走这一步的时候，账本还需要知道的事。 */
export interface SpendContext {
  /** 这一步的连锁里有整线（外边）奖励。 */
  edge?: boolean;
}

/**
 * 手里那几步。
 *
 * 「上一步有没有得分」由账本**自己记**，不让调用方传进来。这不是洁癖：那是整
 * 套接线里最容易接错的一处（`resolveMove` 里到处都是这一拍那一拍的局部变量，
 * 传错一个就成了「按拍算连续」），而记在这儿，CI 那道门连着调三次
 * `spend(true)` 就能整段验出来。
 */
export interface StepBank {
  /** 还剩几步。 */
  left(): number;
  /** 一共走了几步。 */
  spent(): number;
  /** 其中得分的有几步。 */
  scoredMoves(): number;
  /** 因为「上一步也得分」多退回来的步数合计。 */
  streakRefunds(): number;
  /** 因为「这一步消了边」多退回来的步数合计。 */
  edgeRefunds(): number;
  /** 手里最多攒到过几步（结算页那句「最多攒到 X」）。 */
  peak(): number;
  /**
   * 走一步。返回走完之后还剩几步——0 就是这一局到头了。
   *
   * 顺序是**先扣后退**，所以手里剩 1 步时得分不会出现负数的中间态：
   * 1 − 1 + 1 = 1，读起来就是「用掉一步，又赚回一步」。`left` 用
   * Math.max(0, …) 夹住，读数永远不是负的。
   */
  spend(scored: boolean, ctx?: SpendContext): number;
  reset(): void;
}

export function createStepBank(start = PUZZLE_START_STEPS): StepBank {
  let left = start;
  let spent = 0;
  let scored = 0;
  let streak = 0;
  let edges = 0;
  let peak = start;
  /** 上一步有没有得分。一步没得分，链子就断。 */
  let prevScored = false;
  return {
    left: () => left,
    spent: () => spent,
    scoredMoves: () => scored,
    streakRefunds: () => streak,
    edgeRefunds: () => edges,
    peak: () => peak,
    spend(didScore, ctx) {
      spent++;
      left = Math.max(0, left - PUZZLE_STEP_COST);
      if (didScore) {
        scored++;
        left += PUZZLE_STEP_REWARD;
        if (prevScored) {
          left += PUZZLE_STREAK_BONUS;
          streak += PUZZLE_STREAK_BONUS;
        }
        if (ctx?.edge) {
          left += PUZZLE_EDGE_BONUS;
          edges += PUZZLE_EDGE_BONUS;
        }
      }
      prevScored = didScore;
      if (left > peak) peak = left;
      return left;
    },
    reset() {
      left = start;
      spent = 0;
      scored = 0;
      streak = 0;
      edges = 0;
      peak = start;
      prevScored = false;
    },
  };
}
