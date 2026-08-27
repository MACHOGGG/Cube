import type { Cell } from './types';

/**
 * Expands a qualifying seed match (a run-4, 2x2, or cluster pattern a shape
 * already found) outward through same-effective-color adjacent live cells,
 * returning the full connected region. `neighborsOf` must already exclude
 * out-of-bounds, removed, and blank cells — this only ever compares color on
 * cells it's told are live and in range. Folding a run longer than the
 * minimal 4-cell seed, or any extra same-color tile touching it, into one
 * region is what lets the caller score by the region's actual size instead
 * of the flat minimum.
 */
export function floodFillSameColor(
  seed: Cell[],
  effColorAt: (r: number, c: number) => number,
  neighborsOf: (r: number, c: number) => Cell[],
): Cell[] {
  if (!seed.length) return [];
  const targetColor = effColorAt(seed[0][0], seed[0][1]);
  const seen = new Set<string>();
  const queue: Cell[] = [];
  for (const cell of seed) {
    const key = cell[0] + ',' + cell[1];
    if (!seen.has(key)) {
      seen.add(key);
      queue.push(cell);
    }
  }
  const result: Cell[] = [];
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    result.push([r, c]);
    for (const [nr, nc] of neighborsOf(r, c)) {
      const key = nr + ',' + nc;
      if (seen.has(key)) continue;
      seen.add(key);
      if (effColorAt(nr, nc) === targetColor) queue.push([nr, nc]);
    }
  }
  return result;
}
