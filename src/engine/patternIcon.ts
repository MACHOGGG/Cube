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
  label: string;
  cells: IconCell[];
}

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

function renderPatternIconSvg(cells: IconCell[]): string {
  if (!cells.length) return '';
  const { minX, maxX, minY, maxY } = bbox(cells);
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = (VIEW - MARGIN * 2) / Math.max(w, h);
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
  return `<svg viewBox="0 0 ${VIEW} ${VIEW}" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">${shapes}</svg>`;
}

/** Renders the full hint row: one small outline icon + label per pattern, for the given shape's own set of scoring patterns. */
export function renderPatternHintRow(patterns: PatternDef[]): string {
  return patterns
    .map((p) => `<span class="pattern-icon">${renderPatternIconSvg(p.cells)}<span class="pattern-icon-label">${p.label}</span></span>`)
    .join('');
}
