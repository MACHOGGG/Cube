export interface PerformanceGauge {
  /** Feed the result of one resolved move. */
  onMove(scored: boolean): void;
  /** 0-100; only changes on onMove(), so re-reading it between moves returns the same value. */
  valuePercent(): number;
  reset(): void;
}

// How much the last few moves dominate the hit-rate reading (higher = longer memory).
const HIT_ALPHA = 0.75;

/**
 * A live "were your last few moves actually scoring" readout: a recency-
 * weighted hit-rate, no time component — it only moves when you make a
 * move, and holds steady while you're thinking.
 */
export function createPerformanceGauge(): PerformanceGauge {
  let hitEwma = 0;
  let started = false;

  function onMove(scored: boolean) {
    hitEwma = hitEwma * HIT_ALPHA + (scored ? 1 : 0) * (1 - HIT_ALPHA);
    started = true;
  }

  function valuePercent(): number {
    if (!started) return 0;
    return Math.round(hitEwma * 100);
  }

  function reset() {
    hitEwma = 0;
    started = false;
  }

  return { onMove, valuePercent, reset };
}
