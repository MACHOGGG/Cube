export type Cell = readonly [row: number, col: number];

export interface Tile {
  id: number;
  /** index into the shape's color palette — the printed "flavor" face */
  color: number;
  face: 'flavor' | 'dot';
  /** index into the palette this tile shows once flipped to its dot face */
  dotColor: number;
  /**
   * 炸弹玩法：这一枚炸弹挨过几下（得分图案贴着它消掉一次算一下）。两下才拆，
   * 第一下只裂——见 engine/bomb.ts 的 BOMB_HITS_TO_DEFUSE。
   *
   * 记在棋子上而不是记在格子上：行列一滑，格子里换的是另一枚棋子，裂纹得跟着
   * 挨过打的那一枚走。非炸弹棋子永远是 undefined。
   */
  bombHits?: number;
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
