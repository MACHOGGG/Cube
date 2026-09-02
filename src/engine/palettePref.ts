/**
 * The colourblind palette, as one setting for the whole app rather than a
 * button on each board.
 *
 * It used to be a per-game toggle that reset every time you started a run,
 * which is the wrong shape for what it is: someone who needs it needs it
 * everywhere, once. So it lives in 个人主页, is remembered, and every board
 * — plus the play screen's own ground, chips and pattern marks, through the
 * `data-cvd` attribute this puts on <html> — follows it.
 */
const KEY = 'slides_colorblind';
type Listener = () => void;

const listeners = new Set<Listener>();
let on = read();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Mirrors the setting onto <html> so the stylesheet can follow it too. */
function paint(): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-cvd', '1');
  else document.documentElement.removeAttribute('data-cvd');
}
paint();

export function colorblindOn(): boolean {
  return on;
}

export function setColorblind(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: the setting just won't outlive the session */
  }
  paint();
  for (const fn of Array.from(listeners)) fn();
}

/** Subscribes to changes; call the returned function to stop listening. */
export function onColorblindChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}


// ---------------------------------------------------------------------------
// 棋子配色 —— Slides 天才的《解锁更多配色》
// ---------------------------------------------------------------------------

/**
 * 换的是棋子那几支颜色，不是整站的主题。
 *
 * 三套：'now' 是一直用着的那一套，'jia' 沉稳（明暗和它接近，气质不变），
 * 'bing' 柔和（整体提亮一档，棋子从底板上跳出来）。两套新的都是照着三个门槛
 * 优化出来的：棋子彼此 ≥20、离底板 ≥28 且亮度对比 ≥2.2、离「空球」那个空心圈
 * ≥18（现在这套在最后一项只有 12.7，就是「灰球和空球分不清」那件事）。
 *
 * 每套里的七支是按「贪心最远点」排过序的：任取前 N 支，它们彼此都还分得开。
 * 各个玩法用几支颜色不一样（圆球 4 支、大三角 5 支、方块和三角 6 支、七色圆球
 * 和进阶三角 7 支），排过序之后直接切前 N 支就行，不用为每个玩法各写一套。
 * 实测最差的一档（丙的前 7 支）彼此最近 24.5，离底板 40.8。
 */
export type PieceVariant = 'now' | 'jia' | 'bing';
export const PIECE_VARIANTS: readonly PieceVariant[] = ['now', 'jia', 'bing'];
const VARIANT_KEY = 'slides_piece_palette';
const VARIANT_COLORS: Record<'jia' | 'bing', readonly string[]> = {
  jia: ['#26aac0', '#df4b65', '#90a43e', '#9c5ac0', '#c89057', '#2b78d7', '#078664'],
  bing: ['#56dcbd', '#d97d64', '#afc6ff', '#edbf75', '#feacec', '#849f54', '#02a4be'],
};

function readVariant(): PieceVariant {
  try {
    const v = localStorage.getItem(VARIANT_KEY);
    return v === 'jia' || v === 'bing' ? v : 'now';
  } catch {
    return 'now';
  }
}
let variant: PieceVariant = readVariant();

export function pieceVariant(): PieceVariant {
  return variant;
}

/** 几支代表色，给设置页面画小圆点用。 */
export function variantSwatch(v: PieceVariant, base: readonly string[]): readonly string[] {
  return v === 'now' ? base.slice(0, 5) : VARIANT_COLORS[v].slice(0, 5);
}

/**
 * 换一套。走的是色盲开关那同一组监听器——每个玩法本来就订着它，换完立刻
 * 重画，不用再各自接一根线。
 */
export function setPieceVariant(next: PieceVariant): void {
  if (next === variant) return;
  variant = next;
  try {
    localStorage.setItem(VARIANT_KEY, next);
  } catch {
    /* 私密模式：这一次还能用，只是关掉标签页就忘了 */
  }
  for (const fn of Array.from(listeners)) fn();
}

/**
 * 把一个玩法的标准配色换成玩家选的那一套。
 *
 * 两种情况原样返回：选的是 'now'，或者色盲模式开着——色盲那一套是给看不清
 * 的人用的，是需求不是喜好，不该被一个「换个好看的」的设置覆盖掉。
 *
 * keepIdx 是炸弹模式里那一支危险色的位置。炸弹配色是「拿标准配色、把某一格
 * 换成固定的红」算出来的，直接整套替换会把那支红也换掉——红是规则的一部分，
 * 不是配色的一部分。
 */
export function themedPalette(cols: readonly string[], keepIdx = -1): readonly string[] {
  if (on || variant === 'now') return cols;
  const v = VARIANT_COLORS[variant];
  if (!v || cols.length > v.length) return cols;
  const out = v.slice(0, cols.length);
  if (keepIdx >= 0 && keepIdx < out.length) out[keepIdx] = cols[keepIdx];
  return out;
}

/**
 * The inline-SVG colours the page's own glyphs are drawn with, mapped onto
 * the Okabe–Ito set.
 *
 * The stylesheet handles everything painted from a custom property, but the
 * home page's icons are literal SVG strings — the board a card stands for is
 * drawn in that board's own colours, which is exactly the sort of "hue is
 * the meaning" the setting exists to fix. Keys are the values in
 * ui/homeIcons.ts's HOME_COLORS (plus the few one-off fills elsewhere);
 * neutrals are left out of the table entirely, since they are already
 * carrying no hue.
 */
const SVG_SWAP: Record<string, string> = {
  '#E8992E': '#E69F00', // timed orange
  '#E9A53C': '#E69F00', // its lighter face
  '#A5412C': '#8A3D00', // bomb brick
  '#B0432A': '#D55E00', // and the red inside it
  '#CE8474': '#E8A87C',
  '#4A6FC4': '#0072B2', // every blue on the page
  '#2E63C4': '#0072B2',
  '#4A60B4': '#0072B2',
  '#8B9BD4': '#56B4E9',
  '#6A4FB8': '#CC79A7', // every purple
  '#8B5CD9': '#CC79A7',
  '#584B8F': '#CC79A7',
  '#A3696E': '#CC79A7',
  '#2E8B32': '#009E73', // every green
  '#3AA45C': '#009E73',
  '#66B379': '#56B4E9', // except this one, which shares a picker with the above
  '#C6A088': '#E8C39E',
  // the tutorials' own five, which are DOM fills rather than SVG paint
  '#4A67C0': '#0072B2',
  '#B5499B': '#CC79A7',
  '#EE8A2E': '#E69F00',
  '#B34D2B': '#D55E00',
  '#1E8B31': '#009E73',
};

/** One colour, through the table above when the setting is on. For the few
 *  places that paint from a literal rather than a custom property — the
 *  tutorials' pieces, which are plain divs, not SVG. */
export function cvdHex(hex: string): string {
  return on ? SVG_SWAP[hex.toUpperCase()] ?? hex : hex;
}

/**
 * Re-paints the inline SVG glyphs under `root` for the current setting, and
 * back again when it is switched off — each element remembers the colour it
 * was drawn with, so turning the setting off is exact rather than a second
 * guess. Safe to call on a tree that has already been through it.
 */
export function applyPaletteToTree(root: ParentNode): void {
  const els = root.querySelectorAll<SVGElement>('svg [fill], svg [stroke], svg[fill], svg[stroke]');
  for (const el of Array.from(els)) {
    for (const attr of ['fill', 'stroke'] as const) {
      const cur = el.getAttribute(attr);
      if (cur === null) continue;
      const key = attr === 'fill' ? 'cvdFill' : 'cvdStroke';
      const orig = el.dataset[key] ?? cur;
      const next = on ? SVG_SWAP[orig.toUpperCase()] ?? orig : orig;
      if (next === cur) continue;
      el.dataset[key] = orig;
      el.setAttribute(attr, next);
    }
  }
}
