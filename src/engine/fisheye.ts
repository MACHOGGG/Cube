/**
 * 鱼眼形变：一条轴上的 n 项，按「离焦点多远」连续决定各自的大小和位置。
 *
 * 出处是玩家给的《玩法选择器「物理化聚焦」改造 · 实施方案 v1.0》(2026-09-19)
 * 的 §1.3。那份规格自己写明「未接触仓库真实源码，引用的类名文件名均为占位示
 * 意」，也要求「与文档设想差异很大时先回报差异」——下面三处就是回报过、并按
 * 修正后的样子实现的：
 *
 *  ① **`gap` 用中点量距离，不用 `d_i`。** 规格的 `gap(i) = f(influence(d_i))`
 *    是「第 i 项与下一项的间距」。焦点正落在第 k 项上时，`d_k = 0` 让 k 右边
 *    那个间距最大、`d_{k-1} = 1` 让 k 左边那个小得多——**被聚焦的那一项会偏
 *    心**，看着像没对准。改成用这一段的中点（`i + 0.5`）到焦点的距离，左右两
 *    段就对称了，「焦点附近彼此撑开」这个意图不变。
 *  ② **距离一律按「项」为单位量，两端同一个 σ。** 规格说手机端用像素距离、桌
 *    面端用角度差。真按两套单位走，σ 就得各调一套，而 §4.2 又要求点点轴和主
 *    图标区「σ 必须一致」，三处各一套单位是自找麻烦。这里统一成索引距离
 *    （1 ＝ 一个相邻位），循环时按项数取环上最短距离——那正是 §3.2 的
 *    `angularDistance` 换成索引空间的写法。谁要真的角度，`angularDistance()`
 *    也导出了。
 *  ③ **循环时把间距归一化回整圈。** 规格 §3.1 要求桌面端按角度取模做循环，但
 *    没提「间距会变」和「环必须闭合」这两件事撞在一起：各项间距一变，加起来就
 *    不再是 360°，环合不上（第一项和最后一项之间会裂开或叠上）。所以循环模式
 *    下把所有间距按 `wrapTotal / Σ` 等比缩回去——隆起的相对关系照旧，环永远闭
 *    合。直线模式不归一化，因为那边「整条轴总长度轻微起伏」是规格明确要的。
 *
 * 这个文件不碰 DOM、不读任何全局状态，就是几个纯函数——门（check-fisheye）直
 * 接喂数就能验，不用开浏览器。
 */

/** 一项的形变结果。 */
export interface FisheyeSlot {
  index: number;
  /**
   * 渲染位置：沿轴的偏移量，**焦点处为 0**。
   *
   * 单位跟着 `minGap`/`maxGap` 走——手机端传像素就是像素，桌面端传角度就是角
   * 度。焦点恒在 0，所以调用方只要把「选中线」钉在屏幕某处，各项照这个偏移摆
   * 就行，不用自己再算滚动位置（这也是 §4.1 那条胶片轴的做法：高亮线不动，缩
   * 略图在底下滑）。
   */
  at: number;
  scale: number;
  /** 0–1，`influence(d)` 的值。点点轴要复用主图标区这一份，别自己再算一遍。 */
  inf: number;
  /** 到（锁定折算后的）焦点的距离，单位＝项。 */
  d: number;
}

export interface FisheyeParams {
  /**
   * 衰减半径，单位＝项。
   *
   * 规格要的手感是「当前项和左右各 1 项明显变化，第 3 项开始基本回到基准
   * 态」。σ=0.9 正好：influence(1)=0.54、influence(2)=0.084、influence(3)=
   * 0.0043。调大了远处的项会跟着一起胀，调小了就只剩当前项自己在动——那正是
   * §1.1 点名不要的样子。
   */
  sigma: number;
  minScale: number;
  maxScale: number;
  /** 基准间距（influence→0 处两项的距离）。 */
  minGap: number;
  /** 焦点处两项的距离。 */
  maxGap: number;
  /**
   * 焦点锁定半径，单位＝项；0 ＝ 不锁。
   *
   * §1.2 那条补丁：焦点离某一项近到这个程度时，形变**冻住**不再跟着手指的微
   * 小抖动走，玩家才好从容落点。文献里的原始毛病（Bederson 2000 的鱼眼菜单选
   * 取反而更慢）就是「目标一直在挪」。
   */
  lockRadius: number;
}

export interface FisheyeLayout {
  slots: FisheyeSlot[];
  /** 传进来的原始焦点（可以是任意实数，包括越界的回弹区间）。 */
  focus: number;
  /** 锁定折算之后、真正用来算形变的那个焦点。 */
  lockedFocus: number;
  /** 整条轴首末项中心之间的距离；循环模式恒等于 `wrapTotal`。 */
  length: number;
  /** 离焦点最近的那一项（松手要定格到它）。 */
  nearest: number;
}

export interface FisheyeOpts {
  /** 循环（桌面端转盘）。默认 false ＝ 到端点为止（玩家 2026-09 定的手机端不循环）。 */
  wrap?: boolean;
  /** 循环一整圈对应多少个单位，默认 360（度）。 */
  wrapTotal?: number;
}

/** 手机端与点点轴的一套默认值；σ 三处必须同一个，见 §4.2。 */
export const SIGMA = 0.9;

/**
 * 钟形衰减：`exp(-d² / 2σ²)`，d=0 时为 1。
 *
 * 规格 §1.3 选高斯不选线性衰减，理由是边缘回到基准态更快、没有生硬的截断
 * 感——线性衰减在 d=σ 处有个折角，眼睛看得出来。
 */
export function influence(d: number, sigma: number = SIGMA): number {
  const s = sigma > 0 ? sigma : 1e-6;
  return Math.exp(-(d * d) / (2 * s * s));
}

/**
 * 环上两个角的最短夹角，落在 [0, full/2]。
 *
 * 「往左 350° 和往右 10° 是同一个距离」——渲染层要把索引换成屏幕角度时用得
 * 上。形变本身不走这一条（见文件头 ②，距离按项算）。
 */
export function angularDistance(a: number, b: number, full = 360): number {
  const raw = Math.abs(((a - b) % full + full) % full);
  return Math.min(raw, full - raw);
}

/** 环上的有符号偏移，落在 (-full/2, full/2]。 */
function wrapSigned(v: number, full: number): number {
  const m = ((v % full) + full) % full;
  return m > full / 2 ? m - full : m;
}

/** 索引距离；循环时取环上最短。 */
function indexDist(a: number, b: number, count: number, wrap: boolean): number {
  if (!wrap) return Math.abs(a - b);
  return Math.abs(wrapSigned(a - b, count));
}

/**
 * 焦点锁定（§1.2）：把原始焦点折算成「冻过的」焦点。
 *
 * 不是简单地吸附到最近一项——那样离开锁定区的一瞬间会跳一下（区内当成
 * `round(f)`，区外当成 `f`，两者在边界上差着一个 `lockRadius`）。这里用的是
 * 一条连续的死区重映射：
 *
 *   · |e| ≤ L        → 完全冻住（导数 0，抖动一点形变都不动）
 *   · L < |e| ≤ 0.5  → 线性拉回去，正好在 |e| = 0.5（两项正中间）接回原值
 *
 * 所以整条曲线连续，交接处两边算出来是同一个数，既有「冻住」又不会跳。
 */
export function lockFocus(focus: number, lockRadius: number, count: number, wrap: boolean): number {
  if (!(lockRadius > 0) || count <= 1) return focus;
  const L = Math.min(lockRadius, 0.49);
  const centre = Math.round(focus);
  // 不循环时端点外侧（回弹区）不锁：那儿本来就要让它拉出去再弹回来。
  if (!wrap && (centre < 0 || centre > count - 1)) return focus;
  const e = focus - centre;
  if (Math.abs(e) <= L) return centre;
  const pulled = Math.sign(e) * ((Math.abs(e) - L) * 0.5) / (0.5 - L);
  return centre + pulled;
}

/**
 * 算一帧：给项数和当前焦点，返回每一项的大小与位置。
 *
 * 位置是「从焦点往两边累加间距」得出来的，不是固定网格——这就是规格要的「间
 * 距也跟着变」，而整条轴总长度的起伏是它的自然结果，不用另写一套总长度动画
 * （规格特别点名两者必须同源，否则会不同步）。
 */
export function fisheye(
  count: number,
  focus: number,
  p: FisheyeParams,
  opts: FisheyeOpts = {},
): FisheyeLayout {
  const wrap = opts.wrap === true;
  const wrapTotal = opts.wrapTotal ?? 360;
  const n = Math.max(0, Math.floor(count));
  if (n === 0) {
    return { slots: [], focus, lockedFocus: focus, length: 0, nearest: -1 };
  }
  const f = lockFocus(focus, p.lockRadius, n, wrap);

  // 间距：第 i 段（i 与 i+1 之间）按这一段中点到焦点的距离算，左右才对称。
  const segs = wrap ? n : n - 1;
  const gaps: number[] = [];
  let total = 0;
  for (let i = 0; i < segs; i++) {
    const g = p.minGap + (p.maxGap - p.minGap) * influence(indexDist(i + 0.5, f, n, wrap), p.sigma);
    gaps.push(g);
    total += g;
  }
  // 循环模式：等比缩回整圈，环才闭得上（见文件头 ③）。
  if (wrap && total > 0) {
    const k = wrapTotal / total;
    for (let i = 0; i < segs; i++) gaps[i] *= k;
    total = wrapTotal;
  }

  // 累加成坐标，再整体平移，让焦点落在 0。
  const X: number[] = [0];
  for (let i = 0; i < segs; i++) X.push(X[i] + gaps[i]);
  const kf = wrap
    ? Math.floor(((f % n) + n) % n)
    : Math.min(Math.max(Math.floor(f), 0), Math.max(segs - 1, 0));
  const tf = wrap ? (((f % n) + n) % n) - kf : f - kf;
  const Xf = segs > 0 ? X[kf] + tf * gaps[Math.min(kf, segs - 1)] : 0;

  const slots: FisheyeSlot[] = [];
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = indexDist(i, f, n, wrap);
    const inf = influence(d, p.sigma);
    const raw = X[i] - Xf;
    slots.push({
      index: i,
      at: wrap ? wrapSigned(raw, wrapTotal) : raw,
      scale: p.minScale + (p.maxScale - p.minScale) * inf,
      inf,
      d,
    });
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  return { slots, focus, lockedFocus: f, length: wrap ? wrapTotal : total, nearest };
}

/**
 * 点在哪一项上——**按渲染出来的位置量，不是按基准网格**。
 *
 * 形变把各项挪过位置了，按基准网格判定会点错一项（离焦点越近错得越多）。手指
 * 落点到各项中心的距离，谁近算谁，这也正是 §4.2 对点点轴的要求：「热区按距离
 * 动态分配，不能卡死在可见像素边界内」。
 */
export function hitTest(layout: FisheyeLayout, at: number): number {
  let best = Infinity;
  let idx = -1;
  for (const s of layout.slots) {
    const d = Math.abs(s.at - at);
    if (d < best) {
      best = d;
      idx = s.index;
    }
  }
  return idx;
}
