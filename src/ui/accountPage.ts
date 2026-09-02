import { STRINGS, PRIVILEGES, type Lang } from '../i18n';
import { RULES } from '../rules';
import { APP_ICONS, applyAppIcon, loadAppIcon, saveAppIcon } from './appIcons';
import { ICON_SOUND_ON, ICON_SOUND_OFF, ICON_LOCK } from './homeIcons';
import { geniusLogoTag } from './geniusLogo';
import { soundOn, setSoundOn } from '../engine/juice';
import { trackIconChange } from '../engine/analytics';
import {
  PIECE_VARIANTS,
  colorblindOn,
  pieceVariant,
  setColorblind,
  setPieceVariant,
  variantSwatch,
  type PieceVariant,
} from '../engine/palettePref';
import { LEGAL, LEGAL_ORDER, legalDoc, type LegalKey } from '../legal';
import { applyPaletteToTree } from '../engine/palettePref';
import { isStoreChannel } from '../engine/channel';
import { isGenius } from '../engine/subscription';
import {
  openAuthWindow,
  openGeniusWindow,
  openRedeemWindow,
  openStatusWindow,
  runStoreRestore,
} from './subscribe';

/** 「原本」那一套的代表色——就是三角/六边圆球在用的那六支的前五支。 */
const BASE_SWATCH = ['#2F8A96', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52'] as const;

export type { AuthTab } from './subscribe';
import type { AuthTab } from './subscribe';

export interface ProfileHandlers {
  onBack: () => void;
  /** Opens the quick language-switch popup. */
  onSwitchLanguage: () => void;
  onHowToSlide: () => void;
  onRandomTarget: () => void;
  onMultiplayer: () => void;
}

/**
 * 个人主页 — one destination for everything that isn't a game, laid out the
 * way the design sheet has it: the Slides masthead, a wide sign-in pill, the
 * language and tutorial pair, then the 天才特供 panel holding the perks that
 * aren't built yet, and 返回 closing the page.
 *
 * Sign-up / log-in lives in a popup off the 登录通道 pill rather than as tabs
 * pinned to the top of the page, so the page itself stays a clean stack of
 * destinations.
 */
export function renderAccountPage(
  container: HTMLElement,
  initialTab: AuthTab,
  handlers: ProfileHandlers,
  lang: Lang,
) {
  const s = STRINGS[lang];
  const privileges = PRIVILEGES[lang];
  const VARIANT_NAME: Record<PieceVariant, string> = {
    now: s.paletteNow,
    jia: s.paletteJia,
    bing: s.paletteBing,
  };
  // Where the wide pill leads, and what it is called, is decided by which
  // counter can charge this build. The site has accounts because an address
  // is the only identity it has; the store builds have none, because Apple
  // and Google already know who is holding the phone — so what would have
  // been 登录通道 there is 恢复购买, the only "sign in" they need.
  const subscribed = isGenius();
  const gatewayLabel = subscribed
    ? s.geniusStatus
    : isStoreChannel()
      ? s.restoreBtn
      : s.loginGateway;
  const lockedRow = (label: string) =>
    `<div class="profile-row profile-row--locked">` +
    `<span class="profile-row-glyph profile-row-glyph--lock">${ICON_LOCK}</span>` +
    `<span class="profile-row-label">${label}</span>` +
    `<span class="profile-row-value">${s.comingSoon}</span></div>`;

  container.innerHTML = `
    <div class="app profile-page">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${s.homeTagline}</p>
        </div>
      </header>

      <button class="profile-pill profile-pill--wide" id="loginBtn">${gatewayLabel}</button>
      <div class="profile-pill-row">
        <button class="profile-pill" id="langRow">${s.switchLanguage}</button>
        <button class="profile-pill profile-pill--rose" id="howToRow">${s.tutorialShort}</button>
      </div>
      <button class="profile-pill profile-pill--wide" id="rulesRow">${s.rulesPill}</button>
      <!-- 更换图标 keeps the row; the sound switch rides beside it as a
           square of the same pill, so the setting sits where the other
           look-and-feel settings are without adding a row of its own. -->
      <div class="profile-pill-row profile-pill-row--icon">
        <button class="profile-pill" id="iconRow">${s.iconPill}</button>
        <button class="profile-pill profile-pill--square" id="soundRow"
                role="switch" aria-checked="${soundOn()}" aria-label="${s.soundBtn}">
          <span class="sound-glyph" aria-hidden="true">${soundOn() ? ICON_SOUND_ON : ICON_SOUND_OFF}</span>
        </button>
      </div>
      <!-- The colourblind palette: one setting for the whole app, with a
           switch that says on/off by its own colour and position rather
           than by a word — it has to read the same in four languages. -->
      <button class="profile-pill profile-pill--wide profile-pill--switch" id="cvdRow"
              role="switch" aria-checked="${colorblindOn()}">
        <span>${s.colorblindBtn}</span>
        <span class="pill-switch" aria-hidden="true"><span class="pill-switch-knob"></span></span>
      </button>

      <section class="genius-panel">
        <!-- 这一块的主角是那个牌子，不是那行小字。所以顺序是：正中一个大
             logo，下面一句「成为 / 你已经是 Slides 天才」，再下面才是那行
             《Slides 天才特供》的小标签。 -->
        <div class="genius-crest">${geniusLogoTag(90, 'genius-logo--crest')}</div>
        <button class="genius-cta" id="becomeGeniusBtn">${
          subscribed ? s.subscribedTitle : s.becomeGenius
        }</button>
        <div class="menu-section-label">${s.geniusSpecialTitle}</div>
        <!-- A code is its own way in, not a footnote to the paywall: it was
             buried behind 「有内部码？」 inside the subscribe window, which is
             the one place someone holding a code has no reason to open. -->
        <button class="profile-row" id="insiderRow">
          <span class="profile-row-label">${s.insiderCode}</span>
          <span class="profile-row-value">›</span>
        </button>
        <button class="profile-row" id="randomRow">
          <span class="profile-row-label">${s.randomTargetTitle}</span>
          <span class="profile-row-value">${s.comingSoon}</span>
        </button>
        <!-- 多人游玩 is built; it opens its own page rather than saying
             「敬请期待」 like the perks below it still honestly do. -->
        <button class="profile-row" id="multiRow">
          <span class="profile-row-label">${s.multiplayerTitle}</span>
          <span class="profile-row-value">&rsaquo;</span>
        </button>
        <!-- 《解锁更多配色》不再是一行「敬请期待」了：天才点开能挑棋子的
             配色，没开通的人看到的还是原来那把锁。它是 PRIVILEGES 的第一
             条，所以从第二条起才继续挂锁。 -->
        ${
          subscribed
            ? `<button class="profile-row" id="paletteRow">
                 <span class="profile-row-label">${privileges[0]}</span>
                 <span class="profile-row-value">${VARIANT_NAME[pieceVariant()]}&nbsp;&rsaquo;</span>
               </button>`
            : lockedRow(privileges[0])
        }
        ${privileges.slice(1).map(lockedRow).join('')}
      </section>

      <!-- Tarifs, terms, refunds, privacy, contact — the five documents a
           paid service has to publish. Plain rows in the same style as the
           two above them, so they sit at the foot of the page without
           changing anything about it. -->
      <section class="legal-rows">
        ${LEGAL_ORDER.map(
          (k) => `<button class="profile-row" data-legal="${k}">
            <span class="profile-row-label">${LEGAL[lang][k].title}</span>
            <span class="profile-row-value">›</span>
          </button>`,
        ).join('')}
      </section>
      <button class="profile-row profile-row--back" id="backBtn">${s.back}</button>
    </div>
  `;

  /** Buying, restoring or signing out all change what this page should say,
   *  so each of them re-draws it. The palette is re-applied by hand because
   *  the page's glyphs are literal SVG, and only a repaint carries the
   *  colourblind setting into freshly written markup. */
  const refresh = () => {
    renderAccountPage(container, initialTab, handlers, lang);
    applyPaletteToTree(container);
  };

  /** 游戏规则 — the whole rulebook, in the player's own language. It used to
   *  be two long Chinese paragraphs pinned under every board; here it is one
   *  scrollable panel a player opens when they actually want it. */
  function openRules() {
    const book = RULES[lang];
    const list = (items: typeof book.general) =>
      items
        .map((r) => `<div class="rule-item"><b>${r.term}</b><span>${r.body}</span></div>`)
        .join('');
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal rules-modal">
        <h2>${book.title}</h2>
        <div class="rules-body">
          <div class="menu-section-label">${book.generalHeading}</div>
          ${list(book.general)}
          <div class="menu-section-label">${book.modesHeading}</div>
          ${list(book.modes)}
        </div>
        <div class="btn-row"><button class="primary" id="rulesClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#rulesClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** One of the five published documents, in the same window 游戏规则 uses —
   *  a title, a line of lead-in, then term/body pairs. */
  function openLegal(key: LegalKey) {
    // Channel-aware: the clauses that belong to the other counter — its
    // prices, its cancellation route, the company that takes its money —
    // are not in this copy at all.
    const doc = legalDoc(lang, key);
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal rules-modal">
        <h2>${doc.title}</h2>
        <div class="rules-body">
          <p class="legal-intro">${doc.intro}</p>
          ${doc.items
            .map((r) => `<div class="rule-item"><b>${r.term}</b><span>${r.body}</span></div>`)
            .join('')}
        </div>
        <div class="btn-row"><button class="primary" id="legalClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#legalClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 更换图标 — the icon on the browser tab. Picking one swaps it there and
   *  then, and the choice is remembered, so a player sees their own tab icon
   *  on every later visit. */
  /**
   * 棋子配色那扇窗。
   *
   * 每一套用一条真的色带来说明自己——名字（「沉稳」「柔和」）只是标签，
   * 真正要看的是那几支颜色摆在一起是什么样。色带画的是这套配色的前五支，
   * 底下垫着棋盘那块褐色，因为那才是它们实际待的地方。
   */
  function openPalettePicker() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    const row = (v: PieceVariant) =>
      `<button class="pal-opt" data-pal="${v}">
         <span class="pal-name">${VARIANT_NAME[v]}</span>
         <span class="pal-strip">${variantSwatch(v, BASE_SWATCH)
           .map((c) => `<span style="background:${c}"></span>`)
           .join('')}</span>
       </button>`;
    overlay.innerHTML = `
      <div class="modal pal-modal">
        <h2>${s.paletteTitle}</h2>
        <p class="hint">${s.paletteHint}</p>
        <div class="pal-list">${PIECE_VARIANTS.map(row).join('')}</div>
        <div class="btn-row"><button class="primary" id="palClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const opts = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.pal-opt'));
    const mark = (v: PieceVariant) => {
      for (const el of opts) el.classList.toggle('pal-opt--on', el.dataset.pal === v);
      const value = container.querySelector<HTMLElement>('#paletteRow .profile-row-value');
      if (value) value.innerHTML = `${VARIANT_NAME[v]}&nbsp;&rsaquo;`;
    };
    mark(pieceVariant());
    for (const el of opts) {
      el.addEventListener('click', () => {
        const v = el.dataset.pal as PieceVariant;
        setPieceVariant(v);
        mark(v);
      });
    }
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#palClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  function openIconPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal icon-modal">
        <h2>${s.iconTitle}</h2>
        <p>${s.iconHint}</p>
        <div class="icon-grid">
          ${APP_ICONS.map(
            (i) => `<button class="icon-opt" data-icon="${i.id}">${i.svg}</button>`,
          ).join('')}
        </div>
        <div class="btn-row"><button class="primary" id="iconClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const opts = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.icon-opt'));
    const mark = (id: string) => {
      for (const el of opts) el.classList.toggle('icon-opt--on', el.dataset.icon === id);
    };
    mark(loadAppIcon());
    for (const el of opts) {
      el.addEventListener('click', () => {
        const id = el.dataset.icon!;
        saveAppIcon(id);
        applyAppIcon(id);
        trackIconChange(id);
        mark(id);
      });
    }
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#iconClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 联系我们 — the destination has nothing in it yet, so the link opens an
   *  empty panel rather than pretending to have content. */
  const on = (id: string, fn: () => void) =>
    container.querySelector<HTMLButtonElement>('#' + id)?.addEventListener('click', fn);
  on('loginBtn', () => {
    if (isGenius()) openStatusWindow(lang, refresh);
    else if (isStoreChannel()) runStoreRestore(lang, refresh);
    else openAuthWindow(lang, initialTab, refresh);
  });
  on('langRow', handlers.onSwitchLanguage);
  on('rulesRow', openRules);
  on('iconRow', openIconPicker);
  on('paletteRow', openPalettePicker);
  on('cvdRow', () => {
    setColorblind(!colorblindOn());
    const row = container.querySelector<HTMLButtonElement>('#cvdRow');
    row?.setAttribute('aria-checked', String(colorblindOn()));
  });
  // Sound on/off. The glyph is the whole state — a speaker, or the same
  // speaker with a bar across it — so it needs no word in any language.
  // The app's shared click cue fires on this button like any other, which
  // means switching the sound back on is confirmed by a sound and switching
  // it off is confirmed by silence; nothing extra is played here.
  on('soundRow', () => {
    const next = !soundOn();
    setSoundOn(next);
    const row = container.querySelector<HTMLButtonElement>('#soundRow');
    const glyph = row?.querySelector('.sound-glyph');
    if (glyph) glyph.innerHTML = next ? ICON_SOUND_ON : ICON_SOUND_OFF;
    row?.setAttribute('aria-checked', String(next));
  });
  on('howToRow', handlers.onHowToSlide);
  on('randomRow', handlers.onRandomTarget);
  on('multiRow', handlers.onMultiplayer);
  on('becomeGeniusBtn', () => openGeniusWindow(lang, refresh));
  on('insiderRow', () => openRedeemWindow(lang, refresh));
  for (const btn of Array.from(container.querySelectorAll<HTMLElement>('[data-legal]'))) {
    btn.addEventListener('click', () => openLegal(btn.dataset.legal as LegalKey));
  }
  on('backBtn', handlers.onBack);
}
