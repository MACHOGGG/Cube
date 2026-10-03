import { STRINGS, PRIVILEGES, type Lang } from '../i18n';
import { pushLayer } from '../engine/backNav';
import { RULES } from '../rules';
import { APP_ICONS, applyAppIcon, loadAppIcon, saveAppIcon } from './appIcons';
import { ICON_SOUND_ON, ICON_SOUND_OFF, ICON_LOCK } from './homeIcons';
import { CTL_BACK } from './ctlIcons';
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
import { proOn, setPro } from '../engine/proMode';
import { pickedTheme, setTheme } from '../engine/themePref';
import { CONTACT_EMAIL, LEGAL, LEGAL_ORDER, legalDoc, type LegalKey } from '../legal';
import { THANKS } from '../thanks';
import { applyPaletteToTree } from '../engine/palettePref';
import { isStoreChannel } from '../engine/channel';
import { isGenius, signedInEmail } from '../engine/subscription';
import {
  openAuthWindow,
  openGeniusWindow,
  openStatusWindow,
  runStoreRestore,
} from './subscribe';
import { asteriskSvg } from './dotFaceMark';
import { ICON_CHECK, ICON_CLOSE, ICON_PENCIL } from './uiIcons';
import { confirmedNickname, nicknameErrorText, onNicknameChange, setNickname } from '../engine/nickname';

/** 《图形翻面速度》那扇窗里排几颗球。六颗是棋盘上连成一条得分的常见样子，
 *  一颗看不出「一批一起翻」是什么节奏，而节奏也归这根拉杆管。 */
const DEMO_BALLS = 6;

/** 「原本」那一套的代表色——就是三角/六边圆球在用的那六支的前五支。 */


export interface ProfileHandlers {
  onBack: () => void;
  /** Opens the quick language-switch popup. */
  onSwitchLanguage: () => void;
  onHowToSlide: () => void;
  /** 《老虎机模式》——先是三台转着的机器那一页，开通了的人从那儿去挑图形。 */
  onRandomTarget: () => void;
  onMultiplayer: () => void;
  /** 《更多得分目标》——二十个得分图案，按方块 / 小球 / 三角三列摆出来。 */
  onMoreTargets: () => void;
  /** 《更多布局》——菱形七色小球和 V 形三角两副布局的缩图。 */
  onMoreLayouts: () => void;
  /** 《世界排名》——整页只有那张榜。 */
  onWorldRank: () => void;
  /** 《更多玩法》——现在装的是《无限反转》：挑方块或小球，100 秒。 */
  onMoreModes: () => void;
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
  /**
   * 登着的人，哪怕此刻没有权限，那颗大键也该带他去《账户》。
   *
   * 原先这里问的是 isGenius()：订阅一过期，他自己的账号就没有入口了——云端战
   * 绩、别人寄给他的内部码、改密码，全都摸不着，只剩一颗写着「登录通道」的
   * 键，按下去是让他再登一次已经登着的账号。玩家的原话是「登录是登录……登录
   * 不代表有权限」，这一行就是那句话在代码里的样子。
   */
  const signedIn = Boolean(signedInEmail());
  const gatewayLabel = subscribed
    ? s.geniusStatus
    : signedIn
      ? s.accountTitle
      : isStoreChannel()
        ? s.restoreBtn
        : s.loginGateway;
  /** 没开通的人，做好了的那几行行首挂的那把小锁。 */
  const lockGlyph = subscribed
    ? ''
    : `<span class="profile-row-glyph profile-row-glyph--lock">${ICON_LOCK}</span>`;
  /**
   * 「敬请期待」那几行。
   *
   * 「敬请期待」排在标题**底下**一行小字，不再排在行尾（第 17 推）：天才面板改成 2 × 6 的网
   * 格之后，一格只有屏宽的一半不到，标题和行尾那几个字并排时标题被挤成一个字一行——法语
   * 在 360 宽上量到过，「Plus de niveaux」竖着排了十五行，那一格于是一屏高，整张网格（等
   * 高）跟着一屏一格。下面《解锁更多配色》《图形翻面速度》行尾那句当前值也是同一个处理。
   */
  const lockedRow = (label: string) =>
    `<div class="profile-row profile-row--locked">` +
    `<span class="profile-row-glyph profile-row-glyph--lock">${ICON_LOCK}</span>` +
    `<span class="profile-row-text"><span class="profile-row-label">${label}</span>` +
    `<span class="profile-row-sub">${s.comingSoon}</span></span></div>`;

  container.innerHTML = `
    <div class="app profile-page">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${s.homeTagline}</p>
        </div>
      </header>

      <!--
        第 17 推：两栏（电脑端）／单列（手机端）。

          左栏：头卡（砖红）→ 色盲那一行（蓝）→ 语言、完整规则、教学、图示（棕）→ 最后一行
                Pro 和声音并排，两颗加起来和上面那几颗一样宽。
          右栏：天才面板（灰褐）：吉祥物、徽章、2 列 × 6 行的十二个功能行（顺序没动）；面板
                底下《隐私政策》《联系与特别感谢》两颗白键，和网格的两列对齐。

        手机上两栏按这个顺序上下摞起来。颜色全是色卡 token（--card-*），不随深浅主题翻，色盲
        模式下也不换（方案原话）——这几张卡不靠颜色区分，靠位置和字。
      -->
      <div class="profile-cols">
        <section class="profile-col profile-col--main">
          ${
            signedIn
              ? /*
                 * 头卡（第 16 推第 5 条）：登录了的人，左边是昵称（还没登记就写「设置昵称」）和
                 * 一颗 ✎；**头卡其他位置**照旧打开帐号窗。
                 *
                 * 一整颗按钮里塞不下第二颗按钮（按钮不能套按钮），所以头卡本身是一块不响应的
                 * 底（.profile-head，样子和原来那颗药丸一样），上面三样各管各的：
                 *   · 昵称那几个字：点了开帐号窗（它是「其他位置」）；
                 *   · ✎ 外面包一圈 8px 的「空地」（.profile-head-guard）：落在这一圈里什么都不
                 *     发生——方案要「两个点击区域间距 ≥ 8px」，手指按偏一点，既不该误开帐号窗、
                 *     也不该误进编辑；
                 *   · 右边那一截是原来那颗 #loginBtn（键盘和读屏走它），字也还是原来那句。
                 */
                `<div class="profile-pill profile-pill--head profile-head" id="profileHead">
                  <span class="profile-head-nick" id="nickText"></span>
                  <span class="profile-head-guard" id="nickGuard">
                    <button type="button" class="profile-head-icon" id="nickEdit"
                            aria-label="${s.nickEdit}">${ICON_PENCIL}</button>
                  </span>
                  <button class="profile-head-open" id="loginBtn">${gatewayLabel}</button>
                </div>
                <p class="profile-head-msg" id="nickMsg" role="status"></p>`
              : `<button class="profile-pill profile-pill--head" id="loginBtn">${gatewayLabel}</button>`
          }
          <!-- The colourblind palette: one setting for the whole app, with a
               switch that says on/off by its own colour and position rather
               than by a word — it has to read the same in four languages. -->
          <button class="profile-pill profile-pill--switch profile-pill--cvd" id="cvdRow"
                  role="switch" aria-checked="${colorblindOn()}">
            <span>${s.colorblindBtn}</span>
            <span class="pill-switch" aria-hidden="true"><span class="pill-switch-knob"></span></span>
          </button>
          <button class="profile-pill" id="langRow">${s.switchLanguage}</button>
          <button class="profile-pill" id="rulesRow">${s.rulesPill}</button>
          <button class="profile-pill" id="howToRow">${s.tutorialShort}</button>
          <button class="profile-pill" id="iconRow">${s.iconPill}</button>
          <!-- 《Pro》和声音并排（第 17 推）。《Pro》还是那颗带开关的药丸（玩家 2026-09：「开启
               的形式和情况和现在的色盲友好模式一样」），它眼下管的是棋盘上那一圈「这一枚得分
               之后会变成什么颜色」（见 engine/proMode.ts）。声音是旁边那一小方：图标就是状态
               ——一只喇叭，或者划了一道的喇叭——四种语言里都不用写字。 -->
          <div class="profile-pill-row">
            <button class="profile-pill profile-pill--switch" id="proRow"
                    role="switch" aria-checked="${proOn()}">
              <span>${s.proBtn}</span>
              <span class="pill-switch" aria-hidden="true"><span class="pill-switch-knob"></span></span>
            </button>
            <button class="profile-pill profile-pill--square" id="soundRow"
                    role="switch" aria-checked="${soundOn()}" aria-label="${s.soundBtn}">
              <span class="sound-glyph" aria-hidden="true">${soundOn() ? ICON_SOUND_ON : ICON_SOUND_OFF}</span>
            </button>
          </div>
        </section>

        <section class="profile-col profile-col--genius">
          <div class="genius-panel">
            <!-- 这一块的主角是那个牌子：正中一个大吉祥物，底下一枚徽章（「成为 / 你已经是
                 Slides 天才」），再底下才是十二行。 -->
            <div class="genius-crest">${geniusLogoTag(90, 'genius-logo--crest')}</div>
            <button class="genius-badge" id="becomeGeniusBtn">${
              subscribed ? s.subscribedTitle : s.becomeGenius
            }</button>
            <!--
              **《内部码》那一行撤了**（E41，2026-10 的改制）。后端 api/redeem.js 一行没动，已经
              发出去的码照旧兑得了。

              **《SLIDES 天才特供》那行小标签和底下那条横线也撤了**（第 17 推，方案点名）。它标
              的是「线底下这一段要开通才有」，而现在注册即开通、十二行同在一张 2 × 6 的网格
              里，一条把网格切成两截的线只会让人以为上下是两类东西。
            -->
            <div class="genius-grid">
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
                ${lockGlyph}
                <span class="profile-row-text">
                  <span class="profile-row-label">${privileges[0]}</span>
                  ${
                    subscribed
                      ? `<span class="profile-row-sub">${colorblindOn() ? CVD_NAME[cvdVariant()] : VARIANT_NAME[pieceVariant()]}</span>`
                      : ''
                  }
                </span>
                <span class="profile-row-value">&rsaquo;</span>
              </button>
              <!-- 《深色界面》：一颗开关，不是一扇窗（玩家 2026-09 第二句：「简化一
                   下，就和现在开关色盲友好模式一样，亮/暗的开关按钮」）。原先是「点开
                   → 两条色带里挑一条 → 关窗」，三步换一件只有两种可能的事。
                   和上面那颗色盲开关同一个零件（.pill-switch），只是它住在天才特供这
                   一段里，所以行首多一把锁：没开通的按下去不是没反应，是带他去开通那
                   一页——和这一段里别的锁着的几行一个样。 -->
              <button class="profile-row" id="themeRow" role="switch"
                      aria-checked="${subscribed && pickedTheme() === 'dark'}"${subscribed ? '' : ' aria-disabled="true"'}>
                ${lockGlyph}
                <span class="profile-row-label">${s.themeTitle}</span>
                <span class="pill-switch" aria-hidden="true"><span class="pill-switch-knob"></span></span>
              </button>
              <!-- 《图形翻面速度》跟上面那一行同一个规矩：做好了，所以两种人都点
                   得开。没开通的人进去看得见那根拉杆、也看得见它在做什么（窗口里
                   那枚棋子会照当前这一档翻给他看），只是拉不动。 -->
              <button class="profile-row" id="flipRow">
                ${lockGlyph}
                <span class="profile-row-text">
                  <span class="profile-row-label">${s.flipSpeedTitle}</span>
                  ${subscribed ? `<span class="profile-row-sub">${flipLabel(flipStep())}</span>` : ''}
                </span>
                <span class="profile-row-value">&rsaquo;</span>
              </button>
              <!-- 《老虎机模式》做好了，所以和上面几条一样：两种人都点得开。没开通
                   的人进去看得见三台转着的机器、按得动那颗 STOP，只是没有右下角那颗
                   《开始 〉》，开不了局。 -->
              <button class="profile-row" id="randomRow">
                ${lockGlyph}
                <span class="profile-row-label">${s.randomTargetTitle}</span>
                <span class="profile-row-value">&rsaquo;</span>
              </button>
              <!-- 下面三行也是做好了的：二十个得分图案的总览、两副布局的缩图、整页
                   的世界排名。都是「看得见」的东西——没开通的人一样点得开，只是行
                   首挂着锁：图案和布局他玩不到，榜他看不清（那一页由服务器判）。 -->
              <button class="profile-row" id="moreTargetsRow">
                ${lockGlyph}
                <span class="profile-row-label">${privileges[2]}</span>
                <span class="profile-row-value">&rsaquo;</span>
              </button>
              <button class="profile-row" id="moreLayoutsRow">
                ${lockGlyph}
                <span class="profile-row-label">${privileges[3]}</span>
                <span class="profile-row-value">&rsaquo;</span>
              </button>
              <button class="profile-row" id="worldRankRow">
                ${lockGlyph}
                <span class="profile-row-label">${privileges[6]}</span>
                <span class="profile-row-value">&rsaquo;</span>
              </button>
              <!-- 《更多玩法》里现在装着三个：老虎机、无限反转、步步为营。
                   右边只留那个「〉」，不再把三个玩法的名字列出来（玩家 2026-09：「《更多
                   玩法》后面的文字太多了，去除掉《老虎机模式……》恢复排版」）。
                   三个名字连起来是「老虎机模式 · 无限反转 · 真正解密 · 步步为营」——比它
                   左边那个标题还长，于是这一行和上下几行对不齐，整段的排版被它一行撑歪。
                   那三个名字点进去第一屏就是，不必在门口先念一遍。 -->
              <button class="profile-row" id="moreModesRow">
                ${lockGlyph}
                <span class="profile-row-label">${privileges[4]}</span>
                <span class="profile-row-value">&rsaquo;</span>
              </button>
              <!-- 还没做的才写「敬请期待」：更多关卡、更多竞赛、Apple Watch。 -->
              ${[privileges[1], privileges[5], privileges[7]].map(lockedRow).join('')}
            </div>
          </div>
          <!--
            底部那几行法务。原先是五份（价格 / 条款 / 退款 / 隐私 / 联系）——一个收费服务必须
            公布的那五份。2026-10 的改制把付费整个撤了（注册即免费解锁），前三份因此没有对
            象，LEGAL_ORDER 只留隐私（E42）。

            所以这儿是**两颗白键**：《隐私政策》＋《联系与特别感谢》，一样宽，和上面网格的
            两列对齐（第 17 推）。《联系与特别感谢》不是 LEGAL 表里的一份：它不是法务文档，
            是一句话加一份名单（src/thanks.ts），所以它单独摆一颗，不走上面那个 map。
          -->
          <section class="legal-pair">
            ${LEGAL_ORDER.map(
              (k) => `<button class="profile-row" data-legal="${k}">
                <span class="profile-row-label">${LEGAL[lang][k].title}</span>
              </button>`,
            ).join('')}
            <button class="profile-row" id="contactThanksRow">
              <span class="profile-row-label">${s.contactThanksTitle}</span>
            </button>
          </section>
        </section>
      </div>
      <div class="page-back-row"><button class="icon-btn page-back" id="backBtn" aria-label="${s.back}">${CTL_BACK}</button></div>
    </div>
  `;

  /**
   * 电脑端那两列里**排不满的那一条**：找出来，打个记号，CSS 把它居中。
   *
   * 这件事原先是纯 CSS：`.profile-row:last-child:nth-child(odd)`，靠的是「跨两列的那
   * 几样各占偶数格，所以最后一条在奇数位 ⟺ 它落单」。那个推论有两个前提，而两个都已
   * 经不成立了：
   *
   *   · **跨两列的那几样中间会断行。** 《多人游玩》上面是那颗键、下面是小标签，两边都
   *     跨满整行——于是它自己独占一行的左半边，右半边空着。它不在末尾，`:last-child`
   *     够不着它。
   *   · **条数一改，奇偶就翻。** 2026-10 撤掉内部码那一条之后（账号改制推送 2），面板
   *     的子元素从 17 个变成 16 个，这条规则当场失效：最后那条《Apple Watch》贴在左边，
   *     右边空一格。屏幕上看着就是「这一页没排好」，而 CSS 一声不响。
   *
   * 所以改成按**真实的分段**算：跨两列的那几样把 `.profile-row` 切成几段，哪一段的条数
   * 是奇数，这一段的最后一条就落单。加一条、撤一条都不用回来改这儿。
   *
   * 第 17 推之后十二行住进了一张单独的网格（`.genius-grid`），中间不再夹标签和横线，手
   * 机上也是两列——眼下一条都不会落单（2 × 6 正好排满）。这段照旧留着：哪天加了第十三
   * 行，它自己知道把那一条居中，不用等到有人截图来说「右边空一格」。
   */
  for (const panel of container.querySelectorAll('.genius-grid')) {
    let run: Element[] = [];
    const close = () => {
      if (run.length % 2 === 1) run[run.length - 1].classList.add('profile-row--alone');
      run = [];
    };
    for (const kid of panel.children) {
      if (kid.classList.contains('profile-row')) run.push(kid);
      else close();
    }
    close();
  }

  /** Buying, restoring or signing out all change what this page should say,
   *  so each of them re-draws it. The palette is re-applied by hand because
   *  the page's glyphs are literal SVG, and only a repaint carries the
   *  colourblind setting into freshly written markup. */
  const refresh = () => {
    renderAccountPage(container, handlers, lang);
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
    pushLayer(close, overlay);
    overlay.querySelector<HTMLButtonElement>('#rulesClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /**
   * 《联系与特别感谢》——和 `openLegal` 同一种弹窗，两段。
   *
   * ```
   * 联系
   *   欢迎遇到任何问题附上截图联络我…（玩家自己写的那一段）
   *   support@play-slides.com          ← 可点 mailto，字号比正文大一档
   *
   * 特别感谢
   *   Zoey Kang · Sichuang Fan · 林衍竹 · Apple Chen · Dray
   *   等诸多测试并提出珍贵建议的朋友
   * ```
   *
   * 那句话排在**邮箱上方**（玩家定的顺序）：先说「欢迎来找我」，再给地址——反过来是一张
   * 名片，而这一段要说的是「有人在看」。
   *
   * 邮箱读的是 `src/legal.ts` 的 `CONTACT_EMAIL` 一个常量，全站引它。名单读
   * `src/thanks.ts`——加人只改那一个数组。
   */
  function openContactThanks() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.innerHTML = `
      <div class="modal rules-modal">
        <h2>${s.contactThanksTitle}</h2>
        <div class="rules-body">
          <div class="rule-item">
            <b>${s.contactTitle}</b>
            <span>${s.contactInvite}</span>
          </div>
          <p class="contact-mail"><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
          <div class="rule-item">
            <b>${s.thanksTitle}</b>
            <span>${THANKS.join(' · ')}<br />${s.thanksTail}</span>
          </div>
        </div>
        <div class="btn-row"><button class="primary" id="thanksClose">${s.closeBtn}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    pushLayer(close, overlay);
    overlay.querySelector<HTMLButtonElement>('#thanksClose')!.addEventListener('click', close);
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
    pushLayer(close, overlay);
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
          <button class="${locked ? 'profile-row profile-row--back' : 'primary'}" id="palClose">${s.doneBtn}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    pushLayer(close, overlay);
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
      // 当前那一套写在标题底下那一行小字里（第 17 推，见 lockedRow 上面那段）。
      const sub = container.querySelector<HTMLElement>('#paletteRow .profile-row-sub');
      if (sub) sub.textContent = nameOf(v);
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
          <button class="${locked ? 'profile-row profile-row--back' : 'primary'}" id="flipClose">${s.doneBtn}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const balls = Array.from(overlay.querySelectorAll<HTMLElement>('.flip-demo-ball'));
    // 一颗球现在是哪一面。正面是一支实色，反面是那颗星——三副棋盘现在共用的
    // 同一个记号（ui/dotFaceMark.ts），所以这里演的就是他等一下真会看到的那
    // 一下，不是另做的示意。从前这儿抄了一份一样的 SVG，抄的那份不会跟着改：
    // 记号一动，演示就和棋盘对不上了。
    const paintBall = (el: HTMLElement, dotFace: boolean) => {
      if (!dotFace) {
        el.style.background = faceA;
        el.innerHTML = '';
        return;
      }
      el.style.background = 'transparent';
      el.innerHTML = asteriskSvg(el.offsetWidth * 0.95, faceB);
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
      const sub = container.querySelector<HTMLElement>('#flipRow .profile-row-sub');
      if (sub) sub.textContent = flipLabel(flipStep());
    });

    const close = () => {
      window.clearTimeout(timer);
      overlay.remove();
    };
    overlay.querySelector<HTMLButtonElement>('#flipGo')?.addEventListener('click', () => {
      close();
      openGeniusWindow(lang, refresh);
    });
    pushLayer(close, overlay);
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
    pushLayer(close, overlay);
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
    // 认「登着没登着」，不认「是不是天才」——理由见上面 signedIn 那一段。
    if (signedInEmail()) openStatusWindow(lang, refresh);
    else if (isStoreChannel()) runStoreRestore(lang, refresh);
    else openAuthWindow(lang, refresh);
  });
  mountNicknameHead(container, lang);
  on('langRow', handlers.onSwitchLanguage);
  on('rulesRow', openRules);
  on('iconRow', openIconPicker);
  on('paletteRow', openPalettePicker);
  /**
   * 《深色界面》那颗开关。
   *
   * 和色盲那颗一样：按一下就换，aria-checked 跟着改（开关的样子全靠它，见
   * style.css 的 [aria-checked='true'] .pill-switch）。不用重画整页——换主题只是
   * 在 <html> 上换一个属性，这一页连同底下的主菜单当场就变了。
   */
  on('themeRow', () => {
    if (!isGenius()) {
      openGeniusWindow(lang, refresh);
      return;
    }
    const dark = pickedTheme() !== 'dark';
    setTheme(dark ? 'dark' : 'light');
    container.querySelector('#themeRow')?.setAttribute('aria-checked', String(dark));
  });
  on('flipRow', openFlipSpeedPicker);
  on('proRow', () => {
    setPro(!proOn());
    container.querySelector<HTMLButtonElement>('#proRow')?.setAttribute('aria-checked', String(proOn()));
  });
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
  on('moreTargetsRow', handlers.onMoreTargets);
  on('moreLayoutsRow', handlers.onMoreLayouts);
  on('worldRankRow', handlers.onWorldRank);
  on('moreModesRow', handlers.onMoreModes);
  on('becomeGeniusBtn', () => openGeniusWindow(lang, refresh));
  // 《联系与特别感谢》那一行。它不在 LEGAL 表里（不是法务文档），所以不走下面那个
  // `[data-legal]` 循环。
  container.querySelector<HTMLButtonElement>('#contactThanksRow')?.addEventListener('click', openContactThanks);
  for (const btn of Array.from(container.querySelectorAll<HTMLElement>('[data-legal]'))) {
    btn.addEventListener('click', () => openLegal(btn.dataset.legal as LegalKey));
  }
  on('backBtn', handlers.onBack);
}

/**
 * 头卡上的昵称：显示、✎ 原地改、✓ 存、✕ 不存（第 16 推第 5 条）。
 *
 * 显示的是**服务器认过的**那一个（engine/nickname.ts 的 confirmedNickname）。自动上传失败、
 * 或者压根没取过，就写「设置昵称」——那正是他该做的事。服务器那一份晚到（登录之后取回存档那
 * 一趟），这一格自己换过来，不用整页重画：重画会打断他正在改的那一下。
 *
 * 编辑时整张头卡让给输入框和 ✓ ✕（右边那句《账户》先收起来：360 宽上三样摆不下，挤着
 * 摆的话输入框只剩两个字宽）。Enter 等于 ✓，Esc 等于 ✕。存不进去就在头卡底下说一句为什么，
 * 输入框留着他敲的字，让他接着改。
 */
function mountNicknameHead(container: HTMLElement, lang: Lang): void {
  const head = container.querySelector<HTMLElement>('#profileHead');
  if (!head) return;
  const s = STRINGS[lang];
  const text = head.querySelector<HTMLElement>('#nickText')!;
  const msg = container.querySelector<HTMLElement>('#nickMsg')!;
  const open = head.querySelector<HTMLButtonElement>('#loginBtn')!;

  const show = () => {
    const name = confirmedNickname();
    text.textContent = name || s.nickSet;
    text.classList.toggle('profile-head-nick--unset', !name);
  };
  show();
  // 昵称那几个字也是「其他位置」：点了开帐号窗，和右边那一截一样。
  text.addEventListener('click', () => open.click());
  // ✎ 外面那一圈空地：吞掉落在上面的点击，什么都不做（见头卡那段注释）。
  head.querySelector('#nickGuard')!.addEventListener('click', (e) => e.stopPropagation());

  let editing: HTMLElement | null = null;
  const stopEditing = () => {
    editing?.remove();
    editing = null;
    head.classList.remove('profile-head--editing');
    show();
  };
  const startEditing = () => {
    if (editing) return;
    msg.textContent = '';
    head.classList.add('profile-head--editing');
    editing = document.createElement('div');
    editing.className = 'profile-head-editor';
    editing.innerHTML =
      `<input type="text" class="profile-head-input" id="nickInput" autocomplete="nickname"` +
      ` aria-label="${s.nickEdit}" />` +
      `<button type="button" class="profile-head-icon" id="nickSave" aria-label="${s.nickSave}">${ICON_CHECK}</button>` +
      `<button type="button" class="profile-head-icon" id="nickCancel" aria-label="${s.nickCancel}">${ICON_CLOSE}</button>`;
    head.appendChild(editing);
    const input = editing.querySelector<HTMLInputElement>('#nickInput')!;
    const save = editing.querySelector<HTMLButtonElement>('#nickSave')!;
    input.value = confirmedNickname();
    input.focus();
    input.select();
    let busy = false;
    const commit = async () => {
      if (busy) return;
      busy = true;
      save.disabled = true;
      const done = await setNickname(input.value);
      busy = false;
      save.disabled = false;
      if (!head.isConnected) return;
      if (done.ok) {
        msg.textContent = '';
        stopEditing();
        return;
      }
      msg.textContent = nicknameErrorText(done.reason, lang);
      input.focus();
    };
    save.addEventListener('click', () => void commit());
    editing.querySelector('#nickCancel')!.addEventListener('click', () => {
      msg.textContent = '';
      stopEditing();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        msg.textContent = '';
        stopEditing();
      }
    });
  };
  head.querySelector('#nickEdit')!.addEventListener('click', startEditing);

  // 服务器那一份到了（或者自动上传失败了）：这一格自己换。页面换走了就把自己摘掉。
  const off = onNicknameChange(() => {
    if (!head.isConnected) return off();
    if (!editing) show();
  });
}
