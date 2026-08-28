import type { Cell, Tile } from './types';

/** Every scoring pattern in the game (run-4, 2x2, 22/121, 31/13, ...) needs at least this many same-effective-color tiles. */
export const MIN_MATCH_SIZE = 4;

export interface LiveTile {
  cell: Cell;
  tile: Tile;
}

function groupBy(liveTiles: LiveTile[], key: (t: Tile) => number): LiveTile[][] {
  const map = new Map<number, LiveTile[]>();
  for (const lt of liveTiles) {
    const arr = map.get(key(lt.tile));
    if (arr) arr.push(lt);
    else map.set(key(lt.tile), [lt]);
  }
  return [...map.values()];
}

/**
 * Two entirely independent things can still keep a run going, and the board
 * is truly stuck only once *both* are gone:
 *
 * 1. A first-time flip: driven purely by *flavor*-color matches among
 *    still-flavor-faced tiles. If any flavor color still has >= MIN_MATCH_SIZE
 *    flavor-faced tiles somewhere, more flips are still possible.
 * 2. Further scoring on tiles that already flipped: a dot-color match or a
 *    whole-line bonus, which only need enough same-dotColor tiles to exist
 *    *somewhere* on the board (flipped or not) — sliding rows/columns around
 *    can still rearrange already-dot-faced tiles into a new qualifying
 *    pattern without any of them flipping again. If any dotColor still has
 *    >= MIN_MATCH_SIZE tiles among the live board, that path is still open.
 *
 * Checking only #1 (as an earlier version of this function did) means the
 * run gets called "stuck" while there's still a whole other dotColor sitting
 * there in bulk, fully able to keep scoring by sliding alone — exactly what
 * it looks like to a player watching several still-healthy colors get
 * written off. Checking only #2 (the very first version) means it gets
 * called "stuck" the moment any single dotColor dips low, which — since a
 * whole-line bonus by definition drains a big slice of one dotColor's
 * supply in one shot (see each shape's isFullDotMatch) — happens as the
 * *routine* outcome of the very first line bonus, not a rare dead end.
 * Requiring both closed off is what actually means nothing can ever happen
 * again, by either route.
 *
 * The returned groups are only the stuck flavor-faced tiles (path #1) —
 * those are the concrete, present-tense reason nothing more can happen, and
 * the ones a player can visually confirm ("this piece, nothing else left to
 * pair it with"). dotColor exhaustion (path #2) is checked only as a gate on
 * *whether* to end the run at all, not surfaced as its own highlighted
 * group: by the time it's satisfied, ordinary play has usually already left
 * several dotColors individually below MIN_MATCH_SIZE over the course of the
 * game, and flagging all of them would bury the one thing actually worth
 * showing under a pile of long-since-resolved history.
 */
export function findStuckColorGroups(liveTiles: LiveTile[]): Cell[][] {
  const flavorFaced = liveTiles.filter((lt) => lt.tile.face === 'flavor');
  if (flavorFaced.length === 0) return []; // nothing left to ever get stuck on; isGameOver handles this

  const flavorGroups = groupBy(flavorFaced, (t) => t.color);
  const canStillFlipSomething = flavorGroups.some((g) => g.length >= MIN_MATCH_SIZE);
  if (canStillFlipSomething) return [];

  const dotGroups = groupBy(liveTiles, (t) => t.dotColor);
  const canStillScoreByRearranging = dotGroups.some((g) => g.length >= MIN_MATCH_SIZE);
  if (canStillScoreByRearranging) return [];

  return flavorGroups.map((g) => g.map((lt) => lt.cell));
}

/**
 * Tallies what's left on the board for the end-of-run flat penalty (see
 * gameController's endGame): a tile still showing its flavor face never
 * contributed anything — the player never even got its first flip — so it
 * counts separately (and costs far more) from a tile that already flipped
 * but simply never got swept into a further dot-match or line bonus before
 * the run ended.
 */
export interface RemainingTileCounts {
  neverFlipped: number;
  flippedButRemaining: number;
}
export function countRemainingTiles(liveTiles: LiveTile[]): RemainingTileCounts {
  let neverFlipped = 0;
  let flippedButRemaining = 0;
  for (const { tile } of liveTiles) {
    if (tile.face === 'flavor') neverFlipped++;
    else flippedButRemaining++;
  }
  return { neverFlipped, flippedButRemaining };
}
