/**
 * 一局分数的上限，全站一个数：排行榜（scores.js）和小屋（room.js）都从这儿取（10-09 补充方案 7-6）。
 * 文件后半是排行榜交卷时对的那一遍账（vetRun，10-11 方案 A-3）。
 *
 * 两头收的都是客户端报上来的分，服务器核不了真伪（scores.js 文件头「关于作弊」、room.js 的 score
 * 里那一段）。这个十亿只挡**离谱的数**，不是反作弊——排行榜那头另有下面那一道对账，「999999999」
 * 在那一道上就被拒了；小屋那头至今只有它。它真正防的是「1e300」那一种——小屋那头原先只收拾了负数
 * 和非数字，一份 1e300 原样存进去，散场那张战绩卡上就印着「1e+300」；报到 1e308 的话两局一加就溢
 * 出成 Infinity，而 Infinity 写进库里（JSON）变成 null，读回来是 0——他一晚上的累计总分悄悄清零。
 *
 * 原来是一百万：无限反转早先那版计分（同一步里 ×3 连锁、翻来翻去不停）真能打到七位数，超过的
 * 一律记成一百万，榜上就出现一排一模一样的数——玩家的原话：「过了上限以后都按照同一数字显示
 * 了」。现在放到十亿：正常怎么打都够不着，又仍然挡得住「把 999999999999 填进去」那种一眼假的数。
 *
 * 两处从前各写各的：排行榜封在十亿，小屋没封。一个数写在两个地方，迟早会一处改了另一处没改。
 */
export const MAX_SCORE = 1_000_000_000;

/*
 * ── 这一局的账对不对得上（10-11 方案 A-3）──────────────────────────────────
 *
 * 上面那个十亿只挡「一眼假」的数。排行榜上真出过的事比那个狡猾：一个免费账号交 `999999999`，明细
 * 互相矛盾（翻了 3 枚、拼出分却是九位数），照样 200、上了总榜第一——服务器原先只核 `totalScore ===
 * score`、`shapeId === mode`，步步为营另有一道 10N 的上限，别的什么都不看。
 *
 * 这一段给每一局对一遍账：用**服务器自己的表**（每副棋盘几枚、几个线族、最长的线、基准步数），按
 * 玩法分档，把客户端报上来的明细重算一遍。对不上、或者超出这副棋盘在规则下**打得出**的最大值，就
 * 不收（scores.js 的 push 回 400 `implausible`；重建时那一局不计入，A-5）。
 *
 * 它挡得住「乱填」，挡不住「自洽的假分」（步数 1、全清，方块照样一百四十多万）——真防伪要服务端拿
 * 种子加操作记录重放一遍，那是另一件大工程，不在这一批。
 *
 * ⚠️ **下面这几张表都是手抄的**：api/ 是纯 .js，import 不进 src 里的 ts。门 scripts/check-scores-guard.mjs
 * 当场从各棋盘源码、engine/targetMatch.ts、engine/erosion.ts 那几处推一遍，对不上就红——改了棋盘、
 * 阶梯、计分，跟着改这儿。
 */

/**
 * 每副棋盘：
 *   N    全盘几枚（客户端的 hooks.boardTiles）。
 *   d    一枚最多同时在几条线上（线族数）。
 *   Lmax 一条线上最多几枚活格（六边圆球中心那个永久空位不算，所以是 6 不是 7）。
 *   par  基准步数（engine/erosion.ts 的表）。
 */
export const BOARD_LIMITS = Object.freeze({
  square: Object.freeze({ N: 36, d: 2, Lmax: 6, par: 54 }),
  circle: Object.freeze({ N: 28, d: 3, Lmax: 7, par: 28 }),
  squareDiamond: Object.freeze({ N: 36, d: 3, Lmax: 6, par: 54 }),
  circleHex: Object.freeze({ N: 36, d: 3, Lmax: 6, par: 54 }),
  circleSeven: Object.freeze({ N: 49, d: 3, Lmax: 7, par: 86 }),
  triangleBig: Object.freeze({ N: 54, d: 3, Lmax: 11, par: 81 }),
});

/**
 * 老虎机：「经过某一格的不同摆法数 × ⌈k²/2⌉」在这一族各目标、各级里的最大值。
 *
 * 一次拼成拿 ⌈k²/2⌉（engine/targets.ts 的 scoreForSize）；每一次拼成里至少有一枚正面在那一拍翻过
 * 去，而一枚只翻一次——所以整局的完成奖励不超过 N × P。方块那一族最大的是目标 33 降到 4 枚那一级
 * （五种子形一共 100 种摆法 × 8 分），小球是目标 26 降到 5 枚那一级（30 × 13）。
 */
export const SLOT_P = Object.freeze({ square: 800, circle: 390 });

/**
 * 无限反转：一步之内各拍原始分加起来最多多少（raw），最多几拍（beats）。
 *
 * 这一档翻过去还能翻回来，「每枚只翻一次」那个上界不成立，所以按引擎的连锁规则推：一步之内棋子
 * 不挪位（这一档没有消线），一组就是一条线上连着的一段（≥ 4 枚，图案冻结在 4 枚），按棋子身份记账，
 * 同一组一步之内最多给两次分（scoring.ts 的 createToggleLedger），一组的分就是它的枚数。所以
 *   raw   ≤ 2 × Σ（每条线上每一段 ≥ 4 枚的连续段的枚数）
 *   beats ≤ 2 × 那样的段数
 * 方块是 12 条 6 枚的线，小球是三个方向各 7 条（1 到 7 枚）。可证明，而且宽——宁可放过，不可误拒。
 */
export const FLIP_STEP = Object.freeze({
  square: Object.freeze({ raw: 672, beats: 144 }),
  circle: Object.freeze({ raw: 570, beats: 120 }),
});

/** 无限反转一局几秒（src/engine/modeClock.ts 的 MODE_SECONDS）。报上来的用时多给 5 秒的余量。 */
export const FLIP_SECONDS = 100;
/** 连击倍率的封顶：1.5¹⁰（src/engine/scoring.ts 的 FLIP_STREAK_BASE ** FLIP_STREAK_CAP）。 */
export const FLIP_MULT_CAP = 1.5 ** 10;
/** 每翻一枚几分（src/engine/scoring.ts 的 POINTS_PER_FLIP）。 */
export const POINTS_PER_FLIP = 2;
/** 炸弹相连收场扣几分（src/engine/bomb.ts 的 BOMB_HAZARD_PENALTY）。 */
export const BOMB_HAZARD_PENALTY = 100;
/** 步步为营：被消除一枚几分、终局一颗星几分（src/engine/puzzleScore.ts）。 */
export const PUZZLE_CLEARED_POINTS = 10;
export const PUZZLE_STAR_POINTS = 5;

/** 削线分的上界：每格在每个线族里最多属于一条线，一条线的分是它枚数的平方 ≤ 枚数 × Lmax。 */
const lineCeiling = (b) => b.d * b.N * b.Lmax;

/** 乘步数系数那几档（基础、计时、炸弹、更多布局、每日挑战）的综合分上界 T = (2N + d·N·Lmax) · par²。 */
export function stepCeiling(board) {
  const b = BOARD_LIMITS[board];
  return b ? (POINTS_PER_FLIP * b.N + lineCeiling(b)) * b.par ** 2 : 0;
}

/** 老虎机的上界 S = 2N + d·N·Lmax + N·P（这一档不乘步数系数）。 */
export function slotCeiling(board) {
  const b = BOARD_LIMITS[board];
  return b && SLOT_P[board] ? POINTS_PER_FLIP * b.N + lineCeiling(b) + b.N * SLOT_P[board] : 0;
}

/** 无限反转：这么多秒里最多走几步（一秒 4 步，人的手到不了）。 */
export const flipMoveCap = (elapsedSec) => 4 * Math.max(1, elapsedSec);
/** 无限反转一步最多几分：每一拍都按封顶的倍率算，再给每一拍的四舍五入留半分。 */
export function flipStepCap(board) {
  const f = FLIP_STEP[board];
  return f ? f.raw * FLIP_MULT_CAP + f.beats / 2 : 0;
}
/** 无限反转一局的绝对上界（重建时判旧 best 用）：用满一局的秒数、走满步数。 */
export const flipCeiling = (board) => flipMoveCap(FLIP_SECONDS + 5) * flipStepCap(board);

/** 步步为营一局的上界：一盘全消掉。 */
export function puzzleCeiling(board) {
  const b = BOARD_LIMITS[board];
  return b ? b.N * PUZZLE_CLEARED_POINTS : 0;
}

/**
 * 步数系数——**和客户端 src/engine/stepCoef.ts 的 stepCoefFor 一个字不差**（同样的运算次序，得出来的
 * 浮点数逐位相同，四舍五入才对得上）。
 */
export function stepCoefOf(par, cleared, tiles, moves) {
  if (moves <= 0 || tiles <= 0) return 1;
  const x = ((par * cleared) / tiles) / moves;
  return Math.max(1, x) ** 2;
}

/** 每一档都要有的那几样（结算页的明细，客户端 RunData 一直带着）。 */
const REQUIRED = ['flips', 'defused', 'lines', 'linePoints', 'patternPoints', 'comboBonusPoints', 'score', 'totalScore', 'moves', 'cleared', 'boardTiles'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * 对一局的账：`{ verdict: 'ok' | 'legacy' | 'implausible', why? }`。
 *
 *   · 'legacy'：缺字段（在途的旧客户端、规则版本却是现行的）。这一局进存档、不上榜——不是他的错，
 *     也不能拿它上榜（明细都没有，什么都对不了）。
 *   · 'implausible'：明细互相对不上，或者超出这副棋盘在规则下打得出的最大值。
 *
 * `why` 只是一个短词，给门和日志认是哪一条没过；不回给客户端。
 */
export function vetRun(board, data) {
  const b = BOARD_LIMITS[board];
  if (!b || !data || typeof data !== 'object') return { verdict: 'implausible', why: 'board' };
  const modeKey = String(data.modeKey || 'base');
  const flip = modeKey === 'flip';
  const puzzle = modeKey === 'puzzle';
  const slot = Boolean(data.slot);

  // ① 字段齐全、都是有限数。各档另外要用到的那几样也在这一步问。
  const need = [...REQUIRED, ...(flip ? ['elapsedSec', 'stepCoef'] : puzzle ? [] : ['stepCoef'])];
  if (!need.every((k) => isNum(data[k]))) return { verdict: 'legacy', why: 'fields' };
  if (puzzle && !(data.puzzle && isNum(data.puzzle.cleared) && isNum(data.puzzle.stars))) {
    return { verdict: 'legacy', why: 'fields' };
  }
  const { flips, defused, lines, linePoints, patternPoints, comboBonusPoints, score, totalScore, moves, cleared } = data;

  // ② 拼出分 = 图案分 + 削线分 + 连击多出来的那部分（gameController.ts 就是这样拆账的）。
  if (score !== patternPoints + linePoints + comboBonusPoints) return { verdict: 'implausible', why: 'split' };
  if (![linePoints, patternPoints, comboBonusPoints, score, totalScore].every((v) => v >= 0)) {
    return { verdict: 'implausible', why: 'negative' };
  }
  // ③ 计数都是非负整数；拆弹算在翻面里（拆除那一下按一次翻面计）；全盘就是这副棋盘。
  //    「翻面 ≤ N」只对不能翻回来的那几档成立：无限反转一枚可以来回翻很多次（每一拍那一组整组都翻）。
  if (![flips, defused, lines, moves, cleared, data.boardTiles].every(isCount)) return { verdict: 'implausible', why: 'counts' };
  if (defused > flips || (!flip && flips > b.N)) return { verdict: 'implausible', why: 'flips' };
  if (data.boardTiles !== b.N || cleared > b.N) return { verdict: 'implausible', why: 'tiles' };
  // ④ 削线：一条线的分是它枚数的平方。
  if (linePoints > lines * b.Lmax ** 2) return { verdict: 'implausible', why: 'lines' };

  if (flip) {
    // 无限反转：不乘步数系数、不消线、没有扣分；用时、步数、每一步的分都有天花板（FLIP_STEP 那一段）。
    if (!FLIP_STEP[board]) return { verdict: 'implausible', why: 'board' };
    if (data.stepCoef !== 1 || linePoints !== 0 || totalScore !== score) return { verdict: 'implausible', why: 'flipSplit' };
    if (data.elapsedSec < 0 || data.elapsedSec > FLIP_SECONDS + 5) return { verdict: 'implausible', why: 'flipTime' };
    if (moves > flipMoveCap(data.elapsedSec)) return { verdict: 'implausible', why: 'flipMoves' };
    if (score > moves * flipStepCap(board)) return { verdict: 'implausible', why: 'flipCap' };
    return { verdict: 'ok' };
  }
  if (puzzle) {
    // 步步为营：综合分 = 被消除 × 10 + 星星 × 5（puzzleScore.ts 的 puzzleComposite）。
    const { cleared: gone, stars } = data.puzzle;
    if (!isCount(gone) || !isCount(stars) || gone + stars > b.N) return { verdict: 'implausible', why: 'puzzleTally' };
    if (totalScore !== gone * PUZZLE_CLEARED_POINTS + stars * PUZZLE_STAR_POINTS) return { verdict: 'implausible', why: 'puzzleTotal' };
    return { verdict: 'ok' };
  }
  if (slot) {
    // 老虎机：不乘步数系数；图案分里比「每枚 2 分」多出来的是完成奖励，整局不超过 N × P。
    if (!SLOT_P[board]) return { verdict: 'implausible', why: 'board' };
    if (data.stepCoef !== 1 || comboBonusPoints !== 0 || patternPoints < POINTS_PER_FLIP * flips || totalScore !== score) {
      return { verdict: 'implausible', why: 'slotSplit' };
    }
    if (score > slotCeiling(board)) return { verdict: 'implausible', why: 'slotCap' };
    return { verdict: 'ok' };
  }
  // 乘步数系数的那几档：基础、计时、炸弹（三档）、更多布局、每日挑战。
  if (comboBonusPoints !== 0 || patternPoints !== POINTS_PER_FLIP * flips) return { verdict: 'implausible', why: 'pattern' };
  const coef = stepCoefOf(b.par, cleared, b.N, moves);
  if (Math.abs(coef - data.stepCoef) > 0.01) return { verdict: 'implausible', why: 'coef' };
  const penalty = data.hazardEnd === true && (modeKey === 'bomb' || modeKey === 'bombTimed') ? BOMB_HAZARD_PENALTY : 0;
  if (totalScore !== Math.max(0, Math.round(score * coef) - penalty)) return { verdict: 'implausible', why: 'total' };
  if (totalScore > stepCeiling(board)) return { verdict: 'implausible', why: 'cap' };
  return { verdict: 'ok' };
}
