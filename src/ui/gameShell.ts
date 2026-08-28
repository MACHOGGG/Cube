import { STRINGS, type Lang } from '../i18n';

export interface ExtraControl {
  id: string;
  label: string;
}

export interface ShellMeta {
  title: string;
  tagline: string;
  startBody: string;
  hint: string;
  assumptions: string;
  extraControls?: ExtraControl[];
  /** Pre-rendered HTML (via engine/patternIcon.ts's renderPatternHintRow) for the small blank-outline scoring-pattern icons shown under the HUD. */
  patternHint?: string;
  /** Widens the whole .app column beyond its normal max-width, for a board
   *  whose own layout (many cells, or a shape denser than a plain square
   *  grid) reads as cramped at the standard size — see the "app-wide" CSS. */
  wideBoard?: boolean;
  /** Localizes the shell's own static chrome (buttons/HUD labels/overlay
   *  copy) below — title/tagline/startBody/hint/assumptions above stay
   *  shape-authored (still Chinese-only pending per-shape translation). */
  lang: Lang;
}

export interface ShellRefs {
  root: HTMLElement;
  boardWrap: HTMLElement;
  boardEl: HTMLElement;
  legendEl: HTMLElement;
  hudTimeEl: HTMLElement;
  hudPerfEl: HTMLElement;
  scoreReelEl: HTMLElement;
  gainBadgeEl: HTMLElement;
  startOverlay: HTMLElement;
  pauseOverlay: HTMLElement;
  endOverlay: HTMLElement;
  endHazardBgEl: HTMLElement;
  endTitleEl: HTMLElement;
  endScoreEl: HTMLElement;
  endBreakdownEl: HTMLElement;
  endDetailEl: HTMLElement;
  shareOverlay: HTMLElement;
  shareImageEl: HTMLImageElement;
  buttons: {
    stop: HTMLButtonElement;
    finish: HTMLButtonElement;
    back: HTMLButtonElement;
    start: HTMLButtonElement;
    continueBtn: HTMLButtonElement;
    restart: HTMLButtonElement;
    endBack: HTMLButtonElement;
    /** Hidden until some tile is genuinely unable to ever flip again; the player decides when (or whether) to end the run over it, rather than the run ending on its own. */
    stuckEnd: HTMLButtonElement;
    share: HTMLButtonElement;
    shareClose: HTMLButtonElement;
    extra: Record<string, HTMLButtonElement>;
  };
}

/**
 * Builds the HUD/board/legend/overlay DOM every shape shares — the only
 * things that differ between shapes are copy (title/hint/assumptions), any
 * extra control buttons, and the board contents the shape renders inside
 * #board.
 */
export function buildShell(container: HTMLElement, meta: ShellMeta): ShellRefs {
  const s = STRINGS[meta.lang];
  const extraButtonsHtml = (meta.extraControls ?? [])
    .map((b) => `<button class="icon-btn" id="${b.id}">${b.label}</button>`)
    .join('');

  container.innerHTML = `
    <div class="app${meta.wideBoard ? ' app-wide' : ''}">
      <h1>${meta.title}</h1>
      <p class="tag-line">${meta.tagline}</p>

      <div class="controls">
        <button class="icon-btn" id="stopBtn">${s.pauseBtn}</button>
        <button class="icon-btn" id="finishBtn">${s.finishBtn}</button>
        ${extraButtonsHtml}
        <button class="icon-btn" id="backBtn">${s.backToMenu}</button>
      </div>

      <div class="hud">
        <div class="hud-cell score-cell">
          <span class="gain-badge" id="gainBadge"></span>
          <div class="k">${s.scoreLabel}</div>
          <div class="v"><span class="score-reel" id="scoreReel"></span></div>
        </div>
        <div class="hud-cell perf-cell"><div class="k">${s.perfLabel}</div><div class="v" id="hud-perf">0%</div></div>
        <div class="hud-cell"><div class="k">${s.timeLabel}</div><div class="v" id="hud-time">0:00</div></div>
      </div>

      ${meta.patternHint ? `<div class="pattern-hint">${meta.patternHint}</div>` : ''}

      <div class="board-wrap" id="boardWrap">
        <div class="board" id="board"></div>
      </div>

      <div class="legend" id="legend"></div>
      <button class="stuck-end-btn stuck-glow" id="stuckEndBtn" hidden>${s.stuckEndBtn}</button>
      <p class="hint">${meta.hint}</p>
      <p class="assumptions">${meta.assumptions}</p>
    </div>

    <div class="overlay opaque show" id="startOverlay">
      <div class="modal">
        <h2>${meta.title}</h2>
        <p>${meta.startBody}</p>
        <div class="btn-row"><button class="primary" id="startBtn">${s.startBtn}</button></div>
      </div>
    </div>

    <div class="overlay opaque" id="pauseOverlay">
      <div class="modal">
        <h2>${s.pausedTitle}</h2>
        <p>${s.pausedBody}</p>
        <div class="btn-row"><button class="primary" id="continueBtn">${s.resume}</button></div>
      </div>
    </div>

    <div class="overlay" id="endOverlay">
      <div class="modal">
        <div class="end-hazard-bg" id="endHazardBg" aria-hidden="true">💥</div>
        <h2 id="endTitle">${s.endTitleDefault}</h2>
        <div class="end-score-label">${s.compositeScoreLabel}</div>
        <div class="big-score" id="endScore">0</div>
        <div class="end-breakdown" id="endBreakdown"></div>
        <p id="endDetail">${s.stepsPhrase.replace('{n}', '0')} · ${s.timeLabel} 0:00 · ${s.bestPhrase.replace('{n}', '0')}</p>
        <div class="btn-row">
          <button class="secondary" id="endBackBtn">${s.backToMenu}</button>
          <button class="secondary" id="shareBtn">${s.shareBtn}</button>
          <button class="primary" id="restartBtn">${s.restartBtn}</button>
        </div>
      </div>
    </div>

    <div class="overlay" id="shareOverlay">
      <div class="modal share-modal">
        <h2>${s.shareCardTitle}</h2>
        <img id="shareImage" alt="${s.shareImgAlt}" />
        <p class="hint">${s.shareHint}</p>
        <div class="btn-row"><button class="primary" id="shareCloseBtn">${s.closeBtn}</button></div>
      </div>
    </div>
  `;

  const req = <T extends HTMLElement>(id: string) => {
    const el = container.querySelector<T>('#' + id);
    if (!el) throw new Error(`gameShell: missing #${id}`);
    return el;
  };

  const extra: Record<string, HTMLButtonElement> = {};
  for (const b of meta.extraControls ?? []) extra[b.id] = req<HTMLButtonElement>(b.id);

  return {
    root: container,
    boardWrap: req('boardWrap'),
    boardEl: req('board'),
    legendEl: req('legend'),
    hudTimeEl: req('hud-time'),
    hudPerfEl: req('hud-perf'),
    scoreReelEl: req('scoreReel'),
    gainBadgeEl: req('gainBadge'),
    startOverlay: req('startOverlay'),
    pauseOverlay: req('pauseOverlay'),
    endOverlay: req('endOverlay'),
    endHazardBgEl: req('endHazardBg'),
    endTitleEl: req('endTitle'),
    endScoreEl: req('endScore'),
    endBreakdownEl: req('endBreakdown'),
    endDetailEl: req('endDetail'),
    shareOverlay: req('shareOverlay'),
    shareImageEl: req('shareImage'),
    buttons: {
      stop: req('stopBtn'),
      finish: req('finishBtn'),
      back: req('backBtn'),
      start: req('startBtn'),
      continueBtn: req('continueBtn'),
      restart: req('restartBtn'),
      endBack: req('endBackBtn'),
      stuckEnd: req('stuckEndBtn'),
      share: req('shareBtn'),
      shareClose: req('shareCloseBtn'),
      extra,
    },
  };
}
