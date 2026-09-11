/**
 * 「有人在催屋主」这件事，怎么变成掉进标题框里的那几个图形。
 *
 * 画是 titleRain.ts 的事；这儿管两件它不管的：**节奏**（按服务器记下的每一
 * 下的时刻放，按得越密掉得越密），和**书签**（上一次掉到哪一下了）。
 *
 * 为什么要单独抽出来：屋主有两个地方会被催——坐在小屋页里，和去主菜单替大
 * 家挑玩法的时候。原先这套只写在小屋页里，于是屋主一去挑玩法，催他的球就一
 * 个也不掉；等他回到小屋，这期间攒下的几十下会一次性砸满整个框。玩家的原
 * 话：「催屋主的功能现在在选择玩法的时候不显示，全都累积在回小屋里才显示」。
 *
 * 画布和书签是分开的两件事，正是为了这个：页面重画（换屏、重新渲染主菜单）
 * 时换一块画布（attach），书签照旧往前走——书签跟着画布一起重置，就又变成
 * 「一堵墙」了。
 */
import { mountTitleRain, type TitleRain } from './titleRain';
import type { RoomState } from '../engine/room';

/** 一串催促最多摊在这么久里放完——赶在下一轮轮询把新的一串送来之前。 */
const SPREAD_MS = 950;
/** 一轮至多掉这么多个。再多也看不出个数，只会把框塞满，而标题是屋主认路用的。 */
const MAX_PER_ROUND = 40;

export interface NudgeSoak {
  /**
   * 换一块画布：传标题框那个元素就开始掉，传 null 就只记不掉。
   *
   * 客人也要 soak（书签得往前走，不然他哪天成了屋主会被补一堵墙），但客人不
   * 该看见东西掉——他不 attach 就是了。
   */
  attach(glass: HTMLElement | null): void;
  /** 这一轮轮询看到的小屋状态。新的那几下按原本的间隔放出来。 */
  soak(state: RoomState): void;
  /** 收摊。 */
  stop(): void;
}

export function createNudgeSoak(): NudgeSoak {
  let rain: TitleRain | null = null;
  let dead = false;
  /**
   * 上一次看到的催促计数。初值 −1 是「还没看过」：第一轮只记不掉。
   * 否则刚接上的这一刻，屋里从开屋到现在的每一下都会一起砸下来。
   */
  let seen = -1;
  /** 上一次已经掉过的那一下是什么时刻（服务器的钟）。 */
  let seenAt = -1;

  return {
    attach(glass) {
      if (dead) return;
      rain?.stop();
      rain = glass ? mountTitleRain(glass) : null;
    },
    soak(state) {
      if (dead) return;
      const now = state.nudges || 0;
      const stamps = state.nudgeAt ?? [];
      const newest = stamps.length ? stamps[stamps.length - 1] : 0;
      // 没有画布（客人，或者这会儿没接上）：只把书签往前挪。
      // 第一次看见也一样——记下来，不掉。
      if (!rain || seen < 0) {
        seen = now;
        seenAt = Math.max(seenAt, newest);
        return;
      }
      // 只看新的：服务器上那些时刻只增不减，记的是「这间小屋一共被催过哪几
      // 下」，而这儿要的是「刚刚又被催了哪几下」。
      const fresh = stamps.filter((t) => t > seenAt);
      // 老服务器没有时间戳：退回按数量匀开。
      const count = fresh.length ? fresh.length : Math.max(0, now - seen);
      seen = now;
      seenAt = Math.max(seenAt, newest);
      if (count <= 0) return;
      const span = fresh.length > 1 ? fresh[fresh.length - 1] - fresh[0] : 0;
      const scale = span > SPREAD_MS ? SPREAD_MS / span : 1;
      const shown = Math.min(MAX_PER_ROUND, count);
      for (let k = 0; k < shown; k++) {
        const at = fresh.length ? (fresh[k] - fresh[0]) * scale : (k * 1000) / shown;
        window.setTimeout(() => {
          if (!dead && rain) rain.drop(1);
        }, Math.round(at));
      }
    },
    stop() {
      dead = true;
      rain?.stop();
      rain = null;
    },
  };
}
