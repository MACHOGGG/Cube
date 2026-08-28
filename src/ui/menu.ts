import type { ShapeCardMeta } from '../shapes/types';
import { loadBest } from '../engine/persistence';
import { BOMB_TIER_META, type BombTier } from '../engine/bomb';
import { STRINGS, type Lang } from '../i18n';

export interface MenuHandlers {
  onSelectBase: (id: ShapeCardMeta['id']) => void;
  onSelectLayout: (id: ShapeCardMeta['id']) => void;
  onTimedFor: (id: ShapeCardMeta['id']) => void;
  onBombFor: (tier: BombTier, id: ShapeCardMeta['id']) => void;
  onRandomTarget: () => void;
  onMultiplayer: () => void;
  onRankings: () => void;
  onSignIn: () => void;
  onExclusive: () => void;
  onHowToSlide: () => void;
}

/** The home page's fixed left/middle/right column order — every 3-wide row
 *  on this page (base play, timed, each bomb tier, "更多布局") lines its
 *  cards up against this same square/circle/triangle order, so a player's
 *  eye can track "the square one" straight down the page. */
export interface HomeLayout {
  /** [square, circle, triangle] base cards. */
  baseCards: [ShapeCardMeta, ShapeCardMeta, ShapeCardMeta];
  /** [square, circle, triangle] cards for the "进阶炸弹" row — the 3 shapes
   *  that tier actually supports (squareDiamond/circleHex/triangleBig),
   *  already reordered into the square/circle/triangle column slots. */
  advancedBombCards: [ShapeCardMeta, ShapeCardMeta, ShapeCardMeta];
  /** "更多布局" cards bucketed into their own column — square's list may be
   *  shorter than the other two; any column short a row gets a dashed
   *  placeholder there instead of leaving a gap. */
  layoutColumns: [ShapeCardMeta[], ShapeCardMeta[], ShapeCardMeta[]];
}

const SIGNIN_GLYPH =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 20 C4 15.6 7.6 13 12 13 C16.4 13 20 15.6 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function compactCard(name: string, best: string | null, glyph: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'shape-card-compact shape-card-compact--tight';
  btn.innerHTML = `
    <span class="glyph">${glyph}</span>
    <span class="name">${name}</span>
    <span class="best">${best ?? '敬请期待'}</span>
  `;
  return btn;
}

function placeholderCard(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'shape-card-compact shape-card-compact--tight placeholder';
  el.innerHTML = `<span class="glyph"></span><span class="name">·</span><span class="best"></span>`;
  return el;
}

/** Renders one 3-wide row (square/circle/triangle) into a fresh grid div
 *  appended to container, calling onClick(card.id) for whichever slot the
 *  player taps. `bestSuffix` picks which persisted best-score key to show
 *  under each card (see each shape's own mount() for how the suffix is
 *  derived — '_timed'/'_bomb'/none). */
function row3(container: HTMLElement, cards: ShapeCardMeta[], bestSuffix: string, onClick: (id: string) => void): void {
  const grid = document.createElement('div');
  grid.className = 'menu-grid-3col';
  for (const card of cards) {
    const best = loadBest(card.bestKey + bestSuffix);
    const btn = compactCard(card.name, String(best), card.glyph);
    btn.addEventListener('click', () => onClick(card.id));
    grid.appendChild(btn);
  }
  container.appendChild(grid);
}

function sectionLabel(container: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'menu-section-label';
  el.textContent = text;
  container.appendChild(el);
}

export function renderMenu(container: HTMLElement, layout: HomeLayout, handlers: MenuHandlers, lang: Lang) {
  const s = STRINGS[lang];
  container.innerHTML = `
    <div class="app">
      <h1 class="home-title-glow">Slides</h1>
      <p class="tag-line">${s.homeTagline}</p>
      <div class="menu-sections" id="menuSections"></div>
      <button class="home-how-to" id="howToBtn">如何滑？· 重新观看新手教学</button>

      <div class="home-wide-card" id="randomTargetCard">
        <span class="wide-card-title">随机得分目标</span>
        <span class="wide-card-sub">敬请期待</span>
      </div>
      <div class="home-wide-card" id="multiplayerCard">
        <span class="wide-card-title">多人游玩</span>
        <span class="wide-card-sub">敬请期待</span>
      </div>
      <div class="home-wide-card" id="rankingsCard">
        <span class="wide-card-title">成绩与排名</span>
        <span class="wide-card-sub">敬请期待</span>
      </div>

      <div class="home-signin-row">
        <button class="signin-circle" id="signInBtn" aria-label="Sign In">${SIGNIN_GLYPH}</button>
        <button class="exclusive-pill" id="exclusiveBtn">
          <span class="zh">天才入口</span>
          <span class="en">exclusive</span>
        </button>
      </div>
    </div>
  `;

  const req = <T extends HTMLElement>(id: string) => {
    const el = container.querySelector<T>('#' + id);
    if (!el) throw new Error(`menu: missing #${id}`);
    return el;
  };

  const sections = req<HTMLElement>('menuSections');

  sectionLabel(sections, '基础玩法');
  row3(sections, layout.baseCards, '', handlers.onSelectBase);

  sectionLabel(sections, '计时挑战');
  row3(sections, layout.baseCards, '_timed', handlers.onTimedFor);

  (['basic', 'timed'] as BombTier[]).forEach((tier) => {
    sectionLabel(sections, BOMB_TIER_META[tier].title);
    row3(sections, layout.baseCards, '_bomb', (id) => handlers.onBombFor(tier, id));
  });
  sectionLabel(sections, BOMB_TIER_META.advanced.title);
  row3(sections, layout.advancedBombCards, '_bomb', (id) => handlers.onBombFor('advanced', id));

  sectionLabel(sections, '更多布局');
  const maxLayoutRows = Math.max(...layout.layoutColumns.map((col) => col.length));
  for (let r = 0; r < maxLayoutRows; r++) {
    const grid = document.createElement('div');
    grid.className = 'menu-grid-3col';
    for (const col of layout.layoutColumns) {
      const card = col[r];
      if (!card) {
        grid.appendChild(placeholderCard());
        continue;
      }
      const best = loadBest(card.bestKey);
      const btn = compactCard(card.name, String(best), card.glyph);
      btn.addEventListener('click', () => handlers.onSelectLayout(card.id));
      grid.appendChild(btn);
    }
    sections.appendChild(grid);
  }

  req<HTMLElement>('randomTargetCard').addEventListener('click', handlers.onRandomTarget);
  req<HTMLElement>('multiplayerCard').addEventListener('click', handlers.onMultiplayer);
  req<HTMLElement>('rankingsCard').addEventListener('click', handlers.onRankings);
  req<HTMLButtonElement>('signInBtn').addEventListener('click', handlers.onSignIn);
  req<HTMLButtonElement>('exclusiveBtn').addEventListener('click', handlers.onExclusive);
  req<HTMLButtonElement>('howToBtn').addEventListener('click', handlers.onHowToSlide);
}
