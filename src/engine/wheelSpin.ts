/**
 * 桌面端滚轮归一化：把 `wheel` 事件变成一条统一的角速度曲线。
 *
 * 出处是《玩法选择器「物理化聚焦」改造》§3.3。要解决的是一个浏览器层面的既有
 * 限制：物理鼠标每拨一格发一个**固定大小、不衰减**的信号，抬手即停；触控板在
 * 手指还贴着时发连续小信号，**手指抬起后系统还会按指数衰减补发一串**。Web 平
 * 台没有官方手段区分这两者（W3C UI Events issue #337、Chromium issue
 * 40704952）。直接把 `deltaY` 当转动增量的后果是：鼠标用户觉得转盘「一格一格
 * 地跳」，触控板用户觉得「顺滑地滑行」——同一个产品两种手感。
 *
 * 所以这里不把 delta 当位移，而是当**冲量**：加到角速度上，角度由角速度按帧积
 * 分出来，角速度自己按摩擦逐帧衰减到零。两种设备最后都是「转一下，然后按同一
 * 条规律停下来」。
 *
 * 两种设备最后的一致性体现在**每像素走多远是同一个常数**：鼠标一格 100px 走
 * 0.93 项，触控板一次甩动累计 1410px 走 13.04 项——折算到每百像素分别是 0.930
 * 和 0.925，差 1%。换句话说玩家手上出多少力就转多少，设备不影响换算率，两边只
 * 是「出力的方式」不同。门（check-fisheye）盯的就是这个比值。
 *
 * **规格没提、但补了的一条：速度上限。** 它挡的不是触控板的尾巴（那串信号的总
 * 量本来就该转那么多），而是**单次畸形事件**——有些鼠标驱动和「平滑滚动」插件
 * 会在一个事件里发出上千像素的 delta，不封顶的话一下就是几十项，转盘当场失控。
 * 封顶把瞬时速度按住在 24 项/秒（自由滑行约 4.7 项）。
 * （第一版这段注释写的是「不封顶触控板会飞过十几项」——错的：封了顶也是 13
 * 项，因为手指还贴着的时候冲量一直在进来，封速度封不住总行程。是门的负面测试
 * 把这句话揪出来的。）
 *
 * 单位说明：这里的「角速度」单位是**项/秒**，`rotation` 就是鱼眼的焦点
 * （fisheye.ts 的距离也按项算，两边对得上）。要换成度，乘一圈的度数除以项数。
 */

/** `deltaMode = 1`（行）时一行折算多少像素。Firefox 走这一路。 */
export const WHEEL_LINE_PX = 16;
/** `deltaMode = 2`（页）时一页折算多少像素。 */
export const WHEEL_PAGE_PX = 400;

/**
 * 一格鼠标滚轮折算成多少项。
 *
 * Chrome 一格 `deltaY` 约 100px。自由衰减走过的总距离是 `v / ln(1/FRICTION)`
 * ＝ `v / 5.116`，所以要让「一格 ≈ 一项」，冲量系数取 5.116/100 ≈ 0.05。
 */
export const IMPULSE_PER_PX = 0.05;
/** 每秒剩下多少速度。0.006 → 甩一下大约 0.6 秒停住。 */
export const FRICTION = 0.006;
/** 项/秒。见文件头：挡的是单次畸形 delta，不是触控板的尾巴。 */
export const MAX_VELOCITY = 24;
/** 低于这个速度就算停了，可以进定格（§3.4）。 */
export const STOP_BELOW = 0.02;

const MAX_DT_MS = 64;

export interface SpinState {
  /** 累计转动量，单位＝项。**内部永不取模**（§3.1：只在渲染取坐标那一步取模）。 */
  rotation: number;
  /** 项/秒。 */
  velocity: number;
}

export function createSpin(rotation = 0): SpinState {
  return { rotation, velocity: 0 };
}

/** 把 `wheel` 事件的 delta 折算成像素。 */
export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_PAGE_PX;
  return delta;
}

/** 取主轴那一路（斜着滚的时候不要两轴相加，会比单轴滚得快一倍）。 */
export function wheelPixels(e: { deltaX: number; deltaY: number; deltaMode: number }): number {
  const x = normalizeWheelDelta(e.deltaX, e.deltaMode);
  const y = normalizeWheelDelta(e.deltaY, e.deltaMode);
  return Math.abs(x) > Math.abs(y) ? x : y;
}

/** 一次冲量：加到速度上，**不是**直接加到角度上。 */
export function spinImpulse(s: SpinState, pixels: number): void {
  const v = s.velocity + pixels * IMPULSE_PER_PX;
  s.velocity = Math.min(Math.max(v, -MAX_VELOCITY), MAX_VELOCITY);
}

/** 走一帧：先按摩擦衰减速度，再积分出角度。 */
export function stepSpin(s: SpinState, dtMs: number): void {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS) / 1000;
  if (dt <= 0) return;
  s.velocity *= Math.pow(FRICTION, dt);
  if (Math.abs(s.velocity) < STOP_BELOW) s.velocity = 0;
  s.rotation += s.velocity * dt;
}

/** 停了没——停了才进焦点锁定与离散定格（§3.4）。 */
export function spinStopped(s: SpinState): boolean {
  return s.velocity === 0;
}
