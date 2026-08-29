import type { Lang } from '../i18n';
import { renderStoryTutorial, type StoryCell, type StoryStep } from './storyTutorial';

/**
 * The triangle basic tutorial — the storyboard's 6 numbered frames on a
 * 4-row triangle of 16 cells. Frame 1 shows the two scoring patterns (the
 * orange big triangle, the green run of 4); then a row slides right by one
 * pair, a right-slant diagonal slides up by one pair (its wrapped cells
 * re-entering swapped, exactly like the real board), the five-orange
 * diagonal that forms scores and blanks out, and the bottom row finally
 * slides through the blanks to show they still move like everything else.
 */

const S = 76; // triangle side
const H = 66; // row pitch
const W = 320;
const left = (r: number, i: number) => W / 2 + (i - r) * (S / 2) - S / 2;
const top = (r: number) => 8 + r * H;
const ctr = (r: number, i: number) => ({ x: left(r, i) + S / 2, y: top(r) + H / 2 });

const FILL: Record<string, string> = { b: '#4A67C0', r: '#B34D2B', o: '#EE8A2E', g: '#1E8B31', '-': '#8C8C8C' };

function frame(rows: string[]): StoryCell[] {
  const cells: StoryCell[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, i) => {
      cells.push({
        x: left(r, i),
        y: top(r),
        w: S,
        h: H,
        shape: i % 2 === 0 ? 'up' : 'dn',
        fill: ch === 'x' ? '#D2D2D2' : FILL[ch],
        dashed: ch === 'x',
      });
    });
  });
  return cells;
}

const FRAMES: StoryCell[][] = [
  frame(['o', 'ooo', 'o-o--', 'gggg-o-']),
  frame(['b', 'rog', 'o-o--', 'broo-o-']),
  frame(['r', 'rbg', '--o-o', 'broo-o-']),
  frame(['g', 'r-o', '--oo-', 'broo-br']),
  frame(['g', 'r-x', '--xx-', 'brxx-br']),
  frame(['g', 'r-x', '--xx-', 'rbbrxx-']),
];

const MAG = '#B5499B';
const BLUE = '#4A67C0';
const R2 = [4, 5, 6, 7, 8];
const R3 = [9, 10, 11, 12, 13, 14, 15];
/** The right-slant diagonal from the apex: (0,0)(1,1)(1,2)(2,3)(2,4)(3,5)(3,6). */
const DIAG = [0, 2, 3, 7, 8, 14, 15];

const avg = (pts: { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

const diagArrowAt = avg([ctr(3, 5), ctr(2, 3)]);

const BEATS: StoryStep[][] = [
  // 1 — the two scoring patterns: the orange big triangle (3 + 1 inverted)
  // and the green run of 4 along the bottom.
  [
    { t: 'show', f: 0 },
    { t: 'checks', color: BLUE, pts: [avg([ctr(0, 0), ctr(1, 0), ctr(1, 1), ctr(1, 2)])] },
    { t: 'checks', color: '#FFFFFF', pts: [avg([ctr(3, 0), ctr(3, 1), ctr(3, 2), ctr(3, 3)])] },
  ],
  // 2 — a fresh board; the middle row is about to slide right.
  [{ t: 'show', f: 1 }, { t: 'arrow', x: ctr(2, 2).x + 40, y: ctr(2, 2).y, ang: 0, color: MAG }],
  // 3 — the middle row slides right one pair (triangles move two slots at a
  // time, so every cell lands in its own orientation); then the diagonal
  // move is marked.
  [
    { t: 'show', f: 1 },
    { t: 'arrow', x: ctr(2, 2).x + 40, y: ctr(2, 2).y, ang: 0, color: MAG },
    { t: 'slide', f: 1, idx: R2, dx: S, dy: 0, wx: (5 * S) / 2, wy: 0, snap: 2 },
    { t: 'arrow', x: diagArrowAt.x, y: diagArrowAt.y, ang: 240, color: MAG },
  ],
  // 4 — the right-slant diagonal slides up one pair; its two wrapped cells
  // re-enter at the bottom swapped, keeping every orientation valid.
  [
    { t: 'show', f: 2 },
    { t: 'arrow', x: diagArrowAt.x, y: diagArrowAt.y, ang: 240, color: MAG },
    { t: 'slide', f: 2, idx: DIAG, dx: -S / 2, dy: -H, wx: (-3.5 * S) / 2, wy: -3.5 * H, snap: 3 },
  ],
  // 5 — the slide has lined five orange up along a left diagonal: it scores
  // and the whole line turns into blank triangles.
  [
    { t: 'show', f: 3 },
    { t: 'checks', color: BLUE, pts: [ctr(1, 2), ctr(2, 2), ctr(2, 3), ctr(3, 2), ctr(3, 3)] },
    { t: 'fade', snap: 4 },
  ],
  // 6 — the bottom row slides right one pair, straight through the blanks:
  // blank cells still take part in every move.
  [
    { t: 'show', f: 4 },
    { t: 'arrow', x: ctr(3, 3).x + 40, y: ctr(3, 3).y, ang: 0, color: BLUE },
    { t: 'slide', f: 4, idx: R3, dx: S, dy: 0, wx: (7 * S) / 2, wy: 0, snap: 5 },
  ],
];

export function renderTriangleTutorial(container: HTMLElement, lang: Lang, onDone: () => void): void {
  renderStoryTutorial(container, lang, { w: W, h: 280, frames: FRAMES, beats: BEATS }, onDone);
}
