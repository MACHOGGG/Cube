/**
 * 残局穷举兜底——治「该结束没结束」。
 *
 * ── 病根 ────────────────────────────────────────────────────────────────
 *
 * `engine/stalemate.ts` 的判活是一套**计数可达闭包**：某色可见枚数够不够当前图案的
 * 枚数、够不够填满一条外边。它从不看几何。所以「数量够、摆法永远到不了」的残局会被
 * 一直判「活」——玩家眼看着怎么滑都不得分，局却不结束，没有任何按钮拦得住。玩家报过
 * 这件事（《侵蚀阶梯》v1.3.1 PR-15 的病根说明）。
 *
 * 反过来**不能**把计数判定改严：缝隙一旦落到「它说死、其实活」那一侧，后果是一局还
 * 能打的棋盘被 1.4 秒直接结算——那比前者更糟。所以计数那一层原样留着，只在它说「活」
 * 而盘面已经很小的时候，再花一点算力去真的穷举一遍。
 *
 * ── 这一件只做一件事 ────────────────────────────────────────────────────
 *
 * 「从这个盘面出发，一直滑下去，有没有任何一个到得了的盘面能得分？」
 *
 *   · 能 → `'scores'`，活。
 *   · 把所有到得了的盘面都走遍了，一个都不能 → `'dead'`，真死局。
 *   · 预算用完了 → `'unknown'`。**调用方一律当活。** 算不完就判死会把能打的局掐掉，
 *     那正是上面说的更糟的那一侧。
 *
 * ── 为什么不认几何 ──────────────────────────────────────────────────────
 *
 * 六副棋盘的滑动**不是同一个置换**：方块、小球、菱形方块、六边圆球、七色圆球是老老实
 * 实的循环位移（各自的 `grid[r].map((_, i) => vals[(((i - shift) % n) + n) % n])`），可
 * 六边三角 54 不是——它的格子正反交替朝向，所以只允许**偶数步**，而且绕回来那一段要
 * 按相邻两格配对交换（`triangle.ts` 的 `fillerAwareSource`）。
 *
 * 所以这个模块收的不是「线 + 位移量」，而是**算好的重排**：一步就是「这条线上的新第
 * i 格，内容来自旧第 src[i] 格」。棋盘自己最清楚它怎么滑，这儿只负责走遍。拿不准的几
 * 何在这儿一个字都不写，错不到这儿来。
 *
 * 纯算术、不碰 DOM、不认 Tile 类型——所以 `scripts/check-endgame-residue.mjs` 能把它单
 * 独拎出来验，进得了 CI。
 */

/**
 * 一格的编码。
 *
 * `0` 留给**空白**（小球那一副整线消除之后留在原位的空白球：它照样滑，但再也配不上
 * 任何颜色）。别的格子是 `((色号 + 1) << 1) | 是不是星星`。
 *
 * 为什么编成一个数而不是一个对象：BFS 要把整个盘面当钥匙塞进 Set 里比对，一个
 * `Uint16Array` 直接 `String.fromCharCode` 出一把钥匙，而一盘对象要序列化。
 */
export const RESIDUE_BLANK = 0;
export const encodeTile = (color: number, dot: boolean): number =>
  ((color + 1) << 1) | (dot ? 1 : 0);
/** 这一格此刻露的是哪个颜色。空白回 −1：它和谁都不同色，包括另一个空白。 */
export const colorOf = (code: number): number => (code === RESIDUE_BLANK ? -1 : (code >> 1) - 1);
/** 这一格是星星（反面）吗。 */
export const isDot = (code: number): boolean => (code & 1) === 1;
/** 这一格是色块（正面）吗——图案里**至少要有一枚**（§1.1）。 */
export const isFront = (code: number): boolean => code !== RESIDUE_BLANK && (code & 1) === 0;

/** 一步：把这条线上的内容按 `src` 重排（新 `cells[i]` 的内容来自旧 `cells[src[i]]`）。 */
export interface LineShuffle {
  /** 这条线的格号，**按线上顺序**。 */
  cells: readonly number[];
  /** 与 `cells` 等长：新位置 i 的内容来自旧位置 `src[i]`。 */
  src: readonly number[];
}

/** 能靠「整条同色星星」消掉的一条线，以及它此刻要几枚。 */
export interface BonusLine {
  cells: readonly number[];
  /** 这条线要几枚同色星星才消得动（方块＝整行整列长度；外边族＝常态 3、收尾 1）。 */
  need: number;
}

export interface ResidueInput {
  /** 开局盘面：下标＝格号，值＝`encodeTile` 的编码。不在盘上的格号不要出现在任何线里。 */
  start: Uint16Array;
  /** 所有合法的一步。 */
  moves: readonly LineShuffle[];
  /** 要扫「同线连续 N 枚同色」的线。通常就是 `moves` 里那些线去重。 */
  scanLines: readonly (readonly number[])[];
  /** 得分图案此刻要几枚。 */
  matchLen: number;
  /** 能被整线消除的线（一条都消不动就给空数组）。 */
  bonusLines: readonly BonusLine[];
  /** 最多展开几个盘面。默认 20000（v1.3.1 §4 字面值）。 */
  maxStates?: number;
  /** 最多算多少毫秒。默认 250（同上）。 */
  budgetMs?: number;
  /** 现在几点了。只给门用——真实时钟在门里不好控。 */
  now?: () => number;
}

export type ResidueVerdict = 'scores' | 'dead' | 'unknown';

/** v1.3.1 §4 的两个字面值。写成常量是为了让门能引同一个数，而不是各抄一遍。 */
export const RESIDUE_MAX_STATES = 20000;
export const RESIDUE_BUDGET_MS = 250;

/**
 * 这个盘面此刻能得分吗。
 *
 * 两条路，和引擎里那两条一一对应：
 *
 *   · **得分图案**：同一条线上连续 `matchLen` 格同色，而且**至少一枚是色块**
 *     （§1.1：全是星星的线无事发生）。空白格不同色，天然断开一条连续段。
 *   · **整线消除**：某条 `bonusLines` 上的线整条都是同色星星，且枚数 ≥ 它的 `need`。
 *
 * 导出给门用，也给下面的 BFS 用——门拿它当尺子，而不是再抄一份判定。
 */
export function scoresNow(
  state: Uint16Array,
  scanLines: readonly (readonly number[])[],
  matchLen: number,
  bonusLines: readonly BonusLine[],
): boolean {
  if (matchLen >= 1) {
    for (const line of scanLines) {
      let run = 0;
      let runColor = -2;
      let runHasFront = false;
      for (const cell of line) {
        const code = state[cell];
        const color = colorOf(code);
        if (color >= 0 && color === runColor) {
          run++;
          if (isFront(code)) runHasFront = true;
        } else {
          run = color >= 0 ? 1 : 0;
          runColor = color;
          runHasFront = color >= 0 && isFront(code);
        }
        if (run >= matchLen && runHasFront) return true;
      }
    }
  }
  for (const { cells, need } of bonusLines) {
    if (cells.length < need) continue;
    let color = -2;
    let ok = true;
    for (const cell of cells) {
      const code = state[cell];
      // 整线消除要的是**整条都是同色星星**：一个色块、一个空白、一个别的颜色都不行。
      if (!isDot(code)) { ok = false; break; }
      const c = colorOf(code);
      if (color === -2) color = c;
      else if (c !== color) { ok = false; break; }
    }
    if (ok && color >= 0) return true;
  }
  return false;
}

/** 把一个盘面压成一把能进 Set 的钥匙。格数最多几十，`fromCharCode` 够用也最快。 */
function keyOf(state: Uint16Array): string {
  let s = '';
  for (let i = 0; i < state.length; i++) s += String.fromCharCode(state[i]);
  return s;
}

function applyShuffle(state: Uint16Array, move: LineShuffle): Uint16Array {
  const next = state.slice();
  const { cells, src } = move;
  for (let i = 0; i < cells.length; i++) next[cells[i]] = state[cells[src[i]]];
  return next;
}

/**
 * 从这个盘面出发，有没有任何到得了的盘面能得分。
 *
 * 广度优先：**先把一步能到的全看完**，再看两步。所以「还有一步就能得分」这种最常见的
 * 情形第一轮就答出来，不用等整个闭包走完。
 *
 * 起手那个盘面**自己也查一遍**。真实调用里它一定不得分（走到 `stalemate` 那一头的时候连
 * 锁早就结清了），可「反正不会发生」不是不查的理由：第一版就是靠这句话跳过的，于是喂一副
 * 本来就成图案的盘面进去，它答 `'dead'`——一个一眼就看得出错的答案，而门第一轮就逮住了。
 */
export function residueSearch(input: ResidueInput): ResidueVerdict {
  const {
    start,
    moves,
    scanLines,
    matchLen,
    bonusLines,
    maxStates = RESIDUE_MAX_STATES,
    budgetMs = RESIDUE_BUDGET_MS,
    now = () => Date.now(),
  } = input;

  if (scoresNow(start, scanLines, matchLen, bonusLines)) return 'scores';
  if (!moves.length) return 'dead';
  const deadline = now() + budgetMs;
  const seen = new Set<string>([keyOf(start)]);
  let frontier: Uint16Array[] = [start];
  let expanded = 0;

  while (frontier.length) {
    const next: Uint16Array[] = [];
    for (const state of frontier) {
      for (const move of moves) {
        // 预算在**展开之前**问，不在之后：问在之后的话，最后那一批状态已经算过了，
        // 时间早超了才发现——那条 250ms 就不是上限而是个大概。
        if (expanded >= maxStates || now() > deadline) return 'unknown';
        expanded++;
        const child = applyShuffle(state, move);
        const key = keyOf(child);
        if (seen.has(key)) continue;
        seen.add(key);
        if (scoresNow(child, scanLines, matchLen, bonusLines)) return 'scores';
        next.push(child);
      }
    }
    frontier = next;
  }
  // 闭包走完了，一个到得了的盘面都不得分。这才是真死局。
  return 'dead';
}

/**
 * 普通棋盘那五副的一步集合：每条线各走 1…L−1 格的**循环位移**。
 *
 * 六边三角 54 不走这一条（它只允许偶数步，而且绕回来那一段要配对交换，见文件头）。
 */
export function cyclicShuffles(lines: readonly (readonly number[])[]): LineShuffle[] {
  const out: LineShuffle[] = [];
  for (const cells of lines) {
    const n = cells.length;
    if (n < 2) continue;
    for (let shift = 1; shift < n; shift++) {
      const src: number[] = [];
      for (let i = 0; i < n; i++) src.push((((i - shift) % n) + n) % n);
      out.push({ cells, src });
    }
  }
  return out;
}

/**
 * 六边三角 54 那一副的一步集合。
 *
 * 和 `triangle.ts` 的 `fillerAwareSource` 一字对一字：**只允许偶数步**（格子正反交替
 * 朝向，奇数步会把朝向搞错），而绕回来那一段（filler）要按相邻两格配对交换，正好把那
 * 一步的朝向错位抵消掉。
 *
 * 抄一份而不是 import：那一份在 `src/shapes/triangle.ts` 的闭包里，不导出。两份一旦
 * 走样，这儿就会穷举一个玩家滑不出来的盘面——所以 `check-endgame-residue.mjs` 里有一
 * 条尺子，拿同一组输入把两边的输出对一遍。
 */
export function fillerAwareShuffles(lines: readonly (readonly number[])[]): LineShuffle[] {
  const out: LineShuffle[] = [];
  for (const cells of lines) {
    const n = cells.length;
    if (n < 2) continue;
    for (let shift = 2; shift < n; shift += 2) {
      const src: number[] = [];
      for (let i = 0; i < n; i++) src.push(fillerAwareSource(i, shift, n));
      out.push({ cells, src });
    }
  }
  return out;
}

/** `triangle.ts` 那一个的同胞。改任何一边都要改另一边，门里有尺子对着。 */
export function fillerAwareSource(idx: number, shift: number, n: number): number {
  const plain = (((idx - shift) % n) + n) % n;
  if (shift === 0) return plain;
  const fillerSize = Math.abs(shift);
  const regionStart = shift > 0 ? 0 : n - fillerSize;
  const inFiller = shift > 0 ? idx < fillerSize : idx >= regionStart;
  if (!inFiller) return plain;
  const localIdx = idx - regionStart;
  const partnerIdx = regionStart + (localIdx % 2 === 0 ? localIdx + 1 : localIdx - 1);
  return (((partnerIdx - shift) % n) + n) % n;
}
