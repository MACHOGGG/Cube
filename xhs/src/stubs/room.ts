/**
 * 多人小屋的空替身——这一版不做多人。
 *
 * 玩家定的范围里没有多人（小工具不联网，做不了；也不在这一版的清单上）。
 * 但小屋这件事在网页版是**穿在游戏壳里**的：gameShell 要问「现在在不在小屋
 * 里」才知道底下画《完成》还是《交卷》，gameController 结算时要问「要不要
 * 出竞赛排名」。删调用点等于改动那两个文件，就不是「完全复刻」了。
 *
 * 所以换成一个永远回答「不在小屋里」的替身：所有分支自动走单人那一路，
 * gameShell 和 gameController 一个字不用改，真正的 room.ts（里面有 fetch）
 * 也就不会被打进包里——小工具禁止任何网络请求，包里连 fetch( 这个词都不该
 * 出现（见 device-capabilities.md 的扫描清单）。
 *
 * avatarSvg 是纯画图，没有网络，原样搬过来。
 */
import type { RoomPlayer, RoomState } from '../../../src/engine/room';
export type { RoomPlayer, RoomState } from '../../../src/engine/room';

/** 永远不在小屋里。 */
export const currentRoom = (): null => null;
export const latestRoomState = (): RoomState | null => null;
export const iAmHost = (_state?: RoomState | null): boolean => false;

/**
 * 头像那一小张图。照 src/engine/room.ts 的 avatarSvg 抄的——它只是把两个数
 * 字画成一张圆脸，不碰网络。这一版用不到（没有小屋名单），但 roomLeftover
 * 和 roomNotices 会 import 它，留着比让打包报错省事。
 */
export function avatarSvg(_p: RoomPlayer | { avatar?: unknown } | null | undefined): string {
  return '';
}
