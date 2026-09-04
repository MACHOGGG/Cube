/**
 * 圆角三角——一处算，三处用。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要单独一个文件
 *
 * 三角在这个游戏里画在三个互不相干的地方：棋盘上是一个带 clip-path 的 div
 * （三副三角棋盘各有一份），教学里是 SVG 的 <polygon>，图示里是 SVG 的
 * <path>。三处的写法不一样，但「三角长什么样」必须是同一件事——圆角的深浅
 * 一旦各调各的，玩家在教学里看熟的形状，进了棋盘就变了个样。
 *
 * 所以形状只在这儿定义一次：给三个顶点，拿回一条已经把角磨圆了的轮廓。要
 * SVG 就取 path，要 clip-path 就取百分比的 polygon。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 圆角有多圆：不给「圆的半径」，给「从尖上往两边各切掉多长」——切掉的那一
 * 段占这条边的多少。这么定的好处是三角放大缩小时圆角自动跟着按比例走（玩家
 * 的原话：「改成比例，不是像素」），而且不用管三个角的夹角各是多少。
 */
type Pt = readonly [number, number];

/**
 * 从尖上往两边各切掉边长的两成，切口用一段二次贝塞尔接上（控制点就落在原来
 * 那个尖上）。这个数是照着小游戏里那副三角定的——玩家看过之后说「这个里面
 * 的效果就非常好」。
 */
export const TRI_CORNER = 0.2;

/** 一条边上，从 a 往 b 走 t 的那一点。 */
const lerp = (a: Pt, b: Pt, t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * 磨圆之后的轮廓，按顺序排好的一串点。
 *
 * 每个角磨成一段二次贝塞尔：从「这条边上切掉的那一点」出发，以尖点为控制
 * 点，落到「另一条边上切掉的那一点」。`steps` 是每个角采几段——采得越密越
 * 圆滑，8 段在任何尺寸下都看不出棱了。
 */
export function roundTriOutline(pts: readonly Pt[], cut = TRI_CORNER, steps = 8): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const from = lerp(cur, prev, cut);
    const to = lerp(cur, next, cut);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const a = lerp(from, cur, t);
      const b = lerp(cur, to, t);
      out.push(lerp(a, b, t));
    }
  }
  return out;
}

/**
 * 给 SVG 用：一条已经磨圆的 `d`。
 *
 * 直边走 L、圆角走 Q（二次贝塞尔，控制点是原来那个尖）——比一串采样点短得
 * 多，而且是真的曲线，放多大都不会露出棱。
 */
export function roundTriPath(pts: readonly Pt[], cut = TRI_CORNER): string {
  const n = pts.length;
  const seg: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const from = lerp(cur, prev, cut);
    const to = lerp(cur, next, cut);
    const f = (v: number) => Math.round(v * 100) / 100;
    seg.push(`${i === 0 ? 'M' : 'L'}${f(from[0])} ${f(from[1])}`);
    seg.push(`Q${f(cur[0])} ${f(cur[1])} ${f(to[0])} ${f(to[1])}`);
  }
  return seg.join(' ') + ' Z';
}

/**
 * 给 CSS 用：一条已经磨圆的 `polygon(...)`，坐标是这个方框里的百分比。
 *
 * clip-path 的 polygon() 只认直线段，所以这儿用的是采样点那一版——角上一段
 * 十来个点，看不出是折线。（`path()` 能画真曲线，但它只认像素、不认百分比，
 * 元素一改尺寸就得重算，而这几副棋盘的格子是随屏幕缩放的。）
 */
export function roundTriClip(
  pts: readonly Pt[],
  box: { minX: number; minY: number; w: number; h: number },
  cut = TRI_CORNER,
): string {
  const outline = roundTriOutline(pts, cut);
  const f = (v: number) => v.toFixed(2);
  return (
    'polygon(' +
    outline
      .map(([x, y]) => `${f(((x - box.minX) / box.w) * 100)}% ${f(((y - box.minY) / box.h) * 100)}%`)
      .join(',') +
    ')'
  );
}
