import type { Lang } from '../i18n';
import { renderStoryTutorial, type StoryCell, type StoryStep } from './storyTutorial';

/**
 * The circle basic tutorial — the storyboard's 6 numbered frames on a 6-row
 * pyramid of 21 balls. Solid coloured balls are front faces, dark gray are
 * unflipped, white balls with a coloured asterisk are dot faces, and dashed
 * light balls are blanks. Between frames 3 and 4 the sheet's three blue
 * arrows all come up, then each pulls in turn and its diagonal slides
 * (down-right, down-right, up-left), which lines four orange dots up along
 * one left diagonal; frame 6 ends by sliding the bottom row right through
 * the blanks.
 */

const D = 54; // ball diameter
const RH = 47; // row pitch (touching rows)
const W = 340;
const left = (r: number, c: number) => W / 2 + (c - r / 2) * D - D / 2;
const top = (r: number) => 8 + r * RH;
const ctr = (r: number, c: number) => ({ x: left(r, c) + D / 2, y: top(r) + D / 2 });

const FRONT: Record<string, string> = { R: '#B34D2B', O: '#EE8A2E', G: '#1E8B31' };
const STAR: Record<string, string> = { r: '#B34D2B', o: '#EE8A2E', g: '#1E8B31' };

function frame(rows: string[]): StoryCell[] {
  const cells: StoryCell[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const base = { x: left(r, c), y: top(r), w: D, h: D, shape: 'ci' as const };
      if (ch === '-') cells.push({ ...base, fill: '#8A8A8A' });
      else if (ch === 'x') cells.push({ ...base, fill: '#D4D4D4', dashed: true });
      else if (FRONT[ch]) cells.push({ ...base, fill: FRONT[ch] });
      else cells.push({ ...base, fill: '#FFFFFF', star: STAR[ch], ring: true });
    });
  });
  return cells;
}

// 0-3 = storyboard frames 1, 2, 4, 5; 4-5 are the computed boards after the
// first and second of frame 3's three slides (the sheet draws only the
// arrows, but the animation passes through these states); 6 = storyboard
// frame 6, the bottom row slid right one ball through the blank.
const FRAMES: StoryCell[][] = [
  frame(['R', 'RR', '-R-', '--OO', '---OO', 'GGGG--']),
  frame(['g', 'go', '-o-', '--rg', '---gr', 'rroo--']),
  frame(['-', '-g', '-go', '--o-', '--org', 'rro-gr']),
  frame(['-', '-g', '-gx', '--x-', '--xrg', 'rrx-gr']),
  frame(['-', 'gg', '-oo', '--r-', '---gg', 'rroo-r']),
  frame(['-', '-g', '-go', '--o-', '---rg', 'rroogr']),
  frame(['-', '-g', '-gx', '--x-', '--xrg', 'rrrx-g']),
];

const BLUE = '#4A6FC4';
// The three sliding lines are all right-slant diagonals (d = r − c): d0 and
// d1 slide one step down-right, d2 one step up-left.
const D0 = [0, 2, 5, 9, 14, 20];
const D1 = [1, 4, 8, 13, 19];
const D2 = [3, 7, 12, 18];
const VX = D / 2; // one diagonal step
const VY = RH;

function mid(a: { x: number; y: number }, b: { x: number; y: number }, ang: number, mode?: 'static'): StoryStep {
  return { t: 'arrow', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ang, color: BLUE, mode };
}
// Same anchor for the static and the armed version of each arrow, so the
// engine swaps them in place and the hint appears to wake up on its turn.
const arrow1 = (m?: 'static') => mid(ctr(1, 1), ctr(2, 2), 60, m);
const arrow2 = (m?: 'static') => mid(ctr(2, 1), ctr(3, 2), 60, m);
const arrow3 = (m?: 'static') => mid(ctr(5, 3), ctr(4, 2), 240, m);

const avg = (pts: { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

const BEATS: StoryStep[][] = [
  // 1 — the three scoring patterns on front faces: the brick "121" diamond,
  // the orange "22" diamond, the green run of 4.
  [
    { t: 'show', f: 0 },
    {
      t: 'checks',
      color: '#FFFFFF',
      pts: [
        avg([ctr(0, 0), ctr(1, 0), ctr(1, 1), ctr(2, 1)]),
        avg([ctr(3, 2), ctr(3, 3), ctr(4, 3), ctr(4, 4)]),
        avg([ctr(5, 0), ctr(5, 1), ctr(5, 2), ctr(5, 3)]),
      ],
    },
  ],
  // 2 — the board mid-game: scored balls sit flipped to their dot faces.
  [{ t: 'show', f: 1 }],
  // 3 — the sheet's three arrows all come up first; then each pulls in turn
  // and its diagonal slides, which lines four orange dots up along the
  // middle-left diagonal.
  [
    { t: 'show', f: 1 },
    arrow1('static'),
    arrow2('static'),
    arrow3('static'),
    arrow1(),
    { t: 'slide', f: 1, idx: D0, dx: VX, dy: VY, wx: VX * 6, wy: VY * 6, snap: 4 },
    arrow2(),
    { t: 'slide', f: 4, idx: D1, dx: VX, dy: VY, wx: VX * 5, wy: VY * 5, snap: 5 },
    arrow3(),
    { t: 'slide', f: 5, idx: D2, dx: -VX, dy: -VY, wx: -VX * 4, wy: -VY * 4, snap: 2 },
    { t: 'checks', color: BLUE, pts: [ctr(2, 2), ctr(3, 2), ctr(4, 2), ctr(5, 2)] },
  ],
  // 4 — the completed line turns into blank balls: still slide, never score.
  [{ t: 'show', f: 2 }, { t: 'fade', snap: 3 }],
  // 5 — the sheet's frame 6 ending: the bottom row slides right one ball,
  // straight through the blank — blanked balls still ride every move.
  [
    { t: 'show', f: 3 },
    mid(ctr(5, 2), ctr(5, 3), 0),
    { t: 'slide', f: 3, idx: [15, 16, 17, 18, 19, 20], dx: D, dy: 0, wx: D * 6, wy: 0, snap: 6 },
  ],
];

export function renderCircleTutorial(container: HTMLElement, lang: Lang, onDone: () => void): void {
  renderStoryTutorial(container, lang, { id: 'circle', w: W, h: 305, frames: FRAMES, beats: BEATS }, onDone);
}
