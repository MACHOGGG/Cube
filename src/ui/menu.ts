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
// 《无限反转》：玩家画的四层翻面（src/assets/icons/flip-mode-menu.svg）。
const ICON_FLIP_MODE = custom('flip-mode-menu') ?? '';
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

  // 宽屏是三排，照设计稿：三个基础玩法、计时 / 炸弹 / 多人、再是五个布局。
  // 前两排各三张、最后一排五张，所以最后一排自然比上面两排宽——稿子上就是
  // 这个样子。手机仍旧是两列的网格，一张一张按顺序往下排。
  const newRow = (): HTMLElement => {
    if (!wide) return grid;
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
  // 手机上两列，基础三个之后紧挨着的那一格就是第二行右边——这一颗落在那里。
  // 点进去直接是房间那一页，不再绕个人主页。宽屏上它和炸弹卡片同一行。
  const mpBtn = iconButton(ICON_MULTIPLAYER, s.mpTitle);
  mpBtn.addEventListener('click', handlers.onMultiplayer);
  if (!wide) grid.appendChild(mpBtn);

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
  (wide ? timedRow : grid).appendChild(bombBtn);
  // 那扇小门排在这一排最后。手机上它早在基础三个后面就摆过了。
  if (wide) timedRow.appendChild(mpBtn);

  // ---- 每个布局玩法自己露脸，不再藏在「+」后面 -------------------------
  // 从前这里是三张通用的「+」卡，点开才看得到里面有什么。现在直接摆出来：
  // 玩家一眼就知道有哪些棋盘，少一层点击。
  //
  // 顺序按方块 / 圆球 / 三角连续排，一个形状的东西挨在一起。
  //
  // 宽屏五张一排，就照这个顺序摆完——稿子上是菱形方块、六边圆球、七色圆球、
  // 大三角、进阶三角。手机上两列，得把解锁不了的两张挪到最后：它们点下去只
  // 会弹付费墙，夹在中间会把一串能玩的东西从中截断；一排摆得下的时候没有这
  // 个问题，也就不必打乱形状的顺序。
  const inOrder: { card: ShapeCardMeta; shape: BaseShape }[] = [];
  for (const shape of SHAPES) {
    for (const card of layout.moreLayouts[shape]) inOrder.push({ card, shape });
  }
  const ordered = wide
    ? inOrder
    : [...inOrder.filter((e) => !isLayoutLocked(e.card.id)), ...inOrder.filter((e) => isLayoutLocked(e.card.id))];

  let row = wide ? newRow() : grid;
  let inRow = 0;
  /**
   * 锁区第一张：《随机得分目标》。
   *
   * 它不是一副新棋盘（挑完图形玩的就是那三个基础玩法），所以不在
   * moreLayouts 里；但它和那两副锁着的棋盘是同一档东西——天才特供，没开通
   * 就是一把锁。玩家点名要它排在锁区的第一个，所以这里在「第一张锁着的卡」
   * 之前把它插进去；手机上锁着的几张本来就被挪到了最后，插的位置正好是那一
   * 串的头上。
   */
  let slotDone = false;
  const dropSlotCard = () => {
    if (slotDone) return;
    slotDone = true;
    const locked = !isGenius();
    const btn = iconButton(
      ICON_SLOT_MACHINE,
      locked ? `${s.randomTargetTitle} · ${s.geniusOnly}` : s.randomTargetTitle,
    );
    if (locked) {
      btn.classList.add('home-icon-btn--locked');
      btn.insertAdjacentHTML(
        'beforeend',
        `<span class="center-pick-lock">${ICON_LOCK}</span>` +
          `<span class="center-pick-genius">${geniusLogoFluid()}</span>`,
      );
    }
    btn.addEventListener('click', () => (locked ? handlers.onLockedLayout() : handlers.onRandomTarget()));
    (wide ? row : grid).appendChild(btn);
    if (wide) inRow++;
    dropFlipCard();
  };
  /**
   * 锁区第二张：《无限反转》，紧跟在老虎机后面（玩家的原话：「放在主菜单的
   * 老虎机下一个，也是对无权限的玩家封锁的」）。和老虎机同一套：没开通就是
   * 居中一把锁加右下角的天才招牌，按下去开订阅窗；开通了按下去进挑图形那页。
   */
  const dropFlipCard = () => {
    const locked = !isGenius();
    const btn = iconButton(
      ICON_FLIP_MODE,
      locked ? `${s.flipModeTitle} · ${s.geniusOnly}` : s.flipModeTitle,
    );
    if (locked) {
      btn.classList.add('home-icon-btn--locked');
      btn.insertAdjacentHTML(
        'beforeend',
        `<span class="center-pick-lock">${ICON_LOCK}</span>` +
          `<span class="center-pick-genius">${geniusLogoFluid()}</span>`,
      );
    }
    btn.addEventListener('click', () => (locked ? handlers.onLockedLayout() : handlers.onFlipMode()));
    (wide ? row : grid).appendChild(btn);
    if (wide) inRow++;
  };

  // 宽屏一排七张：稿子上这一排是五张棋盘，后来多了老虎机，现在又多了无限反
  // 转。让它换行的话整页就高出一行（一百多像素），而这一页的规矩是「一屏装
  // 得下，不用滚」（见 check-overlap）。七张挤一排不会横着溢出——每张按 flex
  // 平分，各自还有 max-width 收着，多一张只是每张窄一点、跟着矮一点。
  for (const { card, shape } of ordered) {
    if (wide && inRow >= 7) { row = newRow(); inRow = 0; }
    if (isLayoutLocked(card.id)) dropSlotCard();
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
    (wide ? row : grid).appendChild(btn);
    inRow++;
  }
  // 锁区可能一张都没有（比如以后那两副棋盘也解锁了），那就摆在这一串的最后。
  dropSlotCard();
}
