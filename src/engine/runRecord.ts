import { countPhrase, STRINGS, type Lang, type I18nStrings } from '../i18n';
import { BOMB_HAZARD_REASON } from './bomb';
import { ALL_FLIPPED_REASON } from './kinetics';
import {
  PUZZLE_CLEARED_POINTS,
  PUZZLE_STAR_POINTS,
  PUZZLE_STEPS_OUT_REASON,
} from './puzzleScore';
import { POINTS_PER_FLIP } from './scoring';
import type { ShareCardInfo } from './shareCard';

/**
 * Everything a finished run needs to be *re-described* later, stored as raw
 * numbers and language-invariant keys rather than as the sentences the run
 * happened to end on.
 *
 * The archive used to keep the finished strings, which meant a record played
 * in Chinese stayed Chinese forever — reopening it in another language
 * showed the old wording. Keeping the data instead lets 记录 rebuild the
 * whole card in whatever language the player is reading right now.
 */
export interface RunData {
  /** Shape card id, so the name can be looked up per language. */
  shapeId: string;
  /** Fallback display name if the id is somehow unknown. */
  shapeFallback: string;
  /** Localized mode label at save time — '' for the base mode. */
  modeKey: ModeKey;
  totalScore: number;
  /** Raw pattern + streak + line points, before any multiplier. */
  score: number;
  ratePercent: number;
  bonusMult: number;
  elapsedSec: number;
  moves: number;
  best: number;
  /** Language-invariant end-reason key (see REASON_LABEL_KEY). */
  reason: string;
  neverFlipped: number;
  unflippedScale: number;
  timeMult: number;
  patternPoints: number;
  comboBonusPoints: number;
  linePoints: number;
  extraPenalty: number;
  extraPenaltyReason: string;
  hazardEnd: boolean;
  /** 在小屋里打的。老档没有这一项，读出来是 undefined，当 false 用。 */
  room?: boolean;
  /**
   * 老虎机那一局：这一局认的得分图案是转出来的，不是这个玩法自己那几个。
   * modeKey 说不出这件事（老虎机局的 modeKey 还是 'base'），而排行榜要按它
   * 单独排一张榜，所以单记一个标记。老档没有，当 false 用。
   */
  slot?: boolean;
  /**
   * 转出来的那个目标的编号（`engine/targets.ts` 的 `TargetPattern.id`，《侵蚀阶
   * 梯》v1.2 PR-8）。分享卡和记录行照它把那张小图画出来。
   *
   * 存**编号**不存画好的图形：图案表以后改了，旧档翻开画的是现在这张表里的同一个
   * 编号，而不是当年那串坐标——和这个文件顶上那条「存数字不存句子」是同一个道理。
   * 老档（一局两个图案那阵子的）没有这一项，读出来是 undefined，卡上就不画图。
   */
  targetId?: string;
  /**
   * 这一局的炸弹按第几版规则打的（见 bomb.ts 的 BOMB_RULES_VERSION）。老档
   * 没有这一项，读出来是 undefined，就是第一版。存档键和排行榜都按它分开——
   * 六枚炸弹的局和一枚炸弹的局不能放一起比。非炸弹局不写这一项。
   */
  bombRules?: number;
  /**
   * 这一局的无限反转按第几版规则打的（见 scoring.ts 的 FLIP_RULES_VERSION）。
   * 老档没有这一项，读出来是 undefined，就是第一版（连击不封顶）。存档键和排行榜
   * 都按它分开——能不能打出上亿分，封顶前后不是一把尺子量的。非反转局不写这一项。
   */
  flipRules?: number;
  /**
   * 这一局按第几版**计分规则**打的（见 scoring.ts 的 `SCORING_RULES_VERSION`）。
   *
   * 上面那两个各管一个玩法，这一个管**全站**：《侵蚀阶梯》v1.2 把得分图案、翻面
   * 分、整线消除、综合分全换了一套，旧局和新局不是一把尺子量的。服务端照它收不收
   * 这一局（`api/scores.js` 只认现行那一版）；老档没有这一项，读出来是 undefined，
   * 那就是《侵蚀阶梯》之前的局。
   */
  rules?: string;
  /**
   * 《侵蚀阶梯》v1.2 §5 的结算页要的那几个数。老档没有，读出来是 undefined——
   * 记录页翻开旧局时走的还是老那几行（见 runBreakdown）。
   */
  /** 这一局一共翻了几枚，**含拆掉的炸弹**。每枚 2 分。 */
  flips?: number;
  /** 上面那个数里，拆炸弹占几枚。 */
  defused?: number;
  /** 削掉了几条线。 */
  lines?: number;
  /** 这副棋盘的基准步数（engine/erosion.ts 的表）。 */
  par?: number;
  /** 步数系数 = max(1, (par × 已清 ÷ 全盘) ÷ 步数)²。不乘那几档恒 1。 */
  stepCoef?: number;
  /** 清掉了几枚。 */
  cleared?: number;
  /** 全盘一共几枚。 */
  boardTiles?: number;
  /** 清盘了（一枚不剩）。 */
  swept?: boolean;
  /** 这一局到过 1 枚图案（「解锁 1 枚」徽章，§2）。 */
  unlockedOne?: boolean;
  /**
   * 《真正解密 · 步步为营》这一局的账（见 engine/puzzleScore.ts）。老档没有这
   * 一项，读出来是 undefined，照旧走老分支。
   *
   * 存**数字**不存句子：结算页、战绩图、记录页都从这一份重新讲一遍，换种语言
   * 打开旧档要能重新描述，而不是复述它当时恰好用的那些词（见这个文件顶上那段）。
   */
  puzzle?: {
    /** 被消除的枚数（每副棋盘自己数，见 GameControllerHooks.puzzleTally）。 */
    cleared: number;
    /** 终局还在盘上、已经翻成星星的枚数。 */
    stars: number;
    /** 一共走了几步。 */
    spent: number;
    /** 其中得分的有几步。 */
    scoredMoves: number;
    /** 因为「上一步也得分」多退回来的步数合计。 */
    streakRefunds: number;
    /** 因为「这一步消了边」多退回来的步数合计。 */
    edgeRefunds: number;
    /** 结束时手里还剩几步（多半是 0，「都消完了」那条路上不是）。 */
    left: number;
    /** 手里最多攒到过几步。 */
    peak: number;
  };
  /** Epoch millis the run was settled. */
  at: number;
}

/** Which challenge wrapper a run was played under. */
export type ModeKey = 'base' | 'timed' | 'bomb' | 'bombTimed' | 'flip' | 'puzzle';

const MODE_LABEL_KEY: Record<ModeKey, keyof I18nStrings | null> = {
  base: null,
  timed: 'sectionTimed',
  bomb: 'bombBasicTitle',
  bombTimed: 'bombTimedTitle',
  flip: 'flipModeTitle',
  puzzle: 'puzzleModeTitle',
};

export function modeLabel(key: ModeKey, lang: Lang): string {
  const k = MODE_LABEL_KEY[key];
  return k ? (STRINGS[lang][k] as string) : '';
}

/** The player's own "结束" button. */
export const MANUAL_END_REASON = '手动结束';

// Every reason/penalty label ever passed into endGame — from this module's
// own literals or, for the bomb hazard, from every bomb-capable shape via
// the shared BOMB_HAZARD_REASON constant — is authored in Chinese as a
// stable lookup key, never shown to a player directly. These two functions
// are the only place they become words.
const REASON_LABEL_KEY: Partial<Record<string, keyof I18nStrings>> = {
  时间到: 'timeUpReason',
  [ALL_FLIPPED_REASON]: 'allFlippedReason',
  无法继续匹配: 'noMoreMatchesReason',
  [MANUAL_END_REASON]: 'manualEndReason',
  [BOMB_HAZARD_REASON]: 'bombHazardReason',
  [PUZZLE_STEPS_OUT_REASON]: 'stepsOutReason',
};
const PENALTY_LABEL_KEY: Partial<Record<string, keyof I18nStrings>> = {
  炸弹惩罚: 'bombPenaltyLabel',
};

export function displayReason(reason: string, lang: Lang): string {
  const key = REASON_LABEL_KEY[reason];
  return key ? (STRINGS[lang][key] as string) : reason;
}
export function displayPenaltyLabel(label: string, lang: Lang): string {
  const key = PENALTY_LABEL_KEY[label];
  return key ? (STRINGS[lang][key] as string) : label;
}

export function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** "2026-08-29 14:07" — the wall-clock moment the run was settled. */
export function formatRunTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 这一局是不是按《侵蚀阶梯》那一套结算的。
 *
 * 认的是 `flips`——那几个字段是 v1.2 一起加上的，老档一个都没有。老档翻开时走老
 * 那几行（图案分 / 连击加成 / 用时系数……），照它当时那套规则重讲一遍；那正是
 * RunData 存数字不存句子的理由。
 */
const isErosionRun = (d: RunData): boolean => d.flips !== undefined;

/** The one-line summary under the score, in the reader's language. */
export function runDetailLine(d: RunData, lang: Lang): string {
  const s = STRINGS[lang];
  return (
    displayReason(d.reason, lang) +
    ' · ' + countPhrase(s.stepsPhrase, d.moves, lang) +
    // 用时这一句：《侵蚀阶梯》之后它**不计分**（§5），所以写明白，免得玩家以为
    // 快慢还算数。步步为营连钟都没有，整句不印。
    (d.puzzle
      ? ''
      : ' · ' +
        (isErosionRun(d)
          ? s.timeNotScoredLabel.replace('{t}', formatClock(d.elapsedSec))
          : s.timeLabel + ' ' + formatClock(d.elapsedSec))) +
    ' · ' + s.bestPhrase.replace('{n}', String(d.best))
  );
}

/**
 * 明细里哪两行是**主数**（拼出分、综合分）——结算页给它们加一点字重。
 *
 * 按文案认，不按行号认：行数随这一局有没有削线、有没有惩罚而变，写死第几行迟早
 * 会指到别的行上去。
 */
export function isSumRow(label: string, lang: Lang): boolean {
  const s = STRINGS[lang];
  return label === s.builtScoreLabel || label === s.compositeLabel;
}

/**
 * 这一局拿到的徽章（《侵蚀阶梯》v1.2 §5 的排法：清盘、解锁 1 枚）。
 *
 * 没有就是空数组——结算页那一行整条不摆，而不是摆一行空的。
 */
export function runBadges(d: RunData, lang: Lang): string[] {
  const s = STRINGS[lang];
  const out: string[] = [];
  if (d.swept) out.push(s.badgeSwept);
  if (d.unlockedOne) out.push(s.badgeUnlockedOne);
  return out;
}

/** The score breakdown rows, in the reader's language. */
export function runBreakdown(d: RunData, lang: Lang): [label: string, value: string][] {
  const s = STRINGS[lang];
  /**
   * 步步为营另走四行：这一局的分数不是一路攒的，摆「图案分 / 连击加成 / 整线分」
   * 是在讲一件没发生的事（那三项在这一局里根本没参与算分，倍率恒 1）。
   *
   * 那三项里有两项在这一局是**坏的**，所以这儿干脆不摆：用时系数（没有钟）、
   * 0.95^未翻面（步数耗尽是常态，盘上必然剩一堆没碰过的）。摆一行「×1.00」
   * 等于告诉玩家有这回事。
   *
   * 每枚值多少分从常数里取、不写死在文案里：10 和 5 是玩家定的**暂定值**，
   * 改常数的时候这一行要跟着改口，而不是变成一句假话。
   */
  if (d.puzzle) {
    const p = d.puzzle;
    return [
      [s.puzzleClearedLabel.replace('{n}', String(PUZZLE_CLEARED_POINTS)), String(p.cleared * PUZZLE_CLEARED_POINTS)],
      [s.puzzleStarsLabel.replace('{n}', String(PUZZLE_STAR_POINTS)), '+' + p.stars * PUZZLE_STAR_POINTS],
      // 《有效得分率》那一行撤了（玩家 2026-10）：这一档的综合得分不再乘它，摆一行
      // 不起作用的乘数，和「摆一行 ×1.00」是同一种假话。
      [
        s.puzzleStepsLabel.replace('{n}', String(p.spent)).replace('{k}', String(p.scoredMoves)),
        s.puzzleRefundsLabel
          .replace('{m}', String(p.streakRefunds))
          .replace('{e}', String(p.edgeRefunds))
          .replace('{l}', String(p.left))
          .replace('{p}', String(p.peak)),
      ],
    ];
  }
  /**
   * 《侵蚀阶梯》v1.2 §5 的固定行序：
   *   翻面 n 枚 ×2（含拆除 k 枚） → 削线 m 条（星星数²） → **拼出分**
   *   → 步数系数（p 步 · 基准 par · ×C.CC） → **综合分**
   *
   * 摆的是「这分是怎么来的」，每一行都能在盘面上对上号。退役的那几行一行不留：
   * 连击加成、有效得分率、用时系数、0.95^未翻面——它们在这一版里恒 1 或者不存在，
   * 摆一行「×1.00」等于告诉玩家有这回事。
   */
  if (isErosionRun(d)) {
    const flips = d.flips ?? 0;
    const defused = d.defused ?? 0;
    const lines = d.lines ?? 0;
    const flipLabel =
      s.flipRowLabel.replace('{n}', String(flips)) +
      (defused > 0 ? ' ' + s.flipRowDefused.replace('{k}', String(defused)) : '');
    const out: [string, string][] = [[flipLabel, String(flips * POINTS_PER_FLIP)]];
    if (lines > 0) out.push([s.lineRowLabel.replace('{m}', String(lines)), '+' + Math.round(d.linePoints)]);
    out.push([s.builtScoreLabel, String(d.score)]);
    // 步数系数那一行只在真的乘了它的那几档摆。不乘的那三档（老虎机、步步为营、
    // 无限反转）结算时干脆不写 par，所以这儿按「par 在不在」判——摆一行「×1.00」
    // 又是在讲一件没发生的事。
    if (d.par !== undefined) {
      out.push([
        `${s.stepCoefLabel}（${s.stepCoefDetail.replace('{p}', String(d.moves)).replace('{par}', String(d.par))}）`,
        '×' + (d.stepCoef ?? 1).toFixed(2),
      ]);
    }
    if (d.extraPenalty > 0) {
      out.push([displayPenaltyLabel(d.extraPenaltyReason, lang), '−' + d.extraPenalty]);
    }
    out.push([s.compositeLabel, String(d.totalScore)]);
    return out;
  }

  const rows: [string, string][] = [[s.patternPointsLabel, String(Math.round(d.patternPoints))]];
  if (d.comboBonusPoints > 0) rows.push([s.comboBonusLabel, '+' + Math.round(d.comboBonusPoints)]);
  if (d.linePoints > 0) rows.push([s.linePointsLabel, '+' + Math.round(d.linePoints)]);
  rows.push([s.scoreLabel, String(d.score)]);
  rows.push([`${s.perfBonusLabel} (${d.ratePercent}%)`, '×' + d.bonusMult.toFixed(2)]);
  // 无限反转没有用时系数，这一行不摆——摆一行「×1.00」等于告诉人有这回事。
  if (d.modeKey !== 'flip') rows.push([s.timeMultLabel, '×' + d.timeMult.toFixed(2)]);
  if (d.neverFlipped > 0) {
    rows.push([`${s.neverFlippedLabel} × ${d.neverFlipped}`, Math.round(d.unflippedScale * 100) + '%']);
  }
  if (d.extraPenalty > 0) {
    rows.push([displayPenaltyLabel(d.extraPenaltyReason, lang), '−' + d.extraPenalty]);
  }
  return rows;
}

/** Rebuilds a run's whole share card description in the current language. */
export function buildShareInfo(d: RunData, shapeDisplayName: string, lang: Lang): ShareCardInfo {
  return {
    shapeName: shapeDisplayName,
    lang,
    totalScore: d.totalScore,
    scoreRows: runBreakdown(d, lang),
    detail: runDetailLine(d, lang),
    hazardEnd: d.hazardEnd,
    // 炸弹局的标志跟着这一局的模式走，不跟着结局走：安然打完的炸弹局也是炸弹
    // 局，翻回记录里的那张图上照样挂着它。
    bomb: d.modeKey === 'bomb' || d.modeKey === 'bombTimed',
    // 老虎机那一局：这一局在拼哪个图案。modeKey 是 'base'，玩法名那一行说不出
    // 来，所以卡上把它画出来（见 shareCard.ts 的 drawTargetMark）。
    targetId: d.targetId,
  };
}
