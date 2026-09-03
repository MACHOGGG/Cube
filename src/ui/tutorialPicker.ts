/**
 * 个人主页里《如何滑？》点进来的那一页：重看哪一族的教学。
 *
 * 没有标题、没有说明——三个图形（绿方块、红小球、蓝三角）上下排着，点哪个
 * 看哪个的教学；底下是六条规则的图解，最下面一颗《返回》。整页一屏装下，
 * 不用滚，也不被底排导航盖住。玩家的原话：「去除上方的《如何滑……重新观看
 * 新手教学》，直接下面三个图形……不需要任何其他文字……所有内容加上上方的三个
 * 动画教学都要放在一个画面内，不需要上下移动」。
 *
 * 六条规则各配一幅小图，用的是棋子的画法：正面是一块实色，反面是暗底上一
 * 颗点（和棋盘上一样），翻面用 CSS 的 3D 翻转真的翻给人看。
 */
import { STRINGS, TUTORIAL_RULES, type Lang, type TutorialShape } from '../i18n';
import { CTL_BACK } from './ctlIcons';
import { shapeName } from './shapeLabels';

export interface TutorialPickerHandlers {
  onPick: (shape: TutorialShape) => void;
  onBack: () => void;
}

/** 棋子的那套标准色，和 titleRain 用的是同一份。 */
const GREEN = '#2F9E52';
const RED = '#B23A3A';
const BLUE = '#4C68B0';
const ORANGE = '#D89B1E';
const TEAL = '#2F8A96';

/** 三个入口：绿方块、红小球、蓝三角。 */
const SHAPE_GLYPH: Record<TutorialShape, string> = {
  square: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="8" y="8" width="84" height="84" rx="22" fill="${GREEN}"/></svg>`,
  circle: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="${RED}"/></svg>`,
  triangle: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 9 L94 86 H6 Z" fill="${BLUE}" stroke="${BLUE}" stroke-width="10" stroke-linejoin="round"/></svg>`,
};

/**
 * 一枚棋子：正面一块实色（--f），反面暗底一颗点（--d）。
 * rl-tile--back：一直露着反面；rl-flip：来回翻；rl-fade：亮一会儿就淡掉（消除）。
 */
const tile = (front: string, dot: string, cls = '', delay = 0) =>
  `<span class="rl-tile${cls ? ' ' + cls : ''}" style="--f:${front};--d:${dot}${delay ? `;animation-delay:${delay}s` : ''}">` +
  `<i class="rl-front"></i><i class="rl-back"><b></b></i></span>`;

const ART: string[] = [
  // 1. 正反两面：一枚棋子来回翻。
  `<span class="rl-row">${tile(GREEN, RED, 'rl-flip')}</span>`,
  // 2. 同色凑成图案得分并翻面——翻出来的反面颜色各不相同。
  `<span class="rl-row rl-row--score">${tile(GREEN, RED, 'rl-flip', 0)}${tile(GREEN, BLUE, 'rl-flip', 0.12)}${tile(GREEN, ORANGE, 'rl-flip', 0.24)}</span>`,
  // 3. 反面的点和正面同色，也能再凑成图案。
  `<span class="rl-row rl-row--score">${tile(BLUE, GREEN, 'rl-tile--back')}${tile(RED, GREEN, 'rl-tile--back')}${tile(GREEN, TEAL)}</span>`,
  // 4. 反面同色连成一行：得分并消除。
  `<span class="rl-row">${tile(RED, BLUE, 'rl-tile--back rl-fade', 0)}${tile(GREEN, BLUE, 'rl-tile--back rl-fade', 0)}${tile(ORANGE, BLUE, 'rl-tile--back rl-fade', 0)}${tile(TEAL, BLUE, 'rl-tile--back rl-fade', 0)}</span>`,
  // 5. 全部翻成反面（或剩下的翻不动了）就结束。
  `<span class="rl-grid">${tile(RED, BLUE, 'rl-tile--back')}${tile(GREEN, ORANGE, 'rl-tile--back')}${tile(BLUE, RED, 'rl-tile--back')}${tile(ORANGE, GREEN, 'rl-tile--back')}${tile(TEAL, RED, 'rl-tile--back')}${tile(RED, TEAL, 'rl-tile--back')}</span>` +
    `<svg class="rl-check" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="${GREEN}"/><path d="M29 51.5 L44 66 L72 35" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // 6. 时间短、步数少、得分多 → 综合得分高。
  `<svg class="rl-sym" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="56" r="34" fill="none" stroke="currentColor" stroke-width="9"/><path d="M50 56 V34 M50 56 L64 64 M40 14 H60" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/></svg>` +
    `<svg class="rl-sym" viewBox="0 0 100 100" aria-hidden="true"><path d="M14 50 H86 M30 32 L12 50 L30 68 M70 32 L88 50 L70 68" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
    `<svg class="rl-sym rl-sym--star" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 8 L62 36 L92 38 L69 58 L76 88 L50 72 L24 88 L31 58 L8 38 L38 36 Z" fill="${ORANGE}"/></svg>`,
];

export function renderTutorialPicker(root: HTMLElement, lang: Lang, handlers: TutorialPickerHandlers): void {
  const s = STRINGS[lang];
  const rules = TUTORIAL_RULES[lang];
  const shapes: TutorialShape[] = ['square', 'circle', 'triangle'];
  const name = (shape: TutorialShape) => shapeName(lang, shape, shape);
  root.innerHTML = `
    <div class="app tut-pick">
      <div class="tut-pick-shapes" id="tutorialGrid">
        ${shapes
          .map(
            (shape) =>
              `<button class="tut-shape-btn" data-shape="${shape}" aria-label="${name(shape)}">${SHAPE_GLYPH[shape]}</button>`,
          )
          .join('')}
      </div>
      <div class="tut-rules">
        ${rules
          .map(
            (text, i) => `<div class="tut-rule">
              <span class="tut-rule-num">${i + 1}</span>
              <span class="tut-rule-art">${ART[i] ?? ''}</span>
              <span class="tut-rule-text">${text}</span>
            </div>`,
          )
          .join('')}
      </div>
      <div class="page-back-row"><button class="icon-btn page-back" id="backBtn" aria-label="${s.backToMenu}">${CTL_BACK}</button></div>
    </div>
  `;
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.tut-shape-btn'))) {
    btn.addEventListener('click', () => handlers.onPick(btn.dataset.shape as TutorialShape));
  }
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', handlers.onBack);
}
