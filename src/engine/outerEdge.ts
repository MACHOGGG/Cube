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

/** 这条线此刻的活格，按线上的顺序。 */
export function liveOn(board: EdgeBoard, line: EdgeLine): Cell[] {
  return line.cells.filter(([r, c]) => board.isLive(r, c)).map(([r, c]) => [r, c] as Cell);
}

/*
 * 这儿原先有一个 `atSegmentEnd(board, line, cell)`：「这一格贴着自己那一段连续活格
 * 的某一端吗」，endsAll 拿它逐格问。那条写法在三角格阵上是错的——斜向线是正反三角
 * 交替的锯齿链，会在同一行里连着吃掉两枚，靠里的那一枚永远不贴端，于是六边蜂窝 54
 * **一条边都削不动**（check-edge-band 逮到的）。
 *
 * 现在 endsAll 量的是「削掉之后每条线的段数有没有变多」，直接说的就是它要保证的那
 * 件事，也不必再逐格问贴不贴端。
 */

/** 一条线上活格分成几段（段与段之间夹着不在盘上的格子）。 */
function runCount(cells: readonly Cell[], isLive: (r: number, c: number) => boolean): number {
  let runs = 0;
  let prev = false;
  for (const [r, c] of cells) {
    const now = isLive(r, c);
    if (now && !prev) runs++;
    prev = now;
  }
  return runs;
}

/**
 * §3 的 endsAll：**削掉这条线之后，每一条线剩下的活格还和削之前一样连**。
 *
 * 量的是「段数有没有变多」，不是「每个格子是不是贴着端」。两种写法在规整的格阵上
 * 给出同样的答案，但在**三角格阵上不一样**，而那才是真棋盘：
 *
 * 六边蜂窝 54 的斜向线是一条正反三角交替的锯齿链，它会在同一行里连着吃掉两枚。按
 * 「贴着端」算的话，那一对里靠里的那一枚永远不贴端——于是这副棋盘**一条边都削不
 * 动**，整局打到最后谁也消不掉，而且一个字的错都不报。（第一版就是这么写的，
 * check-edge-band 当场逮到：五副外边族里只有它画不出带子。）
 *
 * 按段数算就对了：那一对是链的**头两枚**，拿掉之后链还是一整段。真正要拦的是「从
 * 中间掏一刀」——那一刀会把某条线从一段变成两段，段数立刻多一。
 *
 * 顺带也把六边圆球中心那个永久空位处理干净了：它本来就把三条线各截成两段，削边前
 * 后都是两段，段数没变，所以它不挡任何边。
 */
export function endsAll(board: EdgeBoard, line: EdgeLine, live: Cell[]): boolean {
  const gone = new Set(live.map(([r, c]) => `${r},${c}`));
  const after = (r: number, c: number) => board.isLive(r, c) && !gone.has(`${r},${c}`);
  for (const other of board.lines) {
    // 这条线自己整条要没，不用问它连不连。
    if (other === line) continue;
    const before = runCount(other.cells, board.isLive);
    if (before === 0) continue;
    const now = runCount(other.cells, after);
    // 整条都被削掉了也行（比如只剩一枚、正好在这条边上）——那不叫断成两段。
    if (now > before) return false;
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
