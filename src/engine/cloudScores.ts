import type { RunData } from './runRecord';
import { entitlement, signedInEmail } from './subscription';
import { isStoreChannel } from './channel';
import { fetchWithTimeout } from './fetchTimeout';

/**
 * 战绩存云端，以及两张全球排行榜的客户端这一头。
 *
 * 这里只做一件事：把「这一局」和「这个账号」接上。判断谁是谁、谁看得见榜，
 * 都在服务器那边（api/scores.js）——客户端说的话在这件事上不算数。
 *
 * ── 为什么是「顺手上传」而不是「同步」 ──────────────────────
 *
 * 本机的存档（engine/persistence.ts）一个字都没动，仍然是这台设备上的真相：
 * 没登录也能玩、也能翻记录，这是这个游戏一直以来的样子，不该因为加了云端
 * 就变成「不登录就没有记录」。云端是加上去的一层：登录了，这一局顺手也往上
 * 报一份；换台设备登录，把云上那份取回来和本机的合起来看。
 *
 * 所以每一个调用都是「失败就算了」。上报失败最多是这一局没上榜，不该弹一个
 * 框打断刚打完的人。
 */

/*
 * 榜上写哪个名字——**这一段整个搬去了 engine/nickname.ts**（第 16 推）。
 *
 * 从前名字是每打完一局随 push 一起报上去的（`name` + `nameV`），存在本机 `slides_mp_name`
 * 里那个就是榜上那个。现在昵称跟着帐号存在服务器上，只有改名接口写得进去（api/scores.js
 * 的 rename），push 一个字的名字都不带了。本机那一份只是缓存：`getNickname()` 读它，
 * `leaderboardName()` 就是 `getNickname()`。
 *
 * 那段「⚠️ 这儿从前拿登录凭据当名字，那是一次泄露」的历史跟着搬过去了，门（check-board-no-id
 * 的 ⑷）也改成去那边读。
 */

/**
 * 一次调用要带的身份。没登录就没有。
 *
 * 导出给 engine/nickname.ts 用（改名接口要同一份身份，而它得自己看回包的状态码——409 是
 * 「被占了」、400 是「换一个」，`post()` 把这些全并成了 null）。
 */
export function auth(): { email?: string; code?: string; token: string } | null {
  const e = entitlement();
  if (!e.token) return null;
  const email = signedInEmail();
  if (!email && !e.code) return null;
  return { ...(email ? { email } : {}), ...(e.code ? { code: e.code } : {}), token: e.token };
}

/** 登录了没有——记录页拿它决定要不要去云上取。 */
export const signedIn = (): boolean => auth() !== null;

/**
 * 服务器认不出这台设备了。
 *
 * 令牌每次登录都会换一发，服务器只认最新的那一发。换过设备、或者在别处重新
 * 登录过，这台设备手里那份就成了旧的——服务器回 401。
 *
 * 这件事必须留下痕迹。上线之后榜一直空着，查出来正是这个：八次上报，八次
 * 401，一条都没写进去；而小屋照开照玩（开小屋问的是「是不是天才」，去 Creem
 * 一查就过，根本不看令牌）。玩家那头看到的只有一张永远空着的榜，没有任何一
 * 句话告诉他「你的成绩其实没上传」。
 *
 * 所以这里记一笔，让界面能说出来。别的失败（断网、超时）不记——那些下一次
 * 就好了，不该也去催人重新登录。
 */
let staleToken: string | null = null;

/**
 * 服务器认不出这台设备了吗（10-11 方案 A-12：结算页、个人主页头卡拿它说「登录已过期」）。
 *
 * 记的是**被回了 401 的那一发令牌**，不是一个开关：他点「重新登录」换了一发新的，这里自己就回到
 * false——不用等下一次看榜或交卷成功才把它清掉（那之前头卡会一直说「登录已过期」，而他明明刚登回来）。
 */
export const sessionExpired = (): boolean => staleToken !== null && auth()?.token === staleToken;

/**
 * 一趟请求的结果，**连状态码一起**交出来（10-15 补充 L-9）：调用方要分得清「服务器明说不收」（4xx）、「我们这头
 * 出错了」（5xx）、「被限速了」（429）和「根本没到」。原先只回「拿到了 / null」：看榜被限速说成「检查一下网络」，交卷
 * 被明说拒收也照样两秒后重报一遍——重报答的还是同一句。
 *
 * `status` 0：没发出去（没登录，`error` 是 'signedOut'）或者没回来（断网、超时，`error` 是 'network'）。
 */
type Posted<T> = { ok: true; status: number; body: T } | { ok: false; status: number; error: string };

async function post<T>(body: Record<string, unknown>): Promise<Posted<T>> {
  const who = auth();
  if (!who) return { ok: false, status: 0, error: 'signedOut' };
  try {
    const res = await fetchWithTimeout('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...who, storeClaim: isStoreChannel(), ...body }),
    });
    if (res.status === 401) staleToken = who.token;
    if (!res.ok) {
      const said = (await res.json().catch(() => ({}))) as { error?: unknown };
      return { ok: false, status: res.status, error: String(said.error ?? '') };
    }
    staleToken = null;
    return { ok: true, status: res.status, body: (await res.json()) as T };
  } catch {
    // 断网、超时、服务器抽风——这一局照样算完，只是没上传。
    return { ok: false, status: 0, error: 'network' };
  }
}

/**
 * 这一局的编号。
 *
 * 服务器靠它认出「这一局我收过了」，所以它必须在同一局的两次上报里一模一样，
 * 又不能在两局之间撞上。结算时刻（毫秒）加上玩法 id 就够了：同一个人不可能
 * 在同一毫秒结束两局。
 */
export const runIdOf = (data: RunData): string => `${data.at}-${data.shapeId}-${data.modeKey}`;

/** 榜上的一行。 */
export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  me: boolean;
  /** 总榜上这一行是哪个玩法的那一局（单局榜没有这个字段）。 */
  mode?: string;
  /**
   * 步步为营**清盘**的那一局还剩几步（第 14 推，api/scores.js 的 decodeBoard）。只有清盘的
   * 局才有；同分的两局，剩得多的排在前面。
   */
  left?: number;
}

export interface BoardPage {
  mode: string;
  rows: BoardRow[];
  /** 这张榜上一共多少人。 */
  players: number;
  /** 我自己的名次。没打过这个玩法就是 null——不是第一名。 */
  me: { rank: number; score: number } | null;
}

/** 云上这个账号的样子。 */
export interface CloudMine {
  total: number;
  runs: number;
  best: Record<string, number>;
  archive: { runId: string; mode: string; score: number; at: number; data: RunData | null }[];
  /**
   * 这个帐号登记的昵称（第 16 推）。空串 = 还没登记。拿到之后盖掉本机那一份（engine/
   * nickname.ts 的 adoptServerNickname）。旧服务器不回这一位，读出来是 undefined。
   */
  nickname?: string;
}

/** 上传失败之后隔多久再试一次（只对「下一次可能就好了」的那几种，见 pushRun）。 */
const PUSH_RETRY_MS = 2000;
/** 打开排行榜之前最多等上传多久。 */
const PUSH_WAIT_MS = 2000;

/**
 * 最近那一趟上报。`waitForPush()` 等的就是它。
 *
 * 只留最近一趟：上一局的那一趟早就落地了（或者早就失败了），而「打开排行榜前等一
 * 下」要等的永远是**刚打完这一局**。
 */
let lastPush: Promise<unknown> | null = null;

/**
 * 打完一局，顺手报一份上去。
 *
 * 不 await：结算页已经在屏幕上了，玩家在看自己的分数，没有理由让他等一个
 * 网络请求。
 *
 * **失败隔两秒再试一次——只对「下一次可能就好了」的那几种**：断网、超时（status 0）、5xx、429。失败最常见
 * 的来处正是「刚打完这一局，网刚好抖了一下」，一次重试收掉的正是这一种。
 *
 * **服务器明说不收的，不重报**（10-15 补充 L-9）：4xx（401、429 除外）重报一次答的还是同一句——原先 400 mismatch
 * 隔 2041ms 又报一次、401 隔 2103ms 又报一次。现在：401 交回 null（令牌已经记成过期，结算页据此说「登录已过期」）；
 * 别的 4xx 交回 refused，结算页说「本局未上传」（implausible 那一句是 10-15 补充 S3 先做的）。没登录时一趟都不发，
 * 也不让看榜那边白等两秒。
 */
/**
 * 交卷回包里调用方关心的那一样：每日挑战那一局进没进「今日」榜（api/scores.js 的 pushDaily，回
 * 一个词：stored / late / rejected / zero / stale）。不是每日挑战的局没有这一位；没登录、没报上去是 null。
 * zero 是 0 分的局（10-11 方案 B-13 第 10 条：0 分不上榜）——日子、种子、玩法都对，只是不写榜；stale 是步步为营
 * 那一天交了一局旧规则的（10-15 补充 S9：今日榜只收现行规则）。结算页只为 late / rejected 说话，zero、stale 什么都不说。
 */
export interface PushReply {
  daily?: 'stored' | 'late' | 'rejected' | 'zero' | 'stale';
  /**
   * 服务器明说这一局不收：结算页说「本局未上传」。'implausible' 是对过账、对不上（400 implausible，10-15 补充 S3）；
   * 'rejected' 是别的 4xx（401、429 除外——一个是登录过期、一个是等一下再来，10-15 补充 L-9）。
   */
  refused?: 'implausible' | 'rejected';
}

export function pushRun(data: RunData): Promise<PushReply | null> {
  // **不带名字**（第 16 推）。从前这里带着 `name` 和 `nameV`，于是哪台设备最后交卷，榜上
  // 就是哪台设备上存的那个名字——在这台手机上改了名，换台平板打一局就又变回去了。昵称现在
  // 只走改名接口（engine/nickname.ts 的 setNickname），服务器也不再读 push 里的名字。
  const body = {
    action: 'push',
    runId: runIdOf(data),
    mode: data.shapeId,
    score: Math.max(0, Math.round(data.totalScore || 0)),
    data,
  };
  // 刚打完一局，榜一定变了（至少自己那一行）。把缓存清掉，下一次打开排行榜去拿新的。
  invalidateBoards();
  /** 这一趟的结局：拿到了、明说不收、登录过期 / 没登录，或者「再试一次可能就好了」（undefined）。 */
  const settle = (r: Posted<PushReply>): PushReply | null | undefined => {
    if (r.ok) return r.body;
    // 服务器对过账、明说这一局不收（api/scores.js 的 push 回 400 `implausible`，10-11 方案 A-3）：交回 refused，结算页
    // 说一句「本局未上传」（10-15 补充 S3；原先一个字都不说）。
    if (r.error === 'implausible') return { refused: 'implausible' };
    if (r.status === 0 && r.error === 'signedOut') return null;
    if (r.status === 401) return null;
    if (r.status >= 400 && r.status < 500 && r.status !== 429) return { refused: 'rejected' };
    return undefined;
  };
  const pushing = (async (): Promise<PushReply | null> => {
    const first = settle(await post<PushReply>(body));
    if (first !== undefined) return first;
    await new Promise((r) => setTimeout(r, PUSH_RETRY_MS));
    return settle(await post<PushReply>(body)) ?? null;
  })();
  lastPush = pushing;
  // 交回去给结算页（2026-10-08 方案 2-11）：每日挑战那一局被拒、交晚了，要当场说一句。
  return pushing;
}

/**
 * 等最近那一趟上报落地，最多等 `ms` 毫秒。
 *
 * 打开排行榜之前叫一次。不等的话玩家刚打破自己的记录、点开榜一看还是旧名次——而那
 * 一趟上报多半就在半秒之内落地。等不到也照旧往下走：榜本身比「榜上有没有这一局」
 * 要紧，而他下次打开就对了。
 */
export async function waitForPush(ms = PUSH_WAIT_MS): Promise<void> {
  const pending = lastPush;
  if (!pending) return;
  await Promise.race([pending, new Promise((r) => setTimeout(r, ms))]);
}

/** 云上那份存档。没登录、或者取不到，就是 null。 */
export const fetchMine = async (): Promise<CloudMine | null> => {
  const r = await post<CloudMine>({ action: 'mine' });
  return r.ok ? r.body : null;
};

/**
 * 一张榜。mode 给了是那个玩法的单局榜，不给是累计总榜。
 *
 * 几种结果分得清清楚楚：拿到了、没权限看、登录过期了、看得太勤被限速了、服务器那头出错、网没通。没权限和过期
 * 各要单独说，因为它们各有各的出路——一个去订阅，一个去重新登录；混成一句「取不到」，玩家就只能一直等下去。
 * 限速（429，tooMany）也单说（10-15 补充 L-9）：原先它并进「网络」那一类，屏幕上写「检查一下网络」，而看榜是
 * 按帐号限速的（api/scores.js 每分钟 60 次），他的网好好的。
 */
export type BoardResult =
  | { ok: true; page: BoardPage }
  | { ok: false; reason: 'geniusOnly' | 'signedOut' | 'expired' | 'tooMany' | 'unavailable' | 'network' };

/**
 * 每张榜在内存里存十秒。
 *
 * ── 它解决的是哪个毛病 ──────────────────────────────────────
 *
 * 排行榜那一屏有七个母标签、再加旗下一堆子标签，玩家来回点着看。从前每点一下都把列表
 * 清成一句「加载中」再等一个网络往返——两三下之后那一屏看着就是在闪。而两秒前刚看过的
 * 那张榜，这两秒里几乎不可能变。
 *
 * 十秒：短到「榜是活的」这句话还成立（别人刚上榜，十秒内就看得到），长到来回点不闪。
 *
 * **只在内存里**，不进 localStorage：一张榜是别人的东西，留到下次打开网页就成了「他看
 * 到的是上周的名次」。关掉标签页它就没了，这是对的。
 *
 * 打完一局会把整张表清掉（见 pushRun）：那一刻自己那一行一定变了。
 */
const BOARD_TTL_MS = 10_000;
const boardCache = new Map<string, { at: number; page: BoardPage }>();
const cacheKey = (mode?: string) => mode ?? '';

/** 这张榜手上有没有一份还新鲜的。有就先把它画出来，别让屏幕空着。 */
export function cachedBoard(mode?: string): BoardPage | null {
  const hit = boardCache.get(cacheKey(mode));
  if (!hit) return null;
  if (Date.now() - hit.at > BOARD_TTL_MS) {
    boardCache.delete(cacheKey(mode));
    return null;
  }
  return hit.page;
}

/** 整张表作废。打完一局叫一次（pushRun），别的地方不该叫。 */
export function invalidateBoards(): void {
  boardCache.clear();
}

export async function fetchBoard(mode?: string): Promise<BoardResult> {
  const r = await post<BoardPage>({ action: 'board', ...(mode ? { mode } : {}) });
  if (r.ok) {
    boardCache.set(cacheKey(mode), { at: Date.now(), page: r.body });
    return { ok: true, page: r.body };
  }
  if (r.status === 0) return { ok: false, reason: r.error === 'signedOut' ? 'signedOut' : 'network' };
  // 令牌过期和「没订阅」是两件完全不同的事，给的出路也不同：一个是重新
  // 登录，一个是去订阅。混成一句「取不到」，玩家只会一直等下去。
  if (r.status === 401) return { ok: false, reason: 'expired' };
  if (r.status === 403) return { ok: false, reason: 'geniusOnly' };
  if (r.status === 429) return { ok: false, reason: 'tooMany' };
  // 别的 4xx、5xx 都是我们这头的事，说「服务器忙」，不说「检查一下网络」（10-09 补充方案 7-13 第 3 条；原先 4xx
  // 并进了「网络」那一类）。
  return { ok: false, reason: 'unavailable' };
}
