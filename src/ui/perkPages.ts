/**
 * 个人主页里天才特供那几行点进去的三页——都是「看得见」的东西：
 *
 *   · 《更多得分目标》：二十个得分图案，按方块 / 小球 / 三角三列摆出来，画法
 *     和棋盘上方那一排得分图示是同一套（engine/patternIcon）。
 *   · 《更多布局》：菱形方块、六边圆球、七色圆球、大三角四副布局的缩图，各装在一个圆角
 *     矩形的框里，两两一排。摆哪几副由 main.ts 的 showLayoutsShowcase 传进来——就是主菜单
 *     上「更多布局」那一组（homeLayout.moreLayouts），图是主菜单上同一张卡面。
 *     原先只摆七色圆球和大三角两副（和 engine/geniusContent.ts 的 GENIUS_LAYOUTS 同一对）；
 *     10-08 方案 3-C-5 加上了菱形方块和六边圆球。⚠️ 那两副**照旧免费**（GENIUS_LAYOUTS 没
 *     动、主菜单上没锁）：这一页是陈列，不是「付了钱才有的」那张清单——那张清单在邀请窗，
 *     由 GENIUS_LAYOUTS 生成，还是那两副。
 *   · 《更多玩法》：无限反转那张四层翻面的图，同样装在一个圆角矩形的框里，
 *     只是陈列——要玩还是回主菜单那张卡（玩家的原话：「只是陈列着，玩家还
 *     是要到主菜单去玩的」）。
 *   · 《世界排名》：整页只有那张榜（ui/leaderboard 的 mountBoardView），没有
 *     个人总分、也没有个人成绩——那些在《记录与排名》那一页。
 *
 * 没开通的人一样点得开：前两页只是看，第三页那张榜由服务器判——没权限就是
 * 灰条加一颗《成为 Slides 天才》。三页的《退出》都回个人主页刚才看的位置。
 */
import { PRIVILEGES, STRINGS, type Lang } from '../i18n';
import { targetsOf, type Family } from '../engine/targets';
import { targetPatternDefs } from '../engine/targetIcon';
import { renderPatternHintIcons } from '../engine/patternIcon';
import {
  ICON_BASE_CIRCLE,
  ICON_BASE_SQUARE,
  ICON_BASE_TRIANGLE,
  ICON_FLIP_MODE,
  ICON_SLOT_MACHINE,
  layoutIcon,
  layoutIconIsWide, ICON_PUZZLE_MODE,} from './homeIcons';
import { shapeName } from './shapeLabels';
import { mountBoardView } from './leaderboard';
import { CTL_BACK } from './ctlIcons';
import type { BaseShape } from './homeIcons';

const FAMILY_ICON: Record<Family, string> = {
  square: ICON_BASE_SQUARE,
  circle: ICON_BASE_CIRCLE,
  triangle: ICON_BASE_TRIANGLE,
};

/** 三页共用的骨架：标题板、一行小标签、正文、底下一颗《退出》。 */
function page(pageClass: string, label: string, body: string, lang: Lang): string {
  const s = STRINGS[lang];
  return `
    <div class="app perk-page ${pageClass}">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${s.homeTagline}</p>
        </div>
      </header>
      <div class="menu-section-label">${label}</div>
      ${body}
      <div class="page-back-row"><button class="icon-btn page-back" id="backBtn" aria-label="${s.back}">${CTL_BACK}</button></div>
    </div>
  `;
}

const wireBack = (root: HTMLElement, onBack: () => void) =>
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);

/**
 * 《更多得分目标》：每列先是这一族的图形，底下是它的全部得分图案。
 *
 * **两列，不是三列**（《侵蚀阶梯》v1.2 PR-6）：老虎机只开在方块和小球两族上了
 * ——三角那副基础棋盘删了，剩下的六边蜂窝 54 是天才特供的布局，不进老虎机。
 * 三角那一族的目标数据在 engine/targets.ts 里**留着没删**（PR-8：永不被抽到），
 * 所以这一屏摆不摆它是这儿一句话的事，不是那边的事。
 */
export function renderTargetsShowcase(root: HTMLElement, lang: Lang, onBack: () => void): void {
  const families: Family[] = ['square', 'circle'];
  const columns = families
    .map((family) => {
      const cells = targetsOf(family)
        .map((p) => `<div class="tgt-cell">${renderPatternHintIcons(targetPatternDefs([p]), lang)[0]}</div>`)
        .join('');
      return `<div class="tgt-col" data-family="${family}">
        <div class="tgt-col-head" aria-label="${shapeName(lang, family, family)}">${FAMILY_ICON[family]}</div>
        ${cells}
      </div>`;
    })
    .join('');
  root.innerHTML = page('tgt-page', PRIVILEGES[lang][2], `<div class="tgt-columns">${columns}</div>`, lang);
  wireBack(root, onBack);
}

/** 《更多布局》：几副布局的缩图，各装在一个圆角矩形的框里（四张，两两一排）。 */
export function renderLayoutsShowcase(
  root: HTMLElement,
  lang: Lang,
  onBack: () => void,
  layouts: readonly { id: string; shape: BaseShape }[],
): void {
  const cards = layouts
    .map(
      (l) => `<div class="lay-card" data-layout="${l.id}">
        <div class="lay-thumb${layoutIconIsWide(l.id) ? ' lay-thumb--wide' : ''}">${layoutIcon(l.id, l.shape)}</div>
        <div class="lay-name">${shapeName(lang, l.id, l.shape)}</div>
      </div>`,
    )
    .join('');
  root.innerHTML = page('lay-page', PRIVILEGES[lang][3], `<div class="lay-grid">${cards}</div>`, lang);
  wireBack(root, onBack);
}

/** 《更多玩法》：老虎机、无限反转、步步为营三张并排陈列，各装在一个圆角矩形框里，
 *  和《更多布局》同一副样子。只是陈列——真要玩还是回主菜单，那几张卡就在第二排。
 *  （这句话从前写着「老虎机和无限反转」两张，而底下的数组早就是三条——`check-flip-batch`
 *  那条「两张卡并排」也跟着过期红了一版。） */
export function renderModesShowcase(root: HTMLElement, lang: Lang, onBack: () => void): void {
  const s = STRINGS[lang];
  // 三张图一横两竖（老虎机 897×521，无限反转 252×519，步步为营 225×472），所
  // 以各给各的宽度，让它们在框里看着一样重——步步为营和无限反转的长宽比几乎
  // 一样（0.477 对 0.485），用同一档宽度。
  const cards = [
    { id: 'slot', art: ICON_SLOT_MACHINE, thumb: 'lay-thumb--wide', name: s.randomTargetTitle },
    { id: 'flip', art: ICON_FLIP_MODE, thumb: 'lay-thumb--tall', name: s.flipModeTitle },
    { id: 'puzzle', art: ICON_PUZZLE_MODE, thumb: 'lay-thumb--tall', name: s.puzzleModeTitle },
  ]
    .map(
      (m) => `<div class="lay-card" data-mode="${m.id}">
        <div class="lay-thumb ${m.thumb}">${m.art}</div>
        <div class="lay-name">${m.name}</div>
      </div>`,
    )
    .join('');
  root.innerHTML = page('lay-page modes-page', PRIVILEGES[lang][4], `<div class="lay-grid">${cards}</div>`, lang);
  wireBack(root, onBack);
}

export interface WorldRankPageOpts {
  lang: Lang;
  onBack: () => void;
  onWantGenius: () => void;
  onReLogin: () => void;
}

/** 《世界排名》：整页就是那张榜。 */
export function renderWorldRankPage(root: HTMLElement, opts: WorldRankPageOpts): void {
  root.innerHTML = page(
    'rank-page',
    PRIVILEGES[opts.lang][6],
    `<div class="rank-page-panel" id="rankPagePanel"></div>`,
    opts.lang,
  );
  mountBoardView(root.querySelector<HTMLElement>('#rankPagePanel')!, {
    lang: opts.lang,
    onWantGenius: opts.onWantGenius,
    onReLogin: opts.onReLogin,
  });
  wireBack(root, opts.onBack);
}
