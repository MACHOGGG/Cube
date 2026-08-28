import { STRINGS, LANG_ORDER, type Lang } from '../i18n';

/** A quick language-switch popup for the bottom nav's language button —
 *  distinct from languageSelect.ts's letter-grid puzzle, which is a
 *  first-run onboarding flow, not something a player should have to
 *  re-solve every time they just want to switch languages. */
export function showLangSwitchModal(current: Lang, onSelect: (lang: Lang) => void): () => void {
  const s = STRINGS[current];
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `
    <div class="modal lang-switch-modal">
      <h2>${s.switchLanguage}</h2>
      <div class="lang-switch-list" id="langSwitchList"></div>
      <div class="btn-row"><button class="secondary" id="langSwitchCloseBtn">✕</button></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  const list = overlay.querySelector<HTMLElement>('#langSwitchList')!;
  for (const l of LANG_ORDER) {
    const btn = document.createElement('button');
    btn.className = 'lang-switch-item' + (l === current ? ' active' : '');
    btn.textContent = STRINGS[l].langName;
    btn.addEventListener('click', () => {
      close();
      if (l !== current) onSelect(l);
    });
    list.appendChild(btn);
  }

  overlay.querySelector<HTMLButtonElement>('#langSwitchCloseBtn')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return close;
}
