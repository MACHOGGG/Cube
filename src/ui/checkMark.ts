/**
 * 全站那一枚勾（10-09 补充方案 6-5：「勾的形状 = 甲：直接用游戏里《完成》键那枚」）。
 *
 * 100 格画布上的两笔：短笔约 20.9、长笔约 41.8，一共约 63——帐号窗《完成》描一笔那一下的
 * stroke-dasharray 就是这个数（style.css 的 .acct-done .ctl-check）。凡是画勾的地方都取这一条：
 *
 *   · 游戏里《完成》键、帐号窗《完成》键（都是 ctlIcons 的 CTL_FINISH：圆盘 ＋ 勾）；
 *   · uiIcons 的 ICON_CHECK（改昵称那颗保存键：线描、没有圆盘，100 格画布）；
 *   · 结算页通关章里的勾（40 格画布，checkPathAt(0.4)）；
 *   · 规则书配图最后那个「完成」（白盘绿勾，100 格画布，和《完成》键同一副）；
 *   · 只有一枚勾、没有圆盘的三处——小屋名单上交了卷的小勾（roomNotices 的 TICK）、规则书配图和教学分镜里
 *     得分时闪的白勾（ruleArt、storyTutorial）——画布裁到勾的周围（CHECK_TIGHT_VIEWBOX），大小和粗细
 *     照它们原来的。
 *
 * 从前同一个意思画成了六个样子：这一枚、ICON_CHECK 的细线、通关章照设计图另画的一枚、得分时闪的白勾、规
 * 则书配图最后那个「完成」、小屋的小勾。门 check-one-check 钉着全仓只剩这一种。
 *
 * ⚠️ 这个文件**什么都不 import**，所以单独放在这儿，ctlIcons.ts 原样导出一份（「勾在 ctlIcons 里」照旧成
 * 立）。规则书配图（ruleArt.ts，教学条 coachBar 也带着它）和小屋名单（roomNotices.ts）都取这一条，而
 * check-coach、check-rule-art 是拿 esbuild 把它们打成一个包、在 node 里跑的——要是从 ctlIcons 取，customIcons
 * 那句只有 vite 认得的 import.meta.glob 跟着进包，门当场跑不起来（头一版就是这样）。
 */
export const CHECK_PATH = 'M29 51.5 L44 66 L72 35';

/**
 * 同一枚勾按比例换到别的画布上：`k` = 新画布边长 / 100（通关章 40 格就是 0.4）。只缩放、不挪——这条
 * 路径在 100 格里本来就居中（两头的外框中心是 (50.5, 50.5)），缩完照样居中。数取两位小数，免得浮点
 * 尾巴（29 × 0.4 = 11.600000000000001）写进 SVG。
 */
export function checkPathAt(k: number): string {
  return CHECK_PATH.replace(/\d+(?:\.\d+)?/g, (n) => String(Math.round(Number(n) * k * 100) / 100));
}

/**
 * 没有圆盘、只有一枚勾的时候用的画布：裁到勾的周围，勾占满格子的六成多（43 ÷ 68）——小屋那个小勾、
 * 得分时闪的白勾原来自己画的那一枚就是这么大。线宽各自按原来的粗细折算（见用的地方）。
 */
export const CHECK_TIGHT_VIEWBOX = '16 16 68 68';
