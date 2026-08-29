import { STRINGS, PRIVILEGES, type Lang } from '../i18n';

export type AuthTab = 'register' | 'login';

export interface ProfileHandlers {
  onBack: () => void;
  /** Opens the quick language-switch popup. */
  onSwitchLanguage: () => void;
  onHowToSlide: () => void;
  onRandomTarget: () => void;
  onMultiplayer: () => void;
}

const LOCK_GLYPH =
  '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11 V8 a4 4 0 0 1 8 0 v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const GLOBE_GLYPH =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12 H21 M12 3 C15 6.5 15 17.5 12 21 M12 3 C9 6.5 9 17.5 12 21" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

/**
 * 个人主页 — one destination for everything that isn't a game: sign-in, the
 * Slides Genius perk list, the language setting, the tutorial replay, and the
 * modes that aren't built yet.
 *
 * The redesigned home page is pure game icons with no room for any of that,
 * so this is where those entries moved rather than being dropped.
 */
export function renderAccountPage(
  container: HTMLElement,
  initialTab: AuthTab,
  handlers: ProfileHandlers,
  lang: Lang,
) {
  const s = STRINGS[lang];
  const privileges = PRIVILEGES[lang];
  container.innerHTML = `
    <div class="app">
      <h1>${s.navProfile}</h1>
      <div class="auth-tabs">
        <button class="auth-tab" data-tab="register">${s.tabRegister}</button>
        <button class="auth-tab" data-tab="login">${s.tabLogin}</button>
      </div>
      <div class="auth-body">
        <p class="tag-line">${s.accountComingSoon}</p>
      </div>

      <button class="profile-row" id="langRow">
        <span class="profile-row-glyph">${GLOBE_GLYPH}</span>
        <span class="profile-row-label">${s.switchLanguage}</span>
        <span class="profile-row-value">${s.langName}</span>
      </button>
      <button class="profile-row" id="howToRow">
        <span class="profile-row-label">${s.howToBtn}</span>
        <span class="profile-row-value">›</span>
      </button>

      <hr class="menu-divider" />

      <div class="menu-section-label">${s.geniusSpecialTitle}</div>
      <button class="genius-cta" id="becomeGeniusBtn">${s.becomeGenius}</button>
      <button class="profile-row" id="randomRow">
        <span class="profile-row-label">${s.randomTargetTitle}</span>
        <span class="profile-row-value">${s.comingSoon}</span>
      </button>
      <button class="profile-row" id="multiRow">
        <span class="profile-row-label">${s.multiplayerTitle}</span>
        <span class="profile-row-value">${s.comingSoon}</span>
      </button>
      ${privileges
        .map(
          (p) =>
            `<div class="profile-row profile-row--locked">` +
            `<span class="profile-row-glyph profile-row-glyph--lock">${LOCK_GLYPH}</span>` +
            `<span class="profile-row-label">${p}</span>` +
            `<span class="profile-row-value">${s.comingSoon}</span></div>`,
        )
        .join('')}

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

  const on = (id: string, fn: () => void) =>
    container.querySelector<HTMLButtonElement>('#' + id)?.addEventListener('click', fn);
  on('langRow', handlers.onSwitchLanguage);
  on('howToRow', handlers.onHowToSlide);
  on('randomRow', handlers.onRandomTarget);
  on('multiRow', handlers.onMultiplayer);
  on('becomeGeniusBtn', () => setTab('register'));
  on('backBtn', handlers.onBack);
}
