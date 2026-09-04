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
/**
 * 一个玩法留几局。
 *
 * 分两个数，因为一局的大小差得远：带着两张棋盘照片的那种有好几 KB，从云上取
 * 回来的那种只有原始数据、没有照片，小得多。所以「留着照片的」只留最近十局
 * （照片是拿来重画战绩图的，久远的那几张没人会去翻），而「这一局打过、得了
 * 多少分」这件事本身留四十局——累计得分是这张清单的总和，清单短一截，玩家
 * 的总分就凭空少一截。
 */
const MAX_RUNS = 10;
const MAX_ARCHIVE = 40;

/** 这一局的编号：结算时刻 + 玩法 + 模式。和云端那份用的是同一个式子。 */
const idOf = (run: StoredRun): string =>
  `${run.at}-${run.data?.shapeId ?? ''}-${run.data?.modeKey ?? ''}`;

/** 按上面那两个数收一收：新的在前，只有最近十局留着照片。 */
function trim(list: StoredRun[]): StoredRun[] {
  const sorted = list.slice().sort((a, b) => b.at - a.at).slice(0, MAX_ARCHIVE);
  return sorted.map((run, i) => (i < MAX_RUNS ? run : { ...run, start: null, end: null }));
}

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
    localStorage.setItem(bestKey + RUNS_SUFFIX, JSON.stringify(trim([run, ...loadRuns(bestKey)])));
  } catch {
    // Storage full or unavailable — the run simply isn't archived.
  }
}

/**
 * 把几局并进这台设备的存档里，返回真正添进去了几局。
 *
 * 「并」不是「换」：这台设备上本来就有的一律留着（那几局还带着照片），只把
 * 它没有的补进来。从云上取回自己的战绩走的就是这条路——换了设备、清过缓存、
 * 或者从桌面图标打开（iOS 上那是另一个存储空间），本地那份就是空的，而服务
 * 器上还留着。
 */
export function mergeRuns(bestKey: string, incoming: readonly StoredRun[]): number {
  try {
    const have = loadRuns(bestKey);
    const seen = new Set(have.map(idOf));
    const add = incoming.filter((run) => run?.data && !seen.has(idOf(run)));
    if (!add.length) return 0;
    localStorage.setItem(bestKey + RUNS_SUFFIX, JSON.stringify(trim([...have, ...add])));
    return add.length;
  } catch {
    return 0;
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
