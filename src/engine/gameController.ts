import type { ShellRefs } from '../ui/gameShell';
import { createTimer, formatClock } from './timer';
import { createStreakTracker, createCascadeStepper, type CascadeConfig } from './scoring';
import { createScoreReel } from './scoreReel';
import { saveBestIfHigher, saveRun, addTotalScore } from './persistence';
import { createPerformanceGauge } from './performance';
import { vibrate } from './haptics';
import { renderShareCard, type BoardSnapshot } from './shareCard';
import { playHit, screenShake, spawnParticles, punch, type ShakeTier } from './juice';
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
 */
export function timeMultiplierFor(elapsedSec: number): number {
  return Math.max(0.5, Math.min(2, 2 - elapsedSec / 300));
}
/** Each tile left un-flipped when the run ends scales the composite by this. */
const UNFLIPPED_SCALE = 0.95;
/** The reason string doFinish() passes for the player's own "结束" button. This (and the other internal reason literals below, and BOMB_HAZARD_REASON) doubles as a language-invariant lookup key for displayReason() — never shown to the player directly. */
const MANUAL_END_REASON = '手动结束';

// Every reason/penalty-label string ever passed into endGame — either from
// this module's own internal literals or, for the bomb hazard case, from
// every bomb-capable shape file via the shared BOMB_HAZARD_REASON/label
// constants — is authored in Chinese as a stable lookup key. displayReason()/
// displayPenaltyLabel() translate them to the current lang only at the
// point they're shown to the player, so no shape file needs its own lang
// plumbing just to pass forceEnd() a reason.
const REASON_LABEL_KEY: Partial<Record<string, keyof import('../i18n').I18nStrings>> = {
  时间到: 'timeUpReason',
  全部方块已翻成点面: 'allFlippedReason',
  无法继续匹配: 'noMoreMatchesReason',
  [MANUAL_END_REASON]: 'manualEndReason',
  [BOMB_HAZARD_REASON]: 'bombHazardReason',
};
const PENALTY_LABEL_KEY: Partial<Record<string, keyof import('../i18n').I18nStrings>> = {
  炸弹惩罚: 'bombPenaltyLabel',
};

export interface GameControllerHooks {
  bestKey: string;
  /** Human-readable name for the share card ("方块", "圆球", ...). */
  shapeName: string;
  /** Localizes this controller's own dynamic end-of-run text (breakdown rows, detail line, share-card labels). */
  lang: Lang;
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
  restart(): void;
  pause(): void;
  resume(): void;
  finish(): void;
  /** Call after applying a confirmed drag with the set of cells it touched. */
  resolveMove(mask: Set<string>): void;
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
  const displayReason = (reason: string): string => {
    const key = REASON_LABEL_KEY[reason];
    return key ? (s[key] as string) : reason;
  };
  const displayPenaltyLabel = (label: string): string => {
    const key = PENALTY_LABEL_KEY[label];
    return key ? (s[key] as string) : label;
  };

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
  let started = false;
  let paused = false;
  let gameOver = false;
  let resolving = false;
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
  let stuckGroups: Cell[][] = [];
  let startSnapshot: BoardSnapshot | null = null;
  let endSnapshot: BoardSnapshot | null = null;
  let lastShareInfo: { totalScore: number; scoreRows: [string, string][]; detail: string; hazardEnd: boolean } | null = null;

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
    gameOver = true;
    resolving = false;
    timer.stop();
    const elapsed = timer.elapsedSeconds();

    const statusPercent = perf.valuePercent();
    const bonusMult = 1 + statusPercent / 100;
    const timeMult = timeMultiplierFor(elapsed);
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
    // Every run's composite score also feeds the device-wide 累计得分.
    addTotalScore(total);

    const row = (label: string, value: string) =>
      `<div class="end-row"><span>${label}</span><span>${value}</span></div>`;

    const hazardEnd = reason === BOMB_HAZARD_REASON;
    refs.endHazardBgEl.classList.toggle('show', hazardEnd);
    refs.endTitleEl.textContent = s.endTitleDefault;
    refs.endScoreEl.textContent = String(total);
    const pct = (v: number) => Math.round(v * 100) + '%';
    refs.endBreakdownEl.innerHTML =
      row(s.patternPointsLabel, String(Math.round(patternPoints))) +
      (comboBonusPoints > 0 ? row(s.comboBonusLabel, '+' + Math.round(comboBonusPoints)) : '') +
      (linePoints > 0 ? row(s.linePointsLabel, '+' + Math.round(linePoints)) : '') +
      row(s.scoreLabel, String(score)) +
      row(`${s.perfBonusLabel} (${statusPercent}%)`, '×' + bonusMult.toFixed(2)) +
      row(s.timeMultLabel, '×' + timeMult.toFixed(2)) +
      (remaining.neverFlipped > 0
        ? row(`${s.neverFlippedLabel} × ${remaining.neverFlipped}`, pct(unflippedScale))
        : '') +
      (extraPenalty > 0 ? row(displayPenaltyLabel(extraPenaltyLabel), '−' + extraPenalty) : '');
    const detailText =
      displayReason(reason) +
      ' · ' + s.stepsPhrase.replace('{n}', String(moves)) +
      ' · ' + s.timeLabel + ' ' + formatClock(elapsed) +
      ' · ' + s.bestPhrase.replace('{n}', String(best));
    refs.endDetailEl.textContent = detailText;
    refs.endOverlay.classList.add('show');

    endSnapshot = hooks.snapshotBoard?.() ?? null;
    lastShareInfo = {
      totalScore: total,
      scoreRows: [
        [s.scoreLabel, String(score)],
        [`${s.rateLabel}${statusPercent}%`, '×' + bonusMult.toFixed(2)],
        [s.timeLabel, formatClock(elapsed)],
      ],
      detail: detailText,
      hazardEnd,
    };
    // Archive this run's share card verbatim — the 记录 panel re-opens
    // exactly this photo later, not a reconstruction from the bare score.
    saveRun(hooks.bestKey, {
      at: Date.now(),
      info: { shapeName: hooks.shapeName, lang: hooks.lang, ...lastShareInfo },
      start: startSnapshot,
      end: endSnapshot,
    });
  }

  function doShare() {
    if (!lastShareInfo) return;
    const dataUrl = renderShareCard({ shapeName: hooks.shapeName, lang: hooks.lang, ...lastShareInfo }, endSnapshot);
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

  const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#BE5762';
  const accent2Color = () => getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#5C8A72';

  function resolveMove(mask: Set<string>) {
    if (gameOver || paused || resolving) return;
    moves++;
    resolving = true;
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
      const delta = s.points * multiplier * comboMult;
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
      playHit(tierComboMult, isBonus ? 'bonus' : 'match');
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
        s.commit();
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
        setTimeout(step, (s.lineBonusGroups.length ? BONUS_GAP_MS : STEP_GAP_MS) + hitStopMs);
      };
      if (s.matchGroups.length) setTimeout(proceed, HIGHLIGHT_LEAD_MS + hitStopMs);
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

  function doFinishStuck() {
    if (!started || gameOver || !stuckGroups.length) return;
    endGame('无法继续匹配');
  }

  function doForceEnd(reason: string, penalty = 0, penaltyLabel?: string) {
    if (!started || gameOver) return;
    endGame(reason, penalty, penaltyLabel);
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
  refs.buttons.share.addEventListener('click', doShare);
  refs.buttons.shareClose.addEventListener('click', () => refs.shareOverlay.classList.remove('show'));

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
    forceEnd: doForceEnd,
    destroy() {
      timer.stop();
    },
  };
}
