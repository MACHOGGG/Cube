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
import { shapeName } from './shapeLabels';

export interface TutorialPickerHandlers {
  onPick: (shape: TutorialShape) => void;
  onBack: () => void;
}

/** 棋子的那套标准色，和 titleRain 用的是同一份。（蓝色那一个跟着三角那个入口一起
 *  撤了，见下面。） */
const GREEN = '#2F9E52';
const RED = '#B23A3A';

/** 两个入口：绿方块、红小球。蓝三角那一个 2026-09 撤了——那副基础棋盘删了
 *  （《侵蚀阶梯》v1.2 PR-6），它那段分镜也跟着删了。 */
const SHAPE_GLYPH: Record<TutorialShape, string> = {
  square: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="8" y="8" width="84" height="84" rx="22" fill="${GREEN}"/></svg>`,
  circle: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="${RED}"/></svg>`,
};

export function renderTutorialPicker(root: HTMLElement, lang: Lang, handlers: TutorialPickerHandlers): void {
  const s = STRINGS[lang];
  const rules = TUTORIAL_RULES[lang];
  // 两个（三角那副基础棋盘 2026-09 删了，见《侵蚀阶梯》v1.2 PR-6）。
  const shapes: TutorialShape[] = ['square', 'circle'];
  const name = (shape: TutorialShape) => shapeName(lang, shape, shape);
  root.innerHTML = `
    <div class="app tut-pick">
      <div class="tut-pick-shapes" id="tutorialGrid">
        ${shapes
          .map(
            // 图形上压一个播放三角。
            //
            // 玩家报的：「个人主页中的教学里上方的三个图形看不出是教学内
            // 容」。原先这三颗就是三个纯色图形——绿方块、红小球、蓝三角，
            // 和棋盘上的棋子长得一模一样，谁也看不出点下去会放一段动画；
            // 而这一页底下就摆着六条规则，更像是「这三个是图例」。
            //
            // 这一站少文字（玩家定的），所以不写「教学」两个字，压一个播放
            // 标志：那是全世界都认识的「点这里会播放」。
            (shape) =>
              `<button class="tut-shape-btn" data-shape="${shape}" aria-label="${name(shape)}">
                 ${SHAPE_GLYPH[shape]}
                 <span class="tut-shape-play" aria-hidden="true">
                   <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="var(--ink)"/><path d="M41 30 L72 50 L41 70 Z" fill="var(--surface)"/></svg>
                 </span>
               </button>`,
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
