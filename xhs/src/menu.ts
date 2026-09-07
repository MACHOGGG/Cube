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
  ICON_SLOT_MACHINE,
} from '../../src/ui/homeIcons';
import { ICON_NAV_ME } from './icons';
import { STRINGS, type Lang } from '../../src/i18n';

/** 五个玩法。炸弹 / 老虎机 / 无限反转点开先挑方块还是小球。 */
export type XhsMode = 'square' | 'circle' | 'bomb' | 'slot' | 'flip';

export interface XhsMenuHandlers {
  onPlay: (mode: XhsMode) => void;
  /** 底排那唯一一颗键：成绩 + 说明合成的那一屏。 */
  onProfile: () => void;
  /**
   * 这几张卡要发光——「下一张点这儿」。
   *
   * 头一局小球打完退回主菜单时，五张卡摊在眼前，他还是不知道该点哪一张；给
   * 《基础方块》镶一圈会呼吸的光，路就只有一条了。玩过一次方块之后这圈光就
   * 撤掉（main.ts 记的那把钥匙），不再打扰他。
   */
  glow?: readonly XhsMode[];
  /**
   * 这几张卡调暗一点、写上「进阶入口」。
   *
   * 玩家定的：头一局打完回主菜单，除了发光的那张，其余几张暗一点、标出来，
   * 当完整版的预告——完整版里还有更进阶的玩法。这一版它们照样免费、照样点得
   * 开，所以只是一块牌子，不是一道锁。
   */
  soon?: readonly XhsMode[];
  /**
   * 这几张卡调暗一档。
   *
   * 和 soon 分开：牌子（「进阶入口」）是常驻的预告，暗淡只是头几局的路标。
   * 玩家把小球和方块都打过一遍之后，路他自己认得了，就不该再压着别的玩法
   * ——那时候暗淡只剩「这几个不太重要」这一层意思，不是我们想说的。
   */
  dim?: readonly XhsMode[];
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
function card(
  icon: string,
  label: string,
  onTap: () => void,
  glow = false,
  soon = false,
  dim = false,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className =
    'home-icon-btn' +
    (glow ? ' home-icon-btn--glow' : '') +
    (soon ? ' home-icon-btn--soon' : '') +
    (dim ? ' home-icon-btn--dim' : '');
  btn.setAttribute('aria-label', soon ? `${label}（完整版里还有更进阶的玩法）` : label);
  const art = document.createElement('span');
  art.className = 'home-icon-art';
  art.innerHTML = icon;
  btn.appendChild(art);
  // 「进阶入口」那块小牌子：说的是「完整版里还有更进阶的玩法」，不是一道锁——这一版
  // 照样点得开、照样免费，所以不压锁、不拦手（pointer-events 在样式里关掉）。
  //
  // 摆在图和名字**中间**，不压在图上（玩家定的）。原先是绝对定位贴在图的下
  // 沿：老虎机那张图是横的、下面本来就空着一截，牌子正好落在缝里；方块、炸
  // 弹那几张图是填满整格的，同一块牌子就盖在图案身上了。同一块牌子在五张卡
  // 上长得不一样，看着就像是没对齐。改成自己占一行，五张一致；卡因此高出一
  // 截，menuFit 会把卡缩回来（它现量现算，见 menuFit.ts）。
  if (soon) {
    const tag = document.createElement('span');
    tag.className = 'xhs-soon-tag';
    tag.textContent = '进阶入口';
    btn.appendChild(tag);
  }
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

/**
 * 底排只有一颗键，居中。
 *
 * 网页版是两颗（个人主页 / 记录与排名），这一版把那两屏并成了一屏（见
 * profile.ts），所以键也并成一颗——玩家定的：「用这个作为表示放在屏幕下方
 * 的最中间」。图标是玩家给的那个橙色圆（icons.ts）。
 *
 * 图标要包一层 .home-nav-art：网页版的尺寸、投影、按下去的那点光都挂在这个
 * 类上，直接把 SVG 塞进按钮里的话它没有尺寸，缩成一小点。
 */
function bottomNav(h: XhsMenuHandlers): HTMLElement {
  const nav = document.createElement('div');
  nav.className = 'home-nav xhs-profile-nav';
  nav.innerHTML = `
    <div class="home-nav-dock">
      <button class="home-nav-btn" id="xhsProfile" aria-label="成绩与说明">
        <span class="home-nav-art">${ICON_NAV_ME}</span>
      </button>
    </div>
  `;
  nav.querySelector<HTMLButtonElement>('#xhsProfile')!.addEventListener('click', h.onProfile);
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
      row.appendChild(
        card(
          c.icon,
          menuTag(lang, c.tag),
          () => h.onPlay(c.mode),
          !!h.glow?.includes(c.mode),
          !!h.soon?.includes(c.mode),
          !!h.dim?.includes(c.mode),
        ),
      );
    }
    grid.appendChild(row);
  }

  root.appendChild(page);
  root.appendChild(bottomNav(h));
}
