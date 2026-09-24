/**
 * 主菜单那条**竖着跑的带子**。
 *
 * 玩家 2026-09 第十轮定的：「带子取代鱼眼轴」——**方向和鱼眼轴一样是竖的，
 * 只是效果不同**（他的原话：「滑动是竖向的滑动，和现在鱼眼转盘一样的方向只
 * 是效果不同」）。鱼眼轴（ui/modeAxis.ts，调了七轮）是「滑到哪停哪、中间那张
 * 胀大」；这一条是「自己一直往上走、无缝循环」，速度和倾斜跟着滑动速度走
 * （那是同一轮第二件的规格，见 engine/marquee.ts）。
 *
 * 接口和 mountModeAxis **一模一样**（cards / initial / onFocus / divider），
 * menu.ts 那边只换了一个函数名。这样做有两个原因：首玩期的锁、《我会玩》那条分
 * 界线、「停在上次看的那一项」三件事原样还在，一件都不用重写；万一玩家看过线上
 * 觉得还是轴好，换回去也只是改回那一个名字。
 *
 * **点移动靶这件事**是这一版最大的风险，玩家点名要这个效果、我提过、他确认了。
 * 能做的防护都做了，各自在下面有注释：
 *
 *   · 手指一按下带子就停（marquee 的 pause），松开再走。所以点的那一刻它不动。
 *   · 位移超过 TAP_SLOP 就算「拖」不算「点」，而且那一下的 click 会被吃掉——
 *     不然拖完手一松，底下那张卡就开局了。
 *   · 吃 click 的监听挂在 **window 的捕获阶段**：menu.ts 的 armFirstPlayLock 也
 *     在捕获阶段拦（挂在 grid 上），window 比它更早，所以拖动结束时锁着的那张卡
 *     不会白抖一下。
 *
 * **第二份是克隆的，没有监听器。** 所以这儿一律走事件委派：每张卡身上写一个
 * `data-strip-idx`，点到谁就去叫**真身**的 click()。不这么做的话，带子上有一半
 * 的卡按下去没反应——正是玩家最忌讳的那种「意料之外的疏漏操作」。
 */
import { mountMarquee, type Marquee } from '../engine/marquee';
import { reducedMotion } from '../engine/reducedMotion';

/** 位移超过这么多像素就算「拖」，不算「点」。和鱼眼轴同一个数。 */
const TAP_SLOP = 10;

export interface ModeStripOpts {
  /** 带子上的卡，按顺序。menu.ts 造好了原样交过来——美术内容一个字都不改。 */
  cards: readonly HTMLElement[];
  /** 一开始把哪一项摆在屏幕正中（回主菜单时停在他离开时那一项上）。 */
  initial?: number;
  /**
   * 正中那一项换了就报一声，调用方好把它记住。
   *
   * 带子是一直在走的，所以不像轴那样「停稳了报一次」——这儿是在**手松开**和
   * **离开这一页**的时候各报一次：那两个时刻才是「他刚才在看这个」。
   */
  onFocus?: (index: number) => void;
  /** 首玩期《我会玩》那条分界线，夹在第 `after` 张和第 `after+1` 张之间。 */
  divider?: { el: HTMLElement; after: number };
}

export interface ModeStrip {
  /** 现在正中是哪一项。 */
  focused(): number;
  /** 从外面把某一项摆到正中。 */
  focusTo(index: number): void;
  destroy(): void;
}

export function mountModeStrip(host: HTMLElement, opts: ModeStripOpts): ModeStrip {
  const cards = opts.cards.slice();
  const n = cards.length;
  host.classList.add('mode-strip');

  /**
   * 交给 marquee 的那一串：卡片按顺序，分界线插在它该在的缝里。
   *
   * 分界线在这儿**是队伍里的一员**，不像鱼眼轴那样要每帧算位置——横着排的时候
   * 它自己只占自己那点宽度，「不占额外的位置」这句话自动成立（玩家第九轮为竖版
   * 提的那条，见 modeAxis 的 paintDivider）。
   */
  const items: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    cards[i].dataset.stripIdx = String(i);
    items.push(cards[i]);
    if (opts.divider && i === opts.divider.after) {
      opts.divider.el.dataset.stripRole = 'knowhow';
      items.push(opts.divider.el);
    }
  }
  /** 分界线里那颗真按钮（克隆那一份要靠它代打）。 */
  const knowHowReal = opts.divider?.el.querySelector<HTMLElement>('.know-how-btn') ?? null;

  /** 每张卡在**一份**里的位置和宽度，focused / focusTo 靠它算。 */
  let geo: ({ l: number; w: number } | undefined)[] = [];

  const manual = reducedMotion();

  const mq: Marquee = mountMarquee(host, {
    // 竖着走：和以前的鱼眼轴同一个方向，只是效果换了（见文件头）。
    axis: 'y',
    base: 26,
    velocityGain: 0.4,
    skewGain: 0.004,
    maxSkew: 6,
    direction: 1,
    items,
    onRebuild: measure,
  });

  function measure(): void {
    const copy = host.querySelector<HTMLElement>('.marquee-copy');
    if (!copy) return;
    geo = [];
    for (const el of Array.from(copy.children) as HTMLElement[]) {
      const idx = el.dataset.stripIdx;
      if (idx == null) continue;
      // 竖着摆：位置和长度都沿着 y 量。
      geo[Number(idx)] = { l: el.offsetTop, w: el.offsetHeight };
    }
  }

  function focused(): number {
    const mid = host.clientHeight / 2;
    if (manual) {
      // 手动那一路只有一份，位移就是 scrollTop。
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < geo.length; i++) {
        const g = geo[i];
        if (!g) continue;
        const d = Math.abs(g.l + g.w / 2 - host.scrollTop - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    const off = mq.offset();
    const span = mq.span();
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < geo.length; i++) {
      const g = geo[i];
      if (!g) continue;
      // 位移永远在 (-span, 0]，所以一张卡可能出现在第 0 份或第 1 份里；两份都试。
      for (let k = 0; k < 2; k++) {
        const d = Math.abs(off + k * span + g.l + g.w / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }

  function focusTo(index: number): void {
    const g = geo[index];
    if (!g) return;
    const want = host.clientHeight / 2 - (g.l + g.w / 2);
    if (manual) host.scrollTop = -want;
    else mq.setOffset(want);
  }

  let lastReported = -1;
  function report(): void {
    const f = focused();
    if (f === lastReported) return;
    lastReported = f;
    opts.onFocus?.(f);
  }

  // ---- 手指 ---------------------------------------------------------------
  //
  // 手动那一路（reduced-motion）不装这一套：那儿是浏览器原生的横向滚动，再插一
  // 层指针接管只会和它打架，而且原生滚动本来就带「按住不动」。
  let downY = 0;
  let downOff = 0;
  /** 上一帧手指在哪、什么时候——算拖动速度用（送给 marquee.drive）。 */
  let lastY = 0;
  let lastT = 0;
  let dragging = false;
  let suppressClick = false;

  /**
   * **不用 setPointerCapture。**
   *
   * 第一版用了，结果是带子上的卡全部点不动。捕获一旦设在 host 上，后续的
   * pointer 事件（包括 pointerup）**全部改派给 host**，`e.target` 于是不再是那张卡；
   * 浏览器随后合成的 click 也跟着落在 host 上，真身那一份的原装监听器同样收不到。
   *
   * 改成：按下之后把 move/up 挂到 window 上（手指滑出带子也跟得上，捕获本来就是
   * 为这个用的），命中判定用**落点**（elementFromPoint）而不是 e.target。
   */
  const onDown = (e: PointerEvent): void => {
    if (e.button != null && e.button !== 0) return;
    suppressClick = false;
    dragging = false;
    downY = e.clientY;
    lastY = e.clientY;
    lastT = performance.now();
    downOff = mq.offset();
    mq.pause();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const onMove = (e: PointerEvent): void => {
    const dy = e.clientY - downY;
    if (!dragging && Math.abs(dy) > TAP_SLOP) dragging = true;
    if (!dragging) return;
    mq.setOffset(downOff + dy);
    /*
     * 把手指的速度送给带子：速度和倾斜跟着它走。
     *
     * 不送的话那一条规格实际上永远不会发生：主菜单一屏装得下、带子自己又
     * 吃掉了竖向手势，window.scrollY 永远是 0。玩家眼里的「滑动速度」就是他自己
     * 拖的这一下。方向取反：手指往下拖（dy > 0）等于内容往下走，和页面往上
     * 滚是同一回事。
     */
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    if (dt > 0.004) {
      mq.drive(-(e.clientY - lastY) / dt);
      lastY = e.clientY;
      lastT = now;
    }
  };

  function unwire(): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  const onUp = (e: PointerEvent): void => {
    unwire();
    if (dragging) {
      // 拖完这一下不许变成开局（见文件头）。
      suppressClick = true;
    } else {
      activate(document.elementFromPoint(e.clientX, e.clientY));
    }
    dragging = false;
    mq.resume();
    report();
  };

  const onCancel = (): void => {
    unwire();
    dragging = false;
    mq.resume();
  };

  /**
   * 点到了谁。
   *
   * 真身自己会派 click（它就在第一份里，监听器是原装的），所以这儿**只替克隆的
   * 那一份代打**——两边都叫一次的话，一次点击会开两回游戏。
   */
  function activate(target: Element | null): void {
    if (!target) return;
    const hit = target.closest<HTMLElement>('[data-strip-idx], [data-strip-role="knowhow"]');
    if (!hit) return;
    if (hit.dataset.stripRole === 'knowhow') {
      if (knowHowReal && !knowHowReal.contains(target) && knowHowReal !== target) knowHowReal.click();
      return;
    }
    const real = cards[Number(hit.dataset.stripIdx)];
    if (real && real !== hit) real.click();
  }

  const onClickCapture = (e: Event): void => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  if (!manual) {
    host.addEventListener('pointerdown', onDown);
    // window 的捕获阶段比 grid 上那个 armFirstPlayLock 更早（见文件头）。
    window.addEventListener('click', onClickCapture, true);
  }

  measure();
  /*
   * 屏幕高度一变（转屏、地址栏收起）就重量一遍。
   *
   * 带子占满一屏、上下两头从招牌和底排底下滑过去这件事，交给 CSS 去钉
   * （绝对定位 + 100svh，见 .mode-strip）。第一版是 JS 量一下 top 再负外边距往上
   * 挣，结果和**字体加载**抢跑：招牌的高度在字体到位后变了，那一量就早了几
   * 像素，整页于是高出 3–4px——手机上就是「页面能滑一点点」那一下死活。
   */
  const onResize = () => { mq.refresh(); };
  window.addEventListener('resize', onResize);
  if (opts.initial != null && opts.initial >= 0) {
    focusTo(Math.min(opts.initial, n - 1));
    lastReported = opts.initial;
  }

  return {
    focused,
    focusTo,
    destroy() {
      // 走之前把「他刚才在看哪一项」记下来（这一页是重画的，不记就没了）。
      report();
      host.removeEventListener('pointerdown', onDown);
      unwire();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('click', onClickCapture, true);
      host.style.marginTop = '';
      host.style.height = '';
      mq.destroy();
      host.classList.remove('mode-strip');
    },
  };
}
