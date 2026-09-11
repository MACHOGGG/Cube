/**
 * 《解密》这一局的两条规矩：步数怎么进怎么出，和最后那个综合得分怎么算。
 *
 * 纯算术，不碰 DOM 也不碰棋盘——所以 scripts/check-puzzle.mjs 能把它单独拎
 * 出来验（打包一下直接跑，不用开浏览器，进得了 CI）。八副棋盘和
 * gameController 都只管调它。
 *
 * 这个玩法和别的都不一样的地方：**没有钟**。别的局是「在多少时间里能打多
 * 少分」，这一局是「手里这几步能把这副盘面变成什么样」。所以底下两件事都得
 * 重写，不能沿用。
 */

/**
 * 开局手里有几步。
 *
 * 三步是玩家定的起手数，也是这套经济里唯一的「本钱」：它小到第一步就得想清
 * 楚（走错三次就没了），又刚好够试探一下盘面。这个数很可能还要调，所以它在
 * 这儿是一个有名字的常数，不是散在代码里的 3。
 */
export const PUZZLE_START_STEPS = 3;
/** 走一步扣几步。每一个动作都要付账，得分的那一步也不例外。 */
export const PUZZLE_STEP_COST = 1;
/**
 * 得分的那一步退几步回来。
 *
 * 注意是「那一步」退一次，不是「连锁几拍退几次」。一步引发的连锁有三拍也
 * 只退这一次——玩家的原话是「得到分获得 2 步」，说的是一次行动的回报，不是
 * 一拍的回报。这条是这套经济里最值得试玩之后再定的一条：改成按拍数退，长连
 * 锁立刻变成续命的主力，这一局的味道会完全不同。
 */
export const PUZZLE_STEP_REWARD = 2;

/**
 * 每一枚棋子在结算时值多少分。
 *
 * 分数不再是「你一路滑出了多少分」，而是「你把这副盘面变成了什么样」——这
 * 是《解密》和别的玩法最根本的差别。所以结算看的是**终局盘面**：
 *
 *   · 被消除掉的（整行/整列奖励带走的那些）最值钱：10 分。它要求先把一整条
 *     线凑成同色点面，是这副盘上最难的一件事。
 *   · 还在盘上、已经翻成星星的：5 分。翻面是得过分的凭据，一枚星星就是一次
 *     成功的行动留下的痕迹。
 *   · 还是正面、一次没动过的：0 分。不倒扣——这一局本来就是步数用完才结束，
 *     盘上必然剩一堆没碰过的，罚它等于罚所有人（别的玩法那条 0.95^未翻面
 *     在这儿必须去掉，见 gameController 的综合得分）。
 *
 * 10 和 5 是玩家定的暂定值。
 */
export const PUZZLE_CLEARED_POINTS = 10;
export const PUZZLE_STAR_POINTS = 5;

/** 结算时数出来的那副盘面。 */
export interface PuzzleBoardTally {
  /** 被消除掉的枚数 = 开局枚数 − 结束时盘上还有的枚数。 */
  cleared: number;
  /** 结束时还在盘上、正面朝下（星星）的枚数。 */
  stars: number;
  /** 有效得分率 0–100（engine/performance.ts 的那一个，八副棋盘共用）。 */
  ratePercent: number;
}

/**
 * 《解密》的综合得分。
 *
 *   (被消除 × 10 + 星星 × 5) × (1 + 有效得分率/100)
 *
 * 别的玩法那个四项连乘（原始得分 × 时间系数 × (1+得分率) × 0.95^未翻面）在
 * 这儿有两项是坏的：**时间系数**——不限时间了，快慢不再是本事；**未翻面
 * 惩罚**——步数耗尽是常态，盘上剩三十枚没翻的会把系数压到两成，等于把所有
 * 人一起砸到底。留下来的只有有效得分率，而它在这一局里反而比别处更要紧：按
 * 走一步扣 1、得分退 2 算，得分率不到一半必死，它就是这个玩法的命门。
 */
export function puzzleComposite(tally: PuzzleBoardTally): number {
  const base = tally.cleared * PUZZLE_CLEARED_POINTS + tally.stars * PUZZLE_STAR_POINTS;
  const rate = Math.max(0, tally.ratePercent) / 100;
  return Math.max(0, Math.round(base * (1 + rate)));
}

/** 手里那几步。 */
export interface StepBank {
  /** 还剩几步。 */
  left(): number;
  /** 一共走了几步。 */
  spent(): number;
  /**
   * 走了一步，这一步得没得分。返回走完之后还剩几步——0 就是这一局到头了。
   *
   * 顺序是「先扣后退」，所以最后一步就算得了分也不会出现负数中间态：手里
   * 剩 1 步、走一步得分，是 1 − 1 + 2 = 2，读起来就是「用掉一步，赚回两步」。
   */
  spend(scored: boolean): number;
  reset(): void;
}

export function createStepBank(start = PUZZLE_START_STEPS): StepBank {
  let left = start;
  let spent = 0;
  return {
    left: () => left,
    spent: () => spent,
    spend(scored) {
      spent++;
      left = Math.max(0, left - PUZZLE_STEP_COST);
      if (scored) left += PUZZLE_STEP_REWARD;
      return left;
    },
    reset() {
      left = start;
      spent = 0;
    },
  };
}
