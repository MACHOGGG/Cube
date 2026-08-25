export function loadBest(key: string): number {
  return parseInt(localStorage.getItem(key) || '0', 10) || 0;
}

/** Saves score under key if it beats the stored best, returning the (possibly unchanged) best. */
export function saveBestIfHigher(key: string, score: number): number {
  const best = Math.max(score, loadBest(key));
  localStorage.setItem(key, String(best));
  return best;
}
