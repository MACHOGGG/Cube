/**
 * Slides 微信小游戏的入口。
 *
 * 四屏，一条直线走下来：
 *   主菜单 → 开局倒数 4-3-2-1 → 玩 → 结算（再来 / 回主菜单）
 *
 * 玩的那一屏：顶上三格读数（得分 / 有效得分率 / 用时），中间 6×6 棋盘，手指
 * 按住一行或一列拖，松手落到最近的整格，然后连锁：得分 → 翻面 → 整线消掉 →
 * 再判；全翻完或死局就结算，综合得分和网页版同一条公式。
 *
 * 规则那一半（squareBoard.ts + 网页版的 scoring / stalemate）和网页版是同一
 * 份；这个文件只管手指、节拍和画面。计分节拍照 gameController.resolveMove
 * 抄：同一次滑动里的连锁每多一拍 ×3，跨滑动的连击 ×1 / 1.5 / 2 / 2.5。
 */
import { createSquareBoard } from './squareBoard';
import { createCircleBoard } from './circleBoard';
import type { Board, BoardLabels, BoardLine } from './board';
import type { Cell } from '../../src/engine/types';
import { createPlatform } from './platform';
import {
  cellAtPoint,
  COLORS,
  drawBoard,
  drawControls,
  drawEndCard,
  drawHud,
  fmtTime,
  pixelOf,
  STEP_UNITS,
  type DragView,
  type Highlight,
  type Layout,
} from './render';
import { drawCountdown, drawMenu, iconCircle, iconSquare, type MenuEntry, type MenuHit } from './menu';
import { playMetrics, type PlayMetrics } from './theme';
import { compositeScore } from './composite';
import { createStreakTracker } from '../../src/engine/scoring';
import { createPerformanceGauge } from '../../src/engine/performance';
import { cellKey } from '../../src/engine/types';
// 拖动的手感（磁吸卡点 + 弹簧拖尾 + 松手落位）直接用网页版那两份，不另写一
// 套：玩家的原话是「操作效果我都不希望有任何改动」。
import { magnetizeRawDist } from '../../src/engine/drag';
import { BOARD_FORCE, createDragChain, type DragChain } from '../../src/engine/dragChain';

// 先只做简体中文；多语言等界面定下来再接网页版的 i18n。
const T = {
  score: '得分',
  rate: '有效得分率',
  time: '用时',
  block22: '2×2',
  run4: '1×4',
  line: '整线',
  pattern: '图案',
  diamond121: '1-2-1',
  over: '挑战结束 · 综合得分',
  again: '再来',
  rawScore: '得分',
  timeMult: '用时系数',
  rateBonus: '有效得分率加成',
  unflipped: '从未翻面',
  moves: '步',
  title: 'Slides',
  tagline: '滑动 – 得分 – 消除',
  home: '回主菜单',
  square: '方块',
  circle: '小球',
};

/**
 * 菜单上摆哪几个玩法，以及每个玩法开局时发哪一副棋盘。
 *
 * 只摆做好了的——少一张卡片，好过摆一张按下去什么也不发生的卡片。再添一个
 * 玩法就是往这儿加一行：菜单的排版、棋盘的摆法、手指那一套全是照 Board 接口
 * 来的，一行也不用改。
 */
interface Game extends MenuEntry {
  create: (labels: BoardLabels) => Board;
}
const GAMES: readonly Game[] = [
  { id: 'square', name: T.square, icon: iconSquare, create: createSquareBoard },
  { id: 'circle', name: T.circle, icon: iconCircle, create: createCircleBoard },
];

/** 这一屏是哪一屏。 */
type Screen = 'menu' | 'count' | 'play';
let screen: Screen = 'menu';
let menuHits: MenuHit[] = [];
/** 正在玩（或正要开）的那个玩法。 */
let current: Game = GAMES[0];
/** 倒数从几数起，以及它开始的时刻。 */
const COUNT_FROM = 4;
let countStartedAt = 0;
let homeRect: [number, number, number, number] | null = null;
/** 底下两颗键这一帧画在哪儿——手指按下去要拿它判命中。 */
let ctrlHits: { pause: [number, number, number, number]; finish: [number, number, number, number] } | null = null;
/** 正被按住的那一颗（画成按下去的样子）。 */
let pressedCtl: 'pause' | 'finish' | null = null;

/** 同 gameController：同一次滑动里的连锁，每多一拍再乘它。 */
const CASCADE_COMBO_FACTOR = 3;
const HIGHLIGHT_MS = 450;
const STEP_GAP_MS = 260;
const BONUS_GAP_MS = 650;
const STUCK_END_MS = 1400;
/** 手指挪过这个距离才算开始拖（同网页版的死区意思）。 */
const DEAD_ZONE_PX = 6;

const p = createPlatform();
/** 加分气泡上写的那几个名字，三副棋盘共用一份。 */
const LABELS: BoardLabels = {
  block22: T.block22,
  run4: T.run4,
  line: T.line,
  pattern: T.pattern,
  diamond121: T.diamond121,
};
/** 这一局的棋盘。开局时按挑中的玩法换一副——主循环只认 Board 这个接口。 */
let board: Board = GAMES[0].create(LABELS);
const streak = createStreakTracker();
const perf = createPerformanceGauge();

let score = 0;
let moves = 0;
let startedAt = 0;
let over = false;
let resolving = false;
let highlights: Highlight[] = [];
let stuckKeys: Set<string> | null = null;
let endCard: { total: number; lines: string[] } | null = null;
let againRect: [number, number, number, number] | null = null;
/**
 * 手指按下之后的那一下。
 *
 * 按下时先记住按中了哪一颗；等手指挪出死区，才从「穿过这一颗的那几条线」里
 * 挑一条——手指往哪边拖，投影最大的那条就是它。方块只有横竖两条，小球有三
 * 条（一横两斜），挑法是同一个。
 */
interface DragState {
  line: BoardLine | null;
  lines: BoardLine[];
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  lastShift: number;
  /** 手指按住的是这条线上第几颗——弹簧从这一颗往两头传。 */
  grabbed: number;
  /** 那套弹簧本身（网页版 dragChain）。挑中线之后才有。 */
  chain: DragChain | null;
  /** 松手之后、这条线还在弹回卡点的那几百毫秒：画面照画，手指不再管用。 */
  settling: boolean;
}
let drag: DragState | null = null;
/** 手指按下时按中的那一颗——挑定线之后要靠它算「按住的是第几颗」。 */
let grabbedCell: Cell | null = null;

/** 手指这一下沿着某条线走了多远（像素，正数是顺着 vec 的方向）。 */
const along = (line: BoardLine, dx: number, dy: number): number => dx * line.vec[0] + dy * line.vec[1];

// ---- 排版 ------------------------------------------------------------------
//
// 一页从上到下，照网页版（style.css 的 .app--game）：
//
//   页边距 → 读数三格 → 空当 → 得分图示 → 空当 → 棋盘地板 → 空当
//   → 底下两颗键 → 页边距
//
// 中间那两段空当在网页版是 auto 外边距平分出来的，所以图示正好落在读数和棋
// 盘的正中间。这儿照着算：先把固定的几块减掉，剩下的高度一半给图示上面、一
// 半给图示下面。
const metrics = () => playMetrics(p.width, p.height, p.safeTop, p.safeBottom);

/**
 * 得分图示那一排占多高。
 *
 * 网页版是棋盘上方一排蓝色小图（1×4、2×2……），这一版还没画，先按 0 算——
 * 排版的式子已经给它留好位置了，图画出来之后把这里换成 m.hintEm * 1.6 就行。
 */
const hintHeight = (_m: PlayMetrics): number => 0;

/** 读数三格的上边沿。 */
const hudTop = (m: PlayMetrics) => m.padTop;
/** 底下两颗键的上边沿。 */
const controlsTop = (m: PlayMetrics) => p.height - m.padBottom - m.chipH;

function layout(): Layout {
  const m = metrics();
  const hintH = hintHeight(m);
  const top = hudTop(m) + m.chipH;
  const bottom = controlsTop(m) - m.rowGap;
  // 地板往外多出的那一圈：网页版是棋子自带外边距，地板贴着算；这儿给一个和
  // 圆角同量级的数，看起来才是「一块地板」而不是「刚好裹住棋子的一层皮」。
  const pad = Math.round(m.panelR * 0.55);
  const availW = p.width - m.padSide * 2 - pad * 2;
  const availH = bottom - top - m.rowGap * 2 - hintH - pad * 2;
  // 棋盘自己报出它占多少个「半边长」（extent），这儿只决定一个单位有多少像
  // 素：横竖两头都放得下的那个数，然后整副居中。两副棋盘走的是同一段。
  const e = board.extent();
  const unit = Math.max(1, Math.min(availW / e.w, availH / e.h));
  const x = Math.round((p.width - e.w * unit) / 2);
  // 棋盘在「图示底下到两颗键上面」这一段里居中。
  const boardTop = top + m.rowGap * 2 + hintH;
  const y = Math.round(boardTop + pad + (bottom - boardTop - pad * 2 - e.h * unit) / 2);
  return { x, y, unit, panelPad: pad, panelR: m.panelR };
}

function elapsedSec(): number {
  return over ? endElapsed : (p.now() - startedAt) / 1000;
}
let endElapsed = 0;

// ---- 一局 ------------------------------------------------------------------
/** 挑了一个玩法：先数 4-3-2-1，数完才开局。 */
function startCountdown(entry: Game) {
  current = entry;
  screen = 'count';
  countStartedAt = p.now();
}

function newGame() {
  drag?.chain?.stop();
  drag = null;
  grabbedCell = null;
  screen = 'play';
  board = current.create(LABELS);
  board.deal();
  score = 0;
  moves = 0;
  streak.reset();
  perf.reset();
  highlights = [];
  stuckKeys = null;
  endCard = null;
  againRect = null;
  over = false;
  resolving = false;
  drag = null;
  homeRect = null;
  startedAt = p.now();
}

/** 回主菜单：这一局就此作罢，不留结算。 */
function goHome() {
  drag?.chain?.stop();
  drag = null;
  grabbedCell = null;
  screen = 'menu';
  over = false;
  resolving = false;
  drag = null;
  endCard = null;
  againRect = null;
  homeRect = null;
}

function endGame() {
  if (over) return;
  over = true;
  resolving = false;
  endElapsed = (p.now() - startedAt) / 1000;
  const ratePercent = perf.valuePercent();
  const remaining = board.remaining();
  const comp = compositeScore({ score, elapsedSec: endElapsed, ratePercent, neverFlipped: remaining.neverFlipped });
  endCard = {
    total: comp.total,
    lines: [
      `${T.rawScore} ${score}`,
      `${T.timeMult} ×${comp.timeMult.toFixed(2)} · ${T.rateBonus} ×${comp.bonusMult.toFixed(2)}`,
      `${T.unflipped} × ${remaining.neverFlipped} → ×${comp.unflippedScale.toFixed(2)}`,
      `${moves} ${T.moves} · ${fmtTime(endElapsed)}`,
    ],
  };
}

function resolveMove(mask: Set<string>) {
  if (over || resolving) return;
  moves++;
  resolving = true;
  p.vibrate();
  const stepper = board.cascade(mask);
  const multiplier = streak.currentMultiplier();
  let comboMult = 1;
  let totalRaw = 0;
  let moveWeight = 0;

  const finish = () => {
    streak.apply(totalRaw);
    perf.onMove(moveWeight);
    highlights = [];
    if (board.isGameOver()) {
      endGame();
      return;
    }
    const stuck = board.stuckGroups();
    if (stuck.length) {
      // 再也翻不动了：红光一拍，然后结算（同网页版，死局没有按钮能拦）。
      stuckKeys = new Set(stuck.flat().map(([r, c]) => cellKey(r, c)));
      setTimeout(() => endGame(), STUCK_END_MS);
    }
    resolving = false;
  };

  const step = () => {
    const s = stepper.next();
    if (!s) {
      finish();
      return;
    }
    totalRaw += s.points;
    moveWeight += s.weight;
    const delta = Math.round(s.points * multiplier * comboMult);
    comboMult *= CASCADE_COMBO_FACTOR;
    const isBonus = s.lineBonusGroups.length > 0;
    highlights = [
      ...s.matchGroups.map((cells) => ({ cells, kind: 'match' as const })),
      ...s.lineBonusGroups.map((cells) => ({ cells, kind: 'line' as const })),
    ];
    p.vibrate();
    const proceed = () => {
      s.commit();
      score += delta;
      highlights = [];
      setTimeout(step, isBonus ? BONUS_GAP_MS : STEP_GAP_MS);
    };
    // 整线那一拍：棋子在 next() 返回时已经拿掉了，没有可以描边的东西，直接走。
    if (s.matchGroups.length) setTimeout(proceed, HIGHLIGHT_MS);
    else proceed();
  };
  step();
}

// ---- 手指 ------------------------------------------------------------------
const inRect = (r: [number, number, number, number] | null, x: number, y: number) =>
  !!r && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

p.onTouch({
  start(x, y) {
    if (screen === 'menu') {
      const hit = menuHits.find((h) => inRect(h.rect, x, y));
      const entry = hit && GAMES.find((g) => g.id === hit.id);
      if (entry) {
        p.vibrate();
        startCountdown(entry);
      }
      return;
    }
    // 倒数那几秒按哪儿都不算——网页版也是，倒数停不住。
    if (screen === 'count') return;
    if (over) {
      if (inRect(againRect, x, y)) newGame();
      else if (inRect(homeRect, x, y)) goHome();
      return;
    }
    // 底下那两颗键：《暂停》先只做成「按得动、有反馈」，暂停页和交卷确认是
    // 下一步的事（见 wxgame/README.md 的待办）。《完成》= 这一局到此为止，
    // 直接结算，同网页版的那颗对勾。
    if (ctrlHits && !over) {
      if (inRect(ctrlHits.pause, x, y)) {
        pressedCtl = 'pause';
        p.vibrate();
        return;
      }
      if (inRect(ctrlHits.finish, x, y)) {
        pressedCtl = 'finish';
        p.vibrate();
        return;
      }
    }
    if (resolving) return;
    // 上一条还在弹回去的时候又按下来：立刻把它落定，别把这一下吞掉（同网页版
    // 的 chain.flush——快手连着走两行不该丢一步）。
    if (drag?.settling) {
      drag.chain?.flush();
      drag = null;
    }
    if (resolving) return;
    const hit = cellAtPoint(board, layout(), x, y);
    if (!hit) return;
    drag = {
      line: null,
      lines: board.linesThrough(hit[0], hit[1]),
      x0: x,
      y0: y,
      dx: 0,
      dy: 0,
      lastShift: 0,
      grabbed: 0,
      chain: null,
      settling: false,
    };
    grabbedCell = hit;
  },
  move(x, y) {
    if (screen !== 'play' || !drag || drag.settling) return;
    drag.dx = x - drag.x0;
    drag.dy = y - drag.y0;
    if (!drag.line) {
      if (Math.abs(drag.dx) < DEAD_ZONE_PX && Math.abs(drag.dy) < DEAD_ZONE_PX) return;
      // 挑一条线：手指这一下在哪条线上走得最远，就是想拖那一条。
      let best: BoardLine | null = null;
      let bestProj = 0;
      for (const line of drag.lines) {
        const proj = Math.abs(along(line, drag.dx, drag.dy));
        if (proj > bestProj) {
          bestProj = proj;
          best = line;
        }
      }
      drag.line = best;
      if (!drag.line) return;
      // 挑定了才架弹簧：它要知道这条线有几颗、手指按住的是第几颗。
      const g = grabbedCell;
      drag.grabbed = Math.max(
        0,
        drag.line.cells.findIndex(([r, c]) => !!g && r === g[0] && c === g[1]),
      );
      drag.chain = createDragChain({
        n: drag.line.cells.length,
        grabbed: drag.grabbed,
        force: BOARD_FORCE,
        // 画面本来就每帧重画（主循环），不用它再催一次。
        onFrame: () => {},
      });
    }
    const L = layout();
    const raw = along(drag.line, drag.dx, drag.dy) / (L.unit * STEP_UNITS);
    const shift = Math.round(raw);
    if (shift !== drag.lastShift) {
      drag.lastShift = shift;
      p.vibrate();
    }
    // 磁吸：卡点附近粘一下，过了半格才肯松开。落到哪一格没变，变的只是拖动
    // 过程中看到的位置（magnetizeRawDist 的 round 和原值的 round 永远相同）。
    drag.chain?.drive(magnetizeRawDist(raw));
  },
  end(x, y) {
    // 先看是不是刚按住的那两颗键。
    if (pressedCtl) {
      const which = pressedCtl;
      pressedCtl = null;
      if (ctrlHits && !over && inRect(which === 'pause' ? ctrlHits.pause : ctrlHits.finish, x, y)) {
        if (which === 'finish') endGame();
      }
      return;
    }
    const d = drag;
    if (screen !== 'play' || !d || !d.line || d.settling) {
      drag = null;
      return;
    }
    d.dx = x - d.x0;
    d.dy = y - d.y0;
    const L = layout();
    // 松手落到最近的整格：走了几个「一步」就滑几格，没到半格就当没拖。
    const by = Math.round(along(d.line, d.dx, d.dy) / (L.unit * STEP_UNITS));
    const line = d.line;
    if (!d.chain) {
      drag = null;
      if (by !== 0) resolveMove(board.shiftLine(line.id, by));
      return;
    }
    // 不是「啪」一下切到结果：弹簧把这条线送进卡点，尾巴再晃一下，然后才真
    // 的动棋盘（同网页版 chain.settle）。这几百毫秒里 drag 还留着，画面照画，
    // 手指不管用。
    d.settling = true;
    d.chain.settle(by, () => {
      d.chain?.stop();
      drag = null;
      if (by !== 0) resolveMove(board.shiftLine(line.id, by));
    });
  },
});

// ---- 画 --------------------------------------------------------------------
function draw() {
  const ctx = p.ctx;
  if (screen === 'menu') {
    menuHits = drawMenu(ctx, p.width, p.height, GAMES, { title: T.title, tagline: T.tagline });
    return;
  }
  if (screen === 'count') {
    const left = COUNT_FROM * 1000 - (p.now() - countStartedAt);
    if (left <= 0) {
      newGame();
      return;
    }
    const n = Math.ceil(left / 1000);
    drawCountdown(ctx, p.width, p.height, current, n, 1 - (left % 1000) / 1000);
    return;
  }
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, p.width, p.height);
  const m = metrics();
  drawHud(ctx, p.width, hudTop(m), m, {
    score,
    ratePercent: perf.valuePercent(),
    elapsedSec: elapsedSec(),
    labels: { score: T.score, rate: T.rate, time: T.time },
  });
  // 底下两颗键：《暂停》《完成》。结算页盖上来的时候就不画了。
  if (!over) ctrlHits = drawControls(ctx, p.width, controlsTop(m), m, pressedCtl);
  const L = layout();
  let dv: DragView | null = null;
  if (drag?.line && drag.chain) {
    const chain = drag.chain;
    const line = drag.line;
    // 邻居跟着蹭多远：先找出它和被拖那条线隔了几条。两副棋盘的线号都是
    // 「族 + 序号」（R3、A2、B5、C4），所以同族的两条线相差几号就是隔几条；
    // 不同族的不算邻居。
    const fam = line.id[0];
    const own = Number(line.id.slice(1));
    dv = {
      cells: line.cells,
      vec: line.vec,
      slotsAt: (i) => chain.at(i),
      pressAt: (i) => chain.press(i),
      nudgeAt: (r, c) => {
        const same = board.linesThrough(r, c).find((l) => l.id[0] === fam);
        if (!same) return 0;
        return chain.side(Math.abs(Number(same.id.slice(1)) - own));
      },
    };
  }
  if (board.rows > 0) drawBoard(ctx, board, L, dv, highlights, stuckKeys);
  if (over && endCard) {
    const r = drawEndCard(ctx, p.width, p.height, {
      title: T.over,
      total: endCard.total,
      lines: endCard.lines,
      again: T.again,
      home: T.home,
    });
    againRect = r.again;
    homeRect = r.home;
  }
}

function loop() {
  draw();
  p.requestFrame(loop);
}

// 开门见山是主菜单，不是直接开局——玩家先挑玩法。
loop();

// 浏览器里跑回归（scripts/check-wxgame.mjs）时露一个把手；小游戏里没有 window，不露。
if (!p.isWx) {
  (globalThis as any).__slidesWx = {
    get board() {
      return board;
    },
    layout,
    games: GAMES.map((g) => g.id),
    get screen() {
      return screen;
    },
    get menuHits() {
      return menuHits;
    },
    /** 回归脚本用：直接开一局，不等那四秒。 */
    startNow(id?: string) {
      current = GAMES.find((g) => g.id === id) ?? GAMES[0];
      newGame();
    },
    /** 回归脚本用：照着屏幕坐标拖一条线，和真手指走同一段代码。 */
    get drag() {
      return drag;
    },
    goHome,
    /** 回归脚本用：这一颗的中心在屏幕上的哪儿——好照着它拖。 */
    pixelOf: (r: number, c: number) => pixelOf(board, layout(), r, c),
    /** 一步有多长（像素）：拖这么远正好滑一格。 */
    stepPx: () => layout().unit * STEP_UNITS,
    get score() {
      return score;
    },
    get over() {
      return over;
    },
    get resolving() {
      return resolving;
    },
  };
}
