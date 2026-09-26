import { buildShell } from '../ui/gameShell';
import { createGameController } from '../engine/gameController';
import { groupPoints } from '../engine/groupScore';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { createDragChain, pressScale, BOARD_FORCE, type DragChain } from '../engine/dragChain';
import { vibrate } from '../engine/haptics';
import { floorBox, observeBoardSize, fitFloor } from '../engine/boardResize';
import { colorblindOn, onColorblindChange, themedPalette } from '../engine/palettePref';
import { playMove, seatLine } from '../engine/juice';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, spawnOutlineEl, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { proCircleRing, proHintWidth } from '../engine/proHint';
import { onProChange, proOn } from '../engine/proMode';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, type LiveTile } from '../engine/stalemate';
import { extendRunInLine, growParallelogram } from '../engine/matchGrowth';
import { packSnapshot, type BoardSnapshot, type RawCell } from '../engine/shareCard';
import { renderPatternHintIcons, type PatternDef } from '../engine/patternIcon';
import { scoreOf, sizeOf } from '../engine/targets';
import { findTargets, type BoardView } from '../engine/targetMatch';
import { targetPatternDefs } from '../engine/targetIcon';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { shuffle } from '../engine/rng';
import { crackLayer } from '../ui/bombCrack';
import { BOMB_RED_HEX, BOMB_HAZARD_PENALTY, BOMB_HAZARD_REASON, dealBombBacks, hitBomb, isCrackedBomb, isLiveBomb } from '../engine/bomb';
import { STRINGS as MATCH_LABELS, STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
import type { ShapeGame, ShapeGameOpts } from './types';
import { modeKeyOf, suffixFor } from '../engine/runKey';

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
// color. 这 7 颗炸弹的反面在发牌时就印好了（dealBombBacks）：一颗仍是红的永久
// 炸弹，其余各印一种基础色；正常棋子的反面里永远不会出现红，不然拆出来的星星
// 会和真炸弹混淆。
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
  /** The splash's inter-piece physics, driving every frame of the preview. */
  chain: DragChain | null;
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
      family: 'circle',
      ruleShape: 'circle',
    },
    mount(container, onBack, opts?: ShapeGameOpts) {
      const isBomb = !!opts?.bomb;
      /**
       * 这一枚此刻是不是一颗**活**炸弹（判四连、闪三连预警、数活棋子都问它）。
       *
       * 问的是露在外面的那一面：正面红 = 还没拆；拆成
       * 基础色星星的，不再是炸弹。理由写在 engine/bomb.ts 的 isLiveBomb 上面。
       */
      const liveBomb = (t: Tile) => isBomb && isLiveBomb(t, RED_IDX);
      /** 无限反转（见 ShapeGameOpts.flip）：得分翻面来回翻，不消行，只由计时结束。 */
      const flipMode = !!opts?.flip;
      /** 步步为营（见 ShapeGameOpts.steps 与 engine/puzzleScore.ts）：手里 8 步，没有钟。 */
      const puzzleMode = !!opts?.steps;
      // 这一局记成什么模式、存进哪个键——两样都由 engine/runKey.ts 推。
      // 存档键的后缀带着规则版本号。从前这儿手写着上一版的后缀：炸弹升到第 3 版、
      // 无限反转升到第 2 版，读的那一头跟着常量走了，这儿的字面量没人记得改，于是
      // 新规则的局落进了旧规则的归档（那个文件开头写着后果）。
      const modeKey = modeKeyOf({ bomb: isBomb, flip: flipMode, steps: puzzleMode, timed: !!opts?.timeLimitSec });
      const lang = opts?.lang ?? 'zhHans';
      // 随机得分目标：这一局认哪两个图案。没给就是这个玩法自己那几个。
      const targets = opts?.targets?.length ? opts.targets : null;
      /** 这一局最少几枚才可能算分——死局判定拿它当门槛。 */
      const minMatchSize = targets ? Math.min(...targets.map(sizeOf)) : undefined;
      const refs = buildShell(container, {
        lang,
        practice: !!opts?.practice,
        shapeId: 'circle',
        timed: !!opts?.timeLimitSec,
        flip: flipMode,
        steps: puzzleMode,
        bomb: isBomb,
        title: `Slides · ${shapeName(lang, 'circle', '圆球')}`,
        tagline: isBomb ? SHELL[lang].taglineThreeWay + ' · ' + SHELL[lang].taglineBomb : SHELL[lang].taglineThreeWay,
        startBody: SHELL[lang].shellStartBody,
        patternIcons: renderPatternHintIcons(targets ? targetPatternDefs(targets) : PATTERNS, lang),
        // 随机得分目标：开局页换成那台老虎机，当场把这两个转出来。
        slotTargets: targets ?? undefined,
        // 头一局那块教学条（见 ui/coachBar.ts）。只有头一回进来的那一局有。
        coach: !!opts?.coach,
        noCountdown: !!opts?.noCountdown,
      });

      const pickPalette = (): readonly string[] =>
        themedPalette(
          (isBomb ? BOMB_PALETTES : PALETTES)[colorblindOn() ? 'colorblind' : 'standard'],
          isBomb ? RED_IDX : -1,
        );
      let COLORS: readonly string[] = pickPalette();
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
      // 7th — red is excluded from every *normal* ball's dot-color pool, so
      // a normal star is never mistaken for a hazard. The red balls' own
      // backs are dealt separately just below (dealBombBacks).
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
          dotColors[idx] = bombBacks[i];
        });
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

      /** 炸弹的「挨着」：和判四连、闪预警用同一份邻接（circleNeighbors）。 */
      const bombNeighbors = (r: number, c: number): Cell[] => circleNeighbors(r, c);

      /**
       * 得分图案旁边的炸弹，跟着这一拍挨一下。**两下才拆**（玩家定的，见
       * engine/bomb.ts 的 BOMB_HITS_TO_DEFUSE）：第一下只留一道裂纹，第二下才
       * 翻成它自己的反面（一枚基础色星星）。挨着
       * 的全算，没有上限。
       *
       * 回传拆掉的那几格，连锁那边会把它们并进**下一拍的遮罩**（见 scoring.ts
       * 的 afterCommit）。不并的话会出这种事：蓝色 2×2 得分，右边的炸弹翻成绿
       * 星星，这颗绿星星另一侧恰好有三枚绿正面、四枚正好凑成一个绿色 2×2——可
       * 它一格都不在遮罩里，这一步找不到它，图案摆在盘上不给分，要等以后某次
       * 滑动碰巧碰到。玩家看见的是「拼好了却没给分，过几步又莫名其妙给了」。
       *
       * 拆弹本身不给分、weight 也不记，所以计分和「有效得分率」的口径不变。
       */
      function defuseAround(scored: Cell[]): Cell[] {
        if (!isBomb) return [];
        const hit: Cell[] = [];
        const seen = new Set<string>();
        for (const [r, c] of scored) {
          for (const [nr, nc] of bombNeighbors(r, c)) {
            const key = cellKey(nr, nc);
            if (seen.has(key)) continue;
            const t = grid[nr][nc];
            // 只打还立着的那些。已经翻过去的（包括那枚翻完仍算炸弹的永久
            // 炸弹）不再动它，不然它会被反复算进「这一拍又拆了几枚」。
            if (t.face !== 'flavor' || !liveBomb(t)) continue;
            // 一拍之内同一枚最多挨一下——seen 拦的正是「两组图案同时贴着它」。
            seen.add(key);
            // 第一下只裂，不翻面，也不并进遮罩：盘面对配对来说一个字没变，它
            // 仍旧是一枚立着的红障碍。裂纹由 render 照着 bombHits 画。
            if (!hitBomb(t)) continue;
            t.face = 'dot';
            hit.push([nr, nc]);
          }
        }
        return hit;
      }

      function redClusterKeys(g: Tile[][], minSize: number): Set<string> {
        const found = new Set<string>();
        const seen = new Set<string>();
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c <= r; c++) {
            if (!liveBomb(g[r][c])) continue;
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
                if (seen.has(key) || !liveBomb(g[nr][nc])) continue;
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
        const rect = floorBox(refs.boardWrap);
        const S = Math.min(rect.width, rect.height);
        R = S / 14;
        rowH = R * Math.sqrt(3);
        const totalH = (ROWS - 1) * rowH + 2 * R;
        boardTop = (S - totalH) / 2;
        boardLeft = S / 2; // center x, per-row offset applied in position calc
        refs.boardEl.style.width = S + 'px';
        refs.boardEl.style.height = S + 'px';
             // 图形已经按整格算满了，地板收成正方形不会动到它。
        fitFloor(refs.boardWrap, S, S);
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
        }
        // 挨过一下、还没拆的那几枚：身上画一道裂纹（ui/bombCrack.ts）。没有它，
        // 「两下才拆」这条规则在屏幕上根本不存在，玩家只会觉得「贴着打了一次
        // 怎么没掉」。画在「！」前面，所以那个记号压在裂纹上，不会被盖住。
        if (isCrackedBomb(tile)) el.appendChild(crackLayer(size * 0.72));
        // 「！」画在正面（还没拆的炸弹）。反面那一支留着：第 3 版取消了永久炸弹，所以
        // 现在发不出红反面；这件事来回过两轮，画法不跟着删（见 engine/bomb.ts）。它的
        // 反面还是红（dealBombBacks 留的），照旧按炸弹规则算，而红星星和别的
        // 星星形状一模一样，不加这个记号就混在里面认不出来了。
        if (liveBomb(tile)) {
          const mark = document.createElement('div');
          mark.className = 'hazard-mark';
          mark.textContent = '!';
          mark.style.fontSize = Math.round(size * 0.5) + 'px';
          el.appendChild(mark);
        }
        if (opacity !== undefined) el.style.opacity = String(opacity);
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
        // 少挂一副就回到老 bug，而且没有门守着。现在 anyDotFace 问的是共享契约里
        // 本来就必填的 `CascadeConfig.tileAt(r, c).face`（少实现一副当场编译不过），
        // 那条路和这一句再也没有关系了。
        el.dataset.face = isBlank(tile) ? 'blank' : tile.face;
        // Pro 模式那一圈：这一枚**得分之后会变成什么颜色**（engine/proHint.ts）。只有
        // 正面那一枚有这件事可说——翻过面的已经是那颗星星了，空位更没有。
        // 虚线的节奏得自己定（CSS 的 dashed 定不了，见 proHint.ts），所以这是真画进去
        // 的一层，只在开着 Pro 的时候建；拨开关那一下由 onProChange 重画。
        if (proOn() && !isBlank(tile) && tile.face === 'flavor') {
          el.appendChild(proCircleRing(size, COLORS[tile.dotColor], proHintWidth(size)));
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
        const warnKeys = isBomb ? redClusterKeys(grid, 3) : null;
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c <= r; c++) {
            const key = cellKey(r, c);
            const el = makeBallEl(grid[r][c], r, c);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key));
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            if (warnKeys?.has(key)) el.classList.add('hazard-warn');
            frag.appendChild(el);
          }
        }
        refs.boardEl.innerHTML = '';
        refs.boardEl.appendChild(frag);
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

      /**
       * 随机得分目标那一局，判定要问棋盘的那几件事。棋盘和滑法一概不动，
       * 变的只有「拼成什么算分」。
       *
       * 空球（消过一整行留下的那些）在这里当成「没有这一枚」，不是「一枚
       * 灰色的」——不然一排空球会被当成同色拼图。
       */
      const targetView: BoardView = {
        has: (r, c) => cellValid(r, c) && !isBlank(grid[r][c]),
        tileAt: (r, c) => (cellValid(r, c) && !isBlank(grid[r][c]) ? grid[r][c] : null),
        cells: () => {
          const out: Cell[] = [];
          for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) out.push([r, c]);
          return out;
        },
      };

      function findTargetMatches(mask: Set<string> | null): Match[] {
        const out: Match[] = [];
        for (const p of targets!) {
          for (const cells of findTargets(targetView, p)) {
            if (mask && !cells.some(([r, c]) => mask.has(cellKey(r, c)))) continue;
            out.push({ cells, points: scoreOf(p), label: p.id });
          }
        }
        return out;
      }

      function findRunMatches(mask: Set<string> | null): Match[] {
        if (targets) return findTargetMatches(mask);
        const matches: Match[] = [];
        for (const line of LINES) {
          const cells = line.cells;
          for (let i = 0; i + 3 < cells.length; i++) {
            const seed = cells.slice(i, i + 4);
            if (!qualifies(seed, mask)) continue;
            const region = extendRunInLine(cells, i, i + 3, effColorAt, isLiveCell);
            matches.push({ cells: region, points: groupPoints(region, (r, c) => grid[r][c]), label: MATCH_LABELS[lang].labelRun4 });
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
              matches.push({ cells: region, points: groupPoints(region, (r, c) => grid[r][c]), label: MATCH_LABELS[lang].labelBlock22 });
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
              matches.push({ cells: region, points: groupPoints(region, (r, c) => grid[r][c]), label: MATCH_LABELS[lang].labelBlock22 });
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
      function clearStarGroup(cells: Cell[]) {
        for (const [r, c] of cells) {
          const t = grid[r][c];
          if (isBlank(t)) continue;
          pendingBlankSnapshot.set(cellKey(r, c), t.dotColor);
          t.color = BLANK;
          t.dotColor = BLANK;
        }
      }

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches: findRunMatches,
          // 无限反转：反面同色连成一行 / 列不消除，也就不再找整线奖励。
          findLineBonuses: flipMode ? () => [] : findWholeLineBonuses,
          toggleOnMatch: flipMode,
          // 炸弹玩法：这一拍旁边的炸弹跟着一起拆，拆掉的格子并进下一拍的遮罩。
          afterCommit: isBomb ? defuseAround : undefined,
          onLineBonus: applyLineBonus,
          clearStars: clearStarGroup,
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
        // 无限反转：翻完了还能翻回来，没有「全翻完」这回事——这一局只由计时结束。
        if (flipMode) return false;
        return grid.every((row) => row.every((t) => isBlank(t) || liveBomb(t)));
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c <= r; c++) {
            const t = grid[r][c];
            if (isBlank(t)) continue;
            if (liveBomb(t)) continue;
            live.push({ cell: [r, c], tile: t });
          }
        return live;
      }

      function findStuckGroups(): Cell[][] {
        // 无限反转：反面还会翻回来，「再也翻不动」这件事不成立。
        if (flipMode) return [];
        // 随机得分目标：门槛是这一局转出来的两个图案里枚数较小的那个。写死
        // 4 枚会把「还能拼出那个两枚图案」的残局判成死局，而死局是没有按钮
        // 能拦的——1.4 秒后直接结算（见 gameController）。
        // 传进去的是这副棋盘最短的整线枚数（3 枚，见 findWholeLineBonuses）。星星自己
        // 得分有两条路——连成整线、或者整组星星凑出图案（2026-09 上线）——stalemate 取
        // 两者中小的那个当门槛，见那儿的 starNeed。
        return findStuckColorGroups(liveTiles(), minMatchSize, MIN_LINE_BONUS_LEN);
      }

      function countRemainingTiles() {
        // 无限反转：正反面来回翻，「留着没翻」不是这一局的过失，不扣。
        if (flipMode) return { neverFlipped: 0, flippedButRemaining: 0 };
        return countRemainingTilesFn(liveTiles());
      }

      /**
       * 步步为营的结算要数的两个数（见 engine/puzzleScore.ts）。
       *
       * **小球这一副的「被消除」留在原位**：整线奖励不把球拿走，而是把它的颜色
       * 抹成 BLANK（见 applyLineBonus 上面那段），变成一枚仍然能滑、但再也配不
       * 上任何颜色的空白球。枚数一枚不少——所以「开局枚数 − 现在还剩几枚」在这
       * 副盘上恒等于 0，被消除的枚数只能靠数空白球。
       *
       * stars 直接叫 countRemainingTilesFn（它已经把空白球排除在外了），不走上
       * 面那个 countRemainingTiles——那一个在无限反转里返回 0。
       */
      function puzzleTally() {
        let blanks = 0;
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c <= r; c++) if (isBlank(grid[r][c])) blanks++;
        return { cleared: blanks, stars: countRemainingTilesFn(liveTiles()).flippedButRemaining };
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
              hazard: isBomb && !isBlank(t) && liveBomb(t),
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
        practice: !!opts?.practice,
        // 老虎机那一局：排行榜上它自己一张榜（见 RunData.slot）。
        slot: !!targets,
        flip: flipMode,
        puzzle: puzzleMode,
        puzzleTally,
        bestKey: bestKey + suffixFor(modeKey),
        shapeName: shapeName(lang, 'circle', '圆球'),
        shapeId: 'circle',
        modeKey,
        timeLimitSec: opts?.timeLimitSec,
        coach: !!opts?.coach,
        coachArt: opts?.coachArt,
        coachShape: 'circle',
        coachPlan: opts?.coachPlan,
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
        // Regular matches (run-of-4 and the "22"/"121" clusters) stay on
        // the board, so they get the persistent outline highlight, added
        // per cascade step so a chain reaction reveals one beat at a time.
        // A whole-line bonus instead blanks its cells (see applyLineBonus)
        // — its own fade transition is that event's feedback, not outlined
        // — played in onCascadeStepRendered since the ghost must be
        // appended *after* this step's own render() or that render() would
        // wipe it.
        onCascadeStep: ({ matchGroups }) => outlineTracker.add(matchGroups, MULTI_GROUP_STAGGER_MS),
        // 按快照有没有东西判断，不按「这一拍有没有整行奖励」——整组星星得分也会
        // 往快照里塞东西，而它走的是 matchGroups 那条路。两个列表都传进去，
        // playBlankTransition 自己会跳过快照里没有的格子。
        onCascadeStepRendered: ({ lineBonusGroups, matchGroups }) => {
          if (pendingBlankSnapshot.size) {
            playBlankTransition([...lineBonusGroups, ...matchGroups], pendingBlankSnapshot);
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
        if (!d || !d.fam || !d.chain) return;
        const n = d.cells.length;
        const size = d.R * 1.86;
        const [dirX, dirY] = famVector(d.fam, d.R, d.rowH);
        const stepLen = Math.hypot(dirX, dirY);
        const ux = dirX / stepLen;
        const uy = dirY / stepLen;
        const chain = d.chain;

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
        // Each ball rides its own lagged travel from the chain, not one rigid
        // shift for the whole line — the wave, the contact squash and the
        // entrained neighbours all come from engine/dragChain.ts, the same
        // integrator the splash runs.
        for (let i = 0; i < n; i++) {
          const off = chain.at(i);
          const [r, c] = d.cells[i];
          const [cx, cy] = ballCenter(r, c);
          const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
          if (el) {
            el.style.left = cx - size / 2 + off * dirX + 'px';
            el.style.top = cy - size / 2 + off * dirY + 'px';
            const pos = i + off;
            el.style.opacity = String(edgeOpacity(pos));
            el.style.scale = pressScale(chain.press(i), ux, uy, BOARD_FORCE);
          }
        }
        // 补位的影子跟着手指走，不再钉在线段左右那一轮上。
        //
        // 原先这里是 for (k = -1; k <= 1)：只在本尊左右各一个线段长的地方铺影
        // 子。手机上版图差不多占满屏幕，拖不了那么远，一直没露馅；电脑上版图
        // 只占窗口的一小块，鼠标一路拖出去很容易就超过两个线段长——过了那条
        // 线，本尊已经淡到全透明（edgeOpacity），仅有的那一轮影子也还在更远
        // 处，版图里这一条线就空了，接着又凭空冒出来。玩家看到的就是「拖出版
        // 图之后一顿一跳」。
        //
        // 现在按每一颗此刻的位置反推它该落在第几轮（k0），只铺它自己那一轮和
        // 左右各一轮：拖多远都一样，每帧造的影子还比从前少。造好的先攒在一张
        // 离屏的纸上，最后一次性挂进版图——和 render() 用 DocumentFragment 是
        // 同一个道理，那儿的注释写着为什么。
        const ghosts = document.createDocumentFragment();
        for (let i = 0; i < n; i++) {
          const off = chain.at(i);
          const k0 = Math.round(-off / n);
          for (let k = k0 - 1; k <= k0 + 1; k++) {
            if (k === 0) continue;
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
            ghosts.appendChild(ghost);
          }
        }
        refs.boardEl.appendChild(ghosts);
        // The lines either side get carried a little along the slide axis in
        // proportion to the moving line's velocity, then sprung home.
        const inLine = new Set(d.cells.map(([r, c]) => cellKey(r, c)));
        const lineCoord = (r: number, c: number) =>
          d.fam === 'A' ? r - c : d.fam === 'B' ? c : r;
        const own = lineCoord(d.r, d.c);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c <= r; c++) {
            if (inLine.has(cellKey(r, c))) continue;
            const dist = Math.abs(lineCoord(r, c) - own);
            const nudge = chain.side(dist);
            if (!nudge) continue;
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) el.style.translate = `${nudge * dirX}px ${nudge * dirY}px`;
          }
        }
      }

      // Returns whether it actually resolved a move (and thus already
      // re-rendered at least once) — the caller needs this so it doesn't
      // blindly render() again right after, which would wipe out a cascade
      // step's ghost/flip/highlight elements before they ever get a frame
      // painted (resolveMove no longer settles synchronously — see
      // gameController's stepper-driven reveal).
      // 四连爆炸在**这一步的连锁全部走完之后**查一次，由 gameController 的
      // checkHazard 钩子调（见那里的注释）。从前是拖拽一落地就立刻查：那时红块
      // 永不消也永不翻，滑动是它们唯一会挨到一起的原因，落地查就够了。现在炸弹
      // 挨着得分图案会被拆成星星，连锁每一拍都在改「谁还算活炸弹」——落地那一刻
      // 查，会把下一拍马上要被拆掉的那几枚算进四连，白白炸掉一局；两个时机都查
      // 又会让同一堆红块报两遍。所以只在盘面安定下来之后查这一次。
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
        const mask = new Set<string>(d.cells.map(([r, c]) => cellKey(r, c)));
        seatLine(refs.boardEl, mask);
        const [vx, vy] = famVector(d.fam, d.R, d.rowH);
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
          drag = { r, c, fam: null, cells: [], dx: 0, dy: 0, R, rowH, lastShift: 0, chain: null };
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
            const projA = scalarProjection('A', dx, dy, drag.R, drag.rowH);
            const projB = scalarProjection('B', dx, dy, drag.R, drag.rowH);
            const projR = scalarProjection('R', dx, dy, drag.R, drag.rowH);
            let fam: Fam = 'A';
            let best = Math.abs(projA);
            if (Math.abs(projB) > best) { fam = 'B'; best = Math.abs(projB); }
            if (Math.abs(projR) > best) { fam = 'R'; best = Math.abs(projR); }
            drag.fam = fam;
            drag.cells = fam === 'A' ? lineA(drag.r - drag.c) : fam === 'B' ? lineB(drag.c) : lineRow(drag.r);
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
          const raw = projectedSteps(d.fam, dx, dy, d.R, d.rowH);
          // A light tick each time the drag crosses into a new whole-step
          // shift — the discrete, physical "click" of passing a detent.
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
          // Instead of a hard cut to the resolved board, the chain carries
          // the line the rest of the way into its slot — the tail keeps
          // swinging for a beat, exactly like the splash — and only then
          // does the move resolve.
          d.chain.settle(Math.round(projectedSteps(d.fam, dx, dy, d.R, d.rowH)), () => {
            d.chain?.stop();
            const moved = applyDrag();
            drag = null;
            // A resolved move already re-rendered on its own (and may still
            // be mid-reveal). Only a no-op drag needs this render to snap
            // the preview's manual style tweaks back to a clean rest state.
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
      // Pro 那一圈虚线是真画进 DOM 的（见 proCircleRing），所以拨开关要重画一遍棋盘。
      const stopPro = onProChange(() => {
        if (controller.started) render();
      });

      renderLegend();

      return destroy;
    },
  };
}
