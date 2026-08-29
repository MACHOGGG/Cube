import type { BoardSnapshot, ShareCardInfo } from './shareCard';

export function loadBest(key: string): number {
  return parseInt(localStorage.getItem(key) || '0', 10) || 0;
}

/** Saves score under key if it beats the stored best, returning the (possibly unchanged) best. */
export function saveBestIfHigher(key: string, score: number): number {
  const best = Math.max(score, loadBest(key));
  localStorage.setItem(key, String(best));
  return best;
}

/**
 * One finished run, archived verbatim: exactly what its share card showed
 * (in the language it was played in) plus the two board snapshots — so the
 * 记录 panel can later re-open the very photo that run produced, not a
 * reconstruction from the score alone.
 */
export interface StoredRun {
  at: number;
  info: ShareCardInfo;
  start: BoardSnapshot | null;
  end: BoardSnapshot | null;
}

const RUNS_SUFFIX = '::runs';
/** Newest-first, capped per mode so snapshots can't crowd localStorage out. */
const MAX_RUNS = 10;

export function loadRuns(bestKey: string): StoredRun[] {
  try {
    const raw = localStorage.getItem(bestKey + RUNS_SUFFIX);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? (list as StoredRun[]) : [];
  } catch {
    return [];
  }
}

export function saveRun(bestKey: string, run: StoredRun): void {
  try {
    const list = loadRuns(bestKey);
    list.unshift(run);
    localStorage.setItem(bestKey + RUNS_SUFFIX, JSON.stringify(list.slice(0, MAX_RUNS)));
  } catch {
    // Storage full or unavailable — the run simply isn't archived.
  }
}

/** The newest archived run that produced this exact total — i.e. the run a
 *  best-score row in the records panel is actually about. */
export function findRun(bestKey: string, score: number): StoredRun | null {
  return loadRuns(bestKey).find((r) => r.info && r.info.totalScore === score) ?? null;
}
