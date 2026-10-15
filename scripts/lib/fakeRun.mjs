/**
 * 门用的夹具：给棋盘、玩法、想要的综合分，拼一份**账对得上**的一局明细（10-11 方案 A-3）。
 *
 *   import { fakeRun } from './lib/fakeRun.mjs';
 *   const data = fakeRun({ board: 'square', modeKey: 'base', total: 300 });
 *   await call({ action: 'push', mode: 'square', score: 300, data: { ...data, seedSource: 'daily' } });
 *
 * 为什么要它：A-3 之后服务器对每一局对一遍账（api/_maxscore.js 的 vetRun）——拼出分拆得开、翻面数
 * 和全盘对得上、步数系数和综合分算得出来。缺字段的一局回 200 `stored: false`、不上榜，所以那些只交
 * `{ shapeId, totalScore }` 几位的门（排行榜、今日榜、昵称、重建……）从那以后一局都上不了榜，而它们
 * 量的是别的事。这个夹具替它们把明细拼齐，量的那件事照旧。
 *
 * 拼法（每一档都照 vetRun 的规矩，**不碰上界**——想量上界的门自己改明细）：
 *   · 乘步数系数那几档（基础、计时、炸弹、更多布局）：系数取 1（清掉 0 枚），拼出分 = 综合分；
 *     先用翻面（每枚 2 分、不超过全盘），剩下的算成削线分（每条线不超过 Lmax²）。
 *   · 老虎机：同上，只是剩下的那一截算成完成奖励（图案分里多出来的那部分）。
 *   · 无限反转：用时 100 秒、走 100 步，拼出分 = 综合分（一部分是连击多出来的）。
 *   · 步步为营：综合分 = 被消除 × 10 + 星星 × 5，所以它得是 5 的倍数、不超过全盘 × 10。
 *
 * 规则版本（`rules`）现读 src/engine/scoring.ts 的 SCORING_RULES_VERSION——服务端只收现行那一版。
 *
 * 门里那个 `call()` 多半用下面的 fillRun：门自己写的那几位盖在夹具上，门写什么算什么。
 */
import { readFileSync } from 'node:fs';
import { BOARD_LIMITS, POINTS_PER_FLIP, PUZZLE_CLEARED_POINTS, PUZZLE_STAR_POINTS, PUZZLE_START } from '../../api/_maxscore.js';

const SCORING_V = (/export const SCORING_RULES_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../../src/engine/scoring.ts', import.meta.url), 'utf8'),
) || [])[1];
if (!SCORING_V) throw new Error('fakeRun：读不到 src/engine/scoring.ts 的 SCORING_RULES_VERSION');

/** 每一档带的那几个「第几版规则」（服务端照它们分榜，见 api/scores.js 的 kindOf）。 */
const RULE_TAGS = {
  bomb: { bombRules: 3 },
  bombTimed: { bombRules: 3 },
  flip: { flipRules: 2 },
  puzzle: { puzzleRules: 3 },
};

/**
 * @param {object} o
 * @param {string} o.board   棋盘 id（square / circle / squareDiamond / circleHex / circleSeven / triangleBig）
 * @param {string} [o.modeKey] base / timed / bomb / bombTimed / flip / puzzle（老虎机是 base ＋ slot）
 * @param {boolean} [o.slot]
 * @param {number} o.total   想要的综合分（非负整数）
 */
export function fakeRun({ board, modeKey = 'base', slot = false, total }) {
  const b = BOARD_LIMITS[board];
  if (!b) throw new Error(`fakeRun：不认识的棋盘 ${board}`);
  const T = Math.max(0, Math.round(Number(total) || 0));
  const base = {
    shapeId: board,
    modeKey,
    rules: SCORING_V,
    totalScore: T,
    boardTiles: b.N,
    defused: 0,
    hazardEnd: false,
    elapsedSec: 60,
    ...(RULE_TAGS[modeKey] || {}),
    ...(slot ? { slot: true } : {}),
  };

  if (modeKey === 'puzzle') {
    if (T % 5 !== 0 || T > b.N * PUZZLE_CLEARED_POINTS) throw new Error(`fakeRun：步步为营的分得是 5 的倍数、不超过 ${b.N * 10}（要的是 ${T}）`);
    let cleared = Math.min(b.N, Math.floor(T / PUZZLE_CLEARED_POINTS));
    let stars = (T - cleared * PUZZLE_CLEARED_POINTS) / PUZZLE_STAR_POINTS;
    while (cleared + stars > b.N && cleared > 0) { cleared--; stars += 2; }
    const flips = Math.min(b.N, cleared + stars);
    // 第 3 版的账（10-15 补充 S9）：起手几步就能空走几步，得分的那几步不扣——走了「起手 + 10」步、其中 10 步得分、剩 0。
    const spent = (PUZZLE_START[board] ?? 0) + 10;
    return {
      ...base,
      score: POINTS_PER_FLIP * flips, patternPoints: POINTS_PER_FLIP * flips, linePoints: 0, comboBonusPoints: 0,
      flips, lines: 0, moves: spent, cleared, stepCoef: 1,
      puzzle: { cleared, stars, spent, scoredMoves: 10, left: 0 },
    };
  }
  if (modeKey === 'flip') {
    const patternPoints = Math.min(T, 4 * 100);
    return {
      ...base,
      score: T, patternPoints, linePoints: 0, comboBonusPoints: T - patternPoints,
      flips: patternPoints, lines: 0, moves: 100, cleared: 0, stepCoef: 1, elapsedSec: 100,
    };
  }
  // 乘步数系数的那几档和老虎机：先用翻面，剩下的给削线分（老虎机给完成奖励）。
  const flips = Math.min(b.N, Math.floor(T / POINTS_PER_FLIP));
  const rest = T - POINTS_PER_FLIP * flips;
  if (slot) {
    return {
      ...base,
      score: T, patternPoints: T, linePoints: 0, comboBonusPoints: 0,
      flips, lines: 0, moves: 30, cleared: 0, stepCoef: 1,
    };
  }
  const lines = Math.ceil(rest / b.Lmax ** 2);
  return {
    ...base,
    score: T, patternPoints: POINTS_PER_FLIP * flips, linePoints: rest, comboBonusPoints: 0,
    flips, lines, moves: 30, cleared: 0, stepCoef: 1, par: b.par,
  };
}

/**
 * 门里 `call()` 交卷前补明细的那一句：夹具拼一份对得上账的，门自己写的那几位（`given`）盖在上面。
 *
 *   · 拼不出来的（门故意报一个打不出来的分：步步为营 361 分、不认识的棋盘……）就什么都不补，这一局
 *     照门自己写的交上去——量的正是服务器怎么拦它。
 *   · 「第几版规则」那几位（bombRules / flipRules / puzzleRules）**只用门自己写的**：好几道门故意不写，
 *     好让那一局落进归档的老榜（square:bomb、square:flip……）；夹具替它补上现行版本，那一局就搬到
 *     现行榜上去了，量的不再是那件事。
 */
export function fillRun(mode, score, given = {}) {
  let filled = {};
  try {
    if (BOARD_LIMITS[mode]) {
      filled = fakeRun({ board: mode, modeKey: given.modeKey || 'base', slot: Boolean(given.slot), total: score });
    }
  } catch {
    filled = {};
  }
  for (const k of ['bombRules', 'flipRules', 'puzzleRules']) if (!(k in given)) delete filled[k];
  return { ...filled, shapeId: mode, totalScore: score, ...given };
}
