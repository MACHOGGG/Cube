/**
 * 在棋盘上找「转出来的那两个图案」。
 *
 * 这一层只管一件事：给一个图案和一副棋盘，说出它在哪儿拼成了。八个玩法各自
 * 的 findMatches 不受影响——随机得分目标是另一套判分，走的是这里。
 *
 * ── 三族的格子怎么对上 ──────────────────────────────────────
 *
 * targets.ts 里的图案记的是「几何坐标」：行，加上以半格为单位的列。棋盘用的
 * 却是各自的行列号，两者不是一回事，差在每一族的排布上：
 *
 *   方块：一样。(行+dr, 列+dc)。
 *
 *   小球：棋盘是个 28 颗的三角（第 r 行有 r+1 颗），第 c 颗的横坐标是
 *         2c − r（半径为单位）。所以几何上往右挪 dc 个半径、往下挪 dr 行，
 *         列号只挪 (dc + dr) / 2。要求 dc + dr 是偶数——七个图案各自的
 *         (行+列) 奇偶都一致，所以整体平移一下总能落在格子上。
 *
 *   三角：棋盘按 (行 r, 位置 p) 记，p 是偶数就朝上（见 shapes/triangle.ts
 *         的 iconTri）。每一行还整体左移半格，所以几何列 g 和 p 的关系是
 *         g = p − r − 1，反过来 p = p0 + dg + dr。朝向不用另存——p 的奇偶
 *         就是朝向，图案里记的那一份只是用来核对，核对不上说明图读错了。
 *
 * 这三条不是推的，是拿玩家给的二十个 SVG 逐个验过的：三角五个图案的朝向都能
 * 由 p 的奇偶推出来，小球七个图案的 (行+列) 奇偶各自一致。
 */
import type { Cell, Tile } from './types';
import { effColor } from './types';
import type { Facing, Family, TargetCell, TargetPattern } from './targets';

/** 判定要问棋盘的那几件事。八个玩法各自实现，这一层不关心棋盘怎么画的。 */
export interface BoardView {
  /** 这个格子在不在棋盘上。 */
  has(r: number, c: number): boolean;
  /** 这一枚现在是什么颜色——翻过的看点色，没翻的看正面色。 */
  tileAt(r: number, c: number): Tile | null;
  /** 从哪些格子起手去试。给全盘就行，重复的由调用方去重。 */
  cells(): Cell[];
  /**
   * 三角专用：这一格朝上还是朝下。不给就按「列号是偶数就朝上」——那是
   * triangleBig.ts 的排法（每行不裁、不偏移）。别的族不用。
   */
  facingAt?(r: number, c: number): Facing;
}

/** 把图案的一格（几何坐标）落到棋盘的行列上。落不上就返回 null。 */
function place(
  family: Family,
  anchor: Cell,
  dr: number,
  dg: number,
): Cell | null {
  const [r0, c0] = anchor;
  if (family === 'square') return [r0 + dr, c0 + dg];
  if (family === 'triangle') return [r0 + dr, c0 + dg + dr];
  // 小球：几何上挪 dg 个半径、dr 行，列号只挪一半。
  const sum = dg + dr;
  if (sum % 2 !== 0) return null;
  return [r0 + dr, c0 + sum / 2];
}

/**
 * 这个图案在棋盘上拼成的所有地方。
 *
 * 三条都要满足，缺一不可：
 *   · 每一格都在棋盘上；
 *   · 这些格子现在是同一个颜色；
 *   · 里面至少还有一枚是正面。
 *
 * 最后一条是整个计分体系的老规矩（见 scoring.ts）：一次得分总要翻掉点什么，
 * 否则同一片已经翻好的图案可以推来推去反复计分。
 */
export function findTargetAt(
  view: BoardView,
  pattern: TargetPattern,
  anchor: Cell,
): Cell[] | null {
  const [br, bg, bf] = pattern.cells[0];
  // 三角：起手那一格的朝向必须和图案第一枚的朝向一样。朝向跟着 p 的奇偶走，
  // 而图案里各枚之间的 p 差是定死的，所以起手错了半格，整个图案的每一枚都
  // 会翻个面——「上面一枚、下面一枚拼成的菱形」会变成两枚只在一个尖上碰
  // 一下的三角，那不是图案，却曾经被当成图案给了分。
  if (pattern.family === 'triangle' && bf) {
    const f = view.facingAt ? view.facingAt(anchor[0], anchor[1]) : anchor[1] % 2 === 0 ? 'U' : 'D';
    if (f !== bf) return null;
  }
  const out: Cell[] = [];
  let color = -1;
  let anyFront = false;
  for (const [pr, pg] of pattern.cells) {
    const at = place(pattern.family, anchor, pr - br, pg - bg);
    if (!at || !view.has(at[0], at[1])) return null;
    const tile = view.tileAt(at[0], at[1]);
    if (!tile) return null;
    const c = effColor(tile);
    if (color === -1) color = c;
    else if (c !== color) return null;
    if (tile.face === 'flavor') anyFront = true;
    out.push(at);
  }
  return anyFront ? out : null;
}

/**
 * 这个图案在整副棋盘上拼成的所有地方（可能有重叠，调用方自己挑）。
 *
 * 图案怎么摆都算：横的竖的、转过去的、照镜子的——和各玩法自己那套图案一个
 * 规矩（方块的 1×4 横竖都算，小球的 1×4 三个方向都算，三角的大三角朝上朝
 * 下都算）。原来只认表里画的那一个朝向，于是「横着五枚」竖着摆就不给分。
 */
export function findTargets(view: BoardView, pattern: TargetPattern): Cell[][] {
  const out: Cell[][] = [];
  const anchors = view.cells();
  for (const variant of orientationsOf(pattern)) {
    for (const anchor of anchors) {
      const hit = findTargetAt(view, variant, anchor);
      if (hit) out.push(hit);
    }
  }
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// 一个图案的所有摆法
// ---------------------------------------------------------------------------
//
// 三族的格子各有各的对称：方块转四次、照一次镜子，八种；小球和三角的格子是
// 六角的，转六次、照一次镜子，十二种。算法上不用碰浮点：每一族都有一套整数
// 坐标，让「转 60°/90°」和「照镜子」都是整数上的线性变换，转完再折回行列。
// 三角多一层——朝上朝下不是格子的一个属性，是它在格子上的位置决定的，所以
// 三角不按「一格」转，按它的三个顶点转，转完再看这三个点围成的是朝上还是
// 朝下的那一枚。这样转 60° 把朝上的变成朝下的，自然而然，不用另外记。

const cache = new Map<string, TargetPattern[]>();

/** 这个图案转一转、翻一翻之后所有不一样的样子（含它自己）。 */
export function orientationsOf(pattern: TargetPattern): TargetPattern[] {
  const key = pattern.family + ':' + pattern.id;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw =
    pattern.family === 'square'
      ? squareVariants(pattern.cells)
      : pattern.family === 'circle'
        ? circleVariants(pattern.cells)
        : triangleVariants(pattern.cells);
  const seen = new Set<string>();
  const out: TargetPattern[] = [];
  for (const cells of raw) {
    const k = cells.map(([r, c, f]) => `${r},${c},${f ?? ''}`).join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...pattern, cells });
  }
  cache.set(key, out);
  return out;
}

type XY = readonly [number, number];
const byRowCol = (a: TargetCell, b: TargetCell) => a[0] - b[0] || a[1] - b[1];

/** 方块：(r, c) 转 90° 是 (c, −r)，照镜子是 (r, −c)。 */
function squareVariants(cells: readonly TargetCell[]): TargetCell[][] {
  const out: TargetCell[][] = [];
  for (const mirror of [false, true]) {
    let pts: XY[] = cells.map(([r, c]) => (mirror ? [r, -c] : [r, c]));
    for (let k = 0; k < 4; k++) {
      const minR = Math.min(...pts.map((p) => p[0]));
      const minC = Math.min(...pts.map((p) => p[1]));
      out.push(pts.map(([r, c]): TargetCell => [r - minR, c - minC]).sort(byRowCol));
      pts = pts.map(([r, c]) => [c, -r]);
    }
  }
  return out;
}

/**
 * 小球：几何坐标 (r, g)，g 以半径为单位。换成六角的轴坐标 (i, j)——两根基
 * 向量夹 60°：i 走一颗直径，j 走一行（往右下半颗）。g = 2i + j，r = j。
 * 转 60°：(i, j) → (−j, i + j)。照镜子：(i, j) → (i + j, −j)。
 */
function circleVariants(cells: readonly TargetCell[]): TargetCell[][] {
  // 同一图案里 (g − r) 的奇偶一致（targets.ts 里验过），可能是奇的：整体挪
  // 半颗把它凑成偶数——挪多少不重要，匹配只看各枚之间的差。
  const shift = ((cells[0][1] - cells[0][0]) % 2 + 2) % 2;
  const axial: XY[] = cells.map(([r, g]) => [(g - shift - r) / 2, r]);
  const out: TargetCell[][] = [];
  for (const mirror of [false, true]) {
    let pts: XY[] = axial.map(([i, j]) => (mirror ? [i + j, -j] : [i, j]));
    for (let k = 0; k < 6; k++) {
      out.push(normalizeHex(pts.map(([i, j]) => [j, 2 * i + j])));
      pts = pts.map(([i, j]) => [-j, i + j]);
    }
  }
  return out;
}

/** (r, g) 一组：行挪到从 0 起（沿着行走的一步是 (r+1, g+1)），再整体左右挪偶数个半径让最左的落在 0 或 1。 */
function normalizeHex(pts: XY[]): TargetCell[] {
  const minR = Math.min(...pts.map((p) => p[0]));
  let moved: XY[] = pts.map(([r, g]) => [r - minR, g - minR]);
  const minG = Math.min(...moved.map((p) => p[1]));
  const even = minG - (((minG % 2) + 2) % 2);
  moved = moved.map(([r, g]) => [r, g - even]);
  return moved.map(([r, g]): TargetCell => [r, g]).sort(byRowCol);
}

/**
 * 三角：一枚三角由三个顶点定。顶点落在一张三角格子上，轴坐标 (a, b)，两根
 * 基向量夹 60°（b 就是行号）。朝上的那枚 {(A,i), (A−1,i+1), (A,i+1)}，朝下
 * 的 {(A,i), (A+1,i), (A,i+1)}，其中 A = j − i，j 是这一行里第几枚（p 除以
 * 二取整）。转 60°：(a, b) → (−b, a + b)。照镜子：(a, b) → (a + b, −b)。
 * 转完看三个顶点：最上那一行只有一个点就是朝上的，有两个点就是朝下的。
 */
function triangleVariants(cells: readonly TargetCell[]): TargetCell[][] {
  // 图案坐标 (r, c) → 棋盘 (i, p)：i = r，p = p0 + (c − c0) + (r − r0)——和
  // targetIcon.ts、place() 用的是同一条：p 的奇偶就是朝向，起手那一枚的朝向
  // 定了 p0，后面每一枚跟着走（这一条二十个图案逐个验过）。
  const [r0, c0, f0] = cells[0];
  const p0 = f0 === 'D' ? 1 : 0;
  const tris = cells.map(([r, c]) => {
    const i = r;
    const p = p0 + (c - c0) + (r - r0);
    const j = Math.floor(p / 2);
    const A = j - i;
    const up = p % 2 === 0;
    return up
      ? ([[A, i], [A - 1, i + 1], [A, i + 1]] as XY[])
      : ([[A, i], [A + 1, i], [A, i + 1]] as XY[]);
  });
  const out: TargetCell[][] = [];
  for (const mirror of [false, true]) {
    let shapes = tris.map((v) => v.map(([a, b]): XY => (mirror ? [a + b, -b] : [a, b])));
    for (let k = 0; k < 6; k++) {
      out.push(normalizeTri(shapes.map(triFromVertices)));
      shapes = shapes.map((v) => v.map(([a, b]): XY => [-b, a + b]));
    }
  }
  return out;
}

/** 三个顶点 → (i, p)。 */
function triFromVertices(v: XY[]): XY {
  const bMin = Math.min(...v.map((q) => q[1]));
  const top = v.filter((q) => q[1] === bMin);
  const i = bMin;
  if (top.length === 1) {
    const A = top[0][0];
    return [i, 2 * (A + i)];
  }
  const A = Math.min(top[0][0], top[1][0]);
  return [i, 2 * (A + i) + 1];
}

/** (i, p) 一组 → 图案坐标 (r, c, 朝向)，行挪到从 0 起（沿行的一步是 (r+1, c+1)），左右挪偶数个半格。 */
function normalizeTri(ips: XY[]): TargetCell[] {
  const minI = Math.min(...ips.map((q) => q[0]));
  // 往上挪 minI 行：一行的一步是 (i+1, p+2)，所以 p 跟着挪 2·minI。
  let cells: XY[] = ips.map(([i, p]) => [i - minI, p - 2 * minI]);
  const minC = Math.min(...cells.map(([i, p]) => p - i));
  const even = minC - (((minC % 2) + 2) % 2);
  cells = cells.map(([i, p]) => [i, p - even]);
  return cells
    .map(([i, p]): TargetCell => [i, p - i, p % 2 === 0 ? 'U' : 'D'])
    .sort(byRowCol);
}

/** 同一片格子被不同起手点找到好几遍，只留一份。 */
function dedupe(groups: Cell[][]): Cell[][] {
  const seen = new Set<string>();
  const out: Cell[][] = [];
  for (const g of groups) {
    const key = g
      .map(([r, c]) => `${r},${c}`)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}
