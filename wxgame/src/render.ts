/**
 * 画。棋盘、棋子、读数、结算——全在一块 2D 画布上，微信小游戏和浏览器的
 * 2D 画布是同一套 API。
 */
import type { Cell, Tile } from '../../src/engine/types';
import { cellKey } from '../../src/engine/types';
import type { Board } from './board';

/**
 * 棋盘在屏幕上的落点。
 *
 * 三副棋盘的格子形状差得远，但摆法可以用同一套数说清楚：每副棋盘用
 * board.centerOf() 报出每一颗的中心，单位是「半边长」（方块是半格，小球是一
 * 个半径）；board.extent() 报出整副棋盘在这套单位里占多大。于是这儿只要记住
 * 「一个单位有多少像素」和「棋盘的左上角落在哪」，就能画任何一副。
 */
export interface Layout {
  /** extent 的左上角落在屏幕上的位置。 */
  x: number;
  y: number;
  /** 一个「半边长」单位有多少像素。 */
  unit: number;
}

/** 一步有多长：三副棋盘都是 2 个单位（一格 / 一个直径）。 */
export const STEP_UNITS = 2;

/** 手指还按着的那一条线：整条跟着手指挪，走出去的那一头从另一头补进来。 */
export interface DragView {
  cells: readonly Cell[];
  /** 这条线在画面上的方向（单位向量）。 */
  vec: readonly [number, number];
  /** 沿着这个方向挪了多少像素。 */
  offsetPx: number;
}

export interface Highlight {
  cells: readonly Cell[];
  kind: 'match' | 'line';
}

/** 网页版游戏页的底色与版图色（--play-bg / --board-bg）。 */
export const COLORS = {
  page: '#FAF6EC',
  board: 'rgba(251, 248, 241, 0.6)',
  boardEdge: 'rgba(61, 49, 40, 0.18)',
  ink: '#2E2430',
  inkSoft: '#7A5C48',
  outline: '#FFFFFF',
  stuck: '#C0392B',
  accent: '#B23A3A',
  /** 消掉之后留在原地的空球（网页版的 --ink-faint，压到三成半）。 */
  blank: 'rgba(154, 139, 152, 0.35)',
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

/**
 * 一颗棋子的轮廓，以它的中心为准。
 *
 * 方块是圆角方格，小球是圆——形状不同，但「多大」是同一个数（半边长的
 * radius 倍），所以同一副棋盘上大小一致。
 */
function piecePath(
  ctx: CanvasRenderingContext2D,
  kind: Board['kind'],
  cx: number,
  cy: number,
  radius: number,
) {
  if (kind === 'circle') {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    return;
  }
  roundRect(ctx, cx - radius, cy - radius, radius * 2, radius * 2, radius * 0.36);
}

/**
 * 一枚棋子。正反两面画什么，照网页版那两个文件（src/shapes/square.ts、
 * circle.ts）来——同一个游戏的两个版本，棋子长得不该不一样：
 *
 *   · 正面：这一颗的颜色，铺满整个形状。
 *   · 反面：底色让出去（露出版图），上面留一个反面颜色的记号。方块留一颗
 *     圆点；小球留一个画出来的星号（三道交叉的线）——小球的正面已经是圆
 *     的了，反面再画个小圆只会读成「同一颗缩小了」，得换个真正不一样的记
 *     号才认得出「这一面翻过来了」。
 *   · 空球（小球独有，整线奖励之后留在原地）：一团淡影子。它还占着位置、
 *     还跟着线滑，但没有颜色可以和别人凑成一组。
 */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  kind: Board['kind'],
  cx: number,
  cy: number,
  unit: number,
  palette: readonly string[],
) {
  const radius = unit * 0.94;
  const color = tile.face === 'dot' ? tile.dotColor : tile.color;
  if (color < 0) {
    ctx.fillStyle = COLORS.blank;
    piecePath(ctx, kind, cx, cy, radius);
    ctx.fill();
    return;
  }
  if (tile.face !== 'dot') {
    ctx.fillStyle = palette[color];
    piecePath(ctx, kind, cx, cy, radius);
    ctx.fill();
    return;
  }
  if (kind === 'circle') {
    // 星号：三道过中心的线，24 格坐标里 stroke-width 5.5、两头是圆的——和
    // 网页版画的是同一个。
    const k = (radius * 0.95) / 12;
    ctx.strokeStyle = palette[color];
    ctx.lineWidth = 5.5 * k;
    ctx.lineCap = 'round';
    const seg = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath();
      ctx.moveTo(cx + (x1 - 12) * k, cy + (y1 - 12) * k);
      ctx.lineTo(cx + (x2 - 12) * k, cy + (y2 - 12) * k);
      ctx.stroke();
    };
    seg(12, 2.5, 12, 21.5);
    seg(4, 6.75, 20, 17.25);
    seg(20, 6.75, 4, 17.25);
    return;
  }
  ctx.fillStyle = palette[color];
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.86, 0, Math.PI * 2);
  ctx.fill();
}

/** 一颗的中心在屏幕上的哪儿。 */
export function pixelOf(board: Board, layout: Layout, r: number, c: number): [number, number] {
  const [ux, uy] = board.centerOf(r, c);
  const e = board.extent();
  return [layout.x + (ux - e.minX) * layout.unit, layout.y + (uy - e.minY) * layout.unit];
}

/**
 * 手指按在哪一颗上——按「离哪一颗的中心最近」算，不按格子的方框。
 *
 * 小球是圆的，方框互相咬合，按方框判会把边角判给隔壁那一颗。按
 * 中心距离就没有这回事，而且手指按偏一点也还认得出来（放宽到 1.1 个单位）。
 */
export function cellAtPoint(board: Board, layout: Layout, px: number, py: number): Cell | null {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cellsInRow(r); c++) {
      const [x, y] = pixelOf(board, layout, r, c);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [r, c];
      }
    }
  // 一颗的半径是一个单位，放宽到 1.6 个：按在两颗中间也算得上最近的那一颗，
  // 按到版图外面老远才算没按中。
  const reach = layout.unit * 1.6;
  return best && bestD <= reach * reach ? best : null;
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  layout: Layout,
  drag: DragView | null,
  highlights: readonly Highlight[],
  stuck: ReadonlySet<string> | null,
) {
  const e = board.extent();
  const { x, y, unit } = layout;
  const w = e.w * unit;
  const h = e.h * unit;
  const palette = board.palette;
  // 版图
  ctx.fillStyle = COLORS.board;
  roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 14);
  ctx.fill();
  ctx.strokeStyle = COLORS.boardEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  const onDrag = new Set<string>();
  if (drag) for (const [r, c] of drag.cells) onDrag.add(cellKey(r, c));

  ctx.save();
  roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 14);
  ctx.clip();
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cellsInRow(r); c++) {
      if (onDrag.has(cellKey(r, c))) continue;
      const [px, py] = pixelOf(board, layout, r, c);
      drawPiece(ctx, board.tileAt(r, c), board.kind, px, py, unit, palette);
    }
  if (drag) {
    // 被拖的那条线画三份（本位、前一圈、后一圈），裁在版图里，看起来就是循
    // 环补位：从这头滑出去的那一颗，正好从那头进来。
    const span = drag.cells.length * STEP_UNITS * unit;
    for (let k = -1; k <= 1; k++) {
      const off = drag.offsetPx + k * span;
      for (const [r, c] of drag.cells) {
        const [px, py] = pixelOf(board, layout, r, c);
        drawPiece(
          ctx,
          board.tileAt(r, c),
          board.kind,
          px + drag.vec[0] * off,
          py + drag.vec[1] * off,
          unit,
          palette,
        );
      }
    }
  }
  // 得分的那几组描一圈边（同网页版的得分框）
  const ring = (cells: readonly Cell[], color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, unit * 0.16);
    for (const [r, c] of cells) {
      const [px, py] = pixelOf(board, layout, r, c);
      piecePath(ctx, board.kind, px, py, unit * 0.94);
      ctx.stroke();
    }
  };
  for (const hl of highlights) ring(hl.cells, hl.kind === 'line' ? COLORS.accent : COLORS.outline);
  if (stuck) {
    const cells: Cell[] = [];
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cellsInRow(r); c++) if (stuck.has(cellKey(r, c))) cells.push([r, c]);
    ring(cells, COLORS.stuck);
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
  /** 《回主菜单》那颗键上的字。 */
  home: string;
}

/** 结算：一张居中的卡，综合得分大字，底下几行明细，一颗《再来》一颗《回主菜单》。 */
export function drawEndCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  d: EndCardData,
): { again: [number, number, number, number]; home: [number, number, number, number] } {
  ctx.fillStyle = 'rgba(46, 36, 48, 0.45)';
  ctx.fillRect(0, 0, width, height);
  const cw = Math.min(320, width - 40);
  const ch = 278 + d.lines.length * 22;
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
  // 两颗键上下摞着：《再来》是主色，《回主菜单》收成一条描边的次要键——一
  // 局打完最常按的是再来一局，回菜单是那条随时都在的退路。
  const bw = 180;
  const bh = 46;
  const bx = width / 2 - bw / 2;
  const hy = cy + ch - bh - 20;
  const by = hy - bh - 12;
  ctx.fillStyle = COLORS.accent;
  roundRect(ctx, bx, by, bw, bh, 23);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 16px sans-serif';
  ctx.fillText(d.again, width / 2, by + 30);
  ctx.strokeStyle = COLORS.boardEdge;
  ctx.lineWidth = 2;
  roundRect(ctx, bx, hy, bw, bh, 23);
  ctx.stroke();
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = '600 15px sans-serif';
  ctx.fillText(d.home, width / 2, hy + 29);
  return { again: [bx, by, bw, bh], home: [bx, hy, bw, bh] };
}
