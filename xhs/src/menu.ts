/**
 * 小红书版的主菜单——只有玩家点名的那几个玩法（2026-10 加《步步为营》之后是六个）。
 *
 * 为什么不复用网页版的 renderMenu：那一个是照「方块 / 小球 / 三角三列，每列
 * 基础 + 计时 + 炸弹 + 更多布局」的骨架长出来的，十三张卡；这一版只有六张，
 * 而且没有三角、没有多人、没有锁。硬塞进去要改 src/ui/menu.ts——那就动到网
 * 页版了，玩家的第一条要求正是「完全分离」。
 *
 * 但**长相是同一套**：图标是网页版那几张（src/ui/homeIcons.ts），卡片的类名
 * （.home-icon-btn / .home-icon-art / .home-icon-tag）、标题、底排导航也都用
 * src/style.css 里现成的那几条，所以两边看着是同一个 App。
 */
import { menuTag } from '../../src/ui/menuTags';
import { knowHowButton } from '../../src/ui/knowHowBtn';
import {
  ICON_BASE_CIRCLE,
  ICON_BASE_SQUARE,
  ICON_BOMB_MENU,
  ICON_FLIP_MODE,
  ICON_PUZZLE_MODE,
  ICON_SLOT_MACHINE,
} from '../../src/ui/homeIcons';
import { ICON_NAV_ME } from './icons';
import { STRINGS, type Lang } from '../../src/i18n';
import { dailyAria, dailyArtHtml, watchDay } from '../../src/ui/dailyArt';
import { dayIndexOf } from '../../src/engine/seedCode';

/** 六个玩法。炸弹 / 老虎机 / 无限反转 / 步步为营点开先挑方块还是小球。 */
export type XhsMode = 'square' | 'circle' | 'bomb' | 'slot' | 'flip' | 'puzzle';

export interface XhsMenuHandlers {
  onPlay: (mode: XhsMode) => void;
  /**
   * 《每日挑战》那张卡（第 19 推）。它**不是**一档 XhsMode、不在 CARDS 里：它是摆在最上面单独
   * 一行的那一张（方案原话：「小红书：只在最上方加这一张、居中，其余排布一点不动；在决策文档
   * 记为 E20 的唯一例外」）。放进 CARDS 的话，「窄屏两张一排、三排」那几条冻结的排布就被它挤
   * 动了——六张卡会排成 2 + 2 + 2 + 1。
   */
  onDaily: () => void;
  /** 底排那唯一一颗键：成绩 + 说明合成的那一屏。 */
  onProfile: () => void;
  /**
   * 这几张卡要发光——「下一张点这儿」。
   *
   * 头一局小球打完退回主菜单时，那几张卡摊在眼前，他还是不知道该点哪一张；给
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
  /**
   * 按了《我会玩》：引导的路标（发光 + 压暗）全撤，主菜单重画一遍。
   *
   * 这一版的「新手检测拦截」不是锁——每张卡一直都点得开，压暗只是路标（见上面
   * dim 那段）。玩家要的按钮是同一颗，撤掉的东西按各端自己有的算：网页版撤锁和
   * 光，这一版撤压暗和光。
   */
  onKnowHow?: () => void;
}

/** 宽屏（电脑、手机横屏）一排摆得下六张；窄屏一排两张。同网页版的分界。 */
const WIDE_QUERY = '(min-width: 720px), (orientation: landscape) and (min-width: 560px)';

const CARDS: { mode: XhsMode; icon: string; tag: string }[] = [
  { mode: 'square', icon: ICON_BASE_SQUARE, tag: 'square' },
  { mode: 'circle', icon: ICON_BASE_CIRCLE, tag: 'circle' },
  // 炸弹那张和网页版主菜单是同一枚（10-09 补充方案 7-17 的 bomb-menu.svg）。
  { mode: 'bomb', icon: ICON_BOMB_MENU, tag: 'bomb' },
  { mode: 'slot', icon: ICON_SLOT_MACHINE, tag: 'slot' },
  { mode: 'flip', icon: ICON_FLIP_MODE, tag: 'flip' },
  // 《步步为营》2026-10 补进来（决策 §10 的 E20：「小红书版……加《步步为营》」）。
  // 网页端那一张走 geniusCard（天才特供），这一端没有天才这回事——整个是免费的，
  // 所以它和别的几张一样摆着，不加锁也不加徽记。
  { mode: 'puzzle', icon: ICON_PUZZLE_MODE, tag: 'puzzle' },
];

/** 基础那两副。主菜单上只有这两张正常亮（玩家定的「基础的两个玩法是明亮的」）。 */
export const XHS_BASIC_MODES = ['square', 'circle'] as const;

/**
 * 「进阶」那几档 ＝ `CARDS` 里除了基础那两张的全部。`soon`（那块「进阶入口」牌子）
 * 和 `dim`（头几局的路标）都收它。
 *
 * **算出来的，不手写。** 从前 `main.ts` 里那两行各手写一份
 * `['bomb', 'slot', 'flip']`，2026-10 往菜单补《步步为营》时**两处都漏了**：六张卡里
 * 只有它一张既不暗、也没牌子——四个兄弟都有、它没有，看上去像「这张才是正式的」。
 * 少的不是功能，是一屏卡说不到一块去。从 CARDS 里算，加卡就自动跟上。
 */
export const XHS_ADVANCED_MODES: readonly XhsMode[] = CARDS.map((c) => c.mode).filter(
  (m) => !(XHS_BASIC_MODES as readonly XhsMode[]).includes(m),
);

/**
 * 上一次画主菜单时给《每日挑战》那张卡排的「零点换图」。主菜单每次都整个重画，旧的那一个不撤
 * 的话回一次主菜单就多挂一个定时器。
 */
let stopDailyWatch: (() => void) | null = null;

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
  // 弹那几张图是填满整格的，同一块牌子就盖在图案身上了。同一块牌子在几张卡
  // 上长得不一样，看着就像是没对齐。改成自己占一行，张张一致；卡因此高出一
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
/**
 * @param active 这一刻正开着成绩与说明那一屏。这颗键于是升出圆角矩形一半、
 *   暗一档、带一圈红光（.home-nav-btn--active，网页版底排的同一套），按下去
 *   是「收起来」——回主菜单。玩家定的：那颗键在信息栏里也留着，位置不变，
 *   再点一下回主菜单。
 */
export function xhsBottomNav(onTap: () => void, active = false): HTMLElement {
  const nav = document.createElement('div');
  nav.className = 'home-nav xhs-profile-nav';
  nav.innerHTML = `
    <div class="home-nav-dock">
      <button class="home-nav-btn${active ? ' home-nav-btn--active' : ''}" id="xhsProfile" aria-label="成绩与说明">
        <span class="home-nav-art">${ICON_NAV_ME}</span>
      </button>
    </div>
  `;
  const btn = nav.querySelector<HTMLButtonElement>('#xhsProfile')!;
  // 按下去那一下亮一亮再落回来——玩家的原话「点击的时候会呼吸感的亮一下」。
  // 从 pointerdown 起，不等 click：这一下往往同时换屏，等 click 就来不及放。
  btn.addEventListener('pointerdown', () => {
    btn.classList.remove('xhs-nav-breath');
    void btn.offsetWidth; // 逼浏览器把上一次的动画收掉，不然连点第二下不播
    btn.classList.add('xhs-nav-breath');
  });
  btn.addEventListener('animationend', () => btn.classList.remove('xhs-nav-breath'));
  btn.addEventListener('click', onTap);
  return nav;
}

function bottomNav(h: XhsMenuHandlers): HTMLElement {
  return xhsBottomNav(h.onProfile);
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
  /*
   * 《每日挑战》（第 19 推）：最上面单独一行、居中，只有这一张——E20「主菜单排布冻结」唯一的例
   * 外（方案原话）。下面那几排一张都不动：还是窄屏两张一排、宽屏一排六张、同样的次序。
   *
   * 图按本机时间的北京日期换（小红书那一版不联网，用本机的钟——方案原话），到零点自动换图、
   * 切回前台时重算（dailyArt.ts 的 watchDay）。读屏念「每日挑战，10 月 3 日」，底下那行小字是
   * 「每日挑战」。它不压暗、不挂「进阶入口」牌子：今天那一局谁都能打。
   */
  {
    const today = dayIndexOf(Date.now());
    const row = document.createElement('div');
    row.className = 'home-row xhs-daily-row';
    const btn = card(dailyArtHtml(today), s.dailyTitle, () => h.onDaily());
    btn.classList.add('home-icon-btn--daily');
    btn.setAttribute('aria-label', dailyAria(lang, today));
    row.appendChild(btn);
    grid.appendChild(row);
    stopDailyWatch?.();
    stopDailyWatch = watchDay(Date.now, (d) => {
      if (!btn.isConnected) {
        stopDailyWatch?.();
        stopDailyWatch = null;
        return;
      }
      const art = btn.querySelector<HTMLElement>('.home-icon-art');
      if (art) art.innerHTML = dailyArtHtml(d);
      btn.setAttribute('aria-label', dailyAria(lang, d));
    });
  }
  // 六张：宽屏一排摆完，窄屏三排各两张（排数和五张那一版一样，所以 menuFit 量出来的
  // 高度没变）。从前宽屏那个数写的是 5——补上第六张之后它会排成 5 + 1，最后一张孤
  // 零零吊在下面一行。
  const perRow = wide ? 6 : 2;
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

  // 《我会玩》：只在引导还在压暗别的玩法时摆出来，摆在整张菜单的下方。
  if (h.dim && h.dim.length > 0) {
    const btn = knowHowButton(lang, () => h.onKnowHow?.());
    page.appendChild(btn);
  }

  root.appendChild(page);
  root.appendChild(bottomNav(h));
}
