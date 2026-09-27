import type { Cell } from './types';

/**
 * 「只削此刻最外面的那一条线」——《侵蚀阶梯》v1.2 §3 的**外边族**消除。
 *
 * 五副棋盘走这一套：小球、菱形方块、六边三角 54、六边圆球、七色圆球。方块 36 不
 * 走（它是规整网格，任意一整行/一整列全同色星星就消除、棋盘合拢，零改动）。
 *
 * **菱形方块必须归外边族。** 它的横排长度是 2·3·4·5·6·5·4·3·2：按方块那套「任意
 * 整线」算，随手一条两枚的短横排就被清掉，实测清盘率从 23–27/30 跌到 2–6/30。
 *
 * 一句话：一条线能削，要它**在自己那一族里是最靠外的一条**、活格数够门槛、而且
 * 削掉之后每一条线剩下的活格还连着（endsAll）。于是棋盘一圈一圈往里缩，而不是被
 * 从中间掏空——从中间掏空会把线截成两段，那副盘就再也滑不动了。
 *
 * 算法（§3 那段伪代码，逐条照写）：
 *
 *   每条线属于一个线族 fam（行 / 两个斜向）。同一族里的线互相平行，所以「在族法
 *   向上的投影」对整条线是同一个数——那就是下面的 `offset`。
 *   对每族：只看还有活格的线，取 offset 最小与最大的那两条（并列都算）。
 *   一条极值线是「可削的外边」当且仅当
 *     a) 活格数 ≥ 门槛（常态 3；收尾放开后 1），且
 *     b) endsAll：这条线上的每个活格，在穿过它的**任何其他线**里，都贴着自己那
 *        一段连续活格的某一端。
 *   不足门槛的极值线不是边，**但挡住这一端**（不再往里看下一条）——这一条是故意
 *   的：三角形的三个尖角各是一条只有 1 枚的极值线，要是「不够就往里找」，那三个
 *   尖角会让算法把第二层当外边，尖角本身永远留着，棋盘缩不动。
 *
 * 这个模块只管几何，不认识 Tile：颜色那一半（整条同色星星）留给棋盘自己判，因为
 * 「什么算一枚星星」是棋盘的事。
 */

/** 一条线。同一族里的线互相平行。 */
export interface EdgeLine {
  /** 线族：行、两个斜向。同族的线互不相交。 */
  fam: string;
  /**
   * 这条线在族法向上的偏移，**同一族内唯一且单调**。
   *
   * 哪个方向为正无所谓——算法只取这一族的最小和最大。给的是个显式的数而不是
   * 「数组里的第几条」：顺序是个看不见的前提，哪天谁调了 allLines() 里两个循环
   * 的次序，按下标认就会把中间的线当成外边，而且不报错。
   */
  offset: number;
  cells: readonly Cell[];
}

export interface EdgeBoard {
  readonly lines: readonly EdgeLine[];
  /**
   * 这一格此刻还在盘上吗。
   *
   * 三种不在：格子不属于这副棋盘（坐标在外面）、已经被削掉离场了、六边圆球中心
   * 那个永久空位。永久空位不算活格，也不挡 endsAll——它把穿过它的那三条线截成
   * 两段，而 endsAll 问的是「贴着**自己那一段**的端」，所以两段各自的端都算贴着。
   */
  isLive(r: number, c: number): boolean;
}

/** 常态门槛：一条外边至少要有这么多活格才削得动（§3）。 */
export const EDGE_MIN = 3;
/**
 * 「一条边都削不动」时拿去当门槛的那个够不着的大数。
 *
 * 卡死判定（engine/stalemate.ts）问的是「某色星星够不够填满一条外边」。一条都削不
 * 动的时候不能给它 0——那头会把 0 夹成 1，于是「一枚星星就能得分」，永远判活，死局
 * 再也检测不出来。给一个比任何一副棋盘的任何一条线都长的数，意思就是「这条路现在
 * 走不通」。
 */
export const NO_EDGE = 9999;
/** 收尾放开之后的门槛：无边可削、无色块可翻时降到 1（§3「收尾放开」）。 */
export const EDGE_MIN_ENDGAME = 1;

export interface OuterEdge {
  line: EdgeLine;
  /** 这条线此刻的活格，按线上的顺序。 */
  live: Cell[];
}

const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/** 这条线此刻的活格，按线上的顺序。 */
export function liveOn(board: EdgeBoard, line: EdgeLine): Cell[] {
  return line.cells.filter(([r, c]) => board.isLive(r, c)).map(([r, c]) => [r, c] as Cell);
}

/**
 * 这一格贴着自己那一段连续活格的某一端吗。
 *
 * 「自己那一段」而不是「整条线的活格清单」：六边圆球中心那个永久空位把三条线各
 * 截成两段，按整条清单算的话，紧贴空位的那两枚会被判成「在中间」（在活格清单里
 * 它们的下标是 2 和 3，不是 0 和 5），那三条线就永远削不掉了。
 *
 * 导出是给门用的（check-line-clear.mjs 直接量这一条）：空位挡不挡 endsAll 是整个
 * §3 里最容易写错、又最不容易在屏幕上看出来的一处——写错了只是某几条边永远削不
 * 动，玩家只觉得「这盘运气差」。
 */
export function atSegmentEnd(board: EdgeBoard, line: EdgeLine, cell: Cell): boolean {
  const i = line.cells.findIndex((c) => same(c, cell));
  if (i < 0) return true; // 不在这条线上：与它无关
  const prevLive = i > 0 && board.isLive(line.cells[i - 1][0], line.cells[i - 1][1]);
  const nextLive =
    i + 1 < line.cells.length && board.isLive(line.cells[i + 1][0], line.cells[i + 1][1]);
  return !prevLive || !nextLive;
}

/** §3 的 endsAll：削掉这条线之后，每一条线剩下的活格还连着。 */
export function endsAll(board: EdgeBoard, line: EdgeLine, live: Cell[]): boolean {
  for (const cell of live) {
    for (const other of board.lines) {
      // 同族的线互不相交，不必问。
      if (other.fam === line.fam) continue;
      if (!other.cells.some((c) => same(c, cell))) continue;
      if (!atSegmentEnd(board, other, cell)) return false;
    }
  }
  return true;
}

/**
 * 此刻可以削的外边，连它们的活格一起。
 *
 * @param threshold 活格数门槛：常态 EDGE_MIN，收尾放开后 EDGE_MIN_ENDGAME。
 */
export function outerEdges(board: EdgeBoard, threshold: number = EDGE_MIN): OuterEdge[] {
  const byFam = new Map<string, { line: EdgeLine; live: Cell[] }[]>();
  for (const line of board.lines) {
    const live = liveOn(board, line);
    // 整条都空了：这条线已经不在场，连「极值」都不参加评比。
    if (!live.length) continue;
    const bucket = byFam.get(line.fam);
    if (bucket) bucket.push({ line, live });
    else byFam.set(line.fam, [{ line, live }]);
  }

  const out: OuterEdge[] = [];
  for (const bucket of byFam.values()) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of bucket) {
      if (e.line.offset < lo) lo = e.line.offset;
      if (e.line.offset > hi) hi = e.line.offset;
    }
    // 并列都算（同族 offset 本该唯一，这一条是兜底）。一族只剩一条线时 lo === hi，
    // 那一条只进一次。
    for (const e of bucket) {
      if (e.line.offset !== lo && e.line.offset !== hi) continue;
      if (e.live.length < threshold) continue; // 不足门槛：不是边，而且挡住这一端
      if (!endsAll(board, e.line, e.live)) continue;
      out.push({ line: e.line, live: e.live });
    }
  }
  return out;
}

/**
 * 最短的那条可削外边有几枚；一条都没有就回 0。
 *
 * 卡死判定要它（某色星星够不够填满一条外边），HUD 上那一行也要它。
 */
export function shortestEdge(board: EdgeBoard, threshold: number = EDGE_MIN): number {
  let best = 0;
  for (const e of outerEdges(board, threshold)) {
    if (best === 0 || e.live.length < best) best = e.live.length;
  }
  return best;
}

/**
 * 给一族线按几何算出 `offset`——**给那些没有现成整数偏移的棋盘用的**。
 *
 * 大多数棋盘的线族天生带着一个整数（小球三角的 d / e / r、菱形方块的 d1 / r / c、
 * 六边圆球的立方坐标 x / y / z），直接拿来当 offset 最清楚。六边三角那一副不行：
 * 它的两个斜向族是按「共边的邻居」并查集拼出来的链，链上正反三角交替，没有一个
 * 现成的数。
 *
 * 做法：同一族里的线互相平行，所以拿这条线**两端**定出方向 u，法向 n = u 转 90°，
 * offset = 这条线所有格子中心在 n 上的平均投影。平行的线 u 相同，于是 offset 在这
 * 一族里单调。取平均而不是取某一格：三角格阵上一条斜链是锯齿状的，单看一格会抖。
 *
 * @param posOf 这一格的中心在某个平面坐标系里的位置。哪个坐标系无所谓，只要同一副
 *   棋盘前后一致——算的是「谁比谁更靠外」，不是真实像素。
 */
export function assignOffsets(
  lines: readonly (EdgeLine & { offset: number })[],
  posOf: (r: number, c: number) => readonly [number, number],
): void {
  for (const line of lines) {
    const cells = line.cells;
    if (!cells.length) continue;
    const [fr, fc] = cells[0];
    const [lr, lc] = cells[cells.length - 1];
    const [x0, y0] = posOf(fr, fc);
    const [x1, y1] = posOf(lr, lc);
    let ux = x1 - x0;
    let uy = y1 - y0;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;
    // 法向：u 转 90°。
    const nx = -uy;
    const ny = ux;
    let sum = 0;
    for (const [r, c] of cells) {
      const [x, y] = posOf(r, c);
      sum += x * nx + y * ny;
    }
    // 留三位小数：平行的线在浮点上未必分毫不差，而 outerEdges 是拿等号挑极值的。
    (line as { offset: number }).offset = Math.round((sum / cells.length) * 1000) / 1000;
  }
}
