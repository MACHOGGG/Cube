/**
 * 挨过一下、还没拆掉的炸弹身上那道裂纹——六副炸弹棋盘共用的同一幅画。
 *
 * 炸弹 2026-09 改成两层：得分图案旁边的炸弹要被打中两次才拆（玩家定的数，也
 * 是三档里最均衡的一档——方块上不谨慎的玩家炸死率从 66% 降到 16%，谨慎的仍然
 * 零死亡，炸弹存在率保持八成，分数 126 最接近基础方块的 139）。第一次打中不
 * 拆，只裂，这道裂纹就是那一次的回执：玩家得看得出「这枚已经挨过一下，再来一
 * 下就没了」，不然两层规则在屏幕上根本不存在，只会觉得「怎么打了不掉」。
 *
 * 为什么是这么画的：
 *
 * · **填出来的楔形，不是描出来的线**。原先这里画的是等宽的折线加一层错位高
 *   光，凑一个凿痕的立体感；玩家拿了一张参考图回来——真正像「裂开」的是**一头
 *   粗一头尖**的缝：中间最宽，拐角处更宽，两端收成针尖。所以现在中线只是骨
 *   架，每个点上带一个半宽，`outline()` 把它撑成一圈多边形再平涂。
 * · **一笔纯白，没有第二种颜色**。这套美术是平涂 + 圆角 + 白描边，棋子本来就
 *   镶着白边；裂纹用同一支白，就像那道白边裂进了棋子里。换配色（色盲友好那一
 *   套）、换成任何一档红，白都还在，不会有第三种颜色冒出来。
 * · **绕开正中**：正中那格是「！」（字号是棋子的 0.55，在这幅 100×100 里大约
 *   占 x 43–57、y 26–74）。白裂纹压上白「！」就是一团白，谁也看不清。所以主缝
 *   走中线偏左，分叉只在「！」的上头和下头伸出去。
 *
 * 坐标系 100×100，和棋子多大无关——调用方给一个 size，整幅画等比缩过去。
 */

/** 中线上的一点：x、y，以及这一点上的半宽。半宽 0 就是收成针尖。 */
type Node = readonly [number, number, number];
type Pt = readonly [number, number];

/**
 * 主缝：从上边进来，四折之后从下边出去，整条走在中线偏左，把正中让给「！」。
 * 最宽的一处在 y≈47 那个朝左顶出去的折角上——参考图里也是拐得最狠的地方最厚。
 */
const MAIN: readonly Node[] = [
  [33, 1, 0],
  [29, 15, 3.4],
  [35, 29, 5.0],
  [24, 47, 6.0],
  [36, 63, 4.4],
  [28, 80, 3.0],
  [34, 99, 0],
];

/** 右上那根长针，从主缝上段分出去，一路收成尖。 */
const SPUR_UP: readonly Node[] = [
  [31, 10, 1.9],
  [48, 6, 1.2],
  [68, 3, 0],
];

/** 从最厚的那个折角上横着分出去的长针，走左下——和右上那根一高一低、一上一
 *  下地错开。两根一样长、一样斜着往外伸的话，整幅画会读成一个叉着腰的小人。 */
const SPUR_LEFT: readonly Node[] = [
  [26, 49, 3.2],
  [14, 55, 1.5],
  [2, 60, 0],
];

/** 「！」下头那两根：右边一根长的，左边一根短茬（长短不一样才不像两条腿）。 */
const SPUR_DOWN: readonly Node[] = [
  [31, 74, 2.6],
  [47, 82, 1.6],
  [62, 92, 0],
];
const SPUR_DOWN_LEFT: readonly Node[] = [
  [29, 85, 1.8],
  [20, 90, 0.9],
  [13, 93, 0],
];

const SEAMS: readonly (readonly Node[])[] = [MAIN, SPUR_UP, SPUR_LEFT, SPUR_DOWN, SPUR_DOWN_LEFT];

const unit = ([x, y]: Pt): Pt => {
  const d = Math.hypot(x, y) || 1;
  return [x / d, y / d];
};
const trim = (n: number) => String(Math.round(n * 100) / 100);

/**
 * 把「中线 + 半宽」撑成一圈多边形的点串：左岸顺着走一遍，右岸倒着回来。
 *
 * 拐点上用两段法线的角平分线，再乘一个斜接系数 1/cos(半夹角)——不补这一下，
 * 折角处的宽度会按夹角被掐细，参考图里最厚的恰恰是拐角。系数封顶在 1/0.45，
 * 免得哪天把中线折成回头弯时把尖角甩到画外去。
 */
function outline(seam: readonly Node[]): string {
  const near: Pt[] = [];
  const far: Pt[] = [];
  for (let i = 0; i < seam.length; i++) {
    const [x, y, w] = seam[i];
    const prev = i > 0 ? seam[i - 1] : null;
    const next = i + 1 < seam.length ? seam[i + 1] : null;
    const n0: Pt | null = prev ? (([dx, dy]) => [-dy, dx] as Pt)(unit([x - prev[0], y - prev[1]])) : null;
    const n1: Pt | null = next ? (([dx, dy]) => [-dy, dx] as Pt)(unit([next[0] - x, next[1] - y])) : null;
    let n: Pt;
    let miter = 1;
    if (n0 && n1) {
      n = unit([n0[0] + n1[0], n0[1] + n1[1]]);
      miter = 1 / Math.max(n[0] * n0[0] + n[1] * n0[1], 0.45);
    } else {
      n = (n0 || n1) as Pt;
    }
    const d = w * miter;
    near.push([x + n[0] * d, y + n[1] * d]);
    far.push([x - n[0] * d, y - n[1] * d]);
  }
  const ring = near.concat(far.reverse());
  return ring.map(([x, y]) => trim(x) + ',' + trim(y)).join(' ');
}

/**
 * 裂纹，画成一段 SVG。
 *
 * 每道缝各是一个多边形，彼此叠着没关系——都是同一支不透明的白，叠在一起还是
 * 那支白（这也是不用半透明的一个理由：半透明会把每处交叠印出深浅来）。
 *
 * @param size 这幅画占多少像素见方。方块给格子的 0.88，小球给 0.72（要留在
 *             圆里），三角给短边的 0.5 并往质心挪（见各个 shapes 文件）。
 */
export function crackSvg(size: number): string {
  const s = Math.round(size);
  const polys = SEAMS.map((seam) => `<polygon points="${outline(seam)}"/>`).join('');
  return (
    `<svg viewBox="0 0 100 100" width="${s}" height="${s}" aria-hidden="true" fill="#FFFFFF">` +
    `${polys}</svg>`
  );
}

/**
 * 裂纹那一层 DOM。铺满整枚棋子、自己居中（和「！」同一个做法，见
 * style.css 的 .hazard-mark），所以棋子那层 flex 有几个孩子都不影响它。
 *
 * @param size 见 crackSvg。
 * @param padTop 三角用：整幅画往下挪一点，落到三角的质心上。
 */
export function crackLayer(size: number, padTop = 0): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bomb-crack';
  if (padTop) el.style.paddingTop = Math.round(padTop) + 'px';
  el.innerHTML = crackSvg(size);
  return el;
}
