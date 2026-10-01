import type { Cell, Match, Tile } from './types';
import { cellKey } from './types';

/** What the gain bubble calls a payout, in the player's language. */
export interface CascadeLabels {
  /** Fallback for a match a shape didn't name itself. */
  pattern: string;
  line: string;
}

/**
 * 跨步连击（×1 / 1.5 / 2 / 2.5）**已经退役**——《侵蚀阶梯》v1.2 §1.5：
 * 「拼出分 = 翻面分（含拆除）+ 削线分，无任何过程系数」。
 *
 * 一起退役的还有：同一步之内每拍 ×3 的连锁倍率、结算时的时间系数、有效得分率系
 * 数、以及 0.95^未翻面。留下的只有两样乘数，各有各的理由：无限反转自己那条
 * 1.5ⁿ（下面 flipStreakDelta，那一局不吃侵蚀、也不乘步数系数），和结算页上那个
 * **步数系数**（§5，算在拼出分之外，对局中不显示）。
 */

/**
 * 无限反转的连击：连续第 n 次得分 = 单次得分 × base^(n−1)，每次四舍五入取整。
 *
 * `chain` 是这一次之前已经连续得了几次分（第一次是 0），同一步里的连锁也各算
 * 一次；一步没得分就归零（见 gameController 的 flipChain）。玩家定的数（底数
 * 先是 1.2，后来提到 1.5）：4 分的图案连着来是 4、6、9、13.5≈14、20.25≈20……
 * 不再是别的局那套 ×1.5/2/2.5 和同一步里的 ×3。
 *
 * **倍率有封顶**（FLIP_STREAK_CAP，见下面）：它是指数，不封的话一局能打穿排行榜
 * 的上限。
 */
export const FLIP_STREAK_BASE = 1.5;
/**
 * 连击倍率的**封顶**：`chain` 再大也按这个数算（1.5¹⁰ ≈ 57.7 倍）。
 *
 * 为什么非封不可：这是指数，而排行榜有上限（`api/scores.js` 的 `MAX_SCORE = 1e9`），
 * 超过就一律**截断成十亿**。实算过（node，照下面这个公式逐项算）：4 分的图案大约
 * **连续第 49 次**时单次得分就超过十亿——于是榜首那一批全显示同一个数字，正是玩家
 * 报过的那个 bug（原话「过了上限以后都按照同一数字显示了」）。
 *
 * 顺手记一笔：《外边消除决策》D5 那一节原先写着「到第 32 步倍率已经 ≈1.4×10¹⁵」，
 * 那个数按这个公式**重现不出来**（第 32 次是 ×2.9×10⁵，要到 1.4×10¹⁵ 得连续约 87
 * 次）。文档里已经改对，别再引那个数。
 *
 * 10 是玩家 2026-09 拍的板（「直接封顶，按 n ≤ 10（约 57.7 倍）」）。封顶是**规则
 * 变更**，所以配了 FLIP_RULES_VERSION，让封顶前后的成绩分开排榜。
 */
export const FLIP_STREAK_CAP = 10;
/**
 * 无限反转按第几版规则打的。
 *
 * 1 = 连击不封顶（2026-09 之前）；2 = 封顶在 FLIP_STREAK_CAP。
 * 一局能不能打出上亿分，两版不是一把尺子量的，所以存档键和排行榜要按它分开——
 * 照 `bomb.ts` 的 `BOMB_RULES_VERSION` 那条路走（`_flip` → `_flip2`）。
 */
export const FLIP_RULES_VERSION = 2;
export function flipStreakDelta(points: number, chain: number, base = FLIP_STREAK_BASE): number {
  return Math.round(points * base ** Math.min(Math.max(0, chain), FLIP_STREAK_CAP));
}

/**
 * 这一局按第几版**计分规则**打的——《侵蚀阶梯》v1.2 §6。
 *
 * 和 `BOMB_RULES_VERSION` / `FLIP_RULES_VERSION` 那两个不同：那两个各管一个玩法，
 * 这一个管**全站所有玩法**。《侵蚀阶梯》把得分图案、翻面分、整线消除、综合分全换
 * 了一套，旧局和新局根本不是一把尺子量出来的，所以存档键和排行榜都要按它分开。
 *
 * 写成字符串不是数字：本地键长 `_ero1`，一眼看得出是哪一版，而 `_2` 那样的后缀和炸
 * 弹那几版的数字混在一起认不出来。
 *
 * ⚠️ **云端榜上没有这一截。** 榜 id 由 `api/scores.js` 的 `boardIdOf` 生成，里头没有版
 * 本段（实际长 `square:base` 这样）。云端是**按 `rules` 字段过滤**的：上报时
 * `rules !== 'ero1'` 回 200 + `stored:false`，重建时跳过——不是另开一张榜。这儿从前写着
 * 「云端榜长 `:ero1`」，是假的。
 *
 * 换规则时怎么做：改这个常量 → 本地那一次性清档跟着换钥匙（`engine/wipeOldRules.ts`
 * 的 `slides_wipe_*`，两端各调一次）→ 服务端跑一次**管理员的 `rebuild`**（`api/scores.js`
 * 的 `rebuild` 路由，带 `wipeAll`；**没有清档脚本**，要人手 POST，`ADMIN_TOKEN` 保护）
 * → `api/scores.js` 那一行改成收新的。四样缺一样就会出现「新分进了旧榜」或者「新分谁
 * 也看不见」。
 */
export const SCORING_RULES_VERSION = 'ero1';

export interface CascadeConfig {
  tileAt(r: number, c: number): Tile;
  /** Groups of cells that now qualify for a whole-line color bonus; shape is responsible for not re-offering a line already bonused this game. */
  findLineBonuses(): Cell[][];
  /**
   * Flips every cell in every bonused line to its dot face and, for shapes
   * where a full line leaves the board (the square grid), removes them.
   * Called once per cascade step with *all* of that step's line groups
   * together (not once per group) so a shape whose removal renumbers rows/
   * columns — square clearing a row and a column in the same step — can
   * batch the removal the same way the original single-shape prototype did,
   * instead of the first group's removal invalidating the second group's
   * still-pre-removal coordinates. Every cell in every group is already
   * dot-faced by the time this runs (see isFullDotMatch), so — unlike a
   * regular match — there's no flip for the caller to stage; only the
   * removal (if any) needs revealing.
   */
  onLineBonus(groups: Cell[][]): void;
  /** Square's line-clear shrinks the grid, so any in-flight cell mask goes stale and must be dropped. */
  resetMaskOnLineBonus: boolean;
  /** Square also stops the instant the board is fully cleared away. */
  isTerminalAfterLineBonus?(): boolean;
  findMatches(mask: Set<string> | null): Match[];
  /**
   * 无限反转：得分之后一组里的每一枚都翻一次——正面翻到反面、反面翻回正面
   * （普通规则只把正面翻到反面）。「至少要有一枚正面才算分」那条不变，所以
   * 一组全是反面的照旧不给分。见 ShapeGameOpts.flip。
   */
  toggleOnMatch?: boolean;
  /**
   * 这一拍翻完之后，棋盘自己还顺手动了哪几格——把它们并进下一拍的遮罩。
   *
   * 炸弹玩法要的就是这个。举一个具体局面：一个蓝色 2×2 得分，右边紧邻一枚炸
   * 弹，炸弹被连带拆掉、翻成绿色星星；这颗绿星星的另一侧恰好有三枚绿色正面，
   * 四枚合起来正好是一个绿色 2×2。不并进遮罩的话，第一拍之后遮罩里只有那 4
   * 个蓝格子，绿色 2×2 没有一格在遮罩里，touches 不通过——这个图案在这一步
   * 不会被找到、不会得分，会一直摆在盘上，直到以后某次滑动碰巧碰到它。玩家
   * 看见的是「图案拼好了却没给分，过了几步又莫名其妙给了」。
   *
   * 传进来的是这一拍得分的那些格子，回传要并进遮罩的格子。拆弹本身不给分、
   * weight 也不记（这个回调不碰分数），所以计分和「有效得分率」的口径不变。
   */
  afterCommit?(scored: Cell[]): Cell[];
  /**
   * 老虎机：除了「每翻一枚 +2」，**再加上每一组自己的 `points`**——目标拼成一次的
   * 完成奖励 `⌈枚数²/2⌉`（engine/targets.ts 的 `scoreForSize`：2 枚 +2、3 枚 +5、
   * 4 枚 +8、5 枚 +13、6 枚 +18）。
   *
   * ⚠️ **不能无条件相加。** 基础玩法那条路（`findRunMatches`）也往 `Match.points` 里
   * 写东西（各 shape 里的 `groupPoints`），一直加的话那一档会**双算**：每枚 +2 之外
   * 又把按组算的那一份加一遍。所以这是一个显式开关，只有真的有目标的那一局才开。
   */
  bonusOnMatch?: boolean;
}

/**
 * 每翻一枚色块 +2（《侵蚀阶梯》v1.2 §1.2）。
 *
 * 算的是**这一拍真的翻了几枚**，不是各组的枚数之和：两组共用一枚（十字路口那一
 * 枚同时属于横竖两条线）时那一枚只算一次——§1.2「同一步同一枚只算一次」。混合组
 * 按翻面枚数算，所以 3 色块 + 1 星星的 1×4 是 +6，不是 +8。
 */
export const POINTS_PER_FLIP = 2;

/** 无限反转里同一组棋子最多连着给几次分：正面一次、翻过去反面一次。 */
export const TOGGLE_SCORES_PER_GROUP = 2;
/** 给满之后，隔多少步才能再给——不满这个数把那几枚挪走再挪回来也不算。 */
export const TOGGLE_COOLDOWN_MOVES = 5;

/**
 * 无限反转的连锁账本：按棋子身份记每一组给过几次分。
 *
 * 玩家撞上的情形：几枚棋子正面凑成图案得分翻面，反面恰好也同色、也成图案，
 * 又得分翻回正面，正面再得分……手都不用动，分一直涨。规矩（玩家定的）：同一
 * 组正面得一次、反面得一次，之后要动手；动了手，距上次得分不满五步又把这几
 * 枚拼回来，也不给分。
 *
 * 「同一组」按棋子的 id 认，不按格子位置：整行挪走再挪回来，棋子还是那几枚。
 * 组的成员换了（多拉进来一枚、换掉一枚）就是另一组，各记各的账。
 */
export interface ToggleLedger {
  /** 新的一步开始了——传进来的是这一局的第几步。 */
  beginMove(moveNo: number): void;
  /** 这一组现在能不能给分。 */
  allows(ids: readonly number[]): boolean;
  /** 这一组刚给了分，记一笔。 */
  note(ids: readonly number[]): void;
  reset(): void;
}

export function createToggleLedger(): ToggleLedger {
  const book = new Map<string, { count: number; lastMove: number }>();
  let moveNo = 0;
  const keyOf = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join('|');
  const cooled = (e: { lastMove: number }) => moveNo - e.lastMove >= TOGGLE_COOLDOWN_MOVES;
  return {
    beginMove(n) {
      moveNo = n;
    },
    allows(ids) {
      const e = book.get(keyOf(ids));
      if (!e || cooled(e)) return true;
      return e.count < TOGGLE_SCORES_PER_GROUP;
    },
    note(ids) {
      const k = keyOf(ids);
      const e = book.get(k);
      if (!e || cooled(e)) book.set(k, { count: 1, lastMove: moveNo });
      else {
        e.count++;
        e.lastMove = moveNo;
      }
    },
    reset() {
      book.clear();
      moveNo = 0;
    },
  };
}

/**
 * One "beat" of a cascade — either a wave of whole-line bonuses or a wave of
 * 2x2/run-4/cluster matches, never both — returned *before* a match step's
 * flip is applied so the caller can show the highlight against the tiles'
 * still-current face first. matchGroups is empty for a bonus step and vice
 * versa.
 */
export interface CascadeStep {
  points: number;
  matchGroups: Cell[][];
  lineBonusGroups: Cell[][];
  /**
   * How much "action" this step is worth to the hit-rate meter: 1 for an
   * ordinary 4-cell pattern, 2 for one that grew past 4, 3 for a whole-line
   * clear. A move's weights are summed (see performance.ts).
   */
  weight: number;
  /** What paid out, for the gain bubble ("4连", "整线"…). */
  label: string;
  /** Applies this step's mutation: flips matchGroups' cells to their dot face (a no-op for a bonus step, whose cells are already dot-faced and already removed by the time next() returns). Call once, after showing the pre-flip highlight, before requesting the next step. */
  /**
   * 这一拍**图案本身**要翻几枚（去重之后）。分就是按它算的（每枚 +2）。
   * 棋盘顺手拆掉的炸弹不在里头——那要等 commit 跑完才知道，见下面。
   */
  flips: number;
  /**
   * 真正把这一拍的翻面落到棋盘上，**并回报这一拍一共翻了几枚**——`flips` 加上棋盘
   * 顺手拆掉的炸弹（§1.3：「拆除那一下按一次翻面计：+2 分、消耗一段侵蚀」）。
   * 多出来的那几枚的分由控制器补上；侵蚀阶梯扣的是这个总数。
   * 整线消除那一拍返回 0：那条线上全是星星，一枚都没翻。
   */
  commit(): number;
}

export interface CascadeStepper {
  /** Finds the next step, or null once the chain reaction has fully settled. */
  next(): CascadeStep | null;
}

/**
 * One region, one payout.
 *
 * Every shape's findMatches probes each possible starting cell separately and
 * grows whatever it finds outwards into a whole region — so a run of five
 * seeds at two places and a 3x3 block at four, and each of those seeds hands
 * back the *same* final region as its own Match. Summing them straight
 * doubled a five-run to ten points and quadrupled a 3x3.
 *
 * The old comment in square.ts promised that scoring.ts already collapsed
 * these "by tile id". It did not — the mechanism was never written. This is
 * it, in the one place all eight shapes pass through, rather than eight
 * near-identical guards that would have to be kept in step.
 *
 * Identical regions only. Two regions that merely *overlap* are two different
 * patterns the player really did complete — a run of four sharing its last
 * tile with a column of four is two payouts, and collapsing those would take
 * away a score that was honestly earned.
 */
function dedupe(matches: Match[]): Match[] {
  const seen = new Set<string>();
  const kept: Match[] = [];
  for (const m of matches) {
    // Sorted, so the same region found from two different seeds — which may
    // walk its cells in a different order — signs identically.
    const signature = m.cells.map(([r, c]) => cellKey(r, c)).sort().join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    kept.push(m);
  }
  return kept;
}

/**
 * Drives one full chain reaction following a confirmed move, one beat at a
 * time: repeatedly finds the next whole-line bonus or match wave, applying a
 * bonus's mutation immediately (its cells are always already dot-faced —
 * see isFullDotMatch — so there's nothing to stage) but holding a match
 * wave's flip back in commit() until the caller calls it. The caller is
 * expected to call next() and commit() strictly in sequence — each commit()
 * before the following next() — so from resolveCascade's own point of view
 * this is exactly the same algorithm as a plain synchronous loop, just with
 * its steps exposed one at a time instead of all resolved before returning.
 */
export function createCascadeStepper(
  cfg: CascadeConfig,
  initialMask: Set<string> | null,
  labels: CascadeLabels,
  // A match only pays out if it still contains at least one *front*-facing
  // tile, so every score flips something and the board always moves forward.
  // That single rule is what makes an anti-farming guard unnecessary: a
  // group of already-flipped tiles can be slid back into the same shape as
  // often as you like and it will never score again, because there is
  // nothing left in it to flip.
  //
  // 无限反转是例外：翻过去还能翻回来，「总有一枚正面」拦不住它，所以那一局
  // 带一本账（ledger）：同一组正反各给一次分就停，见 createToggleLedger。
  //
  // 这儿原先还压着一条「一次连锁最多 12 拍」的硬上限，说法是「最后一道保
  // 险」。它拦掉的是玩家真打出来的长连锁——第 13 拍开始，明明还在成图案，分
  // 却不给了，屏幕上也不说一声。玩家要的是连锁能一直连下去，所以按他的意思
  // 撤掉了。撤掉之后还是停得下来：一步之内 moveNo 不动，账本里每一组最多记
  // 两笔（cooled 在同一步里永远是假），而一副盘面上凑得成图案的组是有限的，
  // 所以连锁至多两倍于那个数就走到头。
  ledger?: ToggleLedger,
): CascadeStepper {
  let mask = initialMask;
  let terminal = false;

  function next(): CascadeStep | null {
    if (terminal) return null;

    const lineBonuses = cfg.findLineBonuses();
    if (lineBonuses.length) {
      // A cleared line scores the square of its own tile count, so a longer
      // line (a new layout's diagonal, say) is worth more than a shorter one
      // rather than every shape's line being flatly worth the same bonus.
      const points = lineBonuses.reduce((sum, cells) => sum + cells.length ** 2, 0);
      cfg.onLineBonus(lineBonuses);
      if (cfg.resetMaskOnLineBonus) mask = null;
      if (cfg.isTerminalAfterLineBonus?.()) terminal = true;
      return {
        points,
        matchGroups: [],
        lineBonusGroups: lineBonuses,
        weight: 3 * lineBonuses.length,
        label: labels.line,
        flips: 0,
        // 整线消除不翻任何东西（那条线上全是星星），所以不扣段。
        commit: () => 0,
      };
    }

    const nextMask = new Set<string>();
    const idsOf = (m: Match) => m.cells.map(([r, c]) => cfg.tileAt(r, c).id);
    /**
     * 一组要算数，里头至少得有一枚色块（《侵蚀阶梯》v1.2 §1.1：「图案里至少要有
     * 一枚色块；全是星星的线无事发生」）。
     *
     * 这一条同时也是防刷分的全部：一组已经翻过的棋子再怎么滑回同一个形状也不会
     * 再得分，因为里头没有可翻的了。无限反转是例外（翻过去还能翻回来），所以那
     * 一局另带一本账（ledger）。
     */
    const matches = dedupe(
      cfg.findMatches(mask).filter((m) => m.cells.some(([r, c]) => cfg.tileAt(r, c).face === 'flavor')),
    ).filter((m) => !ledger || ledger.allows(idsOf(m)));
    if (matches.length) {
      const toFlip = new Set<string>();
      for (const m of matches) {
        ledger?.note(idsOf(m));
        for (const [r, c] of m.cells) {
          nextMask.add(cellKey(r, c));
          // 普通规则只翻正面；无限反转一组里每一枚都翻（反面翻回正面）。
          if (cfg.toggleOnMatch || cfg.tileAt(r, c).face === 'flavor') toFlip.add(cellKey(r, c));
        }
      }
      /**
       * 这一拍值几分。
       *
       * 普通规则（《侵蚀阶梯》v1.2 §1.2）：**每翻一枚 +2**，按这一拍去重之后真的
       * 要翻的那个集合算——两组共用的那一枚只算一次。各组自己的 `points` 在这条路
       * 上没人看。
       *
       * 无限反转照旧按组给分（玩家 2026-09-27：「图案跟着变 1×N，但不吃侵蚀，计分
       * 保留它自己那一套」）：那一局翻过去还能翻回来，按翻面枚数算就成了来回翻刷
       * 分。它外面还要再乘 1.5ⁿ，在 gameController 里。
       */
      const flipPoints = POINTS_PER_FLIP * toFlip.size;
      /**
       * 老虎机的完成奖励（§7）：拼成一次，除了翻面那几枚的 +2，再给 `⌈枚数²/2⌉`。
       *
       * 从前这一行没有，于是「完成奖励」整条规则在盘上**一分都没有生效过**——各组的
       * `points` 里算好的那个数被这条路原样丢掉了，而规则书和结算页都在讲它。
       */
      const bonus = cfg.bonusOnMatch ? matches.reduce((sum, m) => sum + m.points, 0) : 0;
      const points = cfg.toggleOnMatch
        ? matches.reduce((sum, m) => sum + m.points, 0)
        : flipPoints + bonus;
      mask = nextMask;
      return {
        points,
        matchGroups: matches.map((m) => m.cells),
        lineBonusGroups: [],
        // A pattern that grew past its seed is worth two actions.
        weight: matches.reduce((sum, m) => sum + (m.cells.length > 4 ? 2 : 1), 0),
        label: matches.map((m) => m.label ?? labels.pattern).join(' · '),
        flips: toFlip.size,
        commit() {
          for (const key of toFlip) {
            const [r, c] = key.split(',').map(Number);
            const t = cfg.tileAt(r, c);
            t.face = cfg.toggleOnMatch && t.face === 'dot' ? 'flavor' : 'dot';
          }
          // 棋盘顺手动的那几格（炸弹被连带拆掉）也算进下一拍的遮罩。
          // 这会儿 mask 已经是 nextMask 了（上面那一行），而 commit 一定在
          // 下一次 next() 之前跑，所以直接往里加就是加进下一拍。
          const also = cfg.afterCommit?.(matches.flatMap((m) => m.cells)) ?? [];
          for (const [r, c] of also) mask?.add(cellKey(r, c));
          // 拆掉的炸弹**也算一次翻面**（§1.3）。它的 +2 不在上面那个 points 里
          // ——afterCommit 要等 commit 才跑，那时候分已经报出去了——所以控制器按
          // 「回报数 − flips」把差额补上（见 gameController）。
          return toFlip.size + also.length;
        },
      };
    }

    terminal = true;
    return null;
  }

  return { next };
}
