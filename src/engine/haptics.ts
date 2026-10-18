/**
 * Thin, safe wrapper over the Vibration API. Most desktop browsers simply
 * don't implement navigator.vibrate at all, so feature-detecting it also
 * naturally limits this to the mobile devices it's meant for — no separate
 * "is this a phone" check needed. Wrapped in try/catch too since some
 * browsers throw rather than no-op when a page hasn't had a user gesture yet
 * or vibration is blocked by a permissions policy.
 *
 * 振动开关（10-18 补充 M-3）：从前振动不受任何设置管，想关只能静音整台手机。游戏无障碍指南基础级就有一条
 * 「给振动一个开关」。开关在暂停面板里（gameShell.ts 的 #vibrateBtn），只在 canVibrate() 的设备上出现。
 */
const VIBRATE_KEY = 'slides_vibrate';
let vibrateSetting = readVibrate();

function readVibrate(): boolean {
  // 没存过就当开着：和声音同一个口径（juice.ts 的 readSound）。
  try {
    return localStorage.getItem(VIBRATE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function vibrateOn(): boolean {
  return vibrateSetting;
}

export function setVibrateOn(next: boolean): void {
  vibrateSetting = next;
  try {
    localStorage.setItem(VIBRATE_KEY, next ? '1' : '0');
  } catch {
    /* 记不下就只管这一次打开 */
  }
}

/**
 * 这台设备上「振动」那一行要不要出现：有这个接口、而且主要靠手指点（电脑版 Chrome 也有这个函数，但振不了）。
 *
 * 只拿来决定那一行显不显示，**不能拦在 vibrate() 里面**：check-smooth-touch、check-pro-wheel 在电脑、鼠标操作
 * 下装一个记账的桩，拿 vibrate(8) 判「这一步落下了」——按设备拦了，那两道门就什么都收不到。
 */
export function canVibrate(): boolean {
  try {
    return typeof navigator.vibrate === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function vibrate(pattern: number | number[]): void {
  if (!vibrateSetting) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is a nice-to-have; never let it break the game.
  }
}
