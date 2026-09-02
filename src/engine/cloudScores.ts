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

async function post<T>(body: Record<string, unknown>): Promise<T | null> {
  const who = auth();
  if (!who) return null;
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...who, storeClaim: isStoreChannel(), ...body }),
    });
    if (!res.ok) return null;
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
 * 三种结果分得清清楚楚：拿到了、没权限看、别的原因没拿到。中间那种要单独
 * 说，因为它是唯一一种「你去订阅就看得到」的失败。
 */
export type BoardResult =
  | { ok: true; page: BoardPage }
  | { ok: false; reason: 'geniusOnly' | 'signedOut' | 'network' };

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
    if (!res.ok) return { ok: false, reason: 'network' };
    return { ok: true, page: (await res.json()) as BoardPage };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
