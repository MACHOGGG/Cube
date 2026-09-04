/**
 * 网页版那一套数值，一处抄过来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要抄，不能引用
 *
 * 网页版的这些数写在 src/style.css 的自定义属性里（--play-chip、--play-panel
 * …）和几条 clamp() 里。CSS 是浏览器算的，小游戏只有一块画布，没有 CSS 引擎，
 * 所以只能把「算出来的结果」搬过来：颜色照抄，clamp() 自己算。
 *
 * 每一条都注明了原文在 style.css 的哪一行附近，改了那边就要改这边。玩家的要
 * 求是「设计、字体、规则、手感都不要有任何改动」——所以宁可这样一条条对，也
 * 不自己另定一套看着差不多的数。
 * ─────────────────────────────────────────────────────────────────────────
 */

/** CSS 的 clamp(a, b, c)：不小于 a、不大于 c。 */
export const clamp = (lo: number, val: number, hi: number): number => Math.min(hi, Math.max(lo, val));

/**
 * 游戏页那一套颜色（style.css 的 :root，「游戏页」那一组）。
 *
 *   --play-bg      页面底色，和主菜单同一个（--bg）
 *   --play-panel   棋盘那块「地板」——深褐，棋子摆在上面
 *   --play-chip    读数和底下两颗键的橙金
 *   --play-chip-ink   橙金上的字色
 *   --play-btn-disc   两颗键中间那个红圆
 */
export const PLAY = {
  bg: '#FAF6EC',
  panel: '#3D3128',
  chip: '#D2952F',
  chipInk: '#3B2508',
  chipPress: '#8E5138',
  chipPressInk: '#FFF1E4',
  btnDisc: '#B0454A',
  btnMark: '#FFFFFF',
  ink: '#2E2430',
  inkSoft: '#6E5F6D',
  inkFaint: '#9A8B98',
  surface: '#FFFFFF',
  accent: '#BE5762',
  /** 得分图示那一排：实心蓝 + 近黑描边（style.css 的 --hint-fill / --hint-edge）。 */
  hintFill: '#4C7EAD',
  hintEdge: '#2E2430',
  /** 卡死时框住那几枚的红。 */
  stuck: '#C0392B',
  /** 消掉之后留在原地的空球（--ink-faint 压到三成半）。 */
  blank: 'rgba(154, 139, 152, 0.35)',
  /** 棋子之间那条缝的颜色就是地板本身——这里只留一个名字，画的时候不用它。 */
  outline: '#FFFFFF',
};

/**
 * 游戏页的排版（style.css 的 .app--game 一节）。
 *
 * 一页从上到下：页边距 → 读数三格 → 间距 → 得分图示 → 间距 → 棋盘地板
 * →（剩下的空当）→ 底下两颗键 → 页边距。中间那两段空当由 auto 外边距平分，
 * 所以图示正好落在读数和棋盘的正中间。
 */
export interface PlayMetrics {
  /** 页面四周留白。上边要躲刘海，底下要躲那道横杠。 */
  padTop: number;
  padSide: number;
  padBottom: number;
  /** 读数三格 / 底下两颗键之间的横向间距。 */
  chipGap: number;
  /** 读数一格、底下一颗键的高（两者同高，这是网页版的写法）。 */
  chipH: number;
  /** 那几块圆角矩形的圆角。 */
  chipR: number;
  /** 读数里数字的字号。 */
  chipFont: number;
  /** 上下相邻两块之间的基本间距（.app--game 的 gap）。 */
  rowGap: number;
  /** 棋盘地板的圆角。 */
  panelR: number;
  /** 得分图示一枚图形有多大（1em）。 */
  hintEm: number;
}

/**
 * 按屏幕算一次。传进来的是逻辑尺寸和安全区，出去的是像素。
 *
 * vh / vmin 就是屏幕高 / 短边的百分之一，和 CSS 里一个意思。
 */
export function playMetrics(w: number, h: number, safeTop = 0, safeBottom = 0): PlayMetrics {
  const vh = h / 100;
  const vw = w / 100;
  const vmin = Math.min(w, h) / 100;
  return {
    // padding: calc(max(env(safe-area-inset-top), 14px) + 6px) max(…, 14px)
    //          calc(max(env(safe-area-inset-bottom), 10px) + 6px) …
    padTop: Math.max(safeTop, 14) + 6,
    padSide: 14,
    padBottom: Math.max(safeBottom, 10) + 6,
    chipGap: clamp(8, 2.4 * vw, 18),
    chipH: clamp(50, 8.2 * vh, 78),
    chipR: clamp(11, 1.9 * vh, 17),
    chipFont: clamp(1.15 * 16, 3.6 * vh, 2 * 16),
    rowGap: clamp(8, 1.6 * vh, 16),
    panelR: clamp(14, 3 * vh, 26),
    // .app--game:not(.pattern-sides) .pattern-hint —— 方块和小球都走这一条。
    hintEm: clamp(13, 4.4 * vmin, 21),
  };
}

/**
 * 字体。
 *
 * 网页版的数字用 Fraunces（衬线，600 字重），说明文字用 Karla。小游戏这边
 * 只能用系统字体：微信小游戏要换字体得先把字体文件转成 ttf 再 wx.loadFont，
 * 那是另一件事（见《微信小游戏上手指南.md》的待办）。在那之前用衬线族兜底，
 * 至少「数字是衬线的」这一点和网页版一致。
 */
export const FONT_NUM = (px: number) => `600 ${px}px Georgia, "Songti SC", serif`;
export const FONT_TEXT = (px: number, weight = 600) =>
  `${weight} ${px}px -apple-system, "PingFang SC", sans-serif`;
