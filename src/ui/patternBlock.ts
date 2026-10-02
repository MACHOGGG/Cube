import { STRINGS, type Lang } from '../i18n';
import { patternIconSvg, runPatternDef, type PatternDef } from '../engine/patternIcon';
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
 * 末位那一枚**不淡出**：要么整枚在，要么整枚没了。玩家 2026-10 的原话——「切换的时候
 * 逐一取出就好」。见下面 `paintIcon` 那段。
 */

/** 段数超过这个数就每 5 段画一根长刻度，不然一圈碎线数不清。 */
const LONG_TICK_AFTER = 12;
/** 变级时那两下亮度脉冲各多长。 */
const FLASH_MS = 120;
/** reduced-motion 那一路：不闪，改成把边框加粗这么久。 */
const THICKEN_MS = 300;
/** 变级时整块弹一下（scale 1→1.12→1）多长。 */
const PUNCH_MS = 320;
/** 棋盘上方那条「得分图案 → 1×3」停多久。reduced-motion 停久一点（没有动效帮着提醒）。 */
const TOAST_MS = 1600;
const TOAST_MS_STILL = 2500;

export interface ErosionView {
  level: number;
  segLeft: number;
  segTotal: number;
}

export interface PatternBlock {
  /** 盘面变了：重画图标、重描刻度、该闪就闪。 */
  update(view: ErosionView): void;
  /**
   * 教学第 3 条那一步：**把「图案会变小」这件事当场演一遍**（E24）。
   *
   * 第 3 条说的是「得分图案会随着游戏解锁而变化」，而这句话指的那样东西就在他头顶上
   * ——可开局那会儿它一动不动，一排四枚摆在那儿，句子里的「变化」没有任何实物对应。
   * 从前这一步等的是**真的**降一级，而降一级要先翻掉三十几枚：一局头几分钟根本见不
   * 到，玩家盯着一句看不懂的话干等，最后靠保底跳过去。
   *
   * 所以这一下是**演示**，不是读数：开着的时候这一块换一支显眼的颜色（《色卡》的
   * `--card-red` #BE411A），图标在「四枚」和「三枚」之间慢慢来回——话和实物同时发生，
   * 而且不必等盘面真的走到那儿。
   *
   * 演的时候真实读数**照旧更新**（刻度环、aria-label、降级那一下的闪和弹都不受影响），
   * 只有图标这一处被借去演示；`demo(false)` 之后立刻按最后一次 `update` 的数重画。
   */
  demo(on: boolean): void;
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
 * @param faceFor 图标怎么画。不给就是基础玩法那一条 1×N。老虎机那一局给的是「这一
 *   级的目标子形」（《侵蚀阶梯》v1.2 PR-8）——刻度环、熄段、末位淡出、变级闪一下
 *   全都照旧共用，换掉的只有中间画什么。所以这一块不认识「老虎机」这件事，它只
 *   认「第几级该画什么」。
 */
export function mountPatternBlock(
  host: HTMLElement,
  family: Family,
  lang: Lang,
  faceFor?: (level: number) => PatternDef,
): PatternBlock {
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
  // 老虎机那一局的目标可能是两三行高的（方块 35 是竖着三格），塞不进这块扁牌
  // 子里的固定 em 尺寸——挂一个身份类，让 CSS 把它按整块的大小缩进去（见
  // style.css 的 .pat-block--target）。基础玩法那一条 1×N 永远是一行，尺寸是玩
  // 家定过的，一个字都不动。
  if (faceFor) host.classList.add('pat-block--target');
  const dim = host.querySelector<SVGRectElement>('.pat-ring-dim')!;
  const lit = host.querySelector<SVGRectElement>('.pat-ring-lit')!;
  const icon = host.querySelector<HTMLElement>('.pat-icon')!;

  let shownLevel = -1;
  let flashTimer = 0;
  let last: ErosionView = { level: 4, segLeft: 0, segTotal: 1 };
  /** 教学那一下演示（见 PatternBlock.demo）正在跑。 */
  let demoTimer = 0;
  let demoing = false;

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

  /**
   * 画这一级的图标。**每一枚都是满的**，没有半透明的那一枚。
   *
   * 从前末位那一枚跟着本级剩余段数线性淡下去（1 → 0.15，后来抬到 0.45），本意是
   * 「降级不是突然发生的，它有一个能看见的过程」。那个过程把这一块变成了一道算术
   * 题：玩家报过一次 off-by-one——「这一块显示的是解锁之后那一级，不是当前这一
   * 级」。查下来级数一个字没错（`check-pattern-level.mjs` 把 erosion 的级数、
   * `runPatternDef` 的图形数、老虎机那一路的 `sizeAtLevel`/`erodedFace` 逐级逐枚
   * 验过），错的是**看起来**：淡到一半的那一枚，一排四枚读起来就是三枚，于是他照
   * 三枚去凑，凑好了不给分。抬到 0.45 只是让那一枚淡得没那么狠，题还在。
   *
   * 玩家 2026-10 直接拍了板：「切换的时候逐一取出就好」。要么整枚在，要么整枚没
   * 了——数得出来的东西不再需要被读出来。降级那一下另有三样东西在说（整块弹一
   * 下、刻度环闪两下、棋盘上方那条「得分图案 → 1×3」），不靠这一枚的透明度。
   */
  function paintIcon(level: number): void {
    icon.innerHTML = patternIconSvg(faceFor ? faceFor(level) : runPatternDef(family, level));
  }

  /** 演示那两级：开局那一级（四枚）和它的下一级（三枚）。 */
  const DEMO_FROM = 4;
  const DEMO_TO = 3;
  /** 两枚之间停多久。慢一点——这一下是讲给人看的，不是动效。 */
  const DEMO_STEP_MS = 1100;

  function demo(on: boolean): void {
    window.clearTimeout(demoTimer);
    demoTimer = 0;
    if (!on) {
      if (!demoing) return;
      demoing = false;
      host.classList.remove('pat-block--demo');
      // 借走的只有图标这一处，所以回来的时候按最后一次真实读数重画就够了。
      paintIcon(last.level);
      return;
    }
    demoing = true;
    host.classList.add('pat-block--demo');
    /*
     * reduced-motion 那一路**只摆结果**，不来回换：这一块在屏幕角上，而「每隔一秒换一
     * 次」对关掉动效的人就是那种最难受的闪烁。摆成少一枚的那一级，颜色照旧换——「它会
     * 变小」这件事照样说得出来，只是不演过程。
     */
    if (reducedMotion()) {
      paintIcon(DEMO_TO);
      return;
    }
    let big = true;
    const tick = (): void => {
      paintIcon(big ? DEMO_FROM : DEMO_TO);
      big = !big;
      demoTimer = window.setTimeout(tick, DEMO_STEP_MS);
    };
    tick();
  }

  /**
   * 棋盘上方居中那条「得分图案 → 1×3」（v1.3.1 PR-14 §3）。
   *
   * 为什么要它：变级是这一局里**最重要的一次规则变化**（要凑的东西少了一枚），而它原先
   * 只在右上角那一小块里闪两下——玩家正盯着棋盘中间，很容易整个错过，然后按旧的枚数去
   * 凑。所以话要说在他看着的地方，而且要说清「变成几枚了」。
   *
   * 挂在棋盘外层（`.app--game`）上而不是这一块里：这一块只有两百多像素宽，一句话摆不
   * 下，而且它就在视野边上。
   */
  /**
   * 这一级屏幕上**真的画了几枚**。
   *
   * 基础玩法里它就等于级数（`runPatternDef(family, level)` 画 level 枚）。老虎机那一
   * 局不是：图标走 `faceFor(level)` → `sizeAtLevel`（engine/targets.ts），一个 6 枚的
   * 目标在第 3 级画的是 **5** 枚，不是 3 枚。
   *
   * 从前报数的地方（toast、读屏的 aria-label）一律拿 `view.level` 去填那句「得分图案
   * 变成 {n} 枚」，于是**二十个目标里有十个报的是假话**：图标画 5 枚、判定也要 5 枚，
   * 而屏幕上那句话写着 3 枚。图标和判定一直是一致的（`targetNeed()` 走的也是
   * `sizeAtLevel`），错的只有文案。
   */
  const shownCount = (level: number): number =>
    faceFor ? faceFor(level).cells.length : Math.max(1, Math.round(level));

  function toast(n: number): void {
    const stage = host.closest('.app--game') ?? host.parentElement;
    if (!stage) return;
    const el = document.createElement('div');
    el.className = 'pat-toast';
    // 用的是同一句 i18n（patternNowLabel：「得分图案变成 N 枚」），不另起一句——两处说
    // 同一件事，用词不一样只会让人以为是两件事。
    el.textContent = s.patternNowLabel.replace('{n}', String(n));
    // 摆在棋盘正上方那条缝里，横竖屏都对：位置**现量棋盘**，不按「顶排多高」去算——
    // 顶排的高随视口和玩法变（步步为营那一块多一行余步），而横屏顶排根本不在上面。
    const board = stage.querySelector<HTMLElement>('#boardWrap');
    if (board) {
      el.style.top = `${Math.max(4, board.offsetTop + 4)}px`;
      el.style.left = `${board.offsetLeft + board.offsetWidth / 2}px`;
    }
    stage.appendChild(el);
    const hold = reducedMotion() ? TOAST_MS_STILL : TOAST_MS;
    window.setTimeout(() => el.remove(), hold);
  }

  function flash(level: number): void {
    const n = shownCount(level);
    host.setAttribute('aria-label', s.patternNowLabel.replace('{n}', String(n)));
    toast(n);
    if (reducedMotion()) {
      // 不闪、不弹：边框加粗一下，同样说明「刚刚变了」，但不用亮度和位移。
      host.classList.add('hud-block--thick');
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => host.classList.remove('hud-block--thick'), THICKEN_MS);
      return;
    }
    host.classList.remove('hud-block--flash', 'hud-block--punch');
    void host.offsetWidth; // 连着降两级时，让这一拍重新起跳
    host.classList.add('hud-block--flash', 'hud-block--punch');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(
      () => host.classList.remove('hud-block--flash', 'hud-block--punch'),
      Math.max(FLASH_MS * 2 + 40, PUNCH_MS + 40),
    );
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
    // 演示借走的只有图标这一处：刻度环、aria-label、降级那一下的闪和弹照旧走下面几行。
    if (!demoing) paintIcon(view.level);
    if (view.level !== shownLevel) {
      if (shownLevel !== -1) flash(view.level);
      else host.setAttribute('aria-label', s.patternNowLabel.replace('{n}', String(shownCount(view.level))));
      shownLevel = view.level;
    }
  }

  layoutRing();
  return {
    update,
    demo,
    destroy() {
      window.clearTimeout(flashTimer);
      window.clearTimeout(demoTimer);
      ro?.disconnect();
    },
  };
}
