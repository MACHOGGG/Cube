/**
 * 《再来一局》之前问的那一句。
 *
 * 为什么要问：这一颗把手上打了一半的局丢掉，而它就摆在暂停面板里、紧挨着
 * 《结束游戏》——一个想交卷的人很容易按到旁边那一颗，按下去分数连同这一局
 * 一起没了，没有一步能退回来。全站的规矩是「不要让玩家出现意料之外的疏漏
 * 操作」，所以这儿多问一句。
 *
 * 《结束游戏》不问：它把这一局交出去结算，分数留着，本来就是他要的结果。
 *
 * 问的这几秒钟不必再停表——按到这儿的人本来就在暂停里，表早停住了。
 */
import { STRINGS, type Lang } from '../i18n';
import { pushLayer } from '../engine/backNav';

export function confirmRestart(lang: Lang, onYes: () => void): void {
  const s = STRINGS[lang];
  const overlay = document.createElement('div');
  // opaque：和《完成了吗？》同一张脸，盖住底下那层暂停面板。
  overlay.className = 'overlay opaque show';
  overlay.id = 'restartConfirm';
  overlay.innerHTML = `
    <div class="modal">
      <p class="tag-line">${s.restartConfirm}</p>
      <div class="btn-row">
        <button class="secondary" id="restartYes">${s.endRunYes}</button>
        <button class="primary" id="restartNo">${s.endRunNo}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // 手机的返回键：等于「否」，回到暂停面板。
  pushLayer(() => overlay.remove(), overlay);
  overlay.querySelector<HTMLButtonElement>('#restartNo')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector<HTMLButtonElement>('#restartYes')!.addEventListener('click', () => {
    overlay.remove();
    onYes();
  });
}
