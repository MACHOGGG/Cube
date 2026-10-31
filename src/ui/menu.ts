import type { ShapeCardMeta } from '../shapes/types';
import { STRINGS, type Lang } from '../i18n';
import { GENIUS_LAYOUTS } from '../engine/geniusContent';
import { STAGE_OF, type MenuStage } from '../engine/menuStage';
import { shapeName } from './shapeLabels';
import { menuTag } from './menuTags';
import { knowHowButton } from './knowHowBtn';
import { mountModeAxis } from './modeAxis';
import { dailyAria, dailyArtHtml, watchDay } from './dailyArt';
import { dayIndexOf } from '../engine/seedCode';
import { typeTagline } from './typeTagline';

import {
  ICON_BASE_SQUARE,
  ICON_BASE_CIRCLE,
  ICON_BASE_TRIANGLE,
  ICON_TIMED_COMBINED,
  ICON_BOMB_MENU,
  ICON_LOCK,
  ICON_MULTIPLAYER,
  layoutIcon,
  layoutIconIsWide,
  type BaseShape,
  ICON_FLIP_MODE,
  ICON_PUZZLE_MODE,
  ICON_SLOT_MACHINE,
} from './homeIcons';

export interface MenuHandlers {
  onSelectBase: (id: string) => void;
  /**
   * 《每日挑战》那张卡（第 19 推）：进每日挑战那一页（ui/dailyMode.ts）。
   *
   * 手机上是鱼眼轴的第一站；电脑宽版摆在基础那一排的最左边（10-09 补充方案 7-12）。第 3 步才出现（见下面 stage）。
   */
  onDaily: () => void;
  /**
   * 主菜单到了第几步（10-31 方案推12 Z-J02，engine/menuStage.ts）：`STAGE_OF[卡] > stage` 的卡**根本不造**（不是挂锁），
   * 排布顺序不改。第 1、2 步是一排居中的小卡（renderIntro），第 3 步起照今天那一套（手机鱼眼轴、电脑三排）。
   */
  stage: MenuStage;
  /**
   * 主菜单真的画出来过的是第几步（slides_played_stage_shown）：`STAGE_OF[卡] > shown` 的卡这一次演「浮出」。
   * 等于 stage 就一张都不演。
   */
  shown: MenuStage;
  /** 登着没有（signedInEmail）：四副更多布局没登录挂锁，点了开登录窗。天才层 2026-10 取消了。 */
  signedIn: boolean;
  /**
   * 「现在」——今天是哪一天、那张卡画星期几、压哪个日期，全从它算（网页端是服务器的钟，见
   * engine/dailyClock.ts）。不给就用本机的钟。
   */
  now?: () => number;
  /** 一副《更多布局》的棋盘，直接开局。（从前还带一个 reopenKey：从主菜单弹出来的挑选窗里开的那一
   *  局，返回时替他把那扇窗再点开。那几扇窗都改成了整页，炸弹是最后一扇——10-08 方案 3-G。） */
  onSelectLayout: (id: string) => void;
  /** 一副更多布局，没登录的人按到了：开登录窗（10-31 方案推12；原先是订阅窗——天才层取消了）。 */
  onLockedLayout: () => void;
  /** 炸弹那张卡：开炸弹那一页（ui/bombMode.ts，10-08 方案 3-G）。 */
  onBombMode: () => void;
  /** 多人游玩，从主菜单直接进——进去就是房间设置那一页。 */
  onMultiplayer: () => void;
  /** 《随机得分目标》：挑图形、转出这一局的得分图案，然后开局。 */
  onRandomTarget: () => void;
  /** 《无限反转》：挑方块或小球，得分翻面来回翻，100 秒。 */
  onFlipMode: () => void;
  /** 《计时挑战》：挑方块或小球，100 秒。整页，不是从前那个居中挑选窗。 */
  onTimedMode: () => void;
  onPuzzleMode: () => void;
  /**
   * 哪几张基础卡要镶一圈光（engine/firstPlay.ts 的 glowingBasics）。
   *
   * 玩家定的：新人一进来，《基础方块》和《基础小球》两张都亮着；打完一个那
   * 张就不亮了，另一张接着亮，直到两张都打过。两张都打过了给空的，主菜单从
   * 此安安静静——光是用来指路的，路走完了就该撤。
   */
  glow?: readonly BaseShape[];
  /**
   * 按了《我会玩》（只在第 1、2 步摆）：引擎里那把钥匙已经记下了（knowHowBtn 自己记的），调用方把第几步升到 3、
   * 再把主菜单重画一遍——光撤了、新的四张浮上来、那颗按钮自己也就不该在了。
   *
   * （这儿从前还有一位 firstPlayLock：首玩期十三张全摆、除两张基础卡都挂锁，中间夹一条《我会玩》分界线。10-31 方案
   * 推12 起没到的卡根本不摆，那道软锁、分界线、抖动、上滑箭头一起删了。）
   */
  onKnowHow?: () => void;
}

/**
 * 主菜单要的东西，已经按基础形状分好组：页面上每一排（基础、计时、两档炸弹、
 * 更多布局）都是同一组形状同一个次序，所以一个玩家可以顺着一列一路往下看。
 *
 * **每排两张，不是三张**（《侵蚀阶梯》v1.2 PR-6）：三角那副基础棋盘删了，剩下的
 * 六边蜂窝 54 是天才特供的布局。所以 `base` 和 `advancedBomb` 只剩方块、小球两个
 * 键——它们是「这一排摆哪几张」，没有棋盘的格子不该留一个空位。
 *
 * `moreLayouts` 的三个键都还在：那一排按「它是哪一族的变体」分组，六边蜂窝仍然
 * 归三角那一族。
 */
export interface HomeLayout {
  /** 两副基础棋盘。 */
  base: Record<RowShape, ShapeCardMeta>;
  /** 进阶炸弹支持的两副布局，摆在同样的两个槽里。 */
  advancedBomb: Record<RowShape, ShapeCardMeta>;
  /** 《更多布局》，按「它是哪一族的变体」分组——方块一张、小球两张、三角一张。 */
  moreLayouts: Record<BaseShape, ShapeCardMeta[]>;
}

/**
 * 整排摆出来的那几个形状。
 *
 * 和 `BaseShape`（方块 / 小球 / 三角三族）分开：族还是三族（六边蜂窝归三角族，
 * 图标、《更多布局》的分组、老虎机的目标都还按族走），但**整排摆出来的只有两个**。
 * 混成一个类型的话，删掉三角那一排之后每一处 `Record<BaseShape, …>` 都会要求一个
 * 不存在的三角棋盘。
 */
export type RowShape = 'square' | 'circle';
const SHAPES: RowShape[] = ['square', 'circle'];
/** 《更多布局》那一排按族分组，三族都要走到（六边三角归三角族）。 */
const LAYOUT_SHAPES: BaseShape[] = ['square', 'circle', 'triangle'];
/** 主菜单一排摆几张。样式那边算图标上限用的也是这两个数：宽屏第二排六张、
 *  第三排五张，窄屏一排两张（一张 130px 见方，玩家点的）。
 *
 *  ⚠️ 这个数一动，style.css 里 --home-card-cap 那条公式的除数要跟着动——那一
 *  项算的就是「一排站得下几张」。不跟着改的后果是横屏手机上整页横向溢出。 */
const WIDE_PER_ROW = 6;
const NARROW_PER_ROW = 2;
/**
 * 鱼眼轴上次停在哪一项。
 *
 * 主菜单每次都是重画的，轴活不到下一次，所以记在模块里。玩家定过「返回主页不
 * 自动置顶」，2026-09 又确认过一次「停在你上次看的那一项」——从一个玩法退回来，
 * 轴该停在他刚才那一项上，不是又回到第一张。
 *
 * **还要再存一份到 sessionStorage**，因为「重画」不是唯一一种会把这个变量清掉的
 * 事：iPhone 上把 Safari 切到后台、过一会儿再回来，系统会把这个标签页整个丢掉重
 * 新载入——玩家自己什么都没做，页面却从头开始，模块变量当然也没了。他眼里就是
 * 「我刚才明明停在炸弹上，回来又跳回方块了」。
 *
 * 用 sessionStorage 不用 localStorage：**同一个标签页里记着，换一次新的就从头
 * 来**。隔了一天重新打开网站还停在第九张上，那是另一种「意料之外的界面」——一进
 * 门就该是熟悉的那张基础方块。
 *
 * **存的是卡的名字（data-card），不是第几张**（10-31 方案推12 Z-J02）：主菜单一步一步出现之后，同一张卡在第 3 步和第 5
 * 步排在不同的序号上——存序号的话，升了一步回来就停到了别的卡上。读回来找不到（那张卡这一步还没有）就回第 0 张。新卡
 * 出现时轴**不**自动滚过去（站长 10-30 答复 ⑤）：照旧停在上次那一项。
 */
const AXIS_KEY = 'slides_axis_focus';
/**
 * 上一次画主菜单时给《每日挑战》那张卡排的「零点换图」（dailyArt.ts 的 watchDay）。主菜单每次都
 * 是整个重画的，旧的那一个不撤的话，回一次主菜单就多挂一个定时器——重画前先撤掉上一个。
 */
let stopDailyWatch: (() => void) | null = null;
let axisFocus = readAxisFocus();

function readAxisFocus(): string {
  try {
    return sessionStorage.getItem(AXIS_KEY) ?? '';
  } catch {
    // 无痕模式：读不到就从第一张开始，不影响别的。
    return '';
  }
}

function saveAxisFocus(card: string): void {
  axisFocus = card;
  try {
    sessionStorage.setItem(AXIS_KEY, card);
  } catch {
    /* 无痕模式：这一次会话里照样跟手，只是活不过刷新 */
  }
}

const BASE_ICON: Record<BaseShape, string> = {
  square: ICON_BASE_SQUARE,
  circle: ICON_BASE_CIRCLE,
  triangle: ICON_BASE_TRIANGLE,
};

/** Below this the timed and bomb sections collapse into a single card each,
 *  which opens a centred picker on tap; above it they sit expanded on the
 *  page and every option is one tap away.
 *
 *  两个条件，任满足一个就用宽版：屏幕本来就宽（电脑、平板），或者手机横过来
 *  了。从前只有前一条，于是横屏窄一点的手机（667×375 这类）落在竖版那一边
 *  ——竖版是两列八张、按「屏幕还剩多高」定卡片大小，横过来只剩三百多像素
 *  高，算出来一张卡片才二十几个像素。屏幕明明变宽了，东西反而更小更挤，正
 *  是那种「横屏塞着竖屏的内容」的样子。
 *
 *  560px 这条线是给横屏留的下限：比这更窄的横屏（老式小屏）宽版三张并排也
 *  站不开，还是竖版两列更合适。 */
export const WIDE_QUERY = '(min-width: 720px), (orientation: landscape) and (min-width: 560px)';

/** A short squash-and-tilt the instant a card is pressed — the "it felt the
 *  tap" cue every icon on this page shares. Driven from pointerdown rather
 *  than :active so it still plays out in full when the tap opens a modal. */
function wireTapFeedback(el: HTMLElement): void {
  el.addEventListener('pointerdown', () => {
    el.classList.remove('home-tap');
    void el.offsetWidth; // restart the animation even on a rapid re-tap
    el.classList.add('home-tap');
  });
  el.addEventListener('animationend', () => el.classList.remove('home-tap'));
}

/**
 * 一张卡：上面一格方的图，底下（窄屏才有）一行小字。
 *
 * 图外面那层 .home-icon-art 是有用的，不是包着好看：锁和天才招牌是绝对定位
 * 的，得贴着「图」的正中和右下角，不能贴着整张卡——卡底下多了一行字，卡的
 * 正中就不是图的正中了。所以定位的参照物是这一层。
 */
function iconButton(glyph: string, label: string, extraClass = '', tag = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'home-icon-btn' + (extraClass ? ' ' + extraClass : '');
  btn.setAttribute('aria-label', label);
  const art = document.createElement('span');
  art.className = 'home-icon-art';
  art.innerHTML = glyph;
  btn.appendChild(art);
  if (tag) btn.appendChild(tagEl(tag));
  wireTapFeedback(btn);
  return btn;
}

/** 卡底下那行小字。用 textContent，玩法名字里将来带上 & 或 < 也不会出事。 */
function tagEl(text: string): HTMLElement {
  const cap = document.createElement('span');
  cap.className = 'home-icon-tag';
  cap.textContent = text;
  return cap;
}

/**
 * 锁着的卡上那把锁：正中一把，压在图上。
 *
 * 原先右下角还收着一块天才招牌（说明这把锁是哪一家的）；天才层 2026-10 取消之后锁只剩「没登录」一种，招牌撤了
 * （10-31 方案推12 Z-J02 E）。
 */
function lockOverlay(btn: HTMLElement): void {
  const art = btn.querySelector('.home-icon-art') ?? btn;
  art.insertAdjacentHTML('beforeend', `<span class="center-pick-lock">${ICON_LOCK}</span>`);
}

/**
 * @returns 拆掉这一版主菜单留下的东西（鱼眼轴挂在 window 上的 resize、盯着 body 的那两个观察器）。
 *   调用方挂到 main.ts 的 activeDestroy 上，换屏时 teardown 会叫它（10-11 方案 B-1）。原先这儿什么都不
 *   返回，mountModeAxis 交出来的 destroy 被丢掉了：主菜单来回进出四趟，resize 监听从 2 涨到 5、body 上的
 *   观察器从 3 涨到 6——而且旧轴还活着，个人主页滚到下面开关一扇窗，旧轴的 recenter 把整页滚回了顶。
 */
export function renderMenu(container: HTMLElement, layout: HomeLayout, handlers: MenuHandlers, lang: Lang): () => void {
  const s = STRINGS[lang];
  const wide = window.matchMedia(WIDE_QUERY).matches;
  /**
   * 第 1、2 步（10-31 方案推12 Z-J02 B，设计图 A1–A4）：只有一排一两张卡＋《我会玩》，整组在招牌和底排之间竖向居中，
   * 手机、电脑一个样。卡**不交给鱼眼轴**：轴上那条分界线要「下一排」，第 1 步只有一排。
   */
  const intro = handlers.stage <= 2;
  /** 这张卡第几步出现（engine/menuStage.ts）。没到的卡根本不造。 */
  const has = (key: string): boolean => (STAGE_OF[key] ?? 1) <= handlers.stage;

  container.innerHTML = `
    <div class="app home-page${wide ? ' home-page--wide' : ''}${intro ? ' home-page--intro' : wide ? '' : ' home-page--axis'}">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <!-- 空的：这一行由 typeTagline 打出来（见那个文件）。模板里先写上整句
               的话，第一帧会把整句闪一下、下一帧才被清空——那一闪比不打字更显眼。
               reduced-motion 和「这次已经打过了」两种情况下它也是由那个函数一次
               填满的，所以这儿永远不该有字。 -->
          <p class="home-sub"></p>
        </div>
      </header>
      <div class="home-grid" id="homeGrid"></div>
      <!--
        法务那五条链接**不在这一页**了（玩家 2026-09：「主页省略下方的价格、法律
        等部分，只留在个人主页的部分」）。

        宽版本来就不摆（style.css 里那条 .home-page--wide .home-legal 是 display:
        none——电脑端一屏排不下），所以这一改之后窄版和宽版是同一个样子：主菜单上
        只有玩法。
        （这段注释在模板字符串里，所以不能用反引号包代码——用了会把整个字符串截
        断，tsc 报的是莫名其妙的「缺少 ;」。）

        **它们没有消失，只是挪了个地方**，三条路都还在：
          · 个人主页最底下那五行（accountPage.ts，点开是弹窗）；
          · /pricing /terms /refund /privacy /contact 五个真网址（静态页由
            scripts/build-legal.mjs 从 src/legal.ts 生成，填得进收单方后台的表格）；
          · 五张静态页彼此的页脚互相链着。
        收单方的审核从前是在落地页上找它们的——这一条是玩家权衡过的，记在这儿，
        万一哪天审核又问起，知道去哪儿把它加回来。
      -->
    </div>
  `;
  // 卡底下那行小字，宽窄两版都给。宽屏那三排要站在一屏里，多出来的这一行高
  // 度已经算进 style.css 的 --home-card-cap（那道算式里减掉的常数）——不减
  // 的话整页会顶出一条滚动条，check-overlap 逮得到。
  const tag = (key: string): string => menuTag(lang, key);

  const grid = container.querySelector<HTMLElement>('#homeGrid');
  if (!grid) throw new Error('menu: missing #homeGrid');

  // 副标题打字机。只有主菜单这一处调它——同一句话在别的页面直接显示（见
  // ui/typeTagline.ts 开头）。「只打一次」由那个模块自己守，这儿每次重绘都照调。
  const sub = container.querySelector<HTMLElement>('.home-sub');
  if (sub) typeTagline(sub, s.homeTagline);

  // 窄屏（手机竖着）的顺序，玩家定的：
  //
  //   每日挑战 ·
  //   方块 · 圆球 · 多人游玩 · 计时 · 炸弹 ·
  //   老虎机 · 无限反转 · 步步为营 ·
  //   ——以下《更多布局》——
  //   菱形方块 · 六边圆球 · 七色圆球 · 大三角
  //
  // 四副《更多布局》挨在最后（10-08 方案 3-D-2：「squareDiamond、circleHex 移到倒数第 4、第
  // 3，与其他更多布局放一起」）。从前分的是「能玩的先摆、天才特供的收在最后」：菱形方块、六
  // 边圆球不要天才，跟在炸弹后面；七色圆球、大三角要天才，跟老虎机那三张一起收在最后——同一
  // 组棋盘被拆在两处，而电脑上那一排、个人主页的《更多布局》都是四副摆在一起的。
  //
  // 次序按内容排，不按这个人开没开通。这一点是有意的：开通了的人和没开通的人看到的该是同一
  // 张菜单，位置不该因为身份而漂。
  //
  // 宽屏（电脑、手机横着）是另一套：三排——三个基础玩法；计时 · 炸弹 · 多人
  // 游玩 · 老虎机 · 无限反转；五副棋盘。那是玩家单独点过的一套，不跟着窄屏
  // 这条链走。
  //
  // 一排两张，一张 130px 见方，摆完为止——十三张七排，所以这一页要往下滑。
  //
  // 每张图标不超过「一排摆满时的那一份」那么宽（见 style.css 的 max-width），
  // 所以张数少的那几排不会因为人少就长得比别人大——十三张从头到尾一样大。
  //
  // 往下滑本身不是问题。真正咬过人的是另一件事：从前图标的大小是按 100dvh
  // 算的，而手机一上滑就把地址栏收起来，dvh 跟着变大，图标就跟着胀大一圈。
  // 现在窄屏的大小是个定数（130px），和屏幕高度、和滑没滑一概无关。
  const newRow = (): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'home-row';
    grid.appendChild(row);
    return row;
  };

  /**
   * 窄屏那一路：把图标按顺序一张张交给它，满了自己换排。宽屏不走这儿——
   * 宽屏的三排是各自成段的，不是一条链切出来的。
   */
  const perRow = wide ? WIDE_PER_ROW : NARROW_PER_ROW;
  let flowRow: HTMLElement | null = null;
  let inFlow = 0;
  /**
   * 窄屏（手机竖屏）现在走鱼眼轴：卡片不进排，先攒起来，最后整条交给
   * ui/modeAxis.ts 摆（玩家定的「主菜单整个换掉」）。宽屏那三排一个字没动——
   * 桌面端是规格里另一套（角度制转盘），排在后面的 PR。
   */
  const onAxis = !wide;
  const axisCards: HTMLElement[] = [];
  const place = (btn: HTMLElement): void => {
    if (onAxis) {
      axisCards.push(btn);
      return;
    }
    if (!flowRow || inFlow >= perRow) {
      flowRow = newRow();
      inFlow = 0;
    }
    flowRow.appendChild(btn);
    inFlow++;
  };
  /**
   * 最后那两段（老虎机那三张、四副《更多布局》）先攒着，等前面的都摆完了再一起摆到最后（只有窄
   * 屏走这儿；宽屏那几排是各自成段的，见上面那段注释）。
   *
   * 攒起来而不是直接摆，是因为它们在代码里出现的次序和该摆的次序不一样：
   * 老虎机那三张跟着「多人游玩」一起造出来（同一个板块），计时、炸弹却在它们后面
   * 才造。攒一攒，两处都不用为了顺序挪位置。
   */
  const tail: HTMLElement[] = [];
  const later = (btn: HTMLElement): void => {
    tail.push(btn);
  };

  /**
   * 这一次要演「浮出」的卡（10-31 方案推12 Z-J02 C）：`STAGE_OF[卡] > shown` 的那几张。造卡时先记下名字、打个记号，画完
   * 之后按它们**在屏幕上的次序**编号（markArrivals）——造的次序和摆的次序不一样（老虎机那三张造得早、摆在后面）。
   */
  const named = <T extends HTMLElement>(btn: T, key: string): T => {
    btn.dataset.card = key;
    if ((STAGE_OF[key] ?? 1) > handlers.shown) btn.dataset.arrive = '1';
    return btn;
  };
  /** 卡上那行字（读屏那一句「新玩法已出现：……」也念它）。 */
  const nameOf = (key: string): string => (key === 'daily' ? s.dailyTitle : tag(key));
  /**
   * 给新卡挂上「浮出」：卡里面那两层（图、字）从透明、0.92 倍浮到实、1 倍，每张晚 70ms，浮完亮两下（style.css 的
   * .home-icon-btn--arrive）。动的是卡里面那两层，不是卡本身：鱼眼轴每帧往卡本身写行内 transform。
   *
   * 读屏：画完那一刻放一个看不见的 role=status，下一帧写一句「新玩法已出现：每日挑战、多人、计时、炸弹」——放进去的同一
   * 帧就写字，有的读屏不念。
   */
  const markArrivals = (cards: readonly HTMLElement[]): void => {
    const fresh = cards.filter((c) => c.dataset.arrive === '1');
    fresh.forEach((c, i) => {
      c.classList.add('home-icon-btn--arrive');
      c.style.setProperty('--arrive-i', String(i));
    });
    if (!fresh.length) return;
    const live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    container.querySelector('.home-page')?.appendChild(live);
    const sep = lang === 'zhHans' || lang === 'zhHant' ? '、' : ', ';
    const text = s.menuNewModes.replace('{list}', fresh.map((c) => nameOf(c.dataset.card ?? '')).filter(Boolean).join(sep));
    requestAnimationFrame(() => {
      if (live.isConnected) live.textContent = text;
    });
  };

  /** 一张基础卡（方块 / 小球）。没打过的那张镶一圈光（glowingBasics）。 */
  const baseCard = (shape: RowShape): HTMLButtonElement => {
    const card = layout.base[shape];
    const btn = iconButton(
      BASE_ICON[shape],
      shapeName(lang, card.id, card.name),
      handlers.glow?.includes(shape) ? 'home-icon-btn--glow' : '',
      tag(card.id),
    );
    btn.addEventListener('click', () => handlers.onSelectBase(card.id));
    // 门认「能点开头一局的那两张」用的钩子（check-push-queue 那一批点的是 data-first-playable 的第一张）。原先首玩
    // 期的软锁也认它；软锁 10-31 方案推12 删了，钩子留着。
    btn.dataset.firstPlayable = '1';
    return named(btn, card.id);
  };

  // ---- 第 1、2 步：一排居中的小卡＋《我会玩》 ------------------------------
  stopDailyWatch?.();
  stopDailyWatch = null;
  if (intro) {
    // 卡边长照计时挑图形那一页（min(40vw, 176px, 22vh)，排缝 18px，style.css 的 .home-row--intro）；第 2 步方块在左、
    // 小球在右（SHAPES 的次序）。《我会玩》在这一排正下方居中——它不再是轴上的分界线，只是一颗小按钮。
    const row = document.createElement('div');
    row.className = 'home-row home-row--intro';
    grid.appendChild(row);
    for (const shape of SHAPES) if (has(shape)) row.appendChild(baseCard(shape));
    grid.appendChild(knowHowButton(lang, () => handlers.onKnowHow?.()));
    markArrivals(Array.from(row.children) as HTMLElement[]);
    return () => {};
  }

  // ---- 每日挑战（第 19 推）-------------------------------------------------
  /**
   * 窄版（鱼眼轴）是轴上的第一站、只有这一张（mountModeAxis 的 leadSolo），打开菜单默认就停在这
   * 一站——一个新会话的默认焦点本来就是第 0 项（readAxisFocus），所以不用另写一句。
   *
   * 宽版（电脑、横屏手机）摆在**基础那一排的最左边**，和基础方块、基础小球三张同尺寸、等间距、整
   * 排居中（10-09 补充方案 7-12）。
   *
   * 图按北京时间的星期几换、日期压在上面（dailyArt.ts），到北京零点自动换、切回前台时重算。
   * 读屏念「每日挑战，10 月 3 日」；卡底下那行小字是「每日挑战」。
   *
   * 第 3 步才出现（10-31 方案推12 Z-J02；原先是「打完过一局、首玩锁撤了」，10-08 方案 3-D-1 ＋ 10-09 补充方案 6-6）。
   * 走到这儿的一定是第 3 步以上（第 1、2 步上面已经返回了），所以它永远在。
   */
  const now = handlers.now ?? Date.now;
  const today = dayIndexOf(now());
  // 基础那一排先开出来：宽版的每日挑战摆在它的最左边（见上面那段）。
  const baseRow = wide ? newRow() : null;
  if (has('daily')) {
    const dailyBtn = named(iconButton(dailyArtHtml(today), dailyAria(lang, today), 'home-icon-btn--daily', s.dailyTitle), 'daily');
    dailyBtn.addEventListener('click', () => handlers.onDaily());
    stopDailyWatch = watchDay(now, (d) => {
      // 主菜单已经被换掉了：这个钟没有用处了，撤掉（下一次画主菜单会另排一个）。
      if (!dailyBtn.isConnected) {
        stopDailyWatch?.();
        stopDailyWatch = null;
        return;
      }
      const art = dailyBtn.querySelector<HTMLElement>('.home-icon-art');
      if (art) art.innerHTML = dailyArtHtml(d);
      dailyBtn.setAttribute('aria-label', dailyAria(lang, d));
    });
    if (baseRow) baseRow.appendChild(dailyBtn);
    else axisCards.push(dailyBtn);
  }

  // ---- 方块 · 小球 --------------------------------------------------------
  for (const shape of SHAPES) {
    if (!has(shape)) continue;
    const btn = baseCard(shape);
    if (baseRow) baseRow.appendChild(btn);
    else place(btn);
  }

  // ---- 多人游玩 · 老虎机 · 无限反转 · 步步为营 ----------------------------
  /*
   * 老虎机、无限反转、步步为营原先是天才特供（没开通就压暗、正中一把锁、右下角收着天才招牌，按下去开订阅窗）。天才层
   * 2026-10 取消了（10-31 方案推12 Z-J02 E）：这三张第 4 步才出现，出现了就能玩，不用登录。
   */
  const modeCard = (glyph: string, title: string, key: string, open: () => void): HTMLButtonElement | null => {
    if (!has(key)) return null;
    const btn = named(iconButton(glyph, title, '', tag(key)), key);
    btn.addEventListener('click', open);
    return btn;
  };

  // 那扇小门点进去直接是小屋那一页，不再绕个人主页。它右边是老虎机和无限反
  // 转——这两个不是新棋盘（挑完图形玩的还是那三个基础玩法），所以不排在下面
  // 的棋盘堆里，跟多人游玩同属「另一种玩法」这一排。
  const mpBtn = modeCard(ICON_MULTIPLAYER, s.mpTitle, 'multiplayer', handlers.onMultiplayer);
  const slotBtn = modeCard(ICON_SLOT_MACHINE, s.randomTargetTitle, 'slot', handlers.onRandomTarget);
  const flipBtn = modeCard(ICON_FLIP_MODE, s.flipModeTitle, 'flip', handlers.onFlipMode);
  // 这一张的读屏名传的是**短名**（tag('puzzle') = 「步步为营」），不是全名
  // 「真正解密 · 步步为营」。全名里带着一个 ` · `，而 check-menu.mjs 读
  // aria-label 之后 .split(' ·')[0]，会把它切成「真正解密」——那道门的期望数
  // 组就得写一个界面上没人见过的名字。全名留给陈列页、规则页、排行榜页签和
  // 结算页，菜单上要的只是认得出来。
  const puzzleBtn = modeCard(ICON_PUZZLE_MODE, tag('puzzle'), 'puzzle', handlers.onPuzzleMode);
  // 窄屏：多人游玩顺着链往下摆，老虎机、无限反转、步步为营收进最后那一段（排在四副《更多
  // 布局》前面）。宽屏上它们跟在计时和炸弹后面，凑成一排六张。
  if (!wide) {
    if (mpBtn) place(mpBtn);
    for (const b of [slotBtn, flipBtn, puzzleBtn]) if (b) later(b);
  }

  // ---- 计时 · 炸弹 --------------------------------------------------------
  // 一只沙漏代表整个计时档。宽屏窄屏同一颗：计时占的是一张的位置，不是两张——同
  // 一个板块在笔记本上和在手机上不该长成两个样。
  //
  // 按下去开的是**一整页**（ui/timedMode.ts），不再是那个居中的挑选窗。从前那颗
  // 沙漏点下去会飞到屏幕中间、落定时裂成几只，那段动效 2026-09 玩家定了不再保
  // 留；跟着撤掉的还有 `dataset.reopen = 'timed'`——reopen 那条路本来就是给挑选
  // 窗设计的（打完一局回来把那扇窗重新弹出来），整页版的《返回》直接回挑形状那
  // 一屏，和《无限反转》一样。
  //
  // 宽版第二排：**这一排第一次要放卡时才造**（10-31 方案推12：空排不造）。第 3 步起计时、炸弹、多人都在，所以实际上
  // 它总在；写成懒的是为了不让哪天调了 STAGE_OF 之后冒出一排空的。
  let timedRow: HTMLElement | null = null;
  const toTimedRow = (btn: HTMLElement): void => {
    if (!timedRow) timedRow = newRow();
    timedRow.appendChild(btn);
  };
  if (has('timed')) {
    const timedBtn = named(iconButton(ICON_TIMED_COMBINED, s.sectionTimed, 'home-icon-btn--timed', tag('timed')), 'timed');
    timedBtn.addEventListener('click', handlers.onTimedMode);
    if (wide) toTimedRow(timedBtn);
    else place(timedBtn);
  }

  // ---- 炸弹，接在计时右边 ------------------------------------------------
  /*
   * 按下去开的是**一整页**（ui/bombMode.ts，10-08 方案 3-G），和计时、老虎机、无限反转、步步为营那
   * 几步同一副骨架；那一页自己那块三排面板（三档 × 两副棋盘、正中一颗白星）在 bombMode.ts 里，这儿
   * 不碰。
   *
   * 主菜单上这张卡只放一枚图标，电脑、手机一个样（10-09 补充方案 7-17，玩家指定的 bomb-menu.svg：砖
   * 红圆角方块里一颗白色圆角星芒，见 homeIcons.ts 的 ICON_BOMB_MENU）。从前电脑宽版这一张画的是那块
   * 面板的缩图——六颗小片挤在一张卡里，格子是 span（buildBombPreview），比别的卡高一截，样式里为它单
   * 写过「这一格不摆方框」「格子收到 27%」两条；手机上第 18 推就换成了一枚图标（bomb-badge.svg）。现
   * 在两端都是这一枚，和旁边的玩法卡一样是一张方图、一样大（--home-card-cap 管着）。
   */
  if (has('bomb')) {
    const bombBtn = document.createElement('button');
    bombBtn.className = wide ? 'home-bomb-card' : 'home-icon-btn home-bomb-mini';
    bombBtn.setAttribute('aria-label', s.bombBasicTitle);
    const bombArt = document.createElement('span');
    bombArt.className = 'home-icon-art';
    bombArt.innerHTML = ICON_BOMB_MENU;
    bombBtn.appendChild(bombArt);
    const bombTag = tag('bomb');
    if (bombTag) bombBtn.appendChild(tagEl(bombTag));
    wireTapFeedback(bombBtn);
    bombBtn.addEventListener('click', handlers.onBombMode);
    named(bombBtn, 'bomb');
    if (wide) toTimedRow(bombBtn);
    else place(bombBtn);
  }
  if (wide) for (const b of [mpBtn, slotBtn, flipBtn, puzzleBtn]) if (b) toTimedRow(b);

  // ---- 最后：每个布局玩法自己露脸，不再藏在「+」后面 ---------------------
  // 从前这里是三张通用的「+」卡，点开才看得到里面有什么。现在直接摆出来：
  // 玩家一眼就知道有哪些棋盘，少一层点击。
  //
  // 顺序按方块 / 圆球 / 三角连续排，一个形状的东西挨在一起：菱形方块、六边
  // 圆球、七色圆球、六边三角。宽屏四张自成一排（第 5 步才有这一排，之前整排不造）。
  //
  // 窄屏四副一起收进最后那一段，排在老虎机那三张后面，彼此的先后不变（10-08 方案 3-D-2）。
  //
  // ⚠️ 这一圈走的是 **LAYOUT_SHAPES（三族）**，不是上面那个 SHAPES（两族）。
  // 《更多布局》按「它是哪一族的变体」分组，而六边三角仍然归三角族——拿 SHAPES
  // 来循环的话，三角那一栏整个不会被走到，六边三角在菜单上凭空消失，而且不报
  // 任何错（check-menu 第一遍就是这么红的）。
  const ordered: { card: ShapeCardMeta; shape: BaseShape }[] = [];
  for (const shape of LAYOUT_SHAPES) {
    for (const card of layout.moreLayouts[shape]) if (has(card.id)) ordered.push({ card, shape });
  }

  const layoutRow = wide && ordered.length ? newRow() : null;
  for (const { card, shape } of ordered) {
    // 没登录挂锁（天才层 10-31 方案推12 取消；判定同 engine/geniusContent.ts 的 layoutLock，这儿用调用方给的登录态，
    // 门里好摆）。锁的样子：图压暗、正中一把锁；读屏名后面跟一句「登录后可用」。点了开登录窗。
    const isLocked = !handlers.signedIn && GENIUS_LAYOUTS.includes(card.id);
    const name = shapeName(lang, card.id, card.name);
    const btn = iconButton(
      layoutIcon(card.id, shape),
      isLocked ? `${name} · ${s.signInOnly}` : name,
      // 进阶三角那张图是横画布，摆进方框里会比别人矮一半。给它一个自己的类，
      // 把它缩到和其它图标看着一样大——按「图形本身占多大」算，不是按方框算。
      layoutIconIsWide(card.id) ? 'home-icon-btn--wide-art' : '',
      tag(card.id),
    );
    named(btn, card.id);
    if (isLocked) {
      btn.classList.add('home-icon-btn--locked');
      lockOverlay(btn);
    }
    btn.addEventListener('click', () =>
      isLocked ? handlers.onLockedLayout() : handlers.onSelectLayout(card.id),
    );
    if (layoutRow) layoutRow.appendChild(btn);
    else later(btn);
  }

  // ---- 最后那一段：老虎机那三张 · 四副《更多布局》 -------------------------
  // 老虎机 · 无限反转 · 步步为营 · 菱形方块 · 六边圆球 · 七色圆球 · 大三角，就是它们被攒起来的次序。
  for (const btn of tail) place(btn);

  if (onAxis) {
    /*
     * 这儿从前是首玩期那一套：十三张全摆、除两张基础卡都挂锁，中间夹一条《我会玩》分界线（modeAxis 的 divider），
     * 按到锁着的卡抖一下、冒一个上滑箭头（armFirstPlayLock）。10-31 方案推12 起没到的卡根本不造，那一套全删了；
     * 《我会玩》只在第 1、2 步摆（上面 intro 那一支）。
     *
     * 轴对卡少不用特别处理：第 3 步 6 张 4 排（每日挑战｜方块·小球｜多人·计时｜炸弹落单居中）、第 4 步 9 张 5 排、
     * 第 5 步 13 张 7 排。初始焦点按上次停的那张卡的名字找（AXIS_KEY），找不到回第 0 张；新卡出现时不自动滚过去。
     */
    markArrivals(axisCards);
    // 纯数字是上一版存的「第几张」（同一个标签页跨过这一次更新时还留着）：照旧当序号用一次，之后存的就是名字了。
    const initial = /^\d+$/.test(axisFocus)
      ? Math.min(Number(axisFocus), Math.max(axisCards.length - 1, 0))
      : Math.max(0, axisCards.findIndex((c) => c.dataset.card === axisFocus));
    const axis = mountModeAxis(grid, {
      cards: axisCards,
      initial,
      onFocus: (i) => saveAxisFocus(axisCards[i]?.dataset.card ?? ''),
      // 第一站只有《每日挑战》一张（第 19 推，见上面造它的那一段）。
      leadSolo: has('daily'),
    });
    return () => axis.destroy();
  }
  markArrivals(Array.from(grid.querySelectorAll<HTMLElement>('[data-card]')));
  // 宽版没有轴，也就没有要拆的东西。
  return () => {};
}
