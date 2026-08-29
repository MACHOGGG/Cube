import { STRINGS, type Lang, type I18nStrings } from '../i18n';
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

const VIEW = 40;
const MARGIN = 3;

function renderPatternIconSvg(cells: IconCell[], extent?: number, hatched?: boolean): string {
  if (!cells.length) return '';
  const { minX, maxX, minY, maxY } = bbox(cells);
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = (VIEW - MARGIN * 2) / (extent ?? Math.max(w, h));
  const offX = (VIEW - w * scale) / 2 - minX * scale;
  const offY = (VIEW - h * scale) / 2 - minY * scale;
  const T = (x: number, y: number): [number, number] => [x * scale + offX, y * scale + offY];
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
        return `<rect x="${(cx - h2).toFixed(1)}" y="${(cy - h2).toFixed(1)}" width="${(h2 * 2).toFixed(1)}" height="${(h2 * 2).toFixed(1)}"${rot}/>`;
      }
      const pts = c.points.map(([x, y]) => T(x, y).map((v) => v.toFixed(1)).join(',')).join(' ');
      return `<polygon points="${pts}"/>`;
    })
    .join('');
  if (!hatched) {
    return `<svg viewBox="0 0 ${VIEW} ${VIEW}" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">${shapes}</svg>`;
  }
  const id = `pat-hatch-${hatchSeq++}`;
  // Sized in viewBox units against a 26-30px render, so the strokes have
  // to be generous or they vanish at icon size.
  const defs =
    `<defs><pattern id="${id}" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="3.2" stroke="currentColor" stroke-width="1.5" opacity="0.8"/>` +
    `</pattern></defs>`;
  return (
    `<svg viewBox="0 0 ${VIEW} ${VIEW}" width="30" height="30" fill="url(#${id})" stroke="currentColor" ` +
    `stroke-width="2.2" stroke-linejoin="round">${defs}${shapes}</svg>`
  );
}

/** Renders the full hint row: one small outline icon + label per pattern, for the given shape's own set of scoring patterns. */
export function renderPatternHintRow(patterns: PatternDef[], lang: Lang): string {
  return patterns
    .map((p) => {
      const label = p.labelKey ? (STRINGS[lang][p.labelKey] as string) : p.label;
      return `<span class="pattern-icon">${renderPatternIconSvg(p.cells, p.extent, p.hatched)}<span class="pattern-icon-label">${label}</span></span>`;
    })
    .join('');
}
