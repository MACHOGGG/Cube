/**
 * 小屋倒数用的那个「服务器现在几点」，和倒数那个数字（第 14 推）。
 *
 * ── 原先是什么样 ──────────────────────────────────────────────
 *
 * 每一份回包都重量一次：`偏差 = 回包里的 serverNow − 收到回包那一刻的本机时间`。这一句把
 * 整段往返都算成了「服务器之后才过去的时间」——回包在路上走了多久，估出来的偏差就短多
 * 久。网好的时候差几十毫秒，看不出来；一旦有一份回包走得慢（地铁里、切了一下后台），偏
 * 差一下子往回缩了几百毫秒，倒数那个数字就**往回跳**：「3 → 2 → 3 → 2」。四台手机一起
 * 数，就是这一台的数字抖了一下。
 *
 * ── 现在 ──────────────────────────────────────────────────────
 *
 *   · 一个样本 = `serverNow − (发出时刻 + 收到时刻) / 2`：服务器盖章的那一刻落在往返的
 *     正中间，误差最多是半个往返，而且往两边的机会一样。
 *   · **只留往返最短的那一个样本**：往返越短，这半个往返越小，估得越准。走得慢的回包照
 *     样拿来用它的状态，只是不拿它改钟。
 *   · 倒数那个数字**只减不增**（`countdownDigit`）：哪天估出来的钟还是往后挪了一下，屏幕
 *     上最多是这一个数多站一会儿，不会倒回去。
 *
 * 纯函数，不碰 DOM、不碰网络：门（scripts/check-clock-sync.mjs）拿模拟的回包直接喂它。
 */

/** 一份回包量出来的东西：偏差，和那一次往返用了多久。 */
export interface ClockSample {
  /** 服务器的钟减本机的钟（毫秒）。 */
  offset: number;
  /** 这一次往返（毫秒）。越短，offset 越可信。 */
  rtt: number;
}

/**
 * 一份回包 → 一个样本。
 *
 * @param stamp 回包里的 serverNow（服务器生成这份状态的那一刻）
 * @param t0 本机发出请求的那一刻
 * @param t1 本机收到并读完回包的那一刻
 */
export function clockSample(stamp: number, t0: number, t1: number): ClockSample {
  return { offset: stamp - (t0 + t1) / 2, rtt: Math.max(0, t1 - t0) };
}

/**
 * 留哪一个：往返短的那个。一样短就换新的（新的更贴近现在这一刻的两只钟）。
 *
 * 没有上一个（刚进屋）就直接收下这一个。
 */
export function keepBetter(best: ClockSample | null, next: ClockSample): ClockSample {
  return !best || next.rtt <= best.rtt ? next : best;
}

/**
 * 倒数这一拍该亮哪个数字。
 *
 * @param shown 上一拍亮着的数字（还没亮过就是 0）
 * @param raw   按现在估出来的钟算出来的秒数（向上取整）
 * @param first 这一局从几数起（头一个数字可以站得久一点，但不会比它大）
 *
 * 只减不增：raw 比上一拍还大，说明估出来的钟往回挪了——这时候照旧亮上一拍那个数字。
 */
export function countdownDigit(shown: number, raw: number, first: number): number {
  const n = Math.min(first, raw);
  return shown > 0 ? Math.min(shown, n) : n;
}
