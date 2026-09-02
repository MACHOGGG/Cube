import { STRINGS, PRIVILEGES, type Lang } from '../i18n';
import { RULES } from '../rules';
import { APP_ICONS, applyAppIcon, loadAppIcon, saveAppIcon } from './appIcons';
import { ICON_SOUND_ON, ICON_SOUND_OFF, ICON_LOCK } from './homeIcons';
import { geniusLogoTag } from './geniusLogo';
import { soundOn, setSoundOn } from '../engine/juice';
import { faceClone, flipStaggerMs, plankFlipEl } from '../engine/plankFlip';
import {
  FLIP_STEPS,
  flipStep,
  isRecommendedStep,
  rateOfStep,
  setFlipStep,
} from '../engine/flipSpeed';
import { trackIconChange } from '../engine/analytics';
import {
  CVD_VARIANTS,
  PIECE_VARIANTS,
  colorblindOn,
  cvdSwatch,
  cvdVariant,
  pieceVariant,
  setColorblind,
  setCvdVariant,
  setPieceVariant,
  type CvdVariant,
  type PieceVariant,
  variantSwatch,
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

/** 《图形翻面速度》那扇窗里排几颗球。六颗是棋盘上连成一条得分的常见样子，
 *  一颗看不出「一批一起翻」是什么节奏，而节奏也归这根拉杆管。 */
const DEMO_BALLS = 6;

/** 「原本」那一套的代表色——就是三角/六边圆球在用的那六支的前五支。 */

export type { AuthTab } from './subscribe';
import type { AuthTab } from './subscribe';

export interface ProfileHandlers {
  onBack: () => void;
  /** Opens the quick language-switch popup. */
  onSwitchLanguage: () => void;
  onHowToSlide: () => void;
  /** 《随机得分目标》。那一行现在锁着（见下面的 lockedRow），所以这条线暂时
   *  没有元素可挂——留着是因为它有内容了就要接回去。 */
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
  const CVD_NAME: Record<CvdVariant, string> = {
    std: s.cvdStd,
    warm: s.cvdWarm,
    cool: s.cvdCool,
  };
  const VARIANT_NAME: Record<PieceVariant, string> = {
    now: s.paletteNow,
    jia: s.paletteJia,
    bing: s.paletteBing,
  };
  /** 《图形翻面速度》那一行右边写什么：推荐档就写「推荐」，其余写倍率。
   *  写倍率而不是毫秒——毫秒要跟设计时长走，倍率是玩家自己拉出来的那个数。 */
  const flipLabel = (i: number) =>
    isRecommendedStep(i) ? s.flipSpeedPick : `${rateOfStep(i).toFixed(1)}\u00d7`;
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
        <!-- 做好的排在上面，没做的排在下面。做好的三条是：内部码、多人游玩、
             解锁更多配色；《随机得分目标》还只是一行「敬请期待」，所以跟着
             其它敬请期待的一起排到下面去。 -->
        <button class="profile-row" id="multiRow">
          <span class="profile-row-label">${s.multiplayerTitle}</span>
          <span class="profile-row-value">&rsaquo;</span>
        </button>
        <!-- 《解锁更多配色》两种人都点得开。
             天才点开是挑颜色；没开通的点开是看看有什么——三套配色照样画出来，
             只是每一行挂着锁、点不动。「敬请期待」那四个字对一件已经做好的
             东西是假话，而一行按不动的灰字既不告诉他有什么，也不给他理由去
             开通。 -->
        <button class="profile-row" id="paletteRow">
          ${subscribed ? '' : `<span class="profile-row-glyph profile-row-glyph--lock">${ICON_LOCK}</span>`}
          <span class="profile-row-label">${privileges[0]}</span>
          <span class="profile-row-value">${
            subscribed
              ? `${colorblindOn() ? CVD_NAME[cvdVariant()] : VARIANT_NAME[pieceVariant()]}&nbsp;&rsaquo;`
              : '&rsaquo;'
          }</span>
        </button>
        <!-- 《图形翻面速度》跟上面那一行同一个规矩：做好了，所以两种人都点
             得开。没开通的人进去看得见那根拉杆、也看得见它在做什么（窗口里
             那枚棋子会照当前这一档翻给他看），只是拉不动。 -->
        <button class="profile-row" id="flipRow">
          ${subscribed ? '' : `<span class="profile-row-glyph profile-row-glyph--lock">${ICON_LOCK}</span>`}
          <span class="profile-row-label">${s.flipSpeedTitle}</span>
          <span class="profile-row-value">${
            subscribed ? `${flipLabel(flipStep())}&nbsp;&rsaquo;` : '&rsaquo;'
          }</span>
        </button>
        <!-- 《随机得分目标》里面还没有东西，所以和其它没做完的一样挂着锁：
             一行点得开、进去却什么都没有的按钮，比一把锁更让人扫兴。等它有
             内容了再把锁去掉。 -->
        ${lockedRow(s.randomTargetTitle)}
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
  /**
   * 挑棋子的配色。
   *
   * 没开通的人也进得来，只是每一行挂着锁、按不动——颜色照样画出来。
   * 「看得见但拿不到」比「敬请期待」诚实：那四个字对一件已经做好的东西是假
   * 话，而且它既没告诉人有什么，也没给人任何想开通的理由。
   */
  function openPalettePicker() {
    const locked = !isGenius();
    // 色盲友好开着的时候，这里挑的是色盲那三套；关着的时候，挑的是棋子那三
    // 套。两组互斥（见 themedPalette），所以同一个窗口按开关切内容，而不是并
    // 排列出一堆对他不生效的选项。
    const cvd = colorblindOn();
    const ids: readonly string[] = cvd ? CVD_VARIANTS : PIECE_VARIANTS;
    const nameOf = (v: string) => (cvd ? CVD_NAME[v as CvdVariant] : VARIANT_NAME[v as PieceVariant]);
    const colorsOf = (v: string) =>
      cvd ? cvdSwatch(v as CvdVariant) : variantSwatch(v as PieceVariant);
    const currentOf = () => (cvd ? cvdVariant() : pieceVariant()) as string;
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    const row = (v: string) =>
      `<button class="pal-opt${locked ? ' pal-opt--locked' : ''}" data-pal="${v}"${
        locked ? ' disabled aria-disabled="true"' : ''
      }>
         ${locked ? `<span class="pal-lock">${ICON_LOCK}</span>` : ''}
         <span class="pal-name">${nameOf(v)}</span>
         <span class="pal-strip">${colorsOf(v)
           .map((c) => `<span style="background:${c}"></span>`)
           .join('')}</span>
       </button>`;
    overlay.innerHTML = `
      <div class="modal pal-modal">
        <h2>${cvd ? s.paletteCvdTitle : s.paletteTitle}</h2>
        <p class="hint">${locked ? s.paletteLocked : cvd ? s.paletteCvdHint : s.paletteHint}</p>
        <div class="pal-list">${ids.map(row).join('')}</div>
        <div class="btn-row">
          ${locked ? `<button class="genius-cta" id="palGo">${s.becomeGenius}</button>` : ''}
          <button class="${locked ? 'profile-row profile-row--back' : 'primary'}" id="palClose">${s.closeBtn}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector<HTMLButtonElement>('#palGo')?.addEventListener('click', () => {
      close();
      openGeniusWindow(lang, refresh);
    });
    const opts = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.pal-opt'));
    const mark = (v: string) => {
      for (const el of opts) el.classList.toggle('pal-opt--on', el.dataset.pal === v);
      // 锁着的时候不去改外面那一行：写上「原本」会让人以为他已经挑了一套，
      // 而他根本挑不了。那一行对他只是一个「›」。
      if (locked) return;
      const value = container.querySelector<HTMLElement>('#paletteRow .profile-row-value');
      if (value) value.innerHTML = `${nameOf(v)}&nbsp;&rsaquo;`;
    };
    mark(currentOf());
    for (const el of opts) {
      el.addEventListener('click', () => {
        const v = el.dataset.pal!;
        if (cvd) setCvdVariant(v as CvdVariant);
        else setPieceVariant(v as PieceVariant);
        mark(v);
      });
    }
    overlay.querySelector<HTMLButtonElement>('#palClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /**
   * 《图形翻面速度》——一根十档的拉杆。
   *
   * 从设计速度的一半到两倍，正中那一档标《推荐》。这件事没有一个对所有人
   * 都对的值：想看清楚每一次翻面的人要慢，打熟了嫌拖沓的人要快，所以交给
   * 玩家自己拉。倍率按几何级数分档（见 flipSpeed.ts），拉起来每一格的差别
   * 才是一样大的。
   *
   * 窗口里那枚棋子是这根拉杆的说明书：拉到哪一档，它就照那一档翻一次给你
   * 看。写「1.4×」谁也感觉不出那是多少，翻一次就知道了——而它翻的正是棋盘
   * 上那一下（同一段动画、同一套配色），不是一个另做的示意。
   *
   * 和《解锁更多配色》一样，没开通的人也进得来：拉杆看得见、演示照样翻，
   * 只是拉不动。
   */
  function openFlipSpeedPicker() {
    const locked = !isGenius();
    // 演示那枚棋子用玩家自己这套配色里的两支：正面一支实色，反面一颗点。
    // 跟着色盲开关走，因为棋盘也跟着它走。
    const swatch = colorblindOn() ? cvdSwatch(cvdVariant()) : variantSwatch(pieceVariant());
    const faceA = swatch[0];
    const faceB = swatch[3];

    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    // 刻度和滑块的圆钮要对得上，所以两边都从 --flip-thumb 算：滑块的钮从
    // 「半个钮」处走到「宽度减半个钮」处，刻度条也就左右各让出半个钮，再按
    // 百分比摆——这样第 i 格的刻度和第 i 档的钮心是同一个点，不是看着差不多。
    const ticks = Array.from({ length: FLIP_STEPS }, (_, i) => {
      const at = `${(i / (FLIP_STEPS - 1)) * 100}%`;
      const pick = isRecommendedStep(i);
      return (
        `<span class="flip-tick${pick ? ' flip-tick--pick' : ''}" style="left:${at}"></span>` +
        (pick ? `<span class="flip-pick" style="left:${at}">${s.flipSpeedPick}</span>` : '')
      );
    }).join('');
    overlay.innerHTML = `
      <div class="modal flip-modal">
        <h2>${s.flipSpeedTitle}</h2>
        <p class="hint">${locked ? s.flipSpeedLocked : s.flipSpeedHint}</p>
        <div class="flip-demo" id="flipDemo">${
          Array.from({ length: DEMO_BALLS }, () => '<div class="flip-demo-ball"></div>').join('')
        }</div>
        <div class="flip-slider${locked ? ' flip-slider--locked' : ''}">
          ${locked ? `<span class="flip-lock">${ICON_LOCK}</span>` : ''}
          <div class="flip-rail-box">
            <input class="flip-range" id="flipRange" type="range"
                   min="0" max="${FLIP_STEPS - 1}" step="1" value="${flipStep()}"
                   aria-label="${s.flipSpeedTitle}"${locked ? ' disabled aria-disabled="true"' : ''}>
            <div class="flip-ticks">${ticks}</div>
            <div class="flip-ends"><span>${s.flipSpeedSlow}</span><span>${s.flipSpeedFast}</span></div>
          </div>
        </div>
        <div class="btn-row">
          ${locked ? `<button class="genius-cta" id="flipGo">${s.becomeGenius}</button>` : ''}
          <button class="${locked ? 'profile-row profile-row--back' : 'primary'}" id="flipClose">${s.closeBtn}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const balls = Array.from(overlay.querySelectorAll<HTMLElement>('.flip-demo-ball'));
    // 一颗球现在是哪一面。正面是一支实色，反面是那个星标——和圆球玩法上画的
    // 是同一份（见 circle.ts 里的 makeBallEl），所以这里演的就是他等一下真会
    // 看到的那一下，不是另做的示意。
    const paintBall = (el: HTMLElement, dotFace: boolean) => {
      if (!dotFace) {
        el.style.background = faceA;
        el.innerHTML = '';
        return;
      }
      el.style.background = 'transparent';
      const d = Math.round(el.offsetWidth * 0.95);
      el.innerHTML =
        `<svg viewBox="0 0 24 24" width="${d}" height="${d}">` +
        `<g stroke="${faceB}" stroke-width="5.5" stroke-linecap="round">` +
        `<line x1="12" y1="2.5" x2="12" y2="21.5"/>` +
        `<line x1="4" y1="6.75" x2="20" y2="17.25"/>` +
        `<line x1="20" y1="6.75" x2="4" y2="17.25"/>` +
        `</g></svg>`;
    };
    let dotFace = false;
    for (const el of balls) paintBall(el, dotFace);

    // 拉的时候一格一个事件，翻面却要好几百毫秒。所以不是每一格都翻——停手
    // 一下下才翻，而且上一批没翻完就再等等：翻到一半重进一次，plankFlipEl
    // 会把正在转的那块木片当成「旧面」拍进去，翻出来就是一团糊的。
    let timer = 0;
    const flipDemo = () => {
      if (!balls[0]?.isConnected) return;
      if (balls.some((el) => el.dataset.flipping)) {
        timer = window.setTimeout(flipDemo, 90);
        return;
      }
      // 六颗依次错开，和棋盘上连成一条得分时一模一样——那个间隔也归这根拉杆
      // 管（flipStaggerMs），所以拉慢了是整排一起变慢，队形不变。
      dotFace = !dotFace;
      const next = dotFace;
      const stagger = flipStaggerMs();
      balls.forEach((el, n) => {
        // 旧面现在就拍下来，新面等轮到它自己才画：一次画完的话，还没轮到的
        // 那几颗会先亮出新面、过半秒再翻，看着像是翻晚了。
        const front = faceClone(el);
        window.setTimeout(() => {
          if (!el.isConnected) return;
          paintBall(el, next);
          plankFlipEl(el, front, 0);
        }, n * stagger);
      });
    };
    const nudgeDemo = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(flipDemo, 110);
    };
    // 一进来就翻一次，不用等他先去拉：这个窗口是来看它怎么翻的。
    timer = window.setTimeout(flipDemo, 260);

    const range = overlay.querySelector<HTMLInputElement>('#flipRange')!;
    range.addEventListener('input', () => {
      // disabled 已经拦住了手，这一句拦的是别的：以后谁为了样式把 disabled
      // 换成一个 class，这把锁不会跟着悄悄开了。
      if (locked) return;
      const i = Number(range.value);
      setFlipStep(i);
      nudgeDemo();
      const value = container.querySelector<HTMLElement>('#flipRow .profile-row-value');
      if (value) value.innerHTML = `${flipLabel(flipStep())}&nbsp;&rsaquo;`;
    });

    const close = () => {
      window.clearTimeout(timer);
      overlay.remove();
    };
    overlay.querySelector<HTMLButtonElement>('#flipGo')?.addEventListener('click', () => {
      close();
      openGeniusWindow(lang, refresh);
    });
    overlay.querySelector<HTMLButtonElement>('#flipClose')!.addEventListener('click', close);
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
  on('flipRow', openFlipSpeedPicker);
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
