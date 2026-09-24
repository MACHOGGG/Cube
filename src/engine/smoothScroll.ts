/**
 * 整页滚动的阻尼（Lenis）。
 *
 * 玩家 2026-09 第八轮点的：滚动要带一点阻尼，而且「不改任何现有布局」。所以这
 * 个模块**只接管滚动这一件事**——它不动任何元素的位置，只是把滚轮和手指的位移
 * 接过来，用插值把 `window.scrollTo` 推过去。版面一个像素都没动。
 *
 * 四条硬规矩（玩家逐条点名的），每一条在下面都有对应的代码：
 *
 *   1. **reduced-motion 下整个不启用**，直接退回原生滚动——阻尼本身就是一段动
 *      画。判断走 `engine/reducedMotion`，不另写一份（全站同一句话）。
 *   2. **弹窗开着的时候停**，关了再开。不停的话手指在弹窗上滑，背景跟着滑走，
 *      关掉弹窗发现页面已经不在原处了。
 *   3. **局内绝对不启用**。棋盘那块自己吃手势（`touch-action: none`），再插一
 *      层接管滚动只会打架。
 *   4. **小红书那一版不接**：`src/` 是两端共用的，这东西在 Chrome 61 上没测
 *      过，小工具的包还有体积门禁。用 xhs/vite.config.ts 现成的 SWAP 机制换成
 *      空替身（和 room.ts / analytics.ts 一样），所以那边的包里连 lenis 这个词
 *      都搜不到。
 *
 * **两个开关，不是一个。** `wanted` 是「这一页要不要」（start/stop 管它），
 * `blocked` 是「现在有弹窗压着」（下面那个观察器管它）——真正生效的是两个都点
 * 头。合成一个的话，弹窗关掉那一下 start() 会把「其实已经进局内了」也一起打
 * 开；分开之后两边互不干涉，谁也盖不掉谁。
 */
import Lenis from 'lenis';
/**
 * Lenis 自己那几行样式，用 `?inline` 拿成字符串、第一次启用时才贴进去。
 *
 * 两个原因：
 *   · 全站的 CSS 都是**从 JS 注进去**的（见 src/injectStyles.ts 的文件头：
 *     Artifact 那套外壳里静态 <style> 会偶发失效）。直接 `import '…​.css'` 会
 *     让 Vite 单独出一个 css 文件、再往 index.html 里插一条 <link>——那是这个
 *     项目里唯一的一条，多一次阻塞渲染的请求，还破了「一条路子」。
 *   · 贴在**启用的时候**：reduced-motion 的人和小红书那一版（换了替身）根本走
 *     不到这儿，一个字节的样式都不会落到页面上。
 */
import lenisCss from 'lenis/dist/lenis.css?inline';
import { reducedMotion } from './reducedMotion';

/**
 * 什么算「弹窗」。
 *
 * 全站的弹窗都是挂到 `document.body` 上的一层 `.overlay`（账户、规则、语言、
 * 确认框、战绩图……），挑图形那个居中窗是 `.center-pick`。两个选择器就够了；
 * 与其在二十来处开窗的地方各写一遍 stop/start，不如在这儿认一次——往后新开的
 * 窗只要照着现有的类名来，自动就管上了。
 */
const MODAL_SEL = '.overlay, .center-pick';

let lenis: Lenis | null = null;
let styled = false;
/** 这一页要不要阻尼（内容页要，局内不要）。 */
let wanted = false;
/** 现在有没有弹窗压着。 */
let blocked = false;
let watching = false;

function ensure(): Lenis | null {
  // reduced-motion：一次都不建。建出来再 stop() 也行，但那样白背一个实例、白
  // 挂一串监听——这台设备明明说了不要动画。
  if (reducedMotion()) return null;
  if (lenis) return lenis;
  if (!styled) {
    styled = true;
    const tag = document.createElement('style');
    tag.id = 'lenis-styles';
    tag.textContent = lenisCss;
    document.head.appendChild(tag);
  }
  lenis = new Lenis({
    // 自己跑 rAF，不用外面再接一条循环。
    autoRaf: true,
    /**
     * **手机上也接管滚动。**
     *
     * `syncTouch` 的默认值是 false（lenis 1.3.26 的类型定义上写着），也就是说
     * Lenis 默认**只接滚轮**。而手机上没有滚轮——第八轮在桌面上调好的那层阻尼，
     * 手机玩家从头到尾一次都没感受过。这个仓库的绝大多数玩家在手机上。
     *
     * `syncTouchLerp` 默认 0.075，这儿写 0.1：和主菜单那条轴的 AXIS_LERP
     * （engine/axisMotion.ts）同一个数，两处的「慢半拍」是同一个手感，不是两种。
     *
     * 影响范围只有**内容页**（条款、说明、记录那几屏）。主菜单那条轴在下面的
     * `prevent` 里被排除了，而且是刻意的——它自己算位置、自己吃手势。
     *
     * **这一条要真机看过才算数。** Lenis 自己列的已知限制里有两条正好打在这儿：
     * Safari 上封顶 60fps、低电量模式 30fps。真机上要是觉得比 iOS 原生更黏、或
     * 者和原生的惯性打架，就把它收回桌面端——在 ensure() 开头加一句
     * `if (!matchMedia('(pointer: fine)').matches) return null;`（触屏设备一律不
     * 启用），并把「手机上试过，原生更好」写在文件头上，免得下一个人再纠结一次。
     */
    syncTouch: true,
    syncTouchLerp: 0.1,
    /**
     * **内容页里自己会滚的那几块，让它们自己滚。**
     *
     * 这一条是 `syncTouch` 的配套，不是可选项：接管了手指之后，Lenis 会把
     * touchmove 一律按「整页滚动」处理——记录页那张排行榜（`.rank-body`，一块
     * `overflow-y: auto` 的列表）上一拖，滚的会是整页，榜一动不动。
     * `allowNestedScroll` 打开之后它先看手指底下那一路有没有能滚的容器，有就放手。
     *
     * 弹窗不在这条路上（弹窗一开整个 Lenis 就停了，见文件头第 2 条），棋盘和轴
     * 在下面的 `prevent` 里。剩下会中招的就是内容页里这种嵌套列表。
     */
    allowNestedScroll: true,
    /**
     * 手指按在这些地方的时候，Lenis 一概不管——它们自己吃手势。
     *
     * 主菜单那条带子（.mode-strip）和棋盘都是自己算位置、自己吃手势的。
     * 写在这儿是把话说死：以后谁把它们放进一个会滚的页面里，也不会变成「一
     * 根手指同时拖两样东西」。`.mode-axis` 也留着：鱼眼轴那一版暂时还在仓库里
     * （见 ui/modeStrip.ts 文件头），换回去的话这一句不用跟着改。
     */
    prevent: (node) => !!(node instanceof Element && node.closest('.mode-strip, .mode-axis, .board-wrap')),
  });
  lenis.stop();
  return lenis;
}

function apply(): void {
  const l = ensure();
  if (!l) return;
  if (wanted && !blocked) l.start();
  else l.stop();
}

/** 弹窗一开一关就重算一次（见文件头第 2 条）。 */
function watchModals(): void {
  if (watching || typeof MutationObserver === 'undefined') return;
  watching = true;
  const sync = () => {
    const now = !!document.querySelector(MODAL_SEL);
    if (now === blocked) return;
    blocked = now;
    apply();
  };
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  sync();
}

/** 内容页：开阻尼。 */
export function start(): void {
  wanted = true;
  if (!ensure()) return;
  watchModals();
  apply();
}

/** 局内、以及任何不该有阻尼的地方：关掉，回原生滚动。 */
export function stop(): void {
  wanted = false;
  apply();
}
