import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { createDragChain, pressScale, BOARD_FORCE, type DragChain } from '../engine/dragChain';
import { vibrate } from '../engine/haptics';
import { floorBox, observeBoardSize, squareFloor } from '../engine/boardResize';
import { colorblindOn, onColorblindChange, themedPalette } from '../engine/palettePref';
import { playMove, seatLine } from '../engine/juice';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnOutlineEl, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { extendRunInLine, growParallelogram } from '../engine/matchGrowth';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintIcons, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import { STRINGS as MATCH_LABELS, STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
import { SEVEN_RHOMBI, sevenBallXY } from '../engine/ballLattice';
import type { ShapeGame, ShapeGameOpts } from './types';

// A 7x7 rhombus (49 balls) cut from the same triangular ball-packing lattice
// the base circle board uses — not a triangular crop like the base board,
// and not a hex crop like circleHex, but a *diamond*: two of the lattice's
// three principal directions (here just called "row" and "col") walked
// straight for 7 steps each from a shared corner, the same way a rhombus is
// two triangles joined at their base. Screen position (see ballCenter below)
// uses the lattice's A/B basis vectors directly — (row, col) IS the (A, B)
// step count, no row-dependent trimming needed — which is what makes the
// window come out as a symmetric upright diamond (single ball at the very
// top and bottom, widest across the middle row) instead of a "leaning"
// parallelogram: reflecting col across row+col=6 also reflects the screen
// x-coordinate, so the shape is mirror-symmetric left-right by construction.
const DIM = 7;
const PALETTES = {
  standard: ['#2F8A96', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#9B958D', '#8067A8'],
  colorblind: ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'],
} as const;
const PER_COLOR = 7;
const MIN_LINE_BONUS_LEN = 3;

const GLYPH = `<svg viewBox="0 0 32 32"><circle cx="16" cy="4" r="4" fill="#B23A3A"/><circle cx="8" cy="12" r="4" fill="#D89B1E"/><circle cx="24" cy="12" r="4" fill="#4C68B0"/><circle cx="16" cy="20" r="4" fill="#2F9E52"/><circle cx="8" cy="28" r="4" fill="#8067A8"/><circle cx="24" cy="28" r="4" fill="#2F8A96"/></svg>`;

// The board's 3 seed patterns (see findRunMatches/CLUSTERS below), positioned
// with the exact same (r,c) -> screen transform the live board uses, drawn
// as blank outlines for the in-HUD pattern hint.
function iconPos(r: number, c: number): [number, number] {
  return [(c - r) * 1, (c + r) * Math.sqrt(3)];
}
const PATTERNS: PatternDef[] = [
  {
    label: '1×4',
    cells: [0, 1, 2, 3].map((c) => {
      const [cx, cy] = iconPos(0, c);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
  {
    label: '2+2',
    cells: ([[0, 0], [0, 1], [1, -1], [1, 0]] as const).map(([r, c]) => {
      const [cx, cy] = iconPos(r, c);
      return { kind: 'circle' as const, cx, cy, r: 0.95 };
    }),
  },
  {
    label: '1-2-1',
    cells: ([[0, 0], [0, 1], [1, 0], [1, 1]] as const).map(([r, c]) => {
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

// family A (fixed row, col 0..6 varies): one lattice edge direction.
// family B (fixed col, row 0..6 varies): the other lattice edge direction —
// together A and B are the diamond's two straight sides, matching the
// user's "two triangles joined" description.
// family R (fixed row+col, the horizontal "row" as drawn on screen): the
// diamond's actual horizontal rows, length 1..7..1 same as any rhombus.
function lineA(r: number): Cell[] {
  return Array.from({ length: DIM }, (_, c) => [r, c] as Cell);
}
function lineB(c: number): Cell[] {
  return Array.from({ length: DIM }, (_, r) => [r, c] as Cell);
}
function lineRow(sum: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < DIM; r++) {
    const c = sum - r;
    if (c >= 0 && c < DIM) cells.push([r, c]);
  }
  return cells;
}
function allLines(): Line[] {
  const lines: Line[] = [];
  for (let r = 0; r < DIM; r++) lines.push({ fam: 'A', cells: lineA(r) });
  for (let c = 0; c < DIM; c++) lines.push({ fam: 'B', cells: lineB(c) });
  for (let s = 0; s <= 2 * (DIM - 1); s++) lines.push({ fam: 'R', cells: lineRow(s) });
  return lines;
}
const LINES = allLines();

function cellValid(r: number, c: number): boolean {
  return r >= 0 && r < DIM && c >= 0 && c < DIM;
}

/**
 * The "two adjacent pairs" bonus, as (dr, dc) basis pairs.
 *
 * This lattice has three step directions — (0,+1), (+1,0) and (+1,-1), each
 * exactly one ball apart on screen — and a rhombus of four is any two of
 * them spanned together, so there are exactly three orientations: the
 * upright diamond, and one leaning each way. All three are the same shape
 * turned, so all three score.
 *
 * The old pair of shapes copied circle.ts's offsets verbatim, on the
 * assumption that a shape written in (r,c) steps carries over between
 * boards. It does not: circle.ts's (r,c) are a *different* pair of screen
 * vectors, and its second rhombus replays here as a zig-zag chain of four
 * rather than a rhombus at all. So two of the three real orientations
 * scored nothing — a player who assembled a 2+2 the "wrong" way round got
 * no points — while a shape no pattern hint has ever shown scored instead.
 */
// 表和「一颗球画在屏幕哪儿」的算式一起住在 engine/ballLattice.ts——形状对不对
// 全看它们画出来是什么样，体检脚本（check-ball-offsets.mjs）拿的就是这一份。
const RHOMBI = SEVEN_RHOMBI;
/** The rhombus's four cells: the corners of the unit parallelogram spanned
 *  by du and dv, in the same (u,v) order growParallelogram walks. */
function rhombusCells(r: number, c: number, du: [number, number], dv: [number, number]): Cell[] | null {
  const cells = ([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(
    ([u, v]) => [r + u * du[0] + v * dv[0], c + u * du[1] + v * dv[1]] as Cell,
  );
  return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
}
function allClusters(): Cell[][] {
  const groups: Cell[][] = [];
  for (let r = 0; r < DIM; r++)
    for (let c = 0; c < DIM; c++)
      for (const [du, dv] of RHOMBI) {
        const g = rhombusCells(r, c, du, dv);
        if (g) groups.push(g);
      }
  return groups;
}
const CLUSTERS = allClusters();

// Each family's vector must equal the actual on-screen delta caused by
// incrementing that line's own array index by 1 — the drag-preview fade
// (edgeOpacity in renderDragPreview, keyed off "index position" = i +
// rawDist) and the wraparound ghosts only land in the right place if index
// order and famVector's sign agree. For A (lineA: c=i, r fixed) and B
// (lineB: r=i, c fixed), ballCenter's own (c-r)*R term makes cx move by
// +R/-R per +1 index step, matching the vectors below. For R (lineRow:
// r=i, c=sum-r), cx = boardLeft+(sum-2r)*R moves by -2R per +1 index step
// (increasing r shifts the row *left* on screen) — the previous [2*R, 0]
// had the wrong sign, which decoupled each ball's "logical index position"
// from where it actually sat on screen and made the edge-fade/ghost-fill
// trigger at arbitrary mid-line points instead of the line's real ends.
/**
 * This diamond is much taller than it is wide, which is the wrong way round
 * for a phone held sideways. In landscape the whole lattice is turned a
 * quarter turn so its long axis runs across the screen — and because every
 * screen vector on this board (a ball's centre, a family's slide direction)
 * goes through this one rotation, a drag along a family still means that
 * same family whichever way the phone is held. Nothing about the grid, the
 * scoring or the wraparound changes; only where it is painted.
 */
function rotXY(x: number, y: number, land: boolean): [number, number] {
  return land ? [-y, x] : [x, y];
}
function famVector(fam: Fam, R: number, rowH: number, land: boolean): [number, number] {
  const v: [number, number] = fam === 'A' ? [R, rowH] : fam === 'B' ? [-R, rowH] : [-2 * R, 0];
  return rotXY(v[0], v[1], land);
}
function scalarProjection(fam: Fam, dx: number, dy: number, R: number, rowH: number, land: boolean): number {
  const [ux, uy] = famVector(fam, R, rowH, land);
  return (dx * ux + dy * uy) / Math.hypot(ux, uy);
}
function projectedSteps(fam: Fam, dx: number, dy: number, R: number, rowH: number, land: boolean): number {
  const [ux, uy] = famVector(fam, R, rowH, land);
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
  /** Which way the board was painted when this drag began — see rotXY. */
  land: boolean;
  /** The splash's inter-piece physics, driving every frame of the preview. */
  chain: DragChain | null;
}

export function createCircleSevenGame(): ShapeGame {
  const bestKey = 'sugarcube_circle_seven_best';

  return {
    card: {
      id: 'circleSeven',
      name: '七色圆球',
      desc: '49 格菱形 · 7 种颜色',
      bestKey,
      glyph: GLYPH,
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const lang = opts?.lang ?? 'zhHans';
      const refs = buildShell(container, {
        lang,
        practice: !!opts?.practice,
        shapeId: 'circleSeven',
        timed: !!opts?.timeLimitSec,
        title: `Slides · ${shapeName(lang, 'circleSeven', '七色圆球')}`,
        tagline: SHELL[lang].taglineThreeWay,
        startBody: SHELL[lang].shellStartBody,
        patternIcons: renderPatternHintIcons(PATTERNS, lang),
        wideBoard: true,
        // 七色圆球's 7x7 diamond is far wider than tall — unplayable in a phone's
        // portrait column, so this screen asks for landscape and lays
        // itself out for it.
        landscape: true,
      });

      const pickPalette = (): readonly string[] =>
        themedPalette(PALETTES[colorblindOn() ? 'colorblind' : 'standard']);
      let COLORS: readonly string[] = pickPalette();
      let grid: Tile[][] = [];
      let R = 0,
        rowH = 0,
        boardLeft = 0,
        boardTop = 0;
      // 菱形这一轮是躺着还是立着。由 layoutBoard() 一处算出来，画球和拖拽都
      // 读它——三处各问各的，就会出现「按立着算的坐标，照躺着的方向去转」。
      let lying = false;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      let bonusedSignatures = new Set<string>();
      // A whole-line dot-face bonus doesn't remove its cells (same reasoning
      // as the base circle board — see circle.ts): the bonused balls become
      // permanently "blank" — a distinct colorless state that stays on the
      // board, keeps sliding with its line, but can never again take part in
      // a match, cluster, or line bonus.
      const BLANK = -1;
      function isBlank(t: Tile): boolean {
        return t.color === BLANK;
      }
      function anyBlank(cells: Cell[]): boolean {
        return cells.some(([r, c]) => isBlank(grid[r][c]));
      }
      let flipInCells = new Set<string>();
      let stuckKeys: Set<string> | null = null;

      function newTile(color: number, dotColor: number): Tile {
        return { id: nextTileId++, color, face: 'flavor', dotColor };
      }

      function shuffledDeck(): number[] {
        const deck: number[] = [];
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < PER_COLOR; i++) deck.push(c);
        return shuffle(deck);
      }

      // Per color group of 7: cycle through the other 6 colors (one gets a
      // 2nd copy to fill the 7th slot) — this tile's own color never appears
      // as its dot color, guaranteeing no ball anywhere has a front/back
      // color match. Same round-robin technique circleHex/triangleBig use
      // for their own no-self-pair distribution, just with 7 colors instead
      // of fewer.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; others.length < PER_COLOR; k++) others.push((color + 1 + (k % (COLORS.length - 1))) % COLORS.length);
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
        for (let r = 0; r < DIM; r++) {
          const row: Tile[] = [];
          for (let c = 0; c < DIM; c++) {
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

      // Screen position from the lattice's own A/B basis (see the module
      // comment for the derivation): (r,c) directly are the A-step and
      // B-step counts, so the 7x7 window comes out as a symmetric diamond
      // centered on cx=0, spanning cy=0 (top point) to cy=12*rowH (bottom
      // point) — no per-row trimming needed, unlike a hex or triangle crop.
      /**
       * 菱形最长的那两个角，永远指着地板最长的那条边。
       *
       * 因为菱形的长对角线比短的长六成，顺着长边摆才拿得到最多的地方。玩家定
       * 的第一条就是这个：最大化最重要，转屏幕时图案跟着换向是可以接受的代价。
       *
       * 所以这里不去问「屏幕是横的还是竖的」，直接把两种摆法各算一遍球半径，
       * 谁大用谁——「最大化」本来就是那条规矩本身，问屏幕只是它的一个代理。
       *
       * 从前问的是 window.innerWidth >= window.innerHeight，那是这个 bug 的
       * 出处。转屏的那一下，这两个数和页面的重排不是同一时刻更新的（iOS 尤其
       * 明显：外面那圈浏览器边框还在动画里，innerHeight 报的还是旧的）。于是
       * ResizeObserver 拿着**新**的地板尺寸叫醒排版，排版却问到一个**旧**的方
       * 向，菱形就照上一个方向摆了下去——而等那两个数追上来，没有任何事件会
       * 再触发一次重排，所以它一直歪到玩家伸手碰一下棋盘为止。「刚转过来还没
       * 操作的时候有问题，碰一下就好了」说的就是这段时间。
       *
       * 现在只有一个数据源：地板自己的那个框。它就是我们要往里排的东西，和它
       * 自己永远不会不同步；而地板一变，ResizeObserver 一定会响——触发和判断
       * 从此说的是同一件事。
       */
      // 菱形沿长轴跨 12 格、沿短轴也跨 12 格，两头各留一颗球（1.86R）的边。
      // 长的那条比短的长六成——这就是它值得挑个方向摆的原因。
      const LONG = 12 * Math.sqrt(3) + 1.86; // 22.64 R
      const SHORT = 12 + 1.86; //               13.86 R

      /** 这块地板上，躺着摆和立着摆哪个球更大。 */
      function lyingFits(w: number, h: number): boolean {
        const standing = Math.min(w / SHORT, h / LONG);
        const lyingR = Math.min(w / LONG, h / SHORT);
        return lyingR > standing;
      }

      function layoutBoard() {
        // floorBox 会把上一轮压在地板上的尺寸全摘掉再量，所以量到的是这一格
        // 本来有多大，不是我们自己上一轮收出来的那个方框。
        const rect = floorBox(refs.boardWrap);
        const width = rect.width || 320;
        const availH = rect.height || 320;
        // 立着摆的时候菱形比它自己宽得多，共用那个正方形外框会让高度定下比例，
        // 球就只剩这一列的半个宽。所以立着按宽算、让外框去迁就菱形要的高度；
        // 躺着把这两个约束对调。两种摆法各有自己的一对约束，整块棋盘怎么摆都
        // 在屏幕里。
        // 方向就在这一句定下来，用的正是刚量到的这个框——底下画球和拖拽都读
        // 这个 lying，不再各问各的。
        lying = lyingFits(width, availH);
        refs.boardWrap.style.aspectRatio = 'auto';
        if (lying) {
          R = Math.min(width / LONG, availH / SHORT);
          rowH = R * Math.sqrt(3);
          const height = SHORT * R;
          // The long axis now runs left-to-right: x = boardLeft - (r+c)*rowH,
          // so boardLeft sits at the diamond's right-hand point.
          boardLeft = (width + 12 * rowH) / 2;
          boardTop = height / 2;
          refs.boardEl.style.width = width + 'px';
          refs.boardEl.style.height = height + 'px';
          // 传的是棋盘元素自己的框（width × height），不是菱形画出来的那块。
          // 地板收到比棋盘元素还小的话，元素会顶出去——躺着的菱形横屏时正是
          // 这样，所以那时候这一句什么都不做。
          squareFloor(refs.boardWrap, width, height);
          return;
        }
        R = Math.min(width / SHORT, availH / LONG);
        rowH = R * Math.sqrt(3);
        const height = LONG * R;
        boardLeft = width / 2;
        // The diamond's top point, with its ball-radius margin above it.
        boardTop = (height - 12 * rowH) / 2;
        refs.boardEl.style.width = width + 'px';
        refs.boardEl.style.height = height + 'px';
        squareFloor(refs.boardWrap, width, height);
      }

      function ballCenter(r: number, c: number): [number, number] {
        const [bx, by] = sevenBallXY(r, c, R, rowH);
        const [ox, oy] = rotXY(bx, by, lying);
        const cx = boardLeft + ox;
        const cy = boardTop + oy;
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
          el.style.background = 'var(--ink-faint)';
          el.style.opacity = '0.35';
        } else if (tile.face === 'dot') {
          // Same drawn asterisk (three crossing strokes) as the base circle
          // board's own dot face — see circle.ts for the rationale.
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
        }
        if (opacity !== undefined) el.style.opacity = String(opacity);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        return el;
      }

      function render() {
        layoutBoard();
        // 先在一张「离屏的纸」上把这一帧的棋子全摆好，再一次性换上去。
        //
        // 从前是先把棋盘清空，再一枚一枚往里塞。塞四十九次就是四十九次改动，
        // 手机上每一次都可能让浏览器把这块重新算一遍；一步棋走完正好要重画整
        // 副棋盘，玩家看到的就是「移动结束时轻轻闪一下」。DocumentFragment 不
        // 在页面上，往它里面塞多少次都不惊动页面，最后那一下 appendChild 才是
        // 唯一一次真正的改动。
        const frag = document.createDocumentFragment();
        const outlineEntries = outlineTracker.current();
        const pulseMs = new Map<string, number>();
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) pulseMs.set(cellKey(r, c), elapsedMs);
        }
        for (let r = 0; r < DIM; r++) {
          for (let c = 0; c < DIM; c++) {
            const key = cellKey(r, c);
            const el = makeBallEl(grid[r][c], r, c);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key));
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            frag.appendChild(el);
          }
        }
        refs.boardEl.innerHTML = '';
        refs.boardEl.appendChild(frag);
        flipInCells = new Set();
        const size = R * 1.86;
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) {
            const [cx, cy] = ballCenter(r, c);
            spawnOutlineEl(refs.boardEl, { left: cx - size / 2, top: cy - size / 2, width: size, height: size }, elapsedMs, 'circle');
          }
        }
      }

      // A match only ever grows along its *own* seed shape's regular
      // directions (see matchGrowth.ts) — never a generic same-color flood
      // fill. A run-4 only extends further along that same line; a 22
      // rhombus only extends by a full extra row/column of its own
      // parallelogram; a small triangle doesn't extend at all — it always
      // scores exactly its own 6 cells.
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }
      function isLiveCell(r: number, c: number): boolean {
        return cellValid(r, c) && !isBlank(grid[r][c]);
      }
      function qualifies(seed: Cell[], mask: Set<string> | null): boolean {
        if (anyBlank(seed)) return false;
        const c0 = effColor(grid[seed[0][0]][seed[0][1]]);
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
        for (let r = 0; r < DIM; r++)
          for (let c = 0; c < DIM; c++)
            for (const [du, dv] of RHOMBI) {
              const seed = rhombusCells(r, c, du, dv);
              if (!seed || !qualifies(seed, mask)) continue;
              const positionAt = (u: number, v: number): Cell | null => {
                const cell: Cell = [r + u * du[0] + v * dv[0], c + u * du[1] + v * dv[1]];
                return cellValid(cell[0], cell[1]) ? cell : null;
              };
              const region = growParallelogram(positionAt, effColorAt, isLiveCell);
              matches.push({ cells: region, points: Math.max(4, region.length), label: MATCH_LABELS[lang].labelBlock22 });
            }
        return matches;
      }

      function isFullDotMatch(cells: Cell[]): boolean {
        if (cells.some(([r, c]) => grid[r][c].face !== 'dot')) return false;
        const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
        return cells.every(([r, c]) => grid[r][c].dotColor === c0);
      }

      function findWholeLineBonuses(): Cell[][] {
        const found: Cell[][] = [];
        for (const line of LINES) {
          if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
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
        return grid.every((row) => row.every((t) => isBlank(t) || t.face === 'dot'));
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < DIM; r++)
          for (let c = 0; c < DIM; c++) {
            const t = grid[r][c];
            if (!isBlank(t)) live.push({ cell: [r, c], tile: t });
          }
        return live;
      }

      function findStuckGroups(clearedDotColors: ReadonlySet<number>): Cell[][] {
        // 反面自己只靠整线得分，这副棋盘最短的整线是 3 枚（见 findWholeLineBonuses）。
        return findStuckColorGroups(liveTiles(), clearedDotColors, undefined, MIN_LINE_BONUS_LEN);
      }

      function countRemainingTiles() {
        return countRemainingTilesFn(liveTiles());
      }

      function snapshotBoard(): BoardSnapshot {
        const rowHUnit = Math.sqrt(3);
        const raw: RawCell[] = [];
        for (let r = 0; r < DIM; r++)
          for (let c = 0; c < DIM; c++) {
            const t = grid[r][c];
            raw.push({
              kind: 'circle',
              cx: (c - r) * 1,
              cy: (r + c) * rowHUnit,
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
        grid = generateCleanBoard();
        bonusedSignatures = new Set();
        outlineTracker.reset();
        stuckKeys = null;
      }

      const controller = createGameController(refs, {
        lang,
        practice: !!opts?.practice,
        bestKey: opts?.timeLimitSec ? bestKey + '_timed' : bestKey,
        shapeName: shapeName(lang, 'circleSeven', '七色圆球'),
        shapeId: 'circleSeven',
        modeKey: opts?.timeLimitSec ? 'timed' : 'base',
        timeLimitSec: opts?.timeLimitSec,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        findStuckGroups,
        countRemainingTiles,
        snapshotBoard,
        highlightStuck,
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

      let drag: DragState | null = null;

      function cellAt(x: number, y: number): Cell {
        let best: Cell = [0, 0];
        let bestDist = Infinity;
        for (let r = 0; r < DIM; r++)
          for (let c = 0; c < DIM; c++) {
            const [cx, cy] = ballCenter(r, c);
            const dist = (cx - x) ** 2 + (cy - y) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              best = [r, c];
            }
          }
        return best;
      }

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam || !d.chain) return;
        const n = d.cells.length;
        const size = d.R * 1.86;
        const [dirX, dirY] = famVector(d.fam, d.R, d.rowH, d.land);
        const stepLen = Math.hypot(dirX, dirY);
        const chain = d.chain;

        const FADE_RANGE = 0.4;
        const edgeOpacity = (pos: number) => {
          const overshoot = pos < 0 ? -pos : pos > n - 1 ? pos - (n - 1) : 0;
          return Math.max(0, 1 - overshoot / FADE_RANGE);
        };
        // Each ball rides its own lagged travel from the chain (the splash's
        // integrator) — the wave, the contact squash, the entrained sides.
        for (let i = 0; i < n; i++) {
          const off = chain.at(i);
          const [r, c] = d.cells[i];
          const [cx, cy] = ballCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + off * dirX + 'px';
            el.style.top = cy - size / 2 + off * dirY + 'px';
            el.style.opacity = String(edgeOpacity(i + off));
            el.style.scale = pressScale(chain.press(i), dirX / stepLen, dirY / stepLen, BOARD_FORCE);
          }
        }
        for (let k = -1; k <= 1; k++) {
          if (k === 0) continue;
          for (let i = 0; i < n; i++) {
            const off = chain.at(i);
            const pos = i + off + k * n;
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
        // The parallel lines either side, carried a little and sprung home.
        const inLine = new Set(d.cells.map(([r, c]) => cellKey(r, c)));
        const lineCoord = (r: number, c: number) =>
          d.fam === 'A' ? r : d.fam === 'B' ? c : r + c;
        const own = lineCoord(d.r, d.c);
        for (let r = 0; r < DIM; r++) {
          for (let c = 0; c < DIM; c++) {
            if (inLine.has(cellKey(r, c))) continue;
            const nudge = chain.side(Math.abs(lineCoord(r, c) - own));
            if (!nudge) continue;
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) el.style.translate = `${nudge * dirX}px ${nudge * dirY}px`;
          }
        }
      }

      function applyDrag(): boolean {
        const d = drag;
        if (!d || !d.fam) return false;
        const n = d.cells.length;
        const shift = Math.round(projectedSteps(d.fam, d.dx, d.dy, d.R, d.rowH, d.land));
        if (((shift % n) + n) % n === 0) return false;
        const vals = d.cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[(((i - shift) % n) + n) % n]);
        d.cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        const mask = new Set<string>(d.cells.map(([r, c]) => cellKey(r, c)));
        seatLine(refs.boardEl, mask);
        const [vx, vy] = famVector(d.fam, d.R, d.rowH, d.land);
        const sign = Math.sign(shift) || 1;
        controller.resolveMove(mask, (Math.atan2(vy * sign, vx * sign) * 180) / Math.PI);
        return true;
      }

      const detachDrag = attachDrag(refs.boardWrap, {
        origin: refs.boardEl,
        // A touch arriving mid-reveal runs the rest of it now rather than
        // being turned away — see GameController.hurry().
        onBeforeStart: () => controller.hurry(),
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onRejected: () => vibrate(15),
        onStart(x, y) {
          // A touch arriving while the previous line is still swinging ends
          // that settle right now instead of being swallowed — fast play was
          // losing whole moves to a wave that had not finished dying down.
          drag?.chain?.flush();
          if (controller.resolving) {
            drag = null;
            return;
          }
          const [r, c] = cellAt(x, y);
          drag = { r, c, fam: null, cells: [], dx: 0, dy: 0, R, rowH, lastShift: 0, land: lying, chain: null };
          return { r: drag.r, c: drag.c };
        },
        /**
         * 还在死区里，手指挪到哪就改抓哪。
         *
         * 抓哪一颗原本是手指落下那一瞬间定死的，落点差两三个像素跨过边界就
         * 抓了隔壁，而且要等牌动起来才发现。死区这几个像素里什么都还没发生，
         * 正好是可以反悔的窗口。
         */
        onRegrab(x, y) {
          if (!drag) return null;
          const [r, c] = cellAt(x, y);
          drag.r = r;
          drag.c = c;
          return { r, c };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const projA = scalarProjection('A', dx, dy, drag.R, drag.rowH, drag.land);
            const projB = scalarProjection('B', dx, dy, drag.R, drag.rowH, drag.land);
            const projR = scalarProjection('R', dx, dy, drag.R, drag.rowH, drag.land);
            let fam: Fam = 'A';
            let best = Math.abs(projA);
            if (Math.abs(projB) > best) { fam = 'B'; best = Math.abs(projB); }
            if (Math.abs(projR) > best) { fam = 'R'; best = Math.abs(projR); }
            drag.fam = fam;
            drag.cells = fam === 'A' ? lineA(drag.r) : fam === 'B' ? lineB(drag.c) : lineRow(drag.r + drag.c);
            const grabbed = drag.cells.findIndex(([r, c]) => r === drag!.r && c === drag!.c);
            drag.chain = createDragChain({
              n: drag.cells.length,
              grabbed: Math.max(0, grabbed),
              force: BOARD_FORCE,
              onFrame: renderDragPreview,
            });
          }
          const d = drag;
          if (!d.fam || !d.chain) return;
          const raw = projectedSteps(d.fam, dx, dy, d.R, d.rowH, d.land);
          const shift = Math.round(raw);
          if (shift !== d.lastShift) {
            vibrate(6);
            playMove();
            d.lastShift = shift;
          }
          d.chain.drive(magnetizeRawDist(raw));
        },
        onEnd(dx, dy) {
          const d = drag;
          if (!d || !d.fam || !d.chain) {
            drag = null;
            if (!controller.resolving) render();
            return;
          }
          d.dx = dx;
          d.dy = dy;
          d.chain.settle(Math.round(projectedSteps(d.fam, dx, dy, d.R, d.rowH, d.land)), () => {
            d.chain?.stop();
            const moved = applyDrag();
            drag = null;
            if (!moved) render();
          });
        },
      });

      const stopResize = observeBoardSize(refs.boardWrap, () => {
        if (!drag && controller.started) render();
      });

      function destroy() {
        drag?.chain?.stop();
        drag = null;
        controller.destroy();
        stopColorblind();
        detachDrag();
        stopResize();
      }

      refs.buttons.back?.addEventListener('click', () => {
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

      // Follows the app-wide setting (个人主页), so switching it mid-run
      // recolours the board under the player's finger rather than waiting
      // for the next game.
      const stopColorblind = onColorblindChange(() => {
        COLORS = pickPalette();
        renderLegend();
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
