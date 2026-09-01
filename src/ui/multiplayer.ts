import { STRINGS, type Lang } from '../i18n';
import { isGenius } from '../engine/subscription';
import { pushDigit, startStageHtml } from './startStage';
import { confirmLeaveRoom } from './confirmLeaveRoom';
import { ICON_LOCK } from './homeIcons';
import { geniusLogoTag } from './geniusLogo';
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
}

const NAME_KEY = 'slides_mp_name';

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Seats open today, as the server last said.
 *
 * Only the wording needs it, and the 4 is a first guess for the one moment
 * before any answer has arrived — every reply that mentions seats, including
 * the refusal that says a room is full, replaces it.
 */
let openSeats = 4;

function errorText(reason: RoomError, lang: Lang, seats?: number): string {
  const s = STRINGS[lang];
  if (typeof seats === 'number' && seats > 0) openSeats = seats;
  switch (reason) {
    case 'geniusOnly':
      return s.mpNeedGenius;
    case 'noRoom':
      return s.mpErrNoRoom;
    case 'full':
      return s.mpErrFull.replace('{n}', String(openSeats));
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

  const stopAll = () => {
    stopWatching?.();
    stopWatching = null;
    window.clearInterval(countdownTimer);
    countdownTimer = 0;
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
        <p class="auth-hint">${s.mpNeedGenius}</p>

        <!-- Four digits read off someone else's screen deserve the room the
             room code itself gets: its own line, at a size that can be
             checked at a glance against the phone being read from. -->
        <div class="mp-join-block">
          <label class="auth-field mp-code-field">
            <span>${s.mpCodeLabel}</span>
            <input id="mpCode" type="text" inputmode="numeric" maxlength="4"
                   autocomplete="off" placeholder="${s.mpCodePlaceholder}" />
          </label>
          <button class="profile-pill" id="mpJoin">${s.mpJoin}</button>
        </div>

        <button class="profile-row profile-row--back" id="mpBack">${s.back}</button>
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
      if (!made.ok) return void (msg.textContent = errorText(made.reason, lang, made.seats));
      renderLobby(made.value);
    });

    container.querySelector<HTMLButtonElement>('#mpJoin')!.addEventListener('click', async () => {
      const code = codeBox.value.trim();
      if (!/^\d{4}$/.test(code)) return void (msg.textContent = s.mpErrNoRoom);
      remember();
      msg.textContent = s.workingLabel;
      const joined = await joinRoom(code, myName(), avatar);
      if (dead) return;
      if (!joined.ok) return void (msg.textContent = errorText(joined.reason, lang, joined.seats));
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
    if (state.seats) openSeats = state.seats;
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
          <p class="auth-hint">${s.mpShareHint.replace('{n}', String(state.seats || openSeats))}</p>
        </div>

        <div class="menu-section-label" id="mpPlayersLabel">${s.mpPlayers}</div>
        <div class="mp-players" id="mpPlayers"></div>

        <div id="mpHostArea"></div>
        <p class="auth-msg" id="mpMsg" role="status"></p>
        <p class="auth-hint">${s.mpSameBoard}</p>

        <button class="profile-row profile-row--back" id="mpLeave">${s.mpLeave}</button>
      </div>
    `;
    const leave = async () => {
      stopAll();
      await leaveRoom();
      if (!dead) renderHome();
    };
    container.querySelector<HTMLButtonElement>('#mpLeave')!.addEventListener('click', () => {
      // Only the host is warned, because only the host's leaving costs the
      // others anything: the server writes 房主 once when the room opens and
      // has no way to hand it on, so a room whose host has gone can still be
      // sat in and can never start another round. Everyone else may go
      // without ceremony.
      // 客人和房主都要问一句，只是问的话不一样（见 confirmLeaveRoom）。
      confirmLeaveRoom(lang, leave);
    });

    paint(state, iAmHost);

    stopWatching = watchRoom(
      (next) => {
        if (dead) return;
        // The host closed up while we were sitting here.
        if (next.ended) {
          stopAll();
          return handlers.onRoomEnded(next);
        }
        paint(next, iAmHost);
        // The host has chosen: everyone counts down to the same instant.
        if (next.startAt && next.seed && next.mode && next.round > playedRound) {
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
        (p) => `<div class="mp-player">
          <span class="mp-avatar">${avatarSvg(p.avatar)}</span>
          <span class="mp-player-name">${esc(p.name)}</span>
          ${p.isHost ? `<span class="mp-badge">${s.mpHostBadge}</span>` : ''}
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
      area.innerHTML = `<p class="tag-line">${s.mpWaitingHost}</p>`;
      return;
    }
    if (!iAmHost) {
      area.innerHTML = `<p class="tag-line">${s.mpWaitingHost}</p>`;
      return;
    }
    const pickLabel = state.round ? s.mpNextRound : s.mpGoPick;
    // Rebuilt only when what it says has changed, so the poll cannot swallow
    // a tap that has already landed.
    if (area.dataset.shape === pickLabel) return;
    area.dataset.shape = pickLabel;
    area.innerHTML = `
      <button class="genius-cta" id="mpPick">${pickLabel}</button>
      ${state.round ? `<button class="profile-row" id="mpEnd">${s.mpEndRoom}</button>` : ''}
    `;
    area.querySelector<HTMLButtonElement>('#mpPick')!.addEventListener('click', () => {
      stopAll();
      handlers.onPickMode(state.code);
    });
    area.querySelector<HTMLButtonElement>('#mpEnd')?.addEventListener('click', async () => {
      stopAll();
      const closed = await endRoom();
      if (dead) return;
      if (!closed.ok) {
        const msg = container.querySelector<HTMLElement>('#mpMsg');
        if (msg) msg.textContent = errorText(closed.reason, lang, closed.seats);
        return renderLobby(state);
      }
      handlers.onRoomEnded(closed.value);
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

  // ---- screen 3: 3, 2, 1 -----------------------------------------------

  function beginCountdown(state: RoomState) {
    if (launched || !state.startAt || !state.seed || !state.mode) return;
    launched = true;
    playedRound = state.round;
    stopAll();
    const { startAt, seed, mode } = state;

    // 和单人开局页是同一幕：上半屏这一局的玩法图（旁边挂着那扇小门，说明这是
    // 一场竞赛），下半屏 3、2、1。区别只在谁在数——这里数的是服务器给的开赛
    // 时刻，不是本地的三秒，所有人的数字才会同时跳。
    container.innerHTML = `
      <div class="app mp-page mp-countdown-page">
        ${startStageHtml({ shapeId: mode, room: true, countId: 'mpTick' })}
      </div>
    `;
    const tickEl = container.querySelector<HTMLElement>('#mpTick')!;
    let shown = 0;

    const paintTick = () => {
      // Against the server's clock, not this device's — that is what puts
      // four phones on the same instant.
      const left = startAt - serverTime();
      if (left <= 0) {
        window.clearInterval(countdownTimer);
        countdownTimer = 0;
        if (!dead) handlers.onMatchStart({ mode, seed });
        return;
      }
      // 服务器留的是三秒半，多出来的半秒都算在第一个「3」上——数字只有三个，
      // 和单人那一幕看起来一模一样。
      const n = Math.min(3, Math.ceil(left / 1000));
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
