import type { Cell, Match, Tile } from './types';
import { cellKey } from './types';

/** What the gain bubble calls a payout, in the player's language. */
export interface CascadeLabels {
  /** Fallback for a match a shape didn't name itself. */
  pattern: string;
  line: string;
}

export interface StreakTracker {
  /** Feeds one move's raw (un-multiplied) points in; returns the score delta to add (0 if the move scored nothing, which also resets the streak). */
  apply(points: number): number;
  /** The multiplier the *next* scoring move would receive if it scores right now. */
  currentMultiplier(): number;
  reset(): void;
}

/**
 * Consecutive scoring moves step the multiplier up by half each time: the
 * 1st move in a streak keeps its own points as-is (×1), the 2nd is ×1.5, the
 * 3rd ×2, the 4th ×2.5 — each move's *own* raw points, not a running sum.
 * Any move that scores nothing resets the streak for the next one.
 *
 * Additive rather than doubling on purpose: a long streak should be worth
 * chasing without letting one lucky run dwarf every other score.
 */
export function createStreakTracker(): StreakTracker {
  let streakLevel = 0; // 0 = no active streak yet; k = the k-th consecutive scoring move just applied

  function reset() {
    streakLevel = 0;
  }

  function currentMultiplier(): number {
    return 1 + 0.5 * streakLevel;
  }

  function apply(points: number): number {
    if (points <= 0) {
      reset();
      return 0;
    }
    const delta = points * currentMultiplier();
    streakLevel++;
    return delta;
  }

  return { apply, currentMultiplier, reset };
}

/**
 * 无限反转的连击：连续第 n 次得分 = 单次得分 × base^(n−1)，每次四舍五入取整。
 *
 * `chain` 是这一次之前已经连续得了几次分（第一次是 0），同一步里的连锁也各算
 * 一次；一步没得分就归零（见 gameController 的 flipChain）。玩家定的数（底数
 * 先是 1.2，后来提到 1.5）：4 分的图案连着来是 4、6、9、13.5≈14、20.25≈20……
 * 不再是别的局那套 ×1.5/2/2.5 和同一步里的 ×3。
 */
export const FLIP_STREAK_BASE = 1.5;
export function flipStreakDelta(points: number, chain: number, base = FLIP_STREAK_BASE): number {
  return Math.round(points * base ** Math.max(0, chain));
}

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
}

/**
 * 无限反转一次连锁最多几拍——只是最后一道保险。真正管「同一组翻来翻去无限得
 * 分」的是下面的账本（ToggleLedger）。
 */
const TOGGLE_STEP_CAP = 12;

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
  /**
   * For a whole-line clear: the dot colour each cleared line was made of —
   * read while its tiles are still in place, since a shape whose bonus
   * removes cells has already dropped them by the time this step is handed
   * back. The stalemate rule needs these (see stalemate.ts).
   */
  clearedDotColors: number[];
  /** Applies this step's mutation: flips matchGroups' cells to their dot face (a no-op for a bonus step, whose cells are already dot-faced and already removed by the time next() returns). Call once, after showing the pre-flip highlight, before requesting the next step. */
  commit(): void;
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
  ledger?: ToggleLedger,
): CascadeStepper {
  let mask = initialMask;
  let terminal = false;
  let steps = 0;

  function next(): CascadeStep | null {
    if (terminal) return null;
    if (cfg.toggleOnMatch && steps >= TOGGLE_STEP_CAP) {
      terminal = true;
      return null;
    }
    steps++;

    const lineBonuses = cfg.findLineBonuses();
    if (lineBonuses.length) {
      // A cleared line scores the square of its own tile count, so a longer
      // line (a new layout's diagonal, say) is worth more than a shorter one
      // rather than every shape's line being flatly worth the same bonus.
      const points = lineBonuses.reduce((sum, cells) => sum + cells.length ** 2, 0);
      const clearedDotColors = lineBonuses.map(([[r, c]]) => cfg.tileAt(r, c).dotColor);
      cfg.onLineBonus(lineBonuses);
      if (cfg.resetMaskOnLineBonus) mask = null;
      if (cfg.isTerminalAfterLineBonus?.()) terminal = true;
      return {
        points,
        matchGroups: [],
        lineBonusGroups: lineBonuses,
        weight: 3 * lineBonuses.length,
        label: labels.line,
        clearedDotColors,
        commit() {},
      };
    }

    const nextMask = new Set<string>();
    const idsOf = (m: Match) => m.cells.map(([r, c]) => cfg.tileAt(r, c).id);
    const matches = dedupe(
      cfg
        .findMatches(mask)
        .filter((m) => m.cells.some(([r, c]) => cfg.tileAt(r, c).face === 'flavor')),
    ).filter((m) => !ledger || ledger.allows(idsOf(m)));
    if (matches.length) {
      let points = 0;
      const toFlip = new Set<string>();
      for (const m of matches) {
        ledger?.note(idsOf(m));
        points += m.points;
        for (const [r, c] of m.cells) {
          nextMask.add(cellKey(r, c));
          // 普通规则只翻正面；无限反转一组里每一枚都翻（反面翻回正面）。
          if (cfg.toggleOnMatch || cfg.tileAt(r, c).face === 'flavor') toFlip.add(cellKey(r, c));
        }
      }
      mask = nextMask;
      return {
        points,
        matchGroups: matches.map((m) => m.cells),
        lineBonusGroups: [],
        // A pattern that grew past its 4-cell seed is worth two actions.
        weight: matches.reduce((sum, m) => sum + (m.cells.length > 4 ? 2 : 1), 0),
        label: matches.map((m) => m.label ?? labels.pattern).join(' · '),
        clearedDotColors: [],
        commit() {
          for (const key of toFlip) {
            const [r, c] = key.split(',').map(Number);
            const t = cfg.tileAt(r, c);
            t.face = cfg.toggleOnMatch && t.face === 'dot' ? 'flavor' : 'dot';
          }
        },
      };
    }

    terminal = true;
    return null;
  }

  return { next };
}
