import type { BoardSnapshot } from './shareCard';
import type { RunData } from './runRecord';

/**
 * 这一档的本机最佳。
 *
 * 和这个文件里别的每一个函数一样包着 try/catch——从前这两个是**仅有的两个裸调**
 * localStorage 的。它们看着无害，可唯一的生产调用点在 `gameController` 的 `endGame`
 * 里（`saveBestIfHigher(hooks.bestKey, total)`），而且在 `lastRun` 赋值**之前**：无痕
 * 模式、站点数据被禁、配额满——任何一种让 localStorage 抛的情形，都会把 `endGame` 从
 * 中间打断。症状不是白屏，是**最后一下之后界面停在棋盘上，结算页永远不弹出来**。
 */
export function loadBest(key: string): number {
  try {
    return parseInt(localStorage.getItem(key) || '0', 10) || 0;
  } catch {
    // 读不到就当还没有纪录。这一局照样结算，只是不显示「本机最佳」。
    return 0;
  }
}

/** Saves score under key if it beats the stored best, returning the (possibly unchanged) best. */
export function saveBestIfHigher(key: string, score: number): number {
  const best = Math.max(score, loadBest(key));
  try {
    localStorage.setItem(key, String(best));
  } catch {
    // 存不进去就下次再说——绝不能因此把这一局的结算页拦下来。
  }
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
 * 把一个存档键连同它的归档一起删掉，回报「本来有没有东西」。
 *
 * 换一版计分规则时要用（《侵蚀阶梯》v1.2 §6 的一次性清档）：旧尺子量出来的分不能
 * 和新的混在一起比，所以旧键整个抹掉，而不是留在那儿等人翻出来。
 */
/**
 * 换规则那一次性清档的哨兵键，和「这台设备真的被清过东西没有」。
 *
 * 两种值分得开：`'1'` 是「跑过了，本来就没东西可清」（新装的设备走这条），
 * `'wiped'` 是「真清掉过存档」。记录页只在后一种情况下说那句「战绩从这里重新开
 * 始」——对一台从没打过的新设备说这句话，是一句没头没脑的话，属于「意料之外的
 * 界面」。
 */
export const wipeKeyFor = (version: string): string => 'slides_wipe_' + version;

export function markWiped(version: string, dropped: number): void {
  try {
    localStorage.setItem(wipeKeyFor(version), dropped > 0 ? 'wiped' : '1');
  } catch {
    /* 无痕模式：这一次会重跑一遍清档，清的还是那几个不存在的键，没有副作用 */
  }
}

/** 这台设备在换到这一版规则时真的被清掉过存档。 */
export function wasWiped(version: string): boolean {
  try {
    return localStorage.getItem(wipeKeyFor(version)) === 'wiped';
  } catch {
    return false;
  }
}

export function dropKey(bestKey: string): boolean {
  try {
    const had =
      localStorage.getItem(bestKey) !== null ||
      localStorage.getItem(bestKey + RUNS_SUFFIX) !== null ||
      localStorage.getItem(bestKey + EVICTED_SUFFIX) !== null ||
      localStorage.getItem(bestKey + EVICTED_AT_SUFFIX) !== null;
    localStorage.removeItem(bestKey);
    localStorage.removeItem(bestKey + RUNS_SUFFIX);
    // 被挤出去那些局的分也要一起清掉（见 EVICTED_SUFFIX）。漏了它，换规则版本清档之
    // 后累计得分还挂着一笔上一版的分——而记录页上一局都看不到，那个数于是无从对账。
    localStorage.removeItem(bestKey + EVICTED_SUFFIX);
    // 水位线一起清（10-09 补充方案 7-2）：留着它，清档之后头几局被挤出去时会被当成「早就记过了」。
    localStorage.removeItem(bestKey + EVICTED_AT_SUFFIX);
    return had;
  } catch {
    // 无痕模式之类：删不掉就当没有，不该连带把开机拦住。
    return false;
  }
}
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

/**
 * 被挤出存档的那些局，分数累加在这儿（一个玩法一笔）。
 *
 * ── 它补的是哪个洞 ──────────────────────────────────────────────
 *
 * 累计得分是**存档这张清单的总和**（recordsPage 的 `totalScoreOf(runs)`），而存档只留
 * 最近 MAX_ARCHIVE（40）局。于是打到第 41 局那一下，最早那一局被挤出去，而他的累计得
 * 分**当场往下掉**——掉的正好是那一局的分。屏幕上不报错，只是那个数变小了，而玩家一直
 * 盯着它：这是「意料之外」里最伤的一种，因为它看起来像我们把他的成绩弄丢了。
 *
 * 所以挤出去之前先把分记在一笔总账上，读的时候加回去。记的是**一个数**，不是那些局：
 * 存档收起来的本来就是「那一局长什么样」（照片、明细），而这笔账要答的只有一句「一共
 * 多少分」。
 *
 * ⚠️ 这笔账只加不减，账上只有一个数。所以它只能由 `trimInto` 一处写——那是唯一「真的
 * 挤掉了一局」的地方。从别处（比如 mergeRuns 发现本机已有这一局）去加，就会把同一局算
 * 两遍，而算两遍之后再也拆不开。同一局被挤出去两次（从云上并回来、又被挤出去）靠下面那条
 * 水位线挡。
 */
const EVICTED_SUFFIX = '::evicted';

/**
 * 那一笔账的水位线：已经记进账的那几局里，最新的那一局的 `at`（10-09 补充方案 7-2，审计 #2）。
 *
 * ── 它补的是哪个洞 ──────────────────────────────────────────────
 *
 * 审计实测累计得分越刷越高：500 → 600 → 700 → 800。云上留 60 局，本机只留 40 局；每次从云上
 * 并战绩（mergeRuns），云上那 60 局里比本机清单旧的那 20 局，本机清单里都找不到，于是当成新
 * 的补进来、随即又被 trimInto 挤出去——挤出去一次就记一笔。账上只有一个数，同一局每并一次就
 * 多算一遍，而玩家每开一次网页就并一次。
 *
 * 被挤出去的永远是最旧的那几局，所以记过的局都不比水位线新：只给比水位线新的局记账，记完把
 * 水位线推到它们里最新的那一局。
 *
 * 不采用「只给本机原有的局记账」：一台新设备从云上拉 60 局，本机一局都没有，那 20 局就一分都
 * 不算了。代价是另一头：比水位线还旧、这台设备从来没见过的局（另一台设备更早打的）并进来时不
 * 记账——已经虚涨的旧数也修不回来（账本只是一个数），玩家选了不升版本（7-4），就此保留。
 */
const EVICTED_AT_SUFFIX = '::evictedAt';

/**
 * 这个玩法此刻的水位线。`have` 是这一次收之前本机清单上的那几局。
 *
 * 水位线是 7-2 才有的。在那之前就记过账的设备，账上有数、却没有水位线——照 0 算的话，上线之后头
 * 一次从云上并战绩，那 20 局会被**再记一遍**。比本机清单里最旧那一局还旧的局，从前都已经被挤出去、
 * 记过账了（trim 留的永远是最新的那几局），所以这种设备的水位线从那一局的前一格起。账上没数的
 * （新设备、还没挤掉过一局）从 0 起：被挤掉的局一局都还没记过。
 */
function evictedMark(bestKey: string, have: readonly StoredRun[]): number {
  try {
    const raw = localStorage.getItem(bestKey + EVICTED_AT_SUFFIX);
    if (raw !== null) return parseInt(raw, 10) || 0;
    if (localStorage.getItem(bestKey + EVICTED_SUFFIX) === null) return 0;
    let oldest = Infinity;
    for (const run of have) if (Number.isFinite(run?.at) && run.at < oldest) oldest = run.at;
    return Number.isFinite(oldest) ? oldest - 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * 收一收，并把**真的被挤出去的那几局**的分记进那一笔总账。
 *
 * 为什么按 id 比而不是按长度减：`trim` 还会把第 11 局之后的照片剥掉（`start/end` 置
 * null），所以「收之前有几局、收之后有几局」这个差值不等于「谁被挤掉了」。按编号比一
 * 遍，谁不在了才算挤掉。
 *
 * 挤掉的局只有比水位线 `mark` 新的才记账（见 EVICTED_AT_SUFFIX），记完水位线跟着往前推。
 */
function trimInto(bestKey: string, list: StoredRun[], mark: number): StoredRun[] {
  const kept = trim(list);
  const alive = new Set(kept.map(idOf));
  let lost = 0;
  let newest = mark;
  for (const run of list) {
    if (!run?.data || alive.has(idOf(run))) continue;
    // 水位线以内的局早就记过了：从云上并回来、又被挤出去，不再记第二遍（审计 #2 那个越刷越高）。
    if (!(run.at > mark)) continue;
    lost += run.data.totalScore || 0;
    newest = Math.max(newest, run.at);
  }
  if (lost > 0) {
    try {
      const was = parseInt(localStorage.getItem(bestKey + EVICTED_SUFFIX) || '0', 10) || 0;
      localStorage.setItem(bestKey + EVICTED_SUFFIX, String(was + lost));
      localStorage.setItem(bestKey + EVICTED_AT_SUFFIX, String(newest));
    } catch {
      // 存不进去就只好少这一笔——这一局的结算照旧，不能因此被打断（见文件头那段）。
    }
  }
  return kept;
}

/** 这几个玩法被挤出存档的局，一共多少分。累计得分要把它加回去。 */
export function evictedScoreOf(bestKeys: readonly string[]): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const key of bestKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      sum += parseInt(localStorage.getItem(key + EVICTED_SUFFIX) || '0', 10) || 0;
    } catch {
      // 读不到就当没有。
    }
  }
  return sum;
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
    const have = loadRuns(bestKey);
    localStorage.setItem(bestKey + RUNS_SUFFIX, JSON.stringify(trimInto(bestKey, [run, ...have], evictedMark(bestKey, have))));
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
    localStorage.setItem(bestKey + RUNS_SUFFIX, JSON.stringify(trimInto(bestKey, [...have, ...add], evictedMark(bestKey, have))));
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
    // 旧键这一头**不记账**：`stay` 里一局都没被挤掉（挪走的那些是 `move`），
    // 而 trimInto 按「谁不在了」算，会把挪走的那几局当成挤掉的记上去——它们已经在新键
    // 下好好地躺着，再记一笔就是把同一局算两遍。
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
