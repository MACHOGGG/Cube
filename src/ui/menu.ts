import type { ShapeCardMeta } from '../shapes/types';
import type { BombTier } from '../engine/bomb';
import { STRINGS, type Lang } from '../i18n';
import { isLayoutLocked } from '../engine/geniusContent';
import { isGenius } from '../engine/subscription';
import { custom } from './customIcons';
import { shapeName } from './shapeLabels';
import { openCenterPicker, type PickerOption } from './centerPicker';
import { geniusLogoFluid } from './geniusLogo';

/** 《随机得分目标》在主菜单上的那块牌子——玩家给的老虎机图。 */
// 主菜单上那台老虎机是单独一张图（三个窗口里画着蓝三角、橙圆、红方块），
// 和开局时真的转起来的那台（slot-machine.svg，两个窗口）不是同一个文件。
const ICON_SLOT_MACHINE = custom('slot-machine-menu') ?? custom('slot-machine') ?? '';
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

function iconButton(glyph: string, label: string, extraClass = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'home-icon-btn' + (extraClass ? ' ' + extraClass : '');
  btn.setAttribute('aria-label', label);
  btn.innerHTML = glyph;
  wireTapFeedback(btn);
  return btn;
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
  const grid = container.querySelector<HTMLElement>('#homeGrid');
  if (!grid) throw new Error('menu: missing #homeGrid');

  // 三排，宽屏窄屏同一个排法：三个基础玩法；计时 / 炸弹 / 多人（宽屏这排末
  // 尾还有老虎机）；最后一排是那几副棋盘加无限反转（窄屏上老虎机也在这排）。
  // 一排里几张，就把这排的宽平分成几份——所以头两排的图标自然比最后一排大，
  // 稿子上就是这个关系。
  //
  // 从前手机上是两列的网格、一张一张往下排，排到第八张就出了屏幕，于是这一
  // 页要往下滑。滑动本身不是问题，问题是滑动那一下手机会把地址栏收起来：
  // 100dvh 跟着变大，按它算出来的图标上限也跟着变大——玩家看到的是「一滑所
  // 有标识就胀大一圈」；同时 position: fixed 的底排在地址栏收放的那一下会跟
  // 着漂。三排装进一屏，不滑了，这两件事一起没了。
  const newRow = (): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'home-row';
    grid.appendChild(row);
    return row;
  };

  // ---- row 1: the three base games -------------------------------------
  const baseRow = newRow();
  for (const shape of SHAPES) {
    const card = layout.base[shape];
    const btn = iconButton(BASE_ICON[shape], shapeName(lang, card.id, card.name));
    btn.addEventListener('click', () => handlers.onSelectBase(card.id));
    baseRow.appendChild(btn);
  }

  // ---- 多人游玩 ---------------------------------------------------------
  // 那扇小门排在第二排最后（宽屏上它右边还有老虎机）。点进去直接是小屋那一
  // 页，不再绕个人主页。
  const mpBtn = iconButton(ICON_MULTIPLAYER, s.mpTitle);
  mpBtn.addEventListener('click', handlers.onMultiplayer);

  // ---- row 2: timed challenge ------------------------------------------
  const timedOptions = (): PickerOption[] =>
    SHAPES.map((shape) => ({
      glyph: timedOption(shape),
      label: shapeName(lang, layout.base[shape].id, layout.base[shape].name),
      onPick: () => handlers.onTimedFor(layout.base[shape].id, 'timed'),
    }));

  // 一只沙漏代表三个，点下去飞到屏幕中间、落定时裂成三只。宽屏窄屏同一颗：
  // 稿子上第二排是「计时 · 炸弹 · 多人」三张，计时占的是一张的位置，不是
  // 三张——同一个板块在笔记本上和在手机上不该长成两个样子。
  const timedRow = newRow();
  const timedBtn = iconButton(ICON_TIMED_COMBINED, s.sectionTimed, 'home-icon-btn--timed');
  timedBtn.dataset.reopen = 'timed';
  timedBtn.addEventListener('click', () =>
    openCenterPicker({ originEl: timedBtn, title: s.sectionTimed, options: timedOptions(), split: true }),
  );
  timedRow.appendChild(timedBtn);


  // ---- row 3: bomb challenge -------------------------------------------
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
  bombBtn.appendChild(preview);
  wireTapFeedback(bombBtn);
  bombBtn.addEventListener('click', () => {
    // The close handle only exists once the picker is open, but the panel
    // has to be built first — so the chips call it through this box.
    let close: (() => void) | undefined;
    const panel = buildBombPanel('bomb', () => close?.());
    close = openCenterPicker({ originEl: bombBtn, title: s.bombBasicTitle, panel });
  });
  timedRow.appendChild(bombBtn);
  timedRow.appendChild(mpBtn);

  // ---- 每个布局玩法自己露脸，不再藏在「+」后面 -------------------------
  // 从前这里是三张通用的「+」卡，点开才看得到里面有什么。现在直接摆出来：
  // 玩家一眼就知道有哪些棋盘，少一层点击。
  //
  // 顺序按方块 / 圆球 / 三角连续排，一个形状的东西挨在一起：菱形方块、六边
  // 圆球、七色圆球、大三角、进阶三角。宽窄一个顺序——手机从前是两列，锁着
  // 的两张夹在中间会把一串能玩的东西从中截断，所以那时把它们挪到最后；现在
  // 手机上这也是一排，摆得下，就不必再打乱形状的顺序了。
  const ordered: { card: ShapeCardMeta; shape: BaseShape }[] = [];
  for (const shape of SHAPES) {
    for (const card of layout.moreLayouts[shape]) ordered.push({ card, shape });
  }

  let row = newRow();
  let inRow = 0;
  /**
   * 天才特供的那两张牌（老虎机、无限反转）：没开通就是图案压暗、正中一把锁、
   * 右下角收着天才招牌，按下去开订阅窗；开通了按下去直接进那个玩法。两张牌
   * 除了图和去处以外一模一样，所以只写一遍。
   */
  const geniusCard = (glyph: string, title: string, open: () => void): HTMLButtonElement => {
    const locked = !isGenius();
    const btn = iconButton(glyph, locked ? `${title} · ${s.geniusOnly}` : title);
    if (locked) {
      btn.classList.add('home-icon-btn--locked');
      btn.insertAdjacentHTML(
        'beforeend',
        `<span class="center-pick-lock">${ICON_LOCK}</span>` +
          `<span class="center-pick-genius">${geniusLogoFluid()}</span>`,
      );
    }
    btn.addEventListener('click', () => (locked ? handlers.onLockedLayout() : open()));
    return btn;
  };
  // 宽屏上老虎机就排在多人游玩右边，第二排四张（玩家点名要的）。窄屏上它跟
  // 无限反转一起留在最后一排——那一排本来就是「更多玩法」的地界。
  if (wide) timedRow.appendChild(geniusCard(ICON_SLOT_MACHINE, s.randomTargetTitle, handlers.onRandomTarget));
  /**
   * 《老虎机模式》和《无限反转》排在这一排最后（稿子上就是这个位置）。
   *
   * 它们不是新棋盘——挑完图形玩的还是那三个基础玩法，所以不在 moreLayouts
   * 里；但和那两副锁着的棋盘是同一档东西，所以摆在同一排。位置和有没有开通
   * 天才无关：开通与否看到的是同一个顺序，只是锁着的那几张压暗加把锁。
   *
   * 宽屏上老虎机已经排在第二排多人游玩的右边了，这里就只剩无限反转一张。
   */
  const dropExtras = () => {
    if (!wide) {
      row.appendChild(geniusCard(ICON_SLOT_MACHINE, s.randomTargetTitle, handlers.onRandomTarget));
      inRow++;
    }
    row.appendChild(geniusCard(ICON_FLIP_MODE, s.flipModeTitle, handlers.onFlipMode));
    inRow++;
  };

  // 一排最多七张：稿子上这一排是五张棋盘，后来多了老虎机，现在又多了无限反
  // 转。让它换行的话整页就高出一行（一百多像素），而这一页的规矩是「一屏装
  // 得下，不用滚」（见 check-overlap）。七张挤一排不会横着溢出——每张按 flex
  // 平分，各自还有 max-width 收着，多一张只是每张窄一点、跟着矮一点。
  for (const { card, shape } of ordered) {
    if (inRow >= 7) { row = newRow(); inRow = 0; }
    const isLocked = isLayoutLocked(card.id);
    const name = shapeName(lang, card.id, card.name);
    const btn = iconButton(
      layoutIcon(card.id, shape),
      isLocked ? `${name} · ${s.geniusOnly}` : name,
      // 进阶三角那张图是 2:1 的宽画布，摆进方框里会比别人矮一半。给它一个
      // 自己的类，把它缩到和其它图标看着一样大——按「图形本身占多大」算，
      // 不是按方框算。
      layoutIconIsWide(card.id) ? 'home-icon-btn--wide-art' : '',
    );
    if (isLocked) {
      // 锁着的玩法现在直接摆在主菜单上，得一眼看出来是锁着的：图案压暗，正
      // 中一把锁，右下角收着那块天才招牌——说明这把锁是哪一家的。招牌的大小
      // 跟着卡片走（见 .home-icon-btn--locked .center-pick-genius），永远压
      // 不到锁。
      btn.classList.add('home-icon-btn--locked');
      btn.insertAdjacentHTML(
        'beforeend',
        `<span class="center-pick-lock">${ICON_LOCK}</span>` +
          `<span class="center-pick-genius">${geniusLogoFluid()}</span>`,
      );
    }
    btn.addEventListener('click', () =>
      isLocked ? handlers.onLockedLayout() : handlers.onSelectLayout(card.id),
    );
    row.appendChild(btn);
    inRow++;
  }
  dropExtras();
}
