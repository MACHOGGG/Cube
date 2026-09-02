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
 */
import { STRINGS, type Lang } from '../i18n';
import { iAmHost } from '../engine/room';

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
  overlay.innerHTML = `
    <div class="modal">
      <p class="tag-line">${iAmHost() ? s.mpHostLeaveWarn : s.mpGuestLeaveWarn}</p>
      <div class="btn-row">
        <button class="secondary" id="mpLeaveYes">${s.mpLeaveAnyway}</button>
        <button class="primary" id="mpLeaveNo">${s.mpStay}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const shut = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>('#mpLeaveNo')!.addEventListener('click', shut);
  overlay.querySelector<HTMLButtonElement>('#mpLeaveYes')!.addEventListener('click', () => {
    shut();
    onLeave();
  });
  // 点在框外面 = 不走。留下才是这个问题的安全答案，所以它既是主按钮，也是
  // 随手一点的那个答案。
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) shut();
  });
}
