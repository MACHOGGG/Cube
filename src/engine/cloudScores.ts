import type { RunData } from './runRecord';
import { entitlement, signedInEmail } from './subscription';
import { isStoreChannel } from './channel';

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

/**
 * 榜上写哪个名字。
 *
 * **只有他自己敲进去的那一个**，没敲过就是空的（服务端把空名字那一行画成「匿名
 * 玩家」）。名字来自多人小屋里那个输入框——他已经取过一次了，没有理由再问一遍，
 * 也没有理由让同一个人在两个地方叫两个名字。
 *
 * 这个键的写入方在多人页面（ui/multiplayer.ts），它从这里取常量，所以两边
 * 不会各写各的。
 *
 * 进小屋不填名字时，服务器会发一个屋里没被占用的字母（A、B、C……），那个字母
 * 另有一个键（ui/multiplayer.ts 的 ASSIGNED_NAME_KEY），不写到这里来——它是一
 * 把椅子的编号，不是一个人的名字。两个混用过一阵：图省事进了一次小屋，从此他
 * 一个人打单人榜，名字也变成了孤零零一个「B」，还不会自己变回来。
 *
 * ── ⚠️ 这儿从前拿登录凭据当名字，那是一次泄露（#2，2026-10-02 修） ──────
 *
 * 没取名字的人，榜上印的是**他的凭据**：
 *
 *   · 免邮箱账号印第一串的前 12 位（`entitlement().handle`）。而第一串**就是那
 *     把钥匙**——api/handle.js 顶上写得很清楚：知道第一串的人凭 `reset` 就能接管
 *     这个账号。把它印在一张公开的榜上，等于把账号挂出去。
 *   · 邮箱账号印 `邮箱.split('@')[0]` 的前 12 位。那是他邮箱的前半截，而域名多半
 *     是 gmail/qq/163 那几个——拼回去不难。
 *
 * 两样都是「玩家没做任何选择、也完全不知道」的情况下被摆到公开页面上的。所以这
 * 个函数现在**只回他自己取的名字**，别的一个字都不猜。
 *
 * 服务端那一头也不信客户端（旧版本的包还在外面跑，它们照旧会报上来那种名字）：
 * `api/scores.js` 的 `leakShaped()` 认那两种形状，认出来就不存、不显示。门
 * （`check-scores`）里有一条静态断言：这个函数的函数体里不许再出现 `handle` 和
 * `signedInEmail`。
 */
export const PLAYER_NAME_KEY = 'slides_mp_name';

/**
 * 名字这件事的版本号，跟着每一局报上去（`nameV`）。
 *
 * 服务端靠它分得出「这个名字是新客户端报的」（玩家真敲过）和「旧客户端猜出来
 * 的」（可能是凭据）。见 api/scores.js 的 `leakShaped`。
 */
export const NAME_V = 2;

export function leaderboardName(): string {
  try {
    const picked = (localStorage.getItem(PLAYER_NAME_KEY) || '').trim();
    if (picked) return picked.slice(0, 12);
  } catch {
    /* 私密模式：读不到就当没取过。 */
  }
  return '';
}

/** 一次调用要带的身份。没登录就没有。 */
function auth(): { email?: string; code?: string; token: string } | null {
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
let tokenStale = false;

/** 服务器认不出这台设备了吗——《记录与排名》拿它决定要不要提示重新登录。 */
export const sessionExpired = (): boolean => tokenStale;

async function post<T>(body: Record<string, unknown>): Promise<T | null> {
  const who = auth();
  if (!who) return null;
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...who, storeClaim: isStoreChannel(), ...body }),
    });
    if (res.status === 401) {
      tokenStale = true;
      return null;
    }
    if (!res.ok) return null;
    tokenStale = false;
    return (await res.json()) as T;
  } catch {
    // 断网、超时、服务器抽风——这一局照样算完，只是没上传。
    return null;
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
}

/** 上传失败之后隔多久再试一次。 */
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
 * **失败隔两秒再试一次。** 从前失败就算了，而失败最常见的来处正是「刚打完这一局，
 * 网刚好抖了一下」——那一局于是不在榜上，而玩家点开排行榜看到的是旧名次，什么提示
 * 都没有。一次重试收掉的正是这一种（真断网的话两次都失败，和从前一样，不更坏）。
 */
export function pushRun(data: RunData, name: string): void {
  const body = {
    action: 'push',
    runId: runIdOf(data),
    mode: data.shapeId,
    score: Math.max(0, Math.round(data.totalScore || 0)),
    name,
    // 这个名字是玩家自己敲的那一个（见 leaderboardName 顶上那段）。服务端靠这一位
    // 分得出「新客户端报的」和「旧客户端从凭据猜出来的」。
    nameV: NAME_V,
    data,
  };
  // 刚打完一局，榜一定变了（至少自己那一行）。把缓存清掉，下一次打开排行榜去拿新的。
  invalidateBoards();
  lastPush = (async () => {
    const first = await post(body);
    if (first) return first;
    await new Promise((r) => setTimeout(r, PUSH_RETRY_MS));
    return post(body);
  })();
  void lastPush;
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
export const fetchMine = (): Promise<CloudMine | null> => post<CloudMine>({ action: 'mine' });

/**
 * 一张榜。mode 给了是那个玩法的单局榜，不给是累计总榜。
 *
 * 四种结果分得清清楚楚：拿到了、没权限看、登录过期了、别的原因没拿到。中间
 * 那两种各要单独说，因为它们各有各的出路——一个去订阅，一个去重新登录；混
 * 成一句「取不到」，玩家就只能一直等下去。
 */
export type BoardResult =
  | { ok: true; page: BoardPage }
  | { ok: false; reason: 'geniusOnly' | 'signedOut' | 'expired' | 'network' };

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
  const who = auth();
  if (!who) return { ok: false, reason: 'signedOut' };
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...who,
        storeClaim: isStoreChannel(),
        action: 'board',
        ...(mode ? { mode } : {}),
      }),
    });
    if (res.status === 403) return { ok: false, reason: 'geniusOnly' };
    // 令牌过期和「没订阅」是两件完全不同的事，给的出路也不同：一个是重新
    // 登录，一个是去订阅。混成一句「取不到」，玩家只会一直等下去。
    if (res.status === 401) {
      tokenStale = true;
      return { ok: false, reason: 'expired' };
    }
    if (!res.ok) return { ok: false, reason: 'network' };
    tokenStale = false;
    const page = (await res.json()) as BoardPage;
    boardCache.set(cacheKey(mode), { at: Date.now(), page });
    return { ok: true, page };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
