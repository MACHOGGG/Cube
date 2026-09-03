/**
 * 《无限反转》第一幕：挑方块还是小球。
 *
 * 只有这两个基础玩法有它（玩家的原话：「这个玩法只对基础方块和小球适用」）。
 * 规则和普通玩法一样——同样的得分图案、同样的滑法——只有两处不同：图案得分
 * 翻面之后，一组里正面的翻成反面、反面的翻回正面，正反无限反转；反面同色连
 * 成一行 / 列不消除。一局 120 秒，看能拿多少分。这两条改在计分连锁和两个玩法
 * 本身（engine/scoring.ts 的 toggleOnMatch，shapes/square.ts、circle.ts 的
 * flipMode），这里只是挑一个然后开局。
 *
 * 排布和《老虎机模式》挑图形那一屏是同一套：两张图上下居中，底下一句话说规
 * 矩，再底下只有一颗《退出》。没开通的人图照画，只是挂锁，按下去是订阅那扇窗。
 */
import { STRINGS, type Lang } from '../i18n';
import { ICON_BASE_CIRCLE, ICON_BASE_SQUARE, ICON_LOCK } from './homeIcons';
import { shapeName } from './shapeLabels';
import { CTL_BACK } from './ctlIcons';

export type FlipFamily = 'square' | 'circle';

const FAMILIES: { family: FlipFamily; icon: string }[] = [
  { family: 'square', icon: ICON_BASE_SQUARE },
  { family: 'circle', icon: ICON_BASE_CIRCLE },
];

export interface FlipModeHandlers {
  onBack: () => void;
  /** 挑好了，开这一局。 */
  onStart: (family: FlipFamily) => void;
  /** 没开通的人点了那两张图里的任意一张。 */
  onGenius: () => void;
}

export function renderFlipModePage(
  root: HTMLElement,
  lang: Lang,
  handlers: FlipModeHandlers,
  locked: boolean,
): void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page flip-page">
      <div class="start-stage">
        <div class="start-count slot-pick-area">
          <div class="slot-pick-row slot-pick-row--two${locked ? ' slot-pick-row--locked' : ''}" id="flipShapes">
            ${FAMILIES.map(
              (f) => `<button class="slot-pick-opt" data-family="${f.family}"
                              aria-label="${shapeName(lang, f.family, f.family)}">
                        ${f.icon}
                        ${locked ? `<span class="slot-pick-lock">${ICON_LOCK}</span>` : ''}
                      </button>`,
            ).join('')}
          </div>
          <p class="tag-line flip-tagline">${s.flipModeTagline}</p>
        </div>
        <div class="start-actions">
          <button class="icon-btn start-act" id="flipBack" aria-label="${s.back}">${CTL_BACK}</button>
        </div>
      </div>
    </div>
  `;
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.slot-pick-opt'))) {
    btn.addEventListener('click', () => {
      if (locked) return handlers.onGenius();
      handlers.onStart(btn.dataset.family as FlipFamily);
    });
  }
  root.querySelector<HTMLButtonElement>('#flipBack')!.addEventListener('click', handlers.onBack);
}
