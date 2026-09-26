/**
 * Pro 模式那一圈：**这一枚得分之后会变成什么颜色的星星**，描在它外侧。
 *
 * 玩家 2026-09 给了三张参考图（方块、三角、小球），并且点明「只参考外边的形式和粗
 * 细……需要是明显知道是非常次要的色彩信息」。照着量出来的就是下面这两个比例：线宽约
 * 是一枚棋子的 4.5%（那三张图上量到 2%–4%，取上沿，屏幕上一枚棋子才 50–70px，再细就
 * 看不见了），最细不低于 1.4px。
 *
 * 形式按族分，也是照那三张图：
 *   · 方块——**虚线**（玩家：「方块只参考最上第一行」，那一行画的是虚线）；
 *   · 小球——整整一圈实线；
 *   · 三角——贴着三条边的一条细线。
 * 前两样纯靠 CSS 画（见 shapes/square.css、shapes/circle.css）：这个模块只把颜色和线
 * 宽写成两个自定义属性挂在棋子上，开没开 Pro 由 <html> 上那个 data-pro 说了算——**所
 * 以拨开关不用重画棋盘**。
 * 三角那一族是另一回事：它的棋子是一个被 clip-path 剪成三角的方盒子，剪刀连子元素一
 * 起剪，描在外面的一圈会被剪掉。所以它那一圈是真画进去的一段 SVG 描边，压在轮廓线上
 * ——外面那一半被剪掉，剩下贴着边的一条，正好是参考图上那个样子。
 */
import { roundTriPath } from './roundTri';

/** 线宽 = 棋子的这个比例。照那三张参考图量的（2%–4%），取中间。 */
const W_RATIO = 0.03;
/** 再细就看不见了。 */
const W_MIN = 1.2;

/** 方块的圆角，和 shapes/square.css 里 `.tile` 的 border-radius 必须是同一个数。 */
export const TILE_RADIUS = 8;

export function proHintWidth(size: number): number {
  return Math.max(W_MIN, Math.round(size * W_RATIO * 10) / 10);
}

/**
 * 小球：把颜色和线宽挂上去，剩下的交给 CSS（shapes/circle.css 那条 ::after）。
 *
 * `color` 给 null 就什么都不挂（翻过面的、空位的棋子没有「将来会变成什么」可说）。
 * 不管开没开 Pro 都挂：这两个属性不画任何东西，画不画由 `html[data-pro='1']` 决定，
 * 于是拨开关那一下是纯样式的事，棋盘一帧都不用重画。
 */
export function setProHint(el: HTMLElement, color: string | null, size: number): void {
  if (!color) return;
  el.style.setProperty('--pro-next', color);
  el.style.setProperty('--pro-w', proHintWidth(size) + 'px');
}

/**
 * 方块：套在棋子外面的一圈**虚线**（玩家：「方块只参考最上第一行」，那一行是虚线）。
 *
 * 为什么不用 CSS 的 `border-style: dashed`：那一套的虚线节奏由浏览器按线宽定，2px 的
 * 边描出来是一串 4px 的小段——一格六十来像素的方块，一条边上排了十来段，整幅棋盘成了
 * 一张网格布，那不是「非常次要的色彩信息」。参考图上一条边只有两三段长的。
 * SVG 能定：`pathLength="100"` 把整圈的长度归一化成 100，于是 `stroke-dasharray` 写的
 * 就是「占整圈的百分之几」，和棋子多大无关——一圈九段，一条边上两段多一点。
 */
export function proSquareRing(size: number, radius: number, color: string, width: number): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.classList.add('pro-square');
  const rect = document.createElementNS(svgNS, 'rect');
  // 描在棋子**外面**：矩形的中线落在棋子边缘外半个线宽处，所以整条线都在棋子之外，
  // 棋子自己的颜色一个像素没被盖住。圆角跟着一起往外让，两条弧才是同心的。
  const off = width;
  rect.setAttribute('x', String(-off));
  rect.setAttribute('y', String(-off));
  rect.setAttribute('width', String(size + off * 2));
  rect.setAttribute('height', String(size + off * 2));
  rect.setAttribute('rx', String(radius + off));
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', String(width));
  rect.setAttribute('pathLength', '100');
  rect.setAttribute('stroke-dasharray', '7.1 4');
  rect.setAttribute('stroke-linecap', 'round');
  svg.appendChild(rect);
  return svg;
}

/**
 * 三角：沿着这一枚自己的轮廓描一段，压在边线上。
 *
 * 线宽给的是**两倍**：外面那一半会被 clip-path 剪掉，剩下贴着边的一条正好是要的宽度。
 * 点用的是这一枚在棋盘上的真坐标，和它自己的 clip-path 同一份（所以两条线严丝合缝）。
 */
export function proTriRing(
  pts: readonly [number, number][],
  box: { minX: number; minY: number; w: number; h: number },
  color: string,
  width: number,
): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('pro-tri');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute(
    'd',
    roundTriPath(
      pts.map(([x, y]) => [((x - box.minX) / box.w) * 100, ((y - box.minY) / box.h) * 100] as [number, number]),
    ),
  );
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', String(width * 2));
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);
  return svg;
}
