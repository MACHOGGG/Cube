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
  bonusPointsPerLine: number;
  /**
   * Flips every cell in every bonused line to its dot face and, for shapes
   * where a full line leaves the board (the square grid), removes them.
   * Called once per cascade pass with *all* of that pass's line groups
   * together (not once per group) so a shape whose removal renumbers rows/
   * columns — square clearing a row and a column in the same pass — can
   * batch the removal the same way the original single-shape prototype did,
   * instead of the first group's removal invalidating the second group's
   * still-pre-removal coordinates.
   */
  onLineBonus(groups: Cell[][]): void;
  /** Square's line-clear shrinks the grid, so any in-flight cell mask goes stale and must be dropped. */
  resetMaskOnLineBonus: boolean;
  /** Square skips match-finding entirely on a pass where a line just cleared; triangle/circle fall through to it in the same pass. */
  continueAfterLineBonus: boolean;
  /** Square also stops the instant the board is fully cleared away. */
  isTerminalAfterLineBonus?(): boolean;
  findMatches(mask: Set<string> | null): Match[];
}

export interface CascadeResult {
  points: number;
  scoredTiles: Set<Tile>;
  /** Each 2x2/run-4 match's own cells, kept separate so the caller can outline each one individually — stays valid to outline for every shape, since a match never removes cells from the board. */
  matchGroups: Cell[][];
  /** Each whole-line bonus's own cells. For a shape whose bonus removes the line from the board (the square grid), these coordinates go stale the instant onLineBonus() runs — don't hold onto them past that. */
  lineBonusGroups: Cell[][];
}

/**
 * Resolves one full chain reaction following a confirmed move: repeatedly
 * awards whole-line bonuses and 2x2/run-4 matches (flipping scored tiles to
 * their dot face) until nothing new triggers. Returns the raw points (no
 * streak multiplier yet) plus every tile that scored — as both a flat set and
 * the individual groups they scored in — so the caller can highlight them.
 */
export function resolveCascade(cfg: CascadeConfig, initialMask: Set<string> | null): CascadeResult {
  let totalPoints = 0;
  let mask = initialMask;
  const scoredTiles = new Set<Tile>();
  const matchGroups: Cell[][] = [];
  const lineBonusGroups: Cell[][] = [];
  // Identifies a match by the permanent ids of its tiles, not by row/col
  // (which shift whenever a line is removed) or by face (a match can be
  // entirely already-dot). Without this, a match with nothing left to flip
  // would get "found" again on every pass forever.
  const scoredSignatures = new Set<string>();

  while (true) {
    let changed = false;

    const lineBonuses = cfg.findLineBonuses();
    if (lineBonuses.length) {
      totalPoints += lineBonuses.length * cfg.bonusPointsPerLine;
      for (const cells of lineBonuses) {
        for (const [r, c] of cells) scoredTiles.add(cfg.tileAt(r, c));
        lineBonusGroups.push(cells);
      }
      cfg.onLineBonus(lineBonuses);
      changed = true;
      if (cfg.resetMaskOnLineBonus) mask = null;
      if (cfg.isTerminalAfterLineBonus?.()) break;
      if (cfg.continueAfterLineBonus) continue;
    }

    const nextMask = new Set<string>();
    const matches = cfg.findMatches(mask).filter((m) => {
      const sig = m.cells
        .map(([r, c]) => cfg.tileAt(r, c).id)
        .sort((a, b) => a - b)
        .join(',');
      if (scoredSignatures.has(sig)) return false;
      scoredSignatures.add(sig);
      return true;
    });

    if (matches.length) {
      changed = true;
      const toFlip = new Set<string>();
      for (const m of matches) {
        totalPoints += m.points;
        matchGroups.push(m.cells);
        for (const [r, c] of m.cells) {
          const t = cfg.tileAt(r, c);
          scoredTiles.add(t);
          if (t.face === 'flavor') toFlip.add(cellKey(r, c));
          nextMask.add(cellKey(r, c));
        }
      }
      for (const key of toFlip) {
        const [r, c] = key.split(',').map(Number);
        cfg.tileAt(r, c).face = 'dot';
      }
      mask = nextMask;
    }

    if (!changed) break;
  }

  return { points: totalPoints, scoredTiles, matchGroups, lineBonusGroups };
}
