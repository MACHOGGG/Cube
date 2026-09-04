import type { ShapeCardMeta } from '../shapes/types';
import type { BombTier } from '../engine/bomb';
import { STRINGS, type Lang } from '../i18n';
import { GENIUS_LAYOUTS, isLayoutLocked } from '../engine/geniusContent';
import { isGenius } from '../engine/subscription';
import { shapeName } from './shapeLabels';
import { menuTag } from './menuTags';
import { openCenterPicker, type PickerOption } from './centerPicker';
import { geniusLogoFluid } from './geniusLogo';

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
/** 主菜单一排摆几张。样式那边算图标上限用的也是这两个数：宽屏第二、三排各
 *  五张，窄屏一排两张（一张 130px 见方，玩家点的）。 */
const WIDE_PER_ROW = 5;
const NARROW_PER_ROW = 2;
/** The bomb panel's own order — the reference sheet lines its chips up
 *  square/triangle/circle rather than the square/circle/triangle the full-
 *  width rows above it use. */
const BOMB_SHAPES: BaseShape[] = ['square', 'triangle', 'circle'];
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
    <div class="app home-page${wide ? ' home-page--wide' : ''}">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${s.homeTagline}</p>
        </div>
      </header>
      <div class="home-grid" id="homeGrid"></div>
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
  const place = (btn: HTMLElement): void => {
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
    const btn = iconButton(BASE_ICON[shape], shapeName(lang, card.id, card.name), '', tag(card.id));
    btn.addEventListener('click', () => handlers.onSelectBase(card.id));
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
  // 窄屏：多人游玩顺着链往下摆，老虎机和无限反转收进天才特供那一段（它们是
  // 那一段里最前面的两张）。宽屏上这三张跟在计时和炸弹后面，凑成一排五张。
  if (!wide) {
    place(mpBtn);
    later(slotBtn);
    later(flipBtn);
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
}
