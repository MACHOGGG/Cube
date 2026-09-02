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
/**
 * 挑配色那个窗口里，每一行下面排的那串小球。
 *
 * 列的是「游戏里真的会出现的颜色」，不是挑几个代表——玩家要照着它决定换不
 * 换，看半套等于没看。七个，因为最多的那个玩法（七色圆球）就是七个；用得少
 * 的玩法取前几个。
 */
export function variantSwatch(v: PieceVariant): readonly string[] {
  return v === 'now' ? PIECE_NOW : VARIANT_COLORS[v];
}

/** 「原本」那一套：七色圆球的标准配色，也就是七个玩法里颜色最全的那一份。 */
const PIECE_NOW: readonly string[] = [
  '#2F8A96', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#9B958D', '#8067A8',
];

/** 色盲那三套里，某一套完整的七个颜色。 */
export const cvdSwatch = (v: CvdVariant): readonly string[] => CVD_COLORS[v];

// ---------------------------------------------------------------------------
// 色盲配色也分三套
// ---------------------------------------------------------------------------

/**
 * 色盲友好开着的时候，用哪一套。
 *
 * 「安全」不是一个选项，是这三套的共同前提：每一套都先被模拟成红色盲、绿色盲、
 * 蓝黄色盲看到的样子，再在那四张表里用 CIEDE2000 量两两距离，取最差的那一对
 * 当分数。三套都过线之后，剩下的自由度才拿去做风格——所以玩家在这里挑的是好
 * 不好看，不是安不安全。
 *
 *   std   Okabe-Ito 那八色里的七色，色觉通用设计的标准套装。最差 8.0。
 *   warm  红、橙、黄、玫瑰那一带。最差 10.8。
 *   cool  蓝、青、绿、紫那一带。最差 12.3。
 *
 * 七个一套，因为最多的那个玩法（七色圆球）要七个。各玩法按自己要的个数取前
 * N 个——顺序是用贪心最远点排的，所以任何前缀（4/5/6/7 色）都一样分得开。
 */
export type CvdVariant = 'std' | 'warm' | 'cool';
export const CVD_VARIANTS: readonly CvdVariant[] = ['std', 'warm', 'cool'];
const CVD_KEY = 'slides_cvd_palette';

export const CVD_COLORS: Record<CvdVariant, readonly string[]> = {
  std: ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'],
  warm: ['#DD344F', '#E9CF99', '#EA732F', '#C181A1', '#FEB449', '#B2A972', '#A66378'],
  cool: ['#8767B7', '#A0DCB5', '#1F8985', '#37E6FA', '#5E8052', '#9199CE', '#43B196'],
};

const readCvd = (): CvdVariant => {
  try {
    const raw = localStorage.getItem(CVD_KEY);
    return raw === 'warm' || raw === 'cool' ? raw : 'std';
  } catch {
    return 'std';
  }
};
let cvd: CvdVariant = readCvd();

export const cvdVariant = (): CvdVariant => cvd;

export function setCvdVariant(next: CvdVariant): void {
  if (next === cvd) return;
  cvd = next;
  try {
    localStorage.setItem(CVD_KEY, next);
  } catch {
    /* 私密模式：这一次还能用，只是下次打开回到 std */
  }
  // 和色盲开关共用一套监听：每块棋盘立刻重画，不用重开。
  for (const fn of Array.from(listeners)) fn();
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
  // 色盲友好开着的时候，挑的是色盲那三套；关着的时候，挑的是棋子那三套。
  // 两组互斥——一个人不会同时既要「看得清」又要「换个风格」，他要的是「在
  // 看得清的前提下换个风格」，而那正是色盲那三套本身。
  // std 和 now 都是「原样」：一个字都不换。
  //
  // 这里不能顺手把 std 也走一遍替换——各玩法的色盲配色个数和顺序本来就不一
  // 样（六边圆球是六个、七色圆球是七个，排的次序也不同），拿一份七色的表按位
  // 置盖上去，选着 std 的人会看到和今天不一样的棋盘。std 的意思就是「今天这
  // 样」。
  const from = on
    ? (cvd === 'std' ? null : CVD_COLORS[cvd])
    : (variant === 'now' ? null : VARIANT_COLORS[variant]);
  if (!from || cols.length > from.length) return cols;
  const out = from.slice(0, cols.length);
  // 炸弹那颗红钉住不换：它不是一种颜色，是「这颗会炸」。
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
