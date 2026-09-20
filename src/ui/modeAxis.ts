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
 *   · **循环**：玩家 2026-09 第二轮改的口径——「没有做到任何循环的效果」。原先
 *     按第一轮的「手机端不循环」做成滑到两端就停 + 回弹，实际用起来是「到头了」
 *     的顿挫，13 张卡里想从最后一张回到第一张要整条滑回去。现在整条轴是一个
 *     **环**（`fisheye` 的 wrap 模式，见 engine/fisheye.ts 头注释第 ③ 条），往
 *     哪边滑都走得通。卡少于 6 张时不成环（首玩期轴上只有两张，成环会让同一张
 *     卡同时出现在上下两头），那时候照旧到头就停。
 *   · **焦点锁定不做开关**：首版直接做死（§1.2）。
 *   · **reduced-motion 下只在定格那一刻出声**，快速滑过不播。
 *   · **首玩期轴上只摆基础方块和基础小球**，打完第一局（或按过《我会玩》）其余
 *     的才长出来——这一条由 menu.ts 决定要把哪几张卡交给它，这个文件不管。
 *
 * 形变、弹簧、距离换算全部来自 engine/fisheye.ts 和 engine/spring.ts（那两份有
 * 门守着：scripts/check-fisheye.mjs）。这个文件只做三件事：把卡片摆到算出来的位
 * 置上、把手指的位移换成焦点、在该出声的时候出声。
 */
import { fisheye, hitTest, influence, SIGMA, type FisheyeParams } from '../engine/fisheye';
import { createSpring, snapSpring, springAtRest, stepSpring, type SpringState } from '../engine/spring';
import { reducedMotion } from '../engine/reducedMotion';
import { playAxisTick } from '../engine/juice';

/**
 * 一张卡的「站位」有多高，以及聚焦时能长到多大。
 *
 * 数是这么来的：卡片的图在轴上统一按 **112px 高**摆（见 style.css 的
 * `--axis-art`），底下那行小字约 23px，一站就是 135px 左右。
 *
 *   · 2026-09 第二轮按玩家给的效果图**收了一档**：图 112 → 100px，间距
 *     146/186 → 130/164，最大缩放 1.34 → 1.26。
 *
 *     为什么收：效果图上一屏看得见**四张**卡（上下两头再化开半张）。而轴分到的
 *     高度是视口减掉标题、法务那五条链接和底排，390×844 的手机上只剩 530px 左
 *     右——按原先 146 的间距只摆得下 3 张，于是玩家说的「不应该只有中间这一部分
 *     能看到」有一半是「根本没几张」。130 的间距刚好 4 张出头。
 *   · 最紧的一对还是「聚焦的那张」和它的邻居：一站高 100 + 23（小字）= 123，
 *     半高 123×1.26/2 = 77.5 加 123×1.223/2 = 75.2 ＝ 152.7，而那一段的间距是
 *     130 + 34×0.857 = 159.1 —— 留 6px 缝，不相撞。（相撞的后果不是难看，是
 *     点错：两张卡的热区叠在一起。门 check-mode-axis 逐对量这件事。）
 *   · `lockRadius = 0.22` 项：手指在一张卡上下 22% 站距内抖动时，整条轴冻住不
 *     动，他才好从容落点（§1.2 那条补丁的出处是 Bederson 2000 的用户测试：位置
 *     会挪的鱼眼菜单，选取反而更慢）。
 */
const PARAMS: FisheyeParams = {
  sigma: SIGMA,
  minScale: 1,
  maxScale: 1.26,
  minGap: 130,
  maxGap: 164,
  lockRadius: 0.22,
};

/** reduced-motion 下用的那一套：一把没有弹性的尺子，位置照旧跟手，但不形变。 */
const RIGID: FisheyeParams = {
  ...PARAMS,
  maxScale: PARAMS.minScale,
  maxGap: PARAMS.minGap,
  lockRadius: 0,
};

/** 超出端点之后还能拉多远（单位＝项），以及拉出去时手指位移打几折。只在**不成环**
 *  的那一档（卡少于 WRAP_MIN 张）用得上——成环之后没有「端点」这回事。 */
const OVERSCROLL = 0.55;
const RUBBER = 0.35;
/** 少于这么多张就不成环：两三张卡围成的环会让同一张同时出现在上下两头。 */
const WRAP_MIN = 6;
/**
 * 上下两头怎么淡出。
 *
 * 玩家 2026-09 第二轮：「上和下的部分不应该是遮盖的，而是透明的，不应该只有中间
 * 这一部分能看到」。原先是一刀切——离中心超过半屏 +140px 就 `opacity: 0`，于是轴
 * 的上下缘看着像被一块板盖住。现在改成一段**渐变**：从 FADE_FROM（离中心多少像素
 * 起开始淡）到轴边缘线性掉到 0，容器再叠一层同样走向的 mask（见 style.css 的
 * `.mode-axis`），所以边缘是化开的，不是切断的。
 *
 * 透到 FADE_MIN 以下就不再吃手势了——看不见的东西不该挡着点下面那张。
 */
const FADE_TAIL = 150;
const FADE_MIN = 0.06;
/**
 * 两侧那两条点点轴（玩家给的效果图上，左右两边各一列小圆点）。
 *
 * 它是「我在这 13 项的哪儿」的唯一提示——轴上一次只看得见四五张卡，没有它，玩家
 * 不知道自己滑到了第几项、还有多少没看。点子按**项**等距排（不跟着卡片的形变走），
 * 离焦点越近越大越亮，所以中间那一颗永远对着当前选中的那张卡。
 */
const RAIL_PITCH = 13;
const RAIL_DOT_MIN = 4;
const RAIL_DOT_MAX = 9;
const RAIL_SPAN = 4.6;
/** 按下那一刻合成的尺子往两边各排几格（见 localRuler）。 */
const RULER_SPAN = 8;
/**
 * 那条隆起在整条轴上一共鼓出来多少（以「一份 maxGap−minGap」为单位）。
 *
 * ＝ Σ influence(k + 0.5)，k 取遍整数。σ = 0.9 时：0.857×2 + 0.249×2 + 0.021×2
 * + … ≈ 2.256。和项数无关（再远的项贡献已经小于 0.001）。成环时拿它算整圈长度，
 * 见 wrapTotal。
 */
const SWELL_SUM = 2.256;
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

  /** 这一轴成不成环（见 WRAP_MIN）。 */
  const wrap = n >= WRAP_MIN;
  /**
   * 整圈多长。
   *
   * `fisheye` 在 wrap 模式下会把这一圈的间距**等比缩回**这个数（隆起的相对关系
   * 不变）。所以这个数要正好等于「不缩之前的一圈」，缩放系数才是 1，远离焦点的
   * 地方间距才还是 minGap。
   *
   * 不缩之前的一圈 = 基准间距 × 项数 ＋ 焦点那一带鼓出来的总量。后者是那条高斯
   * 在所有半整数点上的和，和项数无关，σ = 0.9 时约 2.256（见 SWELL_SUM）。
   *
   * 少算这一截的代价是实打实的：第一版写的是 `n * minGap`，于是整圈被缩掉 4%，
   * 环背面那几张的间距从 130 掉到 124.7——比一站的高度（122）只多 2.7px，门
   * check-mode-axis 逐对量下来最紧的一对只剩 1.0px，再往下就是两张卡的热区叠在
   * 一起、点错玩法。
   */
  const wrapTotal = n * PARAMS.minGap + (PARAMS.maxGap - PARAMS.minGap) * SWELL_SUM;
  const fisheyeOpts = wrap ? { wrap: true, wrapTotal } : {};

  /**
   * 两侧的点点轴。
   *
   * `pointer-events: none`：它是路标，不是控件——手指按在上面照样是在拖轴，不会
   * 因为「按到点子上」而漏掉一次拖动。
   */
  function makeRail(side: 'l' | 'r'): { rail: HTMLElement; dots: HTMLElement[] } {
    const rail = document.createElement('div');
    rail.className = `axis-rail axis-rail--${side}`;
    rail.setAttribute('aria-hidden', 'true');
    const dots: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      d.className = 'axis-dot';
      rail.appendChild(d);
      dots.push(d);
    }
    host.appendChild(rail);
    return { rail, dots };
  }
  const railL = makeRail('l');
  const railR = makeRail('r');

  /** 焦点：一个实数，2.4 就是第 2 张和第 3 张之间。 */
  let focus = Math.min(Math.max(opts.initial ?? 0, 0), Math.max(n - 1, 0));
  let hostH = 0;
  /** 一站（卡片本身）多高——量出来的，用来算「露出半张」那条边界。 */
  let stationH = 130;
  let raf = 0;
  let dragging = false;
  let captured = false;
  let moved = 0;
  let startY = 0;
  let startFocus = 0;
  let ruler: { k: number; at: number }[] | null = null;
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
    host.style.height = '0px';
    const hr = host.getBoundingClientRect();
    /**
     * 轴一直铺到**底排那一条**为止，不是铺到 `.app` 的底边。
     *
     * 从前是后者，于是法务那五条链接（`.home-legal`，`.app` 里轴下面的那一块）
     * 也被算进「轴下面占了多少」，轴因此短一截，而那五条链接一直挂在屏幕下方。
     * 玩家 2026-09 第二轮：「不要一直展示在屏幕的下方……放在最底下就是只有滑到
     * 最最最底下的时候才能看到」。改成量底排之后，轴占满第一屏，那五条自然被顶
     * 到屏幕外，往下滑才看得见——就是普通网站页脚的样子。（它们不能删：收单方
     * 的审核要在落地页上找得到，见 menu.ts 那段注释。）
     *
     * 底排那一条的类名是 `.home-nav`（`bottomNav.ts` 挂在 <body> 上的那个
     * `<nav>`，不是里面那块圆角面板 `.home-nav-dock`）——它是 position: fixed
     * 的，量它的上沿最准，而且它的上沿已经把「选中那颗升起来」留的那点空算进去
     * 了。**类名写错不会报错，只会悄悄退回视口底边**，于是轴一路铺到屏幕最底、
     * 压在底排下面——这儿一开始写的就是不存在的 `.bottom-nav`。它要是没画出来
     * （高度 0），才退回视口底边。
     */
    const nav = document.querySelector('.home-nav');
    const nr = nav?.getBoundingClientRect();
    const floor = nr && nr.height > 0 ? Math.min(nr.top, window.innerHeight) : window.innerHeight;
    /**
     * 首玩期那颗《我会玩》要留在第一屏上。
     *
     * 它排在轴和法务链接之间（menu.ts）。轴一铺到底，它会跟着法务那几条一起被
     * 顶出屏幕——而它是「跳过引导」的唯一出口，藏起来等于没有。所以量到它就把
     * 它那一截让出来。
     */
    const skip = document.querySelector('.know-how-btn');
    const sr = skip?.getBoundingClientRect();
    const keep = sr && sr.height > 0 ? sr.height + 18 : 0;
    hostH = Math.max(260, Math.round(floor - 10 - keep - hr.top));
    host.style.height = hostH + 'px';
    if (cards[0]) stationH = Math.max(60, cards[0].offsetHeight);
    pushLegal();
  }

  /**
   * 把法务那五条链接推到第一屏**外面**。
   *
   * 轴只铺到底排上沿（上面那段），底排那一条是 fixed 的、不占文档高度，于是紧
   * 跟在轴后面的那五条链接正好落在底排那一带——390×844 上量到链接顶 764，还在
   * 屏幕里，只是被底排压着。玩家 2026-09 第二轮要的是「只有滑到最最最底下的时
   * 候才能看到」，所以这儿补一截外边距，把它们顶到视口底边以下。
   *
   * 为什么是量出来的而不是写死一个数：这一截等于「底排有多高」加「轴和页脚之
   * 间本来的那些间距」，两样都跟着安全区、字号、语言变。先把内联的外边距清掉
   * 量它的静止位置（`''` 会退回 style.css 里那条 26px），再按差值补。用文档坐
   * 标（rect + scrollY）比视口坐标稳——measure() 也会在页面已经滑下去之后跑。
   * 静止的那一截也是**读出来的**（清掉内联样式之后问 getComputedStyle），不在这
   * 儿再抄一份 26px：抄了就会跟 style.css 走散。
   *
   * 这几条不能删：收单方的审核要在落地页上找得到（见 menu.ts 那段注释）。
   */
  function pushLegal(): void {
    const legal = document.querySelector<HTMLElement>('.home-legal');
    if (!legal) return;
    legal.style.marginTop = '';
    const rest = parseFloat(getComputedStyle(legal).marginTop) || 0;
    const docTop = legal.getBoundingClientRect().top + window.scrollY;
    const push = Math.ceil(window.innerHeight + 8 - docTop);
    if (push > 0) legal.style.marginTop = rest + push + 'px';
  }

  /**
   * 上一帧给每张卡写过的那几样。
   *
   * 逐帧无脑写 style 是这条轴「很卡」的一半原因：一次 paint 要动 13 张卡 × 5 个
   * 属性，其中 zIndex 会让浏览器重排层序、willChange 反复设/清会反复建图层和拆
   * 图层——都是**每一帧**都在做，而实际上一帧里真正变了的只有 transform 和
   * opacity。这儿记住上一帧的值，变了才写。
   */
  const lastPaint = cards.map(() => ({ t: '', o: '', z: 0, pe: '' }));
  const lastDot = cards.map(() => '');

  function paint(): void {
    if (destroyed || n === 0) return;
    const L = fisheye(n, focus, params(), fisheyeOpts);
    const edge = hostH / 2;
    for (const s of L.slots) {
      const el = cards[s.index];
      const prev = lastPaint[s.index];
      // 逐帧只动 transform / opacity（§5.4：不许逐帧改 box-shadow / filter，那要
      // 软件光栅化）。卡片是整幅宽的（见 style.css 的 .mode-axis > .home-icon-btn），
      // 所以横向不用再 -50%，只把纵向拉回自己的一半高，再叠上这一帧的偏移。
      // translate3d 打头是为了让它整张进合成层——`will-change: transform` 由 CSS
      // 常设（不再逐帧开关），两样配起来，滑动时不再每帧重新栅格化那张大 SVG。
      const t = `translate3d(0,-50%,0) translateY(${s.at.toFixed(2)}px) scale(${s.scale.toFixed(4)})`;
      if (t !== prev.t) { el.style.transform = t; prev.t = t; }
      // 聚焦那张压在上面：形变之后相邻两张的边距只剩十来个像素，层序错了会看见
      // 大的那张被小的压住一条边。
      const z = 10 + Math.round(s.inf * 90);
      if (z !== prev.z) { el.style.zIndex = String(z); prev.z = z; }
      /**
       * 上下两头**化开**，不是切断。
       *
       * 玩家原话：「上和下的部分不应该是遮盖的，而是透明的」。所以这儿不再是
       * 「超出半屏就 opacity: 0」那一刀，而是从 edge − FADE_TAIL 起线性淡到边缘
       * 的 0；容器上还叠了一层同样走向的 mask，两样一起，边缘看着是化开的。
       *
       * 淡法是 `opacity`，**不是 `visibility: hidden`**：后者的元素键盘聚焦不到，
       * 于是 Tab 只走得到当下露在轴上的那四五张，剩下九张玩法用键盘永远到不了
       * （门 check-mode-axis 里「拖动换得了聚焦项」那条先红的就是这个：门想
       * focus() 一张藏起来的卡，浏览器一声不响地没给焦点）。用 opacity 淡掉的卡
       * 照样聚焦得到，而 focusin 会立刻把它带到轴中间来——一 Tab 就看见。
       */
      const far = Math.abs(s.at);
      // 边界要加上**半张卡**：中心正好压在边上的那一张，还有半张在里头。不加这
      // 一截，它的透明度按中心算已经是 0，于是轴上永远只看得见三张，上下两头是
      // 空的——玩家说的「不应该只有中间这一部分能看到」正是这个。加上之后它露出
      // 半张、淡淡地挂在边上，和效果图一样。
      const a = Math.max(0, Math.min(1, (edge + stationH * 0.55 - far) / FADE_TAIL));
      const o = a >= 0.999 ? '' : a.toFixed(3);
      if (o !== prev.o) { el.style.opacity = o; prev.o = o; }
      // 看不见的就别挡手（绝对定位的卡即使在屏幕外也照样命中）。
      const pe = a < FADE_MIN ? 'none' : '';
      if (pe !== prev.pe) { el.style.pointerEvents = pe; prev.pe = pe; }

      // 点点轴：按**项**等距排，不跟着卡片的形变走——它量的是「第几项」，中间那
      // 颗永远对着当前选中的那张。
      let k = s.index - L.lockedFocus;
      if (wrap) {
        k = ((k % n) + n) % n;
        if (k > n / 2) k -= n;
      }
      const dotA = Math.max(0, Math.min(1, (RAIL_SPAN - Math.abs(k)) / 1.6)) *
        (0.28 + 0.72 * s.inf);
      const size = RAIL_DOT_MIN + (RAIL_DOT_MAX - RAIL_DOT_MIN) * s.inf;
      const dt = `translate3d(-50%,-50%,0) translateY(${(k * RAIL_PITCH).toFixed(2)}px)`;
      const key = `${dt}|${size.toFixed(2)}|${dotA.toFixed(3)}`;
      if (key !== lastDot[s.index]) {
        lastDot[s.index] = key;
        for (const dot of [railL.dots[s.index], railR.dots[s.index]]) {
          dot.style.transform = dt;
          dot.style.width = size.toFixed(1) + 'px';
          dot.style.height = size.toFixed(1) + 'px';
          dot.style.opacity = dotA.toFixed(3);
        }
      }
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
      const target = wrap
        ? Math.round(spring.value)
        : Math.min(Math.max(Math.round(spring.value), 0), n - 1);
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
   * 按下那一刻的尺子：焦点附近每一格的中心离焦点多少像素。
   *
   * 拿**按下那一刻**的这份布局当尺子，而不是每帧重新量：抓住的那一点要一直贴着
   * 手指，而各项位置本身正在被形变重新分配。尺子是静的，手感才是 1:1 的；拿正在
   * 形变的布局当尺子会自己喂自己，轴会抖。
   *
   * 为什么自己合成一把，而不是直接拿 `fisheye()` 的 slots：成环之后 slots 里的
   * `at` 是**绕回来**的（±半圈），沿着它插值会在接缝处跳一整圈。这把尺子按「离
   * 焦点第几格」连续排开，接缝不存在，两档（成环/不成环）也共用同一条路。
   */
  function localRuler(): { k: number; at: number }[] {
    const p = params();
    const swell = p.maxGap - p.minGap;
    const out: { k: number; at: number }[] = [{ k: 0, at: 0 }];
    let acc = 0;
    for (let k = 0; k < RULER_SPAN; k++) {
      acc += p.minGap + swell * influence(k + 0.5, p.sigma);
      out.push({ k: k + 1, at: acc });
    }
    acc = 0;
    for (let k = 0; k > -RULER_SPAN; k--) {
      acc -= p.minGap + swell * influence(Math.abs(k - 0.5), p.sigma);
      out.unshift({ k: k - 1, at: acc });
    }
    return out;
  }

  /** 攒到下一帧再画（拖动途中用；弹簧那条路有它自己的 loop）。 */
  let frameRaf = 0;
  function scheduleFrame(): void {
    if (frameRaf || destroyed) return;
    frameRaf = requestAnimationFrame(() => {
      frameRaf = 0;
      paint();
    });
  }

  function focusFromDrag(dy: number): number {
    const L = ruler;
    if (!L || n < 2) return startFocus;
    const want = -dy; // 手指往下 → 轴往下走 → 焦点往前
    // 落在两格之间就线性插值；出了尺子的范围按基准间距外推（成环之后可以一直滑
    // 下去，所以外推这条路是常走的，不是兜底）。
    if (want <= L[0].at) return startFocus + L[0].k + (want - L[0].at) / PARAMS.minGap;
    const last = L[L.length - 1];
    if (want >= last.at) return startFocus + last.k + (want - last.at) / PARAMS.minGap;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i];
      const b = L[i + 1];
      if (want >= a.at && want <= b.at) {
        const span = b.at - a.at || PARAMS.minGap;
        return startFocus + a.k + (want - a.at) / span;
      }
    }
    return startFocus;
  }

  /**
   * 拉出端点之外要费力：超出的那一截打折，松手再弹回去（§2 的「到底了」回弹）。
   *
   * **成环之后这件事不存在**——没有端点，往哪边滑都走得通，所以原样返回。
   */
  function clampRubber(f: number): number {
    if (wrap) return f;
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
    ruler = localRuler();
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
    // 一帧只画一次。pointermove 在手机上一秒能来一百多条（而且 iOS 会把两三条
    // 合并成一条送过来），每来一条就画一次等于一帧里重复画好几遍——手上的感觉
    // 反而更黏。攒到下一帧再画，画的是最新的 focus，一点不丢。
    scheduleFrame();
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
    const target = wrap ? Math.round(focus) : Math.min(Math.max(Math.round(focus), 0), n - 1);
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
    let target = Math.min(Math.max(index, 0), Math.max(n - 1, 0));
    // 成环：从当前位置走**最近**的那一边过去。不折算的话，从第 12 项跳到第 0 项
    // 会整条轴倒着滑回去（12 格），而实际只隔一格。
    if (wrap && n > 0) {
      const here = focus;
      const base = Math.round((here - target) / n) * n;
      target += base;
    }
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
    // 成环之后 focus 是一个可以一直往上（或往下）走的实数——滑了三圈就是 39.2。
    // 对外报的必须是「第几项」，所以折回 0..n-1。
    focused: () =>
      wrap
        ? ((Math.round(focus) % n) + n) % n
        : Math.min(Math.max(Math.round(focus), 0), Math.max(n - 1, 0)),
    focusTo,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (frameRaf) cancelAnimationFrame(frameRaf);
      railL.rail.remove();
      railR.rail.remove();
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
