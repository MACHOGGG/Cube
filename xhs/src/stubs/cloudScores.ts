/**
 * 云端榜单的空替身——这一版没有排行榜。
 *
 * 小工具不联网，全球排行榜做不了；玩家定的替代品是**本机游玩历史**
 * （见 xhs/src/records.ts，存在 localStorage 里）。战绩本身照旧由网页版的
 * persistence.ts 存下来，那一半是本地的，原样能用。
 *
 * 这里把「往云上报 / 从云上取」全部变成什么都不做、什么都没有：
 *   · signedIn() 永远 false —— 界面上一切「登录之后才……」的分支自动走
 *     「没登录」那一路，不用去改调用点。
 *   · pushRun() 空转 —— 结算照常，只是不上传。
 *   · fetchMine / fetchBoard 永远给 null / signedOut。
 */
import type { RunData } from '../../../src/engine/persistence';

export const PLAYER_NAME_KEY = 'slides_mp_name';

/** 战绩图上写的名字。没有云端账号，就读本机存的那个昵称。 */
export function leaderboardName(): string {
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY) || '').trim().slice(0, 12);
  } catch {
    return '';
  }
}

export const signedIn = (): boolean => false;
export const sessionExpired = (): boolean => false;
export const runIdOf = (data: RunData): string => `${data.at}-${data.shapeId}-${data.modeKey}`;

export interface BoardRow { rank: number; name: string; score: number; me?: boolean; shapeId?: string; modeKey?: string }
export interface BoardPage { rows: BoardRow[]; mine?: BoardRow | null }
export interface CloudMine { runs: RunData[]; total: number }
export type BoardResult =
  | { ok: true; page: BoardPage }
  | { ok: false; reason: 'signedOut' | 'geniusOnly' | 'expired' | 'network' };

export function pushRun(_data: RunData, _name: string): void {}
export const fetchMine = (): Promise<CloudMine | null> => Promise.resolve(null);
export const fetchBoard = (_mode?: string): Promise<BoardResult> =>
  Promise.resolve({ ok: false, reason: 'signedOut' as const });
