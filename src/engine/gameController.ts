import type { ShellRefs } from '../ui/gameShell';
import { createTimer, formatClock } from './timer';
import { createStreakTracker, createCascadeStepper, type CascadeConfig } from './scoring';
import { createScoreReel } from './scoreReel';
import { saveBestIfHigher } from './persistence';
import { createPerformanceGauge } from './performance';
import type { Cell } from './types';

export interface CascadeStepGroups {
  matchGroups: Cell[][];
  lineBonusGroups: Cell[][];
}

export interface GameControllerHooks {
  bestKey: string;
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
    const best = saveBestIfHigher(hooks.bestKey, score);
    refs.endTitleEl.textContent = '挑战结束';
    refs.endScoreEl.textContent = String(score);
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

    const stepper = createCascadeStepper(hooks.buildCascadeConfig(), mask);
    const multiplier = streak.currentMultiplier();
    let totalRaw = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const HIGHLIGHT_LEAD_MS = reduceMotion ? 0 : 550;
    const STEP_GAP_MS = reduceMotion ? 0 : 350;

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
      const delta = s.points * multiplier;
      const groups: CascadeStepGroups = { matchGroups: s.matchGroups, lineBonusGroups: s.lineBonusGroups };

      hooks.onCascadeStep?.(groups);
      hooks.render();
      hooks.onCascadeStepRendered?.(groups);

      const proceed = () => {
        s.commit();
        if (delta > 0) {
          score += delta;
          scoreReel.showGain(delta);
          scoreReel.setValue(score);
        }
        hooks.render();
        setTimeout(step, STEP_GAP_MS);
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
