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
 * 教学也是网页版那一份：第一次点开基础方块 / 基础小球，先放它那一段分镜动画
 * （src/ui/tutorial.ts、src/ui/circleTutorial.ts，连 1.5 倍速都是网页版的）；
 * 六条规则那一屏在成绩页和暂停面板里等着人自己点。见 showShapeStory 与
 * ./tutorial.ts 开头那段。
 *
 * 这一版自己的东西只有四件：主菜单（五张卡）、本机游玩历史、介绍页、以及
 * Chrome 61 的基线样式层。多人小屋、排行榜、登录订阅、语言选择整块不做
 * （见 xhs/README.md）。
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
import { renderTutorial } from '../../src/ui/tutorial';
import { renderCircleTutorial } from '../../src/ui/circleTutorial';
import { installBackNav, setScreenBack } from '../../src/engine/backNav';
import { loadAllRuns } from '../../src/engine/persistence';
import { showLoadingScreen } from '../../src/ui/loadingScreen';
import type { Lang } from '../../src/i18n';

import { installOldKernel } from './oldKernel';
import { openTutorial, storySeen, markStorySeen, type StoryFamily } from './tutorial';
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
/**
 * 这一版只有方块和小球两副棋盘。
 *
 * 从前这里写的是「不是小球就当方块」，那是一条会闷声出错的路：万一有个
 * 'triangle' 传进来，抽出来的是三角的得分图案，摆出来的却是方块的棋盘——
 * 玩家看到的就是「完全错误」的一局，而代码一声不吭。真发生过一次（老虎机
 * 那一屏的三角按钮当时还在）。
 *
 * 现在只认这两个，别的返回 null，由调用方决定怎么办（都是「当没点」）。
 */
const gameFor = (family: Family): ShapeGame | null =>
  family === 'circle' ? circleGame : family === 'square' ? squareGame : null;

/** 开一局，但形状不是这一版有的就当没点——宁可没反应，也不能开错一局。 */
function startWith(family: Family, opts: ShapeGameOpts, back: () => void): void {
  const game = gameFor(family);
  if (game) showGame(game, opts, back);
}

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
  closeTutorial?.();
  closeTutorial = null;
  root.innerHTML = '';
  // 离开这一屏就摘掉「正在玩」那个标记，见下面 showGame 上的说明。
  document.documentElement.classList.remove('is-playing');
}

/**
 * 开一局。除了 lang，选项原样交给网页版那个 mount。
 *
 * 第一次开基础方块 / 基础小球时，先放那一段分镜动画（见 showShapeStory）——
 * 放完才真的进局。所以这里分成两步：mountNow 是「真的开」，前面那道岔是
 * 「要不要先看一段」。
 */
function showGame(game: ShapeGame, opts: ShapeGameOpts, onBack: () => void) {
  teardown();

  const mountNow = () => {
    activeDestroy = game.mount(root, onBack, { ...opts, lang: LANG });
    // 「正在玩」这个标记要钉在 <html> 上：游戏页的底色、藏底排、禁掉页面滚动
    // 这三件事，src/style.css 里各写了两遍——一遍用 body:has(.app--game)，一遍
    // 用 html.is-playing。:has 是 Chrome 105 才有的，老内核上只剩后面那一遍，
    // 而钉这个类的是网页版的 src/main.ts，这一版没有它。不钉的话，老安卓上一
    // 进游戏底色不变、页面还能上下滑。
    //
    // 钉在这儿而不是函数开头：教学那一屏不是棋盘，它要能上下滑、底色也照旧。
    document.documentElement.classList.add('is-playing');
    enhanceShareOverlay();
    enhancePauseTutorial();
    setScreenBack(onBack);
  };

  const fam = storyFamilyFor(game, opts);
  if (fam && !storySeen(fam)) {
    // 记在「看到」而不是「看完」：它一族只放一次，中途退出去的人也算被请过了。
    // 和网页版同一条（src/main.ts 的 markTutorialSeen 就在 render 之前）。
    markStorySeen(fam);
    showShapeStory(fam, mountNow, onBack);
    return;
  }
  mountNow();
}

/**
 * 这一局要不要先放分镜动画？要的话放哪一族的。
 *
 * 只有**基础**方块和基础小球会放。炸弹、老虎机、无限反转都不放——那三个是
 * 在基础玩法上加一层规则，玩到那儿的人已经会滑了，中间插一段「这个形状怎么
 * 玩」是把他从自己的节奏里拽出来。判断条件和网页版一字不差（src/main.ts 的
 * `opts?.timeLimitSec || opts?.bomb || opts?.targets ? null : shapeTutorialFor(...)`）：
 *
 *   bomb         炸弹
 *   targets      老虎机（这一局的得分图案是转出来的）
 *   timeLimitSec 无限反转（60 秒）
 */
function storyFamilyFor(game: ShapeGame, opts: ShapeGameOpts): StoryFamily | null {
  if (opts.bomb || opts.targets || opts.timeLimitSec) return null;
  const id = game.card.id;
  if (id.indexOf('square') === 0) return 'square';
  if (id.indexOf('circle') === 0) return 'circle';
  return null;
}

/**
 * 放一段分镜动画。用的是网页版那两个原件，一个字没改：
 *
 *   方块  src/ui/tutorial.ts       renderTutorial
 *   小球  src/ui/circleTutorial.ts renderCircleTutorial
 *
 * 连播放速度都是网页版的（storyTutorial.ts 里那个 `SPEED = 1.5`）——玩家定的
 * 「这两个都照网页版的加速」。下面那四颗键（上一条 / 再一次 / 下一条 / 完成）
 * 也是原件自带的，这一版不加不减不改。
 *
 * 这一屏是**纯动画、没有一个字**：要看字的人去成绩与说明页点《怎么玩》，或者
 * 局中按暂停——那两处是六条规则加配图的详细版（见 tutorial.ts）。
 *
 * 返回键在这一屏按下去回主菜单，不是进这一局：人是在「还没开始」的地方，退
 * 出该退回他来的地方。和网页版那句注释同一个意思（renderShapeTutorialByShape
 * 的 onBack 参数）。
 */
function showShapeStory(fam: StoryFamily, onDone: () => void, onBack: () => void) {
  if (fam === 'square') renderTutorial(root, LANG, onDone);
  else renderCircleTutorial(root, LANG, onDone);
  setScreenBack(onBack);
}

/** 教学窗开着的话，关掉它的那只手。换屏时要用（见 teardown）。 */
let closeTutorial: (() => void) | null = null;

function showTutorial(after?: () => void) {
  closeTutorial?.();
  closeTutorial = openTutorial(LANG, () => {
    closeTutorial = null;
    after?.();
  });
}

/**
 * 暂停面板里加一颗《怎么玩》。
 *
 * 和分享窗口那处一样，是「挂好之后改 DOM」：网页版那块面板的额外按钮来自
 * 形状自己的 meta.extraControls（src/ui/gameShell.ts），从这一版传不进去，
 * 而 src/ 这一版只读不写。改动只在这一版的包里发生。
 *
 * 位置放在色盲开关和《继续》之间：面板从上到下是「设置 → 帮助 → 回去玩」。
 */
function enhancePauseTutorial() {
  const modal = root.querySelector<HTMLElement>('#pauseOverlay .modal');
  const resumeRow = modal?.querySelector<HTMLElement>('#continueBtn')?.closest<HTMLElement>('.btn-row');
  if (!modal || !resumeRow) return;
  const row = document.createElement('div');
  row.className = 'btn-row';
  row.innerHTML = '<button class="icon-btn pause-switch xhs-how-btn" type="button"><span>怎么玩</span></button>';
  modal.insertBefore(row, resumeRow);
  row.querySelector('button')?.addEventListener('click', () => showTutorial());
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
    onPick: (family) => startWith(family, { bomb: true }, showBombPick),
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
        startWith(family, { targets }, showSlot),
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
        startWith(family, { flip: true, timeLimitSec: FLIP_SECONDS }, showFlip),
      onGenius: () => {},
    },
    false,
  );
  setScreenBack(showMenu);
}

/** 成绩 + 说明，一屏。底排那颗橙色圆进来的就是这里。 */
function showProfile() {
  teardown();
  renderProfilePage(root, BOOKS, LANG, {
    onBack: showMenu,
    onOpenRun: showRun,
    onHowToPlay: () => showTutorial(),
  });
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

// 样式装完之后立刻上 Chrome 61 降级层：它要就地改写上面这两块
// （把 clamp/min/max 算成 px、svh 换成 vh、env 换成默认值、gap 换成子项的
// 外边距），所以必须排在两块都进了 <head> 之后。新内核上它什么也不做。
installOldKernel();

installBackNav();
// 开场那段动画和网页版同一份（纯本地，anime.js 打在包里）。放完进主菜单。
void showLoadingScreen().then(showMenu);
