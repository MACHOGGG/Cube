/**
 * A shape-agnostic snapshot of a board's current appearance, in normalized
 * [0,1]x[0,1] board-space (origin top-left) so shareCard can lay it into any
 * pixel-sized thumbnail region without each shape knowing about the card
 * layout at all. Every cell is one filled primitive — a shape draws exactly
 * what its own live board would show for that cell (its current effective
 * color; blanked/removed cells are simply omitted).
 */
export type SnapshotCell =
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string }
  | { kind: 'rect'; cx: number; cy: number; half: number; color: string; rotateDeg?: number }
  | { kind: 'poly'; points: [number, number][]; color: string };

export interface BoardSnapshot {
  cells: SnapshotCell[];
}

/**
 * Same 3 primitives as SnapshotCell, but in each shape's own raw geometry
 * units (e.g. ball radius 1, triangle side 1) instead of normalized [0,1]
 * board-space — a shape computes its cells' *real* relative positions (the
 * exact same math its live board uses, just with a fixed unit scale instead
 * of a live pixel size) and hands them to packSnapshot, which is the one
 * place that works out the board's actual bounding box (from every cell's
 * own extent, not just its center) and rescales everything to fit — so no
 * shape has to hand-derive its own board's overall width/height.
 */
export type RawCell =
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string }
  | { kind: 'rect'; cx: number; cy: number; half: number; color: string; rotateDeg?: number }
  | { kind: 'poly'; points: [number, number][]; color: string };

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
        return { kind: 'circle', cx, cy, r: c.r * scale, color: c.color };
      }
      if (c.kind === 'rect') {
        const [cx, cy] = T(c.cx, c.cy);
        return { kind: 'rect', cx, cy, half: c.half * scale, color: c.color, rotateDeg: c.rotateDeg };
      }
      return { kind: 'poly', color: c.color, points: c.points.map(([x, y]) => T(x, y)) };
    }),
  };
}

function drawSnapshot(ctx: CanvasRenderingContext2D, snap: BoardSnapshot, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  for (const cell of snap.cells) {
    ctx.fillStyle = cell.color;
    if (cell.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(cell.cx * size, cell.cy * size, cell.r * size, 0, Math.PI * 2);
      ctx.fill();
    } else if (cell.kind === 'rect') {
      ctx.save();
      ctx.translate(cell.cx * size, cell.cy * size);
      if (cell.rotateDeg) ctx.rotate((cell.rotateDeg * Math.PI) / 180);
      const h = cell.half * size;
      ctx.fillRect(-h, -h, h * 2, h * 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      cell.points.forEach(([px, py], i) => {
        const X = px * size;
        const Y = py * size;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

export interface ShareCardInfo {
  shapeName: string;
  bestKey?: string;
  totalScore: number;
  scoreRows: [label: string, value: string][];
  detail: string;
}

const CARD_W = 720;
const PAD = 80;

/** Renders the composed PNG data URL: title, score summary, then the start and end board snapshots side by side, each labeled. */
export function renderShareCard(info: ShareCardInfo, startSnap: BoardSnapshot | null, endSnap: BoardSnapshot | null): string {
  const boardsY = 300;
  const boardGap = 28;
  const thumb = (CARD_W - PAD * 2 - boardGap) / 2;
  const cardH = boardsY + thumb + 120;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = cardH;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, 0, CARD_W, cardH);

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
  ctx.fillText('综合得分', PAD + 2, 222);

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
  drawThumb(startSnap, PAD, '开始');
  drawThumb(endSnap, PAD + thumb + boardGap, '结束');

  ctx.font = '500 13px "Karla", sans-serif';
  ctx.fillStyle = '#a39e97';
  ctx.textAlign = 'center';
  ctx.fillText('拖动整行整列或整条斜线，拼出同色图案', CARD_W / 2, cardH - 34);
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
