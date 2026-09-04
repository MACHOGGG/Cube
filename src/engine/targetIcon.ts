/**
 * 把一个「随机得分目标」画成棋盘上那一排小图示。
 *
 * 得分图案本来是各个玩法自己写死的（square.ts 里的 1×4 和 2×2 之类），随机
 * 目标玩法里它们是这一局才抽出来的，所以得有一条从 targets.ts 那张表到
 * patternIcon.ts 那套画法的路。
 *
 * 三族的坐标各自是什么单位，见 targets.ts 顶上那段；这里做的只是把它们换算
 * 成各族图示原来用的那套几何——换算式和 targetMatch.ts 里 place() 用的是同
 * 一个，不然「图上画的」和「盘上认的」会是两个东西。
 */
import type { IconCell, PatternDef } from './patternIcon';
import type { TargetPattern } from './targets';

/** 三角一行有多高，单位是半个三角的宽。和 triangle.ts 里那个是同一个数。 */
const TRI_H = Math.sqrt(3) / 2;

/** 一枚三角形的三个角。i 是第几行，p 是行内第几个（偶数朝上）。 */
function triPoints(i: number, p: number): [number, number][] {
  const up = p % 2 === 0;
  const j = up ? p / 2 : (p - 1) / 2;
  const x = -i / 2 + j;
  return up
    ? [[x, i * TRI_H], [x - 0.5, (i + 1) * TRI_H], [x + 0.5, (i + 1) * TRI_H]]
    : [[x + 0.5, (i + 1) * TRI_H], [x, i * TRI_H], [x + 1, i * TRI_H]];
}

function cellsOf(pattern: TargetPattern): IconCell[] {
  const [br, bg] = pattern.cells[0];
  if (pattern.family === 'square') {
    return pattern.cells.map(([r, c]) => ({ kind: 'rect', cx: c - bg, cy: r - br, half: 0.42 }));
  }
  if (pattern.family === 'circle') {
    // 小球那一列的单位就是半径，而各族图示里小球的 x 也正是按半径算的
    // （circle.ts 的 iconPos：x = 2c − r），两边同一个尺度，直接搬。
    return pattern.cells.map(([r, c]) => ({
      kind: 'circle',
      cx: c - bg,
      cy: (r - br) * Math.sqrt(3),
      r: 0.95,
    }));
  }
  // 三角：p = p0 + dg + dr，和 targetMatch 的 place() 一样。p0 取 0 或 1，
  // 让第一枚的朝向对上图案里记的那一个——p 的奇偶就是朝向，所以起手那一下
  // 定了，后面每一枚的朝向都跟着对上（这一条逐个验过二十个图案）。
  const p0 = pattern.cells[0][2] === 'D' ? 1 : 0;
  return pattern.cells.map(([r, c]) => ({
    kind: 'poly',
    points: triPoints(r - br, p0 + (c - bg) + (r - br)),
  }));
}

/** 一枚图案铺开来横着占多宽、竖着占多高。 */
function spanXY(cells: IconCell[]): [number, number] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of cells) {
    if (c.kind === 'circle') xs.push(c.cx - c.r, c.cx + c.r), ys.push(c.cy - c.r, c.cy + c.r);
    else if (c.kind === 'rect') xs.push(c.cx - c.half, c.cx + c.half), ys.push(c.cy - c.half, c.cy + c.half);
    else for (const [x, y] of c.points) xs.push(x), ys.push(y);
  }
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/** 一枚图案铺开来占多宽/多高（取大的那一边），用来给一排图示定统一的尺度。 */
function span(cells: IconCell[]): number {
  const [w, h] = spanXY(cells);
  return Math.max(w, h);
}

/**
 * 老虎机滚筒里的那一整族：每一张都装进同一个长方框——横的按整族最宽的图案，
 * 竖的按最高的——所以棋子一样大（玩家的原话：「放大一些，但维持统一的大小」），
 * 而框是横着的，正好顺着窗口的形状，比各自塞进正方框里大得多。四周不留呼吸，
 * 图本身还有一圈自己的边距（patternIcon 的 MARGIN），不会贴到窗框上。
 */
export function slotFaceDefs(pool: readonly TargetPattern[]): PatternDef[] {
  const drawn = pool.map(cellsOf);
  const spans = drawn.map(spanXY);
  const extent = Math.max(1, ...spans.map(([w]) => w));
  const extentY = Math.max(1, ...spans.map(([, h]) => h));
  return pool.map((t, i) => ({ label: t.id, cells: drawn[i], extent, extentY }));
}

/**
 * 这一局抽中的那几个图案，画成棋盘上那一排小图示。
 *
 * 两枚共用一个 extent，所以铺得开的那一枚看起来就是「摊得更开」，而不是
 * 「同一个形状画小了」——这一条是 patternIcon 里定的规矩，这里照着给。
 */
export function targetPatternDefs(targets: readonly TargetPattern[]): PatternDef[] {
  const drawn = targets.map(cellsOf);
  const extent = Math.max(1, ...drawn.map(span)) + 0.6;
  return targets.map((t, i) => ({ label: t.id, cells: drawn[i], extent }));
}
