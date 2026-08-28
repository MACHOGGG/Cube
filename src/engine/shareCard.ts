/**
 * A shape-agnostic snapshot of a board's current appearance, in normalized
 * [0,1]x[0,1] board-space (origin top-left) so shareCard can lay it into any
 * pixel-sized thumbnail region without each shape knowing about the card
 * layout at all. Every cell is one primitive plus its face state — a shape
 * hands over exactly what its own live board would show for that cell
 * (front color, or flipped dot color, or a spent/blanked cell), and
 * drawSnapshot below picks the same visual language the real board uses
 * (full-size solid for the front face, a shrunk inset glyph for the dot
 * face, a dim flat fill for a blanked cell) so the thumbnail is a complete,
 * accurate picture of that moment — nothing quietly dropped.
 */
export type CellFace = 'flavor' | 'dot' | 'blank';

export type SnapshotCell =
  | { kind: 'circle'; cx: number; cy: number; r: number; face: CellFace; color: string }
  | { kind: 'rect'; cx: number; cy: number; half: number; face: CellFace; color: string; rotateDeg?: number }
  | { kind: 'poly'; points: [number, number][]; face: CellFace; color: string };

export interface BoardSnapshot {
  cells: SnapshotCell[];
}

/**
 * Same shape as SnapshotCell, but in each shape's own raw geometry units
 * (e.g. ball radius 1, triangle side 1) instead of normalized [0,1]
 * board-space — a shape computes its cells' *real* relative positions (the
 * exact same math its live board uses, just with a fixed unit scale instead
 * of a live pixel size) and hands them to packSnapshot, which is the one
 * place that works out the board's actual bounding box (from every cell's
 * own extent, not just its center) and rescales everything to fit — so no
 * shape has to hand-derive its own board's overall width/height.
 */
export type RawCell = SnapshotCell;

export function packSnapshot(raw: RawCell[]): BoardSnapshot {
  if (!raw.length) return { cells: [] };
  const pts: [number, number][] = [];
  for (const c of raw) {
    if (c.kind === 'circle') pts.push([c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]);
    else if (c.kind === 'rect') {
      // A rotated square's corners can reach sqrt(2) times further than its
      // half-width — using that worst case keeps the bbox correct at any
      // rotateDeg without needing the actual rotated corner math.
      const d = c.half * Math.SQRT2;
      pts.push([c.cx - d, c.cy - d], [c.cx + d, c.cy + d]);
    } else pts.push(...c.points);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = 1 / Math.max(maxX - minX, maxY - minY, 1e-6);
  const offX = (1 - (maxX - minX) * scale) / 2;
  const offY = (1 - (maxY - minY) * scale) / 2;
  const T = (x: number, y: number): [number, number] => [(x - minX) * scale + offX, (y - minY) * scale + offY];
  return {
    cells: raw.map((c): SnapshotCell => {
      if (c.kind === 'circle') {
        const [cx, cy] = T(c.cx, c.cy);
        return { kind: 'circle', cx, cy, r: c.r * scale, face: c.face, color: c.color };
      }
      if (c.kind === 'rect') {
        const [cx, cy] = T(c.cx, c.cy);
        return { kind: 'rect', cx, cy, half: c.half * scale, face: c.face, color: c.color, rotateDeg: c.rotateDeg };
      }
      return { kind: 'poly', face: c.face, color: c.color, points: c.points.map(([x, y]) => T(x, y)) };
    }),
  };
}

const DOT_SCALE = 0.6;
const DOT_STROKE = '#1A1A1A';
// Several palettes include a muted gray/brown flavor color of their own
// (e.g. #9B958D) that sits too close to any dim gray *fill* to reliably
// tell apart at a glance — same reasoning the live circleHex board already
// applies to its own blank balls. A hollow outline, with no fill in any
// palette, can never coincidentally match a real color, so that's what a
// blanked cell gets here regardless of which shape's snapshot this is.
const RING_COLOR = '#9A8B98';
const RING_SCALE = 0.88;

// Traces one cell's outline at an optional shrink factor around its own
// center — full size (scale 1) for a live front face, shrunk (DOT_SCALE)
// for a flipped dot face or (RING_SCALE) for a blanked cell's ring.
function tracePrimitive(ctx: CanvasRenderingContext2D, cell: SnapshotCell, size: number, scale: number) {
  ctx.beginPath();
  if (cell.kind === 'circle') {
    ctx.arc(cell.cx * size, cell.cy * size, cell.r * size * scale, 0, Math.PI * 2);
  } else if (cell.kind === 'rect') {
    ctx.save();
    ctx.translate(cell.cx * size, cell.cy * size);
    if (cell.rotateDeg) ctx.rotate((cell.rotateDeg * Math.PI) / 180);
    const h = cell.half * size * scale;
    ctx.rect(-h, -h, h * 2, h * 2);
    ctx.restore();
  } else {
    const cx = cell.points.reduce((s, p) => s + p[0], 0) / cell.points.length;
    const cy = cell.points.reduce((s, p) => s + p[1], 0) / cell.points.length;
    cell.points.forEach(([px, py], i) => {
      const X = (cx + (px - cx) * scale) * size;
      const Y = (cy + (py - cy) * scale) * size;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
  }
}

// The live boards use 3 genuinely different dot-face glyphs, not one
// generic stand-in — the rect family (square/diamond) shows a small inset
// circle, the circle family (ball/hex) shows a 3-line asterisk with no
// fill at all, and only the poly family (triangle) actually is a shrunk
// copy of its own silhouette with a dark outline. Routing by cell.kind
// here reproduces each shape's own real look instead of approximating all
// three with the one that happens to fit triangle.
const ASTERISK_SEGS: [[number, number], [number, number]][] = [
  [[12, 2.5], [12, 21.5]],
  [[4, 6.75], [20, 17.25]],
  [[20, 6.75], [4, 17.25]],
];
function drawAsterisk(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const scale = (r * 0.85) / 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 5.5 * scale);
  ctx.lineCap = 'round';
  for (const [[x1, y1], [x2, y2]] of ASTERISK_SEGS) {
    ctx.beginPath();
    ctx.moveTo(cx + (x1 - 12) * scale, cy + (y1 - 12) * scale);
    ctx.lineTo(cx + (x2 - 12) * scale, cy + (y2 - 12) * scale);
    ctx.stroke();
  }
}

function drawDotFace(ctx: CanvasRenderingContext2D, cell: SnapshotCell, size: number) {
  if (cell.kind === 'rect') {
    // Matches the live board's .dot-circle: a small inset disc, not a
    // shrunk square.
    const r = cell.half * size * 0.8;
    ctx.beginPath();
    ctx.arc(cell.cx * size, cell.cy * size, r, 0, Math.PI * 2);
    ctx.fillStyle = cell.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = Math.max(1, size * 0.004);
    ctx.stroke();
  } else if (cell.kind === 'circle') {
    drawAsterisk(ctx, cell.cx * size, cell.cy * size, cell.r * size, cell.color);
  } else {
    tracePrimitive(ctx, cell, size, DOT_SCALE);
    ctx.fillStyle = cell.color;
    ctx.fill();
    ctx.strokeStyle = DOT_STROKE;
    ctx.lineWidth = Math.max(1, size * 0.008);
    ctx.stroke();
  }
}

function drawSnapshot(ctx: CanvasRenderingContext2D, snap: BoardSnapshot, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  for (const cell of snap.cells) {
    if (cell.face === 'blank') {
      tracePrimitive(ctx, cell, size, RING_SCALE);
      ctx.strokeStyle = RING_COLOR;
      ctx.lineWidth = Math.max(1.5, size * 0.018);
      ctx.stroke();
    } else if (cell.face === 'dot') {
      drawDotFace(ctx, cell, size);
    } else {
      tracePrimitive(ctx, cell, size, 1);
      ctx.fillStyle = cell.color;
      ctx.fill();
    }
  }
  ctx.restore();
}

import { STRINGS, type Lang } from '../i18n';

export interface ShareCardInfo {
  shapeName: string;
  bestKey?: string;
  totalScore: number;
  scoreRows: [label: string, value: string][];
  detail: string;
  /** True when this run ended via a bomb hazard cluster — draws a large, low-opacity 💥 behind the card. */
  hazardEnd?: boolean;
  lang: Lang;
}

const CARD_W = 720;
const PAD = 80;
// Canvases are rendered at this multiple of the card's logical CSS-pixel
// layout (all the coordinate math below stays in logical units — only the
// backing pixel buffer and a single ctx.scale grow) so the exported PNG is
// crisp at typical phone/desktop pixel densities instead of blurry when
// zoomed into or saved at native size.
const EXPORT_SCALE = 3;

/** Renders the composed PNG data URL: title, score summary, then the start and end board snapshots side by side, each labeled. */
export function renderShareCard(info: ShareCardInfo, startSnap: BoardSnapshot | null, endSnap: BoardSnapshot | null): string {
  const s = STRINGS[info.lang];
  const boardsY = 300;
  const boardGap = 28;
  const thumb = (CARD_W - PAD * 2 - boardGap) / 2;
  const cardH = boardsY + thumb + 120;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * EXPORT_SCALE;
  canvas.height = cardH * EXPORT_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, 0, CARD_W, cardH);

  if (info.hazardEnd) {
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.font = `${cardH * 0.85}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💥', CARD_W / 2, cardH / 2);
    ctx.restore();
  }

  ctx.fillStyle = '#141413';
  ctx.font = '700 40px "Fraunces", serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Slides', PAD, 76);
  ctx.font = '600 22px "Karla", sans-serif';
  ctx.fillStyle = '#5b5650';
  ctx.fillText(info.shapeName, PAD, 108);

  ctx.font = '700 88px "JetBrains Mono", monospace';
  ctx.fillStyle = '#BE5762';
  ctx.fillText(String(info.totalScore), PAD, 200);
  ctx.font = '500 15px "Karla", sans-serif';
  ctx.fillStyle = '#5b5650';
  ctx.fillText(s.compositeScoreLabel, PAD + 2, 222);

  ctx.font = '500 15px "JetBrains Mono", monospace';
  ctx.fillStyle = '#8b8680';
  let rowY = 168;
  const rowX = CARD_W - PAD;
  for (const [label, value] of info.scoreRows) {
    ctx.textAlign = 'right';
    ctx.fillText(`${label} ${value}`, rowX, rowY);
    rowY += 22;
  }
  ctx.textAlign = 'left';
  ctx.font = '500 13px "Karla", sans-serif';
  ctx.fillStyle = '#8b8680';
  ctx.fillText(info.detail, PAD, 258);

  const drawThumb = (snap: BoardSnapshot | null, x: number, label: string) => {
    ctx.fillStyle = '#f0ece4';
    roundRect(ctx, x, boardsY, thumb, thumb, 20);
    ctx.fill();
    if (snap) {
      const inset = thumb * 0.08;
      drawSnapshot(ctx, snap, x + inset, boardsY + inset, thumb - inset * 2);
    }
    ctx.font = '600 15px "Karla", sans-serif';
    ctx.fillStyle = '#5b5650';
    ctx.fillText(label, x, boardsY + thumb + 30);
  };
  drawThumb(startSnap, PAD, s.shareStartLabel);
  drawThumb(endSnap, PAD + thumb + boardGap, s.shareEndLabel);

  ctx.font = '500 13px "Karla", sans-serif';
  ctx.fillStyle = '#a39e97';
  ctx.textAlign = 'center';
  ctx.fillText(s.shareFooterHint, CARD_W / 2, cardH - 34);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
