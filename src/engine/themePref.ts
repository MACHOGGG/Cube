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
/**
 * **上一次真正画出来的**那一套（不是他挑的那一套）。
 *
 * 只给 index.html 头上那一小段脚本用：它在页面第一帧之前读这一格，直接把
 * `data-theme` 定下来。存的是 `theme()` 的结果而不是 `picked`，这一点是关键——
 *
 *   · 真正付了钱、自己挑了深紫的人，下次一打开**第一帧就是深紫**，不再先闪一下
 *     米白。实测过那一闪：正常网速 55ms（2 帧），CPU 降速 3 倍 140ms（3 帧），
 *     而那还是 JS 已经在本地、没有网络下载的情况。看得见。
 *   · 没开通、但手机系统是深色、又碰巧挑过深紫的人，这一格里永远是 `light`
 *     ——因为 `theme()` 给的就是 light。那一闪深紫本来就是 index.html 上那句
 *     `data-theme="light"` 在防的事（深紫是要花钱才有的东西），这一格不会把它
 *     放回来。
 *
 * 为什么不让那段脚本自己去判「是不是天才」：那要把 isGenius() 的整套逻辑
 * （渠道要对得上、到期日留一天余量）抄一遍进 HTML，而**渠道那一条它判不准**
 * ——`salesChannel()` 看的是 `window.Capacitor`，那东西在 <head> 里那一刻可能还
 * 没注入。判错的后果是 App 里先闪深紫再退回米白，正好是反方向的同一个毛病。
 * 存结果不存条件，就没有第二份会走样的判断。
 */
const PAINTED_KEY = 'slides_theme_paint';
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
  const now = theme();
  document.documentElement.setAttribute('data-theme', now);
  // 记下「这一次画的是哪一套」，好让下一次打开的第一帧就对（见 PAINTED_KEY）。
  // 权限一变这儿也会跟着跑一遍（onGeniusChange），所以订阅过期之后这一格自己就
  // 退回 light，不需要谁去清它。
  try {
    localStorage.setItem(PAINTED_KEY, now);
  } catch {
    /* 无痕模式：这一次照样对，只是下一次又会闪那一下 */
  }
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
