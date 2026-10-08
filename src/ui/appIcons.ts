import { roundedPolyPath } from './homeIcons';
import { custom } from './customIcons';

/**
 * 这个站的图标——浏览器标签页、iOS 主屏幕、Android 安装都是它——画成矢量，不发位图：
 * 三块棋子（三角、圆、方）摞成一座塔，用的是棋盘上同一套形状、同一套颜色，几百个字节，
 * 16px 和 512px 一样清楚。
 *
 * 从前这儿是十一个图标、玩家在个人主页的《图示》里挑一个（存在 localStorage 的
 * slides_app_icon 里）。10-08 方案 3-C-4 把《图示》整个删了（「入口 + 页面/函数 + 四语字符
 * 串全清，不留死代码」），所以另外十个图标、存那份选择和读它的函数、它们在
 * public/icons/app/ 底下那四十个 PNG 和 manifest 一起删了。从前挑过别的图标的人，开机那一下
 * 就回到这一个——那个选择已经没有地方改了，留着它等于一个改不掉的状态。
 */

/** The pieces' own colours. */
const P = {
  rose: '#C05C5C',
  green: '#3C7A2C',
  blue: '#2A3E93',
  paper: '#FFFFFF',
} as const;

const sq = (x: number, y: number, w: number, h: number, fill: string, r = w * 0.16) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const ci = (cx: number, cy: number, r: number, fill: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
/** A triangle on its flat edge, corners softened the way every piece in the
 *  game is. */
const tri = (cx: number, edgeY: number, half: number, h: number, fill: string) =>
  `<path d="${roundedPolyPath([[cx, edgeY - h], [cx + half, edgeY], [cx - half, edgeY]], half * 0.22)}" fill="${fill}"/>`;

/** Three pieces stacked into a tower, each resting on the one below. */
const tower = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<rect width="100" height="100" fill="${P.paper}"/>` +
  tri(50, 34, 13.5, 25, P.rose) + ci(50, 49, 14.8, P.green) + sq(34, 63.5, 32.5, 31, P.blue, 5.2) +
  `</svg>`;

export interface AppIcon {
  id: string;
  svg: string;
}

/**
 * 这一个图标。
 *
 * 想换掉它：放一个 app-tower-rgb.svg 进 src/assets/icons/。手机主屏幕的 PNG 是
 * scripts/gen-app-icons.mjs 从这儿烤出来的，所以换了文件之后重跑一次那个脚本，主屏幕
 * 图标一起跟着换。
 */
export const APP_ICON: AppIcon = { id: 'tower-rgb', svg: custom('app-tower-rgb') ?? tower() };

/**
 * Puts the icon everywhere an icon of this site can appear: the browser tab,
 * the iOS home screen, and the Android install.
 *
 * index.html already names the home-screen pair (they are the same files), but
 * its tab icon is /favicon.svg, a different drawing — the tab has always shown
 * this one once the page is up, so this still runs at boot. Every existing link
 * is removed first: browsers keep using whichever one they picked at parse
 * time, so editing a single href is not reliably enough — replacing the lot is.
 *
 * The tab takes the SVG inline as a data URI, so there is no extra request and
 * no file to ship. The other two cannot: iOS reads apple-touch-icon and installs
 * a real PNG from a real URL, and Android installs whatever icons the linked
 * manifest names. Those two point at the files scripts/gen-app-icons.mjs writes.
 */
export function applyAppIcon(): void {
  if (typeof document === 'undefined') return;
  const drop = (sel: string) => {
    for (const old of Array.from(document.querySelectorAll(sel))) old.remove();
  };
  const add = (attrs: Record<string, string>) => {
    const link = document.createElement('link');
    for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
    document.head.appendChild(link);
  };

  drop('link[rel~="icon"]');
  add({ rel: 'icon', type: 'image/svg+xml', href: 'data:image/svg+xml,' + encodeURIComponent(APP_ICON.svg) });

  drop('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
  add({ rel: 'apple-touch-icon', sizes: '180x180', href: `/icons/app/${APP_ICON.id}-180.png` });

  drop('link[rel="manifest"]');
  add({ rel: 'manifest', href: `/icons/app/${APP_ICON.id}.webmanifest` });
}
