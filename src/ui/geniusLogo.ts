/**
 * 「Slides 天才」 的标志。
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  把你自己的 logo 放进来：
 *
 *  1. 在 Illustrator / Figma / Sketch 里把《Slides天才》导出成 SVG。
 *  2. 用文本编辑器打开那个 .svg 文件，全选、复制。
 *  3. 把下面 GENIUS_LOGO 那对反引号 ` ` 之间的内容整个换掉。
 *
 *  换完就好了——注册页、主菜单里被锁的玩法、订阅后的个人主页，三个地方
 *  会同时出现。在此之前这三处什么都不画：与其自作主张画一个像的，不如
 *  空着等你的原件。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 两点提醒：
 *   · SVG 里的颜色如果写死了，深色模式下可能看不清。想让它跟着主题走，
 *     把 fill 改成 `currentColor`。
 *   · 不用管 width / height，下面会按用到的地方重新定尺寸。
 */
export const GENIUS_LOGO = ``;

/** 换成你的 SVG 之前，三个位置都安静地空着。 */
export const hasGeniusLogo = (): boolean => GENIUS_LOGO.trim().length > 0;

/**
 * 标志本身，按调用处要的尺寸画出来。
 *
 * `size` 是 CSS 像素的边长；`className` 用来微调它在各处的位置。空的时候
 * 返回空字符串，所以调用处直接嵌进模板里就行，不必自己判断有没有。
 */
export function geniusLogoTag(size = 20, className = ''): string {
  if (!hasGeniusLogo()) return '';
  return `<span class="genius-logo ${className}" aria-hidden="true"
                style="width:${size}px;height:${size}px">${GENIUS_LOGO}</span>`;
}
