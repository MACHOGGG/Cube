/**
 * 《真正解密 · 步步为营》第一幕：挑方块、小球还是三角。
 *
 * 三个基础玩法都有它（不像无限反转只有两个）。规则和普通玩法一样——同样的得
 * 分图案、同样的滑法——差别只在**手里那几步**：开局 8 步，走一步扣 1，得分退
 * 回 1；上一步也得分再退 1，这一步消掉整线再退 1，不封顶。没有钟。这些改在
 * engine/puzzleScore.ts 和 gameController 里，这一页只是挑一个然后开局。
 *
 * 排布照《无限反转》那一屏（ui/flipMode.ts），只有两处不同：三个图形而不是两
 * 个（所以 .slot-pick-row 不带 --two），底下那句话换成这个玩法自己的。
 *
 * **不支持小屋。** 这一局是「手里这几步能把盘面变成什么样」，快慢不算数，而小
 * 屋比的是同一段时间里谁分高——两件事凑不到一起。屋主替整屋挑玩法时按到主菜单
 * 那张卡，走 notAMultiplayerBoard()（和计时、炸弹同一条路），所以这里不给 room
 * 入口。
 */
import { STRINGS, type Lang } from '../i18n';
import { ICON_BASE_CIRCLE, ICON_BASE_SQUARE, ICON_BASE_TRIANGLE, ICON_LOCK } from './homeIcons';
import { shapeName } from './shapeLabels';
import { CTL_BACK } from './ctlIcons';

export type PuzzleFamily = 'square' | 'circle' | 'triangle';

const FAMILIES: { family: PuzzleFamily; icon: string }[] = [
  { family: 'square', icon: ICON_BASE_SQUARE },
  { family: 'circle', icon: ICON_BASE_CIRCLE },
  { family: 'triangle', icon: ICON_BASE_TRIANGLE },
];

export interface PuzzleModeHandlers {
  onBack: () => void;
  /** 挑好了，开这一局。 */
  onStart: (family: PuzzleFamily) => void;
  /** 没开通的人点了那三张图里的任意一张。 */
  onGenius: () => void;
}

export function renderPuzzleModePage(
  root: HTMLElement,
  lang: Lang,
  handlers: PuzzleModeHandlers,
  locked: boolean,
): void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page flip-page">
      <div class="start-stage">
        <div class="start-count slot-pick-area">
          <div class="slot-pick-row${locked ? ' slot-pick-row--locked' : ''}" id="puzzleShapes">
            ${FAMILIES.map(
              (f) => `<button class="slot-pick-opt" data-family="${f.family}"
                              aria-label="${shapeName(lang, f.family, f.family)}">
                        ${f.icon}
                        ${locked ? `<span class="slot-pick-lock">${ICON_LOCK}</span>` : ''}
                      </button>`,
            ).join('')}
          </div>
          <p class="tag-line flip-tagline">${s.puzzleModeTagline}</p>
        </div>
        <div class="start-actions">
          <button class="icon-btn start-act" id="puzzleBack" aria-label="${s.back}">${CTL_BACK}</button>
        </div>
      </div>
    </div>
  `;
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.slot-pick-opt'))) {
    btn.addEventListener('click', () => {
      if (locked) return handlers.onGenius();
      handlers.onStart(btn.dataset.family as PuzzleFamily);
    });
  }
  root.querySelector<HTMLButtonElement>('#puzzleBack')!.addEventListener('click', handlers.onBack);
}
