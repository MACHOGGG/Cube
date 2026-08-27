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
 * The composite end-of-run score multiplies the raw score by the live
 * "有效得分率" hit-rate gauge (as a fraction) and a time-elapsed bracket —
 * faster clears are rewarded, slower ones tapered — then, if the run ended
 * with one or more colors permanently unable to ever flip again (see
 * stalemate.ts and stuckEndBtn), further multiplies by STUCK_PENALTY_FACTOR
 * once per such stuck color/group (not per tile).
 */
const TIME_BRACKETS: [maxSec: number, mult: number][] = [
  [60, 2],
  [180, 1.5],
  [300, 1],
  [420, 0.8],
  [600, 0.6],
];
const TIME_BRACKET_FALLBACK_MULT = 0.5;
function timeMultiplierFor(elapsedSec: number): number {
  for (const [maxSec, mult] of TIME_BRACKETS) if (elapsedSec <= maxSec) return mult;
  return TIME_BRACKET_FALLBACK_MULT;
}
const STUCK_PENALTY_FACTOR = 0.95;

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
  // Every group of physical tiles (by permanent id) that has ever scored
  // together this game — see createCascadeStepper's everScoredTileGroups
  // param — persists across moves so the same tiles can't keep re-scoring
  // by oscillating or cycling back through earlier positions.
  let everScoredTileGroups = new Set<string>();
  // Every group of cells findStuckGroups has ever named this game — once a
  // color is genuinely stuck it can only ever stay that way (see
  // stalemate.ts: nothing can un-flip), so this only ever grows. The run
  // does NOT end because of it; the player ends it themselves via
  // stuckEndBtn, once they've decided nothing more is worth waiting for.
  let stuckGroups: Cell[][] = [];

  function updateStuckState(groups: Cell[][]) {
    stuckGroups = groups;
    hooks.highlightStuck?.(groups.length ? groups.flat() : null);
    refs.buttons.stuckEnd.hidden = groups.length === 0;
  }

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
    everScoredTileGroups = new Set();
    updatePerfDisplay();
    timer.start();
    hooks.render();
    updateStuckState([]);
    refs.endOverlay.classList.remove('show');
    refs.pauseOverlay.classList.remove('show');
  }

  function endGame(reason: string, stuckCount = 0) {
    gameOver = true;
    resolving = false;
    timer.stop();
    const elapsed = timer.elapsedSeconds();

    const statusPercent = perf.valuePercent();
    const statusFrac = statusPercent / 100;
    const timeMult = timeMultiplierFor(elapsed);
    const stuckMult = STUCK_PENALTY_FACTOR ** stuckCount;
    const total = Math.round(score * statusFrac * timeMult * stuckMult);

    const best = saveBestIfHigher(hooks.bestKey, total);

    const row = (label: string, value: string) =>
      `<div class="end-row"><span>${label}</span><span>${value}</span></div>`;

    refs.endTitleEl.textContent = '挑战结束';
    refs.endScoreEl.textContent = String(total);
    refs.endBreakdownEl.innerHTML =
      row('得分', String(score)) +
      row(`有效得分率（${statusPercent}%）`, '×' + statusFrac.toFixed(2)) +
      row('用时系数', '×' + timeMult) +
      (stuckCount > 0 ? row(`卡死方块 × ${stuckCount}`, '×' + stuckMult.toFixed(2)) : '');
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

    const stepper = createCascadeStepper(hooks.buildCascadeConfig(), mask, everScoredTileGroups);
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
      if (gameOver) {
        resolving = false;
        return;
      }
      if (hooks.isGameOver()) {
        resolving = false;
        endGame('全部方块已翻成点面');
        return;
      }
      updateStuckState(hooks.findStuckGroups?.() ?? []);
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
    endGame('手动结束', stuckGroups.length);
  }

  function doFinishStuck() {
    if (!started || gameOver || !stuckGroups.length) return;
    endGame('无法继续匹配', stuckGroups.length);
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
  refs.buttons.stuckEnd.addEventListener('click', doFinishStuck);

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
