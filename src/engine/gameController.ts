import type { ShellRefs } from '../ui/gameShell';
import { snapFlipFaces, plankFlipCells, flipMs, flipStaggerMs } from './plankFlip';
import { createTimer, formatClock } from './timer';
import { createStreakTracker, createCascadeStepper, flipStreakDelta, type CascadeConfig } from './scoring';
import { createScoreReel } from './scoreReel';
import { saveBestIfHigher, saveRun, loadRuns } from './persistence';
import { trackGameStart, trackGameEnd, trackShare } from './analytics';
import {
  MANUAL_END_REASON,
  buildShareInfo,
  runBreakdown,
  runDetailLine,
  type ModeKey,
  type RunData,
} from './runRecord';
import { createPerformanceGauge } from './performance';
import { vibrate } from './haptics';
import { renderShareCard, type BoardSnapshot, type Standing } from './shareCard';
import { currentRoom, latestRoomState } from './room';
import { leaderboardName, pushRun } from './cloudScores';
import { confirmFinish } from '../ui/roomNotices';
import { setScreenBack } from './backNav';
import { playScore, playFlip, playClear, playError, playSettle, screenShake, spawnParticles, punch, type ShakeTier } from './juice';
import { BOMB_HAZARD_REASON } from './bomb';
import { STRINGS, type Lang } from '../i18n';
import type { Cell } from './types';

export interface CascadeStepGroups {
  matchGroups: Cell[][];
  lineBonusGroups: Cell[][];
}

/**
 * The composite end-of-run score: the raw score times a continuous
 * time-elapsed coefficient, times 1 + the 有效得分率 hit rate (a 100% rate
 * doubles it, a 0% rate leaves it alone), and finally scaled down by 0.95
 * for every tile still showing its front face when the run ended — whether
 * it was provably impossible to flip or simply never got there. Multiplying
 * rather than subtracting keeps a big score from being wiped out by a board
 * the player never had time to finish, while still making "leave nothing
 * unflipped" the way to a top score.
 */
/**
 * A continuous time coefficient rather than the old brackets: 2× at the
 * first move, sliding down to a 0.5× floor over ten minutes. A bracket
 * boundary used to make one extra second cost a quarter of the score, which
 * rewarded quitting at 59s over playing on.
 *
 * `gain` 是这根杠杆的长度：1 就是上面这条曲线本身，现在单人和小屋都用 TIME_GAIN。
 * 放大在夹紧之后做，所以无论多大的 gain，曲线都还是单调的一条——用时多一秒
 * 绝不会反而变得更划算。
 */
export function timeMultiplierFor(elapsedSec: number, gain = TIME_GAIN): number {
  const t = Math.max(0, elapsedSec);
  // 五分钟以内：从 2 直线落到 1。五分钟之后不再直线往下掉，改成越掉越慢，
  // 慢慢贴向 0.5——曲线在五分钟那一点是接上的（同样的斜率），所以没有一个
  // 「过了五分钟忽然变陡／变缓」的拐点。
  const base = t <= 300 ? 2 - t / 300 : 0.5 + 0.5 * Math.exp(-(t - 300) / 150);
  return 1 + gain * (base - 1);
}
/**
 * 时间说话的分量：离 1 有多远，放大一倍半。单人和小屋同一条规矩。
 *
 * 这个数原来只给小屋用（单人是 1），理由是单人慢一点想清楚是正当打法。玩家
 * 后来定的是两边统一按小屋这一套算——一方面同一份成绩要进同一张榜，两套系
 * 数就是两把尺子；另一方面五分钟之后的那一段改缓了（见上面），慢的那头不再
 * 一下子掉到底。
 *
 * 数出来是：秒杀 2.5，两分半 1.75，五分钟 1，七分半 0.53，十分钟 0.35，再往
 * 后慢慢贴向 0.25——而不是原来的七分半就到 0.25。
 */
export const TIME_GAIN = 1.5;

/** Each tile left un-flipped when the run ends scales the composite by this. */
const UNFLIPPED_SCALE = 0.95;
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
  /**
   * 无限反转（见 ShapeGameOpts.flip）。这一局的计分和别的局不同：
   *   · 没有用时系数——综合得分里那一项恒为 1；
   *   · 连击不再是 ×1 / 1.5 / 2 / 2.5 加同一步里 ×3 的连锁，而是连续第 n 次
   *     得分 = 单次得分 × 1.2^(n−1)，每次四舍五入取整（4 → 4.8≈5 → 5.76≈6 …）；
   *     一步没得分就从头数。
   */
  flip?: boolean;
  /** (Re)builds the shape's internal grid for a fresh game. */
  resetBoard(): void;
  /** Repaints the board from current state. */
  render(): void;
  /** True the instant the current state should end the run. */
  isGameOver(): boolean;
  /** Builds the cascade config for resolving one confirmed move. */
  buildCascadeConfig(): CascadeConfig;
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
  findStuckGroups?(clearedDotColors: ReadonlySet<number>): Cell[][];
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
export function createGameController(refs: ShellRefs, hooks: GameControllerHooks): GameController {
  const s = STRINGS[hooks.lang];

  const scoreReel = createScoreReel(refs.scoreReelEl, refs.gainBadgeEl);
  const perf = createPerformanceGauge();
  const timer = createTimer((sec) => {
    if (hooks.timeLimitSec !== undefined) {
      const remaining = Math.max(0, hooks.timeLimitSec - sec);
      refs.hudTimeEl.textContent = formatClock(remaining);
      if (remaining <= 0 && !gameOver) endGame('时间到');
      return;
    }
    refs.hudTimeEl.textContent = formatClock(sec);
  });
  const streak = createStreakTracker();

  const HOT_THRESHOLD = 60;
  function updatePerfDisplay() {
    const value = perf.valuePercent();
    refs.hudPerfEl.textContent = value + '%';
    refs.hudPerfEl.parentElement?.classList.toggle('hot', value >= HOT_THRESHOLD);
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
  let pendingBeat: { id: number; run: () => void } | null = null;
  // Every dot colour a whole-line clear has drained this run — the first of
  // the two stalemate conditions (see stalemate.ts).
  let clearedDotColors = new Set<number>();
  // Running split of where the score came from, for the end-of-run breakdown.
  let patternPoints = 0;
  let linePoints = 0;
  let comboBonusPoints = 0;
  // Every group of cells findStuckGroups has ever named this game — once a
  // color is genuinely stuck it can only ever stay that way (see
  // stalemate.ts: nothing can un-flip), so this only ever grows. The run
  // does NOT end because of it; the player ends it themselves via
  // stuckEndBtn, once they've decided nothing more is worth waiting for.
  let startSnapshot: BoardSnapshot | null = null;
  let endSnapshot: BoardSnapshot | null = null;
  let lastRun: RunData | null = null;

  function updateStuckState(groups: Cell[][]) {
    hooks.highlightStuck?.(groups.length ? groups.flat() : null);
    // findStuckGroups now only ever reports a *total* dead end — no front
    // colour on the board can ever score again — so instead of arming a
    // "自行结束" button the run ends on its own: the stuck tiles get a beat
    // of red highlight so the player can see what died, then the summary.
    refs.buttons.stuckEnd.hidden = true;
    if (groups.length && !gameOver) {
      hooks.render();
      window.setTimeout(() => {
        if (!gameOver) endGame('无法继续匹配');
      }, 1400);
    }
  }

  function newGame() {
    hooks.resetBoard();
    score = 0;
    moves = 0;
    gameOver = false;
    paused = false;
    resolving = false;
    streak.reset();
    flipChain = 0;
    scoreReel.reset();
    perf.reset();
    clearedDotColors = new Set();
    patternPoints = 0;
    linePoints = 0;
    comboBonusPoints = 0;
    updatePerfDisplay();
    timer.start();
    hooks.render();
    updateStuckState([]);
    startSnapshot = hooks.snapshotBoard?.() ?? null;
    refs.endOverlay.classList.remove('show');
    refs.pauseOverlay.classList.remove('show');
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
    timer.stop();
    const elapsed = timer.elapsedSeconds();

    const statusPercent = perf.valuePercent();
    const bonusMult = 1 + statusPercent / 100;
    // 单人和小屋同一条时间曲线（见 TIME_GAIN）。房间的实时排名比的仍然是原始
    // 得分（那时这一局还没走完，综合得分还不存在），这里算的是走完之后的综合
    // 得分。
    // 无限反转没有用时系数（玩家的原话：「用时系数要取消」）——一局本来就是
    // 固定的 60 秒，快慢没有意义。
    const timeMult = hooks.flip ? 1 : timeMultiplierFor(elapsed);
    // Leaving tiles face-up costs the same either way — walking away early
    // and running the board into a genuine dead end are charged alike, so
    // "stop now" is never a way to dodge the cost of an unfinished board.
    // It is a *scale*, not a flat subtraction: an earlier flat per-tile
    // penalty could wipe out real scoring outright (verified case: 8 raw
    // points against 29 never-flipped tiles → −870, clamped to a flat 0),
    // which read as "you scored nothing" on the results modal and on the
    // share card. Scaling always leaves a good run's score visible.
    const remaining = hooks.countRemainingTiles?.() ?? { neverFlipped: 0, flippedButRemaining: 0 };
    const unflippedScale = UNFLIPPED_SCALE ** remaining.neverFlipped;
    const total = Math.max(
      0,
      Math.round(score * timeMult * bonusMult * unflippedScale) - extraPenalty,
    );

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
      extraPenalty,
      extraPenaltyReason: extraPenaltyLabel,
      hazardEnd,
      // 这一局是在小屋里打的。记录页、战绩图、云上的档都带着它——两边现在
      // 是同一套计分了，可「和谁一起打的」仍然是这一局的一部分。
      room: Boolean(currentRoom()),
      at: Date.now(),
    };

    refs.endHazardBgEl.classList.toggle('show', hazardEnd);
    refs.endTitleEl.textContent = s.endTitleDefault;
    refs.endScoreEl.textContent = String(total);
    // This run measured against this player's own history in this exact mode.
    // Read before the archive is written just below, so this run is counted
    // once — by hand — rather than twice.
    const past = loadRuns(hooks.bestKey);
    const avg = Math.round(
      (past.reduce((sum, r) => sum + (r.data?.totalScore ?? 0), 0) + total) / (past.length + 1),
    );
    refs.endAvgEl.textContent = `${s.avgScoreLabel} = ${avg}`;
    refs.endBreakdownEl.innerHTML = runBreakdown(lastRun, hooks.lang)
      .map(([label, value]) => `<div class="end-row"><span>${label}</span><span>${value}</span></div>`)
      .join('');
    refs.endDetailEl.textContent = runDetailLine(lastRun, hooks.lang);
    // 最快玩家 on a room's closing card is read from here, the same way the
    // live standings read the score off the HUD's reel: the scoreboard takes
    // what is already on screen, and none of the eight boards has to know
    // that multiplayer exists.
    refs.endOverlay.dataset.seconds = String(Math.round(elapsed));
    // 交卷时报给房间的那个数。
    //
    // 打的过程中，比分板报的是 HUD 上的原始得分——那会儿这一局还没走完，综合
    // 得分并不存在。可一局结束之后再按原始得分排名次，就等于说「谁滑得多谁
    // 赢」：同一副牌上多花五分钟总能多滑出几分来。名次要认的是综合得分——里
    // 面有时间系数（房间里还放大了一倍半），也有有效得分率和没翻完的那些块。
    // 和上面那行秒数一样，放在这里是为了让 scoreboard 自己来取：八个玩法谁也
    // 不用知道房间这回事。
    refs.endOverlay.dataset.total = String(total);
    refs.endOverlay.classList.add('show');
    // One cue per ending, told apart by cause: a bomb gets the refusal, every
    // other way of finishing gets the settle. Reached the same way whether the
    // player pressed 结束, ran the clock out, or hit a dead end.
    if (hazardEnd) playError();
    else playSettle();

    endSnapshot = hooks.snapshotBoard?.() ?? null;
    // Archive the run so the 记录 panel can re-open the very same card.
    saveRun(hooks.bestKey, { at: lastRun.at, data: lastRun, start: startSnapshot, end: endSnapshot });
    // 登录了就顺手往云上报一份：换台设备记录跟着回来，成绩也进全球榜。
    // 不 await——结算页已经在屏幕上了，没有理由让刚打完的人等一个请求；
    // 报不上去最多是这一局没上榜，本机那份存档一个字都不受影响。
    pushRun(lastRun, leaderboardName());
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

  function doShare() {
    if (!lastRun) return;
    trackShare('end_modal');
    const dataUrl = renderShareCard(
      {
        ...buildShareInfo(lastRun, hooks.shapeName, hooks.lang),
        standings: roundStandings(),
        room: !!currentRoom(),
      },
      endSnapshot,
      startSnapshot,
    );
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

  const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#BE5762';
  const accent2Color = () => getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#5C8A72';

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
    pendingBeat = null;
    /** The next beat of the reveal, held so hurry() can bring it forward. */
    const beat = (run: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        if (pendingBeat?.id === id) pendingBeat = null;
        run();
      }, ms);
      pendingBeat = { id, run };
    };
    vibrate(8); // a light tick confirming the drag itself landed, win or not

    const stepper = createCascadeStepper(hooks.buildCascadeConfig(), mask, {
      pattern: s.labelPattern,
      line: s.labelWholeLine,
    });
    const multiplier = streak.currentMultiplier();
    // A chain reaction within *this* move is rewarded on top of (not instead
    // of) the cross-move streak above: that streak's own multiplier is fixed
    // for the whole move (captured once, just above), so without this a
    // 3-step cascade in one move and the same 3 scores spread across 3
    // separate moves would add up to exactly the same total — grouping
    // wouldn't matter at all, since both would just be the same points run
    // through the same 1×/2×/4×/... sequence. Growing *this* factor faster
    // (×3 per step) than the cross-move streak (×2 per move) breaks that tie
    // in favor of concentration: for a single step it's a no-op (comboMult
    // starts at 1, so a move with only one score behaves exactly as before),
    // but every additional step *within the same move* compounds faster than
    // spreading the same steps across separate moves ever could.
    let comboMult = 1;
    const CASCADE_COMBO_FACTOR = 3;
    let totalRaw = 0;
    let moveWeight = 0;
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
      streak.apply(totalRaw); // advances/resets the streak level; its delta was already distributed live below
      if (!totalRaw) flipChain = 0;
      perf.onMove(moveWeight);
      updatePerfDisplay();
      if (gameOver) {
        resolving = false;
        return;
      }
      if (hooks.isGameOver()) {
        resolving = false;
        endGame('全部方块已翻成点面');
        return;
      }
      updateStuckState(hooks.findStuckGroups?.(clearedDotColors) ?? []);
      resolving = false;
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
      for (const dot of s.clearedDotColors) clearedDotColors.add(dot);
      // Rounded, so the score stays a whole number. The streak multipliers
      // are ×1/×1.5/×2/×2.5 and the cascade factor compounds on top, so the
      // raw product lands on halves — and a fractional score is wrong twice
      // over: "184.5" is not a score a player should see, and the digit reel
      // has no way to draw a decimal point (see scoreReel.setValue).
      // 无限反转：连续第 n 次得分 = 单次得分 × 1.2^(n−1)，每次四舍五入；同一步里
      // 的连锁也各算一次。跨步的 ×1.5/2/2.5 和同一步里的 ×3 在这一局都不用。
      const delta = hooks.flip
        ? flipStreakDelta(s.points, flipChain)
        : Math.round(s.points * multiplier * comboMult);
      if (hooks.flip) flipChain++;
      // Split for the end-of-run breakdown: the pattern's own points, the
      // whole-line bonus, and everything the streak/chain multipliers added.
      if (s.lineBonusGroups.length) linePoints += s.points;
      else patternPoints += s.points;
      comboBonusPoints += delta - s.points;
      // Captured before comboMult advances for the *next* step — this
      // step's own tier is "how deep into this move's chain are we",
      // which is exactly what comboMult already tracks at this point.
      const tierComboMult = comboMult;
      comboMult *= CASCADE_COMBO_FACTOR;
      const isBonus = s.lineBonusGroups.length > 0;
      const groups: CascadeStepGroups = { matchGroups: s.matchGroups, lineBonusGroups: s.lineBonusGroups };
      // A bonus (the whole-line, 36-point event) gets its own distinct
      // double-pulse — it's the bigger moment — while an ordinary match gets
      // one light buzz, right as its highlight appears.
      vibrate(isBonus ? [25, 40, 25] : 15);
      // Graded feedback: an ordinary first-in-move match only gets a tone —
      // shake and particles are reserved for a chained step or a bonus, so
      // they stay a "big moment" signal instead of firing on every score.
      // A whole-line clear is its own event, not a louder score: the line is
      // draining off the board, so it gets the falling droplet rather than
      // the scoring bell.
      if (isBonus) playClear();
      else playScore(tierComboMult);
      const shakeTier: ShakeTier | null = isBonus ? 'heavy' : tierComboMult > 3 ? 'medium' : tierComboMult > 1 ? 'light' : null;
      if (shakeTier) {
        screenShake(refs.boardWrap, shakeTier);
        const originCell = (isBonus ? s.lineBonusGroups[0] : s.matchGroups[0])?.[0];
        const pos = originCell ? cellCenterPx(originCell) : null;
        if (pos) {
          spawnParticles(refs.boardEl, pos[0], pos[1], {
            color: isBonus ? accent2Color() : accentColor(),
            count: isBonus ? 16 : shakeTier === 'medium' ? 12 : 8,
            spread: isBonus ? 64 : 44,
          });
        }
      }

      hooks.onCascadeStep?.(groups);
      hooks.render();
      hooks.onCascadeStepRendered?.(groups);

      // A brief extra hold right at the moment of impact — hit-stop — for
      // anything above the smallest, most common case: nothing animates
      // differently, the reveal just visibly catches for a beat before
      // continuing, scaled with how big the moment is.
      const hitStopMs = reduceMotion ? 0 : isBonus ? 70 : tierComboMult > 1 ? 40 : 0;

      const proceed = () => {
        // The flip is the splash's plank turn, driven from here for every
        // shape: snapshot the old faces while they are still on screen,
        // let commit + render swap the data and paint the new ones, then
        // turn old into new piece by piece. The roll axis follows the move
        // that caused this score — a flourish in the air only; the landing
        // pose never depends on it (see plankFlip.ts).
        const flipCells = s.matchGroups.flat();
        const faceSnaps = flipCells.length ? snapFlipFaces(refs.boardEl, flipCells) : null;
        s.commit();
        // commit() is what actually turns the matched pieces over — a bonus
        // step's commit is a no-op, so this is exactly the flip moment.
        if (s.matchGroups.length) playFlip();
        if (s.matchGroups.length) hooks.onCommit?.(s.matchGroups);
        if (delta > 0) {
          score += delta;
          const mult = multiplier * tierComboMult;
          scoreReel.showGain(delta, mult > 1 ? `${s.label} ×${mult % 1 ? mult.toFixed(1) : mult}` : s.label);
          scoreReel.setValue(score);
          punch(refs.scoreReelEl);
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
    refs.pauseOverlay.classList.add('show');
  }

  function doResume() {
    if (!paused) return;
    paused = false;
    timer.resume();
    refs.pauseOverlay.classList.remove('show');
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
  refs.buttons.restart.addEventListener('click', newGame);
  // 多人局里没有这颗键——一场同步竞赛暂停不了，那个位置让给了《离开房间》。
  refs.buttons.stop?.addEventListener('click', doPause);
  refs.buttons.continueBtn.addEventListener('click', doResume);
  // A run now ends in exactly two ways, and both are unambiguous: the player
  // presses 结束, or the board itself runs out (every tile turned, or no
  // face-up tile can ever be flipped). Nothing else can navigate away from a
  // game any more — the bottom dock is hidden while one is open — so there
  // is nothing left for a yes/no gate to protect against.
  refs.buttons.finish.addEventListener('click', () => {
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
    forceEnd: doForceEnd,
    destroy() {
      timer.stop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
