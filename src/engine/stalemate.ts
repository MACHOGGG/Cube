import type { Cell, Tile } from './types';
import { effColor } from './types';

/** Every scoring pattern in the game (run-4, 2x2, 22/121, 31/13, ...) needs at least this many same-effective-color tiles. */
export const MIN_MATCH_SIZE = 4;

export interface LiveTile {
  cell: Cell;
  tile: Tile;
}

/**
 * Groups every still-live tile by its current effective color and returns,
 * for each color with fewer than MIN_MATCH_SIZE tiles left anywhere on the
 * board, that color's full remaining cell list as one stuck group. Sliding
 * never changes a tile's color, only its position, so once a color's count
 * drops below the minimum it can never reach a qualifying match again no
 * matter how the board is shuffled from here — a permanent stalemate for
 * those specific tiles.
 */
export function findStuckColorGroups(liveTiles: LiveTile[]): Cell[][] {
  const byColor = new Map<number, Cell[]>();
  for (const { cell, tile } of liveTiles) {
    const c = effColor(tile);
    const cells = byColor.get(c);
    if (cells) cells.push(cell);
    else byColor.set(c, [cell]);
  }
  const groups: Cell[][] = [];
  for (const cells of byColor.values()) {
    if (cells.length < MIN_MATCH_SIZE) groups.push(cells);
  }
  return groups;
}
