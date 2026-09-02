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
 * 就是玩家在多人小屋里给自己取的那个——他已经取过一次了，没有理由再问一遍，
 * 也没有理由让同一个人在两个地方叫两个名字。没取过就用邮箱 @ 前面那一截，
 * 总比一行空白强。
 *
 * 这个键的写入方在多人页面（ui/multiplayer.ts），它从这里取常量，所以两边
 * 不会各写各的。
 */
export const PLAYER_NAME_KEY = 'slides_mp_name';

export function leaderboardName(): string {
  try {
    const picked = (localStorage.getItem(PLAYER_NAME_KEY) || '').trim();
    if (picked) return picked.slice(0, 12);
  } catch {
    /* 私密模式：往下走，用邮箱那一截。 */
  }
  return (signedInEmail() || '').split('@')[0].slice(0, 12);
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

/**
 * 打完一局，顺手报一份上去。
 *
 * 不 await：结算页已经在屏幕上了，玩家在看自己的分数，没有理由让他等一个
 * 网络请求。失败就是没上传，下一局照旧。
 */
export function pushRun(data: RunData, name: string): void {
  void post({
    action: 'push',
    runId: runIdOf(data),
    mode: data.shapeId,
    score: Math.max(0, Math.round(data.totalScore || 0)),
    name,
    data,
  });
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
    return { ok: true, page: (await res.json()) as BoardPage };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
