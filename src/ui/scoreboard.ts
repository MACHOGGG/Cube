import { STRINGS, type I18nStrings, type Lang } from '../i18n';
import { confirmLeaveRoom } from './confirmLeaveRoom';
import { hostNotice, hostTroubleIn, showWaitPanel, tickFor } from './roomNotices';
import {
  avatarSvg,
  currentRoom,
  forgetRoom,
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
 * 它不再是浮在角上的小面板，而是底下那一排里的一块——房间局那一排只剩右边
 * 一颗《离开房间》，左边整条就是这份名单。既然是一场比赛，「我现在第几」本
 * 来就该和分数、时间一样，是一直看得见的读数之一。
 */

const REEL_ID = 'scoreReel';
const END_OVERLAY_ID = 'endOverlay';
/** Often enough to feel live, rarely enough to be nothing on a battery. */
const LOCAL_MS = 500;
/** 分数没动也要隔多久报一次到。服务器那边 12 秒不见人就算掉线（api/room.js
 *  的 AWAY_MS），4 秒一次留出三次的余量：掉一两个包不至于被判出局。 */
const HEARTBEAT_MS = 4000;
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
 * 交上去的那个数：打的过程中是 HUD 上的原始得分，走完之后换成综合得分。
 *
 * 两个数各管一段，因为它们各自只在那一段里成立。正打着的时候综合得分不存在
 * ——时间还在走，没翻完的块还可能翻——所以实时名单只能比原始得分。而一局
 * 结束之后再比原始得分就不对了：同一副牌，多磨五分钟总能多滑出几分，名次会
 * 变成「谁耗得久谁赢」。综合得分里有时间系数（房间里还放大了一倍半），那才
 * 是这场比赛想比的东西。
 */
function submittedScore(over: boolean): number | null {
  const live = localScore();
  if (!over) return live;
  const raw = document.getElementById(END_OVERLAY_ID)?.dataset.total;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : live;
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
  /** 房间没了，人得回到主菜单——不出卡片，因为没什么可结算的。 */
  onHome: () => void;
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
  const shapeId = document.querySelector<HTMLElement>('.app--game')?.dataset.shape ?? 'square';
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

  // 名单就画在底下那一排里，《离开房间》左边那一整条。
  //
  // 它原来是一块浮在屏幕左下角的小面板，压在按钮上——指针能穿过去，眼睛穿不
  // 过去，那颗键看上去是被埋住的。现在房间局的那一排本来就空出了半条（《完
  // 成》和《暂停》都撤了），名单直接站进去：不再盖住任何东西，也不用再去量
  // 按钮在哪儿、转屏之后重量一次。
  const rows = document.getElementById('mpRank');
  if (!rows) return restoreEndPanel;
  rows.setAttribute('aria-label', s.mpStandings);

  let lastSent = -1;
  let sentFinished = false;
  let dead = false;

  const paint = (state: RoomState) => {
    // 名单按人数分行高：两个人就两行大字，四个人就四行小字，整块的高度不
    // 变——它是那一排里的一块，和右边那颗键一样高，不能随人数长个儿。
    rows.style.setProperty('--rank-rows', String(Math.max(2, state.players.length)));
    rows.innerHTML = state.players
      .map((p, rank) => {
        const me = p.id === seat.playerId;
        return `<div class="mp-board-row${me ? ' mp-board-row--me' : ''}${p.left ? ' mp-board-row--left' : ''}">
          <span class="mp-board-rank">${rank + 1}</span>
          <span class="mp-avatar mp-avatar--small">${avatarSvg(p.avatar)}</span>
          <span class="mp-board-name">${esc(p.name)}</span>
          ${p.left ? '' : tickFor(p.finished, s.mpFinished)}
          <span class="mp-board-score">${p.score}</span>
        </div>`;
      })
      .join('');
  };

  // 交了卷之后盖在结算页上的那一层，和房主出了状况时的那一层。两个都按需
  // 造出来：一整局什么事都没有的时候，它们一个字节都不占。
  let wait: ReturnType<typeof showWaitPanel> | null = null;
  const notice = hostNotice(lang, {
    onDismiss: () => {
      dead = true;
      forgetRoom();
      handlers.onHome();
    },
    onLeave: () => {
      dead = true;
      handlers.onLeave();
    },
  });

  // Everyone else's scores.
  const stopWatching = watchRoom(
    (state) => {
      if (dead) return;
      paint(state);
      // 房主走了、还是房主卡住了——两件事说两句不同的话，见 roomNotices.ts。
      notice.set(hostTroubleIn(state, iAmHost()));
      // 这一局所有人都交卷了 —— 直接回小屋，不出结算页。
      //
      // 小屋里的一局不是一个完整的故事，它是一晚上里的一段：结算页问的
      //《再来一局？》《回主页？》都不是这里该问的问题，真正在等的事只有一件
      // ——房主挑下一场。所以这里不再「撤掉等待页、露出底下的结算页」，而是
      // 直接把人送回小屋，比分和名次就在那一页上。
      // 单人局一个字都没动：mountScoreboard 在没有座位的时候第一行就返回了。
      if (runFinished() && state.roundOver) {
        wait?.remove();
        wait = null;
        dead = true;
        markPlayed();
        return handlers.onRoom();
      }
      // 自己交了卷、别人还在打：盖上一层等待页，上面是这一局的标志，下面是
      // 还在动的名单。
      if (runFinished()) {
        wait ??= showWaitPanel(lang, {
          shapeId,
          meId: seat.playerId,
          onLeave: () => confirmLeaveRoom(lang, handlers.onLeave),
        });
        wait.update(state);
      } else if (wait) {
        wait.remove();
        wait = null;
      }
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

  // Our own, off the HUD, and only when it has actually moved —— 外加一条
  // 保命的心跳。
  //
  // 从前这里是「分数没变就不发」。可服务器判断一个人还在不在，看的正是最后
  // 一次报到的时间（api/room.js 的 seat.lastSeen，超过 AWAY_MS 就算掉线）。
  // 于是出现了这样一件事：一个人正常打牌，想了十几秒没得分，服务器就当他走
  // 了——他要是房主，满房间的人都会看到《房主修理电缆中，稍等》。网络一点
  // 问题都没有，安卓 iOS 一样中招。
  //
  // 所以分数没变也要按时报到，只是慢一点：至多每 HEARTBEAT_MS 一次。分数变
  // 了仍然立刻发，那一条不受影响。
  let lastSentAt = 0;
  const localTimer = window.setInterval(() => {
    if (dead) return;
    const over = runFinished();
    const score = submittedScore(over);
    if (score === null) return;
    const changed = score !== lastSent || over !== sentFinished;
    if (!changed && Date.now() - lastSentAt < HEARTBEAT_MS) return;
    lastSent = score;
    sentFinished = over;
    lastSentAt = Date.now();
    if (over) markPlayed();
    void reportScore(score, over, runSeconds());
  }, LOCAL_MS);

  return () => {
    dead = true;
    wait?.remove();
    notice.remove();
    restoreEndPanel();
    stopWatching();
    window.clearInterval(localTimer);
    // One last report, so a player who leaves mid-run does not sit at a
    // stale number on everybody else's screen.
    const score = submittedScore(runFinished());
    if (score !== null) {
      markPlayed();
      void reportScore(score, true, runSeconds());
    }
    rows.innerHTML = '';
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
