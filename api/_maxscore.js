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
 *   par  基准步数（engine/erosion.ts 的表；ero2 起 ×1.2，10-31 方案推14 Z-B02）。
 *   proPar  Pro 局的基准步数 = ⌈par × 1.5⌉（engine/erosion.ts 的 proParOf，Z-B13）。
 */
export const BOARD_LIMITS = Object.freeze({
  square: Object.freeze({ N: 36, d: 2, Lmax: 6, par: 65, proPar: 98 }),
  circle: Object.freeze({ N: 28, d: 3, Lmax: 7, par: 34, proPar: 51 }),
  squareDiamond: Object.freeze({ N: 36, d: 3, Lmax: 6, par: 65, proPar: 98 }),
  circleHex: Object.freeze({ N: 36, d: 3, Lmax: 6, par: 65, proPar: 98 }),
  circleSeven: Object.freeze({ N: 49, d: 3, Lmax: 7, par: 104, proPar: 156 }),
  triangleBig: Object.freeze({ N: 54, d: 3, Lmax: 11, par: 98, proPar: 147 }),
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

/** 无限反转一局几秒（src/engine/modeClock.ts 的 FLIP_SECONDS）。报上来的用时多给 5 秒的余量。 */
export const FLIP_SECONDS = 100;
/** 连击倍率的封顶：1.5⁵（src/engine/scoring.ts 的 FLIP_STREAK_BASE ** FLIP_STREAK_CAP；ero2 起 5 次，原先 10 次）。 */
export const FLIP_MULT_CAP = 1.5 ** 5;
/**
 * 无限反转的「反转系数」（V15，10-31 方案推14 Z-B06）：综合分 = round(拼出分 × 它)。和 src/engine/scoring.ts 的 FLIP_COEF
 * 一字不差，check-scores-guard ⑩ 对上。**vetRun 用服务器自己这一份，不信客户端报的 flipCoef。**
 */
export const FLIP_COEF = Object.freeze({ square: 6, circle: 2.5 });
/** 每翻一枚几分（src/engine/scoring.ts 的 POINTS_PER_FLIP）。 */
export const POINTS_PER_FLIP = 2;
/** 炸弹相连收场扣几分（src/engine/bomb.ts 的 BOMB_HAZARD_PENALTY）。 */
export const BOMB_HAZARD_PENALTY = 100;
/** 步步为营：被消除一枚几分、终局一颗星几分（src/engine/puzzleScore.ts）。 */
export const PUZZLE_CLEARED_POINTS = 10;
export const PUZZLE_STAR_POINTS = 5;
/**
 * 步步为营第 3 版的起手步数（src/engine/puzzleScore.ts 的 PUZZLE_START_STEPS，10-15 补充 S9）。第 3 版步数只降不升，
 * 所以一局结束时「剩几步」不可能比起手还多——vetRun 拿它核。手抄的，check-scores-guard 对上源码。
 */
export const PUZZLE_START = Object.freeze({ square: 22, circle: 15 });

/** 削线分的上界：每格在每个线族里最多属于一条线，一条线的分是它枚数的平方 ≤ 枚数 × Lmax。 */
const lineCeiling = (b) => b.d * b.N * b.Lmax;

/**
 * 乘步数系数那几档（基础、计时、炸弹、更多布局、每日挑战）的综合分上界 T = (2N + d·N·Lmax) · par²。Pro 局用 proPar
 * （10-31 方案推14 Z-B13）。剩余色块九折只会让分变小，上界不改。
 */
export function stepCeiling(board, pro = false) {
  const b = BOARD_LIMITS[board];
  return b ? (POINTS_PER_FLIP * b.N + lineCeiling(b)) * (pro ? b.proPar : b.par) ** 2 : 0;
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
/** 无限反转一局的绝对上界（重建时判旧 best 用）：用满一局的秒数、走满步数，再乘反转系数（榜上那个数是综合分）。 */
export const flipCeiling = (board) => flipMoveCap(FLIP_SECONDS + 5) * flipStepCap(board) * (FLIP_COEF[board] ?? 1);

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

/**
 * 剩余色块九折（站长 10-25，10-31 方案推14 Z-B08）——**和客户端 src/engine/stepCoef.ts 的 LEFTOVER_K / leftoverScale 一字
 * 不差**：循环连乘，不用 Math.pow（逐位相等才收）。
 */
export const LEFTOVER_K = 0.9;
export function leftoverScale(n) {
  let f = 1;
  for (let i = 0; i < n; i++) f *= LEFTOVER_K;
  return f;
}
/**
 * 打九折的两种结局理由，手抄自客户端：判死 gameController.ts 的 STUCK_REASON（「无法继续匹配」）、手动结束
 * runRecord.ts 的 MANUAL_END_REASON（「手动结束」）。时间到、炸弹相连不扣。
 */
const LEFTOVER_REASONS = ['无法继续匹配', '手动结束'];

/**
 * 每一档都要有的那几样（结算页的明细，客户端 RunData 一直带着）。neverFlipped 推14 起也要（九折按它算；客户端一直在发，
 * 旧客户端缺它就落 legacy，不上榜，和现在一样）。
 */
const REQUIRED = ['flips', 'defused', 'lines', 'linePoints', 'patternPoints', 'comboBonusPoints', 'score', 'totalScore', 'moves', 'cleared', 'boardTiles', 'neverFlipped'];
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
  // ⑤ 剩下没翻的色块（推14 Z-B08）：非负整数；不是反转局时，翻过的加没翻的不超过全盘（反转局一枚能来回翻很多次）。
  if (!isCount(data.neverFlipped) || (!flip && data.neverFlipped + flips > b.N)) return { verdict: 'implausible', why: 'leftover' };
  // 九折按服务器自己判的口径算，不信客户端报的 unflippedScale：只在判死、手动结束时扣；无限反转、步步为营不扣。
  const scale = !flip && !puzzle && LEFTOVER_REASONS.includes(data.reason) ? leftoverScale(data.neverFlipped) : 1;

  if (flip) {
    // 无限反转：不乘步数系数、不消线、没有扣分，结算乘反转系数（V15，推14 Z-B06——用服务器这一份 FLIP_COEF）；
    // 用时、步数、每一步的分都有天花板（FLIP_STEP 那一段，比的是拼出分）。
    if (!FLIP_STEP[board] || !FLIP_COEF[board]) return { verdict: 'implausible', why: 'board' };
    if (data.stepCoef !== 1 || linePoints !== 0 || totalScore !== Math.round(score * FLIP_COEF[board])) {
      return { verdict: 'implausible', why: 'flipSplit' };
    }
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
    // 第 3 版步数只降不升：剩的比起手还多只可能是手搓的（剩几步写进榜上那个拼起来的数，同分剩得多的排前面）。
    // 第 1、2 版有退步，剩多少都可能，不核。
    if (Number(data.puzzleRules) >= 3) {
      const left = data.puzzle.left;
      if (!isCount(left) || left > (PUZZLE_START[board] ?? 0)) return { verdict: 'implausible', why: 'puzzleLeft' };
      /*
       * 三个计数要对得上账（10-31 方案推09 Z-H05，verify-F F1、D11 甲）：原先只核 left ≤ 起手步数，手改一个 left 就过。
       * 第 3 版没得分的一步扣 1（puzzleScore.ts 的 PUZZLE_STEP_COST）、得分的不扣，left 用 max(0, …) 夹住——所以
       *   · left === max(0, 起手 − (spent − scoredMoves))（**一定带夹子**：步数刚好用完的正常局 spent − scoredMoves 会
       *     超过起手，不夹就被误判）；
       *   · scoredMoves ≤ spent。
       * **不核 spent === moves**（站长 10-30 定）：连锁动画还没演完就暂停（或切后台自动暂停）、在暂停面板按《结束游戏》，
       * moves++ 在 resolveMove 开头早已记上（gameController.ts 的 resolveMove），endGame 撤掉下一拍、在途那一步的 finish
       * 不再跑（finish 开头那几处提前返回），bank.spend 漏记，于是 moves = spent + 1——这是代码自己认的正常操作，模拟的
       * 11,200 局里这样的 547 局全差 1；加这一条，这些正常局的成绩会被静默丢掉。上面两条那 547 局照样成立（在途那一步
       * 两边都没记）。缺 spent 的在途旧局不拦（和 legacy 一个口径）。不设任何分数硬顶（Q41、D11 甲）。
       */
      const { spent, scoredMoves } = data.puzzle;
      if (isCount(spent) && isCount(scoredMoves)) {
        const start = PUZZLE_START[board] ?? 0;
        if (scoredMoves > spent || left !== Math.max(0, start - (spent - scoredMoves))) {
          return { verdict: 'implausible', why: 'puzzleSteps' };
        }
      }
    }
    return { verdict: 'ok' };
  }
  if (slot) {
    // 老虎机：不乘步数系数；图案分里比「每枚 2 分」多出来的是完成奖励，整局不超过 N × P。
    if (!SLOT_P[board]) return { verdict: 'implausible', why: 'board' };
    // 老虎机也打九折（判死、手动结束；推14 Z-B08）。
    if (data.stepCoef !== 1 || comboBonusPoints !== 0 || patternPoints < POINTS_PER_FLIP * flips || totalScore !== Math.round(score * scale)) {
      return { verdict: 'implausible', why: 'slotSplit' };
    }
    if (score > slotCeiling(board)) return { verdict: 'implausible', why: 'slotCap' };
    return { verdict: 'ok' };
  }
  // 乘步数系数的那几档：基础、计时、炸弹（三档）、更多布局、每日挑战。
  if (comboBonusPoints !== 0 || patternPoints !== POINTS_PER_FLIP * flips) return { verdict: 'implausible', why: 'pattern' };
  // Pro 局的基准步数是 proPar（推14 Z-B13）；谎报 Pro 只会进 Pro 榜（Z-B14），按 Pro par 算出来的系数对不上普通 par。
  const pro = data.pro === true;
  const coef = stepCoefOf(pro ? b.proPar : b.par, cleared, b.N, moves);
  if (Math.abs(coef - data.stepCoef) > 0.01) return { verdict: 'implausible', why: 'coef' };
  const penalty = data.hazardEnd === true && (modeKey === 'bomb' || modeKey === 'bombTimed') ? BOMB_HAZARD_PENALTY : 0;
  if (totalScore !== Math.max(0, Math.round(score * scale * coef) - penalty)) return { verdict: 'implausible', why: 'total' };
  if (totalScore > stepCeiling(board, pro)) return { verdict: 'implausible', why: 'cap' };
  return { verdict: 'ok' };
}
