/**
 * 教学的呼吸灯：**这一条最快几步能完成、哪一种颜色最快**（10-09 补充方案 6-2）。
 *
 * ── 现在的规矩（玩家 2026-10-09，替换 3-E-2 和第 15 推那一套）────────────────────────
 *
 *   · **一次只亮一种颜色**；「一种颜色」包括这个颜色的色块和星星。亮这一色里会参与完成的全部那几枚。
 *   · **看 3 步以内**：对此刻这一条教学的目标（拼出当前级图案 / 拼出含星星的图案 / 填满一条可消的外
 *     边），算每一种颜色最少几步能完成（1–3 步）。亮步数最少的那一色；一样少就随机挑一色。3 步内都
 *     完成不了就不亮。
 *   · **稳定**：正在亮的那一色只要仍是「步数最少」之一，就接着亮，不跳色；不再是最少了才换。每一步结
 *     算完重算一次。
 *   · **有上限**：复用 residueBoard 的走法做限深搜索；一次重算最多看 20000 个盘面或 15ms，超了就退回
 *     只看 2 步，再不够就只看 1 步。不能卡住拖动。
 *   · 其余照旧：只动 filter: drop-shadow，不加热区；减弱动态效果时是静止光晕（样式在 style.css）。
 *
 * ── 从前那几版为什么换掉 ──────────────────────────────────────────────────
 *
 * 第 15 推那一版只看一层（「再走一步就能完成」才亮），挑一组靠「正在亮的那一组仍然有效就保留，失效
 * 了换离手指最近的一组」。10-08 方案 3-E-2 又把同一步顺带凑出来的别的组也点亮，于是一步凑出两组不同
 * 颜色的时候两色同时亮。玩家看下来的问题有两个：一步就能完成的局面并不多，灯多半是黑的；亮起来的时
 * 候又可能是两种颜色、跟着手指换来换去。新规矩把「亮哪儿」从「哪一组」改成「哪一种颜色」，看得更远
 * （3 步），挑色有定规（步数最少，平手随机，亮着的不跳）。
 *
 * ── 这个文件只做三件事 ────────────────────────────────────────────────────
 *
 * ① 逐层加深的限深搜索（reachByColor）：先把一步之内每一种滑法走一遍，哪一色完成了这一条，记下那一
 *    色和参与的棋子；一色都没有，再看两步，再看三步。第 d 层只要有任何一色完成，就不再往下——最少步数
 *    已经是 d。走法来自 `residueBoard.oneStepMoves`（和残局穷举同一套），每一步**就地**换那一条线、问
 *    完换回来；完成没完成交给棋盘自己的判定（groupsFor）——「什么算一组」一个字不在这儿写。
 * ② 挑一色（pickColor）：正在亮的那一色还在最少那几色里就留着；不在了就从最少那几色里随机挑一色。
 * ③ 那盏灯本身（createCoachGlow）：记着正在亮哪一色、此刻亮哪几枚。
 *
 * 不碰 DOM、不认几何，所以 check-coach.mjs 能把它单独打包出来，拿手摆的盘面验，进得了 CI；
 * check-coach-aim.mjs 拿真棋盘对一遍、再真拖一枚。
 */
import type { Cell } from './types';
import type { LineShuffle } from './residueSearch';

/**
 * 这一条要完成的是什么（ui/coachBar.ts 的 HINT_OF 按条给）：
 *
 *   front  第 1、3 条：拼出当前级 1×N 的一组**色块**
 *   mixed  第 2 条：拼出一组**同时含星星和色块**的
 *   edge   第 4 条：同色星星填满一条可消的外边
 *
 * 第 5 条不亮，所以没有它那一种。
 */
export type CoachHint = 'front' | 'mixed' | 'edge';

/** 一次重算最多看几个盘面（玩家定的字面值，10-09 补充方案 6-2）。 */
export const HINT_NODE_CAP = 20000;

/** 一次重算最多算这么久（同上）。从前只看一层，那时候的上限是 8ms。 */
export const HINT_BUDGET_MS = 15;

/** 最多看几步（同上）。 */
export const HINT_MAX_DEPTH = 3;

/** 一副盘面上，每一种颜色最快几步能完成这一条。 */
export interface ColorReach {
  /** 最少几步（1–3）；3 步内都完成不了（或那几层算超了退回来也没有）是 0。 */
  depth: number;
  /**
   * 步数最少的那几色，每色一份：这一层第一次有这一色完成时，这一色参与的那几枚（棋子 id）。参与的
   * 包括这一条要的那一种组，也包括同一副盘面上同色的别的组（色块、星星一起）——「这个颜色里会参与达
   * 成的全部格子」。插入的先后就是搜索碰到的先后，同一副盘面永远是同一个次序。
   */
  byColor: Map<number, number[]>;
}

export interface ReachOpts {
  maxDepth?: number;
  nodeCap?: number;
  budgetMs?: number;
  now?: () => number;
}

/**
 * 逐层加深的限深搜索。
 *
 * @param grid 此刻的盘面——试走的时候**就地**换线、问完换回来，返回时原样不动。
 * @param step 一步之内的全部滑法（`residueBoard.oneStepMoves`）。一步滑动只在线上换位置，哪几格在
 *   盘上、哪几条线是线都不变，所以第二步、第三步用的还是这一份。
 * @param goalOn 在**走过这几步的盘面**上认这一条要的那一种组；`moved` 是最后那一步动过的那条线（和
 *   真的滑一下时交给结算的遮罩同一个口径）。
 * @param alsoOn 同一副盘面上别的那几种组——只在 goalOn 认出了东西之后才问，用来把同色的别的组一起点亮。
 * @param colorOf 这一枚是什么颜色（色块看正面、星星看露出来的那一色：engine/types 的 effColor）。
 * @returns 见 ColorReach；**连一步都没算完**（超时）回 null——调用方过一会儿再试。
 *
 * 上限是「这一次重算」的总账，几层合起来算：第 d 层算到一半超了，这一层作废，退回上一层的答案（上一层
 * 一色都没有——不然不会往下算——所以就是不亮）。满盘的时候一步六十来种滑法，三步是二十多万个盘面，
 * 两万封顶之内算不完，所以第 3 步多半只在线少的残局里看得到；这是玩家定的上限，不是漏算。
 */
export function reachByColor<T extends { id: number }>(
  grid: T[][],
  step: { cells: readonly Cell[]; moves: readonly LineShuffle[] },
  goalOn: (trial: T[][], moved: Set<string>) => readonly (readonly Cell[])[],
  alsoOn: (trial: T[][], moved: Set<string>) => readonly (readonly Cell[])[],
  colorOf: (t: T) => number,
  opts: ReachOpts = {},
): ColorReach | null {
  const maxDepth = opts.maxDepth ?? HINT_MAX_DEPTH;
  const nodeCap = opts.nodeCap ?? HINT_NODE_CAP;
  const budgetMs = opts.budgetMs ?? HINT_BUDGET_MS;
  const now = opts.now ?? defaultNow;
  const t0 = now();
  let nodes = 0;

  /** 一副盘面上，这一条要的那几组按颜色归好（同色的别的组一并收进来）。 */
  const collect = (moved: Set<string>, into: Map<number, number[]>) => {
    const goals = goalOn(grid, moved);
    if (!goals.length) return;
    const found = new Map<number, Set<number>>();
    for (const cells of goals) {
      if (!cells.length) continue;
      const [r0, c0] = cells[0];
      const k = colorOf(grid[r0][c0]);
      const ids = found.get(k) ?? new Set<number>();
      for (const [r, c] of cells) ids.add(grid[r][c].id);
      found.set(k, ids);
    }
    if (!found.size) return;
    for (const cells of alsoOn(grid, moved)) {
      if (!cells.length) continue;
      const [r0, c0] = cells[0];
      const ids = found.get(colorOf(grid[r0][c0]));
      if (ids) for (const [r, c] of cells) ids.add(grid[r][c].id);
    }
    // 同一层里先碰到的那一次算数：同一副盘面永远亮同一组。
    for (const [k, ids] of found) if (!into.has(k)) into.set(k, [...ids]);
  };

  /** 走第 level 步；到了第 depth 步就认组。回 false = 超了上限，这一层作废。 */
  const walk = (level: number, depth: number, into: Map<number, number[]>): boolean => {
    for (const move of step.moves) {
      // 闸在**每一步之前**问：问在之后的话，超的那一步已经算完了，上限就不是上限。
      if (++nodes > nodeCap || now() - t0 > budgetMs) return false;
      const n = move.cells.length;
      const saved: T[] = new Array(n);
      const moved = new Set<string>();
      for (let i = 0; i < n; i++) {
        const [r, c] = step.cells[move.cells[i]];
        saved[i] = grid[r][c];
        moved.add(r + ',' + c);
      }
      try {
        for (let i = 0; i < n; i++) {
          const [r, c] = step.cells[move.cells[i]];
          grid[r][c] = saved[move.src[i]];
        }
        if (level === depth) collect(moved, into);
        else if (!walk(level + 1, depth, into)) return false;
      } finally {
        // 换回来写在 finally 里：认组那一步哪怕抛错，盘面也原样还回去。
        for (let i = 0; i < n; i++) {
          const [r, c] = step.cells[move.cells[i]];
          grid[r][c] = saved[i];
        }
      }
    }
    return true;
  };

  for (let depth = 1; depth <= maxDepth; depth++) {
    const into = new Map<number, number[]>();
    if (!walk(1, depth, into)) return depth === 1 ? null : { depth: 0, byColor: new Map() };
    if (into.size) return { depth, byColor: into };
  }
  return { depth: 0, byColor: new Map() };
}

/**
 * 挑一色：**正在亮的那一色只要还在步数最少的那几色里，就接着亮；不在了，从最少那几色里随机挑一色**
 * （玩家的原话，两句一一对应）。一色都没有就熄（回 null）。
 *
 * @param keep 正在亮的那一色；没有就给 null。
 * @param rng 0–1 的随机数（门里换成确定的）。
 */
export function pickColor(reach: ColorReach, keep: number | null, rng: () => number = Math.random): number | null {
  if (!reach.byColor.size) return null;
  if (keep !== null && reach.byColor.has(keep)) return keep;
  const colors = [...reach.byColor.keys()];
  return colors[Math.min(colors.length - 1, Math.floor(rng() * colors.length))];
}


/**
 * 一组里有几枚星星、几枚色块——第 1、3 条要「全是色块」，第 2 条要「两样都有」。
 *
 * 全是星星的一组本来就不得分（§1.1：图案里至少要有一枚色块），棋盘的 findMatches 不会把它
 * 交出来；这儿还是写成 null，免得哪天规则一改，灯亮在一组不得分的星星上。
 */
export function matchKind(faces: readonly ('dot' | 'flavor')[]): 'front' | 'mixed' | null {
  let dot = 0;
  let front = 0;
  for (const f of faces) {
    if (f === 'dot') dot++;
    else front++;
  }
  if (front && !dot) return 'front';
  if (front && dot) return 'mixed';
  return null;
}

/**
 * 「星星消除」那一条提示（教学第 4 条）：该不该讲、讲哪一色、亮哪几枚（10-08 方案 3-E-3）。
 *
 * 方案原话：「写纯函数 starClearHintFor(board): { color, stars[] } | null——第一步筛『该色在场星星
 * 数 ≥ 当前最外边长度』的颜色；第二步选『已在最外边上的星星最多（还需挪动最少）』的色；平局选星
 * 星总数少的；返回该色全部相关星星+参与格子作为点亮组。只改提示触发，不改得分规则。」
 *
 * 从前这一条只有第一步（`starsReach`：某一种颜色的星星枚数 ≥ 最短外边的长度），灯走的是一层穷
 * 举（'edge'：一步就能填满一条外边的那几颗）——可一步就能填满一条外边的局面少见，于是第 4 条讲
 * 出来了、灯多半是黑的，玩家知道「同色星星在外边会消」，却不知道该攒哪一色、往哪儿攒。
 *
 * - **第一步**：在场星星数 ≥ 此刻最短那条外边的长度——够填满至少一条外边的颜色才算。一色都没有
 *   就回 null（这一条不讲）。和从前 `starsReach` 同一个口径，所以「什么时候讲」没变。
 * - **第二步**：每一色看它够得着的那几条外边（长度 ≤ 它的星星数），哪一条已经有它最多的星星——
 *   也就是还差得最少；挑差得最少的那一色。
 * - **平局**：星星总数少的那一色（攒得快的先讲）。再平就按盘面上先碰到的那一色，同一副盘面永远挑
 *   同一色，灯不会无端换颜色。
 * - **点亮组**：那一色在场的**全部**星星，加上它差得最少的那条外边上的格子（「往这儿攒」）。同一
 *   格只算一次，星星在前。
 *
 * 「哪几条算外边」由棋盘给（`edges`）：小球是此刻削得动的最外面那几条（outerEdges），方块是每一
 * 整行、每一整列（方块的星星凑满任意一整行一整列都消，见 i18n 的 TUTORIAL_RULE4）。得分规则一
 * 个字没动——这儿只回答「提示讲不讲、亮哪儿」。
 *
 * 写成纯函数、单独放在这儿，门（check-star-clear.mjs、check-coach.mjs）拿手摆的盘面就能验它，
 * 不必把整副棋盘连同 DOM 一起搬进 node。
 *
 * **10-09 补充方案 6-2 起，棋盘只拿它判「第 4 条讲不讲」**（coachStarsReachEdge：回不回 null）。亮哪
 * 儿归上面的 reachByColor——'edge' 那一种目标，3 步以内哪一色最快填满一条外边，和第 1–3 条同一套规
 * 矩。这儿挑色、给点亮组的那一半原样留着（check-star-clear 还量着它），只是不再拿来点灯。
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
  // 每一色在场的星星都在哪儿（按盘面扫描的先后，平局时「先碰到的那一色」靠它）。
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
    // 第一步：够不够填满此刻最短的那条外边。
    if (total < shortest) continue;
    const mine = new Set(cells.map(([r, c]) => r + ',' + c));
    // 第二步：它够得着的那几条外边里，哪一条还差得最少（已经在那条边上的越多，要挪的越少）。
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
    // 差得最少的那一色；一样少，挑星星总数少的那一色。
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


/**
 * 一副棋盘上的那盏灯：记着正在亮哪一色、此刻亮哪几枚。
 *
 * 棋盘只管一件事：`update(kind)` 之后把 `lit(id)` 为真的那几枚挂上 `coach-glow`（render 里挂，结算
 * 之后不重画就地挂）。挑哪一色、什么时候熄，全在这儿。
 */
export interface CoachGlow {
  /**
   * 结算之后（或者教学换了一条）重算。`kind` 为 null = 熄灯，但**记着刚才那一色**——下一次重算时它要
   * 是仍在步数最少的那几色里，就接着亮它。
   *
   * 回 false = 连一步都没算完（超了 15ms），这一次跳过了（灯熄着）。调用方可以过一会儿再试一次：第
   * 一次算往往是最慢的那一次（那几个函数还没被浏览器编译成快的那一版）。
   */
  update(kind: CoachHint | null): boolean;
  /** 这一枚此刻亮不亮。 */
  lit(id: number): boolean;
  /** 一局重开：忘掉正在亮的那一色。 */
  reset(): void;
}

export interface CoachGlowBoard<T extends { id: number }> {
  /** 此刻的盘面——会被就地试走（见 reachByColor），所以要的是棋盘自己那一份，不是副本。 */
  grid(): T[][];
  moves(): { cells: Cell[]; moves: LineShuffle[] };
  /**
   * 给这一种目标准备一把「认组」的尺子。分两步是为了让不随滑动而变的东西只算一次：外边族那几条外边
   * 的**几何**只看哪几格还在盘上，一步滑动不改变这件事，于是每种滑法都重算一遍外边是白算。
   */
  groupsFor(kind: CoachHint): (trial: T[][], moved: Set<string>) => readonly (readonly Cell[])[];
  /** 这一枚算什么颜色：色块看正面，星星看露出来的那一色（engine/types 的 effColor）。 */
  colorOf(t: T): number;
}

/** 三种目标——认完这一条要的那一种，同色的另外两种一并点亮。 */
const ALL_KINDS: readonly CoachHint[] = ['front', 'mixed', 'edge'];

export function createCoachGlow<T extends { id: number }>(
  board: CoachGlowBoard<T>,
  now: () => number = defaultNow,
  rng: () => number = Math.random,
): CoachGlow {
  /** 此刻亮着的那几枚。 */
  let shown = new Set<number>();
  /** 正在亮的那一色——熄灯之后也记着，「不跳色」认的是它。 */
  let keep: number | null = null;

  return {
    update(kind) {
      if (!kind) {
        shown = new Set();
        return true;
      }
      const goal = board.groupsFor(kind);
      const others = ALL_KINDS.filter((k) => k !== kind).map((k) => board.groupsFor(k));
      const alsoOn = (trial: T[][], moved: Set<string>) => others.flatMap((ruler) => ruler(trial, moved));
      const reach = reachByColor(board.grid(), board.moves(), goal, alsoOn, (t) => board.colorOf(t), { now });
      // 连一步都没算完：这一次跳过。**熄灯，不留旧的**——旧的那几枚是上一副盘面算出来的，留着可能亮
      // 在一组已经凑不成的棋子上，那比不亮还糟。记着的那一色不丢：下一次算完了它还在最少那几色里，照
      // 样接着亮。
      if (!reach) {
        shown = new Set();
        return false;
      }
      const color = pickColor(reach, keep, rng);
      shown = new Set(color === null ? [] : reach.byColor.get(color));
      keep = color;
      return true;
    },
    lit: (id) => shown.has(id),
    reset() {
      shown = new Set();
      keep = null;
    },
  };
}


function defaultNow(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
