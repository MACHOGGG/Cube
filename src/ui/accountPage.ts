import { STRINGS, PRIVILEGES, type Lang } from '../i18n';

export type AuthTab = 'register' | 'login';

const LOCK_GLYPH =
  '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11 V8 a4 4 0 0 1 8 0 v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** The account/sign-in page and the "天才入口" privileges list, merged into
 *  one destination — reachable from the home page's avatar/exclusive-pill
 *  buttons and the bottom nav's account tab alike, rather than being two
 *  separate screens a player has to know to look for individually. */
export function renderAccountPage(container: HTMLElement, initialTab: AuthTab, onBack: () => void, lang: Lang) {
  const s = STRINGS[lang];
  const privileges = PRIVILEGES[lang];
  container.innerHTML = `
    <div class="app">
      <h1>${s.accountTitle}</h1>
      <div class="auth-tabs">
        <button class="auth-tab" data-tab="register">${s.tabRegister}</button>
        <button class="auth-tab" data-tab="login">${s.tabLogin}</button>
      </div>
      <div class="auth-body">
        <p class="tag-line">${s.accountComingSoon}</p>
      </div>

      <hr class="menu-divider" />

      <div class="menu-section-label">${s.geniusPrivilegesTitle}</div>
      <div class="privilege-list">
        ${privileges.map((p) => `<div class="privilege-item"><span class="glyph">${LOCK_GLYPH}</span><span class="label">${p}</span></div>`).join('')}
        <div class="privilege-item soon">${s.privilegesSoon}</div>
      </div>
      <button class="home-how-to" id="becomeGeniusBtn">${s.becomeGenius}</button>

      <div class="controls">
        <button class="icon-btn" id="backBtn">${s.back}</button>
      </div>
    </div>
  `;

  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.auth-tab'));
  function setTab(tab: AuthTab) {
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === tab);
  }
  for (const t of tabs) {
    t.addEventListener('click', () => setTab(t.dataset.tab as AuthTab));
  }
  setTab(initialTab);

  container.querySelector<HTMLButtonElement>('#becomeGeniusBtn')?.addEventListener('click', () => setTab('register'));
  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}
