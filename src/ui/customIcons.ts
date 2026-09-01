/**
 * 换图标：把 SVG 文件丢进 src/assets/icons/，同名的那个图标就换成你画的。
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  怎么用：一个图标一个文件，文件名见 src/assets/icons/README.md 的清单。
 *  放进去就生效，删掉就变回原来画的那版。不需要改任何代码。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 为什么不是「把 homeIcons.ts 里的字符串换掉」：那样每换一个图标都要动一次
 * 代码，而且原来那版就没了。这里是「文件盖住代码」的关系——代码里画的那版
 * 一直留着当底，文件只是盖在上面，随时能掀开对比。
 *
 * import.meta.glob 在打包时就把整个文件夹读成字符串塞进产物，所以运行时不会
 * 再去下载任何东西，也没有多一次网络请求；文件夹是空的就一个字节都不占。
 */

/** 打包时读进来的全部图标文件，键是 '../assets/icons/base-square.svg'。 */
const FILES = import.meta.glob('../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * 设计软件导出的 SVG 里常带 <clipPath id="clip0_1_2"> 这种 id，而且不同文件
 * 之间会重名。同一个页面上一旦出现两个相同的 id，后一个会被前一个的定义顶掉
 * ——表现为某个图标忽然缺一块或整个不见。所以每个文件的 id 都加上自己的前缀。
 */
function uniqueIds(svg: string, key: string): string {
  const seen = new Set<string>();
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) seen.add(m[1]);
  if (!seen.size) return svg;
  let out = svg;
  for (const id of seen) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scoped = `${key}-${id}`;
    out = out
      .replace(new RegExp(`\\sid="${safe}"`, 'g'), ` id="${scoped}"`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), `url(#${scoped})`)
      .replace(new RegExp(`href="#${safe}"`, 'g'), `href="#${scoped}"`);
  }
  return out;
}

/** XML 声明、注释、DOCTYPE：导出的文件里常有，嵌进 innerHTML 里没用。 */
function trim(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

const CACHE = new Map<string, string | null>();

/**
 * 你画的那一版，没有就返回 null。
 *
 * 调用处一律写成 `custom('xxx') ?? 原来画的那版`，所以文件夹空着的时候，
 * 整个应用和从前一模一样。
 */
export function custom(name: string): string | null {
  const hit = CACHE.get(name);
  if (hit !== undefined) return hit;
  const raw = FILES[`../assets/icons/${name}.svg`];
  if (!raw) {
    CACHE.set(name, null);
    return null;
  }
  let out = trim(raw);
  out = uniqueIds(out, name);
  // 屏幕阅读器不该念图标：它旁边的按钮已经有 aria-label 了。
  if (!/aria-hidden=/.test(out)) out = out.replace(/<svg\b/, '<svg aria-hidden="true"');
  CACHE.set(name, out);
  return out;
}

/**
 * 第一个存在的那个文件。
 *
 * 给「同一支秒表配三个形状」这类图标用：放 timed-square.svg 就只换方块那一支，
 * 放 timed.svg 就三支一起换，两个都放的话方块用前者。这样你可以先画一个看看
 * 效果，再决定要不要每个形状都单独画。
 */
export function customAny(...names: string[]): string | null {
  for (const n of names) {
    const hit = custom(n);
    if (hit) return hit;
  }
  return null;
}

/** 现在放了哪些文件——发码页和自检脚本用来核对文件名有没有写错。 */
export function customIconNames(): string[] {
  return Object.keys(FILES)
    .map((p) => p.replace('../assets/icons/', '').replace(/\.svg$/, ''))
    .sort();
}
