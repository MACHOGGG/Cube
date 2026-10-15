/**
 * 《真正解密 · 步步为营》这一局的两条规矩：步数怎么扣（第 3 版只扣不退），和最后那个
 * 综合得分怎么算。
 *
 * 纯算术，不碰 DOM 也不碰棋盘——所以 scripts/check-puzzle.mjs 能把它单独拎
 * 出来验（打包一下直接跑，不用开浏览器，进得了 CI）。
 *
 * **接线接完了。** 这一份原本是 PR-1 的地基（只有这个文件和它那道门），当时这
 * 里写着「玩法本身还没接线……真接上那天把这一段改成实话」——PR-2 接了
 * gameController 的六处分支和三副棋盘的 puzzleTally()，PR-3 接了主菜单卡片、挑
 * 图形页和四语文案，PR-4 接了记录与排行榜，8ab348c 又把「得分换来的是步数」演
 * 到了 HUD 上。所以现在就是实话：**这个玩法全线在跑**，改这个文件里的数会当场
 * 改变玩家手里的步数。
 *
 * 这个玩法和别的都不一样的地方：**没有钟**。别的局是「在多少时间里能打多少
 * 分」，这一局是「手里这几步能把这副盘面变成什么样」。所以底下两件事都得重
 * 写，不能沿用。
 */

/**
 * 开局手里有几步，**按棋盘定**（第 3 版，站长 2026-10-14）：经典小球 15，经典方块 22。
 *
 * 第 1、2 版是一律八步，再靠「得分退一步、连着得分多退、消边多退两步」往回攒。第 3 版把那几条退步全撤了：
 * 步数只降不升，所以起手要给够——方块那副 36 枚、小球 28 枚，起手跟着盘面大小走。
 *
 * 《步步为营》只开在这两副上（ui/puzzleMode.ts、engine/seedCode.ts、api/_seedcode.js、api/scores.js 的
 * PUZZLE_TILES 都只有 square / circle）。服务端那一份在 api/_maxscore.js 的 PUZZLE_START（交卷时拿它核
 * 「剩几步」不许比起手还多），两份由 check-scores-guard 对上。
 */
export const PUZZLE_START_STEPS: Readonly<Record<'square' | 'circle', number>> = Object.freeze({ circle: 15, square: 22 });
/** 这副棋盘起手几步。查不到就抛：以后开到第三副棋盘却忘了补表，不会悄悄拿别人的步数开局。 */
export function puzzleStartSteps(boardId: string): number {
  const n = (PUZZLE_START_STEPS as Record<string, number | undefined>)[boardId];
  if (n === undefined) throw new Error(`puzzleStartSteps：《步步为营》没有开在 ${boardId} 上`);
  return n;
}
/** 没得分的一步扣几步；得分的一步不扣（等价第 2 版的「扣 1 退 1」）。 */
export const PUZZLE_STEP_COST = 1;

/**
 * 《步步为营》的规则版本号。
 *
 * **第 3 版 = 空走额度**（站长 2026-10-14）：起手按棋盘（小球 15、方块 22），没得分的一步扣 1，得分的一步不扣，
 * 没有任何别的退步（连着得分多退、消边多退都撤了），步数只降不升。本机存档键 `_puzzle2 → _puzzle3`（runKey.ts 的
 * versioned 自动换），服务端榜 `…:puzzle2 → …:puzzle3`（api/scores.js 的 kindOf），旧的那张留着当归档榜。
 *
 * **第 2 版 = 消线退两步**（2026-10-02，那时这儿有一条 PUZZLE_EDGE_BONUS = 2）；第 1 版是消线只退一步的那一段
 * 时间。两版打出来的分不是一把尺子量的：消线的回报翻倍，一局能走的步数、因而终局盘
 * 上有多少枚被消除/翻成星星，整条都变了。
 *
 * 《侵蚀阶梯决策》§11 结尾那一条写得很清楚——上一次改这档的公式（撤掉《有效得分率》
 * 那一乘）**没有**升版本号，理由是那时候这个玩法整档打不开、线上一局都不可能有；而
 * 那一条同时留了话：「**别再用『反正没人打过』这条理由**」。这一次就是那个下一次。
 *
 * 升版本号 = 旧局原样留在 `_puzzle` 那个归档键下（记录页只摆现行那张榜），新局落进
 * `_puzzle2`。做法照 BOMB_RULES_VERSION / FLIP_RULES_VERSION 那条路，一个字都没新发明：
 * 后缀由 `engine/runKey.ts` 的 `versioned()` 生成，服务端那张榜由 `api/scores.js` 的
 * `kindOf` 分开（那儿的注释本来就预留了这一步：「将来……再照 bomb → bomb2 那条路往上
 * 加一版，把这一张留着当归档榜」）。
 */
export const PUZZLE_RULES_VERSION = 3;

// 没有封顶常数，也不需要：第 3 版步数只降不升。

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

/**
 * 《余步》那一格上冒的那行字。第 3 版：空走「−1」，得分「±0」。
 *
 * 写成纯函数、而不是在 gameController 里就地拼串，是因为**这一行字是整个玩法里唯一说得清「得分的那一步不花
 * 步数」的地方**，而它出过一次事故（8ab348c）：
 *
 *   原先那一格只认「净变化」，`bumpSteps` 第一句是 `if (delta === 0) return`。可那时（第 2 版）孤立的一次得分
 *   正好回本（−1 +1，净 0）——于是最常见的那次得分在余步那一格上**一个字都没有**，屏幕上唯一动的东西是分数格
 *   冒出来的「+27」。实测 8 局 67 步，三次得分三次都是余步纹丝不动。
 *
 * 所以**净 0 也必须出字**：得分那一步冒「±0」（U+00B1），说的正是「这一步没花你的步数」，不是「无事发生」。
 * 减号用 U+2212，不是连字符：它和「±」等宽，两种字在那一格里才对得齐。
 */
export function stepLedgerText(scored: boolean): string {
  return scored ? '±0' : `−${PUZZLE_STEP_COST}`;
}

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
  /**
   * 有效得分率 0–100（engine/performance.ts 的那一个，六副棋盘共用）。
   *
   * **这一档的综合得分不再乘它**（玩家 2026-10）。字段留着是因为 `RunData` 里本来就
   * 有这一位、旧档也带着它，结算页读旧档时还要照原样讲一遍（runRecord 那条旧档分支）。
   */
  ratePercent: number;
}

/**
 * 这一局的综合得分。
 *
 *   被消除 × 10 + 星星 × 5
 *
 * **有效得分率那一乘撤了**（玩家 2026-10）。从前是
 * `(被消除 × 10 + 星星 × 5) × (1 + 有效得分率/100)`——别的玩法那个四项连乘在这儿本来
 * 就只剩这一项（时间系数：不限时间了，快慢不再是本事；未翻面惩罚：步数耗尽是常态，
 * 盘上剩三十枚没翻的会把系数压到两成，等于把所有人一起砸到底）。这一轮把最后这一项
 * 也撤掉：这一局的本事已经全写在「消了几枚、留下几颗星」里了，再乘一个按行动加权的
 * 百分比，等于把同一件事记两遍，而那个百分比本身玩家又读不准（见下面那条⚠️）。
 *
 * ⚠️ 别把 HUD 上那个《有效得分率》和「多少步里得了分」混为一谈：前者是**按行
 * 动加权**的（普通图案 1、长图案 2、整线 3，见 engine/performance.ts），后者是
 * 按步数数的。两个数不相等——这正是撤掉它的理由之一。
 *
 * 第 3 版的账没有支点：得分的一步不扣、也不退，一局能走多久只看空走了几步（起手几步，就能空走几步）。
 */
export function puzzleComposite(tally: PuzzleBoardTally): number {
  const base = tally.cleared * PUZZLE_CLEARED_POINTS + tally.stars * PUZZLE_STAR_POINTS;
  return Math.max(0, Math.round(base));
}

/**
 * 手里那几步。
 *
 * 第 3 版只剩三个量：还剩几步、一共走了几步、其中得分的几步。第 2 版那三样（连着得分多退了几步、消边多退了几步、
 * 最多攒到过几步）随退步一起撤了——旧局的结算页读的是存档里记下的数，不读这儿。
 */
export interface StepBank {
  /** 还剩几步。 */
  left(): number;
  /** 一共走了几步。 */
  spent(): number;
  /** 其中得分的有几步。 */
  scoredMoves(): number;
  /**
   * 走一步。返回走完之后还剩几步——0 就是这一局到头了。没得分扣 PUZZLE_STEP_COST，得分不扣；
   * `left` 用 Math.max(0, …) 夹住，读数永远不是负的。
   */
  spend(scored: boolean): number;
  reset(): void;
}

/** 起手几步由调用方给（`puzzleStartSteps(棋盘)`），**没有默认值**：拿错棋盘的步数开局要当场看得出来。 */
export function createStepBank(start: number): StepBank {
  let left = start;
  let spent = 0;
  let scored = 0;
  return {
    left: () => left,
    spent: () => spent,
    scoredMoves: () => scored,
    spend(didScore) {
      spent++;
      if (didScore) scored++;
      else left = Math.max(0, left - PUZZLE_STEP_COST);
      return left;
    },
    reset() {
      left = start;
      spent = 0;
      scored = 0;
    },
  };
}
