import { STRINGS, countPhrase, type I18nStrings, type Lang } from '../i18n';
import { confirmLeaveRoom } from './confirmLeaveRoom';
import { CTL_LEAVE } from './ctlIcons';
import { stashRoomLeftover } from './roomLeftover';
import { isLayoutLocked } from '../engine/geniusContent';
import { isGenius } from '../engine/subscription';
import { pushLayer } from '../engine/backNav';
import { hostNotice, showWaitPanel, tickFor } from './roomNotices';
import { contestants, liveTotal } from './roomCard';
import { standingsWindow } from '../engine/standingsWindow';
import {
  avatarSvg,
  currentRoom,
  hostTroubleIn,
  leaveRoom,
  iAmHost,
  lastPlayedRound,
  latestRoomState,
  markRoundPlayed,
  reportScore,
  forceRound,
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
/** 分数没动也要隔多久报一次到。服务器那边 30 秒不见人就算掉线（api/room.js
 *  的 AWAY_MS），4 秒一次留出六七次的余量：掉几个包不至于被判出局。
 *
 *  这个数原先写的是 12 秒——那是 AWAY_MS 放宽到 30 秒之前的旧值，注释没跟着
 *  改，于是后来的人照着它算余量会算少一半。 */
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
 *
 * ── 为什么这两个数必须「只算一次」 ──────────────────────────────────
 *
 * 从前判断走到哪一段，看的是结算页有没有 .show；每一秒的心跳都重新看一次、
 * 重新取一次数。屋里两个人于是可能各走各的分支：一个人那一拍结算页在，报的
 * 是综合得分；另一个人那一拍结算页不在（小屋里那一层本来就只闪一下），报的
 * 是原始得分。同一张名单上并排放着两把不同的尺子，看上去就是「分数错乱」。
 *
 * 更狠的是最后一下：棋盘拆掉之后，HUD 上那颗计分轮回到 0，而心跳还在跑——
 * 于是这个人的成绩被一条 score: 0 盖掉，整个人的分数完全不对。
 *
 * 所以改成：一局走完的那个数，第一次算出来就钉死，之后再也不从页面上重读。
 * 认的也不再是 .show（它会撤），而是 dataset.total 在不在——那一项只在
 * endGame() 里写一次（见 gameController.ts），写下了就说明这一局确实走完了，
 * 而且元素还在的时候它一直都在。
 */
export interface Settled {
  score: number;
  seconds: number | undefined;
}

/** 钉死这一局的成绩；还没走完就返回 null。 */
function settleOnce(held: Settled | null): Settled | null {
  if (held) return held;
  const el = document.getElementById(END_OVERLAY_ID);
  const raw = el?.dataset.total;
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return { score: Math.round(n), seconds: runSeconds() };
}

/**
 * 一局打完之后，这三颗按钮各自去哪。
 *
 * 单人局的结算页上，《主页》和《再来》的意思是清楚的。房间里不是：主页不该
 * 把人丢出房间（比分还在那儿，屋主还要开下一局），而《再来》如果只是本地重
 * 开一副牌，那就是在一场已经结束的比赛里自己跟自己再玩一遍。所以在房间里这
 * 两颗要换去处，另外补一颗真正能走的《离开房间》。
 */
export interface RoomRunHandlers {
  /** 回房间页——比分和下一局都在那里。 */
  onRoom: () => void;
  /** 屋主专用：回主菜单，继续为整房挑下一个玩法。 */
  onPickNext: () => void;
  /** 交出座位，并出一张截止此刻的竞赛排名。 */
  onLeave: () => void;
  /** 房间没了，人得回到主菜单——不出卡片，因为没什么可结算的。 */
  onHome: () => void;
  /**
   * 小屋正式散场了，而我已经交了卷、正等着别人。
   *
   * 这时候该出的是那张小屋战绩：截止此刻的总分、名次、单局最高、最快完成，
   * 一样不少——数据全都在手上的这份 state 里。原来这条路走的是「屋主出状
   * 况」那一层提示：一句话，然后弹回主菜单，一整晚的东西全扔了；而同样一
   * 个解散动作，人要是恰好站在小屋列表页，却能看到完整的卡。同一件事，不
   * 该因为当时站在哪一屏就是两种结果。
   */
  onRoomEnded: (state: RoomState) => void;
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
   * 这一局是第几局——定一次就不再改。
   *
   * 不能等到交卷时再去问「现在是第几局」：屋主可能已经开了下一局，那时问到
   * 的是新的回合号，于是一局都没打的新回合被记成「打过了」，人回到房间也不
   * 会再倒计时。这个数字属于这一局，就该在这一局开始时定下来。
   *
   * 但「定一次」的起点可以是**还不知道**。挂上来的这一刻手里不一定有房间状
   * 态：刚进页面、断线重连、App 被划掉再打开——latestRoomState() 都是 null。
   * 从前那句写的是 `?? 0`，于是局次成了 0，reportScore 干脆不带 round 字段
   * （engine/room.ts 里那个三元判断），服务器那道「局次对不上就丢掉」的守卫
   * 整个被绕过——**它专为断线重连而设，却恰恰在断线重连时失效**，上一局的分
   * 就这么写进了新的一局。
   *
   * 所以 null 是「还不知道」，不是 0：不知道的时候一分都不报，攒着；第一次
   * 轮询回来就把它定下来，再把攒的那一份补发出去。这块计分板只活一局，所以
   * 「定一次」和「这一局」说的仍然是同一件事。
   */
  let myRound: number | null = latestRoomState()?.round ?? null;
  /** 还不知道局次那会儿攒下的最后一次成绩。知道了立刻补发。 */
  let pending: { score: number; over: boolean; seconds: number | undefined } | null = null;
  /** 这一局在本机算打完了：回到房间时才不会把它当新的一局重开。 */
  const markPlayed = () => markRoundPlayed(myRound ?? 0);

  /** 「这一局没算进总分」只说一次——心跳每四秒一条，说四次就成了骚扰。 */
  let droppedTold = false;

  /**
   * 屋主按「不等了」把这一局结束了，而本机这一局还没打完（10-09 补充方案 7-5）。
   *
   * 认出来之后三件事：飘一句 mpRoundForced（「屋主结束了这一局：您到刚才的 N 分已算进小屋总分」，
   * 0 分时只说前半句）；从此不再报分——服务器那一格已经 final 了，报上去也是一条一条被挡掉，而下一局
   * 开了之后再报，局次对不上，服务器还会把他记成「新的这一局已经交了 0 分的卷」；**不把他从棋盘上拽
   * 走**——正打着的人不该被拽走（下面轮询里那条老规矩），这一局他想打完就打完，只是不再算数。
   *
   * 从前这些一件都没有：他屏幕上什么都不发生，照旧报分；屋主开了下一局，他下一次报分局次对不上，
   * 飘出来的是 mpRoundDropped「离开太久了，这一局没算进小屋总分」——是假话。所以认出来之后
   * droppedTold 那一句也不再说（forcedOut 挡在它前面）。
   */
  let forcedOut = false;
  /**
   * 这一局开打时我在小屋账上是几局、累计多少——给「回来时下一局已经开了」那一种用（见 noticeForced）。
   * 只在手上的房间状态还是这一局的时候记，记一次。
   */
  let before: { rounds: number; total: number } | null = null;
  const meIn = (state: RoomState) => state.players.find((p) => p.id === seat.playerId);
  const noteBefore = (state: RoomState) => {
    if (before || myRound === null || state.round !== myRound) return;
    const me = meIn(state);
    if (me) before = { rounds: me.rounds || 0, total: me.total || 0 };
  };
  {
    const known = latestRoomState();
    if (known) noteBefore(known);
  }
  /**
   * 看一眼这份房间状态：这一局是不是被屋主结束了。认出来就说那一句、停止报分，回 true；之后每次都回
   * true（调的地方据此不再说 mpRoundDropped）。
   *
   * 两种读法：
   *   · **还是这一局**：我这一位上标着 `forced`（api/room.js 的 force），分数就是服务器替我交的那一份。
   *   · **已经是下一局了**：我切出去了、网断了，回来时屋主早就开了下一局，`forced` 那一格已经被清掉。
   *     这时候看账——这一局开打时我在账上几局（before）；现在多了，就说明这一局按当时的分记进去了
   *     （只有交了卷的才记账，而本机没交：那就是屋主替我交的），多出来的那一截总分就是那个分。账上没多，
   *     那一局确实没算（90 秒没消息，屋主没替我交——force 不替掉线的人交），mpRoundDropped 说的是实话。
   *     这一种不是少见的边角：被屋主按「不等了」的，多半正是切到别的应用去了的那个人，而 iPhone 上切
   *     走的网页一下都不轮询。
   *
   * 本机已经打完了就不说（settleOnce 认得出来，和报分那头同一个判据）：那时候结算页和等待页盖着棋
   * 盘，他的成绩是他自己交的那一份。
   */
  const noticeForced = (state: RoomState): boolean => {
    if (forcedOut) return true;
    if (myRound === null || settleOnce(null)) return false;
    const me = meIn(state);
    if (!me) return false;
    let n: number | null = null;
    if (state.round === myRound && me.forced) n = me.score;
    else if (state.round > myRound && before && (me.rounds || 0) > before.rounds) n = (me.total || 0) - before.total;
    if (n === null) return false;
    forcedOut = true;
    flyby(n > 0 ? countPhrase(s.mpRoundForced, n, lang) : s.mpRoundForcedZero);
    return true;
  };
  /**
   * 报一次分，顺便看一眼服务器还认不认这一局。
   *
   * 玩家切出去太久（api/room.js 的 ABSENT_MS，90 秒），屋主开了下一局，他回
   * 来交的这一份就带着旧的回合号。服务器那边（api/room.js 的 score）认出回
   * 合号对不上，**一声不吭地扔掉**，还照样回 200 和一份房间状态——从客户端
   * 看和成功报到一模一样。于是他打完一整局，分数一分没进小屋总分，屏幕上什
   * 么都没说。
   *
   * 分辨的办法就在那份状态里：它带着服务器现在的回合号。和自己手里这一局的
   * 对不上，就是被扔了。飘一句话说清楚（不占版面、不用按、自己会走），其余
   * 什么都不改——这一盘照旧存进他自己的《记录与排名》（gameController 的
   * saveRun 是无条件的），所以那句话的后半句是实话。
   */
  const report = (score: number, over: boolean, seconds: number | undefined) => {
    // 屋主已经替我交了卷（见 forcedOut）：不再报。
    if (forcedOut) return;
    // 还不知道这一局是第几局：攒着，别拿一个「不带局次」的请求去绕过守卫。
    if (myRound === null) {
      pending = { score, over, seconds };
      return;
    }
    const mine = myRound;
    void reportScore(score, over, seconds, mine).then((res) => {
      if (mine <= 0 || !res.ok) return;
      // 回包就是一份房间状态：被屋主结束了的话，说的是另一句，而且不再说下面那句。
      if (noticeForced(res.value) || droppedTold) return;
      const serverRound = res.value.round;
      if (!serverRound || serverRound === mine) return;
      droppedTold = true;
      flyby(s.mpRoundDropped);
    });
  };

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
    // 第一次问到房间状态：把「这一局是第几局」定下来，并且把还不知道那会儿
    // 攒下的那一份成绩补发出去（见上面 myRound 那段）。只定这一次——往后屋
    // 主再开新局，这块计分板会整个换掉，不该在原地改号。
    if (myRound === null && typeof state.round === 'number' && state.round > 0) {
      myRound = state.round;
      const owed = pending;
      pending = null;
      if (owed) report(owed.score, owed.over, owed.seconds);
    }
    noteBefore(state);
    /**
     * 超过三个人就只摆三行：第一名、我前面那一名、我自己（engine/
     * standingsWindow.ts，规矩和边界情形都在那儿，门是 check-standings-window）。
     *
     * 这块地方只有 66–104px 高，行高是它除以人数：八个人挤进来，一行只剩约
     * 11px、字号 7px——那不是「小」，是读不出来。而选手在局中真正要知道的只
     * 有两件事：冠军现在多少分（还差多远），我前面那个多少分（够不够得着）。
     * 全场名单是大屏那一端的事。
     */
    // 竞赛屋的主持人不在这块板上（第 14 推，见 roomCard.ts 的 contestants）：他不参赛，
    // 列进来就是一行永远 0 分的人，还占掉「第一名 / 我前面那一名」那两行里的一行。
    const players = contestants(state);
    const meIndex = players.findIndex((p) => p.id === seat.playerId);
    const win = standingsWindow(players.length, meIndex);
    // 名单按**摆出来的行数**分行高（不是屋里的人数）：两个人就两行大字，收
    // 成三行之后就按三四行算，整块的高度自始至终不变——它是那一排里的一块，
    // 和右边那颗键一样高，不能随人数长个儿。
    rows.style.setProperty('--rank-rows', String(Math.max(2, win.length)));
    rows.innerHTML = win
      .map((row) => {
        // 名次接不上的那一截。只画一个省略号，不写「还有 N 人」——这一行本来
        // 就是「中间还有人」的意思，而读屏从下一行的名次（1. 之后直接是 8.）
        // 已经读得出来，多一句话是这块巴掌大的地方最不需要的东西。
        if (row.kind === 'gap') {
          return '<div class="mp-board-row mp-board-row--gap" aria-hidden="true">···</div>';
        }
        const p = players[row.index];
        const me = p.id === seat.playerId;
        // 印的是**累计总分**（前几局加上这一局），不是刚打的这一局。
        //
        // 座次本来就是按累计排的（服务器 publicState、名单卡 rankRoom、倒数
        // 那一屏，三处同一把尺子），只有这儿印的是单局分。于是从第二局起就
        // 看得出毛病：上一局领先的人这一局还没得分，名单上他排第一、写着
        // 「0」，压在写着「900」的人头上；交卷那一瞬间界面换成累计分，前后两
        // 屏说的又是两回事。liveTotal 就是别处在用的那一个（ui/roomCard.ts）。
        return `<div class="mp-board-row${me ? ' mp-board-row--me' : ''}${p.left ? ' mp-board-row--left' : ''}">
          <span class="mp-board-rank">${row.rank}</span>
          <span class="mp-avatar mp-avatar--small">${avatarSvg(p.avatar)}</span>
          <span class="mp-board-name">${esc(p.name)}</span>
          ${p.left ? '' : tickFor(p.finished, s.mpFinished)}
          <span class="mp-board-score">${liveTotal(p)}</span>
        </div>`;
      })
      .join('');
  };

  /**
   * 屋主散场了，而这一局还在打——把它原地变成一局单人。
   *
   * 不把人赶回主菜单：他手上这盘棋是真的，走到一半被没收，比小屋散了本身更
   * 难受。小屋没了，比赛没了，但这一局还可以打完，只是从此只关他自己。
   *
   * 做三件事，都很小：
   *   · 忘掉座位（本机忘就够了，屋子已经不在），于是《完成》不再问「交卷
   *     吗」、也不再上报分数，结算页回到单人那一套；
   *   · 底下那条实时排名和《离开小屋》撤掉，藏着的《暂停》顶上来——一局单
   *     人棋本来就该能停；
   *   · 停掉轮询和上报。
   *
   * 有一件事跟着变，说清楚：时间系数从小屋的那一档（1.5 倍）回到单人的那
   * 一档。这是对的——已经没有人和他比快慢了。
   */
  const goSolo = (say: string = s.mpHostAwaySolo) => {
    dead = true;
    stopWatching?.();
    window.clearInterval(localTimer);
    wait?.remove();
    wait = null;
    notice.remove();
    restoreEndPanel();
    // 小屋那份成绩先留一份底：屋子已经散了，交回座位之后座位和最后看到
    // 的房间状态都取不到了。等这一局打完，它会摆在结算页最上面（见
    // roomLeftover.ts）——他在这间屋子里打过的那几局不该跟着屋子一起蒸发。
    stashRoomLeftover(latestRoomState(), seat.playerId);
    // 正式交回座位，不只是本机忘掉：屋主可能只是暂时联系不上（hostTroubleIn
    // 的 'gone' 说的是「太久没动静」，不是「他按了解散」）。先 stash 再走，
    // leaveRoom 会把最后看到的房间状态一起清掉。
    void leaveRoom();
    rows.remove();
    // 这一排原地换成单人局那一套：名单、《离开小屋》、《完成》和那颗小的
    // 《色盲友好》一起撤掉，只留一颗《暂停》，占半条宽、居中。撤掉的那三件
    // 事并没有消失，是搬进了暂停面板——而这颗《暂停》正是这时候才露面的。
    document.getElementById('leaveRoomBtn')?.remove();
    document.getElementById('cvdRoomBtn')?.remove();
    document.getElementById('finishBtn')?.remove();
    const row = document.querySelector('.controls');
    row?.classList.remove('controls--room');
    row?.classList.add('controls--solo');
    const pause = document.getElementById('stopBtn');
    if (pause) pause.hidden = false;
    // 版图上一格都没变，名单却忽然没了——不说一句，玩家只会以为哪里出了错。
    // 一句话从标语下面飘过去就够（玩家的原话：「在非游戏版图内出现一句标语
    // 《屋主暂时离开，正在独自游玩》飘过就好」）：不挡棋盘、不用按、说完自
    // 己走，这一局照打不误。
    flyby(say);
  };

  /**
   * 屋主散场，而这一局这个人自己打不了：天才特供的棋盘、无限反转、老虎机，
   * 他没订阅也没有生效的内部码。
   *
   * 不结算、不存档、不上榜——一句话说清楚，按下去回主页（玩家的原话：「会跳
   * 出《屋主离开，小屋暂时解散，等一会再来？》的标语，确认后就是回到主页没
   * 有游戏结束结算也没有成绩储存」）。有权限的人不走这儿，走 goSolo 原地转成
   * 单人接着打。
   *
   * 先把这一局停住：话还挂着的时候表不能再走——走完了就成了一场自动结算。
   */
  const lockedMode = (st: RoomState) =>
    isLayoutLocked(shapeId) || (!isGenius() && (st.flip || Boolean(st.slot)));
  const lockedOut = (say: string = s.mpHostLeftLocked, ok: string = s.mpOk) => {
    leaveForGood();
    // 房间局里这颗键藏着，但它还在、还接着 doPause：借它把表停住。
    document.querySelector<HTMLButtonElement>('#stopBtn')?.click();
    homeNotice(say, ok);
  };

  /** 不再跟这间屋有任何往来：停轮询、停上报、撤掉盖着的那几层，座位正式交回去。 */
  const leaveForGood = () => {
    dead = true;
    stopWatching?.();
    window.clearInterval(localTimer);
    wait?.remove();
    wait = null;
    notice.remove();
    // 同上：正式交回座位。
    void leaveRoom();
  };

  /** 一句话、一颗键，按下去回主页（返回键也是）。 */
  const homeNotice = (say: string, ok: string) => {
    const box = document.createElement('div');
    box.className = 'overlay opaque show';
    box.id = 'roomLockedOut';
    box.innerHTML = `
      <div class="modal">
        <p class="tag-line">${say}</p>
        <div class="btn-row"><button class="primary" id="roomLockedOk">${ok}</button></div>
      </div>
    `;
    document.body.appendChild(box);
    const go = () => {
      box.remove();
      handlers.onHome();
    };
    pushLayer(go, box);
    box.querySelector<HTMLButtonElement>('#roomLockedOk')?.addEventListener('click', go);
  };

  /**
   * 这间小屋在库里已经不在了——过期了（二十分钟没人动它，api/room.js 的 ROOM_TTL_S），10-09 补充
   * 方案 7-13 第 14 条。极少见：一屋人都在打的时候，每一次报分都在给它续命；要走到这儿，得是整屋
   * 断了好一阵又回来。
   *
   * 原先轮询失败一律「什么都不动」（见 watchRoom 那个 onError），可这一种不是「这一下没问到」，是定
   * 论——再问一万次它也不会回来：交了卷的人永远停在等待页上，正打着的人打完也一样。现在和屋主散场
   * 同一套去处，只是话不一样：
   *   · 还在打、这一局他打得了 → 原地转成单人打完（结算页上就有回主页的路）；
   *   · 还在打、打不了（天才特供那几样）→ 停住、说一句、按下去回主页；
   *   · 已经交了卷在等 → 等待页撤掉、说一句、按下去回主页。
   */
  const roomExpired = () => {
    if (!runFinished()) {
      const st = latestRoomState();
      const locked = st ? lockedMode(st) : isLayoutLocked(shapeId);
      return locked ? lockedOut(s.mpRoomExpired, s.homeBtn) : goSolo(s.mpRoomExpiredSolo);
    }
    leaveForGood();
    homeNotice(s.mpRoomExpired, s.homeBtn);
  };

  /**
 * 棋盘上方飘过一句话，说完自己撤。
 *
 * 摆在标语底下、HUD 上面——那一块是页面自己的地方，版图一格都不占，所以它
 * 既不会挡住正在打的这一局，也不用玩家按任何东西把它关掉。
 */
function flyby(text: string): void {
  const anchor = document.querySelector('.app--game .tag-line');
  if (!anchor || !anchor.parentElement) return;
  const el = document.createElement('p');
  el.className = 'solo-flyby';
  el.textContent = text;
  anchor.insertAdjacentElement('afterend', el);
  el.addEventListener('animationend', () => el.remove());
  // 动画被系统关掉（prefers-reduced-motion 之外还有直接禁掉动画的机器）时
  // animationend 不会来：兜一个底，到点无论如何撤掉。
  window.setTimeout(() => el.remove(), 9000);
}

/** 这间小屋结束了：屋主按了《解散小屋》，或者他的终端没了。 */
  const roomOver = (state: RoomState) =>
    state.ended || hostTroubleIn(state, iAmHost()) === 'gone';

  // 交了卷之后盖在结算页上的那一层，和屋主出了状况时的那一层。两个都按需
  // 造出来：一整局什么事都没有的时候，它们一个字节都不占。
  let wait: ReturnType<typeof showWaitPanel> | null = null;
  const notice = hostNotice(lang, {
    onDismiss: () => {
      dead = true;
      // 和小屋页那一处同一条：屋主可能只是暂时联系不上，屋子并没有散——
      // 按下确定就把座位正式交回去，别把一把清不掉的空椅子留在屋里。
      void leaveRoom();
      handlers.onHome();
    },
    onLeave: () => {
      dead = true;
      handlers.onLeave();
    },
  });

  /**
   * 屋主的等待页上多一颗「不等了」（2026-10-08 方案 2-6）：还没交卷的人替他交卷，这一局就此
   * 结束。只有屋主有——问的是此刻（屋主是谁不会在一局里变，可这块计分板是开局时挂上的）。
   */
  const forceIfHost = () => (iAmHost() ? { onForce: () => forceRound().then((r) => r.ok) } : {});

  // 交卷那一刻就把等待页盖上，不等下一次轮询。
  //
  // 原来等待页是在轮询回调里盖的：交卷 → 结算页先亮出来 → 最多一秒之后下一
  // 次轮询到了才盖上等待页。中间那一闪就是玩家说的「交卷时闪一下旧结算页」。
  // 结算页亮起来的信号就是 #endOverlay 拿到 show，盯着它，同步盖上；名单先
  // 用手上最后一份 state 画，下一次轮询到了再刷。
  const endEl = document.getElementById(END_OVERLAY_ID);
  const coverNow = () => {
    if (dead || wait || !runFinished()) return;
    const known = latestRoomState();
    if (!known || roomOver(known)) return;
    // 这一局在我交卷之前就已经算结束了（别人都交了、我又被判缺席过）：没什
    // 么可等的，直接回小屋——和下面轮询里那一条同一个去处，只是不必再等
    // 下一次轮询、让结算页先露一秒。
    if (known.roundOver) {
      dead = true;
      markPlayed();
      handlers.onRoom();
      return;
    }
    wait = showWaitPanel(lang, {
      shapeId,
      meId: seat.playerId,
      code: seat.code,
      onLeave: () => confirmLeaveRoom(lang, handlers.onLeave),
      ...forceIfHost(),
    });
    wait.update(known);
  };
  const endWatch = endEl && typeof MutationObserver !== 'undefined' ? new MutationObserver(coverNow) : null;
  if (endEl) endWatch?.observe(endEl, { attributes: true, attributeFilter: ['class'] });

  // Everyone else's scores.
  const stopWatching = watchRoom(
    (state) => {
      if (dead) return;
      paint(state);
      // 屋主按了「不等了」：说一句、不再报分，棋盘照旧开着（见 noticeForced）。
      noticeForced(state);
      // 小屋散了，而这一局还在打：不把人赶走，就地转成一局单人。
      //
      // 这一条要排在 notice 前面：《Ohno！小屋被取消》那一层是给「已经没在
      // 打」的人看的，正打着的人不该被一张遮罩糊住盘面。
      if (roomOver(state) && !runFinished()) {
        return lockedMode(state) ? lockedOut() : goSolo();
      }
      // 我已经交了卷、正等着别人，这时候小屋散了：当下的分数立刻算数，直接
      // 出那张战绩卡。要排在 notice 前面——那一层是「还没有结果」时的提示，
      // 而这里结果已经有了。
      if (runFinished() && roomOver(state)) {
        wait?.remove();
        wait = null;
        dead = true;
        markPlayed();
        return handlers.onRoomEnded(state);
      }
      // 屋主走了、还是屋主卡住了——两件事说两句不同的话，见 roomNotices.ts。
      //
      // 只在「这一局已经打完、正等着别人」的时候说。上面两条都写着「正打着的
      // 人不该被一张遮罩糊住盘面」，偏偏这一行漏了这道判断：屋主网卡一下，全
      // 屋还在打的人就被《屋主暂时联系不上》整屏罩住，那张遮罩上只有一颗
      //《离开小屋》，连关都关不掉——想接着打只能退出去。屋主的状态跟他们手里
      // 这一局没有关系，等他们打完再说也不迟。
      //
      // 这里拦掉的只会是《屋主暂时联系不上》（away）那一种：屋主真的走了
      //（gone）在上面第一条就被 roomOver 接走转了单人，走不到这一行。
      notice.set(runFinished() ? hostTroubleIn(state, iAmHost()) : null);
      // 这一局所有人都交卷了 —— 直接回小屋，不出结算页。
      //
      // 小屋里的一局不是一个完整的故事，它是一晚上里的一段：结算页问的
      //《再来一局？》《回主页？》都不是这里该问的问题，真正在等的事只有一件
      // ——屋主挑下一场。所以这里不再「撤掉等待页、露出底下的结算页」，而是
      // 直接把人送回小屋，比分和名次就在那一页上。
      // 单人局一个字都没动：mountScoreboard 在没有座位的时候第一行就返回了。
      if (runFinished() && state.roundOver) {
        dead = true;
        markPlayed();
        // 先把人送回小屋、小屋页画好，再撤等待页。撤早了，露出来的是底下那张
        // 单局结算页——正是玩家看到的「结算时闪一下就没了」。小屋页那边现在
        // 一进去就同步先画（见 multiplayer.ts 的开头那段），两件事在同一帧里
        // 做完，中间没有一帧是结算页。
        handlers.onRoom();
        wait?.remove();
        wait = null;
        return;
      }
      // 自己交了卷、别人还在打：盖上一层等待页，上面是这一局的标志，下面是
      // 还在动的名单。
      if (runFinished()) {
        wait ??= showWaitPanel(lang, {
          shapeId,
          meId: seat.playerId,
          code: seat.code,
          onLeave: () => confirmLeaveRoom(lang, handlers.onLeave),
          ...forceIfHost(),
        });
        wait.update(state);
      } else if (wait) {
        wait.remove();
        wait = null;
      }
      // 屋主已经开了下一局，而这台设备还停在上一局的结算页上。谁也不会来叫
      // 他——开局的倒计时是房间页在听的，而这台设备现在不在房间页上。所以
      // 由这里把人送回去，房间页一进去就接上倒计时。
      // 只在本局已经打完之后才动：正打着的人不该被拽走。
      if (runFinished() && state.startAt && state.round > lastPlayedRound()) {
        dead = true;
        return handlers.onRoom();
      }
    },
    (reason) => {
      if (dead) return;
      // 小屋过期了：这一种是定论，不是「这一下没问到」（见 roomExpired）。本机还拿着座位才算——
      // 本机连座位都没有时 fetchState 也答 noRoom，那一种不是服务器说的，不在这儿认。
      if (reason === 'noRoom' && currentRoom()) return roomExpired();
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
  // 了——他要是屋主，满房间的人都会看到《屋主修理电缆中，稍等》。网络一点
  // 问题都没有，安卓 iOS 一样中招。
  //
  // 所以分数没变也要按时报到，只是慢一点：至多每 HEARTBEAT_MS 一次。分数变
  // 了仍然立刻发，那一条不受影响。
  let lastSentAt = 0;
  /** 这一局走完之后的成绩，算出来就钉在这儿，不再重读。 */
  let settled: Settled | null = null;
  const localTimer = window.setInterval(() => {
    if (dead) return;
    settled = settleOnce(settled);
    const over = settled !== null;
    const score = settled ? settled.score : localScore();
    if (score === null) return;
    const changed = score !== lastSent || over !== sentFinished;
    if (!changed && Date.now() - lastSentAt < HEARTBEAT_MS) return;
    lastSent = score;
    sentFinished = over;
    lastSentAt = Date.now();
    if (over) markPlayed();
    report(score, over, settled ? settled.seconds : runSeconds());
  }, LOCAL_MS);

  return () => {
    endWatch?.disconnect();
    dead = true;
    wait?.remove();
    notice.remove();
    restoreEndPanel();
    stopWatching();
    window.clearInterval(localTimer);
    // One last report, so a player who leaves mid-run does not sit at a
    // stale number on everybody else's screen.
    //
    // 走完了就报那个钉死的数。这一下最容易出事：拆到这里棋盘往往已经没了，
    // 计分轮回到 0，再去读 HUD 就是拿一个 0 盖掉人家一局的成绩。
    settled = settleOnce(settled);
    const score = settled ? settled.score : localScore();
    if (score !== null) {
      markPlayed();
      report(score, true, settled ? settled.seconds : runSeconds());
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

  /**
   * 换掉的那些键，连同它们本来的样子。
   *
   * 「换成克隆」这一手是单向的：克隆不带监听器，而原来那一颗被摘下去之后，
   * 它自己的监听器还好好地挂着（replaceWith 只是把它从文档里拿走）。所以把
   * 原件留一份，还原的时候原样放回去——不然屋主一散场、这一局转成单人，
   * 《主页》那颗键在结算页上就成了一颗按不动的死键。
   */
  const swapped: { fresh: HTMLElement; original: HTMLElement }[] = [];

  const swap = (id: string, label: string, onClick: () => void): HTMLElement | null => {
    const original = row.querySelector<HTMLButtonElement>(`#${id}`);
    if (!original) return null;
    const fresh = original.cloneNode(true) as HTMLButtonElement;
    // 这几颗键 10-08 方案 3-I 起只有记号没有字（设计图），名字在 aria-label 上。从前这儿写的是
    // textContent——那会把键上的记号整个冲掉，留下一颗写着字的白键。
    fresh.setAttribute('aria-label', label);
    original.replaceWith(fresh);
    fresh.addEventListener('click', onClick);
    swapped.push({ fresh, original });
    return fresh;
  };

  const host = iAmHost();

  // 《主页》：屋主回主菜单挑下一个玩法（那就是「回主页继续玩」）；客人回房间页，
  // 因为开局的权限不在他手上，主菜单对他没有可按的东西。
  swap('endBackBtn', s.homeBtn, host ? handlers.onPickNext : handlers.onRoom);

  // 《再来》：屋主用同一个玩法立刻再开一局。客人开不了局，这颗对他没有意义，
  // 与其让它跳到别的地方假装能用，不如收起来。
  const again = row.querySelector<HTMLButtonElement>('#restartBtn');
  if (host) {
    swap('restartBtn', s.restartBtn, () => {
      // 再开的是同一种局：同一副棋盘，老虎机 / 无限反转的标记也照旧。
      const last = latestRoomState();
      handlers.onRoom();
      if (last?.mode) void startMatch(last.mode, last.slot, last.flip);
    });
  } else if (again) {
    again.hidden = true;
  }

  // 新的一颗：真正走得掉的出口。放在这一排最后，和别的三颗同一种长相（10-08 方案 3-I：只有记号，
  // 这一颗是局里那颗《离开小屋》的那扇门，名字在 aria-label 上）。
  const leave = document.createElement('button');
  leave.className = 'end-act end-act--leave';
  leave.id = 'endLeaveRoomBtn';
  leave.setAttribute('aria-label', s.mpLeave);
  leave.innerHTML = CTL_LEAVE;
  // 结算页上这一颗也要问一句：四个出口问的是同一件事，不该有的问、有的不问。
  leave.addEventListener('click', () => confirmLeaveRoom(lang, handlers.onLeave));
  row.appendChild(leave);

  return () => {
    leave.remove();
    if (again) again.hidden = false;
    // 原件放回去，它们本来的监听器也就跟着回来了。
    for (const { fresh, original } of swapped) fresh.replaceWith(original);
    swapped.length = 0;
  };
}
