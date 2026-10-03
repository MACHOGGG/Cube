/**
 * 《每日挑战》那张图（第 19 推）：星期几的那一张底图，上面压着当天的日期数字。
 *
 * 底图是玩家给的七个 SVG（src/assets/icons/daily-1 … daily-7，1 ＝ 周一），按北京时间的星期
 * 换——和每日种子用的是**同一个 dayIndex**（engine/seedCode.ts 的 beijingDate），所以图、数字和
 * 那一天的种子永远同时换，不会出现「图已经是周日、种子还是周六」的那一分钟。
 *
 * 数字不在文件里，由这儿追加一个 `<text>`（方案原话）：
 *   · Fraunces 600，字号约为图标高的 45%（491 的画布上 221），水平垂直都居中——一位数和两位
 *     数都居中，靠的是 `text-anchor: middle` + `dominant-baseline: central`，不是按位数挪；
 *   · 光学尺寸钉在 24（`'opsz' 24`）：Fraunces 默认按字号自动挑光学尺寸，221 这个字号会挑到
 *     最高那一档——粗细对比拉到最大，横笔细成一根发丝，图标缩到菜单上那么大时数字只剩一圈描
 *     边（第一版就是这样）。24 是正文那一档的笔画，和设计图上那个「17」一个样子；
 *   · 奶白那一天（周六）底上的点是白的，白字压上去就看不见了，所以数字用 `--card-gray`、描边
 *     用白色；其余六天白字、`rgba(0,0,0,.25)` 的描边；
 *   · `paint-order: stroke`：描边画在字的下面，只露出字外面那一圈（491 的画布上约 2px，描边宽
 *     4 的一半）——不压细笔画，又把白字从浅色的点上托出来。
 *
 * 颜色一个都不改：底图走 customIcons 的 custom()（它只把 display-p3 换成等价的十六进制，旧安
 * 卓不认 display-p3，认不得整条 fill 作废、图变空白——见那个文件）。
 */
import { STRINGS, type Lang } from '../i18n';
import { beijingDate, dayIndexOf, dayStartOf } from '../engine/seedCode';
import { custom } from './customIcons';

/** 奶白那一天：周六（daily-6.svg）。 */
export const CREAM_WEEKDAY = 6;

/** 星期几（1 ＝ 周一 … 7 ＝ 周日）用哪一个图标文件。 */
export const dailyIconName = (weekday: number): string => `daily-${weekday}`;

/**
 * 七个文件里少了哪一个时垫底的那块：一张纸色的圆角方块。不该发生（文件在仓库里），真发生了
 * 那一天还有一张看得出是卡片的图，数字照样压在上面。
 */
const FALLBACK =
  '<svg viewBox="0 0 491 491" aria-hidden="true"><rect width="491" height="491" rx="123" fill="#F6E2C0"></rect></svg>';

/** 日期数字那一层的样式：奶白那一天深灰字白描边，其余白字暗描边。 */
export function dailyDateInk(weekday: number): { fill: string; stroke: string } {
  return weekday === CREAM_WEEKDAY
    ? { fill: 'var(--card-gray, #4C4C4C)', stroke: '#FFFFFF' }
    : { fill: '#FFFFFF', stroke: 'rgba(0, 0, 0, 0.25)' };
}

/** 那一天的图（整段 SVG）。 */
export function dailyArtHtml(dayIndex: number): string {
  const { d, weekday } = beijingDate(dayIndex);
  const base = custom(dailyIconName(weekday)) ?? FALLBACK;
  const ink = dailyDateInk(weekday);
  // fill / stroke 写在 style 里，不写成属性：属性里的 var() 不算数（表现属性不认变量），而奶白
  // 那一天的字色要跟着 --card-gray 走。
  const text =
    `<text class="daily-date" x="245.5" y="245.5" text-anchor="middle" dominant-baseline="central"` +
    ` font-family="Fraunces, Georgia, serif" font-weight="600" font-size="221"` +
    ` stroke-width="4" stroke-linejoin="round" paint-order="stroke"` +
    ` style="fill:${ink.fill};stroke:${ink.stroke};font-variation-settings:'opsz' 24">${d}</text>`;
  // 门要认得出这是哪一天、星期几（check-daily 量「零点换图」和「七天配色」）。
  return base
    .replace(/<svg\b/, `<svg data-daily-day="${dayIndex}" data-daily-weekday="${weekday}"`)
    .replace(/<\/svg>\s*$/, `${text}</svg>`);
}

/** 读屏念的那一句：「每日挑战，10 月 3 日」（英法两种语言念月份的名字）。 */
export function dailyAria(lang: Lang, dayIndex: number): string {
  const s = STRINGS[lang];
  const { m, d } = beijingDate(dayIndex);
  const month = s.monthNames.split('|')[m - 1] ?? String(m);
  return s.dailyAria.replace('{month}', month).replace('{m}', String(m)).replace('{d}', String(d));
}

/**
 * 盯着「今天是哪一天」：到北京零点、或者从后台切回来时发现换了一天，就叫一声 onChange（方案原
 * 话：「菜单开着时到北京零点自动换图，切回前台时重算」）。
 *
 * 零点那一下用一个定时器排到下一个零点（多 50ms，宁可晚一拍也不要早——早了算出来还是昨天，
 * 就要再排一次）。定时器在后台会被浏览器压住、手机锁屏会整个停掉，所以切回前台那一下另外现算
 * 一次，不信定时器。
 *
 * @returns 撤掉定时器和监听（拆页面时叫）。
 */
export function watchDay(now: () => number, onChange: (dayIndex: number) => void): () => void {
  let day = dayIndexOf(now());
  let timer = 0;
  const arm = () => {
    window.clearTimeout(timer);
    const wait = Math.max(0, dayStartOf(day + 1) - now()) + 50;
    timer = window.setTimeout(check, wait);
  };
  function check(): void {
    const d = dayIndexOf(now());
    if (d !== day) {
      day = d;
      onChange(d);
    }
    arm();
  }
  const onShow = () => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onShow);
  arm();
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onShow);
  };
}
