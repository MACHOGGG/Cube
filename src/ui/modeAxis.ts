/**
 * 主菜单的鱼眼轴（手机竖屏那一路）。
 *
 * 出处是《玩法选择器「物理化聚焦」改造 · 实施方案 v1.0》的 §2 手机端规格。它把
 * 从前那张「两列七排、往下滚」的网格换成**一条竖轴**：手指在哪，轴上那一带就按
 * 距离连续隆起——被聚焦的那张卡最大，左右各一张跟着变，第三张起回到基准态；间距
 * 也一起变，所以整条轴像一块有弹性的材质被按住，不是一个孤立的图标在自己胀大。
 *
 * 玩家 2026-09 拍板的几条，都在这儿：
 *   · **全摊平**：13 张卡各占轴上一站，没有「点开再挑」的分组。（炸弹的三档三
 *     形、计时挑形状仍然保留——那是进了玩法之后的选择，不是菜单条目。）
 *   · **手机端不循环**：滑到两端就停，带一次轻微回弹。
 *   · **焦点锁定不做开关**：首版直接做死（§1.2）。
 *   · **reduced-motion 下只在定格那一刻出声**，快速滑过不播。
 *   · **首玩期轴上只摆基础方块和基础小球**，打完第一局（或按过《我会玩》）其余
 *     的才长出来——这一条由 menu.ts 决定要把哪几张卡交给它，这个文件不管。
 *
 * 形变、弹簧、距离换算全部来自 engine/fisheye.ts 和 engine/spring.ts（那两份有
 * 门守着：scripts/check-fisheye.mjs）。这个文件只做三件事：把卡片摆到算出来的位
 * 置上、把手指的位移换成焦点、在该出声的时候出声。
 */
import { fisheye, hitTest, SIGMA, type FisheyeLayout, type FisheyeParams } from '../engine/fisheye';
import { createSpring, snapSpring, springAtRest, stepSpring, type SpringState } from '../engine/spring';
import { reducedMotion } from '../engine/reducedMotion';
import { playAxisTick } from '../engine/juice';

/**
 * 一张卡的「站位」有多高，以及聚焦时能长到多大。
 *
 * 数是这么来的：卡片的图在轴上统一按 **112px 高**摆（见 style.css 的
 * `--axis-art`），底下那行小字约 23px，一站就是 135px 左右。
 *
 *   · `maxScale = 1.34` → 聚焦那张的图有 150px，比从前网格里的 130px **还大**。
 *     这是鱼眼的交易：正在看的那一张比从前大，两侧的小一点。
 *   · 间距 146 → 186。最紧的一对是「聚焦的那张」和它的邻居：半高
 *     135×1.34/2 = 90.5 加 135×1.183/2 = 79.9 ＝ 170.4，而那一段的间距是
 *     146 + 40×0.857 = 180.3 —— 留 10px 缝，不相撞。（相撞的后果不是难看，是
 *     点错：两张卡的热区叠在一起。门 check-mode-axis 逐对量这件事。）
 *   · `lockRadius = 0.22` 项：手指在一张卡上下 22% 站距内抖动时，整条轴冻住不
 *     动，他才好从容落点（§1.2 那条补丁的出处是 Bederson 2000 的用户测试：位置
 *     会挪的鱼眼菜单，选取反而更慢）。
 */
const PARAMS: FisheyeParams = {
  sigma: SIGMA,
  minScale: 1,
  maxScale: 1.34,
  minGap: 146,
  maxGap: 186,
  lockRadius: 0.22,
};

/** reduced-motion 下用的那一套：一把没有弹性的尺子，位置照旧跟手，但不形变。 */
const RIGID: FisheyeParams = {
  ...PARAMS,
  maxScale: PARAMS.minScale,
  maxGap: PARAMS.minGap,
  lockRadius: 0,
};

/** 超出端点之后还能拉多远（单位＝项），以及拉出去时手指位移打几折。 */
const OVERSCROLL = 0.55;
const RUBBER = 0.35;
/** 位移超过这么多像素就算「拖」，不算「点」——否则滑一下手会误开一个玩法。 */
const TAP_SLOP = 10;

export interface ModeAxisOpts {
  /** 轴上的卡，按顺序。menu.ts 造好了原样交过来——美术内容一个字都不改。 */
  cards: readonly HTMLElement[];
  /** 一开始停在哪一项。回主菜单时要停在他离开时那一项上（玩家定过「返回主页不自动置顶」）。 */
  initial?: number;
  /**
   * 聚焦项换了就报一声，调用方好把它记住。
   *
   * 为的是上面那条：主菜单是重画的（renderMenu 每次都把容器清空），轴自己活不到
   * 下一次，记在外面才留得住。
   */
  onFocus?: (index: number) => void;
}

export interface ModeAxis {
  /** 现在停在哪一项（离焦点最近的那个）。 */
  focused(): number;
  /** 从外面把焦点设过去（键盘 Tab、以后的点点轴都走这儿）。 */
  focusTo(index: number, animate?: boolean): void;
  destroy(): void;
}

/**
 * 把这些卡摆成一条鱼眼轴。
 *
 * `host` 就是 `#homeGrid`：它在 CSS 里已经是「撑满剩下的高度」那一块，这儿只
 * 把它变成定位容器，然后把卡片绝对定位进去。
 */
export function mountModeAxis(host: HTMLElement, opts: ModeAxisOpts): ModeAxis {
  const cards = opts.cards.slice();
  const n = cards.length;
  host.classList.add('mode-axis');
  host.innerHTML = '';
  for (const c of cards) host.appendChild(c);

  /** 焦点：一个实数，2.4 就是第 2 张和第 3 张之间。 */
  let focus = Math.min(Math.max(opts.initial ?? 0, 0), Math.max(n - 1, 0));
  let hostH = 0;
  let raf = 0;
  let dragging = false;
  let captured = false;
  let moved = 0;
  let startY = 0;
  let startFocus = 0;
  let ruler: FisheyeLayout | null = null;
  const spring: SpringState = createSpring(focus);
  let springing = false;
  let lastNearest = Math.round(focus);
  let destroyed = false;

  const params = () => (reducedMotion() ? RIGID : PARAMS);

  /**
   * 轴有多高：自己量，不写死。
   *
   * 量法是「整页底边减去轴的底边」＝ 轴下面那些东西（法务那五条链接 + 页面给底
   * 排留的那截内边距）占了多少，再拿视口高度减掉轴的顶边和这一截。写死一个常数
   * 迟早和 CSS 走散——这个仓库为「按 100dvh 算图标大小，手机一上滑地址栏收起来
   * 图标就胀大一圈」已经栽过一次，教训是尺寸要么是定数、要么现量。
   */
  function measure(): void {
    const page = host.closest('.app');
    host.style.height = '0px';
    const hr = host.getBoundingClientRect();
    const below = page ? page.getBoundingClientRect().bottom - hr.bottom : 0;
    hostH = Math.max(260, Math.round(window.innerHeight - hr.top - below));
    host.style.height = hostH + 'px';
  }

  function paint(): void {
    if (destroyed || n === 0) return;
    const L = fisheye(n, focus, params(), {});
    for (const s of L.slots) {
      const el = cards[s.index];
      // 逐帧只动 transform（§5.4：不许逐帧改 box-shadow / filter，那要软件光栅化）。
      // 卡片是整幅宽的（见 style.css 的 .mode-axis > .home-icon-btn），所以横向
      // 不用再 -50%，只把纵向拉回自己的一半高，再叠上这一帧算出来的偏移。
      el.style.transform = `translateY(-50%) translateY(${s.at.toFixed(2)}px) scale(${s.scale.toFixed(4)})`;
      // 聚焦那张压在上面：形变之后相邻两张的边距只剩十来个像素，层序错了会看见
      // 大的那张被小的压住一条边。
      el.style.zIndex = String(10 + Math.round(s.inf * 90));
      // 看不见的就别挡手（绝对定位的卡即使在屏幕外也照样命中）。
      //
      // 藏法是 `opacity: 0`，**不是 `visibility: hidden`**：后者的元素键盘聚焦
      // 不到，于是 Tab 只走得到当下露在轴上的那四五张，剩下九张玩法用键盘永远
      // 到不了（门 check-mode-axis 里「拖动换得了聚焦项」那条先红的就是这个：
      // 门想 focus() 一张藏起来的卡，浏览器一声不响地没给焦点）。用 opacity
      // 藏着的卡照样聚焦得到，而 focusin 会立刻把它带到轴中间来——一 Tab 就看见。
      const off = Math.abs(s.at) > hostH / 2 + 140;
      el.style.opacity = off ? '0' : '';
      el.style.pointerEvents = off ? 'none' : '';
      el.style.willChange = !off && s.d < 2 ? 'transform' : '';
    }
    const near = L.nearest;
    if (near !== lastNearest) {
      lastNearest = near;
      opts.onFocus?.(near);
      // §5.2：只在「聚焦项换了」这一个离散事件上出一声，不跟着连续的形变播。
      // reduced-motion 下拖动途中一声不出，只在松手定格那一下出——玩家原话：
      // 「只在最后选中一个图标停下来的那一刻出声，快速滑过的时候不播」。
      if (!reducedMotion()) tick();
    }
  }

  /**
   * 聚焦换了那一声。
   *
   * 玩家 2026-09 点名：**cuelume 的 scan**（和暂停同一个音色，见 juice.ts 的
   * CUE.axis；音量比暂停低一档，因为一次滑动会连响好几下）。
   */
  function tick(): void {
    try {
      playAxisTick();
    } catch {
      /* 音频还没解锁（第一次手势之前）：不响就不响，不能因此断掉手势 */
    }
  }

  function loop(): void {
    raf = 0;
    if (destroyed) return;
    if (springing) {
      const target = Math.min(Math.max(Math.round(spring.value), 0), n - 1);
      stepSpring(spring, target, 16.7);
      focus = spring.value;
      if (springAtRest(spring, target)) {
        springing = false;
        focus = target;
        spring.value = target;
      }
      paint();
      if (springing) schedule();
      else settled();
    }
  }

  function schedule(): void {
    if (!raf && !destroyed) raf = requestAnimationFrame(loop);
  }

  /** 停稳那一刻。reduced-motion 下的唯一一声就在这儿。 */
  function settled(): void {
    if (reducedMotion()) tick();
  }

  /**
   * 手指位移 → 焦点，1:1。
   *
   * 拿**按下那一刻**的那份布局当尺子，而不是每帧重新量：抓住的那一点要一直贴着
   * 手指，而各项位置本身正在被形变重新分配。尺子是静的，手感才是 1:1 的；拿正在
   * 形变的布局当尺子会自己喂自己，轴会抖。
   */
  function focusFromDrag(dy: number): number {
    const L = ruler;
    if (!L || n < 2) return startFocus;
    const want = -dy; // 手指往下 → 轴往下走 → 焦点往前
    const slots = L.slots;
    // 落在两项之间就线性插值；落在两端之外按基准间距外推。
    if (want <= slots[0].at) return 0 + (want - slots[0].at) / PARAMS.minGap;
    const last = slots[n - 1];
    if (want >= last.at) return n - 1 + (want - last.at) / PARAMS.minGap;
    for (let i = 0; i < n - 1; i++) {
      const a = slots[i];
      const b = slots[i + 1];
      if (want >= a.at && want <= b.at) {
        const span = b.at - a.at || PARAMS.minGap;
        return i + (want - a.at) / span;
      }
    }
    return startFocus;
  }

  /** 拉出端点之外要费力：超出的那一截打折，松手再弹回去（§2 的「到底了」回弹）。 */
  function clampRubber(f: number): number {
    if (f < 0) return Math.max(-OVERSCROLL, f * RUBBER);
    const max = n - 1;
    if (f > max) return Math.min(max + OVERSCROLL, max + (f - max) * RUBBER);
    return f;
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    captured = false;
    moved = 0;
    startY = e.clientY;
    startFocus = focus;
    springing = false;
    ruler = fisheye(n, focus, params(), {});
    // 这儿**不能**立刻 setPointerCapture。捕获之后 pointerup 的目标变成容器，浏
    // 览器就把 click 派到「pointerdown 和 pointerup 的最近公共祖先」——也就是容
    // 器——卡片自己的 click 永远不触发，**点一下打不开任何玩法**。（门
    // check-mode-axis 的「点一下就进那个玩法」逮到的正是这个。）
    // 所以捕获推迟到「已经算拖动了」那一刻，见 onMove。
  }

  function onMove(e: PointerEvent): void {
    if (!dragging) return;
    const dy = e.clientY - startY;
    moved = Math.max(moved, Math.abs(dy));
    // 一旦确定是拖动，才把指针捕获过来：这样手指滑出容器（滑到标题或法务链接上）
    // 也还跟着走，而「点一下」那条路一次都不会碰到捕获。
    if (!captured && moved > TAP_SLOP) {
      captured = true;
      try {
        host.setPointerCapture?.(e.pointerId);
      } catch {
        /* 有些内核在某些时序下会拒绝捕获：不捕获只是滑出容器会断，不影响主路 */
      }
    }
    focus = clampRubber(focusFromDrag(dy));
    paint();
  }

  function onUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    if (captured) {
      try {
        host.releasePointerCapture?.(e.pointerId);
      } catch {
        /* 已经自动释放了 */
      }
    }
    ruler = null;
    // §5.3 离散定格：松手必须停在某一项上，不能停在两项中间。
    const target = Math.min(Math.max(Math.round(focus), 0), n - 1);
    if (reducedMotion()) {
      // §5.1：这台设备要求少动画，那就直接跳过去，不要过渡。
      focus = target;
      snapSpring(spring, target);
      paint();
      settled();
      return;
    }
    spring.value = focus;
    spring.velocity = 0;
    springing = true;
    schedule();
  }

  /**
   * 点一张卡就开那个玩法——**一下就开，不是先聚焦再点第二下**。
   *
   * 两下才开等于把全站最常用的那一下操作变成两下。焦点锁定（§1.2）加上按渲染位
   * 置判定的 hitTest，落点已经足够准；真正要防的是「滑动的尾巴被当成点击」，那
   * 由下面这个位移阈值挡掉。
   */
  function onClickCapture(e: Event): void {
    if (moved > TAP_SLOP) {
      e.stopPropagation();
      e.preventDefault();
      moved = 0;
    }
  }

  /**
   * 键盘 Tab 到一张卡上：把它带到焦点来。
   *
   * 不接这一条的后果是「焦点在屏幕外的一个按钮上」——看不见、也不知道现在选的是
   * 谁。卡本身是 <button>，Tab 本来就走得到。
   */
  function onFocusIn(e: FocusEvent): void {
    // 浏览器给一个刚获得焦点的元素「滚动到可见」时，会去动这个带 overflow:hidden
    // 的容器的 scrollTop——那会把整条轴连坐标系一起挪走，而 JS 算的位置还是按没
    // 滚过算的。归零一次，比事后找原因便宜。
    if (host.scrollTop !== 0) host.scrollTop = 0;
    if (host.scrollLeft !== 0) host.scrollLeft = 0;
    const i = cards.indexOf((e.target as HTMLElement)?.closest?.('.home-icon-btn') as HTMLElement);
    if (i >= 0 && Math.round(focus) !== i) focusTo(i, !reducedMotion());
  }

  function focusTo(index: number, animate = true): void {
    const target = Math.min(Math.max(index, 0), Math.max(n - 1, 0));
    if (!animate || reducedMotion()) {
      focus = target;
      snapSpring(spring, target);
      springing = false;
      paint();
      return;
    }
    spring.value = focus;
    spring.velocity = 0;
    springing = true;
    schedule();
    // 弹簧的目标是「离当前值最近的整数项」，所以先把 focus 推到目标附近一格内，
    // 它才会往对的方向收（否则从第 0 项跳到第 12 项会原地不动）。
    focus = target + (focus > target ? 0.49 : -0.49);
    spring.value = focus;
  }

  function onResize(): void {
    measure();
    paint();
  }

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('click', onClickCapture, true);
  host.addEventListener('focusin', onFocusIn);
  window.addEventListener('resize', onResize);

  measure();
  paint();

  return {
    focused: () => Math.min(Math.max(Math.round(focus), 0), Math.max(n - 1, 0)),
    focusTo,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.removeEventListener('click', onClickCapture, true);
      host.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('resize', onResize);
      host.classList.remove('mode-axis');
      host.style.height = '';
    },
  };
}

/** 门要用：把那几个数摆出来，免得门自己抄一份然后和实现走散。 */
export const AXIS_PARAMS = PARAMS;
export { hitTest };
