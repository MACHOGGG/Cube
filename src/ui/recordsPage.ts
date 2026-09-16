import { loadAllRuns, totalScoreOf, type StoredRun } from '../engine/persistence';
import { pushLayer } from '../engine/backNav';
import { renderShareCard } from '../engine/shareCard';
import { buildShareInfo, formatRunTime, modeLabel } from '../engine/runRecord';
import { STRINGS, type Lang } from '../i18n';
import { shapeName } from './shapeLabels';
import { openCenterPicker } from './centerPicker';
import type { ShapeCardMeta } from '../shapes/types';
import { trackShare } from '../engine/analytics';
import { isGenius } from '../engine/subscription';
import { mountBoardThumb, mountBoardView } from './leaderboard';
import { CTL_BACK } from './ctlIcons';
// 累计得分没有上限，而它那张卡是页面上一个固定的格子——数字长到装不下就缩写，
// 点开的放大版再写全每一位。排行榜缩略牌用的是同一份（见 engine/compactScore）。
import { compactScore } from '../engine/compactScore';

/** One playable game+mode combination, so the page knows which archives to
 *  read and which glyph belongs to a stored run's shape id. */
export interface RecordSource {
  card: ShapeCardMeta;
  /** Suffix on the persisted best-score key — '' base, '_timed', '_bomb2'. */
  suffix: string;
  mode: string;
}

/** The number of ruled lines each panel shows when it has nothing to put on
 *  them — the reference sheet draws five, and an empty panel keeps them so it
 *  reads as "waiting for entries" rather than as a blank block. */
const PLACEHOLDER_ROWS = 5;

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
 * 记录与排名 — 累计得分 on top, then the two panels the design sheet
 * specifies: the amber one holds this device's records, the periwinkle one is
 * reserved for rankings.
 *
 * All three are the same kind of object: a card you can tap to fly it into
 * the middle of a dimmed page, where it is free to run as long as it needs.
 * Rankings have no data source yet — there is no account or server — so that
 * panel keeps its half of the screen and shows its ruled lines empty rather
 * than being hidden until the feature lands.
 */
export function renderRecordsPage(
  container: HTMLElement,
  sources: RecordSource[],
  onBack: () => void,
  lang: Lang,
  /** 锁着的排行榜上那颗《成为 Slides 天才》按下去以后去哪儿。 */
  onWantGenius: () => void = () => {},
  /** 登录过期那一屏上那颗《重新登录》按下去以后去哪儿——个人主页。 */
  onReLogin: () => void = () => {},
): void {
  const s = STRINGS[lang];
  // One archive per game+mode; the page reads them all so 记录 is a single
  // chronological list and 累计得分 is literally its sum.
  const runs = loadAllRuns(sources.map((src) => src.card.bestKey + src.suffix));
  const total = totalScoreOf(runs);
  const glyphOf = new Map(sources.map((src) => [src.card.id, src.card.glyph]));

  // 一句只对还没订阅的人有意义的话：成绩留在这台手机里，除非你是 Slides 天才。
  // 已经是天才的人，这句话没有任何东西可以告诉他——所以整句消失，只剩
  //《累计得分》和那个数。
  const syncNote = isGenius() ? '' : `<span class="total-card-sub">${s.totalScoreSync}</span>`;

  container.innerHTML = `
    <div class="app records-page">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${s.homeTagline}</p>
        </div>
      </header>
      <button class="total-card" id="totalCard">
        <span class="total-card-title">${s.totalScoreTitle}</span>
        <span class="total-card-value" id="totalValue">${compactScore(total, lang)}</span>
        ${syncNote}
      </button>
      <div class="records-panels">
        <button class="records-panel records-panel--records" id="recordsPanel" aria-label="${s.navRecords}"></button>
        <button class="records-panel records-panel--ranks" id="ranksPanel" aria-label="${s.rankingsTitle}"></button>
      </div>
      <div class="page-back-row"><button class="icon-btn page-back" id="backBtn" aria-label="${s.back}">${CTL_BACK}</button></div>
    </div>
  `;

  /** One record line: which shape, which mode, when it finished, what it
   *  scored. Tapping it goes straight to that run's share card. */
  function recordRow(run: StoredRun, compact: boolean): HTMLElement {
    const d = run.data;
    const name = shapeName(lang, d.shapeId, d.shapeFallback);
    const mode = modeLabel(d.modeKey, lang);
    const row = document.createElement('button');
    row.className = 'records-row';
    row.innerHTML =
      `<span class="records-row-glyph">${glyphOf.get(d.shapeId) ?? ''}</span>` +
      `<span class="records-row-name">${name}${mode ? `<span class="records-row-mode">${mode}</span>` : ''}` +
      `<span class="records-row-time">${formatRunTime(d.at)}</span></span>` +
      `<span class="records-row-score">${compact ? compactScore(d.totalScore, lang) : d.totalScore}</span>`;
    row.addEventListener('click', (e) => {
      // The panel itself is clickable (to blow it up); a row click is about
      // that one run, so it must not also trigger the panel.
      e.stopPropagation();
      openShareCard(run, lang);
    });
    return row;
  }

  /** Fills a container with record rows, padded out with ruled lines so a
   *  short list still reads as the design's ruled sheet. */
  function fillRecords(host: HTMLElement, limit: number | null) {
    // limit 不为 null 的那一次就是半幅的缩略牌：那儿的分数得缩写，否则一个十位
    // 数能把这半幅撑破（见 engine/compactScore 开头那段）。点开的整页不缩。
    const compact = limit !== null;
    host.innerHTML = '';
    const shown = limit === null ? runs : runs.slice(0, limit);
    if (!shown.length) {
      host.innerHTML =
        Array.from({ length: PLACEHOLDER_ROWS }, () => '<div class="records-rule"></div>').join('') +
        `<p class="records-locked">${s.noRecordsYet}</p>`;
      return;
    }
    for (const run of shown) host.appendChild(recordRow(run, compact));
    for (let i = shown.length; i < PLACEHOLDER_ROWS; i++) {
      const rule = document.createElement('div');
      rule.className = 'records-rule';
      host.appendChild(rule);
    }
  }

  const panel = container.querySelector<HTMLButtonElement>('#recordsPanel')!;
  fillRecords(panel, PLACEHOLDER_ROWS);
  panel.addEventListener('click', () => {
    // Blown up, the list keeps its type size and simply runs as long as it
    // needs to — scrolling inside the panel rather than shrinking to fit.
    const big = document.createElement('div');
    big.className = 'records-panel records-panel--records records-panel--big';
    fillRecords(big, null);
    openCenterPicker({ originEl: panel, title: s.navRecords, panel: big, panelClass: 'records-panel--big', back: s.back });
  });

  const ranks = container.querySelector<HTMLButtonElement>('#ranksPanel')!;
  // 缩略图上只有总榜的前几名（leaderboard 的 THUMB_ROWS）——那半块屏幕装不下
  // 六个母标签和它们旗下的子标签，而站在这儿的人想知道的也就「榜上头几个是
  // 谁」。点开才是完整的那几张榜。
  mountBoardThumb(ranks, lang);
  // 排行榜是活的：每次点开都重新去问，而不是把上一次的结果留在手上。
  ranks.addEventListener('click', () => {
    const big = document.createElement('div');
    big.className = 'records-panel records-panel--ranks records-panel--big';
    mountBoardView(big, { lang, onWantGenius, onReLogin });
    openCenterPicker({ originEl: ranks, title: s.rankingsTitle, panel: big, panelClass: 'records-panel--big', back: s.back });
  });

  const valueEl = container.querySelector<HTMLElement>('#totalValue');
  if (valueEl) valueEl.style.fontSize = scoreFontSize(valueEl.textContent ?? '', false);

  const totalCard = container.querySelector<HTMLButtonElement>('#totalCard');
  totalCard?.addEventListener('click', () => {
    const big = document.createElement('div');
    big.className = 'total-card total-card--big';
    const full = fullScore(total);
    big.innerHTML =
      `<span class="total-card-title">${s.totalScoreTitle}</span>` +
      `<span class="total-card-value" style="font-size:${scoreFontSize(full, true)}">${full}</span>` +
      syncNote;
    openCenterPicker({ originEl: totalCard, title: s.totalScoreTitle, panel: big, panelClass: 'total-card--big', back: s.back });
  });

  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}

/**
 * Tapping a record opens that run's share card directly — the photo is the
 * record, so there is no summary screen in between.
 *
 * The card is rebuilt from the run's stored numbers rather than replayed
 * from saved text, so it comes out in whatever language is being read now,
 * with the run's own start and end boards side by side.
 */
function openShareCard(run: StoredRun, lang: Lang): void {
  trackShare('records');
  const s = STRINGS[lang];
  const d = run.data;
  const info = buildShareInfo(d, shapeName(lang, d.shapeId, d.shapeFallback), lang);
  const dataUrl = renderShareCard(info, run.end ?? null, run.start ?? null);
  // One card at a time: tapping a second record replaces the one already up
  // rather than stacking another overlay behind it.
  for (const old of Array.from(document.querySelectorAll('.overlay--top'))) old.remove();
  const share = document.createElement('div');
  // --top puts it above the blown-up 记录 panel it was opened from; closing
  // it just removes this layer, so that panel is still there underneath.
  share.className = 'overlay overlay--top overlay--wide show';
  share.innerHTML = `
    <div class="modal share-modal">
      <h2>${s.shareCardTitle}</h2>
      <img src="${dataUrl}" alt="${s.shareImgAlt}" />
      <p class="hint">${s.shareHint}</p>
      <div class="btn-row"><button class="primary" id="recShareClose">${s.closeBtn}</button></div>
    </div>
  `;
  document.body.appendChild(share);
  const close = () => {
    share.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  pushLayer(close, share);
  // Escape belongs to the card while it is up. The panel behind has its own
  // window-level Escape handler; this one is registered on the capture phase,
  // so it runs first and stops the key reaching that handler — otherwise
  // Escape would shut the panel and leave the card floating over nothing.
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  }
  window.addEventListener('keydown', onKey, true);
  share.querySelector<HTMLButtonElement>('#recShareClose')!.addEventListener('click', close);
  share.addEventListener('click', (e) => {
    if (e.target === share) close();
  });
}
