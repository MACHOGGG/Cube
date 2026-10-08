/**
 * 教学的呼吸灯：**再走一步就能完成这一条的，是哪几枚**（第 15 推）。
 *
 * ── 从前那盏灯为什么换掉 ──────────────────────────────────────────────
 *
 * 上一版（E23）的灯打在「这一条句子里那样东西」上：讲得分图案就点亮 HUD 那块《得分图
 * 案》，讲外边就点亮托盘上那条外边带子。它指得出**名词**，指不出**下一步**——玩家看着一块
 * 发光的牌子，还是不知道该滑哪一枚。玩家 2026-10-03 定的新规矩，逐字：
 *
 *   · 同一时间只亮一种颜色；
 *   · 只在「再走一步就能完成这一条」时亮，只亮会参与的那几枚（包括要滑过去的那一枚）；
 *   · 每一步结算之后重算：正在亮的那一组仍然有效就保留；失效了，换成离上一次手指位置最
 *     近的一组；一组都没有就熄灭；
 *   · 实现：复用 residueBoard 生成走法，只看一层，每个盘面调用游戏自己的判定，拿到参与的
 *     格子后映射回当前位置。单次超过 8ms 就跳过这一次。
 *
 * ── 这个文件只做三件事 ────────────────────────────────────────────────
 *
 * ① 一层穷举：每一种滑法走一步（走法来自 `residueBoard.oneStepMoves`，和残局穷举同一
 *    套），把走过一步的盘面交给棋盘自己去认组——**认组的规矩一个字不在这儿写**。这一处
 *    要是另抄一份「什么算一组」，两份迟早走样，灯就会亮在一组凑不成的棋子上。
 * ② 映射回来：组是在「走过一步的盘面」上认出来的，可灯要亮在**此刻**的棋子上。棋子本身
 *    不变，只是换了位置，所以按棋子的 id 找回它此刻在哪一格——要滑过去的那一枚也就自然
 *    在里面。
 * ③ 挑一组：保留 → 离手指最近 → 熄灭。
 *
 * ── 一盏灯亮的是「这一步」，不是「这一组」（10-08 方案 3-E-2）──────────────────────
 *
 * 方案原话：「呼吸灯点亮组扩成『这 1 步会参与结算的所有元素（格子 + 星星）』」。从前一组一
 * 个候选、按条只认一种组：讲第 1 条只亮那一组色块，同一步顺带凑出来的另一组（带星星的、或
 * 者一条要消的外边）黑着——可玩家滑下去，那几枚照样会翻、会消，灯没告诉他。现在一步一个候
 * 选：这一步能完成这一条（「哪些步算数」照旧按条认，见 HINT_OF），它结算时动到的每一组都亮，
 * 色块、星星一起（见 stepRuler）。一步只凑出一组的时候和从前一模一样；一步凑出两组不同颜色
 * 的，「同一时间只亮一种颜色」那一句让给这一条——两组都会在这一步里结算，只亮一组反倒是在
 * 瞒着他。
 *
 * 不碰 DOM、不认几何（「离手指多远」要的格子中心由棋盘给），所以 `check-coach-hint.mjs`
 * 能把它单独打包出来，拿假盘面验，进得了 CI。
 */
import type { Cell } from './types';
import type { LineShuffle } from './residueSearch';

/**
 * 这一步该亮哪一种组（ui/coachBar.ts 的 HINT_OF 按条给）：
 *
 *   front  第 1、3 条：一步就能拼出当前级 1×N 的那几枚**色块**（不亮星星）
 *   mixed  第 2 条：一步就能拼出的、**同时含星星和色块**的那一组
 *   edge   第 4 条：从前是「一步就能填满一条可消除外边的那几颗同色星星」；10-08 方案 3-E-3 起
 *          棋盘给了 starClear 就不走一层穷举，亮 starClearHintFor 挑出来的那一色（见那个函数）
 *
 * 第 5 条不亮，所以没有它那一种。
 */
export type CoachHint = 'front' | 'mixed' | 'edge';

/** 一组：参与的那几枚的 id，和它们**此刻**所在的格子（同一个顺序）。 */
export interface HintGroup {
  ids: readonly number[];
  cells: readonly Cell[];
}

/** 单次最多算这么久；超了这一次就跳过（玩家定的字面值）。 */
export const HINT_BUDGET_MS = 8;

/**
 * 一层穷举。
 *
 * @param grid 此刻的盘面（行 × 列，方块是矩形，小球是三角形的锯齿数组）。试走的时候**就地**
 *   换那一条线、问完立刻换回来（见下面那段），返回时原样不动。
 * @param step 一步之内的全部滑法（`residueBoard.oneStepMoves` 的结果）。
 * @param groupsOn 在**走过一步的盘面**上认组，棋盘自己的判定。`moved` 是这一步动过的那
 *   条线（和真的滑一下时交给 `resolveMove` 的遮罩是同一个口径），回的格子是那副盘面上的。
 * @returns 每一组一份（同一组被几种滑法凑出来只算一份）；算超时回 `null`。
 */
export function oneStepGroups<T extends { id: number }>(
  grid: T[][],
  step: { cells: readonly Cell[]; moves: readonly LineShuffle[] },
  groupsOn: (trial: T[][], moved: Set<string>) => readonly (readonly Cell[])[],
  budgetMs: number = HINT_BUDGET_MS,
  now: () => number = defaultNow,
): HintGroup[] | null {
  const t0 = now();
  // 每一枚此刻在哪一格——映射回来要用。
  const where = new Map<number, Cell>();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) where.set(row[c].id, [r, c]);
  }
  const seen = new Set<string>();
  const out: HintGroup[] = [];
  for (const move of step.moves) {
    // 预算在**每一步之前**问：问在之后的话，超时的那一步已经算完了，8ms 就不是上限。
    if (now() - t0 > budgetMs) return null;
    /*
     * **就地**把这一条线换成走过一步的样子，问完立刻换回来，而不是每种滑法复制一整副盘面：
     * 一层有六十来种滑法，每种复制一遍是几百个小数组，手机上那 8ms 有一大截花在这儿和随
     * 后的垃圾回收上。换回来写在 finally 里——认组那一步哪怕抛错，盘面也原样还回去。
     */
    const n = move.cells.length;
    const saved: T[] = new Array(n);
    const moved = new Set<string>();
    for (let i = 0; i < n; i++) {
      const [r, c] = step.cells[move.cells[i]];
      saved[i] = grid[r][c];
      moved.add(r + ',' + c);
    }
    let found: (readonly number[])[];
    try {
      for (let i = 0; i < n; i++) {
        const [r, c] = step.cells[move.cells[i]];
        grid[r][c] = saved[move.src[i]];
      }
      // 认出来的组要在换回去**之前**记成棋子 id：换回去之后那几格上已经是别的棋子了。
      found = groupsOn(grid, moved).map((cells) => cells.map(([r, c]) => grid[r][c].id));
    } finally {
      for (let i = 0; i < n; i++) {
        const [r, c] = step.cells[move.cells[i]];
        grid[r][c] = saved[i];
      }
    }
    for (const ids of found) {
      const key = ids.slice().sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const here: Cell[] = [];
      for (const id of ids) {
        const at = where.get(id);
        if (at) here.push(at);
      }
      // 映射不回来的（理论上不会：滑动只换位置，不增减棋子）整组丢掉，不亮半组。
      if (here.length === ids.length) out.push({ ids: ids.slice(), cells: here });
    }
  }
  return out;
}

/** 两组是不是同一组（同一批棋子，不管顺序）。 */
function sameIds(a: readonly number[], b: ReadonlySet<number>): boolean {
  if (a.length !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * 挑一组：**正在亮的那一组仍然有效就保留；失效了，换成离上一次手指位置最近的一组；一组
 * 都没有就熄灭**（玩家的原话，三句一一对应下面三段）。
 *
 * 「离手指最近」量的是手指到这一组**最近的那一枚**的距离，不是到这一组的中心：一组是一
 * 条线，中心可能落在离手指很远的空处，而玩家的眼睛跟着的是他手边那几枚。距离一样就取先
 * 算出来的那一组——穷举的次序是固定的，所以同一副盘面永远挑同一组，灯不会无端换地方。
 *
 * @param keep 正在亮的那一组（棋子 id）；没有就给 null。
 * @param finger 上一次手指的位置（板内坐标）；还没碰过盘面就给板子中心。
 */
export function pickGroup(
  cands: readonly HintGroup[],
  keep: ReadonlySet<number> | null,
  finger: readonly [number, number],
  centerOf: (cell: Cell) => readonly [number, number],
): HintGroup | null {
  if (!cands.length) return null;
  if (keep && keep.size) {
    for (const g of cands) if (sameIds(g.ids, keep)) return g;
  }
  let best: HintGroup | null = null;
  let bestD = Infinity;
  for (const g of cands) {
    let d = Infinity;
    for (const cell of g.cells) {
      const [x, y] = centerOf(cell);
      const dd = (x - finger[0]) * (x - finger[0]) + (y - finger[1]) * (y - finger[1]);
      if (dd < d) d = dd;
    }
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
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
 * 一副棋盘上的那盏灯：记着正在亮哪一组、手指上一次在哪儿。
 *
 * 棋盘只管两件事：`update(kind)` 之后把 `lit(id)` 为真的那几枚挂上 `coach-glow`（render
 * 里挂，结算之后不重画就地挂），以及在手指松开时报一次 `touch`。挑哪一组、什么时候熄，全
 * 在这儿。
 */
export interface CoachGlow {
  /**
   * 结算之后（或者教学换了一条）重算。`kind` 为 null = 熄灯，但**记着刚才那一组**——下一
   * 次重算时它要是仍然有效，就接着亮它。
   *
   * 回 false = 这一次超了 8ms，跳过了（灯熄着）。调用方可以过一会儿再试一次：第一次算往往
   * 是最慢的那一次（那几个函数还没被浏览器编译成快的那一版），再算一次多半就进得了 8ms。
   */
  update(kind: CoachHint | null): boolean;
  /** 这一枚此刻亮不亮。 */
  lit(id: number): boolean;
  /** 手指松开的位置（板内坐标）。 */
  touch(x: number, y: number): void;
  /** 一局重开：两样都忘掉。 */
  reset(): void;
}

export interface CoachGlowBoard<T extends { id: number }> {
  /** 此刻的盘面——会被就地试走（见 oneStepGroups），所以要的是棋盘自己那一份，不是副本。 */
  grid(): T[][];
  moves(): { cells: Cell[]; moves: LineShuffle[] };
  /**
   * 给这一种提示准备一把「认组」的尺子。分两步是为了让不随滑动而变的东西只算一次：外边
   * 族那几条外边的**几何**只看哪几格还在盘上，一步滑动不改变这件事，于是每种滑法都重算一
   * 遍外边是白算（小球那副要算二十一条线 × 二十一条线）。
   */
  groupsFor(kind: CoachHint): (trial: T[][], moved: Set<string>) => readonly (readonly Cell[])[];
  /**
   * 第 4 条（edge）那一盏（10-08 方案 3-E-3）：棋盘按此刻的盘面问 starClearHintFor，回它挑好的那
   * 一组。给了它，edge 就不走一层穷举——那一层要「一步就能填满一条外边」才亮，局面上少见，第 4
   * 条讲着、灯多半是黑的。
   */
  starClear?(): StarClearHint | null;
  centerOf(cell: Cell): readonly [number, number];
  boardCenter(): readonly [number, number];
}

/** 三种组都问一遍——「这一步结算时会动到哪些棋子」要的是全部，不只是这一条讲的那一种。 */
const ALL_KINDS: readonly CoachHint[] = ['front', 'mixed', 'edge'];

/**
 * 给 oneStepGroups 的那把尺子：**一步一个候选**（10-08 方案 3-E-2，见文件开头那一段）。
 *
 * 先用这一条自己那把（`kind`）问：这一步能不能完成这一条——不能就什么都不回，这一步不算
 * 数。能的话，把另外两把也问一遍，三把认出来的格子并成一组交回去：这一步结算时会动到的每一
 * 枚，色块、星星一起。同一格被两组认出来只算一次。
 *
 * 另外两把只在「这一步算数」之后才问：一层六十来种滑法里真能完成这一条的只有几种，绝大多
 * 数步只花一把尺子的工夫，8ms 的预算不会因为这一条吃紧。
 */
function stepRuler<T extends { id: number }>(
  board: CoachGlowBoard<T>,
  kind: CoachHint,
): (trial: T[][], moved: Set<string>) => readonly (readonly Cell[])[] {
  const own = board.groupsFor(kind);
  const rest = ALL_KINDS.filter((k) => k !== kind).map((k) => board.groupsFor(k));
  return (trial, moved) => {
    const mine = own(trial, moved);
    if (!mine.length) return [];
    const seen = new Set<string>();
    const all: Cell[] = [];
    const add = (cells: readonly Cell[]) => {
      for (const cell of cells) {
        const key = cell[0] + ',' + cell[1];
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(cell);
      }
    };
    for (const g of mine) add(g);
    for (const ruler of rest) for (const g of ruler(trial, moved)) add(g);
    return [all];
  };
}

export function createCoachGlow<T extends { id: number }>(
  board: CoachGlowBoard<T>,
  now: () => number = defaultNow,
): CoachGlow {
  /** 此刻亮着的那几枚。 */
  let shown = new Set<number>();
  /** 刚才亮过的那一组——熄灯之后也记着，「仍然有效就保留」认的是它。 */
  let keep: Set<number> | null = null;
  let finger: [number, number] | null = null;

  return {
    update(kind) {
      if (!kind) {
        shown = new Set();
        return true;
      }
      if (kind === 'edge' && board.starClear) {
        // 挑哪一色、亮哪几枚由 starClearHintFor 说了算（它自己保证同一副盘面挑同一色），这儿只
        // 把格子换成棋子 id。不走「保留 → 最近」那一套：那一套是给一层穷举里好几组候选挑一组用的。
        const hint = board.starClear();
        const g = board.grid();
        shown = new Set(hint ? hint.stars.map(([r, c]) => g[r][c].id) : []);
        keep = null;
        return true;
      }
      const cands = oneStepGroups(board.grid(), board.moves(), stepRuler(board, kind), HINT_BUDGET_MS, now);
      // 超时：这一次跳过。**熄灯，不留旧的**——旧的那一组是上一副盘面算出来的，留着可能亮
      // 在一组已经凑不成的棋子上，那比不亮还糟。
      if (!cands) {
        shown = new Set();
        return false;
      }
      const g = pickGroup(cands, keep, finger ?? board.boardCenter(), board.centerOf);
      shown = new Set(g ? g.ids : []);
      keep = g ? new Set(g.ids) : null;
      return true;
    },
    lit: (id) => shown.has(id),
    touch(x, y) {
      finger = [x, y];
    },
    reset() {
      shown = new Set();
      keep = null;
      finger = null;
    },
  };
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
