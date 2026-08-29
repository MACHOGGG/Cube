import type { ShapeCardMeta } from '../shapes/types';
import type { BombTier } from '../engine/bomb';
import { STRINGS, type Lang } from '../i18n';
import { shapeName } from './shapeLabels';
import { openCenterPicker, type PickerOption } from './centerPicker';
import {
  ICON_BASE_SQUARE,
  ICON_BASE_CIRCLE,
  ICON_BASE_TRIANGLE,
  ICON_TIMED_COMBINED,
  ICON_BOMB_STAR,
  ICON_BOMB_90S,
  bombChip,
  moreLayoutCard,
  timedCard,
  timedOption,
  type BaseShape,
} from './homeIcons';

export interface MenuHandlers {
  onSelectBase: (id: string) => void;
  onSelectLayout: (id: string) => void;
  onTimedFor: (id: string) => void;
  onBombFor: (tier: BombTier, id: string) => void;
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

/** Below this width the timed and bomb sections collapse into a single card
 *  each, which opens a centred picker on tap; above it they sit expanded on
 *  the page and every option is one tap away. */
const WIDE_QUERY = '(min-width: 720px)';

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
        <h1 class="home-title">Slides</h1>
        <p class="home-sub">${s.homeTagline}</p>
      </header>
      <div class="home-grid" id="homeGrid"></div>
    </div>
  `;
  const grid = container.querySelector<HTMLElement>('#homeGrid');
  if (!grid) throw new Error('menu: missing #homeGrid');

  // ---- row 1: the three base games -------------------------------------
  for (const shape of SHAPES) {
    const card = layout.base[shape];
    const btn = iconButton(BASE_ICON[shape], shapeName(lang, card.id, card.name));
    btn.addEventListener('click', () => handlers.onSelectBase(card.id));
    grid.appendChild(btn);
  }

  // ---- row 2: timed challenge ------------------------------------------
  const timedOptions = (): PickerOption[] =>
    SHAPES.map((shape) => ({
      glyph: timedOption(shape),
      label: shapeName(lang, layout.base[shape].id, layout.base[shape].name),
      onPick: () => handlers.onTimedFor(layout.base[shape].id),
    }));

  if (wide) {
    // Expanded: one clock per shape, each starting that game immediately.
    for (const shape of SHAPES) {
      const card = layout.base[shape];
      const btn = iconButton(timedCard(shape), `${s.sectionTimed} · ${shapeName(lang, card.id, card.name)}`);
      btn.addEventListener('click', () => handlers.onTimedFor(card.id));
      grid.appendChild(btn);
    }
  } else {
    // Collapsed: one clock standing in for all three, which flies to the
    // middle of the screen and splits into the three as it lands.
    const btn = iconButton(ICON_TIMED_COMBINED, s.sectionTimed, 'home-icon-btn--timed');
    btn.addEventListener('click', () =>
      openCenterPicker({ originEl: btn, title: s.sectionTimed, options: timedOptions(), split: true }),
    );
    grid.appendChild(btn);
  }

  // ---- row 3: bomb challenge -------------------------------------------
  // The panel is the same markup wherever it appears — inline beside the
  // burst on a wide screen, blown up in the centre of a phone — so its three
  // tiers stay in the same order and only its size changes.
  function buildBombPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'bomb-panel';

    const basicRow = document.createElement('div');
    basicRow.className = 'bomb-row';
    for (const shape of BOMB_SHAPES) {
      const card = layout.base[shape];
      const chip = iconButton(bombChip(shape, 'basic'), `${s.bombBasicTitle} · ${shapeName(lang, card.id, card.name)}`, 'bomb-chip');
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onBombFor('basic', card.id);
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
        const chip = iconButton(bombChip(shape, 'basic'), `${s.bombTimedTitle} · ${shapeName(lang, card.id, card.name)}`, 'bomb-chip');
        chip.addEventListener('click', (ev) => {
          ev.stopPropagation();
          handlers.onBombFor('timed', card.id);
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
        handlers.onBombFor('advanced', card.id);
      });
      advRow.appendChild(chip);
    }
    panel.appendChild(advRow);
    return panel;
  }

  if (wide) {
    const star = document.createElement('div');
    star.className = 'home-icon-btn home-bomb-star';
    star.innerHTML = ICON_BOMB_STAR;
    grid.appendChild(star);
    const wrap = document.createElement('div');
    wrap.className = 'home-bomb-wrap';
    wrap.appendChild(buildBombPanel());
    grid.appendChild(wrap);
    // Keeps the pair centred under the 3-wide rows above, matching the sheet.
    const spacer = document.createElement('div');
    spacer.className = 'home-grid-spacer';
    grid.appendChild(spacer);
  } else {
    const btn = document.createElement('button');
    btn.className = 'home-icon-btn home-bomb-mini';
    btn.setAttribute('aria-label', s.bombBasicTitle);
    btn.appendChild(buildBombPanel());
    wireTapFeedback(btn);
    btn.addEventListener('click', () =>
      openCenterPicker({ originEl: btn, title: s.bombBasicTitle, panel: buildBombPanel() }),
    );
    grid.appendChild(btn);
  }

  // ---- row 4: more layouts ---------------------------------------------
  // One card per base shape, holding that shape's own layout variants:
  // square has a single one (so it starts straight away), circle and
  // triangle have two apiece and open a picker.
  const moreOrder: BaseShape[] = wide ? ['square', 'circle', 'triangle'] : ['square', 'triangle', 'circle'];
  for (const shape of moreOrder) {
    const cards = layout.moreLayouts[shape];
    if (!cards.length) continue;
    const btn = iconButton(moreLayoutCard(shape), `${s.sectionMore} · ${shapeName(lang, layout.base[shape].id, layout.base[shape].name)}`);
    btn.addEventListener('click', () => {
      if (cards.length === 1) {
        handlers.onSelectLayout(cards[0].id);
        return;
      }
      openCenterPicker({
        originEl: btn,
        title: s.sectionMore,
        options: cards.map((c) => ({
          glyph: moreLayoutCard(shape),
          label: shapeName(lang, c.id, c.name),
          showLabel: true,
          onPick: () => handlers.onSelectLayout(c.id),
        })),
      });
    });
    grid.appendChild(btn);
  }
}
