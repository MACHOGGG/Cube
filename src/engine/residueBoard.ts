/**
 * 把一副真棋盘喂给残局穷举（`engine/residueSearch.ts`）。
 *
 * 搜索件自己不认几何——它收的是「算好的重排」和「格号」。这个文件就是那层转换：棋盘交出
 * 它的线、它此刻每一格是什么，这儿把它们编成搜索件认得的样子。
 *
 * ── 为什么六副棋盘只要两个适配 ────────────────────────────────
 *
 * 五副外边族（小球、菱形方块、六边圆球、七色圆球、六边三角 54）的 `edgeBoard` 长得一模一
 * 样：`{ lines: LINES, isLive: (r, c) => 在界内 && !isBlank(grid[r][c]) }`。方块那一副没有
 * 外边的概念，线就是此刻的每一行每一列。所以 `edgeResidue()` 服务前五副，`gridResidue()`
 * 服务方块。六边三角 54 只多一样：它的滑动不是普通循环位移（只许偶数步 + filler 配对交
 * 换），传 `filler: true` 换一套重排。
 *
 * ── 三个容易接错的地方，都在这儿钉死 ──────────────────────────
 *
 * **① 线上的格子要**全**给，不是只给 `liveTiles()` 那一份。** 各副棋盘的 `liveTiles()` 把
 * 空白球和活炸弹**排除在外**（它是给计分和卡死计数用的）。可空白球是**跟着线一起滑**的
 * （circleHex 那段注释记着一次事故：从前按坐标豁免中心空位，滑过一行之后豁在了一枚真球
 * 上）。漏掉它们，搜索件算出来的就是另一副棋盘。
 *
 * **② 空白和活炸弹编成「配不上任何颜色」**（`RESIDUE_BLANK`）。炸弹看着像偷懒，其实安
 * 全：拆炸弹要先有一次得分，而只要有任何一个到得了的盘面能得分，答案已经是「活」了。
 *
 * **③ 不在盘上的格子不进线**（方块消掉整行整列之后那些坐标）。留着它们等于在盘上插一堵
 * 看不见的墙，把本来连得上的一段截断——那会让搜索件少看见一些得分，往「判死」那一侧偏，
 * 而那是最不能偏的方向。
 */
import type { Cell } from './types';
import { EDGE_MIN, outerEdges, type EdgeBoard } from './outerEdge';
import {
  RESIDUE_BLANK,
  cyclicShuffles,
  encodeTile,
  fillerAwareShuffles,
  residueSearch,
  type BonusLine,
  type ResidueVerdict,
} from './residueSearch';

/** 这一格此刻是什么。`null` = 不在盘上（不占位置、不参与滑动）。 */
export type ResidueCellAt = (r: number, c: number) => { color: number; dot: boolean } | 'blank' | null;

/** 可用枚数超过这个数就不穷举了——§4 的字面值。 */
export const RESIDUE_MAX_TILES = 16;

interface Built {
  index: Map<string, number>;
  start: Uint16Array;
  lines: number[][];
}

const key = (r: number, c: number) => r + ',' + c;

/** 把线和格子编成号。不在盘上的格子直接不进线。 */
function build(lines: readonly (readonly Cell[])[], at: ResidueCellAt): Built {
  const index = new Map<string, number>();
  const codes: number[] = [];
  const out: number[][] = [];
  for (const line of lines) {
    const row: number[] = [];
    for (const [r, c] of line) {
      const got = at(r, c);
      if (got === null) continue;
      const k = key(r, c);
      let id = index.get(k);
      if (id === undefined) {
        id = codes.length;
        index.set(k, id);
        codes.push(got === 'blank' ? RESIDUE_BLANK : encodeTile(got.color, got.dot));
      }
      row.push(id);
    }
    if (row.length >= 2) out.push(row);
  }
  return { index, start: Uint16Array.from(codes), lines: out };
}

function toBonus(
  built: Built,
  bonus: readonly { cells: readonly Cell[]; need: number }[],
): BonusLine[] {
  const out: BonusLine[] = [];
  for (const { cells, need } of bonus) {
    const ids: number[] = [];
    for (const [r, c] of cells) {
      const id = built.index.get(key(r, c));
      if (id !== undefined) ids.push(id);
    }
    if (ids.length) out.push({ cells: ids, need });
  }
  return out;
}

export interface ResidueOpts {
  lines: readonly (readonly Cell[])[];
  at: ResidueCellAt;
  matchLen: number;
  bonusLines: readonly { cells: readonly Cell[]; need: number }[];
  /** 六边三角 54 那一套（只许偶数步 + filler 配对交换）。 */
  filler?: boolean;
}

/** 跑一趟穷举。盘子太大就不跑，直接当「算不完」。 */
export function residueVerdict(opts: ResidueOpts): ResidueVerdict {
  const built = build(opts.lines, opts.at);
  /*
   * 盘子还大的时候不跑：§4 定的是「**可用** ≤16 枚时」。大盘上那 20000 个状态连一层都展
   * 不开，答案必然是 'unknown'，白白花掉 250ms——而这一问每走一步都要问一次。
   *
   * ⚠️ 数的是**非空白**的那几枚，不是线上的总格数。外边族消掉的球是**原地变空白**（不
   * 离场，照样滑），所以晚盘上大半格子是空白——按总格数卡的话这个兜底在五副外边族上
   * **永远不会触发**，而那正是最需要它的时候。第一版就是按总格数写的。
   */
  let usable = 0;
  for (let i = 0; i < built.start.length; i++) if (built.start[i] !== RESIDUE_BLANK) usable++;
  if (usable > RESIDUE_MAX_TILES) return 'unknown';
  if (!built.lines.length) return 'unknown';
  return residueSearch({
    start: built.start,
    moves: opts.filler ? fillerAwareShuffles(built.lines) : cyclicShuffles(built.lines),
    scanLines: built.lines,
    matchLen: opts.matchLen,
    bonusLines: toBonus(built, opts.bonusLines),
  });
}

/**
 * 外边族那五副：线就是 `edgeBoard.lines`，能消的线就是此刻那几条可削外边。
 *
 * `threshold` 和问 `shortestEdge` 用的是同一个（常态 3，收尾放开后 1）——两处要是给不同
 * 的数，计数那层和穷举这层判的就是两副不同的棋盘。
 */
export function edgeResidue(
  board: EdgeBoard,
  at: ResidueCellAt,
  matchLen: number,
  threshold: number = EDGE_MIN,
  filler = false,
): ResidueVerdict {
  const bonus = outerEdges(board, threshold).map((e) => ({ cells: e.live, need: threshold }));
  // `EdgeLine` 比一串格子多带两位（族名、法向偏移），穷举这头只要格子。
  const lines = board.lines.map((l) => l.cells);
  return residueVerdict({ lines, at, matchLen, bonusLines: bonus, filler });
}

/**
 * 方块那一副：线是此刻的每一行每一列，能消的线是**整行或整列全是同色星星**。
 *
 * 所以每条线的门槛就是它自己此刻的长度——消掉整行整列之后盘子变小，门槛跟着变小，这一点
 * 必须现问，不能写死 6。
 */
export function gridResidue(
  rows: number,
  cols: number,
  at: ResidueCellAt,
  matchLen: number,
): ResidueVerdict {
  const lines: Cell[][] = [];
  for (let r = 0; r < rows; r++) lines.push(Array.from({ length: cols }, (_, c) => [r, c] as Cell));
  for (let c = 0; c < cols; c++) lines.push(Array.from({ length: rows }, (_, r) => [r, c] as Cell));
  const bonus = lines.map((cells) => ({ cells, need: cells.length }));
  return residueVerdict({ lines, at, matchLen, bonusLines: bonus });
}
