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
