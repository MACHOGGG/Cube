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
 * On top of that, dot faces keep the run alive on their own — they already
 * show the colour they will always show and they still slide, so they can be
 * walked together however dead every front colour is. Since 2026-09 they have
 * two ways to score that way: a whole line (lineMin) and, new with star
 * clearing, a pattern made only of stars (minMatch, paid as the star count
 * squared and then cleared — see clearStars in scoring.ts). Whichever comes
 * first keeps the run alive, so the threshold here is min(minMatch, lineMin),
 * counted on the dot faces alone: the reachability walk above mixes fronts
 * into its per-colour totals and asks a different question.
 *
 * Bomb modes need no special case here: their shapes already leave the
 * hazard colour out of the liveTiles they pass in.
 *
 * Returns [] while the run is alive; when stuck, the pieces the player can
 * look at and confirm none of them will ever pair up, grouped by colour —
 * the remaining front tiles, or, on a board where none are left, the stars
 * themselves. gameController ends the run over it.
 */
export function findStuckColorGroups(
  liveTiles: LiveTile[],
  /** 这一局最少几枚才可能算分。不给就是各玩法自己那套图案的门槛（4 枚）。 */
  minMatch: number = MIN_MATCH_SIZE,
  /**
   * 这副棋盘最短的整线奖励要几枚同色星星：小球、三角各版式都是 3，方块是当
   * 前行、列里较短的那个边长。这是星星自己得分的两条路之一，另一条是「整组
   * 星星凑出图案」（门槛就是上面那个 minMatch），所以判「星星还能不能得分」
   * 要拿**两者中小的那个**——只认哪一条都会判出死局来：
   *
   *   · 只认图案枚数：3 枚同色星星明明还能连成一线消掉，按 4 枚算就是死局
   *     （玩家眼看着场上还有能消的星星就被结算了）；
   *   · 只认这一个：方块盘上 4 枚同色星星明明能凑出 2×2，按边长 6 算又是死局。
   */
  lineMin: number,
): Cell[][] {
  const need = Math.max(1, Math.round(minMatch));
  const lineNeed = Math.max(1, Math.round(lineMin));
  const fronts = liveTiles.filter((lt) => lt.tile.face === 'flavor');

  /**
   * 星星自己能得分的门槛。
   *
   * 2026-09 星星消除上线之前，星星只有「连成整线消掉」这一条路，所以这儿用的是
   * lineNeed。现在它多了一条：**整组星星自己就能凑图案**，按枚数平方得分，然后
   * 从棋盘上消除（scoring.ts 的 clearStars）。两条路哪条先够得着就算还活着，所
   * 以取两者中小的那个。
   *
   * 照旧用 lineNeed 的后果是判得太松：玩家报过一次，结算页写着「全部已变成星
   * 星」，盘面上还躺着四颗同色蓝星——凑得出图案，可 isGameOver 先把局结了。
   */
  const starNeed = Math.min(need, lineNeed);
  const dotCount = new Map<number, number>();
  for (const lt of liveTiles) {
    if (lt.tile.face !== 'dot') continue;
    dotCount.set(lt.tile.dotColor, (dotCount.get(lt.tile.dotColor) ?? 0) + 1);
  }
  for (const n of dotCount.values()) if (n >= starNeed) return [];

  /**
   * 一枚色块都不剩了。
   *
   * 从前这儿直接 `return []`（「没有正面就不存在卡死，交给 isGameOver」）——那是
   * 星星消除之前的分工：那时候「全是星星」就是终局，isGameOver 会收场。现在
   * 「全是星星」不再是终局（八副棋盘的 isGameOver 都改了），所以这条路必须在这
   * 儿判完：上面那一关没有任何颜色的星星够得着门槛，就是真的走不动了。
   *
   * 不改的后果比原来的 bug 更糟：isGameOver 不再收场、这儿又说「还活着」，一盘
   * 谁也凑不出来的棋盘会永远结束不了。
   */
  if (fronts.length === 0) {
    const stuckStars = new Map<number, Cell[]>();
    for (const lt of liveTiles) {
      if (lt.tile.face !== 'dot') continue;
      const arr = stuckStars.get(lt.tile.dotColor);
      if (arr) arr.push(lt.cell);
      else stuckStars.set(lt.tile.dotColor, [lt.cell]);
    }
    return [...stuckStars.values()];
  }

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
