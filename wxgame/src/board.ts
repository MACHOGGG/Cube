/**
 * 一副棋盘对外长什么样。
 *
 * 方块是 6×6 的方格，小球是 28 颗堆成的三角，三角是一排排交错的正三角形——
 * 形状差得远，但主循环（main.ts）对它们做的事是同一件：发牌、手指按住一条线
 * 拖、松手滑一格、跑一遍连锁、判结束。所以把「不一样的地方」收进这个接口里，
 * 主循环就只认这一个接口，加一副新棋盘不用动主循环。
 *
 * 坐标这件事分两层：
 *   · 逻辑坐标 (r, c)——规则那一层用的，每副棋盘自己定义（方块是行列，小球
 *     第 r 排有 r+1 颗）。
 *   · 画面坐标——centerOf() 给的，单位是「一格的半边长」。画的时候乘上真尺寸
 *     就是屏幕坐标。这样排版那段代码不必知道棋盘长什么样。
 */
import type { Cell, Tile } from '../../src/engine/types';
import type { CascadeStepper } from '../../src/engine/scoring';
import type { RemainingTileCounts } from '../../src/engine/stalemate';

/** 加分气泡上写的名字。 */
export interface BoardLabels {
  block22: string;
  run4: string;
  line: string;
  pattern: string;
  /** 小球那副棋盘独有的菱形 1-2-1。 */
  diamond121: string;
  /** 三角那副棋盘独有的「31 / 13」大三角。 */
  bigTriangle: string;
}

/** 一条能滑的线：它串起哪几颗，以及它在画面上朝哪个方向。 */
export interface BoardLine {
  id: string;
  cells: Cell[];
  /** 单位向量（画面坐标）。手指往哪边拖，就跟投影最大的那条线走。 */
  vec: [number, number];
}

export interface Board {
  readonly kind: 'square' | 'circle' | 'triangle';
  /** 这副棋盘的正面配色。 */
  readonly palette: readonly string[];
  readonly rows: number;
  /** 第 r 排有几颗。 */
  cellsInRow(r: number): number;
  tileAt(r: number, c: number): Tile;
  /** 消掉之后留在原地的空位（方块那副没有，永远是 false）。 */
  isBlankAt(r: number, c: number): boolean;
  /** 这一枚朝上吗——只有三角那副分朝向，另外两副一律 true。 */
  pointsUp(r: number, c: number): boolean;
  /** 一颗的中心，单位是「半边长」。 */
  centerOf(r: number, c: number): [number, number];
  /** 整副棋盘在这套单位里的包围盒——排版拿它算缩放。 */
  extent(): { minX: number; minY: number; w: number; h: number };
  /** 穿过这一颗的所有线。 */
  linesThrough(r: number, c: number): BoardLine[];
  /**
   * 把一条线循环滑 by 步，返回这条线上的格子——连锁从这儿找起。
   *
   * 单位是「步」不是「格」：方块和小球一步就是一格，三角一步是两枚（那副棋
   * 盘只能偶数步滑，见 triangleBoard.ts 开头）。一步在画面上都是 2 个单位，
   * 所以主循环只管「手指走了几个 2 单位」，三副棋盘同一段代码。
   */
  shiftLine(id: string, by: number): Set<string>;
  deal(): void;
  cascade(mask: Set<string>): CascadeStepper;
  isGameOver(): boolean;
  stuckGroups(): Cell[][];
  remaining(): RemainingTileCounts;
}
