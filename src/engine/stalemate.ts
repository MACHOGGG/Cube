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
 * "This colour can never be turned over again", as two conditions that must
 * both hold — checked in order, and only ever reported once the first one is
 * already true:
 *
 * 1. The back colour that a still-unflipped tile of this colour would show
 *    has already been drained by a whole-line clear. (Whole-line clears are
 *    the only thing that permanently removes a dot colour's supply, so
 *    before one happens no colour can be written off.)
 * 2. Counting what is left: the tiles currently *showing* this colour
 *    (front-facing, or flipped to it) plus every other colour's tile that
 *    has not been flipped yet come to 4 or fewer — too little material left
 *    for this colour to ever complete another pattern.
 *
 * The returned groups are those colours' still-unflipped tiles: the concrete
 * pieces a player can look at and confirm nothing will ever pair with. The
 * run is not ended automatically — this only lights up 自行结束.
 */
export function findStuckColorGroups(
  liveTiles: LiveTile[],
  clearedDotColors: ReadonlySet<number>,
  /**
   * Bomb modes: the hazard colour. Red tiles never flip and never match, so
   * they are not material this rule can count on — leaving them in condition
   * 2's tally would keep the board looking playable long after it isn't, and
   * a colour of pure obstacles is never itself "stuck". Omitted outside bomb
   * modes, where there is no such colour.
   */
  hazardColor?: number,
): Cell[][] {
  const flavorFaced = liveTiles.filter((lt) => lt.tile.face === 'flavor');
  if (flavorFaced.length === 0) return []; // nothing left to ever get stuck on; isGameOver handles this

  const stuck: Cell[][] = [];
  for (const group of groupBy(flavorFaced, (t) => t.color)) {
    const color = group[0].tile.color;
    if (color === hazardColor) continue;
    // 1 — has a line clear already eaten what these tiles would flip into?
    if (!group.some((lt) => clearedDotColors.has(lt.tile.dotColor))) continue;
    // 2 — is there still enough material for this colour to pair up?
    const showingThisColor = liveTiles.filter(
      (lt) => (lt.tile.face === 'dot' ? lt.tile.dotColor : lt.tile.color) === color,
    ).length;
    const otherUnflipped = flavorFaced.filter(
      (lt) => lt.tile.color !== color && lt.tile.color !== hazardColor,
    ).length;
    if (showingThisColor + otherUnflipped > MIN_MATCH_SIZE) continue;
    stuck.push(group.map((lt) => lt.cell));
  }
  return stuck;
}

/**
 * Tallies what's left on the board when the run ends (see gameController's
 * endGame): a tile still showing its flavor face never contributed anything
 * — the player never even got its first flip — and each one scales the
 * composite score down. A tile that already flipped but never got swept into
 * a further dot-match or line bonus is counted separately and costs nothing.
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
