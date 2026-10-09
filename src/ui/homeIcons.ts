/**
 * Every glyph on the home page, as inline SVG strings.
 *
 * The whole page is built out of four families, each with its own colour so a
 * player can tell a mode apart before reading a word:
 *   gray    — the three base games (square / circle / triangle)
 *   orange  — the timed challenge, drawn as a stopwatch
 *   brick   — the bomb challenge, drawn as a burst star
 *   pastel  — "more layouts", drawn as a brush-stroke plus
 * Every icon draws on the same 100x100 viewBox and is sized entirely by CSS,
 * so a card can grow or shrink without any of this changing.
 *
 * 想换掉其中任何一个：把你自己的 SVG 放进 src/assets/icons/，文件名见那里的
 * README。下面每一处都是「先找你的文件，没有才用这里画的」，所以放一个文件
 * 换一个图标，删掉文件就变回来，代码不用动。
 */
import { custom, customAny } from './customIcons';
import type { BombTier } from '../engine/bomb';

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
  /* 炸弹那一页三档各自的颜色（bombBasic / bombTimed / bombAdv，PR-20）从前在这儿。第 18 推
     那一页换成了「棋盘图标 ＋ 一排一种底板颜色」，颜色挪到 style.css 的 .bomb-row--*（色卡
     token），这三支没人用了，一起撤。 */
  white: '#FFFFFF',
  moreSquare: '#3AA45C',
  /* the "more layouts" boards, tinted per the design sheet */
  layoutGreen: '#66B379',
  layoutPurple: '#584B8F',
  layoutPeri: '#8B9BD4',
  tan: '#C6A088',
  rose: '#A3696E',
  moreCircle: '#8B5CD9',
  moreTriangle: '#4A6FC4',
  navBlue: '#2E63C4',
  navAvatar: '#4A60B4',
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

/*
 * 这儿原先还有一个 `svgWide(w, inner)`，给不是正方的图开一个 w:100 的框——唯一用它
 * 的是 V 形进阶三角那张（两条臂各画得和大三角一样大）。那副棋盘 2026-09 删了
 * （《侵蚀阶梯》v1.2 PR-6），这个函数也就没人调了。
 *
 * 删掉而不是留着：留着编译报错（noUnusedLocals），而且下一张宽图来了照这两行重写
 * 一遍比猜它当年为什么在那儿容易。WIDE_LAYOUT_ICONS 那张表留着（见下面）。
 */

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
const C = HOME_COLORS;

export const ICON_BASE_SQUARE = custom('base-square') ?? svg(
  baseShape('square', C.gray) +
    miniSquare(39, 39, 11, C.blue) +
    miniSquare(63, 39, 11, C.amber) +
    miniSquare(39, 63, 11, C.red) +
    miniSquare(63, 63, 11, C.green),
);

export const ICON_BASE_CIRCLE = custom('base-circle') ?? svg(
  baseShape('circle', C.gray) +
    miniCircle(50, 38, 11.5, C.amber) +
    miniCircle(38, 60, 11.5, C.purple) +
    miniCircle(62, 60, 11.5, C.white),
);

/** Traces a polygon whose corners are rounded off by `r`: each corner is cut
 *  back along both of its edges and bridged by a quadratic through the
 *  original point, so the piece keeps its exact silhouette with soft tips. */
export function roundedPolyPath(pts: [number, number][], r: number | number[]): string {
  const n = pts.length;
  const radius = (i: number) => (typeof r === 'number' ? r : r[i]);
  const toward = (p: [number, number], q: [number, number], rr: number): [number, number] => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(rr, len / 2) / len;
    return [p[0] + dx * k, p[1] + dy * k];
  };
  const f = (v: number) => v.toFixed(1);
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = toward(p, pts[(i - 1 + n) % n], radius(i));
    const b = toward(p, pts[(i + 1) % n], radius(i));
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

export const ICON_BASE_TRIANGLE = custom('base-triangle') ?? svg(
  baseShape('triangle', C.gray) +
    // Three big interlocking pieces, the middle one inverted and riding a
    // little higher, so the row nests the way a real board row does.
    tileTriangle(32.5, 79, 13.5, 26, C.red) +
    tileTriangle(50, 50, 13.5, 26, C.purple, false) +
    tileTriangle(67.5, 79, 13.5, 26, C.green),
);

// ---------------------------------------------------------------------------
// timed challenge — a stopwatch
// ---------------------------------------------------------------------------

/**
 * The stopwatch the reference sheet draws for the timed games: an orange body
 * in the card's own shape, a crown (a rounded pill on a short stem) standing
 * on top of it, and — on the round one only — two pushers angled off its
 * shoulders. The face is that game's own shape again, in its own colour,
 * ringed by a white band so it reads off the orange.
 *
 * Everything sits on the shared 100x100 grid. The body hangs low because the
 * crown claims the top fifth, which is why these read a little narrower than
 * the base-game cards beside them — that difference is in the artwork, not in
 * the CSS, so the row keeps one box size throughout.
 */
const WATCH_CY = 63.5;
const WATCH_HALF = 34.5;
/** White band between the body and the face. */
const WATCH_RING = 3.4;

/** The crown: a stem bridging up out of the body into a rounded pill. Drawn
 *  before the body so the stem's lower end disappears underneath it. */
const WATCH_CROWN =
  `<rect x="46" y="10" width="8" height="26" rx="4" fill="${C.orange}"/>` +
  `<rect x="34" y="2.5" width="32" height="15.5" rx="7.75" fill="${C.orange}"/>`;

/** The round watch's two side pushers, angled off its upper shoulders. */
const WATCH_PUSHERS = [225, 315]
  .map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x = (r: number) => (50 + Math.cos(a) * r).toFixed(1);
    const y = (r: number) => (WATCH_CY + Math.sin(a) * r).toFixed(1);
    const [x0, y0, x1, y1] = [x(31), y(31), x(46), y(46)];
    return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"
      stroke="${C.orange}" stroke-width="12" stroke-linecap="round"/>`;
  })
  .join('');

const WATCH_BODY: Record<BaseShape, string> = {
  square: `<rect x="${50 - WATCH_HALF}" y="${WATCH_CY - WATCH_HALF}" width="${WATCH_HALF * 2}"
    height="${WATCH_HALF * 2}" rx="15" fill="${C.orange}"/>`,
  circle: `<circle cx="50" cy="${WATCH_CY}" r="36" fill="${C.orange}"/>`,
  // Fitted to what actually gets DRAWN, not to the polygon fed in. Those are
  // not the same shape: a 25-unit corner radius pulls the bottom corners far
  // inside the base points, so the previous [11..89] base rendered only 64.8
  // wide against 76.5 tall — a 0.847 silhouette where the reference drawing
  // is 0.928, which is exactly the "too thin" it looked. These numbers were
  // solved against the rendered bounding box instead: 72.4 x 78.0, ratio
  // 0.928, top edge at y=20 so a length of stem still shows under the crown.
  triangle: `<path d="${roundedPolyPath([[50, 12], [94, 98], [6, 98]], [18, 25, 25])}" fill="${C.orange}"/>`,
};

/** The face, drawn twice: once grown by the ring width in white, then again
 *  at size in its own colour. `grow` is what separates the two passes. */
function watchFace(shape: BaseShape, fill: string, grow = 0): string {
  if (shape === 'square') {
    const h = 20 + grow;
    return `<rect x="${50 - h}" y="${WATCH_CY - h}" width="${h * 2}" height="${h * 2}"
      rx="${(h * 0.45).toFixed(1)}" fill="${fill}"/>`;
  }
  if (shape === 'circle') return `<circle cx="50" cy="${WATCH_CY}" r="${15 + grow}" fill="${fill}"/>`;
  // Same tracing, against the body's real bounds: apex 24% and base 70% down
  // it, base 0.478 of its width — so a band of orange stays underneath, as
  // the drawing has it.
  const g = grow * 1.5;
  return `<path d="${roundedPolyPath([[50, 38.9 - g], [67.3 + g, 74.4 + g * 0.6], [32.7 - g, 74.4 + g * 0.6]], 6)}"
    fill="${fill}"/>`;
}

/** Face colours, straight off the reference sheet. */
const WATCH_FACE_FILL: Record<BaseShape, string> = {
  square: C.green,
  circle: C.brick,
  triangle: C.gray,
};

function stopwatch(shape: BaseShape, face?: string): string {
  return svg(
    WATCH_CROWN +
      (shape === 'circle' ? WATCH_PUSHERS : '') +
      WATCH_BODY[shape] +
      watchFace(shape, C.white, WATCH_RING) +
      (face ?? watchFace(shape, WATCH_FACE_FILL[shape])),
  );
}


/**
 * Mobile home: one watch standing in for all three timed games, its face a
 * white plate carrying a miniature of each game's piece.
 *
 * It has to be the *same* watch the picker fans out, or tapping it reads as
 * one object turning into three different ones — which is exactly how the
 * old alarm clock looked once the three became stopwatches.
 */
export const ICON_TIMED_COMBINED = custom('timed-combined') ?? (() => {
  const cy = WATCH_CY;
  // No white outlines here. The base-game cards draw their pieces outlined
  // because they sit on grey, but this face is already white — the outlines
  // only made the three collide, the triangle's stroke overlapping the
  // square beside it. And the triangle is rounded the way the bomb chips'
  // triangle is, rather than left sharp among two soft neighbours.
  const sq = (cx: number, h: number, fill: string) =>
    `<rect x="${cx - h}" y="${cy - h}" width="${h * 2}" height="${h * 2}" rx="${(h * 0.34).toFixed(1)}" fill="${fill}"/>`;
  const tri = (cx: number, h: number, fill: string) =>
    `<path d="${roundedPolyPath([[cx, cy - h], [cx + h * 1.04, cy + h * 0.82], [cx - h * 1.04, cy + h * 0.82]], h * 0.21)}"
      fill="${fill}"/>`;
  const ci = (cx: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
  return stopwatch(
    'square',
    watchFace('square', C.white) + sq(37.5, 5, C.purple) + tri(50, 5.6, C.blue) + ci(62.5, 5.2, C.green),
  );
})();

/*
 * 这儿原先还有一个 timedOption(shape)：一种形状一支秒表（文件 timed-square / timed-circle /
 * timed-triangle.svg，偷懒写法 timed.svg）。它是 2026-09 之前计时那个居中挑选窗里的三张图；挑
 * 选窗改成整页（ui/timedMode.ts，摆的是基础方块 / 基础小球）之后，只剩开局倒数页还在摆它——
 * 玩家在计时那一页按下的是灰底的方块，倒数那几秒看见的却是一支绿脸的秒表。10-08 方案 3-F-4
 * 把倒数页改成和第二层同一个图源（ui/modeIcons.ts 的 iconFor），它就没有人用了，连同那三个
 * 文件一起删掉。主菜单那支沙漏（ICON_TIMED_COMBINED）照旧在上面。
 */

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

/**
 * 炸弹选择页上的一格（第 18 推第 2 条，按设计图）：**那副棋盘自己的图标**，只是把「底板」
 * ——图里第一笔画的那一块：方块的圆角方、小球的圆、菱形方块的菱形、六边形小球的六边形——
 * 交给这一页的 CSS 上色（`.bomb-plate`，见 style.css 的 .bomb-row--*）：
 *
 *   基础  底板浅灰 #A7A7A7（正是这两张图标文件自己底板的颜色，所以第一排就是原样的图标）
 *   计时  底板 --card-orange
 *   进阶  底板 --card-gray（菱形方块 / 六边形小球）
 *
 * 鼠标经过、按下、键盘聚焦时底板变 --card-red 加一圈白边，也是那条 CSS 的事。
 *
 * 做法：把图标里第一个带 fill 的形状的 fill 换成 class="bomb-plate"。表现属性 fill 的优先
 * 级比任何一条 CSS 都低，按说留着也盖得住；拿掉是为了别让它在 CSS 没加载上的那一下闪出另
 * 一个颜色，也让「这一块归 CSS 管」一眼看得出来。文件版（src/assets/icons/ 里那几个）和代
 * 码兜底那版都是先画底板、再画棋子，所以「第一个」就是底板——门 check-bomb-panel 量的就是
 * 这一块真的上了那一排的颜色。
 *
 * 从前这一格是 `bombChip()`：一个纯色的方块或圆，定时那两枚印「100s」、进阶那两枚印
 * 「+++」（PR-20 / E26，「一个字都不写」）。第 18 推的设计图换成了棋盘图标 ＋ 面板左边三个
 * 字，徽记就不印了——三排靠那三个字分，不再靠格子上的徽记。
 *
 * 给了 `tier`，底板再多挂一个 `bomb-plate--<档>`：那一档的颜色跟着图走，不靠它外面是哪一
 * 排（10-08 方案 3-F-4）。开局倒数页上那张图外面没有 .bomb-row，可它和炸弹那一页按下去的那
 * 一格必须是同一张（ui/modeIcons.ts 的 iconFor）。主菜单电脑端那块面板的缩图不给 tier，照旧
 * 按排上色（3-D-5：炸弹缩图不动）。
 */
export function bombBoard(glyph: string, tier?: BombTier): string {
  const cls = tier ? `bomb-plate bomb-plate--${tier}` : 'bomb-plate';
  return glyph.replace(/<(rect|circle|ellipse|path|polygon)\b([^>]*?)\sfill="[^"]*"/, `<$1$2 class="${cls}"`);
}

/** 炸弹选择页面板正中那颗白色八角星（第 18 推第 2 条）。装饰，aria-hidden。 */
export function bombPanelStar(): string {
  return svg(burstStar(50, 50, 48, C.white));
}

/*
 * **那枚星爆时长徽记（ICON_BOMB_90S）撤了**（PR-20 / E17+E26）。
 *
 * 它是炸弹那一页中间那条宽的横杠：一枚画着「100s」的爆炸星，点一下才换成两枚棋盘。两件
 * 事让它退场：
 *
 *   · **两次点击才开得了一局**，而上下两行都是一次。同一页上三行长得像、行为不一样，正
 *     是玩家定的「不要让玩家出现意料之外的疏漏操作」那一条。
 *   · 时长现在印在棋盘那两枚自己身上（`bombChip` 的徽记），所以也不缺那条信息。
 *
 * 它带走的那几样一起撤了：`style.css` 的 `.bomb-90s` / `.bomb-row--90s` /
 * `.bomb-row--open` 五条规则、`scripts/icon-sheet.mjs` 那一行、`check-mode-axis.mjs` 里量
 * 它位置的那几条断言。
 *
 * `burstStar()` 留着——「炸弹」那一族的主图标（ICON_BOMB）和炸弹选择页面板正中那颗星
 * （`bombPanelStar`，第 18 推）都在用它。
 */

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
  const drawn = customAny(`more-${shape}`, 'more');
  if (drawn) return drawn;
  const fill = shape === 'square' ? C.moreSquare : shape === 'circle' ? C.moreCircle : C.moreTriangle;
  const lift = shape === 'triangle' ? '<g transform="translate(0,8) scale(0.86) translate(8,0)">' : '<g>';
  return svg(baseShape(shape, fill) + lift + BRUSH_PLUS + BRUSH_FLECKS + '</g>');
}

// ---------------------------------------------------------------------------
// the five "more layouts" variants — each drawn as its own board, so the
// picker shows five different shapes instead of five copies of the plus card
// ---------------------------------------------------------------------------

/** 菱形方块 — the board's own rotated square, holding four tiles at the
 *  compass points with the middle left open. */
const ICON_SQUARE_DIAMOND = svg(
  `<path d="${roundedPolyPath([[50, 3], [97, 50], [50, 97], [3, 50]], 15)}" fill="${C.layoutGreen}"/>` +
    miniSquare(50, 27, 12, C.green) +
    miniSquare(27, 50, 12, C.blue) +
    miniSquare(73, 50, 12, C.white) +
    miniSquare(50, 73, 12, C.amber),
);

/** 六边圆球 — the hexagon, packed with its own rows of balls (3-4-5-4-3). */
const HEX_PTS: [number, number][] = [[50, 4], [90, 27], [90, 73], [50, 96], [10, 73], [10, 27]];
const HEX_ROWS: { n: number; y: number }[] = [
  { n: 3, y: 24 }, { n: 4, y: 37 }, { n: 5, y: 50 }, { n: 4, y: 63 }, { n: 3, y: 76 },
];
const HEX_FILLS = [
  C.green, C.white, C.green,
  C.blue, C.blue, C.red, C.amber,
  C.red, C.amber, C.blue, C.red, C.blue,
  C.amber, C.white, C.amber, C.green,
  C.blue, C.red, C.blue,
];
const ICON_CIRCLE_HEX = svg(
  `<path d="${roundedPolyPath(HEX_PTS, 6)}" fill="${C.layoutPurple}"/>` +
    HEX_ROWS.flatMap((row, r) =>
      Array.from({ length: row.n }, (_, i) => {
        const step = 13;
        const cx = 50 + (i - (row.n - 1) / 2) * step;
        const n = HEX_ROWS.slice(0, r).reduce((a, x) => a + x.n, 0) + i;
        return miniCircle(cx, row.y, 5.9, HEX_FILLS[n] ?? C.blue);
      }),
    ).join(''),
);

/** 七色圆球 — the wide diamond the 7x7 board really is, with a rosette of
 *  balls round an open middle. */
const ICON_CIRCLE_SEVEN = svg(
  `<path d="${roundedPolyPath([[50, 18], [98, 50], [50, 82], [2, 50]], 9)}" fill="${C.blue}"/>` +
    miniCircle(50, 50, 11, C.white) +
    miniCircle(50, 30, 11, C.red) +
    miniCircle(50, 70, 11, C.green) +
    miniCircle(31, 39, 11, C.green) +
    miniCircle(31, 61, 11, C.red) +
    miniCircle(69, 39, 11, C.amber) +
    miniCircle(69, 61, 11, C.blue) +
    miniCircle(12, 50, 11, C.amber) +
    miniCircle(88, 50, 11, C.green),
);

/** Rows of alternating up/down tile triangles filling a triangular field —
 *  the lattice both triangle layouts are built on. */
function triRows(
  apexX: number, apexY: number, half: number, rows: number, fills: string[],
): string {
  const h = ((half * 2) / rows) * 0.866;
  const w = (half * 2) / rows;
  let out = '';
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const edgeY = apexY + (r + 1) * h;
    const count = 2 * r + 1;
    const left = apexX - ((r + 1) * w) / 2;
    for (let i = 0; i < count; i++) {
      const up = i % 2 === 0;
      const cx = left + (i / 2 + 0.5) * w;
      out += tileTriangle(cx, up ? edgeY : edgeY - h, w / 2, h, fills[n % fills.length], up);
      n++;
    }
  }
  return out;
}
const TRI_FILLS = [C.green, C.blue, C.tan, C.blue, C.tan, C.rose, C.blue, C.tan, C.rose];

/** One arm, in two layers: the periwinkle silhouette, and the rows of tiles
 *  that sit on it. Both triangle layouts are built from these, at exactly
 *  the same size — 进阶三角 is two of them. Keeping the two layers separate
 *  is what lets that icon interleave them (see below). */
const TRI_BODY = `<path d="${TRIANGLE_PATH}" fill="${C.layoutPeri}"/>`;
const TRI_TILES = (fills: string[]) => `<g transform="translate(0,2)">${triRows(50, 12, 40, 3, fills)}</g>`;
const TRI_ARM = (fills: string[]) => TRI_BODY + TRI_TILES(fills);

/** 大三角 — one big triangle of tiles. */
const ICON_TRIANGLE_BIG = svg(TRI_ARM(TRI_FILLS));

/*
 * 进阶三角（V 形）那张图连着它那几个算宽度的常数一起删了——那副棋盘 2026-09 删了
 * （《侵蚀阶梯》v1.2 PR-6）。它是唯一一张 2:1 的宽图，所以下面那张「哪些图要宽格
 * 子」的表现在是空的。
 */

/** 要 2:1 宽格子的图，不是平常那种正方的。
 *  **眼下一张都没有**：唯一那张（V 形进阶三角）随棋盘一起删了。机制留着——挑布局
 *  那一屏给宽图双倍宽的槽、装不下就换行，下一张宽图来了直接填这张表就行。 */
const WIDE_LAYOUT_ICONS = new Set<string>();

/** Whether this variant's icon is the wide (2:1) kind — the picker gives it
 *  a double-width slot, and wraps to a second line when that no longer fits
 *  beside its sibling. */
export function layoutIconIsWide(id: string): boolean {
  return WIDE_LAYOUT_ICONS.has(id);
}

/** One icon per "more layouts" variant, by its game id. */
const LAYOUT_ICONS: Record<string, string> = {
  squareDiamond: ICON_SQUARE_DIAMOND,
  circleHex: ICON_CIRCLE_HEX,
  circleSeven: ICON_CIRCLE_SEVEN,
  triangleBig: ICON_TRIANGLE_BIG,
};

/** The icon for one layout variant, falling back to its family's plus-card
 *  if a new variant ever arrives without artwork of its own. */
export function layoutIcon(id: string, shape: BaseShape): string {
  return custom(`layout-${id}`) ?? LAYOUT_ICONS[id] ?? moreLayoutCard(shape);
}

// ---------------------------------------------------------------------------
// 多人游玩
// ---------------------------------------------------------------------------

/**
 * 主菜单上那颗多人游玩。
 *
 * 兜底画的是三块层层叠起来的牌——三个人各拿一副同样的棋盘，正是这个玩法的
 * 意思。换成你自己的：放一个 multiplayer.svg 进 src/assets/icons/。
 */
export const ICON_MULTIPLAYER =
  custom('multiplayer') ??
  svg(
    `<path d="M30 18 L74 34 V78 L30 62 Z" fill="${C.orange}"/>` +
      `<path d="M22 30 L66 46 V90 L22 74 Z" fill="${C.blue}"/>` +
      `<path d="M14 42 L58 58 V96 L14 80 Z" fill="${C.green}"/>`,
  );

/**
 * 同一扇门的纯白版：《加入小屋》那颗键上的标识。
 *
 * 门还是主菜单上那一扇——同一个文件、同一套几何，只是三块门板全刷成白的。
 * 刷白之后三块会连成一整片，看不出是门了，所以每一块再描一圈 `--door-gap`：
 * 那圈不是画上去的线，是底色透过来的缝，门板的层次靠它留住。门把手同理，
 * 白门上的白把手是看不见的，所以它也留成底色。
 *
 * `--door-gap` 由用它的那颗键给（见 style.css 的 .mp-join-door）；没人给就
 * 是透明的，退回一个纯白的剪影，不会画出一圈莫名其妙的黑边。
 */
export const ICON_DOOR_WHITE = whiteDoor(ICON_MULTIPLAYER);

function whiteDoor(markup: string): string {
  return markup
    .replace(
      /<path /g,
      '<path stroke="var(--door-gap, transparent)" stroke-width="9" stroke-linejoin="round" ',
    )
    .replace(/<ellipse ([^>]*?)fill="#FFFFFF"/gi, '<ellipse $1fill="var(--door-gap, transparent)"')
    .replace(/fill="#(?!FFFFFF\b)[0-9A-Fa-f]{3,8}"/g, 'fill="#FFFFFF"');
}

/**
 * 炸弹局的标志：一颗白底红星，摆在开局页和战绩图上。
 *
 * 和主菜单那张炸弹卡不是一回事——那张是入口，这个是「你正在打的这一局是炸弹
 * 局」。所以它小、独立、能贴在别的东西旁边。换成你自己的：bomb-badge.svg。
 */
export const ICON_BOMB_BADGE =
  custom('bomb-badge') ??
  svg(`<circle cx="50" cy="50" r="46" fill="#fff"/>` + burstStar(50, 50, 34, C.brick));

/**
 * 主菜单上那张炸弹卡（10-09 补充方案 7-17，玩家指定的 bomb-menu.svg：砖红圆角方块里一颗白色圆角星
 * 芒，1026 见方，原样存的——`<title>`、display-p3 两样由 customIcons 现成的清理处理）。电脑宽版、手
 * 机、小红书那一版的菜单都是这一枚；点开之后炸弹那一页自己的三排面板不动。
 *
 * 和上面那枚 ICON_BOMB_BADGE 是同一个设计，新的一枚画布更大、星角是圆的；那一枚照旧是「这一局是
 * 炸弹局」的标志（开局页、战绩图）。文件缺了就退回那一枚，不会空白。
 */
export const ICON_BOMB_MENU = custom('bomb-menu') ?? ICON_BOMB_BADGE;

// ---------------------------------------------------------------------------
// bottom nav
// ---------------------------------------------------------------------------

/** 个人主页 — a blue-violet disc holding one white avatar: a ringed head over
 *  a rounded bust whose shoulders run off the bottom of the disc, which the
 *  disc's own edge crops. */
export const ICON_NAV_PROFILE = custom('nav-profile') ?? svg(
  `<defs><clipPath id="navAvatarClip"><circle cx="50" cy="50" r="46"/></clipPath></defs>` +
    `<circle cx="50" cy="50" r="46" fill="${C.navAvatar}"/>` +
    `<g clip-path="url(#navAvatarClip)">` +
    `<path d="M25 104 C25 71 34 55 50 55 C66 55 75 71 75 104 Z" fill="#fff"/>` +
    `</g>` +
    `<circle cx="50" cy="33" r="12" fill="none" stroke="#fff" stroke-width="5"/>`,
);

/** 记录与排名 — a gray triangle with list rules across it. */
export const ICON_NAV_RECORDS = custom('nav-records') ?? svg(
  `<path d="${TRIANGLE_PATH}" fill="${C.navGray}"/>` +
    `<path d="M32 60 H68 M28 71 H72 M36 49 H64" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
);

/**
 * The sound switch's two faces, from the reference sheet: a filled speaker
 * with three widening arcs, and the same speaker with a stroke laid across
 * the arcs. Drawn in currentColor so the pill's own ink carries them.
 */
const SPEAKER_BODY =
  '<path d="M8 38 H22 L40 20 A5 5 0 0 1 48 24 V76 A5 5 0 0 1 40 80 L22 62 H8 ' +
  'A5 5 0 0 1 3 57 V43 A5 5 0 0 1 8 38 Z" fill="currentColor"/>';
const SPEAKER_ARCS =
  '<g fill="none" stroke="currentColor" stroke-width="8.5" stroke-linecap="round">' +
  '<path d="M60 38 A18 18 0 0 1 60 62"/>' +
  '<path d="M72 27 A31 31 0 0 1 72 73"/>' +
  '<path d="M84 17 A44 44 0 0 1 84 83"/></g>';
// 这两个和下面的锁是用 currentColor 画的：颜色跟着它所在那颗按钮走，深色
// 模式下会自己变。换成写死颜色的文件之后就不跟了——这是取舍，不是 bug。
export const ICON_SOUND_ON = custom('sound-on') ?? svg(SPEAKER_BODY + SPEAKER_ARCS);
export const ICON_SOUND_OFF = custom('sound-off') ?? svg(
  SPEAKER_BODY +
    SPEAKER_ARCS +
    // The bar, cut clear of the arcs it crosses so it reads as one stroke
    // laid over them rather than as a fourth arc.
    '<path d="M56 14 L98 92" fill="none" stroke="var(--pill-ink, #FFFFFF)" stroke-width="17" stroke-linecap="round"/>' +
    '<path d="M56 14 L98 92" fill="none" stroke="currentColor" stroke-width="8.5" stroke-linecap="round"/>',
);

/** The padlock worn by anything behind 「Slides 天才」 — the 「+」 picker's
 *  locked boards and the not-yet-built perks listed in 个人主页. Drawn in
 *  currentColor so each place it appears takes its own ink. */
/** 《无限反转》：玩家画的四层翻面（src/assets/icons/flip-mode-menu.svg）。主菜单那
 *  张卡和个人主页《更多玩法》的陈列页用的是同一张。 */
export const ICON_FLIP_MODE = custom('flip-mode-menu') ?? '';
/** 《真正解密 · 步步为营》：玩家画的那张（src/assets/icons/puzzle-mode-menu.svg）。
 *  主菜单那张卡和个人主页《更多玩法》的陈列页用的是同一张。 */
export const ICON_PUZZLE_MODE = custom('puzzle-mode-menu') ?? '';

/** 《老虎机模式》在主菜单上的那块牌子——玩家给的老虎机图。
 *
 *  主菜单那台是单独一张图（三个窗口里画着蓝三角、橙圆、红方块），和开局时
 *  真转起来的那台（slot-machine.svg，两个窗口）不是同一个文件。个人主页
 *  《更多玩法》的陈列页也用这一张，所以放在这儿而不是 menu.ts 里。 */
export const ICON_SLOT_MACHINE = custom('slot-machine-menu') ?? custom('slot-machine') ?? '';

export const ICON_LOCK =
  custom('lock') ??
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11 V8 a4 4 0 0 1 8 0 v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

// ---------------------------------------------------------------------------
// 开局页用的「这是哪一个玩法」
// ---------------------------------------------------------------------------

const BASE_GAME_ICONS: Record<string, string> = {
  square: ICON_BASE_SQUARE,
  circle: ICON_BASE_CIRCLE,
  triangle: ICON_BASE_TRIANGLE,
};

/**
 * 一副棋盘在主菜单上的那张脸，按它的 id 取。
 *
 * 三个基础玩法用自己的底图，其余变体走 layoutIcon()；家族按 id 前缀认（circleHex 是圆球家
 * 的）——这儿收的常常是服务器发来的 mode（排行榜那一行、小屋），猜错只影响摆哪张图，而且必须
 * 容得下脏数据（见 CLAUDE.md《家族和规则》）。
 *
 * 开局倒数页不直接问它，问的是 ui/modeIcons.ts 的 iconFor（「这一局是什么」→ 图，10-08 方案
 * 3-F-4），iconFor 再按棋盘来这儿取底图。从前这儿还收一个 `timed`：计时局换成 timedOption 那
 * 支秒表——那是计时还是居中挑选窗时候的图，第二层改成整页之后就和玩家按下去的那一格对不上了，
 * 连同 timedOption 一起删掉（见上面 ICON_TIMED_COMBINED 底下那段）。
 */
export function gameIcon(id: string): string {
  const family: BaseShape = id.startsWith('circle')
    ? 'circle'
    : id.startsWith('triangle')
      ? 'triangle'
      : 'square';
  return BASE_GAME_ICONS[id] ?? layoutIcon(id, family);
}
