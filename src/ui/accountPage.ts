import { STRINGS, PRIVILEGES, type Lang } from '../i18n';
import { RULES } from '../rules';
import { APP_ICONS, applyAppIcon, loadAppIcon, saveAppIcon } from './appIcons';
import { trackIconChange } from '../engine/analytics';

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

/**
 * 个人主页 — one destination for everything that isn't a game, laid out the
 * way the design sheet has it: the Slides masthead, a wide sign-in pill, the
 * language and tutorial pair, then the 天才特供 panel holding the perks that
 * aren't built yet, and 返回 closing the page.
 *
 * Sign-up / log-in lives in a popup off the 登录通道 pill rather than as tabs
 * pinned to the top of the page, so the page itself stays a clean stack of
 * destinations.
 */
export function renderAccountPage(
  container: HTMLElement,
  initialTab: AuthTab,
  handlers: ProfileHandlers,
  lang: Lang,
) {
  const s = STRINGS[lang];
  const privileges = PRIVILEGES[lang];
  const lockedRow = (label: string) =>
    `<div class="profile-row profile-row--locked">` +
    `<span class="profile-row-glyph profile-row-glyph--lock">${LOCK_GLYPH}</span>` +
    `<span class="profile-row-label">${label}</span>` +
    `<span class="profile-row-value">${s.comingSoon}</span></div>`;

  container.innerHTML = `
    <div class="app profile-page">
      <header class="home-head">
        <h1 class="home-title">Slides</h1>
        <p class="home-sub">${s.homeTagline}</p>
      </header>

      <button class="profile-pill profile-pill--wide" id="loginBtn">${s.loginGateway}</button>
      <div class="profile-pill-row">
        <button class="profile-pill" id="langRow">${s.switchLanguage}</button>
        <button class="profile-pill profile-pill--rose" id="howToRow">${s.tutorialShort}</button>
      </div>
      <button class="profile-pill profile-pill--wide" id="rulesRow">${s.rulesPill}</button>
      <button class="profile-pill profile-pill--wide" id="iconRow">${s.iconPill}</button>

      <section class="genius-panel">
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
        ${privileges.map(lockedRow).join('')}
      </section>

      <button class="profile-row" id="contactRow">
        <span class="profile-row-label">${s.contactUs}</span>
        <span class="profile-row-value">›</span>
      </button>
      <button class="profile-row profile-row--back" id="backBtn">${s.back}</button>
    </div>
  `;

  /** The sign-up / log-in popup: the same two tabs as before, now opened from
   *  the 登录通道 pill (and from 成为 Slides 天才, on its sign-up tab). */
  function openAuth(tab: AuthTab) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal auth-modal">
        <div class="auth-tabs">
          <button class="auth-tab" data-tab="register">${s.tabRegister}</button>
          <button class="auth-tab" data-tab="login">${s.tabLogin}</button>
        </div>
        <div class="auth-body"><p class="tag-line">${s.accountComingSoon}</p></div>
        <div class="btn-row"><button class="primary" id="authClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const tabs = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.auth-tab'));
    const setTab = (t: AuthTab) => {
      for (const el of tabs) el.classList.toggle('active', el.dataset.tab === t);
    };
    for (const el of tabs) el.addEventListener('click', () => setTab(el.dataset.tab as AuthTab));
    setTab(tab);
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#authClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 游戏规则 — the whole rulebook, in the player's own language. It used to
   *  be two long Chinese paragraphs pinned under every board; here it is one
   *  scrollable panel a player opens when they actually want it. */
  function openRules() {
    const book = RULES[lang];
    const list = (items: typeof book.general) =>
      items
        .map((r) => `<div class="rule-item"><b>${r.term}</b><span>${r.body}</span></div>`)
        .join('');
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal rules-modal">
        <h2>${book.title}</h2>
        <div class="rules-body">
          <div class="menu-section-label">${book.generalHeading}</div>
          ${list(book.general)}
          <div class="menu-section-label">${book.modesHeading}</div>
          ${list(book.modes)}
        </div>
        <div class="btn-row"><button class="primary" id="rulesClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#rulesClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 更换图标 — the icon on the browser tab. Picking one swaps it there and
   *  then, and the choice is remembered, so a player sees their own tab icon
   *  on every later visit. */
  function openIconPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal icon-modal">
        <h2>${s.iconTitle}</h2>
        <p>${s.iconHint}</p>
        <div class="icon-grid">
          ${APP_ICONS.map(
            (i) => `<button class="icon-opt" data-icon="${i.id}">${i.svg}</button>`,
          ).join('')}
        </div>
        <div class="btn-row"><button class="primary" id="iconClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const opts = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.icon-opt'));
    const mark = (id: string) => {
      for (const el of opts) el.classList.toggle('icon-opt--on', el.dataset.icon === id);
    };
    mark(loadAppIcon());
    for (const el of opts) {
      el.addEventListener('click', () => {
        const id = el.dataset.icon!;
        saveAppIcon(id);
        applyAppIcon(id);
        trackIconChange(id);
        mark(id);
      });
    }
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#iconClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 联系我们 — the destination has nothing in it yet, so the link opens an
   *  empty panel rather than pretending to have content. */
  function openContact() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${s.contactUs}</h2>
        <div class="contact-empty"></div>
        <div class="btn-row"><button class="primary" id="contactClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#contactClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  const on = (id: string, fn: () => void) =>
    container.querySelector<HTMLButtonElement>('#' + id)?.addEventListener('click', fn);
  on('loginBtn', () => openAuth(initialTab));
  on('langRow', handlers.onSwitchLanguage);
  on('rulesRow', openRules);
  on('iconRow', openIconPicker);
  on('howToRow', handlers.onHowToSlide);
  on('randomRow', handlers.onRandomTarget);
  on('multiRow', handlers.onMultiplayer);
  on('becomeGeniusBtn', () => openAuth('register'));
  on('contactRow', openContact);
  on('backBtn', handlers.onBack);
}
