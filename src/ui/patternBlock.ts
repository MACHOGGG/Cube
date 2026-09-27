import { STRINGS, type Lang } from '../i18n';
import { patternIconSvg, runPatternDef } from '../engine/patternIcon';
import { reducedMotion } from '../engine/reducedMotion';
import type { Family } from '../engine/targets';

/**
 * HUD 右边那一块《得分图案》——《侵蚀阶梯》v1.2 PR-7。
 *
 * 一块牌上两样东西：
 *
 *   · **中间**：当前这一级的 1×N 图标，画成这副棋盘那一族棋子的样子；
 *   · **外框**：一圈刻度线段，等分成「这一级一共几段」，每翻一枚就熄一段。
 *
 * 为什么是刻度环而不是一根进度条：玩家要读的不是「百分之多少」，是「还差几下」。
 * 一段一段熄下去数得出来，而一根越来越短的条只看得出「快了」。
 *
 * 末位那一枚的不透明度跟着本级剩余段数线性下降（1 → 0.15）：段快扣完的时候，图案
 * 上那一枚已经在淡出了——**降级不是突然发生的**，它有一个能看见的过程。
 */

/** 末位那枚淡到最低多少（不是 0——彻底看不见的话，「它还在」这件事就没了）。 */
const TAIL_MIN_OPACITY = 0.15;
/** 段数超过这个数就每 5 段画一根长刻度，不然一圈碎线数不清。 */
const LONG_TICK_AFTER = 12;
/** 变级时那两下亮度脉冲各多长。 */
const FLASH_MS = 120;
/** reduced-motion 那一路：不闪，改成把边框加粗这么久。 */
const THICKEN_MS = 300;

export interface ErosionView {
  level: number;
  segLeft: number;
  segTotal: number;
}

export interface PatternBlock {
  /** 盘面变了：重画图标、重描刻度、该闪就闪。 */
  update(view: ErosionView): void;
  destroy(): void;
}

/**
 * 一圈刻度的 `stroke-dasharray`。
 *
 * 把路径的 `pathLength` 设成「一共几段」，于是一段就是 1 个单位，每一段画成
 * 「实线一点 + 空一点」。亮的那几段排在前面，剩下的一口气空掉——所以数组的和正好
 * 等于 pathLength，一个周期刚好绕一圈，不会接出第二圈来。
 *
 * 段数多的时候每 5 段那一根画长一点（`long`），一圈碎线才数得清。
 */
export function tickDash(segTotal: number, segLeft: number): string {
  const total = Math.max(1, Math.round(segTotal));
  const lit = Math.max(0, Math.min(total, Math.round(segLeft)));
  const long = total > LONG_TICK_AFTER;
  const parts: string[] = [];
  for (let i = 0; i < lit; i++) {
    const on = long && i % 5 === 0 ? 0.82 : 0.6;
    parts.push(on.toFixed(2), (1 - on).toFixed(2));
  }
  const rest = total - lit;
  if (rest > 0) parts.push('0', String(rest));
  return parts.join(' ');
}

/**
 * @param host   这一块的容器（`.hud-block--pattern`）
 * @param family 这副棋盘归哪一族——图标画成它那一族棋子的样子
 */
export function mountPatternBlock(host: HTMLElement, family: Family, lang: Lang): PatternBlock {
  const s = STRINGS[lang];
  host.setAttribute('aria-live', 'polite');
  host.innerHTML =
    /*
     * 刻度环。
     *
     * viewBox 用的是**这一块的真实像素尺寸**，不是 0..100 归一化再拉伸。
     * `preserveAspectRatio="none"` 那一版看着像「上边的刻度又宽又长、两侧的又
     * 窄又短」：非等比缩放会把用户坐标系里等长的虚线在横竖两个方向拉成不同的长
     * 度，而这一块是扁的（约 217×69），横竖差了三倍。等距的刻度是这一块能数得
     * 出来的前提，所以宁可跟着尺寸重画一次（下面那个 ResizeObserver）。
     */
    '<svg class="pat-ring" viewBox="0 0 100 100" aria-hidden="true">' +
    // 暗的那一圈画的是**全部段数**（整圈刻度），亮的那一圈画还剩几段盖在上面。
    // 暗圈画成实线的话，底下是一道连续的边，熄掉的那几段看着像「边框本来就长这
    // 样」，数不出还剩几下——而这一块存在的全部意义就是「还差几下」。
    '<rect class="pat-ring-dim" x="2" y="2" width="96" height="96" rx="14" ry="14"' +
    ' fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="butt"/>' +
    '<rect class="pat-ring-lit" x="2" y="2" width="96" height="96" rx="14" ry="14"' +
    ' fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="butt"/>' +
    '</svg>' +
    '<span class="pat-icon" id="patIcon"></span>';
  const dim = host.querySelector<SVGRectElement>('.pat-ring-dim')!;
  const lit = host.querySelector<SVGRectElement>('.pat-ring-lit')!;
  const icon = host.querySelector<HTMLElement>('.pat-icon')!;

  let shownLevel = -1;
  let flashTimer = 0;
  let last: ErosionView = { level: 4, segLeft: 0, segTotal: 1 };

  /** 把那两个矩形按这一块此刻的真实像素尺寸重摆一遍。 */
  function layoutRing(): void {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const svg = host.querySelector<SVGSVGElement>('.pat-ring');
    svg?.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // 描边压在块的边上，所以内缩半个线宽；圆角跟着块自己的圆角走（读的是计算
    // 样式，不是猜一个数——那个圆角是 clamp 出来的，随屏幕变）。
    const sw = 3;
    const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 12;
    for (const rect of [dim, lit]) {
      rect.setAttribute('x', String(sw / 2));
      rect.setAttribute('y', String(sw / 2));
      rect.setAttribute('width', String(Math.max(0, w - sw)));
      rect.setAttribute('height', String(Math.max(0, h - sw)));
      rect.setAttribute('rx', String(Math.max(0, radius - sw / 2)));
      rect.setAttribute('ry', String(Math.max(0, radius - sw / 2)));
      rect.setAttribute('stroke-width', String(sw));
    }
  }

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        layoutRing();
        update(last);
      })
    : null;
  ro?.observe(host);

  function paintIcon(level: number, tailAlpha: number): void {
    icon.innerHTML = patternIconSvg(runPatternDef(family, level));
    // 末位那一枚单独淡：SVG 里最后一个图形就是它（runPatternDef 按顺序生成）。
    const marks = icon.querySelectorAll<SVGElement>('svg > *');
    const last = marks[marks.length - 1];
    if (last) last.style.opacity = String(tailAlpha);
  }

  function flash(level: number): void {
    host.setAttribute('aria-label', s.patternNowLabel.replace('{n}', String(level)));
    if (reducedMotion()) {
      // 不闪：边框加粗一下，同样说明「刚刚变了」，但不用亮度脉冲。
      host.classList.add('hud-block--thick');
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => host.classList.remove('hud-block--thick'), THICKEN_MS);
      return;
    }
    host.classList.remove('hud-block--flash');
    void host.offsetWidth; // 连着降两级时，让这一拍重新起跳
    host.classList.add('hud-block--flash');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => host.classList.remove('hud-block--flash'), FLASH_MS * 2 + 40);
  }

  function update(view: ErosionView): void {
    last = view;
    const total = Math.max(1, view.segTotal);
    const left = Math.max(0, Math.min(total, view.segLeft));
    dim.setAttribute('pathLength', String(total));
    dim.setAttribute('stroke-dasharray', tickDash(total, total));
    lit.setAttribute('pathLength', String(total));
    lit.setAttribute('stroke-dasharray', tickDash(total, left));
    // 到 1 枚之后没有下一级了，段数环整圈熄掉——再翻也不会更小（§2）。
    dim.style.opacity = view.level <= 1 ? '0.25' : '';
    const tail = view.level <= 1 ? 1 : TAIL_MIN_OPACITY + (1 - TAIL_MIN_OPACITY) * (left / total);
    paintIcon(view.level, tail);
    if (view.level !== shownLevel) {
      if (shownLevel !== -1) flash(view.level);
      else host.setAttribute('aria-label', s.patternNowLabel.replace('{n}', String(view.level)));
      shownLevel = view.level;
    }
  }

  layoutRing();
  return {
    update,
    destroy() {
      window.clearTimeout(flashTimer);
      ro?.disconnect();
    },
  };
}
