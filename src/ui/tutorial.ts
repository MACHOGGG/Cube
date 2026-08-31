import type { Lang } from '../i18n';
import { cvdHex } from '../engine/palettePref';
import { renderStoryTutorial, type StoryCell, type StoryStep } from './storyTutorial';

/**
 * The square basic tutorial — a watch-only keyframe playback of the design
 * storyboard's 10 numbered frames (5×5 board), transcribed cell-for-cell.
 * Rounded squares are front faces, circles are tiles already flipped to
 * their dot face, and the final frame is the board after its brick column
 * cleared — the five emptied slots left standing as dashed holes.
 */

const P = 62; // cell pitch
const CELL = 56;
const ORIGIN = 8;

// Front faces (rounded squares).
const SQ: Record<string, string> = { b: '#4A67C0', y: '#ADADAD', m: '#B5499B', o: '#EE8A2E' };
// Dot faces (circles).
const CI: Record<string, string> = { R: '#B34D2B', G: '#1E8B31', Y: '#B0B0B0', M: '#B5499B', O: '#EE8A2E' };

function frame(rows: string[]): StoryCell[] {
  const cells: StoryCell[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const base = { x: ORIGIN + c * P, y: ORIGIN + r * P, w: CELL, h: CELL };
      // '.' — nothing at all, for the very last frame: once the holes have
      // blinked their goodbye the column is simply not there any more.
      if (ch === '.') return;
      // 'x' — a slot the clear emptied: a hollow dashed circle, nothing in
      // it. Unlike the circle and triangle boards, a completed dot line on
      // the square board is gone for good rather than left as a blank piece,
      // so it is drawn as a hole and not as a spent tile.
      if (ch === 'x') cells.push({ ...base, shape: 'ci', fill: '#FFFFFF', dashed: true });
      else if (SQ[ch]) cells.push({ ...base, shape: 'sq', fill: cvdHex(SQ[ch]) });
      else cells.push({ ...base, shape: 'ci', fill: cvdHex(CI[ch]) });
    });
  });
  return cells;
}

// Frames 0-7 = storyboard 1-5 and 7-9 (frame 6 of the storyboard is frame 4
// plus an arrow, drawn by the beat script instead of a separate grid);
// frame 8 = the board after the clear — the four surviving columns stay put
// and the emptied column is left standing as five dashed holes, so the last
// beat reads as "those pieces are gone" instead of the board silently
// becoming narrower; frames 9-10 are
// the computed midpoints inside storyboard step 9's three consecutive
// slides, which the sheet doesn't draw but the animation passes through.
const FRAMES: StoryCell[][] = [
  frame(['bbyyR', 'bbbmm', 'bbyom', 'ooobR', 'bbbbb']),
  frame(['bbybR', 'bbbym', 'bbymm', 'ooooR', 'bbbbb']),
  frame(['bbybR', 'bbbym', 'bbymm', 'RGYMR', 'bbbbb']),
  frame(['bbybb', 'bbbyR', 'bbymm', 'RGYMm', 'bbbbR']),
  frame(['bbybb', 'bbbyR', 'bbyGR', 'RGYMO', 'bbbbR']),
  frame(['bbybb', 'bbyRb', 'bbyGR', 'RGYMO', 'bbbbR']),
  frame(['bbRbb', 'bbORb', 'bbMGR', 'RGYMO', 'bbbbR']),
  frame(['bbbbR', 'bbbOR', 'bbMGR', 'GYMOR', 'bbbbR']),
  frame(['bbbbx', 'bbbOx', 'bbMGx', 'GYMOx', 'bbbbx']),
  frame(['bbbbR', 'bbORb', 'bbMGR', 'RGYMO', 'bbbbR']),
  frame(['bbbbR', 'bbbOR', 'bbMGR', 'RGYMO', 'bbbbR']),
  // frame 11 — the board the tutorial ends on: the cleared column is gone,
  // not even a hole left where it was.
  frame(['bbbb.', 'bbbO.', 'bbMG.', 'GYMO.', 'bbbb.']),
];

const ctr = (r: number, c: number) => ({ x: ORIGIN + c * P + CELL / 2, y: ORIGIN + r * P + CELL / 2 });
const col = (c: number) => [c, c + 5, c + 10, c + 15, c + 20];
const row = (r: number) => [r * 5, r * 5 + 1, r * 5 + 2, r * 5 + 3, r * 5 + 4];
const W = '#FFFFFF';
const SPAN = 5 * P;

function arrow(r: number, c: number, ang: number, mode?: 'static'): StoryStep {
  // Anchored just past the named cell's centre, in the pointing direction.
  const p = ctr(r, c);
  const rad = (ang * Math.PI) / 180;
  return { t: 'arrow', x: p.x + Math.cos(rad) * 34, y: p.y + Math.sin(rad) * 34, ang, color: W, mode };
}

const BEATS: StoryStep[][] = [
  // 1 — the opening deal; column 3 is about to slide down.
  [{ t: 'show', f: 0 }, arrow(2, 3, 90)],
  // 2 — column 3 slides down one: the orange 1×4 completes and scores.
  [
    { t: 'show', f: 0 },
    arrow(2, 3, 90),
    { t: 'slide', f: 0, idx: col(3), dx: 0, dy: P, wx: 0, wy: SPAN, snap: 1 },
    { t: 'checks', pts: [0, 1, 2, 3].map((c) => ctr(3, c)), color: W },
  ],
  // 3 — the scored oranges flip to their dot faces; column 4 is next.
  [{ t: 'show', f: 1 }, { t: 'flip', f: 1, idx: [15, 16, 17, 18], snap: 2, dir: 90 }, arrow(2, 4, 90)],
  // 4 — column 4 slides down one: a 2×2 magenta forms across BOTH faces
  // (three fronts + one already-flipped dot) and still scores.
  [
    { t: 'show', f: 2 },
    arrow(2, 4, 90),
    { t: 'slide', f: 2, idx: col(4), dx: 0, dy: P, wx: 0, wy: SPAN, snap: 3 },
    { t: 'checks', pts: [ctr(2, 3), ctr(2, 4), ctr(3, 3), ctr(3, 4)], color: W },
  ],
  // 5 — the magentas flip, each to its own randomly-printed dot colour.
  [{ t: 'show', f: 3 }, { t: 'flip', f: 3, idx: [13, 14, 19], snap: 4, dir: 90 }],
  // 6 — row 1 is about to slide left.
  [{ t: 'show', f: 4 }, arrow(1, 3, 180)],
  // 7 — row 1 slides left one: a vertical gray 4 forms (again mixed faces).
  [
    { t: 'show', f: 4 },
    arrow(1, 3, 180),
    { t: 'slide', f: 4, idx: row(1), dx: -P, dy: 0, wx: -SPAN, wy: 0, snap: 5 },
    { t: 'checks', pts: [0, 1, 2, 3].map((r) => ctr(r, 2)), color: W },
  ],
  // 8 — the grays flip; the three coming slides are all marked at once.
  [
    { t: 'show', f: 5 },
    { t: 'flip', f: 5, idx: [2, 7, 12], snap: 6, dir: 180 },
    arrow(0, 3, 0, 'static'),
    arrow(1, 3, 0, 'static'),
    arrow(3, 0, 180, 'static'),
  ],
  // 9 — all three arrows come up first, then each pulls in turn and its row
  // slides: row 0 right two, row 1 right one, row 3 left one — the whole
  // right column collects five brick dots, a full-column dot match.
  [
    { t: 'show', f: 6 },
    arrow(0, 2, 0, 'static'),
    arrow(1, 3, 0, 'static'),
    arrow(3, 0, 180, 'static'),
    arrow(0, 2, 0),
    { t: 'slide', f: 6, idx: row(0), dx: P * 2, dy: 0, wx: SPAN, wy: 0, snap: 9 },
    arrow(1, 3, 0),
    { t: 'slide', f: 9, idx: row(1), dx: P, dy: 0, wx: SPAN, wy: 0, snap: 10 },
    arrow(3, 0, 180),
    { t: 'slide', f: 10, idx: row(3), dx: -P, dy: 0, wx: -SPAN, wy: 0, snap: 7 },
    { t: 'checks', pts: [0, 1, 2, 3, 4].map((r) => ctr(r, 4)), color: W },
  ],
  // 10 — the completed column clears: the five pieces vanish, their slots
  // stand for a moment as dashed holes, blink twice to say that is what
  // just went, and then the column is gone for good.
  [{ t: 'show', f: 7 }, { t: 'fade', snap: 8 }, { t: 'blink', idx: col(4), times: 2, snap: 11 }],
];

export function renderTutorial(container: HTMLElement, lang: Lang, onDone: () => void): void {
  renderStoryTutorial(container, lang, { id: 'square', w: 320, h: 320, frames: FRAMES, beats: BEATS }, onDone);
}
