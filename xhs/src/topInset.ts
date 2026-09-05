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
 *   报的 ≥ 64px  →  它已经把按钮那一行算进去了，照它说的让。
 *   报的 <  64px  →  这是状态栏的高度（或者干脆是 0），再加 44px 给按钮那行。
 *
 * 64 这个坎是这么来的：刘海机的状态栏单独就有 44～59px，所以「小于 64」几乎
 * 只可能是「只报了状态栏」；而状态栏 20 + 按钮 44 = 64 起步，报到 64 以上的
 * 数就只能是含了按钮那行的。
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

/** 容器那排按钮（退出 / 分享 / 用户）大约多高。iOS/安卓的导航栏惯例都是 44。 */
const BAR = 44;

/** 报上来的数超过这个坎，就认为它已经把按钮那一行算进去了。 */
const INCLUDES_BAR = 64;

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
