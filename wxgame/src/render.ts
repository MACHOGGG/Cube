/**
 * 画。棋盘、棋子、读数、结算——全在一块 2D 画布上，微信小游戏和浏览器的
 * 2D 画布是同一套 API。
 */
import type { Cell, Tile } from '../../src/engine/types';
import { cellKey } from '../../src/engine/types';

export interface Layout {
  /** 棋盘左上角、一格的边长（逻辑像素）。 */
  x: number;
  y: number;
  cell: number;
}

/** 手指还按着的那一线：整行 / 整列跟着手指挪，超出的那一头从另一头补进来。 */
export interface DragView {
  axis: 'row' | 'col';
  index: number;
  /** 挪了多少像素（正数向右 / 向下）。 */
  offsetPx: number;
}

export interface Highlight {
  cells: readonly Cell[];
  kind: 'match' | 'line';
}

export interface BoardLike {
  readonly rows: number;
  readonly cols: number;
  tileAt(r: number, c: number): Tile;
}

/** 网页版游戏页的底色与版图色（--play-bg / --board-bg）。 */
export const COLORS = {
  page: '#FAF6EC',
  board: 'rgba(251, 248, 241, 0.6)',
  boardEdge: 'rgba(61, 49, 40, 0.18)',
  ink: '#2E2430',
  inkSoft: '#7A5C48',
  dotFace: '#3D3128',
  outline: '#FFFFFF',
  stuck: '#C0392B',
  accent: '#B23A3A',
};

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 一枚棋子：正面是它的颜色；反面是深底加一颗反面颜色的圆点（同网页版）。 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  x: number,
  y: number,
  cell: number,
  palette: readonly string[],
) {
  const pad = Math.max(2, cell * 0.06);
  const size = cell - pad * 2;
  const radius = size * 0.18;
  if (tile.face === 'dot') {
    ctx.fillStyle = COLORS.dotFace;
    roundRect(ctx, x + pad, y + pad, size, size, radius);
    ctx.fill();
    ctx.fillStyle = palette[tile.dotColor];
    ctx.beginPath();
    ctx.arc(x + cell / 2, y + cell / 2, size * 0.43, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = palette[tile.color];
    roundRect(ctx, x + pad, y + pad, size, size, radius);
    ctx.fill();
  }
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: BoardLike,
  layout: Layout,
  palette: readonly string[],
  drag: DragView | null,
  highlights: readonly Highlight[],
  stuck: ReadonlySet<string> | null,
) {
  const { x, y, cell } = layout;
  const w = board.cols * cell;
  const h = board.rows * cell;
  // 版图
  ctx.fillStyle = COLORS.board;
  roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 14);
  ctx.fill();
  ctx.strokeStyle = COLORS.boardEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cols; c++) {
      const onDragLine = drag && (drag.axis === 'row' ? drag.index === r : drag.index === c);
      if (onDragLine) continue;
      drawTile(ctx, board.tileAt(r, c), x + c * cell, y + r * cell, cell, palette);
    }
  if (drag) {
    // 被拖的那一线画三份（本位、前一圈、后一圈），裁在版图里，看起来就是循环补位。
    const n = drag.axis === 'row' ? board.cols : board.rows;
    for (let k = -1; k <= 1; k++) {
      const wrap = k * n * cell;
      for (let i = 0; i < n; i++) {
        const r = drag.axis === 'row' ? drag.index : i;
        const c = drag.axis === 'row' ? i : drag.index;
        const tx = drag.axis === 'row' ? x + c * cell + drag.offsetPx + wrap : x + c * cell;
        const ty = drag.axis === 'col' ? y + r * cell + drag.offsetPx + wrap : y + r * cell;
        drawTile(ctx, board.tileAt(r, c), tx, ty, cell, palette);
      }
    }
  }
  // 得分的那几组：白色描边（同网页版的得分框）
  for (const hl of highlights) {
    ctx.strokeStyle = hl.kind === 'line' ? COLORS.accent : COLORS.outline;
    ctx.lineWidth = Math.max(2, cell * 0.08);
    for (const [r, c] of hl.cells) {
      const pad = Math.max(2, cell * 0.06);
      roundRect(ctx, x + c * cell + pad, y + r * cell + pad, cell - pad * 2, cell - pad * 2, (cell - pad * 2) * 0.18);
      ctx.stroke();
    }
  }
  if (stuck) {
    ctx.strokeStyle = COLORS.stuck;
    ctx.lineWidth = Math.max(2, cell * 0.08);
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cols; c++) {
        if (!stuck.has(cellKey(r, c))) continue;
        const pad = Math.max(2, cell * 0.06);
        roundRect(ctx, x + c * cell + pad, y + r * cell + pad, cell - pad * 2, cell - pad * 2, (cell - pad * 2) * 0.18);
        ctx.stroke();
      }
  }
  ctx.restore();
}

export interface HudData {
  score: number;
  ratePercent: number;
  elapsedSec: number;
  labels: { score: string; rate: string; time: string };
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/** 顶上三格读数：得分、有效得分率、用时（同网页版的顺序）。 */
export function drawHud(ctx: CanvasRenderingContext2D, width: number, top: number, hud: HudData) {
  const slots = [
    [hud.labels.score, String(hud.score)],
    [hud.labels.rate, hud.ratePercent + '%'],
    [hud.labels.time, fmtTime(hud.elapsedSec)],
  ];
  const gap = 10;
  const slotW = (width - 32 - gap * 2) / 3;
  slots.forEach(([label, value], i) => {
    const sx = 16 + i * (slotW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    roundRect(ctx, sx, top, slotW, 58, 12);
    ctx.fill();
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, sx + slotW / 2, top + 20);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 22px monospace';
    ctx.fillText(value, sx + slotW / 2, top + 47);
  });
}

export interface EndCardData {
  title: string;
  total: number;
  lines: string[];
  again: string;
}

/** 结算：一张居中的卡，综合得分大字，底下几行明细，一颗《再来》。 */
export function drawEndCard(ctx: CanvasRenderingContext2D, width: number, height: number, d: EndCardData): { again: [number, number, number, number] } {
  ctx.fillStyle = 'rgba(46, 36, 48, 0.45)';
  ctx.fillRect(0, 0, width, height);
  const cw = Math.min(320, width - 40);
  const ch = 220 + d.lines.length * 22;
  const cx = (width - cw) / 2;
  const cy = (height - ch) / 2;
  ctx.fillStyle = '#FBF8F1';
  roundRect(ctx, cx, cy, cw, ch, 18);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = '600 14px sans-serif';
  ctx.fillText(d.title, width / 2, cy + 34);
  ctx.fillStyle = COLORS.ink;
  ctx.font = '700 44px monospace';
  ctx.fillText(String(d.total), width / 2, cy + 88);
  ctx.font = '500 13px sans-serif';
  ctx.fillStyle = COLORS.inkSoft;
  d.lines.forEach((line, i) => ctx.fillText(line, width / 2, cy + 122 + i * 22));
  const bw = 140;
  const bh = 46;
  const bx = width / 2 - bw / 2;
  const by = cy + ch - bh - 22;
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, bx, by, bw, bh, 23);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 16px sans-serif';
  ctx.fillText(d.again, width / 2, by + 30);
  return { again: [bx, by, bw, bh] };
}
