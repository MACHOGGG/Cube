/**
 * Every glyph on the home page, as inline SVG strings.
 *
 * The whole page is built out of four families, each with its own colour so a
 * player can tell a mode apart before reading a word:
 *   gray    — the three base games (square / circle / triangle)
 *   orange  — the timed challenge, drawn as an alarm clock
 *   brick   — the bomb challenge, drawn as a burst star
 *   pastel  — "more layouts", drawn as a brush-stroke plus
 * Every icon draws on the same 100x100 viewBox and is sized entirely by CSS,
 * so a card can grow or shrink without any of this changing.
 */

export const HOME_COLORS = {
  gray: '#A8A8A8',
  orange: '#E8992E',
  brick: '#A5412C',
  brickSoft: '#CE8474',
  panel: '#C6C6C6',
  panelRow: '#D6D6D6',
  blue: '#4A6FC4',
  purple: '#6A4FB8',
  green: '#2E8B32',
  red: '#B0432A',
  amber: '#E9A53C',
  white: '#FFFFFF',
  moreSquare: '#3AA45C',
  moreCircle: '#8B5CD9',
  moreTriangle: '#4A6FC4',
  navBlue: '#2E63C4',
  navInk: '#2A3A78',
  navGray: '#B0B0B0',
} as const;

/** Shared base-shape outlines on the 100x100 grid. The triangle is inset a
 *  little at the top so its apex doesn't look pinched next to the square and
 *  circle, which both fill their box. */
const SQUARE_PATH = 'M6 26 A20 20 0 0 1 26 6 H74 A20 20 0 0 1 94 26 V74 A20 20 0 0 1 74 94 H26 A20 20 0 0 1 6 74 Z';
const TRIANGLE_PATH = 'M50 6 A9 9 0 0 1 57 10 L95 84 A9 9 0 0 1 88 95 H12 A9 9 0 0 1 5 84 L43 10 A9 9 0 0 1 50 6 Z';

export type BaseShape = 'square' | 'circle' | 'triangle';

/** The card's own silhouette, filled with `fill`. */
function baseShape(shape: BaseShape, fill: string): string {
  if (shape === 'circle') return `<circle cx="50" cy="50" r="46" fill="${fill}"/>`;
  if (shape === 'triangle') return `<path d="${TRIANGLE_PATH}" fill="${fill}"/>`;
  return `<path d="${SQUARE_PATH}" fill="${fill}"/>`;
}

function svg(inner: string): string {
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
}

// ---------------------------------------------------------------------------
// base games — a gray silhouette holding a miniature of that game's own board
// ---------------------------------------------------------------------------

/** A small rounded square tile, white-outlined like the real board's pieces. */
function miniSquare(cx: number, cy: number, half: number, fill: string): string {
  return `<rect x="${cx - half}" y="${cy - half}" width="${half * 2}" height="${half * 2}" rx="${half * 0.32}"
    fill="${fill}" stroke="#fff" stroke-width="2.4"/>`;
}
function miniCircle(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="2.4"/>`;
}
/** A small triangle; `up=false` draws it inverted, the way the real triangle
 *  board alternates orientations along a row. */
function miniTriangle(cx: number, cy: number, half: number, fill: string, up = true): string {
  const h = half * 1.5;
  const pts = up
    ? `${cx},${cy - h / 2} ${cx + half},${cy + h / 2} ${cx - half},${cy + h / 2}`
    : `${cx},${cy + h / 2} ${cx + half},${cy - h / 2} ${cx - half},${cy - h / 2}`;
  return `<polygon points="${pts}" fill="${fill}" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>`;
}

const C = HOME_COLORS;

export const ICON_BASE_SQUARE = svg(
  baseShape('square', C.gray) +
    miniSquare(39, 39, 11, C.blue) +
    miniSquare(63, 39, 11, C.amber) +
    miniSquare(39, 63, 11, C.red) +
    miniSquare(63, 63, 11, C.green),
);

export const ICON_BASE_CIRCLE = svg(
  baseShape('circle', C.gray) +
    miniCircle(50, 38, 11.5, C.amber) +
    miniCircle(38, 60, 11.5, C.purple) +
    miniCircle(62, 60, 11.5, C.white),
);

/** Traces a polygon whose corners are rounded off by `r`: each corner is cut
 *  back along both of its edges and bridged by a quadratic through the
 *  original point, so the piece keeps its exact silhouette with soft tips. */
function roundedPolyPath(pts: [number, number][], r: number): string {
  const n = pts.length;
  const toward = (p: [number, number], q: [number, number]): [number, number] => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(r, len / 2) / len;
    return [p[0] + dx * k, p[1] + dy * k];
  };
  const f = (v: number) => v.toFixed(1);
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = toward(p, pts[(i - 1 + n) % n]);
    const b = toward(p, pts[(i + 1) % n]);
    d += (i === 0 ? `M${f(a[0])} ${f(a[1])}` : ` L${f(a[0])} ${f(a[1])}`);
    d += ` Q${f(p[0])} ${f(p[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return d + ' Z';
}

/** One of the three pieces inside the base-triangle card: a tall triangle
 *  with softly rounded corners and the board's own white outline, anchored on
 *  its flat edge (`edgeY`). `up=false` inverts it. */
function tileTriangle(cx: number, edgeY: number, half: number, h: number, fill: string, up = true): string {
  const pts: [number, number][] = up
    ? [[cx, edgeY - h], [cx + half, edgeY], [cx - half, edgeY]]
    : [[cx, edgeY + h], [cx + half, edgeY], [cx - half, edgeY]];
  return `<path d="${roundedPolyPath(pts, 5.5)}" fill="${fill}" stroke="#fff" stroke-width="3.4"
    stroke-linejoin="round"/>`;
}

export const ICON_BASE_TRIANGLE = svg(
  baseShape('triangle', C.gray) +
    // Three big interlocking pieces, the middle one inverted and riding a
    // little higher, so the row nests the way a real board row does.
    tileTriangle(32.5, 79, 13.5, 26, C.red) +
    tileTriangle(50, 50, 13.5, 26, C.purple, false) +
    tileTriangle(67.5, 79, 13.5, 26, C.green),
);

// ---------------------------------------------------------------------------
// timed challenge — an alarm clock
// ---------------------------------------------------------------------------

/** One alarm bell: two round-ended bars crossed into an X, the long one
 *  lying along `ang` (the outward direction, away from the face centre). */
function bell(cx: number, cy: number, ang: number): string {
  const a = (ang * Math.PI) / 180;
  const bar = (len: number, turn: number) => {
    const t = a + turn;
    const dx = Math.cos(t) * len;
    const dy = Math.sin(t) * len;
    return `<line x1="${(cx - dx).toFixed(1)}" y1="${(cy - dy).toFixed(1)}"
      x2="${(cx + dx).toFixed(1)}" y2="${(cy + dy).toFixed(1)}"
      stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  return bar(13, 0) + bar(8.5, Math.PI / 2);
}

/** One clock foot: a single thin bar reaching down and out from the face. */
function foot(cx: number, cy: number, r: number, ang: number): string {
  const a = (ang * Math.PI) / 180;
  const x0 = cx + Math.cos(a) * (r + 3);
  const y0 = cy + Math.sin(a) * (r + 3);
  const x1 = cx + Math.cos(a) * (r + 15);
  const y1 = cy + Math.sin(a) * (r + 15);
  return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"
    stroke="#fff" stroke-width="6.5" stroke-linecap="round"/>`;
}

/**
 * The alarm clock as the reference art draws it: a big white face, two
 * X-shaped bells crossed over its top corners, and (on the square) two thin
 * feet below — every piece of hardware kept apart from the face by a
 * hairline of the card's own orange.
 *
 * On the round and triangular cards the face is deliberately bigger than the
 * card can hold, so the card's own silhouette crops it; that is what gives
 * those two their bottom-heavy look, with only slivers of orange left at the
 * corners. Everything after the card is drawn inside a clip of that
 * silhouette, so nothing spills outside the shape.
 */
interface ClockCfg {
  /** The white face. */
  cx: number;
  cy: number;
  r: number;
  /** Bell centres, and the angle their long bar points along. */
  bells: [x: number, y: number, ang: number][];
  /** Foot directions, in degrees from the face centre. */
  feet: number[];
}

const CLOCK: Record<BaseShape, ClockCfg> = {
  square: { cx: 50, cy: 51, r: 33.5, bells: [[24, 21, 225], [76, 21, 315]], feet: [135, 45] },
  circle: { cx: 50, cy: 63, r: 35, bells: [[20, 32, 225], [80, 32, 315]], feet: [] },
  triangle: { cx: 50, cy: 85, r: 32, bells: [[29, 60, 228], [71, 60, 312]], feet: [] },
};

/** Gap of card colour left between the face and every piece of hardware. */
const CLOCK_GAP = 4.5;

let clipSeq = 0;

function alarmClock(shape: BaseShape, inner = ''): string {
  const k = CLOCK[shape];
  const id = 'clockClip' + ++clipSeq;
  const hardware =
    k.bells.map(([x, y, ang]) => bell(x, y, ang)).join('') +
    k.feet.map((ang) => foot(k.cx, k.cy, k.r, ang)).join('');
  return svg(
    `<defs><clipPath id="${id}">${baseShape(shape, '#000')}</clipPath></defs>` +
      baseShape(shape, C.orange) +
      `<g clip-path="url(#${id})">` +
      hardware +
      // Drawn over the hardware, this ring is the orange hairline that keeps
      // the bells and feet from merging into the face.
      `<circle cx="${k.cx}" cy="${k.cy}" r="${k.r + CLOCK_GAP / 2}" fill="none"
         stroke="${C.orange}" stroke-width="${CLOCK_GAP}"/>` +
      `<circle cx="${k.cx}" cy="${k.cy}" r="${k.r}" fill="${C.white}"/>` +
      inner +
      `</g>`,
  );
}

/** PC row: the clock takes the *card's own* shape, so the three timed entries
 *  read as "the square game, timed", etc. even before the inner glyph. */
export function timedCard(shape: BaseShape): string {
  return alarmClock(shape);
}

/** Mobile home: one clock standing in for all three timed games, with a
 *  miniature of each game's piece lined up inside its face. */
export const ICON_TIMED_COMBINED = alarmClock(
  'square',
  miniSquare(33, 51, 8, C.purple) + miniTriangle(50, 51, 9.5, C.blue) + miniCircle(67, 51, 8, C.green),
);

/** Mobile picker: one clock per timed game — the same three cards the wide
 *  layout shows in its timed row. */
export function timedOption(shape: BaseShape): string {
  return alarmClock(shape);
}

// ---------------------------------------------------------------------------
// bomb challenge — a burst star
// ---------------------------------------------------------------------------

/** An 8-point burst with deliberately uneven spikes, so it reads as a comic
 *  "bang" rather than a tidy compass rose. */
function burstStar(cx: number, cy: number, R: number, fill: string): string {
  const spikes = [
    [90, 1.0], [128, 0.5], [168, 0.82], [205, 0.46],
    [250, 0.95], [292, 0.48], [332, 0.88], [42, 0.52],
  ];
  const pts: string[] = [];
  for (let i = 0; i < spikes.length; i++) {
    const [deg, len] = spikes[i];
    const a = (deg * Math.PI) / 180;
    pts.push(`${(cx + Math.cos(a) * R * len).toFixed(1)},${(cy - Math.sin(a) * R * len).toFixed(1)}`);
    const nb = (deg + 22) * (Math.PI / 180);
    pts.push(`${(cx + Math.cos(nb) * R * 0.34).toFixed(1)},${(cy - Math.sin(nb) * R * 0.34).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

/** A single option chip inside the bomb panel: an orange piece for the basic
 *  tier, a green piece (the base-square icon's green) for the 90s timed tier,
 *  a purple "+" piece for the advanced (more-layouts) tier. */
export function bombChip(shape: BaseShape, tier: 'basic' | 'timed' | 'advanced'): string {
  const fill = tier === 'basic' ? C.amber : tier === 'timed' ? C.green : C.purple;
  const body =
    shape === 'square'
      ? `<rect x="22" y="22" width="56" height="56" rx="12" fill="${fill}"/>`
      : shape === 'triangle'
        ? `<path d="M50 16 A8 8 0 0 1 57 20 L88 74 A8 8 0 0 1 81 85 H19 A8 8 0 0 1 12 74 L43 20 A8 8 0 0 1 50 16 Z" fill="${fill}"/>`
        : `<circle cx="50" cy="50" r="29" fill="${fill}"/>`;
  const plus =
    tier === 'advanced'
      ? `<path d="M50 ${shape === 'triangle' ? 46 : 38} V${shape === 'triangle' ? 70 : 62} M38 ${shape === 'triangle' ? 58 : 50} H62"
           stroke="#fff" stroke-width="8" stroke-linecap="round"/>`
      : '';
  return svg(body + plus);
}

/** The 90s timed-bomb tier's own marker — a wide burst with the label on top.
 *  Its own viewBox is wider than tall and it is allowed to overflow its row,
 *  so the star spills into the tiers above and below exactly as the sheet
 *  has it, instead of being boxed inside the middle bar. */
export const ICON_BOMB_90S =
  '<svg viewBox="0 0 260 100" overflow="visible" aria-hidden="true">' +
  burstStar(130, 50, 88, C.white) +
  `<text x="130" y="64" text-anchor="middle" font-family="Karla, sans-serif" font-size="40"
      font-weight="700" fill="#3A3733">90s</text>` +
  '</svg>';

// ---------------------------------------------------------------------------
// more layouts — a brush-stroke plus
// ---------------------------------------------------------------------------

/** A hand-inked plus: slightly wobbly edges and a few flecks knocked out, so
 *  the "more" cards feel drawn rather than generated. */
const BRUSH_PLUS =
  '<path d="M43.5 20.5 C46 19.6 54.4 19.2 56.8 20.8 C57.9 28 57.2 35.4 57.6 42.6 ' +
  'C64.8 42.2 72.4 41.6 79.6 42.8 C80.9 45.4 80.6 53.8 79.2 56.2 C72 57.1 64.6 56.4 57.4 56.8 ' +
  'C57.9 64.2 57.2 71.8 58.4 79.2 C55.8 80.6 47.4 80.9 45 79.4 C44.1 72.2 44.8 64.6 44.4 57.2 ' +
  'C37 56.8 29.4 57.4 22 56.2 C20.7 53.6 21 45.2 22.4 42.8 C29.6 41.9 37.2 42.6 44.6 42.2 ' +
  'C44.1 34.9 43.1 27.6 43.5 20.5 Z" fill="#fff"/>' +
  '<circle cx="49" cy="31" r="1.5" fill="#fff" opacity="0"/>' +
  '<path d="M52 27 l2 1 -1 2 z" fill="#fff" opacity="0.001"/>';

/** Small knocked-out flecks that read as dry-brush gaps in the stroke. */
const BRUSH_FLECKS =
  '<circle cx="52.5" cy="33" r="1.6" fill="rgba(255,255,255,0)"/>' +
  '<circle cx="47" cy="66" r="1.3" fill="rgba(255,255,255,0)"/>';

export function moreLayoutCard(shape: BaseShape): string {
  const fill = shape === 'square' ? C.moreSquare : shape === 'circle' ? C.moreCircle : C.moreTriangle;
  const lift = shape === 'triangle' ? '<g transform="translate(0,8) scale(0.86) translate(8,0)">' : '<g>';
  return svg(baseShape(shape, fill) + lift + BRUSH_PLUS + BRUSH_FLECKS + '</g>');
}

// ---------------------------------------------------------------------------
// bottom nav
// ---------------------------------------------------------------------------

/** 个人主页 — one navy bust: an arch with a flat base, the head marked by a
 *  white ring near its crown rather than drawn as a separate blob. */
export const ICON_NAV_PROFILE = svg(
  `<path d="M8 97 V52 A42 42 0 0 1 92 52 V97 Z" fill="${C.navInk}"/>` +
    `<circle cx="50" cy="35" r="11.5" fill="none" stroke="#fff" stroke-width="4.5"/>`,
);

/** 记录与排名 — a gray triangle with list rules across it. */
export const ICON_NAV_RECORDS = svg(
  `<path d="${TRIANGLE_PATH}" fill="${C.navGray}"/>` +
    `<path d="M32 60 H68 M28 71 H72 M36 49 H64" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
);
