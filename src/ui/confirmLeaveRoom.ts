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
 * 按住那一套（圆环、时长、键盘直接生效那条无障碍的路、reduced-motion 下退回单击）住在
 * holdToConfirm.ts：10-09 补充方案 7-5 起屋主等待页上那颗「不等了」也用它，两处一份。
 *
 * reduced-motion 下退化成普通的二次确认：单击就生效，圆环不出现。
 */
import { STRINGS, type Lang } from '../i18n';
import { iAmHost } from '../engine/room';
import { pushLayer } from '../engine/backNav';
import { HOLD_RING, holdWanted, wireHold } from './holdToConfirm';

/**
 * @param note 问句上面多说的一行。屋主按了《解散小屋》、服务器那头没办成的时候，把这一问原样再
 *   问一次，这一行写「小屋还没解散」（2026-10-08 方案 2-7）——他还在屋里，再按一次就是。
 */
export function confirmLeaveRoom(lang: Lang, onLeave: () => void, note?: string): void {
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
  const hold = holdWanted();
  overlay.innerHTML = `
    <div class="modal">
      ${note ? `<p class="auth-msg auth-msg--bad leave-note" role="status">${note}</p>` : ''}
      <p class="tag-line">${iAmHost() ? s.mpHostLeaveWarn : s.mpGuestLeaveWarn}</p>
      <div class="btn-row">
        <button class="secondary${hold ? ' leave-hold' : ''}" id="mpLeaveYes"${
          hold ? ` aria-describedby="mpLeaveHint"` : ''
        }>${
          hold ? `${HOLD_RING}<span>${s.mpLeaveHold}</span>` : s.mpLeaveAnyway
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
  if (!hold) yes.addEventListener('click', leave);
  // 按住 600ms 生效；键盘的 Enter／空格按一下就走（无障碍那条路，键上那行辅助文案写着）。
  else wireHold(yes, leave);
  // 点在框外面 = 不走。留下才是这个问题的安全答案，所以它既是主按钮，也是
  // 随手一点的那个答案。
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) shut();
  });
}
