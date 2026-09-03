/**
 * 《随机得分目标》第一幕：挑一个图形。
 *
 * 一整屏，排布和 4-3-2-1 开局页是同一套——三个图形三选一上下居中，底下只有
 * 一颗《退出》；那台机器不在这一屏，转起来的时候才出现。没有一句说明：三张图
 * 已经说完了要选什么。玩家的原话：「进来先是方块、圆球、三角三个三选一（不
 * 需要任何文字指示）……在这下面只有一个额外的按钮是退出」。
 *
 * 挑完就直接开局——第二幕（滚筒真的转起来、5-4-3-2-1）长在游戏外壳的开局页
 * 上，见 gameShell 的 slotTargets 和 ui/slotReels.ts。这里只负责抽出这一局
 * 认哪两个图案，抽的规矩在 targets.ts：有些图案互相包含（拼出大的就白送一个
 * 小的），有些是玩家点名不许同时出现的，drawPair 只从合得来的对子里抽。
 *
 * 玩法本身没有新东西：挑完什么就是那个基础玩法，同一副棋盘、同样的滑法、同
 * 样的整行奖励，只有「拼成什么算分」变了。
 */
import { STRINGS, type Lang } from '../i18n';
import { drawPair, type Family, type TargetPattern } from '../engine/targets';
import { ICON_BASE_CIRCLE, ICON_BASE_SQUARE, ICON_BASE_TRIANGLE, ICON_LOCK } from './homeIcons';
import { shapeName } from './shapeLabels';
import { CTL_BACK } from './ctlIcons';

/** 三个基础玩法，和它们在主菜单上的那张图。 */
const FAMILIES: { family: Family; shapeId: string; icon: string }[] = [
  { family: 'square', shapeId: 'square', icon: ICON_BASE_SQUARE },
  { family: 'circle', shapeId: 'circle', icon: ICON_BASE_CIRCLE },
  // 主菜单上的《三角》后面装的是 triangleBig.ts 画的那块整三角，它自己的 id
  // 就叫 'triangle'（两个三角的内容 2026-09 对调过，各自的身份也跟着换了，
  // 见 main.ts 那段注释）。这里要的是玩家看到的那个名字，所以用它。
  { family: 'triangle', shapeId: 'triangle', icon: ICON_BASE_TRIANGLE },
];

export interface RandomTargetHandlers {
  onBack: () => void;
  /** 挑好了，开这一局：这个 family 的基础玩法，认这两个图案。 */
  onStart: (family: Family, targets: TargetPattern[]) => void;
  /** 没开通的人点了那三张图里的任意一张。 */
  onGenius: () => void;
}

/**
 * @param locked 没开通 Slides 天才。页面照样打得开——玩家自己定的规矩：做好
 *   的东西谁都点得进来看，只是玩不了。所以三张图照画，只是压暗、挂锁，按下
 *   去开的是订阅那扇窗而不是一局游戏。不另外加按钮：这一屏只该有一颗键。
 */
export function renderRandomTargetPage(
  root: HTMLElement,
  lang: Lang,
  handlers: RandomTargetHandlers,
  locked: boolean,
): void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page">
      <div class="start-stage">
        <!-- 这一屏上没有那台机器：三张图上下居中占整屏（玩家的原话：「第一
             个界面不要有上方的老虎机标识，剩下的 mode 标识上下居中」）。机器
             只在下一幕、转起来的时候才出现。 -->
        <div class="start-count slot-pick-area">
          <div class="slot-pick-row${locked ? ' slot-pick-row--locked' : ''}" id="slotShapes">
            ${FAMILIES.map(
              (f) => `<button class="slot-pick-opt" data-family="${f.family}"
                              aria-label="${shapeName(lang, f.shapeId, f.family)}">
                        ${f.icon}
                        ${locked ? `<span class="slot-pick-lock">${ICON_LOCK}</span>` : ''}
                      </button>`,
            ).join('')}
          </div>
        </div>
        <div class="start-actions">
          <button class="icon-btn start-act" id="slotBack" aria-label="${s.back}">${CTL_BACK}</button>
        </div>
      </div>
    </div>
  `;

  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.slot-pick-opt'))) {
    btn.addEventListener('click', () => {
      if (locked) return handlers.onGenius();
      const pair = drawPair(btn.dataset.family as Family);
      // 这一族没有能同时成立的两个——不会发生，check-targets 每次都验（真发
      // 生了也不该把人卡在一张按不动的页面上，所以退回上一页）。
      if (!pair) return handlers.onBack();
      handlers.onStart(btn.dataset.family as Family, pair);
    });
  }
  root.querySelector<HTMLButtonElement>('#slotBack')!.addEventListener('click', handlers.onBack);
}
