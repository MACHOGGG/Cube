export type Cell = readonly [row: number, col: number];

export interface Tile {
  id: number;
  /** index into the shape's color palette — the printed "flavor" face */
  color: number;
  face: 'flavor' | 'dot';
  /** index into the palette this tile shows once flipped to its dot face */
  dotColor: number;
}

export interface Match {
  cells: Cell[];
  points: number;
  /** Which pattern paid out, for the gain bubble ("4连", "2×2", "大三角"…). */
  label?: string;
}

export function effColor(t: Tile): number {
  return t.face === 'dot' ? t.dotColor : t.color;
}

export function cellKey(r: number, c: number): string {
  return r + ',' + c;
}
