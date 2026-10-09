/**
 * 四页改版（第 17 推）那五个线描图标：登录、关闭、邮件、眼睛、划掉的眼睛。
 *
 * 全部用 `currentColor` 画，颜色跟着按钮的字色走——方案定的「所有图标用白色」就是这么
 * 落实的：图标自己不写颜色，药丸上是白，白格子里自然是墨色（白格子里放白图标就看不见
 * 了，门里量对比度的那一条会红）。
 *
 * ── 为什么既 import 又走 custom() ─────────────────────────────────────
 *
 * `src/assets/icons/` 那一套的规矩是「代码里画一版当底，文件盖在上面；删掉文件就变回代
 * 码那版」（见那儿的 README 和 customIcons.ts）。这五个**没有代码里的底版**：文件就是图
 * 标本身。所以：
 *
 *   · 下面那五行 `?raw` import 是给**构建**看的——文件被删、被改名，`vite build` 当场
 *     失败，而不是线上出一颗空白的按钮（一颗看不见图标、只有 aria-label 的键，玩家按
 *     不到也想不到去按）。
 *   · 真正拿去用的是 `custom(name)`：它替文件做的那几件事（去掉 width/height、加
 *     aria-hidden、把 id 加前缀）这五个也要。两条路读的是同一个文件。
 */
import { custom } from './customIcons';
import { CHECK_PATH } from './checkMark';
import LOGIN from '../assets/icons/login.svg?raw';
import CLOSE from '../assets/icons/close.svg?raw';
import MAIL from '../assets/icons/mail.svg?raw';
import EYE from '../assets/icons/eye.svg?raw';
import EYE_OFF from '../assets/icons/eye-off.svg?raw';

export const ICON_LOGIN = custom('login') ?? LOGIN;
export const ICON_CLOSE = custom('close') ?? CLOSE;
export const ICON_MAIL = custom('mail') ?? MAIL;
export const ICON_EYE = custom('eye') ?? EYE;
export const ICON_EYE_OFF = custom('eye-off') ?? EYE_OFF;

/*
 * 下面两个是**代码里画的**（第 16 推，个人主页头卡上改昵称那三颗键：✎、✓；✕ 用上面的
 * ICON_CLOSE）。设计稿给的那五个是文件，这两个稿子里没有，所以照那五个的路子画：
 * 24 × 24、2px 圆头线、`currentColor`，摆在药丸上就是白的。
 *
 * 不用 ✎ ✓ 这两个字：它们在 Fraunces / Georgia 里都没有，落到哪个后备字体上看机器——有的系
 * 统画成彩色 emoji，有的画成一个细得看不见的符号。
 */
const svg24 = (body: string) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  body +
  '</svg>';
export const ICON_PENCIL = svg24('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>');
/**
 * ✓ 是全站那一枚勾（checkMark.ts 的 CHECK_PATH，10-09 补充方案 6-5「全站统一一种勾」），所以画布跟着它
 * 是 100 格，不是上面那几个的 24 格；线宽照原来的视觉粗细折算：2 / 24 ≈ 8.3 / 100，摆在一排线描图标
 * 里还是一样粗。从前这儿是自己画的一枚细勾，和游戏里《完成》键那枚不是一个样子。
 */
export const ICON_CHECK =
  '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="8.3" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  `<path d="${CHECK_PATH}"/></svg>`;

/*
 * 「→」：登录窗那颗往下走的键（第 17 推第 8 条：登录窗和另外三扇窗一样，两颗棕色药丸只放图
 * 标——✕ 和 →）。稿子里没有这个文件，和上面 ✎ ✓ 一样在代码里画。不用「→」这个字：Fraunces
 * 里的箭头比别的图标细一截，摆在一排线描图标中间像是另一套东西。
 */
export const ICON_ARROW = svg24('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>');
