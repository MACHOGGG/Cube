import type { ShapeCardMeta } from '../shapes/types';
import type { BombTier } from '../engine/bomb';
import { STRINGS, type Lang } from '../i18n';
import { GENIUS_LAYOUTS, isLayoutLocked } from '../engine/geniusContent';
import { isGenius } from '../engine/subscription';
import { shapeName } from './shapeLabels';
import { menuTag } from './menuTags';
import { openCenterPicker, type PickerOption } from './centerPicker';
import { geniusLogoFluid } from './geniusLogo';
import { knowHowButton } from './knowHowBtn';
import { mountModeAxis } from './modeAxis';

import {
  ICON_BASE_SQUARE,
  ICON_BASE_CIRCLE,
  ICON_BASE_TRIANGLE,
  ICON_TIMED_COMBINED,
  ICON_BOMB_90S,
  bombChip,
  ICON_LOCK,
  ICON_MULTIPLAYER,
  layoutIcon,
  layoutIconIsWide,
  timedOption,
  type BaseShape,
  ICON_FLIP_MODE,
  ICON_PUZZLE_MODE,
  ICON_SLOT_MACHINE,
} from './homeIcons';

export interface MenuHandlers {
  onSelectBase: (id: string) => void;
  /** `reopenKey`, when present, is the `data-reopen` value of the card whose
   *  pop-up picker launched this game — main.ts hands it back to showMenu()
   *  so "back" from that game re-opens the same picker. */
  onSelectLayout: (id: string, reopenKey?: string) => void;
  /** A 「+」 board that 「Slides 天才」 unlocks, tapped by someone who has not
   *  bought it — the picker shows what it is, and this opens the paywall. */
  onLockedLayout: () => void;
  onTimedFor: (id: string, reopenKey?: string) => void;
  onBombFor: (tier: BombTier, id: string, reopenKey?: string) => void;
  /** 多人游玩，从主菜单直接进——进去就是房间设置那一页。 */
  onMultiplayer: () => void;
  /** 《随机得分目标》：挑图形、转出这一局的得分图案，然后开局。 */
  onRandomTarget: () => void;
  /** 《无限反转》：挑方块或小球，得分翻面来回翻，120 秒。 */
  onFlipMode: () => void;
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
   * 头一回打开、一局都还没打过：除了《基础方块》和《基础小球》，别的一概按不
   * 开（engine/firstPlay.ts 的 lockedForFirstPlay）。
   *
   * 玩家 2026-09 定的：「第一次玩的玩家只能选择基础方块 or 基础小球，在游玩
   * 过第一个玩法之后就可以解锁……这些封锁的设置都是只给第一次游玩的玩家才会
   * 出现，在此之后再也不会出现」。
   *
   * 按到别的卡不是没反应：那两张会轻轻抖一下、光更亮一点；要是他按的那张在
   * 屏幕靠下的位置，还会在两张卡那儿冒一个小圆角箭头，指他往上滑。锁不写字
   * ——两张亮着的卡本身就是答案。
   */
  firstPlayLock?: boolean;
  /**
   * 按了《我会玩》：引擎里那把钥匙已经记下了（knowHowBtn 自己记的），这儿只要
   * 把主菜单重画一遍——锁撤了、光撤了、那颗按钮自己也就不该在了。
   */
  onKnowHow?: () => void;
}

/**
 * Everything the home page needs, already bucketed by the three base shapes
 * the whole design is organised around — every row on the page (base play,
 * timed, each bomb tier, "more layouts") is the same square/circle/triangle
 * trio, so a player can track one shape straight down the page.
 */
export interface HomeLayout {
  /** The three base games. */
  base: Record<BaseShape, ShapeCardMeta>;
  /** The 3 layouts the advanced bomb tier supports, in base-shape slots. */
  advancedBomb: Record<BaseShape, ShapeCardMeta>;
  /** "More layouts" grouped under the base shape each one is a variant of —
   *  square has one, circle and triangle have two apiece. */
  moreLayouts: Record<BaseShape, ShapeCardMeta[]>;
}

const SHAPES: BaseShape[] = ['square', 'circle', 'triangle'];
/** 这副棋盘是不是天才特供的——按内容问，不按这个人开没开通（isLayoutLocked
 *  问的是后者）。窄屏的顺序要用前者：菜单的排布不该因为身份而变。 */
const isGeniusLayout = (cardId: string): boolean => GENIUS_LAYOUTS.includes(cardId);
/** 主菜单一排摆几张。样式那边算图标上限用的也是这两个数：宽屏第二排六张、
 *  第三排五张，窄屏一排两张（一张 130px 见方，玩家点的）。
 *
 *  ⚠️ 这个数一动，style.css 里 --home-card-cap 那条公式的除数要跟着动——那一
 *  项算的就是「一排站得下几张」。不跟着改的后果是横屏手机上整页横向溢出。 */
const WIDE_PER_ROW = 6;
const NARROW_PER_ROW = 2;
/** The bomb panel's own order — the reference sheet lines its chips up
 *  square/triangle/circle rather than the square/circle/triangle the full-
 *  width rows above it use. */
const BOMB_SHAPES: BaseShape[] = ['square', 'triangle', 'circle'];
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
 */
const AXIS_KEY = 'slides_axis_focus';
let axisFocus = readAxisFocus();

function readAxisFocus(): number {
  try {
    const n = Number(sessionStorage.getItem(AXIS_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    // 无痕模式：读不到就从第一张开始，不影响别的。
    return 0;
  }
}

function saveAxisFocus(i: number): void {
  axisFocus = i;
  try {
    sessionStorage.setItem(AXIS_KEY, String(i));
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

/** 锁着的卡上那两件东西：正中一把锁，右下角一块天才招牌。都压在图上。 */
function lockOverlay(btn: HTMLElement): void {
  const art = btn.querySelector('.home-icon-art') ?? btn;
  art.insertAdjacentHTML(
    'beforeend',
    `<span class="center-pick-lock">${ICON_LOCK}</span>` +
      `<span class="center-pick-genius">${geniusLogoFluid()}</span>`,
  );
}

export function renderMenu(container: HTMLElement, layout: HomeLayout, handlers: MenuHandlers, lang: Lang) {
  const s = STRINGS[lang];
  const wide = window.matchMedia(WIDE_QUERY).matches;

  container.innerHTML = `
    <div class="app home-page${wide ? ' home-page--wide' : ''}${wide ? '' : ' home-page--axis'}">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${s.homeTagline}</p>
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

  // 窄屏（手机竖着）的顺序，玩家定的：能玩的先摆，天才特供的四张收在最后。
  //
  //   方块 · 小球 · 三角 · 多人游玩 · 计时 · 炸弹 ·
  //   菱形方块 · 六边圆球 · 六边形三角
  //   ——以下天才特供——
  //   老虎机 · 无限反转 · 七色圆球 · V 型三角
  //
  // 「天才特供」按内容分，不按这个人开没开通（老虎机、无限反转，加上
  // geniusContent.ts 里 GENIUS_LAYOUTS 那两副棋盘）。这一点是有意的：开通了
  // 的人和没开通的人看到的该是同一张菜单，位置不该因为身份而漂。
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
   * 天才特供的那几张先攒着，等能玩的都摆完了再一起摆到最后（只有窄屏走这
   * 儿；宽屏那三排是各自成段的，见上面那段注释）。
   *
   * 攒起来而不是直接摆，是因为它们在代码里出现的次序和该摆的次序不一样：
   * 老虎机和无限反转跟着「多人游玩」一起造出来（三张是同一个板块），两副天
   * 才棋盘却在最后那一圈布局里。攒一攒，两处都不用为了顺序挪位置。
   */
  const geniusTail: HTMLElement[] = [];
  const later = (btn: HTMLElement): void => {
    geniusTail.push(btn);
  };

  // ---- 方块 · 小球 · 三角 ------------------------------------------------
  const baseRow = wide ? newRow() : null;
  for (const shape of SHAPES) {
    const card = layout.base[shape];
    const btn = iconButton(
      BASE_ICON[shape],
      shapeName(lang, card.id, card.name),
      handlers.glow?.includes(shape) ? 'home-icon-btn--glow' : '',
      tag(card.id),
    );
    btn.addEventListener('click', () => handlers.onSelectBase(card.id));
    // 首玩期轴上只摆这两张（玩家定的）。三角这时候也不摆——它本来就在锁里。
    if (shape === 'square' || shape === 'circle') btn.dataset.firstPlayable = '1';
    if (baseRow) baseRow.appendChild(btn);
    else place(btn);
  }

  // ---- 多人游玩 · 老虎机 · 无限反转 --------------------------------------
  /**
   * 天才特供的那两张牌（老虎机、无限反转）：没开通就是图案压暗、正中一把锁、
   * 右下角收着天才招牌，按下去开订阅窗；开通了按下去直接进那个玩法。两张牌
   * 除了图和去处以外一模一样，所以只写一遍。
   */
  const geniusCard = (glyph: string, title: string, tagKey: string, open: () => void): HTMLButtonElement => {
    const locked = !isGenius();
    const btn = iconButton(glyph, locked ? `${title} · ${s.geniusOnly}` : title, '', tag(tagKey));
    if (locked) {
      btn.classList.add('home-icon-btn--locked');
      lockOverlay(btn);
    }
    btn.addEventListener('click', () => (locked ? handlers.onLockedLayout() : open()));
    return btn;
  };

  // 那扇小门点进去直接是小屋那一页，不再绕个人主页。它右边是老虎机和无限反
  // 转——这两个不是新棋盘（挑完图形玩的还是那三个基础玩法），所以不排在下面
  // 的棋盘堆里，跟多人游玩同属「另一种玩法」这一排。
  const mpBtn = iconButton(ICON_MULTIPLAYER, s.mpTitle, '', tag('multiplayer'));
  mpBtn.addEventListener('click', handlers.onMultiplayer);
  const slotBtn = geniusCard(ICON_SLOT_MACHINE, s.randomTargetTitle, 'slot', handlers.onRandomTarget);
  const flipBtn = geniusCard(ICON_FLIP_MODE, s.flipModeTitle, 'flip', handlers.onFlipMode);
  // 这一张的读屏名传的是**短名**（tag('puzzle') = 「步步为营」），不是全名
  // 「真正解密 · 步步为营」。全名里带着一个 ` · `，而 check-menu.mjs 读
  // aria-label 之后 .split(' ·')[0]，会把它切成「真正解密」——那道门的期望数
  // 组就得写一个界面上没人见过的名字。全名留给陈列页、规则页、排行榜页签和
  // 结算页，菜单上要的只是认得出来。
  const puzzleBtn = geniusCard(ICON_PUZZLE_MODE, tag('puzzle'), 'puzzle', handlers.onPuzzleMode);
  // 窄屏：多人游玩顺着链往下摆，老虎机和无限反转收进天才特供那一段（它们是
  // 那一段里最前面的两张）。宽屏上这三张跟在计时和炸弹后面，凑成一排五张。
  if (!wide) {
    place(mpBtn);
    later(slotBtn);
    later(flipBtn);
    later(puzzleBtn);
  }

  // ---- 计时 · 炸弹 --------------------------------------------------------
  const timedOptions = (): PickerOption[] =>
    SHAPES.map((shape) => ({
      glyph: timedOption(shape),
      label: shapeName(lang, layout.base[shape].id, layout.base[shape].name),
      onPick: () => handlers.onTimedFor(layout.base[shape].id, 'timed'),
    }));

  // 一只沙漏代表三个，点下去飞到屏幕中间、落定时裂成三只。宽屏窄屏同一颗：
  // 计时占的是一张的位置，不是三张——同一个板块在笔记本上和在手机上不该长
  // 成两个样子。
  const timedRow = wide ? newRow() : null;
  const timedBtn = iconButton(ICON_TIMED_COMBINED, s.sectionTimed, 'home-icon-btn--timed', tag('timed'));
  timedBtn.dataset.reopen = 'timed';
  timedBtn.addEventListener('click', () =>
    openCenterPicker({ originEl: timedBtn, title: s.sectionTimed, options: timedOptions(), split: true }),
  );
  if (timedRow) timedRow.appendChild(timedBtn);
  else place(timedBtn);


  // ---- 炸弹，接在计时右边 ------------------------------------------------
  // The panel is the same markup wherever it appears — inline beside the
  // burst on a wide screen, blown up in the centre of a phone — so its three
  // tiers stay in the same order and only its size changes.
  // `onLaunch` runs just before a chip starts its game — the mobile centre
  // picker passes its own close() here, so the blown-up bomb window retires
  // the moment a challenge is picked, exactly like the timed picker does.
  function buildBombPanel(reopenKey?: string, onLaunch?: () => void): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'bomb-panel';

    const basicRow = document.createElement('div');
    basicRow.className = 'bomb-row';
    for (const shape of BOMB_SHAPES) {
      const card = layout.base[shape];
      const chip = iconButton(bombChip(shape, 'basic'), `${s.bombBasicTitle} · ${shapeName(lang, card.id, card.name)}`, 'bomb-chip');
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        onLaunch?.();
        handlers.onBombFor('basic', card.id, reopenKey);
      });
      basicRow.appendChild(chip);
    }
    panel.appendChild(basicRow);

    // The 90s tier has no shape of its own on the reference sheet — it is one
    // wide bar between the other two rows. Tapping it swaps that bar for its
    // own three shapes in place, so the tier stays reachable without adding a
    // row the design doesn't have.
    const timedRow = document.createElement('div');
    timedRow.className = 'bomb-row bomb-row--90s';
    const badge = iconButton(ICON_BOMB_90S, s.bombTimedTitle, 'bomb-90s');
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      timedRow.innerHTML = '';
      timedRow.classList.add('bomb-row--open');
      for (const shape of BOMB_SHAPES) {
        const card = layout.base[shape];
        const chip = iconButton(bombChip(shape, 'timed'), `${s.bombTimedTitle} · ${shapeName(lang, card.id, card.name)}`, 'bomb-chip');
        chip.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onLaunch?.();
          handlers.onBombFor('timed', card.id, reopenKey);
        });
        timedRow.appendChild(chip);
      }
    });
    timedRow.appendChild(badge);
    panel.appendChild(timedRow);

    const advRow = document.createElement('div');
    advRow.className = 'bomb-row';
    for (const shape of BOMB_SHAPES) {
      const card = layout.advancedBomb[shape];
      const chip = iconButton(bombChip(shape, 'advanced'), `${s.bombAdvancedTitle} · ${shapeName(lang, card.id, card.name)}`, 'bomb-chip');
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        onLaunch?.();
        handlers.onBombFor('advanced', card.id, reopenKey);
      });
      advRow.appendChild(chip);
    }
    panel.appendChild(advRow);
    return panel;
  }

  // 炸弹接在计时后面，同一排。不论宽窄，这个板块都是一颗会飞到屏幕中间、
  // 放大、把背后压暗的按钮，然后才让人挑档位——从前笔记本上它是就地能点的，
  // 于是同一个板块在两种屏幕上是两套规矩。
  const bombBtn = document.createElement('button');
  bombBtn.className = wide ? 'home-bomb-card' : 'home-icon-btn home-bomb-mini';
  bombBtn.setAttribute('aria-label', s.bombBasicTitle);
  bombBtn.dataset.reopen = 'bomb';
  // The panel inside the button is a picture of the section, not a control:
  // its chips would otherwise swallow the tap (they stopPropagation so they
  // can launch a game from inside the *picker*) and the section would never
  // open. Only the copy built for the picker below is live.
  const preview = buildBombPanel();
  preview.style.pointerEvents = 'none';
  const bombArt = document.createElement('span');
  bombArt.className = 'home-icon-art';
  bombArt.appendChild(preview);
  bombBtn.appendChild(bombArt);
  const bombTag = tag('bomb');
  if (bombTag) bombBtn.appendChild(tagEl(bombTag));
  wireTapFeedback(bombBtn);
  bombBtn.addEventListener('click', () => {
    // The close handle only exists once the picker is open, but the panel
    // has to be built first — so the chips call it through this box.
    let close: (() => void) | undefined;
    const panel = buildBombPanel('bomb', () => close?.());
    close = openCenterPicker({ originEl: bombBtn, title: s.bombBasicTitle, panel });
  });
  if (timedRow) {
    timedRow.appendChild(bombBtn);
    timedRow.appendChild(mpBtn);
    timedRow.appendChild(slotBtn);
    timedRow.appendChild(flipBtn);
    timedRow.appendChild(puzzleBtn);
  } else {
    place(bombBtn);
  }

  // ---- 最后：每个布局玩法自己露脸，不再藏在「+」后面 ---------------------
  // 从前这里是三张通用的「+」卡，点开才看得到里面有什么。现在直接摆出来：
  // 玩家一眼就知道有哪些棋盘，少一层点击。
  //
  // 顺序按方块 / 圆球 / 三角连续排，一个形状的东西挨在一起：菱形方块、六边
  // 圆球、七色圆球、六边形三角、V 型三角。宽屏五张自成一排。
  //
  // 窄屏在这个次序上再分一道：能玩的三副（菱形方块、六边圆球、六边形三角）
  // 顺着链往下摆，天才特供的两副（七色圆球、V 型三角）收进最后那一段，排在
  // 老虎机和无限反转后面。两副之间的先后不变。
  const ordered: { card: ShapeCardMeta; shape: BaseShape }[] = [];
  for (const shape of SHAPES) {
    for (const card of layout.moreLayouts[shape]) ordered.push({ card, shape });
  }

  const layoutRow = wide ? newRow() : null;
  for (const { card, shape } of ordered) {
    const isLocked = isLayoutLocked(card.id);
    const name = shapeName(lang, card.id, card.name);
    const btn = iconButton(
      layoutIcon(card.id, shape),
      isLocked ? `${name} · ${s.geniusOnly}` : name,
      // 进阶三角那张图是横画布，摆进方框里会比别人矮一半。给它一个自己的类，
      // 把它缩到和其它图标看着一样大——按「图形本身占多大」算，不是按方框算。
      layoutIconIsWide(card.id) ? 'home-icon-btn--wide-art' : '',
      tag(card.id),
    );
    if (isLocked) {
      // 锁着的玩法现在直接摆在主菜单上，得一眼看出来是锁着的：图案压暗，正
      // 中一把锁，右下角收着那块天才招牌——说明这把锁是哪一家的。招牌的大小
      // 跟着卡片走（见 .home-icon-btn--locked .center-pick-genius），永远压
      // 不到锁。
      btn.classList.add('home-icon-btn--locked');
      lockOverlay(btn);
    }
    btn.addEventListener('click', () =>
      isLocked ? handlers.onLockedLayout() : handlers.onSelectLayout(card.id),
    );
    if (layoutRow) layoutRow.appendChild(btn);
    else if (isGeniusLayout(card.id)) later(btn);
    else place(btn);
  }

  // ---- 最后那一段：天才特供 ----------------------------------------------
  // 老虎机 · 无限反转 · 七色圆球 · V 型三角，就是它们被攒起来的次序。
  for (const btn of geniusTail) place(btn);

  /**
   * 首玩期的《我会玩》。
   *
   * 宽版（电脑、横屏手机）摆在整张菜单的**下方**——它不是一个玩法，不该和那十
   * 几张卡排在同一条链上。窄版那一路不走这儿：轴上它是链条里的一环，见下面
   * mountModeAxis 那一段。
   */
  if (handlers.firstPlayLock && !onAxis) {
    armFirstPlayLock(grid);
    const btn = knowHowButton(lang, () => handlers.onKnowHow?.());
    grid.parentElement?.appendChild(btn);
  }

  if (onAxis) {
    /**
     * 首玩期的轴：**十四张全摆出来，只是除了两张基础的以外都挂着锁**。
     *
     * 玩家 2026-09 第五轮改的口径：「对于检测到的初始玩家来说，转盘也可以看到所
     * 有内容只是有锁而已，在基础的方块、小球玩法下面写着『我会玩』，下面是其他
     * 的玩法。玩家如果点击了『我会玩』就解锁了」。
     *
     * 上一版是「轴上只摆那两张」——滑不到别处去，新玩家也就看不见这游戏里到底
     * 有什么。现在能看见、能滑过去，只是按不动（锁着那几张走 armFirstPlayLock
     * 那条捕获阶段的拦截：抖一下、光更亮一档，不开局）。
     *
     * 《我会玩》就排在两张基础卡后面、其余玩法前面——它是「我不用学，全给我打
     * 开」的那个闸，位置正好在能玩的和锁着的之间。它跟着轴一起形变、一起滑，所
     * 以直接当成轴上的一项交给 mountModeAxis（轴只管把元素摆到算出来的位置上，
     * 不要求每一项都是一张卡）。
     */
    let entries: HTMLElement[] = axisCards;
    /** 首玩期那条「基础 | 锁着」的分界线（见下面），没有就是 undefined。 */
    let divider: HTMLElement | undefined;
    let dividerAfter = -1;
    if (handlers.firstPlayLock) {
      armFirstPlayLock(
        grid,
        axisCards.filter((c) => c.dataset.firstPlayable === '1'),
      );
      let after = -1;
      for (let i = 0; i < axisCards.length; i++) {
        if (axisCards[i].dataset.firstPlayable === '1') after = i;
        else axisCards[i].classList.add('home-icon-btn--locked');
      }
      /**
       * **它是一条分界线，不是轴上的一站。**
       *
       * 上一版把它当成轴上的一项塞进 entries 里——轴的站距是均匀的（一站
       * 150–210px），而这颗按钮只有 44px 高，于是它上下各空出一大截。玩家
       * 2026-09 第九轮报的正是这个：「《我会玩》上方有巨大的空格，按理说就是一
       * 个小小的文字（文字两边是分割线分出上面基础方块、小球玩法和其他锁住的）
       * 和按钮不占额外的位置」。
       *
       * 所以改成**骑在两站中间的那条缝上**：两条横线夹一行小字，由 modeAxis 每
       * 帧摆到「最后一张基础卡」和「下一张锁着的卡」正中间（见那儿的 divider）。
       * 它不占站位，轴还是十四站；线和字跟着卡片一起滑，位置永远对得上。
       *
       * 外面那层 `.axis-divider` 才是被摆的那个，按钮仍旧只有文字那么宽——热区
       * 横贯整屏的话，手指落在屏幕中间随便哪儿都算撤掉引导（门里有一条盯着）。
       */
      const skip = knowHowButton(lang, () => handlers.onKnowHow?.());
      divider = document.createElement('div');
      divider.className = 'axis-divider';
      const line = () => {
        const el = document.createElement('span');
        el.className = 'axis-divider-line';
        // 两条线是画，不是内容：读屏念到这儿只该听见「我会玩」。
        el.setAttribute('aria-hidden', 'true');
        return el;
      };
      divider.append(line(), skip, line());
      dividerAfter = after;
    }
    axisFocus = Math.min(axisFocus, Math.max(entries.length - 1, 0));
    mountModeAxis(grid, {
      cards: entries,
      initial: axisFocus,
      onFocus: saveAxisFocus,
      divider: divider ? { el: divider, after: dividerAfter } : undefined,
    });
  }
}

/**
 * 头一回打开时的那道软锁。
 *
 * 拦在**捕获**阶段的一个监听器，不是给十几张卡各挂一遍：这一页上的卡是分七八
 * 处摆出来的（基础三张、炸弹的九颗小片、更多布局、天才特供……），逐个去改要
 * 改七八处，还得记得以后新加的卡也照做。拦在这儿，往后加什么卡都自动锁上。
 *
 * 被拦下来的那一下不是「没反应」：两张基础卡抖一下、光更亮一档；他按的那张要
 * 是在两张卡下面，就在那儿冒一个小圆角箭头指他往上滑。
 */
function armFirstPlayLock(grid: HTMLElement, given?: HTMLElement[]): void {
  /**
   * 「能玩的那几张」由调用方点名（`given`），认不到才去 grid 里找。
   *
   * 这儿栽过两次，都是同一个毛病——**去问 DOM「哪几张能玩」，而问的时机不对**：
   *
   *   · 原先找的是 `.home-icon-btn--glow`。光是**引导**加的（打完第一局才给某一
   *     张镶上），和「这一张现在能不能点」是两件事；真正头一回打开的人一圈光都
   *     没有，`basics.length === 0` 当场 return，整道拦截一次都没装上。
   *   · 改成找 `[data-first-playable]` 之后，轴那一路还是空的：轴上的卡这会儿还
   *     在 axisCards 那个数组里，要等 mountModeAxis 才进 grid。
   *
   * 所以现在不猜了：谁造的卡谁最清楚，直接把那两张传进来。
   */
  const basics = given?.length
    ? given
    : Array.from(grid.querySelectorAll<HTMLElement>('[data-first-playable="1"]'));
  if (!basics.length) return;
  let hint: HTMLElement | null = null;
  let off = 0;

  grid.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.home-icon-btn') as HTMLElement | null;
      if (!btn || basics.includes(btn)) return;
      e.stopPropagation();
      e.preventDefault();

      // 抖 + 更亮一档。先摘再挂，中间读一次 offsetWidth 逼浏览器把「没有这个
      // 类」当成一帧算掉，否则连按两下第二下不会重播。
      for (const b of basics) b.classList.remove('home-icon-btn--nudge');
      void basics[0].offsetWidth;
      for (const b of basics) b.classList.add('home-icon-btn--nudge');

      // 他按的那张在两张卡下面：指一下往上滑。用的是两者在页面上的位置，不是
      // 「第几张」——宽窄两版的排法不一样，位置才是他眼睛看见的事实。
      const target = basics[0].getBoundingClientRect();
      if (btn.getBoundingClientRect().top > target.bottom + 8) {
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'home-up-hint';
          hint.setAttribute('aria-hidden', 'true');
          hint.innerHTML =
            '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"' +
            ' stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 19.5 V6"/><path d="M5.5 12 L12 5.4 L18.5 12"/></svg>';
          basics[0].parentElement?.insertBefore(hint, basics[0]);
        }
        hint.classList.remove('home-up-hint--in');
        void hint.offsetWidth;
        hint.classList.add('home-up-hint--in');
      }

      window.clearTimeout(off);
      off = window.setTimeout(() => {
        for (const b of basics) b.classList.remove('home-icon-btn--nudge');
        hint?.classList.remove('home-up-hint--in');
      }, 1400);
    },
    true,
  );
}
