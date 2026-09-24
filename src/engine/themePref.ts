/**
 * 界面的明暗：米白（默认）和深紫（Slides 天才才挑得动）。
 *
 * 样式本来就有两套（style.css 顶上那两块 `:root`），从前是**跟着系统走**的：手机
 * 开了深色模式，这个网站就自己变深色。玩家 2026-09 定的规矩不一样——「默认是白色
 * 米白的系统，如果是 slides 天才可以解锁选择暗色系统（深紫色）」。两件事因此都要
 * 改：
 *
 *   · 默认那一套不再由手机决定。`index.html` 的 <html> 上直接写着
 *     `data-theme="light"`，所以**第一帧**就是米白的——写在 HTML 里而不是等这个
 *     模块跑起来再盖，是因为那中间隔着解析和下载 JS 的几百毫秒，深色模式的手机会
 *     先闪一下深紫。CSS 那两块的写法（`:root:not([data-theme="light"])` 才跟系统
 *     走）正好配合：属性一挂上，系统偏好就再也说不上话。
 *   · 深紫是权益，所以它跟着 `isGenius()` 走，不只是跟着这儿存的那一格走。订阅过
 *     期、退订、换了一台没登录的设备——下次画出来就是米白，不需要谁去清这一格。
 *     他的选择照旧存着，重新开通当场回到深紫。
 *
 * 和 palettePref 一样：存一格、往 <html> 上盖一个属性、通知在看的人。判定只写一
 * 遍（下面的 `theme()`），别处一律问它。
 */
import { isGenius, onGeniusChange } from './subscription';

export type Theme = 'light' | 'dark';

const KEY = 'slides_theme';
type Listener = () => void;

const listeners = new Set<Listener>();
let picked: Theme = read();

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    // 无痕模式：这一格读不到就是默认那一套，不影响别的。
    return 'light';
  }
}

/**
 * 玩家自己挑的那一套（哪怕现在没权限用）。
 *
 * 挑选窗口里打勾的是这个，不是 `theme()`：没开通的人看到的是「我挑的是米白」，
 * 而不是「系统把我按回了米白」——后者会让他以为自己点的那一下没生效。
 */
export function pickedTheme(): Theme {
  return picked;
}

/** 现在**实际**用着的那一套。深紫要有权限，没权限一律米白。 */
export function theme(): Theme {
  return picked === 'dark' && isGenius() ? 'dark' : 'light';
}

/** 把它盖到 <html> 上，样式表跟着走。 */
function paint(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme());
}
paint();

// 权限一变（登录、兑码、退订、令牌过期）就重画一次：深紫是权益，过期了要自己退
// 回米白。不接这一条的话，过期的人会一直深紫到下一次刷新页面。
onGeniusChange(paint);

export function setTheme(next: Theme): void {
  if (next === picked) return;
  picked = next;
  try {
    localStorage.setItem(KEY, picked);
  } catch {
    /* 无痕模式：这一次会话里照样生效，只是活不到下一次 */
  }
  paint();
  for (const fn of Array.from(listeners)) fn();
}

/** 订阅变化；调用返回的那个函数取消。 */
export function onThemeChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 挑选窗口里那两条色带。
 *
 * **必须和 style.css 里那两块 `:root` 一致**——那边是真的样式，这边只是画给玩家
 * 看的说明。两处写同一组颜色本来是会走散的，所以 `scripts/check-theme.mjs` 里有
 * 一条门：它把属性真的盖上去，读 `getComputedStyle` 拿到的 `--bg` 等四支，和这儿
 * 逐支比。改了那边忘了这边，门当场红。
 *
 * 四支是「底色、卡片、字、强调色」——一套配色最先被认出来的就是这四样。
 */
export const THEME_SWATCH: Record<Theme, readonly string[]> = {
  light: ['#FAF6EC', '#FFFFFF', '#2E2430', '#BE5762'],
  dark: ['#1E1820', '#2B222D', '#F2EAEE', '#E68F98'],
};
