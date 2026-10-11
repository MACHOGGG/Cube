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
 *   **而且只在玩家点了「接受」之后才加载**（10-11 方案 A-14，同意记录见 engine/consent.ts）。
 *   原先它开机就加载、一句都不问，可它写的那两个 Cookie（`_ga`、`_ga_<编号>`，各活两年）
 *   按 CNIL 的规定必须先问：没答、答了「拒绝」、或者答复过了期，这一路就一个字节都不发——
 *   脚本不请求，Cookie 不写。主菜单上那张同意条（ui/consentBar.ts）和隐私政策那扇窗顶上的
 *   开关是仅有的两个开口，都走下面的 acceptAnalytics / declineAnalytics。
 *   Vercel 那一路不写 Cookie，不受这一条管，照旧开机就开。
 *
 * Nothing here can break the game: `report()` swallows everything, and the
 * whole module no-ops off a real https host (the artifact build, a file://
 * copy, and localhost all measure nobody).
 *
 * No personal data is collected — no names, no emails, no free text. Every
 * property below is either a fixed enum from our own code or a number.
 */
import { inject, track } from '@vercel/analytics';
import { consentChoice, recordConsent } from './consent';

type Props = Record<string, string | number | boolean>;

const FIRST_KEY = 'slides_analytics_first';
const LAST_KEY = 'slides_analytics_last';
const VISITS_KEY = 'slides_analytics_visits';
const GAMES_KEY = 'slides_analytics_games';

/**
 * 上面那四个计数最长活 13 个月（10-11 方案 A-1）：从 FIRST 记下的那一刻起，满 13 个**日历月**就
 * 四个一起清掉、从头数。
 *
 * 为什么是 13 个月：这四个是 Vercel 那一路（不写 Cookie、不用问）的原料，CNIL 给免同意统计的条件
 * 之一就是追踪器的寿命不超过 13 个月。原先它们一辈子不过期——那这一路严格说也得先问。
 * 按日历月算（setMonth），不按「395 天」这种近似：近似值在某些月份会超出 13 个月几天。
 */
const COUNTER_MONTHS = 13;

let enabled = false;
/** 构建时配的 GA 编号（VITE_GA_ID）。配了不等于在用——在不在用看 gaOn。 */
let gaId = '';
/** gtag 的脚本已经插进页面了（一页里只插一次）。 */
let gaLoaded = false;
/** 这一刻 GA 收不收事件：点过「接受」、而且之后没有撤回。 */
let gaOn = false;

/** Only measure where there is an audience: a real https host, not a local or offline copy. */
export function isLiveSite(): boolean {
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
  if (gaOn) {
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

function configuredGaId(): string {
  return (import.meta.env.VITE_GA_ID || '').trim();
}

/** Google 文档里的停用开关：`window['ga-disable-<编号>'] = true` 之后 gtag 一个请求都不再发。 */
function setGaDisabled(id: string, off: boolean): void {
  try {
    (window as unknown as Record<string, unknown>)['ga-disable-' + id] = off;
  } catch {
    /* 设不上也不该拖垮游戏 */
  }
}

/** 打开 GA：头一次就插脚本，撤回过再打开就只把停用开关拨回去（脚本一页里只插一次）。 */
function startGoogleAnalytics(): void {
  if (!gaId) return;
  setGaDisabled(gaId, false);
  if (!gaLoaded) {
    try {
      loadGoogleAnalytics(gaId);
      gaLoaded = true;
    } catch {
      return;
    }
  }
  gaOn = true;
}

/**
 * 删掉 GA 写下的那两个 Cookie（`_ga`、`_ga_<编号>`）。
 *
 * GA 默认把 Cookie 写在「能写的最上一级域名」上（cookie_domain: 'auto'），所以只删当前域名不够：
 * 在 www.play-slides.com 上，它写的是 .play-slides.com。删法是同名、同 path、同 domain 再写一遍、
 * 过期时间设成过去——domain 对不上的那一份浏览器不认，所以几种写法挨个来一遍：不带 domain（只属于
 * 这个主机的那份）、当前主机、上一级域名。上一级只到「还有两段」为止：com 那一级本来就写不上。
 */
function deleteGaCookies(): void {
  try {
    const host = window.location.hostname;
    const parts = host.split('.');
    const domains = ['', host, '.' + host];
    if (parts.length > 2) {
      const parent = parts.slice(1).join('.');
      domains.push(parent, '.' + parent);
    }
    const names = document.cookie
      .split(';')
      .map((c) => c.split('=')[0].trim())
      .filter((n) => n === '_ga' || n.startsWith('_ga_'));
    for (const name of names) {
      for (const d of domains) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` + (d ? `; domain=${d}` : '');
      }
    }
  } catch {
    /* document.cookie 被禁掉（极少数内嵌浏览器）：那 GA 本来也写不进去 */
  }
}

/**
 * 主菜单同意条和隐私政策那扇窗该不该出现：这一份构建配了 GA，而且跑在线上的网址上。
 * 小红书那一版（这个模块是空替身）、iOS 外壳（isLiveSite 为假）、没配 VITE_GA_ID 的构建都答 false。
 */
export function gaConsentApplies(): boolean {
  return configuredGaId() !== '' && isLiveSite();
}

/** 他点了「接受」（同意条上那一颗，或者隐私政策窗顶上那颗开关拨到开）：记下来，当场加载。 */
export function acceptAnalytics(): void {
  recordConsent('granted');
  // initAnalytics 没走到这一步（不是线上、insights 起不来）就只记答复：这一页本来什么都不发。
  if (!enabled || !gaId) return;
  startGoogleAnalytics();
}

/**
 * 他点了「拒绝」，或者把开关拨到关（撤回）：记下来；已经在跑的那一份当场停掉、Cookie 删掉。
 * 「拒绝」那一路 GA 从来没加载过，停用和删 Cookie 都是空转——同一个函数，省得两条路走散。
 */
export function declineAnalytics(): void {
  recordConsent('denied');
  gaOn = false;
  const id = gaId || configuredGaId();
  if (id) setGaDisabled(id, true);
  deleteGaCookies();
}

/**
 * 四个计数满 13 个日历月就一起清掉（见 COUNTER_MONTHS）。清掉之后这台设备在统计里就是一个
 * 新来的人——这正是「寿命不超过 13 个月」的意思。
 */
function expireCounters(now: number): void {
  try {
    const first = num(FIRST_KEY);
    if (!first) return;
    const until = new Date(first);
    until.setMonth(until.getMonth() + COUNTER_MONTHS);
    if (now < until.getTime()) return;
    for (const k of [FIRST_KEY, LAST_KEY, VISITS_KEY, GAMES_KEY]) localStorage.removeItem(k);
  } catch {
    /* 存储用不了：那这四个本来就没记下 */
  }
}

/**
 * Boots both sinks and reports the visit itself: which visit number this is
 * for this browser, and how long since the first and the previous one — the
 * raw material for a retention curve, derived entirely from this device's own
 * localStorage rather than from any cross-site identifier.
 */
export function initAnalytics(lang: string): void {
  // 过期清零放在「是不是线上」之前：这四个键在哪儿都会被写（bumpLifetimeGames 不看域名），
  // 「最长 13 个月」这句话在哪儿都该成立。
  const now = Date.now();
  expireCounters(now);
  if (!isLiveSite()) return;
  enabled = true;

  try {
    inject();
  } catch {
    enabled = false;
    return;
  }

  gaId = configuredGaId();
  // 只有本机记着「接受」、而且没过期，才加载。没答过的人这一下什么都不发；他在主菜单上点
  // 「接受」的那一刻，acceptAnalytics 当场补上。
  if (gaId && consentChoice(now) === 'granted') startGoogleAnalytics();

  let first = 0;
  let last = 0;
  let visits = 0;
  try {
    first = num(FIRST_KEY) || now;
    last = num(LAST_KEY);
    visits = num(VISITS_KEY) + 1;
    lifetimeGames = num(GAMES_KEY);
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
    // 「来的人」分两种，广告漏斗的第一格问的正是这个：这一次打开之前，这台
    // 设备有没有打过。returning 说的是「来过没有」，这两个不是一回事——看了
    // 一眼就走、第二天又回来的人，returning 是真的，new_player 也还是真的。
    new_player: lifetimeGames === 0,
    games_before: lifetimeGames,
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
/**
 * 这台设备一共开过几局——跨会话算，不是这一次打开。
 *
 * 广告漏斗问的是「进来的人里，有几成真的开了第一局、又有几成把它打完了」，
 * 所以「第一局」必须按设备的一生来算：同一个人第二天回来再打一局，那不是
 * 第一局。上面那个 `games` 数的是这一次打开，两个都要，各答各的问题。
 */
let lifetimeGames = 0;
/**
 * 手上这一局是不是这台设备的第一局。
 *
 * 开局那一刻就定下来，结算时照着报——不在结算时重算：那时候计数器已经加过
 * 一了，重算出来的每一局都不是第一局。
 */
let firstRunOpen = false;
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

/**
 * 记下又开了一局，并回答「这一局是不是这台设备的第一局」。
 *
 * 每次都重新读存储，不信任 initAnalytics 那时候读到的数：init 有两条提前
 * 返回的路（不是线上的域名、insights 起不来），走了那两条 lifetimeGames 就
 * 还是 0——照着它写回去，等于把一个老玩家抹成了新玩家。
 *
 * 存储被禁掉（无痕窗口）时读不到也写不进，于是每一局看上去都是第一局；这
 * 和上面来访计数退化的方式是一致的：宁可多算，也不要漏掉真正的第一局。
 */
function bumpLifetimeGames(): boolean {
  let before = lifetimeGames;
  try {
    before = num(GAMES_KEY);
    localStorage.setItem(GAMES_KEY, String(before + 1));
    // 13 个月那只钟从 FIRST 起算（expireCounters）。线上 initAnalytics 开机就记下它，走不到那
    // 一步的地方（不是线上的域名）计数也在涨，那就从这一局起算——不许有一个没有钟的计数。
    if (!num(FIRST_KEY)) localStorage.setItem(FIRST_KEY, String(Date.now()));
  } catch {
    /* 记不住这台设备打过几局 */
  }
  lifetimeGames = before + 1;
  return before === 0;
}

export function trackGameStart(shape: string, mode: string): void {
  games++;
  firstRunOpen = bumpLifetimeGames();
  report('game_start', { shape, mode, first: firstRunOpen });
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
    // 和 game_start 上那个是同一局的同一个答案，所以「开了第一局的人里有
    // 几成把它打完」这一格，两边的数直接就能相除。
    first: firstRunOpen,
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
