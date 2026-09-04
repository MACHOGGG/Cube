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
import { createSquareBoard, PALETTE } from './squareBoard';
import { createPlatform } from './platform';
import { COLORS, drawBoard, drawEndCard, drawHud, fmtTime, type DragView, type Highlight, type Layout } from './render';
import { drawCountdown, drawMenu, iconSquare, type MenuEntry, type MenuHit } from './menu';
import { compositeScore } from './composite';
import { createStreakTracker } from '../../src/engine/scoring';
import { createPerformanceGauge } from '../../src/engine/performance';
import { cellKey } from '../../src/engine/types';

// 先只做简体中文；多语言等界面定下来再接网页版的 i18n。
const T = {
  score: '得分',
  rate: '有效得分率',
  time: '用时',
  block22: '2×2',
  run4: '1×4',
  line: '整线',
  pattern: '图案',
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
};

/**
 * 菜单上摆哪几个玩法。
 *
 * 只摆做好了的——少一张卡片，好过摆一张按下去什么也不发生的卡片。小球和三
 * 角的规则模型做好了（wxgame/src/circleBoard.ts / triangleBoard.ts），往这儿
 * 加一行就是了，菜单的排版自己会跟上。
 */
const GAMES: readonly MenuEntry[] = [{ id: 'square', name: T.square, icon: iconSquare }];

/** 这一屏是哪一屏。 */
type Screen = 'menu' | 'count' | 'play';
let screen: Screen = 'menu';
let menuHits: MenuHit[] = [];
/** 正在玩（或正要开）的那个玩法。 */
let current: MenuEntry = GAMES[0];
/** 倒数从几数起，以及它开始的时刻。 */
const COUNT_FROM = 4;
let countStartedAt = 0;
let homeRect: [number, number, number, number] | null = null;

/** 同 gameController：同一次滑动里的连锁，每多一拍再乘它。 */
const CASCADE_COMBO_FACTOR = 3;
const HIGHLIGHT_MS = 450;
const STEP_GAP_MS = 260;
const BONUS_GAP_MS = 650;
const STUCK_END_MS = 1400;
/** 手指挪过这个距离才算开始拖（同网页版的死区意思）。 */
const DEAD_ZONE_PX = 6;

const p = createPlatform();
const board = createSquareBoard({ block22: T.block22, run4: T.run4, line: T.line, pattern: T.pattern });
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
let drag: { r: number; c: number; axis: 'row' | 'col' | null; x0: number; y0: number; dx: number; dy: number; lastShift: number } | null =
  null;

// ---- 排版 ------------------------------------------------------------------
const HUD_TOP = 48;
const HUD_H = 58;
function layout(): Layout {
  const top = HUD_TOP + HUD_H + 22;
  const availW = p.width - 32;
  const availH = p.height - top - 40;
  const cell = Math.floor(Math.min(availW / Math.max(1, board.cols), availH / Math.max(1, board.rows)));
  const x = Math.round((p.width - cell * board.cols) / 2);
  const y = Math.round(top + (availH - cell * board.rows) / 2);
  return { x, y, cell };
}

function elapsedSec(): number {
  return over ? endElapsed : (p.now() - startedAt) / 1000;
}
let endElapsed = 0;

// ---- 一局 ------------------------------------------------------------------
/** 挑了一个玩法：先数 4-3-2-1，数完才开局。 */
function startCountdown(entry: MenuEntry) {
  current = entry;
  screen = 'count';
  countStartedAt = p.now();
}

function newGame() {
  screen = 'play';
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
    if (resolving) return;
    const L = layout();
    const c = Math.floor((x - L.x) / L.cell);
    const r = Math.floor((y - L.y) / L.cell);
    if (r < 0 || c < 0 || r >= board.rows || c >= board.cols) return;
    drag = { r, c, axis: null, x0: x, y0: y, dx: 0, dy: 0, lastShift: 0 };
  },
  move(x, y) {
    if (screen !== 'play' || !drag) return;
    drag.dx = x - drag.x0;
    drag.dy = y - drag.y0;
    if (!drag.axis) {
      if (Math.abs(drag.dx) < DEAD_ZONE_PX && Math.abs(drag.dy) < DEAD_ZONE_PX) return;
      drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'row' : 'col';
    }
    const L = layout();
    const shift = Math.round((drag.axis === 'row' ? drag.dx : drag.dy) / L.cell);
    if (shift !== drag.lastShift) {
      drag.lastShift = shift;
      p.vibrate();
    }
  },
  end(x, y) {
    const d = drag;
    drag = null;
    if (screen !== 'play' || !d || !d.axis) return;
    d.dx = x - d.x0;
    d.dy = y - d.y0;
    const L = layout();
    const by = Math.round((d.axis === 'row' ? d.dx : d.dy) / L.cell);
    if (by === 0) return;
    const mask = board.shift(d.axis, d.axis === 'row' ? d.r : d.c, by);
    resolveMove(mask);
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
  drawHud(ctx, p.width, HUD_TOP, {
    score,
    ratePercent: perf.valuePercent(),
    elapsedSec: elapsedSec(),
    labels: { score: T.score, rate: T.rate, time: T.time },
  });
  const L = layout();
  let dv: DragView | null = null;
  if (drag?.axis) {
    dv = {
      axis: drag.axis,
      index: drag.axis === 'row' ? drag.r : drag.c,
      offsetPx: drag.axis === 'row' ? drag.dx : drag.dy,
    };
  }
  if (board.rows > 0 && board.cols > 0) drawBoard(ctx, board, L, PALETTE, dv, highlights, stuckKeys);
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
    board,
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
    goHome,
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
