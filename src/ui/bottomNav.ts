import { STRINGS, type Lang } from '../i18n';
import { ICON_NAV_PROFILE, ICON_NAV_RECORDS } from './homeIcons';

export interface BottomNavHandlers {
  onProfile: () => void;
  onRecords: () => void;
}

/** Which of the two entry points the app is currently showing, so the bar can
 *  lift that icon and so tapping it again reads as "close this" rather than
 *  "open the thing I'm already looking at". */
export type NavTab = 'profile' | 'records' | null;

let barEl: HTMLElement | null = null;

/**
 * The two round entry points that sit under every screen: 个人主页 on the
 * left, 记录与排名 on the right.
 *
 * They sit on a small rounded dock of their own and stay on screen at all
 * times — the bar used to slide away whenever a phone was scrolled to the
 * top, which meant the two entry points were missing exactly when a player
 * first landed on the page.
 *
 * It is appended straight to <body>, a sibling of #app rather than a child,
 * so it survives every `root.innerHTML = ...` screen swap main.ts does — the
 * app has no partial-redraw hook, so anything meant to outlive a screen has
 * to live outside the screen's own container. Calling this again (after a
 * language switch, say) replaces the previous bar rather than stacking a
 * second one.
 */
export function mountBottomNav(handlers: BottomNavHandlers, lang: Lang): void {
  barEl?.remove();

  const s = STRINGS[lang];
  const el = document.createElement('nav');
  el.className = 'home-nav';
  el.innerHTML = `
    <div class="home-nav-dock">
      <button class="home-nav-btn" id="navProfile" aria-label="${s.navProfile}"><span class="home-nav-art">${ICON_NAV_PROFILE}</span></button>
      <button class="home-nav-btn" id="navRecords" aria-label="${s.navRecords}"><span class="home-nav-art">${ICON_NAV_RECORDS}</span></button>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('#navProfile')!.addEventListener('click', handlers.onProfile);
  el.querySelector<HTMLButtonElement>('#navRecords')!.addEventListener('click', handlers.onRecords);
  for (const btn of el.querySelectorAll<HTMLElement>('.home-nav-btn')) {
    btn.addEventListener('pointerdown', () => {
      btn.classList.remove('home-tap');
      void btn.offsetWidth;
      btn.classList.add('home-tap');
    });
    btn.addEventListener('animationend', () => btn.classList.remove('home-tap'));
  }
  barEl = el;
}

/** Kept as a no-op so the screens can keep calling it: the bar used to hide
 *  itself at the top of a phone screen and had to be re-checked after every
 *  screen swap. It is simply always there now. */
export function refreshBottomNav(): void {}

/** Lifts and darkens whichever entry point is open (null puts both back
 *  down). Purely visual — main.ts owns what the second tap actually does. */
export function setActiveNavTab(tab: NavTab): void {
  if (!barEl) return;
  barEl.querySelector('#navProfile')?.classList.toggle('home-nav-btn--active', tab === 'profile');
  barEl.querySelector('#navRecords')?.classList.toggle('home-nav-btn--active', tab === 'records');
}
