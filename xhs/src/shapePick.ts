/**
 * 「方块还是小球」——炸弹用的挑形状那一屏。
 *
 * 排布照 src/ui/flipMode.ts（无限反转那一屏）：两张图上下居中，底下一句话
 * 说规矩，再底下只有一颗《退出》。类名也用它那一套（.slot-page /
 * .slot-pick-row / .slot-pick-opt），所以和老虎机、无限反转那两屏长一个样。
 *
 * 网页版的炸弹是从主菜单那块「炸弹板」上按一档（基础 / 定时 / 进阶）再弹窗
 * 挑形状；这一版只有基础炸弹一档，所以直接就是挑形状。
 */
import { ICON_BASE_CIRCLE, ICON_BASE_SQUARE, bombBoard } from '../../src/ui/homeIcons';
import { CTL_BACK } from '../../src/ui/ctlIcons';
import { shapeName } from '../../src/ui/shapeLabels';
import { STRINGS, type Lang } from '../../src/i18n';
import type { Family } from '../../src/engine/targets';

export interface ShapePickHandlers {
  title: string;
  tagline: string;
  onBack: () => void;
  onPick: (family: Family) => void;
}

const FAMILIES: { family: Family; icon: string }[] = [
  { family: 'square', icon: ICON_BASE_SQUARE },
  { family: 'circle', icon: ICON_BASE_CIRCLE },
];

export function renderShapePick(root: HTMLElement, lang: Lang, h: ShapePickHandlers): void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page flip-page">
      <div class="start-stage">
        <div class="start-count slot-pick-area">
          <!-- 两张图的底板交给样式上色（bombBoard，第 18 推第 2 条）：平时是图标自己那块浅灰，
               按下去、手指或鼠标停在上面时变成砖红、加一圈白边、放大一点——和网页版炸弹选择页那
               六格同一个样子（xhs/src/pages.css 的 .xhs-bomb-pick）。 -->
          <div class="slot-pick-row slot-pick-row--two xhs-bomb-pick" id="pickShapes">
            ${FAMILIES.map(
              (f) => `<button class="slot-pick-opt" data-family="${f.family}"
                              aria-label="${shapeName(lang, f.family, f.family)}">${bombBoard(f.icon)}</button>`,
            ).join('')}
          </div>
          <p class="tag-line flip-tagline">${h.tagline}</p>
        </div>
        <button class="icon-btn page-exit" id="pickBack" aria-label="${s.back}">${CTL_BACK}</button>
      </div>
    </div>
  `;
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.slot-pick-opt'))) {
    btn.addEventListener('click', () => h.onPick(btn.dataset.family as Family));
  }
  root.querySelector<HTMLButtonElement>('#pickBack')!.addEventListener('click', h.onBack);
}
