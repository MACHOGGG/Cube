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

/** Set on a live bomb still showing its front face, so the thumbnail marks
 *  it with the same "!" the board does — without it a bomb run's picture is
 *  just a board with some red pieces in it, and the one thing that made the
 *  run a bomb run is the thing the picture leaves out. A bomb that has been
 *  turned is no longer a hazard, so it is never flagged on a dot face. */
type Hazard = { hazard?: boolean };

export type SnapshotCell =
  | ({ kind: 'circle'; cx: number; cy: number; r: number; face: CellFace; color: string } & Hazard)
  | ({ kind: 'rect'; cx: number; cy: number; half: number; face: CellFace; color: string; rotateDeg?: number } & Hazard)
  | ({ kind: 'poly'; points: [number, number][]; face: CellFace; color: string } & Hazard);

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
  // 4 decimals of board-space (≤0.1px on any real thumbnail): snapshots are
  // archived to localStorage per finished run, so their JSON stays compact.
  const R4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const T = (x: number, y: number): [number, number] => [R4((x - minX) * scale + offX), R4((y - minY) * scale + offY)];
  return {
    cells: raw.map((c): SnapshotCell => {
      if (c.kind === 'circle') {
        const [cx, cy] = T(c.cx, c.cy);
        return { kind: 'circle', cx, cy, r: R4(c.r * scale), face: c.face, color: c.color, hazard: c.hazard };
      }
      if (c.kind === 'rect') {
        const [cx, cy] = T(c.cx, c.cy);
        return { kind: 'rect', cx, cy, half: R4(c.half * scale), face: c.face, color: c.color, rotateDeg: c.rotateDeg, hazard: c.hazard };
      }
      return { kind: 'poly', face: c.face, color: c.color, hazard: c.hazard, points: c.points.map(([x, y]) => T(x, y)) };
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

/** The board's own "!", in the card's own units: white Fraunces over the
 *  piece, sunk a little toward a triangle's centroid the way the live board
 *  sinks it, and sized off the piece's shorter axis so it never spills out
 *  of one. */
function drawHazardMark(ctx: CanvasRenderingContext2D, cell: SnapshotCell, size: number) {
  let cx: number, cy: number, em: number;
  if (cell.kind === 'circle') {
    cx = cell.cx * size;
    cy = cell.cy * size;
    em = cell.r * size * 1.1;
  } else if (cell.kind === 'rect') {
    cx = cell.cx * size;
    cy = cell.cy * size;
    em = cell.half * size * 1.05;
  } else {
    const xs = cell.points.map((p) => p[0] * size);
    const ys = cell.points.map((p) => p[1] * size);
    cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    // A triangle's centroid is a third of the way up from its base, which is
    // where the eye reads its middle — not the bounding box's centre.
    cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    em = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.55;
  }
  if (em < 2) return;
  ctx.save();
  ctx.font = `700 ${em.toFixed(1)}px Fraunces, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowOffsetY = Math.max(1, em * 0.06);
  ctx.shadowBlur = Math.max(1, em * 0.12);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('!', cx, cy);
  ctx.restore();
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
      if (cell.hazard) drawHazardMark(ctx, cell, size);
    }
  }
  ctx.restore();
}

import { STRINGS, type Lang } from '../i18n';
import { QR_MATRIX, QR_QUIET_MODULES } from './qrSlides';
import { ICON_BOMB_BADGE, ICON_MULTIPLAYER } from '../ui/homeIcons';

/**
 * 战绩图上那两个小标志（炸弹局、多人竞赛）。
 *
 * 它们和主菜单、开局页用的是同一份 SVG——玩家换过的那份也算——所以只能把 SVG
 * 画进画布，不能在这里另画一个。canvas 画 SVG 要先解码成图片，而解码是异步
 * 的；战绩图这一支是同步出图的，所以在模块加载时就把两张解好放着，等到有人打
 * 完一局要图的时候早就好了。真要是没好（第一局结束得比解码还快），那就少这一
 * 个标志，别为它把整张图拖成异步。
 */
function badgeImage(svg: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const tagEnd = svg.indexOf('>');
  if (!svg.startsWith('<svg') || tagEnd < 0) return null;
  let tag = svg.slice(0, tagEnd);
  // 补在根标签上，缺一样这张图就加载不出来——而且是静悄悄地加载不出来：
  //   xmlns —— 内嵌在网页里的 <svg> 不需要它（HTML 解析器自己会给命名空间），
  //            当成一张图片加载时没有它就不是合法 SVG。
  //   宽高 —— 只有 viewBox 的 SVG 画进画布时各家浏览器取的固有尺寸不一样。
  // 三样都只在「原本没有」时才补：SVG 走的是 XML 解析，同一个属性写两遍是致命
  // 错误，整张图直接不解析。你自己画的图标文件多半已经带着 width/height 了。
  const box = /viewBox="([\d.\s-]+)"/.exec(tag);
  const nums = (box?.[1] ?? '0 0 100 100').trim().split(/\s+/).map(Number);
  if (!/\swidth=/.test(tag)) tag += ` width="${nums[2] || 100}"`;
  if (!/\sheight=/.test(tag)) tag += ` height="${nums[3] || 100}"`;
  if (!/\sxmlns=/.test(tag)) tag += ' xmlns="http://www.w3.org/2000/svg"';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tag + svg.slice(tagEnd));
  return img;
}
const BADGE_BOMB = badgeImage(ICON_BOMB_BADGE);
const BADGE_ROOM = badgeImage(ICON_MULTIPLAYER);

/** 画在标题右边的一排小标志。画不出来的那张就跳过，其余照排。 */
function drawModeBadges(
  ctx: CanvasRenderingContext2D,
  marks: (HTMLImageElement | null)[],
  x: number,
  y: number,
  size: number,
): void {
  let at = x;
  for (const img of marks) {
    if (!img?.complete || !img.naturalWidth) continue;
    const w = size * (img.naturalWidth / img.naturalHeight);
    ctx.drawImage(img, at, y, w, size);
    at += w + 8;
  }
}

export interface ShareCardInfo {
  shapeName: string;
  bestKey?: string;
  totalScore: number;
  scoreRows: [label: string, value: string][];
  detail: string;
  /** True when this run ended via a bomb hazard cluster — draws a large, low-opacity 💥 behind the card. */
  hazardEnd?: boolean;
  /** 炸弹局。和 hazardEnd 不是一回事——那个说的是「这一局是被炸掉的」，这个说
   *  的是「这一局本来就有炸弹」，一局炸弹局安然打完，标志照挂。 */
  bomb?: boolean;
  /** 多人竞赛的一局。不写就看有没有名次表。 */
  room?: boolean;
  lang: Lang;
  /**
   * The room, when this run was one board out of four people's evening.
   *
   * A solo card is about a board; a room's is about the people around it,
   * so the two panels give up some of their size and the places go in the
   * room they free. Absent for a solo run, which is then exactly what it was.
   */
  standings?: Standing[];
}

/** One player's line on a room card: who, where they came, what they scored. */
export interface Standing {
  name: string;
  score: number;
  /** Their own row is the one the person holding the card looks for. */
  me?: boolean;
}

const CARD_W = 720;
const PAD = 80;
// Canvases are rendered at this multiple of the card's logical CSS-pixel
// layout (all the coordinate math below stays in logical units — only the
// backing pixel buffer and a single ctx.scale grow) so the exported PNG is
// crisp at typical phone/desktop pixel densities instead of blurry when
// zoomed into or saved at native size.
const EXPORT_SCALE = 3;

/**
 * Draws the pre-encoded Slides QR (see qrSlides.ts) into a square box, with
 * the invitation under it.
 *
 * 码子直接落在卡片的米色底上，底下不再垫一块白方块。那块白的本来是想「保证
 * 扫得动」，可扫码要的是深浅分得开，不是非白不可：这张卡的底是 #faf9f5，和
 * 码子的 #141413 差着二十多倍的亮度，任何一台手机都读得出来。去掉它，右上角
 * 就不再是贴上去的一张贴纸，而是印在同一张纸上的东西。
 *
 * 两种卡（一局的战绩、整房的排名）共用这一个函数，「所有分享图里的码子长得
 * 一样」这件事才不用靠两处各自记得。
 */
export function drawQr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  caption?: string,
) {
  const modules = QR_MATRIX.length + QR_QUIET_MODULES * 2;
  const m = size / modules;
  ctx.fillStyle = '#141413';
  for (let r = 0; r < QR_MATRIX.length; r++) {
    const row = QR_MATRIX[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '1') continue;
      // Cells are drawn a hair oversized so neighbouring dark modules meet
      // cleanly instead of showing seams from fractional-pixel rounding.
      ctx.fillRect(
        x + (c + QR_QUIET_MODULES) * m,
        y + (r + QR_QUIET_MODULES) * m,
        m + 0.5,
        m + 0.5,
      );
    }
  }
  if (caption) {
    ctx.font = '500 13px "Karla", sans-serif';
    ctx.fillStyle = '#5b5650';
    ctx.textAlign = 'center';
    ctx.fillText(caption, x + size / 2, y + size + 18);
    ctx.textAlign = 'left';
  }
}

/**
 * Renders the composed PNG data URL: the run's headline score and breakdown
 * up top, then the board as it started and as it finished, side by side, so
 * the picture shows what the run actually did rather than just where it
 * landed. A QR to the Slides page sits in the top corner.
 */
export function renderShareCard(
  info: ShareCardInfo,
  endSnap: BoardSnapshot | null,
  startSnap: BoardSnapshot | null = null,
): string {
  const s = STRINGS[info.lang];
  const boardY = 300;
  const gap = 28;
  // A room card gives the two boards a little over half the width they get
  // on their own, and spends what it saves on the places — on a shared card
  // 谁赢了 is the part everyone reads first.
  const standings = info.standings ?? [];
  const full = (CARD_W - PAD * 2 - gap) / 2;
  const panel = standings.length ? full * 0.62 : full;
  const cardH = boardY + panel + (standings.length ? 132 : 110);

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
  // 这一局是哪一种局，挂在玩法名右边：炸弹局一颗炸弹，多人竞赛一扇门。开局页
  // 上挂的是同样这两个，同一局的两张画面因此对得上。
  drawModeBadges(
    ctx,
    [info.bomb ? BADGE_BOMB : null, (info.room ?? standings.length > 0) ? BADGE_ROOM : null],
    PAD + ctx.measureText(info.shapeName).width + 14,
    84,
    32,
  );

  // The QR and its caption own the top-right corner; the breakdown rows sit
  // below them rather than beside, so neither has to shrink.
  const qrSize = 96;
  drawQr(ctx, CARD_W - PAD - qrSize, 40, qrSize, s.shareQrCaption);

  ctx.font = '700 88px "JetBrains Mono", monospace';
  ctx.fillStyle = '#BE5762';
  ctx.fillText(String(info.totalScore), PAD, 210);
  ctx.font = '500 15px "Karla", sans-serif';
  ctx.fillStyle = '#5b5650';
  ctx.fillText(s.compositeScoreLabel, PAD + 2, 232);

  ctx.font = '500 15px "JetBrains Mono", monospace';
  ctx.fillStyle = '#8b8680';
  let rowY = 186;
  const rowX = CARD_W - PAD;
  for (const [label, value] of info.scoreRows) {
    ctx.textAlign = 'right';
    ctx.fillText(`${label} ${value}`, rowX, rowY);
    rowY += 22;
  }
  ctx.textAlign = 'left';
  ctx.font = '500 13px "Karla", sans-serif';
  ctx.fillStyle = '#8b8680';
  ctx.fillText(info.detail, PAD, 268);

  // Start on the left, end on the right, each centred in its own panel.
  const panels: [number, BoardSnapshot | null, string][] = [
    [PAD, startSnap, s.shareStartLabel],
    [PAD + panel + gap, endSnap, s.shareEndLabel],
  ];
  for (const [x, snap, label] of panels) {
    ctx.fillStyle = '#f0ece4';
    roundRect(ctx, x, boardY, panel, panel, 20);
    ctx.fill();
    if (snap) {
      const inset = panel * 0.08;
      drawSnapshot(ctx, snap, x + inset, boardY + inset, panel - inset * 2);
    }
    ctx.font = '600 15px "Karla", sans-serif';
    ctx.fillStyle = '#5b5650';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + panel / 2, boardY + panel + 30);
    ctx.textAlign = 'left';
  }

  // The places, in the column the shrunken boards left free. The rows are
  // sized to that column rather than being a fixed height: four players get
  // a comfortable list, and twelve still end inside the card instead of
  // running off the bottom of it.
  if (standings.length) {
    const listX = PAD + panel * 2 + gap + 26;
    const listRoom = panel + 30;
    const rowH = Math.min(38, Math.max(18, (listRoom - 20) / standings.length));
    drawStandings(ctx, standings, listX, boardY, CARD_W - PAD - listX, s.mpRoundResult, rowH);
  }

  ctx.font = '500 13px "Karla", sans-serif';
  ctx.fillStyle = '#a39e97';
  ctx.textAlign = 'center';
  ctx.fillText(s.shareFooterHint, CARD_W / 2, cardH - 30);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

/**
 * A ranked column: place, name, score. Used by the per-round card beside the
 * boards, and by the room's closing card as the whole of its middle.
 */
/**
 * 小王冠。金的给第一，银的给第二。
 *
 * 画成路径而不是用 🏆/👑 那种字符：同一个码位在 iOS、安卓、Windows 上是三
 * 张完全不同的图，而且不少安卓机的系统字体里根本没有这一个，落到战绩图上
 * 就是一个豆腐块。路径到哪都一样。
 */
function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
  const u = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(u, u);
  ctx.beginPath();
  ctx.moveTo(2, 8);
  ctx.lineTo(7, 13.5);
  ctx.lineTo(12, 3.5);
  ctx.lineTo(17, 13.5);
  ctx.lineTo(22, 8);
  ctx.lineTo(20, 20.5);
  ctx.lineTo(4, 20.5);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/** 冠军的金、亚军的银。两支都调得比正文暗一点，压在米白纸上不发飘。 */
export const CROWN_GOLD = '#D2A017';
export const CROWN_SILVER = '#9FA6AE';

/**
 * 这一排该不该有王冠、什么颜色。
 *
 * 规矩是玩家定的：两个人的时候只有冠军戴，三个人往上亚军也戴一顶银的。
 * 两个人的第二名就是「输的那个」，给他一顶冠冕是在开玩笑。
 */
function crownFor(place: number, total: number): string | null {
  if (place === 0) return CROWN_GOLD;
  if (place === 1 && total >= 3) return CROWN_SILVER;
  return null;
}

export function drawStandings(
  ctx: CanvasRenderingContext2D,
  rows: Standing[],
  x: number,
  y: number,
  width: number,
  title: string,
  rowH = 38,
  /** 名次旁边加王冠——整房的排名图要，单局那一列不要。 */
  crowns = false,
) {
  ctx.font = '600 14px "Karla", sans-serif';
  ctx.fillStyle = '#8b8680';
  ctx.textAlign = 'left';
  ctx.fillText(title, x, y + 4);

  rows.forEach((row, i) => {
    const top = y + 20 + i * rowH;
    if (row.me) {
      ctx.fillStyle = '#f2e6e6';
      roundRect(ctx, x - 8, top, width + 8, rowH - 6, 9);
      ctx.fill();
    }
    const mid = top + (rowH - 6) / 2 + 5;
    // First place is the accent; everyone else is ordinary ink, so the
    // winner is findable without reading a single name.
    ctx.fillStyle = i === 0 ? '#BE5762' : '#8b8680';
    ctx.font = '700 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(i + 1), x, mid);

    ctx.fillStyle = row.me ? '#BE5762' : '#141413';
    ctx.font = `${row.me ? 700 : 500} 15px "Karla", sans-serif`;
    const crown = crowns ? crownFor(i, rows.length) : null;
    // 王冠占的位置要先从名字能用的宽度里扣掉，否则一个长名字会把冠推到
    // 分数上面去。
    const crownRoom = crown ? 22 : 0;
    const name = clipTo(ctx, row.name, width - 76 - crownRoom);
    ctx.fillText(name, x + 20, mid);
    if (crown) drawCrown(ctx, x + 20 + ctx.measureText(name).width + 5, mid - 13, 15, crown);

    ctx.fillStyle = i === 0 ? '#BE5762' : '#5b5650';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(row.score), x + width - 6, mid);
    ctx.textAlign = 'left';
  });
}

/** A name that would run past its column, cut and given an ellipsis. */
function clipTo(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > max) cut = cut.slice(0, -1);
  return cut + '…';
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
