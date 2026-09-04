/**
 * 个人主页里天才特供那几行点进去的三页——都是「看得见」的东西：
 *
 *   · 《更多得分目标》：二十个得分图案，按方块 / 小球 / 三角三列摆出来，画法
 *     和棋盘上方那一排得分图示是同一套（engine/patternIcon）。
 *   · 《更多布局》：菱形七色小球和 V 形三角两副布局的缩图，各装在一个圆角
 *     矩形的框里。
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
import { ICON_BASE_CIRCLE, ICON_BASE_SQUARE, ICON_BASE_TRIANGLE, ICON_FLIP_MODE, layoutIcon, layoutIconIsWide } from './homeIcons';
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

/** 《更多得分目标》：三列，每列先是这一族的图形，底下是它的全部得分图案。 */
export function renderTargetsShowcase(root: HTMLElement, lang: Lang, onBack: () => void): void {
  const families: Family[] = ['square', 'circle', 'triangle'];
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

/** 《更多布局》：几副布局的缩图，各装在一个圆角矩形的框里。 */
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

/** 《更多玩法》：无限反转的图装在圆角矩形框里陈列着，和《更多布局》同一副样子。 */
export function renderModesShowcase(root: HTMLElement, lang: Lang, onBack: () => void): void {
  const s = STRINGS[lang];
  const card = `<div class="lay-card" data-mode="flip">
        <div class="lay-thumb lay-thumb--tall">${ICON_FLIP_MODE}</div>
        <div class="lay-name">${s.flipModeTitle}</div>
      </div>`;
  root.innerHTML = page('lay-page modes-page', PRIVILEGES[lang][4], `<div class="lay-grid">${card}</div>`, lang);
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
