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
