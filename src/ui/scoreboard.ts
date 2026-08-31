import { STRINGS, type Lang } from '../i18n';
import {
  avatarSvg,
  currentRoom,
  reportScore,
  watchRoom,
  type RoomState,
} from '../engine/room';

/**
 * The live standings, over a multiplayer run.
 *
 * It reads the local score straight off the HUD's reel rather than being
 * handed it: the reel already carries the settled number as a data
 * attribute, and taking it from there means none of the eight boards, nor
 * the controller they share, has to know that multiplayer exists. A racing
 * scoreboard is not a reason to thread a callback through the whole game.
 *
 * Everyone else's score arrives by polling, about once a second. That is not
 * a compromise anyone can see: a row that changes places a second after the
 * points were scored reads exactly like one that changed places instantly.
 *
 * The panel is deliberately small and out of the way. What is being played
 * is still a puzzle, and the board has to stay the thing you are looking at.
 */

const REEL_ID = 'scoreReel';
const END_OVERLAY_ID = 'endOverlay';
/** Often enough to feel live, rarely enough to be nothing on a battery. */
const LOCAL_MS = 500;
const REMOTE_MS = 1000;

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What the HUD says right now, or null while no board is mounted. */
function localScore(): number | null {
  const reel = document.getElementById(REEL_ID);
  const raw = reel?.dataset.score;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The run is over once the end-of-run panel is up. */
const runFinished = (): boolean =>
  document.getElementById(END_OVERLAY_ID)?.classList.contains('show') ?? false;

/**
 * Puts the standings on screen and keeps them there until the returned
 * teardown is called. Does nothing at all outside a room, so a solo run is
 * exactly what it was.
 */
export function mountScoreboard(lang: Lang): () => void {
  const seat = currentRoom();
  if (!seat) return () => {};
  const s = STRINGS[lang];

  const panel = document.createElement('aside');
  panel.className = 'mp-board';
  panel.innerHTML = `<div class="mp-board-title">${s.mpStandings}</div><div class="mp-board-rows"></div>`;
  document.body.appendChild(panel);
  const rows = panel.querySelector<HTMLElement>('.mp-board-rows')!;

  let lastSent = -1;
  let sentFinished = false;
  let dead = false;

  const paint = (state: RoomState) => {
    rows.innerHTML = state.players
      .map((p, rank) => {
        const me = p.id === seat.playerId;
        return `<div class="mp-board-row${me ? ' mp-board-row--me' : ''}">
          <span class="mp-board-rank">${rank + 1}</span>
          <span class="mp-avatar mp-avatar--small">${avatarSvg(p.avatar)}</span>
          <span class="mp-board-name">${esc(p.name)}</span>
          <span class="mp-board-score">${p.score}</span>
          ${p.finished ? `<span class="mp-badge">${s.mpFinished}</span>` : ''}
        </div>`;
      })
      .join('');
  };

  // Everyone else's scores.
  const stopWatching = watchRoom(
    (state) => {
      if (!dead) paint(state);
    },
    () => {
      // A poll that fails changes nothing on screen: the last standings
      // stand, which is better than blanking the panel over one dropped
      // request in the middle of someone's run.
    },
    REMOTE_MS,
  );

  // Our own, off the HUD, and only when it has actually moved.
  const localTimer = window.setInterval(() => {
    if (dead) return;
    const score = localScore();
    if (score === null) return;
    const over = runFinished();
    if (score === lastSent && over === sentFinished) return;
    lastSent = score;
    sentFinished = over;
    void reportScore(score, over);
  }, LOCAL_MS);

  return () => {
    dead = true;
    stopWatching();
    window.clearInterval(localTimer);
    // One last report, so a player who leaves mid-run does not sit at a
    // stale number on everybody else's screen.
    const score = localScore();
    if (score !== null) void reportScore(score, true);
    panel.remove();
  };
}
