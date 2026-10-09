import type { ShellRefs } from '../ui/gameShell';
import { clearRoomLeftover, mountRoomLeftover } from '../ui/roomLeftover';
import { snapFlipFaces, plankFlipCells, flipMs, flipStaggerMs } from './plankFlip';
import { watchFrames } from './frameTier';
import { createTimer, formatClock } from './timer';
import { createErosion, tableFor, type Erosion } from './erosion';
import { devErosionFor } from './devDeal';
import { POINTS_PER_FLIP, createCascadeStepper, createToggleLedger, flipStreakDelta, flipStreakMult, FLIP_RULES_VERSION, SCORING_RULES_VERSION, type CascadeConfig } from './scoring';
import { createScoreReel, syncGainState } from './scoreReel';
import { ALL_FLIPPED_REASON, endCheckEligible } from './kinetics';
import { rollDuration, rollOdometer } from './odometer';
import { saveBestIfHigher, saveRun, loadRuns } from './persistence';
import { trackGameStart, trackGameEnd, trackShare } from './analytics';
import {
  MANUAL_END_REASON,
  buildShareInfo,
  isSumRow,
  runBadges,
  runBreakdown,
  type ModeKey,
  type RunData,
} from './runRecord';
import { createPerformanceGauge } from './performance';
import { vibrate } from './haptics';
import { renderShareCard, type BoardSnapshot, type Standing } from './shareCard';
import { currentRoom, latestRoomState } from './room';
import { pushRun } from './cloudScores';
import { confirmRestart } from '../ui/confirmRestart';
import { confirmFinish } from '../ui/roomNotices';
import { setScreenBack } from './backNav';
import { playScore, playFlip, playClear, playError, playFinish, playSettle, reducedMotion, screenShake, spawnParticles, punch } from './juice';
import { BOMB_HAZARD_REASON, BOMB_RULES_VERSION } from './bomb';
import {
  createStepBank, puzzleComposite, stepLedgerText,
  PUZZLE_RULES_VERSION, PUZZLE_STEP_COST, PUZZLE_STEPS_OUT_REASON,
} from './puzzleScore';
import { claimFirstHowToHint, markFinishedAGame } from './firstPlay';
import { STRINGS, type Lang } from '../i18n';
import { stepCoefFor } from './stepCoef';
import type { Cell } from './types';

export interface CascadeStepGroups {
  matchGroups: Cell[][];
  lineBonusGroups: Cell[][];
}

/** Each tile left un-flipped when the run ends scales the composite by this. */
const UNFLIPPED_SCALE = 0.95;

import { mountCoachBar, mountCoachTip, type CoachBar, type CoachPlan, type CoachShape } from '../ui/coachBar';
import type { CoachHint } from './coachHint';
import { mountPatternBlock } from '../ui/patternBlock';
import { sizeAtLevel, type TargetPattern } from './targets';
import { clearSeed, seedRandom } from './rng';
import { dealSeed, randomSeed, variantForGame, type SeedRun } from './seedCode';
import { seedForTarget, slotTargetOf } from './seedDeal';
import { targetHudDef } from './targetIcon';
import { erodedFace } from './targetMatch';
import { cardOrNull } from '../shapes/registry';

export interface GameControllerHooks {
  bestKey: string;
  /** Human-readable name for the share card, already localized. */
  shapeName: string;
  /** Shape card id + challenge wrapper, so an archived run can be
   *  re-described later in whatever language it is reopened in. */
  shapeId: string;
  modeKey: ModeKey;
  /** Localizes this controller's own dynamic end-of-run text (breakdown rows, detail line, share-card labels). */
  lang: Lang;
  /**
   * Timed-challenge mode: the HUD clock counts down from this many seconds
   * instead of counting up, and the run ends on its own the instant it hits
   * zero (in addition to, not instead of, the normal isGameOver() ending).
   */
  timeLimitSec?: number;
  /** 练习盘：打完了就再来一盘，不结算、不存档、不上榜、不报统计。见 ShapeGameOpts.practice。 */
  practice?: boolean;
  /** 老虎机那一局（见 RunData.slot）：排行榜靠它把这一局单独排一张榜。 */
  slot?: boolean;
  /**
   * 老虎机那一局转出来的**那一个**目标（《侵蚀阶梯》v1.2 PR-8）。
   *
   * 控制器只拿它做两件事：HUD 那一块画这个目标（而不是基础玩法的 1×N），以及往
   * 这一局的档里记一个 `targetId`——分享卡和记录行照它画那张小图。「拼成了算几
   * 分」不在这儿，在棋盘自己的 findMatches 里（它要知道此刻认哪些子形）。
   */
  slotTarget?: TargetPattern;
  /**
   * 这副棋盘一共有几个可用格、几种颜色——侵蚀阶梯的段数与基准按它查表
   * （engine/erosion.ts 的 tableFor，《侵蚀阶梯》v1.2 §2）。
   *
   * 由棋盘自己报，而不是在 erosion.ts 里按 id 硬编一份：六边圆球中心那个永久空
   * 位算不算「可用」这种事只有棋盘自己知道，表里那几行也正是照它填的。
   */
  boardTiles: number;
  boardColors: number;
  /**
   * 此刻盘上还剩几枚**可用格**（离场的不算，中间那个永久空位本来就不算）。
   *
   * 结算页那个步数系数要它：「已清格数」＝ `boardTiles − tilesLeft()`
   * （《侵蚀阶梯》v1.2 §5）。由棋盘自己数，因为「离场」在各副棋盘里长得不一样
   * ——方块是把行列从网格里摘掉，别的五副是把格子打成空位。
   */
  tilesLeft(): number;
  /** 图案降了一级（4→3→2→1）。棋盘拿它重画提示，HUD 拿它演那一下熄灭（PR-7）。 */
  onErosion?: (level: number) => void;
  /**
   * 无限反转（见 ShapeGameOpts.flip）。这一局的计分和别的局不同：
   *   · 没有用时系数——综合得分里那一项恒为 1；
   *   · 连击不再是 ×1 / 1.5 / 2 / 2.5 加同一步里 ×3 的连锁，而是连续第 n 次
   *     得分 = 单次得分 × 1.5^(n−1)，每次四舍五入取整（4 → 6 → 9 → 13.5≈14 …）；
   *     一步没得分就从头数；
   *   · 同一组棋子正面、反面各得一次分就停，要动手才有下一次，而且不满五步
   *     拼回来不算（scoring.ts 的 ToggleLedger）。
   */
  flip?: boolean;
  /**
   * 头一局那块教学条（见 ui/coachBar.ts）。开着的话，棋盘底下那块壳子里会
   * 一条一条摆出五条规则，玩家做到了哪一条就换到下一条。只有玩家头一回打
   * 开被直接按进的那一局基础小球才开。
   */
  coach?: boolean;
  /** 教学条用的六幅配图。不给就按图形现算；小红书版传摘掉三角的那一份。 */
  coachArt?: readonly string[];
  /** 这一局玩的是哪种图形——决定第 4 条那句话，也决定配图画方块还是小球。 */
  coachShape?: CoachShape;
  /** 哪一种排法：头一局小球从第 1 条起，头一回玩方块先不出声。见 coachBar.ts。 */
  coachPlan?: CoachPlan;
  /**
   * 炸弹 / 无限反转 / 老虎机头一回进来时的那一句提示。
   *
   * 给了就用同一块条子摆这一句（没有六段进度、不跟着玩家走），15 秒后自己
   * 走掉；给了它就不摆五条规则——这三个玩法是在基础规则上加一层，能玩到这
   * 儿的人五条早听过了，要说的只有加的那一层。
   */
  coachTip?: { text: string; art: string };
  /**
   * 教学的呼吸灯（engine/coachHint.ts；10-09 补充方案 6-2 起一次一色、看 3 步以内）：棋盘自己
   * 搜、自己挑那一色、自己挂 `coach-glow`。`null` = 熄灯（一步正在结算、这一条不亮、这一局完
   * 了）。只有带五条教学的那两副基础棋盘（方块、小球）实现。
   *
   * 回 false = 这一次连一步都没算完（超了 15ms）、跳过了（灯熄着）；控制器过一会儿再试一次（见
   * refreshCoachGlow）。
   */
  coachGlow?(kind: CoachHint | null): boolean;
  /**
   * 教学第 4 条的条件：此刻某一种颜色的星星枚数 ≥ 最短外边的长度（方块用较短那条边）。
   * 「最短外边」只有棋盘自己知道，所以由它数。
   */
  coachStarsReachEdge?(): boolean;

  /**
   * 结算页上那对轮流发光的键（《分享》→《首页》）要不要亮。
   *
   * 玩家定的：「只有第一次结算的时候这两个轮流发光，随后的每局游戏都不要发
   * 光」。所以这不是「有没有教学条」的事——头一回进炸弹、进老虎机同样有教学
   * 条，可那时候他早就见过结算页了，再指一次就成了噪音。
   *
   * 判「是不是第一次」要落到本地记录上，而网页版和小红书版的记录**各存各
   * 的**（玩家定的头一条）。所以这里不自己读存储，改成问一句：结算页真的要
   * 露面了才叫这个函数，返回 true 就亮。谁来答、答案存哪儿，各版自己管。
   */
  shouldLeadOut?: () => boolean;
  /**
   * 头一回看见结算页时，在明细底下补一句「综合得分怎么算」。
   *
   * 问一次记一次（engine/firstPlay.ts 的 claimFirstTotalTip），所以只出现一
   * 次；结算页真的露面了才叫得到这儿。
   */
  shouldTeachTotal?: () => boolean;
  /**
   * 这一局用哪一串种子码发牌（第 19 推，ShapeGameOpts.seed）。不给就由控制器随手抽一串
   * ——每一局单人游戏都用种子发牌，见 newGame。
   */
  seed?: SeedRun;
  /** (Re)builds the shape's internal grid for a fresh game. */
  resetBoard(): void;
  /** Repaints the board from current state. */
  render(): void;
  /** True the instant the current state should end the run. */
  isGameOver(): boolean;
  /** Builds the cascade config for resolving one confirmed move. */
  buildCascadeConfig(): CascadeConfig;
  /**
   * 炸弹玩法：这一步结束时，盘面上有没有四枚活炸弹连成一片。回 true 表示这一
   * 局已经被它结束了（形状那边自己调了 forceEnd）。
   *
   * 为什么放在这儿、而且只查一次。从前它在 applyDrag 里：滑动一落定立刻查，
   * 然后才开始连锁。新规则下连锁里会拆炸弹，「这一步到底有没有四枚活炸弹相
   * 连」得等连锁跑完才知道，所以挪到连锁收尾的 finish()，看结算完的盘面。
   *
   * 只查一次，是为了不出现两个爆炸时刻：要是滑完查一次、连锁完再查一次，那一
   * 步「滑完的确四连、可连锁里恰好把其中一枚拆掉了」的走法就会被头一次检查提
   * 前引爆，规则从此要多解释一句「什么时候算被拆弹救回来、什么时候不算」。只
   * 留后一次，规则一句话说得清：**爆炸看这一步结束时的盘面**。
   *
   * 它还顺手补上一个旧漏洞：连锁里消掉一整行，上下两团炸弹会贴到一起——从前
   * 连锁里从不判死，这个四连要等玩家下一次在别处滑动、进了 applyDrag 才引爆，
   * 一个和炸弹无关的动作触发了爆炸。现在消行造成的四连就在那一步结算。
   */
  checkHazard?(): boolean;
  /**
   * Called once per cascade step (one "beat" of a chain reaction), right
   * before render() paints it — for a match step, matchGroups' cells are
   * still showing their pre-flip face at this point (the flip lands a
   * moment later, once the highlight has had time to be seen), so the
   * shape registers them into its own outline tracker here. For a bonus
   * step, lineBonusGroups' cells are already dot-faced and (for a shape
   * whose bonus removes cells) already gone from the board's data model —
   * this is where such a shape should snapshot the board's still-current
   * DOM to diff against once onCascadeStepRendered fires.
   */
  onCascadeStep?(step: CascadeStepGroups): void;
  /**
   * Called once per cascade step, right after render() paints it. A shape
   * whose line bonus removes cells plays its removal/collapse animation
   * here, diffing against whatever it captured in onCascadeStep.
   */
  onCascadeStepRendered?(step: CascadeStepGroups): void;
  /**
   * Called right after a match step's commit() actually flips matchGroups'
   * cells to their dot face, just before the render() that paints that flip
   * — a shape uses this to mark those specific cells so their *next*
   * render() plays a one-shot "just flipped" animation instead of silently
   * swapping in the new face. Never called for a bonus step (nothing to
   * flip — see CascadeStep.commit).
   */
  onCommit?(matchGroups: Cell[][]): void;
  /**
   * Checked after every move settles: [] unless the board has reached a
   * true dead end (every remaining not-yet-flipped tile's own flavor color
   * is too depleted to ever complete another match, so nothing can ever
   * flip again) — see stalemate.ts for why this is deliberately much
   * narrower than "some dot color is already exhausted" (that happens
   * routinely, right after an ordinary whole-line bonus, without blocking
   * the rest of the game). Each inner array is one dead color's remaining
   * cells, shown to the player before settling. Omit, or return [], if the
   * shape doesn't implement stalemate detection.
   */
  findStuckGroups?(): Cell[][];
  /**
   * Tells the shape which cells (if any) to draw the red "stuck" glow
   * around on its next render(); null clears it. Only meaningful together
   * with findStuckGroups.
   */
  highlightStuck?(cells: Cell[] | null): void;
  /**
   * Checked once, when the run ends: how many live tiles never got their
   * first flip at all vs. flipped at some point but never got swept into a
   * further dot-match or line bonus before the run ended — see endGame's
   * flat end-of-run penalty. Omit, or return zeros, if the shape doesn't
   * implement this (the penalty is simply skipped).
   */
  countRemainingTiles?(): { neverFlipped: number; flippedButRemaining: number };
  /**
   * 《真正解密 · 步步为营》。给了就是这一局玩它（见 engine/puzzleScore.ts）。
   *
   * 它和别的玩法的差别不在难度上，在**计什么**上：没有钟，HUD 第三格从「时间」
   * 换成「余步」，分数格印的是「此刻这副盘面值多少分」而不是一路攒的原始分，
   * 结算看终局盘面。所以这一个布尔在这份文件里岔开六处，每一处都点名了它。
   */
  puzzle?: boolean;
  /**
   * 步步为营的结算要数的两个数：被消除的枚数、终局还在盘上的星星数。
   *
   * **每副棋盘自己数。** 不许用「开局枚数 − 现在还剩几枚」一刀切——「被消除」
   * 在三副盘上长得不一样：方块是真的把格子拿走、两侧收拢；小球消完留一枚空白
   * 球在原位；三角留一个空洞。一刀切在小球和三角上会数成 0，那两副盘的分数就
   * 全靠星星，整个玩法的目标都歪了。
   */
  puzzleTally?(): { cleared: number; stars: number };
  /**
   * A lightweight snapshot of the board's current appearance for the share
   * card (see shareCard.ts) — called once right after a fresh board is dealt
   * and once when the run ends. Omit if the shape doesn't support sharing.
   */
  snapshotBoard?(): BoardSnapshot;
}

export interface GameController {
  readonly score: number;
  readonly moves: number;
  readonly started: boolean;
  readonly paused: boolean;
  readonly gameOver: boolean;
  /** True from the moment a move is confirmed until its whole chain reaction has finished revealing — a shape's drag should stay locked out until this clears, since resolveMove no longer settles synchronously. */
  readonly resolving: boolean;
  /** Runs the rest of the current reveal now, so a fresh touch is not
   *  turned away while the previous move is still being played out. */
  hurry(): void;
  restart(): void;
  pause(): void;
  resume(): void;
  finish(): void;
  /** Call after applying a confirmed drag with the set of cells it touched. */
  resolveMove(mask: Set<string>, moveDirDeg?: number): void;
  /**
   * 此刻的得分图案是几枚（4→3→2→1，《侵蚀阶梯》v1.2 §2）。棋盘的 findMatches
   * 每次都现问——图案会在一步之内变小，把它缓存下来就会慢一拍。
   */
  matchLen(): number;
  /** 这一级还剩几段 / 一共几段 / 到过 1 枚没有：HUD 的《得分图案》块要它们。 */
  erosionView(): { level: number; segLeft: number; segTotal: number; unlocked: boolean; par: number };
  /** Ends the run immediately with a custom reason and an optional flat score penalty (e.g. a bomb-mode hazard cluster) — shown as its own breakdown row, subtracted the same way as the other end-of-run penalties. */
  forceEnd(reason: string, penalty?: number, penaltyLabel?: string): void;
  /** Stops timers when navigating away without ending the run. */
  destroy(): void;
}

/**
 * Owns the state machine every board shares: start/pause/resume/finish/restart,
 * the timer, the streak multiplier, the score reel, and the best-score
 * persistence. Shapes plug in board setup/render/end-condition/cascade-config
 * and call resolveMove() once they've applied a confirmed drag to their grid.
 */
/** 往 HTML 里塞一句话之前先转义。这一句是五条规矩里的原文，不含标记。 */
const escHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createGameController(refs: ShellRefs, hooks: GameControllerHooks): GameController {
  const s = STRINGS[hooks.lang];

  /**
   * 侵蚀阶梯（《侵蚀阶梯》v1.2 §2）。无限反转传 frozen：那一局段照扣，图案不降级
   * （玩家 2026-09-27 拍板）。
   */
  const erosion: Erosion = createErosion(
    tableFor(hooks.shapeId, hooks.boardTiles, hooks.boardColors),
    !!hooks.flip,
  );

  const scoreReel = createScoreReel(refs.scoreReelEl, refs.gainBadgeEl);
  /**
   * 《行动有效率》那份统计。读数**在任何界面都不存在了**（《侵蚀阶梯》v1.2 PR-7）：§5 之后
   * 它不参与任何计分，留一个不算分的百分比在屏幕上，玩家只会照着它打。统计本身**没删**：步
   * 步为营的终局公式还在用它（engine/puzzleScore.ts 的 ratePercent）。
   *
   * 原先还留着一个空的 updatePerfDisplay（「把它印出来」那一步撤掉之后的空壳）和它的两处调
   * 用，10-08 方案第五批第 4 条删掉了——函数体是空的，删掉行为不变（check-scoring 第 6 节先
   * 证明过）。
   */
  const perf = createPerformanceGauge();
  /** 倒数进最后这么多秒就转警示色（§PR-7）。 */
  const TIMER_LOW_SEC = 10;
  const timer = createTimer((sec) => {
    // 计时器**照常走**，不管屏幕上画不画它：结算档案里的 elapsedSec 还要用
    // （记录页、云端、战绩图都读它）。
    //
    // 顶排从 2026-09 起没有钟了（《侵蚀阶梯》v1.2 PR-7）：时间不再计分，所以只有
    // 计时那一档还需要一个读数，它摆在暂停药丸正上方那一块小的上。别的档屏幕上
    // 干脆不显示时间——留一个一直在涨、却不算分的数，只会让人以为快慢有用。
    if (hooks.puzzle) return;
    const el = refs.timerEl;
    if (hooks.timeLimitSec !== undefined) {
      const remaining = Math.max(0, hooks.timeLimitSec - sec);
      if (el) {
        el.textContent = formatClock(remaining);
        el.classList.toggle('timer-pill--low', remaining <= TIMER_LOW_SEC);
      }
      /*
       * 钟响的那一刻，**连锁可能还在一拍一拍地走**（#18）。
       *
       * 从前这儿直接 `endGame`，于是那几拍再也不会跑：玩家最后一滑引出的那串消除、它带的
       * 分、它可能引出的降级，全都停在半空中。结算页上写的是「时间到」加一个比他眼睛看到
       * 的要小的数——而他明明看见那串消除正在发生。更难看的一种：最后一滑刚好把盘清空，本
       * 该是「全部消完了」，结果被判成「时间到」。
       *
       * 所以先 `hurry()` 把剩下的拍子一次跑完（它自己是有界的，见那个函数），再结算。
       *
       * ⚠️ **第二道 `!gameOver` 不能省。** `hurry()` 跑的那几拍自己就会结算——盘清空了、或
       * 者判出死局。省掉的话这一局会被结算两遍，而第二遍写的是「时间到」，把第一遍那个正确
       * 的理由盖掉。
       *
       * ⚠️ **也不要把 `hurry()` 挪进 `endGame()`。** `endGame` 正是那几拍自己会调的东西，
       * 挪进去就是 `endGame → hurry → 某一拍 → endGame`，一个会把栈打穿的环。这一句只属于
       * 「钟响了」这一条路：它是唯一一个**从外面**打断连锁的结算理由。
       */
      if (remaining <= 0 && !gameOver) {
        hurry();
        if (!gameOver) endGame('时间到');
      }
      return;
    }
    if (el) el.textContent = formatClock(sec);
  });
  /**
   * 这一局的帧时采样（engine/frameTier.ts）。量到连续两秒都跑不到 45fps 就
   * 把粒子和震屏降一档，之后不再量。只在局中挂着：主菜单的帧时说明不了棋盘
   * 跑不跑得动，而一条永远在转的 rAF 会让手机没法休眠。
   */
  const stopFrameWatch = watchFrames();
  /**
   * HUD 右边那一块《得分图案》（ui/patternBlock.ts）。
   *
   * 它归控制器管、不归棋盘管：图案是几枚、这一级还剩几段，都是侵蚀阶梯的状态，
   * 而阶梯活在这儿。棋盘只报自己归哪一族（画成方块、小球还是三角）。
   */
  const patternBlock = mountPatternBlock(
    refs.patternBlockEl,
    // 认不出来就当方块：这一处画的是**图标长什么样**，猜错只影响好不好看，
    // 而 hooks.shapeId 在练习盘、小屋那几条路上不一定查得到（cardOrNull 的用意）。
    cardOrNull(hooks.shapeId)?.family ?? 'square',
    hooks.lang,
    // 老虎机那一局画的是这一级的目标子形，别的局画 1×N。挑哪一个子形来画由
    // erodedFace 定死（见那儿：从后往前拆，剩下的还连着就拆它），所以同一个目标
    // 每次降级都是「同一个图案缺了个角」，不是每级换一个陌生形状。
    hooks.slotTarget
      ? (level) =>
          targetHudDef(
            hooks.slotTarget!,
            erodedFace(hooks.slotTarget!, sizeAtLevel(hooks.slotTarget!, level)),
          )
      : undefined,
  );
  const paintPattern = () =>
    patternBlock.update({ level: erosion.level(), segLeft: erosion.segLeft(), segTotal: erosion.segTotal() });
  /** 无限反转的连锁账本（见 scoring.ts 的 createToggleLedger）；别的局没有。 */
  const flipLedger = hooks.flip ? createToggleLedger() : null;
  /** 步步为营手里那几步（见 engine/puzzleScore.ts）；别的局没有。 */
  const bank = hooks.puzzle ? createStepBank() : null;

  /** 余步 ≤ 2 就把那一格点红。这一局没有钟，紧张感全在这个数上。 */
  const STEPS_LOW = 2;
  function paintSteps(left: number) {
    // 只有步步为营那一档有这个读数（顶排左边那一块印的是余步，不是分数）；
    // 别的档它是 null。
    const el = refs.hudTimeEl;
    if (!el) return;
    el.textContent = String(left);
    // 用 --accent 而不是写死一个红：色盲友好开关会把 --accent 换成蓝色，写死的
    // 红在那一套配色下反而是最不该出现的颜色。
    el.closest<HTMLElement>('.hud-block')?.classList.toggle('low', left <= STEPS_LOW);
  }
  /**
   * 那一格上冒一下「−1」「−1 +1」「−1 +2」「−1 +3」。
   *
   * 收的是**这一步退回来了几步**，不是净变化——净变化那一版把最要紧的那一下
   * 吞掉了（孤立得分净 0，于是什么都不冒，见 puzzleScore.ts 的 stepLedgerText）。
   * 字怎么排由那个纯函数说了算，这儿只负责把它放上去：那样 check-puzzle 不用
   * 开浏览器就能把四种情况钉住。
   *
   * 没有借 scoreReel.showGain：它 amount <= 0 直接 return、而且永远印「+」号
   * ——而这一局每一步都带着一个 −1。借 .gain-pop 那个类，动画是同一套。
   */
  function bumpSteps(refund: number) {
    const host = refs.stepsBadgeEl;
    if (!host) return;
    const pop = document.createElement('span');
    pop.className = 'gain-pop';
    pop.textContent = stepLedgerText(refund);
    host.appendChild(pop);
    // 和 showGain 那一头同一件事：牌里有「−1」在飘的时候，读数让一让（那个类由
    // syncGainState 挂，理由见它自己那段注释——`:has()` 在 Chrome 61 上整条被丢）。
    const stepsCell = host.closest<HTMLElement>('.hud-block--score');
    syncGainState(stepsCell);
    window.setTimeout(() => {
      pop.remove();
      syncGainState(stepsCell);
    }, 1400);
    // 从前这下轻弹打在分数格上（得分了就该有反馈）。这一局分数不在局中露面
    // 了，反馈就跟着搬到真正在变的那一格来（顶排左边那一块印的是余步）。
    if (refs.hudTimeEl) punch(refs.hudTimeEl);
  }
  let score = 0;
  let moves = 0;
  /** 无限反转：到现在为止连续得了几次分（含同一步里的连锁），一步没得分就归零。 */
  let flipChain = 0;
  let started = false;
  let paused = false;
  let gameOver = false;
  let resolving = false;
  // The one timer the reveal is waiting on, so a fresh touch can run the
  // rest of it now instead of waiting it out — see hurry().
  let pendingBeat: { id: number; run: () => void; at: number; ms: number } | null = null;
  /**
   * 暂停时把还没到点的那一拍收在这儿，《继续》时原样放回去。
   *
   * 玩家撞上的是这个：滑出一步能连锁好几拍的棋，这时候手机来电、或者手一抖
   * 按了暂停——遮罩盖上了，连锁、加分、判死局却都在遮罩背后接着跑，可能在他
   * 完全没看见的情况下自己弹出结算页。现在暂停连这一拍一起停，剩下多少毫秒
   * 就记多少，回来接着数。
   */
  let heldBeat: { run: () => void; ms: number } | null = null;

  /** 排下一拍。记下排的时刻和时长，暂停时才算得出「还剩多久」。 */
  function armBeat(run: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      if (pendingBeat?.id === id) pendingBeat = null;
      run();
    }, ms);
    pendingBeat = { id, run, at: Date.now(), ms };
  }

  /**
   * 把还没到点的那一拍**撤掉**（不留着回来跑）。
   *
   * 「把引用置空」和「撤掉定时器」是两件事。`armBeat` 排下的那个 setTimeout 只认自己
   * 的 id，到点照样跑 `run()`——置空只是让这边不再认得它，拦不住它。于是这一局都结束
   * 了（endGame），连锁的下一拍还会在结算页盖上之后落下来：往一副已经结清的盘上接着
   * 翻、接着记分、接着判死局。不崩、不报错。
   */
  function cancelBeat(): void {
    if (pendingBeat) window.clearTimeout(pendingBeat.id);
    pendingBeat = null;
  }

  /** 把还没到点的那一拍收起来（暂停用）。 */
  function holdBeat(): void {
    if (!pendingBeat) return;
    window.clearTimeout(pendingBeat.id);
    heldBeat = { run: pendingBeat.run, ms: Math.max(0, pendingBeat.ms - (Date.now() - pendingBeat.at)) };
    pendingBeat = null;
  }
  // Running split of where the score came from, for the end-of-run breakdown.
  let patternPoints = 0;
  let linePoints = 0;
  let comboBonusPoints = 0;
  /**
   * 结算页那几行要的三个数（《侵蚀阶梯》v1.2 §5 的行序）。
   *
   * 这一局一共翻了几枚（`flipsTotal`，**含拆掉的炸弹**）、其中拆弹占几枚
   * （`defusedTotal`）、削掉了几条线（`lineCount`）。分是按翻面枚数算的，所以结
   * 算页那一行说的是「翻面 n 枚 ×2」——n 必须是真数出来的，不是拿分除以 2 倒推：
   * 无限反转那一局不按翻面计分，倒推出来的数会是个假的。
   */
  let flipsTotal = 0;
  let defusedTotal = 0;
  let lineCount = 0;
  /** 这一局到过 1 枚图案没有（「解锁 1 枚」徽章，§2）。 */
  let unlockedOne = false;
  // 一局里 findStuckGroups 点过名的每一组格子。一种颜色一旦真的死了就只会一
  // 直死着（见 stalemate.ts：没有什么能让它翻回来），所以这个集合只会变大。
  let startSnapshot: BoardSnapshot | null = null;
  let endSnapshot: BoardSnapshot | null = null;
  let lastRun: RunData | null = null;
  /**
   * 这一局正用着的种子（第 19 推）。外面给了就用外面的；没给就在头一局开出来的那一刻随手
   * 抽一串（练习盘不抽，见 newGame）。「再来一局」：随手抽的那种换一串新的，敲进来的、每
   * 日的、小屋的都还是这一串。
   */
  let seedRun: SeedRun | null = hooks.seed ?? null;
  /** 这一局在种子码编号表里是第几行（engine/seedCode.ts 的 VARIANTS）；表里没有就 -1。 */
  const seedVariant = variantForGame(hooks.modeKey, hooks.shapeId, Boolean(hooks.slotTarget));
  /** 这一个控制器开过几局了（第二局起「随手抽的」种子要换一串）。 */
  let dealt = 0;
  /**
   * 这一局的战绩图（PNG 的 data:uri）。一局画一次，结算页和《分享》那一窗共
   * 用同一张——见 renderCard。
   */
  let lastCardUrl: string | null = null;

  /**
   * 「全死」那一下排下的收尾（1.4 秒后出结算页）的定时器（第 14 推）。
   *
   * 原先是一个没人记得的 setTimeout：死局亮红的那 1.4 秒里按了《再来一局》（或者离开这
   * 一页），它照样会响——那时 gameOver 已经是**新的那一局**的 false，于是新的一局刚开就被
   * 「无法继续匹配」收掉。新开一局、拆掉这一页都要先把它撤了。
   */
  let stuckTimer = 0;

  function updateStuckState(groups: Cell[][]) {
    hooks.highlightStuck?.(groups.length ? groups.flat() : null);
    // findStuckGroups 现在只报「全死」——场上没有任何一种正面颜色还能再得分。
    // 所以这一局不再等玩家自己按什么键结束，它自己结束：那几枚先红一下让人看
    // 清是什么死了，随后出结算页。
    //
    // 从前这儿还有一颗《自行结束》键（单色死就亮起来，让玩家自己决定还磨不
    // 磨）。判定改成只认「全死」之后那颗键就再也没有亮起来的时机了，2026-09
    // 连同它的四条文案一起删掉——留着一颗永远不出现的键，只会让读规则的人去
    // 找一个不存在的东西（《游戏规则》里那句话当时也一起改了）。
    if (groups.length && !gameOver) {
      hooks.render();
      window.clearTimeout(stuckTimer);
      stuckTimer = window.setTimeout(() => {
        stuckTimer = 0;
        if (!gameOver) endGame('无法继续匹配');
      }, 1400);
    }
  }

  /** 头一局那块教学条。没开、或者外壳没画那块壳子，就一直是 null。 */
  let coach: CoachBar | null = null;
  /** 那三个玩法头一回进来的一句提示。摆 15 秒自己走，走了就不再回来。 */
  let coachTip: { destroy(): void } | null = null;

  /**
   * 结算页上替他指路：《分享》先亮三个来回，然后换《首页》一直亮着。
   *
   * 只在他**头一回看见结算页**那一次做（见 hooks.shouldLeadOut）。之后他认
   * 得这一排键了，再亮就是噪音。
   */
  let leadTimer = 0;
  function leadTheWayOut() {
    window.clearTimeout(leadTimer);
    refs.buttons.endBack.classList.remove('glow-pulse');
    refs.buttons.share.classList.add('glow-pulse');
    leadTimer = window.setTimeout(() => {
      refs.buttons.share.classList.remove('glow-pulse');
      refs.buttons.endBack.classList.add('glow-pulse');
    }, 6600);
  }

  /** 离开结算页时把这两处光撤掉——下一局重开时不该还亮着。 */
  function stopLeading() {
    window.clearTimeout(leadTimer);
    leadTimer = 0;
    refs.buttons.share.classList.remove('glow-pulse');
    refs.buttons.endBack.classList.remove('glow-pulse');
  }

  /**
   * 教学的呼吸灯重算一次（第 15 推）。
   *
   * 两个人会喊它：一步结算完（finish），和教学条换了一条（onChange）。两件事常常在同一
   * 拍里一起发生（结算完、条子顺手换到下一条），所以合并成一次——推到这一拍的末尾
   * （Promise 的微任务；`queueMicrotask` 小红书那台 Chrome 61 没有）再算，算之前问一句「是
   * 不是又开始结算了」：结算期间灯是熄的，等 finish 再点。
   */
  let glowQueued = false;
  /**
   * 连一步都没算完、跳过之后，隔多久再试一次、最多试几次。
   *
   * 每一次重算有上限（10-09 补充方案 6-2：两万个盘面或 15ms，超了退回少看几步；第 15 推那一版是
   * 「单次超过 8ms 就跳过这一次」），可**第一次算往往是最慢的那一次**：开局那一下认组的那几个
   * 函数还一次都没跑过，浏览器还没把它们编译成快的那一版。不再试的话，最该亮的那一刻（开局讲第
   * 1 条）在慢一点的手机上反而一盏都不亮，要等他自己滑完第一步才有。再试一次的时候它们已经热
   * 了。每一次照样守着那条上限。
   */
  const GLOW_RETRY_MS = 300;
  const GLOW_RETRIES = 2;
  let glowRetryTimer = 0;
  let glowRetriesLeft = GLOW_RETRIES;
  function refreshCoachGlow(retry = false): void {
    // 不在这儿问 coach 在不在：条子开口那一下（mountCoachBar 里 show(0) → onChange）就会喊
    // 它，那时候 `coach = mountCoachBar(…)` 还没赋上值。到微任务里再问。
    if (!hooks.coachGlow || glowQueued) return;
    if (!retry) {
      window.clearTimeout(glowRetryTimer);
      glowRetryTimer = 0;
      glowRetriesLeft = GLOW_RETRIES;
    }
    glowQueued = true;
    void Promise.resolve().then(() => {
      glowQueued = false;
      if (!coach || resolving || gameOver || !started) return;
      const done = hooks.coachGlow?.(coach.hint()) ?? true;
      if (!done && glowRetriesLeft > 0) {
        glowRetriesLeft--;
        glowRetryTimer = window.setTimeout(() => {
          glowRetryTimer = 0;
          refreshCoachGlow(true);
        }, GLOW_RETRY_MS);
      }
    });
  }

  /**
   * 发牌之前把种子种上（第 19 推，方案原话：「在 newGame 里的 hooks.resetBoard() 之前
   * seedRandom('s1:' + code)」）。
   *
   * · 练习盘不种：那一块是小屋等人时随手打的，不结算、不存档，也没有码可印；它从前就是
   *   Math.random（main.ts 的 onPractice 自己清过一次），这儿照旧清一遍。
   * · 头一局：外面给了就用外面的；没给就随手抽一串（这个玩法、这副棋盘）。
   * · 第二局起（「再来一局」）：随手抽的那种换一串新的；敲进来的、每日的、小屋的还是这
   *   一串——同一副牌再来一次，正是输种子、打每日挑战的意思。
   * · 老虎机：目标是**先**从种子里抽的（方案：「先从种子里抽，再发牌」），所以这儿照抽一
   *   次——抽出来的和开局前那一屏转出来的是同一个（同一串码、同一个起点），抽这一下是为
   *   了让后面发牌从流里同一个位置接着取，任何一台设备照这串码都发出同一副牌。
   *   「再来一局」不换目标（从前就是同一个图案、换一副牌），所以换的那一串要挑「头一下抽
   *   出来正是这个目标」的（seedDeal.ts 的 seedForTarget）——随手换一串的话，印在分享卡
   *   上的码还原出来是另一个图案。暂停面板和结算页那两颗《再来一局》都走这儿。
   * · 编号表里没有这一局（不该发生）：退回 Math.random，不印码——印一串还原不了这一局的
   *   码比不印更糟。
   */
  function plantSeed() {
    if (hooks.practice) {
      seedRun = null;
      clearSeed();
      return;
    }
    if (!seedRun || (dealt > 0 && seedRun.source === 'random')) {
      const code =
        seedVariant < 0
          ? null
          : hooks.slotTarget
            ? seedForTarget(seedVariant, hooks.slotTarget)
            : randomSeed(seedVariant);
      if (!code) {
        seedRun = null;
        clearSeed();
        return;
      }
      seedRun = { code, source: 'random' };
    }
    if (hooks.slotTarget) slotTargetOf(seedRun.code, hooks.slotTarget.family);
    else seedRandom(dealSeed(seedRun.code));
  }

  function newGame() {
    // 上一局「全死」排下的收尾不许落到这一局头上（见 stuckTimer）。
    window.clearTimeout(stuckTimer);
    stuckTimer = 0;
    plantSeed();
    dealt++;
    hooks.resetBoard();
    score = 0;
    moves = 0;
    gameOver = false;
    paused = false;
    resolving = false;
    // 上一局暂停时收起来的那一拍不能带到这一局里（重开是从暂停面板按下去的）。
    heldBeat = null;
    // 上一局那张战绩图也一起忘掉：这一局还没打完，结算页上不该留着上一局的图。
    lastCardUrl = null;
    refs.endShareImgEl.removeAttribute('src');
    refs.endShareImgEl.parentElement?.setAttribute('hidden', '');
    if (pendingBeat) {
      window.clearTimeout(pendingBeat.id);
      pendingBeat = null;
    }
    flipChain = 0;
    flipLedger?.reset();
    bank?.reset();
    scoreReel.reset();
    perf.reset();
    if (bank) paintSteps(bank.left());
    patternPoints = 0;
    linePoints = 0;
    comboBonusPoints = 0;
    flipsTotal = 0;
    defusedTotal = 0;
    lineCount = 0;
    unlockedOne = false;
    erosion.reset();
    // 开发时可以让这一局一开局就扣掉几段（engine/devDeal.ts 的 devErosionFor）：走到「解锁 1 枚」
    // 要翻三十来枚，门（check-erosion-live）靠它直接从那儿开始。正式包里这一行整段被摇掉。
    const devSpent = devErosionFor();
    if (devSpent > 0) erosion.spend(devSpent);
    paintPattern();
    timer.start();
    hooks.render();
    updateStuckState([]);
    startSnapshot = hooks.snapshotBoard?.() ?? null;
    // 开新的一局就把小屋那份底忘掉。屋主散场之后转成单人的那一局，如果人没
    // 打完就走了（按《主页》，没有结算页），那份底会一直留着——不清掉的话，
    // 他下次随便开一局单人打完，顶上会莫名其妙冒出一间早散了的小屋。
    clearRoomLeftover();
    stopLeading();
    refs.endOverlay.classList.remove('show');
    refs.pauseOverlay.classList.remove('show');
    // 教学条跟着新的一局从第 1 条重来。第一次开局时才真的建出来——建在开局
    // 页还盖着的时候没有意义，玩家根本看不见它。
    if (hooks.coach && refs.coachEl) {
      if (hooks.coachTip) {
        // 一句提示：只在真正的第一局摆一次。再来一局的人已经看过了，再摆一
        // 遍是把同一句话说第二次。
        if (!coachTip) coachTip = mountCoachTip(refs.coachEl, hooks.coachTip.text, hooks.coachTip.art);
      } else if (coach) coach.reset();
      else {
        coach = mountCoachBar(refs.coachEl, {
          lang: hooks.lang,
          shape: hooks.coachShape ?? 'circle',
          plan: hooks.coachPlan,
          art: hooks.coachArt,
          // 换了一条，呼吸灯亮哪一种组跟着换（第 15 推）。条子不认识棋子、棋盘不认识条子，
          // 两样都在这儿手上，所以由这儿接线。
          onChange: () => refreshCoachGlow(),
        });
      }
    }
  }

  /** 章画完之前留出的那 50ms：分数落定和盖章之间要有一道缝，不然读起来是同时发生。 */
  const STAMP_GAP_MS = 50;

  /**
   * 「全部方块已翻成点面」那一枚章。
   *
   * **只有真通关才有这个节点。** 别的终局这儿一个 SVG 都不建——不是建了再 hidden：
   * 一枚藏着的「完成」章迟早会因为某一条 CSS 而露出来，而它露出来说的是假话。
   * 判定在 engine/kinetics.ts 的 endCheckEligible（纯函数，门钉着它对每一种终局
   * 的映射）。
   *
   * 落在分数后面：滚筒滚完（rollDuration 把错峰算进去了）再等 50ms 才开始描。
   */
  function stampEndCheck(reason: string, total: number): void {
    const host = refs.endStampEl;
    host.textContent = '';
    host.classList.remove('end-stamp--drawn');
    // 有没有这枚勾，抬头是两种排法（10-08 方案 3-I 的两张设计图）：有勾的时候勾在左边那一列、
    // 明细在右边那一列；没有就是明细在分数底下。见 style.css 的 .end--stamp。
    refs.endOverlay.classList.toggle('end--stamp', endCheckEligible(reason));
    if (!endCheckEligible(reason)) return;
    // 颜色和粗细照设计图（10-08 方案 3-I）：88px 的圈、环宽 13、勾也是粗的一笔——从前是细线描的
    // 72px（环宽 3）。颜色走 --end-ok（浅色主题里就是设计图那支 #00AC00，深色和色盲另有一档）。
    host.innerHTML =
      '<svg viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle class="end-stamp-ring" cx="20" cy="20" r="17" fill="none"' +
      ' stroke="var(--end-ok)" stroke-width="5.9"/>' +
      '<path class="end-stamp-tick" d="M11.3 18.2 L16.6 25.6 L28.6 12.6" fill="none"' +
      ' stroke="var(--end-ok)" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    if (reducedMotion()) {
      // 直接就是画完的样子（那两条 transition 在 reduced-motion 下是 none）。
      host.classList.add('end-stamp--drawn');
      return;
    }
    const wait = rollDuration(total) + STAMP_GAP_MS;
    window.setTimeout(() => {
      // 这中间他可能已经按了《再来一局》或《首页》——那时候这个节点早被下一局的
      // stampEndCheck 清空了，或者整页换掉了。不在文档里就不画。
      if (!host.isConnected || !host.firstChild) return;
      host.classList.add('end-stamp--drawn');
      // 里程碑那一声，摆在勾这一边。结算页开场那一下是 playSettle（每一局都有），
      // 这一声只有真通关才有——最少见、最好的那一种结局值得一句单独的话。
      playFinish();
    }, wait);
  }

  function endGame(reason: string, extraPenalty = 0, extraPenaltyLabel = s.defaultPenaltyLabel) {
    if (hooks.practice) {
      // 练习盘没有「结束」这回事：翻完了、死局了，就静静再发一盘接着玩。
      gameOver = false;
      resolving = false;
      newGame();
      return;
    }
    gameOver = true;
    resolving = false;
    // 打完过一局了（头一局那个带教学条的也算）：主菜单上那张《每日挑战》从此摆出来（10-08 方案
    // 3-D-1，见 engine/firstPlay.ts 的 finishedAGame）。
    markFinishedAGame();
    // 这一局完了，教学的呼吸灯一起熄（结算页底下那副棋盘还看得见一角）。
    if (coach) hooks.coachGlow?.(null);
    // 连锁的下一拍要**撤掉**，不是置空（见 cancelBeat 那段）。从前这儿一句都没有，
    // 排着的那一拍会在结算页盖上之后照样落下来。
    cancelBeat();
    timer.stop();
    // 单人局的《结束游戏》就长在暂停面板上，所以这一局多半是从那一层按下来
    // 的——不撤掉的话，暂停那一层会一直亮着躺在结算页底下：按结算页的《主页》
    // 走人、下一次再进游戏，它就跟着冒出来了。paused 也要跟着放平，不然回到
    // 前台时那套「还在暂停中」的判断会当作这一局还停在半路。
    paused = false;
    refs.pauseOverlay.classList.remove('show');
    const elapsed = timer.elapsedSeconds();

    const statusPercent = perf.valuePercent();
    const bonusMult = 1 + statusPercent / 100;
    /**
     * **用时系数退役了**（《侵蚀阶梯》v1.2 §5）。综合分那一头现在只剩一个乘数：
     * 步数系数。用时只在结算页上以一行小字出现，写明「不计分」。
     *
     * 这一行留着是因为 `RunData.timeMult` 还在（旧档里有这个字段，记录页翻开老局
     * 时照它重讲一遍）；新局一律 1，结算页也不摆那一行。原先那条用时曲线
     * （timeMultiplierFor / TIME_GAIN）退役之后一个调用者都没有，10-08 方案第五批
     * 第 4 条删掉了。
     */
    const timeMult = 1;
    /**
     * 这一档乘不乘步数系数（§5「适用：基础、更多布局、计时、炸弹、小屋终榜。
     * 不适用：老虎机、步步为营、无限反转」）。
     */
    const usesStepCoef = !hooks.flip && !hooks.puzzle && !hooks.slot;
    // Leaving tiles face-up costs the same either way — walking away early
    // and running the board into a genuine dead end are charged alike, so
    // "stop now" is never a way to dodge the cost of an unfinished board.
    // It is a *scale*, not a flat subtraction: an earlier flat per-tile
    // penalty could wipe out real scoring outright (verified case: 8 raw
    // points against 29 never-flipped tiles → −870, clamped to a flat 0),
    // which read as "you scored nothing" on the results modal and on the
    // share card. Scaling always leaves a good run's score visible.
    const remaining = hooks.countRemainingTiles?.() ?? { neverFlipped: 0, flippedButRemaining: 0 };
    /**
     * 步步为营这三项一律 1 / 1 / 0，另走一条公式（见 engine/puzzleScore.ts）。
     *
     * 不是「顺手简化」，是那条四项连乘里有两项在这一局是**坏的**：
     *   · 时间系数——没有钟，快慢不再是本事（上面那一行已经按下去了）；
     *   · 0.95^未翻面——步数耗尽是这一局的常态，盘上必然剩一堆没碰过的，剩 29
     *     枚就把系数压到两成，等于把所有人一起砸到底，罚的不是失误而是规则。
     * 惩罚那一项这一局没有任何路径会传进来（没有炸弹），写成 0 是把这件事钉住，
     * 而不是靠「反正没人传」。
     *
     * 写成定值、而不是留着算出一个 1.00，是为了让 runBreakdown 的 puzzle 分支
     * 干脆不摆那几行——摆一行「×1.00」等于告诉玩家有这回事。
     */
    const unflippedScale = hooks.puzzle ? 1 : UNFLIPPED_SCALE ** remaining.neverFlipped;
    const penalty = hooks.puzzle ? 0 : extraPenalty;
    /** 这一局的终局盘面（每副棋盘自己数，见 hooks.puzzleTally）。 */
    const tally = hooks.puzzle ? (hooks.puzzleTally?.() ?? { cleared: 0, stars: 0 }) : null;
    /** 已清格数：开局有几枚，现在还剩几枚，差就是清掉的（§5）。 */
    const cleared = Math.max(0, hooks.boardTiles - hooks.tilesLeft());
    const swept = cleared >= hooks.boardTiles;
    const par = erosion.par();
    const stepCoef = stepCoefFor({ par, cleared, tiles: hooks.boardTiles, moves, apply: usesStepCoef });
    const total = tally
      ? puzzleComposite({ cleared: tally.cleared, stars: tally.stars, ratePercent: statusPercent })
      : Math.max(0, Math.round(score * stepCoef) - penalty);

    const best = saveBestIfHigher(hooks.bestKey, total);

    // One record of the run, as data rather than as finished sentences — the
    // end modal, the share card and the 记录 panel all render from this, so
    // reopening an old run in another language re-describes it properly
    // instead of replaying the wording it happened to end on.
    const hazardEnd = reason === BOMB_HAZARD_REASON;
    lastRun = {
      shapeId: hooks.shapeId,
      shapeFallback: hooks.shapeName,
      modeKey: hooks.modeKey,
      totalScore: total,
      score,
      ratePercent: statusPercent,
      bonusMult,
      elapsedSec: elapsed,
      moves,
      best,
      reason,
      neverFlipped: remaining.neverFlipped,
      unflippedScale,
      timeMult,
      patternPoints,
      comboBonusPoints,
      linePoints,
      extraPenalty: penalty,
      extraPenaltyReason: extraPenaltyLabel,
      hazardEnd,
      /**
       * 步步为营这一局的明细。存**数字**不存句子——结算页、战绩图、记录页都从
       * 这一份重新讲一遍，换种语言打开旧档要能重新描述，而不是复述它当时恰好
       * 用的那些词（见 runRecord.ts 顶上那段）。
       */
      puzzle:
        tally && bank
          ? {
              cleared: tally.cleared,
              stars: tally.stars,
              spent: bank.spent(),
              scoredMoves: bank.scoredMoves(),
              streakRefunds: bank.streakRefunds(),
              edgeRefunds: bank.edgeRefunds(),
              left: bank.left(),
              peak: bank.peak(),
            }
          : undefined,
      // 这一局是在小屋里打的。记录页、战绩图、云上的档都带着它——两边现在
      // 是同一套计分了，可「和谁一起打的」仍然是这一局的一部分。
      room: Boolean(currentRoom()),
      slot: Boolean(hooks.slot),
      // 这一局认的是哪个得分目标（《侵蚀阶梯》v1.2 PR-8）。分享卡和记录行照它画
      // 那张小图——从前一局认两个、屏幕上有一整排图示，档里于是不必记；现在只有
      // 一个，而它是这一局**唯一**和别的局不同的地方，不记下来那张卡就说不出这一
      // 局在拼什么。非老虎机局不写这一项。
      targetId: hooks.slotTarget?.id,
      // 炸弹局带上规则版本号：存档键和排行榜靠它把新旧两套规则的局分开（见
      // bomb.ts 的 BOMB_RULES_VERSION）。非炸弹局不写，省得每一局都多一个字段。
      bombRules:
        hooks.modeKey === 'bomb' || hooks.modeKey === 'bombTimed' ? BOMB_RULES_VERSION : undefined,
      // 无限反转同理（见 scoring.ts 的 FLIP_RULES_VERSION）：连击封顶前后的分不是
      // 一把尺子量的。非反转局不写。
      flipRules: hooks.modeKey === 'flip' ? FLIP_RULES_VERSION : undefined,
      // 步步为营同理（见 puzzleScore.ts 的 PUZZLE_RULES_VERSION）：2026-10-02 消线奖励
      // 从退一步改成退两步，一局能走多久、终局盘面长什么样整条都变了。非这一档不写。
      puzzleRules: hooks.modeKey === 'puzzle' ? PUZZLE_RULES_VERSION : undefined,
      // 这一局的种子（第 19 推）：码、从哪儿来的、每日挑战那一天。分享卡照它印「种子
      // XXXX-XXXX」（每日的再加「· 每日 MM/DD」），服务器照 daily 和 seed 把每日挑战那一
      // 局收进「今日」榜（它自己重算那一天的码核对，不信这两个字段）。小屋老虎机「各抽各
      // 的」那一局不记码：那串码还原得了牌、还原不了他的目标。
      seed: seedRun && !seedRun.hideCode ? seedRun.code : undefined,
      seedSource: seedRun?.source,
      daily: seedRun?.source === 'daily' ? seedRun.daily : undefined,
      // 这一局按第几版**计分规则**打的（《侵蚀阶梯》v1.2 §6）。上面那两个各管一
      // 个玩法，这一个管全站——服务端照它收不收这一局（`api/scores.js` 只认现行
      // 那一版），旧客户端在途打完的局照常给他看结算页，只是不入榜。
      rules: SCORING_RULES_VERSION,
      // 结算页那几行（《侵蚀阶梯》v1.2 §5 的固定行序）。
      flips: flipsTotal,
      defused: defusedTotal,
      lines: lineCount,
      // 不乘步数系数的那三档（老虎机、步步为营、无限反转）**不写 par**：结算页
      // 照 par 在不在来决定摆不摆那一行。摆一行「×1.00」等于告诉玩家有这回事。
      par: usesStepCoef ? par : undefined,
      stepCoef,
      cleared,
      boardTiles: hooks.boardTiles,
      swept,
      unlockedOne,
      at: Date.now(),
    };

    refs.endHazardBgEl.classList.toggle('show', hazardEnd);
    // 结算弹窗的标题就是「综合得分」（10-08 方案 3-I 的设计图）：从前是「挑战结束」一行大字、底下
    // 再一行小字「综合得分」，设计图上只剩后者，站在标题的位置。
    refs.endTitleEl.textContent = s.compositeScoreLabel;
    // 总分一位一位滚上去（engine/odometer.ts）。局内那一套滚筒不动——两套数数
    // 系统不并存，这一套只管结算页和排行榜自己那一行。
    rollOdometer(refs.endScoreEl, total);
    // This run measured against this player's own history in this exact mode.
    // Read before the archive is written just below, so this run is counted
    // once — by hand — rather than twice.
    const past = loadRuns(hooks.bestKey);
    const avg = Math.round(
      (past.reduce((sum, r) => sum + (r.data?.totalScore ?? 0), 0) + total) / (past.length + 1),
    );
    // 「没进今日榜」那一句先藏起来：它属于上一局，这一局要不要说，等交卷回包（见下面 pushRun）。
    refs.endDailyNoteEl.hidden = true;
    refs.endDailyNoteEl.textContent = '';
    /**
     * 徽章那一排（《侵蚀阶梯》v1.2 §5：清盘、解锁 1 枚）。
     *
     * 一个都没有就整条不摆——摆一行空的等于告诉玩家「这儿本来该有东西」。
     */
    // 设计图（10-08 方案 3-I）上徽章站在分数右边，不再是明细底下一排——#endBadges 是抬头里单独
    // 的一格。
    const badges = runBadges(lastRun, hooks.lang);
    refs.endBadgesEl.innerHTML = badges.map((b) => `<span class="end-badge">${escHtml(b)}</span>`).join('');
    refs.endBreakdownEl.innerHTML =
      runBreakdown(lastRun, hooks.lang)
        .map(([label, value]) =>
          // 设计图上只有「综合分」那一行是粗的（拼出分和别的行一样细），所以那一行另挂一个类。
          `<div class="end-row${isSumRow(label, hooks.lang) ? (label === s.compositeLabel ? ' end-row--sum end-row--total' : ' end-row--sum') : ''}">` +
          `<span>${label}</span><span>${value}</span></div>`)
        .join('') +
      // 「该玩法您的均分」：设计图上是明细的最后一行（从前是分数底下单独一行大字，#endAvg）。
      // 整句一个格子，横跨两栏。
      `<div class="end-row end-row--avg"><span>${escHtml(`${s.avgScoreLabel} = ${avg}`)}</span></div>` +
      // 「综合分是怎么来的」摆在这儿，只摆头一回。
      //
      // 玩家 2026-09 定的：从前它在棋盘底下那块教学条上，和「这一局怎么结束」并成
      // 最后一步——可那是他正专心滑的时候，讲的却是结算页才用得着的知识，在他最忙
      // 的时候讲最不急的事。挪到这儿，上面那几行明细就是实物，指着实物讲。
      //
      // ⚠️ 用的是自己的键（endTipComposite），不再借教学那几条的下标。从前借的是
      // 第 6 条，而教学 2026-09 收成了五条——借下标的写法当场就指空了，屏幕上是一
      // 行空白，不报错。
      //
      // **只在真的乘了步数系数的那几档讲。** 这句话解释的是「综合分 = 拼出分 × 步数
      // 系数」，而不乘的那三档（老虎机、步步为营、无限反转）压根没有这一乘：上面那几
      // 行明细里连系数那一行都不摆（按 par 在不在判，理由见下面 lastRun 那段——「摆一
      // 行『×1.00』等于告诉玩家有这回事」）。注解比那一行更糟：那一行只是摆出一个不
      // 起作用的数，这一句是**讲一件这一局没发生的事**，而且就讲在「指着实物讲」的位
      // 置上——他照着往上看，明细里找不到那个系数。
      //
      // `usesStepCoef` 写在 `&&` 左边是要紧的：`shouldTeachTotal()` 一问就**记账**
      // （firstPlay 的 claimFirstTotalTip 调 markOpened），右边先跑的话这一次性的教学
      // 会白白烧在一局根本不显示它的反转局上，他从此再也看不到这句话。
      (usesStepCoef && hooks.shouldTeachTotal?.()
        ? `<div class="end-row end-row--tip"><span>${escHtml(s.endTipComposite)}</span></div>`
        : '');
    // 从前这儿写一行字（结束方式 · 共 N 步 · 用时 · 本机最佳）。现在那一行印
    // 在战绩图上，图本身摆到了它的位置——见 gameShell 的 #endShare。
    // 单局最快 on a room's closing card is read from here, the same way the
    // live standings read the score off the HUD's reel: the scoreboard takes
    // what is already on screen, and none of the eight boards has to know
    // that multiplayer exists.
    refs.endOverlay.dataset.seconds = String(Math.round(elapsed));
    // 交卷时报给房间的那个数。
    //
    // 打的过程中，比分板报的是 HUD 上那个**拼出分**——那会儿这一局还没走完，综合
    // 分并不存在（它要等「一共走了几步、清了几枚」都定下来才算得出来）。可一局
    // 结束之后再按拼出分排名次，就等于说「谁滑得多谁赢」：同一副牌上多滑几十步
    // 总能多拼出几分来。名次要认的是**综合分** ＝ 拼出分 × 步数系数
    // （《侵蚀阶梯》v1.2 §5）——少走一步才是这一局真正的本事。
    // 和上面那行秒数一样，放在这里是为了让 scoreboard 自己来取：每副棋盘谁也
    // 不用知道房间这回事。
    refs.endOverlay.dataset.total = String(total);
    // 终局的盘面，和照着它画出来的战绩图。
    //
    // 两件事都赶在结算页露面之前做完：图现在是结算页的一部分（玩家定的「整
    // 合分享和结算」），等页出来了再往里塞，这一屏会先空着一块、图落下来时
    // 整页跳一下。画一张图是几十毫秒的事，那一局刚打完的这一瞬间花得起。
    endSnapshot = hooks.snapshotBoard?.() ?? null;
    lastCardUrl = renderCard();
    if (lastCardUrl) refs.endShareImgEl.src = lastCardUrl;
    // 画不出来（理论上只有 lastRun 为空，走不到这儿）就整块不摆，别在结算页
    // 上留一个坏掉的图标和一句没着落的「长按保存」。
    //
    // 写成 setAttribute / removeAttribute 两句，不用 toggleAttribute：小红书那
    // 一版的底线是 Chrome 61，那个方法要到 69 才有，在这儿一喊就抛错——而这一
    // 行正卡在结算页露面之前，一抛错整页就不出来了（体检 check-oldkernel 逮到
    // 过一次）。
    const shareBox = refs.endShareImgEl.parentElement;
    if (shareBox) {
      if (lastCardUrl) shareBox.removeAttribute('hidden');
      else shareBox.setAttribute('hidden', '');
    }
    // 屋主中途散场、这一局转成单人打完的：把小屋那份摆在结算页最上面。平时
    // 什么也不做（见 roomLeftover.ts）——单人局的结算页一个字都不改样子。
    mountRoomLeftover(document.getElementById('endRoomBlock'), hooks.lang);
    refs.endOverlay.classList.add('show');
    // 头一局打完，替他指一下路：先让《分享》亮一阵，再换《首页》亮着不停。
    //
    // 结算页上摆着三颗键，他头一回看见，不知道哪一颗是「接着往下」。顺序是
    // 玩家定的——先分享（这一局的战绩此刻最值钱），再回主菜单。用的是全站同
    // 一套光（style.css 的 glow-pulse），贴着按钮自己的轮廓发。
    if (hooks.shouldLeadOut?.()) leadTheWayOut();
    // One cue per ending, told apart by cause: a bomb gets the refusal, every
    // other way of finishing gets the settle. Reached the same way whether the
    // player pressed 结束, ran the clock out, or hit a dead end.
    if (hazardEnd) playError();
    else playSettle();
    // 真通关那一枚章。顺序是刻意的：**分数先落定，再盖章**——读出来是「这一局
    // 值这么多分 → 而且是通关」，一件事接着另一件。同时出现的话两样东西抢同一
    // 眼，谁也没看清。
    stampEndCheck(reason, total);

    // Archive the run so the 记录 panel can re-open the very same card.
    saveRun(hooks.bestKey, { at: lastRun.at, data: lastRun, start: startSnapshot, end: endSnapshot });
    // 登录了就顺手往云上报一份：换台设备记录跟着回来，成绩也进全球榜。
    // 不 await——结算页已经在屏幕上了，没有理由让刚打完的人等一个请求；
    // 报不上去最多是这一局没上榜，本机那份存档一个字都不受影响。
    //
    // 每日挑战那一局：服务器回包里说它进没进「今日」榜（2026-10-08 方案 2-11）。被拒、交晚了，
    // 从前一个字都不说——玩家以为上榜了，去榜上一看没有。说一句明话，带上「看看设备的日期」：
    // 日子和种子都是按本机的钟算的，钟不对就是这两种。回包到的时候他要是已经开了下一局（这一局
    // 不再是 lastRun），就不说了——不然这一句会挂到下一局的结算页上。
    const settledRun = lastRun;
    void pushRun(lastRun).then((reply) => {
      const verdict = reply?.daily;
      if ((verdict !== 'late' && verdict !== 'rejected') || lastRun !== settledRun) return;
      refs.endDailyNoteEl.textContent = s.dailyNotCounted;
      refs.endDailyNoteEl.hidden = false;
    });
    // The reason key is one of our own fixed strings, never player text.
    trackGameEnd({
      shape: hooks.shapeId,
      mode: hooks.modeKey,
      score: total,
      moves,
      seconds: elapsed,
      reason,
      hazard: hazardEnd,
    });
  }

  /**
   * 这一局的战绩图。没有 lastRun 就画不出来（还没打完），返回 null。
   *
   * 一局只画一次：结算页露面之前画好（endGame），《分享》那一窗直接拿这一
   * 张。同一局两处两张图会不一致——名次是现取的（roundStandings），中间要是
   * 又轮询回来一次，两张图上的排名就能对不上。
   */
  function renderCard(): string | null {
    if (!lastRun) return null;
    return renderShareCard(
      {
        ...buildShareInfo(lastRun, hooks.shapeName, hooks.lang),
        standings: roundStandings(),
        room: !!currentRoom(),
      },
      endSnapshot,
      startSnapshot,
    );
  }

  function doShare() {
    // 图在结算页上已经有一张了；这一窗是把它放大了看（和小红书版那两颗原生
    // 键的落脚处）。所以这儿不重画，用刚才那一张。
    const dataUrl = lastCardUrl ?? renderCard();
    if (!dataUrl) return;
    trackShare('end_modal');
    refs.shareImageEl.src = dataUrl;
    refs.shareOverlay.classList.add('show');
  }

  // A chain reaction is revealed one beat at a time instead of jumping
  // straight to its end state: each match wave is highlighted while its
  // tiles still show their pre-match face, held for HIGHLIGHT_LEAD_MS, then
  // flipped — so causality stays visible ("this is what matched" before
  // "now it's flipped") — with a further pause before checking whether that
  // flip triggered another wave. A whole-line bonus's cells are already
  // dot-faced by definition (see isFullDotMatch), so it only needs the
  // shorter gap, not a highlight-then-flip beat of its own.
  // Reads a scored cell's *actual* rendered position straight off its own
  // DOM element (every shape already tags its tiles with data-r/data-c) —
  // gameController has no idea how any particular shape maps (r, c) to
  // pixels, but it doesn't need to: the element that's already on screen
  // knows. Returns board-local center coordinates, or null if the cell
  // isn't currently rendered (e.g. a shape that hides removed cells).
  function cellCenterPx([r, c]: Cell): [number, number] | null {
    const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (!el) return null;
    const board = refs.boardEl.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return [box.left - board.left + box.width / 2, box.top - board.top + box.height / 2];
  }

  /**
   * The room this run belonged to, as of the last poll — empty for a solo
   * run, which is what leaves the card exactly as it was.
   *
   * The scores come from the standings the player was already watching in
   * the corner, so the card cannot disagree with the panel it replaces.
   */
  function roundStandings(): Standing[] | undefined {
    const state = latestRoomState();
    const seat = currentRoom();
    if (!state || !seat || state.players.length < 2) return undefined;
    return [...state.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ name: p.name, score: p.score, me: p.id === seat.playerId }));
  }

  const accent2Color = () => getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#5C8A72';

  /**
   * 「大时刻」那一套：两下震动、滴落声、重震、一大把二号强调色的粒子。
   *
   * 整线消除那一拍一直是这么庆祝的；1×1 解锁那一下也走它（10-08 方案 3-A：「复用现有星星
   * 结算庆祝通道，不新开动画所有权」）。两处说的是同一种分量的事——一条线整个化掉、图案
   * 缩到只剩一枚——长得就该一样；各写一份的话，下回调其中一处，另一处就悄悄走样。
   * 粒子从 `originCell` 那一格冒出来，那一格不在屏幕上就只有声、震、晃。
   */
  function bigMoment(originCell: Cell | undefined): void {
    vibrate([25, 40, 25]);
    playClear();
    screenShake(refs.boardWrap, 'heavy');
    const pos = originCell ? cellCenterPx(originCell) : null;
    if (pos) spawnParticles(refs.boardEl, pos[0], pos[1], { color: accent2Color(), count: 16, spread: 64 });
  }

  /**
   * Plays out whatever is left of the current reveal immediately.
   *
   * The reveal is a chain of timed beats — hold the highlight, turn the
   * planks, pause, look for the next step — and the board refuses input for
   * all of it, which for a scoring move is well over a second. A player who
   * slides one line and reaches straight for the next was losing that second
   * move to an animation. So a fresh touch runs the remaining beats now
   * rather than turning the touch away: every step still happens, in order,
   * with the same scores and the same end state — it just doesn't wait. The
   * planks still in the air are torn down by the renders that follow, which
   * is what a chained step already did to them.
   */
  function hurry(): void {
    // The loop is bounded because each beat either schedules exactly one
    // more or finishes the cascade; the cap is only a guard against a beat
    // that somehow re-arms itself forever.
    for (let guard = 0; resolving && pendingBeat && guard < 400; guard++) {
      const beat = pendingBeat;
      pendingBeat = null;
      window.clearTimeout(beat.id);
      beat.run();
    }
  }

  function resolveMove(mask: Set<string>, moveDirDeg = 0) {
    if (gameOver || paused || resolving) return;
    moves++;
    resolving = true;
    // 教学的呼吸灯：这一步结算期间熄着，结算完（finish）再按新盘面点——亮着的那几枚多半
    // 正要翻面或者挪地方，灯跟着它们走一路只会添乱。
    if (coach) hooks.coachGlow?.(null);
    // 同上：撤掉，不是置空。
    cancelBeat();
    heldBeat = null;
    /** The next beat of the reveal, held so hurry() can bring it forward. */
    const beat = armBeat;
    vibrate(8); // a light tick confirming the drag itself landed, win or not

    flipLedger?.beginMove(moves);
    const cascade = hooks.buildCascadeConfig();
    const stepper = createCascadeStepper(
      cascade,
      mask,
      { pattern: s.labelPattern, line: s.labelWholeLine },
      flipLedger ?? undefined,
    );
    /*
     * 跨步连击和同一步之内的连锁倍率**都退役了**（《侵蚀阶梯》v1.2 §1.5：「拼出
     * 分 = 翻面分（含拆除）+ 削线分，无任何过程系数」）。无限反转不受影响，它走自己
     * 的 1.5ⁿ（scoring.ts 的 flipStreakDelta）。
     *
     * 退役之后这儿还留过两个恒为 1 的因子（multiplier、comboMult）和一个恒为 1 的连锁
     * 系数，理由是「底下十几处在读它们，也留得住这一步是连锁第几拍」——可系数是 1，
     * comboMult 从来长不大，「第几拍」其实一直没留住：读它的那几处（连锁那一档的震动、
     * 粒子、顿帧、音量）只有最低一档在跑。10-08 方案第五批第 4 条先在 check-scoring 第 6 节
     * 证明它们恒为 1，再删掉；行为一个字没变。
     */
    let totalRaw = 0;
    let moveWeight = 0;
    /**
     * 这一步的连锁里有没有整线奖励（步步为营的「消边」判据）。
     *
     * 判的是 step.lineBonusGroups.length > 0。今天它是「整行／整列消除」，
     * 《外边消除》那套规则落地之后它自动变成「消掉此刻的最外边」——同一个字段，
     * 这儿一个字都不用改。
     */
    let hadLineBonus = false;
    /** 走这一步之前手里还剩几步，用来算气泡上那个增量。 */
    const beforeLeft = bank?.left() ?? 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const HIGHLIGHT_LEAD_MS = reduceMotion ? 0 : 550;
    const STEP_GAP_MS = reduceMotion ? 0 : 350;
    // A bonus step's own removal/fade animation (square's collapse, or
    // triangle's fade-to-hole) runs well past this gap on its own timeline —
    // if a further chained step fires while it's still mid-flight, that
    // step's own render() would cut the tail of it short (harmless to the
    // data, since the removal itself already landed, but visibly abrupt).
    // A longer pause specifically after a bonus step gives it room to
    // finish before the next step's render() could touch it.
    const BONUS_GAP_MS = reduceMotion ? 0 : 1250;

    const finish = () => {
      // Guarantees at least one render() even when the cascade found nothing
      // to reveal (a shift that didn't score) — every earlier return path
      // out of step() already rendered at least once on its own.
      if (!totalRaw) hooks.render();
      if (!totalRaw) flipChain = 0;
      perf.onMove(moveWeight);
      if (gameOver) {
        resolving = false;
        return;
      }
      /**
       * **先记账，再判这一局到没到头。**
       *
       * 这一步真的走了——不管它之后盘面是清空了、炸掉了，还是步数正好见底。所以
       * 账要先记上：`spend` 是「走了一步」这件事唯一的记录处，结算页那几行、分享
       * 卡、记录页读的都是它。
       *
       * ⚠️ **从前它排在 isGameOver 后面，于是清盘那一局的最后一步整步漏掉**：把盘
       * 面打到一枚不剩的那一下不计入「走了 N 步」，结算页和分享卡一起少一步。少的
       * 偏偏是最漂亮的那一局——打到清盘的人才会遇上。屏幕上什么都不报，数字看着也
       * 像那么回事。
       *
       * **只是记账挪了位置，哪种结局优先一个字没动**：炸弹 > 盘面清空 > 步数见底。
       * 这个次序是玩家定的——「盘面真的走完了就该报『都消完了』，不该报『步数用完
       * 了』」，后者会让他以为自己输了，而他其实是赢到了头。所以下面三个 if 的先
       * 后仍然照旧，`left <= 0` 排在最后。
       */
      let left = -1;
      if (bank) {
        left = bank.spend(totalRaw > 0, { edge: hadLineBonus });
        paintSteps(left);
        // 退回来了几步 = 现在剩的 − 走之前剩的 + 那一步的成本。要的是「退了几
        // 步」而不是净变化：孤立得分净变化是 0，可屏幕上必须看得见「付了 1、
        // 退回 1」——那正是这一局要教的那句话（见 stepLedgerText）。
        bumpSteps(Math.max(0, left - beforeLeft + PUZZLE_STEP_COST));
      }
      // 炸弹四连炸在**这一步结束时**的盘面上判（见 checkHazard 上面那段）。
      // 排在 isGameOver 前面：被炸掉的那一局不该同时报「盘面清空了」。
      if (hooks.checkHazard?.()) {
        resolving = false;
        return;
      }
      if (hooks.isGameOver()) {
        resolving = false;
        // 这个字符串是**存档里的那一个**（见 runRecord 的 REASON_LABEL_KEY）：它的
        // 名字是星星消除上线之前留下的（那时候终局是「全翻成星星」），现在这条路
        // 的意思是「一枚不剩」。名字没改，因为玩家早先的记录里存的就是它。
        endGame(ALL_FLIPPED_REASON);
        return;
      }
      if (bank && left <= 0) {
        resolving = false;
        endGame(PUZZLE_STEPS_OUT_REASON);
        return;
      }
      updateStuckState(hooks.findStuckGroups?.() ?? []);
      resolving = false;
      // 教学条（第 15 推）：一步结算完，看一眼盘面——第 3、4 条等的都是盘面上的事。看完重算
      // 呼吸灯（这一步之前熄掉的，见 resolveMove 开头）。
      if (coach) {
        coach.observe({ segLeft: erosion.segLeft(), starsReachEdge: hooks.coachStarsReachEdge?.() ?? false });
        refreshCoachGlow();
      }
    };

    const step = () => {
      if (gameOver) return; // a manual "结束" click mid-chain stops the reveal where it is
      const s = stepper.next();
      if (!s) {
        finish();
        return;
      }
      totalRaw += s.points;
      moveWeight += s.weight;
      // 无限反转：连续第 n 次得分 = 单次得分 × 1.5^(n−1)，每次四舍五入（分数必须是整
      // 数：「184.5」不是该给玩家看的分，数字滚轮也画不出小数点，见 scoreReel.setValue）；
      // 同一步里的连锁也各算一次。别的玩法没有任何过程系数，加的就是这一拍的原始分。
      const delta = hooks.flip ? flipStreakDelta(s.points, flipChain) : s.points;
      /**
       * 加分气泡上印的那个倍率——这一步真正用的那一个。
       *
       * 无限反转走的是另一套公式（1.5^(n−1)，见 scoring.ts 的
       * flipStreakDelta），可气泡上从前印的一直是基础玩法那两个因子
       * （multiplier × tierComboMult），而这一局里它们一个都没参与计算。于是
       * 屏幕上的数字和跳动的分数对不上：一个 4 分的图案连续第 3 次得分实际加
       * 9 分，气泡却写「×2」（照它算该是 8）；第 5 次实际加 20，气泡写「×3」。
       * 玩家盯着倍率心算，永远算不出屏幕上那个数。
       *
       * 在这里算、而不是在下面 proceed 里：flipChain 下一行就自增了，到那时
       * 已经是**下一次**的连击数。
       */
      //
      // 倍率从 scoring.ts 的 flipStreakMult 拿（第 14 推）：原先这儿自己算 `1.5 ** flipChain`，
      // 没套 FLIP_STREAK_CAP——连击过了十次，加分已经封顶，气泡上的倍率还在往上翻。
      const shownMult = hooks.flip ? flipStreakMult(flipChain) : 1;
      if (hooks.flip) flipChain++;
      // Split for the end-of-run breakdown: the pattern's own points, the
      // whole-line bonus, and everything the streak/chain multipliers added.
      if (s.lineBonusGroups.length) linePoints += s.points;
      else patternPoints += s.points;
      lineCount += s.lineBonusGroups.length;
      // 步步为营的「消边」：一步引发的连锁里**任意一拍**是整线奖励就算，所以
      // 这儿只置真、不置假（后面的拍子没消线，不该把前面那一拍的功劳抹掉）。
      if (s.lineBonusGroups.length) hadLineBonus = true;
      comboBonusPoints += delta - s.points;
      const isBonus = s.lineBonusGroups.length > 0;
      const groups: CascadeStepGroups = { matchGroups: s.matchGroups, lineBonusGroups: s.lineBonusGroups };
      // 教学第 5 条等的就是这一下：第一次真的消掉一条外边（第 15 推）。条子只记下，等这一
      // 步结算完（finish 里的 observe）才换条——别抢在消除动画前面。
      if (isBonus) coach?.signal('line');
      // A bonus (the whole-line, 36-point event) gets its own distinct
      // double-pulse — it's the bigger moment — while an ordinary match gets
      // one light buzz, right as its highlight appears.
      // A whole-line clear is its own event, not a louder score: the line is
      // draining off the board, so it gets the falling droplet rather than
      // the scoring bell. That whole package lives in bigMoment (the 1×1
      // unlock uses it too).
      if (isBonus) bigMoment(s.lineBonusGroups[0]?.[0]);
      else {
        vibrate(15);
        // An ordinary match only gets a tone — shake and particles are
        // reserved for the bonus (bigMoment above), so they stay a "big
        // moment" signal instead of firing on every score. 连锁第几拍那一档的
        // 震动和粒子从倍率退役起就没再跑过（comboMult 恒为 1），随它一起删了。
        playScore(1);
      }

      hooks.onCascadeStep?.(groups);
      hooks.render();
      hooks.onCascadeStepRendered?.(groups);

      // A brief extra hold right at the moment of impact — hit-stop — for
      // the bonus: nothing animates differently, the reveal just visibly
      // catches for a beat before continuing.
      const hitStopMs = reduceMotion ? 0 : isBonus ? 70 : 0;

      const proceed = () => {
        // The flip is the splash's plank turn, driven from here for every
        // shape: snapshot the old faces while they are still on screen,
        // let commit + render swap the data and paint the new ones, then
        // turn old into new piece by piece. The roll axis follows the move
        // that caused this score — a flourish in the air only; the landing
        // pose never depends on it (see plankFlip.ts).
        const flipCells = s.matchGroups.flat();
        const faceSnaps = flipCells.length ? snapFlipFaces(refs.boardEl, flipCells) : null;
        const committed = s.commit();
        /**
         * 棋盘顺手拆掉的炸弹：**拆除那一下按一次翻面计**（§1.3），所以既要补
         * +2/枚，也要一起扣段。它们不在这一拍报出去的 points 里（afterCommit 要
         * 等 commit 才跑），所以在这儿按差额补。
         * 无限反转没有炸弹局，也不按翻面计分，所以那一局这儿恒 0。
         */
        const defused = Math.max(0, committed - s.flips);
        if (defused > 0 && !hooks.flip) {
          const bombPoints = POINTS_PER_FLIP * defused;
          score += bombPoints;
          totalRaw += bombPoints;
          patternPoints += bombPoints;
          scoreReel.setValue(score);
        }
        // 结算页那一行要的两个数：这一局一共翻了几枚、其中拆弹占几枚。
        flipsTotal += committed;
        defusedTotal += defused;
        // 这一拍翻了几枚，侵蚀就扣几段（整线消除那一拍是 0）。降级了就重画一遍
        // 棋盘：图案变小之后能凑成的组跟着变，棋盘上那几处提示也要跟着换。
        if (committed > 0) {
          const step = erosion.spend(committed);
          if (step.dropped > 0) {
            /*
             * 降级了：下一拍**全盘**按新图案重找（10-09 补充方案 6-3）。盘上可能早就摆着一组现成的
             * 新图案（比如一组 1×3），它不在这一步动过的格子上，照遮罩找不到——从前它得等哪天谁碰
             * 巧滑到它才给分。降到 1 枚时，场上剩下的每一枚色块单独就是一组，这一拍把它们全部翻掉。
             * 都算这一步的连锁拍：分数、连锁、步步为营的退步一概照连锁算。
             */
            stepper.rescanAll();
            hooks.onErosion?.(step.level);
            // 教学第 3 条「剩下的段数 ≤ 4」可能在一步之内整个被跨过去（一步翻了八枚，降级
            // 之后新的一级是满格）——结算之后再看段数就看不出来了，所以降级这一下单报一声。
            coach?.signal('erosion');
            // 1×1 解锁的那一下：主动说一声（10-08 方案 3-A）。二版里 1×1 是真打的一段，到
            // 这儿不再意味着盘已翻完——这一下得让人知道「现在一枚就够了」，不能只靠右上角
            // 那一块闪两下。只响一次：级数在一局里只降不升，unlockedOne 记着这一局响过没有。
            if (step.level === 1 && !unlockedOne) bigMoment(s.matchGroups[0]?.[0]);
          }
          if (step.unlocked) unlockedOne = true;
          // 每翻一枚都要重画：段熄一格、末位那枚跟着再淡一点。降级那一下由
          // patternBlock 自己认出来（它记着上次画的是几枚）并闪一下。
          paintPattern();
        }
        // commit() is what actually turns the matched pieces over — a bonus
        // step's commit is a no-op, so this is exactly the flip moment.
        if (s.matchGroups.length) playFlip();
        if (s.matchGroups.length) hooks.onCommit?.(s.matchGroups);
        if (delta > 0) {
          score += delta;
          // 步步为营：分数在局中**整个不露面**（那一格印的是破折号，见
          // gameShell 的 score-cell--hold），结算页才揭晓。
          //
          // 玩家报的原话是「得分现在还是加分不是加步数」。只要屏幕上还有一个数
          // 在涨，这一局的回报就被读成了分数——而它真正换来的是步数。先前这儿
          // 印的是「此刻这副盘面值多少分」，本意是别让人盯着原始分，可玩家分辨
          // 不出这两种数，看到的一样是「得分 +27」。
          //
          // 所以这一拍什么都不印（连那下轻弹也搬走了）。这一步换到了几步，等
          // 盘面落定之后在《余步》那一格上说——见 finish() 里的 bumpSteps。
          if (!hooks.puzzle) {
            // shownMult 是这一步实打实用的那个因子（两种玩法各一套，见上面）。
            // 1.5^n 会长出一串小数（3.375、5.0625……），印一位就够——气泡是拿
            // 来说「越连越多」的，不是拿来对账的。
            const mult = Math.round(shownMult * 10) / 10;
            scoreReel.showGain(delta, mult > 1 ? `${s.label} ×${mult % 1 ? mult.toFixed(1) : mult}` : s.label);
            scoreReel.setValue(score);
            punch(refs.scoreReelEl);
          }
        }
        // Only a match step's commit() actually changes anything (the
        // flip) — a bonus step's commit() is a no-op (its cells were
        // already dot-faced and, for a shape whose bonus removes cells,
        // already gone from the grid by the time next() returned it), so
        // re-rendering here would serve no purpose except wiping out the
        // ghost/collapse elements onCascadeStepRendered just appended for
        // it, before a single frame of them ever painted.
        if (s.matchGroups.length) hooks.render();
        if (faceSnaps?.size) plankFlipCells(refs.boardEl, flipCells, faceSnaps, moveDirDeg);
        // A chained step's own render() would tear the planks down mid-turn,
        // so the gap after a flip stretches to let the last piece finish —
        // the splash holds for its flips the same way.
        // 让位给翻面的那一段，和动画本身走同一个时长——玩家把翻面调慢之后，
        // 这里要是还按设计时长等，下一拍就会把翻到一半的牌拆掉。
        const flipRoomMs = faceSnaps?.size
          ? (flipCells.length - 1) * flipStaggerMs() + flipMs() + 80
          : 0;
        beat(step, Math.max(s.lineBonusGroups.length ? BONUS_GAP_MS : STEP_GAP_MS, flipRoomMs) + hitStopMs);
      };
      if (s.matchGroups.length) beat(proceed, HIGHLIGHT_LEAD_MS + hitStopMs);
      else proceed();
    };
    step();
  }

  function doPause() {
    if (!started || gameOver || paused) return;
    paused = true;
    timer.pause();
    // 连锁也一起停：遮罩盖上之后，翻面、加分、判死局都不该在背后继续跑
    // （见 heldBeat）。
    holdBeat();
    // 开局倒数那一屏借的是同一层面板，那时候「再来一局 / 结束游戏」无从谈
    // 起，所以那条路上挂了 .pause--pre 把它们藏起来（见 gameShell 的
    // #startPauseBtn）。现在是真的在打了，摘掉。写在这儿而不是那颗《暂停》
    // 的监听里：切到后台自动暂停走的也是这条路，不经过任何按钮。
    refs.pauseOverlay.classList.remove('pause--pre');
    refs.pauseOverlay.classList.add('show');
    hintHowToOnce();
  }

  /**
   * 头一回按下暂停：让《怎么玩》那一行描一次呼吸的边。
   *
   * 那一屏是全站唯一「打到一半还能把规则再看一遍」的地方，可它和下面那条色
   * 盲开关长得一模一样——不点一下，新玩家没有任何理由知道它通向五条规则。
   * 巡检的原话是「不要假设玩家会自己发现」。
   *
   * 一次就一次（firstPlay.ts 的 claimFirstHowToHint 记在本机），而且写在这
   * 儿而不是那颗《暂停》的监听里：切到后台自动暂停走的也是这条路，不经过任
   * 何按钮。动画自己播完就把类摘掉，省得它一直挂在 DOM 上。
   */
  function hintHowToOnce() {
    const btn = refs.pauseOverlay.querySelector<HTMLElement>('#howBtn');
    if (!btn || !claimFirstHowToHint()) return;
    btn.classList.add('pause-switch--hint');
    btn.addEventListener(
      'animationend',
      () => btn.classList.remove('pause-switch--hint'),
      { once: true },
    );
  }

  function doResume() {
    if (!paused) return;
    paused = false;
    timer.resume();
    refs.pauseOverlay.classList.remove('show');
    // 停下时还剩多少毫秒，就接着数多少——连锁从他离开的那一拍往下走。
    const held = heldBeat;
    heldBeat = null;
    if (held && resolving && !gameOver) armBeat(held.run, held.ms);
  }

  function doFinish() {
    if (!started || gameOver) return;
    endGame(MANUAL_END_REASON);
  }

  function doForceEnd(reason: string, penalty = 0, penaltyLabel?: string) {
    if (!started || gameOver) return;
    endGame(reason, penalty, penaltyLabel);
  }

  refs.buttons.start.addEventListener('click', () => {
    // 开局这颗键现在有两个人会按：开局页倒数完自己按下去，多人局则由房间那边
    // 统一按。按第二下就是把已经在打的这一局重发一次，所以只认第一下。
    if (started) return;
    started = true;
    if (!hooks.practice) trackGameStart(hooks.shapeId, hooks.modeKey);
    refs.startOverlay.classList.remove('show');
    newGame();
  });
  refs.buttons.restart.addEventListener('click', () => {
    // 《再来一局》也是开一局，也要报一条 game_start。
    //
    // 从前这儿是直接 newGame，整条埋点被绕过去了，坏的是两件事：重开的那些
    // 局在后台只有 game_end、没有对应的 game_start（「哪个玩法最受欢迎」因此
    // 少数了一大截）；而且 first 这个标记是在 trackGameStart 里定的，不再报
    // 就不再重算，于是第二局、第三局的 game_end 仍然带着 first: true。一个新
    // 玩家打完第一局接着连打两局——最平常不过的操作，不用刷新也不用离开页面
    // ——后台算出来的「首局完成率」就会超过 100%，一个不可能出现的数。
    //
    // 埋在这儿而不是埋进 newGame：newGame 还有一条练习盘的路（endGame 里那
    // 一句），那种盘本来就不上报。
    if (!hooks.practice) trackGameStart(hooks.shapeId, hooks.modeKey);
    newGame();
  });
  // 多人局里没有这颗键——一场同步竞赛暂停不了，那个位置让给了《离开房间》。
  refs.buttons.stop?.addEventListener('click', doPause);
  refs.buttons.continueBtn.addEventListener('click', doResume);
  // A run now ends in exactly two ways, and both are unambiguous: the player
  // presses 结束, or the board itself runs out (every tile turned, or no
  // face-up tile can ever be flipped). Nothing else can navigate away from a
  // game any more — the bottom dock is hidden while one is open — so there
  // is nothing left for a yes/no gate to protect against.
  //
  // 这颗键有两处：小屋局在底排上（那一排还留着《完成》），单人局在暂停面板里
  // （《结束游戏》——玩家定的「把游戏界面中的暂停和完成全部放在暂停里」）。两
  // 处接的是同一个处理函数，行为一字不差。
  const onFinishPressed = () => {
    if (!started || gameOver) return;
    // 单人局按下去就是结束——这一局是自己的，没有别人在等。
    if (!currentRoom()) return doFinish();
    // 房间局先问一句：交出去的分数就是名次，按错一下没得反悔。问的这几秒钟
    // 停着、牌也盖上（那一层是 opaque 的），所以犹豫既不吃时间系数，也不能
    // 顺便多看几眼盘面。
    confirmFinish(hooks.lang, {
      onHold: () => {
        paused = true;
        timer.pause();
      },
      onResume: () => {
        paused = false;
        timer.resume();
      },
      onFinish: () => {
        paused = false;
        timer.resume();
        doFinish();
      },
    });
  };
  refs.buttons.finish?.addEventListener('click', onFinishPressed);
  refs.buttons.pauseFinish.addEventListener('click', onFinishPressed);
  // 暂停面板里的《再来一局》：丢掉这一局原地重开。先问一句——它紧挨着《结束
  // 游戏》，按错一下这一局的分就没了，而这一步退不回来（见 confirmRestart）。
  // 答「是」之后 newGame() 自己会把暂停那一层撤掉、把表重新起头。
  refs.buttons.pauseRestart.addEventListener('click', () => {
    if (!started || gameOver) return;
    confirmRestart(hooks.lang, newGame);
  });
  refs.buttons.share.addEventListener('click', doShare);
  refs.buttons.shareClose.addEventListener('click', () => refs.shareOverlay.classList.remove('show'));

  /**
   * 手机 / 浏览器的返回键在这一局里做什么（见 backNav.ts）：分享图开着先关它；开局
   * 页（含 4-3-2-1）等同那颗《返回》；结算页等同《主页》（小屋局里 scoreboard 把它
   * 换成了回小屋 / 挑下一局）；小屋局等同《离开小屋》（会先问一句）；单人局打着
   * 就暂停、暂停着就继续——和手机游戏里「返回 = 暂停菜单的开关」一个习惯。这一
   * 局不因为返回键而丢掉：想结束走《完成》。
   */
  function backFromGame() {
    if (refs.shareOverlay.classList.contains('show')) {
      refs.shareOverlay.classList.remove('show');
      return;
    }
    if (!started) {
      refs.buttons.startBack.click();
      return;
    }
    if (gameOver) {
      // 按 id 找而不用 refs.buttons.endBack：小屋局里 scoreboard 把这颗键整个换过。
      refs.endOverlay.querySelector<HTMLButtonElement>('#endBackBtn')?.click();
      return;
    }
    const leave = refs.buttons.leaveRoom;
    if (leave && leave.isConnected && !leave.hidden) {
      leave.click();
      return;
    }
    if (paused) doResume();
    else doPause();
  }
  // 练习盘不接：它只是等待页上的一块，那一屏的返回归小屋页管。
  if (!hooks.practice) setScreenBack(backFromGame);

  /**
   * 页面被切到背后（iOS 上侧滑回桌面、切去别的 App、锁屏）：单人局立刻暂停。
   *
   * 表停在切走的那一刻，回来看到的是暂停页、按《继续》接着打——和手机游戏一
   * 个习惯。不停的话，秒表在背后一直走：计时局回来已经结束，普通局的用时系数
   * 白白掉下去，而玩家什么都没做错。
   *
   * 小屋局不停：一场同步竞赛，别人的钟不会跟着停（那一局本来就没有《暂停》）。
   * 练习盘也不停，它不结算。
   */
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') return;
    if (!started || gameOver || paused || hooks.practice || currentRoom()) return;
    doPause();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get score() {
      return score;
    },
    get moves() {
      return moves;
    },
    get started() {
      return started;
    },
    get paused() {
      return paused;
    },
    get gameOver() {
      return gameOver;
    },
    hurry,
    get resolving() {
      return resolving;
    },
    restart: newGame,
    pause: doPause,
    resume: doResume,
    finish: doFinish,
    resolveMove,
    matchLen: () => erosion.level(),
    erosionView: () => ({
      level: erosion.level(),
      segLeft: erosion.segLeft(),
      segTotal: erosion.segTotal(),
      unlocked: erosion.unlocked(),
      par: erosion.par(),
    }),
    forceEnd: doForceEnd,
    destroy() {
      timer.stop();
      window.clearTimeout(stuckTimer);
      stuckTimer = 0;
      stopFrameWatch();
      patternBlock.destroy();
      coach?.destroy();
      coach = null;
      window.clearTimeout(glowRetryTimer);
      coachTip?.destroy();
      stopLeading();
      coachTip = null;
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
