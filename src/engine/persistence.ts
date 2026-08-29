import type { BoardSnapshot } from './shareCard';
import type { RunData } from './runRecord';

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
 * One finished run, archived as raw data plus the two board snapshots — so
 * the 记录 panel can re-open the very photo that run produced, described in
 * whatever language the player is reading now (see runRecord.ts).
 */
export interface StoredRun {
  at: number;
  data: RunData;
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


/**
 * Every archived run on this device, newest first. The records panel lists
 * these directly and 累计得分 is their sum — one source of truth, so the
 * total can never drift from the list under it.
 */
export function loadAllRuns(bestKeys: readonly string[]): StoredRun[] {
  const seen = new Set<string>();
  const all: StoredRun[] = [];
  for (const key of bestKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    for (const run of loadRuns(key)) {
      // Entries archived before runs held raw data can't be re-described.
      if (run && run.data) all.push(run);
    }
  }
  return all.sort((a, b) => b.at - a.at);
}

export function totalScoreOf(runs: readonly StoredRun[]): number {
  return runs.reduce((sum, r) => sum + (r.data.totalScore || 0), 0);
}
