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

/**
 * 去掉根标签上的 width / height。
 *
 * 设计软件导出的 SVG 根标签长这样：<svg width="533px" height="583px" viewBox=…>。
 * 这两个是 presentation attribute——优先级低于任何 CSS 声明，但只要它们在，
 * 「高度」这条属性就有值了，于是 CSS 的 aspect-ratio 无从生效（aspect-ratio
 * 只在宽高有一边是 auto 时才算数）。表现是：某个只写了 width 的地方，图标被
 * 拉成原始比例的竖长条——居中弹窗里三只秒表因此散得满屏都是。
 *
 * 尺寸一律交给 CSS，文件只管画什么。viewBox 留着，比例照样是对的。
 */
function unsize(svg: string): string {
  const end = svg.indexOf('>');
  if (end < 0) return svg;
  return svg.slice(0, end).replace(/\s(?:width|height)="[^"]*"/g, '') + svg.slice(end);
}

/**
 * 把 color(display-p3 r g b) 换成普通的 #rrggbb。
 *
 * 这不是为了好看，是为了图标能显示出来。设计软件（Sketch 尤其）导出时会把
 * 颜色写成 `fill="color(display-p3 0.29 0.376 0.698)"`，那是 CSS Color 4 的
 * 写法，Chrome 111 / Safari 15 以后才认。旧一点的安卓 WebView 和旧 Safari
 * 读不懂它——而 SVG 的 fill 是个「表现属性」，值非法时不是退回默认色，是
 * 整条属性作废，于是这个 rect 去继承父层的 fill。导出的文件父层恰恰写着
 * fill="none"。结果：整个图标一片空白，刷新多少次都一样，因为它根本不是
 * 没加载，是加载了却画不出来。（基础方块那颗图标就是这么消失的。）
 *
 * 换算走公开的两段矩阵——P3 线性 → XYZ(D65) → sRGB 线性——不是把三个数字
 * 直接当 sRGB 用：P3 的色域更宽，同样的数值在 sRGB 里要更饱和才等价。
 * 自检：白 → #ffffff，黑 → #000000，中灰 0.5 → #808080，都对得上。
 * 超出 sRGB 能表达的部分只能截断，那是换色域本身的代价，不是算错。
 */
const P3_TO_SRGB = [
  [1.2249401763, -0.2249401763, 0.0],
  [-0.0420569547, 1.0420569547, 0.0],
  [-0.0196375546, -0.0786360456, 1.0982736001],
];
function p3ToHex(r: number, g: number, b: number): string {
  const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const lin = [toLin(r), toLin(g), toLin(b)];
  const hex = P3_TO_SRGB.map((row) => {
    const v = toGam(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
    return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  });
  return '#' + hex.join('');
}
/** 文件里所有 color(display-p3 …) 就地换成十六进制；带透明度的换成 rgba()。 */
function sRGBOnly(svg: string): string {
  return svg.replace(
    /color\(\s*display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)/g,
    (_m, r: string, g: string, b: string, a?: string) => {
      const hex = p3ToHex(parseFloat(r), parseFloat(g), parseFloat(b));
      if (a === undefined) return hex;
      const alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
      const [rr, gg, bb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return `rgba(${rr}, ${gg}, ${bb}, ${alpha})`;
    },
  );
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
  let out = sRGBOnly(unsize(trim(raw)));
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
