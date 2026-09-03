import type { Cell, Tile } from './types';

/**
 * Every scoring pattern in the game (run-4, 2x2, 22/121, 31/13, ...) needs at
 * least this many same-effective-color tiles.
 *
 * 这是各个玩法自己那套图案的门槛。《随机得分目标》里门槛是这一局转出来的
 * 两个图案中较小的那个——小到 2 枚（三角的「两块拼一个菱形」）——所以那一
 * 局要把真正的门槛传进来。写死 4 的后果不是判得松，是判得太狠：还能拼出那
 * 个小图案的残局被当成死局，1.4 秒后没有任何按钮拦得住结算。
 */
export const MIN_MATCH_SIZE = 4;

export interface LiveTile {
  cell: Cell;
  tile: Tile;
}

/**
 * "The run is over", from the player's own point of view — using only what
 * is visible on the board, never a tile's hidden back colour.
 *
 * A colour is *reachable* when it could still complete a pattern:
 *
 *   1. Seed: any colour already showing on ≥ MIN_MATCH_SIZE tiles (front
 *      faces and dot faces both count — patterns match across faces).
 *   2. Grow: a front tile of a reachable colour can still be flipped some
 *      day, and what it flips to is unknown from the outside — so every
 *      such tile is potential material for any other colour. A colour
 *      whose visible count plus that pool reaches MIN_MATCH_SIZE joins
 *      the reachable set, which may unlock further colours; repeat until
 *      nothing changes.
 *
 * Step 2 is what closes the mutual-deadlock hole the old per-colour count
 * had: two colours, each short of 4 on its own, could still both count the
 * *other's* front tiles as potential backup — even though neither could
 * ever actually flip one. Walking the closure from provably-clearable
 * colours only ever credits flips that can really happen.
 *
 * The whole board is stuck exactly when NO front colour is reachable: not
 * one remaining front tile can ever be part of a score, so nothing can
 * ever flip again. If even one front colour is still reachable, the run is
 * alive and nothing is reported — a single dead colour is the player's
 * problem to route around, not the game's to end.
 *
 * On top of that, dot faces keep the run alive on their own once one colour
 * has enough of them to fill a whole line. Those pieces already show the
 * colour they will always show and they still slide, so they can be walked
 * into one line however dead every front colour is — and a whole-line
 * clear scores. It is the *only* way dot faces score by themselves: a
 * pattern pays out only while it still holds at least one front tile (see
 * createCascadeStepper in scoring.ts), so `minMatch` dot faces of a colour
 * are worth nothing as a pattern and must not count here. The threshold is
 * lineMin — the shortest whole-line bonus this board has: 3 on every ball
 * and triangle layout, the shorter of the current row/column length on the
 * square boards. Counted on the dot faces alone: the reachability walk
 * above mixes fronts into its per-colour totals and asks about patterns,
 * not lines.
 *
 * Bomb modes need no special case here: their shapes already leave the
 * hazard colour out of the liveTiles they pass in.
 *
 * Returns [] while the run is alive; when stuck, every remaining front
 * tile, grouped by colour — the pieces the player can look at and confirm
 * none of them will ever pair up. gameController ends the run over it.
 */
export function findStuckColorGroups(
  liveTiles: LiveTile[],
  _clearedDotColors: ReadonlySet<number>,
  /** 这一局最少几枚才可能算分。不给就是各玩法自己那套图案的门槛（4 枚）。 */
  minMatch: number = MIN_MATCH_SIZE,
  /**
   * 这副棋盘最短的整线奖励要几枚同色反面：小球、三角各版式都是 3，方块是当
   * 前行、列里较短的那个边长。反面自己只有「连成整线消掉」这一条得分路——
   * 图案得分至少要含一枚正面（见 scoring.ts）——所以判「反面还能不能得分」
   * 拿它当门槛，不能拿图案枚数：3 枚同色反面明明还能连成一线消掉，按 4 枚
   * 算就成了死局，玩家眼看着场上还有能消的反面就被结算了。
   */
  lineMin: number,
): Cell[][] {
  const need = Math.max(1, Math.round(minMatch));
  const lineNeed = Math.max(1, Math.round(lineMin));
  const fronts = liveTiles.filter((lt) => lt.tile.face === 'flavor');
  if (fronts.length === 0) return []; // nothing left to ever get stuck on; isGameOver handles this

  // Enough already-flipped tiles of one colour to fill a whole line are a
  // score the player can still go and take, whatever the front faces are
  // doing. A whole line is the only score dot faces can make on their own
  // — a pattern needs a front tile in it — so this is lineMin, not need.
  const dotCount = new Map<number, number>();
  for (const lt of liveTiles) {
    if (lt.tile.face !== 'dot') continue;
    dotCount.set(lt.tile.dotColor, (dotCount.get(lt.tile.dotColor) ?? 0) + 1);
  }
  for (const n of dotCount.values()) if (n >= lineNeed) return [];

  const shownColor = (lt: LiveTile) => (lt.tile.face === 'dot' ? lt.tile.dotColor : lt.tile.color);
  const up = new Map<number, number>();
  for (const lt of liveTiles) up.set(shownColor(lt), (up.get(shownColor(lt)) ?? 0) + 1);
  const frontCount = new Map<number, number>();
  for (const lt of fronts) frontCount.set(lt.tile.color, (frontCount.get(lt.tile.color) ?? 0) + 1);

  const reachable = new Set<number>();
  for (const [color, count] of up) if (count >= need) reachable.add(color);
  for (;;) {
    let pool = 0;
    for (const [color, count] of frontCount) if (reachable.has(color)) pool += count;
    let grew = false;
    for (const [color, count] of up) {
      if (reachable.has(color)) continue;
      if (count + pool >= need) {
        reachable.add(color);
        grew = true;
      }
    }
    if (!grew) break;
  }

  for (const color of frontCount.keys()) if (reachable.has(color)) return [];

  const byColor = new Map<number, Cell[]>();
  for (const lt of fronts) {
    const arr = byColor.get(lt.tile.color);
    if (arr) arr.push(lt.cell);
    else byColor.set(lt.tile.color, [lt.cell]);
  }
  return [...byColor.values()];
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
