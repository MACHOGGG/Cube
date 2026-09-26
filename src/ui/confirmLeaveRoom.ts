/**
 * 「真的要走吗？」——交座位之前问的那一句。
 *
 * 现在有四个地方能离开一间房：房间页、结算页、游戏进行中那一排、以及屋主被
 * 送回主菜单挑下一局时顶上那条横幅。四处问的是同一件事，所以只写一遍——散
 * 在各处的确认框迟早会各自漂走，有的问、有的不问，有的还拿屋主那句话去吓
 * 客人。
 *
 * 说的话分两种，因为后果本来就是两种：屋主一走，整桌都开不了下一局；客人
 * 走了，别人接着玩。
 *
 * **《还是离开》改成按住 600ms 生效**（kinetics 方案 §13 的试点，重开确认那一处等这一
 * 处的真机反馈再定）。理由是这颗键的后果不可逆：座位交回去了，这一局的分也就没了，而它
 * 紧挨着《留下》——手指滑一下就按到另一颗。按住这段时间里键上的圆环一点点填满，松手就
 * 退回去，所以「我按错了」永远来得及收手。
 *
 * **无障碍双通道，这一条是硬要求。** 长按对开关设备、对手不稳的人是不可达的，所以键盘
 * 的 Enter／空格保留**直接生效**那条路（按一下就走），并且把这件事写进键上那行辅助文案
 * ——一颗只能长按的键对这些玩家等于一扇锁死的门。
 *
 * reduced-motion 下退化成普通的二次确认：单击就生效，圆环不出现。那一档里「按住」这件
 * 事没有任何可看的进度，而一个按下去没反应的键是这一页最不该有的东西。
 */
import { STRINGS, type Lang } from '../i18n';
import { iAmHost } from '../engine/room';
import { pushLayer } from '../engine/backNav';
import { reducedMotion } from '../engine/reducedMotion';
import { vibrate } from '../engine/haptics';

export function confirmLeaveRoom(lang: Lang, onLeave: () => void): void {
  const s = STRINGS[lang];
  const overlay = document.createElement('div');
  // overlay--top（z-index 120）不是装饰，是这颗问句能不能被看见的全部。
  //
  // 光写 .overlay 是 z-index 90，而交卷之后那张等待页是 .overlay--wait，
  // 100，还是不透明的。于是在等待页上按《离开小屋》，这一框确确实实建出来
  // 了、也确确实实在监听，只是整个压在那层不透明的底下——玩家看到的是「按
  // 了没反应」。等所有人都打完、等待页撤掉，它才忽然冒出来。
  //
  // 这句问话能从四个地方问出来（小屋页、结算页、局中那一排、屋主那条横幅），
  // 所以它不该去猜自己盖在谁上面，直接钉在最上层。
  overlay.className = 'overlay show overlay--top';
  overlay.id = 'leaveRoomConfirm';
  // reduced-motion 下不做长按：那一档里按住这件事没有任何可看的进度（圆环不画），
  // 而一个按下去没反应的键是这一页最不该有的东西。单击就生效，和从前一样。
  const hold = !reducedMotion();
  overlay.innerHTML = `
    <div class="modal">
      <p class="tag-line">${iAmHost() ? s.mpHostLeaveWarn : s.mpGuestLeaveWarn}</p>
      <div class="btn-row">
        <button class="secondary${hold ? ' leave-hold' : ''}" id="mpLeaveYes"${
          hold ? ` aria-describedby="mpLeaveHint"` : ''
        }>${
          hold
            ? // 圆环画在字的左边。stroke-dasharray 是量出来的周长（2π·9 ≈ 56.5），
              // 填满靠 stroke-dashoffset 从 56.5 线性走到 0——老技术，Chrome 61 也认得。
              `<svg class="leave-ring" viewBox="0 0 22 22" aria-hidden="true">` +
              `<circle class="leave-ring-track" cx="11" cy="11" r="9" fill="none" stroke-width="2.5"/>` +
              `<circle class="leave-ring-fill" cx="11" cy="11" r="9" fill="none" stroke-width="2.5"/>` +
              `</svg><span>${s.mpLeaveHold}</span>`
            : s.mpLeaveAnyway
        }</button>
        <button class="primary" id="mpLeaveNo">${s.mpStay}</button>
      </div>
      ${hold ? `<p class="hint leave-hold-hint" id="mpLeaveHint">${s.mpLeaveHoldHint}</p>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  const shut = () => overlay.remove();
  // 手机的返回键：等于「留下」。
  pushLayer(shut, overlay);
  overlay.querySelector<HTMLButtonElement>('#mpLeaveNo')!.addEventListener('click', shut);

  const yes = overlay.querySelector<HTMLButtonElement>('#mpLeaveYes')!;
  const leave = () => {
    shut();
    onLeave();
  };
  if (!hold) {
    yes.addEventListener('click', leave);
  } else {
    /** 按住多久算数。和 CSS 里那条 transition 的时长必须是同一个数。 */
    const HOLD_MS = 600;
    let timer = 0;
    let done = false;
    const stop = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      yes.classList.remove('leave-hold--on');
    };
    const start = (e: PointerEvent) => {
      // 只认主键（鼠标左键／手指／笔）。右键菜单那一下不该开始计时。
      if (e.button !== 0 || done) return;
      yes.classList.add('leave-hold--on');
      // 指针离开按钮、松手、被系统取消，都算收手——圆环 .15s 退回零（CSS 那一头）。
      yes.setPointerCapture?.(e.pointerId);
      timer = window.setTimeout(() => {
        done = true;
        // 填满那一下定格震一下。15ms 是「咔」的一声，不是提醒；iOS 的 Safari 没有这个
        // 接口，vibrate 自己吞掉（见 engine/haptics.ts）。
        vibrate(15);
        leave();
      }, HOLD_MS);
    };
    yes.addEventListener('pointerdown', start);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      yes.addEventListener(ev, stop);
    }
    /**
     * 键盘那条路：**按一下就走，不用按住。**
     *
     * 这不是图省事，是无障碍的硬要求——长按对开关设备、对手不稳的人不可达，只留长按等
     * 于把这扇门对他们锁死。键上那行辅助文案写着这件事（mpLeaveHoldHint）。
     *
     * 用 keydown 而不是 click：按钮的 click 会被空格／Enter 合成出来，那条路会绕回上面
     * 那套按住的逻辑（而它不会被触发，于是变成「按了没反应」）。
     */
    yes.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      if (done) return;
      done = true;
      leave();
    });
  }
  // 点在框外面 = 不走。留下才是这个问题的安全答案，所以它既是主按钮，也是
  // 随手一点的那个答案。
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) shut();
  });
}
