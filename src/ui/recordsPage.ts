import { loadBest } from '../engine/persistence';
import { renderShareCard } from '../engine/shareCard';
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

/** The number of ruled lines each panel shows when it has nothing to put on
 *  them — the reference sheet draws five, and an empty panel keeps them so it
 *  reads as "waiting for entries" rather than as a blank block. */
const PLACEHOLDER_ROWS = 5;

/**
 * 记录与排名, laid out as the two panels the design sheet specifies: the
 * amber one on the left/top holds this device's records, the periwinkle one
 * on the right/bottom is reserved for rankings.
 *
 * Rankings have no data source yet — there is no account or server — so that
 * panel keeps its full half of the screen and shows its ruled lines empty,
 * rather than being hidden until the feature lands.
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
      card: src.card,
      suffix: src.suffix,
      name: shapeName(lang, src.card.id, src.card.name),
      mode: src.mode,
      best: loadBest(src.card.bestKey + src.suffix),
    }))
    .filter((r) => r.best > 0)
    .sort((a, b) => b.best - a.best);

  container.innerHTML = `
    <div class="app records-page">
      <header class="home-head">
        <h1 class="home-title">Slides</h1>
        <p class="home-sub">${s.homeTagline}</p>
      </header>
      <div class="records-panels">
        <section class="records-panel records-panel--records" id="recordsPanel" aria-label="${s.navRecords}"></section>
        <section class="records-panel records-panel--ranks" aria-label="${s.rankingsTitle}">
          ${Array.from({ length: PLACEHOLDER_ROWS }, () => '<div class="records-rule"></div>').join('')}
          <p class="records-locked">${s.rankingsTitle} · ${s.comingSoon}</p>
        </section>
      </div>
      <div class="controls"><button class="icon-btn" id="backBtn">${s.back}</button></div>
    </div>
  `;

  const panel = container.querySelector<HTMLElement>('#recordsPanel')!;
  if (!rows.length) {
    panel.innerHTML =
      Array.from({ length: PLACEHOLDER_ROWS }, () => '<div class="records-rule"></div>').join('') +
      `<p class="records-locked">${s.noRecordsYet}</p>`;
  } else {
    for (const r of rows) {
      const row = document.createElement('button');
      row.className = 'records-row';
      row.innerHTML =
        `<span class="records-row-name">${r.name}<span class="records-row-mode">${r.mode}</span></span>` +
        `<span class="records-row-score">${r.best}</span>`;
      row.addEventListener('click', () => openRecordDetail(r.name + r.mode, r.best, lang));
      panel.appendChild(row);
    }
    // Keep the ruled look when there are only a handful of entries.
    for (let i = rows.length; i < PLACEHOLDER_ROWS; i++) {
      const rule = document.createElement('div');
      rule.className = 'records-rule';
      panel.appendChild(rule);
    }
  }

  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}

/**
 * Tapping a record re-opens the same result modal the run itself ended on —
 * same composite-score layout, same 分享战绩 button and share-card popup.
 *
 * Only the score survives in storage (runs aren't recorded move by move yet,
 * see the records/rankings task), so the breakdown rows a live result shows
 * are left out and the share card is drawn without its board thumbnails
 * rather than with invented ones.
 */
function openRecordDetail(title: string, score: number, lang: Lang): void {
  const s = STRINGS[lang];
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${title}</h2>
      <div class="end-score-label">${s.compositeScoreLabel}</div>
      <div class="big-score">${score}</div>
      <p class="hint">${s.bestPhrase.replace('{n}', String(score))}</p>
      <div class="btn-row">
        <button class="secondary" id="recShareBtn">${s.shareBtn}</button>
        <button class="primary" id="recCloseBtn">${s.closeBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector<HTMLButtonElement>('#recCloseBtn')!.addEventListener('click', close);
  overlay.querySelector<HTMLButtonElement>('#recShareBtn')!.addEventListener('click', () => {
    const dataUrl = renderShareCard(
      {
        shapeName: title,
        lang,
        totalScore: score,
        scoreRows: [[s.scoreLabel, String(score)]],
        detail: s.bestPhrase.replace('{n}', String(score)),
      },
      null,
      null,
    );
    const share = document.createElement('div');
    share.className = 'overlay show';
    share.innerHTML = `
      <div class="modal share-modal">
        <h2>${s.shareCardTitle}</h2>
        <img src="${dataUrl}" alt="${s.shareImgAlt}" />
        <p class="hint">${s.shareHint}</p>
        <div class="btn-row"><button class="primary" id="recShareClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(share);
    const closeShare = () => share.remove();
    share.querySelector<HTMLButtonElement>('#recShareClose')!.addEventListener('click', closeShare);
    share.addEventListener('click', (e) => {
      if (e.target === share) closeShare();
    });
  });
}
