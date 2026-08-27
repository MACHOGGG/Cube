import type { Cell, Match, Tile } from './types';
import { cellKey } from './types';

export interface StreakTracker {
  /** Feeds one move's raw (un-multiplied) points in; returns the score delta to add (0 if the move scored nothing, which also resets the streak). */
  apply(points: number): number;
  /** The multiplier the *next* scoring move would receive if it scores right now. */
  currentMultiplier(): number;
  reset(): void;
}

/**
 * Consecutive scoring moves double the multiplier each time: the 1st move in
 * a streak keeps its own points as-is (×1), the 2nd move's own points are
 * ×2, the 3rd's ×4, and so on without limit — each move's *own* raw points,
 * not a running sum. Any move that scores nothing resets the streak back to
 * ×1 for the next one.
 */
export function createStreakTracker(): StreakTracker {
  let streakLevel = 0; // 0 = no active streak yet; k = the k-th consecutive scoring move just applied

  function reset() {
    streakLevel = 0;
  }

  function currentMultiplier(): number {
    return 2 ** streakLevel;
  }

  function apply(points: number): number {
    if (points <= 0) {
      reset();
      return 0;
    }
    const delta = points * currentMultiplier();
    streakLevel++;
    return delta;
  }

  return { apply, currentMultiplier, reset };
}

export interface CascadeConfig {
  tileAt(r: number, c: number): Tile;
  /** Groups of cells that now qualify for a whole-line color bonus; shape is responsible for not re-offering a line already bonused this game. */
  findLineBonuses(): Cell[][];
  /**
   * Flips every cell in every bonused line to its dot face and, for shapes
   * where a full line leaves the board (the square grid), removes them.
   * Called once per cascade step with *all* of that step's line groups
   * together (not once per group) so a shape whose removal renumbers rows/
   * columns — square clearing a row and a column in the same step — can
   * batch the removal the same way the original single-shape prototype did,
   * instead of the first group's removal invalidating the second group's
   * still-pre-removal coordinates. Every cell in every group is already
   * dot-faced by the time this runs (see isFullDotMatch), so — unlike a
   * regular match — there's no flip for the caller to stage; only the
   * removal (if any) needs revealing.
   */
  onLineBonus(groups: Cell[][]): void;
  /** Square's line-clear shrinks the grid, so any in-flight cell mask goes stale and must be dropped. */
  resetMaskOnLineBonus: boolean;
  /** Square also stops the instant the board is fully cleared away. */
  isTerminalAfterLineBonus?(): boolean;
  findMatches(mask: Set<string> | null): Match[];
}

/**
 * One "beat" of a cascade — either a wave of whole-line bonuses or a wave of
 * 2x2/run-4/cluster matches, never both — returned *before* a match step's
 * flip is applied so the caller can show the highlight against the tiles'
 * still-current face first. matchGroups is empty for a bonus step and vice
 * versa.
 */
export interface CascadeStep {
  points: number;
  matchGroups: Cell[][];
  lineBonusGroups: Cell[][];
  /** Applies this step's mutation: flips matchGroups' cells to their dot face (a no-op for a bonus step, whose cells are already dot-faced and already removed by the time next() returns). Call once, after showing the pre-flip highlight, before requesting the next step. */
  commit(): void;
}

export interface CascadeStepper {
  /** Finds the next step, or null once the chain reaction has fully settled. */
  next(): CascadeStep | null;
}

/**
 * Drives one full chain reaction following a confirmed move, one beat at a
 * time: repeatedly finds the next whole-line bonus or match wave, applying a
 * bonus's mutation immediately (its cells are always already dot-faced —
 * see isFullDotMatch — so there's nothing to stage) but holding a match
 * wave's flip back in commit() until the caller calls it. The caller is
 * expected to call next() and commit() strictly in sequence — each commit()
 * before the following next() — so from resolveCascade's own point of view
 * this is exactly the same algorithm as a plain synchronous loop, just with
 * its steps exposed one at a time instead of all resolved before returning.
 */
export function createCascadeStepper(
  cfg: CascadeConfig,
  initialMask: Set<string> | null,
  // Anti-farming guard, both within one cascade and across the whole game:
  // the caller owns this set for the whole game (passing the same Set back
  // in on every move) so the exact same group of physical tiles (by
  // permanent id, not by row/col — those shift whenever a line is removed,
  // and a match can be entirely already-dot so face doesn't distinguish
  // them either) can never pay out twice, no matter how many times a shift
  // is repeated, undone, or re-applied to reach that same grouping again.
  //
  // This is deliberately keyed by tile identity rather than by (cells,
  // color): keying by cell position instead would block a *different* set
  // of tiles from ever scoring again just because some earlier, unrelated
  // match once used that same patch of the board with the same color — a
  // false block, not a farming guard — while simultaneously *failing* to
  // catch a real farm where the same tiles keep re-forming a match at
  // shifting cell coordinates (a long run oscillating past a fixed
  // neighbour, say). Keying by tile id set fixes both: it only ever blocks
  // literally the same tiles from re-scoring together, and it does so
  // regardless of where on the board they happen to be sitting this time.
  //
  // For a run of N same-color tiles sliding past a fixed neighbour, this
  // bounds the exploit rather than closing it outright — the row only has N
  // distinct rotations, so at most N distinct tile-id groups can ever form
  // there, each paying out once and then staying blocked forever — instead
  // of the unbounded repeat-forever farm the old per-position guard allowed.
  //
  // Left empty and un-persisted by a caller (e.g. the tutorial board) that
  // doesn't need the cross-move guard; even then, still used for the rest of
  // *this* cascade so a match with nothing left to flip doesn't get "found"
  // again on every subsequent step.
  everScoredTileGroups: Set<string> = new Set(),
): CascadeStepper {
  let mask = initialMask;
  let terminal = false;

  function next(): CascadeStep | null {
    if (terminal) return null;

    const lineBonuses = cfg.findLineBonuses();
    if (lineBonuses.length) {
      // A cleared line scores the square of its own tile count, so a longer
      // line (a new layout's diagonal, say) is worth more than a shorter one
      // rather than every shape's line being flatly worth the same bonus.
      const points = lineBonuses.reduce((sum, cells) => sum + cells.length ** 2, 0);
      cfg.onLineBonus(lineBonuses);
      if (cfg.resetMaskOnLineBonus) mask = null;
      if (cfg.isTerminalAfterLineBonus?.()) terminal = true;
      return { points, matchGroups: [], lineBonusGroups: lineBonuses, commit() {} };
    }

    const nextMask = new Set<string>();
    const matches = cfg.findMatches(mask).filter((m) => {
      const sig = m.cells
        .map(([r, c]) => cfg.tileAt(r, c).id)
        .sort((a, b) => a - b)
        .join(',');
      if (everScoredTileGroups.has(sig)) return false;
      everScoredTileGroups.add(sig);
      return true;
    });
    if (matches.length) {
      let points = 0;
      const toFlip = new Set<string>();
      for (const m of matches) {
        points += m.points;
        for (const [r, c] of m.cells) {
          nextMask.add(cellKey(r, c));
          if (cfg.tileAt(r, c).face === 'flavor') toFlip.add(cellKey(r, c));
        }
      }
      mask = nextMask;
      return {
        points,
        matchGroups: matches.map((m) => m.cells),
        lineBonusGroups: [],
        commit() {
          for (const key of toFlip) {
            const [r, c] = key.split(',').map(Number);
            cfg.tileAt(r, c).face = 'dot';
          }
        },
      };
    }

    terminal = true;
    return null;
  }

  return { next };
}
