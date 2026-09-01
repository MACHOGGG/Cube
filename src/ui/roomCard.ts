import { STRINGS, type Lang } from '../i18n';
import { drawStandings, type Standing } from '../engine/shareCard';
import { QR_MATRIX, QR_QUIET_MODULES } from '../engine/qrSlides';
import { avatarSvg, currentRoom, type RoomPlayer, type RoomState } from '../engine/room';

/**
 * 本房战绩 — what a whole evening in one room added up to.
 *
 * A round's own card is about a board: this one is about the people. The
 * ranking is by the total across every round, because an evening is not
 * decided by the last board anyone happened to play, and the two things
 * that a single total cannot say — who put together the best board, and who
 * was quickest at one — are named underneath rather than ranked alongside.
 * They are worth a mention and not worth an argument.
 *
 * Drawn on a canvas rather than in HTML for the same reason the run's card
 * is: what people do with it is send it to each other.
 */

const CARD_W = 720;
const PAD = 72;
/** Roomy for four, still on one page at twelve. */
const ROW_H = 46;
const rowHeightFor = (count: number) => (count <= 6 ? ROW_H : Math.max(30, ROW_H - (count - 6) * 2));
const EXPORT_SCALE = 3;

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** m:ss, the same shape the results panel uses. */
export function shortTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Highest total first; a tie is broken by the better single round. */
export const rankRoom = (players: RoomPlayer[]): RoomPlayer[] =>
  [...players].sort((a, b) => b.total - a.total || b.best - a.best);

/** Whoever put together the single best board, when anyone did. */
function bestRoundOf(players: RoomPlayer[]): RoomPlayer | null {
  const scored = players.filter((p) => p.best > 0);
  if (!scored.length) return null;
  return scored.reduce((top, p) => (p.best > top.best ? p : top));
}

/** Whoever finished a board quickest, when a time was ever recorded. */
function fastestOf(players: RoomPlayer[]): RoomPlayer | null {
  const timed = players.filter((p) => typeof p.bestTime === 'number' && p.bestTime > 0);
  if (!timed.length) return null;
  return timed.reduce((top, p) => ((p.bestTime ?? 0) < (top.bestTime ?? 0) ? p : top));
}

function drawQr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const modules = QR_MATRIX.length + QR_QUIET_MODULES * 2;
  const m = size / modules;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#141413';
  for (let r = 0; r < QR_MATRIX.length; r++) {
    const row = QR_MATRIX[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '1') continue;
      ctx.fillRect(x + (c + QR_QUIET_MODULES) * m, y + (r + QR_QUIET_MODULES) * m, m + 0.5, m + 0.5);
    }
  }
}

/** The closing card as a PNG data URL. */
export function renderRoomCard(state: RoomState, lang: Lang): string {
  const s = STRINGS[lang];
  const seat = currentRoom();
  const ranked = rankRoom(state.players);
  const rows: Standing[] = ranked.map((p) => ({
    name: p.name,
    score: p.total,
    me: Boolean(seat && p.id === seat.playerId),
  }));

  const rowH = rowHeightFor(rows.length);
  const listY = 232;
  const notesY = listY + 20 + rows.length * rowH + 34;
  const cardH = notesY + 96;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * EXPORT_SCALE;
  canvas.height = cardH * EXPORT_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, 0, CARD_W, cardH);

  ctx.fillStyle = '#141413';
  ctx.font = '700 40px "Fraunces", serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Slides', PAD, 74);
  ctx.font = '600 22px "Karla", sans-serif';
  ctx.fillStyle = '#5b5650';
  ctx.fillText(s.mpFinalTitle, PAD, 106);

  const qrSize = 88;
  drawQr(ctx, CARD_W - PAD - qrSize, 40, qrSize);

  // The room, and how much of an evening it was.
  ctx.font = '700 56px "Fraunces", serif';
  ctx.fillStyle = '#BE5762';
  ctx.fillText(state.code, PAD, 178);
  ctx.font = '500 15px "Karla", sans-serif';
  ctx.fillStyle = '#8b8680';
  ctx.fillText(
    `${s.mpRoomCode} · ${s.mpRoundsPlayed.replace('{n}', String(state.round))}`,
    PAD + 2,
    202,
  );

  drawStandings(ctx, rows, PAD, listY, CARD_W - PAD * 2, s.mpTotalLabel, rowH);

  // The two side notes, quiet and on one line each.
  const best = bestRoundOf(state.players);
  const fastest = fastestOf(state.players);
  ctx.font = '500 14px "Karla", sans-serif';
  ctx.fillStyle = '#8b8680';
  let noteY = notesY;
  if (best) {
    ctx.fillText(`${s.mpBestRound} · ${best.name} ${best.best}`, PAD, noteY);
    noteY += 24;
  }
  if (fastest?.bestTime) {
    ctx.fillText(`${s.mpFastest} · ${fastest.name} ${shortTime(fastest.bestTime)}`, PAD, noteY);
  }

  ctx.font = '500 13px "Karla", sans-serif';
  ctx.fillStyle = '#a39e97';
  ctx.textAlign = 'center';
  ctx.fillText(s.shareFooterHint, CARD_W / 2, cardH - 26);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

/**
 * The page everyone lands on when the host closes up: the standings as HTML
 * so they can be read at a glance, and the card itself to keep or send on.
 */
/**
 * `title` 换掉页头那一行字，`meId` 指定「我是哪一行」。
 *
 * 两个都是给「退出房间」那条路准备的：那张卡叫《竞赛排名》而不是《本房战绩》，
 * 而且画它的时候座位已经交回去了，currentRoom() 是空的——不把 id 提前留下来，
 * 玩家就在自己的排名表里找不到自己。
 */
export interface RoomCardOpts {
  title?: string;
  meId?: string;
}

export function showRoomCard(
  container: HTMLElement,
  state: RoomState,
  lang: Lang,
  onDone: () => void,
  opts: RoomCardOpts = {},
): void {
  const s = STRINGS[lang];
  const meId = opts.meId ?? currentRoom()?.playerId;
  const ranked = rankRoom(state.players);
  const best = bestRoundOf(state.players);
  const fastest = fastestOf(state.players);

  container.innerHTML = `
    <div class="app mp-page">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${opts.title ?? s.mpFinalTitle}</p>
        </div>
      </header>

      <div class="mp-code-card">
        <div class="menu-section-label">${s.mpRoomCode}</div>
        <div class="mp-code">${state.code}</div>
        <p class="auth-hint">${s.mpRoundsPlayed.replace('{n}', String(state.round))}</p>
      </div>

      <div class="mp-players" id="mpFinalRows">
        ${ranked
          .map(
            (p, i) => `<div class="mp-player${meId && p.id === meId ? ' mp-player--me' : ''}">
              <span class="mp-final-rank">${i + 1}</span>
              <span class="mp-avatar">${avatarSvg(p.avatar)}</span>
              <span class="mp-player-name">${esc(p.name)}</span>
              <span class="mp-player-total">${p.total}</span>
            </div>`,
          )
          .join('')}
      </div>

      <div class="mp-notes">
        ${best ? `<p class="auth-hint">${s.mpBestRound} · ${esc(best.name)} ${best.best}</p>` : ''}
        ${
          fastest?.bestTime
            ? `<p class="auth-hint">${s.mpFastest} · ${esc(fastest.name)} ${shortTime(fastest.bestTime)}</p>`
            : ''
        }
      </div>

      <img class="mp-final-card" id="mpFinalCard" alt="${s.shareImgAlt}" />
      <p class="auth-hint">${s.shareHint}</p>

      <button class="genius-cta" id="mpFinalDone">${s.homeBtn}</button>
    </div>
  `;

  const img = container.querySelector<HTMLImageElement>('#mpFinalCard')!;
  // Drawn after the page is up: the fonts it uses are the page's own, and a
  // canvas asked for them before anything has been laid out gets fallbacks.
  requestAnimationFrame(() => {
    try {
      img.src = renderRoomCard(state, lang);
    } catch {
      // A canvas this device would not give us costs the picture, not the
      // standings — those are the rows above, in plain HTML.
      img.remove();
    }
  });
  container.querySelector<HTMLButtonElement>('#mpFinalDone')!.addEventListener('click', onDone);
}
