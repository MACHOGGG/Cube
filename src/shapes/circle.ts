import './circle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnOutlineEl } from '../engine/scoreOutline';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame } from './types';

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

const GLYPH = `<svg viewBox="0 0 32 32"><circle cx="16" cy="7" r="6" fill="#C0666B"/><circle cx="8" cy="20" r="6" fill="#DDA857"/><circle cx="24" cy="20" r="6" fill="#4F72C4"/></svg>`;

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
    mount(container, onBack) {
      const refs = buildShell(container, {
        title: 'Slides · 圆球',
        tagline: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平、左斜或右斜方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '沿任意一条水平、左斜或右斜方向的线拖动，一条线上连续 4 个同色（不分点/面）得 4 分；同色的"22"菱形（2+2 两行）或"121"菱形（1+2+1 三行）同样得 4 分。得分方块翻成点面。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得 36 分（不移出棋盘）。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。全部翻成点面时结束，结算当时的分数。',
        assumptions:
          '4 种口味色，每色 7 枚，共 28 枚；每种口味的点色分布为：其余 3 色各 2 枚、本色 1 枚。三角堆叠结构有水平、左斜、右斜三个滑动方向，判分规则完全一致；2×2 图案在此结构下没有直接对应，改用"22"/"121"两种沿斜向的小菱形代替。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = PALETTES[paletteName];
      let grid: Tile[][] = [];
      let R = 0,
        rowH = 0,
        boardTop = 0,
        boardLeft = 0;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      let bonusedSignatures = new Set<string>();

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
        if (tile.face === 'dot') {
          // A same-shape smaller circle here reads as "still the front, just
          // resized" — nothing else on this board changes shape on flip, so
          // a ball needs a genuinely different glyph. A drawn asterisk
          // (three crossing strokes) rather than the "*" character keeps it
          // perfectly centered and a consistent weight across browsers/fonts.
          el.style.background = 'transparent';
          const starSize = Math.round(size * 0.62);
          const color = COLORS[tile.dotColor];
          el.innerHTML =
            `<svg viewBox="0 0 24 24" width="${starSize}" height="${starSize}">` +
            `<g stroke="${color}" stroke-width="3.2" stroke-linecap="round">` +
            `<line x1="12" y1="2.5" x2="12" y2="21.5"/>` +
            `<line x1="4" y1="6.75" x2="20" y2="17.25"/>` +
            `<line x1="20" y1="6.75" x2="4" y2="17.25"/>` +
            `</g></svg>`;
        } else {
          el.style.background = COLORS[tile.color];
        }
        if (opacity !== undefined) el.style.opacity = String(opacity);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        return el;
      }

      function render() {
        layoutBoard();
        refs.boardEl.innerHTML = '';
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c <= r; c++) {
            refs.boardEl.appendChild(makeBallEl(grid[r][c], r, c));
          }
        }
        // One circular outline per ball, not one rectangle around the whole
        // group — balls don't tile edge-to-edge like the square board's
        // tiles, so a bounding box would highlight empty margin between
        // them instead of tracing the actual scored balls.
        const size = R * 1.86;
        for (const { cells, elapsedMs } of outlineTracker.current()) {
          for (const [r, c] of cells) {
            const [cx, cy] = ballCenter(r, c);
            spawnOutlineEl(refs.boardEl, { left: cx - size / 2, top: cy - size / 2, width: size, height: size }, elapsedMs, 'circle');
          }
        }
      }

      // ---------- matching engine ----------
      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const windowCells = cells.slice(i, i + 4);
            const c0 = effColor(grid[windowCells[0][0]][windowCells[0][1]]);
            if (!windowCells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
            if (mask && !windowCells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
            matches.push({ cells: windowCells, points: 4 });
          }
        }
        for (const cells of CLUSTERS) {
          const c0 = effColor(grid[cells[0][0]][cells[0][1]]);
          if (!cells.every(([r, c]) => effColor(grid[r][c]) === c0)) continue;
          if (mask && !cells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
          matches.push({ cells, points: 4 });
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

      function applyLineBonus(groups: Cell[][]) {
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const t = grid[r][c];
            if (t.face === 'flavor') t.face = 'dot';
          }
        }
      }

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches: findRunMatches,
          findLineBonuses: findWholeLineBonuses,
          bonusPointsPerLine: 36,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
        };
      }

      function isGameOver(): boolean {
        return grid.every((row) => row.every((t) => t.face === 'dot'));
      }

      function resetBoard() {
        grid = generateCleanBoard();
        bonusedSignatures = new Set();
        outlineTracker.reset();
      }

      const controller = createGameController(refs, {
        bestKey,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        // Unlike the square grid, a whole-line bonus here never removes
        // cells from the board, so both kinds of group stay outline-safe —
        // added to the tracker per cascade step (not once for the whole
        // move) so a chain reaction's outlines appear one beat at a time.
        onCascadeStep: ({ matchGroups, lineBonusGroups }) => outlineTracker.add([...matchGroups, ...lineBonusGroups]),
      });

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

        // Shorter lines (near the triangle's apex) have real empty margin
        // beside them to fade a wraparound ghost into, but this board's
        // *longest* lines (length ROWS, along the triangle's base or its
        // longest diagonal) run flush with the triangular arrangement's own
        // edge — there's no slack there, same as every line on the hex
        // triangle board, so an overshooting real ball or ghost pokes past
        // the triangle's silhouette into the board element's square corner
        // padding instead of off the board entirely. A hairline's tolerance
        // (float-jitter safety, not visual slack) keeps that from happening
        // while still letting short-line ghosts fade in gracefully.
        const EDGE_EPS = 0.03;
        for (let i = 0; i < n; i++) {
          const [r, c] = d.cells[i];
          const [cx, cy] = ballCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + rawDist * dirX + 'px';
            el.style.top = cy - size / 2 + rawDist * dirY + 'px';
            const pos = i + rawDist;
            el.style.opacity = pos < -EDGE_EPS || pos > n - 1 + EDGE_EPS ? '0' : '';
          }
        }
        for (let k = -1; k <= 1; k++) {
          if (k === 0) continue;
          for (let i = 0; i < n; i++) {
            const pos = i + rawDist + k * n;
            if (pos < -EDGE_EPS || pos > n - 1 + EDGE_EPS) continue;
            const [r0, c0] = d.cells[i];
            const [baseX, baseY] = ballCenter(r0, c0);
            const shiftedX = baseX + (pos - i) * dirX;
            const shiftedY = baseY + (pos - i) * dirY;
            const ghost = makeBallEl(grid[r0][c0], r0, c0, 0.42);
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
        const mask = new Set<string>(d.cells.map(([r, c]) => cellKey(r, c)));
        controller.resolveMove(mask);
        return true;
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onStart(x, y) {
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, cells: [], dx: 0, dy: 0, R, rowH };
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

      refs.buttons.extra['paletteBtn'].addEventListener('click', (e) => {
        paletteName = paletteName === 'standard' ? 'colorblind' : 'standard';
        COLORS = PALETTES[paletteName];
        (e.currentTarget as HTMLElement).classList.toggle('active', paletteName === 'colorblind');
        renderLegend();
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
