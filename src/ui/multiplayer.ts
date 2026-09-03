import { STRINGS, type Lang } from '../i18n';
import { isGenius } from '../engine/subscription';
import { countFrom, pushDigit, startStageHtml } from './startStage';
import { hostNotice, hostTroubleIn, tickFor, type HostNotice } from './roomNotices';
import { confirmLeaveRoom } from './confirmLeaveRoom';
import { PLAYER_NAME_KEY } from '../engine/cloudScores';
import { ICON_DOOR_WHITE, ICON_LOCK } from './homeIcons';
import { CTL_BACK } from './ctlIcons';
import { geniusLogoTag } from './geniusLogo';
import { mountTitleRain, type TitleRain } from './titleRain';
import { custom } from './customIcons';
import { shapeName } from './shapeLabels';
import { hasSeenTutorial, type TutorialShape } from '../i18n';
import {
  avatarSvg,
  createRoom,
  currentRoom,
  endRoom,
  fetchState,
  forgetRoom,
  joinRoom,
  leaveRoom,
  randomAvatar,
  serverTime,
  watchRoom,
  type Avatar,
  type RoomError,
  type RoomState,
  lastPlayedRound,
  markRoundPlayed,
  nudgeHost,
  setLearning,
} from '../engine/room';

/**
 * 多人游玩 — a four-digit room, two to four players, one board between them.
 *
 * The page is three screens in one: choosing who you are, waiting in the
 * room, and the countdown. They share a container and a single poll, because
 * what moves between them is the room's own state arriving from the server:
 * a player joins and the list grows; the host picks a board and `startAt`
 * appears; the countdown reaches zero and the run begins.
 *
 * A room is an evening rather than a single game. When a round ends everyone
 * comes back here with the scores still up, and the host either puts another
 * board in front of the table or closes the room, which is when the closing
 * card is drawn.
 *
 * The host picks that board on the home page, not here: all eight of them
 * live there already, with their icons, at the size a thumb wants. While
 * they are away choosing, the whole screen wears a faint pink frame — it is
 * the only thing on the home page that says this tap is for four people
 * rather than for you.
 *
 * Nothing here waits for a message at the moment it matters. The server
 * names an instant and each device counts down to it against the server's
 * clock rather than its own, so four phones say "go" together even if one of
 * them thinks it is Tuesday.
 */

export interface MatchStart {
  mode: string;
  seed: string;
  /** 随机得分目标那一局：'same' 全屋同一对图案，'own' 各转各的。 */
  slot?: 'same' | 'own' | null;
}

export interface MultiplayerHandlers {
  onBack: () => void;
  /** The countdown has run out: deal the seeded board and race. */
  onMatchStart: (match: MatchStart) => void;
  /** Opening a room is the subscriber's — this shows them what that is. */
  onNeedGenius: () => void;
  /** The host is off to the home page to choose what everyone plays. */
  onPickMode: (code: string) => void;
  /** The room is closed: hand over the standings for the closing card. */
  onRoomEnded: (state: RoomState) => void;
  /**
   * 这个人说他不会规则：放这一族的教学给他看，看完了回小屋。
   *
   * 教学会把整页占掉，所以这一页（连同它的轮询）就此拆掉——回来走的是
   * showMultiplayer 那条「已经在屋里就接着往下走」的路。
   */
  onLearnTutorial: (shape: TutorialShape) => void;
}

/** 一个玩法归哪一族的教学。布局变体没有自己的课，跟着它那一族走。 */
function tutorialFamilyOf(mode: string): TutorialShape | null {
  if (mode.startsWith('square')) return 'square';
  if (mode.startsWith('circle')) return 'circle';
  if (mode.startsWith('triangle')) return 'triangle';
  return null;
}

/** 问「会不会规则」给多久。到点没人按，就当他会。 */
const KNOW_ASK_MS = 4000;

const NAME_KEY = PLAYER_NAME_KEY;

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function errorText(reason: RoomError, lang: Lang): string {
  const s = STRINGS[lang];
  switch (reason) {
    case 'geniusOnly':
      return s.mpNeedGenius;
    case 'noRoom':
      return s.mpErrNoRoom;
    case 'full':
      return s.mpErrFull;
    case 'started':
      return s.mpErrStarted;
    case 'tooFew':
      return s.mpErrTooFew;
    case 'ended':
      return s.mpErrEnded;
    case 'notConfigured':
    case 'busy':
      return s.mpErrNotOpen;
    default:
      return s.purchaseNetwork;
  }
}

/**
 * Renders the page and returns its teardown. The caller must keep that and
 * call it: the room is polled while this is on screen, and a timer left
 * running would go on asking about a room nobody is looking at.
 */
export function renderMultiplayerPage(
  container: HTMLElement,
  handlers: MultiplayerHandlers,
  lang: Lang,
): () => void {
  const s = STRINGS[lang];
  let avatar: Avatar = randomAvatar();
  let stopWatching: (() => void) | null = null;
  let countdownTimer = 0;
  /**
   * The last round this device actually played.
   *
   * `startAt` stays set after a round finishes — it is what that round
   * began at — so it cannot be what decides whether to count down. The
   * round number can: a round we have already played never starts again.
   *
   * 它存在 sessionStorage 里，不在这个闭包里：每次回到房间页，这个函数都是
   * 新跑一遍，闭包里的数字会归零。归零之后服务器说的「第 1 局」大于 0，刚打
   * 完的那一局就会被当成新的一局重开——人回到一块已经结束的棋盘上，再点主页
   * 又重来一次，出不去。座位当初也是栽在同一件事上。
   */
  let playedRound = lastPlayedRound();
  let launched = false;
  let dead = false;

  /** 屋主出状况时盖上去的那一层，见 roomNotices.ts。 */
  let notice: HostNotice | null = null;
  /** 被催的时候往标题框里掉东西的那块画布（只有屋主挂）。 */
  let rain: TitleRain | null = null;
  /**
   * 上一次看到的催促计数。
   *
   * 初值是 -1「还没看过」：进小屋页的第一次轮询只是把数字记下来，不掉东西。
   * 否则屋主去主菜单挑玩法、回来的时候，这段时间里攒下的每一下会一次性砸
   * 满整个框——那不是「有人在催」，那是一堵墙。
   */
  let seenNudges = -1;
  /** 这一局的「会不会规则」已经问过了——每局只问一次，问完不再挡路。 */
  let askedRound = -1;
  /** 《会不会规则》那一问正挂着。 */
  let asking = false;
  /** 「有人在学，稍等」那一屏已经画上了，别每次轮询都重画一遍。 */
  let waitingOnLearner = false;
  const stopAll = () => {
    stopWatching?.();
    stopWatching = null;
    window.clearInterval(countdownTimer);
    countdownTimer = 0;
    notice?.remove();
    notice = null;
    rain?.stop();
    rain = null;
    seenNudges = -1;
    waitingOnLearner = false;
  };
  const teardown = () => {
    dead = true;
    stopAll();
  };

  const savedName = (() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  })();

  // ---- screen 1: who you are, and which room ---------------------------

  function renderHome(message = '') {
    stopAll();
    // 开房间是订阅（或内部码）才有的事，所以那块天才招牌一直挂着——它说的是
    // 「这件事属于天才」，对已经开通的人同样成立：那是他才有的权利。
    // 变的只有那把锁：还没开通的人才看得到它，按下去弹订阅那一页；开通了的
    // 人只剩招牌，按下去直接开房。
    const needsGenius = !isGenius();
    container.innerHTML = `
      <div class="app mp-page">
        <header class="home-head">
          <div class="home-head-glass">
            <h1 class="home-title">Slides</h1>
            <p class="home-sub">${s.mpTitle}</p>
          </div>
        </header>
        <p class="tag-line">${s.mpIntro}</p>

        <!-- 换一个图形的按钮，就贴着那个图形——它换的是它，摆在名字另一头
             的时候没人看得出这两样东西是一回事。 -->
        <div class="mp-me">
          <div class="mp-mark">
            <span class="mp-avatar" id="mpAvatar">${avatarSvg(avatar)}</span>
            <button class="mp-shuffle" id="mpShuffle" aria-label="${s.mpShuffle}">&#8635;</button>
          </div>
          <label class="auth-field mp-name-field">
            <span>${s.mpNameLabel}</span>
            <input id="mpName" type="text" maxlength="12" autocomplete="nickname"
                   placeholder="${s.mpNamePlaceholder}" value="${esc(savedName)}" />
          </label>
        </div>

        <p class="auth-msg" id="mpMsg" role="status">${message}</p>

        <button class="genius-cta genius-cta--crest${needsGenius ? ' genius-cta--locked' : ''}" id="mpCreate">
          ${needsGenius ? `<span class="cta-lock">${ICON_LOCK}</span>` : ''}
          <span>${s.mpCreate}</span>
          ${geniusLogoTag(40, 'genius-logo--cta')}
        </button>
        <!-- 上面是「自己开一间」，下面是「进别人开的」。这条线把两件事分开——
             底下那句《加入 Slides 天才搭建的小屋》说的其实是下半段的事，
             所以线画在按钮和它中间，而不是画在它下面。 -->
        <hr class="mp-rule" />
        <p class="auth-hint auth-hint--center">${s.mpNeedGenius}</p>

        <!-- Four digits read off someone else's screen deserve the room the
             room code itself gets: its own line, at a size that can be
             checked at a glance against the phone being read from. -->
        <div class="mp-join-block">
          <label class="auth-field mp-code-field">
            <span>${s.mpCodeLabel}</span>
            <input id="mpCode" type="text" inputmode="numeric" maxlength="4"
                   autocomplete="off" placeholder="${s.mpCodePlaceholder}" />
          </label>
          <!-- 《加入小屋》不写字了，就摆主菜单上那扇门的纯白版——玩家的
               原话：「《加入小屋》改称一个白色小门的标识」。名字留在
               aria-label 里给读屏软件。 -->
          <button class="profile-pill mp-join-door" id="mpJoin" aria-label="${s.mpJoin}">${ICON_DOOR_WHITE}</button>
        </div>

        <!-- 全站的《返回》都是同一颗圆盘（见 ui/ctlIcons.ts）。 -->
        <div class="page-back-row"><button class="icon-btn page-back" id="mpBack" aria-label="${s.back}">${CTL_BACK}</button></div>
      </div>
    `;

    const nameBox = container.querySelector<HTMLInputElement>('#mpName')!;
    const codeBox = container.querySelector<HTMLInputElement>('#mpCode')!;
    const msg = container.querySelector<HTMLElement>('#mpMsg')!;

    const myName = () => nameBox.value.trim().slice(0, 12) || s.mpNamePlaceholder;
    const remember = () => {
      try {
        localStorage.setItem(NAME_KEY, nameBox.value.trim().slice(0, 12));
      } catch {
        // A name that cannot be remembered is simply typed again next time.
      }
    };

    container.querySelector<HTMLButtonElement>('#mpShuffle')!.addEventListener('click', () => {
      avatar = randomAvatar();
      const slot = container.querySelector<HTMLElement>('#mpAvatar');
      if (slot) slot.innerHTML = avatarSvg(avatar);
    });

    container.querySelector<HTMLButtonElement>('#mpCreate')!.addEventListener('click', async () => {
      // Checked here as well as on the server, so the answer is the paywall
      // rather than an error message.
      if (!isGenius()) return handlers.onNeedGenius();
      remember();
      msg.textContent = s.workingLabel;
      const made = await createRoom(myName(), avatar);
      if (dead) return;
      if (!made.ok) return void (msg.textContent = errorText(made.reason, lang));
      renderLobby(made.value);
    });

    container.querySelector<HTMLButtonElement>('#mpJoin')!.addEventListener('click', async () => {
      const code = codeBox.value.trim();
      if (!/^\d{4}$/.test(code)) return void (msg.textContent = s.mpErrNoRoom);
      remember();
      msg.textContent = s.workingLabel;
      const joined = await joinRoom(code, myName(), avatar);
      if (dead) return;
      if (!joined.ok) return void (msg.textContent = errorText(joined.reason, lang));
      renderLobby(joined.value);
    });

    // Digits only, so a stray letter never sits in the box looking like a
    // room that does not exist.
    codeBox.addEventListener('input', () => {
      const digits = codeBox.value.replace(/\D/g, '').slice(0, 4);
      if (digits !== codeBox.value) codeBox.value = digits;
    });
    codeBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') container.querySelector<HTMLButtonElement>('#mpJoin')?.click();
    });
    container.querySelector<HTMLButtonElement>('#mpBack')!.addEventListener('click', handlers.onBack);
  }

  // ---- screen 2: the room ----------------------------------------------

  function renderLobby(state: RoomState) {
    stopAll();
    // Whether *we* host it, not merely whether the room has a host.
    const iAmHost = Boolean(state.host) && currentRoom()?.playerId === state.host;
    container.innerHTML = `
      <div class="app mp-page">
        <header class="home-head">
          <div class="home-head-glass">
            <h1 class="home-title">Slides</h1>
            <p class="home-sub">${s.mpTitle}</p>
          </div>
        </header>

        <div class="mp-code-card">
          <div class="menu-section-label">${s.mpRoomCode}</div>
          <div class="mp-code">${state.code}</div>
          <p class="auth-hint">${s.mpShareHint}</p>
        </div>

        <div class="menu-section-label" id="mpPlayersLabel">${s.mpPlayers}</div>
        <div class="mp-players" id="mpPlayers"></div>

        <div id="mpHostArea"></div>
        <p class="auth-msg" id="mpMsg" role="status"></p>

        <button class="profile-row profile-row--back" id="mpLeave">${
          iAmHost ? s.mpDisbandRoom : s.mpLeave
        }</button>
      </div>
    `;
    // 屋主按的是《解散小屋》：先把屋子关掉（屋里其他人手上会亮起那张总战绩
    // 图），再把自己的座位交回去。分成两颗键的时候，屋主按了《离开小屋》就
    // 只是自己走人，剩下的人干坐在一间永远开不了下一局的屋里——对他来说这
    // 两件事从来就是一件。
    //
    // 打过局的，屋主自己也看那张总战绩图（这原是《结束小屋》做的事）；一局
    // 都没打就散场的，图上全是 0，不如直接退回多人设置页。
    const leave = async () => {
      stopAll();
      if (!iAmHost) {
        await leaveRoom();
        if (!dead) renderHome();
        return;
      }
      const closed = await endRoom();
      const card = closed.ok && closed.value.round ? closed.value : null;
      // 屋主不发 leave：屋子已经关了，再补一条「他走了」只会在别人手上那张
      // 总战绩图里，把屋主自己标成中途离席的人。座位在本机上忘掉就够了。
      forgetRoom();
      if (dead) return;
      if (card) return handlers.onRoomEnded(card);
      renderHome();
    };
    container.querySelector<HTMLButtonElement>('#mpLeave')!.addEventListener('click', () => {
      // Only the host is warned, because only the host's leaving costs the
      // others anything: the server writes 屋主 once when the room opens and
      // has no way to hand it on, so a room whose host has gone can still be
      // sat in and can never start another round. Everyone else may go
      // without ceremony.
      // 客人和屋主都要问一句，只是问的话不一样（见 confirmLeaveRoom）。
      confirmLeaveRoom(lang, leave);
    });

    // 只有屋主的标题框会下雨——催的就是他。
    if (iAmHost) {
      const glass = container.querySelector<HTMLElement>('.home-head-glass');
      if (glass) rain = mountTitleRain(glass);
    }

    paint(state, iAmHost);
    soakNudges(state, iAmHost);

    // 屋主走了、还是屋主卡住了。这一页上也要分得清：坐在房间里等下一局的
    // 人，和正在打的人一样有权知道自己在等的是什么。
    notice?.remove();
    notice = hostNotice(lang, {
      onDismiss: () => {
        stopAll();
        forgetRoom();
        if (!dead) renderHome();
      },
      onLeave: () => confirmLeaveRoom(lang, leave),
    });

    stopWatching = watchRoom(
      (next) => {
        if (dead) return;
        // The host closed up while we were sitting here.
        if (next.ended) {
          stopAll();
          return handlers.onRoomEnded(next);
        }
        notice?.set(hostTroubleIn(next, iAmHost));
        paint(next, iAmHost);
        soakNudges(next, iAmHost);
        // The host has chosen: everyone counts down to the same instant.
        if (next.startAt && next.seed && next.mode && next.round > playedRound) {
          // 三道关，顺序是有讲究的：
          // 1. 我自己会不会这个玩法——不会就去看教学，别人等我；
          // 2. 屋里还有没有别人在学——有就一起等；
          // 3. 都齐了，才数 4-3-2-1。
          if (askKnowsRules(next)) return;
          // 问句还挂着：这一轮什么都不做。服务器那头我是「在学」，别人在等。
          if (asking) return;
          if (next.players.some((p) => p.learning)) {
            // 数到一半有人说他不会：把数字收起来，换成「稍等」。倒数不是
            // 承诺，是一段可以退回去的路。
            cancelCountdown();
            return showLearningWait();
          }
          waitingOnLearner = false;
          beginCountdown(next);
        }
      },
      (reason) => {
        // 轮询本来就会偶尔掉一次。房间还在屏幕上，比分也还在，所以这里
        // 只说一句话，不重画、更不清身份。
        const msg = container.querySelector<HTMLElement>('#mpMsg');
        if (!msg) return;
        msg.textContent =
          reason === 'noRoom' || reason === 'ended'
            ? errorText(reason, lang)
            : s.mpReconnecting;
      },
    );
  }

  function paint(state: RoomState, iAmHost: boolean) {
    paintPlayers(state);
    paintHostArea(state, iAmHost);
  }

  /**
   * 有人催了几下，就往标题框里掉几个。
   *
   * 只看差值，不看绝对值：服务器上那个数只增不减，它记的是「这间小屋一共被
   * 催了多少下」，而这里要的是「刚刚又被催了几下」。
   */
  function soakNudges(state: RoomState, iAmHost: boolean) {
    const now = state.nudges || 0;
    if (!iAmHost || !rain) {
      seenNudges = now;
      return;
    }
    if (seenNudges < 0) {
      seenNudges = now;   // 第一次看见，只记不掉
      return;
    }
    const fresh = now - seenNudges;
    seenNudges = now;
    if (fresh <= 0) return;
    // 一颗一颗掉，摊在这一轮轮询的间隔里：按得越密掉得越密，而不是一次倒出
    // 一批（玩家的原话：「按点击频率逐个掉，不按批次」）。一轮最多十二颗——
    // 再多就是在刷屏，看不出频率了。
    const count = Math.min(12, fresh);
    const gap = 1000 / count;
    for (let k = 0; k < count; k++) {
      window.setTimeout(() => {
        if (!dead && rain) rain.drop(1);
      }, Math.round(k * gap));
    }
  }

  /**
   * The table. Between rounds this is also the scoreboard, so it carries the
   * running total as well as the round just played — that is what everyone
   * looks at while the host decides what is next.
   */
  function paintPlayers(state: RoomState) {
    const label = container.querySelector<HTMLElement>('#mpPlayersLabel');
    if (label) {
      label.textContent = state.round
        ? `${s.mpPlayers} · ${s.mpRoundLabel.replace('{n}', String(state.round))}`
        : s.mpPlayers;
    }
    const list = container.querySelector<HTMLElement>('#mpPlayers');
    if (!list) return;
    const played = state.round > 0;
    list.innerHTML = state.players
      .map(
        (p) => `<div class="mp-player${p.left ? ' mp-player--left' : ''}">
          <span class="mp-avatar">${avatarSvg(p.avatar)}</span>
          <span class="mp-player-name">${esc(p.name)}</span>
          ${p.isHost ? `<span class="mp-badge">${s.mpHostBadge}</span>` : ''}
          ${p.left ? `<span class="mp-badge mp-badge--left">${s.mpLeftTag}</span>` : tickFor(p.finished, s.mpFinished)}
          ${played ? `<span class="mp-player-total">${p.total + p.score}</span>` : ''}
        </div>`,
      )
      .join('');
  }

  /**
   * What the room is waiting on. For everyone but the host that is a line of
   * text; for the host it is the trip to the home page and, once a round has
   * been played, the way to close the room.
   */
  function paintHostArea(state: RoomState, iAmHost: boolean) {
    const area = container.querySelector<HTMLElement>('#mpHostArea');
    if (!area) return;
    // Mid-round — nothing to decide until everyone is back.
    if (state.round > 0 && !state.roundOver) {
      if (area.dataset.shape === 'mid') return;
      area.dataset.shape = 'mid';
      area.innerHTML = `<p class="tag-line">${s.mpWaitingHost}</p>`;
      return;
    }
    if (!iAmHost) {
      // 客人在小屋里能做的只有两件事：催，或者走。所以这一块就只有这一颗键，
      // 底下那颗《离开小屋》是另一件。原先这里是一行「等屋主挑玩法」的字——
      // 说的是实话，但等的人手上一件事都没有。
      if (area.dataset.shape === 'nudge') return;
      area.dataset.shape = 'nudge';
      area.innerHTML = `<button class="genius-cta" id="mpNudge">${s.mpNudge}</button>`;
      area.querySelector<HTMLButtonElement>('#mpNudge')!.addEventListener('click', () => {
        // 不等回包、不改按钮状态：催是一件可以连着按的事，按下去就该像按下去。
        void nudgeHost();
      });
      return;
    }
    const pickLabel = state.round ? s.mpNextRound : s.mpGoPick;
    // Rebuilt only when what it says has changed, so the poll cannot swallow
    // a tap that has already landed.
    if (area.dataset.shape === pickLabel) return;
    area.dataset.shape = pickLabel;
    area.innerHTML = `
      <button class="genius-cta" id="mpPick">${pickLabel}</button>
    `;
    area.querySelector<HTMLButtonElement>('#mpPick')!.addEventListener('click', () => {
      stopAll();
      handlers.onPickMode(state.code);
    });
  }

  /**
   * 连不上，但座位还在。
   *
   * 这一屏没有「返回」——按下去就等于放弃座位，而这恰恰是它要避免的事。
   * 它自己每三秒再试一次，通了就直接进房间；真的不想等了，关掉页面就行。
   */
  function renderReconnecting() {
    stopAll();
    container.innerHTML = `
      <div class="app mp-page mp-wait-page">
        <p class="tag-line">${s.mpReconnecting}</p>
        <p class="auth-hint" id="mpReconnectHint"></p>
      </div>
    `;
    const hint = container.querySelector<HTMLElement>('#mpReconnectHint')!;
    let tries = 0;
    const again = async () => {
      if (dead) return;
      tries++;
      hint.textContent = `${tries}`;
      const now = await fetchState();
      if (dead) return;
      if (now.ok) {
        if (now.value.ended) {
          forgetRoom();
          return renderHome(s.mpRoomEnded);
        }
        if (now.value.roundOver) markRoundPlayed(now.value.round);
        playedRound = Math.max(playedRound, lastPlayedRound());
        return renderLobby(now.value);
      }
      if (now.reason === 'noRoom' || now.reason === 'ended') {
        forgetRoom();
        return renderHome(s.mpErrNoRoom);
      }
      countdownTimer = window.setTimeout(again, 3000) as unknown as number;
    };
    void again();
  }

  // ---- screen 3: 4, 3, 2, 1 --------------------------------------------

  /**
   * 开局倒数那几秒里，屏幕下半截放着现在的排名和每个人的总分，自己那一行
   * 标出来。
   *
   * 只在打过至少一局、并且真有人得过分之后才出现：第一局开赛前所有人都是
   * 0，一张全零的表说不出任何事情，只会把倒数那一幕挤窄。
   *
   * 它是一张定格，不跟着刷新——倒数这几秒里 stopAll() 已经把轮询停了，而且
   * 这段时间谁的分也不会变。
   */
  function standingsStrip(state: RoomState): string {
    const ranked = [...state.players].sort(
      (a, b) => b.total + b.score - (a.total + a.score) || b.best - a.best,
    );
    if (state.round < 1 || !ranked.some((p) => p.total + p.score > 0)) return '';
    const meId = currentRoom()?.playerId;
    const rows = ranked
      .map(
        (p, i) => `<div class="mp-cd-row${meId && p.id === meId ? ' mp-cd-row--me' : ''}${
          p.left ? ' mp-cd-row--left' : ''
        }">
          <span class="mp-cd-rank">${i + 1}</span>
          <span class="mp-cd-name">${esc(p.name)}</span>
          <span class="mp-cd-score">${p.total + p.score}</span>
        </div>`,
      )
      .join('');
    return `<div class="mp-cd-board" aria-label="${s.mpStandings}">
      <div class="mp-cd-title">${s.mpRoomTotal}</div>${rows}</div>`;
  }

  /**
   * 开局前那一句：「会 XXX 的规则吗？」
   *
   * 只问没看过这一族教学的人，而且一局只问一次。四秒内不按就当他会——问题
   * 本身不该变成一道卡住整屋的门；真不会的人会去按那颗，而按不下去的原因
   * 通常是他正好没在看屏幕，那按「会」是对的。
   *
   * 回 true 表示「这一关我接管了」：调用处就此打住，不去数数。
   */
  function askKnowsRules(state: RoomState): boolean {
    if (askedRound === state.round) return false;
    const family = state.mode ? tutorialFamilyOf(state.mode) : null;
    if (!family || hasSeenTutorial(family)) {
      askedRound = state.round;
      return false;
    }
    askedRound = state.round;

    // 问的这几秒里全屋等我——和「去看教学」走同一条路：先向服务器报一声
    // 「我在学」，别人那边立刻变成「稍等」，开赛时刻等我答完再重新盖一遍。
    // 原来这一问只是本机上盖了一层，服务器那头的开赛时刻照走、下一次轮询就
    // 在这层底下把倒数数起来了；答得慢一点，牌已经在底下开了。
    asking = true;
    void setLearning(true);
    const name = shapeName(lang, state.mode ?? '', family);
    const box = document.createElement('div');
    box.className = 'overlay opaque show';
    box.id = 'mpKnowAsk';
    box.innerHTML = `
      <div class="start-stage">
        <p class="tag-line">${s.mpKnowRules.replace('{name}', name)}</p>
        <div class="start-actions">
          <button class="icon-btn start-act" id="mpKnowNo">${s.mpKnowNo}</button>
          <button class="icon-btn start-act" id="mpKnowYes">${s.mpKnowYes}</button>
        </div>
        <p class="auth-hint" id="mpKnowTick"></p>
      </div>
    `;
    document.body.appendChild(box);

    let timer = 0;
    const close = () => {
      window.clearInterval(timer);
      box.remove();
      asking = false;
    };
    // 说「会」（或者没答，时间到了）：向服务器销掉「我在学」。最后一个销掉
    // 的人会让服务器把开赛时刻重新盖一遍，全屋一起从头数——见 api/room.js
    // 的 learn。
    const knows = () => {
      close();
      void setLearning(false);
    };
    box.querySelector<HTMLButtonElement>('#mpKnowYes')!.addEventListener('click', knows);
    box.querySelector<HTMLButtonElement>('#mpKnowNo')!.addEventListener('click', () => {
      close();
      void goLearn(family);
    });

    const until = Date.now() + KNOW_ASK_MS;
    const tick = box.querySelector<HTMLElement>('#mpKnowTick')!;
    const paint = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      tick.textContent = left > 0 ? String(left) : '';
      if (left <= 0) knows();
    };
    paint();
    timer = window.setInterval(paint, 200);
    return true;
  }

  /**
   * 去看教学。先告诉服务器「我在学」——别人那边立刻看到「有人在学习，稍等」，
   * 开赛时刻等我学完再重新盖一遍。
   */
  async function goLearn(family: TutorialShape) {
    await setLearning(true);
    if (dead) return;
    stopAll();
    handlers.onLearnTutorial(family);
  }

  /**
   * 屋里有人在学，其他人看到的那一屏。
   *
   * 和开局那一幕同一个身架：上半屏这一局的玩法图，中间原本放 4-3-2-1 的位置
   * 换成一句话，底下是那只转圈的标识。轮询不停——它就是这一屏等的东西。
   */
  function showLearningWait() {
    if (waitingOnLearner) return;
    waitingOnLearner = true;
    rain?.stop();
    rain = null;
    const spinner = custom('mp-loading') ?? '';
    container.innerHTML = `
      <div class="app mp-page mp-countdown-page mp-learn-page">
        <div class="start-stage mp-learn-stage">
          <p class="tag-line mp-learn-line">${s.mpLearningWait}</p>
          <div class="mp-learn-spin">${spinner}</div>
        </div>
      </div>
    `;
  }

  /** 把倒数收回去（有人临时说他不会规则）。轮询不动——它正是等的那件事。 */
  function cancelCountdown() {
    window.clearInterval(countdownTimer);
    countdownTimer = 0;
    launched = false;
  }

  function beginCountdown(state: RoomState) {
    if (launched || !state.startAt || !state.seed || !state.mode) return;
    launched = true;
    // playedRound 要等真开局那一刻才记，不能在这儿记。
    //
    // 上面那道关卡看的是 next.round > playedRound；在这里就把它记上，等于
    // 一开始数数就把自己关在门外——数到一半有人说他不会规则，轮询照样收得
    // 到，却再也走不进那道关，于是数到 0 照常开局，把还在看教学的人一个人
    // 留在后面。
    const round = state.round;
    // 只收自己的东西，不停轮询。
    //
    // 从前这里是 stopAll()：数字一开始跳，这台设备就不再问服务器了。于是
    // 「屋里有人临时说他不会规则」这件事根本传不进来——屋主那边照样数到 0
    // 就开局，把还在看教学的人一个人留在后面。倒数这几秒恰恰是最需要听着的
    // 几秒。
    window.clearInterval(countdownTimer);
    countdownTimer = 0;
    rain?.stop();
    rain = null;
    const { startAt, seed, mode } = state;

    // 和单人开局页是同一幕：上半屏这一局的玩法图（旁边挂着那扇小门，说明这是
    // 一场竞赛），下半屏 4、3、2、1。区别只在谁在数——这里数的是服务器给的开
    // 赛时刻，不是本地的秒表，所有人的数字才会同时跳。
    container.innerHTML = `
      <div class="app mp-page mp-countdown-page">
        ${startStageHtml({
          shapeId: mode,
          room: true,
          countId: 'mpTick',
          extra: standingsStrip(state),
        })}
      </div>
    `;
    const tickEl = container.querySelector<HTMLElement>('#mpTick')!;
    // 从几数起。这一局是哪个玩法，服务器那边给的提前量就按同一份名单多留一秒
    // （api/room.js 的 WIDE_MODES），所以两边数出来的秒数对得上。
    const first = countFrom(mode);
    let shown = 0;

    const paintTick = () => {
      // Against the server's clock, not this device's — that is what puts
      // four phones on the same instant.
      const left = startAt - serverTime();
      if (left <= 0) {
        window.clearInterval(countdownTimer);
        countdownTimer = 0;
        playedRound = round;
        if (!dead) handlers.onMatchStart({ mode, seed, slot: state.slot ?? null });
        return;
      }
      // 服务器留的是四秒半（建议横着玩的玩法五秒半），多出来的半秒都算在第一
      // 个数字上——看起来和单人那一幕一模一样：几个数字就几秒，只有头一个站
      // 得久一点。
      const n = Math.min(first, Math.ceil(left / 1000));
      if (n !== shown) {
        shown = n;
        pushDigit(tickEl, n);
      }
    };
    paintTick();
    countdownTimer = window.setInterval(paintTick, 80);
  }

  // A room this device is already in is rejoined wherever it has got to: a
  // reload mid-lobby, and just as importantly the walk back from a finished
  // round, which lands here with the scores still on the server.
  void (async () => {
    // 根本没有座位，就是「还没进过任何房间」——直接摆出这一页，不要报错。
    // 以前它和「你那间房没了」走同一条路，于是每个第一次点进来的人都被
    // 告知「没有这个房间号」，而他压根还没输过房间号。
    if (!currentRoom()) return renderHome();
    const existing = await fetchState();
    if (dead) return;
    if (!existing.ok) {
      // 「房间没了」和「这次请求没打通」是两件事，以前一律按前者处理：
      // 地铁里晃一下、后台被回收一次，人就被请出房间而且回不去。
      // 只有服务器亲口说没有这间房，才放弃这个座位。
      const gone = existing.reason === 'noRoom' || existing.reason === 'ended';
      if (!gone && currentRoom()) return renderReconnecting();
      forgetRoom();
      return renderHome(gone ? s.mpErrNoRoom : '');
    }
    if (existing.value.ended) {
      forgetRoom();
      return renderHome(s.mpRoomEnded);
    }
    // A round that began while this device was away is still worth joining
    // late; one it has already played is not.
    if (existing.value.roundOver) markRoundPlayed(existing.value.round);
    playedRound = Math.max(playedRound, lastPlayedRound());
    renderLobby(existing.value);
  })();

  return teardown;
}
