/**
 * 个人主页里《如何滑？》点进来的那一页：重看哪一族的教学。
 *
 * 没有标题、没有说明——三条横向的大圆角矩形按钮（和从前带文字那一版的卡片
 * 一个底），里面各居中一个图形（绿方块、红小球、蓝三角），点哪个看哪个的教
 * 学；底下是六条规则，每条配一段循环的小动画（ruleArt.ts）；最下面一颗《返
 * 回》。整页一屏装下，不用滚，也不被底排导航盖住。
 */
import { STRINGS, TUTORIAL_RULES, type Lang, type TutorialShape } from '../i18n';
import { CTL_BACK } from './ctlIcons';
import { RULE_ART } from './ruleArt';
import { roundTriPath } from '../engine/roundTri';
import { shapeName } from './shapeLabels';

export interface TutorialPickerHandlers {
  onPick: (shape: TutorialShape) => void;
  onBack: () => void;
}

/** 棋子的那套标准色，和 titleRain 用的是同一份。 */
const GREEN = '#2F9E52';
const RED = '#B23A3A';
const BLUE = '#4C68B0';

/** 三个入口：绿方块、红小球、蓝三角。 */
const SHAPE_GLYPH: Record<TutorialShape, string> = {
  square: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="8" y="8" width="84" height="84" rx="22" fill="${GREEN}"/></svg>`,
  circle: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="${RED}"/></svg>`,
  // 圆角走 roundTri.ts 那一条，和棋盘、教学分镜、规则配图里的三角同一个形状；
  // 同色的描边留着，是为了不改这枚图形原来的大小。
  triangle: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${roundTriPath([[50, 9], [94, 86], [6, 86]])}" fill="${BLUE}" stroke="${BLUE}" stroke-width="10" stroke-linejoin="round"/></svg>`,
};

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
              <span class="tut-rule-art">${RULE_ART[i] ?? ''}</span>
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
