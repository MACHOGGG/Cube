/**
 * 反面那颗「＊」——三副棋盘现在共用的同一个记号。
 *
 * 从前三族各画各的：小球是这三笔，方块是一颗实心小圆，三角是一个缩小的同向
 * 小三角加深色描边。玩家在 2026-09 定下统一：「把正方形和三角形的反面后变成
 * 和小球一样的星星标记『*』……颜色和对照关系什么的都不变……注意现在小球玩法
 * 的『*』就很好，请按照现在的设计来统一」。所以这里搬的就是小球那一份，不是
 * 另画一个。
 *
 * 为什么是三笔画的线，不是「＊」这个字：字要靠字体，各家字体里星号的位置、
 * 粗细、甚至有没有都不一样，画出来会在格子里偏上偏下。三条线自己定坐标，走
 * 到哪台机器上都正中、都一样粗。
 *
 * 24×24 是它的原始坐标系（小球那边一直用的），下面几个函数都只是把它搬到各自
 * 的画布上：DOM 棋盘用 SVG，战绩图用 canvas（engine/shareCard.ts 自己有一份
 * 同样的线段表，那边是离线画图，不引 ui 层）。
 */

/** 三笔：一竖，两斜。坐标在 24×24 里，中心 (12,12)。 */
export const ASTERISK_SEGS: readonly [[number, number], [number, number]][] = [
  [[12, 2.5], [12, 21.5]],
  [[4, 6.75], [20, 17.25]],
  [[20, 6.75], [4, 17.25]],
];

/** 笔画粗细，也在 24 的坐标系里——跟着 size 一起缩放。 */
export const ASTERISK_STROKE = 5.5;

/**
 * 一枚反面，画成 SVG。
 *
 * @param size 这颗星占多少像素见方。小球那边给的是格子的 0.95。
 * @param color 点面的颜色（COLORS[tile.dotColor]），一个字都不变。
 */
export function asteriskSvg(size: number, color: string): string {
  const s = Math.round(size);
  return (
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}">` +
    `<g stroke="${color}" stroke-width="${ASTERISK_STROKE}" stroke-linecap="round">` +
    ASTERISK_SEGS.map(([[x1, y1], [x2, y2]]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('') +
    `</g></svg>`
  );
}

/**
 * 同一颗星，摆进一块已经存在的 SVG 里（三角用的是这一支）。
 *
 * 三角的外框是个方的，可它自己是斜的：照外框算大小，星星的两只斜角会顶出斜
 * 边去。所以三角那边传进来的是**内切圆的直径**，不是外框的边长——见
 * triInradius()。
 *
 * @param cx,cy 这颗星的中心，在目标 SVG 自己的坐标里。
 * @param size 星星占多少见方（同上）。
 */
export function asteriskGroup(cx: number, cy: number, size: number, color: string): string {
  const k = size / 24;
  return (
    `<g transform="translate(${(cx - size / 2).toFixed(2)},${(cy - size / 2).toFixed(2)}) scale(${k.toFixed(4)})"` +
    ` stroke="${color}" stroke-width="${ASTERISK_STROKE}" stroke-linecap="round" fill="none">` +
    ASTERISK_SEGS.map(([[x1, y1], [x2, y2]]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('') +
    `</g>`
  );
}

/** 三角形的内切圆半径 = 面积 / 半周长。三角上那颗星按它定大小。 */
export function triInradius(pts: readonly (readonly [number, number])[]): number {
  const d = (p: readonly [number, number], q: readonly [number, number]) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const [a, b, c] = [pts[0], pts[1], pts[2]] as [number, number][];
  const s = (d(b, c) + d(a, c) + d(a, b)) / 2;
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  return s > 0 ? area / s : 0;
}

/** 三角形的重心——星星摆在这儿，不是外框的正中。 */
export function triCentroid(pts: readonly (readonly [number, number])[]): [number, number] {
  return [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
}

/** 星星占内切圆的多少。小球那边是格子的 0.95，这里对着内切圆同一个数。 */
export const TRI_STAR_OF_INRADIUS = 0.95;
