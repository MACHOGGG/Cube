import { loadBest } from '../engine/persistence';
import { STRINGS, type Lang } from '../i18n';
import { shapeName } from './shapeLabels';
import type { ShapeCardMeta } from '../shapes/types';

/** One line of the records list: which game, which mode, and the best score
 *  this device has stored for that exact combination. */
export interface RecordSource {
  card: ShapeCardMeta;
  /** Suffix on the persisted best-score key — '' base, '_timed', '_bomb'. */
  suffix: string;
  mode: string;
}

/**
 * 记录与排名 — for now the "rankings" half has nowhere to read from (there is
 * no account or server yet), so this shows what the game genuinely does
 * already keep: the best composite score stored on this device for every
 * game and mode, ranked highest first. Modes never played show as blank
 * rather than as a zero, so an untouched mode doesn't read as a bad run.
 */
export function renderRecordsPage(
  container: HTMLElement,
  sources: RecordSource[],
  onBack: () => void,
  lang: Lang,
): void {
  const s = STRINGS[lang];
  const rows = sources
    .map((src) => ({
      name: shapeName(lang, src.card.id, src.card.name),
      mode: src.mode,
      best: loadBest(src.card.bestKey + src.suffix),
    }))
    .sort((a, b) => b.best - a.best);

  const played = rows.filter((r) => r.best > 0);
  const unplayed = rows.filter((r) => r.best <= 0);

  const rowHtml = (r: { name: string; mode: string; best: number }, rank: number | null) => `
    <div class="record-row${rank === 0 ? ' record-row--top' : ''}">
      <span class="record-rank">${rank === null ? '·' : rank + 1}</span>
      <span class="record-name">${r.name}<span class="record-mode">${r.mode}</span></span>
      <span class="record-score">${r.best > 0 ? r.best : s.noRecordsYet}</span>
    </div>`;

  container.innerHTML = `
    <div class="app">
      <h1>${s.navRecords}</h1>
      <div class="record-list">
        ${played.map((r, i) => rowHtml(r, i)).join('')}
        ${unplayed.map((r) => rowHtml(r, null)).join('')}
      </div>
      <p class="assumptions">${s.rankingsTitle} · ${s.comingSoon}</p>
      <div class="controls">
        <button class="icon-btn" id="backBtn">${s.back}</button>
      </div>
    </div>
  `;
  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}
