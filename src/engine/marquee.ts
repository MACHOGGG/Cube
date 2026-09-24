/**
 * 一条无缝滚动的带子（竖着或横着都行），速度和倾斜跟着滑动速度走。
 *
 * 玩家 2026-09 第八轮点的第二件。这个模块**只管那条带子怎么动**，不管它放在哪
 * 一页、里面装什么——内容由调用的人传进来（`items`），位置由外面那层 CSS 决定。
 *
 * **方向由 `axis` 定**：`'y'` 是竖着走（主菜单那条，和以前的鱼眼轴同一个方
 * 向，只是换了效果），`'x'` 是横着走。下面一律管那一维叫「长」（span），
 * 竖着就是高度、横着就是宽度。
 *
 * 「无缝」的全部秘密就一句：内容摆**两份**，位移走过一份的长度就减掉那个长度。
 * 眼睛看到的永远是「第一份的后半截 + 第二份的前半截」，接缝处两份长得一模一
 * 样，于是看不出跳。两份就够——前提是**一份自己就比屏幕宽**（不然减完一份，屏
 * 幕右边会空出一块）。传进来的东西不够宽时，下面会在这一份里把内容重复摆几遍，
 * 先把一份撑到比屏幕宽，再复制成两份；不是摆三份四份。
 *
 * 四条硬规矩（玩家逐条点名的），每一条下面都有对应的代码：
 *
 *   1. **复制出来的那一份 `aria-hidden`**，否则读屏会把同样的内容念两遍。为了
 *      撑宽度而在同一份里重复摆的那几遍，同理也要藏起来——真正被念到的只有最前
 *      面那一组。
 *   2. **reduced-motion 时不自动滚**，只留手动横向滑。这时候只摆一份：手动滑的
 *      时候是有头有尾的，摆两份会让人以为内容出了重影。
 *   3. **只用 transform**（translate3d + skewX），不碰 left/margin——只有
 *      transform 和 opacity 不触发重排，这条带子每帧都在动，重排一次就掉帧。
 *   4. **页面切到后台就停 rAF**（document.hidden）。不停的话，切回来那一帧的 dt
 *      是「离开到回来」的整段时间，带子会瞬移一大截。
 *
 * 速度从哪来：自己按 `window.scrollY` 的逐帧差算，不问 Lenis 要。
 * 这样原生滚动、Lenis 阻尼、手机惯性滑三种情形是同一套数，这个模块也就不依赖
 * smoothScroll——那边在 reduced-motion 下和小红书那一版里压根不存在。
 */
import { reducedMotion } from './reducedMotion';

export interface MarqueeOpts {
  /** 带子里要摆的东西（一组）。这些节点会被真的放进去，事件监听照旧有效。 */
  items: HTMLElement[];
  /** 没人滚页面的时候，带子自己走多快（px/秒）。 */
  base?: number;
  /** 滚动加成：页面速度每 1 px/s，带子多走多少 px/s。 */
  velocityGain?: number;
  /** 倾斜：页面速度每 1 px/s 斜多少度。 */
  skewGain?: number;
  /** 倾斜上限（度）。玩家点名 ±6。 */
  maxSkew?: number;
  /**
   * 往哪一维走。`'y'` 竖着（主菜单那条），`'x'` 横着。缺省横着。
   */
  axis?: 'x' | 'y';
  /** 1 = 往前走（竖着是往上、横着是往左），-1 = 反过来。 */
  direction?: 1 | -1;
  /**
   * 重新量完、两份重搭好之后叫一声。
   *
   * 复制出来的那份是 `cloneNode`，**监听器不会跟着过去**。带子里的东西如果是
   * 可点的，外面要在这儿重新接一遍（或者干脆用事件委派，就不用管克隆不克隆）。
   * 没这一声的话，第二份里的按钮点下去没反应——正是「意料之外的疏漏操作」。
   */
  onRebuild?: () => void;
}

export interface Marquee {
  /** 屏幕宽度变了、或者内容换了之后重新量一遍。 */
  refresh(): void;
  /**
   * 停住（手指按下的那一下）。
   *
   * 带子上的东西如果是可点的，这一句是必须的：不停的话手指落下去的那一刻
   * 和抬起来的那一刻，下面压着的已经不是同一个东西了。
   */
  pause(): void;
  /** 松手：接着走。 */
  resume(): void;
  /** 手指横拖：直接推位移（超过一份宽度会自己绕回去）。 */
  nudge(dx: number): void;
  /** 现在的位移。 */
  offset(): number;
  /** 把位移设成某个值（恢复「上次看到哪儿」用）。 */
  setOffset(v: number): void;
  /** 一份内容的宽度，也就是绕回去的距离。 */
  span(): number;
  /** 现在是不是停着的（手指按着、或者页面在后台）。 */
  paused(): boolean;
  /**
   * 从外面给一个速度（px/秒），带子的加速和倾斜跟着它走。
   *
   * 为什么需要这一个：原本速度只从 `window.scrollY` 的逐帧差算。可主菜单是
   * **一屏装下的**、而且带子自己吃掉了滑动手势——页面压根儿不滚，scrollY 永远
   * 是 0，于是「速度和倾斜跟着滑动速度走」这一条实际上永远不会发生。玩家在带
   * 子上拖的那个速度才是他眼里的「滑动速度」，所以由外面（modeStrip）送进来。
   */
  drive(v: number): void;
  destroy(): void;
}

const DEF_BASE = 28;
const DEF_VGAIN = 0.35;
const DEF_SKEW_GAIN = 0.004;
const DEF_MAX_SKEW = 6;
/**
 * 速度的平滑系数（每帧往新值靠拢多少）。
 *
 * 逐帧差是很毛的——手指一抖就是几百 px/s，直接拿去算倾斜，带子会抽搐。0.18 大约
 * 是「三四帧追上」，看着是跟手的，又不抖。它同时也是玩家要的「停下来自己回零」：
 * 页面一停，raw 变 0，这个数自己指数衰减回去，不用另写一段回零动画。
 */
const VEL_SMOOTH = 0.18;
/** 一帧最多算 50ms。卡一下、或者刚从后台回来的那一帧，不许带子瞬移一大截。 */
const MAX_DT = 0.05;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function mountMarquee(host: HTMLElement, opts: MarqueeOpts): Marquee {
  const base = opts.base ?? DEF_BASE;
  const vGain = opts.velocityGain ?? DEF_VGAIN;
  const skewGain = opts.skewGain ?? DEF_SKEW_GAIN;
  const maxSkew = opts.maxSkew ?? DEF_MAX_SKEW;
  const dir = opts.direction ?? 1;
  const vert = (opts.axis ?? 'x') === 'y';

  host.classList.add('marquee');
  host.classList.toggle('marquee--y', vert);
  host.innerHTML = '';

  const track = document.createElement('div');
  track.className = 'marquee-track';
  host.appendChild(track);

  const copyA = document.createElement('div');
  copyA.className = 'marquee-copy';
  for (const it of opts.items) copyA.appendChild(it);
  track.appendChild(copyA);

  /**
   * reduced-motion：到此为止。
   *
   * 一份内容、外壳改成可以横着滑（见 .marquee--manual），不起 rAF、不复制第二
   * 份。玩家还是看得到全部内容，只是得自己拨——「不自动滚，只保留手动横向滑」。
   */
  if (reducedMotion()) {
    host.classList.add('marquee--manual');
    opts.onRebuild?.();
    return {
      refresh() { opts.onRebuild?.(); },
      pause() {}, resume() {}, nudge() {}, drive() {},
      offset: () => 0, setOffset() {}, span: () => 0, paused: () => true,
      destroy() { host.innerHTML = ''; },
    };
  }

  let copyB: HTMLElement | null = null;
  /** 一份内容的**长度**（竖着是高、横着是宽），也就是位移绕回去的距离。 */
  let copyW = 0;
  /** 量一个盒子在这根轴上的长度。 */
  const spanOf = (el: HTMLElement): number => {
    const r = el.getBoundingClientRect();
    return vert ? r.height : r.width;
  };
  let offset = 0;

  /**
   * 把一份撑到比屏幕宽，再复制成第二份。
   *
   * 「撑」是在同一份里把 items 再克隆几遍——克隆出来的全部 aria-hidden，读屏只
   * 念最前面那一组真的。上限 12 遍是个保险丝：万一传进来的 items 量出来是 0 宽
   * （字体还没到、图片还没加载），没有它这儿会转成死循环。
   */
  function build(): void {
    if (copyB) { track.removeChild(copyB); copyB = null; }
    // 先把上一次为了撑宽度补的那些克隆清掉，只留真的那一组。
    for (const extra of Array.from(copyA.querySelectorAll('.marquee-pad'))) extra.remove();

    const need = spanOf(host);
    let guard = 0;
    while (spanOf(copyA) < need && guard++ < 12) {
      for (const it of opts.items) {
        const c = it.cloneNode(true) as HTMLElement;
        c.classList.add('marquee-pad');
        c.setAttribute('aria-hidden', 'true');
        copyA.appendChild(c);
      }
    }
    copyW = spanOf(copyA);

    copyB = copyA.cloneNode(true) as HTMLElement;
    // 第二份整个是画，不是内容（规矩 1）。
    copyB.setAttribute('aria-hidden', 'true');
    track.appendChild(copyB);

    // 宽度变了之后，旧的位移可能已经超出一份，先归拢回去。
    if (copyW > 0) offset = ((offset % copyW) + copyW) % copyW - copyW;

    // 克隆出来的那份没有监听器，外面要知道这一下（见 opts.onRebuild）。
    opts.onRebuild?.();
  }

  let raf = 0;
  let last = 0;
  let lastY = 0;
  let vel = 0;
  /** 外面送进来的速度（玩家在带子上拖的那个，见 drive）。 */
  let extern = 0;
  /** 手指正按着（或者外面叫了 pause）：不自己走，但帧还在跑（拖动要画）。 */
  let held = false;

  /** 走过一份就减掉一份——这是「无缝」的全部秘密。 */
  function wrap(): void {
    if (copyW <= 0) return;
    while (offset <= -copyW) offset += copyW;
    while (offset > 0) offset -= copyW;
  }

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;

    const y = window.scrollY || window.pageYOffset || 0;
    /*
     * 两个来源加起来：页面自己滚了多快，加上玩家在带子上拖得多快。
     *
     * 只算前者的话，主菜单这种「一屏装下、而且带子自己吃掉了手势」的页面上
     * scrollY 永远是 0，「速度和倾斜跟着滑动速度走」就永远不会发生。
     */
    const raw = (dt > 0 ? (y - lastY) / dt : 0) + extern;
    lastY = y;
    vel += (raw - vel) * VEL_SMOOTH;
    // 外来的那一份是一次性的：手指一停它就该衰下去（玩家要的「停下来自己回零」）。
    extern *= 0.82;

    if (copyW > 0 && !held) {
      offset -= (base + Math.abs(vel) * vGain) * dt * dir;
      wrap();
    }
    const skew = clamp(vel * skewGain, -maxSkew, maxSkew);
    /*
     * 倾斜一律用 skewX，两个方向都是。
     *
     * 竖着跑的时候，skewX 把整列按「离中线多远」横向抽一下——看上去就是整列
     * 顺着走势斜一下，正是「速度感」那一下。换成 skewY 对一条窄列几乎看不出来。
     */
    const t = vert ? `translate3d(0,${offset.toFixed(2)}px,0)` : `translate3d(${offset.toFixed(2)}px,0,0)`;
    track.style.transform = `${t} skewX(${skew.toFixed(2)}deg)`;

    raf = requestAnimationFrame(frame);
  }

  function play(): void {
    if (raf) return;
    // 重新起步时把时间和滚动位置都对一次表，否则第一帧的 dt / 速度是离开前的旧账。
    last = performance.now();
    lastY = window.scrollY || window.pageYOffset || 0;
    raf = requestAnimationFrame(frame);
  }
  function pause(): void {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // 规矩 4：切到后台就停，回来再接着走。
  const onVis = () => { if (document.hidden) pause(); else play(); };
  document.addEventListener('visibilitychange', onVis);

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(build, 120);
  };
  window.addEventListener('resize', onResize);

  build();
  play();

  return {
    refresh: build,
    pause() { held = true; },
    resume() { held = false; },
    nudge(dx: number) { offset += dx; wrap(); },
    offset: () => offset,
    setOffset(v: number) { offset = v; wrap(); },
    span: () => copyW,
    paused: () => held || !raf,
    drive(v: number) { extern = v; },
    destroy() {
      pause();
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      host.innerHTML = '';
      host.classList.remove('marquee', 'marquee--manual');
    },
  };
}
