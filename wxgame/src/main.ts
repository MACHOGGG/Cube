/**
 * Slides 微信小游戏——方块基础版原型的入口。
 *
 * 一屏：顶上三格读数（得分 / 有效得分率 / 用时），中间 6×6 棋盘，手指按住
 * 一行或一列拖，松手落到最近的整格，然后连锁：得分 → 翻面 → 整线消掉 → 再
 * 判；全翻完或死局就结算，综合得分和网页版同一条公式。
 *
 * 规则那一半（squareBoard.ts + 网页版的 scoring / stalemate）和网页版是同一
 * 份；这个文件只管手指、节拍和画面。计分节拍照 gameController.resolveMove
 * 抄：同一次滑动里的连锁每多一拍 ×3，跨滑动的连击 ×1 / 1.5 / 2 / 2.5。
 */
import { createSquareBoard, PALETTE } from './squareBoard';
import { createPlatform } from './platform';
import { COLORS, drawBoard, drawEndCard, drawHud, fmtTime, type DragView, type Highlight, type Layout } from './render';
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
};

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
function newGame() {
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
  startedAt = p.now();
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
p.onTouch({
  start(x, y) {
    if (over) {
      const a = againRect;
      if (a && x >= a[0] && x <= a[0] + a[2] && y >= a[1] && y <= a[1] + a[3]) newGame();
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
    if (!drag) return;
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
    if (!d || !d.axis) return;
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
    const r = drawEndCard(ctx, p.width, p.height, { title: T.over, total: endCard.total, lines: endCard.lines, again: T.again });
    againRect = r.again;
  }
}

function loop() {
  draw();
  p.requestFrame(loop);
}

newGame();
loop();

// 浏览器里跑回归（scripts/check-wxgame.mjs）时露一个把手；小游戏里没有 window，不露。
if (!p.isWx) {
  (globalThis as any).__slidesWx = {
    board,
    layout,
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
