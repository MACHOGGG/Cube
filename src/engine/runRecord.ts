import { STRINGS, type Lang, type I18nStrings } from '../i18n';
import { BOMB_HAZARD_REASON } from './bomb';
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
  /** Epoch millis the run was settled. */
  at: number;
}

/** Which challenge wrapper a run was played under. */
export type ModeKey = 'base' | 'timed' | 'bomb' | 'bombTimed' | 'flip';

const MODE_LABEL_KEY: Record<ModeKey, keyof I18nStrings | null> = {
  base: null,
  timed: 'sectionTimed',
  bomb: 'bombBasicTitle',
  bombTimed: 'bombTimedTitle',
  flip: 'flipModeTitle',
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
    ' · ' + s.stepsPhrase.replace('{n}', String(d.moves)) +
    ' · ' + s.timeLabel + ' ' + formatClock(d.elapsedSec) +
    ' · ' + s.bestPhrase.replace('{n}', String(d.best))
  );
}

/** The score breakdown rows, in the reader's language. */
export function runBreakdown(d: RunData, lang: Lang): [label: string, value: string][] {
  const s = STRINGS[lang];
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
