import { shuffle } from './rng';

/**
 * Triangle boards only.
 *
 * A triangle's up/down orientation belongs to its *slot*, not to the piece:
 * render() rebuilds every slot from its own fixed geometry and only the
 * colors move between slots. Every legal move then keeps a piece in slots of
 * its own orientation — sliding snaps to an even shift (which preserves each
 * slot index's parity, and slots strictly alternate), and the pieces that
 * wrap around get pair-swapped to cancel the one-step mismatch an odd-length
 * line would otherwise introduce (see triangle.ts's fillerAwareSource).
 *
 * So a color's up/down split is fixed for the whole run — and every scoring
 * pattern needs both orientations: a run of 4 covers 4 consecutive slots
 * (2 up + 2 down), a big triangle is 3 of one orientation plus 1 of the
 * other. A color dealt entirely into up-slots can therefore never score
 * again for the rest of the game. Dealing at random, that is not rare: on
 * the 25-cell big-triangle board (15 up / 10 down, 5 tiles per color) some
 * color lands with fewer than 2 of an orientation about 90% of the time.
 *
 * Both functions here exist to make that impossible: deal each color as
 * evenly across the two orientations as the board's own ratio allows, and —
 * because an even start stays even forever — the guarantee holds for the
 * whole run without touching the movement rules at all.
 */

/**
 * Deals `colorCount` colors × `perColor` tiles over the slots described by
 * `orientations` (true = an up-pointing slot), splitting every color's tiles
 * between up- and down-slots as evenly as the board allows. Returns the deck
 * in slot order.
 */
export function dealBalancedDeck(
  orientations: readonly boolean[],
  colorCount: number,
  perColor: number,
): number[] {
  const n = orientations.length;
  if (colorCount * perColor !== n) {
    throw new Error(`dealBalancedDeck: ${colorCount}x${perColor} tiles for ${n} slots`);
  }
  const all = Array.from({ length: n }, (_, i) => i);
  const upSlots = shuffle(all.filter((i) => orientations[i]));
  const downSlots = shuffle(all.filter((i) => !orientations[i]));

  // Largest-remainder split: every color takes the same base share of the
  // up-slots, and the few leftover up-slots go to a random subset of colors.
  // (54-cell board: 27 up over 6 colors of 9 -> three colors 5 up/4 down and
  // three 4 up/5 down.) The floor is what keeps both sides >= 2 on every
  // board this is used on.
  const base = Math.floor((perColor * upSlots.length) / n);
  const extra = upSlots.length - base * colorCount;
  const colors = shuffle(Array.from({ length: colorCount }, (_, i) => i));

  const deck = new Array<number>(n);
  let u = 0;
  let d = 0;
  colors.forEach((color, rank) => {
    const ups = base + (rank < extra ? 1 : 0);
    for (let k = 0; k < ups; k++) deck[upSlots[u++]] = color;
    for (let k = 0; k < perColor - ups; k++) deck[downSlots[d++]] = color;
  });
  return deck;
}

/**
 * Places each group's already-built pool of dot colors onto that group's
 * slots, spreading every dot color across both orientations rather than
 * letting one clump on a single side. Same reason as the deal above: a dot
 * color is what a tile shows once flipped, so it needs both orientations to
 * stay matchable late in a run. Greedy, over the shape's own per-front-color
 * pools, so each shape keeps its own back-face distribution rule intact.
 *
 * Returns dot color by slot index. Every slot covered by `groups` is filled;
 * any slot not in a group (bomb mode's red tiles, which never flip) is left
 * as whatever the caller pre-filled.
 */
export function spreadDotColors(
  groups: readonly { readonly slots: readonly number[]; readonly pool: readonly number[] }[],
  isUp: (slot: number) => boolean,
  out: number[],
): number[] {
  // How many of each dot color have landed on each side so far.
  const upCount = new Map<number, number>();
  const downCount = new Map<number, number>();
  const count = (m: Map<number, number>, k: number) => m.get(k) ?? 0;

  for (const group of groups) {
    const pool = [...group.pool];
    for (const slot of group.slots) {
      const here = isUp(slot) ? upCount : downCount;
      const there = isUp(slot) ? downCount : upCount;
      // Take whichever color is furthest behind on *this* side. The pool
      // arrives shuffled, so an all-zero tie resolves randomly.
      let best = 0;
      const want = (v: number) => count(there, v) - count(here, v);
      for (let i = 1; i < pool.length; i++) if (want(pool[i]) > want(pool[best])) best = i;
      const color = pool.splice(best, 1)[0];
      out[slot] = color;
      here.set(color, count(here, color) + 1);
    }
  }
  return out;
}
