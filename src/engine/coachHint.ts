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
 *   edge   第 4 条：一步就能填满一条可消除外边的那几颗同色星星
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
 * 教学第 4 条的条件：此刻某一种颜色的星星枚数 ≥ `need`（最短外边的长度）。
 *
 * 只数**星星**，按它露出来的那个颜色（`dotColor`）；哪几枚算星星由棋盘说（`isStar`：空位、
 * 活炸弹不算）。`need` 也由棋盘给——方块是此刻较短的那条边，小球是此刻削得动的最短那条
 * 外边，一条都削不动就是 0，那时候一律不算。
 *
 * 写成纯函数、单独放在这儿，是为了让门拿模拟盘面验它（check-coach.mjs），而不必把整副
 * 棋盘连同 DOM 一起搬进 node。
 */
export function starsReach<T extends { dotColor: number }>(
  grid: readonly (readonly T[])[],
  need: number,
  isStar: (t: T) => boolean,
): boolean {
  if (!(need > 0)) return false;
  const count = new Map<number, number>();
  for (const row of grid) {
    for (const t of row) {
      if (!isStar(t)) continue;
      const n = (count.get(t.dotColor) ?? 0) + 1;
      if (n >= need) return true;
      count.set(t.dotColor, n);
    }
  }
  return false;
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
  centerOf(cell: Cell): readonly [number, number];
  boardCenter(): readonly [number, number];
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
      const cands = oneStepGroups(board.grid(), board.moves(), board.groupsFor(kind), HINT_BUDGET_MS, now);
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
