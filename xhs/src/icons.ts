/**
 * 这一版自己的图标。网页版那一套在 src/ui/homeIcons.ts，那个文件不动。
 */

/**
 * 底排那唯一一颗键：一个橙色的圆。玩家给的原图。
 *
 * 原图的填色写的是 `color(display-p3 0.910 0.533 0.227)`。这里换成了等价的
 * sRGB —— 不是嫌它新，是踩过坑：安卓上一批 WebView 认得 `color()` 这个函数、
 * 却算不出 display-p3 的值，于是整条 fill 作废、退回初始值**纯黑**，图标当场
 * 变成一个黑饼（见 scripts/check-css-fallbacks.mjs 开头那段账）。小工具的底线
 * 内核是 Chrome 61，比那批还老。
 *
 * 换算走的是标准那条路（P3 → 线性 → XYZ D65 → 线性 sRGB → 编码），得到
 * #F7821B。在广色域屏上比原图略淡一点点，在普通屏上一模一样——而普通屏是
 * 大多数。
 *
 * 原图是 361×361 的椭圆（rx 179.99 / ry 180.05），画成正圆看不出差别。
 */
export const ICON_NAV_ME = `<svg viewBox="0 0 361 361" width="100%" height="100%" aria-hidden="true" focusable="false"><circle cx="180.5" cy="180.5" r="180" fill="#F7821B"/></svg>`;
