/**
 * 昵称的空替身（第 16 推）——这一版没有帐号，也就没有昵称。
 *
 * 真身（src/engine/nickname.ts）的改名要打 `/api/scores`，而小工具禁止任何网络请求（包里连
 * `fetch(` 这个词都不该出现，见 xhs/build.mjs 的禁用能力扫描）。这一版也根本走不到改名那一
 * 步：没有登录，没有个人主页头卡，没有小屋。所以：
 *
 *   · `getNickname()` / `leaderboardName()` 照旧读本机那个键（和真身一样，纯 localStorage）；
 *   · 改名、取服务器那一份，全是「什么都不做」。
 *
 * 签名和真身一模一样——替身存在的全部意义就在这儿（见 cloudScores.ts 替身顶上那段）。
 */
import type { Lang } from '../../../src/i18n';

export const PLAYER_NAME_KEY = 'slides_mp_name';
export const NICK_MAX = 12;

export type NicknameError =
  | 'taken'
  | 'blocked'
  | 'bad'
  | 'required'
  | 'tooMany'
  | 'signedOut'
  | 'network';
export type NicknameResult = { ok: true; name: string } | { ok: false; reason: NicknameError };

export function getNickname(): string {
  try {
    const raw = (localStorage.getItem(PLAYER_NAME_KEY) || '').trim();
    return Array.from(raw).slice(0, NICK_MAX).join('');
  } catch {
    return '';
  }
}
export const leaderboardName = (): string => getNickname();
export const confirmedNickname = (): string => getNickname();
export const onNicknameChange = (_fn: () => void): (() => void) => () => {};
export const setNickname = (_raw: string): Promise<NicknameResult> =>
  Promise.resolve({ ok: false, reason: 'signedOut' });
export const adoptServerNickname = (_serverName: unknown): Promise<void> => Promise.resolve();
export const nicknameErrorText = (_reason: NicknameError, _lang: Lang): string => '';
