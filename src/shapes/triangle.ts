import './triangle.css';
import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnTriangleOutline } from '../engine/scoreOutline';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import type { ShapeGame } from './types';

// Same Okabe–Ito colorblind-safe 6-hue set the square board offers, reused
// as-is (see square.ts for the palette rationale) so the toggle means the
// same thing on every board.
const PALETTES = {
  standard: ['#3C4452', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#E8E4DC'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;
const ROW_LENS = [7, 9, 11, 11, 9, 7];
const LEFT_TRIM = [0, 0, 0, 1, 3, 5]; // maps local col -> global position p = c + LEFT_TRIM[r]
const GLOBAL_ROW_OFFSET = 3; // local row r -> global big-triangle row i = r+3
const PER_COLOR = 9;
const MIN_LINE_BONUS_LEN = 3;

const GLYPH = `<svg viewBox="0 0 32 32"><polygon points="16,3 29,25 3,25" fill="#4C68B0"/><polygon points="16,29 4,9 28,9" fill="#D89B1E" opacity="0.9"/></svg>`;

interface Line {
  fam: 'A' | 'B' | 'R';
  cells: Cell[];
}

// ---------- diagonal line families (pure geometry, shared by every instance) ----------
// u = column centered within its row; family A fixes d=r-u, family B fixes e=r+u.
function uOf(r: number, c: number): number {
  return c - (ROW_LENS[r] - 1) / 2;
}

function allLines(): Line[] {
  const byD = new Map<number, Cell[]>();
  const byE = new Map<number, Cell[]>();
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const u = uOf(r, c),
        d = r - u,
        e = r + u;
      if (!byD.has(d)) byD.set(d, []);
      byD.get(d)!.push([r, c]);
      if (!byE.has(e)) byE.set(e, []);
      byE.get(e)!.push([r, c]);
    }
  const lines: Line[] = [];
  byD.forEach((cells) => lines.push({ fam: 'A', cells: cells.sort((a, b) => a[0] - b[0]) }));
  byE.forEach((cells) => lines.push({ fam: 'B', cells: cells.sort((a, b) => a[0] - b[0]) }));
  // Third axis: a full horizontal row (up- and down-pointing triangles
  // interleaved). Adjacent triangles in a row are edge-sharing neighbors, so
  // this is a real third slide direction alongside the two diagonals, not
  // just a row/column convenience like the square board's.
  for (let r = 0; r < ROW_LENS.length; r++) {
    lines.push({ fam: 'R', cells: Array.from({ length: ROW_LENS[r] }, (_, c) => [r, c] as Cell) });
  }
  return lines;
}
const LINES = allLines();

function lineFor(fam: 'A' | 'B' | 'R', r: number, c: number): Line {
  const line = LINES.find((l) => l.fam === fam && l.cells.some(([rr, cc]) => rr === r && cc === c));
  if (!line) throw new Error('lineFor: cell not found in any line');
  return line;
}

interface DragState {
  r: number;
  c: number;
  fam: 'A' | 'B' | 'R' | null;
  line: Line | null;
  dx: number;
  dy: number;
}

export function createTriangleGame(): ShapeGame {
  const bestKey = 'sugarcube_triangles_best';

  return {
    card: {
      id: 'triangle',
      name: '三角',
      desc: '沿斜线拖动 · 六边蜂窝三角',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack) {
      const refs = buildShell(container, {
        title: 'Slides · 三角',
        tagline: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
        startBody: '拖动水平、左斜或右斜方向的整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
        hint:
          '沿任意一条水平、左斜或右斜方向的线拖动，一条线上连续 4 个同色（不分点/面）得 4 分，得分方块翻成点面。当一整条线（长度 ≥3）都翻成点面且点色相同时，额外得 36 分（不移出棋盘）。连续多步得分会自动加倍：第 2 步该步得分 ×2，第 3 步 ×4，以此类推无止境翻倍，一旦某步没得分就重新计数。全部翻成点面时结束，结算当时的分数。',
        assumptions:
          '6 种口味色，每色 9 枚，共 54 枚（六边形三角拼接，六行 7/9/11/11/9/7 枚）；每种口味的点色分布为：其余 5 色各 1 枚、本色 4 枚。三个滑动方向——水平（按行，6 条线）、左斜、右斜（按每行居中对齐的坐标划分，两个方向各 12 条线，长度 3–6）——判分规则完全一致。2×2 图案在此结构下没有直接对应，本版本暂不实现。',
        extraControls: [{ id: 'paletteBtn', label: '色盲友好配色' }],
      });

      let paletteName: keyof typeof PALETTES = 'standard';
      let COLORS: readonly string[] = PALETTES[paletteName];
      let grid: Tile[][] = [];
      let S = 0,
        H = 0,
        originX = 0,
        originY = 0;
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

      // per color group of 9: the other 5 colors get 1 each (5) + the tile's
      // own color four times (4) = 9 — matches the physical set's back
      // distribution.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; k < COLORS.length; k++) if (k !== color) others.push(k);
          for (let i = 0; i < 4; i++) others.push(color);
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
        for (let r = 0; r < ROW_LENS.length; r++) {
          const row: Tile[] = [];
          for (let c = 0; c < ROW_LENS[r]; c++) {
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

      // ---------- geometry: true up/down triangle vertices, from local (r,c) ----------
      function globalPos(r: number, c: number) {
        return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
      }

      function triGeometry(r: number, c: number): { up: boolean; pts: [number, number][] } {
        const { i, p } = globalPos(r, c);
        const up = p % 2 === 0;
        const j = up ? p / 2 : (p - 1) / 2;
        const xBase = (-i * S) / 2 + j * S;
        if (up) {
          const A: [number, number] = [xBase, i * H];
          const B: [number, number] = [xBase - S / 2, (i + 1) * H];
          const C: [number, number] = [xBase + S / 2, (i + 1) * H];
          return { up: true, pts: [A, B, C] };
        }
        const A: [number, number] = [xBase + S / 2, (i + 1) * H];
        const B: [number, number] = [xBase, i * H];
        const C: [number, number] = [xBase + S, i * H];
        return { up: false, pts: [A, B, C] };
      }

      function centroid(pts: [number, number][]): [number, number] {
        return [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
      }

      function layoutBoard() {
        const rect = refs.boardWrap.getBoundingClientRect();
        const boardSize = Math.min(rect.width, rect.height);
        S = boardSize / 6.4;
        H = (S * Math.sqrt(3)) / 2;
        originX = boardSize / 2;
        originY = (boardSize - 6 * H) / 2 - GLOBAL_ROW_OFFSET * H;
        refs.boardEl.style.width = boardSize + 'px';
        refs.boardEl.style.height = boardSize + 'px';
      }

      function toScreen([x, y]: [number, number]): [number, number] {
        return [x + originX, y + originY];
      }

      function makeTriEl(
        tile: Tile,
        r: number,
        c: number,
        opacityOverride?: number,
        offset?: [number, number],
      ): HTMLElement {
        const geo = triGeometry(r, c);
        const [offX, offY] = offset ?? [0, 0];
        const pts = geo.pts.map(toScreen).map(([x, y]) => [x + offX, y + offY] as [number, number]);
        const xs = pts.map((p) => p[0]),
          ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs),
          minY = Math.min(...ys);
        const maxX = Math.max(...xs),
          maxY = Math.max(...ys);
        const w = maxX - minX,
          h = maxY - minY;
        const clip =
          'polygon(' +
          pts.map((p) => `${(((p[0] - minX) / w) * 100).toFixed(2)}% ${(((p[1] - minY) / h) * 100).toFixed(2)}%`).join(',') +
          ')';

        const el = document.createElement('div');
        el.className = 'tri';
        el.style.left = minX + 'px';
        el.style.top = minY + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';

        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.style.clipPath = clip;
        fill.style.setProperty('-webkit-clip-path', clip);

        if (tile.face === 'dot') {
          const cenBase = toScreen(centroid(geo.pts));
          const cen: [number, number] = [cenBase[0] + offX, cenBase[1] + offY];
          const dsize = S * 0.5;
          const dot = document.createElement('div');
          dot.className = 'dot-circle';
          dot.style.width = dsize + 'px';
          dot.style.height = dsize + 'px';
          dot.style.left = cen[0] - minX - dsize / 2 + 'px';
          dot.style.top = cen[1] - minY - dsize / 2 + 'px';
          dot.style.background = COLORS[tile.dotColor];
          el.appendChild(fill);
          el.appendChild(dot);
        } else {
          fill.style.background = COLORS[tile.color];
          el.appendChild(fill);
        }
        if (opacityOverride !== undefined) el.style.opacity = String(opacityOverride);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        return el;
      }

      function render() {
        layoutBoard();
        refs.boardEl.innerHTML = '';
        for (let r = 0; r < ROW_LENS.length; r++) {
          for (let c = 0; c < ROW_LENS[r]; c++) {
            refs.boardEl.appendChild(makeTriEl(grid[r][c], r, c));
          }
        }
        // One triangle-shaped outline per tile, not a bounding rectangle
        // around the whole group — adjacent tiles here alternate up/down
        // orientation, so their combined outline is a zigzag, not a clean
        // box, and a rectangle would highlight empty corners no tile
        // occupies.
        for (const { cells, elapsedMs } of outlineTracker.current()) {
          for (const [r, c] of cells) {
            spawnTriangleOutline(refs.boardEl, triGeometry(r, c).pts.map(toScreen), elapsedMs);
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
          continueAfterLineBonus: false,
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
        // cells from the board, so both kinds of group stay outline-safe.
        onScored: (matchGroups, lineBonusGroups) => outlineTracker.add([...matchGroups, ...lineBonusGroups]),
      });

      // ---------- drag interaction ----------
      let drag: DragState | null = null;

      function cellAt(x: number, y: number): Cell {
        let best: Cell = [0, 0];
        let bestDist = Infinity;
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const cen = toScreen(centroid(triGeometry(r, c).pts));
            const dist = (cen[0] - x) ** 2 + (cen[1] - y) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              best = [r, c];
            }
          }
        return best;
      }

      // True per-index-step displacement (screen pixels) along each family's
      // line. A/B share a uniform S-pixel step (hypot(S/2,H)=S exactly, the
      // whole point of the u-centered coordinate system) regardless of row
      // width. A row's x-coordinate is an *exact* linear function of the
      // column — S/2 pixels per step — regardless of the up/down triangles'
      // zigzag in y, so (S/2, 0) is its true step vector and the zigzag
      // simply never enters the projection.
      function trueStepVector(fam: 'A' | 'B' | 'R'): [number, number] {
        if (fam === 'A') return [S / 2, H];
        if (fam === 'B') return [-S / 2, H];
        return [S / 2, 0];
      }

      // Pixels of the drag that point along this family's direction — used
      // only to pick the best-aligned family among the three (dividing by
      // |v| makes the comparison fair despite A/B and the row not sharing
      // one step magnitude).
      function scalarProjection(fam: 'A' | 'B' | 'R', dx: number, dy: number): number {
        const [ux, uy] = trueStepVector(fam);
        return (dx * ux + dy * uy) / Math.hypot(ux, uy);
      }

      // How many index-steps along this family's line the drag corresponds
      // to: the orthogonal-projection coefficient rawDist such that
      // rawDist*v best matches the raw drag vector, i.e. (drag·v)/|v|² — NOT
      // (drag·v)/|v|, which would leave every step read as if the player had
      // dragged the whole line's own step-length again on top of itself.
      function projectedSteps(fam: 'A' | 'B' | 'R', dx: number, dy: number): number {
        const [ux, uy] = trueStepVector(fam);
        const proj = dx * ux + dy * uy;
        return proj / (ux * ux + uy * uy);
      }

      // Every real tile in the line translates by the same rawDist*step
      // vector (exact for A/B, a smooth approximation of the row's zigzag
      // that's visually unnoticeable mid-drag and irrelevant the instant it
      // settles, since the final render() after release always uses the
      // real, non-approximated geometry). Wraparound ghosts one full line-
      // length before/after each real cell keep the line reading as an
      // unbroken loop while dragging, the same way the square and circle
      // boards already do, instead of the old clamp-at-the-ends behavior
      // that left overflow tiles stacked in place with nothing to show
      // where they were headed.
      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam || !d.line) return;
        const cells = d.line.cells;
        const n = cells.length;
        const rawDist = magnetizeRawDist(projectedSteps(d.fam, d.dx, d.dy));
        const [dirX, dirY] = trueStepVector(d.fam);

        // A family-A/B/row line here is only 3-6 cells, much shorter than
        // the board's own span, so — unlike the square board's full-width
        // rows — a real tile shifted more than about half a slot past
        // either end of its *own* short line has visually wrapped, not just
        // moved; left visible, it drifts into whatever empty margin sits
        // outside the hexagon instead of off the board entirely. Hide it at
        // that point and let the matching ghost (below) stand in.
        for (let idx = 0; idx < n; idx++) {
          const [r, c] = cells[idx];
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (!el) continue;
          const curLeft = parseFloat(el.style.left);
          const curTop = parseFloat(el.style.top);
          el.style.left = curLeft + rawDist * dirX + 'px';
          el.style.top = curTop + rawDist * dirY + 'px';
          const pos = idx + rawDist;
          if (pos < -0.5 || pos > n - 0.5) el.style.opacity = '0';
        }

        for (let k = -1; k <= 1; k++) {
          if (k === 0) continue;
          for (let i = 0; i < n; i++) {
            const pos = i + rawDist + k * n;
            if (pos < -0.5 || pos > n - 0.5) continue;
            const [r0, c0] = cells[i];
            const offset: [number, number] = [(pos - i) * dirX, (pos - i) * dirY];
            const ghost = makeTriEl(grid[r0][c0], r0, c0, 0.42, offset);
            ghost.classList.add('ghost');
            refs.boardEl.appendChild(ghost);
          }
        }
      }

      function applyDrag() {
        const d = drag;
        if (!d || !d.fam || !d.line) return;
        const cells = d.line.cells;
        const n = cells.length;
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy));
        if (((shift % n) + n) % n === 0) return;
        const vals = cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[(((i - shift) % n) + n) % n]);
        cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        const mask = new Set<string>(cells.map(([r, c]) => cellKey(r, c)));
        controller.resolveMove(mask);
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        isActive: () => controller.started && !controller.paused && !controller.gameOver,
        onStart(x, y) {
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0 };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const projA = scalarProjection('A', dx, dy);
            const projB = scalarProjection('B', dx, dy);
            const projR = scalarProjection('R', dx, dy);
            let fam: 'A' | 'B' | 'R' = 'A';
            let best = Math.abs(projA);
            if (Math.abs(projB) > best) { fam = 'B'; best = Math.abs(projB); }
            if (Math.abs(projR) > best) { fam = 'R'; best = Math.abs(projR); }
            drag.fam = fam;
            drag.line = lineFor(fam, drag.r, drag.c);
          }
          renderDragPreview();
        },
        onEnd(dx, dy) {
          if (drag && drag.fam) {
            drag.dx = dx;
            drag.dy = dy;
            applyDrag();
          }
          drag = null;
          render();
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
