/**
 * 「这台机器跑得动吗」——量出来的，不是问出来的。
 *
 * 和它旁边那个 reducedMotion.ts 是两件事，别混：
 *
 *   · reducedMotion() 读的是 `prefers-reduced-motion`，那是**系统设置**——玩家
 *     要到 iOS / 安卓的「辅助功能」里去开，绝大多数人一辈子不会碰它。它关掉
 *     的是「要不要动画」这个意愿问题。
 *   · 这个文件量的是**这台机器这一刻的帧时**，和意愿无关。老安卓、发烫降频、
 *     后台一堆东西——玩家没做任何设置，画面就是卡了。
 *
 * 降的只有两样，都是三个特效里最贵的那两个（见 juice.ts）：
 *   · spawnParticles 的粒子数减半——每颗都是一个真的 div，进排版、进合成；
 *   · screenShake 只允许 light——medium / heavy 那两档抖得更狠，重绘面积
 *     也更大。
 * 顿帧、落位、翻面、音效一概不动：它们要么不花钱，要么是玩法本身的一部分。
 * **full 档下这个文件等于不存在**，一行行为都不改。
 *
 * 几条把「误判」挡在外面的规矩，每一条都有具体的怕：
 *
 *   · **开头 WARMUP 帧不算。** 一局刚开的头几帧在建 DOM、量地板、跑 4-3-2-1，
 *     必然慢。拿它当证据，人人都会被降档。
 *   · **比 OUTLIER_MS 还长的那一帧不算。** 切到后台、锁屏、系统弹窗——那不是
 *     一帧慢，那是根本没在画。算进去一次就能把整扇窗的均值拖垮。
 *   · **要连续 WINDOW 帧的均值都超标。** 单帧毛刺（一次垃圾回收、一次图片解
 *     码）不该改全局的档位。
 *   · **只降不升。** 升回去意味着「快了→特效变多→又慢了→再降」的来回跳，玩
 *     家看到的是特效忽有忽无。降过一次就不再量了（rAF 直接停掉，连采样本身
 *     的开销也省了）。
 *
 * 只在一局游戏进行中采样（gameController 开局挂上、destroy 摘掉）：主菜单和
 * 各种页面的帧时说明不了棋盘跑不跑得动，而挂一条永远在转的 rAF 会让手机没法
 * 休眠。
 */

export type MotionTier = 'full' | 'lite';

/** 超过这个帧时就算「跑不动」。22ms ≈ 45fps——60 掉到 45 已经看得出来了。 */
const SLOW_MS = 22;
/** 要连续这么多帧的均值都超标（60fps 下大约两秒）。 */
const WINDOW = 120;
/** 开头这些帧不算数（开局那阵子必然慢）。 */
const WARMUP = 30;
/** 比这更长的不是「一帧慢」，是页面压根没在画——切后台、锁屏。 */
const OUTLIER_MS = 250;

let tier: MotionTier = 'full';
let watchers = 0;
let raf = 0;
let last = 0;
let seen = 0;
let sum = 0;
let counted = 0;

/** 现在是哪一档。同步的，可以在渲染里直接调。 */
export function motionTier(): MotionTier {
  return tier;
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function tick(now: number): void {
  raf = requestAnimationFrame(tick);
  const dt = last ? now - last : 0;
  last = now;
  // 第一帧没有「上一帧」；被挂起的那一帧也不是一帧。
  if (dt <= 0 || dt > OUTLIER_MS) return;
  if (++seen <= WARMUP) return;
  sum += dt;
  counted++;
  if (counted < WINDOW) return;
  if (sum / counted > SLOW_MS) {
    tier = 'lite';
    stop(); // 只降不升，量到了就没什么可量的了
    return;
  }
  sum = 0;
  counted = 0;
}

/**
 * 开始采样。返回「停手」——同一时刻可能有不止一处在看（小屋里练习盘和正式
 * 局会短暂重叠），所以按引用计数，最后一个走的那个才真的停。
 */
export function watchFrames(): () => void {
  if (tier === 'lite') return () => {};
  if (typeof requestAnimationFrame !== 'function') return () => {};
  watchers++;
  if (watchers === 1) {
    last = 0;
    seen = 0;
    sum = 0;
    counted = 0;
    raf = requestAnimationFrame(tick);
  }
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    watchers = Math.max(0, watchers - 1);
    if (watchers === 0) stop();
  };
}

/** 只给门用：回到出厂状态，好在一个进程里量好几种帧时。 */
export function resetFrameTier(): void {
  stop();
  tier = 'full';
  watchers = 0;
  last = 0;
  seen = 0;
  sum = 0;
  counted = 0;
}
