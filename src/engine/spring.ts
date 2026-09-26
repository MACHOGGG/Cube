import { tune } from './axisTune';

/**
 * 一个弹簧积分器：给当前值、速度和目标值，往前走一帧。
 *
 * 出处是《玩法选择器「物理化聚焦」改造》§1.4：只有两处需要时间动画（松手后从
 * 「跟手的即时值」过渡到定格值、桌面端惯性转动），两处共用这一份。跟手那部分
 * 不需要它——那些量本身就是输入位置的函数，每帧直接算就天然跟手。
 *
 * **和规格差一点的地方：规格写「临界阻尼」，这里默认略微欠阻尼。** 玩家对
 * §8-D4 的回答是「弹簧系数给一个能被感知到的小数值」，而临界阻尼按定义就是
 * 「过冲为零」——那是感知不到弹性的。所以默认阻尼比取 0.78，过冲约 2%：在一
 * 次 1.0→1.34 的放大上是 7 个千分位的回弹，眼睛扫得到，但绝不会晃。要彻底不
 * 过冲就把 `zeta` 传 1。
 *
 * 为什么不用固定时长的贝塞尔：`ease-out` 最后一段总是拖泥带水，而这里每一帧
 * 的目标值可能又变了（手指还在动），弹簧天生接得住「目标中途换了」这件事，缓
 * 动曲线接不住——它得重新开一条动画，于是速度断一次。
 */

export interface SpringState {
  value: number;
  velocity: number;
}

export interface SpringParams {
  /** 刚度 k（质量恒为 1，所以 ω = √k）。 */
  tension: number;
  /** 阻尼比：1 ＝ 临界阻尼（不过冲），<1 ＝ 会回弹一点。 */
  zeta: number;
}

/**
 * 松手后过渡到定格值用的那一套。
 *
 * k=150 → ω≈12.2 rad/s，2% 以内的稳定时间 284ms，落在规格要的「响应
 * 250–350ms」正中间。第一版拍了 k=370，门量出来只有 184ms——快得多，手感会比
 * 规格设计的更急；照着门给的数调回来的。zeta 见文件头。
 */
/**
 * 松手之后收尾那把弹簧（只有主菜单那条轴用它）。
 *
 * 玩家 2026-09 在调参模拟台上把它调软了：k 150 → **90**、ζ 0.78 → **0.90**。软一档、
 * 阻尼更足，落定得更稳——配合同一轮定下的「无滞后直贴」（拖动中一比一跟手），松手那一
 * 下的过冲才不会显得突然。
 */
export const SETTLE_SPRING: SpringParams = { tension: tune('springK', 90), zeta: tune('zeta', 0.9) };

/** 一次积分最多认多长的一帧：切到后台再回来那一下 dt 可能是几秒，认了就炸。 */
const MAX_DT_MS = 64;
/** 子步上限。4ms 一步在 k 上到 400 都是稳的，大 dt 拆成多步走。 */
const SUBSTEP_MS = 4;

export function createSpring(value = 0): SpringState {
  return { value, velocity: 0 };
}

/**
 * 往前走 dtMs，逼近 target。原地改 `s`。
 *
 * 半隐式欧拉（先更新速度、再用新速度更新位置）——比显式欧拉稳得多，而且不用
 * 引第三方库，小红书那边 Chrome 61 也跑得动（规格 §5.4 要求两端统一手写 JS）。
 */
export function stepSpring(s: SpringState, target: number, dtMs: number, p: SpringParams = SETTLE_SPRING): void {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS);
  if (dt <= 0) return;
  const k = p.tension;
  const c = 2 * p.zeta * Math.sqrt(k);
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP_MS));
  const h = dt / steps / 1000;
  for (let i = 0; i < steps; i++) {
    s.velocity += (-k * (s.value - target) - c * s.velocity) * h;
    s.value += s.velocity * h;
  }
}

/** 到位了没：值和速度都进了阈值才算，光看值会在过冲的顶点上误判成静止。 */
export function springAtRest(s: SpringState, target: number, eps = 0.0005): boolean {
  return Math.abs(s.value - target) < eps && Math.abs(s.velocity) < eps * 60;
}

/** 直接落到目标（reduced-motion 下用：规格 §5.1 要求退化成无过渡的离散翻页）。 */
export function snapSpring(s: SpringState, target: number): void {
  s.value = target;
  s.velocity = 0;
}
