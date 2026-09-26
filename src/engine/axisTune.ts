/**
 * 鱼眼轴的**开发期调参覆盖**。
 *
 *   localStorage['slides.axisTune'] = '{"gain":1.2,"slowK":0.5}'
 *
 * 键名和调参模拟台（axis-tune-rig）导出的那份 JSON **完全一致**，所以玩家在模拟台上调
 * 定一组值之后，那份 JSON 原样贴进来就能在真机上复核，不必重新构建一次。存在的键覆盖对
 * 应常量，不存在的走默认值。
 *
 * **发版不依赖它。** 正式包里没有这个键，于是每个 tune() 都回默认值，行为和把数字写死
 * 在常量上一个字不差。
 *
 * 每个键都有上下界。手滑写进一个极端值（`gain: 1e9`）不该把主菜单变成一块动不了的砖，
 * 而调参这件事本来就是在一个已知的范围里挑数——超出范围的值不是「更激进」，是「坏了」。
 *
 * 只读一次（模块加载时）：这些值是常量的初值，不是每帧查一次的设置。改完要刷新页面。
 */

const KEY = 'slides.axisTune';

/**
 * 每个键的合理区间。左列就是模拟台那份 JSON 的键名。
 *
 * 有几个键**故意没有对应常量**，列在这儿只是为了这张表和模拟台一一对得上：
 *   · `chase` —— 停住追赶的倍数。lerp = 1（无滞后直贴）之后它不起作用，但把 lerp 调回
 *     小于 1 的时候又会起作用，所以留着。
 *   · `vibDrag` / `vibSettle` —— 轴上的震动已经整个删掉了（玩家调定两个都是 0），没有
 *     常量可覆盖。列在这儿是为了「模拟台里有的键，这儿都找得到交代」。
 */
const RANGE: Record<string, readonly [number, number]> = {
  lerp: [0.01, 1],
  chase: [1, 40],
  gain: [0.1, 8],
  gainFar: [0.1, 12],
  knee: [20, 600],
  slowK: [0.1, 2],
  fastK: [0.2, 4],
  vSlow: [0.01, 3],
  vFast: [0.02, 6],
  vSmooth: [0.05, 1],
  sigma: [0.3, 3],
  minScale: [0.2, 1.5],
  maxScale: [0.5, 3],
  minGap: [40, 400],
  maxGap: [60, 600],
  lock: [0, 0.49],
  flatMax: [0, 1],
  flatDead: [0, 20],
  flatVmax: [0.1, 60],
  flingMs: [0, 400],
  flingMin: [0, 3],
  flingMax: [0, 10],
  carry: [0, 1],
  vmax: [0, 30],
  stale: [0, 500],
  springK: [10, 600],
  zeta: [0.2, 2],
  shift: [0, 0.45],
  // 开关语义：0 / 1。
  sound: [0, 1],
  blur: [0, 1],
  blurExempt: [0, 1],
  // 没有对应常量，见上面那段。
  vibDrag: [0, 200],
  vibSettle: [0, 200],
};

const overrides: Record<string, unknown> = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // 数组也是 object，但它不是一份「键 → 值」；只认普通对象。
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // 无痕模式读不了，或者贴进来的 JSON 是坏的：当成没有这个键。**不报错**——
    // 一份写坏的调参不该让主菜单打不开。
    return {};
  }
})();

/** 这个键被覆盖了没有。给「有没有在调参」那行日志用。 */
export const axisTuned = Object.keys(overrides).some((k) => k in RANGE);

/** 取一个数。没被覆盖、或者覆盖的不是有限数，就回默认值；越界钳回区间里。 */
export function tune(key: keyof typeof RANGE & string, fallback: number): number {
  const v = overrides[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const [lo, hi] = RANGE[key];
  return Math.max(lo, Math.min(hi, v));
}

/** 取一个开关。语义是「非 0 为真」，和模拟台那份 JSON 里写 0/1 的习惯对得上。 */
export function tuneFlag(key: keyof typeof RANGE & string, fallback: boolean): boolean {
  const v = overrides[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v !== 0;
}
