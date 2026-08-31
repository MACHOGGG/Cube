import { STRINGS, type Lang } from '../i18n';
import { isGenius } from '../engine/subscription';
import { shapeName } from './shapeLabels';
import { geniusMark } from './geniusMark';
import {
  avatarSvg,
  createRoom,
  currentRoom,
  fetchState,
  forgetRoom,
  joinRoom,
  leaveRoom,
  randomAvatar,
  serverTime,
  startMatch,
  watchRoom,
  type Avatar,
  type RoomError,
  type RoomState,
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
}

/** The eight boards a host can put in front of everyone. */
const MODES = [
  'square', 'circle', 'triangle',
  'squareDiamond', 'circleHex', 'circleSeven', 'triangleBig', 'triangleAdvanced',
];

const NAME_KEY = 'slides_mp_name';

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
    container.innerHTML = `
      <div class="app mp-page">
        <header class="home-head">
          <div class="home-head-glass">
            <h1 class="home-title">Slides</h1>
            <p class="home-sub">${s.mpTitle}</p>
          </div>
        </header>
        <p class="tag-line">${s.mpIntro}</p>

        <div class="mp-me">
          <span class="mp-avatar" id="mpAvatar">${avatarSvg(avatar)}</span>
          <label class="auth-field mp-name-field">
            <span>${s.mpNameLabel}</span>
            <input id="mpName" type="text" maxlength="12" autocomplete="nickname"
                   placeholder="${s.mpNamePlaceholder}" value="${esc(savedName)}" />
          </label>
          <button class="profile-pill profile-pill--square" id="mpShuffle"
                  aria-label="${s.mpShuffle}">&#8635;</button>
        </div>

        <p class="auth-msg" id="mpMsg" role="status">${message}</p>

        <button class="genius-cta" id="mpCreate">${s.mpCreate}</button>
        <p class="auth-hint">${geniusMark()}${s.mpNeedGenius}</p>

        <div class="mp-join-row">
          <label class="auth-field mp-code-field">
            <span>${s.mpCodeLabel}</span>
            <input id="mpCode" type="text" inputmode="numeric" maxlength="4"
                   placeholder="${s.mpCodePlaceholder}" />
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

        <div class="menu-section-label">${s.mpPlayers}</div>
        <div class="mp-players" id="mpPlayers"></div>

        <div id="mpHostArea"></div>
        <p class="auth-msg" id="mpMsg" role="status"></p>
        <p class="auth-hint">${s.mpSameBoard}</p>

        <button class="profile-row profile-row--back" id="mpLeave">${s.mpLeave}</button>
      </div>
    `;
    container.querySelector<HTMLButtonElement>('#mpLeave')!.addEventListener('click', async () => {
      stopAll();
      await leaveRoom();
      if (!dead) renderHome();
    });

    paintPlayers(state);
    paintHostArea(state, iAmHost);

    stopWatching = watchRoom(
      (next) => {
        if (dead) return;
        paintPlayers(next);
        paintHostArea(next, iAmHost);
        // The host has chosen: everyone counts down to the same instant.
        if (next.startAt && next.seed && next.mode) beginCountdown(next);
      },
      (reason) => {
        const msg = container.querySelector<HTMLElement>('#mpMsg');
        if (msg) msg.textContent = errorText(reason, lang);
      },
    );
  }

  function paintPlayers(state: RoomState) {
    const list = container.querySelector<HTMLElement>('#mpPlayers');
    if (!list) return;
    list.innerHTML = state.players
      .map(
        (p) => `<div class="mp-player">
          <span class="mp-avatar">${avatarSvg(p.avatar)}</span>
          <span class="mp-player-name">${esc(p.name)}</span>
          ${p.isHost ? `<span class="mp-badge">${s.mpHostBadge}</span>` : ''}
        </div>`,
      )
      .join('');
  }

  function paintHostArea(state: RoomState, iAmHost: boolean) {
    const area = container.querySelector<HTMLElement>('#mpHostArea');
    if (!area || state.startAt) return;
    if (!iAmHost) {
      area.innerHTML = `<p class="tag-line">${s.mpWaitingHost}</p>`;
      return;
    }
    // Rebuilt only when it has nothing in it, so the poll does not wipe out
    // the choice the host is in the middle of making.
    if (area.querySelector('.mp-mode')) return;
    area.innerHTML = `
      <div class="menu-section-label">${s.mpPickMode}</div>
      <div class="mp-modes">
        ${MODES.map(
          (id) => `<button class="mp-mode" data-mode="${id}">${shapeName(lang, id, id)}</button>`,
        ).join('')}
      </div>
      <button class="genius-cta" id="mpStart" disabled>${s.mpStartBtn}</button>
    `;
    let picked = '';
    const startBtn = area.querySelector<HTMLButtonElement>('#mpStart')!;
    for (const btn of Array.from(area.querySelectorAll<HTMLButtonElement>('.mp-mode'))) {
      btn.addEventListener('click', () => {
        picked = btn.dataset.mode!;
        for (const other of Array.from(area.querySelectorAll('.mp-mode'))) {
          other.classList.toggle('mp-mode--on', other === btn);
        }
        startBtn.disabled = false;
      });
    }
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      const begun = await startMatch(picked);
      if (dead) return;
      if (!begun.ok) {
        startBtn.disabled = false;
        const msg = container.querySelector<HTMLElement>('#mpMsg');
        if (msg) msg.textContent = errorText(begun.reason, lang);
        return;
      }
      beginCountdown(begun.value);
    });
  }

  // ---- screen 3: 3, 2, 1 -----------------------------------------------

  function beginCountdown(state: RoomState) {
    if (launched || !state.startAt || !state.seed || !state.mode) return;
    launched = true;
    stopAll();
    const { startAt, seed, mode } = state;

    container.innerHTML = `
      <div class="app mp-page mp-countdown-page">
        <div class="mp-countdown" id="mpTick">3</div>
        <p class="tag-line">${shapeName(lang, mode, mode)}</p>
        <p class="auth-hint">${s.mpSameBoard}</p>
      </div>
    `;
    const tickEl = container.querySelector<HTMLElement>('#mpTick')!;

    const paint = () => {
      // Against the server's clock, not this device's — that is what puts
      // four phones on the same instant.
      const left = startAt - serverTime();
      if (left <= 0) {
        window.clearInterval(countdownTimer);
        countdownTimer = 0;
        tickEl.textContent = s.mpGo;
        if (!dead) handlers.onMatchStart({ mode, seed });
        return;
      }
      const n = Math.ceil(left / 1000);
      if (tickEl.textContent !== String(n)) {
        tickEl.textContent = String(n);
        tickEl.classList.remove('mp-countdown--beat');
        void tickEl.offsetWidth;
        tickEl.classList.add('mp-countdown--beat');
      }
    };
    paint();
    countdownTimer = window.setInterval(paint, 80);
  }

  // A room already in progress on this device (a reload mid-lobby) is simply
  // rejoined; otherwise this starts at the front.
  void (async () => {
    const existing = await fetchState();
    if (dead) return;
    if (existing.ok && !existing.value.startAt) renderLobby(existing.value);
    else {
      forgetRoom();
      renderHome();
    }
  })();

  return teardown;
}
