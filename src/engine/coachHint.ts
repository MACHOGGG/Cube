/**
 * 教学的呼吸灯：**每一种颜色最少几步能完成这一条、亮哪几枚**（10-11 方案 D-2 ～ D-4，按玩家规格重做）。
 *
 * ── 现在的规矩 ───────────────────────────────────────────────────────────────
 *
 *   · B「星星可以与色块一同再次拼出得分图案」、C「得分图案会随着游戏解锁而变化」——目标（`group`）是**当前 N 的任
 *     意一组得分图案**：同色连着 ≥ N、至少一枚色块、碰到最后滑过的那条线。和真结算一字不差：认组问的就是棋盘结
 *     算用的那一份（`scoring`），这儿一个字不写「什么算一组」。
 *       - 按颜色算**精确的最少步数**（IDA*，估值 `h = min_线 max(0, N − 这条线上这一色的枚数)`：方块、小球上两条线
 *         最多交一格，滑一步最多让某一条线上这一色多一枚、自己那条线上的枚数不变，所以 h 一步最多减 1，不会高估）。
 *         各色的界一起往上加，哪一档有颜色成了就停（minDepths）：挑色只要知道「最少的是哪几色」。中间哪一步自己就
 *         会得分或消边，那一支剪掉——真滑下去盘面就变了，后面那几步不成立。
 *       - 挑色：步数最少；平手先留正在亮的那一色（「不跳色」）；再平时留**含星星**的组（贴合 B 那句话）；再平按
 *         **盘面哈希**挑——同一副盘面每次重算都挑同一色，不同盘面之间仍是随机的。
 *       - 亮哪几枚：只亮最优方案**最后一步成组的那 N 枚**，同色的别的不亮；同一色里先沿用上一次那一组。
 *   · D「同色星星在整体的外边会得分并消除」——目标（`edge`）是某一色的星星填满一条**此刻能消**的外边（方块：任意
 *     整行整列；小球：棋盘交上来的那几条外边）。IDA*，估值 `h = min_边 (|边| − 这条边上这一色的星星数)`。认「填满」
 *     认的是那一步滑完、连锁还没动之前的盘面（连锁第一拍问的就是整线消除，见 engine/scoring.ts 的 next）；不把那
 *     一步连锁里翻出来的星星算进去，所以 h 不会因为「一步翻出好几颗」而高估（门里拿不带估值的逐层加深逐个对）。
 *       - 亮的是这一色**在场的所有星星**；色块一枚不亮。
 *       - 一色都填不满任何一条边（星星不够）：亮「还差的枚数」最少的那一色的所有星星（玩家已定）。
 *   · 有上限：一次重算最多看 HINT_NODE_CAP 个盘面。超了退回「按估值排」（每一色按此刻的 h 排，最小的那一色）并标
 *     `estimate`——不卡住，也不至于一盏都不亮。
 *
 * ── 算在哪儿、什么时候亮（D-4）──────────────────────────────────────────────
 *
 * 状态只有一份（`CoachGlowState`：哪一种目标、哪一色、哪几枚、几步、版本号），页面上的灯全部从它派生；棋盘每次
 * 重画只按它「重挂」，不重算。搜索拆成每段 ≤ SLICE_MS 毫秒，用 MessageChannel 一段段排（没有的内核退回
 * setTimeout(0)）；新的一步开始时作废没算完的那一份（版本号）；**算完才亮**，不先亮一个次优色再跳。
 *
 * 不碰 DOM、不认几何：棋盘把「这一步滑完会不会得分 / 消边」「一枚是什么颜色」交进来。所以 check-coach.mjs 能拿手摆
 * 的盘面单独验它，check-coach-aim.mjs 拿真棋盘对一遍。
 *
 * ── 从前那一版为什么换掉（10-11 方案 D-0，已复现）────────────────────────────────
 *
 *   1. 上限 15ms / 两万个盘面：满盘看两层要三四千个盘面、中位 17–20ms，算不完就「不亮」且不再重试——有两步解却
 *      不亮约占一半，门把这当成「对」，一直绿着。
 *   2. 目标比得分规则窄：第 2 条只认含星星的组，第 1、3 条只认全是色块的组；游戏里任何一组都得分。
 *   3. 第 4 条只看 3 步（实际要 2–5 步），亮的是那条边上的星星加同色色块——和规格「该色所有星星、色块不亮」相反。
 *   5. 慢手机冷启动：第一层就超 15ms，开局一步解也不亮。（第 4 个根因在棋盘的动画那一头，见 scoreOutline.ts。）
 */
import type { Cell } from './types';
import type { LineShuffle } from './residueSearch';

/**
 * 教学条此刻要灯做什么（ui/coachBar.ts 按条给）：
 *
 *   group      B：拼出当前 N 的一组，每一步结算完重算
 *   groupOnce  C：同上，但只在这一条刚出来那一下算一次；之后灯跟着那几枚走，它们被翻掉、离场就熄
 *   edge       D：某一色的星星填满一条能消的外边
 *
 * A、E 不亮，没有它们那一种。
 */
export type CoachHint = 'group' | 'groupOnce' | 'edge';

/** 一次重算最多看几个盘面（D-4：「总上限十几万盘面」）。 */
export const HINT_NODE_CAP = 150_000;

/** 搜索每一段最多跑几毫秒，然后把控制权让出去（D-4）。 */
export const SLICE_MS = 3;

/** 最多看几步。真正的闸是 HINT_NODE_CAP；这个只是不让估值失灵时一路往下挖。 */
export const HINT_MAX_DEPTH = 8;

/**
 * 每走这么多个盘面让一次（调用方看钟、该停就停）。不能大：慢手机上（CPU 降速六倍量过）一个盘面要 0.2–0.3ms，原先
 * 64 个一让，一段就跑到 15–25ms，「每段 ≤ 3ms」成了空话（10-11 方案 D-5 第 2 条那道门量的正是这个）。
 */
const CHECK_EVERY = 4;

/** 棋盘交给搜索的那一份视图。 */
export interface PlanBoard<T extends { id: number }> {
  /** 此刻的盘面——试走的时候**就地**换线、问完换回来，算完原样不动。 */
  grid: T[][];
  /** 一步之内的全部滑法（residueBoard.oneStepMoves）。一步滑动只在线上换位置，所以第几步用的都是这一份。 */
  step: { cells: readonly Cell[]; moves: readonly LineShuffle[] };
  /** 一组能落在上面的那几条线（此刻在盘上的格子，按线上的顺序）。只给 group 的估值用。 */
  lines: readonly (readonly Cell[])[];
  /** 此刻能消的外边（一次搜索里几何不变）。只给 edge 用。 */
  edges: readonly (readonly Cell[])[];
  /** 当前的得分图案是几枚。 */
  n: number;
  /** 滑完这一步，真结算会认出的那几组（至少一枚色块、碰到 moved），格子在**试走过的盘面**上。 */
  scoring(trial: T[][], moved: Set<string>): readonly (readonly Cell[])[];
  /** 滑完这一步，连锁第一拍会消掉的那几条外边（整条同色星星）。 */
  clearing(trial: T[][]): readonly (readonly Cell[])[];
  /** 这一枚算什么颜色：色块看正面，星星看露出来的那一色（engine/types 的 effColor）。 */
  colorOf(t: T): number;
  /** 这一枚算不算一枚能进组的棋子（空位、离场的、炸弹不算）。 */
  isPiece(t: T): boolean;
  /** 这一枚是不是一颗星星（能填外边的那种）。 */
  isStar(t: T): boolean;
  /** 这一枚是不是色块（正面朝上）。 */
  isBlock(t: T): boolean;
}

/** 上一次亮的是什么——「不跳色」「同一色里沿用上一组」认的是它。 */
export interface PlanPrev {
  color: number | null;
  ids: readonly number[];
}

/** 一次搜索的结果。 */
export interface PlanResult {
  /** 挑中的那一色；一色都没有是 null（这一次不亮）。 */
  color: number | null;
  /** 要亮的那几枚（棋子 id）。group：正好 N 枚；edge：那一色在场的所有星星。 */
  ids: number[];
  /** 那一色最少几步；退回估值、或者星星不够填任何一条边时是 0。 */
  depth: number;
  /** 盘面数超了上限，退回按估值排的（D-4「标『估计』」）。 */
  estimate: boolean;
}

/** 搜索途中报一下进度：走了几个盘面。门（check-coach）拿它量上限。 */
export interface PlanStats {
  nodes: number;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * 盘面哈希：平手时按它挑（D-2）。同一副盘面（每一格是哪一枚、哪一面朝上）永远是同一个数——重算十次挑同一色、
 * 灯不闪；换了一副盘面就是另一个数，所以不同盘面之间仍是随机的。FNV-1a，最后再搅一遍（murmur3 的 fmix32）。
 *
 * 最后那一遍不能省：挑的时候拿的是 `哈希 % 几样`，看的是最低那几位，而 FNV-1a 的最低一位只跟着「每一格最低一位」
 * 的异或走——这儿每一格是 `id × 4 + 哪一面`，最低一位就是「是不是星星」。不搅的话，星星数一样的盘面最低一位全一
 * 样，两色平手永远挑同一色（check-coach 第 ⑩ 节量出来的：换 24 副盘面挑了 24 次同一色）。
 */
export function boardHash<T extends { id: number }>(grid: readonly (readonly T[])[], faceOf: (t: T) => number): number {
  let h = 0x811c9dc5;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const t = row[c];
      const v = t ? t.id * 4 + faceOf(t) : -1;
      h ^= v & 0xffff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xffff;
      h = Math.imul(h, 0x01000193);
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 从几样里按哈希挑一样（先排好序，同一副盘面挑同一样）。 */
function pickByHash<X>(items: readonly X[], hash: number, key: (x: X) => string): X {
  const sorted = [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return sorted[hash % sorted.length];
}

/** 把一步滑法就地走上去，回一个撤回的函数。动过哪几格不在这儿算——每一种滑法动的格子是定的，搜索开头算一次（movedSetsOf）。 */
function applyMove<T>(grid: T[][], step: PlanBoard<{ id: number }>['step'], move: LineShuffle): () => void {
  const n = move.cells.length;
  const saved: T[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const [r, c] = step.cells[move.cells[i]];
    saved[i] = grid[r][c];
  }
  for (let i = 0; i < n; i++) {
    const [r, c] = step.cells[move.cells[i]];
    grid[r][c] = saved[move.src[i]];
  }
  return () => {
    for (let i = 0; i < n; i++) {
      const [r, c] = step.cells[move.cells[i]];
      grid[r][c] = saved[i];
    }
  };
}

/** 一次搜索里滑法不变，跟着滑法的那几样只算一次（prepareMoves）。 */
interface MoveInfo {
  /** 每一种滑法动过的格子（"r,c"），和 step.moves 一一对应。原先每走一个盘面就拼一遍字符串、建一个新的 Set，满盘一次
   *  搜索几万个盘面，光这一样就占了一大截。 */
  moved: Set<string>[];
  /** 每一种滑法在哪一条线上（同一条线上的几种滑法同一个号）。 */
  lineOf: number[];
  /** 每一种滑法动过的格子落在 b.lines 的哪几条上（下标）——这一步之后要是凑出了一组，它只能在这几条线上。 */
  touching: number[][];
}
function prepareMoves<T extends { id: number }>(b: PlanBoard<T>): MoveInfo {
  const { cells, moves } = b.step;
  const linesAt = new Map<string, number[]>();
  b.lines.forEach((line, li) => {
    for (const [r, c] of line) {
      const key = r + ',' + c;
      const list = linesAt.get(key);
      if (list) list.push(li);
      else linesAt.set(key, [li]);
    }
  });
  const lineIds = new Map<string, number>();
  const info: MoveInfo = { moved: [], lineOf: [], touching: [] };
  for (const move of moves) {
    const keys = move.cells.map((i) => cells[i][0] + ',' + cells[i][1]);
    info.moved.push(new Set(keys));
    const id = keys.join(' ');
    if (!lineIds.has(id)) lineIds.set(id, lineIds.size);
    info.lineOf.push(lineIds.get(id)!);
    const touch = new Set<number>();
    for (const key of keys) for (const li of linesAt.get(key) ?? []) touch.add(li);
    info.touching.push([...touch]);
  }
  return info;
}

/**
 * 这一步之后**有没有可能**凑出一组：动过的格子所在的那几条线上，有没有哪一色够 N 枚（连不连着先不管）。没有的话，
 * 真结算那一份认组（scoring，棋盘自己的 findMatches，每问一次都要把整盘扫一遍）就不用问了——它一定回「没有」。这只是
 * 一道先筛，答「有可能」的照旧去问 scoring，所以认组的口径一个字没变；搜索里绝大多数盘面在这一道就筛掉了。
 */
function mayScore<T extends { id: number }>(b: PlanBoard<T>, touching: readonly number[]): boolean {
  const n = b.n;
  for (const li of touching) {
    const line = b.lines[li];
    if (line.length < n) continue;
    const seen = new Map<number, number>();
    for (const [r, c] of line) {
      const t = b.grid[r][c];
      if (!t || !b.isPiece(t)) continue;
      const k = b.colorOf(t);
      const cnt = (seen.get(k) ?? 0) + 1;
      if (cnt >= n) return true;
      seen.set(k, cnt);
    }
  }
  return false;
}

/**
 * 这一副盘面上有没有可能整条消掉一条外边：某一色的星星至少有最短那条边那么多。一色都没有的话，搜索里每一步问的那一
 * 句「会不会消边」（clearing）可以整个省掉——B 那一条（星星还很少）上它从来都是「不会」。
 */
function canClearAny<T extends { id: number }>(b: PlanBoard<T>): boolean {
  let shortest = Infinity;
  for (const e of b.edges) if (e.length && e.length < shortest) shortest = e.length;
  if (!Number.isFinite(shortest)) return false;
  const stars = new Map<number, number>();
  for (const row of b.grid) {
    for (const t of row) {
      if (!t || !b.isStar(t)) continue;
      const k = b.colorOf(t);
      const n = (stars.get(k) ?? 0) + 1;
      if (n >= shortest) return true;
      stars.set(k, n);
    }
  }
  return false;
}

/** 一条线上某一色有几枚能进组的棋子。 */
function countOn<T extends { id: number }>(b: PlanBoard<T>, line: readonly Cell[], k: number): number {
  let n = 0;
  for (const [r, c] of line) {
    const t = b.grid[r][c];
    if (t && b.isPiece(t) && b.colorOf(t) === k) n++;
  }
  return n;
}

/** 一条边上某一色有几颗星星。 */
function starsOn<T extends { id: number }>(b: PlanBoard<T>, edge: readonly Cell[], k: number): number {
  let n = 0;
  for (const [r, c] of edge) {
    const t = b.grid[r][c];
    if (t && b.isStar(t) && b.colorOf(t) === k) n++;
  }
  return n;
}

/** group 的估值（见文件头）：至少还要几步，这一色才可能在某一条线上凑够 N 枚。 */
export function groupH<T extends { id: number }>(b: PlanBoard<T>, k: number): number {
  let best = Infinity;
  for (const line of b.lines) {
    if (line.length < b.n) continue;
    const need = b.n - countOn(b, line, k);
    if (need <= 0) return 0;
    if (need < best) best = need;
  }
  return best;
}

/** edge 的估值：至少还要几步，这一色的星星才可能填满某一条它够得着的外边。 */
export function edgeH<T extends { id: number }>(b: PlanBoard<T>, k: number, stars: number): number {
  let best = Infinity;
  for (const edge of b.edges) {
    if (!edge.length || edge.length > stars) continue;
    const need = edge.length - starsOn(b, edge, k);
    if (need <= 0) return 0;
    if (need < best) best = need;
  }
  return best;
}

/** 一组（试走过的盘面上的格子）里挑那 N 枚：一段连着的 N 格，碰到滑过的线、至少一枚色块。 */
function pickWindow<T extends { id: number }>(
  b: PlanBoard<T>,
  cells: readonly Cell[],
  moved: Set<string>,
): Cell[] {
  const n = b.n;
  if (cells.length <= n) return [...cells];
  for (let i = 0; i + n <= cells.length; i++) {
    const win = cells.slice(i, i + n);
    const touches = win.some(([r, c]) => moved.has(r + ',' + c));
    const block = win.some(([r, c]) => b.isBlock(b.grid[r][c]));
    if (touches && block) return win;
  }
  for (let i = 0; i + n <= cells.length; i++) {
    const win = cells.slice(i, i + n);
    if (win.some(([r, c]) => moved.has(r + ',' + c))) return win;
  }
  return cells.slice(0, n);
}

// ---------------------------------------------------------------------------
// 搜索：显式栈的 IDA*（好拆段：每走 CHECK_EVERY 个盘面 yield 一次）
// ---------------------------------------------------------------------------

/** 一副盘面（走过 g 步之后）是什么情形。 */
type Verdict = 'goal' | 'dead' | 'open';

interface DfsOpts {
  bound: number;
  /** 走到一副盘面上（已经走过 g 步、这一步是第 mi 种滑法）：是不是目标、是不是死路（中间得分 / 消边）、还是可以接着走。 */
  verdict: (moved: Set<string>, g: number, mi: number) => Verdict;
  /** 估值（此刻的盘面）。 */
  h: () => number;
  /** 碰到目标时：回 true 就停（只要最少步数），回 false 就接着找（要把这一层所有的解都收齐）。 */
  onGoal: (moved: Set<string>, g: number) => boolean;
  /** 跟着滑法的那几样（prepareMoves）。 */
  moves: MoveInfo;
  stats: PlanStats;
  cap: number;
}

/**
 * 在 bound 以内深搜一遍。yield 出去让调用方看钟；回 { found, next, capped }：
 *   found  这一遍碰到过目标
 *   next   被估值剪掉的那几支里最小的 f（下一遍的 bound）
 *   capped 盘面数超了上限，半路停的
 */
function* dfs<T extends { id: number }>(b: PlanBoard<T>, o: DfsOpts): Generator<void, { found: boolean; next: number; capped: boolean }> {
  const moves = b.step.moves;
  /** 每一层：下一个要试的滑法、这一层此刻走上去的那一步（撤回用）。 */
  const frames: { mi: number; undo: (() => void) | null }[] = [{ mi: 0, undo: null }];
  let next = Infinity;
  let found = false;
  try {
    while (frames.length) {
      const top = frames[frames.length - 1];
      if (top.undo) {
        top.undo();
        top.undo = null;
      }
      if (top.mi >= moves.length) {
        frames.pop();
        continue;
      }
      const mi = top.mi++;
      // 同一条线连着滑两次 = 一次滑到位（或者滑回原样）：那条路一定不是最少的，不走。
      const parent = frames.length > 1 ? frames[frames.length - 2].mi - 1 : -1;
      if (parent >= 0 && o.moves.lineOf[parent] === o.moves.lineOf[mi]) continue;
      top.undo = applyMove(b.grid, b.step, moves[mi]);
      const moved = o.moves.moved[mi];
      if (++o.stats.nodes > o.cap) return { found, next, capped: true };
      if (o.stats.nodes % CHECK_EVERY === 0) yield;
      const g = frames.length;
      const v = o.verdict(moved, g, mi);
      if (v === 'goal') {
        found = true;
        if (o.onGoal(moved, g)) return { found, next, capped: false };
        continue;
      }
      if (v === 'dead') continue;
      const hh = o.h();
      if (g < o.bound && g + hh <= o.bound) {
        frames.push({ mi: 0, undo: null });
        continue;
      }
      // 这一支这一遍不往下走了：给下一遍留界。到了界的那一层，它的下一步至少是 g + 1，而估值一步最多减 1，所以
      // 下一步那几副盘面的 f 至少是 g + max(1, hh)；没到界、是被估值剪掉的，就是它自己的 f。只记前一种的话，估值
      // 处处是 0 的时候 next 一直是 Infinity，下一遍就开不出来，深一点的解全被当成「没有」。
      const f = g >= o.bound ? g + Math.max(1, hh) : g + hh;
      if (f < next) next = f;
    }
    return { found, next, capped: false };
  } finally {
    // 半路停下（上限、调用方作废）也要把盘面原样还回去：从里往外一层层撤。
    for (let i = frames.length - 1; i >= 0; i--) frames[i].undo?.();
  }
}

/**
 * 几种颜色各自的最少步数（IDA*），**只算到最少的那一档为止**：界从 1 往上加，每一档把还没算出来、下界够得着的颜色各
 * 深搜一遍；哪一档有颜色成了，这一档走完就停——别的颜色要是还没成，它们的最少步数一定比这一档多，挑色用不着知道多多少。
 *
 * 原先是一色一色各自算到底：一步就有颜色能成的盘面上，另外几色照样各自往下挖到第五、第六步，十几万个盘面的上限常常
 * 就耗在它们身上——灯迟迟不亮，最后还退回「估计」。
 *
 * 回 depth：每一色的最少步数（没进 Map 的 = 比最少那一档多，或者够不着）；capped = 半路超了上限。
 */
function* minDepths<T extends { id: number }>(
  b: PlanBoard<T>,
  colors: readonly number[],
  hOf: (k: number) => () => number,
  verdictOf: (k: number) => (moved: Set<string>, g: number, mi: number) => Verdict,
  moves: MoveInfo,
  stats: PlanStats,
  cap: number,
): Generator<void, { depth: Map<number, number>; capped: boolean }> {
  /** 每一色此刻的下界（估值，或者上一遍被剪掉的那几支里最小的 f）。没有 = 这一色够不着。 */
  const lower = new Map<number, number>();
  for (const k of colors) {
    const h0 = hOf(k)();
    // 一步都不走就成的情形不存在（连锁已经走完了），所以至少一步。
    if (Number.isFinite(h0)) lower.set(k, Math.max(1, h0));
  }
  const depth = new Map<number, number>();
  let best = Infinity;
  for (let bound = 1; bound <= HINT_MAX_DEPTH && bound <= best; bound++) {
    for (const k of colors) {
      const lb = lower.get(k);
      if (lb === undefined || lb > bound || depth.has(k)) continue;
      let at = 0;
      const r = yield* dfs(b, {
        bound,
        verdict: verdictOf(k),
        h: hOf(k),
        moves,
        stats,
        cap,
        onGoal: (_m, g) => {
          at = g;
          return true;
        },
      });
      if (r.capped) return { depth, capped: true };
      if (r.found) {
        depth.set(k, at);
        if (at < best) best = at;
      } else if (Number.isFinite(r.next)) lower.set(k, r.next);
      else lower.delete(k);
    }
  }
  return { depth, capped: false };
}

// ---------------------------------------------------------------------------
// B / C：拼出当前 N 的一组
// ---------------------------------------------------------------------------

/**
 * B / C 的一次搜索（D-2）。是一个 generator：每走 CHECK_EVERY 个盘面 yield 一次，调用方看钟、该让就让。
 */
export function* planGroup<T extends { id: number }>(
  live: PlanBoard<T>,
  prev: PlanPrev,
  stats: PlanStats = { nodes: 0 },
  cap = HINT_NODE_CAP,
): Generator<void, PlanResult> {
  // **在副本上试走**：搜索是一段段跑的，两段之间盘面停在「试走了一半」的样子——要是走的是棋盘自己那一份，这几
  // 毫秒里一次重画、一次拖动读到的就是一副假盘面。棋子本身是共用的（试走只换位置，不改它们）。
  const b: PlanBoard<T> = { ...live, grid: live.grid.map((row) => row.slice()) };
  // 哪几色有可能：盘上至少一枚这一色的色块（一组至少一枚色块），而且这一色一共够 N 枚。
  const blocks = new Map<number, number>();
  const pieces = new Map<number, number>();
  for (const row of b.grid) {
    for (const t of row) {
      if (!t || !b.isPiece(t)) continue;
      const k = b.colorOf(t);
      pieces.set(k, (pieces.get(k) ?? 0) + 1);
      if (b.isBlock(t)) blocks.set(k, (blocks.get(k) ?? 0) + 1);
    }
  }
  const colors = [...blocks.keys()].filter((k) => (pieces.get(k) ?? 0) >= b.n).sort((x, y) => x - y);
  if (!colors.length) return { color: null, ids: [], depth: 0, estimate: false };

  const moves = prepareMoves(b);
  const clearable = canClearAny(b);
  /** 中间步：会得分（不管哪一色）或会消边 → 死路；最后一步：这一色成组 → 目标。 */
  const verdictFor = (k: number) => (m: Set<string>, _g: number, mi: number): Verdict => {
    if (clearable && b.clearing(b.grid).length) return 'dead';
    if (!mayScore(b, moves.touching[mi])) return 'open';
    const groups = b.scoring(b.grid, m);
    if (!groups.length) return 'open';
    for (const cells of groups) {
      const [r, c] = cells[0];
      if (b.colorOf(b.grid[r][c]) === k) return 'goal';
    }
    return 'dead';
  };

  const searched = yield* minDepths(b, colors, (k) => () => groupH(b, k), verdictFor, moves, stats, cap);
  const depthOf = searched.depth;
  const capped = searched.capped;

  const hash = boardHash(b.grid, (t) => (b.isStar(t) ? 1 : 0));
  if (capped) {
    // 退回按估值排（D-4）：每一色按此刻的 h 排，最小的那一色；亮它在场的……group 没有「一组」可亮，就亮这一色
    // 离成组最近的那条线上的那几枚——估计出来的，标 estimate。
    let bestH = Infinity;
    for (const k of colors) bestH = Math.min(bestH, groupH(b, k));
    const tied = colors.filter((k) => groupH(b, k) === bestH);
    const k = tied.includes(prev.color as number) ? (prev.color as number) : pickByHash(tied, hash, String);
    return { color: k, ids: nearestLineIds(b, k), depth: 0, estimate: true };
  }
  if (!depthOf.size) return { color: null, ids: [], depth: 0, estimate: false };

  const best = Math.min(...depthOf.values());
  const tied = [...depthOf.keys()].filter((k) => depthOf.get(k) === best);

  // 把最少步数那几色在这一层能成的组收齐（每一色一份：id 集合 → 有没有星星）。
  const groupsOf = new Map<number, { ids: number[]; star: boolean }[]>();
  for (const k of tied) {
    const found: { ids: number[]; star: boolean }[] = [];
    const seen = new Set<string>();
    const r = yield* dfs(b, {
      bound: best,
      // 比 best 浅的那几层不会有这一色的解（best 就是它的最少步数），所以照常判就行。
      verdict: verdictFor(k),
      h: () => groupH(b, k),
      moves,
      stats,
      cap,
      onGoal: (m) => {
        for (const cells of b.scoring(b.grid, m)) {
          const [r0, c0] = cells[0];
          if (b.colorOf(b.grid[r0][c0]) !== k) continue;
          const win = pickWindow(b, cells, m);
          const ids = win.map(([r, c]) => b.grid[r][c].id).sort((x, y) => x - y);
          const key = ids.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ ids, star: win.some(([r, c]) => b.isStar(b.grid[r][c])) });
        }
        return found.length >= 64;
      },
    });
    if (r.capped) break;
    if (found.length) groupsOf.set(k, found);
  }
  const ready = tied.filter((k) => groupsOf.has(k));
  if (!ready.length) return { color: null, ids: [], depth: 0, estimate: false };

  // 挑色：留正在亮的那一色 → 含星星的 → 盘面哈希。
  let color: number;
  if (prev.color !== null && ready.includes(prev.color)) color = prev.color;
  else {
    const starry = ready.filter((k) => groupsOf.get(k)!.some((g) => g.star));
    color = pickByHash(starry.length ? starry : ready, hash, String);
  }
  // 挑那一组：沿用上一次那一组 → 含星星的 → 盘面哈希。
  const options = groupsOf.get(color)!;
  const prevKey = [...prev.ids].sort((x, y) => x - y).join(',');
  const same = prev.color === color ? options.find((g) => g.ids.join(',') === prevKey) : undefined;
  const starry = options.filter((g) => g.star);
  const chosen = same ?? pickByHash(starry.length ? starry : options, hash, (g) => g.ids.join(','));
  return { color, ids: chosen.ids, depth: best, estimate: false };
}

/** 退回估值时亮哪几枚：这一色离成组最近的那条线上这一色的那几枚（最多 N 枚）。 */
function nearestLineIds<T extends { id: number }>(b: PlanBoard<T>, k: number): number[] {
  let bestLine: readonly Cell[] | null = null;
  let bestCount = -1;
  for (const line of b.lines) {
    if (line.length < b.n) continue;
    const n = countOn(b, line, k);
    if (n > bestCount) {
      bestCount = n;
      bestLine = line;
    }
  }
  if (!bestLine) return [];
  const ids: number[] = [];
  for (const [r, c] of bestLine) {
    const t = b.grid[r][c];
    if (t && b.isPiece(t) && b.colorOf(t) === k && ids.length < b.n) ids.push(t.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// D：同色星星填满一条能消的外边
// ---------------------------------------------------------------------------

export function* planEdge<T extends { id: number }>(
  live: PlanBoard<T>,
  prev: PlanPrev,
  stats: PlanStats = { nodes: 0 },
  cap = HINT_NODE_CAP,
): Generator<void, PlanResult> {
  // 在副本上试走（理由见 planGroup）。
  const b: PlanBoard<T> = { ...live, grid: live.grid.map((row) => row.slice()) };
  const stars = new Map<number, number[]>();
  for (const row of b.grid) {
    for (const t of row) {
      if (!t || !b.isStar(t)) continue;
      const k = b.colorOf(t);
      const list = stars.get(k);
      if (list) list.push(t.id);
      else stars.set(k, [t.id]);
    }
  }
  if (!stars.size || !b.edges.length) return { color: null, ids: [], depth: 0, estimate: false };
  const hash = boardHash(b.grid, (t) => (b.isStar(t) ? 1 : 0));
  const shortest = Math.min(...b.edges.filter((e) => e.length).map((e) => e.length));
  const all = [...stars.keys()].sort((x, y) => x - y);
  const able = all.filter((k) => stars.get(k)!.length >= shortest);

  /** 一色都填不满（星星不够）：亮「还差的枚数」最少的那一色的所有星星（玩家已定）。 */
  const fallback = (estimate: boolean, pool: readonly number[]): PlanResult => {
    const needOf = (k: number) => {
      if (estimate) return edgeH(b, k, stars.get(k)!.length);
      let need = Infinity;
      for (const e of b.edges) if (e.length) need = Math.min(need, Math.max(0, e.length - stars.get(k)!.length));
      return need;
    };
    let low = Infinity;
    for (const k of pool) low = Math.min(low, needOf(k));
    const tied = pool.filter((k) => needOf(k) === low);
    const k = prev.color !== null && tied.includes(prev.color) ? prev.color : pickByHash(tied, hash, String);
    return { color: k, ids: [...stars.get(k)!], depth: 0, estimate };
  };
  if (!able.length) return fallback(false, all);

  const moves = prepareMoves(b);
  const verdictFor = (k: number) => (m: Set<string>, _g: number, mi: number): Verdict => {
    const clears = b.clearing(b.grid);
    if (clears.length) {
      for (const edge of clears) {
        const [r, c] = edge[0];
        if (b.colorOf(b.grid[r][c]) === k) return 'goal';
      }
      return 'dead';
    }
    return mayScore(b, moves.touching[mi]) && b.scoring(b.grid, m).length ? 'dead' : 'open';
  };
  const searched = yield* minDepths(b, able, (k) => () => edgeH(b, k, stars.get(k)!.length), verdictFor, moves, stats, cap);
  if (searched.capped) return fallback(true, able);
  const depthOf = searched.depth;
  if (!depthOf.size) return fallback(false, all);
  const best = Math.min(...depthOf.values());
  const tied = [...depthOf.keys()].filter((k) => depthOf.get(k) === best);
  const k = prev.color !== null && tied.includes(prev.color) ? prev.color : pickByHash(tied, hash, String);
  return { color: k, ids: [...stars.get(k)!], depth: best, estimate: false };
}

// ---------------------------------------------------------------------------
// 分段跑：每段 ≤ SLICE_MS，用 MessageChannel 一段段排
// ---------------------------------------------------------------------------

/** 让出控制权、下一拍再接着跑。MessageChannel 比 setTimeout(0) 快（没有 4ms 的下限）；没有就退回去。 */
function makeYielder(): (fn: () => void) => void {
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    const queue: (() => void)[] = [];
    ch.port1.onmessage = () => queue.shift()?.();
    return (fn) => {
      queue.push(fn);
      ch.port2.postMessage(0);
    };
  }
  return (fn) => void setTimeout(fn, 0);
}

export interface SliceRunner {
  /** 开跑一个 generator；之前那一个（如果还在跑）作废。跑完了调 onDone。 */
  run<R>(gen: Generator<void, R>, onDone: (r: R) => void): void;
  /** 作废正在跑的那一个。 */
  cancel(): void;
}

/**
 * @param now 钟（门里换成假的）
 * @param later 让出控制权（门里换成同步的队列）
 * @param mark 每一段跑完量一下（performance.mark / measure，D-5 的 check-coach-budget 只量这一种任务）
 */
export function createSliceRunner(
  now: () => number = defaultNow,
  later: (fn: () => void) => void = makeYielder(),
  mark?: (t0: number, t1: number) => void,
): SliceRunner {
  let version = 0;
  return {
    run(gen, onDone) {
      const mine = ++version;
      const slice = () => {
        if (mine !== version) {
          gen.return(undefined as never);
          return;
        }
        const t0 = now();
        for (;;) {
          const step = gen.next();
          if (step.done) {
            mark?.(t0, now());
            onDone(step.value);
            return;
          }
          if (now() - t0 >= SLICE_MS) break;
        }
        mark?.(t0, now());
        later(slice);
      };
      slice();
    },
    cancel() {
      version++;
    },
  };
}

// ---------------------------------------------------------------------------
// 那盏灯：一份状态，页面从它派生
// ---------------------------------------------------------------------------

/** 灯此刻的全部状态（D-4：只存一份）。 */
export interface CoachGlowState {
  hint: CoachHint | null;
  color: number | null;
  ids: readonly number[];
  depth: number;
  estimate: boolean;
  /** 每一次重算 +1；没算完的那一份认不出自己的版本就作废。 */
  version: number;
}

export interface CoachGlow {
  /**
   * 结算完（或者教学换了一条、新开一局）：按这一条重算。null = 熄灯。
   * groupOnce 只在这一条第一次来的时候算；之后每次只问「那几枚还在不在」（retain）。
   */
  request(hint: CoachHint | null): void;
  /** 一步开始结算：作废没算完的那一份、熄灯（记着刚才那一色，「不跳色」要它）。 */
  cancel(): void;
  /** 这一枚此刻亮不亮。 */
  lit(id: number): boolean;
  state(): CoachGlowState;
  /** 新开一局：全部忘掉。 */
  reset(): void;
  /**
   * 开局倒数那几秒：在一副临时盘面上空跑一遍，不亮、不动状态（D-4「预热」，治冷启动）。倒数时这一局的牌还没发，
   * 所以用的是棋盘交上来的 scratch（同一套发牌规矩另发的一副）；没有就用此刻的盘面。
   */
  prewarm(): void;
}

export interface CoachGlowBoard<T extends { id: number }> {
  /** 此刻的盘面视图（每次重算现取：线、外边、N 都可能变了）。 */
  view(): PlanBoard<T>;
  /** C 那一组里的一枚还在不在、还是不是当时那一面（被翻掉、离场就熄）。 */
  still(id: number, face: number): boolean;
  /** 一枚此刻是哪一面（0 色块、1 星星）——C 记下来，之后比。 */
  faceOf(id: number): number;
  /** 状态变了：重挂灯。 */
  paint(): void;
  /** 一副临时盘面的视图，只给预热用（开局倒数时这一局的牌还没发）。 */
  scratch?(): PlanBoard<T>;
}

/**
 * 每一段搜索在浏览器的性能时间线上标一笔（performance.measure，名字 `coach-search`）：10-11 方案 D-5 第 2 条那道门
 * （check-coach-budget）只量这一种任务——棋盘重画、动画不算。标多了时间线会一直涨，所以隔一阵清一次（门是用
 * PerformanceObserver 当场收的，清不清不影响它）。小红书那台 Chrome 61 不认 measure 的这种写法：包在 try 里，不标就是了。
 */
let slicesMarked = 0;
function markSlice(t0: number, t1: number): void {
  try {
    performance.measure('coach-search', { start: t0, end: t1 });
    if (++slicesMarked % 500 === 0) performance.clearMeasures('coach-search');
  } catch {
    // 没有 performance（node 里跑门）、或者老内核：不标。
  }
}

export function createCoachGlow<T extends { id: number }>(
  board: CoachGlowBoard<T>,
  runner: SliceRunner = createSliceRunner(defaultNow, makeYielder(), markSlice),
): CoachGlow {
  let state: CoachGlowState = { hint: null, color: null, ids: [], depth: 0, estimate: false, version: 0 };
  let shown = new Set<number>();
  /** 正在亮的那一色、那一组——熄灯之后也记着（「不跳色」「沿用上一组」）。 */
  let prev: PlanPrev = { color: null, ids: [] };
  /** C 那一组：哪几枚、各是哪一面（被翻掉、离场就熄）。null = 这一条还没算出来。 */
  let onceFaces: Map<number, number> | null = null;
  /**
   * 预热自己一个 runner：开局（reset）不作废它——小红书那一端头一局不数 4-3-2-1，开局页下一帧就被按掉，跟着
   * 真的那个一起作废的话，最该预热的那台老内核上它一段都跑不完。头一次真的重算（request）、第一步开始结算
   * （cancel）、离开这一局（cancel）才作废它：到那时该热的已经热了，再跟真的那一份抢时间就是添乱。
   */
  const warm = createSliceRunner(defaultNow, makeYielder(), markSlice);

  const set = (next: Partial<CoachGlowState>) => {
    state = { ...state, ...next };
    shown = new Set(state.ids);
    board.paint();
  };

  const start = (hint: CoachHint) => {
    const v = state.version + 1;
    set({ hint, ids: [], color: null, depth: 0, estimate: false, version: v });
    const b = board.view();
    const gen = hint === 'edge' ? planEdge(b, prev) : planGroup(b, prev);
    runner.run(gen, (r) => {
      if (state.version !== v) return;
      if (r.color !== null) prev = { color: r.color, ids: r.ids };
      if (hint === 'groupOnce') onceFaces = new Map(r.ids.map((id) => [id, board.faceOf(id)]));
      set({ color: r.color, ids: r.ids, depth: r.depth, estimate: r.estimate });
    });
  };

  return {
    request(hint) {
      runner.cancel();
      warm.cancel();
      if (!hint) {
        onceFaces = null;
        set({ hint: null, ids: [], color: null, version: state.version + 1 });
        return;
      }
      if (hint === 'groupOnce' && state.hint === 'groupOnce' && onceFaces) {
        // C 已经算过：只看那几枚还在不在、还是不是当时那一面。翻了一枚、离场一枚，整组熄掉，这一条剩下的时间不再亮。
        const faces = onceFaces;
        const ok = faces.size > 0 && [...faces].every(([id, face]) => board.still(id, face));
        if (!ok) onceFaces = new Map();
        set({ hint, ids: ok ? [...faces.keys()] : [], version: state.version + 1 });
        return;
      }
      // C 第一次来（或者上一次没算完就被一步打断了）、B、D：重算。
      onceFaces = null;
      start(hint);
    },
    cancel() {
      runner.cancel();
      warm.cancel();
      // C 那一组只是这一步结算期间不亮；结算完 request('groupOnce') 会按「还在不在」接回来。
      set({ ids: [], version: state.version + 1 });
    },
    lit: (id) => shown.has(id),
    state: () => state,
    reset() {
      runner.cancel();
      prev = { color: null, ids: [] };
      onceFaces = null;
      set({ hint: null, ids: [], color: null, depth: 0, estimate: false, version: state.version + 1 });
    },
    prewarm() {
      // 不动状态、不亮：只让那几个函数在开局倒数这几秒里先跑热（第一次跑往往是最慢的那一次）。
      const b = board.scratch?.() ?? board.view();
      if (!b.grid.length) return;
      warm.run(planGroup(b, { color: null, ids: [] }), () => {});
    },
  };
}

// ---------------------------------------------------------------------------
// 第 4 条（D）讲不讲：此刻某一色的星星够不够填满最短的那条外边（10-08 方案 3-E-3）
// ---------------------------------------------------------------------------

/**
 * 「星星消除」那一条该不该讲、讲哪一色（10-08 方案 3-E-3）。
 *
 * 10-11 方案 D 起，棋盘只拿它判两件事：第二副基础棋盘的第 4 条讲不讲，C 那一条「某色星星数 ≥ 当前最短外边的
 * 枚数」那 5 秒从什么时候起算（coachStarsReachEdge：回不回 null）。亮哪儿归上面的 planEdge。这儿挑色、给点亮组
 * 的那一半原样留着（check-star-clear 还量着它）。
 *
 * - **第一步**：在场星星数 ≥ 此刻最短那条外边的长度——够填满至少一条外边的颜色才算。一色都没有就回 null。
 * - **第二步**：每一色看它够得着的那几条外边（长度 ≤ 它的星星数），哪一条已经有它最多的星星——还差得最少。
 * - **平局**：星星总数少的那一色。再平就按盘面上先碰到的那一色。
 * - **点亮组**：那一色在场的**全部**星星，加上它差得最少的那条外边上的格子。
 */
export interface StarClearHint {
  /** 挑中的那一色（星星露出来的那个颜色）。 */
  color: number;
  /** 点亮组：这一色在场的全部星星，再加上它该去填的那条外边的格子。 */
  stars: Cell[];
}

export interface StarClearBoard<T> {
  grid: readonly (readonly T[])[];
  /** 此刻能消的外边，每条一串格子。 */
  edges: readonly (readonly Cell[])[];
  /** 这一枚算不算一颗星星（空位、离场的、活炸弹都不算）。 */
  isStar(t: T): boolean;
  /** 星星露出来的那个颜色。 */
  colorOf(t: T): number;
}

export function starClearHintFor<T>(board: StarClearBoard<T>): StarClearHint | null {
  const { grid, edges } = board;
  let shortest = 0;
  for (const e of edges) if (e.length && (shortest === 0 || e.length < shortest)) shortest = e.length;
  if (!(shortest > 0)) return null;
  const where = new Map<number, Cell[]>();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const t = row[c];
      if (!board.isStar(t)) continue;
      const k = board.colorOf(t);
      const list = where.get(k);
      if (list) list.push([r, c]);
      else where.set(k, [[r, c]]);
    }
  }
  let best: { color: number; need: number; total: number; edge: readonly Cell[] } | null = null;
  for (const [color, cells] of where) {
    const total = cells.length;
    if (total < shortest) continue;
    const mine = new Set(cells.map(([r, c]) => r + ',' + c));
    let need = Infinity;
    let edge: readonly Cell[] = [];
    for (const e of edges) {
      if (!e.length || e.length > total) continue;
      let here = 0;
      for (const [r, c] of e) if (mine.has(r + ',' + c)) here++;
      if (e.length - here < need) {
        need = e.length - here;
        edge = e;
      }
    }
    if (!best || need < best.need || (need === best.need && total < best.total)) best = { color, need, total, edge };
  }
  if (!best) return null;
  const seen = new Set<string>();
  const stars: Cell[] = [];
  for (const cell of [...(where.get(best.color) ?? []), ...best.edge]) {
    const key = cell[0] + ',' + cell[1];
    if (seen.has(key)) continue;
    seen.add(key);
    stars.push(cell);
  }
  return { color: best.color, stars };
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
