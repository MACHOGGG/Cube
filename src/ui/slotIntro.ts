/**
 * 《老虎机模式》从个人主页点进来的那一页。
 *
 * 两台机器（方块、小球）上下居中、等距排着，进来就都转着；底下一颗红色
 * 的 STOP，按下去从上到下一台一台停稳，键随即变成绿色的《开始》，再按又转起
 * 来。玩家的原话：「居中等距的竖着排列三个老虎机……下面有一个《stop》红色按
 * 钮，按下的时候三个老虎机逐步停下，然后 stop 改为开始（绿色）然后可以再继续
 * 转动」——他当时说的是三台，因为那会儿有三副基础棋盘；台数跟着 FAMILIES 走
 * （《侵蚀阶梯》v1.2 PR-6 删掉三角之后是两台），「逐台停」那一条不变。
 *
 * 没开通的人看到的就是这一幕，玩不了；开通了的人右下角多一颗《开始 〉》，去
 * 挑图形那一屏（ui/slotMachine.ts）。这几台机器和开局页上那台是同一台（同一张
 * 图、同一套滚筒，见 ui/slotReels.ts），只是这里的转停由这颗键说了算。
 */
import { STRINGS, type Lang } from '../i18n';
import { drawOne, targetsOf, type Family } from '../engine/targets';
import { planFor, slotMachineHtml, spinSlotHeld, type ReelPlan, type SpinHandle } from './slotReels';
import { CTL_BACK } from './ctlIcons';

/** 两族（三角那副基础棋盘 2026-09 删了，见《侵蚀阶梯》v1.2 PR-6）。这一屏摆几台
 *  老虎机就看它，要和 ui/slotMachine.ts 的 FAMILIES 对得上。 */
const FAMILIES: readonly Family[] = ['square', 'circle'];

/** 按下 STOP 之后，第 k 台机器的两个轮子各在多少毫秒后停稳：逐台、逐轮。 */
const stopDelays = (k: number): number[] => [700 + k * 1100, 1200 + k * 1100];

export interface SlotIntroHandlers {
  onBack: () => void;
  /** 右下角那颗《开始 〉》（只有开通了的人才有）：去挑图形那一屏。 */
  onGo: () => void;
}

/**
 * @param locked 没开通 Slides 天才：没有那颗《开始 〉》，其余一样。
 * @returns 拆页面时叫一声，把这几台机器的动画停掉。
 */
export function renderSlotIntroPage(
  root: HTMLElement,
  lang: Lang,
  handlers: SlotIntroHandlers,
  locked: boolean,
): () => void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page slot-intro-page">
      <div class="start-stage slot-intro-stage">
        <div class="slot-intro-stack" id="slotIntroStack">
          ${FAMILIES.map(
            (f) => `<div class="slot-intro-item" data-family="${f}">${slotMachineHtml()}</div>`,
          ).join('')}
        </div>
        <div class="slot-intro-actions">
          <button class="slot-demo-btn slot-demo-btn--stop" id="slotDemoBtn">${s.slotDemoStop}</button>
        </div>
        <button class="icon-btn page-exit" id="slotBack" aria-label="${s.back}">${CTL_BACK}</button>
        ${
          locked
            ? ''
            : `<button class="slot-go" id="slotGo">${s.slotStartLabel}<span class="slot-go-chev" aria-hidden="true">〉</span></button>`
        }
      </div>
    </div>
  `;

  const items = Array.from(root.querySelectorAll<HTMLElement>('.slot-intro-item'));
  const btn = root.querySelector<HTMLButtonElement>('#slotDemoBtn')!;
  let handles: SpinHandle[] = [];
  /** 每台机器上一回的计划：再转的时候从上一回停的那张接着走，不跳。 */
  const plans: ReelPlan[][] = items.map(() => []);
  let settled = 0;
  /** 'spinning' 转着；'stopping' 按了 STOP、还没全停稳；'set' 全停稳了。 */
  let phase: 'spinning' | 'stopping' | 'set' = 'set';

  const paintButton = () => {
    const stop = phase !== 'set';
    btn.textContent = stop ? s.slotDemoStop : s.slotStartLabel;
    btn.className = `slot-demo-btn ${stop ? 'slot-demo-btn--stop' : 'slot-demo-btn--start'}`;
  };

  const spin = () => {
    settled = 0;
    phase = 'spinning';
    paintButton();
    handles = items.map((el, k) => {
      const family = el.dataset.family as Family;
      // 这一屏只是演示：随手抽一个，两个轮子都停在它上面（《侵蚀阶梯》v1.2
      // PR-8，见 slotReels.ts 顶上那段）。一族抽不出来是不会发生的事
      // （check-targets 每次都验）；真发生了就拿头一个顶上，别让这一页空着。
      const target = drawOne(family) ?? targetsOf(family)[0];
      const prev = plans[k];
      const next = planFor(family, target, lang).map((p, i) => ({ ...p, from: prev[i]?.land ?? 0 }));
      plans[k] = next;
      return spinSlotHeld(el, next, () => {
        settled++;
        if (settled < items.length) return;
        phase = 'set';
        paintButton();
      });
    });
  };

  btn.addEventListener('click', () => {
    if (phase === 'stopping') return;
    if (phase === 'spinning') {
      // 逐台停：第一台先停，后面的跟上。
      phase = 'stopping';
      handles.forEach((h, k) => h.stop(stopDelays(k)));
      return;
    }
    spin();
  });
  root.querySelector<HTMLButtonElement>('#slotBack')!.addEventListener('click', handlers.onBack);
  root.querySelector<HTMLButtonElement>('#slotGo')?.addEventListener('click', handlers.onGo);

  spin();
  return () => {
    for (const h of handles) h.cancel();
  };
}
