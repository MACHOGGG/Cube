/**
 * The single place any usage data leaves this app.
 *
 * Two sinks, both optional and independent:
 *
 * - **Vercel Web Analytics** — cookie-free, no consent banner needed, and it
 *   posts to this site's own origin (/_vercel/insights/*), so it is reachable
 *   from anywhere the game itself is reachable. This is the sink that is
 *   always on in production.
 * - **Google Analytics 4** — richer reports (engagement time, retention
 *   cohorts, funnels), but it loads from googletagmanager.com, which is
 *   blocked in mainland China, and it sets cookies. It only switches on when
 *   VITE_GA_ID is set at build time, and it is loaded `async` with its own
 *   error swallowed, so a blocked or slow request can never delay a frame or
 *   throw into the app.
 *
 * Nothing here can break the game: `report()` swallows everything, and the
 * whole module no-ops off a real https host (the artifact build, a file://
 * copy, and localhost all measure nobody).
 *
 * No personal data is collected — no names, no emails, no free text. Every
 * property below is either a fixed enum from our own code or a number.
 */
import { inject, track } from '@vercel/analytics';

type Props = Record<string, string | number | boolean>;

const FIRST_KEY = 'slides_analytics_first';
const LAST_KEY = 'slides_analytics_last';
const VISITS_KEY = 'slides_analytics_visits';

let enabled = false;
let gaId = '';

/** Only measure where there is an audience: a real https host, not a local or offline copy. */
function isLiveSite(): boolean {
  try {
    const { protocol, hostname } = window.location;
    if (!protocol.startsWith('http')) return false;
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.endsWith('.local');
  } catch {
    return false;
  }
}

function num(key: string): number {
  const v = parseInt(localStorage.getItem(key) || '', 10);
  return Number.isFinite(v) ? v : 0;
}

const DAY = 86_400_000;

/**
 * Sends one event to every configured sink. Deliberately total: an analytics
 * failure must never surface as a broken game, so every path is swallowed.
 */
export function report(name: string, props: Props = {}): void {
  if (!enabled) return;
  try {
    track(name, props);
  } catch {
    /* the insights endpoint is unreachable — not the game's problem */
  }
  if (gaId) {
    try {
      (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', name, props);
    } catch {
      /* gtag queues into dataLayer even before its script lands, so this
         should not throw; if it somehow does, the game carries on. */
    }
  }
}

function loadGoogleAnalytics(id: string): void {
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  // The canonical gtag shim: it pushes the raw `arguments` object, so it has
  // to be a function expression, not an arrow.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag('js', new Date());
  w.gtag('config', id);

  const el = document.createElement('script');
  el.async = true;
  el.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  // Where googletagmanager.com is blocked (mainland China) this request just
  // fails; the queued calls above sit in dataLayer forever and nothing else
  // in the app notices.
  el.onerror = () => {};
  document.head.appendChild(el);
}

/**
 * Boots both sinks and reports the visit itself: which visit number this is
 * for this browser, and how long since the first and the previous one — the
 * raw material for a retention curve, derived entirely from this device's own
 * localStorage rather than from any cross-site identifier.
 */
export function initAnalytics(lang: string): void {
  if (!isLiveSite()) return;
  enabled = true;

  try {
    inject();
  } catch {
    enabled = false;
    return;
  }

  gaId = (import.meta.env.VITE_GA_ID || '').trim();
  if (gaId) {
    try {
      loadGoogleAnalytics(gaId);
    } catch {
      gaId = '';
    }
  }

  const now = Date.now();
  let first = 0;
  let last = 0;
  let visits = 0;
  try {
    first = num(FIRST_KEY) || now;
    last = num(LAST_KEY);
    visits = num(VISITS_KEY) + 1;
    localStorage.setItem(FIRST_KEY, String(first));
    localStorage.setItem(LAST_KEY, String(now));
    localStorage.setItem(VISITS_KEY, String(visits));
  } catch {
    // Private mode with storage blocked: still worth counting the visit,
    // it just always looks like a first one.
    first = now;
    visits = 1;
  }

  report('session_start', {
    visit: visits,
    returning: visits > 1,
    days_since_first: Math.floor((now - first) / DAY),
    days_since_last: last ? Math.floor((now - last) / DAY) : -1,
    lang,
    screen: screenSizeBucket(),
  });

  startDurationTracking();
}

function screenSizeBucket(): string {
  try {
    const w = window.innerWidth;
    if (w < 480) return 'phone';
    if (w < 900) return 'tablet';
    return 'desktop';
  } catch {
    return 'unknown';
  }
}

// --- how long people actually stay -----------------------------------------
// Only *visible* time counts: a tab left open in the background for an hour
// is not an hour of play. Reported once per page load, on the first time the
// page is hidden or torn down — the one moment mobile browsers reliably give
// you before they may never run your code again.

let visibleMs = 0;
let visibleSince = 0;
let screens = 0;
let games = 0;
let durationSent = false;

function startDurationTracking(): void {
  visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;

  const accumulate = () => {
    if (visibleSince) {
      visibleMs += Date.now() - visibleSince;
      visibleSince = 0;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!visibleSince) visibleSince = Date.now();
    } else {
      accumulate();
      flushDuration();
    }
  });
  // pagehide covers the navigations visibilitychange misses (and fires on
  // iOS Safari's back-forward cache, where unload does not).
  window.addEventListener('pagehide', () => {
    accumulate();
    flushDuration();
  });
}

/** Coarse buckets, because a dashboard breakdown by "347 seconds" tells you nothing. */
function durationBucket(sec: number): string {
  if (sec < 10) return '0-10s';
  if (sec < 30) return '10-30s';
  if (sec < 60) return '30-60s';
  if (sec < 180) return '1-3m';
  if (sec < 600) return '3-10m';
  if (sec < 1800) return '10-30m';
  return '30m+';
}

function flushDuration(): void {
  if (durationSent) return;
  durationSent = true;
  const sec = Math.round(visibleMs / 1000);
  report('session_end', {
    seconds: sec,
    bucket: durationBucket(sec),
    screens,
    games,
    played: games > 0,
  });
}

// --- the events themselves --------------------------------------------------

/** Which screen the player moved to. The app has one URL, so this is its page-view. */
export function trackScreen(screen: string): void {
  screens++;
  report('screen_view', { screen });
}

export function trackGameStart(shape: string, mode: string): void {
  games++;
  report('game_start', { shape, mode });
}

export function trackGameEnd(e: {
  shape: string;
  mode: string;
  score: number;
  moves: number;
  seconds: number;
  reason: string;
  hazard: boolean;
}): void {
  report('game_end', {
    shape: e.shape,
    mode: e.mode,
    score: e.score,
    moves: e.moves,
    seconds: e.seconds,
    duration: durationBucket(e.seconds),
    reason: e.reason,
    hazard: e.hazard,
    scored: e.score > 0,
  });
}

export function trackTutorialStart(shape: string): void {
  report('tutorial_start', { shape });
}

/**
 * `finished` separates "watched it through" from "backed out partway", and
 * `beat` says exactly where the ones who left gave up — which beat of a
 * tutorial loses people is the single most actionable number here.
 */
export function trackTutorialEnd(
  shape: string,
  finished: boolean,
  beat: number,
  beats: number,
): void {
  report('tutorial_end', {
    shape,
    finished,
    beat,
    beats,
    progress: beats > 0 ? Math.round((beat / beats) * 100) : 0,
  });
}

export function trackLanguage(lang: string, source: 'auto' | 'switch'): void {
  report('language_set', { lang, source });
}

export function trackShare(source: string): void {
  report('share_open', { source });
}

export function trackIconChange(icon: string): void {
  report('icon_change', { icon });
}
