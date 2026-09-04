/**
 * 小红书版的主菜单——只有玩家点名的那五个玩法。
 *
 * 为什么不复用网页版的 renderMenu：那一个是照「方块 / 小球 / 三角三列，每列
 * 基础 + 计时 + 炸弹 + 更多布局」的骨架长出来的，十三张卡；这一版只有五张，
 * 而且没有三角、没有多人、没有锁。硬塞进去要改 src/ui/menu.ts——那就动到网
 * 页版了，玩家的第一条要求正是「完全分离」。
 *
 * 但**长相是同一套**：图标是网页版那几张（src/ui/homeIcons.ts），卡片的类名
 * （.home-icon-btn / .home-icon-art / .home-icon-tag）、标题、底排导航也都用
 * src/style.css 里现成的那几条，所以两边看着是同一个 App。
 */
import { menuTag } from '../../src/ui/menuTags';
import {
  ICON_BASE_CIRCLE,
  ICON_BASE_SQUARE,
  ICON_BOMB_BADGE,
  ICON_FLIP_MODE,
  ICON_NAV_PROFILE,
  ICON_NAV_RECORDS,
  ICON_SLOT_MACHINE,
} from '../../src/ui/homeIcons';
import { STRINGS, type Lang } from '../../src/i18n';

/** 五个玩法。炸弹 / 老虎机 / 无限反转点开先挑方块还是小球。 */
export type XhsMode = 'square' | 'circle' | 'bomb' | 'slot' | 'flip';

export interface XhsMenuHandlers {
  onPlay: (mode: XhsMode) => void;
  onRecords: () => void;
  onAbout: () => void;
}

/** 宽屏（电脑、手机横屏）一排摆得下五张；窄屏一排两张。同网页版的分界。 */
const WIDE_QUERY = '(min-width: 720px), (orientation: landscape) and (min-width: 560px)';

const CARDS: { mode: XhsMode; icon: string; tag: string }[] = [
  { mode: 'square', icon: ICON_BASE_SQUARE, tag: 'square' },
  { mode: 'circle', icon: ICON_BASE_CIRCLE, tag: 'circle' },
  { mode: 'bomb', icon: ICON_BOMB_BADGE, tag: 'bomb' },
  { mode: 'slot', icon: ICON_SLOT_MACHINE, tag: 'slot' },
  { mode: 'flip', icon: ICON_FLIP_MODE, tag: 'flip' },
];

/** 一张卡：上面一格方的图，底下一行小字。和网页版的 iconButton 同一个形状。 */
function card(icon: string, label: string, onTap: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'home-icon-btn';
  btn.setAttribute('aria-label', label);
  const art = document.createElement('span');
  art.className = 'home-icon-art';
  art.innerHTML = icon;
  btn.appendChild(art);
  const cap = document.createElement('span');
  cap.className = 'home-icon-tag';
  cap.textContent = label;
  btn.appendChild(cap);
  // 按下去那一下的反馈，照网页版的 wireTapFeedback。
  btn.addEventListener('pointerdown', () => {
    btn.classList.remove('home-tap');
    void btn.offsetWidth;
    btn.classList.add('home-tap');
  });
  btn.addEventListener('animationend', () => btn.classList.remove('home-tap'));
  btn.addEventListener('click', onTap);
  return btn;
}

/** 底排那两颗：左边《记录》，右边《介绍》。网页版是个人主页 + 记录与排名。 */
function bottomNav(h: XhsMenuHandlers): HTMLElement {
  const nav = document.createElement('div');
  nav.className = 'home-nav';
  nav.innerHTML = `
    <div class="home-nav-dock">
      <button class="home-nav-btn" id="xhsRecords" aria-label="游玩记录">${ICON_NAV_RECORDS}</button>
      <button class="home-nav-btn" id="xhsAbout" aria-label="关于 Slides">${ICON_NAV_PROFILE}</button>
    </div>
  `;
  nav.querySelector<HTMLButtonElement>('#xhsRecords')!.addEventListener('click', h.onRecords);
  nav.querySelector<HTMLButtonElement>('#xhsAbout')!.addEventListener('click', h.onAbout);
  return nav;
}

export function renderXhsMenu(root: HTMLElement, lang: Lang, h: XhsMenuHandlers): void {
  const s = STRINGS[lang];
  const wide = window.matchMedia(WIDE_QUERY).matches;
  const page = document.createElement('div');
  page.className = 'app home-page' + (wide ? ' home-page--wide' : '');

  page.innerHTML = `
    <div class="home-head">
      <div class="home-head-glass">
        <h1 class="home-title">Slides</h1>
        <p class="home-sub tag-line">${s.homeTagline}</p>
      </div>
    </div>
    <div class="home-grid" id="xhsGrid"></div>
  `;

  const grid = page.querySelector<HTMLElement>('#xhsGrid')!;
  // 宽屏五张一排；窄屏两张一排，最后一排只有一张。
  const perRow = wide ? 5 : 2;
  for (let i = 0; i < CARDS.length; i += perRow) {
    const row = document.createElement('div');
    row.className = 'home-row';
    for (const c of CARDS.slice(i, i + perRow)) {
      row.appendChild(card(c.icon, menuTag(lang, c.tag), () => h.onPlay(c.mode)));
    }
    grid.appendChild(row);
  }

  root.appendChild(page);
  root.appendChild(bottomNav(h));
}
