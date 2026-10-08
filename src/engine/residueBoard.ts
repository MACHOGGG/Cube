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
 * **① 线上的格子按「此刻还在盘上的」给，不是按 `liveTiles()` 给。** 两者差一样东西：活
 * 炸弹。`liveTiles()` 把空白**和活炸弹**都排除在外（它是给计分和卡死计数用的），可活炸弹
 * 真的占着一格、真的跟着线滑——漏掉它，搜索件算出来的就是另一副棋盘。
 *
 * ⚠️ **空白是另一回事：它不在盘上，所以根本不进线。** 2026-10-02 之前这儿写的是「空白球
 * 跟着线一起滑」，那是**星星消除那个年代**的事（消掉的球原地变成一枚无色球，确实照样
 * 滑）。《侵蚀阶梯》PR-3 把外边族改成「削掉的格子离场」之后，滑动就是在 `liveOnLine()`
 * 那一串上做循环移位（见各副棋盘的 `applyDrag`）——被削掉的格子已经不在那串里，剩下的球
 * 首尾相接，整条线变短。所以五副外边族的 `residueAt` 现在对空白回 `null`。
 *
 * 那一句错着的后果：穷举拿到的线长不对，循环位移算出来的排列整个不对。它既会算出真实棋
 * 盘到不了的得分（该判死的判活），也会漏掉真实棋盘到得了的（该判活的判死）——而两种都只
 * 是「局不结束」或者「局突然结束」，屏幕上一个字都不报。
 *
 * **② 活炸弹编成「配不上任何颜色」**（`RESIDUE_BLANK`）。看着像偷懒，其实安全：拆炸弹要
 * 先有一次得分，而只要有任何一个到得了的盘面能得分，答案已经是「活」了。
 *
 * **③ 不在盘上的格子不进线**（方块消掉整行整列之后那些坐标）。留着它们等于在盘上插一堵
 * 看不见的墙，把本来连得上的一段截断——那会让搜索件少看见一些得分，往「判死」那一侧偏，
 * 而那是最不能偏的方向。
 *
 * **④ 例外：六边圆球中心那个永久空位是一堵真墙**（2026-10-08 方案 2-4）。真棋盘扫「同线连续
 * N 枚」时它就在线上、把两边断开，只是滑的时候球隔着它首尾相接。所以它不能像 ③ 那样整个
 * 不进线——它回 `'hole'`：滑动那头不进线，扫描那头占一格。照 ③ 那样压实，洞两边两枚同色球
 * 在穷举里就成了「连着的」，实盘永远得不了分的残局被判活，局不结束。
 */
import type { Cell, Tile } from './types';
import { EDGE_MIN, outerEdges, type EdgeBoard } from './outerEdge';
import { erodedShapes, findTargetAt, orientationsOf, type BoardView } from './targetMatch';
import type { TargetPattern } from './targets';
import {
  RESIDUE_BLANK,
  colorOf,
  cyclicShuffles,
  encodeTile,
  fillerAwareShuffles,
  isDot,
  residueSearch,
  type BonusLine,
  type LineShuffle,
  type ResidueVerdict,
} from './residueSearch';

/**
 * 这一格此刻是什么。
 *
 *   · `null`：不在盘上——不占位置、不参与滑动、也不出现在扫描线上。
 *   · `'blank'`：占着一格、**跟着线滑**，可配不上任何颜色（活炸弹）。
 *   · `'hole'`：占着线上的一个位置、**不滑**，也配不上任何颜色。只有六边圆球中心那个永久空位
 *     是这样（2026-10-08 方案 2-4），见 build() 上面那段。
 */
export type ResidueCellAt = (r: number, c: number) => { color: number; dot: boolean } | 'blank' | 'hole' | null;

/** 可用枚数超过这个数就不穷举了——§4 的字面值。 */
export const RESIDUE_MAX_TILES = 16;

interface Built {
  index: Map<string, number>;
  /** 反过来：格号 → 它的行列。老虎机那一支要用它当「从哪儿起手试这个形状」。 */
  cells: Cell[];
  start: Uint16Array;
  /** 滑动用的线：只有跟着线滑的格子（洞不在里面）。 */
  moveLines: number[][];
  /** 扫「同线连续 N 枚」用的线：洞在里面，占一个位置、把两边断开。没有洞的棋盘两份一模一样。 */
  scanLines: number[][];
}

const key = (r: number, c: number) => r + ',' + c;

/**
 * 把线和格子编成号。不在盘上的格子直接不进线。
 *
 * **洞要分两头编**（2026-10-08 方案 2-4）。六边圆球中心那个永久空位，真棋盘对它的两种待遇
 * 不一样：
 *
 *   · 滑的时候它**不在**那一串里（applyDrag 滑的是 liveOnLine，空位不算），两边的球隔着它首
 *     尾相接——所以滑动那头照旧压实，洞不进 moveLines；
 *   · 扫「同线连续 N 枚」的时候它**在**（findRunMatches 按整条几何线扫，空位让 qualifies
 *     不成立），洞两边的两枚**不算相邻**——所以扫描那头洞要占一格，编成配不上任何颜色的
 *     RESIDUE_BLANK，把两边断开。
 *
 * 从前洞回 `null`，两头一起压实：洞左右两枚同色球在穷举里成了「连着的两枚」。于是一副实盘上
 * 怎么滑都得不了分的残局，穷举说「还能得分」，局就永远不结束——正是这个兜底要治的那个病，
 * 换了个来路又回来了。洞不在任何一条滑动线里，所以它那一格的编码永远是起手那个
 * RESIDUE_BLANK，不会被滑走、也不会被别的球换进来。
 */
function build(lines: readonly (readonly Cell[])[], at: ResidueCellAt): Built {
  const index = new Map<string, number>();
  const cells: Cell[] = [];
  const codes: number[] = [];
  const moveLines: number[][] = [];
  const scanLines: number[][] = [];
  for (const line of lines) {
    const scan: number[] = [];
    const move: number[] = [];
    for (const [r, c] of line) {
      const got = at(r, c);
      if (got === null) continue;
      const k = key(r, c);
      let id = index.get(k);
      if (id === undefined) {
        id = codes.length;
        index.set(k, id);
        cells.push([r, c]);
        codes.push(got === 'blank' || got === 'hole' ? RESIDUE_BLANK : encodeTile(got.color, got.dot));
      }
      scan.push(id);
      if (got !== 'hole') move.push(id);
    }
    if (move.length >= 2) moveLines.push(move);
    if (scan.length >= 2) scanLines.push(scan);
  }
  return { index, cells, start: Uint16Array.from(codes), moveLines, scanLines };
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

/**
 * 老虎机那一局认的得分形状（E33 的 (a)）。
 *
 * 只有方块和小球开老虎机，所以只有这两副会给它。
 */
export interface ResidueSlot {
  /** 这一局转出来的那个图案。 */
  target: TargetPattern;
  /**
   * 当前侵蚀级要几枚——`sizeAtLevel(target, level)`，也就是 HUD 那一块此刻画着的那个数
   * （`patternBlock.ts` 的 `shownCount`）。棋盘那头现成的 `targetNeed()` 就是它。
   *
   * ⚠️ 这个数和计数那一层的门槛**必须是同一个**（棋盘那头两处都传 `need`）。给不同的数，
   * 两层判的就是两副不同的棋盘：计数层按 3 枚说活、穷举层按 4 枚说死，结果取后者。
   */
  need: number;
}

/**
 * 老虎机那一局的 (a)：这个盘面上拼成了当前级那个形状没有。
 *
 * **拿的是屏幕上真的给不给分那把尺子**（`targetMatch.ts` 的 `findTargetAt`），不另抄一
 * 份——「同一件事写两遍、改一处漏一处」这个仓库栽过不止一次，而这一处漏了的后果是「穷举
 * 说死、玩家明明还拼得出」，1.4 秒直接结算。
 *
 * 两样在**开搜之前**就算定（E33 明文「外边、目标、门槛在开搜前算好，搜索中不变」）：
 *
 *   · 形状表摊平成一张 `variants`。`erodedShapes` 和 `orientationsOf` 各自带缓存，可那
 *     是「每调一次查一次 Map」，而这一问每个盘面都要问一遍（最多两万个）。
 *   · 起手格就是 `built.cells`，**只含此刻还在盘上的格子**。丢掉不在盘上的那些不会漏掉
 *     任何一处匹配：图案第一枚落的正是起手那一格（`place()` 对 cells[0] 的位移是 0），
 *     起手格不在盘上，`findTargetAt` 第一问就回 null。
 */
function patternHitFor(built: Built, slot: ResidueSlot): (state: Uint16Array) => boolean {
  const variants: TargetPattern[] = [];
  for (const p of erodedShapes(slot.target, slot.need)) variants.push(...orientationsOf(p));

  // 这把 view 是**跟着当前盘面走**的一层壳：每问一个盘面就换一次 `cur`，而不是每个盘面
  // 新建一个 BoardView（两万个盘面 × 一个对象，白白给垃圾回收添活）。
  let cur: Uint16Array = built.start;
  const idAt = (r: number, c: number) => built.index.get(key(r, c));
  const view: BoardView = {
    has: (r, c) => {
      const id = idAt(r, c);
      return id !== undefined && cur[id] !== RESIDUE_BLANK;
    },
    tileAt: (r, c) => {
      const id = idAt(r, c);
      if (id === undefined) return null;
      const code = cur[id];
      // 配不上任何颜色的那一格（活炸弹、方块消过的空位）当「没有这一枚」，不是「一枚灰
      // 色的」——不然一片空位会被当成同色拼成了图案。和两副棋盘真的那份 targetView 一
      // 个口径（见 circle.ts 那一处的注释）。
      if (code === RESIDUE_BLANK) return null;
      const color = colorOf(code);
      // 假棋子：`findTargetAt` 只问 `effColor` 和 `face` 两样。正反两面都填同一个颜色，
      // 于是 effColor 怎么走都对。
      const tile: Tile = { id: 0, color, dotColor: color, face: isDot(code) ? 'dot' : 'flavor' };
      return tile;
    },
    cells: () => built.cells,
  };
  const anchors = view.cells();

  return (state: Uint16Array) => {
    cur = state;
    for (const variant of variants) {
      for (const anchor of anchors) {
        if (findTargetAt(view, variant, anchor)) return true;
      }
    }
    return false;
  };
}

export interface ResidueOpts {
  lines: readonly (readonly Cell[])[];
  at: ResidueCellAt;
  matchLen: number;
  bonusLines: readonly { cells: readonly Cell[]; need: number }[];
  /** 老虎机那一局：给了就按转出来那个形状判，`matchLen` 那条 1×N 整个不走。 */
  slot?: ResidueSlot;
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
   * ⚠️ 数的是**非 RESIDUE_BLANK** 的那几枚，不是线上的总格数。差的那几枚是**活炸弹**：它
   * 们占着格子、跟着线滑，可一个也配不上，不该算进「可用」。
   *
   * （这一段从前的理由是另一个：那时候外边族消掉的球「原地变空白、照样滑」，于是晚盘上大
   * 半格子是空白，按总格数卡的话这个兜底永远不会触发。那个前提 2026-10-02 起不成立了——空
   * 白现在压根不进线，见文件顶上 ① 那段 ⚠️。按非空白数这件事本身照旧对，所以留着。）
   */
  let usable = 0;
  for (let i = 0; i < built.start.length; i++) if (built.start[i] !== RESIDUE_BLANK) usable++;
  if (usable > RESIDUE_MAX_TILES) return 'unknown';
  if (!built.moveLines.length) return 'unknown';
  return residueSearch({
    start: built.start,
    moves: opts.filler ? fillerAwareShuffles(built.moveLines) : cyclicShuffles(built.moveLines),
    scanLines: built.scanLines,
    matchLen: opts.matchLen,
    patternHit: opts.slot ? patternHitFor(built, opts.slot) : undefined,
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
  slot?: ResidueSlot,
): ResidueVerdict {
  const bonus = outerEdges(board, threshold).map((e) => ({ cells: e.live, need: threshold }));
  // `EdgeLine` 比一串格子多带两位（族名、法向偏移），穷举这头只要格子。
  const lines = board.lines.map((l) => l.cells);
  return residueVerdict({ lines, at, matchLen, bonusLines: bonus, filler, slot });
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
  slot?: ResidueSlot,
): ResidueVerdict {
  const lines = gridLines(rows, cols);
  const bonus = lines.map((cells) => ({ cells, need: cells.length }));
  return residueVerdict({ lines, at, matchLen, bonusLines: bonus, slot });
}

/** 方块那一副此刻的线：每一行、每一列（消掉整行整列之后盘子变小，所以现给行列数）。 */
export function gridLines(rows: number, cols: number): Cell[][] {
  const lines: Cell[][] = [];
  for (let r = 0; r < rows; r++) lines.push(Array.from({ length: cols }, (_, c) => [r, c] as Cell));
  for (let c = 0; c < cols; c++) lines.push(Array.from({ length: rows }, (_, r) => [r, c] as Cell));
  return lines;
}

/**
 * 一步之内能走到的每一个盘面——**只给走法，不判分**（第 15 推，教学的呼吸灯）。
 *
 * 呼吸灯要回答「再走一步就能完成这一条的是哪几枚」，那就得把一步之内的每一种滑法都试一
 * 遍。滑法用的就是上面穷举那一套（同一个 `build`、同一个 `cyclicShuffles` /
 * `fillerAwareShuffles`），不另抄：两份滑法一旦走样，灯就会亮在一组**玩家滑不出来**的棋
 * 子上——那比不亮还糟，他照着灯去滑，什么都不发生。
 *
 * 和穷举那头的差别只有一处：这儿不编码颜色（判分交还给棋盘自己的 findMatches，见
 * engine/coachHint.ts），所以 `isOn` 只问「这一格在不在线上」——口径和 `ResidueCellAt`
 * 回不回 `null` 一样：不在盘上的格子不进线。
 *
 * @returns `cells[k]` 是格号 k 的行列；每一步 `moves[i]` 的 `cells` / `src` 都是格号。
 */
export function oneStepMoves(
  lines: readonly (readonly Cell[])[],
  isOn: (r: number, c: number) => boolean,
  filler = false,
): { cells: Cell[]; moves: LineShuffle[] } {
  const built = build(lines, (r, c) => (isOn(r, c) ? 'blank' : null));
  return { cells: built.cells, moves: filler ? fillerAwareShuffles(built.moveLines) : cyclicShuffles(built.moveLines) };
}
