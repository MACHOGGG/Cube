import { STRINGS, type Lang } from '../i18n';
import { colorblindOn, setColorblind } from '../engine/palettePref';

export interface ExtraControl {
  id: string;
  label: string;
}

export interface ShellMeta {
  title: string;
  tagline: string;
  startBody: string;
  extraControls?: ExtraControl[];
  /** Pre-rendered HTML (via engine/patternIcon.ts's renderPatternHintRow) for the small blank-outline scoring-pattern icons shown under the HUD. */
  patternHint?: string;
  /** Widens the whole .app column beyond its normal max-width, for a board
   *  whose own layout (many cells, or a shape denser than a plain square
   *  grid) reads as cramped at the standard size — see the "app-wide" CSS. */
  wideBoard?: boolean;
  /** This board gains the most from a phone held sideways (七色圆球's
   *  diamond, which turns a quarter turn to lie across the screen, and
   *  进阶三角's V), so its start card carries the turn-your-phone prompt.
   *  The landscape layout itself is not gated on this — every game switches
   *  to it in a short, wide viewport; see the ".app--game" landscape CSS. */
  landscape?: boolean;
  /** Every string on this screen is localized through STRINGS[lang]; the
   *  shapes pass in already-translated title/tagline/startBody. The long
   *  rules that used to sit under each board now live in one translated
   *  rulebook (rules.ts), opened from 个人主页 → 游戏规则. */
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
  endAvgEl: HTMLElement;
  endBreakdownEl: HTMLElement;
  endDetailEl: HTMLElement;
  shareOverlay: HTMLElement;
  shareImageEl: HTMLImageElement;
  buttons: {
    stop: HTMLButtonElement;
    finish: HTMLButtonElement;
    /** Absent in-game (the row has no way-out button any more — leaving a
     *  run goes through the title or the bottom nav, which ask first); the
     *  shape modules still wire it when it exists. */
    back?: HTMLButtonElement;
    start: HTMLButtonElement;
    continueBtn: HTMLButtonElement;
    restart: HTMLButtonElement;
    endBack: HTMLButtonElement;
    /** Hidden until some tile is genuinely unable to ever flip again; the player decides when (or whether) to end the run over it, rather than the run ending on its own. */
    stuckEnd: HTMLButtonElement;
    /** Leaves without starting a run — same destination as `back`. */
    startBack: HTMLButtonElement;
    share: HTMLButtonElement;
    shareClose: HTMLButtonElement;
    extra: Record<string, HTMLButtonElement>;
  };
}

/**
 * Builds the HUD/board/legend/overlay DOM every shape shares — the only
 * things that differ between shapes are copy (title/tagline), any
 * extra control buttons, and the board contents the shape renders inside
 * #board.
 */
/**
 * The turn-your-phone prompt on a wide board's start card: a phone outline
 * that tips a quarter turn and settles, over one line of copy. It is drawn
 * from the same parts as the rest of the app — a rounded rectangle with the
 * board's own piece colours inside — rather than a stock rotate glyph, and
 * it only ever appears where turning really helps.
 */
const ROTATE_HINT = (copy: string) => `
  <div class="rotate-hint">
    <svg class="rotate-hint-phone" viewBox="0 0 120 120" aria-hidden="true">
      <g class="rotate-hint-turn">
        <rect x="41" y="16" width="38" height="88" rx="9"
              fill="none" stroke="currentColor" stroke-width="4"/>
        <rect x="47" y="27" width="26" height="66" rx="4" fill="currentColor" opacity="0.14"/>
        <circle cx="53" cy="47" r="5.5" fill="var(--accent)"/>
        <circle cx="67" cy="47" r="5.5" fill="var(--accent-2)"/>
        <circle cx="53" cy="61" r="5.5" fill="var(--warn)"/>
        <circle cx="67" cy="61" r="5.5" fill="var(--accent)"/>
      </g>
      <path class="rotate-hint-arc" d="M22 74 A42 42 0 0 1 30 40"
            fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      <path class="rotate-hint-arc" d="M30 40 l-9 2 l5 -8 Z" fill="currentColor" stroke="none"/>
    </svg>
    <p class="rotate-hint-copy">${copy}</p>
  </div>`;

/**
 * The two controls' marks: a disc with the sign cut into it, drawn rather
 * than written.
 *
 * They replace the words 完成/暂停, which had to be translated and then made
 * to fit — "Terminer" is four times the width of 完成 — and which a player
 * mid-run reads as shapes anyway. The disc takes `--ctl-disc` and the sign
 * `--ctl-mark`, so the pressed state swaps the two and the mark inverts with
 * the chip under it (see .app--game .controls .icon-btn in style.css).
 */
const ctlGlyph = (inner: string) =>
  `<svg class="ctl-glyph" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
  `<circle cx="50" cy="50" r="46" fill="var(--ctl-disc)"/>${inner}</svg>`;
const CTL_PAUSE = ctlGlyph(
  '<rect x="35" y="28" width="11" height="44" rx="5.5" fill="var(--ctl-mark)"/>' +
    '<rect x="54" y="28" width="11" height="44" rx="5.5" fill="var(--ctl-mark)"/>',
);
const CTL_FINISH = ctlGlyph(
  '<path d="M29 51.5 L44 66 L72 35" fill="none" stroke="var(--ctl-mark)" stroke-width="12" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>',
);

export function buildShell(container: HTMLElement, meta: ShellMeta): ShellRefs {
  const s = STRINGS[meta.lang];
  const extraButtonsHtml = (meta.extraControls ?? [])
    .map((b) => `<button class="icon-btn" id="${b.id}">${b.label}</button>`)
    .join('');

  // The landscape layout is one grid — readouts | board | buttons — and the
  // portrait one is the column it has always been. Both are the same DOM in
  // the same order; only the landscape media query's grid areas move the
  // pieces, so nothing re-renders when the phone turns.
  container.innerHTML = `
    <div class="app app--game${meta.wideBoard ? ' app-wide' : ''}${meta.landscape ? ' app--land-wide' : ''}">
      <h1>${meta.title}</h1>
      <p class="tag-line">${meta.tagline}</p>

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

      <!-- Two controls, and only two: 完成 and 暂停. Anything a player
           changes rather than does — the colourblind palette — lives in the
           pause panel instead, so the play screen stays the board plus the
           three readings plus the two things you can do to a run. -->
      <div class="controls">
        <button class="icon-btn" id="stopBtn" aria-label="${s.pauseBtn}">${CTL_PAUSE}</button>
        <button class="icon-btn" id="finishBtn" aria-label="${s.finishBtn}">${CTL_FINISH}</button>
      </div>
    </div>

    <div class="overlay opaque show" id="startOverlay">
      <div class="modal">
        <h2>${meta.title}</h2>
        <p>${meta.startBody}</p>
        ${meta.landscape ? ROTATE_HINT(s.rotateHint) : ''}
        <div class="btn-row"><button class="primary" id="startBtn">${s.startBtn}</button></div>
        <!-- A way out without starting a run: goes back to the home page, or
             to the picker this game was chosen from. -->
        <div class="btn-row"><button class="secondary" id="startBackBtn">${s.back}</button></div>
      </div>
    </div>

    <div class="overlay opaque" id="pauseOverlay">
      <div class="modal">
        <h2>${s.pausedTitle}</h2>
        <p>${s.pausedBody}</p>
        <!-- Reachable from a run as well as from 个人主页: someone who needs
             the colourblind palette should not have to leave the board to
             turn it on. Same setting, same switch, either way in. -->
        <div class="btn-row">
          <button class="icon-btn pause-switch" id="cvdBtn" role="switch" aria-checked="false">
            <span>${s.colorblindBtn}</span>
            <span class="pill-switch" aria-hidden="true"><span class="pill-switch-knob"></span></span>
          </button>
        </div>
        ${extraButtonsHtml ? `<div class="btn-row pause-extras">${extraButtonsHtml}</div>` : ''}
        <div class="btn-row"><button class="primary" id="continueBtn">${s.resume}</button></div>
      </div>
    </div>

    <div class="overlay overlay--end" id="endOverlay">
      <div class="modal">
        <div class="end-hazard-bg" id="endHazardBg" aria-hidden="true">💥</div>
        <h2 id="endTitle">${s.endTitleDefault}</h2>
        <div class="end-score-label">${s.compositeScoreLabel}</div>
        <div class="big-score" id="endScore">0</div>
        <!-- What this run was worth, set against what this mode is usually
             worth to this player — the one number that says whether it was a
             good run, without them having to remember their own history. -->
        <div class="end-avg" id="endAvg"></div>
        <div class="end-rule" aria-hidden="true"></div>
        <div class="end-breakdown" id="endBreakdown"></div>
        <p id="endDetail">${s.stepsPhrase.replace('{n}', '0')} · ${s.timeLabel} 0:00 · ${s.bestPhrase.replace('{n}', '0')}</p>
        <div class="btn-row">
          <button class="secondary" id="endBackBtn">${s.homeBtn}</button>
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

  /**
   * Shrinks a chip's type until its content fits.
   *
   * The chips are a fixed size, and what goes in them is not: 用时 is
   * "Temps" in French and "0:00" either way, 色盲友好配色 is
   * "Couleurs daltoniennes", and a score that reaches four digits is wider
   * than one that reaches two. A clamp() alone cannot know any of that — it
   * only knows the viewport — so anything that would spill gets stepped
   * down from whatever the stylesheet asked for until it doesn't.
   */
  const chips = () =>
    Array.from(container.querySelectorAll<HTMLElement>('.app--game .hud-cell, .app--game .controls .icon-btn'));
  const fitsIn = (el: HTMLElement) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
  let fitQueued = 0;
  function fitChips(): void {
    for (const el of chips()) {
      el.style.fontSize = '';
      const max = parseFloat(getComputedStyle(el).fontSize) || 16;
      if (fitsIn(el)) continue;
      // Binary search rather than a step-down loop: eight layout reads is
      // the whole cost, however far the type has to come down.
      let lo = 7;
      let hi = max;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = mid.toFixed(2) + 'px';
        if (fitsIn(el)) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = lo.toFixed(2) + 'px';
    }
  }
  const scheduleFit = () => {
    if (fitQueued) return;
    fitQueued = requestAnimationFrame(() => {
      fitQueued = 0;
      fitChips();
    });
  };
  scheduleFit();
  // The readouts change under their own steam — the clock every second, the
  // score whenever it goes up — so the fit follows the content, not just the
  // window.
  const hudEl = container.querySelector<HTMLElement>('.app--game .hud');
  if (hudEl) new MutationObserver(scheduleFit).observe(hudEl, { subtree: true, childList: true, characterData: true });
  for (const ev of ['resize', 'orientationchange']) window.addEventListener(ev, scheduleFit);

  const cvdBtn = container.querySelector<HTMLButtonElement>('#cvdBtn');
  cvdBtn?.setAttribute('aria-checked', String(colorblindOn()));
  cvdBtn?.addEventListener('click', () => {
    setColorblind(!colorblindOn());
    cvdBtn.setAttribute('aria-checked', String(colorblindOn()));
  });

  // The press flip on 完成/暂停 is driven from pointer events rather than
  // :active — a finger that presses and then slides a little (which is most
  // of them) drops :active on iOS while the button is still held, so the
  // colour would snap back under a thumb that had not lifted.
  for (const btn of Array.from(container.querySelectorAll<HTMLElement>('.controls .icon-btn'))) {
    const down = () => btn.classList.add('chip--press');
    const up = () => btn.classList.remove('chip--press');
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('blur', up);
  }

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
    endAvgEl: req('endAvg'),
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
      back: undefined,
      start: req('startBtn'),
      continueBtn: req('continueBtn'),
      restart: req('restartBtn'),
      endBack: req('endBackBtn'),
      stuckEnd: req('stuckEndBtn'),
      startBack: req('startBackBtn'),
      share: req('shareBtn'),
      shareClose: req('shareCloseBtn'),
      extra,
    },
  };
}
