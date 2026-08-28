import type { Cell } from './types';

/**
 * Two shared "grow a qualifying seed match, but only along its own regular
 * shape" helpers, replacing the old generic same-color flood fill every
 * shape used to call here. Flood fill was wrong: it happily folded in any
 * same-color tile touching the seed from *any* direction, so a straight
 * run-of-4 with an unrelated same-color tile poking off one side scored as
 * if that tile were part of the line, and a shape that stretches easily
 * (a 2x2 block, a rhombus cluster) could balloon into whatever oddly-shaped
 * blob of matching color happened to be connected to it. Both helpers below
 * only ever accept a *complete* next step of the seed's own shape family —
 * a longer straight line, or a bigger version of the same parallelogram —
 * never a partial or off-axis addition.
 */

/**
 * Extends a run-of-4 seed (a contiguous slice of an ordered line, e.g. one
 * of a board's row/diagonal LINES) outward in both directions along that
 * *same* line only, for as long as the color keeps matching — so "1x4"
 * becomes "1x5"/"1x6" when the line itself continues, but a same-color tile
 * one step off that line (on a different line entirely) is never reachable
 * and so never folds in.
 */
export function extendRunInLine(
  lineCells: Cell[],
  seedStart: number,
  seedEnd: number,
  effColorAt: (r: number, c: number) => number,
  isLive: (r: number, c: number) => boolean,
): Cell[] {
  const [sr, sc] = lineCells[seedStart];
  const color = effColorAt(sr, sc);
  let lo = seedStart;
  let hi = seedEnd;
  while (lo - 1 >= 0) {
    const [r, c] = lineCells[lo - 1];
    if (!isLive(r, c) || effColorAt(r, c) !== color) break;
    lo--;
  }
  while (hi + 1 < lineCells.length) {
    const [r, c] = lineCells[hi + 1];
    if (!isLive(r, c) || effColorAt(r, c) !== color) break;
    hi++;
  }
  return lineCells.slice(lo, hi + 1);
}

/**
 * Extends a "2x2-family" seed — a parallelogram spanned by two directions
 * from an anchor cell (anchor, anchor+u, anchor+v, anchor+u+v — exactly
 * what a square 2x2 block or a triangular/hex board's rhombus cluster
 * already is) into the largest same-color parallelogram sharing those same
 * two directions. `positionAt(u, v)` maps the seed's own local (u, v)
 * lattice (anchor is (0, 0)) to a real board cell, or null if that lattice
 * point falls outside the board — a plain `(r0+u*dr1+v*dr2, c0+u*dc1+v*dc2)`
 * closure for a shape whose grid is simple addition (square, circle,
 * squareDiamond), or a cube-coordinate lookup for one that isn't (circleHex,
 * whose row-trimmed hex crop makes a flat (r, c) step vector wrong). Growth
 * is one *entire* extra row or column (in the seed's own u/v lattice) at a
 * time — "22" -> "33" (widen) or "222" (add a full extra row) both qualify,
 * but "221" (a partial extra row) doesn't, since that row fails the
 * all-cells-match-and-in-bounds check and growth stops right there.
 */
export function growParallelogram(
  positionAt: (u: number, v: number) => Cell | null,
  effColorAt: (r: number, c: number) => number,
  isLive: (r: number, c: number) => boolean,
): Cell[] {
  const anchor = positionAt(0, 0)!;
  const color = effColorAt(anchor[0], anchor[1]);
  const lineMatches = (fixedAxis: 'u' | 'v', fixedVal: number, otherLo: number, otherHi: number): boolean => {
    for (let k = otherLo; k <= otherHi; k++) {
      const cell = fixedAxis === 'u' ? positionAt(fixedVal, k) : positionAt(k, fixedVal);
      if (!cell) return false;
      const [r, c] = cell;
      if (!isLive(r, c) || effColorAt(r, c) !== color) return false;
    }
    return true;
  };
  let u0 = 0;
  let u1 = 1;
  let v0 = 0;
  let v1 = 1;
  let grew = true;
  while (grew) {
    grew = false;
    if (lineMatches('u', u0 - 1, v0, v1)) { u0--; grew = true; }
    if (lineMatches('u', u1 + 1, v0, v1)) { u1++; grew = true; }
    if (lineMatches('v', v0 - 1, u0, u1)) { v0--; grew = true; }
    if (lineMatches('v', v1 + 1, u0, u1)) { v1++; grew = true; }
  }
  const cells: Cell[] = [];
  for (let u = u0; u <= u1; u++) for (let v = v0; v <= v1; v++) cells.push(positionAt(u, v)!);
  return cells;
}
