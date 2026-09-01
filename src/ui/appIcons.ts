import { roundedPolyPath } from './homeIcons';
import { custom } from './customIcons';

/**
 * The icon set a player can put on the browser tab, drawn as vectors rather
 * than shipped as bitmaps: every one of them is a handful of rounded squares,
 * circles and triangles, so tracing them into SVG costs a few hundred bytes
 * and stays crisp at 16px and at 512px alike.
 *
 * They are all built from the game's own pieces — the same three shapes and
 * the same five colours the boards use — so whichever a player picks, the tab
 * still reads as this game.
 */

/** The pieces' own colours. */
const P = {
  rose: '#C05C5C',
  green: '#3C7A2C',
  blue: '#2A3E93',
  ochre: '#A66A17',
  purple: '#9455C6',
  paper: '#FFFFFF',
} as const;

const sq = (x: number, y: number, w: number, h: number, fill: string, r = w * 0.16) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const ci = (cx: number, cy: number, r: number, fill: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
/** A triangle on its flat edge (`up`) or hanging from it, corners softened
 *  the way every piece in the game is. */
const tri = (cx: number, edgeY: number, half: number, h: number, fill: string, up = true) => {
  const pts: [number, number][] = up
    ? [[cx, edgeY - h], [cx + half, edgeY], [cx - half, edgeY]]
    : [[cx, edgeY + h], [cx + half, edgeY], [cx - half, edgeY]];
  return `<path d="${roundedPolyPath(pts, half * 0.22)}" fill="${fill}"/>`;
};

let clipSeq = 0;
/** Wraps one icon. Tilings run off every edge, so they are clipped back to
 *  the icon's own square — with rounded corners where the artwork has them. */
function icon(inner: string, clipR?: number): string {
  let body = inner;
  if (clipR !== undefined) {
    const id = 'appIconClip' + ++clipSeq;
    body =
      `<defs><clipPath id="${id}"><rect x="0" y="0" width="100" height="100" rx="${clipR}"/></clipPath></defs>` +
      `<g clip-path="url(#${id})">${inner}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${P.paper}"/>${body}</svg>`;
}

// ---------------------------------------------------------------------------
// the eleven
// ---------------------------------------------------------------------------

/** Three pieces stacked into a tower, each resting on the one below. */
const stack = (t: string, c: string, s: string) =>
  icon(tri(50, 34, 13.5, 25, t) + ci(50, 49, 14.8, c) + sq(34, 63.5, 32.5, 31, s, 5.2));

/** A scoop, a block and a cone. */
const cone = () =>
  icon(ci(49.5, 24, 14, P.rose) + sq(34, 35, 32, 30.5, P.blue, 5) + tri(49.5, 66, 13.3, 25.5, P.ochre, false));

/** The three pieces set apart rather than stacked. */
const scatter = () =>
  icon(ci(25, 34, 14.8, P.ochre) + sq(60.5, 19, 31.5, 30.7, P.rose, 5) + tri(49.7, 79.5, 13.2, 25.5, P.blue));

/** Circles packed row on row, every other row half a pitch across — sized so
 *  neighbours just touch and the white shows through as the curved gaps
 *  between them. */
function circleTile(colors: string[]): string {
  const R = 19, PX = 38, PY = 33;
  let out = '', n = 0;
  for (let row = -1; row <= 3; row++) {
    for (let col = -1; col <= 3; col++) {
      const cx = col * PX + (row & 1 ? PX / 2 : 0) + 4;
      out += ci(cx, row * PY + 8, R, colors[n++ % colors.length]);
    }
  }
  return icon(out);
}

/** Rounded squares on a plain grid, running off all four edges. */
function squareTile(colors: string[]): string {
  const S = 36, PT = 39;
  let out = '', n = 0;
  for (let row = 0; row <= 2; row++) {
    for (let col = 0; col <= 2; col++) {
      out += sq(col * PT - 14, row * PT - 12, S, S, colors[n++ % colors.length], 8.3);
    }
  }
  return icon(out);
}

/** One band of triangles, point up and point down alternately, their bases on
 *  opposite edges of the band so they interlock. */
function triBand(fill: string): string {
  const HALF = 12.5, H = 28, LO = 36, HI = LO + H, GAP = 1.2;
  let out = '';
  for (let i = -1; i <= 4; i++) {
    out += tri(i * 25, HI, HALF - GAP, H - GAP, fill);
    out += tri(i * 25 + 12.5, LO, HALF - GAP, H - GAP, fill, false);
  }
  return icon(out);
}

/** The same interlock carried over the whole icon, three bands deep. */
function triTile(fill: string): string {
  const HALF = 16.5, H = 32, PITCH = 33.5, GAP = 1.4;
  let out = '';
  for (let band = -1; band <= 2; band++) {
    const lo = band * PITCH + 1;
    for (let i = -1; i <= 3; i++) {
      out += tri(i * 33 - 4, lo + H, HALF - GAP, H - GAP, fill);
      out += tri(i * 33 + 12.5, lo, HALF - GAP, H - GAP, fill, false);
    }
  }
  return icon(out, 12);
}

export interface AppIcon {
  id: string;
  svg: string;
}

/**
 * Every icon on offer, in the order the picker lays them out.
 *
 * 想换掉其中一个：放一个 app-<id>.svg 进 src/assets/icons/，比如
 * app-tower-rgb.svg。手机主屏幕的 PNG 是 scripts/gen-app-icons.mjs 从这个
 * 数组烤出来的，所以换了文件之后重跑一次那个脚本，主屏幕图标一起跟着换。
 */
const DRAWN: AppIcon[] = [
  { id: 'tower-rgb', svg: stack(P.rose, P.green, P.blue) },
  { id: 'tower-bor', svg: stack(P.blue, P.ochre, P.rose) },
  { id: 'scatter', svg: scatter() },
  { id: 'cone', svg: cone() },
  { id: 'balls-multi', svg: circleTile([P.rose, P.blue, P.ochre, P.green, P.purple, P.rose, P.purple, P.blue]) },
  { id: 'balls-rose', svg: circleTile([P.rose]) },
  { id: 'blocks-multi', svg: squareTile([P.green, P.blue, P.rose, P.ochre, P.green, P.purple, P.rose, P.ochre]) },
  { id: 'band-rose', svg: triBand(P.rose) },
  { id: 'band-blue', svg: triBand(P.blue) },
  { id: 'tri-rose', svg: triTile(P.rose) },
  { id: 'tri-blue', svg: triTile(P.blue) },
];

export const APP_ICONS: AppIcon[] = DRAWN.map(({ id, svg }) => ({
  id,
  svg: custom(`app-${id}`) ?? svg,
}));

export const DEFAULT_APP_ICON = 'tower-rgb';

// ---------------------------------------------------------------------------
// the player's choice
// ---------------------------------------------------------------------------

export const APP_ICON_KEY = 'slides_app_icon';

/** The chosen icon's id, falling back to the default when storage is
 *  unavailable (private windows throw on access) or holds something stale. */
export function loadAppIcon(): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(APP_ICON_KEY);
  } catch {
    // A browser that refuses storage still gets the default icon.
  }
  return APP_ICONS.some((i) => i.id === saved) ? (saved as string) : DEFAULT_APP_ICON;
}

export function saveAppIcon(id: string): void {
  try {
    localStorage.setItem(APP_ICON_KEY, id);
  } catch {
    // The choice just won't survive a reload; the tab still updates now.
  }
}

/**
 * Puts the chosen icon everywhere an icon of this site can appear: the
 * browser tab, the iOS home screen, and the Android install.
 *
 * Every existing link is removed first: browsers keep using whichever one
 * they picked at parse time, so editing a single href is not reliably
 * enough — replacing the lot is.
 *
 * The tab takes the SVG inline as a data URI, so there is no extra request
 * and no file to ship. The other two cannot: iOS reads apple-touch-icon and
 * installs a real PNG from a real URL, and Android installs whatever icons
 * the linked manifest names — which is why picking an icon used to change
 * the tab and leave the home screen showing the shipped default. Those two
 * point at the files scripts/gen-app-icons.mjs writes, one set per icon.
 */
export function applyAppIcon(id: string = loadAppIcon()): void {
  if (typeof document === 'undefined') return;
  const chosen = APP_ICONS.find((i) => i.id === id) ?? APP_ICONS[0];
  const drop = (sel: string) => {
    for (const old of Array.from(document.querySelectorAll(sel))) old.remove();
  };
  const add = (attrs: Record<string, string>) => {
    const link = document.createElement('link');
    for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
    document.head.appendChild(link);
  };

  drop('link[rel~="icon"]');
  add({ rel: 'icon', type: 'image/svg+xml', href: 'data:image/svg+xml,' + encodeURIComponent(chosen.svg) });

  drop('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
  add({ rel: 'apple-touch-icon', sizes: '180x180', href: `/icons/app/${chosen.id}-180.png` });

  drop('link[rel="manifest"]');
  add({ rel: 'manifest', href: `/icons/app/${chosen.id}.webmanifest` });
}
