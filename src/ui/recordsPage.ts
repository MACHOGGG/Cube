import { loadBest, findRun, loadTotalScore } from '../engine/persistence';
import { renderShareCard } from '../engine/shareCard';
import { STRINGS, type Lang } from '../i18n';
import { shapeName } from './shapeLabels';
import { openCenterPicker } from './centerPicker';
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
 * 累计得分 has no upper bound, but its card is a fixed slot on the page — so
 * the number is shortened (万/亿 in Chinese, K/M/B elsewhere) once it grows
 * past what fits comfortably, and the blown-up view then shows every digit.
 */
function compactScore(n: number, lang: Lang): string {
  const zh = lang === 'zhHans' || lang === 'zhHant';
  const cut = (v: number, unit: string) => {
    const t = (n / v).toFixed(n / v >= 100 ? 0 : 1);
    return (t.endsWith('.0') ? t.slice(0, -2) : t) + unit;
  };
  if (zh) {
    if (n >= 1e8) return cut(1e8, '亿');
    if (n >= 1e5) return cut(1e4, '万');
    return String(n);
  }
  if (n >= 1e9) return cut(1e9, 'B');
  if (n >= 1e6) return cut(1e6, 'M');
  if (n >= 1e5) return cut(1e3, 'K');
  return String(n);
}

/** The full number, grouped, for the blown-up view. */
function fullScore(n: number): string {
  return n.toLocaleString('en-US');
}

/** Shrinks the type as the number lengthens, so however long it runs it
 *  still lands inside one screen rather than overflowing or wrapping into a
 *  wall; a short number keeps the ordinary large size. */
function scoreFontSize(text: string, big: boolean): string {
  const n = text.length;
  const scale = big ? 1 : 0.72;
  const rem = n <= 7 ? 3.2 : n <= 10 ? 2.6 : n <= 13 ? 2.1 : n <= 17 ? 1.7 : 1.35;
  return (rem * scale).toFixed(2) + 'rem';
}

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
  const total = loadTotalScore();
  const rows = sources
    .map((src) => ({
      card: src.card,
      suffix: src.suffix,
      key: src.card.bestKey + src.suffix,
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
      <button class="total-card" id="totalCard">
        <span class="total-card-title">${s.totalScoreTitle}</span>
        <span class="total-card-value" id="totalValue">${compactScore(total, lang)}</span>
        <span class="total-card-sub">（${s.totalScoreSync}）</span>
      </button>
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
      row.addEventListener('click', () => openRecordDetail(r.name + r.mode, r.best, r.key, lang));
      panel.appendChild(row);
    }
    // Keep the ruled look when there are only a handful of entries.
    for (let i = rows.length; i < PLACEHOLDER_ROWS; i++) {
      const rule = document.createElement('div');
      rule.className = 'records-rule';
      panel.appendChild(rule);
    }
  }

  const valueEl = container.querySelector<HTMLElement>('#totalValue');
  if (valueEl) valueEl.style.fontSize = scoreFontSize(valueEl.textContent ?? '', false);

  // Tapping the card blows it up into the middle of a dimmed page — the same
  // flight the home page's bomb card takes — where every digit is shown in
  // full at whatever size keeps it on one screen.
  const totalCard = container.querySelector<HTMLButtonElement>('#totalCard');
  totalCard?.addEventListener('click', () => {
    const big = document.createElement('div');
    big.className = 'total-card total-card--big';
    const full = fullScore(total);
    big.innerHTML =
      `<span class="total-card-title">${s.totalScoreTitle}</span>` +
      `<span class="total-card-value" style="font-size:${scoreFontSize(full, true)}">${full}</span>` +
      `<span class="total-card-sub">${s.totalScoreSync}</span>`;
    openCenterPicker({ originEl: totalCard, title: s.totalScoreTitle, panel: big, panelClass: 'total-card--big' });
  });

  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}

/**
 * Tapping a record re-opens the same result modal the run itself ended on —
 * same composite-score layout, same 分享战绩 button and share-card popup.
 *
 * Every finished run archives its share card verbatim (see saveRun in
 * persistence.ts), so the popup shows the very photo that run produced —
 * board snapshot, breakdown rows, and the language it was played in. Only a
 * record set before archiving existed falls back to a card rebuilt from the
 * bare score, with an empty board space.
 */
function openRecordDetail(title: string, score: number, bestKey: string, lang: Lang): void {
  const s = STRINGS[lang];
  const run = findRun(bestKey, score);
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${title}</h2>
      <div class="end-score-label">${s.compositeScoreLabel}</div>
      <div class="big-score">${score}</div>
      <p class="hint"></p>
      <div class="btn-row">
        <button class="secondary" id="recShareBtn">${s.shareBtn}</button>
        <button class="primary" id="recCloseBtn">${s.closeBtn}</button>
      </div>
    </div>
  `;
  overlay.querySelector<HTMLElement>('.hint')!.textContent = run
    ? run.info.detail
    : s.bestPhrase.replace('{n}', String(score));
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector<HTMLButtonElement>('#recCloseBtn')!.addEventListener('click', close);
  overlay.querySelector<HTMLButtonElement>('#recShareBtn')!.addEventListener('click', () => {
    const dataUrl = run
      ? renderShareCard(run.info, run.end ?? null)
      : renderShareCard(
          {
            shapeName: title,
            lang,
            totalScore: score,
            scoreRows: [[s.scoreLabel, String(score)]],
            detail: s.bestPhrase.replace('{n}', String(score)),
          },
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
