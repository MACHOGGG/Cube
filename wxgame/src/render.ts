/**
 * 画。棋盘、棋子、读数、结算——全在一块 2D 画布上，微信小游戏和浏览器的
 * 2D 画布是同一套 API。
 */
import type { Cell, Tile } from '../../src/engine/types';
import { cellKey } from '../../src/engine/types';
import { BOARD_FORCE } from '../../src/engine/dragChain';
import { FONT_NUM, PLAY, type PlayMetrics } from './theme';

/** 挤到底时压扁多少——和 dragChain.ts 里那个 SQUASH 同一个数。 */
const SQUASH = 0.1;
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
  /** 地板比棋盘本身往外多出多少（网页版那圈留白）。不给就是 8。 */
  panelPad?: number;
  /** 地板的圆角。不给就是 14。 */
  panelR?: number;
}

/** 一步有多长：三副棋盘都是 2 个单位（一格 / 一个直径）。 */
export const STEP_UNITS = 2;

/** 手指还按着的那一条线：整条跟着手指挪，走出去的那一头从另一头补进来。 */
/**
 * 正被手指拖着的那条线，画的时候要知道的事。
 *
 * 一条线不是一块铁板：手指下面那一颗跟得最紧，越往两头越慢半拍，松手之后尾
 * 巴还会晃一下——这套弹簧是网页版的 src/engine/dragChain.ts，两边用的是同一
 * 份，所以手感一样。所以这儿给的不是「整条线挪了多少」，而是「第 i 颗挪了多
 * 少」。
 */
export interface DragView {
  cells: readonly Cell[];
  /** 这条线在画面上的方向（单位向量）。 */
  vec: readonly [number, number];
  /** 第 i 颗沿着这个方向挪了多少格（一格 = STEP_UNITS 个单位）。 */
  slotsAt(i: number): number;
  /** 第 i 颗被前面那颗挤到什么程度，0～1——画的时候顺着拖动方向压扁一点。 */
  pressAt(i: number): number;
  /** 不在这条线上的那一颗要跟着蹭多远（格）：按它离这条线几条来给。 */
  nudgeAt(r: number, c: number): number;
}

export interface Highlight {
  cells: readonly Cell[];
  kind: 'match' | 'line';
}

/**
 * 游戏页那一套颜色。数值全在 theme.ts（从网页版 style.css 一条条抄过来的），
 * 这儿只是给它们起个短名字，画的时候顺手。
 */
export const COLORS = {
  page: PLAY.bg,
  board: PLAY.panel,
  boardEdge: 'transparent',
  ink: PLAY.ink,
  inkSoft: PLAY.inkSoft,
  outline: PLAY.outline,
  stuck: PLAY.stuck,
  accent: PLAY.accent,
  blank: PLAY.blank,
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
  // 地板：深褐的一大块圆角矩形，棋子摆在上面（网页版的 --play-panel）。棋盘
  // 自己那一圈边距由 pad 给——网页版是「棋子自带外边距，地板本身不留内边距」。
  const pad = layout.panelPad ?? 8;
  const radius = layout.panelR ?? 14;
  ctx.fillStyle = COLORS.board;
  roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, radius);
  ctx.fill();

  const onDrag = new Set<string>();
  if (drag) for (const [r, c] of drag.cells) onDrag.add(cellKey(r, c));

  ctx.save();
  roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, radius);
  ctx.clip();
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cellsInRow(r); c++) {
      if (onDrag.has(cellKey(r, c))) continue;
      const [px, py] = pixelOf(board, layout, r, c);
      // 旁边几条线跟着蹭一点（同网页版：被拖那条越快，邻居被带得越远，然后
      // 各自弹回原位）。
      const nudge = drag ? drag.nudgeAt(r, c) * STEP_UNITS * unit : 0;
      const dx = drag && nudge ? drag.vec[0] * nudge : 0;
      const dy = drag && nudge ? drag.vec[1] * nudge : 0;
      drawPiece(ctx, board.tileAt(r, c), board.kind, px + dx, py + dy, unit, palette);
    }
  if (drag) {
    // 被拖的那条线画三份（本位、前一圈、后一圈），裁在版图里，看起来就是循
    // 环补位：从这头滑出去的那一颗，正好从那头进来。
    //
    // 每一颗自己挪自己的（drag.slotsAt(i)）：手指下面那颗跟得紧，越往两头越
    // 慢半拍——弹簧在 src/engine/dragChain.ts，和网页版同一份。
    //
    // 淡出淡入的规矩也照网页版：滑出线两端之外的那一段按 FADE_RANGE 淡掉，
    // 补位的那两份最浓只到 0.55——一眼能看出「那是绕回来的影子，不是又多出
    // 一颗棋子」。
    const n = drag.cells.length;
    const step = STEP_UNITS * unit;
    const FADE_RANGE = 0.4;
    const fadeAt = (pos: number) => {
      const over = pos < 0 ? -pos : pos > n - 1 ? pos - (n - 1) : 0;
      return Math.max(0, 1 - over / FADE_RANGE);
    };
    for (let k = -1; k <= 1; k++) {
      for (let i = 0; i < n; i++) {
        const slots = drag.slotsAt(i);
        const pos = i + slots + k * n;
        const alpha = fadeAt(pos) * (k === 0 ? 1 : 0.55);
        if (alpha <= 0.01) continue;
        const [r, c] = drag.cells[i];
        const [px, py] = pixelOf(board, layout, r, c);
        const off = (pos - i) * step;
        ctx.save();
        ctx.globalAlpha = alpha;
        // 挤到一起的那一下压扁一点：顺着拖动方向压，横着不动（同网页版的
        // pressScale）。
        const squash = drag.pressAt(i) * SQUASH * BOARD_FORCE;
        const cx = px + drag.vec[0] * off;
        const cy = py + drag.vec[1] * off;
        if (squash > 0.0005) {
          ctx.translate(cx, cy);
          ctx.scale(1 - squash * Math.abs(drag.vec[0]), 1 - squash * Math.abs(drag.vec[1]));
          ctx.translate(-cx, -cy);
        }
        drawPiece(ctx, board.tileAt(r, c), board.kind, cx, cy, unit, palette);
        ctx.restore();
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
/**
 * 顶上那三格读数。
 *
 * 照网页版（style.css 的 .app--game .hud）：三块等宽的橙金圆角矩形，里面只
 * 有数字，没有标签——玩家定的「少文字」。顺序是 flex-direction: row-reverse
 * 出来的那一版：用时在左，有效得分率在中，得分在右，「越往右越是要紧的那个
 * 数」。
 *
 * 返回三格各自的方框，得分那一格要拿它冒加分气泡。
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  top: number,
  m: PlayMetrics,
  hud: HudData,
): { score: [number, number, number, number] } {
  const values = [fmtTime(hud.elapsedSec), hud.ratePercent + '%', String(hud.score)];
  const cellW = (width - m.padSide * 2 - m.chipGap * 2) / 3;
  let scoreBox: [number, number, number, number] = [0, 0, 0, 0];
  values.forEach((value, i) => {
    const x = m.padSide + i * (cellW + m.chipGap);
    ctx.fillStyle = PLAY.chip;
    roundRect(ctx, x, top, cellW, m.chipH, m.chipR);
    ctx.fill();
    ctx.fillStyle = PLAY.chipInk;
    ctx.font = FONT_NUM(m.chipFont);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x + cellW / 2, top + m.chipH / 2 + m.chipFont * 0.04);
    if (i === 2) scoreBox = [x, top, cellW, m.chipH];
  });
  return { score: scoreBox };
}

/**
 * 底下那两颗键：《暂停》和《完成》。
 *
 * 照网页版（.app--game .controls .icon-btn）：和读数同宽同高的橙金圆角矩形，
 * 正中一个红圆，圆里一个白记号（两根竖条 / 一个对勾）。按下去橙金变赭红、
 * 记号反色——那一下的手感是「键按下去了」，不是「状态变了」。
 */
export function drawControls(
  ctx: CanvasRenderingContext2D,
  width: number,
  top: number,
  m: PlayMetrics,
  pressed: 'pause' | 'finish' | null,
): { pause: [number, number, number, number]; finish: [number, number, number, number] } {
  const cellW = (width - m.padSide * 2 - m.chipGap) / 2;
  const boxes: [number, number, number, number][] = [];
  (['pause', 'finish'] as const).forEach((kind, i) => {
    const x = m.padSide + i * (cellW + m.chipGap);
    const down = pressed === kind;
    ctx.fillStyle = down ? PLAY.chipPress : PLAY.chip;
    roundRect(ctx, x, top, cellW, m.chipH, m.chipR);
    ctx.fill();
    // 红圆：高度的六成半，和网页版那颗圆的比例一样。
    const cx = x + cellW / 2;
    const cy = top + m.chipH / 2;
    const r = m.chipH * 0.325;
    ctx.fillStyle = down ? PLAY.chipPressInk : PLAY.btnDisc;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = down ? PLAY.chipPress : PLAY.btnMark;
    ctx.strokeStyle = ctx.fillStyle;
    if (kind === 'pause') {
      // 两根竖条。
      const bw = r * 0.24;
      const bh = r * 0.92;
      roundRect(ctx, cx - r * 0.36 - bw / 2, cy - bh / 2, bw, bh, bw / 2);
      ctx.fill();
      roundRect(ctx, cx + r * 0.36 - bw / 2, cy - bh / 2, bw, bh, bw / 2);
      ctx.fill();
    } else {
      // 对勾。
      ctx.lineWidth = r * 0.26;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.46, cy + r * 0.02);
      ctx.lineTo(cx - r * 0.12, cy + r * 0.38);
      ctx.lineTo(cx + r * 0.5, cy - r * 0.4);
      ctx.stroke();
    }
    boxes.push([x, top, cellW, m.chipH]);
  });
  return { pause: boxes[0], finish: boxes[1] };
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
