/**
 * 《计时挑战》第一幕：挑方块还是小球。
 *
 * 2026-09 之前这不是一整页：主菜单上那只沙漏按下去，飞到屏幕中间、落定时裂成
 * 几只，是一个居中的挑选窗（ui/centerPicker.ts）。玩家定的新样子和《无限反转》
 * 《老虎机模式》一致——一整页、图上下居中、底下一句标语、再底下只有一颗《退
 * 出》。那段「飞到中间裂开」的动效不再保留。
 *
 * 和 flipMode.ts 是同一套骨架，只有两处不同：
 *
 * · **这一页没有锁。** 计时挑战是免费的（主菜单上它走 iconButton，不是
 *   geniusCard），所以这儿没有 `locked` 形参、没有 `onGenius`、也没有那枚挂在图
 *   上的锁。抄的时候把这一路整个删掉，不留一个永远是 false 的参数——留着的话，
 *   下一个人会以为这一页有「没开通」这条分支，跑去实现它。
 * · **图只有两张，用 `slot-pick-row--two`。** 基础玩法就剩方块和小球两副（《侵蚀
 *   阶梯》v1.2 PR-6 删掉了两副三角），和 menu.ts 的 `SHAPES` 是同一个事实。
 *
 * 样式一条都不用新写：`.timed-page` 只是个身份类，画面全部来自 `.slot-page`，
 * 标语借的是 `.slot-tagline`（老虎机那一屏 2026-09 补标语时顺手扩过来的）。
 */
import { STRINGS, type Lang } from '../i18n';
import { iconFor } from './modeIcons';
import { shapeName } from './shapeLabels';
import { CTL_BACK } from './ctlIcons';

export type TimedFamily = 'square' | 'circle';

// 图从 iconFor 取（10-08 方案 3-F-4）：按下去之后倒数页上摆的就是这一张。
const FAMILIES: { family: TimedFamily; icon: string }[] = [
  { family: 'square', icon: iconFor({ mode: 'timed', board: 'square' }) },
  { family: 'circle', icon: iconFor({ mode: 'timed', board: 'circle' }) },
];

export interface TimedModeHandlers {
  onBack: () => void;
  /** 挑好了，开这一局。 */
  onStart: (family: TimedFamily) => void;
}

export function renderTimedModePage(root: HTMLElement, lang: Lang, handlers: TimedModeHandlers): void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page timed-page">
      <div class="start-stage">
        <div class="start-count slot-pick-area">
          <div class="slot-pick-row slot-pick-row--two" id="timedShapes">
            ${FAMILIES.map(
              (f) => `<button class="slot-pick-opt" data-family="${f.family}"
                              aria-label="${shapeName(lang, f.family, f.family)}">
                        ${f.icon}
                      </button>`,
            ).join('')}
          </div>
          <p class="tag-line slot-tagline">${s.timedModeTagline}</p>
        </div>
        <button class="icon-btn page-exit" id="timedBack" aria-label="${s.back}">${CTL_BACK}</button>
      </div>
    </div>
  `;
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.slot-pick-opt'))) {
    btn.addEventListener('click', () => handlers.onStart(btn.dataset.family as TimedFamily));
  }
  root.querySelector<HTMLButtonElement>('#timedBack')!.addEventListener('click', handlers.onBack);
}
