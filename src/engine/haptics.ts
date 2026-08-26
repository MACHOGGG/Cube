/**
 * Thin, safe wrapper over the Vibration API. Most desktop browsers simply
 * don't implement navigator.vibrate at all, so feature-detecting it also
 * naturally limits this to the mobile devices it's meant for — no separate
 * "is this a phone" check needed. Wrapped in try/catch too since some
 * browsers throw rather than no-op when a page hasn't had a user gesture yet
 * or vibration is blocked by a permissions policy.
 */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is a nice-to-have; never let it break the game.
  }
}
