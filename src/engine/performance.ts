export interface PerformanceGauge {
  /**
   * Feed one resolved move. `weight` is what that move scored in "actions":
   * 0 if it scored nothing, otherwise the sum of its steps' weights (an
   * ordinary pattern 1, a pattern grown past 4 cells 2, a whole-line clear
   * 3 — see scoring.ts).
   */
  onMove(weight: number): void;
  /** 0-100: scoring actions / total actions, over the whole run so far. */
  valuePercent(): number;
  reset(): void;
}

/**
 * 有效得分率 — how much of everything the player has done actually scored,
 * counted in *actions* rather than moves and accumulated from the first move
 * to the last (no recency weighting, so the reading can't swing on the final
 * couple of moves).
 *
 * A move that scores nothing still costs one action. A scoring move adds its
 * own weight to both sides, so bigger scores also count as more of the run:
 * five blank moves read 0/5, a plain score next reads 1/6, a grown pattern
 * after that 3/8, and a whole-line clear on top of that 6/11.
 */
export function createPerformanceGauge(): PerformanceGauge {
  let scoredActions = 0;
  let totalActions = 0;

  function onMove(weight: number) {
    const w = Math.max(0, Math.round(weight));
    scoredActions += w;
    totalActions += Math.max(1, w);
  }

  function valuePercent(): number {
    if (totalActions === 0) return 0;
    return Math.round((scoredActions / totalActions) * 100);
  }

  function reset() {
    scoredActions = 0;
    totalActions = 0;
  }

  return { onMove, valuePercent, reset };
}
