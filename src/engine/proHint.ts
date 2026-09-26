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
 * 三族都是一段 SVG 描边，不是 CSS 的边框：**虚线的节奏得自己定**，而 CSS 的
 * `border-style: dashed` 只会按线宽排一串小段（一条边上十来段，整幅棋盘成了一张网格
 * 布）。SVG 的 `pathLength="100"` 把整条轮廓归一化成 100 份，于是「一条边上几段、落
 * 在哪儿」写出来就是几个数，和棋子多大无关——照着参考图量出来的那几个数见下面。
 *
 * 线压在棋子自己的轮廓上（一半在里、一半在外）。三角那一族例外地描两倍宽：它的棋子是
 * 一个被 clip-path 剪成三角的方盒子，剪刀连子元素一起剪，外面那一半会被剪掉，露出来的
 * 正好是一个线宽。
 */
import { roundTriPath } from './roundTri';

/** 线宽 = 棋子的这个比例。照那三张参考图量的（2%–4%），取中间。 */
const W_RATIO = 0.03;
/** 再细就看不见了。 */
const W_MIN = 1.2;
/**
 * 再粗就不是「次要信息」了（玩家 2026-09：「三角的边框太粗」）。
 * 三角那一族的棋子比方块、小球都大（一条边一百来像素），按比例算会到 3px 以上，比旁
 * 边两族的线粗一半——这条上限把三族拉到同一个观感。
 */
const W_MAX = 2;

/** 方块的圆角，和 shapes/square.css 里 `.tile` 的 border-radius 必须是同一个数。 */
export const TILE_RADIUS = 8;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 虚线的节奏，三族各一套，全是照玩家那三张参考图量出来的。写成 `pathLength="100"` 上
 * 的份数，所以和棋子多大、那条边多长都没关系——同一副节奏在任何屏幕上都一样。
 *
 *   · 方块：一条边上两段（参考图那一行数出来的），四条边共八段 → 段 8.5、缺 4；
 *     整体挪半段，让四个角落在缺口里（角上那一段弧最不该被描）。
 *   · 小球：两段，缺口在正上和正下（量到缺口 ≈ 50°、每段 ≈ 130°）→ 段 36、缺 14，
 *     再整体挪 32（`<circle>` 从三点钟起步顺时针走，十二点在 75、六点在 25）。
 *   · 三角：一条边一段，三段（参考图上那一段从尖角往下约 11%–35% 的位置）→ 段 8、
 *     缺 25.33（三份正好 100），再挪 4 让它落在拐过角之后。
 */
const SQUARE_DASH = '8.5 4';
const SQUARE_OFFSET = -6;
const CIRCLE_DASH = '36 14';
const CIRCLE_OFFSET = -32;
const TRI_DASH = '8 25.33';
const TRI_OFFSET = -4;

/** 一张盖住棋子、边上不裁的透明画布。 */
function blankSvg(size: number, cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.classList.add(cls);
  return svg;
}

/** 三族共用的描边写法：一条颜色、一个线宽、一副节奏。 */
function dash(el: SVGElement, color: string, width: number, pattern: string, offset: number): void {
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('pathLength', '100');
  el.setAttribute('stroke-dasharray', pattern);
  el.setAttribute('stroke-dashoffset', String(offset));
}

export function proHintWidth(size: number): number {
  return Math.min(W_MAX, Math.max(W_MIN, Math.round(size * W_RATIO * 10) / 10));
}

/**
 * 三族共用的一条规矩：**这条线压在棋子自己的轮廓上**（一半在里、一半在外），不是整条
 * 描在外面。
 *
 * 玩家 2026-09：「方块的贴合的太近了以至于没有缝隙看不清两个边框」。算一下就知道躲不
 * 过：方块之间的缝是 4px（square.ts 里 `size = cell - 4`），上一版整条描在外面、还离
 * 棋子半个线宽，一枚就吃掉 1.5 个线宽 ≈ 2.7px，两枚挨着是 5.4px——比那道缝还宽，两条
 * 线于是糊在一起。压在轮廓上只吃掉半个线宽，两枚之间还剩 4 − 1.8 = 2.2px 的底板，看
 * 得出是两条线。小球那边同理：缝是 0.14R ≈ 3.4px，剩 2px。
 * 三角是另一回事：它的棋子被 clip-path 剪着，外面那一半会被剪掉，所以线要描两倍宽，
 * 露出来的正好是一个线宽（见 proTriRing）。
 */

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
  const svg = blankSvg(size, 'pro-square');
  const rect = document.createElementNS(SVG_NS, 'rect');
  // 压在棋子自己的边上（见上面那段）：矩形就是棋子的那一圈，线的中线落在边上。
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', String(size));
  rect.setAttribute('height', String(size));
  rect.setAttribute('rx', String(radius));
  dash(rect, color, width, SQUARE_DASH, SQUARE_OFFSET);
  svg.appendChild(rect);
  return svg;
}

/**
 * 小球：压在球边上的一圈虚线。
 *
 * 参考图上量出来的是**两段**：左边一段、右边一段，缺口在正上和正下（顶上那颗球量到
 * 的缺口约 50°，两段各约 130°）。`<circle>` 的路径从三点钟出发顺时针走，pathLength
 * 归一化成 100 之后：三点 0、六点 25、九点 50、十二点 75。要把两个缺口摆在 25 和 75，
 * 就是「段 36、缺 14」再整体挪 32——下面那两个常数就是这么来的。
 */
export function proCircleRing(size: number, color: string, width: number): SVGSVGElement {
  const svg = blankSvg(size, 'pro-circle');
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(size / 2));
  circle.setAttribute('cy', String(size / 2));
  circle.setAttribute('r', String(size / 2));
  dash(circle, color, width, CIRCLE_DASH, CIRCLE_OFFSET);
  svg.appendChild(circle);
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
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('pro-tri');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    roundTriPath(
      pts.map(([x, y]) => [((x - box.minX) / box.w) * 100, ((y - box.minY) / box.h) * 100] as [number, number]),
    ),
  );
  // 两倍宽：外面那一半被 clip-path 剪掉，露出来的正好是一个线宽（见上面那段）。
  dash(path, color, width * 2, TRI_DASH, TRI_OFFSET);
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);
  return svg;
}
