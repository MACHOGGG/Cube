import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { vibrate } from '../engine/haptics';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnOutlineEl, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { extendRunInLine, growParallelogram } from '../engine/matchGrowth';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintRow, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import { BOMB_RED_HEX, BOMB_HAZARD_PENALTY, BOMB_HAZARD_REASON } from '../engine/bomb';
import { STRINGS as MATCH_LABELS, STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
import type { ShapeGame, ShapeGameOpts } from './types';

// The colorblind set is 4 hues picked from the Okabe–Ito palette for maximum
// separation (vermillion/yellow/bluish-green/blue) rather than just the
// first 4 of the square board's 6 — with only 4 colors to tell apart there's
// room to pick the most distinct ones instead of reusing a prefix.
const PALETTES = {
  standard: ['#C0666B', '#DDA857', '#7A9C4A', '#4F72C4'],
  colorblind: ['#D55E00', '#F0E442', '#009E73', '#0072B2'],
} as const;
const ROWS = 7; // row r (0..6) has r+1 balls, total 28
const PER_COLOR = 7;
const MIN_LINE_BONUS_LEN = 3;

// Bomb mode reuses the exact same 4-color, 7-per-color deck as the base
// game — it doesn't drop colors or reserve extra board slots for red. It
// just reinterprets slot 0 (each palette's own reddish hue) as the hazard
// color: those 7 balls never flip, and no other ball is ever assigned red
// as its dot color.
const BOMB_PALETTES = {
  standard: PALETTES.standard.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
  colorblind: PALETTES.colorblind.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
} as const;
const RED_IDX = 0;

const GLYPH = `<svg viewBox="0 0 32 32"><circle cx="16" cy="7" r="6" fill="#C0666B"/><circle cx="8" cy="20" r="6" fill="#DDA857"/><circle cx="24" cy="20" r="6" fill="#4F72C4"/></svg>`;

// The board's 3 seed patterns (see findMatches/CLUSTERS below), positioned
// with the exact same (r,c) -> screen transform the live board uses, drawn
// as blank outlines for the in-HUD pattern hint. iconPos's (r,c) offsets
// are copied verbatim from rhombus22B/diamond121's own cell lists.
function iconPos(r: number, c: number): [number, number] {
  return [(c - r / 2) * 2, r * Math.sqrt(3)];
}
const PATTERNS: PatternDef[] = [
  {
    label: '1×4',
    cells: [0, 1, 2, 3].map((c) => {
      const [cx, cy] = iconPos(3, c);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
  {
    label: '2+2',
    cells: ([[0, 0], [0, 1], [1, 0], [1, 1]] as const).map(([r, c]) => {
      const [cx, cy] = iconPos(r, c);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
  {
    label: '1-2-1',
    cells: ([[0, 0], [1, 0], [1, 1], [2, 1]] as const).map(([r, c]) => {
      const [cx, cy] = iconPos(r, c);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
];

type Fam = 'A' | 'B' | 'R';

interface Line {
  fam: Fam;
  cells: Cell[];
}

// family A ("right-slant", visually down-right): fixed d = r - c
// family B ("left-slant", visually down-left): fixed e = c
// family R ("row", horizontal): fixed r, c runs 0..r
function lineA(d: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = d; r < ROWS; r++) cells.push([r, r - d]);
  return cells;
}
function lineB(e: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = e; r < ROWS; r++) cells.push([r, e]);
  return cells;
}
function lineRow(r: number): Cell[] {
  const cells: Cell[] = [];
  for (let c = 0; c <= r; c++) cells.push([r, c]);
  return cells;
}
function allLines(): Line[] {
  const lines: Line[] = [];
  for (let d = 0; d < ROWS; d++) lines.push({ fam: 'A', cells: lineA(d) });
  for (let e = 0; e < ROWS; e++) lines.push({ fam: 'B', cells: lineB(e) });
  for (let r = 0; r < ROWS; r++) lines.push({ fam: 'R', cells: lineRow(r) });
  return lines;
}
const LINES = allLines();

function cellValid(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c <= r;
}

// The board's two non-linear bonus shapes, the closest analogue this
// triangular packing has to the square board's 2×2 — built the same way a
// square 2×2 is: one step along each of two of the board's directions from a
// shared corner, rather than 4-in-a-row along just one. "22": a small
// parallelogram, 2 balls along the row direction repeated one step along a
// diagonal (so 2 balls in each of 2 rows) — it has two mirror-image
// orientations (leaning the other way), both counted. "121": a small rhombus
// one step further along each diagonal from a single corner, spanning 3 rows
// 1/2/1 balls wide.
function rhombus22B(r: number, c: number): Cell[] | null {
  const cells: Cell[] = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
  return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
}
function rhombus22A(r: number, c: number): Cell[] | null {
  const cells: Cell[] = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c + 2]];
  return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
}
function diamond121(r: number, c: number): Cell[] | null {
  const cells: Cell[] = [[r, c], [r + 1, c], [r + 1, c + 1], [r + 2, c + 1]];
  return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
}
function allClusters(): Cell[][] {
  const groups: Cell[][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= r; c++) {
      const b = rhombus22B(r, c);
      if (b) groups.push(b);
      const a = rhombus22A(r, c);
      if (a) groups.push(a);
      const d = diamond121(r, c);
      if (d) groups.push(d);
    }
  return groups;
}
const CLUSTERS = allClusters();

// The three diagonal/row directions of this triangular ball packing are
// exactly 60° apart, and one index-step along any of them is the same
// physical distance (2R) — a row of balls has no up/down alternation to
// zigzag around, unlike the triangle board's row direction.
function famVector(fam: Fam, R: number, rowH: number): [number, number] {
  if (fam === 'A') return [R, rowH];
  if (fam === 'B') return [-R, rowH];
  return [2 * R, 0];
}

// How many pixels of the drag point along this family's direction — used
// only to pick the best-aligned family (compares fairly here because all
// three vectors share the same magnitude 2R).
function scalarProjection(fam: Fam, dx: number, dy: number, R: number, rowH: number): number {
  const [ux, uy] = famVector(fam, R, rowH);
  return (dx * ux + dy * uy) / Math.hypot(ux, uy);
}

// How many index-steps along this family's line the drag corresponds to:
// the orthogonal-projection coefficient rawDist such that rawDist*v best
// matches the raw drag vector, i.e. (drag·v)/|v|² — NOT (drag·v)/|v|, which
// would leave every step this line's own magnitude (2R) too large, making a
// drag as short as one cell-width already read as if the player had dragged
// the full line around several times.
function projectedSteps(fam: Fam, dx: number, dy: number, R: number, rowH: number): number {
  const [ux, uy] = famVector(fam, R, rowH);
  const proj = dx * ux + dy * uy;
  return proj / (ux * ux + uy * uy);
}

interface DragState {
  r: number;
  c: number;
  fam: Fam | null;
  cells: Cell[];
  dx: number;
  dy: number;
  R: number;
  rowH: number;
  lastShift: number;
}

export function createCircleGame(): ShapeGame {
  const bestKey = 'sugarcube_circles_best';

  return {
    card: {
      id: 'circle',
      name: '圆球',
      desc: '沿斜线拖动 · 三角堆叠圆球',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const isBomb = !!opts?.bomb;
      const lang = opts?.lang ?? 'zhHans';
      const refs = buildShell(container, {
        lang,
        title: `Slides · ${shapeName(lang, 'circle', '圆球')}`,
        tagline: isBomb ? SHELL[lang].taglineThreeWay + ' · ' + SHELL[lang].taglineBomb : SHELL[lang].taglineThreeWay,
        startBody: SHELL[lang].shellStartBody,
        extraControls: [{ id: 'paletteBtn', label: SHELL[lang].colorblindBtn }],
        patternHint: renderPatternHintRow(PATTERNS, lang),
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = isBomb ? BOMB_PALETTES[paletteName] : PALETTES[paletteName];
      let grid: Tile[][] = [];
      let R = 0,
        rowH = 0,
        boardTop = 0,
        boardLeft = 0;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      let bonusedSignatures = new Set<string>();
      // A whole-line dot-face bonus doesn't remove its cells the way square
      // or triangle do: this board's triangular packing means a removed
      // line can split the remaining balls into pieces no longer connected
      // by any shared line, permanently stranding them from each other. So
      // instead the bonused cells become permanently "blank" — a distinct
      // colorless state that stays on the board, keeps sliding with its
      // line exactly like any other ball, but can never again take part in
      // a match, cluster, or line bonus. BLANK is a sentinel value stored in
      // a tile's own color/dotColor fields (rather than a separate flag) so
      // every color-comparison call site "just works" without special-
      // casing, as long as it also checks isBlank first.
      const BLANK = -1;
      function isBlank(t: Tile): boolean {
        return t.color === BLANK;
      }
      function anyBlank(cells: Cell[]): boolean {
        return cells.some(([r, c]) => isBlank(grid[r][c]));
      }
      // Cells whose flip to their dot face just landed (set in onCommit,
      // consumed and cleared by the very next render()) — those cells get a
      // one-shot .flip-in animation class so the flip itself has motion
      // instead of the face silently swapping.
      let flipInCells = new Set<string>();
      // Cells GameController told us (via highlightStuck) to draw the red
      // "this can never score again" glow around, right before ending the run.
      let stuckKeys: Set<string> | null = null;

      function newTile(color: number, dotColor: number): Tile {
        return { id: nextTileId++, color, face: 'flavor', dotColor };
      }

      function shuffledDeck(): number[] {
        const deck: number[] = [];
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < PER_COLOR; i++) deck.push(c);
        return shuffle(deck);
      }

      // per color group of 7: the other 3 colors get 2 each (6) + the tile's
      // own color once (7) — matches the physical set's back-color
      // distribution.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; k < COLORS.length; k++) if (k !== color) others.push(k, k);
          others.push(color);
          shuffle(others);
          const indices: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) indices.push(idx);
          });
          indices.forEach((idx, i) => {
            dotColors[idx] = others[i];
          });
        }
        return dotColors;
      }

      function boardFromDeck(deck: number[]): Tile[][] {
        const dots = assignDotColors(deck);
        const g: Tile[][] = [];
        let idx = 0;
        for (let r = 0; r < ROWS; r++) {
          const row: Tile[] = [];
          for (let c = 0; c <= r; c++) {
            row.push(newTile(deck[idx], dots[idx]));
            idx++;
          }
          g.push(row);
        }
        return g;
      }

      function hasInitialClump(g: Tile[][]): boolean {
        for (const line of LINES) {
          const colors = line.cells.map(([r, c]) => g[r][c].color);
          for (let i = 0; i + 3 < colors.length; i++) {
            if (colors[i] === colors[i + 1] && colors[i] === colors[i + 2] && colors[i] === colors[i + 3])
              return true;
          }
        }
        for (const cells of CLUSTERS) {
          const c0 = g[cells[0][0]][cells[0][1]].color;
          if (cells.every(([r, c]) => g[r][c].color === c0)) return true;
        }
        return false;
      }

      function generateCleanBoard(): Tile[][] {
        let g: Tile[][];
        let tries = 0;
        do {
          g = boardFromDeck(shuffledDeck());
          tries++;
        } while (hasInitialClump(g) && tries < 500);
        return g;
      }

      // ---------- bomb mode: red hazard balls ----------
      // Same deck as the base game (4 colors x 7 balls = 28) — shuffledDeck()
      // already reads from COLORS, which is BOMB_PALETTES here, so it needs
      // no bomb-specific variant.

      // Per non-red front-color group of 7: the other 2 non-red colors get 3
      // dot-color slots each (6), and the tile's own front color gets the
      // 7th — red is excluded from every dot-color pool since red balls
      // never flip and never need one.
      function assignBombDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length).fill(RED_IDX);
        for (let color = 0; color < COLORS.length; color++) {
          if (color === RED_IDX) continue;
          const others = Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== color && k !== RED_IDX);
          const pool = shuffle([...others.flatMap((o) => [o, o, o]), color]);
          const indices: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) indices.push(idx);
          });
          indices.forEach((idx, i) => {
            dotColors[idx] = pool[i];
          });
        }
        return dotColors;
      }

      function boardFromBombDeck(deck: number[]): Tile[][] {
        const dots = assignBombDotColors(deck);
        const g: Tile[][] = [];
        let idx = 0;
        for (let r = 0; r < ROWS; r++) {
          const row: Tile[] = [];
          for (let c = 0; c <= r; c++) {
            row.push(newTile(deck[idx], dots[idx]));
            idx++;
          }
          g.push(row);
        }
        return g;
      }

      // The 6-neighbor adjacency of this triangular ball packing: the two
      // balls in the same row, and two each in the row above/below (derived
      // from ballCenter's own coordinate formula — every one of these sits
      // at exactly the same center-to-center distance as its row neighbors).
      function circleNeighbors(r: number, c: number): Cell[] {
        const cands: Cell[] = [
          [r, c - 1], [r, c + 1],
          [r - 1, c - 1], [r - 1, c],
          [r + 1, c], [r + 1, c + 1],
        ];
        return cands.filter(([rr, cc]) => cellValid(rr, cc));
      }

      function redClusterKeys(g: Tile[][], minSize: number): Set<string> {
        const found = new Set<string>();
        const seen = new Set<string>();
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c <= r; c++) {
            if (g[r][c].color !== RED_IDX) continue;
            const startKey = cellKey(r, c);
            if (seen.has(startKey)) continue;
            const comp: string[] = [];
            const stack: Cell[] = [[r, c]];
            seen.add(startKey);
            while (stack.length) {
              const [cr, cc] = stack.pop()!;
              comp.push(cellKey(cr, cc));
              for (const [nr, nc] of circleNeighbors(cr, cc)) {
                const key = cellKey(nr, nc);
                if (seen.has(key) || g[nr][nc].color !== RED_IDX) continue;
                seen.add(key);
                stack.push([nr, nc]);
              }
            }
            if (comp.length >= minSize) for (const k of comp) found.add(k);
          }
        return found;
      }

      // A 4-cluster ends the run outright; a 3-cluster is one drag away
      // from it, so render() pulses those tiles as an early warning.
      function hasRedCluster(g: Tile[][]): boolean {
        return redClusterKeys(g, 4).size > 0;
      }

      function generateCleanBombBoard(): Tile[][] {
        let g: Tile[][];
        let tries = 0;
        do {
          g = boardFromBombDeck(shuffledDeck());
          tries++;
        } while ((hasInitialClump(g) || hasRedCluster(g)) && tries < 500);
        return g;
      }

      function renderLegend() {
        refs.legendEl.innerHTML = COLORS.map((hex) => `<span class="swatch" style="background:${hex}"></span>`).join('');
      }

      function layoutBoard() {
        const rect = refs.boardWrap.getBoundingClientRect();
        const S = Math.min(rect.width, rect.height);
        R = S / 14;
        rowH = R * Math.sqrt(3);
        const totalH = (ROWS - 1) * rowH + 2 * R;
        boardTop = (S - totalH) / 2;
        boardLeft = S / 2; // center x, per-row offset applied in position calc
        refs.boardEl.style.width = S + 'px';
        refs.boardEl.style.height = S + 'px';
      }

      function ballCenter(r: number, c: number): [number, number] {
        const cx = boardLeft + (c - r / 2) * 2 * R;
        const cy = boardTop + R + r * rowH;
        return [cx, cy];
      }

      function makeBallEl(tile: Tile, r: number, c: number, opacity?: number): HTMLElement {
        const [cx, cy] = ballCenter(r, c);
        const size = R * 1.86;
        const el = document.createElement('div');
        el.className = 'ball';
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = cx - size / 2 + 'px';
        el.style.top = cy - size / 2 + 'px';
        if (isBlank(tile)) {
          // Spent: no color on either face, just a dim neutral disc so it
          // still reads clearly as "a ball is here" (still slides with its
          // line) without looking like a live front or dot color. The
          // explicit `opacity` param, applied below when the caller passes
          // one (e.g. a drag ghost), overrides this dimming.
          el.style.background = 'var(--ink-faint)';
          el.style.opacity = '0.35';
        } else if (tile.face === 'dot') {
          // A same-shape smaller circle here reads as "still the front, just
          // resized" — nothing else on this board changes shape on flip, so
          // a ball needs a genuinely different glyph. A drawn asterisk
          // (three crossing strokes) rather than the "*" character keeps it
          // perfectly centered and a consistent weight across browsers/fonts.
          el.style.background = 'transparent';
          const starSize = Math.round(size * 0.95);
          const color = COLORS[tile.dotColor];
          el.innerHTML =
            `<svg viewBox="0 0 24 24" width="${starSize}" height="${starSize}">` +
            `<g stroke="${color}" stroke-width="5.5" stroke-linecap="round">` +
            `<line x1="12" y1="2.5" x2="12" y2="21.5"/>` +
            `<line x1="4" y1="6.75" x2="20" y2="17.25"/>` +
            `<line x1="20" y1="6.75" x2="4" y2="17.25"/>` +
            `</g></svg>`;
        } else {
          el.style.background = COLORS[tile.color];
          if (isBomb && tile.color === RED_IDX) {
            const mark = document.createElement('div');
            mark.className = 'hazard-mark';
            mark.textContent = '!';
            mark.style.fontSize = Math.round(size * 0.5) + 'px';
            el.appendChild(mark);
          }
        }
        if (opacity !== undefined) el.style.opacity = String(opacity);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        return el;
      }

      function render() {
        layoutBoard();
        refs.boardEl.innerHTML = '';
        const outlineEntries = outlineTracker.current();
        const pulseMs = new Map<string, number>();
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) pulseMs.set(cellKey(r, c), elapsedMs);
        }
        const warnKeys = isBomb ? redClusterKeys(grid, 3) : null;
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c <= r; c++) {
            const key = cellKey(r, c);
            const el = makeBallEl(grid[r][c], r, c);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key));
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            if (warnKeys?.has(key)) el.classList.add('hazard-warn');
            refs.boardEl.appendChild(el);
          }
        }
        flipInCells = new Set();
        // One circular outline per ball, not one rectangle around the whole
        // group — balls don't tile edge-to-edge like the square board's
        // tiles, so a bounding box would highlight empty margin between
        // them instead of tracing the actual scored balls.
        const size = R * 1.86;
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) {
            const [cx, cy] = ballCenter(r, c);
            spawnOutlineEl(refs.boardEl, { left: cx - size / 2, top: cy - size / 2, width: size, height: size }, elapsedMs, 'circle');
          }
        }
      }

      // ---------- matching engine ----------
      // A match only ever grows along its *own* seed shape's regular
      // directions (see matchGrowth.ts) — never a generic same-color flood
      // fill, which used to happily fold in any same-color tile touching
      // the seed from any direction at all. A run-4 only extends further
      // along that same line; a 22 rhombus only extends by a full extra
      // row/column of its own parallelogram; a 121 diamond doesn't extend
      // at all (it's a closed shape, not an open-ended one) — it always
      // scores exactly its own 4 cells.
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }
      function isLiveCell(r: number, c: number): boolean {
        return cellValid(r, c) && !isBlank(grid[r][c]);
      }
      function qualifies(seed: Cell[], mask: Set<string> | null): boolean {
        if (anyBlank(seed)) return false;
        const c0 = effColor(grid[seed[0][0]][seed[0][1]]);
        // Red hazard tiles are obstacles, not a matchable color.
        if (isBomb && c0 === RED_IDX) return false;
        if (!seed.every(([r, c]) => effColor(grid[r][c]) === c0)) return false;
        if (mask && !seed.some(([r, c]) => mask.has(cellKey(r, c)))) return false;
        return true;
      }

      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const seed = cells.slice(i, i + 4);
            if (!qualifies(seed, mask)) continue;
            const region = extendRunInLine(cells, i, i + 3, effColorAt, isLiveCell);
            matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelRun4 });
          }
        }
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c <= r; c++) {
            // rhombus22B's 4 offsets are (r, c) + u*(0,1) + v*(1,0) for
            // u,v in {0,1} — a step along the row, and a step down a
            // diagonal.
            const b = rhombus22B(r, c);
            if (b && qualifies(b, mask)) {
              const positionAt = (u: number, v: number): Cell | null => {
                const cell: Cell = [r + v, c + u];
                return cellValid(cell[0], cell[1]) ? cell : null;
              };
              const region = growParallelogram(positionAt, effColorAt, isLiveCell);
              matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelBlock22 });
            }
            // rhombus22A's 4 offsets are (r, c) + u*(0,1) + v*(1,1) — a step
            // along the row, and a step along the *other* diagonal.
            const a = rhombus22A(r, c);
            if (a && qualifies(a, mask)) {
              const positionAt = (u: number, v: number): Cell | null => {
                const cell: Cell = [r + v, c + u + v];
                return cellValid(cell[0], cell[1]) ? cell : null;
              };
              const region = growParallelogram(positionAt, effColorAt, isLiveCell);
              matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelBlock22 });
            }
            const d = diamond121(r, c);
            if (d && qualifies(d, mask)) {
              matches.push({ cells: d, points: 4, label: MATCH_LABELS[lang].label121 });
            }
          }
        return matches;
      }

      // A line only qualifies once every tile in it has flipped to its dot
      // face *and* those dot colors all match — a mix of flavor-face and
      // dot-face tiles no longer counts, even if their effective colors
      // happen to agree.
      function isFullDotMatch(cells: Cell[]): boolean {
        if (cells.some(([r, c]) => grid[r][c].face !== 'dot')) return false;
        const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
        return cells.every(([r, c]) => grid[r][c].dotColor === c0);
      }

      function findWholeLineBonuses(): Cell[][] {
        const found: Cell[][] = [];
        for (const line of LINES) {
          if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
          // A line with any already-blanked cell can never qualify again —
          // a blank has no color to agree with the rest of the line.
          if (anyBlank(line.cells)) continue;
          if (!isFullDotMatch(line.cells)) continue;
          const sig = line.cells
            .map(([r, c]) => grid[r][c].id)
            .sort((a, b) => a - b)
            .join(',');
          if (bonusedSignatures.has(sig)) continue;
          bonusedSignatures.add(sig);
          found.push(line.cells);
        }
        return found;
      }

      // Flips the bonused line's tiles to their dot face (matching what the
      // player just saw complete), stashes that dot color for the fade
      // transition (see pendingBlankSnapshot below — grid is about to be
      // overwritten, so this is the last point that still has it), and then
      // blanks the cells for good.
      function applyLineBonus(groups: Cell[][]) {
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const t = grid[r][c];
            if (t.face === 'flavor') t.face = 'dot';
            pendingBlankSnapshot.set(cellKey(r, c), t.dotColor);
            t.color = BLANK;
            t.dotColor = BLANK;
          }
        }
      }

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches: findRunMatches,
          findLineBonuses: findWholeLineBonuses,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
        };
      }

      function isGameOver(): boolean {
        return grid.every((row) => row.every((t) => isBlank(t) || t.face === 'dot' || (isBomb && t.color === RED_IDX)));
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c <= r; c++) {
            const t = grid[r][c];
            if (isBlank(t)) continue;
            if (isBomb && t.color === RED_IDX) continue;
            live.push({ cell: [r, c], tile: t });
          }
        return live;
      }

      function findStuckGroups(clearedDotColors: ReadonlySet<number>): Cell[][] {
        return findStuckColorGroups(liveTiles(), clearedDotColors, isBomb ? RED_IDX : undefined);
      }

      function countRemainingTiles() {
        return countRemainingTilesFn(liveTiles());
      }

      function snapshotBoard(): BoardSnapshot {
        const rowH = Math.sqrt(3);
        const raw: RawCell[] = [];
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c <= r; c++) {
            const t = grid[r][c];
            raw.push({
              kind: 'circle',
              cx: (c - r / 2) * 2,
              cy: r * rowH,
              r: 0.95,
              face: isBlank(t) ? 'blank' : t.face,
              color: COLORS[effColor(t)],
            });
          }
        return packSnapshot(raw);
      }

      function highlightStuck(cells: Cell[] | null) {
        stuckKeys = cells ? new Set(cells.map(([r, c]) => cellKey(r, c))) : null;
      }

      function resetBoard() {
        grid = isBomb ? generateCleanBombBoard() : generateCleanBoard();
        bonusedSignatures = new Set();
        outlineTracker.reset();
        stuckKeys = null;
      }

      const controller = createGameController(refs, {
        lang,
        bestKey: isBomb ? bestKey + '_bomb' : opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: shapeName(lang, 'circle', '圆球'),
        shapeId: 'circle',
        modeKey: isBomb ? (opts?.timeLimitSec ? 'bombTimed' : 'bomb') : opts?.timeLimitSec ? 'timed' : 'base',
        timeLimitSec: opts?.timeLimitSec,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        findStuckGroups,
        countRemainingTiles,
        snapshotBoard,
        highlightStuck,
        // Regular matches (run-of-4 and the "22"/"121" clusters) stay on
        // the board, so they get the persistent outline highlight, added
        // per cascade step so a chain reaction reveals one beat at a time.
        // A whole-line bonus instead blanks its cells (see applyLineBonus)
        // — its own fade transition is that event's feedback, not outlined
        // — played in onCascadeStepRendered since the ghost must be
        // appended *after* this step's own render() or that render() would
        // wipe it.
        onCascadeStep: ({ matchGroups }) => outlineTracker.add(matchGroups, MULTI_GROUP_STAGGER_MS),
        onCascadeStepRendered: ({ lineBonusGroups }) => {
          if (lineBonusGroups.length) {
            playBlankTransition(lineBonusGroups, pendingBlankSnapshot);
            pendingBlankSnapshot = new Map();
          }
        },
        onCommit: (matchGroups) => {
          for (const cells of matchGroups) for (const [r, c] of cells) flipInCells.add(cellKey(r, c));
        },
      });

      const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const REMOVE_FADE_MS = 700;
      // Captured by applyLineBonus (the only point that still has the old
      // dot color, right before overwriting it to BLANK) and consumed here
      // once render() has painted the new blank state, so the fade shows
      // the *old* dot-colored look dissolving into the *new* blank ball
      // already sitting beneath it, rather than fading to an empty gap.
      let pendingBlankSnapshot = new Map<string, number>();

      function playBlankTransition(groups: Cell[][], snapshot: Map<string, number>) {
        if (reduceMotion()) return;
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const dotColor = snapshot.get(cellKey(r, c));
            if (dotColor === undefined) continue;
            const fakeTile: Tile = { id: -1, color: 0, face: 'dot', dotColor };
            const ghost = makeBallEl(fakeTile, r, c);
            ghost.classList.add('ghost');
            ghost.style.pointerEvents = 'none';
            ghost.style.opacity = '1';
            refs.boardEl.appendChild(ghost);
            ghost.style.transition = `opacity ${REMOVE_FADE_MS}ms ease`;
            requestAnimationFrame(() => { ghost.style.opacity = '0'; });
            setTimeout(() => ghost.remove(), REMOVE_FADE_MS + 40);
          }
        }
      }

      // ---------- drag interaction ----------
      let drag: DragState | null = null;

      function cellAt(x: number, y: number): Cell {
        let r = Math.round((y - boardTop - R) / rowH);
        r = Math.max(0, Math.min(ROWS - 1, r));
        let c = Math.round((x - boardLeft) / (2 * R) + r / 2);
        c = Math.max(0, Math.min(r, c));
        return [r, c];
      }

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam) return;
        const n = d.cells.length;
        const size = d.R * 1.86;
        const [dirX, dirY] = famVector(d.fam, d.R, d.rowH);
        const rawDist = magnetizeRawDist(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH));
        // A light tick each time the drag crosses into a new whole-step
        // shift — the discrete, physical "click" of passing a detent, felt
        // (haptics) rather than only inferred from the drag's positional easing.
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH));
        if (shift !== d.lastShift) {
          vibrate(6);
          d.lastShift = shift;
        }

        // Shorter lines (near the triangle's apex) have real empty margin
        // beside them to fade a wraparound ghost into, but this board's
        // *longest* lines (length ROWS, along the triangle's base or its
        // longest diagonal) run flush with the triangular arrangement's own
        // edge — there's no slack there, same as every line on the hex
        // triangle board. The board element itself clips overflow, though,
        // so a ball fading out over a little real distance past that edge
        // just gets cropped for the flush-edge lines instead of visually
        // leaking — letting every line fade the same soft way rather than
        // needing a hard, instant cutoff right at the edge.
        const FADE_RANGE = 0.4;
        const edgeOpacity = (pos: number) => {
          const overshoot = pos < 0 ? -pos : pos > n - 1 ? pos - (n - 1) : 0;
          return Math.max(0, 1 - overshoot / FADE_RANGE);
        };
        for (let i = 0; i < n; i++) {
          const [r, c] = d.cells[i];
          const [cx, cy] = ballCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + rawDist * dirX + 'px';
            el.style.top = cy - size / 2 + rawDist * dirY + 'px';
            const pos = i + rawDist;
            el.style.opacity = String(edgeOpacity(pos));
          }
        }
        for (let k = -1; k <= 1; k++) {
          if (k === 0) continue;
          for (let i = 0; i < n; i++) {
            const pos = i + rawDist + k * n;
            const fade = edgeOpacity(pos);
            if (fade <= 0) continue;
            const [r0, c0] = d.cells[i];
            const [baseX, baseY] = ballCenter(r0, c0);
            const shiftedX = baseX + (pos - i) * dirX;
            const shiftedY = baseY + (pos - i) * dirY;
            const ghost = makeBallEl(grid[r0][c0], r0, c0, 0.55 * fade);
            ghost.style.left = shiftedX - size / 2 + 'px';
            ghost.style.top = shiftedY - size / 2 + 'px';
            ghost.classList.add('ghost');
            refs.boardEl.appendChild(ghost);
          }
        }
      }

      // Returns whether it actually resolved a move (and thus already
      // re-rendered at least once) — the caller needs this so it doesn't
      // blindly render() again right after, which would wipe out a cascade
      // step's ghost/flip/highlight elements before they ever get a frame
      // painted (resolveMove no longer settles synchronously — see
      // gameController's stepper-driven reveal).
      // Checked right after a drag lands, before normal move resolution —
      // red tiles are never removed or flipped (see qualifies/findWholeLineBonuses
      // guards above), so the only way their adjacency ever changes is a
      // line shift landing two clusters next to each other.
      function checkBombHazard(): boolean {
        if (!isBomb || !hasRedCluster(grid)) return false;
        render();
        controller.forceEnd(BOMB_HAZARD_REASON, BOMB_HAZARD_PENALTY, '炸弹惩罚');
        return true;
      }

      function applyDrag(): boolean {
        const d = drag;
        if (!d || !d.fam) return false;
        const n = d.cells.length;
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH));
        if (((shift % n) + n) % n === 0) return false;
        const vals = d.cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[(((i - shift) % n) + n) % n]);
        d.cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        if (checkBombHazard()) return true;
        const mask = new Set<string>(d.cells.map(([r, c]) => cellKey(r, c)));
        controller.resolveMove(mask);
        return true;
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onRejected: () => vibrate(15),
        onStart(x, y) {
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, cells: [], dx: 0, dy: 0, R, rowH, lastShift: 0 };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const projA = scalarProjection('A', dx, dy, drag.R, drag.rowH);
            const projB = scalarProjection('B', dx, dy, drag.R, drag.rowH);
            const projR = scalarProjection('R', dx, dy, drag.R, drag.rowH);
            let fam: Fam = 'A';
            let best = Math.abs(projA);
            if (Math.abs(projB) > best) { fam = 'B'; best = Math.abs(projB); }
            if (Math.abs(projR) > best) { fam = 'R'; best = Math.abs(projR); }
            drag.fam = fam;
            drag.cells = fam === 'A' ? lineA(drag.r - drag.c) : fam === 'B' ? lineB(drag.c) : lineRow(drag.r);
          }
          renderDragPreview();
        },
        onEnd(dx, dy) {
          let moved = false;
          if (drag && drag.fam) {
            drag.dx = dx;
            drag.dy = dy;
            moved = applyDrag();
          }
          drag = null;
          // A resolved move already re-rendered on its own (and may still be
          // mid-reveal) — rendering again here would erase that before a
          // frame of it paints. Only a no-op drag needs this to snap the
          // preview's manual style tweaks back to a clean rest state.
          if (!moved) render();
        },
      });

      const onResize = () => {
        if (!drag && controller.started) render();
      };
      window.addEventListener('resize', onResize);

      function destroy() {
        controller.destroy();
        detachDrag();
        window.removeEventListener('resize', onResize);
      }

      refs.buttons.back.addEventListener('click', () => {
        destroy();
        onBack();
      });
      // Leaving from the start screen goes exactly where the in-game back
      // button goes — the home page, or the picker this game came from.
      refs.buttons.startBack.addEventListener('click', () => {
        destroy();
        onBack();
      });
      refs.buttons.endBack.addEventListener('click', () => {
        destroy();
        onBack();
      });

      refs.buttons.extra['paletteBtn'].addEventListener('click', (e) => {
        paletteName = paletteName === 'standard' ? 'colorblind' : 'standard';
        COLORS = isBomb ? BOMB_PALETTES[paletteName] : PALETTES[paletteName];
        (e.currentTarget as HTMLElement).classList.toggle('active', paletteName === 'colorblind');
        renderLegend();
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
