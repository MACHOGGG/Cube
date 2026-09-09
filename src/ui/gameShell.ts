import { STRINGS, type Lang } from '../i18n';
import { CTL_BACK, CTL_CVD, CTL_FINISH, CTL_LEAVE, CTL_PAUSE } from './ctlIcons';
import { currentRoom, iAmHost } from '../engine/room';
import { countFrom, playCountdown, startStageHtml } from './startStage';
import { colorblindOn, setColorblind } from '../engine/palettePref';
import { openRulesModal, type ExtraTipView } from './rulesModal';
import { landscapePlayed, markLandscapePlayed } from '../engine/landscapeSeen';
import { planFor, slotMachineHtml, spinSlot } from './slotReels';
import { menuTag } from './menuTags';
import { slotTip } from './modeTips';
import type { Family, TargetPattern } from '../engine/targets';

export interface ExtraControl {
  id: string;
  label: string;
}

/** 横屏里得分图示留在棋盘上方那一条的两个玩法：它们横过来是宽度吃满的，
 *  两边没有空当可用（菱形躺着的七色圆球、张开的 V 形进阶三角）。 */
const PATTERNS_ON_TOP = new Set(['circleSeven', 'triangleAdvanced']);

export interface ShellMeta {
  title: string;
  tagline: string;
  startBody: string;
  extraControls?: ExtraControl[];
  /** 这个玩法的得分图示，一枚一枚（engine/patternIcon.ts 的
   *  renderPatternHintIcons 画好的小图）。横屏时这一批会劈成两半贴到棋盘两
   *  边去，所以给的是一个数组而不是一整条 HTML。 */
  patternIcons?: string[];
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

  /**
   * 不数 4-3-2-1，直接开局。
   *
   * 只给小红书那一版的头一局小球用（玩家定的：「第一回合小球的版本里取消
   * 4-3-2-1 倒计时，之后其他的所有都保留只有这个取消」）。那一局是新来的人
   * 打开小工具看见的**第一屏**——他还不知道这是什么，先让他看见棋盘、看见
   * 棋盘底下那句话，比先让他等四秒管用。往后每一局照旧数。
   */
  noCountdown?: boolean;
  /** Every string on this screen is localized through STRINGS[lang]; the
   *  shapes pass in already-translated title/tagline/startBody. The long
   *  rules that used to sit under each board now live in one translated
   *  rulebook (rules.ts), opened from 个人主页 → 游戏规则. */
  lang: Lang;
  /** 炸弹局。开局页和战绩图上都会挂一个炸弹标志，让人一眼认出这是哪一种局
   *  ——同一副棋盘，有没有炸弹是两回事。 */
  bomb?: boolean;
  /** 这个玩法在主菜单上的 id（square / circleHex / …）。开局页摆的就是它在
   *  主菜单上的那张图——按下去的是哪个图形，倒数时看见的就是同一个。 */
  shapeId: string;
  /** 练习盘（见 ShapeGameOpts.practice）：外壳只剩棋盘，读数、按键、图示都不画。 */
  practice?: boolean;
  /** 计时局。开局页摆的换成主菜单上那只橙色秒表，也就是玩家刚刚按下的那张。 */
  timed?: boolean;
  /**
   * 无限反转那一局（见 ShapeGameOpts.flip）。开局页上摆的仍是玩家挑的那个图形
   * （不换成秒表——他按的不是计时卡），倒数底下多一块：无限反转的图标加一句
   * 话，说清这一局的计分和别的局不同（连击加成减弱、没有时间奖励）。
   */
  flip?: boolean;
  /**
   * 随机得分目标那一局转出来的两个图案。
   *
   * 给了它，开局页就换一副样子：上半屏是那台老虎机，三个滚筒当场从左到右
   * 转出这两个图案（外加最右边那个转出你挑的图形）；倒数从 5 数起，多出来
   * 的那一秒就是让轮子停完；底下只留《退出》——一场正在开的老虎机没有「暂
   * 停」这回事。见 ui/slotReels.ts。
   */
  slotTargets?: readonly TargetPattern[];
  /**
   * 头一局那块教学条（见 ui/coachBar.ts）。只有玩家头一回打开、被直接按进
   * 的那一局基础小球才给——棋盘底下多一块小圆角矩形，把六条规则一条一条摆
   * 出来。别的局一律没有：这块条子是给还没上手的人的。
   */
  coach?: boolean;
}

export interface ShellRefs {
  root: HTMLElement;
  boardWrap: HTMLElement;
  boardEl: HTMLElement;
  legendEl: HTMLElement;
  /** 头一局那块教学条的壳子；meta.coach 没开时是 null（那一局根本没画它）。 */
  coachEl: HTMLElement | null;
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
  /** 结算页上那张战绩图。开局那一刻还是空的，一局打完由 endGame 填上。 */
  endShareImgEl: HTMLImageElement;
  shareOverlay: HTMLElement;
  shareImageEl: HTMLImageElement;
  buttons: {
    /** 多人局里它藏着——同步竞赛暂停不了，那个位置让给了《离开小屋》。
     *  屋主散场、这一局转成单人之后它才露面。 */
    stop: HTMLButtonElement;
    /** 只有多人局才有：进行到一半也走得掉。由 scoreboard.ts 接上。 */
    leaveRoom?: HTMLButtonElement;
    /** 底排上那颗《完成》：只有小屋局有。单人局它搬进了暂停面板，见
     *  pauseFinish——两颗接的是同一个处理函数。 */
    finish?: HTMLButtonElement;
    /** 暂停面板里的《结束游戏》。哪一局都在（小屋局散场转单人之后也够得
     *  着），内容就是从前底排那颗《完成》。 */
    pauseFinish: HTMLButtonElement;
    /** 暂停面板里的《再来一局》：丢掉这一局，原地重开一局同样的玩法。 */
    pauseRestart: HTMLButtonElement;
    /** Absent in-game (the row has no way-out button any more — leaving a
     *  run goes through the title or the bottom nav, which ask first); the
     *  shape modules still wire it when it exists. */
    back?: HTMLButtonElement;
    start: HTMLButtonElement;
    continueBtn: HTMLButtonElement;
    restart: HTMLButtonElement;
    endBack: HTMLButtonElement;
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
const ROTATE_HINT = (copy: string | null) => `
  <div class="rotate-hint${copy ? '' : ' rotate-hint--bare'}">
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
    ${copy ? `<p class="rotate-hint-copy">${copy}</p>` : ''}
  </div>`;

// 那四颗圆盘搬去了 ctlIcons.ts——全站的《返回》现在也用同一颗，而那几页不
// 该为了一个图标把整个游戏外壳拖进来。这里再导出一遍，老的引用照旧
// （scripts/icon-sheet.mjs 从这个模块拿 CTL_PAUSE / CTL_FINISH）。
export { CTL_PAUSE, CTL_FINISH, CTL_LEAVE, CTL_BACK } from './ctlIcons';

/**
 * 认的是 id 的**前缀**，不是那三个基础 id。八副棋盘的 id 就是按家族起的：
 *
 *   square  squareDiamond                     → 方块家
 *   circle  circleHex  circleSeven            → 小球家
 *   triangle  triangleBig  triangleAdvanced   → 三角家
 *
 * 从前这儿写的是「square 归方块、circle 归小球、其余一律归三角」——菱形方块、
 * 六边形小球、七色圆球三副棋盘于是全被当成三角，暂停里的《怎么玩》第 4 条给
 * 他讲的是三角的说法（最少 3 个、消掉留下空三角），而他眼前那副棋盘消掉是直
 * 接拿走的。玩家一脸问号：是不是进错了玩法。
 *
 * 唯一要小心的是三角：主菜单上《三角》后面装的是 triangleBig.ts（它自己的 id
 * 叫 'triangle'），两个三角 2026-09 对调过。按前缀认就不受这件事影响。
 */
const familyOf = (shapeId: string): Family =>
  shapeId.startsWith('circle') ? 'circle' : shapeId.startsWith('triangle') ? 'triangle' : 'square';

/** 三个基础玩法的棋盘。除它们之外的都是「特殊布局」——格子怎么摆不一样，规矩
 *  一条没变（菱形方块、六边形小球、六边形三角、菱形小球、V 字三角）。 */
const BASE_BOARDS = new Set(['square', 'circle', 'triangle']);

export function buildShell(container: HTMLElement, meta: ShellMeta): ShellRefs {
  const s = STRINGS[meta.lang];
  // 问一次，下面画按钮和取按钮都用这一个答案——中途房间没了的话，两处各问
  // 各的就会一个画了、另一个取不到。
  const inRoom = !!currentRoom();
  const extraButtonsHtml = (meta.extraControls ?? [])
    .map((b) => `<button class="icon-btn" id="${b.id}">${b.label}</button>`)
    .join('');

  /**
   * 得分图示摆在哪儿。
   *
   * 竖屏：一条，在读数和棋盘中间，上下居中在那段空当里。
   * 横屏：劈成两半贴到棋盘左右两边，竖着排、上下居中——横屏里棋盘是被高度
   *   卡住的，图示占着上面那条就等于把棋盘压小一圈，而两边的空当反正也没
   *   人用。玩家自己定的：「这样游戏版图和游戏内的布局都可以放更大」。
   *
   * 两个例外，七色圆球和进阶三角：它们横过来是宽度吃满的（菱形躺着、V 形
   * 张开），两边根本没有空当，图示还得留在上面那条。
   *
   * 劈法是「前一半 + 后一半」，而且后一半在 DOM 里出现两次：一次在左边那
   * 条里（竖屏时它是完整的一条），一次单独作为右边那一条。谁露谁藏由 CSS
   * 决定——用 display:none 藏，所以读屏软件在任何一种排布下都只会念到一遍，
   * 不会重。这样劈的位置不用给 CSS，也就不用管每个玩法有几枚。
   */
  const icons = meta.patternIcons ?? [];
  const half = Math.ceil(icons.length / 2);
  const sides = icons.length > 1 && !PATTERNS_ON_TOP.has(meta.shapeId);
  const patternHtml = icons.length
    ? `<div class="pattern-hint pattern-hint--a">` +
      `<span class="ph-part">${icons.slice(0, half).join('')}</span>` +
      `<span class="ph-part ph-part--tail">${icons.slice(half).join('')}</span>` +
      `</div>` +
      (sides ? `<div class="pattern-hint pattern-hint--b">${icons.slice(half).join('')}</div>` : '')
    : '';

  // The landscape layout is one grid — readouts | board | buttons — and the
  // portrait one is the column it has always been. Both are the same DOM in
  // the same order; only the landscape media query's grid areas move the
  // pieces, so nothing re-renders when the phone turns.
  container.innerHTML = `
    <div class="app app--game${meta.wideBoard ? ' app-wide' : ''}${meta.landscape ? ' app--land-wide' : ''}${
      sides ? ' pattern-sides' : ''
    }${meta.practice ? ' app--practice' : ''}${meta.coach ? ' has-coach' : ''}" data-shape="${meta.shapeId}">
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

      ${patternHtml}

      <div class="board-wrap" id="boardWrap">
        <div class="board" id="board"></div>
      </div>

      <div class="legend" id="legend"></div>
      <!-- 头一局的教学条。空壳子先摆在这儿，内容由 coachBar.ts 填——它要跟着
           玩家做到哪一步换，不是画一次就完了。 -->
      ${meta.coach ? '<div class="coach-bar" id="coachBar" hidden></div>' : ''}

      <!-- 单人局这一排上只剩一颗《暂停》，占从前那一半的宽度、居中站着
           （玩家定的「底排②」）。《完成》搬进了暂停面板——玩家的原话：「把
           游戏界面中的暂停和完成全部放在暂停里（只保留现在的《暂停》）」。
           棋盘底下于是只剩一件事可按，别的都在那一层后面。

           小屋局的这一排是另一套，也是玩家单独定的：最重要的那一半留给实时
           排名（「一半位置还是留给实时排行榜」），另一半分给三颗小的——色盲
           友好、离开小屋、完成。《暂停》在这儿没有意义（一场同步竞赛停不下
           来，别人的钟不会跟着停），所以那一层里的《色盲友好》够不着，得在
           这一排上单摆一颗。 -->
      <div class="controls${inRoom ? ' controls--room' : ' controls--solo'}">
        ${inRoom
          ? `<div class="mp-rank" id="mpRank" aria-live="polite"></div>
             <!-- 房间局里《暂停》先藏着。屋主散场之后这一局原地转成单人，那
                  时候名单和《离开小屋》一起撤掉，它顶上来（见 scoreboard.ts
                  的 goSolo）。先造出来而不是事后插一颗：它的监听器是开局那一
                  刻接上的（gameController 的 refs.buttons.stop），事后新建的
                  按钮长得一样，却谁也不听。 -->
             <button class="icon-btn" id="stopBtn" aria-label="${s.pauseBtn}" hidden>${CTL_PAUSE}</button>
             <button class="icon-btn icon-btn--half" id="cvdRoomBtn" role="switch" aria-checked="false" aria-label="${s.colorblindBtn}">${CTL_CVD}</button>
             <button class="icon-btn icon-btn--half" id="leaveRoomBtn" aria-label="${
               iAmHost() ? s.mpDisbandRoom : s.mpLeave
             }">${CTL_LEAVE}</button>
             <button class="icon-btn icon-btn--half" id="finishBtn" aria-label="${s.finishBtn}">${CTL_FINISH}</button>`
          : `<button class="icon-btn" id="stopBtn" aria-label="${s.pauseBtn}">${CTL_PAUSE}</button>`}
      </div>
    </div>

    <!-- 开局页。没有标题也没有说明——上半屏那张图就是「你选的是这个玩法」，
         下半屏 3、2、1 数完直接开打。真正把一局叫起来的仍然是 #startBtn，只是
         现在它藏起来，由倒数替玩家按下去：这样游戏本身的开始/暂停/结束那套状
         态机一个字都不用改。 -->
    <div class="overlay opaque show overlay--start" id="startOverlay">
      ${startStageHtml({
        shapeId: meta.shapeId,
        bomb: meta.bomb,
        // 无限反转也是计时的，但开局页上摆的是他挑的那个图形，不是秒表。
        timed: meta.timed && !meta.flip,
        room: !!currentRoom(),
        countId: 'startCount',
        emblem: meta.slotTargets ? slotMachineHtml() : undefined,
        // 无限反转这一屏不再解释计分怎么算（玩家定的）。4-3-2-1 数完就开打，
        // 上半屏那张图已经说清「你选的是这个玩法」；连击底数、有没有时间奖
        // 励，是打完看结算页的事，不是站在开局线上要读的。
        extra: meta.landscape
            ? ROTATE_HINT(landscapePlayed() ? null : s.rotateHint)
            : '',
        // 老虎机那一局底下只留《退出》：轮子已经在转了，「暂停」停不住它，
        // 而这一幕本来就只有五秒。玩家的原话：「下面还是只有那个《退出》」。
        actions:
          `<button class="icon-btn start-act" id="startBackBtn" aria-label="${s.back}">${CTL_BACK}</button>` +
          (meta.slotTargets
            ? ''
            : `<button class="icon-btn start-act" id="startPauseBtn" aria-label="${s.pauseBtn}">${CTL_PAUSE}</button>`),
      })}
      <button id="startBtn" class="start-hidden-go" hidden aria-hidden="true" tabindex="-1">${s.startBtn}</button>
    </div>

    <!-- 暂停面板：从前只有一条色盲开关和一颗《继续》，现在四件事都收在这
         儿（玩家定的顺序：教学、色盲友好、再来一局、结束游戏）。

         分三组，看一眼就知道哪一颗把你带出这一局（玩家选的「方案 B」）：

           · 上面两条是「看一眼就回来」——《怎么玩》开一层弹窗，色盲友好是
             个开关，两条都不动这一局；
           · 中间一排是「离开这一局」，两颗并排：《再来一局》丢掉重开，
             《结束游戏》交卷去结算；
           · 最下面单独一颗《继续》，回棋盘。

         开局倒数那一屏也用这同一层（#startPauseBtn 打开、#continueBtn 接着
         数）。那时候还没开局，「再来一局 / 结束游戏」无从谈起——所以那条路上
         多挂一个 .pause--pre 把中间那一排藏起来，等真的开打、真的暂停了，
         gameController 的 doPause 再把它摘掉。 -->
    <div class="overlay opaque" id="pauseOverlay">
      <div class="modal">
        <h2>${s.pausedTitle}</h2>
        <!-- 局中也进得去的那一屏六条规则：和个人主页 / 小红书版《怎么玩》是
             同一份（ui/rulesModal.ts）。规则记不清的人不该为了看一眼而丢掉
             手上这一局。 -->
        <div class="btn-row">
          <button class="icon-btn pause-switch" id="howBtn">
            <span>${s.howToPlayBtn}</span>
            <span class="pause-chev" aria-hidden="true">›</span>
          </button>
        </div>
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
        <div class="btn-row pause-exits">
          <button class="secondary" id="pauseRestartBtn">${s.restartRunBtn}</button>
          <button class="secondary" id="pauseFinishBtn">${s.endRunBtn}</button>
        </div>
        <div class="btn-row pause-resume"><button class="primary" id="continueBtn">${s.resume}</button></div>
      </div>
    </div>

    <div class="overlay overlay--end" id="endOverlay">
      <div class="modal">
        <div class="end-hazard-bg" id="endHazardBg" aria-hidden="true">💥</div>
        <!-- 屋主中途散场、这一局转成单人接着打完的时候，小屋那份成绩摆在这
             儿：总排行和它的战绩图在上，底下才是这一局单人的结算和它自己那
             张图。平时是空的、藏着的（见 roomLeftover.ts）。 -->
        <div class="end-room" id="endRoomBlock" hidden></div>
        <h2 id="endTitle">${s.endTitleDefault}</h2>
        <div class="end-score-label">${s.compositeScoreLabel}</div>
        <div class="big-score" id="endScore">0</div>
        <!-- What this run was worth, set against what this mode is usually
             worth to this player — the one number that says whether it was a
             good run, without them having to remember their own history. -->
        <div class="end-avg" id="endAvg"></div>
        <div class="end-rule" aria-hidden="true"></div>
        <div class="end-breakdown" id="endBreakdown"></div>
        <!-- 这一局的战绩图，就摆在这儿——玩家定的：「整合分享和结算两部分」。
             从前这个位置是一行字（手动结束 · 共 N 步 · 用时 · 本机最佳）。那
             行字没丢：它本来就印在图上（shareCard.ts 画的 info.detail），所以
             这不是拿掉一件事，是让同一件事以看得见的样子出现。

             图是结算页露面之前就画好的（gameController 的 endGame），不是等
             玩家按了《分享》才画——不然这块地方会先空着、图落下来时整页跳一
             下。底下那句「长按或右键保存」是给网页版的；小红书版的容器把长按
             禁掉了，那一句在那儿是假话，由 xhs/src/main.ts 换成《发笔记》
             《存相册》两颗键。 -->
        <figure class="end-share" id="endShare" hidden>
          <img id="endShareImg" alt="${s.shareImgAlt}" />
          <figcaption class="hint" id="endShareHint">${s.shareHint}</figcaption>
        </figure>
        <div class="btn-row">
          <button class="secondary" id="endBackBtn">${s.homeBtn}</button>
          <button class="secondary" id="shareBtn">${s.shareBtn}</button>
          <button class="primary" id="restartBtn">${s.restartBtn}</button>
        </div>
      </div>
    </div>

    <div class="overlay overlay--wide" id="shareOverlay">
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

  // 色盲友好这一条有两颗开关：暂停面板里那条长的（单人局），和小屋局底排上
  // 那颗小的（小屋局按不了暂停，见控制条那段注释）。同一个设置，两处一起跟着
  // 变——按了哪一颗，另一颗的 aria-checked 也翻过来。
  const cvdBtns = Array.from(container.querySelectorAll<HTMLButtonElement>('#cvdBtn, #cvdRoomBtn'));
  const showCvd = () => {
    for (const b of cvdBtns) b.setAttribute('aria-checked', String(colorblindOn()));
  };
  showCvd();
  for (const b of cvdBtns) {
    b.addEventListener('click', () => {
      setColorblind(!colorblindOn());
      showCvd();
    });
  }

  // 暂停面板里的《怎么玩》：开的是全站同一屏六条规则（ui/rulesModal.ts）。有
  // 没有三角那一列由整包说了算（网页版有，小红书版在自己的 main.ts 里关
  // 掉），这儿不写死。关掉之后什么也不做——这一层还压在暂停面板上，玩家回到
  // 的正是他刚才那一屏。
  //
  // 这一屏认得出自己开在哪一局里（玩家的原话：「在每个游戏界面里的暂停里的怎
  // 么玩？教学中 都是针对这个玩法的内容……现在在基础玩法里的教学会带有特殊玩
  // 法的规则」）：
  //   shape  第 4 条换成这一族自己那一句——小球留空球、方块拿走不再出现、三角
  //          留空三角。局中他眼前只有一种图形，讲另外两种是白讲。
  //   tips   底下那几条附注只留当局那一条。基础局一条都没有，连那道分档的黑线
  //          也不画；炸弹局只有炸弹，老虎机局只有老虎机，如此类推。
  //
  // 摆的是「这一局比基础规矩多出来的每一层」，所以定时炸弹会摆两条（炸弹一
  // 条、计时一条）——它确实是两层。玩家 2026-09 点的名：老虎机 / 计时 / 特殊布
  // 局从前一条也没有，那三句只在头一回进去时在棋盘底下摆一局，看过就没了。
  container.querySelector<HTMLButtonElement>('#howBtn')?.addEventListener('click', () => {
    const tips: ExtraTipView[] = [];
    if (meta.bomb) tips.push({ key: 'bomb' });
    if (meta.flip) tips.push({ key: 'flip' });
    // 老虎机那一幅是当局现抽的两个得分图案，和读数条上那两个是同一份画法
    // ——换一张重画，等于让他自己去对。
    if (meta.slotTargets?.length) {
      tips.push({ key: 'slot', art: slotTip(meta.lang, meta.slotTargets).art });
    }
    // 无限反转也是 60 秒，可它那一条自己就带着「限时 60 秒」，不必再摆一条计时
    //（头上那个读数的显隐用的也是这同一个判断）。
    if (meta.timed && !meta.flip) tips.push({ key: 'timed' });
    // 特殊布局没有自己的那张卡，左边那个词就用这副棋盘自己的名字。
    if (!BASE_BOARDS.has(meta.shapeId)) {
      tips.push({ key: 'layout', label: menuTag(meta.lang, meta.shapeId) });
    }
    openRulesModal({
      lang: meta.lang,
      shape: familyOf(meta.shapeId),
      tips,
      // 无限反转局：第 4、5 条讲的事那一局不会发生（星星同色不消除、也不会全
      // 部翻成星星就结束），整条抽掉，剩下四条重新编号。
      omitRules: meta.flip ? [4, 5] : undefined,
    });
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

  // ---- 开局倒数 ---------------------------------------------------------
  //
  // 3、2、1 数完，替玩家按下那颗藏起来的 #startBtn——一局就这样开始，中间不
  // 需要谁再点一下。数到一半按《暂停》，倒数整个停住并弹出暂停面板；从暂停里
  // 回来时不是接着数，而是从头重新数：被打断之后剩下的那半秒不足以让人重新
  // 准备好。建议横着玩的那两个玩法从 4 数起——底下那句「把手机转过来」得有
  // 时间照做才算数（见 startStage.ts 的 countFrom）。
  const countWin = container.querySelector<HTMLElement>('#startCount');
  const startBtnEl = container.querySelector<HTMLButtonElement>('#startBtn');
  const pauseOv = container.querySelector<HTMLElement>('#pauseOverlay');
  // 老虎机那一局：倒数不马上开始，也先不露面——等第二个轮子停稳了再数
  //（玩家的原话：「最开始没有 5-4-3-2-1 的那个板块出现，等老虎机转出来第二
  // 个内容之后开始倒计时」）。下面的 runCount 交给 spinSlot 的 onSettled。
  let startCounting: (() => void) | null = null;
  if (meta.noCountdown && startBtnEl) {
    // 不数了，直接替他按下那颗藏起来的键。放在下一帧：这一屏此刻还没上树，
    // 现在按等于对着一块还没排版的 DOM 开局，棋盘会量出错的尺寸。
    requestAnimationFrame(() => {
      if (container.querySelector('#startOverlay')?.classList.contains('show')) startBtnEl.click();
    });
  } else if (countWin && startBtnEl) {
    let cancelCount: (() => void) | null = null;
    const runCount = () => {
      countWin.classList.remove('cd-window--waiting');
      cancelCount?.();
      cancelCount = playCountdown(countWin, () => {
        cancelCount = null;
        // 多人局是由房间那边数完之后直接开赛的（main.ts 会替所有人按下同一
        // 颗键），这一页从没露过面。倒数还在后台跑完就再按一次，等于开局三秒
        // 后把牌重发一遍——所以只有这一页还挂着的时候才算数。
        if (!container.querySelector('#startOverlay')?.classList.contains('show')) return;
        startBtnEl.click();
        // 老虎机那一局多数一个（5-4-3-2-1）——玩家定的。
      }, countFrom(meta.shapeId) + (meta.slotTargets ? 1 : 0));
    };
    container.querySelector<HTMLButtonElement>('#startPauseBtn')?.addEventListener('click', () => {
      cancelCount?.();
      cancelCount = null;
      pauseOv?.classList.add('show', 'pause--pre');
    });
    // 游戏本身的《继续》也挂在这颗键上，但那一路在没开局时会自己空转，所以两
    // 边可以共用，互不干扰。
    container.querySelector<HTMLButtonElement>('#continueBtn')?.addEventListener('click', () => {
      if (!container.querySelector('#startOverlay')?.classList.contains('show')) return;
      pauseOv?.classList.remove('show');
      runCount();
    });
    // 离开这一页（返回、或者整块 DOM 被换掉）时别再让计时器把人拽进游戏里。
    container.querySelector<HTMLButtonElement>('#startBackBtn')?.addEventListener('click', () => {
      cancelCount?.();
      cancelCount = null;
    });
    if (meta.slotTargets?.length) {
      countWin.classList.add('cd-window--waiting');
      startCounting = runCount;
    } else {
      runCount();
    }
  }

  // ---- 老虎机：开局页那台机器真的在转 -----------------------------------
  //
  // 结果在进这一页之前就抽好了（slotMachine.ts 的 drawPair），这里转的是给
  // 人看的那几秒：三个轮子从左到右先后停住，最后一个停完时倒数还剩一秒多，
  // 刚好够看清转出了什么。按《退出》就别转了——这块 DOM 马上要被换掉。
  if (meta.slotTargets?.length) {
    const stage = container.querySelector<HTMLElement>('#startOverlay');
    if (stage) {
      const stopSpin = spinSlot(stage, planFor(familyOf(meta.shapeId), meta.slotTargets, meta.lang), () => {
        // 第二个轮子停稳了：这时候倒数才露面、才开始数。人已经离开这一页
        // 的话什么都不做。
        if (!container.querySelector('#startOverlay')?.classList.contains('show')) return;
        startCounting?.();
      });
      container.querySelector<HTMLButtonElement>('#startBackBtn')?.addEventListener('click', stopSpin);
    }
  }

  // ---- 「这个人已经横着玩过了」-----------------------------------------
  //
  // 记的是真的横着玩过一局，不是见过开局页那句提示——开局页还挂着的时候不
  // 算数，那会儿人只是在看提示，手机还没转。所以两个时刻各打一次点：一局
  // 开起来时屏幕已经是横的，或者局中把手机转横了。之后那句话就不再出现，
  // 只留下转手机的动画（见 engine/landscapeSeen.ts）。
  if (meta.landscape) {
    const land = window.matchMedia('(orientation: landscape)');
    const noteLandscape = () => {
      // 这块 DOM 已经被换掉了（离开了这一局）——顺手把自己摘掉，免得每进一
      // 局就多挂一个监听器。
      if (!document.contains(container)) return land.removeEventListener('change', noteLandscape);
      if (!land.matches) return;
      if (container.querySelector('#startOverlay')?.classList.contains('show')) return;
      markLandscapePlayed();
    };
    land.addEventListener('change', noteLandscape);
    // 开局那一下：#startBtn 按下之后开局页才收起来，所以等下一帧再看。
    startBtnEl?.addEventListener('click', () => requestAnimationFrame(noteLandscape));
  }

  return {
    root: container,
    boardWrap: req('boardWrap'),
    boardEl: req('board'),
    legendEl: req('legend'),
    coachEl: container.querySelector<HTMLElement>('#coachBar'),
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
    endShareImgEl: req<HTMLImageElement>('endShareImg'),
    shareOverlay: req('shareOverlay'),
    shareImageEl: req('shareImage'),
    buttons: {
      // 房间局里它也在，只是藏着——散场转单人的时候才露面，所以监听器必须
      // 在开局那一刻就接上（见上面控制条里的注释）。
      stop: req<HTMLButtonElement>('stopBtn'),
      leaveRoom: inRoom ? req<HTMLButtonElement>('leaveRoomBtn') : undefined,
      // 单人局底排上没有《完成》了（它进了暂停面板），所以这儿是 query 不是
      // req——小屋局才找得到。
      finish: container.querySelector<HTMLButtonElement>('#finishBtn') ?? undefined,
      pauseFinish: req('pauseFinishBtn'),
      pauseRestart: req('pauseRestartBtn'),
      back: undefined,
      start: req('startBtn'),
      continueBtn: req('continueBtn'),
      restart: req('restartBtn'),
      endBack: req('endBackBtn'),
      startBack: req('startBackBtn'),
      share: req('shareBtn'),
      shareClose: req('shareCloseBtn'),
      extra,
    },
  };
}
