/**
 * 给小红书自己那排按钮让开位置。
 *
 * ── 这是在解决什么 ──────────────────────────────────────────────
 *
 * 小工具跑在小红书的容器里，容器在页面**上方**有一排它自己的按钮——退出、
 * 分享，还有右边那颗用户键。规范里写着「窗口样式、导航栏……由容器统一控制」
 * （zip-artifact-spec.md 开头那句），意思是这排东西我们既撤不掉也改不了，
 * 它就在那儿。
 *
 * 那它压不压着我们的画面？规范给的答案是安全区：容器把它占掉的高度写成
 * `--safe-area-inset-top` 注进来，页面自己让开（cross-platform-h5.md §3）。
 * 底下那道已经吃过一次亏了——底排按钮在真机上「看不见，是一个框」，就是因为
 * 从前只读 `env()` 不读这个变量。
 *
 * 可上面这道还有第二个坑，比底下那道更难发现：
 *
 *   1. 主菜单那一页的上内边距是**写死的 10px**（src/style.css 里
 *      `.home-page:not(.home-page--wide)`），压根不看安全区。量出来是：
 *      注进 88px 的上安全区，标题还是停在 20px——纹丝不动。
 *   2. 就算读了，容器报的那个数**未必含这排按钮**。同类容器的惯例是只报状态
 *      栏高度（刘海那一截），按钮那一行要页面自己再让。少让的话，标题正好被
 *      按钮压住。
 *
 * ── 怎么处理 ────────────────────────────────────────────────────
 *
 * 开机时量一次容器报的数，然后按这条规矩折算出真正要让的高度：
 *
 *   报的 ≥ 80px  →  它已经把按钮那一行算进去了，照它说的让。
 *   报的 <  80px  →  这是状态栏的高度（或者干脆是 0），再加 40px 给按钮那行。
 *
 * 两个数各自的来历写在下面 BAR 和 INCLUDES_BAR 的注释里，都是拿真机截图逐
 * 像素量出来的，不是拍脑袋。
 *
 * 算完的数写到 `<body>` 上的 `--safe-area-inset-top`。这么写的好处是**一处
 * 改，全站跟着走**：网页版每一处让开刘海的式子写的都是
 * `var(--safe-area-inset-top, env(...))`——棋盘页、4-3-2-1 开局页、个人主
 * 页……它们读到的就是折算之后的数，一行样式都不用改。
 *
 * 写在 `<body>` 而不是 `<html>` 上，是因为容器那个变量多半就注在 `<html>`
 * 上：写同一处会把它盖掉，下次量到的就是我们自己写的数，越滚越大。自定义
 * 属性是继承的，写在 body 上对页面里所有东西一样管用，而 `<html>` 上那份原
 * 件留着不动，转屏之后还能再量一次。
 */

/**
 * 容器那排按钮（退出 / 分享 / 用户）要多让多少。
 *
 * 拿玩家发的真机截图逐像素量的（1206×2622 的 3 倍图，402×874pt）：
 *
 *   状态栏文字      14.0 → 50.3pt
 *   那三颗圆钮      68.5 → 99.2pt   ← 要让开的就是它
 *   容器报的安全区  62pt
 *
 * 也就是说从安全区底下算起，按钮那一行占到 99.2 − 62 = 37.2pt。取 40，落点
 * 102pt，比按钮下边多 2.8pt——够把边缘的抗锯齿盖住，又不至于白让一截。
 *
 * 从前取的是 44（iOS/安卓导航栏的惯例高度），落点 106pt。那是没量之前的稳
 * 妥值；玩家看了真机觉得「上面留太多了」，量完确实多让了近 7pt。
 *
 * 另一件量出来的事，记在这儿备用：页面自己的背景在真机上是一直铺到 y=0 的，
 * 那排按钮是**浮在上面**的一层，而且只占左右两头，中间是空的。所以「让开」
 * 让的只是内容，底色不用跟着退。
 */
const BAR = 40;

/**
 * 报上来的数超过这个坎，就认为它已经把按钮那一行算进去了。
 *
 * 80 是量出来的，不是拍的。玩家在 iPhone 16 Pro Max（402×874pt）上截的第一版
 * 实机图里：
 *
 *   · 容器那三颗键的圆，上边 70pt、下边 100pt；
 *   · 同一张图里棋盘页的读数块顶边在 68pt。那一页的上内边距写的是
 *     `max(安全区, 14) + 6`，反推容器报的是 62pt——正好是这台机器的灵动岛
 *     安全区，**不含**它自己那排键。
 *
 * 所以这个容器报的就是设备安全区，按钮那一行要我们自己再让：62 + 40 = 102，
 * 落在按钮下边（99.2pt）再往下 2.8pt。
 *
 * 坎从前写 64，离 62 只差 2——哪台机器报到 65 就会被错当成「含按钮了」，键正
 * 好压在字上。刘海机的安全区最大到 62 上下，而「含按钮」的数最小也有
 * 44 + 44 = 88，所以 80 卡在两者中间，两边都够宽。
 */
const INCLUDES_BAR = 80;

/**
 * 量一段 CSS 长度有多少像素：拿一个看不见的探针撑出这个高度再量。
 *
 * 只用来量 `env()`——那是真机报的那份，读不出来只能撑出来看。
 */
function measureEnv(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
    'height:env(safe-area-inset-top, 0px)';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return Number.isFinite(h) ? h : 0;
}

/**
 * 容器注进来的那个变量是多少。
 *
 * 直接读根元素上算出来的值，不拿探针撑——因为折算完的数我们自己会写到
 * `<body>` 上，探针挂在 body 里量到的就是我们自己写的那份，转一次屏就多加
 * 一次 44，越滚越大。根元素上那份是容器的原件，我们从不动它。
 */
function reportedVar(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top');
    const n = parseFloat(String(raw).trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** 容器到底报了多少。变量和 env() 各取一次取大的——模拟器给变量，真机给 env()。 */
function reportedTop(): number {
  return Math.max(reportedVar(), measureEnv(), 0);
}

/** 折算：报的数 → 真正要让开的高度。 */
export function clearanceFor(reported: number): number {
  return reported >= INCLUDES_BAR ? reported : reported + BAR;
}

function apply(): void {
  const clear = clearanceFor(reportedTop());
  const px = clear + 'px';
  // 网页版所有让开刘海的式子读的都是这一个名字，写它等于一次改全站。
  document.body.style.setProperty('--safe-area-inset-top', px);
  // 主菜单那页的上内边距是写死的，样式表里另外拿这个名字盖掉（pages.css）。
  document.body.style.setProperty('--xhs-top-clear', px);
}

/**
 * 装上。转屏之后安全区会变（横屏时刘海跑到侧面，上面那道通常缩成 0），所以
 * 每次尺寸变化都重算一遍。
 */
export function installTopInset(): void {
  apply();
  const again = () => apply();
  // 容器什么时候把那个变量注进来，规范没说。这个文件是在 <head> 里跑的，很可
  // 能比它早——所以后面这几个时刻各再量一次。量一次几乎不要钱（读一个属性 +
  // 一个探针），漏掉一次就是标题被按钮压着。
  document.addEventListener('DOMContentLoaded', again);
  window.addEventListener('load', again);
  setTimeout(again, 0);
  setTimeout(again, 300);
  // 转屏之后安全区会变（横过来时上面那道通常缩成 0）。
  window.addEventListener('resize', again);
  window.addEventListener('orientationchange', again);
}
