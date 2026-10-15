/**
 * 「登录后打的每一局都会存到云端，换设备也找得回。」——主屏版、iOS 浏览器里没登录的人，说一句（10-11 方案
 * B-14，玩家已拍板）。
 *
 * ── 为什么要说 ────────────────────────────────────────────────
 *
 * iOS 上「添加到主屏幕」的那一版和 Safari 的存储是分开的；Safari 七天不和网站互动，就会把脚本写下的存储清掉
 * （WebKit 有意这么设计）。没登录的人换台设备、清一次浏览器、或者只是一个多星期没打开，战绩就没了——而屏幕
 * 上从来没人告诉过他。这句话照实说：只有登录**之后**打的局才会上云（之前那些不会自己补上去）。
 *
 * ── 什么时候说（都要求「没登录」） ─────────────────────────────────
 *
 *   · 主屏版（`display-mode: standalone`，或者 iOS 的 `navigator.standalone`）：一直说；
 *   · iOS 浏览器里（不是主屏版）：本机已经有 ≥3 局才说——头两局还没什么可丢的，一上来就说是噪音；
 *   · 别的地方一律不说（电脑、安卓浏览器的存储不会自己清掉）。
 *
 * iOS 上的浏览器都是 WebKit（Chrome、Firefox 也是），一样会被清，所以不分是不是 Safari。iPadOS 13 起 iPad 报
 * 自己是 Mac（`MacIntel`），能触摸的 Mac 只有它。
 *
 * ── 说在哪儿 ──────────────────────────────────────────────────
 *
 * 记录页顶上一行小字＋一颗《登录》；结算页三颗键上面一行（**每天最多一次**，记在本机的 HINT_DAY_KEY 里）。不弹
 * 窗（站点原则：少文字、不出现意料之外的界面）。
 */

/** 结算页那一句上一次是哪一天说的（本机日期 YYYY-MM-DD）。隐私政策《只存在您自己设备上的》「进度」那一类里写着。 */
export const HINT_DAY_KEY = 'slides_signin_hint_day';

/** 加到主屏幕的那一版：独立窗口显示，或者 iOS 的 navigator.standalone。 */
export function isStandalone(): boolean {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* 老浏览器认不得这一条媒体查询：当它不是 */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone / iPod / iPad（iPadOS 13 起 iPad 报自己是 Mac：MacIntel ＋ 能触摸）。 */
export function isIOS(): boolean {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * 该不该说：没登录；主屏版一直说，iOS 浏览器里本机已有 ≥3 局才说。
 *
 * 本机几局是**要用时才数**的（`localRuns` 是个函数，10-15 补充 S8）：数一次要把全部本机战绩 JSON.parse 一遍
 * （500 局、18 本共 1.6MB，6× 降速实测 8–111ms），而原先每一局结算都先数完再进来——已登录的人、主屏版、安卓，
 * 根本用不着这个数的人也数。
 */
export function wantsSignInHint(signedIn: boolean, localRuns: () => number): boolean {
  if (signedIn) return false;
  if (isStandalone()) return true;
  return isIOS() && localRuns() >= 3;
}

/** 本机日期（不是 UTC）：玩家说的「今天」是他手机上的今天。 */
function dayOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 结算页那一句今天说过没有。存储用不了（无痕窗口）就当没说过——宁可多说一次，也比一直不说强。 */
export function endHintShownToday(now: Date = new Date()): boolean {
  try {
    return localStorage.getItem(HINT_DAY_KEY) === dayOf(now);
  } catch {
    return false;
  }
}

/** 记下结算页那一句今天说过了。 */
export function markEndHintShown(now: Date = new Date()): void {
  try {
    localStorage.setItem(HINT_DAY_KEY, dayOf(now));
  } catch {
    /* 记不住：明天之前可能再说一次，不要紧 */
  }
}
