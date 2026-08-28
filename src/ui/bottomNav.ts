import { STRINGS, type Lang } from '../i18n';

export interface BottomNavHandlers {
  onHome: () => void;
  onLanguage: () => void;
  onAccount: () => void;
}

const HOME_GLYPH =
  '<svg viewBox="0 0 24 24"><path d="M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const LANG_GLYPH =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12 H21 M12 3 C15 6.5 15 17.5 12 21 M12 3 C9 6.5 9 17.5 12 21" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ACCOUNT_GLYPH =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 20 C4 15.6 7.6 13 12 13 C16.4 13 20 15.6 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

let barEl: HTMLElement | null = null;

/**
 * A persistent frosted-glass tab bar fixed to the viewport bottom, built
 * once and never torn down by the per-screen `root.innerHTML = ...`
 * navigation main.ts otherwise uses — it lives as a sibling of #app,
 * appended straight to <body>, so it survives every screen change. Calling
 * this again (e.g. after switching language, to refresh the language
 * label) just replaces the previous bar in place rather than stacking a
 * second one.
 */
export function mountBottomNav(handlers: BottomNavHandlers, lang: Lang): void {
  barEl?.remove();
  const el = document.createElement('nav');
  el.className = 'bottom-nav';
  el.innerHTML = `
    <button class="bottom-nav-btn" id="bnHome">${HOME_GLYPH}<span>${STRINGS[lang].navHome}</span></button>
    <button class="bottom-nav-btn" id="bnLang">${LANG_GLYPH}<span>${STRINGS[lang].langName}</span></button>
    <button class="bottom-nav-btn" id="bnAccount">${ACCOUNT_GLYPH}<span>${STRINGS[lang].navAccount}</span></button>
  `;
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('#bnHome')!.addEventListener('click', handlers.onHome);
  el.querySelector<HTMLButtonElement>('#bnLang')!.addEventListener('click', handlers.onLanguage);
  el.querySelector<HTMLButtonElement>('#bnAccount')!.addEventListener('click', handlers.onAccount);
  barEl = el;
}
