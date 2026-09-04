import { STRINGS, type Lang, type I18nStrings } from '../i18n';
import { roundTriPath } from './roundTri';
/**
 * Tiny blank/outline diagrams of a shape's own scoring patterns, shown in a
 * hint row under the HUD so a player can see what to aim for without having
 * to discover it by trial. Reuses the same 3-primitive vocabulary (circle /
 * rect / poly) and bounding-box-fit approach as shareCard.ts's board
 * snapshots, but simpler: no face state, no color — every pattern is drawn
 * as a plain outline, since the point is "this shape, any one color", not
 * a specific board moment.
 */
export type IconCell =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; cx: number; cy: number; half: number; rotateDeg?: number }
  | { kind: 'poly'; points: [number, number][] };

export interface PatternDef {
  /** Used as-is when there's no labelKey — for the script-neutral names
   *  ('1x4', '2+2', '1-2-1') that read the same in every language. */
  label: string;
  /** Set for a label that is a real word, so it follows the UI language. */
  labelKey?: keyof I18nStrings;
  cells: IconCell[];
  /**
   * Draw at a fixed scale instead of fitting this icon's own bounding box:
   * the pattern is centred in a square viewport this many pattern-units
   * wide. Give every icon in one shape's row the same value and their tiles
   * all come out the same size, so a pattern spread over a wider area reads
   * as *spread out* rather than as "the same shape, drawn smaller". Without
   * it each icon is fitted individually (the original behaviour).
   */
  extent?: number;
  /**
   * 竖着的那一边另给一个尺度（不给就和 extent 一样，是个正方框）。老虎机的
   * 窗口是横着的长方形：横的按最宽的图案、竖的按最高的图案各定一个，整族的
   * 图案都装进同一个长方框，棋子一样大，又比塞进正方框里大得多。
   */
  extentY?: number;
  /**
   * Fill each tile with fine diagonal lines instead of leaving it hollow.
   * For a pattern whose tiles don't touch (the diamond board's 1-2-1), an
   * outline-only drawing lets the gap between them read as one more tile;
   * hatching says which squares are the pattern and which is just space.
   */
  hatched?: boolean;
}

// Hatch fills live in <defs> and are referenced by id, so every icon on a
// page needs its own.
let hatchSeq = 0;

function bbox(cells: IconCell[]) {
  const pts: [number, number][] = [];
  for (const c of cells) {
    if (c.kind === 'circle') pts.push([c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]);
    else if (c.kind === 'rect') {
      const d = c.half * Math.SQRT2;
      pts.push([c.cx - d, c.cy - d], [c.cx + d, c.cy + d]);
    } else pts.push(...c.points);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * One piece is drawn this many viewBox units across, whatever board it
 * belongs to and whatever the pattern's own extent is — and the <svg> is
 * then sized in `em`, so a piece comes out the same size in every icon of
 * the row and the whole row scales from one CSS font-size. Fitting each
 * icon into a shared square box instead (the old behaviour) made a run of
 * four draw its pieces at a quarter the size of a 2+2's, which read as two
 * different games rather than two patterns of one.
 */
const MARK = 10;
const PER_EM = 10;
const MARGIN = 1.6;

/** Half the size of the largest piece in the icon, in the pattern's own
 *  units — the scale every icon of one shape shares. */
function unitHalf(cells: IconCell[]): number {
  let u = 0;
  for (const c of cells) {
    if (c.kind === 'circle') u = Math.max(u, c.r);
    else if (c.kind === 'rect') u = Math.max(u, c.rotateDeg ? c.half * Math.SQRT2 : c.half);
    else {
      const xs = c.points.map((p) => p[0]);
      const ys = c.points.map((p) => p[1]);
      u = Math.max(u, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2);
    }
  }
  return u || 0.5;
}

function renderPatternIconSvg(cells: IconCell[], extent?: number, hatched?: boolean, extentY = extent): string {
  if (!cells.length) return '';
  const { minX, maxX, minY, maxY } = bbox(cells);
  // `extent` still holds one shape's icons to a common span where a board
  // wants it (the diamond's spread-out 1-2-1); the piece size below is the
  // same either way.
  const scale = MARK / (2 * unitHalf(cells));
  const pad = MARGIN;
  const w = (maxX - minX) * scale + pad * 2;
  const h = (maxY - minY) * scale + pad * 2;
  const extraX = extent ? Math.max(0, (extent * scale - (maxX - minX) * scale) / 2) : 0;
  const extraY = extentY ? Math.max(0, (extentY * scale - (maxY - minY) * scale) / 2) : 0;
  const W = w + extraX * 2;
  const H = h + extraY * 2;
  const T = (x: number, y: number): [number, number] => [
    (x - minX) * scale + pad + extraX,
    (y - minY) * scale + pad + extraY,
  ];
  const shapes = cells
    .map((c) => {
      if (c.kind === 'circle') {
        const [cx, cy] = T(c.cx, c.cy);
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(c.r * scale).toFixed(1)}"/>`;
      }
      if (c.kind === 'rect') {
        const [cx, cy] = T(c.cx, c.cy);
        const h2 = c.half * scale;
        const rot = c.rotateDeg ? ` transform="rotate(${c.rotateDeg} ${cx.toFixed(1)} ${cy.toFixed(1)})"` : '';
        return `<rect x="${(cx - h2).toFixed(1)}" y="${(cy - h2).toFixed(1)}" width="${(h2 * 2).toFixed(1)}" height="${(h2 * 2).toFixed(1)}" rx="${(h2 * 0.3).toFixed(1)}"${rot}/>`;
      }
      // 三角走 roundTri.ts 那一条磨圆的轮廓，和棋盘上、教学里的三角同一个形
      // 状——图示上画的就该是玩家在棋盘上看见的那枚。（三个点之外的多边形眼
      // 下没有，留一条老路兜着。）
      const at = c.points.map(([x, y]) => T(x, y));
      if (at.length === 3) return `<path d="${roundTriPath(at)}"/>`;
      const pts = at.map((v) => v.map((n) => n.toFixed(1)).join(',')).join(' ');
      return `<polygon points="${pts}"/>`;
    })
    .join('');
  const box = `viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${(W / PER_EM).toFixed(3)}em" height="${(H / PER_EM).toFixed(3)}em"`;
  if (!hatched) {
    // Filled pieces with a light rule around each, not hollow outlines: on
    // the play screen this row sits on a dark ground where an outline
    // drawing all but disappears, and a filled mark reads at a glance as
    // "four of these, like so".
    return `<svg ${box} fill="currentColor" stroke="var(--mark-edge, #fff)" stroke-width="2" stroke-linejoin="round">${shapes}</svg>`;
  }
  const id = `pat-hatch-${hatchSeq++}`;
  const defs =
    `<defs><pattern id="${id}" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="3.2" stroke="currentColor" stroke-width="1.5" opacity="0.8"/>` +
    `</pattern></defs>`;
  return `<svg ${box} fill="url(#${id})" stroke="var(--mark-edge, #fff)" stroke-width="2" stroke-linejoin="round">${defs}${shapes}</svg>`;
}

/**
 * The scoring patterns: one small diagram per pattern, for this shape's own
 * set. The name goes on the icon as its accessible label rather than under
 * it in print — a line of type would compete with the readouts beside it,
 * and the diagrams say what they are without being named.
 *
 * 一枚一枚地返回，不是连成一条字符串：横屏里这一批要劈成两半，一半贴棋盘
 * 左边、一半贴右边（见 gameShell），劈的时候要按「第几枚」来数，而不是去
 * 切一段 HTML。
 */
export function renderPatternHintIcons(patterns: PatternDef[], lang: Lang): string[] {
  return patterns.map((p) => {
    const label = p.labelKey ? (STRINGS[lang][p.labelKey] as string) : p.label;
    return `<span class="pattern-icon" role="img" aria-label="${label}">${renderPatternIconSvg(p.cells, p.extent, p.hatched, p.extentY)}</span>`;
  });
}

