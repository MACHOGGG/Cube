/**
 * 按住生效的键：按住 HOLD_MS，键上的圆环一点点填满，填满才算数；松手、滑出键外、被系统取消，都
 * 算收手——圆环退回零，什么都没发生。
 *
 * 从《离开小屋》那一问里抽出来的（kinetics 方案 §13 的试点，原先整段写在 confirmLeaveRoom.ts
 * 里）。10-09 补充方案 7-5 起屋主等待页上那颗「不等了」也用它：两处的后果都不可逆（座位交回去
 * 了；还没打完的人被替交了卷），又都紧挨着另一颗键，手指滑一下就按到。两处各写一份的话，迟早
 * 一处改了时长、另一处没跟上。
 *
 * **无障碍双通道，这一条是硬要求。** 长按对开关设备、对手不稳的人是不可达的，所以键盘的
 * Enter／空格保留**直接生效**那条路（按一下就算），并且把这件事写进键上那行辅助文案
 * （mpLeaveHoldHint，两处共用：那句话只说「按住这颗键，或按 Enter」，不说按了会怎样）——一颗只
 * 能长按的键对这些玩家等于一扇锁死的门。
 *
 * reduced-motion 下不做长按（holdWanted() 为 false）：那一档里「按住」这件事没有任何可看的进
 * 度（圆环不画），而一个按下去没反应的键是一页上最不该有的东西。那一档由调用的地方照旧接成单击。
 */
import { reducedMotion } from '../engine/reducedMotion';
import { vibrate } from '../engine/haptics';

/** 这一档要不要做「按住」。 */
export const holdWanted = (): boolean => !reducedMotion();

/** 按住多久算数。和 CSS 里那条 transition 的时长（style.css 的 .leave-hold--on）必须是同一个数。 */
export const HOLD_MS = 600;

/**
 * 键上那个圆环，画在字的左边。stroke-dasharray 是量出来的周长（2π·9 ≈ 56.5），填满靠
 * stroke-dashoffset 从 56.5 线性走到 0——老技术，Chrome 61 也认得。
 */
export const HOLD_RING =
  `<svg class="leave-ring" viewBox="0 0 22 22" aria-hidden="true">` +
  `<circle class="leave-ring-track" cx="11" cy="11" r="9" fill="none" stroke-width="2.5"/>` +
  `<circle class="leave-ring-fill" cx="11" cy="11" r="9" fill="none" stroke-width="2.5"/>` +
  `</svg>`;

/**
 * 把一颗键接成「按住生效」。键本身要带 `leave-hold` 这个类（圆环的样式挂在它上面）。
 *
 * 生效一次之后就不再认（免得填满那一下之后手还没松、或者 Enter 连按，同一件事办两次）；办砸了要
 * 再给一次机会的，调返回的那个函数把它重新接上。
 */
export function wireHold(btn: HTMLButtonElement, onDone: () => void): () => void {
  let timer = 0;
  let done = false;
  const stop = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    btn.classList.remove('leave-hold--on');
  };
  const start = (e: PointerEvent) => {
    // 只认主键（鼠标左键／手指／笔）。右键菜单那一下不该开始计时。
    if (e.button !== 0 || done) return;
    btn.classList.add('leave-hold--on');
    // 指针离开按钮、松手、被系统取消，都算收手——圆环 .15s 退回零（CSS 那一头）。
    btn.setPointerCapture?.(e.pointerId);
    timer = window.setTimeout(() => {
      timer = 0;
      done = true;
      // 填满那一下定格震一下。15ms 是「咔」的一声，不是提醒；iOS 的 Safari 没有这个
      // 接口，vibrate 自己吞掉（见 engine/haptics.ts）。
      vibrate(15);
      onDone();
    }, HOLD_MS);
  };
  btn.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    btn.addEventListener(ev, stop);
  }
  /**
   * 键盘那条路：**按一下就算，不用按住。**
   *
   * 这不是图省事，是无障碍的硬要求（见文件头）。用 keydown 而不是 click：按钮的 click 会被空
   * 格／Enter 合成出来，那条路会绕回上面那套按住的逻辑（而它不会被触发，于是变成「按了没反应」）。
   */
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    if (done) return;
    done = true;
    onDone();
  });
  return () => {
    stop();
    done = false;
  };
}
