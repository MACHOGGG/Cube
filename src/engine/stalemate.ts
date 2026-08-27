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
 * A whole-line bonus only ever fires on a line that's *already* entirely one
 * dot color (see each shape's isFullDotMatch), so it always consumes a big
 * slice of exactly one dotColor's total supply in a single event — and every
 * shape keeps that color's total supply small (5-9 tiles) by design. That
 * means a dotColor dropping below MIN_MATCH_SIZE the instant a line bonus
 * fires is not a rare edge case, it is the *normal* outcome of the very
 * first line bonus in a run. Ending the whole game right there — the
 * player's first big win — would make nearly every run stop almost
 * immediately, which is not a stalemate, just an unlucky (or even a
 * perfectly ordinary) bit of geometry.
 *
 * A dotColor going dead like that only means those specific tiles, once
 * flipped, can never join *another* dot-match or line bonus — it does not
 * stop anything else on the board. Flipping (flavor face -> dot face) is
 * driven entirely by *flavor*-color matches, which have nothing to do with
 * dotColor accounting, so every other still-flavor-faced tile keeps flipping
 * normally regardless of which dotColors have already been exhausted.
 *
 * The board can only *truly* never progress again once every remaining
 * flavor-faced tile's own flavor color is itself down to fewer than
 * MIN_MATCH_SIZE flavor-faced tiles — at that point nothing left can ever
 * complete a qualifying match, so nothing can ever flip again, and the game
 * would otherwise run forever short of that. That is the only condition
 * allowed to end the run. When it fires, the returned groups additionally
 * include any dotColor already reduced below MIN_MATCH_SIZE (whether or not
 * its own remaining tiles have flipped yet) purely so the reveal-and-settle
 * sequence can show the player every color that ended up unresolved.
 */
export function findStuckColorGroups(liveTiles: LiveTile[]): Cell[][] {
  const flavorFaced = liveTiles.filter((lt) => lt.tile.face === 'flavor');
  if (flavorFaced.length === 0) return []; // nothing left to ever get stuck on; isGameOver handles this

  const flavorGroups = groupBy(flavorFaced, (t) => t.color);
  const stillProgressPossible = flavorGroups.some((g) => g.length >= MIN_MATCH_SIZE);
  if (stillProgressPossible) return [];

  const deadDotGroups = groupBy(liveTiles, (t) => t.dotColor).filter((g) => g.length < MIN_MATCH_SIZE);
  return [...flavorGroups, ...deadDotGroups].map((g) => g.map((lt) => lt.cell));
}
