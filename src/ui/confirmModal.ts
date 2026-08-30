import { STRINGS, type Lang } from '../i18n';

/**
 * A small yes/no gate, used wherever leaving a screen would throw away a run
 * in progress: the title, the two bottom-nav entries, and the game page's own
 * 结束 button all pass through here first.
 *
 * It mounts on <body> rather than inside #app, because the thing it is
 * guarding is usually a screen swap that replaces #app's contents — a dialog
 * living inside the outgoing screen would be torn down by the very action it
 * is asking about.
 */
export function confirmEndRun(lang: Lang, onYes: () => void): void {
  const s = STRINGS[lang];
  const wrap = document.createElement('div');
  wrap.className = 'confirm-scrim';
  wrap.innerHTML = `
    <div class="confirm-box" role="dialog" aria-modal="true" aria-label="${s.endRunTitle}">
      <p class="confirm-q">${s.endRunTitle}</p>
      <div class="confirm-row">
        <button class="icon-btn confirm-yes">${s.endRunYes}</button>
        <button class="icon-btn confirm-no">${s.endRunNo}</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  wrap.querySelector<HTMLButtonElement>('.confirm-no')!.addEventListener('click', close);
  wrap.querySelector<HTMLButtonElement>('.confirm-yes')!.addEventListener('click', () => {
    close();
    onYes();
  });
  // Tapping the scrim is the same as 否 — the safe answer, never the one that
  // discards the run.
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  requestAnimationFrame(() => wrap.classList.add('confirm-scrim--in'));
  wrap.querySelector<HTMLButtonElement>('.confirm-no')!.focus();
}
