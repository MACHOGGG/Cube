import { STRINGS, type I18nStrings, type Lang } from '../i18n';
import { confirmLeaveRoom } from './confirmLeaveRoom';
import {
  avatarSvg,
  currentRoom,
  iAmHost,
  lastPlayedRound,
  latestRoomState,
  markRoundPlayed,
  reportScore,
  startMatch,
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

/** How long the run took, as the end panel recorded it. */
function runSeconds(): number | undefined {
  const raw = document.getElementById(END_OVERLAY_ID)?.dataset.seconds;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 一局打完之后，这三颗按钮各自去哪。
 *
 * 单人局的结算页上，《主页》和《再来》的意思是清楚的。房间里不是：主页不该
 * 把人丢出房间（比分还在那儿，房主还要开下一局），而《再来》如果只是本地重
 * 开一副牌，那就是在一场已经结束的比赛里自己跟自己再玩一遍。所以在房间里这
 * 两颗要换去处，另外补一颗真正能走的《离开房间》。
 */
export interface RoomRunHandlers {
  /** 回房间页——比分和下一局都在那里。 */
  onRoom: () => void;
  /** 房主专用：回主菜单，继续为整房挑下一个玩法。 */
  onPickNext: () => void;
  /** 交出座位，并出一张截止此刻的竞赛排名。 */
  onLeave: () => void;
}

/**
 * Puts the standings on screen and keeps them there until the returned
 * teardown is called. Does nothing at all outside a room, so a solo run is
 * exactly what it was.
 */
export function mountScoreboard(lang: Lang, handlers: RoomRunHandlers): () => void {
  const seat = currentRoom();
  if (!seat) return () => {};
  const s = STRINGS[lang];
  const restoreEndPanel = wireEndPanel(s, lang, handlers);

  // 打到一半也走得掉。这颗键占的是单人局里《暂停》的位置——一场同步竞赛暂停
  // 不了，别人的钟不会跟着停——所以那个位置本来就该让给真正的出口。
  // 走之前问一句：这一步是把座位交回去，不是回上一页。
  const midRunLeave = document.querySelector<HTMLButtonElement>('#leaveRoomBtn');
  midRunLeave?.addEventListener('click', () => confirmLeaveRoom(lang, handlers.onLeave));
  /**
   * 这一局是第几局——在开局的这一刻记下来，之后不再改。
   *
   * 不能等到交卷时再去问「现在是第几局」：房主可能已经开了下一局，那时问到
   * 的是新的回合号，于是一局都没打的新回合被记成「打过了」，人回到房间也不
   * 会再倒计时。这个数字属于这一局，就该在这一局开始时定下来。
   */
  const myRound = latestRoomState()?.round ?? 0;
  /** 这一局在本机算打完了：回到房间时才不会把它当新的一局重开。 */
  const markPlayed = () => markRoundPlayed(myRound);

  const panel = document.createElement('aside');
  panel.className = 'mp-board';
  panel.innerHTML = `<div class="mp-board-title">${s.mpStandings}</div><div class="mp-board-rows"></div>`;
  document.body.appendChild(panel);
  const rows = panel.querySelector<HTMLElement>('.mp-board-rows')!;

  // 把比分板抬到那一排按钮上面去。
  //
  // 它本来贴着屏幕底，而那一排按钮也贴着屏幕底——两个都在左下角，于是名单正
  // 好压在《离开房间》身上。指针能穿过去（见下面那句 pointerEvents），但眼睛
  // 穿不过去：那颗键看上去是被埋住的，没人会去按一个看不见的东西。
  // 所以量一次按钮排的位置，把面板停在它上沿之上；转屏、改窗口都重量一次。
  const liftPanel = () => {
    const row = document.querySelector('.app--game .controls');
    if (!row) return;
    const gap = Math.round(window.innerHeight - row.getBoundingClientRect().top) + 10;
    panel.style.bottom = `calc(${Math.max(12, gap)}px + env(safe-area-inset-bottom, 0px))`;
  };
  requestAnimationFrame(liftPanel);
  for (const ev of ['resize', 'orientationchange']) window.addEventListener(ev, liftPanel);

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
    // 名单只有在真的装不下、需要自己滚的时候才把指针要回来。四个人的名单没得
    // 滚，却会盖住底下的东西——《离开房间》正好在它底下，按不动。
    rows.style.pointerEvents = rows.scrollHeight > rows.clientHeight + 1 ? 'auto' : 'none';
  };

  // Everyone else's scores.
  const stopWatching = watchRoom(
    (state) => {
      if (dead) return;
      paint(state);
      // 房主已经开了下一局，而这台设备还停在上一局的结算页上。谁也不会来叫
      // 他——开局的倒计时是房间页在听的，而这台设备现在不在房间页上。所以
      // 由这里把人送回去，房间页一进去就接上倒计时。
      // 只在本局已经打完之后才动：正打着的人不该被拽走。
      if (runFinished() && state.startAt && state.round > lastPlayedRound()) {
        dead = true;
        return handlers.onRoom();
      }
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
    if (over) markPlayed();
    void reportScore(score, over, runSeconds());
  }, LOCAL_MS);

  return () => {
    dead = true;
    restoreEndPanel();
    for (const ev of ['resize', 'orientationchange']) window.removeEventListener(ev, liftPanel);
    stopWatching();
    window.clearInterval(localTimer);
    // One last report, so a player who leaves mid-run does not sit at a
    // stale number on everybody else's screen.
    const score = localScore();
    if (score !== null) {
      markPlayed();
      void reportScore(score, true, runSeconds());
    }
    panel.remove();
  };
}


/**
 * 把结算页那一排按钮改成房间里的样子，返回还原用的函数。
 *
 * 换按钮的手法是「把节点整个换成它的克隆」：克隆不带任何监听器，于是各个玩法
 * 自己挂在上面的那一份（本地重开、回上一页）就断了，再挂我们要的。这样八个
 * 玩法文件和 gameShell 都不用动——它们本来就不知道多人房间这回事，也不该知道。
 */
function wireEndPanel(s: I18nStrings, lang: Lang, handlers: RoomRunHandlers): () => void {
  const row = document.querySelector<HTMLElement>(`#${END_OVERLAY_ID} .btn-row`);
  if (!row) return () => {};

  const swap = (id: string, label: string, onClick: () => void): HTMLElement | null => {
    const old = row.querySelector<HTMLButtonElement>(`#${id}`);
    if (!old) return null;
    const fresh = old.cloneNode(true) as HTMLButtonElement;
    fresh.textContent = label;
    old.replaceWith(fresh);
    fresh.addEventListener('click', onClick);
    return fresh;
  };

  const host = iAmHost();

  // 《主页》：房主回主菜单挑下一个玩法（那就是「回主页继续玩」）；客人回房间页，
  // 因为开局的权限不在他手上，主菜单对他没有可按的东西。
  swap('endBackBtn', s.homeBtn, host ? handlers.onPickNext : handlers.onRoom);

  // 《再来》：房主用同一个玩法立刻再开一局。客人开不了局，这颗对他没有意义，
  // 与其让它跳到别的地方假装能用，不如收起来。
  const again = row.querySelector<HTMLButtonElement>('#restartBtn');
  if (host) {
    swap('restartBtn', s.restartBtn, () => {
      const mode = latestRoomState()?.mode;
      handlers.onRoom();
      if (mode) void startMatch(mode);
    });
  } else if (again) {
    again.hidden = true;
  }

  // 新的一颗：真正走得掉的出口。放在这一排最后，和《分享》并排。
  const leave = document.createElement('button');
  leave.className = 'secondary';
  leave.id = 'endLeaveRoomBtn';
  leave.textContent = s.mpLeave;
  // 结算页上这一颗也要问一句：四个出口问的是同一件事，不该有的问、有的不问。
  leave.addEventListener('click', () => confirmLeaveRoom(lang, handlers.onLeave));
  row.appendChild(leave);

  return () => {
    leave.remove();
    if (again) again.hidden = false;
  };
}
