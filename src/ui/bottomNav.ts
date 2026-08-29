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
let detachScroll: (() => void) | null = null;

/** Wider than this and the bar is simply always there, the way the desktop
 *  reference sheet has it pinned under the grid. Narrower and it stays out of
 *  the way until the player scrolls. */
const WIDE_QUERY = '(min-width: 720px)';

/**
 * The two round entry points that sit under every screen: 个人主页 on the
 * left, 记录与排名 on the right.
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
  detachScroll?.();
  detachScroll = null;

  const s = STRINGS[lang];
  const el = document.createElement('nav');
  el.className = 'home-nav';
  el.innerHTML = `
    <button class="home-nav-btn" id="navProfile" aria-label="${s.navProfile}">${ICON_NAV_PROFILE}</button>
    <button class="home-nav-btn" id="navRecords" aria-label="${s.navRecords}">${ICON_NAV_RECORDS}</button>
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

  const wideMq = window.matchMedia(WIDE_QUERY);
  // On a phone the bar is hidden while the page is sitting at the very top
  // and slides in as soon as the player scrolls — matching the reference
  // sheet, where the resting home screen has no bar and the scrolled one
  // does. A short screen with nothing to scroll would otherwise never be able
  // to reach it, so it is also revealed whenever the page can't scroll at all.
  const sync = () => {
    if (wideMq.matches) {
      el.classList.add('home-nav--shown');
      return;
    }
    const de = document.documentElement;
    const scrollable = de.scrollHeight > de.clientHeight + 8;
    el.classList.toggle('home-nav--shown', !scrollable || window.scrollY > 12);
  };
  sync();
  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  wideMq.addEventListener('change', sync);
  detachScroll = () => {
    window.removeEventListener('scroll', sync);
    window.removeEventListener('resize', sync);
    wideMq.removeEventListener('change', sync);
  };
}

/** Re-checks whether the bar should be showing — call after swapping in a
 *  screen of a different height, since that can change whether the page
 *  scrolls at all. */
export function refreshBottomNav(): void {
  window.dispatchEvent(new Event('resize'));
}

/** Lifts and darkens whichever entry point is open (null puts both back
 *  down). Purely visual — main.ts owns what the second tap actually does. */
export function setActiveNavTab(tab: NavTab): void {
  if (!barEl) return;
  barEl.querySelector('#navProfile')?.classList.toggle('home-nav-btn--active', tab === 'profile');
  barEl.querySelector('#navRecords')?.classList.toggle('home-nav-btn--active', tab === 'records');
}
