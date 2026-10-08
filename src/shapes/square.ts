import { buildShell } from '../ui/gameShell';
import { applyDevDeal, devDealFor } from '../engine/devDeal';
import { createGameController } from '../engine/gameController';
import { slideLine } from '../engine/slideLine';
import { groupPoints } from '../engine/groupScore';
import { attachDrag, magnetizeRawDist } from '../engine/drag';
import { createDragChain, pressScale, BOARD_FORCE, type DragChain } from '../engine/dragChain';
import { vibrate } from '../engine/haptics';
import { floorBox, observeBoardSize, fitFloor } from '../engine/boardResize';
import { colorblindOn, onColorblindChange, themedPalette } from '../engine/palettePref';
import { playMove, seatLine } from '../engine/juice';
import type { CascadeConfig } from '../engine/scoring';
import { createOutlineTracker, applyScoreAnimations, MULTI_GROUP_STAGGER_MS } from '../engine/scoreOutline';
import { TILE_RADIUS, proHintWidth, proSquareRing } from '../engine/proHint';
import { onProChange, proOn } from '../engine/proMode';
import { findStuckColorGroups, countRemainingTiles as countRemainingTilesFn, stuckKeysOf, type LiveTile } from '../engine/stalemate';
import { stuckGroupsOf } from '../engine/stalemate';
import { RESIDUE_MAX_TILES, gridLines, gridResidue, oneStepMoves } from '../engine/residueBoard';
import { createCoachGlow, matchKind, starClearHintFor, type StarClearHint } from '../engine/coachHint';
import { packSnapshot, type BoardSnapshot, type SnapshotCell } from '../engine/shareCard';
import { renderPatternHintIcons, type PatternDef } from '../engine/patternIcon';
import { scoreForSize, sizeAtLevel } from '../engine/targets';
import { erodedShapes, findTargets, type BoardView } from '../engine/targetMatch';
import { runLabel as runLabelOf, squareGrowth } from '../engine/matchGrowth';
import type { Cell, Match, Tile } from '../engine/types';
import { cellKey, effColor } from '../engine/types';
import { asteriskSvg } from '../ui/dotFaceMark';
import { shuffle } from '../engine/rng';
import { crackLayer } from '../ui/bombCrack';
import { BOMB_RED_HEX, blowUpIfClustered, dealBombBacks, defuseAround, isCrackedBomb, isLiveBomb, generateCleanBombBoard, redClusterKeys, GRID_ADJACENCY, type BombAdjacency } from '../engine/bomb';
import { STRINGS as SHELL } from '../i18n';
import { shapeName } from '../ui/shapeLabels';
import type { ShapeGame, ShapeGameOpts } from './types';
import { modeKeyOf, suffixFor } from '../engine/runKey';

// Two selectable palettes, both with 6 hues spaced at least ~50-60° apart on
// the hue wheel so no two colors (or a tile's front vs. its own dot) can be
// mistaken for each other at a glance.
//
// "standard": muted / higher-grayscale for a calmer, less neon candy look —
// optimized for normal color vision only.
//
// "colorblind": the Okabe–Ito qualitative palette, a published, widely-used
// reference set (e.g. Nature/Science figure guidelines) empirically checked
// to stay distinguishable under protanopia, deuteranopia and tritanopia. Left
// at its original saturation on purpose — desaturating it would shrink the
// margin that makes it CVD-safe.
const PALETTES = {
  standard: ['#C46A4E', '#9C8A3D', '#4A9573', '#4C7EAD', '#8067A8', '#AD5C82'],
  colorblind: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#CC79A7'],
} as const;

// Bomb mode reuses the exact same 6-color deck as the base game — same
// color count, same 6-tiles-per-color — it doesn't drop colors or reserve
// extra board slots for red. It just reinterprets slot 0 (each palette's
// own reddish hue) as the hazard color. 这 6 枚炸弹的反面在发牌时就印好了
// （dealBombBacks）：每一枚都印一种基础色（第 3 版之后没有永久炸弹了，见 engine/bomb.ts 的 BOMB_RULES_VERSION）；正常棋子
// 的反面里永远不会出现红，不然拆出来的星星会和真炸弹混淆。
const BOMB_PALETTES = {
  standard: PALETTES.standard.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
  colorblind: PALETTES.colorblind.map((c, i) => (i === 0 ? BOMB_RED_HEX : c)),
} as const;
const RED_IDX = 0;

const BOARD_DIM = 6;
/**
 * 空位：星星单独成图案得分之后，那几格从棋盘上拿掉留下的洞。
 *
 * 用 color 里的一个哨兵值表示，和菱形方块（squareDiamond.ts）同一套办法——那副
 * 盘早就有这个概念，这里是照它抄的。空位不是一种新的「面」，而是一枚 color 和
 * dotColor 都等于 BLANK 的棋子：于是它跟着整行照常滑动（和别的棋子一样），只是
 * effColor 永远对不上任何真颜色，所以再也凑不进任何图案。
 *
 * 玩家 2026-09 拍板：基础方块也走「留空洞」，和另外七副一致。
 */
const BLANK = -1;

const GLYPH = `<svg viewBox="0 0 32 32"><rect x="2" y="2" width="12" height="12" rx="3" fill="#C46A4E"/><rect x="18" y="2" width="12" height="12" rx="3" fill="#4A9573"/><rect x="2" y="18" width="12" height="12" rx="3" fill="#4C7EAD"/><rect x="18" y="18" width="12" height="12" rx="3" fill="#AD5C82"/></svg>`;

// The board's two seed patterns (see findMatches below) — a 2x2 block and a
// straight run of 4 — drawn as blank outlines for the in-HUD pattern hint.
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
    cells: [
      { kind: 'rect', cx: 0, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 1, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 2, cy: 0, half: 0.42 },
      { kind: 'rect', cx: 3, cy: 0, half: 0.42 },
    ],
  },
];

interface DragState {
  r: number;
  c: number;
  axis: 'row' | 'col' | null;
  dx: number;
  dy: number;
  cell: number;
  lastShift: number;
  /** The splash's inter-piece physics, driving every frame of the preview. */
  chain: DragChain | null;
}

export function createSquareGame(): ShapeGame {
  const bestKey = 'sugarcube_best';

  return {
    card: {
      id: 'square',
      name: '方块',
      desc: '拖动整行/整列 · 6×6 棋盘',
      bestKey,
      glyph: GLYPH,
      family: 'square',
      ruleShape: 'square',
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
      // 随机得分目标：这一局认哪个图案。没给就是这个玩法自己那一套 1×N。
      const target = opts?.target ?? null;
      /**
       * 此刻这一局要凑几枚（《侵蚀阶梯》v1.2 PR-8）。
       *
       * **现问，不缓存。** 老虎机那一局的目标跟着侵蚀阶梯一级一级变小（每降一级
       * 少一枚，下限 1），而一步之内可以连降两级；开局算一次存下来的话，死局判定
       * 和判分会各按一个过时的门槛走——门槛偏大那一头最凶：图案已经降到 2 枚、盘
       * 上明明还凑得出，却被当成死局，而死局没有任何按钮拦得住（1.4 秒后直接结算）。
       */
      const targetNeed = () => (target ? sizeAtLevel(target, controller.matchLen()) : 0);
      const refs = buildShell(container, {
        lang,
        practice: !!opts?.practice,
        shapeId: 'square',
        timed: !!opts?.timeLimitSec,
        flip: flipMode,
        steps: puzzleMode,
        bomb: isBomb,
        title: `Slides · ${shapeName(lang, 'square', '方块')}`,
        tagline: isBomb ? SHELL[lang].taglineRowCol + ' · ' + SHELL[lang].taglineBomb : SHELL[lang].taglineRowCol,
        startBody: SHELL[lang].shellStartBody,
        patternIcons: renderPatternHintIcons(PATTERNS, lang),
        // 随机得分目标：开局页换成那台老虎机，当场把它转出来。
        slotTarget: target ?? undefined,
        // 棋盘底下那块教学条（见 ui/coachBar.ts）。方块这边只有两种局给：头
        // 一回玩方块（先不出声，见 coachPlan），和炸弹 / 无限反转 / 老虎机头
        // 一回进来时的那一句提示（coachTip）。
        coach: !!opts?.coach,
        // 不数 4-3-2-1（每日挑战那一页自己数过了，第 19 推；见 ShellMeta.noCountdown）。
        noCountdown: !!opts?.noCountdown,
      });

      const pickPalette = (): readonly string[] =>
        themedPalette(
          (isBomb ? BOMB_PALETTES : PALETTES)[colorblindOn() ? 'colorblind' : 'standard'],
          isBomb ? RED_IDX : -1,
        );
      let COLORS: readonly string[] = pickPalette();

      let rows = BOARD_DIM;
      let cols = BOARD_DIM;
      let grid: Tile[][] = [];
      let CELL = 0;
      let nextTileId = 0;
      const outlineTracker = createOutlineTracker();
      // Stashed by findLineBonusGroups() for applyLineBonus() to consume in
      // the same cascade pass — see the comment on applyLineBonus below.
      let pendingRowClears: number[] = [];
      let pendingColClears: number[] = [];
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
        // exactly 6 tiles of each of the 6 colors = 36, matching the physical set
        const deck: number[] = [];
        for (let c = 0; c < COLORS.length; c++) for (let i = 0; i < BOARD_DIM; i++) deck.push(c);
        return shuffle(deck);
      }

      // Pre-assigns each tile's future dot color at generation time (like a
      // real printed card). Per front-color group of 6 tiles: 5 of them get
      // the other 5 colors, one each (a clean permutation — no two tiles in
      // the group share a dot color), and exactly 1 keeps its own color as
      // the dot (a same-color "self" tile) — the same "some self-pairs per
      // front-color group" pattern circle (1 self per 7) and triangle (4
      // self per 9) use, just with square's own count (1 self per 6).
      function assignDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length);
        for (let color = 0; color < COLORS.length; color++) {
          const assignments = shuffle([
            ...Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== color),
            color,
          ]);
          const indices: number[] = [];
          deck.forEach((c, idx) => {
            if (c === color) indices.push(idx);
          });
          indices.forEach((idx, i) => {
            dotColors[idx] = assignments[i];
          });
        }
        return dotColors;
      }

      function boardFromDeck(deck: number[]): Tile[][] {
        const dots = assignDotColors(deck);
        const g: Tile[][] = [];
        for (let r = 0; r < BOARD_DIM; r++) {
          const row: Tile[] = [];
          for (let c = 0; c < BOARD_DIM; c++) {
            const idx = r * BOARD_DIM + c;
            row.push(newTile(deck[idx], dots[idx]));
          }
          g.push(row);
        }
        return g;
      }

      /**
       * 开局盘面上别自带一坨同色——发牌时重摇，最多 500 次。
       *
       * 这里比「已经能得分了」严：它连三连、2×2、斜着三颗都拦掉，而《侵蚀阶梯》
       * v1.2 §1.1 之后能得分的只有同色 1×N（开局那一级是 4 枚），方块这副还根本
       * 不按斜线算分。留着这几条是为了一眼的观感，不是为了防白送分。
       */
      function hasInitialClump(g: Tile[][]): boolean {
        const R = g.length,
          C = g[0].length;
        const col = (r: number, c: number) => g[r][c].color;
        for (let r = 0; r < R; r++)
          for (let c = 0; c < C; c++) {
            if (c <= C - 3 && col(r, c) === col(r, c + 1) && col(r, c) === col(r, c + 2)) return true;
            if (r <= R - 3 && col(r, c) === col(r + 1, c) && col(r, c) === col(r + 2, c)) return true;
            if (
              r <= R - 2 &&
              c <= C - 2 &&
              col(r, c) === col(r, c + 1) &&
              col(r, c) === col(r + 1, c) &&
              col(r, c) === col(r + 1, c + 1)
            )
              return true;
            if (r <= R - 3 && c <= C - 3 && col(r, c) === col(r + 1, c + 1) && col(r, c) === col(r + 2, c + 2))
              return true;
            if (r <= R - 3 && c >= 2 && col(r, c) === col(r + 1, c - 1) && col(r, c) === col(r + 2, c - 2))
              return true;
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
      // Same deck as the base game (6 colors x 6 tiles = 36) — shuffledDeck()
      // already reads from COLORS, which is BOMB_PALETTES here, so it needs
      // no bomb-specific variant.

      // Per non-red front-color group of 6: the other 4 non-red colors get 1
      // dot-color slot each, and the tile's own front color gets 2 (1 "own
      // share" + 1 extra) to fill out the 6th slot — red is excluded from
      // every *normal* tile's dot-color pool, because a normal tile flipping
      // to a "red" back would be confusable with an actual hazard tile. The
      // red tiles' own backs are dealt separately just below (dealBombBacks).
      function assignBombDotColors(deck: number[]): number[] {
        const dotColors = new Array<number>(deck.length).fill(RED_IDX);
        for (let color = 0; color < COLORS.length; color++) {
          if (color === RED_IDX) continue;
          const others = Array.from({ length: COLORS.length }, (_, k) => k).filter((k) => k !== color && k !== RED_IDX);
          const pool = shuffle([...others, color, color]);
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
        for (let r = 0; r < BOARD_DIM; r++) {
          const row: Tile[] = [];
          for (let c = 0; c < BOARD_DIM; c++) {
            const idx = r * BOARD_DIM + c;
            row.push(newTile(deck[idx], dots[idx]));
          }
          g.push(row);
        }
        return g;
      }

      // General 4-directional connected-component check for red tiles —
      // used both to reject an initial deal that already starts lost and to
      // watch for the same condition forming live as the player drags.
      /**
       * 炸弹的「挨着」：上下左右四格。判四连、闪三连预警、以及得分时连带拆
       * 弹，用的是同一份邻接——三处口径必须一致，不然会出现「预警闪了却不
       * 炸」「拆得掉的却没拆」。
       */
      function bombNeighbors(r: number, c: number): Cell[] {
        const out: Cell[] = [];
        for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as Cell[]) {
          if (nr < 0 || nr >= grid.length || nc < 0 || nc >= grid[nr].length) continue;
          out.push([nr, nc]);
        }
        return out;
      }

      // 炸弹那三样（四连判爆、三连预警、发一副干净的开局）在 engine/bomb.ts（第 14 推从
      // 五副棋盘里抽出来，规矩只写一遍）；这儿只交代这一副盘「有哪些格、谁挨着谁」。
      // A 4-cluster ends the run outright; a 3-cluster is one drag away
      // from it, so render() pulses those tiles as an early warning.
      const BOMB_ADJ: BombAdjacency = GRID_ADJACENCY;

      function renderLegend() {
        refs.legendEl.innerHTML = COLORS.map((hex) => `<span class="swatch" style="background:${hex}"></span>`).join('');
      }

      function computeCell(): number {
        const rect = floorBox(refs.boardWrap);
        const avail = Math.min(rect.width, rect.height);
        return Math.floor(Math.min(avail / cols, avail / rows));
      }

      function layoutBoard() {
        CELL = computeCell();
        refs.boardEl.style.width = CELL * cols + 'px';
        refs.boardEl.style.height = CELL * rows + 'px';
        fitFloor(refs.boardWrap, CELL * cols, CELL * rows);
      }

      function makeTileEl(tile: Tile, r: number, c: number, cell: number, opacity?: number): HTMLElement {
        const el = document.createElement('div');
        el.className = 'tile';
        const size = cell - 4;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = c * cell + 2 + 'px';
        el.style.top = r * cell + 2 + 'px';
        if (isBlank(tile)) {
          // 空位：底板透出来，什么都不画。照菱形方块那套。
          el.style.background = 'transparent';
        } else if (tile.face === 'dot') {
          // 反面：底板透出来，颜色只留在那三笔上。和小球那颗一模一样（玩家
          // 2026-09 定的统一，见 ui/dotFaceMark.ts）——从前这儿是一颗实心小
          // 圆，一枚翻过面的方块和一枚正面的圆球看着差不多，两副棋盘摆在一
          // 起要认两套记号。dotColor 写成属性，是因为消行动画要照着这一枚原
          // 来的颜色画一个替身（captureTileSnapshots），它从前是去问那颗小圆
          // 的底色的，现在没有底色可问了。
          el.style.background = 'transparent';
          el.dataset.dotColor = COLORS[tile.dotColor];
          el.innerHTML = asteriskSvg(size * 0.95, COLORS[tile.dotColor]);
        } else {
          el.style.background = COLORS[tile.color];
        }
        // 挨过一下、还没拆的那几枚：身上画一道裂纹（ui/bombCrack.ts）。没有它，
        // 「两下才拆」这条规则在屏幕上根本不存在，玩家只会觉得「贴着打了一次
        // 怎么没掉」。画在「！」前面，所以那个记号压在裂纹上，不会被盖住。
        if (isCrackedBomb(tile)) el.appendChild(crackLayer(size * 0.88));
        // 「！」画在正面（还没拆的炸弹）。反面那一支留着：第 3 版取消了永久炸弹，所以
        // 现在发不出红反面；这件事来回过两轮，画法不跟着删（见 engine/bomb.ts）。它的
        // 反面还是红（dealBombBacks 留的），照旧按炸弹规则算，而红星星和别的
        // 星星形状一模一样，不加这个记号就混在里面认不出来了。
        if (liveBomb(tile)) {
          const mark = document.createElement('div');
          mark.className = 'hazard-mark';
          mark.textContent = '!';
          mark.style.fontSize = Math.round(size * 0.55) + 'px';
          el.appendChild(mark);
        }
        if (opacity !== undefined) el.style.opacity = String(opacity);
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.dataset.id = String(tile.id);
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
        // Pro 模式那一圈：这一枚**得分之后会变成什么颜色**（engine/proHint.ts）。只有
        // 正面那一枚有这件事可说——翻过面的已经是那颗星星了，空位更没有。
        // 方块那一版是虚线，虚线的节奏得自己定（见 proSquareRing 的说明），所以是真画
        // 进去的一层，只在开着 Pro 的时候建；拨开关那一下由 onProChange 重画。
        if (proOn() && !isBlank(tile) && tile.face === 'flavor') {
          el.appendChild(proSquareRing(size, TILE_RADIUS, COLORS[tile.dotColor], proHintWidth(size)));
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
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const key = cellKey(r, c);
            const el = makeTileEl(grid[r][c], r, c, CELL);
            applyScoreAnimations(el, flipInCells.has(key), pulseMs.get(key), true);
            if (stuckKeys?.has(key)) el.classList.add('stuck-glow');
            if (glow.lit(grid[r][c].id)) el.classList.add('coach-glow');
            if (warnKeys?.has(key)) el.classList.add('hazard-warn');
            frag.appendChild(el);
          }
        }
        refs.boardEl.innerHTML = '';
        refs.boardEl.appendChild(frag);
        flipInCells = new Set();
      }

      // ---------- matching engine ----------
      // A match only ever grows along its *own* seed shape's regular
      // directions — never a generic same-color flood fill. A straight
      // run-of-4 only extends further along that same row/column (so a
      // same-color tile hanging off the side never folds in); a 2x2 block
      // only extends by a full extra row or column at a time (so "3 wide,
      // 2 deep, plus one stray tile" stops at the 3x2 rectangle, not the
      // stray tile too). Two overlapping seed windows inside one longer run
      // (or one bigger rectangle) converge on the exact same final region;
      // scoring.ts's dedupe() collapses those identical regions into a single
      // payout (an earlier version of this comment claimed that already
      // happened when in fact nothing did it, and a five-run scored double).
      function isBlank(t: Tile): boolean {
        return t.color === BLANK;
      }
      function anyBlank(cells: Cell[]): boolean {
        return cells.some(([r, c]) => isBlank(grid[r][c]));
      }
      function cellsSameColor(cells: Cell[]): boolean {
        // 空位不进任何图案。不写这一句也几乎不会错（空位的 effColor 是 BLANK，
        // 对不上任何真颜色），但一整组都是空位的时候「大家颜色一样」会成立。
        if (anyBlank(cells)) return false;
        const c0 = effColor(grid[cells[0][0]][cells[0][1]]);
        // Red hazard tiles are obstacles, not a matchable color — never a
        // valid seed even though they'd otherwise pass the same-color check.
        if (isBomb && c0 === RED_IDX) return false;
        return cells.every(([r, c]) => effColor(grid[r][c]) === c0);
      }
      function touches(cells: Cell[], mask: Set<string> | null): boolean {
        if (!mask) return true;
        return cells.some(([r, c]) => mask.has(cellKey(r, c)));
      }
      function effColorAt(r: number, c: number): number {
        return effColor(grid[r][c]);
      }

      // 三条长大的规矩在 engine/matchGrowth.ts（squareGrowth），和别的七副的放
      // 在一处；体检脚本量的就是那一份真件。
      // rows/cols 传的是函数：消掉整行整列时棋盘会当场变小。
      const { extendRunHoriz, extendRunVert } = squareGrowth({
        rows: () => rows,
        cols: () => cols,
        effColorAt,
      });

      /**
       * 随机得分目标那一局，判定要问棋盘的那几件事。
       *
       * 棋盘、滑法、整行奖励一概不动——变的只有「拼成什么算分」，所以这里
       * 只是把 grid 包一层给 targetMatch 用，别的地方一个字都不用改。
       */
      const targetView: BoardView = {
        has: (r, c) => r >= 0 && r < rows && c >= 0 && c < cols,
        tileAt: (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols ? grid[r][c] : null),
        cells: () => {
          const out: Cell[] = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([r, c]);
          return out;
        },
      };

      /**
       * 老虎机那一局的判分：目标此刻是 k 枚，**它的任意仍相连 k 子形**都算
       * （《侵蚀阶梯》v1.2 PR-8）。
       *
       * 分按拼成的那几枚算（⌈k²/2⌉），不按目标原来有几枚——不然图案侵蚀到 1 枚之
       * 后，随便一枚同色都能拿到五枚图案那一档的分。
       */
      function findTargetMatches(mask: Set<string> | null): Match[] {
        const out: Match[] = [];
        const need = targetNeed();
        const points = scoreForSize(need);
        for (const p of erodedShapes(target!, need)) {
          for (const cells of findTargets(targetView, p)) {
            if (!touches(cells, mask)) continue;
            out.push({ cells, points, label: target!.id });
          }
        }
        return out;
      }

      /** 这一局的「几连」怎么念（枚数是变的，见 engine/matchGrowth 的 runLabel）。 */
      const runLabel = (n: number) => runLabelOf(lang, n);

      /**
       * 得分图案**只剩同色 1×N 连线**（《侵蚀阶梯》v1.2 §1.1）：2×2 那一种连同小球的
       * 2+2、1-2-1、三角的大三角一起删了。
       *
       * N 不是写死的 4，是**现问**控制器（`matchLen()`）——侵蚀阶梯会在一步之内把它
       * 从 4 降到 3、2、1（§2），缓存一份就会慢一拍。
       */
      function findMatches(mask: Set<string> | null): Match[] {
        if (target) return findTargetMatches(mask);
        const matches: Match[] = [];
        const n = controller.matchLen();
        const label = runLabel(n);
        for (let r = 0; r < rows; r++)
          for (let c = 0; c + n <= cols; c++) {
            const seed: Cell[] = [];
            for (let k = 0; k < n; k++) seed.push([r, c + k]);
            if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
            const region = extendRunHoriz(r, c, c + n - 1);
            matches.push({ cells: region, points: groupPoints(region, (r, c) => grid[r][c]), label });
          }
        for (let c = 0; c < cols; c++)
          for (let r = 0; r + n <= rows; r++) {
            const seed: Cell[] = [];
            for (let k = 0; k < n; k++) seed.push([r + k, c]);
            if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
            const region = extendRunVert(c, r, r + n - 1);
            matches.push({ cells: region, points: groupPoints(region, (r, c) => grid[r][c]), label });
          }
        return matches;
      }

      // A line only qualifies once every tile in it has flipped to its dot
      // face *and* those dot colors all match — a mix of flavor-face and
      // dot-face tiles no longer counts, even if their effective colors
      // happen to agree.
      function isFullDotMatch(tiles: Tile[]): boolean {
        if (tiles.some((t) => t.face !== 'dot')) return false;
        const c0 = tiles[0].dotColor;
        return tiles.every((t) => t.dotColor === c0);
      }

      /**
       * 此刻整行 / 整列全是同色星星的那几行、几列。
       *
       * 整线消除认的就是它；教学的呼吸灯（第 15 推）也要问它「走一步之后有没有」，所以单拎
       * 出来——两处问的是同一把尺子，不是各写一份。
       */
      function fullDotLines(): { rowClears: number[]; colClears: number[]; groups: Cell[][] } {
        const rowClears: number[] = [];
        for (let r = 0; r < rows; r++) {
          if (isFullDotMatch(grid[r])) rowClears.push(r);
        }
        const colClears: number[] = [];
        for (let c = 0; c < cols; c++) {
          const column = grid.map((row) => row[c]);
          if (isFullDotMatch(column)) colClears.push(c);
        }
        const groups: Cell[][] = [];
        for (const r of rowClears) groups.push(Array.from({ length: cols }, (_, c) => [r, c] as Cell));
        for (const c of colClears) groups.push(Array.from({ length: rows }, (_, r) => [r, c] as Cell));
        return { rowClears, colClears, groups };
      }
      function findLineBonusGroups(): Cell[][] {
        const { rowClears, colClears, groups } = fullDotLines();
        pendingRowClears = rowClears;
        pendingColClears = colClears;
        return groups;
      }

      function removeLines(rowClears: number[], colClears: number[]) {
        if (rowClears.length) {
          const keep = new Set(Array.from({ length: rows }, (_, i) => i));
          rowClears.forEach((r) => keep.delete(r));
          grid = Array.from(keep)
            .sort((a, b) => a - b)
            .map((r) => grid[r]);
          rows = grid.length;
        }
        if (colClears.length && rows > 0) {
          const keep = new Set(Array.from({ length: cols }, (_, i) => i));
          colClears.forEach((c) => keep.delete(c));
          grid = grid.map((row) =>
            Array.from(keep)
              .sort((a, b) => a - b)
              .map((c) => row[c]),
          );
          cols = grid[0] ? grid[0].length : 0;
        }
      }

      // findLineBonusGroups() and applyLineBonus() are always called back to
      // back within the same cascade pass (see resolveCascade), so stashing
      // the raw row/col indices here — rather than re-deriving them from the
      // Cell[][] groups — lets the flip-then-batch-remove happen against the
      // one consistent pre-removal grid, exactly like the original single-
      // shape prototype.
      function applyLineBonus(_groups: Cell[][]) {
        const rowClears = pendingRowClears;
        const colClears = pendingColClears;
        rowClears.forEach((r) => grid[r].forEach((t) => { if (t.face === 'flavor') t.face = 'dot'; }));
        colClears.forEach((c) => {
          for (let r = 0; r < rows; r++) {
            const t = grid[r][c];
            if (t.face === 'flavor') t.face = 'dot';
          }
        });
        removeLines(rowClears, colClears);
      }

      function buildCascadeConfig(): CascadeConfig {
        return {
          tileAt: (r, c) => grid[r][c],
          findMatches,
          // 无限反转：反面同色连成一行 / 列不消除，也就不再找整线奖励。
          findLineBonuses: flipMode ? () => [] : findLineBonusGroups,
          toggleOnMatch: flipMode,
          // 老虎机：开完成奖励（⌈枚数²/2⌉）。**只有真有目标的那一局才开**——基础玩法
          // 那条路也往 Match.points 里写东西，一直开着会双算。
          bonusOnMatch: Boolean(target),
          // 炸弹玩法：这一拍旁边的炸弹跟着挨一下（两下才拆），拆掉的格子并进下一拍的遮罩。规矩在
          // engine/bomb.ts 的 defuseAround（10-08 方案第五批第 3 条从五副棋盘里抽出来，只写一遍）；
          // 这儿只交代这一副盘谁挨着谁、某一格是哪一枚、哪一枚还是活炸弹。
          afterCommit: isBomb ? (scored) => defuseAround(scored, bombNeighbors, (r, c) => grid[r][c], liveBomb) : undefined,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: true,
          isTerminalAfterLineBonus: () => rows === 0 || cols === 0,
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
        // 认的是活炸弹（liveBomb）不是红色：拆成基础色星星的那几枚照常参与消
        // 除，不该算成「还没清掉的障碍」。
        const allGone =
          grid.length > 0 &&
          // 空位算「已经清掉了」——它本来就不需要再翻。
          grid.every((row) => row.every((t) => isBlank(t) || liveBomb(t)));
        return allGone || rows === 0 || cols === 0;
      }

      function liveTiles(): LiveTile[] {
        const live: LiveTile[] = [];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            // Red hazard tiles are permanent obstacles, not something the
            // player is expected to ever flip — excluded from stalemate
            // detection and the end-of-run "left on the board" penalty.
            if (liveBomb(grid[r][c])) continue;
            // 空位不算「留在盘上没翻的」——结算那笔扣分和卡死判定都不该算它。
            if (isBlank(grid[r][c])) continue;
            live.push({ cell: [r, c], tile: grid[r][c] });
          }
        return live;
      }

      function findStuckGroups(): Cell[][] {
        // 无限反转：反面还会翻回来，「再也翻不动」这件事不成立。
        if (flipMode) return [];
        // 随机得分目标：门槛是目标此刻还有几枚（targetNeed，跟着侵蚀走）。写死
        // 4 枚会把「还能拼出那个两枚图案」的残局判成死局，而死局是没有按钮
        // 能拦的——1.4 秒后直接结算（见 gameController）。
        // 传进去的是当前较短的那条边长：整行 / 整列会随消除变短，门槛得跟着走。星星
        // 自己得分有两条路——连成整线、或者整组星星凑出图案（2026-09 上线）——stalemate
        // 取两者中小的那个当门槛，见那儿的 starNeed。
        // 没有目标的那几档，门槛是**这一级的 1×N 要几枚**（controller.matchLen()），
        // 不是 `undefined`。传 undefined 会落到 stalemate 的默认值 4，而侵蚀把图案降到
        // 1×3 之后盘上剩 3 枚同色是**还能凑的**——按 4 判就成了死局，而死局没有任何按钮
        // 拦得住，1.4 秒后直接结算。八副棋盘里只有这一副是这么写的，其余五副都问
        // controller.matchLen()。
        const need = target ? targetNeed() : controller.matchLen();
        const live = liveTiles();
        const counted = findStuckColorGroups(live, need, Math.min(rows, cols));
        // 计数那一层已经说死了就不用再算——它只会偏松（说活），不会偏紧。
        if (counted.length) return counted;
        /*
         * 计数说活，**可它从不看几何**（engine/stalemate.ts 开头那段）：「数量够、摆法
         * 永远到不了」的残局会被一直判活，玩家报过——剩几枚怎么滑都不得分，局却不结束。
         *
         * 所以盘子小到一定程度之后，再花一点力气真的穷举一遍（§4 的「可用 ≤16 枚 BFS
         * 穷举」，见 engine/residueSearch.ts）。算不完一律当活，所以这一段只会**多**判
         * 出死局，不会把还能打的局掐掉。
         *
         * 方块这一副的线就是**此刻**的每一行每一列：整行整列消掉之后盘子真的变小
         * （removeLines 把它们从网格里摘掉、两侧收拢），所以 rows/cols 现问，不写死 6。
         */
        if (live.length > RESIDUE_MAX_TILES) return [];
        const residueAt = (r: number, c: number) => {
          const t = grid[r]?.[c];
          if (!t) return null;
          // 空位和活炸弹**跟着整行整列一起滑**，所以一格不少地算进去，只是编成
          // 「配不上任何颜色」。`liveTiles()` 那一份把它们排除在外，不能拿来当盘面。
          if (isBlank(t) || liveBomb(t)) return 'blank' as const;
          return { color: effColor(t), dot: t.face === 'dot' };
        };
        /*
         * 老虎机那一局**也走这一层**（E33，2026-10-02 放开）：得分算不算看的是转出来那
         * 个形状的当前级子形，不是同色 1×N，所以把形状和它此刻要几枚一起交下去。上一推
         * 这儿是 `if (target) return [];`（穷举层那时只会量 1×N，拿它量老虎机会把还拼得
         * 出形状的棋判死），代价是那一局根本没有几何兜底。
         *
         * `need` 和上面计数层那一处共用一个——两层的门槛必须是同一个数。
         */
        const verdict = gridResidue(rows, cols, residueAt, need, target ? { target, need } : undefined);
        return verdict === 'dead' ? stuckGroupsOf(live) : [];
      }

      function countRemainingTiles() {
        // 无限反转：正反面来回翻，「留着没翻」不是这一局的过失，不扣。
        if (flipMode) return { neverFlipped: 0, flippedButRemaining: 0 };
        return countRemainingTilesFn(liveTiles());
      }

      /**
       * 步步为营的结算要数的两个数（见 engine/puzzleScore.ts）。
       *
       * **方块这一副的「被消除」是真的把格子拿走、两侧收拢**：整行 / 整列奖励
       * 一落，rows 或 cols 就少一，棋盘整个缩小。所以少掉的那些格子就是被消除
       * 的枚数——开局 36 枚，现在 rows × cols 枚，差额就是答案。
       *
       * 小球和三角**不能**这么数：它们消完是把那一枚留在原位（变成空白球 /
       * 空洞），枚数一枚不少，这个减法在那两副盘上恒等于 0。三副盘各数各的。
       *
       * stars 直接叫 countRemainingTilesFn，不走上面那个 countRemainingTiles
       * ——那一个在无限反转里返回 0。两种玩法今天不会同时开，但这儿不靠那个
       * 前提：数错了星星，玩家的分就凭空少一截，而且看不出来。
       */
      function puzzleTally() {
        return {
          cleared: BOARD_DIM * BOARD_DIM - rows * cols,
          stars: countRemainingTilesFn(liveTiles()).flippedButRemaining,
        };
      }

      function highlightStuck(cells: Cell[] | null) {
        stuckKeys = stuckKeysOf(cells);
      }

      function snapshotBoard(): BoardSnapshot {
        const cells: SnapshotCell[] = [];
        const half = 0.5 / BOARD_DIM - 0.01;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const t = grid[r][c];
            cells.push({
              kind: 'rect',
              cx: (c + 0.5) / BOARD_DIM,
              cy: (r + 0.5) / BOARD_DIM,
              half,
              face: t.face,
              color: COLORS[effColor(t)],
              hazard: isBomb && liveBomb(t),
            });
          }
        // 交给 packSnapshot 摆正、放大（第 14 推，别的五副棋盘本来就是这样）。原先原样返回
        // ——格子位置按整块 6 × 6 的底板算，消掉几行几列之后剩下的那一块缩在图的左上角，
        // 右边和下面空着一大片：玩家分享出去的终局图像是没画完。
        return packSnapshot(cells);
      }

      function resetBoard() {
        rows = BOARD_DIM;
        cols = BOARD_DIM;
        grid = isBomb ? generateCleanBombBoard(() => boardFromBombDeck(shuffledDeck()), hasInitialClump, BOMB_ADJ, liveBomb) : generateCleanBoard();
        /*
         * 开发时手摆的那副牌（`engine/devDeal.ts`）。**正式包里这一句整段不存在**
         * （`import.meta.env.DEV` 是构建时常量，Vite 把它摇掉）。
         *
         * 摆在 `generateCleanBoard()` **之后**：发牌那一套该跑的照旧跑一遍（颜色配额、
         * 开局不许有现成的得分组、三角那一副的朝向配平……），手摆的只是盖在上面。少
         * 写的那几格原样留着发出来的牌，所以一副写一半的 devDeal 不会把棋盘弄坏。
         */
        const dealt = devDealFor('square');
        if (dealt) applyDevDeal(grid, dealt, BLANK);
        outlineTracker.reset();
        stuckKeys = null;
        glow.reset();
      }

      // ---------- 教学的呼吸灯（第 15 推，engine/coachHint.ts） ----------
      /**
       * 在一副**走过一步**的盘面上认组：把 grid 临时换成那一副，问这一局真正结算用的那几个
       * 判定，问完换回来。
       *
       * 为什么换 grid，而不是把 findMatches 改成收一个盘面参数：灯要回答的正是「这一步它
       * 会不会给分」，答案只能来自结算用的那一份——另写一份收参数的，两份迟早走样，灯就亮
       * 在一组凑不成的棋子上。整段同步跑完、不让出控制权，中间不会有一次 render 读到那副假
       * 盘面。
       */
      function withGrid<R>(g: Tile[][], run: () => R): R {
        const real = grid;
        grid = g;
        try {
          return run();
        } finally {
          grid = real;
        }
      }
      const glow = createCoachGlow<Tile>({
        grid: () => grid,
        // 方块的一步：任意一行或一列整条转几格。空位和活炸弹跟着整行整列一起滑，所以每一格
        // 都在线上（和残局穷举那头 residueAt 的口径一样）。
        moves: () => oneStepMoves(gridLines(rows, cols), (r, c) => !!grid[r]?.[c]),
        groupsFor: (kind) =>
          kind === 'edge'
            ? (trial) => withGrid(trial, () => fullDotLines().groups)
            : (trial, moved) =>
                withGrid(trial, () =>
                  findMatches(moved)
                    .map((m) => m.cells)
                    .filter((cells) => matchKind(cells.map(([r, c]) => grid[r][c].face)) === kind),
                ),
        // 第 4 条那一盏（10-08 方案 3-E-3）：亮挑中的那一色，见下面 coachStarClear。
        starClear: () => coachStarClear(),
        centerOf: ([r, c]) => [c * CELL + CELL / 2, r * CELL + CELL / 2],
        boardCenter: () => [(cols * CELL) / 2, (rows * CELL) / 2],
      });
      /** 手指落下的位置（板内坐标）——松开时加上拖过的那一段，报给 glow 当「上一次手指位置」。 */
      let fingerAt: [number, number] | null = null;
      /**
       * 结算之后**不重画**，就地给此刻画着的那几枚挂上 / 摘掉 `coach-glow`。重画会把还在空
       * 中翻的那几块牌拆掉（gameController 的 plankFlipCells），而灯是在连锁收尾那一刻点
       * 的，最后一拍的翻面可能还没落地。
       */
      function paintCoachGlow() {
        for (const el of refs.boardEl.querySelectorAll<HTMLElement>('.tile[data-r][data-c]')) {
          const t = grid[Number(el.dataset.r)]?.[Number(el.dataset.c)];
          el.classList.toggle('coach-glow', !!t && glow.lit(t.id));
        }
      }
      /**
       * 教学第 4 条（星星消除那一条）该不该讲、亮哪一色（10-08 方案 3-E-3，engine/coachHint 的
       * starClearHintFor）。
       *
       * 方块没有「最外边」这回事：星星凑满**任意**一整行、一整列都消（fullDotLines），所以交给它
       * 的「外边」是每一整行、每一整列。最短的那条就是较短的那条边——和第 15 推定的「方块用较短
       * 那条边」同一个数，所以「什么时候讲」没变。消掉整行整列之后盘子变小，所以现问 rows / cols。
       */
      function coachStarClear(): StarClearHint | null {
        const edges: Cell[][] = [];
        for (let r = 0; r < rows; r++) edges.push(Array.from({ length: cols }, (_, c) => [r, c] as Cell));
        for (let c = 0; c < cols; c++) edges.push(Array.from({ length: rows }, (_, r) => [r, c] as Cell));
        return starClearHintFor<Tile>({
          grid,
          edges,
          isStar: (t) => !isBlank(t) && t.face === 'dot' && !liveBomb(t),
          colorOf: (t) => t.dotColor,
        });
      }
      function coachStarsReachEdge(): boolean {
        return coachStarClear() !== null;
      }

      const controller = createGameController(refs, {
        // 侵蚀阶梯要的两个数（《侵蚀阶梯》v1.2 §2）：方块 36×6。
        // 一枚棋子一段，所以「可用格数」＝ 发牌时每色几枚 × 几色。
        /**
         * 盘上还剩几枚可用格——结算页那个步数系数要的「已清格数」按它算
         * （《侵蚀阶梯》v1.2 §5：已清 = boardTiles − 这个数）。
         *
         * 方块这一副的整线消除是把整行整列从网格里**摘掉**（removeLines），所以
         * 剩几枚就是此刻的 rows × cols。
         */
        tilesLeft: () => rows * cols,
        boardTiles: BOARD_DIM * BOARD_DIM,
        boardColors: PALETTES.standard.length,
        lang,
        practice: !!opts?.practice,
        // 老虎机那一局：排行榜上它自己一张榜（见 RunData.slot）。
        slot: !!target,
        slotTarget: target ?? undefined,
        flip: flipMode,
        puzzle: puzzleMode,
        puzzleTally,
        bestKey: bestKey + suffixFor(modeKey),
        shapeName: shapeName(lang, 'square', '方块'),
        shapeId: 'square',
        modeKey,
        timeLimitSec: opts?.timeLimitSec,
        coach: !!opts?.coach,
        // 这一局用哪一串种子发牌（第 19 推，见 ShapeGameOpts.seed）。
        seed: opts?.seed,
        coachArt: opts?.coachArt,
        coachShape: 'square',
        coachPlan: opts?.coachPlan,
        coachTip: opts?.coachTip,
        coachGlow: (kind) => {
          const done = glow.update(kind);
          paintCoachGlow();
          return done;
        },
        coachStarsReachEdge,
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
        // Line-bonus cells are removed from the board a moment later (see
        // applyLineBonus), so their coordinates aren't safe to outline —
        // the fade+collapse transition already gives that event its own
        // feedback. Only 2x2/straight-4 matches, which stay in place, get
        // the outline highlight. A bonus step's DOM still shows its
        // pre-removal state when this fires (render() for this step hasn't
        // run yet), so this is also where the "before" snapshot for that
        // transition gets captured.
        onCascadeStep: ({ matchGroups, lineBonusGroups }) => {
          outlineTracker.add(matchGroups, MULTI_GROUP_STAGGER_MS);
          if (lineBonusGroups.length) pendingCollapseSnapshot = captureTileSnapshots();
        },
        onCascadeStepRendered: ({ lineBonusGroups }) => {
          /*
           * 方块没有「星星消除那一拍的淡出」（pendingBlankSnapshot / playBlankTransition）：
           * 它的整线消除是收拢、不留空位，走下面这条 collapse；整组星星消除那条路随《侵蚀阶
           * 梯》v1.2 退役之后，这儿那一份快照再没人往里写，淡出一次都不会跑。10-08 方案第五批
           * 第 4 条先在 check-scoring 第 6 节证明「方块永不写入」、跑过自检机器人，再删掉。
           * 另外五副棋盘的整线消除是原地留空位，它们那一份还在用，没动。
           */
          if (lineBonusGroups.length && pendingCollapseSnapshot) {
            playCollapseTransition(pendingCollapseSnapshot);
            pendingCollapseSnapshot = null;
          }
        },
        onCommit: (matchGroups) => {
          for (const cells of matchGroups) for (const [r, c] of cells) flipInCells.add(cellKey(r, c));
        },
      });

      // ---------- drag interaction ----------
      let drag: DragState | null = null;

      // A ghost fully outside [low, high] (the same generous one-cell
      // margin the old hard cutoff used) is invisible; one that's just
      // crossed into range ramps up smoothly over a short distance instead
      // of popping in at full ghost-opacity — same idea in reverse as it
      // exits the other side.
      function edgeFade(x: number, low: number, high: number, range: number): number {
        const overshoot = x < low ? low - x : x > high ? x - high : 0;
        return Math.max(0, 1 - overshoot / range);
      }

      function renderDragPreview() {
        render();
        if (!drag || !drag.axis || !drag.chain) return;
        const cell = drag.cell;
        const chain = drag.chain;
        // Each tile rides its own lagged travel from the chain (the splash's
        // integrator, engine/dragChain.ts): a wave down the line, contact
        // squash, and the neighbouring lines carried a little and sprung home.
        if (drag.axis === 'row') {
          const r = drag.r;
          const span = cols * cell;
          const fadeRange = cell * 0.4;
          for (let c = 0; c < cols; c++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) {
              el.style.left = c * cell + chain.at(c) * cell + 'px';
              el.style.scale = pressScale(chain.press(c), 1, 0, BOARD_FORCE);
            }
          }
          // 补位的影子跟着手指走，不再钉在版图旁边那两轮上。
          //
          // 原先这里是 for (k = -2; k <= 2)：只在本尊左右各两个版图宽的地方
          // 铺影子。手机上版图差不多占满屏幕，两个版图宽根本拖不到，所以一直
          // 没露馅；电脑上版图只有窗口的三分之一，鼠标一路拖过去很容易就超过
          // 两轮——过了那条线，本尊早被裁在版图外，最远的影子也还在更远处，
          // 版图里这一行就空了，接着又凭空冒出来。玩家看到的就是「拖出版图之
          // 后一顿一跳」。
          //
          // 现在按每一颗此刻的位置反推它该落在第几轮（k0），只铺它自己那一轮
          // 和左右各一轮。可见的那一条带子宽度比一轮多一格，最多容得下两轮，
          // 三个候选一定够；拖多远都一样，而且每帧造的影子还比从前少一个。
          //
          // 造好的影子先攒在一张离屏的纸上，最后一次性挂到版图里——和 render()
          // 用 DocumentFragment 是同一个道理，那儿的注释写着为什么：一枚一枚
          // 往活页面里塞，每一次都可能让浏览器重算一遍这块。影子的枚数正好在
          // 「拖出版图」那一刻从零跳到一整行，所以这笔账也是那时候才结的。
          const ghosts = document.createDocumentFragment();
          for (let c = 0; c < cols; c++) {
            const travel = chain.at(c);
            const k0 = Math.round(-travel / cols);
            for (let k = k0 - 1; k <= k0 + 1; k++) {
              if (k === 0) continue;
              const x = c * cell + travel * cell + k * span;
              const fade = edgeFade(x, -cell, span, fadeRange);
              if (fade <= 0) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.55 * fade);
              ghost.classList.add('ghost');
              ghost.style.left = x + 'px';
              ghosts.appendChild(ghost);
            }
          }
          refs.boardEl.appendChild(ghosts);
          for (let r2 = 0; r2 < rows; r2++) {
            if (r2 === r) continue;
            const nudge = chain.side(Math.abs(r2 - r));
            if (!nudge) continue;
            for (let c = 0; c < cols; c++) {
              const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r2}"][data-c="${c}"]`);
              if (el) el.style.translate = `${nudge * cell}px 0`;
            }
          }
        } else {
          const c = drag.c;
          const span = rows * cell;
          const fadeRange = cell * 0.4;
          for (let r = 0; r < rows; r++) {
            const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
            if (el) {
              el.style.top = r * cell + chain.at(r) * cell + 'px';
              el.style.scale = pressScale(chain.press(r), 0, 1, BOARD_FORCE);
            }
          }
          // 竖着拖同一条：影子跟着手指走，一次性挂上去。见上面那段。
          const ghosts = document.createDocumentFragment();
          for (let r = 0; r < rows; r++) {
            const travel = chain.at(r);
            const k0 = Math.round(-travel / rows);
            for (let k = k0 - 1; k <= k0 + 1; k++) {
              if (k === 0) continue;
              const y = r * cell + travel * cell + k * span;
              const fade = edgeFade(y, -cell, span, fadeRange);
              if (fade <= 0) continue;
              const ghost = makeTileEl(grid[r][c], r, c, cell, 0.55 * fade);
              ghost.classList.add('ghost');
              ghost.style.top = y + 'px';
              ghosts.appendChild(ghost);
            }
          }
          refs.boardEl.appendChild(ghosts);
          for (let c2 = 0; c2 < cols; c2++) {
            if (c2 === c) continue;
            const nudge = chain.side(Math.abs(c2 - c));
            if (!nudge) continue;
            for (let r = 0; r < rows; r++) {
              const el = refs.boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c2}"]`);
              if (el) el.style.translate = `0 ${nudge * cell}px`;
            }
          }
        }
      }

      // ---------- line-clear collapse transition ----------
      // A whole-line bonus removes tiles from the board (see applyLineBonus
      // above), which would otherwise make survivors silently teleport to
      // their new position on the very next render(). Captured just before
      // the move, then diffed against the post-move DOM: cleared tiles get a
      // brief fade-out ghost at their old spot, and survivors that moved
      // freeze at their old spot and slide into their real one right after —
      // fade, *then* collapse, matching a real row of blocks being cleared
      // and the remaining ones sliding together to close the gap.
      const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const COLLAPSE_FADE_MS = 700;
      const COLLAPSE_SLIDE_MS = 480;
      // A gentle ease-in that snaps shut with a small overshoot right at the
      // end — survivors drift together slowly at first, then the last bit of
      // the gap "snaps" closed like a magnet grabbing hold, instead of a flat
      // constant-feel ease.
      const COLLAPSE_SLIDE_EASING = 'cubic-bezier(0.5, 0, 0.18, 1.4)';

      interface TileSnapshot { left: number; top: number; color: string }

      function captureTileSnapshots(): Map<number, TileSnapshot> {
        const map = new Map<number, TileSnapshot>();
        refs.boardEl.querySelectorAll<HTMLElement>('.tile[data-id]').forEach((el) => {
          const id = Number(el.dataset.id);
          const color = el.dataset.dotColor || el.style.background || 'var(--ink-faint)';
          map.set(id, { left: parseFloat(el.style.left), top: parseFloat(el.style.top), color });
        });
        return map;
      }

      // Snapshotted in onCascadeStep (still pre-removal DOM) and consumed by
      // onCascadeStepRendered right after that same step's render() — one
      // bonus step at a time, now that a chain reaction reveals its steps
      // one beat apart instead of all landing in the same render().
      let pendingCollapseSnapshot: Map<number, TileSnapshot> | null = null;

      function playCollapseTransition(before: Map<number, TileSnapshot>) {
        const seenIds = new Set<number>();
        const flipEls: HTMLElement[] = [];
        refs.boardEl.querySelectorAll<HTMLElement>('.tile[data-id]').forEach((el) => {
          const id = Number(el.dataset.id);
          seenIds.add(id);
          const prev = before.get(id);
          if (!prev) return;
          const dx = prev.left - parseFloat(el.style.left);
          const dy = prev.top - parseFloat(el.style.top);
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
          el.style.transition = 'none';
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          flipEls.push(el);
        });

        const removedIds: number[] = [];
        before.forEach((_, id) => { if (!seenIds.has(id)) removedIds.push(id); });

        const slideNow = () => {
          if (!flipEls.length) return;
          void refs.boardEl.offsetHeight; // commit the frozen transform before transitioning away from it
          requestAnimationFrame(() => {
            flipEls.forEach((el) => {
              el.style.transition = `transform ${COLLAPSE_SLIDE_MS}ms ${COLLAPSE_SLIDE_EASING}`;
              el.style.transform = '';
            });
          });
        };

        if (!removedIds.length) {
          slideNow();
          return;
        }
        removedIds.forEach((id) => {
          const prev = before.get(id)!;
          // A whole-line bonus only ever fires once every cell in that line
          // is already dot-faced (see isFullDotMatch), so what the player
          // just saw complete — and what should visibly disappear — is the
          // dot face: a transparent tile wearing the asterisk, not a
          // solid-fill square (which reads as the *front* of that color).
          const ghost = document.createElement('div');
          ghost.className = 'tile';
          const size = CELL - 4;
          ghost.style.width = size + 'px';
          ghost.style.height = size + 'px';
          ghost.style.left = prev.left + 'px';
          ghost.style.top = prev.top + 'px';
          ghost.style.pointerEvents = 'none';
          ghost.innerHTML = asteriskSvg(size * 0.95, prev.color);
          refs.boardEl.appendChild(ghost);
          if (reduceMotion()) { ghost.remove(); return; }
          ghost.style.transition = `opacity ${COLLAPSE_FADE_MS}ms ease`;
          requestAnimationFrame(() => { ghost.style.opacity = '0'; });
          setTimeout(() => ghost.remove(), COLLAPSE_FADE_MS + 40);
        });
        if (reduceMotion()) return; // final render() already shows the settled state
        setTimeout(slideNow, COLLAPSE_FADE_MS);
      }

      // Returns whether it actually resolved a move (and thus already
      // re-rendered at least once) — the caller needs this so it doesn't
      // blindly render() again right after, which would wipe out a cascade
      // step's ghost/flip/highlight elements before they ever get a frame
      // painted.
      // 四连爆炸：什么时候查（这一步的连锁全部走完之后，只查一次）、炸了扣多少、结算页写什么，都在
      // engine/bomb.ts 的 blowUpIfClustered（10-08 方案第五批第 3 条从五副棋盘里抽出来）。这儿只交代
      // 这副盘、谁挨着谁、怎么收场。
      function checkBombHazard(): boolean {
        return isBomb && blowUpIfClustered(grid, BOMB_ADJ, liveBomb, { render, forceEnd: (...a) => controller.forceEnd(...a) });
      }

      /**
       * 松手那一下把这一行 / 这一列滑定。
       *
       * 滑法走 engine/slideLine（2026-10-08 方案 2-12），和其余五副一样：**转了整圈、算出来不是
       * 一个排列，这一下都不算一步**。从前这儿自己转：只拦了「没动」（shift 为 0），拖满一整圈
       * （6 格）盘面原样回来，却照样记一步——步步为营里就是白扣一步余步，别的玩法里步数系数
       * 跟着吃亏。
       */
      function applyDrag(): boolean {
        if (!drag || !drag.axis) return false;
        if (drag.axis === 'row') {
          const shift = Math.round(drag.dx / drag.cell);
          const r = drag.r;
          const shifted = slideLine(grid[r], shift);
          if (!shifted) return false;
          grid[r] = shifted;
          const mask = new Set<string>();
          for (let c = 0; c < cols; c++) mask.add(cellKey(r, c));
          seatLine(refs.boardEl, mask);
          controller.resolveMove(mask, shift > 0 ? 0 : 180);
          return true;
        } else {
          const shift = Math.round(drag.dy / drag.cell);
          const c = drag.c;
          const shifted = slideLine(grid.map((row) => row[c]), shift);
          if (!shifted) return false;
          for (let r = 0; r < rows; r++) grid[r][c] = shifted[r];
          const mask = new Set<string>();
          for (let r = 0; r < rows; r++) mask.add(cellKey(r, c));
          seatLine(refs.boardEl, mask);
          controller.resolveMove(mask, shift > 0 ? 90 : -90);
          return true;
        }
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
          // x/y are board-local (see DragCallbacks.origin): removeLines()
          // really does drop a column from the array, so from the first
          // whole-line bonus onward the board sits inset inside its wrapper
          // and a wrapper-relative start point would grab the neighbouring
          // column.
          const c = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
          const r = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
          fingerAt = [x, y];
          drag = { r, c, axis: null, dx: 0, dy: 0, cell: CELL, lastShift: 0, chain: null };
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
          drag.c = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
          drag.r = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
          return { r: drag.r, c: drag.c };
        },
        onDrag(dx, dy) {
          if (!drag) return;
          drag.dx = dx;
          drag.dy = dy;
          if (!drag.axis) {
            drag.axis = Math.abs(dx) > Math.abs(dy) ? 'row' : 'col';
            drag.chain = createDragChain({
              n: drag.axis === 'row' ? cols : rows,
              grabbed: drag.axis === 'row' ? drag.c : drag.r,
              force: BOARD_FORCE,
              onFrame: renderDragPreview,
            });
          }
          const raw = drag.axis === 'row' ? dx / drag.cell : dy / drag.cell;
          // A light tick each time the drag crosses into a new whole-cell
          // shift — the discrete, physical "click" of passing a detent.
          const shift = Math.round(raw);
          if (shift !== drag.lastShift) {
            vibrate(6);
            playMove();
            drag.lastShift = shift;
          }
          drag.chain?.drive(magnetizeRawDist(raw));
        },
        onEnd(dx, dy) {
          const d = drag;
          // 教学的呼吸灯认「离上一次手指位置最近的一组」：手指落下的地方加上拖过的那一段，
          // 就是他松手的地方。
          if (fingerAt) glow.touch(fingerAt[0] + dx, fingerAt[1] + dy);
          if (!d || !d.axis || !d.chain) {
            drag = null;
            if (!controller.resolving) render();
            return;
          }
          d.dx = dx;
          d.dy = dy;
          // The chain carries the line the rest of the way into its slot —
          // the tail keeps swinging for a beat, exactly like the splash —
          // and only then does the move resolve.
          d.chain.settle(Math.round((d.axis === 'row' ? dx : dy) / d.cell), () => {
            d.chain?.stop();
            const moved = applyDrag();
            drag = null;
            // A resolved move already re-rendered (and, for a line bonus, is
            // mid-way through its own fade/collapse transition). Only a
            // no-op drag needs this render to snap the preview clean.
            if (!moved) render();
          });
        },
      });

      const stopResize = observeBoardSize(refs.boardWrap, () => {
        if (!drag && controller.started) render();
      });

      // Follows the app-wide setting (个人主页), so switching it mid-run
      // recolours the board under the player's finger rather than waiting
      // for the next game.
      const stopColorblind = onColorblindChange(() => {
        COLORS = pickPalette();
        renderLegend();
        if (controller.started) render();
      });
      // Pro 那一圈虚线是真画进 DOM 的（见 proSquareRing），所以拨开关要重画一遍棋盘。
      const stopPro = onProChange(() => {
        if (controller.started) render();
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

      // the board stays empty until Start is pressed — nothing is generated
      // or shown ahead of time — but the legend can render immediately.
      renderLegend();

      return destroy;
    },
  };
}
