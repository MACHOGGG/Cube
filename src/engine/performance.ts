export interface PerformanceGauge {
  /** Feed the result of one resolved move. */
  onMove(scored: boolean): void;
  /** 0-100, meant to be re-read continuously (including between moves) since it decays with idle time. */
  valuePercent(): number;
  reset(): void;
}

// How much the last few moves dominate the hit-rate reading (higher = longer memory).
const HIT_ALPHA = 0.75;
// Seconds of no new score before the gauge decays to 0, even with a decent hit-rate.
const COOLDOWN_SECONDS = 10;

/**
 * A live "how hot is this run right now" readout, styled after a car's
 * speedometer rather than a flat run average: it blends a recency-weighted
 * hit-rate (were your last few moves actually scoring?) with a cooldown that
 * bleeds the number back down to 0 if too much time passes without a fresh
 * score — so it keeps ticking down even while you're just staring at the
 * board, not only when you make a bad move.
 */
export function createPerformanceGauge(): PerformanceGauge {
  let hitEwma = 0;
  let lastScoreTime = Date.now();
  let started = false;

  function onMove(scored: boolean) {
    hitEwma = hitEwma * HIT_ALPHA + (scored ? 1 : 0) * (1 - HIT_ALPHA);
    if (scored) lastScoreTime = Date.now();
    started = true;
  }

  function valuePercent(): number {
    if (!started) return 0;
    const secondsSinceScore = (Date.now() - lastScoreTime) / 1000;
    const timeDecay = Math.max(0, Math.min(1, 1 - secondsSinceScore / COOLDOWN_SECONDS));
    return Math.round(hitEwma * timeDecay * 100);
  }

  function reset() {
    hitEwma = 0;
    lastScoreTime = Date.now();
    started = false;
  }

  return { onMove, valuePercent, reset };
}
