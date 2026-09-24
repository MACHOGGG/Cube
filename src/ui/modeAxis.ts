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
 *   · **不循环**：滑到最后一张就停，两端各留一点空白（拉得出去、松手弹回来）。
 *     这一条来回改过：第一轮定「不循环」→ 第二轮玩家说「没有做到任何循环的效
 *     果」，改成了环 → 第三轮又改回来：「不要循环的，滑动到底（留有一点空白）
 *     就停止」。所以 `fisheye` 的 wrap 模式这边不再用（引擎里那一档还留着）。
 *   · **上下两头不盖任何东西**：轴不裁自己的边，也不给卡片加渐隐。整列图标就这
 *     么从 Slides 招牌和底排那两块板子**底下滑过去**（玩家第三轮原话）。做法是
 *     `overflow: clip` + 一圈 clip-margin（画得出去，但不撑大页面的可滚动区），
 *     加上 `z-index: 0` 把这条轴整个压在那两块板子下面——见 style.css。
 *   · **轴占满整块屏幕**：第四轮又往前一步——「最上方和最下方仍然有遮挡，我希望
 *     完全没有，就是可以理解为最底下是底色、第二层是鱼眼转盘、最上面是 title 区
 *     块和个人主页和信息栏区块。鱼眼转盘的范围一直从头到尾延伸，可以在上下两端
 *     有点轻微的模糊处理」。所以轴的高度就是视口高，上沿贴视口顶（见 measure），
 *     两头那一点交代靠**虚**——不是淡出、不是遮罩（那两样他都否过），见 BLUR_*。
 *   · **滑起来要有力道和顿挫**：慢慢拖是一档灵敏度，快速甩是另一档（见 SLOW_K
 *     那一段），每滑过一项出一声、震一下（DETENT_MS）。
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
import { vibrate } from '../engine/haptics';

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
  // 玩家 2026-09 第三轮：「鱼眼的放大和缩小要更明显」。原先是 1 → 1.26（远处的
  // 卡就是原大，近处胀 26%），一眼扫过去几乎看不出哪张被选中。现在两头都拉开：
  // 远处缩到 0.80、焦点胀到 1.40，一大一小差 1.75 倍。
  //
  // 间距跟着一起放（126 / 182）：焦点那张长大了，挨着它的那张要是不让开就会撞
  // 上——撞上的后果不是难看，是**点错**（两张卡的热区叠在一起）。按最紧那一对
  // 算：半高 123×1.40/2 = 86.1 加 123×1.124/2 = 69.1 ＝ 155.2，而那一段的间距是
  // 126 + 56×0.857 = 174.0，留 18.8px。门 check-mode-axis 逐对量这件事。
  //
  // 第四轮之后玩家还要更大的落差：「整体大小差异再大一点，中线（被选中）的最大
  // 的尺寸还要再放大一些」。于是 0.80–1.40 再拉到 0.72–1.60（一大一小差 2.2
  // 倍），图本身也从 100 收到 112（style.css 的 --axis-art）。
  //
  // 间距跟着一起放，否则焦点那张一胀就压上邻居。按最紧那一对算（一站 112 + 小字
  // 23 = 135）：焦点半高 135×1.60/2 = 108.0，邻居 scale 1.195 半高 80.7，合
  // 188.7；那一段的间距是 150 + 60×0.857 = 201.4，留 12.7px。门 check-mode-axis
  // 逐对量这件事，改这几个数之前先跑它。
  minScale: 0.72,
  maxScale: 1.6,
  minGap: 150,
  maxGap: 210,
  lockRadius: 0.22,
};

/** reduced-motion 下用的那一套：一把没有弹性的尺子，位置照旧跟手，但不形变。 */
const RIGID: FisheyeParams = {
  ...PARAMS,
  maxScale: PARAMS.minScale,
  maxGap: PARAMS.minGap,
  lockRadius: 0,
};

/**
 * 超出端点之后还能拉多远（单位＝项），以及拉出去时手指位移打几折。
 *
 * **这条轴不循环**——玩家 2026-09 第三轮定的：「不要循环的，滑动到底（留有一点
 * 空白）就停止」。（第二轮曾经改成环，用了一轮就撤回来了；`fisheye` 的 wrap 模式
 * 还在引擎里，这边不再用它。）第一张之上、最后一张之下还能再拉出去半格多一点，
 * 松手弹回——那点空白就是「到底了」的手感，不是卡住。
 */
const OVERSCROLL = 0.55;
const RUBBER = 0.35;
/**
 * 手指位移放大多少倍。
 *
 * 玩家 2026-09 第三轮：「滑动图标的灵敏度加强（先 2 倍），然后两次点点的滑动速度
 * 更加大幅度增强」。所以是两段：
 *
 *   · 头 GAIN_KNEE 像素（正好是 2 格的行程）按 GAIN 倍走——这一段要跟手，挑相邻
 *     那一两张全靠它；
 *   · 超出的部分按 GAIN_FAR 倍走——一次长滑能扫过大半条轴，十四张卡不用滑五次。
 *
 * 分两段的写法本身是连续且单调的：手指往同一个方向走，焦点绝不会倒退，接缝处也
 * 不会跳一下。（第四轮之后这两个数是**快滑**那一档的倍率，慢慢拖要再打折——见
 * 下面 SLOW_K。）
 */
const GAIN = 2;
const GAIN_FAR = 5;
const GAIN_KNEE = 130;
/**
 * 快慢分档：**同样的手指位移，滑得越快走得越多**。
 *
 * 玩家 2026-09 第三轮：「滑动鱼眼转盘是根据力道会有不同速度的……现在的 0.75 倍
 * 作为正常滑动的灵敏度，然后用户上下快速滑动的时候是现在这样的灵敏度」。所以上
 * 面那两段（2 倍 / 5 倍）现在是**快滑**那一档的值，慢慢拖的时候整体打 0.75 折。
 *
 * 判快慢用的是手指的瞬时速度（px/ms）：0.35 以下算「在挑」——这时候要跟手，手感
 * 比距离重要；1.6 以上算「在甩」——这时候他要的是快点翻过去。中间线性过渡，不会
 * 在某个速度上突然变一档。
 *
 * 因为倍率随时在变，位移不能再拿「按下到现在的总距离」一次换算（那样倍率一变，
 * 焦点会当场跳一下）。改成**逐段累加**：每来一条 pointermove，把这一小段位移按
 * 当时的倍率折算成轴上的像素加进去。见 onMove。
 */
const SLOW_K = 0.75;
/**
 * 两档的分界线，2026-09 第五轮重新标过。
 *
 * 原先是 0.35 / 1.6 px/ms。玩家试下来「点点快速滑动……敏感度并没有很高」——量了
 * 一下才明白：手机上一次「轻甩」也就 0.6–1.2 px/ms，1.6 这条线几乎够不着，于是
 * 快滑那一档形同虚设，他感觉到的永远是慢档那 0.75 折。
 *
 * 现在 0.22 / 0.85：轻轻一甩就到顶。而且顶上那一档不再只是「不打折」，是 FAST_K
 * 倍——同样的位移，甩过去要比慢慢拖多走六成，差别才摆得出来。
 */
const V_SLOW = 0.22;
const V_FAST = 0.85;
const FAST_K = 1.6;
/**
 * 速度要先过一道低通再拿去挑档。
 *
 * 单条 pointermove 算出来的瞬时速度抖得厉害：手机上一秒来一百多条，而 iOS 会把两
 * 三条合并成一条送过来，dt 忽大忽小，同一次匀速滑动里算出来的 v 能差三倍。直接拿
 * 它挑档，倍率在一次滑动里来回跳，手上的感觉是「一顿一顿的」。这道一阶低通认的是
 * 「这一下大概多快」，不是「这一条事件多快」。
 */
const V_SMOOTH = 0.45;
/**
 * 每滑过一项的那一下「咔」。
 *
 * 玩家第三轮：「每一经过一个玩法都有一点经过每一小卡的感觉」。声音本来就有（滑
 * 过一项出一声 scan），这儿再补一记极短的震动——两样加上焦点锁定那个死区（见
 * fisheye 的 lockRadius），滑过每一张卡就有一记轻轻的顿挫。
 */
const DETENT_MS = 8;
/**
 * 上下两头那一点**模糊**。
 *
 * 玩家第三轮：「最底下是底色、第二层是鱼眼转盘、最上面是 title 区块和个人主页和
 * 信息栏区块。鱼眼转盘的范围一直从头到尾延伸，可以在上下两端有点轻微的模糊处
 * 理」。所以两头不再是「淡出」或者「遮罩」（那两样他都否过），而是**还在、只是
 * 有点虚**——像景深，不像盖了块板。
 *
 * 只在离屏幕边 BLUR_EDGE 以内才给，最多 BLUR_MAX；而且**量化成 0.5px 一档**再
 * 写：`filter` 一改就要软件光栅化那一张，量化之后一次滑动里每张卡只写那么几次，
 * 不是每帧都写（§5.4 那条「不许逐帧改 filter」说的就是这个）。
 */
const BLUR_EDGE = 150;
const BLUR_MAX = 2.5;
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
  /**
   * 这一次按下以来，轴上一共走了多少像素（**已经按倍率折算过**）。
   *
   * 为什么不像从前那样拿「按下到现在的总位移」一次换算：倍率现在跟着手速变，同一
   * 段位移在慢拖和快甩下折算出来不是一个数——一次换算的话，倍率一变，整条轴会当场
   * 跳一下（手指没动，焦点却蹦了半格）。改成逐段累加：每来一条 pointermove，把这
   * 一小段位移按**当时**的倍率折进来。累加全程是浮点、不取整，所以不会漂。
   */
  let axisPx = 0;
  let lastY = 0;
  let lastT = 0;
  /** 平滑过的手速（px/ms），见 V_SMOOTH。 */
  let vel = 0;
  let ruler: { k: number; at: number }[] | null = null;
  const spring: SpringState = createSpring(focus);
  let springing = false;
  let lastNearest = Math.round(focus);
  let destroyed = false;

  const params = () => (reducedMotion() ? RIGID : PARAMS);

  /**
   * 轴占**整块屏幕**：上沿贴视口顶，高度就是视口高。
   *
   * 玩家 2026-09 第四轮原话：「最上方和最下方仍然有遮挡，我希望完全没有，就是可
   * 以理解为最底下是底色、第二层是鱼眼转盘、最上面是 title 区块和个人主页和信息
   * 栏区块。鱼眼转盘的范围一直从头到尾延伸」。
   *
   * 前一版是「从招牌下沿铺到底排上沿」（量 `.home-nav` 的上边），于是上下两头各
   * 空出一条一百多像素的带子，卡片滑到那儿就消失——在玩家眼里那就是「被挡住
   * 了」，跟第二轮那层渐变遮罩看上去是同一回事。这一版两头都不留：
   *
   *   · 高度 = `window.innerHeight`（不是「剩下多少」）；
   *   · 用一截**负的上外边距**把它从文档流里的位置拉回视口顶——它在 DOM 里排在
   *     招牌后面，自然位置就在招牌下沿。拉多少是量出来的：`rect.top + scrollY`
   *     是它自然位置在**文档**里的 y，取负正好把上沿对到文档 0。用文档坐标而不
   *     是视口坐标，是因为 measure() 也会在页面已经滑下去之后跑（resize、地址栏
   *     收起）——视口坐标那会儿是负的，照它算会把轴越推越上去。
   *     **量之前要先把内联的外边距清掉**，否则量到的是「上一次拉过之后」的位置；
   *     而且要**先把高度设成最终值再量**：轴矮的时候这一页装得进一屏，`.app` 那根
   *     flex 列于是有富余可分，招牌的位置和铺满之后差 4px——拿那个位置去算，轴的
   *     上沿就落在 4 而不是 0。量的状态和最终状态一致，这道误差就不存在。
   *
   * 招牌是 sticky 的，照旧浮在最上面；轴整条压在它下面一层（style.css 里那句
   * `z-index: 0`），所以卡片是从它底下滑过去的，不是盖住它。两头那一点交代靠
   * **虚**，见 paint 里的 BLUR_*。
   *
   * 高度写死一个常数迟早和 CSS 走散——这个仓库为「按 100dvh 算图标大小，手机一
   * 上滑地址栏收起来图标就胀大一圈」栽过一次，教训是尺寸要么是定数、要么现量。
   */
  function measure(): void {
    host.style.marginTop = '';
    hostH = Math.max(260, Math.round(window.innerHeight));
    host.style.height = hostH + 'px';
    const hr = host.getBoundingClientRect();
    host.style.marginTop = -Math.round(hr.top + window.scrollY) + 'px';
    if (cards[0]) stationH = Math.max(60, cards[0].offsetHeight);
    floatKnowHow();
  }

  /**
   * 首玩期那颗《我会玩》：轴占满屏之后，得把它浮到轴上面来。
   *
   * 它在 DOM 里排在轴和法务链接之间（menu.ts）。轴一占满整屏，它就跟着法务那几
   * 条一起被顶到屏幕外面去了——而它是「跳过引导」的唯一出口，藏起来等于没有
   * （上一版为它在轴底下让出过一截，这一版没有「底下」可让了）。
   *
   * 所以改成固定定位，浮在底排**上方**那道缝里：位置是量底排上沿得出来的，不写
   * 死——底排那一条的高度跟着安全区走（刘海屏底下那道横杠会把它顶上来）。
   * `left: 50%` + `translateX(-50%)` 居中（见 style.css），不是 `left/right: 0`：
   * 后者那颗按钮会横贯整屏，热区跟着变成一整条——手指落在屏幕底下随便哪儿都算
   * 按了它，引导就这么悄悄撤了。这正是玩家说的那种「意料之外的疏漏操作」。
   */
  function floatKnowHow(): void {
    const skip = document.querySelector<HTMLElement>('.know-how-btn');
    if (!skip) return;
    skip.classList.add('know-how-btn--float');
    const nav = document.querySelector('.home-nav');
    const nr = nav?.getBoundingClientRect();
    // 底排没画出来（高度 0）就退回一个够高的默认值：宁可高一点，也不要压在底排上。
    const above = nr && nr.height > 0 ? Math.round(window.innerHeight - nr.top + 6) : 112;
    skip.style.bottom = above + 'px';
  }

  /**
   * 上一帧给每张卡写过的那几样。
   *
   * 逐帧无脑写 style 是这条轴「很卡」的一半原因：一次 paint 要动 13 张卡 × 5 个
   * 属性，其中 zIndex 会让浏览器重排层序、willChange 反复设/清会反复建图层和拆
   * 图层——都是**每一帧**都在做，而实际上一帧里真正变了的只有 transform 和
   * opacity。这儿记住上一帧的值，变了才写。
   */
  const lastPaint = cards.map(() => ({ t: '', o: '', z: 0, pe: '', f: '' }));
  const lastDot = cards.map(() => '');

  function paint(): void {
    if (destroyed || n === 0) return;
    const L = fisheye(n, focus, params());
    const edge = hostH / 2;
    // 正在动吗？两头那一点虚只在停稳之后给（见下面那段），滑动中一律不写
    // filter。
    const still = !dragging && !springing;
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
       * **一张都不淡**：玩家 2026-09 第三轮——「上方和下方仍然有渐变的覆盖，完全
       * 去除」。所以这儿不再按距离算透明度，卡片从头到尾都是实的，越过轴的上下
       * 边之后就从招牌和底排那两块板子底下滑过去（容器那边 z-index: 0 + clip
       * margin，见 style.css）。
       *
       * 这一行留着不是多余：上一版给这些卡写过内联的 opacity，不清掉的话它会一直
       * 挂在 style 上。写成空串就退回 CSS。
       */
      if (prev.o !== '') { el.style.opacity = ''; prev.o = ''; }
      /**
       * 离轴太远的就别挡手。
       *
       * 它们现在是**看得见**的（从板子底下滑过去），但轴外面那一带上面盖着底排
       * 导航和招牌——手指落在那儿本该点到底排，不该被一张飘到那儿的卡截走。界线
       * 取「轴的半高 + 一张半卡」：屏幕上看得见的那几张都在界内，再远的只剩画面，
       * 不吃手势。
       *
       * 挡法用 pointer-events，**不是 visibility: hidden**：后者键盘聚焦不到，于
       * 是 Tab 只走得到眼前那四五张，剩下九张玩法用键盘永远到不了。
       *
       * 轴占满整屏之后这一条挡的是**画到 clip-margin 那一圈里去的那几张**：页面
       * 往下滑一点，轴的下沿就抬进屏幕里，而 clip-margin 让它外面 220px 照样画得
       * 出来、也照样点得到——那一带底下是底排，手指落在那儿本该点到底排。
       */
      const far = Math.abs(s.at);
      const pe = far > edge + stationH * 1.5 ? 'none' : '';
      if (pe !== prev.pe) { el.style.pointerEvents = pe; prev.pe = pe; }
      /**
       * 上下两头那一点**虚**（出处和两个数在 BLUR_EDGE 上面）——**只在停稳之后
       * 给，手指一碰就全撤掉**。
       *
       * 第四轮是一直给着的，玩家第五轮报「滑动转盘不够丝滑现在还是卡卡的」。
       * `filter: blur()` 是这条轴上最贵的一样东西：每变一次就要把那张卡连同里面
       * 那张 SVG 重新栅格化一遍，手机上一次滑动里有四五张卡在虚着，每张又要改好
       * 几档——帧全花在这儿了。
       *
       * 而它本来就是给「停着看」的一个交代（两头不是被切掉，是化开了）。滑动中
       * 那一眼没人盯着两头，所以这一版：`dragging || springing` 的时候一律清空，
       * 停稳那一刻再补一次 paint 把它加回来（见 settled）。滑动时一次 filter 都
       * 不写。
       *
       * 量的是「这张卡的中心离最近的那条屏幕边还有多远」——轴的盒子就是视口，所
       * 以 `半高 − |位移|` 正好是这个距离。写之前量化成 0.5px 一档，理由同上。
       */
      const room = edge - Math.abs(s.at);
      const raw =
        !still || room >= BLUR_EDGE
          ? 0
          : BLUR_MAX * Math.min(1, (BLUR_EDGE - room) / BLUR_EDGE);
      const q = Math.round(raw * 2) / 2;
      const f = q > 0 ? `blur(${q}px)` : '';
      if (f !== prev.f) { el.style.filter = f; prev.f = f; }

      /**
       * 点点轴：按**项**等距排，不跟着卡片的形变走——它量的是「第几项」，中间那
       * 颗永远对着当前选中的那张。
       *
       * 大小用 `transform: scale()`，**不改 width/height**。这是第五轮那条「还是
       * 卡卡的」的另一半：两条轴一共 28 颗点，逐帧改宽高就是逐帧让浏览器重新排
       * 版 28 次——排版是整棵树的事，比画 13 张卡还贵。scale 只走合成，一行都不
       * 重排。点子在 CSS 里就是最大的那个尺寸（RAIL_DOT_MAX），这儿只往下缩。
       */
      const k = s.index - L.lockedFocus;
      const dotA = Math.max(0, Math.min(1, (RAIL_SPAN - Math.abs(k)) / 1.6)) *
        (0.28 + 0.72 * s.inf);
      const size = RAIL_DOT_MIN + (RAIL_DOT_MAX - RAIL_DOT_MIN) * s.inf;
      const dt =
        `translate3d(-50%,-50%,0) translateY(${(k * RAIL_PITCH).toFixed(2)}px)` +
        ` scale(${(size / RAIL_DOT_MAX).toFixed(3)})`;
      const key = `${dt}|${dotA.toFixed(3)}`;
      if (key !== lastDot[s.index]) {
        lastDot[s.index] = key;
        for (const dot of [railL.dots[s.index], railR.dots[s.index]]) {
          dot.style.transform = dt;
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
      //
      // 震动和声音同一个时机：玩家第四轮要的「每一经过一个玩法都有一点经过每一
      // 小卡的感觉」，就是这一声加这一下，再加上焦点锁定那个死区（lockRadius）
      // ——三样凑起来，滑过每一张卡手上都有一记轻轻的顿挫。
      if (!reducedMotion()) {
        tick();
        vibrate(DETENT_MS);
      }
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

  /**
   * 停稳那一刻。reduced-motion 下的唯一一声就在这儿。
   *
   * 还要再画一次：两头那一点虚是「停着才给」的（见 paint），而最后那一帧是在
   * `springing` 还为真的时候画的——不补这一次，轴停下来了却一直不虚。
   */
  function settled(): void {
    if (reducedMotion()) tick();
    paint();
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

  /**
   * 这一小段位移在轴上算几倍：**行程**那一档 × **手速**那一档。
   *
   * 行程那一档（stepGain）就是原先那条两段映射的斜率：这一次按下以来手指已经走了
   * 不到 GAIN_KNEE 就按 GAIN 倍，超过了按 GAIN_FAR 倍。拿「按下以来的总行程」而不
   * 是这一小段的长度来分档，是为了保住它原来的意思——「一次长滑能扫过大半条轴」。
   *
   * 手速那一档（speedK）是第四轮加的：慢慢拖打 SLOW_K 折，快速甩不打折，中间线性
   * 过渡。两头都是常数（不是一直线性外推下去），所以再慢不会慢到推不动、再快也不
   * 会快到一甩就飞到底。
   */
  function stepGain(travel: number): number {
    return travel < GAIN_KNEE ? GAIN : GAIN_FAR;
  }

  function speedK(v: number): number {
    if (v <= V_SLOW) return SLOW_K;
    if (v >= V_FAST) return FAST_K;
    return SLOW_K + (FAST_K - SLOW_K) * ((v - V_SLOW) / (V_FAST - V_SLOW));
  }

  /** 轴上走了这么多像素之后，焦点落在第几项（可以是小数）。 */
  function focusFromAxis(want: number): number {
    const L = ruler;
    if (!L || n < 2) return startFocus;
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
   * 拉出端点之外要费力：超出的那一截打折，松手再弹回去。
   *
   * 玩家第三轮点名要的就是这个——「滑动到底（留有一点空白）就停止」：到头了还能
   * 再拉出半格多一点，看得见那一点空白，手一松弹回去。没有这一截的话，滑到头是
   * 硬生生一堵墙，手感像卡住了。
   */
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
    axisPx = 0;
    lastY = e.clientY;
    lastT = e.timeStamp;
    vel = 0;
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
    /**
     * 这一小段：走了多少、多快，然后按当时的倍率折进累加器。
     *
     * `e.timeStamp` 而不是 `Date.now()`：它和事件本身同一条时间线，浏览器把几条
     * move 合并送过来的时候也还是各自的真实时刻。dt 有下限 1ms——同一毫秒里来两
     * 条（合并事件、或者时钟精度被降频）的话，除下去会得到一个无穷大的速度。
     *
     * 手指往下（seg > 0）＝ 轴往下走 ＝ 焦点往**前**（索引变小），所以是减。
     */
    const seg = e.clientY - lastY;
    const dt = Math.max(1, e.timeStamp - lastT);
    lastY = e.clientY;
    lastT = e.timeStamp;
    // 第一条 move 不做平滑，直接就是它自己：低通从 0 起步的话，一次「轻甩」总
    // 共也就五六条事件，等它爬上来手指已经离开屏幕了——这正是玩家说的「快速滑
    // 动敏感度并没有很高」的另一半原因。
    const now = Math.abs(seg) / dt;
    vel = vel === 0 ? now : vel * (1 - V_SMOOTH) + now * V_SMOOTH;
    axisPx -= seg * stepGain(Math.abs(dy)) * speedK(vel);
    focus = clampRubber(focusFromAxis(axisPx));
    // 一帧只画一次。pointermove 在手机上一秒能来一百多条（而且 iOS 会把两三条
    // 合并成一条送过来），每来一条就画一次等于一帧里重复画好几遍——手上的感觉
    // 反而更黏。攒到下一帧再画，画的是最新的 focus，一点不丢。
    // （累加是在**每一条** move 上做的，不是每帧一次：攒到帧里再算就会漏掉合并
    // 进来的那几段位移，一次快滑少走一大截。）
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
    /**
     * 同一件事还有**整页**那一份。
     *
     * 浏览器让刚获得焦点的元素露出来时，滚的不止那个带 overflow 的容器，还有页
     * 面本身。轴上的卡是绝对定位的，屏幕外那几张离文档顶两千多像素——一次 Tab
     * 就把页面滚到底（实测 scrollY 220，也就是这一页能滚的全部），而轴现在是钉在
     * 文档顶上、正好一屏高的，于是整条被拉出屏幕 220px：选中的那张跑到屏幕上方，
     * 底下空出一条底色。选中项该在哪儿由 focusTo 管（它会把那张带到正中），页面
     * 一点都不需要动。
     *
     * 正在拖的时候不管：那会儿的 focusin 是手指按在卡上带出来的，页面本来就在他
     * 刚才滑到的地方，中途抽一下反而是「意料之外的界面」。
     */
    if (!dragging && window.scrollY !== 0) window.scrollTo(0, 0);
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

  /**
   * 字体到货之后再量一次。
   *
   * 招牌那行 Slides 用的是自托管的 Fraunces：头一次打开时先拿后备字体（Georgia）
   * 排一遍，字体文件到货再重排——招牌的高度从 101 长到 105。而轴的上沿是**按招牌
   * 的下沿算出来**的（measure 里那截负外边距），算的时候招牌还是矮的，字体一到货
   * 招牌长高 4px，轴就跟着被顶下去 4px：屏幕最上面留出一条 4px 的底色缝。玩家这一
   * 轮要的正是「最上方完全没有遮挡」，4px 也算。
   *
   * 只补量这一次就够：字体不会再变。`?.` 两道是给老内核留的（FontFaceSet 很早就
   * 有，但小红书那一版跑在 Chrome 61 上，宁可当它没有）。
   */
  document.fonts?.ready?.then(() => {
    if (destroyed) return;
    measure();
    paint();
  });

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
    // focus 在回弹区里会短暂越界（-0.55 ~ n-1+0.55），对外报的必须是「第几项」。
    focused: () => Math.min(Math.max(Math.round(focus), 0), Math.max(n - 1, 0)),
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
      host.style.marginTop = '';
      const skip = document.querySelector<HTMLElement>('.know-how-btn');
      if (skip) {
        skip.classList.remove('know-how-btn--float');
        skip.style.bottom = '';
      }
    },
  };
}

/** 门要用：把那几个数摆出来，免得门自己抄一份然后和实现走散。 */
export const AXIS_PARAMS = PARAMS;
export { hitTest };
