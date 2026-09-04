/**
 * Slides · 小红书小工具版的入口。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这个文件只做「哪一屏」，不做「怎么玩」
 *
 * 五个玩法全部是网页版同一个入口的五组开关（src/shapes/types.ts 的
 * ShapeGameOpts）：
 *
 *   基础方块   createSquareGame().mount(root, back, {})
 *   基础小球   createCircleGame().mount(root, back, {})
 *   炸弹       { bomb: true }
 *   老虎机     { targets: 转出来的两个图案 }
 *   无限反转   { flip: true, timeLimitSec: 60 }
 *
 * 棋盘、滑动手感、得分判定、连锁节拍、翻面动画、结算、战绩图——一律走网页
 * 版那一份，这里一个字都不改。玩家定的：选出来的玩法要「完全复刻一样」。
 *
 * 这一版自己的东西只有四件：主菜单（五张卡）、本机游玩历史、介绍页、以及
 * Chrome 61 的基线样式层。多人小屋、排行榜、登录订阅、教学、语言选择整块
 * 不做（见 xhs/README.md）。
 * ─────────────────────────────────────────────────────────────────────────
 */
import { injectStyles } from '../../src/injectStyles';
import pagesCss from './pages.css?inline';
import baselineCss from './baseline.css?inline';

import { createSquareGame } from '../../src/shapes/square';
import { createCircleGame } from '../../src/shapes/circle';
import type { ShapeGame, ShapeGameOpts } from '../../src/shapes/types';
import type { Family, TargetPattern } from '../../src/engine/targets';
import { renderRandomTargetPage } from '../../src/ui/slotMachine';
import { renderFlipModePage } from '../../src/ui/flipMode';
import { installBackNav, setScreenBack } from '../../src/engine/backNav';
import { loadAllRuns } from '../../src/engine/persistence';
import { showLoadingScreen } from '../../src/ui/loadingScreen';
import type { Lang } from '../../src/i18n';

import { renderXhsMenu, type XhsMode } from './menu';
import { renderProfilePage, type Book } from './profile';
import { renderRunSheet } from './runSheet';
import { renderShapePick } from './shapePick';
import { mountShareActions } from './shareActions';
import type { StoredRun } from '../../src/engine/persistence';

/** 小红书是中文平台，这一版固定简体中文——没有语言选择页。 */
const LANG: Lang = 'zhHans';
/** 无限反转一局多长。和网页版同一个数（src/main.ts 的 FLIP_SECONDS）。 */
const FLIP_SECONDS = 60;

const root = document.getElementById('app') as HTMLElement;
const squareGame = createSquareGame();
const circleGame = createCircleGame();
const gameFor = (family: Family): ShapeGame => (family === 'circle' ? circleGame : squareGame);

/**
 * 成绩那一页要翻的六本存档：两个玩法 × 三种模式。
 *
 * 键名问玩法自己要（card.bestKey）再接后缀，和网页版存的时候用的是同一条
 * 算法（见 square.ts 结尾那句 `flipMode ? bestKey + '_flip' : ...`）。老虎
 * 机没有自己的后缀——它换的只是得分图案，记在基础那本上，和网页版一致。
 */
const BOOKS: Book[] = [
  { card: squareGame.card, suffix: '' },
  { card: circleGame.card, suffix: '' },
  { card: squareGame.card, suffix: '_bomb' },
  { card: circleGame.card, suffix: '_bomb' },
  { card: squareGame.card, suffix: '_flip' },
  { card: circleGame.card, suffix: '_flip' },
];

/** 上一屏留下来要拆的东西（一局游戏挂了一堆监听，换屏前得让它自己收拾）。 */
let activeDestroy: (() => void) | null = null;
function teardown() {
  activeDestroy?.();
  activeDestroy = null;
  root.innerHTML = '';
}

/** 开一局。除了 lang，选项原样交给网页版那个 mount。 */
function showGame(game: ShapeGame, opts: ShapeGameOpts, onBack: () => void) {
  teardown();
  activeDestroy = game.mount(root, onBack, { ...opts, lang: LANG });
  enhanceShareOverlay();
  setScreenBack(onBack);
}

/**
 * 结算页那个「分享战绩」窗口：把网页版的「长按图片保存」换成小红书的两颗键。
 *
 * 网页版靠的是浏览器的长按菜单，小工具的容器把它禁掉了——玩家长按什么也不会
 * 发生。所以这里在游戏挂好之后，找到那个窗口，把提示那一行换成《发笔记》
 * 《存相册》（和成绩页里点开一局看到的是同一套，见 shareActions.ts）。
 *
 * 用「挂完之后改 DOM」而不是改 src/ui/gameShell.ts：那个文件是网页版正在跑
 * 的东西，这一版的规矩是只读不写。改动只在这一版的包里发生。
 *
 * 图是现取的，不是现在这一刻的——窗口每次打开，gameController 都会把新的
 * data:uri 塞进那个 <img>，所以按下去的时候才读它。
 */
function enhanceShareOverlay() {
  const img = root.querySelector<HTMLImageElement>('#shareImage');
  const modal = img?.closest<HTMLElement>('.share-modal');
  if (!img || !modal) return;
  // 「长按保存」那句在这儿是假话，去掉。
  modal.querySelector('.hint')?.remove();
  const host = document.createElement('div');
  host.className = 'xhs-share-host';
  modal.insertBefore(host, modal.querySelector('.btn-row'));
  // 每次窗口打开都重挂一次：分数和图都变了。用 MutationObserver 盯着 src。
  const remount = () => {
    host.innerHTML = '';
    // 每次都重新去存档里取最新那一局——窗口打开的时候这一局刚存进去。
    refreshLastRun();
    const d = lastRunData;
    if (img.src && img.src.indexOf('data:') === 0 && d) mountShareActions(host, img.src, d);
  };
  remount();
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(remount).observe(img, { attributes: true, attributeFilter: ['src'] });
  }
}

/**
 * 刚打完那一局的数据，给分享窗口填笔记用。
 *
 * 拿法是「结算之后去存档里翻最新的一条」——游戏自己不往外报这个，而每一局
 * 结束时它都会写进 localStorage（见 engine/persistence.ts 的 saveRun）。
 */
let lastRunData: StoredRun['data'] | null = null;
function refreshLastRun() {
  try {
    const all = loadAllRuns(BOOKS.map((b) => b.card.bestKey + b.suffix));
    lastRunData = all.length ? all[0].data : null;
  } catch {
    lastRunData = null;
  }
}

// ---- 各屏 -------------------------------------------------------------------

function showMenu() {
  teardown();
  renderXhsMenu(root, LANG, {
    onPlay: (mode: XhsMode) => {
      if (mode === 'square') return showGame(squareGame, {}, showMenu);
      if (mode === 'circle') return showGame(circleGame, {}, showMenu);
      if (mode === 'bomb') return showBombPick();
      if (mode === 'slot') return showSlot();
      return showFlip();
    },
    onProfile: showProfile,
  });
  // 主菜单是最外面那一屏：在这儿按返回键（安卓的实体键、浏览器的后退）就该
  // 退出小工具，不再往回走，所以不给它挂返回处理。
  setScreenBack(null);
}

/** 炸弹：先挑方块还是小球，再开局。 */
function showBombPick() {
  teardown();
  renderShapePick(root, LANG, {
    title: '炸弹',
    tagline: '红色是危险色 · 四颗连起来这一局就结束',
    onBack: showMenu,
    onPick: (family) => showGame(gameFor(family), { bomb: true }, showBombPick),
  });
  setScreenBack(showMenu);
}

/** 老虎机：网页版那一屏原样搬过来——挑图形、转滚筒、抽出这一局的得分图案。 */
function showSlot() {
  teardown();
  renderRandomTargetPage(
    root,
    LANG,
    {
      onBack: showMenu,
      onStart: (family: Family, targets: TargetPattern[]) =>
        showGame(gameFor(family), { targets }, showSlot),
      // 这一版全部免费，没有「没开通」这条岔路；给个空函数只是接口要它。
      onGenius: () => {},
    },
    false,
  );
  // 这一版只有方块和小球——三角整块不做（见 xhs/README.md）。网页版那一屏
  // 摆的是三个，所以画完把三角那颗摘掉。
  //
  // 不去改 src/ui/slotMachine.ts 的 FAMILIES：那是网页版正在用的清单，动它
  // 等于动网页版。摘一颗按钮是这一版自己的事，就在这一版里做。
  // 剩下两颗自己会重新居中（.slot-pick-row 是 justify-content: center）。
  root.querySelector('.slot-pick-opt[data-family="triangle"]')?.remove();
  setScreenBack(showMenu);
}

/** 无限反转：也是网页版那一屏，挑方块或小球。 */
function showFlip() {
  teardown();
  renderFlipModePage(
    root,
    LANG,
    {
      onBack: showMenu,
      onStart: (family) =>
        showGame(gameFor(family), { flip: true, timeLimitSec: FLIP_SECONDS }, showFlip),
      onGenius: () => {},
    },
    false,
  );
  setScreenBack(showMenu);
}

/** 成绩 + 说明，一屏。底排那颗橙色圆进来的就是这里。 */
function showProfile() {
  teardown();
  renderProfilePage(root, BOOKS, LANG, { onBack: showMenu, onOpenRun: showRun });
  setScreenBack(showMenu);
}

/** 点开成绩页里的某一局：那一张战绩图 + 发笔记 / 存相册。 */
function showRun(run: StoredRun) {
  teardown();
  renderRunSheet(root, run, LANG, { onBack: showProfile });
  setScreenBack(showProfile);
}

// ---- 起飞 -------------------------------------------------------------------

// 这一版**只有浅色**。网页版有一套深色主题（跟着手机的深色模式走），在小
// 工具里它带来的是一个玩家没要过的界面：手机开着深色模式，主菜单整片变成
// 近黑的 #1E1820，而棋盘那一屏又是固定配色、看着照旧——同一个小工具，两屏
// 两个世界。玩家的原话是「主菜单的背景是全黑的，请修复」。
//
// 锁法用的是样式表自己留的那个口子：深色的每一条都写成
// `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ... }`，
// 所以根元素上钉一个 data-theme="light"，整套深色就都不生效了。src/ 一个字
// 不用动，网页版的深色主题照旧。
document.documentElement.setAttribute('data-theme', 'light');

// 样式：先装网页版那一整套（字体 + 主样式 + 两副棋盘 + 开场动画，见
// src/injectStyles.ts），再把这一版的 Chrome 61 基线层叠在后面——同名规则
// 以后来的为准。
injectStyles();
const extra = document.createElement('style');
extra.id = 'xhs-styles';
// 两层，顺序有讲究：先是这一版自己那两块的样式，再是 Chrome 61 的降级层
// （降级层要能盖住前面所有人）。
extra.textContent = pagesCss + '\n' + baselineCss;
document.head.appendChild(extra);

installBackNav();
// 开场那段动画和网页版同一份（纯本地，anime.js 打在包里）。放完进主菜单。
void showLoadingScreen().then(showMenu);
