import type { Cell, Tile } from './types';

/** Every scoring pattern in the game (run-4, 2x2, 22/121, 31/13, ...) needs at least this many same-effective-color tiles. */
export const MIN_MATCH_SIZE = 4;

export interface LiveTile {
  cell: Cell;
  tile: Tile;
}

/**
 * Groups every still-live tile by its permanent dotColor — the color it
 * shows once flipped, fixed at deck-build time and unaffected by which face
 * happens to be showing right now — and returns, for each dotColor with
 * fewer than MIN_MATCH_SIZE tiles left anywhere on the board, that color's
 * full remaining cell list as one stuck group.
 *
 * This must NOT group by current effective color (flavor color if still
 * flavor-faced, dotColor if already flipped): an ordinary match flips 4+
 * tiles from their flavor color to their own individual dotColors in one
 * step, so "how many tiles currently show color X" swings wildly on every
 * single move even though nothing was removed from the board — grouping by
 * that would flag a color as stuck moments after a completely unrelated
 * match, the instant its current on-screen count happened to dip low,
 * while still-flavor-faced tiles elsewhere whose *own* preassigned dotColor
 * is that same color sit ready to join it the moment *they* flip.
 *
 * dotColor is assigned once per tile at creation and never changes
 * afterwards, so this grouping is provably invariant across every ordinary
 * match (flipping changes a tile's face, never its dotColor) — the only
 * thing that can ever shrink a dotColor's count is a whole-line bonus
 * actually removing or blanking tiles. That is exactly why this check only
 * ever finds something the moment after a line has been cleared, with no
 * separate gating needed: before any removal, every dotColor still has its
 * full original count (safely above the minimum by deck construction).
 */
export function findStuckColorGroups(liveTiles: LiveTile[]): Cell[][] {
  const byDotColor = new Map<number, Cell[]>();
  for (const { cell, tile } of liveTiles) {
    const cells = byDotColor.get(tile.dotColor);
    if (cells) cells.push(cell);
    else byDotColor.set(tile.dotColor, [cell]);
  }
  const groups: Cell[][] = [];
  for (const cells of byDotColor.values()) {
    if (cells.length < MIN_MATCH_SIZE) groups.push(cells);
  }
  return groups;
}
