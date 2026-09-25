import { countPhrase, STRINGS, type Lang, type I18nStrings } from '../i18n';
import { BOMB_HAZARD_REASON } from './bomb';
import {
  PUZZLE_CLEARED_POINTS,
  PUZZLE_STAR_POINTS,
  PUZZLE_STEPS_OUT_REASON,
} from './puzzleScore';
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
   * 老虎机那一局：这一局认的两个得分图案是转出来的，不是这个玩法自己那几个。
   * modeKey 说不出这件事（老虎机局的 modeKey 还是 'base'），而排行榜要按它
   * 单独排一张榜，所以单记一个标记。老档没有，当 false 用。
   */
  slot?: boolean;
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
  全部方块已翻成点面: 'allFlippedReason',
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

/** The one-line summary under the score, in the reader's language. */
export function runDetailLine(d: RunData, lang: Lang): string {
  const s = STRINGS[lang];
  return (
    displayReason(d.reason, lang) +
    ' · ' + countPhrase(s.stepsPhrase, d.moves, lang) +
    // 步步为营这一局不比时间（没有钟，也没有用时系数），印出来只会让玩家以为
    // 快慢算数。别的玩法照旧。
    (d.puzzle ? '' : ' · ' + s.timeLabel + ' ' + formatClock(d.elapsedSec)) +
    ' · ' + s.bestPhrase.replace('{n}', String(d.best))
  );
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
      [`${s.perfBonusLabel} (${d.ratePercent}%)`, '×' + d.bonusMult.toFixed(2)],
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
  };
}
