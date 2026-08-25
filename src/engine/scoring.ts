import type { Cell, Match, Tile } from './types';
import { cellKey } from './types';

export interface StreakTracker {
  /** Feeds one move's raw (un-multiplied) points in; returns the score delta to add (0 if the move scored nothing, which also resets the streak). */
  apply(points: number): number;
  reset(): void;
}

/**
 * N consecutive scoring moves multiply their combined raw points by N — applied
 * incrementally each move so the running total only ever grows by the marginal
 * delta, letting the caller show "+delta" immediately without a popup.
 */
export function createStreakTracker(): StreakTracker {
  let streakSum = 0;
  let streakCount = 0;
  let streakAdded = 0;

  function reset() {
    streakSum = 0;
    streakCount = 0;
    streakAdded = 0;
  }

  function apply(points: number): number {
    if (points <= 0) {
      reset();
      return 0;
    }
    streakSum += points;
    streakCount++;
    const newTotal = streakSum * streakCount;
    const delta = newTotal - streakAdded;
    streakAdded = newTotal;
    return delta;
  }

  return { apply, reset };
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
}

/**
 * Resolves one full chain reaction following a confirmed move: repeatedly
 * awards whole-line bonuses and 2x2/run-4 matches (flipping scored tiles to
 * their dot face) until nothing new triggers. Returns the raw points (no
 * streak multiplier yet) plus every tile that scored, so the caller can flash
 * them as one group.
 */
export function resolveCascade(cfg: CascadeConfig, initialMask: Set<string> | null): CascadeResult {
  let totalPoints = 0;
  let mask = initialMask;
  const scoredTiles = new Set<Tile>();
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

  return { points: totalPoints, scoredTiles };
}
