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
     * 手指按在这些地方的时候，Lenis 一概不管——它们自己吃手势。
     *
     * 鱼眼轴（主菜单那条竖轴）是自己算位置的，`touch-action: none`；棋盘同理。
     * 这两处本来也不该有页面滚动，写在这儿是把话说死：以后谁把轴放进一个会滚
     * 的页面里，也不会变成「一根手指同时拖两样东西」。
     */
    prevent: (node) => !!(node instanceof Element && node.closest('.mode-axis, .board-wrap')),
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
