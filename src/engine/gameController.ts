import type { ShellRefs } from '../ui/gameShell';
import { createTimer, formatClock } from './timer';
import { createStreakTracker, createCascadeStepper, type CascadeConfig } from './scoring';
import { createScoreReel } from './scoreReel';
import { saveBestIfHigher } from './persistence';
import { createPerformanceGauge } from './performance';
import { vibrate } from './haptics';
import type { Cell } from './types';

export interface CascadeStepGroups {
  matchGroups: Cell[][];
  lineBonusGroups: Cell[][];
}

/**
 * Weights turning the raw score, the leftover-tile count, the live "状态"
 * hit-rate gauge, and the elapsed time into one final composite number
 * (see endGame below) — the four inputs the end-of-run screen breaks out
 * as separate line items above their sum.
 */
const PENALTY_PER_UNFINISHED = 3;
const STATUS_WEIGHT = 2;
const TIME_BONUS_BASE = 100;
const TIME_BONUS_REFERENCE_SEC = 180;

export interface GameControllerHooks {
  bestKey: string;
  /**
   * Timed-challenge mode: the HUD clock counts down from this many seconds
   * instead of counting up, and the run ends on its own the instant it hits
   * zero (in addition to, not instead of, the normal isGameOver() ending).
   */
  timeLimitSec?: number;
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
   * Count of cells still showing their flavor (un-flipped) face the instant
   * the run ends — a tile that never got to finish its own pattern, whether
   * because a whole-line bonus removed/blanked the neighbors it needed or
   * simply because the run ended (time out, manual stop) before it got
   * there. Feeds the end-of-run "未完成" penalty; a shape that has already
   * emptied a cell (square's row/col removal, circle's blank ball) must not
   * count it here — only live, still-flavor-faced cells.
   */
  countUnfinished(): number;
}

export interface GameController {
  readonly score: number;
  readonly moves: number;
  readonly started: boolean;
  readonly paused: boolean;
  readonly gameOver: boolean;
  /** True from the moment a move is confirmed until its whole chain reaction has finished revealing — a shape's drag should stay locked out until this clears, since resolveMove no longer settles synchronously. */
  readonly resolving: boolean;
  restart(): void;
  pause(): void;
  resume(): void;
  finish(): void;
  /** Call after applying a confirmed drag with the set of cells it touched. */
  resolveMove(mask: Set<string>): void;
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
  const scoreReel = createScoreReel(refs.scoreReelEl, refs.gainBadgeEl);
  const perf = createPerformanceGauge();
  const timer = createTimer((s) => {
    if (hooks.timeLimitSec !== undefined) {
      const remaining = Math.max(0, hooks.timeLimitSec - s);
      refs.hudTimeEl.textContent = formatClock(remaining);
      if (remaining <= 0 && !gameOver) endGame('时间到');
      return;
    }
    refs.hudTimeEl.textContent = formatClock(s);
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
  let started = false;
  let paused = false;
  let gameOver = false;
  let resolving = false;

  function newGame() {
    hooks.resetBoard();
    score = 0;
    moves = 0;
    gameOver = false;
    paused = false;
    resolving = false;
    streak.reset();
    scoreReel.reset();
    perf.reset();
    updatePerfDisplay();
    timer.start();
    hooks.render();
    refs.endOverlay.classList.remove('show');
    refs.pauseOverlay.classList.remove('show');
  }

  function endGame(reason: string) {
    gameOver = true;
    resolving = false;
    timer.stop();
    const elapsed = timer.elapsedSeconds();

    const unfinished = hooks.countUnfinished();
    const unfinishedPenalty = unfinished * PENALTY_PER_UNFINISHED;
    const statusPercent = perf.valuePercent();
    const statusBonus = Math.round(statusPercent * STATUS_WEIGHT);
    const timeRef = hooks.timeLimitSec ?? TIME_BONUS_REFERENCE_SEC;
    const timeBonus = Math.round(Math.max(0, 1 - elapsed / timeRef) * TIME_BONUS_BASE);
    const total = Math.max(0, score - unfinishedPenalty + statusBonus + timeBonus);

    const best = saveBestIfHigher(hooks.bestKey, total);

    const signed = (n: number) => (n > 0 ? '+' + n : String(n));
    const row = (label: string, value: number) =>
      `<div class="end-row"><span>${label}</span><span>${signed(value)}</span></div>`;

    refs.endTitleEl.textContent = '挑战结束';
    refs.endScoreEl.textContent = String(total);
    refs.endBreakdownEl.innerHTML =
      row('得分', score) +
      row(`未完成 × ${unfinished}（每处 -${PENALTY_PER_UNFINISHED}）`, -unfinishedPenalty) +
      row(`状态加成（${statusPercent}%）`, statusBonus) +
      row('用时加成', timeBonus);
    refs.endDetailEl.textContent =
      reason + ' · 共 ' + moves + ' 步 · 用时 ' + formatClock(elapsed) + ' · 本机最佳 ' + best;
    refs.endOverlay.classList.add('show');
  }

  // A chain reaction is revealed one beat at a time instead of jumping
  // straight to its end state: each match wave is highlighted while its
  // tiles still show their pre-match face, held for HIGHLIGHT_LEAD_MS, then
  // flipped — so causality stays visible ("this is what matched" before
  // "now it's flipped") — with a further pause before checking whether that
  // flip triggered another wave. A whole-line bonus's cells are already
  // dot-faced by definition (see isFullDotMatch), so it only needs the
  // shorter gap, not a highlight-then-flip beat of its own.
  function resolveMove(mask: Set<string>) {
    if (gameOver || paused || resolving) return;
    moves++;
    resolving = true;
    vibrate(8); // a light tick confirming the drag itself landed, win or not

    const stepper = createCascadeStepper(hooks.buildCascadeConfig(), mask);
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
      perf.onMove(totalRaw > 0);
      updatePerfDisplay();
      resolving = false;
      if (!gameOver && hooks.isGameOver()) endGame('全部方块已翻成点面');
    };

    const step = () => {
      if (gameOver) return; // a manual "结束" click mid-chain stops the reveal where it is
      const s = stepper.next();
      if (!s) {
        finish();
        return;
      }
      totalRaw += s.points;
      const delta = s.points * multiplier * comboMult;
      comboMult *= CASCADE_COMBO_FACTOR;
      const groups: CascadeStepGroups = { matchGroups: s.matchGroups, lineBonusGroups: s.lineBonusGroups };
      // A bonus (the whole-line, 36-point event) gets its own distinct
      // double-pulse — it's the bigger moment — while an ordinary match gets
      // one light buzz, right as its highlight appears.
      vibrate(s.lineBonusGroups.length ? [25, 40, 25] : 15);

      hooks.onCascadeStep?.(groups);
      hooks.render();
      hooks.onCascadeStepRendered?.(groups);

      const proceed = () => {
        s.commit();
        if (s.matchGroups.length) hooks.onCommit?.(s.matchGroups);
        if (delta > 0) {
          score += delta;
          scoreReel.showGain(delta);
          scoreReel.setValue(score);
        }
        // Only a match step's commit() actually changes anything (the
        // flip) — a bonus step's commit() is a no-op (its cells were
        // already dot-faced and, for a shape whose bonus removes cells,
        // already gone from the grid by the time next() returned it), so
        // re-rendering here would serve no purpose except wiping out the
        // ghost/collapse elements onCascadeStepRendered just appended for
        // it, before a single frame of them ever painted.
        if (s.matchGroups.length) hooks.render();
        setTimeout(step, s.lineBonusGroups.length ? BONUS_GAP_MS : STEP_GAP_MS);
      };
      if (s.matchGroups.length) setTimeout(proceed, HIGHLIGHT_LEAD_MS);
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
    endGame('手动结束');
  }

  refs.buttons.start.addEventListener('click', () => {
    started = true;
    refs.startOverlay.classList.remove('show');
    newGame();
  });
  refs.buttons.restart.addEventListener('click', newGame);
  refs.buttons.stop.addEventListener('click', doPause);
  refs.buttons.continueBtn.addEventListener('click', doResume);
  refs.buttons.finish.addEventListener('click', doFinish);

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
    get resolving() {
      return resolving;
    },
    restart: newGame,
    pause: doPause,
    resume: doResume,
    finish: doFinish,
    resolveMove,
    destroy() {
      timer.stop();
    },
  };
}
