import type { ShellRefs } from '../ui/gameShell';
import { createTimer, formatClock } from './timer';
import { createStreakTracker, resolveCascade, type CascadeConfig } from './scoring';
import { createScoreReel } from './scoreReel';
import { saveBestIfHigher } from './persistence';

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
}

export interface GameController {
  readonly score: number;
  readonly moves: number;
  readonly started: boolean;
  readonly paused: boolean;
  readonly gameOver: boolean;
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
  const timer = createTimer((s) => {
    refs.hudTimeEl.textContent = formatClock(s);
  });
  const streak = createStreakTracker();

  let score = 0;
  let moves = 0;
  let started = false;
  let paused = false;
  let gameOver = false;

  function newGame() {
    hooks.resetBoard();
    score = 0;
    moves = 0;
    gameOver = false;
    paused = false;
    streak.reset();
    scoreReel.reset();
    timer.start();
    hooks.render();
    refs.endOverlay.classList.remove('show');
    refs.pauseOverlay.classList.remove('show');
  }

  function endGame(reason: string) {
    gameOver = true;
    timer.stop();
    const elapsed = timer.elapsedSeconds();
    const best = saveBestIfHigher(hooks.bestKey, score);
    refs.endTitleEl.textContent = '挑战结束';
    refs.endScoreEl.textContent = String(score);
    refs.endDetailEl.textContent =
      reason + ' · 共 ' + moves + ' 步 · 用时 ' + formatClock(elapsed) + ' · 本机最佳 ' + best;
    refs.endOverlay.classList.add('show');
  }

  function resolveMove(mask: Set<string>) {
    if (gameOver || paused) return;
    moves++;
    const { points } = resolveCascade(hooks.buildCascadeConfig(), mask);
    const delta = streak.apply(points);
    if (delta > 0) {
      score += delta;
      scoreReel.showGain(delta);
    }
    scoreReel.setValue(score);
    hooks.render();
    if (!gameOver && hooks.isGameOver()) endGame('全部方块已翻成点面');
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
