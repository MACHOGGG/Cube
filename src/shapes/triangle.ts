import { buildShell } from '../ui/gameShell';
import { applyDevDeal, devDealFor } from '../engine/devDeal';
import { createGameController } from '../engine/gameController';
import { groupPoints } from '../engine/groupScore';
import { attachDrag, magnetizeFollow } from '../engine/drag';
import { createDragChain, pressScale, BOARD_FORCE, type DragChain } from '../engine/dragChain';
import { vibrate } from '../engine/haptics';
import { floorBox, observeBoardSize, fitFloor } from '../engine/boardResize';
import { fitLive, type Fit, type FitBox } from '../engine/liveFit';
import { createBoardZoom } from '../ui/boardZoom';
import { colorblindOn, onColorblindChange, themedPalette } from '../engine/palettePref';
import { playMove, seatLine } from '../engine/juice';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnTriangleOutline, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { proHintWidth, proTriRing } from '../engine/proHint';
import { onProChange, proOn } from '../engine/proMode';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, stuckKeysOf, type LiveTile } from '../engine/stalemate';
import { stuckGroupsOf } from '../engine/stalemate';
import { RESIDUE_MAX_TILES, edgeResidue } from '../engine/residueBoard';
import { extendRunInLine, runLabel as runLabelOf } from '../engine/matchGrowth';
import { buildEdgeBand } from '../ui/edgeBand';
import { assignOffsets, outerEdges, shortestEdge, EDGE_MIN, EDGE_MIN_ENDGAME, NO_EDGE, type EdgeBoard } from '../engine/outerEdge';
import { roundTriClip, roundTriPath, triRingPath, TRI_RING_INSET } from '../engine/roundTri';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintIcons, type PatternDef } from '../engine/patternIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { clampOddShift, fillerAwareSource, slideLine } from '../engine/slideLine';
import { asteriskGroup, triCentroid, triInradius, TRI_STAR_OF_INRADIUS } from '../ui/dotFaceMark';
import { shuffle } from '../engine/rng';
import { dealBalancedDeck, spreadDotColors } from '../engine/orientationDeal';
import { crackLayer } from '../ui/bombCrack';
import { BOMB_RED_HEX, blowUpIfClustered, dealBombBacks, defuseAround, isCrackedBomb, isLiveBomb, generateCleanBombBoard, redClusterKeys, type BombAdjacency } from '../engine/bomb';
import { STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
import type { ShapeGame, ShapeGameOpts } from './types';
import { modeKeyOf, suffixFor } from '../engine/runKey';

// Same Okabe–Ito colorblind-safe 6-hue set the square board offers, reused
// as-is (see square.ts for the palette rationale) so the toggle means the
// same thing on every board.
/** 拖动时预览跟手的曲线，见 drag.ts 的 magnetizeFollow。
 *  三角只能偶数步落位，卡点隔着两格，纯磁吸会在卡点附近把牌粘住不动——
 *  掺三成直线进去，速率就稳在 0.70～1.15 之间。落位一步没变。 */
const MAGNET_POWER = 1.5;
const MAGNET_BLEND = 0.3;

const PALETTES = {
  standard: ['#2F8A96', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#9B958D'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;
const ROW_LENS = [7, 9, 11, 11, 9, 7];
const LEFT_TRIM = [0, 0, 0, 1, 3, 5]; // maps local col -> global position p = c + LEFT_TRIM[r]
const GLOBAL_ROW_OFFSET = 3; // local row r -> global big-triangle row i = r+3
const PER_COLOR = 9;
/*
 * 这儿原先有一个 `MIN_LINE_BONUS_LEN = 3`：「整条线至少几枚才给整线奖励」，那时候
 * **任意**一整条同色星星都能消。《侵蚀阶梯》v1.2 §3 之后只削**此刻最外面的那一
 * 条**，门槛由 engine/outerEdge.ts 的 EDGE_MIN / EDGE_MIN_ENDGAME 两个常量说了算
 * （常态 3，收尾放开后 1），所以这个数没有自己的位置了。
 */
// Slot order is row-major over ROW_LENS, matching boardFromDeck's own walk —
// so this indexes the deck directly. A slot points up when its global
// position p is even (see triGeom).
const SLOT_IS_UP: boolean[] = ROW_LENS.flatMap((len, r) =>
  Array.from({ length: len }, (_, c) => (c + LEFT_TRIM[r]) % 2 === 0));

// Bomb mode reuses the exact same 6-color, 9-per-color deck as the base
// game. It reinterprets one existing palette slot as the hazard color —
// fixed at index 1 for *both* palette variants (not each one's own most-red
// hue) on purpose: a tile's color is stored as an index, and toggling the
// colorblind-palette button only swaps which hex values that index maps
// to, not which tiles are hazards. If each variant used a different red
// index, switching palettes mid-game would decouple "which tiles are
// hazards" from "which tiles render red". Index 1 is where standard's own
// red already sits, so this is a no-op there; colorblind's index 1 (amber)
// gets overridden to the same fixed hazard red instead of keeping its own
// natural vermillion at index 0.
const RED_IDX = 1;
const BOMB_PALETTES = {
  standard: PALETTES.standard.map((c, i) => (i === RED_IDX ? BOMB_RED_HEX : c)),
  colorblind: PALETTES.colorblind.map((c, i) => (i === RED_IDX ? BOMB_RED_HEX : c)),
} as const;

const GLYPH = `<svg viewBox="0 0 32 32"><path d="${roundTriPath([[16, 3], [29, 25], [3, 25]])}" fill="#4C68B0"/><path d="${roundTriPath([[16, 29], [4, 9], [28, 9]])}" fill="#D89B1E" opacity="0.9"/></svg>`;

// The board's 2 seed patterns (see findRunMatches/BIG_TRIANGLES below),
// built with the exact same up/down triangle geometry snapshotBoard() uses
// (global row i, global position p), drawn as blank outlines for the
// in-HUD pattern hint.
const ICON_H = Math.sqrt(3) / 2;
function iconTri(i: number, p: number): [number, number][] {
  const up = p % 2 === 0;
  const j = up ? p / 2 : (p - 1) / 2;
  const xBase = -i / 2 + j;
  return up
    ? [[xBase, i * ICON_H], [xBase - 0.5, (i + 1) * ICON_H], [xBase + 0.5, (i + 1) * ICON_H]]
    : [[xBase + 0.5, (i + 1) * ICON_H], [xBase, i * ICON_H], [xBase + 1, i * ICON_H]];
}
/**
 * 这副棋盘的得分图案——**只剩一种**：同色 1×N 连线（《侵蚀阶梯》v1.2 §1.1）。
 * 2×2 / 2+2 / 1-2-1 / 大三角那几种全部退役。
 *
 * 这儿画的是开局那一级（1×4）。图案会随侵蚀变短（4→3→2→1），HUD 上那一块按当前
 * 级数现画（见 PR-7 的《得分图案》块）。
 */
const PATTERNS: PatternDef[] = [
  {
    label: '1×4',
    cells: [0, 1, 2, 3].map((p) => ({ kind: 'poly' as const, points: iconTri(0, p) })),
  },
];

interface Line {
  fam: 'A' | 'B' | 'R';
  /**
   * 这条线在族法向上的偏移（《侵蚀阶梯》v1.2 §3 的「最外边」要它）。
   *
   * 这一副**没有现成的整数**：两个斜向族是按「共边的邻居」并查集拼出来的链，链上
   * 正反三角交替。所以下面 allLines() 末尾统一调 assignOffsets 按几何算——拿每条线
   * 两端定方向、法向上取平均投影，平行的线自然排得出前后（见 engine/outerEdge.ts）。
   */
  offset: number;
  cells: Cell[];
}

// ---------- diagonal line families (pure geometry, shared by every instance) ----------
// Every triangle has exactly 3 edges: two "row" edges (same i, sharing p±1 with the
// opposite orientation — family R, below) and one "cross" edge into the next i-band.
// Crucially the cross edge only ever runs *forward*: up(i,p) connects to down(i+1,p+1),
// and a down cell's only cross edge is that same one seen backward (to up(i-1,p-1)) —
// there is no separate "down cell's forward cross edge". A straight diagonal line is
// therefore not "same i-p" or "same i+p": it's a zigzag that alternates the cross edge
// with ONE of the two row edges. Alternating with the row-edge whose true geometric
// slope matches the cross edge's own +x lean gives one diagonal direction; alternating
// with the other row edge gives the mirror direction. (An earlier version grouped cells
// by a closed-form column formula that silently only ever picked up one triangle
// orientation — this walks the real adjacency instead, so it can't make that mistake.)
function globalToLocal(i: number, p: number): Cell | null {
  const r = i - GLOBAL_ROW_OFFSET;
  if (r < 0 || r >= ROW_LENS.length) return null;
  const c = p - LEFT_TRIM[r];
  if (c < 0 || c >= ROW_LENS[r]) return null;
  return [r, c];
}
function crossNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i + 1, p + 1) : globalToLocal(i - 1, p - 1);
}
// The neighbor sharing the same slope as an up-cell's own "p+1" edge — for a down
// cell that's its "p-1" neighbor, since a down triangle is the up triangle mirrored.
function rowRightNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i, p + 1) : globalToLocal(i, p - 1);
}
function rowLeftNeighbor(i: number, p: number): Cell | null {
  return p % 2 === 0 ? globalToLocal(i, p - 1) : globalToLocal(i, p + 1);
}

function buildDiagonalFamily(fam: 'A' | 'B'): Line[] {
  const useRowRight = fam === 'B';
  const parent = new Map<string, string>();
  for (let r = 0; r < ROW_LENS.length; r++) for (let c = 0; c < ROW_LENS[r]; c++) parent.set(cellKey(r, c), cellKey(r, c));
  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }
  function union(a: string, b: string) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const neighborsOf = new Map<string, Cell[]>();
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const { i, p } = globalPosPure(r, c);
      const nbrs: Cell[] = [];
      const cross = crossNeighbor(i, p);
      const along = useRowRight ? rowRightNeighbor(i, p) : rowLeftNeighbor(i, p);
      if (cross) { nbrs.push(cross); union(cellKey(r, c), cellKey(cross[0], cross[1])); }
      if (along) { nbrs.push(along); union(cellKey(r, c), cellKey(along[0], along[1])); }
      neighborsOf.set(cellKey(r, c), nbrs);
    }
  const groups = new Map<string, Cell[]>();
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const root = find(cellKey(r, c));
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push([r, c]);
    }
  // Walk each group end-to-end into a single physically-ordered chain (starting
  // from an endpoint where possible) so that shifting the array by N positions
  // means sliding N real steps along the true line, same as the row family.
  const lines: Line[] = [];
  for (const group of groups.values()) {
    const setK = new Set(group.map(([r, c]) => cellKey(r, c)));
    const within = (r: number, c: number) => neighborsOf.get(cellKey(r, c))!.filter(([rr, cc]) => setK.has(cellKey(rr, cc)));
    const start = group.find(([r, c]) => within(r, c).length <= 1) ?? group[0];
    const ordered: Cell[] = [start];
    const seen = new Set([cellKey(start[0], start[1])]);
    let cur = start;
    for (;;) {
      const next = within(cur[0], cur[1]).find(([r, c]) => !seen.has(cellKey(r, c)));
      if (!next) break;
      ordered.push(next);
      seen.add(cellKey(next[0], next[1]));
      cur = next;
    }
    lines.push({ fam, offset: 0, cells: ordered });
  }
  return lines;
}

// (globalPos, defined further below alongside the rest of the render geometry, is
// identical to this — duplicated as a pure function here so line construction doesn't
// depend on render-time state and can run once at module load.)
function globalPosPure(r: number, c: number) {
  return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
}

function allLines(): Line[] {
  const lines: Line[] = [...buildDiagonalFamily('A'), ...buildDiagonalFamily('B')];
  // R 族的 offset 就是行号，下面那个循环里带上；两个斜向族在末尾统一算（见 Line.offset）。
  // Third axis: a full horizontal row (up- and down-pointing triangles
  // interleaved). Adjacent triangles in a row are edge-sharing neighbors, so
  // this is a real third slide direction alongside the two diagonals, not
  // just a row/column convenience like the square board's.
  for (let r = 0; r < ROW_LENS.length; r++) {
    lines.push({ fam: 'R', offset: r, cells: Array.from({ length: ROW_LENS[r] }, (_, c) => [r, c] as Cell) });
  }
  // 三角格阵上，一枚三角的「中心」按 globalPosPure 那一套（i 是全局行、p 是行内位
  // 置）。正反三角的中心在行内差半格，所以 x 取 p / 2——同一族里的线因此才真的平行。
  assignOffsets(
    lines.filter((l) => l.fam !== 'R'),
    (r, c) => {
      const { i, p } = globalPosPure(r, c);
      return [p / 2, i] as const;
    },
  );
  return lines;
}
const LINES = allLines();

// "31"/"13" big-triangle bonus shape: 3 small triangles of one orientation
// plus 1 of the other tile exactly into one triangle twice the size (the
// standard 4-way split of an equilateral triangle) — the closest analogue
// this board has to the square board's 2×2. An up-pointing big triangle is
// its apex cell plus the 3 consecutive same-row cells one band below,
// centered on the apex's forward cross-neighbor (up(i,p)'s only cross edge
// runs to down(i+1,p+1), which sits exactly at the middle of that trio); a
// down-pointing one is the mirror image, one band above.
function bigTriangleUp(r: number, c: number): Cell[] | null {
  const { i, p } = globalPosPure(r, c);
  if (p % 2 !== 0) return null;
  const a = globalToLocal(i + 1, p);
  const b = globalToLocal(i + 1, p + 1);
  const cc = globalToLocal(i + 1, p + 2);
  if (!a || !b || !cc) return null;
  return [[r, c], a, b, cc];
}
function bigTriangleDown(r: number, c: number): Cell[] | null {
  const { i, p } = globalPosPure(r, c);
  if (p % 2 === 0) return null;
  const a = globalToLocal(i - 1, p - 2);
  const b = globalToLocal(i - 1, p - 1);
  const cc = globalToLocal(i - 1, p);
  if (!a || !b || !cc) return null;
  return [[r, c], a, b, cc];
}
function allBigTriangles(): Cell[][] {
  const groups: Cell[][] = [];
  for (let r = 0; r < ROW_LENS.length; r++)
    for (let c = 0; c < ROW_LENS[r]; c++) {
      const up = bigTriangleUp(r, c);
      if (up) groups.push(up);
      const down = bigTriangleDown(r, c);
      if (down) groups.push(down);
    }
  return groups;
}
/**
 * 发牌时用的「一坨同色」表，**不是得分图案**——大三角在《侵蚀阶梯》v1.2 §1.1 里
 * 退役了。留着它只为一件事：开局盘面上别自带一坨同色（见 hasInitialClump），那看
 * 着像「这局已经解过一半了」。
 */
const BIG_TRIANGLES = allBigTriangles();

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
  lastShift: number;
  /** The splash's inter-piece physics. Triangles interlock and swap by
   *  pairs rather than sliding, so the chain runs in pair units and drives
   *  each pair's "give" nudge — the ripple — instead of real travel. */
  chain: DragChain | null;
}

/*
 * 这个文件画的是六边蜂窝那块三角棋盘。它挂在《大三角》那个入口后面——
 * 名字和文件名对不上是有意的：2026-09 把两个三角的棋盘对调了，因为整块
 * 大三角上手容易得多，该由它站在主菜单上当《三角》，蜂窝这块难一些，退到
 * 《更多布局》里当《大三角》。
 *
 * 对调的做法是只换身份（id / 名字 / 存档键 / shapeId），不搬棋盘代码：
 * 图标是按 id 查的（homeIcons.ts），所以两个入口的图标原地不动，正是
 * 「icon 先不换」要的结果。要换回去，把这里和 triangleBig.ts 的这几行
 * 再对调一次即可，别去动棋盘本身。
 */
export function createTriangleGame(): ShapeGame {
  const bestKey = 'sugarcube_triangle_big_best';

  return {
    card: {
      id: 'triangleBig',
      name: '大三角',
      desc: '沿斜线拖动 · 六边蜂窝三角',
      bestKey,
      glyph: GLYPH,
      family: 'triangle',
      ruleShape: 'triangle',
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const isBomb = !!opts?.bomb;
      // 这一局记成什么模式、存进哪个键——两样都由 engine/runKey.ts 推。
      // 存档键的后缀带着规则版本号。从前这儿手写着上一版的后缀：炸弹升到第 3 版、
      // 无限反转升到第 2 版，读的那一头跟着常量走了，这儿的字面量没人记得改，于是
      // 新规则的局落进了旧规则的归档（那个文件开头写着后果）。
      const modeKey = modeKeyOf({ bomb: isBomb, timed: !!opts?.timeLimitSec });
      /**
       * 这一枚此刻是不是一颗**活**炸弹（判四连、闪三连预警、数活棋子都问它）。
       *
       * 问的是露在外面的那一面：正面红 = 还没拆；拆成
       * 基础色星星的，不再是炸弹。理由写在 engine/bomb.ts 的 isLiveBomb 上面。
       */
      const liveBomb = (t: Tile) => isBomb && isLiveBomb(t, RED_IDX);
      const lang = opts?.lang ?? 'zhHans';
      const refs = buildShell(container, {
        lang,
        practice: !!opts?.practice,
        shapeId: 'triangleBig',
        timed: !!opts?.timeLimitSec,
        // 棋盘底下那块教学条（见 ui/coachBar.ts）。这一副只用它摆头一回进来的
        // 那一句提示（coachTip）——特殊布局、计时、炸弹各一句。
        coach: !!opts?.coach,
        // 不数 4-3-2-1（每日挑战那一页自己数过了，第 19 推；见 ShellMeta.noCountdown）。
        noCountdown: !!opts?.noCountdown,
        bomb: isBomb,
        title: `Slides · ${shapeName(lang, 'triangleBig', '大三角')}`,
        tagline: isBomb ? SHELL[lang].taglineThreeWay + ' · ' + SHELL[lang].taglineBomb : SHELL[lang].taglineThreeWay,
        startBody: SHELL[lang].shellStartBody,
        patternIcons: renderPatternHintIcons(PATTERNS, lang),
        wideBoard: true,
      });

      const pickPalette = (): readonly string[] =>
        themedPalette(
          (isBomb ? BOMB_PALETTES : PALETTES)[colorblindOn() ? 'colorblind' : 'standard'],
          isBomb ? RED_IDX : -1,
        );
      let COLORS: readonly string[] = pickPalette();
      let grid: Tile[][] = [];
      let S = 0,
        H = 0,
        originX = 0,
        originY = 0;
      /** 这一帧的「放大多少、锚在哪儿」（`engine/liveFit.ts`）。 */
      let fit: Fit = { zoom: 1, unit: 0, originX: 0, originY: 0 };
      /** 「剩下的部分长大了」那一下动画（`ui/boardZoom.ts`，五副外边族共用）。 */
      const zoom = createBoardZoom(refs.boardEl, () =>
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      let bonusedSignatures = new Set<string>();
      // A whole-line dot-face bonus doesn't remove its cells: same as
      // circle's blank ball (see circle.ts), a bonused triangle just loses
      // its color for good (the BLANK sentinel) while staying a real,
      // slidable tile — this hexagon has no smaller hexagon to reflow into,
      // so there's nothing to gain by punching a permanent hole, and
      // leaving it in play means later drags can still move it out of the
      // way of the cells around it.
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
      let stuckKeys: Set<string> | null = null;

      function newTile(color: number, dotColor: number): Tile {
        return { id: nextTileId++, color, face: 'flavor', dotColor };
      }

      // Balanced across up/down slots rather than plain-shuffled — see
      // orientationDeal.ts for why a triangle board needs that.
      function shuffledDeck(): number[] {
        return dealBalancedDeck(SLOT_IS_UP, COLORS.length, PER_COLOR);
      }

      // per color group of 9: the other 5 colors get 1 each (5) + the tile's
      // own color four times (4) = 9 — matches the physical set's back
      // distribution.
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        const groups: { slots: number[]; pool: number[] }[] = [];
        for (let color = 0; color < COLORS.length; color++) {
          const others: number[] = [];
          for (let k = 0; k < COLORS.length; k++) if (k !== color) others.push(k);
          for (let i = 0; i < 4; i++) others.push(color);
          shuffle(others);
          const slots: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) slots.push(idx);
          });
          groups.push({ slots, pool: others });
        }
        return spreadDotColors(groups, (slot) => SLOT_IS_UP[slot], dotColors);
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
        for (const cells of BIG_TRIANGLES) {
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

      // ---------- bomb mode: red hazard tiles ----------
      // Same deck as the base game (6 colors x 9 tiles = 54) — shuffledDeck()
      // already reads from COLORS, which is BOMB_PALETTES here, so it needs
      // no bomb-specific variant.

      // Per non-red front-color group of 9: the other 4 non-red colors get 1
      // dot-color slot each (4), and the tile's own front color gets the
      // remaining 5 — the same "others get 1 each, self gets what's left"
      // shape as the base game's own 9-per-group rule, just with one fewer
      // other color available. Red is excluded from every *normal* tile's
      // dot-color pool, so a normal star is never mistaken for a hazard. The
      // red tiles' own backs are dealt separately just below (dealBombBacks).
      function assignBombDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length).fill(RED_IDX);
        const groups: { slots: number[]; pool: number[] }[] = [];
        for (let color = 0; color < COLORS.length; color++) {
          if (color === RED_IDX) continue;
          const others = Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== color && k !== RED_IDX);
          const pool = shuffle([...others, color, color, color, color, color]);
          const slots: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) slots.push(idx);
          });
          groups.push({ slots, pool: pool });
        }
        const spread = spreadDotColors(groups, (slot) => SLOT_IS_UP[slot], dotColors);
        // 炸弹自己的反面。
        //
        // 从前这一格留着上面 fill(RED_IDX) 的默认值——红块永不翻面，那个反面
        // 谁也没见过。现在炸弹挨着得分图案会被连带拆掉、翻成星星，它就得是一
        // 颗真的星星：每一枚的反面都印基础色（第 3 版之后没有永久炸弹了，见 engine/bomb.ts 的 BOMB_RULES_VERSION），其
        // 余按五种基础色配平。为什么在发牌时定、为什么是配平，见
        // engine/bomb.ts 的 dealBombBacks。
        const bombBackPool = Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== RED_IDX);
        const bombSlots: number[] = [];
        deck.forEach((c, idx) => {
          if (c === RED_IDX) bombSlots.push(idx);
        });
        const bombBacks = dealBombBacks(bombSlots.length, bombBackPool, RED_IDX, shuffle);
        bombSlots.forEach((idx, i) => {
          spread[idx] = bombBacks[i];
        });
        return spread;
      }

      function boardFromBombDeck(deck: number[]): Tile[][] {
        const dots = assignBombDotColors(deck);
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

      // Each triangle touches exactly 3 others edge-to-edge — the cross edge
      // into the next i-band, and its two in-row neighbors (same real
      // adjacency the pre-matchGrowth flood-fill used to expand a seed with;
      // see crossNeighbor/rowLeftNeighbor/rowRightNeighbor above).
      function triangleAdjacency(r: number, c: number): Cell[] {
        const { i, p } = globalPosPure(r, c);
        const out: Cell[] = [];
        for (const cand of [crossNeighbor(i, p), rowLeftNeighbor(i, p), rowRightNeighbor(i, p)]) {
          if (cand) out.push(cand);
        }
        return out;
      }

      /** 炸弹的「挨着」：和判四连、闪预警用同一份邻接（triangleAdjacency）。 */
      const bombNeighbors = (r: number, c: number): Cell[] => triangleAdjacency(r, c);

      // 炸弹那三样（四连判爆、三连预警、发一副干净的开局）在 engine/bomb.ts（第 14 推从
      // 五副棋盘里抽出来，规矩只写一遍）；这儿只交代这一副盘「有哪些格、谁挨着谁」。
      // A 4-cluster ends the run outright; a 3-cluster is one drag away
      // from it, so render() pulses those tiles as an early warning.
      const BOMB_ADJ: BombAdjacency = {
        *cells() {
          for (let r = 0; r < ROW_LENS.length; r++) for (let c = 0; c < ROW_LENS[r]; c++) yield [r, c] as const;
        },
        neighbors: (r, c) => triangleAdjacency(r, c),
      };

      function renderLegend() {
        refs.legendEl.innerHTML = COLORS.map((hex) => `<span class="swatch" style="background:${hex}"></span>`).join('');
      }

      // ---------- geometry: true up/down triangle vertices, from local (r,c) ----------
      function globalPos(r: number, c: number) {
        return { i: r + GLOBAL_ROW_OFFSET, p: c + LEFT_TRIM[r] };
      }

      /**
       * 一枚三角的三个顶点。**边长和行高收成参数**，不是直接读闭包里的 `S` / `H`。
       *
       * 抽出来只为一件事：外接框要按「一个 S」这把尺算一遍（放大那一套要它，见
       * engine/liveFit.ts），而那时候的 `S` 是这一帧真正要用的那个，不能拿来当尺。
       */
      function triGeometryAt(
        r: number, c: number, s: number, h: number,
      ): { up: boolean; pts: [number, number][] } {
        const { i, p } = globalPos(r, c);
        const up = p % 2 === 0;
        const j = up ? p / 2 : (p - 1) / 2;
        const xBase = (-i * s) / 2 + j * s;
        if (up) {
          const A: [number, number] = [xBase, i * h];
          const B: [number, number] = [xBase - s / 2, (i + 1) * h];
          const C: [number, number] = [xBase + s / 2, (i + 1) * h];
          return { up: true, pts: [A, B, C] };
        }
        const A: [number, number] = [xBase + s / 2, (i + 1) * h];
        const B: [number, number] = [xBase, i * h];
        const C: [number, number] = [xBase + s, i * h];
        return { up: false, pts: [A, B, C] };
      }

      function triGeometry(r: number, c: number): { up: boolean; pts: [number, number][] } {
        return triGeometryAt(r, c, S, H);
      }

      /*
       * ── 「换算成一个 S」之后，一枚三角占哪一块 ─────────────────────
       *
       * 别的四副收的是「中心 ± 半个棋子」，这一副直接收**三个顶点**——三角的外接框和中心
       * 差着一截（朝上朝下还不一样），按中心加减半格算会差半格，而半格在这副盘上看得见。
       */
      function boxOf(cells: readonly Cell[]): FitBox | null {
        if (!cells.length) return null;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [r, c] of cells) {
          for (const [x, y] of triGeometryAt(r, c, 1, Math.sqrt(3) / 2).pts) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
        return { x: { min: x0, max: x1 }, y: { min: y0, max: y1 } };
      }

      function centroid(pts: [number, number][]): [number, number] {
        return [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
      }

      /** 整副棋盘（每一格都还在）的外接框——zoom 的基准，开局 zoom 正好 1。 */
      const FULL_BOX = (() => {
        const all: Cell[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) all.push([r, c]);
        return boxOf(all)!;
      })();
      /** 此刻还在盘上的那些格子（削掉离场的不算，《侵蚀阶梯》v1.2 §3）。 */
      function liveBox(): FitBox | null {
        const cells: Cell[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++)
            if (grid[r]?.[c] && !isBlank(grid[r][c])) cells.push([r, c]);
        return boxOf(cells);
      }

      function layoutBoard() {
        const rect = floorBox(refs.boardWrap);
        const boardSize = Math.min(rect.width, rect.height);
        // 手上压着的放大变换是按上一套数算的，底板或者活格框一变就不作数了。
        zoom.cancel();
        /*
         * 消除之后剩下的部分整体放大（玩家 2026-10 推翻 PR-3 的「棋盘一圈圈变小」，见
         * engine/liveFit.ts）。
         *
         * ⚠️ 老式那两行原样留着当锚点，**`GLOBAL_ROW_OFFSET * H` 那一项也在里头**。那是
         * 这副棋盘有意偏的半格（局部 7 行只占大三角的中间一截），照底板居中会把它抹掉，
         * 而 `fitLive` 收老锚点正是为了这个。
         */
        const S0 = boardSize / 6.4;
        const H0 = (S0 * Math.sqrt(3)) / 2;
        fit = fitLive({
          full: FULL_BOX,
          live: liveBox(),
          unit0: S0,
          originX0: boardSize / 2,
          originY0: (boardSize - 6 * H0) / 2 - GLOBAL_ROW_OFFSET * H0,
        });
        S = fit.unit;
        H = (S * Math.sqrt(3)) / 2;
        originX = fit.originX;
        originY = fit.originY;
        refs.boardEl.style.width = boardSize + 'px';
        refs.boardEl.style.height = boardSize + 'px';
             // 图形已经按整格算满了，地板收成正方形不会动到它。
        fitFloor(refs.boardWrap, boardSize, boardSize);
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
        warn = false,
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
        // 尖角磨圆——三副三角棋盘、教学、图示用的是同一条轮廓（roundTri.ts），
        // 圆角的深浅只在那儿定义一次：玩家在教学里看熟的形状，进了棋盘不该变
        // 成另一个样子。
        const clip = roundTriClip(pts, { minX, minY, w, h });

        const el = document.createElement('div');
        el.className = 'tri';
        el.style.left = minX + 'px';
        el.style.top = minY + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';

        // The parent wears the same silhouette so its white ground shows as
        // an edge around the inset fill — see .tri in triangle.css.
        el.style.clipPath = clip;
        el.style.setProperty('-webkit-clip-path', clip);

        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.style.clipPath = clip;
        fill.style.setProperty('-webkit-clip-path', clip);

        if (isBlank(tile)) {
          // Spent: a hollow outline, not a filled dim triangle — this
          // palette's own muted gray (#9B958D) sits too close to a dim fill
          // to read as reliably different at a glance (same fix already
          // applied to circleHex's blank balls). No fill at all reads
          // unambiguously as "an empty slot" in any palette, while the
          // outline still shows a piece is here and still slides with its
          // line.
          const cen = centroid(pts);
          const RING_SCALE = TRI_RING_INSET;
          const ringPts = pts.map(([x, y]) => [cen[0] + (x - cen[0]) * RING_SCALE, cen[1] + (y - cen[1]) * RING_SCALE] as [number, number]);
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('viewBox', '0 0 100 100');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.style.position = 'absolute';
          svg.style.left = '0';
          svg.style.top = '0';
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.overflow = 'visible';
          const poly = document.createElementNS(svgNS, 'path');
          // 尖角磨圆，和外面那圈轮廓同一条（见 engine/roundTri.ts）——里外两层
          // 的圆角要是一个磨了一个没磨，小三角看着就像贴歪了。
          poly.setAttribute(
            'd',
            roundTriPath(ringPts.map(([x, y]) => [((x - minX) / w) * 100, ((y - minY) / h) * 100] as [number, number])),
          );
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke', 'var(--ink-faint)');
          poly.setAttribute('stroke-width', '3.5');
          poly.setAttribute('stroke-linejoin', 'round');
          poly.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(poly);
          el.appendChild(svg);
        } else if (tile.face === 'dot') {
          // 反面：底板从三角自己的轮廓里透出来，中间摆一颗星——和小球、方块
          // 同一个记号（玩家 2026-09 定的统一，见 ui/dotFaceMark.ts）。从前这
          // 儿是一个缩小的同向小三角加深色描边：三副棋盘各认各的记号，翻过面
          // 的三角和一枚小一号的正面三角要靠「有没有描边」去分。
          //
          // 星星按**内切圆**定大小，不按那个方方的外框：三角是斜的，照外框
          // 算，两只斜角会顶出斜边去。位置也在重心上，不是外框的正中——外框
          // 的中点在一个朝下的三角里是空的。
          const local = pts.map(([x, y]) => [x - minX, y - minY] as [number, number]);
          const [starX, starY] = triCentroid(local);
          const starSize = triInradius(local) * 2 * TRI_STAR_OF_INRADIUS;
          const mark = document.createElement('div');
          mark.style.position = 'absolute';
          mark.style.left = '0';
          mark.style.top = '0';
          mark.style.width = '100%';
          mark.style.height = '100%';
          // 用 div 的 innerHTML 包一层，而不是往 SVG 元素上写 innerHTML：小红
          // 书那一版跑在 Chrome 61 上，那儿 SVGElement 的 innerHTML 靠不住。
          // 那圈灰边：和消掉之后剩下的空三角是同一圈（engine/roundTri.ts 的
          // triRingPath），得分变成星星之后一直留着。玩家 2026-09 定的——星星
          // 面的底板是透出来的，没有这圈边，一枚变成星星的三角在深色底板上就
          // 只剩一颗浮着的星，看不出它还占着一格、还会跟着整行滑。
          mark.innerHTML =
            `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" style="display:block;overflow:visible">` +
            `<path d="${triRingPath(local)}" fill="none" stroke="var(--ink-faint)" stroke-width="3.5" stroke-linejoin="round"/>` +
            asteriskGroup(starX, starY, starSize, COLORS[tile.dotColor]) +
            `</svg>`;
          el.appendChild(fill);
          el.appendChild(mark);
        } else {
          fill.style.background = COLORS[tile.color];
          el.appendChild(fill);
        }
        if (warn) {
          // A triangle's element is a rectangle with a clip-path, so the
          // shared .hazard-warn box-shadow would flash that rectangle —
          // reading as a stray shape swelling over its neighbours. Its own
          // silhouette, stroked as an SVG polygon (the same technique the
          // blank and dot faces use), is what should blink.
          const cen = centroid(pts);
          const WARN_SCALE = 0.9;
          const ringPts = pts.map(([x, y]) => [cen[0] + (x - cen[0]) * WARN_SCALE, cen[1] + (y - cen[1]) * WARN_SCALE] as [number, number]);
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('viewBox', '0 0 100 100');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.style.position = 'absolute';
          svg.style.left = '0';
          svg.style.top = '0';
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.overflow = 'visible';
          svg.style.pointerEvents = 'none';
          const poly = document.createElementNS(svgNS, 'path');
          // 尖角磨圆，和外面那圈轮廓同一条（见 engine/roundTri.ts）——里外两层
          // 的圆角要是一个磨了一个没磨，小三角看着就像贴歪了。
          poly.setAttribute(
            'd',
            roundTriPath(ringPts.map(([x, y]) => [((x - minX) / w) * 100, ((y - minY) / h) * 100] as [number, number])),
          );
          poly.setAttribute('class', 'hazard-ring');
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke-width', '4');
          poly.setAttribute('stroke-linejoin', 'round');
          poly.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(poly);
          el.appendChild(svg);
        }
        // 挨过一下、还没拆的那几枚：身上画一道裂纹（ui/bombCrack.ts）。没有它，
        // 「两下才拆」这条规则在屏幕上根本不存在，玩家只会觉得「贴着打了一次
        // 怎么没掉」。画在「！」前面，所以那个记号压在裂纹上，不会被盖住。
        if (isCrackedBomb(tile)) el.appendChild(crackLayer(Math.min(w, h) * 0.5, h * 0.22));
        // 「！」画在正面（还没拆的炸弹）。反面那一支留着：第 3 版取消了永久炸弹，所以
        // 现在发不出红反面；这件事来回过两轮，画法不跟着删（见 engine/bomb.ts）。它的
        // 反面还是红（dealBombBacks 留的），照旧按炸弹规则算，而红星星和别的
        // 星星形状一模一样，不加这个记号就混在里面认不出来了。
        if (liveBomb(tile)) {
          const mark = document.createElement('div');
          mark.className = 'hazard-mark';
          mark.textContent = '!';
          mark.style.position = 'absolute';
          mark.style.left = '0';
          mark.style.top = '0';
          mark.style.width = '100%';
          mark.style.height = '100%';
          mark.style.display = 'flex';
          mark.style.alignItems = 'center';
          mark.style.justifyContent = 'center';
          // Nudged down from dead-center toward the triangle's visual
          // centroid (a third of the way from its top edge to its base),
          // and sized off the shorter of the two axes so it never
          // overflows a bounding box this non-square.
          mark.style.paddingTop = Math.round(h * 0.22) + 'px';
          mark.style.fontSize = Math.round(Math.min(w, h) * 0.4) + 'px';
          el.appendChild(mark);
        }
        if (opacityOverride !== undefined) el.style.opacity = String(opacityOverride);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        // 这一枚这会儿是哪一面。写成属性是给**画面上的东西**用的：翻面动画那一
        // 拍要先拍一张旧面的快照（engine/plankFlip.ts 的 snapFlipFaces），样式和
        // 门也拿它认牌。
        //
        // **控制器已经不靠它了。** 从前头一局那块教学条要靠这个属性认出「这一组
        // 里有反面」（gameController 的 anyDotFace），而那时八副棋盘里只有
        // circle.ts 挂了它——于是头一局玩方块、三角的人，第 3 条哪怕真的做对了也
        // 感知不到，只能干等超时跳过。星星消除 PR-2（4fffbb4）给八副都补上了这一
        // 句，但病根是「控制器在读画面来推断数据」：八副必须各自记得挂同一个属性，
        // 少挂一副就回到老 bug，而且没有门守着。现在控制器连这个问题都不问了：第 15 推起
        // 教学条不再等「这一组里有反面」这个信号（第 2 条的灯由棋盘自己认组，见
        // engine/coachHint.ts），anyDotFace 跟着删了，这一句和控制器再也没有关系。
        el.dataset.face = isBlank(tile) ? 'blank' : tile.face;
        // Pro 模式那一条：这一枚**得分之后会变成什么颜色**（engine/proHint.ts）。
        //
        // 三角这一族只能真画进去：它的棋子是一个被 clip-path 剪成三角的方盒子，剪刀连
        // 子元素一起剪，所以描在外面的一圈会被整个剪掉。这一条压在轮廓线上，外面那一半
        // 剪掉，剩下贴着边的一条——正是玩家那张参考图上的样子。
        // 因为是真节点，所以只在开着 Pro 的时候建（拨开关那一下由 onProChange 重画）。
        if (proOn() && !isBlank(tile) && tile.face === 'flavor') {
          el.appendChild(proTriRing(pts, { minX, minY, w, h }, COLORS[tile.dotColor], proHintWidth(w)));
        }
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
        const warnKeys = isBomb ? redClusterKeys(grid, 3, BOMB_ADJ, liveBomb) : null;
        for (let r = 0; r < ROW_LENS.length; r++) {
          for (let c = 0; c < ROW_LENS[r]; c++) {
            // 离场的格子一律不画（《侵蚀阶梯》v1.2 §3「格子离场」）。从前削掉的
            // 棋子留在原地画成一枚暗的空位、还跟着整条线滑——现在它是真的不在了，
            // 棋盘一圈圈往里缩。淡出那一帧另有人管（playBlankTransition）。
            if (isBlank(grid[r][c])) continue;
            const key = cellKey(r, c);
            const el = makeTriEl(grid[r][c], r, c, undefined, undefined, !!warnKeys?.has(key));
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key));
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            frag.appendChild(el);
          }
        }
        refs.boardEl.innerHTML = '';
        refs.boardEl.appendChild(frag);
        // 外边指引 · 方案 B「双色托盘」（《侵蚀阶梯》v1.2 PR-7）：沿此刻削得动的
        // 那几条外边，在**棋子底下**描一条粗带。塞在最前面，所以它在所有棋子之下。
        //
        // 一枚三角的「中心」取三个顶点的重心（正反三角的重心不在同一高度，这正是
        // 玩家看见的那条带子该有的锯齿——带子走的是棋子，不是一条直线）。
        const band = buildEdgeBand({
          edges: outerEdges(edgeBoard, edgeThreshold()).map((e) => e.live),
          centerOf: (r, c) => {
            const pts = triGeometry(r, c).pts.map(toScreen);
            return [
              (pts[0][0] + pts[1][0] + pts[2][0]) / 3,
              (pts[0][1] + pts[1][1] + pts[2][1]) / 3,
            ];
          },
          /*
           * 一枚三角的「直径」取它的**高**（H = S·√3/2），不是边长 S。
           *
           * 带子是沿着一排棋子走的，玩家看见的「这一排有多厚」就是三角的高；按边
           * 长算会宽出一截（S 比 H 大 15%），带子就从「托盘上的提示」变成了「压在
           * 棋盘上的一条粗杠」。圆和方块那三副的外接框宽高相等，所以它们直接用格
           * 径——这儿差别只出在三角上。
           */
          pieceSize: H,
          width: refs.boardEl.clientWidth,
          height: refs.boardEl.clientHeight,
        });
        if (band) refs.boardEl.insertBefore(band, refs.boardEl.firstChild);
        flipInCells = new Set();
        // One triangle-shaped outline per tile, not a bounding rectangle
        // around the whole group — adjacent tiles here alternate up/down
        // orientation, so their combined outline is a zigzag, not a clean
        // box, and a rectangle would highlight empty corners no tile
        // occupies.
        for (const { cells, elapsedMs } of outlineEntries) {
          for (const [r, c] of cells) {
            spawnTriangleOutline(refs.boardEl, triGeometry(r, c).pts.map(toScreen), elapsedMs);
          }
        }
      }

      // A match only ever grows along its *own* seed shape's regular
      // directions (see matchGrowth.ts) — never a generic same-color flood
      // fill. A run-4 only extends further along that same line (so a
      // same-color triangle touching it from a different line never folds
      // in); a 31/13 big-triangle doesn't extend at all — it's a closed
      // shape, not an open-ended one, so it always scores exactly its own
      // 4 cells.
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }
      function isLiveCell(r: number, c: number): boolean {
        return !isBlank(grid[r][c]);
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

      // ---------- matching engine ----------
      /** 这一局的「几连」怎么念（枚数是变的，见 engine/matchGrowth 的 runLabel）。 */
      const runLabel = (n: number) => runLabelOf(lang, n);

      /**
       * 得分图案**只剩同色 1×N 连线**（《侵蚀阶梯》v1.2 §1.1）：大三角那一族连同方块
       * 的 2×2、小球的 2+2 / 1-2-1 一起删了。N 现问控制器（侵蚀阶梯会把它从 4 降到 1）。
       */
      function findRunMatches(mask: Set<string> | null): Match[] {
        const matches: Match[] = [];
        const n = controller.matchLen();
        const label = runLabel(n);
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + n <= cells.length; i++) {
            const seed = cells.slice(i, i + n);
            if (!qualifies(seed, mask)) continue;
            const region = extendRunInLine(cells, i, i + n - 1, effColorAt, isLiveCell);
            matches.push({ cells: region, points: groupPoints(region, (r, c) => grid[r][c]), label });
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

      /**
       * 这副棋盘交给「最外边」算法的那一份视图（engine/outerEdge.ts）。
       *
       * `isLive` 问的是**这一格还在不在盘上**：离场的格子（削掉的那些，`color` 打成
       * 了 BLANK）不算。**不看正反面**——一枚色块也是活格，只是它凑不成「整条同色
       * 星星」，颜色那一半在下面判。
       */
      const edgeBoard: EdgeBoard = {
        lines: LINES,
        isLive: (r, c) => !isBlank(grid[r][c]),
      };

      /**
       * 收尾放开（《侵蚀阶梯》v1.2 §3）：无边可削、又没有色块可翻的时候置上，门槛
       * 从 3 降到 1，一局之内**不回退**。
       *
       * 不放开的话每一局都以「盘上还剩几枚、怎么滑都没用」收场——削到最后剩下的那一
       * 小圈，每条边都短过常态门槛。
       */
      let endgameOpen = false;
      const edgeThreshold = () => (endgameOpen ? EDGE_MIN_ENDGAME : EDGE_MIN);

      function collectEdges(threshold: number): Cell[][] {
        const found: Cell[][] = [];
        for (const { live } of outerEdges(edgeBoard, threshold)) {
          if (!isFullDotMatch(live)) continue;
          const sig = live
            .map(([r, c]) => grid[r][c].id)
            .sort((a, b) => a - b)
            .join(',');
          if (bonusedSignatures.has(sig)) continue;
          bonusedSignatures.add(sig);
          found.push(live);
        }
        return found;
      }

      /**
       * 此刻能削的那几条外边——**只削最外面的**（《侵蚀阶梯》v1.2 §3）。
       *
       * 两半：几何那一半问 outerEdges（这一族里最靠外、活格够门槛、削掉之后每条线
       * 剩下的活格还连着）；颜色那一半在这儿判（整条同色星星）。
       *
       * 从前是「**任意**一整条同色星星都能消」。那条规则会从盘子中间掏出一条线来，
       * 穿过它的每条线当场断成两段——而滑动是在一条连续的活格上做循环移位，断了就
       * 再也滑不动了。
       */
      function findWholeLineBonuses(): Cell[][] {
        const found = collectEdges(edgeThreshold());
        if (found.length || endgameOpen) return found;
        /*
         * **收尾放开**（§3）：一条边都削不动、而且这盘子已经怎么滑都翻不动一枚色块
         * 了，就把门槛降到 1，这一拍接着削。连锁本来就是一拍一拍问下来的，所以放开
         * 之后它会自己一路削到底（每条照星星数² 计分，1 枚就是 1 分）。
         *
         * 判「翻不动了」用的是卡死判定本身，不是「这一步没得分」——大多数步本来就
         * 不得分，照那个判会在开局第二步就放开，整盘当场被削光。
         */
        if (!stuckAt(edgeThreshold()).length) return found;
        endgameOpen = true;
        return collectEdges(EDGE_MIN_ENDGAME);
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

      /**
       * 一组**整组都是星星**的图案得分了：这几格从棋盘上拿掉，留空位。
       *
       * 和整行奖励那条路（applyLineBonus）用的是同一套写法——先把 dotColor 存进
       * pendingBlankSnapshot，淡出动画靠它画出「消失前长什么样」那一帧
       * （playBlankTransition），然后把 color / dotColor 都打成 BLANK，于是
       * isBlank 那六处（渲染、移动合法性、卡死判定、liveTiles、拖拽预览、
       * anyBlank）自动全都认得它。
       *
       * 这个「消除」同时是这条规则的防刷分闸：星星从盘上没了，同一批星星凑不回
       * 同一个形状。
       */

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches: findRunMatches,
          findLineBonuses: findWholeLineBonuses,
          // 炸弹玩法：这一拍旁边的炸弹跟着挨一下（两下才拆），拆掉的格子并进下一拍的遮罩。规矩在
          // engine/bomb.ts 的 defuseAround（10-08 方案第五批第 3 条从五副棋盘里抽出来，只写一遍）；
          // 这儿只交代这一副盘谁挨着谁、某一格是哪一枚、哪一枚还是活炸弹。
          afterCommit: isBomb ? (scored) => defuseAround(scored, bombNeighbors, (r, c) => grid[r][c], liveBomb) : undefined,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false,
        };
      }

      function isGameOver(): boolean {
        // 「全是星星」**不再是终局**（星星消除 2026-09 上线之后）。星星现在自己
        // 就能凑图案得分、并从棋盘上消除（见 scoring.ts 的 clearStars），所以一盘
        // 全是星星的棋盘往往还能继续打——玩家报过一次：结算页写着「全部已变成星
        // 星」，可盘面上还躺着四颗同色蓝星，明明凑得出图案。
        //
        // 真正的终局只剩两种：**一枚不剩**（全消完，就是这儿判的），或者**谁也
        // 凑不出来了**（死局，交给 engine/stalemate.ts）。活炸弹拆不掉也消不掉，
        // 不算在「还剩东西」里。
        return grid.every((row) => row.every((t) => isBlank(t) || liveBomb(t)));
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const t = grid[r][c];
            if (isBlank(t)) continue;
            if (liveBomb(t)) continue;
            live.push({ cell: [r, c], tile: t });
          }
        return live;
      }

      /**
       * 这盘子在某个外边门槛下是不是已经走不动了。
       *
       * 两个门槛都是**现问**的，不写死：
       *   · 图案要几枚 —— 侵蚀阶梯此刻是第几级（4→3→2→1，见 engine/erosion.ts）。
       *     写死 4 的后果不是判得松，是判得太狠：图案已经降到 2 枚、盘上明明还凑得
       *     出，却被当成死局——而死局没有任何按钮拦得住，1.4 秒后直接结算。
       *   · 星星自己那条路 —— **此刻最短的那条可削外边**。一条都削不动时给一个够不
       *     着的大数：星星现在只有「填满一条外边」这一条活路了（§1.1 之后，全是星星
       *     的图案不给分也不消除），给 0 会被 stalemate 那头夹成 1，等于永远判活。
       */

      /**
       * 这一格此刻是什么，喂给残局穷举（engine/residueBoard.ts）。
       *
       * 和 `liveTiles()` **不是同一份**，这一点最容易接错：那一份把空白和活炸弹都排除在外
       * （它是给计分和计数用的）。可**这两样在这儿的待遇不一样**，下面两段分别说。
       *
       * ⚠️ **空白回 `null`，不是 `'blank'`**（2026-10-02 修）。
       *
       * `null` 的意思是「不在盘上：不占位置、不参与滑动」，而这正是外边族消掉的格子此刻的
       * 样子——滑动是在 `liveOnLine()` 那一串上做循环移位（见 applyDrag），**被削掉的格子
       * 已经不在那串里了**，剩下的球首尾相接，整条线变短。
       *
       * 从前这儿回 `'blank'`（「占着位置、跟着线一起滑的无色球」）。那是星星消除那个年代的
       * 事：那时候消掉的球原地变成一枚无色球，确实照样滑。《侵蚀阶梯》PR-3 把外边族改成
       * 「削掉的格子离场」之后，这一句就在**拿一副不存在的棋盘喂给穷举**——线长不对，循环
       * 位移算出来的排列整个不对。于是它既会算出真实棋盘到不了的得分（该判死的判活），也会
       * 漏掉真实棋盘到得了的（该判活的判死），而两种都只是「局不结束」或者「局突然结束」，
       * 屏幕上一个字都不报。
       *
       * **活炸弹照旧回 `'blank'`**：它真的占着一格、真的跟着线滑，只是配不上任何颜色。
       * 漏掉它（像 `liveTiles()` 那样）穷举算的就又是另一副棋盘了。
       */
      const residueAt = (r: number, c: number) => {
        const t = grid[r]?.[c];
        if (!t) return null;
        if (isBlank(t)) return null;
        if (liveBomb(t)) return 'blank' as const;
        return { color: effColor(t), dot: t.face === 'dot' };
      };

      function stuckAt(threshold: number): Cell[][] {
        const edge = shortestEdge(edgeBoard, threshold);
        const need = controller.matchLen();
        const live = liveTiles();
        const counted = findStuckColorGroups(live, need, edge || NO_EDGE);
        // 计数那一层已经说死了就不用再算——它只会偏松（说活），不会偏紧。
        if (counted.length) return counted;
        /*
         * 计数说活，**可它从不看几何**（engine/stalemate.ts 开头那段）：「数量够、摆法
         * 永远到不了」的残局会被一直判活，玩家报过——剩几枚怎么滑都不得分，局却不结束。
         *
         * 所以盘子小到一定程度之后，再花一点力气真的穷举一遍（§4 的「可用 ≤16 枚 BFS
         * 穷举」，见 engine/residueSearch.ts）。算不完一律当活，所以这一段只会**多**判
         * 出死局，不会把还能打的局掐掉。
         */
        if (live.length > RESIDUE_MAX_TILES) return [];
        const verdict = edgeResidue(edgeBoard, residueAt, need, threshold, true);
        return verdict === 'dead' ? stuckGroupsOf(live) : [];
      }

      /**
       * 一条线上此刻**还在盘上**的那几格，按线上的顺序。
       *
       * 滑动是在这一串上做循环移位（见 applyDrag）。削掉的格子离场之后就不在这串里
       * 了，所以整条线变短、剩下的棋子照样首尾相接——这正是《侵蚀阶梯》v1.2 §3 的
       * endsAll 要保证的那件事：削完每条线剩下的活格还连着，不会被掏成两段。
       */
      function liveOnLine(cells: readonly Cell[]): Cell[] {
        return cells.filter(([r, c]) => !isBlank(grid[r][c])).map(([r, c]) => [r, c] as Cell);
      }

      function findStuckGroups(): Cell[][] {
        // 这一副没有《无限反转》（那一档只在基础方块和小球上），所以不必像那两副
        // 一样先把「翻过去还能翻回来」摘出去。
        return stuckAt(edgeThreshold());
      }

      function countRemainingTiles() {
        return countRemainingTilesFn(liveTiles());
      }

      function snapshotBoard(): BoardSnapshot {
        const H = Math.sqrt(3) / 2;
        const raw: RawCell[] = [];
        for (let r = 0; r < ROW_LENS.length; r++)
          for (let c = 0; c < ROW_LENS[r]; c++) {
            const tile = grid[r][c];
            // 离场的格子不进分享卡：它们已经不在盘上了（《侵蚀阶梯》v1.2 §3），
            // 卡上该是玩家最后看见的那副缩小了的棋盘，不是原来那一圈打了洞。
            if (isBlank(tile)) continue;
            const { i, p } = globalPos(r, c);
            const up = p % 2 === 0;
            const j = up ? p / 2 : (p - 1) / 2;
            const xBase = -i / 2 + j;
            const points: [number, number][] = up
              ? [[xBase, i * H], [xBase - 0.5, (i + 1) * H], [xBase + 0.5, (i + 1) * H]]
              : [[xBase + 0.5, (i + 1) * H], [xBase, i * H], [xBase + 1, i * H]];
            raw.push({
              kind: 'poly',
              points,
              face: tile.face,
              color: COLORS[effColor(tile)],
              hazard: isBomb && liveBomb(tile),
            });
          }
        return packSnapshot(raw);
      }

      function highlightStuck(cells: Cell[] | null) {
        stuckKeys = stuckKeysOf(cells);
      }

      function resetBoard() {
        grid = isBomb ? generateCleanBombBoard(() => boardFromBombDeck(shuffledDeck()), hasInitialClump, BOMB_ADJ, liveBomb) : generateCleanBoard();
        /*
         * 开发时手摆的那副牌（`engine/devDeal.ts`）。**正式包里这一句整段不存在**
         * （`import.meta.env.DEV` 是构建时常量，Vite 把它摇掉）。
         *
         * 摆在 `generateCleanBoard()` **之后**：发牌那一套该跑的照旧跑一遍（颜色配额、
         * 开局不许有现成的得分组、三角那一副的朝向配平……），手摆的只是盖在上面。少
         * 写的那几格原样留着发出来的牌，所以一副写一半的 devDeal 不会把棋盘弄坏。
         */
        const dealt = devDealFor('triangleBig');
        if (dealt) applyDevDeal(grid, dealt, BLANK);
        bonusedSignatures = new Set();
        outlineTracker.reset();
        stuckKeys = null;
        // 收尾放开**不许跨局**。这一句从前没有，于是上一局一旦触发过放开
        // （endgameOpen = true，一局之内不回退，见上面那段），`newGame` 调
        // `resetBoard` 重发一副牌时它还留在闭包里——下一局从第一步起就带着
        // 「最短边门槛 1」，而玩家看到的是一副全新的棋盘。不崩、不报错，只是
        // 这一局的消除规则悄悄比规则书写的松。
        endgameOpen = false;
      }

      const controller = createGameController(refs, {
        // 侵蚀阶梯要的两个数（《侵蚀阶梯》v1.2 §2）：六边三角 54×6（id 是 triangleBig）。
        // 一枚棋子一段，所以「可用格数」＝ 发牌时每色几枚 × 几色。
        /**
         * 盘上还剩几枚可用格——结算页那个步数系数要的「已清格数」按它算
         * （《侵蚀阶梯》v1.2 §5：已清 = boardTiles − 这个数）。
         *
         * 数的是「不是空位的格子」：削掉离场的、以及中间那个永久空位（如果有），
         * 都不在里头。所以开局这个数正好等于 boardTiles。
         */
        tilesLeft: () => {
          let n = 0;
          for (const row of grid) for (const t of row) if (!isBlank(t)) n++;
          return n;
        },
        boardTiles: PER_COLOR * PALETTES.standard.length,
        boardColors: PALETTES.standard.length,
        lang,
        practice: !!opts?.practice,
        bestKey: bestKey + suffixFor(modeKey),
        shapeName: shapeName(lang, 'triangleBig', '大三角'),
        shapeId: 'triangleBig',
        modeKey,
        timeLimitSec: opts?.timeLimitSec,
        coach: !!opts?.coach,
        // 这一局用哪一串种子发牌（第 19 推，见 ShapeGameOpts.seed）。
        seed: opts?.seed,
        coachTip: opts?.coachTip,
        shouldLeadOut: opts?.shouldLeadOut,
        shouldTeachTotal: opts?.shouldTeachTotal,
        resetBoard,
        render,
        isGameOver,
        buildCascadeConfig,
        checkHazard: isBomb ? checkBombHazard : undefined,
        findStuckGroups,
        countRemainingTiles,
        snapshotBoard,
        highlightStuck,
        // Regular matches (run-of-4 and the big-triangle cluster) stay on
        // the board, so they get the persistent outline highlight, added
        // per cascade step so a chain reaction reveals one beat at a time.
        // A whole-line bonus instead blanks its cells (see applyLineBonus)
        // — its own fade transition is that event's feedback, not outlined
        // — played in onCascadeStepRendered since the ghost must be
        // appended *after* this step's own render() or that render() would
        // wipe it.
        onCascadeStep: ({ matchGroups }) => {
          // 这一拍还没 render()，`fit` 还是玩家此刻看到的那一帧——记下来（见 ui/boardZoom.ts）。
          zoom.mark(fit);
          outlineTracker.add(matchGroups, MULTI_GROUP_STAGGER_MS);
        },
        // 按快照有没有东西判断，不按「这一拍有没有整行奖励」——整组星星得分也会
        // 往快照里塞东西，而它走的是 matchGroups 那条路。两个列表都传进去，
        // playBlankTransition 自己会跳过快照里没有的格子。
        onCascadeStepRendered: ({ lineBonusGroups, matchGroups }) => {
          if (pendingBlankSnapshot.size) {
            playBlankTransition([...lineBonusGroups, ...matchGroups], pendingBlankSnapshot);
            pendingBlankSnapshot = new Map();
          }
          // 这一拍削掉了格子的话，先倒回上一帧的样子，停一下，再长过来。没削掉的那些拍
          // zoom.play 自己什么都不做。
          zoom.play(fit);
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
      // the *old* dot-colored look dissolving into the *new* blank tile
      // already sitting beneath it, rather than fading to an empty gap.
      let pendingBlankSnapshot = new Map<string, number>();

      function playBlankTransition(groups: Cell[][], snapshot: Map<string, number>) {
        if (reduceMotion()) return;
        for (const cells of groups) {
          for (const [r, c] of cells) {
            const dotColor = snapshot.get(cellKey(r, c));
            if (dotColor === undefined) continue;
            const fakeTile: Tile = { id: -1, color: 0, face: 'dot', dotColor };
            const ghost = makeTriEl(fakeTile, r, c);
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

      // Unlike square's tiles or circle's balls, a triangle's own shape
      // depends on which slot it's in — every line here strictly alternates
      // up/down from one cell to the next (confirmed: no line on this board
      // ever has two consecutive same-orientation cells). Up and down
      // triangles are mirror images, not translations of each other, so
      // sliding a *fixed* clip-path element sideways by raw pixels (as an
      // earlier version of this did) puts the wrong silhouette at half the
      // positions it passes through — it only ever looked right again once
      // the drag settled and a real render() rebuilt every shape from
      // scratch, which is exactly the "shape/position changes, or the move
      // seems to snap back" effect players were seeing mid-drag.
      //
      // The fix: never move a shaped element. Each of the n slots in the
      // line keeps its own fixed shape+position (from its own true
      // geometry) always — only *which tile's color* renders in that slot
      // changes, via the same modular remap applyDrag will commit on
      // release (so the preview can never show a configuration release
      // wouldn't). This also makes the line a genuine cyclic buffer: every
      // slot is always populated by construction, so there's no "overflow"
      // and thus no wraparound ghosts needed at all.
      //
      // A *shift* by itself still leaves a residual problem every line here
      // shares: every line has an ODD number of cells (7/9/11 — a hexagon
      // built from small triangles can't have an even-length row or
      // diagonal), and an odd-length cycle can't be perfectly 2-colored —
      // so ordinary rotation always mismatches some tiles' orientation once
      // content wraps from one end to the other. The fix used here has two
      // parts: (1) the "moving unit" — the tiles that stay within the
      // line's own span, not wrapping — only ever settles on an EVEN shift,
      // which (given strict alternation) *always* keeps every one of those
      // tiles correctly oriented; (2) the wrapped tiles ("filler", shown
      // dimmed as a preview of what's flowing in) always mismatch by
      // exactly one step under an even shift, but adjacent slots always
      // alternate orientation too — so swapping which of each ADJACENT PAIR
      // of filler slots gets which tile's content exactly cancels that
      // mismatch. The filler region's size always equals the (even) shift,
      // so it always splits into whole pairs with nothing left over.
      // fillerAwareSource 本体搬到了 engine/slideLine.ts（第 14 推）：applyDrag 要把它当参数
      // 交给 slideLine，残局穷举（engine/residueSearch.ts）也要用同一个——从前那边抄了一份，
      // 因为这一个在闭包里拿不到。上面这一大段讲的就是它。

      const FILLER_OPACITY = 0.55;

      function renderDragPreview() {
        render();
        const d = drag;
        if (!d || !d.fam || !d.line) return;
        const cells = liveOnLine(d.line.cells);
        const n = cells.length;
        // Magnetize toward the nearest EVEN step (halve, snap, double) so
        // the "moving unit" only ever settles at an orientation-preserving
        // shift — odd intermediate positions are passed through smoothly
        // while dragging but are never a stable rest point. A gentler power
        // than the other boards' per-step snap (each detent here is twice
        // as far apart, so the same curve would otherwise pull noticeably
        // harder over that longer stretch and feel forced rather than guided).
        const half = magnetizeFollow(projectedSteps(d.fam, d.dx, d.dy) / 2, MAGNET_POWER, MAGNET_BLEND);
        // 夹紧和 applyDrag 那一处同一句：预览画出来的，必须正是松手之后落定的那一副。
        const shift = clampOddShift(2 * Math.round(half), n);
        // A light tick each time the drag crosses into a new suitable
        // (even) configuration — the discrete, physical "click" of passing
        // a detent, felt (haptics) and not just inferred from the drag's
        // subtler positional easing.
        if (shift !== d.lastShift) {
          vibrate(6);
          playMove(); // ...and a tick, so a long slide reads as a run of detents
          d.lastShift = shift;
        }
        // The small leftover distance from that nearest snap point: near
        // zero almost all the time (magnetizeRawDist sticks close to even
        // integers), growing toward ±1 only while passing through the
        // midpoint to the next suitable slot — used as a tiny same-shape
        // nudge so a slot's content still visibly "gives" a little instead
        // of teleporting.
        // The give is no longer one rigid nudge for the whole line: each
        // pair rides its own lagged value from the chain (the splash's
        // integrator, in pair units), so the give ripples down the line and
        // the far end keeps swinging for a beat — the closest this
        // interlocked, pair-swapping board can come to the splash's slide.
        const [dirX, dirY] = trueStepVector(d.fam);
        const stepLen = Math.hypot(dirX, dirY);
        const chain = d.chain;
        const giveAt = (idx: number) => {
          const pairHalf = chain ? chain.at(Math.floor(idx / 2)) : half;
          // Undamped: the give is what the line does between detents, so
          // anything less than 1:1 is the board lagging the finger. It used
          // to be scaled to 0.6 to tame a wobble that came from the
          // inter-piece simulation, and with that turned down to near
          // nothing (see BOARD_FORCE) the damping was only costing
          // responsiveness — measured, a triangle followed a 29px drag by
          // 17px where the square followed it by 23px and the ball by 30px,
          // which is exactly the "not very sensitive" the boards felt. The
          // clamp is one whole step, which is the midpoint to the next
          // even configuration, so the preview still cannot run past what
          // release would commit.
          const residual = 2 * pairHalf - shift;
          return Math.max(-1, Math.min(1, residual));
        };
        const fillerSize = Math.abs(shift);

        for (let idx = 0; idx < n; idx++) {
          const [r, c] = cells[idx];
          const sourceIdx = fillerAwareSource(idx, shift, n);
          const [sr, sc] = cells[sourceIdx];
          const isFiller = shift > 0 ? idx < fillerSize : idx >= n - fillerSize;
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) el.remove();
          const give = giveAt(idx);
          const fresh = makeTriEl(grid[sr][sc], r, c, isFiller ? FILLER_OPACITY : undefined, [give * dirX, give * dirY]);
          if (chain) fresh.style.scale = pressScale(chain.press(Math.floor(idx / 2)), dirX / stepLen, dirY / stepLen, BOARD_FORCE);
          refs.boardEl.appendChild(fresh);
        }
        // The bands above and below get carried a little and sprung home.
        if (chain) {
          const inLine = new Set(cells.map(([r, c]) => cellKey(r, c)));
          for (let r = 0; r < ROW_LENS.length; r++) {
            const nudge = chain.side(Math.abs(r - d.r));
            if (!nudge) continue;
            for (let c = 0; c < ROW_LENS[r]; c++) {
              if (inLine.has(cellKey(r, c))) continue;
              const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
              if (el) el.style.translate = `${nudge * dirX}px ${nudge * dirY}px`;
            }
          }
        }
      }

      // Returns whether it actually resolved a move (and thus already
      // re-rendered at least once) — the caller needs this so it doesn't
      // blindly render() again right after, which would wipe out a cascade
      // step's ghost/flip/highlight elements before they ever get a frame
      // painted (resolveMove no longer settles synchronously — see
      // gameController's stepper-driven reveal).
      // 四连爆炸：什么时候查（这一步的连锁全部走完之后，只查一次）、炸了扣多少、结算页写什么，都在
      // engine/bomb.ts 的 blowUpIfClustered（10-08 方案第五批第 3 条从五副棋盘里抽出来）。这儿只交代
      // 这副盘、谁挨着谁、怎么收场。
      function checkBombHazard(): boolean {
        return isBomb && blowUpIfClustered(grid, BOMB_ADJ, liveBomb, { render, forceEnd: (...a) => controller.forceEnd(...a) });
      }

      function applyDrag(): boolean {
        const d = drag;
        if (!d || !d.fam || !d.line) return false;
        const cells = liveOnLine(d.line.cells);
        const n = cells.length;
        // Same even-rounding as the preview (magnetizeRawDist's contract —
        // Math.round(magnetize(x)) === Math.round(x) — holds identically
        // when applied to x/2, so the plain, unmagnetized value already
        // agrees with whatever the preview last displayed).
        //
        // 夹在 ±(n − 1) 以内，和预览那一处同一句（第 14 推）：奇数长的线滑过 n − 1 格，
        // fillerAwareSource 会把同一枚分给两格、另一枚凭空消失（「长滑会复制或丢棋子」）。
        const shift = clampOddShift(2 * Math.round(projectedSteps(d.fam, d.dx, d.dy) / 2), n);
        // 活格不到两枚、转了整圈、算出来的不是排列：这一下不算一步（engine/slideLine.ts）。
        const shifted = slideLine(cells.map(([r, c]) => grid[r][c]), shift, fillerAwareSource);
        if (!shifted) return false;
        cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
        const mask = new Set<string>(cells.map(([r, c]) => cellKey(r, c)));
        seatLine(refs.boardEl, mask);
        const [vx, vy] = trueStepVector(d.fam);
        const sign = Math.sign(shift) || 1;
        controller.resolveMove(mask, (Math.atan2(vy * sign, vx * sign) * 180) / Math.PI);
        return true;
      }

      /**
       * 手指落下那一刻，棋盘上要是正压着放大动画的那个变换，落点就要往回换算一道。
       *
       * `engine/drag.ts` 量的是 `clientX − boardEl.getBoundingClientRect().left`，而那个
       * rect 是在 `onBeforeStart` **之后**读的——我们在那儿已经把变换摘掉了，于是量出来的是
       * 「没有变换时的板内坐标」。可玩家按的是**变换之后**画在那儿的那一枚：
       *
       *   板内看到的位置 = ax + s × 没有变换时的位置
       *
       * 所以反过来除一道。不修的话，放大 2 倍的时候他按哪儿抓到的都是另一枚——而屏幕上只
       * 看出「这游戏点不准」。
       */
      let dragFix: { ax: number; ay: number; s: number } | null = null;
      const unfix = (x: number, y: number): [number, number] =>
        dragFix ? [(x - dragFix.ax) / dragFix.s, (y - dragFix.ay) / dragFix.s] : [x, y];

      const detachDrag = attachDrag(refs.boardWrap, {
        origin: refs.boardEl,
        // A touch arriving mid-reveal runs the rest of it now rather than
        // being turned away — see GameController.hurry().
        onBeforeStart: () => {
          // 先取消（拿到取消那一刻压着的那个变换），再 hurry。次序不能换：hurry 会把剩下
          // 那几拍一次跑完，那几拍自己又会 render → layoutBoard → cancel。
          const snap = zoom.cancel();
          const before = fit;
          controller.hurry();
          // hurry 真的又走了几拍的话，连「没有变换时的位置」都变了，这个修正量就不作数了。
          const moved = fit.unit !== before.unit
            || fit.originX !== before.originX || fit.originY !== before.originY;
          dragFix = moved ? null : snap;
        },
        isActive: () => controller.started && !controller.paused && !controller.gameOver && !controller.resolving,
        onRejected: () => vibrate(15),
        onStart(x, y) {
          // A touch arriving while the previous line is still swinging ends
          // that settle right now instead of being swallowed — fast play was
          // losing whole moves to a wave that had not finished dying down.
          drag?.chain?.flush();
          if (controller.resolving) {
            drag = null;
            dragFix = null;
            return;
          }
          // 修正只对**落下那一下**成立：到了 onRegrab 那会儿变换早就摘掉了。
          const [px, py] = unfix(x, y);
          dragFix = null;
          const [r, c] = cellAt(px, py);
          // 手指落在一个已经离场的格子上：那儿什么都没有，这一下就什么都不做（和小球那一副
          // 同一句，第 14 推）。从前这几副不拦，于是抓着一条可能只剩一枚、甚至一枚活格都没
          // 有的线滑出去——什么都没动，步数照扣。
          if (isBlank(grid[r][c])) {
            drag = null;
            return;
          }
          drag = { r, c, fam: null, line: null, dx: 0, dy: 0, lastShift: 0, chain: null };
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
          // 改抓的时候也一样：挪到一片空地上就维持原来抓的那一颗，不要抓空。
          if (isBlank(grid[r][c])) return null;
          drag.r = r;
          drag.c = c;
          return { r, c };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.fam) {
            const candidates = (['A', 'B', 'R'] as const)
              .map((fam) => ({ fam, line: lineFor(fam, drag!.r, drag!.c), proj: Math.abs(scalarProjection(fam, dx, dy)) }))
              .sort((a, b) => b.proj - a.proj);
            drag.fam = candidates[0].fam;
            drag.line = candidates[0].line;
            const liveCells = liveOnLine(drag.line.cells);
            const grabbed = liveCells.findIndex(([r, c]) => r === drag!.r && c === drag!.c);
            drag.chain = createDragChain({
              n: Math.max(1, Math.ceil(liveCells.length / 2)),
              grabbed: Math.max(0, Math.floor(Math.max(0, grabbed) / 2)),
              force: BOARD_FORCE,
              onFrame: renderDragPreview,
            });
          }
          const d = drag;
          if (!d.fam || !d.chain) return;
          d.chain.drive(magnetizeFollow(projectedSteps(d.fam, dx, dy) / 2, MAGNET_POWER, MAGNET_BLEND));
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
          d.chain.settle(Math.round(projectedSteps(d.fam, dx, dy) / 2), () => {
            d.chain?.stop();
            const moved = applyDrag();
            drag = null;
            // Only a no-op drag needs this render to snap the preview clean.
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
        stopPro();
        detachDrag();
        stopResize();
        zoom.dispose();
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
      // Pro 那一圈是真画进 DOM 的（见上面 proTriRing 那段），所以拨开关要重画一遍棋盘。
      // 方块和小球不用：它们那一圈纯靠 CSS，data-pro 一变就跟着变。
      const stopPro = onProChange(() => {
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
