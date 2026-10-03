/**
 * 个人主页里《如何滑？》点进来的那一页：五条规则，每条配一段循环的小动画（ruleArt.ts），
 * 最下面一颗《返回》。整页一屏装下，不用滚，也不被底排导航盖住。
 *
 * 从前五条上头还摆着两条大按钮（绿方块、红小球，压一个播放标志），点下去放那一族的
 * 分镜动画。第 14 推把它们撤了：那两段动画还在教旧规则（它们比《侵蚀阶梯》早），而
 * 方案定的是「直接下线入口，不重做」。规矩就看这五条——它们是跟着现在的规则走的。
 */
import { STRINGS, TUTORIAL_RULES, type Lang } from '../i18n';
import { CTL_BACK } from './ctlIcons';
import { RULE_ART } from './ruleArt';

export interface TutorialPickerHandlers {
  onBack: () => void;
}

export function renderTutorialPicker(root: HTMLElement, lang: Lang, handlers: TutorialPickerHandlers): void {
  const s = STRINGS[lang];
  const rules = TUTORIAL_RULES[lang];
  root.innerHTML = `
    <div class="app tut-pick">
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
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', handlers.onBack);
}
