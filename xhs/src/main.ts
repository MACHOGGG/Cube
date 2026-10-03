/**
 * Slides · 小红书小工具版的入口。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这个文件只做「哪一屏」，不做「怎么玩」
 *
 * 六个玩法全部是网页版同一个入口的六组开关（src/shapes/types.ts 的
 * ShapeGameOpts）：
 *
 *   基础方块   createSquareGame().mount(root, back, {})
 *   基础小球   createCircleGame().mount(root, back, {})
 *   炸弹       { bomb: true }
 *   老虎机     { target: 转出来的那个图案 }
 *   无限反转   { flip: true, timeLimitSec: MODE_SECONDS }  // 100 秒
 *
 * 棋盘、滑动手感、得分判定、连锁节拍、翻面动画、结算、战绩图——一律走网页
 * 版那一份，这里一个字都不改。玩家定的：选出来的玩法要「完全复刻一样」。
 *
 * 教学也是网页版那一份，而且**一次都不自己跳出来**（玩家定的，网页版同一条）：
 * 五条规则那一屏得玩家自己按——成绩与说明页那颗《怎么玩》；局中按暂停，面板里还
 * 有一颗。见 ./tutorial.ts 开头那段。从前五条上头还摆着方块和小球两颗分镜键（网页版
 * 那两段分镜动画），第 14 推下线了：那两段还在教旧规则。
 *
 * 这一版自己的东西只有四件：主菜单（六张卡）、本机游玩历史、介绍页、以及
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
import { renderPuzzleModePage } from '../../src/ui/puzzleMode';
import { installBackNav, setScreenBack } from '../../src/engine/backNav';
import { loadAllRuns } from '../../src/engine/persistence';
import { showLoadingScreen } from '../../src/ui/loadingScreen';
import type { Lang } from '../../src/i18n';
import { suffixFor } from '../../src/engine/runKey';
import { wipeOldRules } from '../../src/engine/wipeOldRules';
import { MODE_SECONDS } from '../../src/engine/modeClock';
import { registerCards } from '../../src/shapes/registry';

import { installOldKernel } from './oldKernel';
import { installTopInset } from './topInset';
import { installMenuFit, scheduleFitMenu } from './menuFit';
import { knowsHow, setKnowHowKey } from '../../src/engine/firstPlay';
import { openTutorial, storySeen, markStorySeen, RULE_ART_CIRCLE, RULE_ART_SQUARE } from './tutorial';
import { bombTip, flipTip, puzzleTip, slotTip } from '../../src/ui/modeTips';
import { renderXhsMenu, XHS_ADVANCED_MODES, type XhsMode } from './menu';
import { renderProfilePage, type Book } from './profile';
import { renderRunSheet } from './runSheet';
import { renderShapePick } from './shapePick';
import { mountShareActions } from './shareActions';
import type { StoredRun } from '../../src/engine/persistence';

/** 小红书是中文平台，这一版固定简体中文——没有语言选择页。 */
const LANG: Lang = 'zhHans';
/**
 * 无限反转一局多长。**从前这里手抄网页版那个数**，靠一句注释「和网页版同一个数」
 * 维持同步——注释维持不了任何东西：网页端 120→60 那一次，这一份就落后过一版。
 * 现在两端读同一个常量（src/engine/modeClock.ts），抄不歪。
 */
const FLIP_SECONDS = MODE_SECONDS;

const root = document.getElementById('app') as HTMLElement;
const squareGame = createSquareGame();
const circleGame = createCircleGame();

/**
 * 把这一版这两副棋盘的名片交给那张表（shapes/registry.ts）。
 *
 * ⚠️ **这一句不喊，这一版当场就崩。** `cardOf(id)` 查不到会直接抛（那是它的本意
 * ——从前四处按 id 前缀猜、猜错不报错，见 registry.ts 文件头），而 gameShell 每开
 * 一局都要查一次。网页版在 src/main.ts 建好六个游戏之后喊了这一句；2026-09 加这套
 * 注册的时候只改了网页那一头，这一端**漏了**，于是老虎机那一局开不起来，报
 * 「不认识的玩法 id：square」。check-vsweb 逮到的。
 *
 * 为什么不在 registry.ts 里直接 import 工厂：每一副棋盘都 import gameShell，而
 * gameShell 要用 cardOf，反过来 import 就成环，那张表会在第一次被查的时候还是空的。
 * 所以**每一个入口自己注册它真的建了哪几副**——这一版只有两副。
 */
registerCards([squareGame.card, circleGame.card]);
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
 * 成绩那一页要翻的八本存档：两副棋盘 × 四种模式（2026-10 加《步步为营》之前是六本）。
 *
 * 键名问玩法自己要（card.bestKey）再接后缀，而后缀**一律走 engine/runKey.ts 的
 * `suffixFor`**，和棋盘真正存进去时调的是同一个函数。
 *
 * ⚠️ 这几行从前是手写的字面量（`''` / `'_bomb2'` / `'_flip'`）。手写的那一版
 * 2026-09 静悄悄地全错了：《侵蚀阶梯》v1.2 §6 给每个键都加了一截 `_ero1`
 * （scoring.ts 的 SCORING_RULES_VERSION），炸弹那一版也早升到了第 3 版——于是这
 * 一页按三个不存在的键去找，**成绩页上一条记录都没有，累计得分永远是 0**，而且
 * 不报任何错。check-vsweb 逮到的：网页版那一栏有一行，这一版是空的。
 *
 * 网页版的 `recordSources`（src/main.ts）因为同一件事修过一次，那边的说明写得更
 * 长。两处现在调的是同一个函数，下一次升版本两边一起跟着走。
 *
 * 老虎机没有自己的后缀——它换的只是得分图案，记在基础那本上，和网页版一致。
 */
const BOOKS: Book[] = [
  { card: squareGame.card, suffix: suffixFor('base') },
  { card: circleGame.card, suffix: suffixFor('base') },
  { card: squareGame.card, suffix: suffixFor('bomb') },
  { card: circleGame.card, suffix: suffixFor('bomb') },
  { card: squareGame.card, suffix: suffixFor('flip') },
  { card: circleGame.card, suffix: suffixFor('flip') },
  // 《步步为营》2026-10 补进来（决策 §10 的 E20）。少了这两本，这一档打完的局在成绩页上
  // **整片不存在**，而且不报任何错——和上面那段说的是同一个毛病。
  { card: squareGame.card, suffix: suffixFor('puzzle') },
  { card: circleGame.card, suffix: suffixFor('puzzle') },
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
 * **开局前不放分镜动画**（玩家定的，网页版同一条）：点哪个玩法就直接落进棋盘。
 * 那一段第 14 推整个下线了（还在教旧规则），连成绩与说明页那个入口也撤了。
 *
 * 这段说明以前写的是反的（「第一次开基础方块 / 基础小球时先放一段，放完才真的
 * 进局」），那是上一版的行为。照着它去「修」代码，就会把玩家否掉的自动播放加
 * 回来，而且 check-story 当场红——那时候人还不知道自己修错了哪一头。
 */
function showGame(game: ShapeGame, opts: ShapeGameOpts, onBack: () => void) {
  teardown();

  const mountNow = () => {
    // shouldLeadOut：结算页那对指路的光只在他头一回看见结算页时亮一次（玩家
    // 定的）。每一局都挂上，真正判「是不是头一回」的是结算页露面那一刻。
    // shouldTeachTotal 同理：结算页那一句「综合得分怎么算」，也只摆头一回。
    activeDestroy = game.mount(root, onBack, {
      shouldLeadOut: claimFirstEndcard,
      shouldTeachTotal: claimFirstTotalTip,
      ...opts,
      lang: LANG,
    });
    // 「正在玩」这个标记要钉在 <html> 上：游戏页的底色、藏底排、禁掉页面滚动
    // 这三件事，src/style.css 里各写了两遍——一遍用 body:has(.app--game)，一遍
    // 用 html.is-playing。:has 是 Chrome 105 才有的，老内核上只剩后面那一遍，
    // 而钉这个类的是网页版的 src/main.ts，这一版没有它。不钉的话，老安卓上一
    // 进游戏底色不变、页面还能上下滑。
    //
    // 钉在这儿而不是函数开头：教学那一屏不是棋盘，它要能上下滑、底色也照旧。
    document.documentElement.classList.add('is-playing');
    enhanceShareOverlay();
    dropProSwitch();
    setScreenBack(onBack);
  };

  // 开局前不再自己放分镜动画（玩家定的，网页版同一条）。那两段第 14 推整个下线
  // 了（还在教旧规则）；规矩看成绩与说明页那一颗《怎么玩》，五条规则。
  mountNow();
}

// 从前这儿有一个 showShapeStory：放一段分镜动画（网页版 src/ui/tutorial.ts 和
// circleTutorial.ts 那两个原件）。第 14 推下线了——那两段还在教旧规则，方案定的是
// 「直接下线入口，不重做」。《怎么玩》那一屏现在只有五条规则。

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
 * 战绩图底下那句「长按或右键保存」，在这一版换成两颗键：《发笔记》《存相册》。
 *
 * 网页版靠的是浏览器的长按菜单，小工具的容器把它禁掉了——玩家长按什么也不会
 * 发生，那句话在这儿是假话。规范给的替代品是两个原生接口，见 shareActions.ts
 * （和成绩页里点开一局看到的是同一套）。
 *
 * 两处都要换：结算页上那张图（#endShareImg，玩家定的「整合分享和结算」），
 * 和按《分享》放大看的那一窗（#shareImage）。
 *
 * 用「挂完之后改 DOM」而不是改 src/ui/gameShell.ts：那个文件是网页版正在跑
 * 的东西，这一版的规矩是只读不写。改动只在这一版的包里发生。
 *
 * 图是现取的，不是现在这一刻的——每打完一局 gameController 都会把新的
 * data:uri 塞进那个 <img>，所以按下去的时候才读它。
 */
function enhanceShareOverlay() {
  swapHintForActions(root.querySelector<HTMLImageElement>('#endShareImg'), '.end-share');
  swapHintForActions(root.querySelector<HTMLImageElement>('#shareImage'), '.share-modal');
}

/**
 * 暂停面板里那颗《Pro》，这一版不要。
 *
 * 玩家定的：这一版**没有 Pro 模式**。Pro 是「在棋盘上描出这一枚得分之后会变成什么
 * 颜色」的开关，属于完整版；留在这儿，玩家拨得动、也真的会生效，于是这一版就凭空
 * 多了一个完整版才有的东西。
 *
 * 和上面换分享键同一条路：**挂完之后改 DOM**，不去动 src/ui/gameShell.ts——那个文
 * 件是网页版正在跑的东西，这一版的规矩是只读不写。
 *
 * 整行一起摘（不是只藏那颗键）：`.btn-row` 是个 flex，光把按钮 display:none 掉会
 * 留下一条空行的外边距，面板上多一道说不清的缝。
 */
function dropProSwitch() {
  root.querySelector('#proBtn')?.closest('.btn-row')?.remove();
}

/**
 * 把 `img` 所在那一块里的「长按保存」换成两颗原生键。
 *
 * `boxSel` 是那一块的选择器——结算页上是 <figure class="end-share">，放大看
 * 的那一窗是 .share-modal。
 */
function swapHintForActions(img: HTMLImageElement | null, boxSel: string) {
  const modal = img?.closest<HTMLElement>(boxSel);
  if (!img || !modal) return;
  // 「长按保存」那句在这儿是假话，去掉。
  modal.querySelector('.hint')?.remove();
  const host = document.createElement('div');
  host.className = 'xhs-share-host';
  // 放大看的那一窗里，两颗键要摆在《关闭》上面；结算页那块 <figure> 里没有
  // 别的东西，接在图后面就是。
  const before = modal.querySelector('.btn-row');
  if (before) modal.insertBefore(host, before);
  else modal.appendChild(host);
  // 每换一张图就重挂一次：分数和图都变了。用 MutationObserver 盯着 src。
  const remount = () => {
    host.innerHTML = '';
    // 每次都重新去存档里取最新那一局——图落下来的时候这一局刚存进去。
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

/**
 * 头一回打开这个小工具时的第一屏。
 *
 * 不是主菜单，是直接开一局《基础小球》——那几张卡摊在眼前，刚点进来的人不知
 * 道先按哪一张。showGame 自己那道教学闸口会先放小球的分镜动画（和点开那张
 * 卡看到的是同一段），学完就在同一屏里打，打完按《退出》才第一次见到主菜
 * 单。往后每次进来都直接是主菜单。和网页版同一条（src/main.ts 的 isFirstRun）。
 *
 * 钥匙是这一版自己的（slides.xhs.*），和网页版那把互不相干——玩家定的：两
 * 边的存档完全分开。判「头一回」看两把钥匙，缺一不可：这把没立过，而且小球
 * 那段分镜也没看过。只看新钥匙的话，第一版审核时就玩过的人升上来会被当成新
 * 人，重新按进一局小球里。
 */
const FIRST_RUN_KEY = 'slides.xhs.firstRun';

/**
 * 「这个玩法他开过没有」——头一回进去时才有的那点招待，都靠它。
 *
 *   square          头一回点开《基础方块》：棋盘底下那块教学条按 'square' 那
 *                   一路走（先不出声，见 ui/coachBar.ts）；在他开过之前，主菜
 *                   单上那张卡一直镶着一圈光。
 *   bomb/slot/flip/ 头一回进去：棋盘底下摆一句话说清加的那一层规矩，15 秒自
 *   puzzle          己走掉（ui/modeTips.ts）。
 *
 * 存不进 localStorage（容器把它关了）就当「已经开过」——宁可少招待一次，也
 * 不要每一局都重来一遍：一句每次都冒出来的提示比没有还烦。
 *
 * **这张表和 `src/engine/firstPlay.ts` 的 `PlayKey` 是两张**（这一端的键带
 * `slides.xhs.` 前缀，玩家定的「两边存档完全分开」）。所以主菜单加一档玩法要
 * **两边都加**：2026-10 补《步步为营》时只加了 `PlayKey` 那一张，于是
 * `npm run build:xhs` 当场编译不过——`npm run typecheck`（`tsc -b`）**管不到
 * `xhs/`**，它用的是 `xhs/tsconfig.json`。
 */
type FirstKey = 'square' | 'bomb' | 'slot' | 'flip' | 'puzzle' | 'endcard' | 'totaltip';
const OPENED_KEY = (k: FirstKey) => `slides.xhs.opened.${k}`;

/** 小球和方块都打过一遍了没有——主菜单要不要再压暗别的玩法，看这个。 */
function basicsDone(): boolean {
  // 按过《我会玩》就当路已经走完了——那颗按钮撤掉的就是这套路标（见
  // src/engine/firstPlay.ts 的 knowsHow）。
  if (knowsHow()) return true;
  try {
    return storySeen('circle') && !firstTimeIn('square');
  } catch {
    return true;
  }
}

function firstTimeIn(k: FirstKey): boolean {
  try {
    // 方块还认那段分镜的旧钥匙：上一版玩过方块的人升上来不该又被当成新人。
    if (k === 'square' && storySeen('square')) return false;
    return localStorage.getItem(OPENED_KEY(k)) !== '1';
  } catch {
    return false;
  }
}

function markOpened(k: FirstKey): void {
  try {
    localStorage.setItem(OPENED_KEY(k), '1');
  } catch {
    /* 存不进去就下次再招待一遍，不是什么大事 */
  }
}

/**
 * 结算页那对指路的光（《分享》→《首页》）该不该亮。
 *
 * 玩家定的：「只有第一次结算的时候这两个轮流发光，随后的每局游戏都不要发
 * 光」。判的是「他见过结算页没有」，不是「这一局有没有教学条」——头一回进炸
 * 弹、进老虎机同样有教学条，可那时候结算页早看过了。
 *
 * 钥匙存在这一版自己的命名空间里（玩家定的第一条：和网页版完全分开）。结算
 * 页真的露面了才叫得到这儿，所以打到一半退出去的局不会白白把这一次用掉。
 */
function claimFirstEndcard(): boolean {
  if (!firstTimeIn('endcard')) return false;
  markOpened('endcard');
  return true;
}

/**
 * 结算页那一句「综合得分怎么算」该不该摆（只摆头一回）。
 *
 * 网页版是 src/engine/firstPlay.ts 的 claimFirstTotalTip，这一版从前**没接**：mount
 * 只传了 shouldLeadOut，没传 shouldTeachTotal（第 14 推），于是五条规矩的最后一条——
 * 从棋盘底下挪到结算页上的那一句——在小红书这边一次都没摆过。钥匙和上面那颗光一样
 * 存在这一版自己的命名空间里，各记各的。
 */
function claimFirstTotalTip(): boolean {
  if (!firstTimeIn('totaltip')) return false;
  markOpened('totaltip');
  return true;
}

function firstScreen(): void {
  let first = false;
  try {
    first = localStorage.getItem(FIRST_RUN_KEY) !== '1' && !storySeen('circle');
  } catch {
    /* 容器把 localStorage 关了：当老玩家处理，直接进主菜单，别硬按进一局里 */
  }
  if (!first) return showMenu();
  try {
    localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    /* 存不进去就下次再来一遍，不是什么大事 */
  }
  // 小球那段分镜在这儿**不放**，直接落进棋盘（玩家定的）：怎么滑，棋盘底下那
  // 块教学条会一条一条说，何况手指按上去就知道了；先看一段没有互动的动画，反
  // 而是把刚点进来的人挡在门外。
  //
  // 记成「看过」而不是绕过闸口：小球那一段的内容他已经在这一局里边玩边学过
  // 了。开局本来就不再自动放分镜（见 showGame），所以这一笔管的是别处——主菜
  // 单要不要压暗其余玩法（basicsDone 读的就是它），以及首玩期那几句提示还认不
  // 认他是新人。方块那一格不动：他还没碰过方块。
  markStorySeen('circle');
  // coach：棋盘底下那块教学条（ui/coachBar.ts）。头一局才给——这一局的规矩全
  // 靠它讲。配图用这一版摘掉三角的那一份。
  //
  // noCountdown：这一局不数 4-3-2-1，直接落进棋盘（玩家定的：「第一回合小球
  // 的版本里取消 4-3-2-1 倒计时，之后其他的所有都保留只有这个取消」）。这是
  // 新来的人打开小工具看见的第一屏，他还不知道这是什么——让他先看见棋盘和棋
  // 盘底下那句话，比先让他对着四个数字等四秒管用。往后每一局照旧数。
  showGame(
    circleGame,
    { coach: true, coachArt: RULE_ART_CIRCLE, noCountdown: true },
    showMenu,
  );
}

// ---- 各屏 -------------------------------------------------------------------

function showMenu() {
  teardown();
  renderXhsMenu(root, LANG, {
    // 主菜单不再单独点亮某一张：基础那两个正常亮，其余几个调暗一档（玩家
    // 定的「基础的两个玩法是明亮的，剩下的轻微暗淡」，见 menu.ts 的 soon）。
    glow: [],
    /**
     * 炸弹 / 老虎机 / 无限反转 / 步步为营：完整版里还有更进阶的玩法，这儿标一块牌子
     * 当预告。这一版它们照样免费——牌子不拦手，点开就能玩。牌子是常驻的。
     *
     * ⚠️ 这一行和下面那一行是**按玩法逐个点名的**，所以主菜单加一档就要一起加。
     * 2026-10 补《步步为营》时漏过：六张卡里只有它一张既不暗也没牌子——四个兄弟都
     * 有、它没有，看上去像是「这张才是正式的」，而玩家定的是「基础的两个明亮，剩下
     * 的轻微暗淡」。少的不是功能，是一屏卡说不到一块去。
     */
    soon: XHS_ADVANCED_MODES,
    // 暗淡只在头几局当路标：小球和方块都打过一遍之后就撤掉（玩家定的）。
    // 那时候路他自己认得了，再压着别的玩法只剩「这几个不太重要」这一层意
    // 思，不是我们想说的。
    dim: basicsDone() ? [] : XHS_ADVANCED_MODES,
    // 按了《我会玩》就地重画：上面那三样（glow / soon / dim）都由 basicsDone 算。
    onKnowHow: showMenu,
    onPlay: (mode: XhsMode) => {
      // 一档一条，**不留落空的默认分支**。从前最后一档写的是 `return showFlip()`
      // 兜底：补《步步为营》那天，这一句的意思就从「flip 走这儿」悄悄变成了「凡是
      // 没列到的都走无限反转」——接错一整屏，编译器一声不响。改成穷举 switch 之
      // 后，`XhsMode` 再加一档而这儿漏了，`never` 那一行当场编译不过。
      switch (mode) {
        case 'square':
          return showSquare();
        case 'circle':
          return showGame(circleGame, {}, showMenu);
        case 'bomb':
          return showBombPick();
        case 'slot':
          return showSlot();
        case 'flip':
          return showFlip();
        case 'puzzle':
          return showPuzzle();
      }
      const missed: never = mode;
      return missed;
    },
    onProfile: showProfile,
  });
  // 卡多大要等这一屏排完版才算得了，所以画完再叫一声。
  scheduleFitMenu();
  // 主菜单是最外面那一屏：在这儿按返回键（安卓的实体键、浏览器的后退）就该
  // 退出小工具，不再往回走，所以不给它挂返回处理。
  setScreenBack(null);
}

/**
 * 基础方块。头一回点开时棋盘底下也给一块教学条，但走的是另一路（'second'）。
 *
 * 他刚打完那一局小球，五条已经跟着走过一遍了，所以这块条子只讲第 4 条——方块
 * 自己的那一条（任意整行整列，不是最外边）；条件和头一局一样：盘上第一次出现
 * 「某一种颜色的星星 ≥ 较短那条边」时才开口，之前不出声（第 15 推，见
 * src/ui/coachBar.ts 的文件头）。配图和文字都换成方块那一份。
 *
 * 分镜动画不放了：那两段第 14 推整个下线（还在教旧规则），开局也不再自动放（见
 * showGame）。
 */
function showSquare(): void {
  const first = firstTimeIn('square');
  if (first) markOpened('square');
  showGame(
    squareGame,
    first ? { coach: true, coachPlan: 'second', coachArt: RULE_ART_SQUARE } : {},
    showMenu,
  );
}

/**
 * 炸弹 / 老虎机 / 无限反转头一回进去时，棋盘底下摆的那一句。
 *
 * 这三个都是在基础规则上加一层，所以只说加的那一层，摆 15 秒自己走掉（玩家
 * 定的）。第二回再进来就没有了——同一句话说两遍就成了噪音。
 *
 * 配图跟着他刚挑的图形走（炸弹、无限反转），老虎机那幅直接用这一局转出来的
 * 那个得分图案——就是他抬头在 HUD 右边那一块上看见的同一个。
 *
 * 返回的是 ShapeGameOpts 的一小撮字段，摊进开局那个大 opts 里；不是头一回就
 * 返回空对象，什么也不加。
 */
function tipFor(
  kind: 'bomb' | 'slot' | 'flip' | 'puzzle',
  family: Family,
  target?: TargetPattern,
): ShapeGameOpts {
  if (!firstTimeIn(kind)) return {};
  // 老虎机那一句要有个目标才画得出配图（《侵蚀阶梯》v1.2 PR-8 之后是一个，不是一
  // 对）。走到这儿一定有——showSlot 那边抽好了才开局。真没有就当这一回不算「头
  // 一回」：先检查再 markOpened，不然那面旗子被烧掉了，条子却一次都没摆过。
  if (kind === 'slot' && !target) return {};
  markOpened(kind);
  // 这一版只有方块和小球，三角整块不做；真来了个别的就当方块画。
  const shape = family === 'circle' ? 'circle' : 'square';
  const tip =
    kind === 'bomb'
      ? bombTip(LANG, shape)
      : kind === 'flip'
        ? flipTip(LANG, shape)
        : kind === 'puzzle'
          ? puzzleTip(LANG)
          : slotTip(LANG, target!);
  return { coach: true, coachTip: tip };
}

/** 炸弹：先挑方块还是小球，再开局。 */
function showBombPick() {
  teardown();
  renderShapePick(root, LANG, {
    title: '炸弹',
    tagline: '红色是危险色 · 四颗连起来这一局就结束',
    onBack: showMenu,
    onPick: (family) => startWith(family, { bomb: true, ...tipFor('bomb', family) }, showBombPick),
  });
  setScreenBack(showMenu);
}

/**
 * 老虎机：网页版那一屏原样搬过来——挑图形、转滚筒、抽出这一局的得分图案。
 *
 * 从前这儿画完还要 `root.querySelector('.slot-pick-opt[data-family="triangle"]')
 * ?.remove()`——那会儿网页版那一屏摆的是三个图形，这一版只有两个。《侵蚀阶梯》
 * v1.2 PR-6 把三角那副基础棋盘删了之后，网页版自己也只剩两个，那一句从此摘的是
 * 一个不存在的节点：不报错，只是在骗后来看代码的人「这一版和网页版的清单不一
 * 样」。清单现在两头同一份，所以那一句连着它的注释一起删掉。
 */
function showSlot() {
  teardown();
  renderRandomTargetPage(
    root,
    LANG,
    {
      onBack: showMenu,
      onStart: (family: Family, target: TargetPattern) =>
        startWith(family, { target, ...tipFor('slot', family, target) }, showSlot),
      // 这一版全部免费，没有「没开通」这条岔路；给个空函数只是接口要它。
      onGenius: () => {},
    },
    false,
  );
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
        startWith(family, { flip: true, timeLimitSec: FLIP_SECONDS, ...tipFor('flip', family) }, showFlip),
      onGenius: () => {},
    },
    false,
  );
  setScreenBack(showMenu);
}

/**
 * 步步为营：网页版那一屏，挑方块或小球（决策 §10 的 E20）。
 *
 * 最后那个 `false` 是「挂不挂锁」。网页端这一档是天才特供，所以那边传的是
 * `!isGenius()`；这一端整个是免费的，没有天才这回事，一律不挂锁——和炸弹、老虎机、
 * 无限反转那三屏一样。
 */
function showPuzzle() {
  teardown();
  renderPuzzleModePage(
    root,
    LANG,
    {
      onBack: showMenu,
      onStart: (family) =>
        startWith(family, { steps: true, ...tipFor('puzzle', family) }, showPuzzle),
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
    // 《怎么玩》：五条规则。上头那两颗分镜键第 14 推撤了（那两段还在教旧规则）。
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

// 从前这儿还喊一声 setRulesTriangle(false)：《怎么玩》那一屏的第 1 幅配图把
// 方块/小球/三角并排画出来，这一版整块没有三角，讲一个玩家见不到的图形只会
// 让人以为自己漏了什么。那一幅 2026-09 随教学改成五条退役了，五幅新图里没有
// 一幅认得出三角，那个开关也就跟着删了（见 src/ui/rulesModal.ts 的文件头）。
// 从前这儿还有一句 setCoachStoreKey('slides.xhs.coach.ero')：教学条那一格「第 3 条做到
// 过没有」分开存。第 15 推那一格整个拆了（第二副棋盘只讲第 4 条，不再补讲第 3 条，见
// src/ui/coachBar.ts 的文件头），这一句跟着删。
// 《我会玩》那把钥匙也换成这一版自己的：容器里两版可能共用一个域名下的存档，
// 一版按过不该把另一版的引导也关掉（整套 slides.xhs. 前缀就是为这件事）。
setKnowHowKey('slides.xhs.knowHow');

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

// 再给小红书自己那排按钮（退出 / 分享 / 用户）让开上面那道——它压在页面上，
// 不让就正好盖住主菜单的标题。见 topInset.ts 开头那段。
installTopInset();
// 主菜单那几张卡按屏幕算大小，别压到底排上。见 menuFit.ts。
installMenuFit();

installBackNav();
/*
 * 《侵蚀阶梯》上线那一次性的清档，这一端从前**一次都没跑过**。
 *
 * 它原先是 `src/main.ts` 里的一个私有函数，只有网页端调；而两端用的是同一组
 * `sugarcube_*` 键名，所以这一端的旧局（按旧规则打的，和新规则不是一把尺子）一直躺
 * 在本机上，成绩页的累计得分是两套规则的和，哨兵键 `slides_wipe_ero1` 也永远不写
 * 入。现在它是 `engine/wipeOldRules.ts`，两端各调一次。
 *
 * 传的是这一端有的那两副棋盘——多传几个不存在的键不花什么，少传一个就会漏掉一批局。
 */
wipeOldRules([squareGame.card.bestKey, circleGame.card.bestKey]);
// 开场那段动画和网页版同一份（纯本地，anime.js 打在包里）。放完进第一屏。
void showLoadingScreen().then(firstScreen);
