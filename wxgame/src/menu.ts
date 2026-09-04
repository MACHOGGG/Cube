/**
 * 小游戏的主菜单和开局倒数。
 *
 * 网页版的主菜单是一页 DOM，图标是玩家画的 SVG；小游戏没有 DOM，也不该为
 * 了几个图标去下载一堆图片文件（包体越小启动越快）。所以这儿的图标是用画布
 * 现画的——同一副形状、同一套颜色，只是画法换了。
 *
 * 菜单上只摆做好了的玩法。少一张卡片，好过摆一张按下去什么也不发生的卡片
 * （玩家的原话：「不要出现意料外的界面」）。小球、三角做好了往 GAMES 里加
 * 一行就是了，排版自己会跟上。
 */
import { COLORS, roundRect } from './render';

/** 菜单上一张卡片：一个图形、一个名字，按下去开这一局。 */
export interface MenuEntry {
  id: string;
  name: string;
  /** 在给定的方框里画这个玩法的标志。 */
  icon: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;
}

/** 卡片在屏幕上的位置——主循环拿它做点击命中。 */
export interface MenuHit {
  id: string;
  rect: [number, number, number, number];
}

/** 网页版主菜单上那三张基础玩法的配色（灰底 + 四种糖果色）。 */
const MARK_BG = '#A8A5A0';
const MARK_COLORS = ['#4C7EAD', '#E2941F', '#C0392B', '#2E8B45'];

/** 方块：灰圆角方块底，里面四小块。 */
export function iconSquare(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = MARK_BG;
  roundRect(ctx, x, y, s, s, s * 0.16);
  ctx.fill();
  const pad = s * 0.16;
  const gap = s * 0.045;
  const cell = (s - pad * 2 - gap) / 2;
  for (let i = 0; i < 4; i++) {
    const cx = x + pad + (i % 2) * (cell + gap);
    const cy = y + pad + Math.floor(i / 2) * (cell + gap);
    ctx.fillStyle = MARK_COLORS[i];
    roundRect(ctx, cx, cy, cell, cell, cell * 0.22);
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = Math.max(1.5, s * 0.022);
    ctx.stroke();
  }
}

/** 小球：灰圆底，里面几颗小球。 */
export function iconCircle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = MARK_BG;
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  ctx.fill();
  const r = s * 0.115;
  const spots: [number, number, number][] = [
    [0.5, 0.28, 1],
    [0.32, 0.5, 3],
    [0.68, 0.5, 0],
    [0.5, 0.72, 2],
  ];
  for (const [fx, fy, ci] of spots) {
    ctx.fillStyle = MARK_COLORS[ci];
    ctx.beginPath();
    ctx.arc(x + s * fx, y + s * fy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = Math.max(1.5, s * 0.022);
    ctx.stroke();
  }
}

/** 一个（圆角）正三角，尖朝上。 */
function trianglePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const h = (size * Math.sqrt(3)) / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + size / 2, cy + h / 2);
  ctx.lineTo(cx - size / 2, cy + h / 2);
  ctx.closePath();
}

/** 三角：灰三角底，里面三个小三角。 */
export function iconTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = MARK_BG;
  trianglePath(ctx, x + s / 2, y + s / 2, s);
  ctx.fill();
  const small = s * 0.26;
  const spots: [number, number, number][] = [
    [0.5, 0.42, 1],
    [0.34, 0.66, 2],
    [0.66, 0.66, 3],
  ];
  for (const [fx, fy, ci] of spots) {
    ctx.fillStyle = MARK_COLORS[ci];
    trianglePath(ctx, x + s * fx, y + s * fy, small);
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = Math.max(1.5, s * 0.022);
    ctx.stroke();
  }
}

export interface MenuText {
  title: string;
  tagline: string;
}

/**
 * 画主菜单，返回每张卡片占的方框。
 *
 * 一排最多三张（和网页版一样），摆不下就往下一排放；每张一样大，一排里几张
 * 就把这排的宽平分成几份，整体居中。
 */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  entries: readonly MenuEntry[],
  text: MenuText,
): MenuHit[] {
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, width, height);

  const titleY = Math.max(72, height * 0.14);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 ${Math.round(Math.min(width * 0.11, 46))}px sans-serif`;
  ctx.fillText(text.title, width / 2, titleY);
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = `${Math.round(Math.min(width * 0.038, 16))}px sans-serif`;
  ctx.fillText(text.tagline, width / 2, titleY + 26);

  const perRow = Math.min(3, Math.max(1, entries.length));
  const rows = Math.ceil(entries.length / perRow);
  const gap = Math.round(width * 0.05);
  const side = Math.round(width * 0.06);
  // 一张卡片有多大：横着按「这一排三等分」，竖着按剩下的高度均分，取小的那
  // 个——两头都不越界，整页也就不用滚。
  const byWidth = (width - side * 2 - gap * (perRow - 1)) / perRow;
  const top = titleY + 56;
  const bottom = height - Math.max(40, height * 0.08);
  const byHeight = (bottom - top - gap * (rows - 1)) / rows - 26;
  const size = Math.max(64, Math.min(byWidth, byHeight, 190));

  const hits: MenuHit[] = [];
  const blockH = size + 26;
  const startY = top + Math.max(0, (bottom - top - (blockH * rows + gap * (rows - 1))) / 2);
  for (let i = 0; i < entries.length; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, entries.length - row * perRow);
    const col = i - row * perRow;
    const rowW = size * inRow + gap * (inRow - 1);
    const x = Math.round((width - rowW) / 2 + col * (size + gap));
    const y = Math.round(startY + row * (blockH + gap));
    entries[i].icon(ctx, x, y, size);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 ${Math.round(Math.min(size * 0.16, 18))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(entries[i].name, x + size / 2, y + size + 20);
    hits.push({ id: entries[i].id, rect: [x, y, size, size + 26] });
  }
  return hits;
}

/**
 * 开局倒数：这一局的图形在上，底下一个越来越小的数字。
 *
 * @param n 还剩几秒（4、3、2、1）。
 * @param phase 这一秒走了多少（0→1），用来做那一下缩放。
 */
export function drawCountdown(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  entry: MenuEntry,
  n: number,
  phase: number,
): void {
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, width, height);
  const size = Math.min(width * 0.42, 180);
  const x = (width - size) / 2;
  const y = height * 0.28 - size / 2;
  entry.icon(ctx, x, y, size);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 ${Math.round(Math.min(width * 0.05, 20))}px sans-serif`;
  ctx.fillText(entry.name, width / 2, y + size + 30);
  // 每个数字自己从大缩到正常，落定时正好整秒——和网页版开局那一幕一个意思。
  const scale = 1.5 - 0.5 * Math.min(1, phase * 3);
  const fs = Math.round(Math.min(width * 0.28, 120) * scale);
  ctx.fillStyle = COLORS.accent;
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.fillText(String(n), width / 2, height * 0.72);
}
