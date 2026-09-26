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
 * 把存错了键的局挪回它该在的那个键下。
 *
 * 为什么会存错：棋盘存新局时手写着旧版本的后缀，而读的那一头跟着版本常量走
 * （见 engine/runKey.ts 开头那段）。于是那段时间里打的炸弹局和无限反转局，全都
 * 落进了**上一版规则的归档**里——记录页只摆现行那张榜，所以它们既不在记录页上
 * 出现，也没被算进累计得分。没登录的玩家这些局只存在本机，不挪就永远找不回来。
 *
 * 分得清是因为每一局自己带着规则版本号（RunData 的 bombRules / flipRules），而
 * persistence 从来只剥快照、不删局，所以挪得准也挪得全。
 *
 * **只往上抬，不往下削**：
 *   · 新键的「本机最佳」取「它本来的」和「挪过来这几局里最高的」中的大者；
 *   · **旧键的那个数一个字不动**。它可能被一局新规则的分顶高过，但旧键此刻已经
 *     是纯归档（记录页那张表里没有它），一个偏高的归档数字只是不好看；而按剩下
 *     的局重算就可能把一条真纪录抹掉——存档只留最近 40 局，更早的那条纪录的局
 *     早就被收走了，重算出来的数比它低。两害相权，不动。
 *
 * 返回挪了几局，给调用方打一行日志用；异常一概吞掉——迁移失败只是这些局继续躺在
 * 旧键下，不该连带把开机拦住。
 */
export function moveRuns(from: string, to: string, belongs: (run: StoredRun) => boolean): number {
  try {
    const stay: StoredRun[] = [];
    const move: StoredRun[] = [];
    for (const run of loadRuns(from)) {
      (run?.data && belongs(run) ? move : stay).push(run);
    }
    if (!move.length) return 0;
    const added = mergeRuns(to, move);
    // 新键的最佳跟着抬上去。挪过来的局里最高的那个分，本该一直是它的最佳。
    const top = move.reduce((m, r) => Math.max(m, r.data?.totalScore || 0), 0);
    if (top > 0) saveBestIfHigher(to, top);
    localStorage.setItem(from + RUNS_SUFFIX, JSON.stringify(trim(stay)));
    return added;
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
