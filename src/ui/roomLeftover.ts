/**
 * 屋主中途散场之后，那一局转成单人接着打——打完了，结算页上要给两份。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这一块
 *
 * 屋主一按《解散小屋》，屋子就没了。这时候正打着的人分两种：
 *
 *   · 这一局他自己打不了（天才特供的棋盘 / 无限反转 / 老虎机，他没开通）
 *     ——弹一句话，回主页，不结算不存档（见 scoreboard.ts 的 lockedOut）；
 *   · 有权限的，原地转成一局单人接着打（goSolo）。
 *
 * 第二种人手上其实攒着两份成绩：在小屋里打过的那几局（那是他和别人比出来
 * 的），和刚刚这一局单人（那是他自己一个人打完的）。从前结算页只给后面那
 * 一份——小屋里的那几局，屋子一散就跟着蒸发了。玩家的原话：「非屋主的玩家
 * 离开游戏的时候还是完全没有得到任何结算分数和榜单的部分」。
 *
 * 所以这一块把小屋那份接住：屋子散的那一刻先留一份底（那之后 forgetRoom()
 * 就把座位和最后看到的房间状态都清了，晚一步什么都取不到），等这一局单人
 * 打完，摆在结算页最上面——小屋的总排行和它的战绩图在上，这一局单人的结算
 * 和它的战绩图在下。两份各自完整，各有各的图。
 * ─────────────────────────────────────────────────────────────────────────
 */
import { STRINGS, type Lang } from '../i18n';
import { avatarSvg, type RoomState } from '../engine/room';
import { liveTotal, rankRoom, renderRoomCard } from './roomCard';

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** 屋子散的那一刻留下的那份底。一次性的：给出去一次就清掉。 */
let pending: { state: RoomState; meId: string } | null = null;

/**
 * 留一份底。要在 forgetRoom() 之前叫——之后房间状态和座位都没了。
 *
 * 一局都没打过就散场的不留：图上全是 0，摆出来只是一块空白。
 */
export function stashRoomLeftover(state: RoomState | null, meId: string | undefined): void {
  if (!state || state.round <= 0 || !meId) return;
  pending = { state, meId };
}

/** 忘掉它。开一局新的（跟小屋没关系的）之前要清，免得旧的那份跟着冒出来。 */
export function clearRoomLeftover(): void {
  pending = null;
}

/**
 * 把小屋那份画进结算页顶上那块地方，然后清掉。
 *
 * 没有底就把那块地方藏起来——单人局的结算页一个字都不该因此改样子。
 */
export function mountRoomLeftover(host: HTMLElement | null, lang: Lang): void {
  if (!host) return;
  const held = pending;
  pending = null;
  if (!held) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const s = STRINGS[lang];
  const { state, meId } = held;
  const ranked = rankRoom(state.players);
  const roomTotal = state.players.reduce((sum, p) => sum + liveTotal(p), 0);
  host.innerHTML = `
    <div class="end-room-head">
      <div class="end-score-label">${s.mpRoomTotal}</div>
      <div class="big-score">${roomTotal}</div>
      <p class="auth-hint auth-hint--center">${s.mpRoundsPlayed.replace('{n}', String(state.round))}</p>
    </div>
    <div class="mp-players end-room-rows">
      ${ranked
        .map(
          (p, i) => `<div class="mp-player${p.id === meId ? ' mp-player--me' : ''}">
            <span class="mp-final-rank">${i + 1}</span>
            <span class="mp-avatar">${avatarSvg(p.avatar)}</span>
            <span class="mp-player-name">${esc(p.name)}</span>
            <span class="mp-player-total">${liveTotal(p)}</span>
          </div>`,
        )
        .join('')}
    </div>
    <img class="mp-final-card end-room-card" alt="${s.shareImgAlt}" />
    <div class="end-rule" aria-hidden="true"></div>
  `;
  host.hidden = false;
  const img = host.querySelector<HTMLImageElement>('.end-room-card');
  // 图在页面立起来之后再画：它用的是页面自己那几种字体，排版还没发生就问画
  // 布要，拿到的是替补字体。
  requestAnimationFrame(() => {
    if (!img) return;
    try {
      img.src = renderRoomCard(state, lang, { title: s.mpFinalTitle, meId });
    } catch {
      // 这台设备给不了画布，丢的是那张图，不是名次——名次就在上面那几行。
      img.remove();
    }
  });
}
