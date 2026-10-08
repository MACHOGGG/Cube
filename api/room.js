import { createHash, randomBytes, randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { identify, isGenius as isGeniusClaim } from './_entitlement.js';
import { checkNickname, nicknameOf, nicknameOwner, scrubName } from './_nickname.js';
import { expire, hdel, hget, hgetall, hincrby, hset, hsetnx, storeConfigured } from './_store.js';
import { callerId, tooMany } from './_ratelimit.js';

/**
 * Multiplayer rooms: a four-digit code, two to four players, one board.
 *
 * Almost nothing here is real-time, and that is the design rather than a
 * shortcut. Three things could have needed a socket, and none of them does:
 *
 *   The board. Every player deals it themselves from one seed (see
 *   engine/rng.ts), so what crosses the wire is a short string, once. No
 *   board is transmitted and no client is trusted to report one - none of
 *   them could produce a different board even if it wanted to.
 *
 *   The countdown. The server names an instant, `startAt`, and every device
 *   counts down to it locally. Each reply also carries `serverNow`, so a
 *   client whose clock is off can correct for it. 3-2-1 then lands together
 *   without a single message being exchanged at the moment it matters.
 *
 *   The scoreboard. Scores are polled about once a second. A leaderboard
 *   that re-orders a second later reads as live; nobody can tell, and it
 *   costs no infrastructure at all.
 *
 * Rooms are a Redis hash with one field per player, never a single JSON
 * document: four phones report scores at the same moment, and a
 * read-modify-write of one blob would quietly drop most of those writes.
 */

/**
 * 三个数，不是一个，因为它们回答的是三个不同的问题。
 *
 * ROOM_CAPACITY is what the machinery can carry: a room is a Redis hash with
 * one field per player and every write touches only that player's own field,
 * so nothing here gets harder as the table grows. 二十是屋号（四位数字）、
 * 名单和那张战绩图都还读得下去的那个数。
 *
 * OPEN_SEATS 是普通小屋开着的座位——玩家定的「一般小屋是 2-8 人」。
 * CONTEST_SEATS 是竞赛小屋的——「竞赛版本开放到 20 人上限」，而那 20 指的是
 * **选手**：主持人不参赛（见 isSpectator），但他也要占一把椅子（座位就是身份，
 * `s:0…s:N-1` 是原子占位的那一套），所以是 **21 把**。玩家 2026-09 拍的板：
 * 「要 20 名选手（连主持人 21 人）」。
 * ROOM_CAPACITY 跟着到 21——`seatsFor` 会把座位数夹进
 * [MIN_PLAYERS, ROOM_CAPACITY]，不抬这个数，21 会被夹回 20。
 *
 * 要紧的是第三件事：**座位数是跟着屋子走的，不是跟着这个文件走的**。一间屋
 * 开出来的那一刻就把自己的座位数写进 meta.seats，往后满不满、名单上写
 * 「3/8」还是「3/20」，都问它自己那一个数（seatsFor）。所以以后调这儿的常
 * 数，不会把正开着的那些屋子从「3/8」变成「3/20」——玩家盯着的那个数在一
 * 局中间自己变了，正是「意料之外的界面」。meta 里没有 seats 的老屋（这次改
 * 动之前开的）按 OPEN_SEATS 算，和从前一模一样。
 */
const ROOM_CAPACITY = 21;
/** 普通小屋开着的座位。 */
const OPEN_SEATS = 8;
/**
 * 竞赛小屋开着的座位。
 *
 * 竞赛模式还在筹备：**今天没有任何一个界面会请求开一间竞赛屋**，所以实际跑
 * 起来每一间屋拿到的都还是 OPEN_SEATS。这条路先修通，等局中那条实时排名改
 * 成三行（engine/standingsWindow.ts）、名单和战绩图都摆得下二十个人之后，
 * 再把入口放出来——反过来先放入口，今晚就会有人开出一间二十人的屋子配着八
 * 人的排版。
 */
const CONTEST_SEATS = 21;
const MIN_PLAYERS = 2;

/**
 * 这一间屋有几把椅子。
 *
 * 认 meta.seats；没有（老屋）或者写坏了就按普通小屋算。再夹一道
 * [MIN_PLAYERS, ROOM_CAPACITY]——这个数是从请求里来的，不夹住的话一个
 * `seats: 99999` 就能让 claimSlot 空转十万圈。
 */
function seatsFor(meta) {
  const n = Number(meta && meta.seats);
  if (!Number.isFinite(n)) return OPEN_SEATS;
  return Math.max(MIN_PLAYERS, Math.min(ROOM_CAPACITY, Math.round(n)));
}
/**
 * 一间小屋在「没人动它」之后还留多久。
 *
 * Redis 那头是按存量和命令数计费的，一间打完就没人再回来的屋子留两个小时，
 * 留的全是空钱。二十分钟：屋里任何一个人在自己的网页上点一下，这个数就从头
 * 开始算——不只是走棋，任何点击都算（见下面 touched 的说明）。所以只有整间
 * 屋子真的都散了，它才会在二十分钟后自己消失。
 */
const ROOM_TTL_S = 20 * 60;
/** Long enough to read "4, 3, 2, 1" without anyone feeling held up.
    四个数字一秒一个，再加半秒的余量；客户端从几数起见 startStage.ts 的
    countFrom，两边必须是同一个长度，不然屏幕上的 1 落下去了棋盘还没来。 */
const COUNTDOWN_MS = 4500;
/**
 * 建议横着玩的两个玩法——开局页会请人把手机转过来，而转手机这件事本身就要
 * 一秒。所以这两个的提前量多给一秒，倒数也就比别人多数一个（5 而不是 4）。
 *
 * 这份名单要和客户端 src/ui/startStage.ts 里的 LANDSCAPE_MODES 对得上：那边
 * 决定屏幕上从几数起，这边决定服务器留多长，两个数字必须是同一个。
 *
 * 这边从前多一个 `triangleAdvanced`。那一副在《侵蚀阶梯》PR-6 里删掉了，于是它成了
 * 死值：进不了 `MODES`（见下面那张表），`start()` 那头根本收不到这个 mode，
 * `countdownMsFor` 永远不会按它算。咬不到人，可上面那句「两个数字必须是同一个」就不
 * 再是真的了——而这段注释的全部用处就是让下一个人相信这句话。所以 2026-10 把它拿
 * 掉，两边现在都只有 `circleSeven` 一个。
 */
const WIDE_MODES = new Set(['circleSeven']);
const countdownMsFor = (mode) => (WIDE_MODES.has(mode) ? COUNTDOWN_MS + 1000 : COUNTDOWN_MS);
/**
 * How long a player who has stopped reporting holds the round open.
 *
 * A round is over when everyone says they are done. Someone who closes the
 * tab mid-run never says it, and without this the host could never start
 * another round — one person walking away would end the evening for the rest
 * of the table. Ninety seconds is far longer than the gap between two
 * reports from a device that is still playing, so this can only catch a
 * device that has genuinely gone.
 */
const ABSENT_MS = 90_000;
/**
 * 多久没听见一个人的动静，就当他此刻不在。
 *
 * 比 ABSENT_MS 短得多，因为它们答的是两个问题：那个决定「这一局还等不等
 * 他」，错判的代价是整桌卡住，所以要宽；这个只决定屏幕上要不要说一句「稍
 * 等」，错判的代价是白说一句话，所以可以紧。
 *
 * 从十二秒放宽到三十秒，是因为玩家要的是「网络完全断了、或者人把网页关
 * 了」才算走，不是「这一下慢了」。每台设备四秒记一次到（见 SEEN_WRITE_MS），
 * 三十秒里丢掉六次还判不出「不在」；而真的关掉网页那一下有 beacon 直接说
 * 一声（见 bye），不用等这个上限。
 */
const AWAY_MS = 30_000;
/**
 * 轮询多久才顺手把「我还在」记一次。
 *
 * 每台设备一秒问一次房间状态，但没必要一秒写一次库——那是每人每秒一次写。
 * 四秒记一次，AWAY_MS 里能记七次，掉几次也判不出「不在」。
 */
const SEEN_WRITE_MS = 4000;
/**
 * 收到「我的网页关了」（bye）之后，再等多久才真的当他关了。
 *
 * **为什么要等。** 浏览器刷新一次页面，pagehide 照样会触发、persisted 照样是
 * 假——和真的关掉网页在事件上一模一样，客户端分不出来。于是屋主的网页只是刷
 * 新了一下（手机上很常见：网抖一下、内存紧张浏览器自己重载、或者他自己觉得
 * 卡随手点了刷新，手机网络下要 2-4 秒），这几秒里屋里其他人一轮询就看见「屋
 * 主走了」，正打着的那一局当场被转成单人或者弹「小屋暂时关闭」——一两秒后屋
 * 主刷新完，人好好地坐在屋里，别人却已经被请出这一局，回不去了。
 *
 * 这个文件里别的判定（AWAY_MS 三十秒、ABSENT_MS 九十秒）都留了缓冲，唯独
 * 「网页真的关了」一点没留，是漏的，不是有意的。
 *
 * **为什么是十秒。** 比最慢的一次手机刷新（2-4 秒）宽出一大截，又远远短于
 * AWAY_MS——真关了网页的人，屋里最多多等十秒就知道，仍然比干等九十秒快得多。
 *
 * 等的这十秒里他不是「在」：lastSeen 已经被 bye 抹成 0，屏幕上照旧走 away 那
 * 条路，屋主那儿显示的是「屋主等一下就来」——刷新期间要的正是这句话。
 */
const BYE_GRACE_MS = 10_000;
/**
 * 这个座位「最后一次露面」从哪一刻算起——away / gone / roundOver 三处同一句话。
 *
 * 平时就是他自己最后一次报到的时刻。**开局那一下要往后挪**：一局刚开始的时
 * 候谁都还没来得及报，照上一次报到算会把整屋人一起判成「不在」，这一局还没
 * 打就先结束了。
 *
 * 但这一挪不能无条件——真断线的人就是被它坑的。手机没电直接关机（来不及发
 * bye，这是最常见的一种断线）的人此后再也不会报到，而「开局时刻」每开一局
 * 刷新一次：从他消失的那一局起，后面每开一局都要重新傻等满 ABSENT_MS 才进
 * 得了下一局——不是等一次，是场场都等，直到大家受不了只能解散重开。屋里还
 * 一直看不出是谁卡着：他每局开头都被这一挪重新算成「在」。
 *
 * 所以只有「这一局开始的时候他还算在」的人才跟着开局时刻走。开局那一刻就已
 * 经超过 ABSENT_MS 没露面的，从头到尾按他自己最后一次露面算——这一局直接认
 * 定他出局，不再重新给一次宽限，名单上也如实标成「不在」。
 *
 * 导出只为了一件事：scripts/check-room-seat.mjs 直接量这一条规则。它是个纯
 * 函数（自己不读 Date.now），所以那一台不用真的等满九十秒——把「上一局是什
 * 么时候开的」当参数递进去就行。
 */
export function seenFrom(seat, meta) {
  const last = Math.max(seat.lastSeen || 0, seat.joinedAt || 0);
  const startAt = meta.startAt || 0;
  if (startAt - last > ABSENT_MS) return last;
  return Math.max(last, startAt);
}
const seatAway = (seat, meta) => Date.now() - seenFrom(seat, meta) > AWAY_MS;
/**
 * 太久没听见他了（ABSENT_MS）：这一局不再等他（roundOver 也是这个数）；他要
 * 是屋主，屋里其他人看到的就是「屋主离家出走了，小屋暂时解散」。走了的
 * （left）和关了网页的（closed）各有各的标记，不算在这儿。
 */
const seatGone = (seat, meta) =>
  !seat.left && seat.lastSeen !== 0 && Date.now() - seenFrom(seat, meta) > ABSENT_MS;
/**
 * 这台设备真的关了：它自己说了一声（bye 写下 byeAt），而且过了宽限期还没再
 * 露面。见 BYE_GRACE_MS——刷新一次页面发的是同一个信号，所以不能一收到就信。
 *
 * 只要他再报一次到（轮询、报分、认领座位……任何一条写心跳的路），byeAt 就被
 * 抹成 0，这一条立刻不成立：刷新完的那台设备自己把自己救回来。
 */
const seatClosed = (seat) => {
  const at = Number(seat.byeAt) || 0;
  return at > 0 && Date.now() - at >= BYE_GRACE_MS;
};

/** The boards a host may choose. Anything else is not a mode we ship. */
/**
 * 主持人能摆上来的棋盘。
 *
 * 2026-09（《侵蚀阶梯》v1.2 PR-6）删了两副三角：原《三角》（整块大三角）和 V 形
 * `triangleAdvanced`。这张表跟着收成六个——留着已经不存在的 id 只会让一屋子人开局
 * 之后集体被弹回主页（客户端按 id 找不到那副棋盘就退回主菜单）。
 *
 * `triangleBig` 是六边蜂窝 54，删剩的唯一一副三角，天才特供。
 */
const MODES = new Set([
  'square', 'circle',
  'squareDiamond', 'circleHex', 'circleSeven', 'triangleBig',
]);
// 头像那三个形状和棋盘无关，别跟着一起改。
const AVATAR_SHAPES = new Set(['circle', 'triangle', 'square']);
/** 随机得分目标能开在哪几副棋盘上——就是两个基础玩法（三角那一副删了）。 */
const SLOT_MODES = new Set(['square', 'circle']);
/** 无限反转能开在哪几副棋盘上——基础方块和小球（玩家定的）。 */
const FLIP_MODES = new Set(['square', 'circle']);
/** Control characters, which a player's name has no business containing. */
const CTRL_RE = /[\u0000-\u001F\u007F]/g;

/**
 * 学的人多久没动静，整屋就不再等他。
 *
 * 看教学的那台设备每点一下就报一声「我还在学」（learningAt 往前挪，见
 * ui 那边的 learnHeartbeat）；二十秒一下都没点，就当他走神了——大家继续，他
 * 看完教学之后坐等待页，下一局再入。玩家的原话：「太久（20s）没有响应（没有
 * 点击任何地方）那么大家继续」。
 */
const LEARN_IDLE_MS = 20_000;
const seatLearning = (seat) =>
  Boolean(seat.learningAt) && Date.now() - seat.learningAt < LEARN_IDLE_MS;
/**
 * 一次挂起最多挂这么久，不管学的人还点不点。
 *
 * 上面那条二十秒的「走神就不等他」要**有人来问**才会生效：放行写在 `state()` 的轮询里
 * （三道门里唯一稳定会跑到的那一条）。屋里一个人都不轮询的那几秒——全都切到后台、或者
 * 只剩那个正在看教学的——它就不会发生，而那台设备每点一下还会把二十秒重新续上。于是一
 * 个人慢慢翻教学，整屋的开赛可以被无限期推下去。
 *
 * 九十秒是硬顶：和 ABSENT_MS 同一个数，意思也是同一句「再久就不等了」。教学那几屏翻完
 * 用不了九十秒；真翻不完的人学完会坐等待页，下一局再入——那本来就是设计。
 */
const LEARN_MAX_MS = 90_000;
/** 这一次挂起是不是已经挂满了（见 LEARN_MAX_MS）。老的 meta 没有 heldAt，当成挂满。 */
const holdExpired = (meta) => Boolean(meta.learnHold) && Date.now() - (meta.heldAt || 0) > LEARN_MAX_MS;
/**
 * 可能有新手的那一局，开赛前多留的四秒：没看过这个玩法教学的人在这四秒里
 * 回答「会 / 不会」，其他人的倒数则从 8（横屏玩法 9）数起。客户端那一问的
 * 时限是同一个数（ui/multiplayer.ts 的 KNOW_ASK_MS）。
 */
const ASK_MS = 4000;
/*
 * ── 「多久算……」一览：全在这个文件里，别处不另定 ─────────────────────
 *   SEEN_WRITE_MS    4 s   一台设备至多多久写一次「我还在」（轮询本身一秒一次）
 *   AWAY_MS         30 s   多久没听见就算「暂时不在」——屋主 → 「屋主等一下就来」
 *   ABSENT_MS       90 s   多久没听见就算「不在了」——这一局不再等他；屋主 →
 *                          「屋主离家出走了，小屋暂时解散」（publicState 的 gone）
 *   LEARN_IDLE_MS   20 s   看教学的人多久没点一下就不再等他
 *   LEARN_MAX_MS    90 s   一次挂起的硬顶：学的人还在点，也不再往后推开赛
 *   ASK_MS           4 s   开局前「会不会规则」那一问留的时间（倒数多数这几秒）
 *   ROOM_TTL_S      20 min 小屋多久没人碰就过期
 *   SECONDS_SLACK_S 15 s   报上来的用时允许比「这一局开了多久」多出这么多（见 score）
 * 客户端那边只有一个：LATE_MS（5 s，开赛之后晚到多久就坐等待页），见
 * ui/multiplayer.ts。小屋此刻在哪一段（等人 / 倒数 / 打着 / 打完 / 散了）由
 * engine/room.ts 的 roomPhase 一处判定。
 */
const FAMILIES = new Set(['square', 'circle', 'triangle']);
/** 一个玩法属于哪一族——按 id 前缀认，和教学的族是同一份。 */
const familyOf = (mode) =>
  String(mode).startsWith('square') ? 'square' : String(mode).startsWith('circle') ? 'circle' : 'triangle';
/** 这个玩法的倒数从几数起（客户端 startStage.ts 的 countFrom 是同一份）。 */
const countFromFor = (mode) => (WIDE_MODES.has(mode) ? 5 : 4);
/** 这台设备看过哪几族的教学——只认那三个名字。 */
const cleanSeen = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => FAMILIES.has(x)))] : []);
/**
 * 「屋里可能有新手」只对**这两族**成立。
 *
 * ⚠️ 网页那头的 `seenTutorials()`（src/i18n.ts）**只会回 square 和 circle**——教学本来就
 * 只有这两族（基础三角 2026-09 删了，剩下的大三角是天才特供，没有自己那一份教学）。
 * 所以三角那一族的 `seen` 里**永远是空的**，而下面那一句是「有人没看过这一族的教学」：
 * 于是大三角那间屋子**每一局**都被判成「可能有新手」——全屋的倒数永远从 8 数起（横屏
 * 9），而且每一局都把「你会不会玩」那一屏弹到每个人脸上。
 *
 * 这和竞赛屋主持人那件事是同一个形状（见下面 isSpectator 那一行的注释）：一个永远不会
 * 出现在 `seen` 里的东西，被当成了「他没看过」。
 */
const NOVICE_FAMILIES = new Set(['square', 'circle']);
const anyoneLearning = (hash) =>
  Object.entries(hash).some(([k, v]) => k.startsWith('p:') && v && !v.left && seatLearning(v));

const roomKey = (code) => 'room:' + code;
const id = (bytes) => randomBytes(bytes).toString('hex');

/**
 * 一动作一个桶。这个文件从前一条限速都没有，而它是全站唯一「不出示身份也办」
 * 的接口——房号只有四位数（randomInt(0, 10000)），一个脚本从 0000 数到 9999
 * 就能把每一间正在打的小屋的 publicState 全拉下来：玩家自己填的名字、头像、
 * 实时比分、谁交了卷。这不是猜出来的，state() 不给 playerId 也照样整份返回。
 * create 那条更贵：它会一路走到 hostMayOpen → isGeniusClaim，刷卡订阅那支每
 * 次都真的去问一次 Creem（_creem.js），于是一条不限速的路能拿来烧我们的 Creem
 * 调用额度。checkout.js 和 redeem.js 早就挂了限速，只有这儿漏了。
 *
 * ── 为什么 state / nudge 用十秒窗口，join / create 用一小时 ──────────────
 *
 * 因为要挡的东西和要放过的东西在**频率**上分得开，不在总量上分得开：
 *
 *   · 扫号是爆发：一秒上千次。
 *   · 轮询是匀速：每人每秒一次（engine/room.ts 的 everyMs = 1000）。
 *
 * 所以 state 挂小时桶是两头不着：给得紧会踢掉合法玩家——callerId 认的是 IP，
 * 而小屋本来就是给朋友一起玩的，四个人常常在同一个 Wi-Fi 后面，一小时就是
 * 4 × 3600 = 14400 次；给得松（比如 40000）等于让扫号脚本把整个房号空间来
 * 回扫四遍。十秒窗口两件事一起成立：八个人满座挤在一个 IP 后面是 80 次/十
 * 秒，300 留了两倍半的余量；而一秒一千次的脚本三百次就被关在门外。
 *
 * ⚠️ 上面那笔「80 次/十秒」是按**八座位**（`OPEN_SEATS`）算的，而竞赛屋是 21 座
 * （`CONTEST_SEATS`，已经上线：`#mpContest` 那颗键 → `createRoom(…, contest)`）。21
 * 个人满座挤在同一个 IP 后面是 210 次/十秒——**还不到 429**（上限 300），但余量从
 * 3.75 倍掉到 1.43 倍。所以这个 300 现在是「刚够」，不是「两倍半的余量」：谁要再往
 * 轮询里加一跳、或者把轮询调快一点，先回来重算这个数。一屋人打到一半集体断线，而屏
 * 幕上写的是「连不上网络」，他们会去查路由器。
 *
 * join / create 是一次性动作（进一次屋、开一间屋），一小时几十次绰绰有余，
 * 短窗口反而会在网络抖动连点几下时误伤，所以这两个照 redeem.js 的写法。
 *
 * nudge 要先有座位（seatOf 那句 403），所以它不是给陌生人用的门；这里给的
 * 200 次/十秒是给「催是一件可以连着按的事」留的——玩家按多快掉多快是设计好
 * 的（见 nudge 里那段注释），不能让限速把手感掐掉。
 *
 * leave / bye 故意不挂：它们是**关页面时用 beacon 发出去的**，刷新一次也发同
 * 一条。限速一旦误伤，屋里就要白等九十秒才判定这个人走了——为一点 Redis 读写
 * 去换这个风险不值。而且这两条不给身份时一个字都不写（seatOf 拦在写之前），
 * 也不吐任何别人的数据，回的就是 { ok: true }。
 *
 * start / score / end / learn 都要先出示座位或屋主令牌，够不上「陌生人的门」。
 */
const RATE = {
  state: { limit: 300, windowS: 10 },
  nudge: { limit: 200, windowS: 10 },
  join: { limit: 60, windowS: 3600 },
  create: { limit: 20, windowS: 3600 },
  // 局中改昵称（第 16 推）：要先有座位、还要帐号令牌，而且一次改名只发一次。和 join 一样
  // 是一次性动作，同一个桶的大小。
  rename: { limit: 60, windowS: 3600 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  // 限速排在分发之前，所以 create 的桶也排在 hostMayOpen 之前——不然「别拿这条
  // 路烧 Creem 额度」这个目的就没达成（和 mint.js 的 adminGate 同一个道理：先
  // 数数，再验身份）。
  const rate = RATE[body.action];
  if (rate && (await tooMany(`room:${body.action}`, callerId(req), rate.limit, rate.windowS))) {
    return send(res, 429, { error: 'tooMany' });
  }
  try {
    switch (body.action) {
      case 'create': return await create(res, body);
      case 'join': return await join(res, body);
      case 'state': return await state(res, body);
      case 'start': return await start(res, body);
      case 'score': return await score(res, body);
      case 'leave': return await leave(res, body);
      case 'end': return await end(res, body);
      case 'nudge': return await nudge(res, body);
      case 'learn': return await learn(res, body);
      case 'bye': return await bye(res, body);
      case 'rename': return await renameSeat(res, body);
      default: return send(res, 400, { error: 'action' });
    }
  } catch {
    return send(res, 502, { error: 'upstream' });
  }
}

// ---- who may open a room ------------------------------------------------

/**
 * 开小屋是订阅者的事；进别人的小屋不是——不然一个订阅者想找朋友打一局，
 * 得先让朋友们都去订阅，那他就永远打不成。
 *
 * 「他是不是天才」这道题现在只在一个地方回答（api/_entitlement.js），排行
 * 榜问的是同一句。三处各写一份的下场是可以预见的：有一天其中一份放行了另
 * 外两份挡住的人，而两边都觉得自己是对的。
 */
const hostMayOpen = (claim) => isGeniusClaim(claim);

// ---- shaping what a player is told --------------------------------------

/** Twelve characters of the player's choosing, minus anything that would
 *  break the row it is drawn into. */
function cleanName(value) {
  return String(value ?? '').replace(CTRL_RE, '').trim().slice(0, 12);
}

function cleanAvatar(value) {
  const shape = AVATAR_SHAPES.has(value?.shape) ? value.shape : 'circle';
  const raw = Number(value?.hue);
  const hue = Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : 0;
  return { shape, hue: Math.round(hue) };
}

/**
 * 让新来的这个人的图形和屋里已有的都不一样。
 *
 * 图形是各自的设备随机出来的，谁也不知道别人抽到了什么，所以四个人里撞上
 * 两个同色同形是常事——而这个图形正是比分板上认人的唯一标志，撞了就分不清
 * 谁是谁。只有服务器同时看得见所有人，所以在这里让一让：形状先换，形状换
 * 完还撞就把色相挪开一段。
 *
 * 「一样」按形状加色相段算，不按精确色值：两个只差三度的蓝，屏幕上就是同
 * 一个蓝。
 */
const HUE_STEP = 40;
const avatarKey = (a) => `${a.shape}:${Math.round(a.hue / HUE_STEP)}`;

/**
 * 催屋主：一人一格，不写进 meta。
 *
 * 原先这个计数和「这一局是什么」住在同一格（meta）里，而催一下是「读一份
 * meta → 改两个字段 → 整份写回去」。屋主按下《开始》写的也是整份 meta。两个
 * 请求前后脚撞上，后写的那个把先写的整段盖掉，于是出过两种事：
 *
 *   · 客人在屋主开局之后催了一下 —— 这一下被吃掉，计数没动，他自己不知道；
 *   · 客人那一下和屋主开局撞在同一瞬间 —— 屋主自己进了棋盘开始打，别人的画
 *     面还停在小屋等待页，什么反应都没有：round、seed、startAt 一起被那份旧
 *     meta 盖回去了。
 *
 * 而「等屋主开局的时候一直点催促」恰好是玩家最常做的那个动作。
 *
 * 拆成两样东西，各用各的办法：
 *
 *   **数目** —— 整间屋一个数，用 HINCRBY 加（`nudges` 字段）。加和读是同一
 *     步，所以一个手快的人打出来的那一串同时在飞的请求，一下都不会少。它住
 *     在这间屋的 hash 里，读整间屋的时候顺带就回来了——每台设备一秒问一次状
 *     态，为这一个数字多跑一趟，八个人就是每秒八趟。
 *
 *   **时刻** —— 一人一格（`nu:<playerId>`），照抄这个仓库对付并发唯一的那个
 *     办法（文件顶上就写着，玩家分数从来都是这么存的）。各写各的，谁也盖不
 *     到谁，更盖不到 meta。同一个人同一瞬间按的两下里丢掉一个时刻，屏幕上看
 *     不出来（那两颗本来就是同时掉的），而数目一下都不会少。
 *
 * 键前缀避开了已经占用的那几个：`p:` 座位、`s:` 椅子、`n:` 名字锁、`a:` 头像锁。
 */
const nudgeField = (playerId) => 'nu:' + String(playerId);
/** 被催了多少下——整间屋一个数，用 HINCRBY 加，所以它就住在这间屋的 hash 里。 */
const NUDGE_COUNT = 'nudges';

/**
 * 全屋催了多少下、各在什么时刻。
 *
 * `meta.nudges` / `meta.nudgeAt` 那两句是给**改这一版之前就开着的屋**留的：
 * 小屋只活二十分钟，可正好跨在部署那一下的屋不该让数字倒退回去——数字一退，
 * 屋主那头的书签（ui/nudgeRain.ts 的 seen）就再也对不上了。
 */
function nudgeTally(hash) {
  const meta = hash.meta || {};
  const nudges = (Number(hash[NUDGE_COUNT]) || 0) + (meta.nudges || 0);
  const stamps = Array.isArray(meta.nudgeAt) ? [...meta.nudgeAt] : [];
  for (const [field, value] of Object.entries(hash)) {
    if (!field.startsWith('nu:') || !value) continue;
    if (Array.isArray(value.at)) stamps.push(...value.at);
  }
  stamps.sort((a, b) => a - b);
  return { nudges, nudgeAt: stamps.slice(-40) };
}

/** Everything the room looks like - minus every player's private token. */
function publicState(code, hash) {
  const meta = hash.meta || {};
  const tally = nudgeTally(hash);
  const players = [];
  for (const [field, value] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !value) continue;
    players.push({
      id: field.slice(2),
      name: value.name,
      avatar: value.avatar,
      score: value.score || 0,
      finished: Boolean(value.finished),
      isHost: field.slice(2) === meta.host,
      /** 这会儿听不见他。屋主 away 的时候，别人那边会显示「稍等」。 */
      away: seatAway(value, meta),
      /** 太久没动静了（ABSENT_MS）。屋主 gone 就是「离家出走，小屋暂时解散」。 */
      gone: seatGone(value, meta),
      // What the evening adds up to, rather than this one round: the total
      // across every round banked so far, the best single round, and the
      // quickest one. The room's closing card is drawn from these.
      total: value.total || 0,
      best: value.best || 0,
      bestTime: value.bestTime ?? null,
      seconds: value.seconds ?? null,
      rounds: value.rounds || 0,
      /** 中途走了。人还在名单和排名里，只是不再报到，也不占座位。 */
      left: Boolean(value.left),
      /**
       * 这个人的网页真的被关掉了。
       *
       * 只有 bye 那条路会写下 byeAt，而 bye 只在 pagehide 且不进 bfcache 的时
       * 候发——切个应用、锁个屏都不算。但**刷新一次页面发的也是它**，所以还要
       * 过了 BYE_GRACE_MS 他仍然没再露面才算数（见 seatClosed）。这个布尔值说
       * 的是「终端真的没了」，和 away（听不见他，可能只是网差、也可能正在刷
       * 新）是两件事：屋主终端没了，这间小屋就散了；屋主网差，大家等他。
       */
      closed: seatClosed(value),
      /**
       * 正在看这个玩法的教学——全屋等他学完再一起数 4-3-2-1。
       *
       * ⚠️ **只在真的挂起着的时候才报。** 这一位在屏幕上的意思是「大家在等他」
       * （ui 那头据此画「等 X 看教学」），而「他在看教学」和「大家在等他」是两件事：
       * 挂起被放行之后（走神二十秒、或者挂满 LEARN_MAX_MS），倒数已经在走了，可他那台
       * 设备还在教学页上一下一下地点——`seatLearning` 照旧为真，于是屋里所有人看着一句
       * 「正在等他」而倒数正在归零，数到 0 直接开局。
       */
      learning: Boolean(meta.learnHold) && seatLearning(value),
    });
  }
  // 按累计总分排，不是按刚打完那一局。名单上每一行印的就是累计总分（前几局
  // 加上这一局），倒计时那一屏和最后那张战绩图也都是按累计排的——只有这里
  // 按单局排，于是会出现「写着 3000 的人排在写着 1500 的人下面」。
  //
  // 并列的时候比什么，三处必须是同一句话：这儿、名单那张卡（ui/roomCard.ts
  // 的 rankRoom）、倒数那一屏（ui/multiplayer.ts）。原先这儿并列比名字，另
  // 外两处并列比「单局最高」——两个人打平的那一刻，屏幕上的名次和倒数那一
  // 屏的名次会对不上，同一间小屋里两张表说两种话。名字留在最后一档，只是
  // 为了让完全一样的两行不要每次刷新都换位置。
  const running = (p) => (p.total || 0) + (p.score || 0);
  players.sort(
    (a, b) =>
      running(b) - running(a) ||
      (b.best || 0) - (a.best || 0) ||
      String(a.name).localeCompare(String(b.name)),
  );
  return {
    code,
    host: meta.host ?? null,
    mode: meta.mode ?? null,
    slot: meta.slot ?? null,
    /** 这一局是无限反转（100 秒、得分翻面来回翻）。 */
    flip: Boolean(meta.flip),
    seed: meta.seed ?? null,
    startAt: meta.startAt ?? null,
    // 有人去看教学了，这一局的开赛被挂起——startAt 还是原来那个（已经过去
    // 的）时刻，学完那一刻才重新盖一个（见 releaseHold）。等的人必须知道
    // 「现在是挂起，不是我来晚了」，否则他们会把这一局记成打过，坐到等待
    // 页去，学的人一个人开局。
    learnHold: Boolean(meta.learnHold),
    /** 0 before the first match; every 开始 raises it by one. */
    round: meta.round || 0,
    /** Everyone is done: the host may pick the next board, or close up. */
    roundOver: roundOver(hash),
    /** The host has closed the room. What is left is the closing card. */
    ended: Boolean(meta.endedAt),
    /** Seats open today, so what the app says about a full room is one
     *  number rather than the word "four" written into four languages.
     *  这一间屋自己的数（见 seatsFor）：普通小屋 8，竞赛小屋 20。 */
    seats: seatsFor(meta),
    /**
     * 竞赛屋：上限 20 名选手，开屋的人不参赛、只看实时榜单（见 isSpectator）。
     * 客户端拿它决定主持人那台设备这一局到底开不开棋盘。
     */
    contest: Boolean(meta.contest),
    /**
     * **屏幕上那个「几/几」该拿谁去数。**
     *
     * 普通小屋两个数就是座位：屋主自己也在打，「3/8」里那个 3 包括他。竞赛屋不
     * 一样——主持人占一把椅子但不参赛，照座位数就会写成「21/21」，而那一行小字
     * 写的是「最多 20 人」。两个数对不上，正是「意料之外的界面」。
     *
     * 所以竞赛屋报的是**选手**那一对：上限 20（座位数减掉主持人那一把），当前
     * 是已入座的选手数（playerCount 已经把主持人排除了）。普通小屋原样。
     */
    playerSeats: Boolean(meta.contest) ? Math.max(0, seatsFor(meta) - 1) : seatsFor(meta),
    playersIn: Boolean(meta.contest) ? playerCount(hash) : seatCount(hash),
    players,
    /** 被催了多少下。屋主那边看它变大就往标题里掉图形。 */
    nudges: tally.nudges,
    /** 最近几十下催促各是什么时刻——屋主按这个节奏一颗一颗掉。 */
    nudgeAt: tally.nudgeAt,
    /** 这一局的倒数从几数起（可能有新手的局是 8 / 9）。 */
    countFrom: meta.countFrom ?? null,
    // Lets a device with a wrong clock still count down to the same instant.
    serverNow: Date.now(),
  };
}

/** Every seat that is still reporting has finished this round. */
function roundOver(hash) {
  const meta = hash.meta || {};
  if (!meta.round || !meta.startAt || Date.now() < meta.startAt) return false;
  const seats = Object.entries(hash)
    // 竞赛屋的主持人不参赛（见 isSpectator）：这一局压根不等他。他那台设备坐在
    // 实时榜单上，永远不会交卷——把他算进来，每一局都要干等满 ABSENT_MS。
    .filter(([field, value]) => field.startsWith('p:') && value && !isSpectator(meta, field.slice(2)))
    .map(([, value]) => value);
  if (!seats.length) return false;
  return seats.every((seat) => {
    // 走掉的人不是这一局在等的人。leave 已经把他标成 finished 了，这一行
    // 是把意图写明白：名单上留着他，不代表整局要等他。
    if (seat.left) return true;
    // 网页已经关了，而且是他的浏览器自己说的（bye 写下 byeAt，过了宽限期还
    // 没回来才算数，见 seatClosed）。
    //
    // 这一句原先没有，于是服务器明明已经知道「这个人走了」，却还是只认「九十
    // 秒没消息」那一条：屋里一个人中途直接关掉网页——很常见——其余所有人交
    // 完卷都要干等到第 90 秒才开得了下一局。已经收到的消息就该当消息用。
    if (seatClosed(seat)) return true;
    // Walked in after this round began: they were never in it, so they
    // cannot be what it is waiting on.
    if ((seat.joinedAt || 0) > meta.startAt) return true;
    if (seat.finished) return true;
    // 从哪一刻算「最后一次露面」，规则只写在一处（seenFrom）：一局刚开始时
    // 基准往后挪到开局时刻，但开局那一刻就已经超时的人不再跟着挪——不然一个
    // 真断线的人会让后面每一局都重新等满 ABSENT_MS。
    return Date.now() - seenFrom(seat, meta) > ABSENT_MS;
  });
}

/**
 * 心跳单独一格：`h:<playerId>`，只放 lastSeen。
 *
 * 为什么要分出来。这个文件开头那条原则——「小屋存成 Redis hash，一个玩家一
 * 个 field」——从前只贯彻了一半：**跨玩家**确实互不相干，可**同一个玩家**的
 * 座位 `p:<id>` 仍是一份 JSON 文档，而写它的有五条路（score / state / bye /
 * leave / learn），全是读—改—写。两条同时落地，后写的那份带着自己进函数时
 * 读到的旧快照，把中间那次写入整个盖掉。
 *
 * 这不是极端情况，是日常：客户端两个循环本来就互不协调——轮询每秒一次，心
 * 跳每四秒真写一次库（SEEN_WRITE_MS），大约每四次报分就有一次撞上的窗口；
 * 关网页那一下的 beacon 和拆卸时最后一次报分同时飞出去；点《离开》同理。玩
 * 家看到的是「分数对不上」：打完一局的分数回退成中途那个数甚至 0，交卷标记
 * 一起丢掉之后，全屋还要继续等一个已经交过卷的人。
 *
 * 最吵的那一条是心跳——它一秒问一次、四秒写一次，却只改一个字段。把它搬进
 * 自己那一格，心跳就永远不碰座位，报分也永远不碰心跳，两条路撞不上了。
 */
const beatKey = (playerId) => 'h:' + String(playerId);
/**
 * 这一局的成绩也单独一格：`r:<playerId>`，只放 score / finished / seconds。
 *
 * 心跳搬出去之后还剩两处会撞：报分撞《离开》、报分撞《看教学》——那两条写的
 * 是 left / learningAt / seen，都是货真价实的座位属性，搬不进心跳格。它们和
 * 报分抢的是同一份 JSON 文档，先重读一次只能把窗口缩小，堵不死。
 *
 * 所以按字段的归属再切一刀：**会在一局之内反复变的三样**归 `r:`，报分只写
 * 它；**跟着这个人一晚上不变的**（名字、头像、椅子、累计总分、走没走、在不
 * 在看教学）留在 `p:`，别的路只写它。两边不再有交集，也就撞不上了。
 *
 * 「交了卷」于是不必再由《离开》去写：走了的人本来就不该再等，roundOver 早
 * 就认 left，所以这里**推导**出来——谁走了谁就算交了卷。少一处写入，就少一
 * 个可以抢的地方。
 */
const roundKey = (playerId) => 'r:' + String(playerId);
/**
 * **累计账自己一格**（`t:<id>`）：total / best / rounds / bestTime。
 *
 * 和 `h:`（心跳）、`r:`（这一局）是同一条规矩，理由也同一个：`p:` 那一格有**六条路**
 * 在写（join 补椅子、leave 标走人、learn 记 learningAt 和 seen、claim 认领、改名字、
 * 收椅子），每一条都是「读一份、改一点、整份写回去」。记账从前也写在 `p:` 上，于是：
 *
 *   屋主按《开下一局》→ 记账循环读到一份快照 → 中间有人改了名字 / 点了看教学 →
 *   循环把快照整份写回去 → 那个人的名字、learningAt 当场被抹掉。
 *
 * 反过来更贵：那六条路里任何一条踩在记账中间，把它读到的**旧 total** 写回去，这一局
 * 的分就凭空消失——而屏幕上一切正常，只有总分少了一截，事后谁也说不清少在哪儿。
 *
 * 拆开之后 `t:` 只有两处写（start 和 end 的记账循环，而它们互相让锁），那六条路一个
 * 字都碰不到它。`readRoom` 读的时候折回座位上，所以下游（publicState / 排行 / 战绩
 * 卡）一行都不用改。
 */
const totalKey = (playerId) => 't:' + String(playerId);
/** 累计账那四样。`p:` 里的同名字段从此是死数据（和 h: / r: 一样，见 readRoom）。 */
const TOTAL_FIELDS = ['total', 'best', 'rounds', 'bestTime'];

/**
 * 「这把椅子归我认领」的独占权，一个座位一格。
 *
 * 格名里带上**我看到的那把钥匙**（seat.token）——和 takeRoomLock 里那道
 * 「接手废锁」用的是同一个办法（格名里带上「我看到的那个时刻」）。
 *
 * 为什么非这么写不可：抢椅子（claimSlot 的 HSETNX）本来就是原子的，可抢到之
 * 后「往座位里写一把新钥匙」不是。两台设备同时认领同一把离线的椅子，都读到
 * 「这把椅子空着」，各自生成一把新钥匙写进同一个 `p:<id>`，后写的赢，先写的
 * 那把当场作废——而那台设备表面上一切正常：小屋画面、名单、倒数照常，从那一
 * 刻起报分、催屋主、看教学、离开却全被安静地拒绝，界面上一个字的错都不弹。
 * 他打完一整局，回到小屋才发现自己那一行一直是 0。最容易踩到的是同一个人：
 * 手机快没电换平板接着玩（手机那个标签页没关），或者网卡时点了两下《加入》。
 *
 * 两台看到的是同一把旧钥匙，于是竞争同一格，HSETNX 只放一条过去。赢的那条写
 * 下新钥匙之后，将来再有人认领读到的是**新**钥匙，格名不一样，照样认领得了
 * ——这把锁只挡「同一轮认领」，不会把椅子永久焊死。
 *
 * 多出来的这几格不用清：和小屋同生共死（一间屋一个 hash，TTL 到了一起走），
 * 而下游读座位的地方全都按 `p:` 前缀过滤。
 */
const claimKey = (playerId, token) => 'c:' + String(playerId) + ':' + String(token || '');
/**
 * 「这一局是谁开的」——一局一格，抢到的那个才办。
 *
 * 屋主双击《再来》：客户端那道闸（engine/room.ts 的 startMatch）把同一个网页
 * 里的连点合并成一条，可它挡不住两个来源——两个分页、手机加电脑、或者请求在
 * 路上时页面被刷新（闸随之消失）再按一次。
 *
 * 从前服务器这一侧是「先看一眼上一局结束没有，再各自算一份新棋盘写回去」，
 * 中间没锁。两条都能过那道 `if (round && !roundOver) return 409` 的闸，因为
 * 它们看到的是同一份「上一局已结束」的快照。
 *
 * 实测出来的不是种子分叉（那一条躲过去了：所有人拼棋盘的种子都是从每秒一次
 * 的轮询里读的，不是开局回包，见 ui/multiplayer.ts 的 beginCountdown），而是
 * **记账记了两遍**：B 的读恰好落在 A 的记账循环中间——A 已经把屋主那一格并
 * 进 total 了，meta 还没写，于是 B 读到一个「记过一半、局次还是旧的、roundOver
 * 还是真」的屋子，把已经记过的那几格又记了一遍。量到的是屋主 total=200、
 * rounds=2，而他那一局只打了 100 分。和 2026-09 那次「散场时最后一局算两遍」
 * 是同一种账。
 *
 * HSETNX 是 Redis 自己那一步：这一格空着才写得进去。和抢房号、抢椅子用的是
 * 同一个办法。抢不到的那一条不报错——屋主按下去是想开局，而局确实开起来了，
 * 回一份当前状态就好；一秒后的轮询会把新局次和种子一起带给他。
 */
const startLockKey = (round) => 'ls:' + String(round);
/**
 * 散场那一件事的锁。一间屋只散一次，所以不按局次分格，就一格。
 *
 * end() 从前也没锁，而它和 start() 是同一段账：第 1266 行的
 * `if (hash.meta.endedAt) return` 只是「看一眼有没有结束」，不是原子的，而真正
 * 写 endedAt 是在整个记账循环**跑完之后**——两条 end 都能过那道闸。
 *
 * 今天凌晨那一笔只堵了 start()，这个几乎逐字相同的口子留在了原地。
 *
 * 实测（scripts/check-room-races.mjs 的 ⑧，两人各 100/200 分，把错位量从 0 到
 * 40 挨个走）：错位 2 屋主的总分从 100 变 200，错位 4 客人的从 200 变 400，
 * 错位 3 和 5 是 rounds 变 2。翻倍**只翻在恰好被撞上的那一个人头上**——每个座
 * 位各有自己「写完 p: 还没写 r:」那两步的窗口，撞上谁是谁。所以那张要发给朋友
 * 看的小屋战绩卡上，是三个人里有一个的分数莫名其妙翻了倍，比全屋一起翻更难
 * 解释。
 *
 * 另外记一笔：错位 0（也就是干脆用一把 Promise.all 同时发两条）是**绿的**——
 * 两条读到同一份快照，各自算出同一个结果，写回去的值一模一样。所以这个 bug
 * 只能靠扫错位量量出来，一把 Promise.all 会让人以为没事。
 */
const END_LOCK = 'le:end';
/**
 * 「放行这一局的开赛挂起」那一格锁（见 patchMeta / releaseHold）。
 *
 * 一局只挂一次、也只放行一次（learn 里那句 `heldRound !== round` 保证的），所以
 * 一局一格的一次性锁正合适——和 startLockKey 同一个形状。
 */
const holdLockKey = (round) => 'lh:' + String(round);
/**
 * 「把这一局的开赛挂起」那一格锁——和上面那把**必须是两格**。
 *
 * takeRoomLock 抢到就不还（除非过了 LOCK_STALE_MS），这是故意的：一局里「放行」只
 * 许发生一次。所以挂起要是和放行共用 `lh:N`，顺序就成了：有人说「我不会玩」→ 挂起
 * 抢走了 lh:N → 他学完了 → releaseHold 抢不到 → **倒数永远不会被放行，全屋干等到
 * 锁过期（20 秒）**。那比它要修的那个 bug 严重得多：原来是零点几秒的窗口里偶尔撞
 * 上，这个是每次有人说「不会」都必然发生。
 *
 * 挂起和放行在同一局里各自只发生一次，所以正好各用一把自己的一次性锁。
 */
const holdSetLockKey = (round) => 'lhs:' + String(round);
/**
 * 一把锁「多久没动静就算是废的」。
 *
 * 锁本身带来一个新毛病：抢锁和把结果写进 meta 之间隔着一整段记账循环（20 个
 * 座位就是 40 次 Redis 往返）。中间任何一次超时抛错，最外层的 catch 回一个
 * 502，而 **meta 一步没动、锁也没人删**。于是屋主再点《再来一局》，算出来的
 * 「下一局」局次和刚才失败那次一模一样（拿的是没变过的旧局次），锁的位置也没
 * 变，永远抢不到——回的还是 200，一份「什么都没变」的状态，连错都不报。屋主
 * 怎么点都没反应，其他人卡在「等屋主选玩法」，一晚上的战绩只能等这间屋自己过
 * 期。而且不一定等得到 20 分钟就好：TTL 是「任何点击都续命」的（见 state 里的
 * touched），几个人在界面上乱点，这间死屋能一直续下去。
 *
 * 20 秒这个数怎么来的：它必须**大于任何一次跑得成的记账**（不然就是把一条还在
 * 干活的请求的锁抢走，⑦⑧ 修的东西白修），又要尽量小（它就是这间屋卡住之后要等
 * 多久才自愈）。算得出来的那一头：最坏是 20 座 × 2 次 hset + meta + expire ≈
 * 43 次往返，Upstash 一次 50–200ms，也就是最多八九秒。20 秒留了两倍多的余量，
 * 同时比「等这间屋自己过期」（20 分钟）快六十倍。
 *
 * 两头错的后果不对称，所以宁可留厚一点：定得太小是**又开始记两遍**，定得太大
 * 只是自愈慢一点。真要改这个数，先量一遍记账那一段在生产上的耗时。
 *
 * （本来想再加一句「反正 Vercel 会先把函数掐掉」当第二道保险，查了文档没找到
 * Hobby 档默认上限的确切数，就不写了——没核实的数字不该当成依据。）
 */
const LOCK_STALE_MS = 20_000;
/**
 * 抢一格一次性的锁：抢到回 true，没抢到回 false。start() 和 end() 共用。
 *
 * 平常就是一句 HSETNX（Redis 自己那一步：这一格空着才写得进去），和抢房号、抢
 * 椅子用的是同一个办法。
 *
 * 多出来的那一半是「接手废锁」，而它必须**也是原子的**，不然就是把刚补上的洞
 * 又挖开：最自然的写法是「看一眼时间戳，旧了就 hdel 掉重抢」，可那样两条都会
 * 先看到同一把废锁、都去删、都重抢——第二条删掉的是第一条刚写下的新锁，于是
 * 两条都以为自己抢到了，记账又是两遍。
 *
 * 所以接手权另记一格，**格名里带上「我看到的那个时刻」**（`ls:2:1789…`）：看到
 * 同一把废锁的几条一定竞争同一格，HSETNX 保证只有一条拿得到；看到的是更新的
 * 那把（也就是已经有人接手了）的，压根不会走到这一步。接手成功的那一条先占下
 * 这一格、再把锁的时间戳刷新，所以就算它也半路死掉，下一轮会按新时间戳再选出
 * 一个接手人，一层套一层，永远只有一个。
 *
 * 多出来的那几格不用清：它们和小屋同生共死（一间屋就是一个 hash，TTL 到了整间
 * 一起走），而且下游读座位的地方全都按 `p:` 前缀过滤（publicState / seatCount /
 * roundOver / 两处记账循环），多几格非 p: 的字段一个都不看。
 */
async function takeRoomLock(code, field) {
  const now = Date.now();
  if (await hsetnx(roomKey(code), field, { at: now })) return true;
  const held = await hget(roomKey(code), field);
  const at = Number(held && held.at) || 0;
  // 还有人在办这件事。抢不到的那一条不报错——屋主按下去是想开局/散场，而那件
  // 事确实正在办，回一份当前状态就好。
  if (at && now - at < LOCK_STALE_MS) return false;
  if (!(await hsetnx(roomKey(code), field + ':' + at, { at: now }))) return false;
  await hset(roomKey(code), field, { at: now });
  return true;
}
/**
 * 这一格锁还新鲜吗——也就是「有人正在办这件事」。
 *
 * 读的是 readRoom 已经拿回来的那份 hash，不额外跑库：小屋整间就是一个 hash，
 * 锁和座位在同一次 hgetall 里。
 */
const lockHeld = (hash, field) => {
  const at = Number(hash?.[field]?.at) || 0;
  return at > 0 && Date.now() - at < LOCK_STALE_MS;
};

/** 一局收尾时把那三样清回零（开下一局、散场各用一次）。 */
const CLEAR_ROUND = { score: 0, finished: false, seconds: null, final: false };

/**
 * 记账前再看一眼这个座位此刻真正的样子：`p:` 那一份，加上他自己 `r:` 那一格
 * **最新**的分。
 *
 * start() / end() 各在抢到锁之后重读过一次整间屋子，那一次挡住的是「读快照
 * → 抢锁」那段窗口。可记账循环本身也要跑库：一个人两次 hset，八个人就是十六
 * 趟往返，几百毫秒——最后一次报分很可能正落在这中间。落进去的那一份写的是
 * `r:`（score() 只写那一格），循环手上那份快照里那一格还是旧的，于是按旧的
 * 记账，紧接着又把 `r:` 清掉：那一局的分连记带存两头落空。
 *
 * 所以每个人临写之前，单独把他那一格再拿一次。和 leave() / learn() 是同一条
 * 规矩——「写之前重读」——只是下沉到了真正发生写入的那一层。
 */
async function liveSeat(code, field, seat) {
  const run = await hget(roomKey(code), roundKey(field.slice(2)));
  if (!run) return seat;
  return {
    ...seat,
    score: Math.max(0, Math.floor(Number(run.score) || 0)),
    // 走了的人一律算交了卷——readRoom 里那条推导，这儿要跟着，不然刚 leave
    // 的人会被这一份 r: 拉回「还没交卷」。
    finished: Boolean(run.finished) || Boolean(seat.left),
    seconds: run.seconds ?? null,
  };
}

const readRoom = async (code) => {
  const hash = await hgetall(roomKey(code));
  if (!hash || !hash.meta) return null;
  // 折回座位上：往下所有读这几样的地方（roundOver / seatAway / seatGone /
  // publicState / bankRound / claimSeat / seatReclaimable）一个字都不用改。
  //
  // **谁说了算：h: 和 r: 存在就以它们为准。** p: 里同名的那几个字段（lastSeen /
  // score / finished / seconds）从此是死数据——有几条路会把折好的座位整份写回
  // p:（state 里补椅子、freeSeatFor 收椅子），于是留下一份影子，而影子谁都不
  // 读，下一次 readRoom 照样被 r: 盖掉。
  //
  // 这条规矩的另一面是**一局收尾时必须写 r:**，光清座位不算清。end() 上就差点
  // 栽在这里：座位里 score 清成了 0，r: 还留着这一局的分，屋里其他人一重读，
  // 屏幕上的 total + score 就把最后一局算了两遍（见 end 那段，门是
  // check-room-races 的 ⑥）。
  for (const [field, seat] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !seat) continue;
    const id = field.slice(2);
    const beat = hash[beatKey(id)];
    if (beat && typeof beat.lastSeen === 'number') seat.lastSeen = beat.lastSeen;
    // byeAt 和 lastSeen 一样住在心跳那一格里，也要折回来——seatClosed 读的是它。
    if (beat && typeof beat.byeAt === 'number') seat.byeAt = beat.byeAt;
    const run = hash[roundKey(id)];
    if (run) {
      seat.score = Math.max(0, Math.floor(Number(run.score) || 0));
      seat.finished = Boolean(run.finished);
      seat.seconds = run.seconds ?? null;
    }
    // 累计账同理：`t:` 存在就以它为准（见 totalKey 那段）。老屋子没有这一格，
    // 读到的就还是 `p:` 里那一份——所以这一改不必迁移，正在进行的小屋照旧算。
    const acc = hash[totalKey(id)];
    if (acc) for (const k of TOTAL_FIELDS) if (acc[k] !== undefined) seat[k] = acc[k];
    // 走了的人一律算交了卷——这一条从前是 leave 写进座位里的，现在推导。
    if (seat.left) seat.finished = true;
  }
  return hash;
};

/** Checks that this really is the player it claims to be. */
/**
 * 折好的一份，专给「刚写完、下一句就要摆给玩家看」的那几处。
 *
 * 为什么非得折：readRoom 把 h:（lastSeen / byeAt）和 r:（score / finished /
 * seconds）折回座位上，并且它自己的注释写明「p: 里同名的那几个字段从此是死数
 * 据」。所以直接 hgetall 出来的那份 p: 是一份**影子**：谁都不读它，它也不跟着
 * 报分和心跳更新。拿影子去 publicState，玩家在「刚加入 / 刚认领椅子 / 刚点完
 * 看教学」那一次响应里看到的别人的比分、交卷勾、「网页关了」就可能是旧的——
 * 下一次轮询（一秒后）自己好，所以它一直没被当成 bug，只是一闪。
 *
 * readRoom 在房间不存在（!hash.meta）时回 null，而 publicState 收到 null 会
 * 当场炸。这几处房间刚写过、一定在，可 TTL 恰好在这一瞬间到期不是不可能，所
 * 以兜一手裸快照——宁可摆一次影子，不能白屏。
 */
const freshRoom = async (code) => (await readRoom(code)) || (await hgetall(roomKey(code)));

function seatOf(hash, playerId, token) {
  const seat = hash['p:' + playerId];
  return seat && seat.token && seat.token === token ? seat : null;
}

/** 还坐着的人。走掉的座位留在表里（见 leave），但它不占位子。 */
const seatCount = (hash) =>
  Object.entries(hash).filter(([k, v]) => k.startsWith('p:') && v && !v.left).length;

/**
 * 这个座位是不是**主持人**——竞赛屋里开屋那个人，他不参赛。
 *
 * 玩家 2026-09 定的竞赛版：「上限 20 人、发起人不参加游戏单独看到实时榜单情况」。
 * 所以竞赛屋里屋主的那把椅子是一张**看台票**：
 *   · 这一局不等他交卷（roundOver 跳过他）；
 *   · 他没有分（两处记账循环都跳过他），榜单和那张战绩图上也不该有他；
 *   · 他仍然是屋主——开局、解散、被催，一样都不少。
 *
 * 判定只写这一遍，三处（roundOver / start 记账 / end 记账）都问它。**普通小屋一律
 * 回 false**：屋主照旧打自己的局，这一条一个字都不影响八人屋。
 */
const isSpectator = (meta, playerId) => Boolean(meta && meta.contest) && playerId === (meta && meta.host);

/**
 * 真正下场比的有几个人（主持人不算）。
 *
 * 开局那道「至少两个人」的门槛问的是这个数：竞赛屋里「屋主 + 一个人」只有一名选手，
 * 开出来是一个人自己跟自己比。
 */
const playerCount = (hash) => {
  const meta = hash.meta || {};
  return Object.entries(hash).filter(
    ([k, v]) => k.startsWith('p:') && v && !v.left && !isSpectator(meta, k.slice(2)),
  ).length;
};

/** 同一个昵称——不分大小写，两头的空白不算。 */
const sameName = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * 这把椅子能不能让同名的人认领：只认按过《离开》（left）和网页真的关掉了
 * （seatClosed：说过 bye，而且过了宽限期没再回来）的座位。
 *
 * 只是一阵子没心跳（away）的不算。那个人多半只是锁了屏、接了个电话，座位、
 * 名字、分数都还是他的。从前这一条把 away 的座位也交给同名的人——而两个都
 * 没取名字的人在服务器眼里名字一模一样（都是占位那一句），于是先来的人接
 * 个电话回来，座位连同分数已经是后来那个人的了。正在看教学的也不算——那台
 * 设备整页被教学占着、不轮询，看着像没人，人其实在。
 */
const seatReclaimable = (seat) => (Boolean(seat.left) || seatClosed(seat)) && !seatLearning(seat);

/**
 * 没取名字的人，发一个字母：A、B、C……屋里没被占的第一个。
 *
 * 从前发的是占位那句话本身（《取个名字》/「Host」/「Player」）。两件事因此
 * 出错：排行榜上一屋子人全叫同一句话，谁是谁看不出来（第二个人还会被加编号
 * 成「取个名字 2」，更难看）；再就是座位认领——走了又回来的人靠名字认自己那
 * 把椅子，名字人人一样，认到的可能是别人的。
 *
 * 字母在这里发，不在网页那头发：只有服务器手上有整屋的名单，才敢说「这一个
 * 没被占」。发完之后网页把它记在本机上（见 ui/multiplayer.ts），所以断线回来
 * 报的还是同一个字母，认领的还是自己那把椅子。
 *
 * 八个座位，26 个字母够用；真要一个都不剩（同名的人自己取名叫 A 到 Z），
 * 就退回 uniqueName 那套加编号。
 */
function freeLetter(hash) {
  const taken = new Set(
    Object.entries(hash)
      .filter(([k, v]) => k.startsWith('p:') && v && !v.left)
      .map(([, v]) => String(v.name ?? '').trim().toUpperCase()),
  );
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!taken.has(letter)) return letter;
  }
  return 'A';
}

/**
 * 走了又回来的人，这一趟叫什么。
 *
 * 名字通常还是他自己那个。只有一种情况要换：他不在的这段时间里，屋里来了个
 * 人正好占了这个名字（尤其容易发生在字母上——他走了，B 就空出来了，下一个
 * 没取名字的人拿到的就是 B）。同名一旦成真，排行榜上分不出谁是谁，下一次认
 * 领座位也会认错人。
 *
 * 换的时候看他原来叫什么：本来就是发的字母，就再发一个没被占的字母；自己取
 * 的名字则照老规矩加编号（「阿甲 2」）——把人家取的名字换成一个字母，比重名
 * 还奇怪。
 */
function nameForReturner(seat, hash) {
  const name = String(seat.name ?? '').trim();
  if (!name) return freeLetter(hash);
  const kept = uniqueName(name, hash);
  if (kept === name) return name;
  return /^[A-Za-z]$/.test(name) ? freeLetter(hash) : kept;
}

/**
 * 屋里已经有人叫这个名字（还坐着的）：后来的加个编号——「起个名字 2」。同名
 * 不再可能，认领座位那一条也就永远不会把两个陌生人当成一个人。
 */
function uniqueName(name, hash) {
  const taken = new Set(
    Object.entries(hash)
      .filter(([k, v]) => k.startsWith('p:') && v && !v.left)
      .map(([, v]) => String(v.name ?? '').trim().toLowerCase()),
  );
  if (!taken.has(name.trim().toLowerCase())) return name;
  for (let n = 2; n < 100; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

/**
 * 占一把椅子：s:0 … s:N-1 里第一把空的。HSETNX 是原子的——两个人同一瞬间进
 * 来，同一把椅子只有一个人坐得上；都坐不上就是满了。从前是「先数一遍人、再
 * 写座位」两步，中间没有锁，最后一把椅子能被两个人同时坐上去。
 *
 * `seats` 由调用方从这一间屋自己的 meta 里取（seatsFor），不是这个文件里的
 * 常数——普通小屋八把，竞赛小屋二十把。
 */
async function claimSlot(code, playerId, seats) {
  for (let i = 0; i < seats; i++) {
    if (await hsetnx(roomKey(code), 's:' + i, playerId)) return i;
  }
  return -1;
}

/**
 * 占一把椅子；满了就先看看有没有「已经确认走了」的椅子空着人。
 *
 * 按过《离开》的椅子早就交回去了（leave 里的 hdel）。**关掉网页的没有**：那
 * 条路故意不把座位标成 left（关标签页和按《离开》是两回事，手滑关掉、切个应
 * 用的人马上就回来，座位得留着）。可代价是这把椅子从此谁也坐不上——新朋友
 * 进不来，要等整间小屋二十分钟过期才能重新凑齐人。
 *
 * 只有在真的坐满了、又确实有人进不来的时候才收：平时那把椅子照旧留着他。
 * 三种不收——屋主的（屋主身份不能换人）、正在看教学的（那台设备整页被教学
 * 占着、不轮询，看着像没人，人其实在）、已经交回去的。收的时候把 seat.slot
 * 一并抹掉，他回来时会重新占一把（join 里 `slot === undefined` 那一支），而
 * 名字、分数、打过几局都还在他名下——人还在名单和排行里，只是不再占位子。
 */
async function claimSeat(code, playerId, hash) {
  const seats = seatsFor(hash.meta);
  let slot = await claimSlot(code, playerId, seats);
  if (slot >= 0) return slot;
  let freed = 0;
  for (const [field, seat] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !seat) continue;
    if (field.slice(2) === hash.meta.host) continue;
    if (seat.left || seat.slot === undefined) continue;
    /*
     * 能收回来的有两种：**网页真的关掉了**（seatClosed：说过 bye，而且过了宽限期没再回
     * 来），和**九十秒没听见动静**（seatGone，ABSENT_MS）。
     *
     * 从前只认前一种，于是最常见的那一种收不回来：手机进了后台、电没了、地铁里断网
     * ——这几样都不会发出 bye，那把椅子于是一直占着，屋里坐满了而进不来的人只能等整间
     * 小屋二十分钟过期。而这一局**早就不等他了**（roundOver 用的就是同一个 ABSENT_MS），
     * 也就是说服务器一边认定他不在，一边替他留着椅子。
     *
     * ⚠️ `seatReclaimable` 一个字都不动（那是另一条路：**同名的人**来认领这把椅子）。
     * 它刻意只认 left / closed——「一阵子没心跳」就把座位连同分数交给一个同名的人，正是
     * 那条注释里记着的那次事故。这儿不同：收回来的只是**位子**，名字、分数、打过几局都
     * 还在他名下（下面 `delete next.slot`），他回来会重新占一把。
     */
    if (!(seatClosed(seat) || seatGone(seat, hash.meta)) || seatLearning(seat)) continue;
    await hdel(roomKey(code), 's:' + seat.slot);
    const next = { ...seat };
    delete next.slot;
    await hset(roomKey(code), field, next);
    freed++;
  }
  if (!freed) return -1;
  slot = await claimSlot(code, playerId, seats);
  return slot;
}

/**
 * 抢名字、抢头像：和占椅子同一个办法（HSETNX），不是「先算一遍再写」。
 *
 * 玩家撞上的是这个：一群朋友几乎同时点《加入》。占椅子本来就是原子的，可
 * 「这个字母有没有被占」「这个昵称重不重」「这个头像撞不撞」三件事吃的都是
 * 函数一进来读的那一份旧快照——四个人同一瞬间读到的是同一份，于是四个人都
 * 叫「A」，或者四个人都叫「小明」、都顶着同一个头像。排行榜和结算图上就出现
 * 几行一模一样的名字，而认领座位正是按名字认的。
 *
 * 现在把「这个名字归我了」也做成一次原子写：n:<小写名字> / a:<形状:色相格>
 * 写成功才算抢到，抢不到就试下一个候选。两台手机同时按，同一把锁只有一台
 * 抢得到。
 *
 * @param taken 快照里已经占着的（键的写法要和候选的 key 一致）。屋主的名字、
 *   走了又回来的人的名字都是不经过这里写下去的，没有对应的锁；拿快照兜住
 *   它们，抢锁只负责挡住「同时进来的这几个人」。
 * @returns 抢到的那个值；一个都没抢到（候选用完了）就返回最后一个，宁可重
 *   一个名字也不拦人进屋。
 */
async function claimTag(code, prefix, playerId, candidates, taken, { mine = false } = {}) {
  let last = null;
  for (const c of candidates) {
    last = c.value;
    if (taken.has(c.key)) continue;
    if (await hsetnx(roomKey(code), prefix + c.key, playerId)) return c.value;
    // 局中改名（renameSeat）：这一格可能本来就是他自己的（改回从前叫过的名字），那就算抢到了。
    if (mine && (await hget(roomKey(code), prefix + c.key)) === playerId) return c.value;
  }
  return last;
}

/**
 * 没取名字的人发字母；取了名字的人重了就加编号。候选按老规矩排。
 *
 * `skipBase`：名字本身不在候选里，从「名字 2」开始（第 16 推：没登录的人撞上了别人登记的昵
 * 称，见 pickSeatName）。
 */
function nameCandidates(typed, { skipBase = false } = {}) {
  const trimmed = String(typed ?? '').trim();
  if (!trimmed) {
    return Array.from({ length: 26 }, (_, i) => {
      const letter = String.fromCharCode(65 + i);
      return { key: letter.toLowerCase(), value: letter };
    });
  }
  const list = skipBase ? [] : [{ key: trimmed.toLowerCase(), value: trimmed }];
  for (let n = 2; n < 100; n++) {
    list.push({ key: `${trimmed} ${n}`.toLowerCase(), value: `${trimmed} ${n}` });
  }
  return list;
}

/**
 * 新坐下来的这个人在屋里叫什么（第 16 推第 6 条）。
 *
 *   · **登录了、登记过昵称**：用帐号昵称，他在名字栏里敲的不算。认人用的是和开屋那一关同
 *     一套（_entitlement.js 的 identify：邮箱或第一串 + 令牌），所以报一个别人的邮箱拿不到
 *     别人的名字。
 *   · **没登录（或者登录了还没取昵称）**：用他自己敲的。过和昵称同一道关（清洗、12 个码点、
 *     词表），只是单个字母放行——那本来就是小屋的规矩（见 _badwords.js）。
 *     这个名字要是**已经是某个帐号登记的昵称**，直接给他「名字 2」：那个名字在全站是别
 *     人的，屋里不该出现一个冒用它的匿名座位——尤其是榜单和那张发出去的战绩卡上。
 *
 * 屋里的重名（两个没登录的人都叫「阿花」）照旧由 claimTag 那一套加编号，后来的那个加。
 *
 * @returns {{ ok: true, typed: string, skipBase: boolean } | { ok: false, error: string }}
 *   `typed` 空着就是没取名字，发字母；`skipBase` 为真时候选从「名字 2」开始。
 */
async function pickSeatName(body, who) {
  const nick = who ? await nicknameOf(who.id) : '';
  if (nick) return { ok: true, typed: nick, skipBase: false };
  if (!scrubName(body.name)) return { ok: true, typed: '', skipBase: false };
  const checked = checkNickname(body.name, { letter: true });
  if (!checked.ok) return { ok: false, error: checked.error };
  const owner = await nicknameOwner(checked.name);
  return { ok: true, typed: checked.name, skipBase: Boolean(owner) && owner !== who?.id };
}

/**
 * 打请求的这个人是谁（登录了的话）。没带令牌、令牌不对都是 null。
 *
 * 认人这一步摔了（库抖一下）也当他没登录：进不了屋比名字不对更糟，而他下一次进屋就对了。
 * 代价是这一次认领不回他自己那把带账号标识的椅子（见 seatOwnerTag）——他会坐进一把新椅子，
 * 和「换了台没登录的设备回来」一样。
 */
async function whoIsAsking(body) {
  if (!body.accountToken) return null;
  try {
    return await identify({ email: body.email, accountToken: body.accountToken, holderCode: body.holderCode });
  } catch {
    return null;
  }
}

/**
 * 座位上记的「这把椅子是哪个账号坐的」（2026-10-08 方案 1-3）。
 *
 * 从前认领只认名字：走了的人回来，敲同一个名字就把椅子连同累计分一起领回去（见 join 里
 * `back` 那一段）。可名字谁都敲得出来——一个没登录的人敲一个登录玩家的昵称，那人的椅子一
 * 空出来（按了《离开》、网页关了），他就顶号接走人家打了一晚上的累计分。所以登录的人坐下
 * 时在椅子上记一枚账号标识；认领这种椅子必须出示同一个账号的令牌。匿名的椅子照旧按名字认。
 *
 * 存的是 sha256 全长、带一个用途前缀，**不是邮箱原文**：小屋整间屋是一个 hash，任何能读库
 * 的人都看得到它，而这一位只用来比「是不是同一个人」。不用 `_redact.js` 的 redact——那一枚
 * 只给日志用，它自己写着别拿来当 id。publicState 不往外发这一位（它一个字段一个字段地挑）。
 */
const seatOwnerTag = (accountId) =>
  createHash('sha256').update('seat-owner:' + String(accountId), 'utf8').digest('hex');

/** 头像候选：先本形状，再换形状，再沿色环挪（挑法见上面 avatarKey 那段）。 */
function avatarCandidates(wanted) {
  const shapes = [...AVATAR_SHAPES];
  const list = [{ key: avatarKey(wanted), value: wanted }];
  for (const shape of shapes) {
    const tryIt = { shape, hue: wanted.hue };
    list.push({ key: avatarKey(tryIt), value: tryIt });
  }
  const buckets = Math.round(360 / HUE_STEP);
  for (let step = 1; step <= buckets; step++) {
    for (const shape of shapes) {
      const tryIt = { shape, hue: (wanted.hue + step * HUE_STEP) % 360 };
      list.push({ key: avatarKey(tryIt), value: tryIt });
    }
  }
  return list;
}

/** 快照里这些名字已经有人用了（小写比对，和 uniqueName/freeLetter 一致）。 */
const namesTaken = (hash) =>
  new Set(
    Object.entries(hash)
      .filter(([k, v]) => k.startsWith('p:') && v && !v.left)
      .map(([, v]) => String(v.name ?? '').trim().toLowerCase()),
  );

/** 快照里这些头像格已经有人占了。 */
const avatarsTaken = (hash) =>
  new Set(
    Object.entries(hash || {})
      .filter(([field, value]) => field.startsWith('p:') && value?.avatar)
      .map(([, value]) => avatarKey(cleanAvatar(value.avatar))),
  );

// ---- the six things a room can be asked ---------------------------------

async function create(res, body) {
  if (!(await hostMayOpen(body))) return send(res, 403, { error: 'geniusOnly' });
  // 屋主叫什么（第 16 推）：登记过昵称就是昵称，否则是他敲的那个（见 pickSeatName）。放在抢
  // 房号**之前**：名字不过关就别先开出一间空屋。
  const who = await whoIsAsking(body);
  const picked = await pickSeatName(body, who);
  if (!picked.ok) return send(res, 400, { error: picked.error });

  const playerId = id(8);
  const token = id(16);
  const meta = {
    host: playerId, createdAt: Date.now(),
    mode: null, seed: null, startAt: null,
    /**
     * 这间屋有几把椅子，开屋那一刻定死（见上面 seatsFor 的说明）。
     *
     * body.contest 今天没有任何界面会送过来，所以现在开出来的每一间都是普
     * 通小屋（8 把）。竞赛模式的入口做好之后，那个界面送 contest: true。
     */
    seats: body.contest === true ? CONTEST_SEATS : OPEN_SEATS,
    /**
     * 这是一间竞赛屋。座位数上面那一行已经定了，这一位管的是**规则**：开屋的人
     * 不参赛，只看实时榜单（见 isSpectator）。两样分开存，因为它们回答的是两个
     * 不同的问题——「几把椅子」和「屋主算不算选手」。
     */
    contest: body.contest === true,
    /** 随机得分目标那一局：'same' 全屋同一对图案，'own' 各转各的；别的局 null。 */
    slot: null,
    /** Rounds played. The host may put up one board after another. */
    round: 0,
  };

  // Four digits is 10 000 rooms; at any plausible number of games running at
  // once a handful of tries finds a free one. HSETNX makes the claim atomic,
  // so two hosts cannot be handed the same code.
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = String(randomInt(0, 10000)).padStart(4, '0');
    if (!(await hsetnx(roomKey(code), 'meta', meta))) continue;
    // **抢到房号的下一步就是给它定期限**（第 14 推）。原先 EXPIRE 排在后面两次写入之后：
    // 那两次里任何一次摔了（库忙、超时），这把房号就成了一个没有期限的键——永远占着，
    // 一万个房号就少一个，而且没有任何东西会去清它。期限先压上，后面摔了也只是一间二十
    // 分钟后自己消失的空屋。check-room-race 钉着这个先后。
    await expire(roomKey(code), ROOM_TTL_S);
    await hset(roomKey(code), 's:0', playerId);
    await hset(roomKey(code), 'p:' + playerId, {
      token,
      // 空的名字发一个字母。这间屋刚开，谁都没坐，所以屋主拿到的是 A。撞上别人登记的昵称
      // 就是候选里的第一个「名字 2」（屋里是空的，轮不到更后面的编号）。
      name: picked.typed ? nameCandidates(picked.typed, picked)[0].value : freeLetter({}),
      avatar: cleanAvatar(body.avatar),
      score: 0,
      finished: false,
      joinedAt: Date.now(),
      slot: 0,
      seen: cleanSeen(body.seen),
      // 屋主的椅子本来就一律不认领（见 join），记上是为了和别的椅子一个样子。
      ...(who ? { owner: seatOwnerTag(who.id) } : {}),
    });
    return send(res, 200, {
      code,
      playerId,
      playerToken: token,
      state: publicState(code, await freshRoom(code)),
    });
  }
  return send(res, 503, { error: 'busy' });
}

async function join(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  if (hash.meta.endedAt) return send(res, 409, { error: 'ended' });
  // 自己取的名字（可能是空的）和最后落到座位上的名字，是两件事：认领旧椅子
  // 只认前者。没取名字的人报上来的是空，认领这一步就整个跳过——拿一个空名字
  // 去比，会认到别人那把椅子上去。
  const typed = cleanName(body.name);
  const name = typed || freeLetter(hash);
  // 一局正打到一半也进得来（从前这里回 409 started）。这一局不算他的：新座位
  // 的 joinedAt 在 startAt 之后，roundOver 不等他、bankRound 不记他；他在等待
  // 页看着实时排行，下一局开始时才入局——见 ui/multiplayer.ts 的 sideline。
  const midRound = Boolean(hash.meta.round) && !roundOver(hash);

  // 走了的人回来。
  //
  // 同一个昵称、椅子还在表里（leave 只标不删），就把那把椅子还给他：昵称、
  // 打过的几局、累计的分数、连 playerId 都还是原来的（屋主回来还是屋主），
  // 只换一把新钥匙——旧那把留在他走掉的那台设备上，不该再开得了这个座位。
  // 关掉网页的、早就没动静的座位也认：掉线的人多半连 localStorage 里的座位
  // 一起丢了（换了浏览器、清了数据），只剩名字能证明他是谁。正在报到的座位
  // 不认，那是另一个恰好同名的人（seatReclaimable）。
  // 屋主的椅子一律不认领：屋主身份不能换人（玩家定的）。他不在，屋里的人看
  // 到的是「屋主等一下就来」；太久不回来就是「屋主离家出走了，小屋暂时解散」。
  //
  // **带账号标识的椅子只还给同一个账号**（2026-10-08 方案 1-3，见 seatOwnerTag）。一个没登录
  // 的人敲了登录玩家的名字，那把椅子不算「他的」：find 跳过它，他照常坐一把新椅子（名字撞
  // 上别人登记的昵称时是「名字 2」，见 pickSeatName）。匿名的椅子照旧谁敲对名字给谁。
  const who = await whoIsAsking(body);
  const askerTag = who ? seatOwnerTag(who.id) : '';
  const back = Object.entries(hash).find(
    ([field, seat]) =>
      field.startsWith('p:') &&
      seat &&
      field.slice(2) !== hash.meta.host &&
      sameName(seat.name, typed) &&
      seatReclaimable(seat) &&
      (!seat.owner || seat.owner === askerTag),
  );
  // typed 是空的时候上面那个 find 一定落空（座位名字不会是空的），不必另写
  // 一句判断——留着这行注释是因为「空名字不认领」是有意的，不是漏了。
  if (back) {
    const [field, seat] = back;
    // 先拿这一轮认领的独占权（见 claimKey 上面那段）。放在占椅子**之前**：
    // 抢不到的那台不该先去占一把椅子再被打回来，那会把一把椅子白白漏出去，
    // 屋里于是显示出一个不存在的人。
    if (!(await hsetnx(roomKey(code), claimKey(field.slice(2), seat.token), { at: Date.now() }))) {
      return send(res, 409, { error: 'claimed' });
    }
    const token = id(16);
    // 按过《离开》的座位早把椅子交回去了（见 leave）：回来先重新占一把。
    let slot = seat.slot;
    if (seat.left || slot === undefined) {
      slot = await claimSeat(code, field.slice(2), hash);
      if (slot < 0) {
        // 满了：先把刚抢的那把认领锁还回去，再答 full（第 14 推）。原先锁留在那儿——他等
        // 到有人起身、再按一次《加入》，撞上的是自己上一次留下的锁，答的是 claimed，而且
        // 这间屋子活着一天就一直是 claimed：他再也回不到自己那个座位上。
        await hdel(roomKey(code), claimKey(field.slice(2), seat.token));
        return send(res, 409, { error: 'full', seats: seatsFor(hash.meta) });
      }
    }
    const next = {
      ...seat,
      name: nameForReturner(seat, hash),
      token,
      slot,
      lastSeen: Date.now(),
      learningAt: 0,
      seen: cleanSeen(body.seen),
    };
    delete next.left;
    // 这一局已经开了：他手上的棋盘早没了，这一局不等他，下一局再入。走之前
    // 打出来的那点分留着，下一次 start 时 bankRound 照常记账。
    if (midRound) next.finished = true;
    await hset(roomKey(code), field, next);
    // 心跳那一格也要翻新。他多半是关了网页才被认领回来的，那一格里留着的是
    // bye 写下的 lastSeen 0 和 byeAt；不盖掉的话 readRoom 会把它们折回座位上
    // ——人明明回来了，屋里却一直显示他「终端关着」，座位还随时会被下一个同
    // 名的人认领走。
    await hset(roomKey(code), beatKey(field.slice(2)), { lastSeen: Date.now(), byeAt: 0 });
    /*
     * 这一局那一格：**只盖 `finished` 这一位**，分数和用时原样留着——而且写之前重读。
     *
     * 要写它，是因为「这一局已经开了，不等他」只有写在这一格里才作数：`readRoom` 拿
     * `r:` 盖座位，不写的话上面刚算好的 `next.finished` 会被旧的那一份折回去，于是屋里
     * 要为一个回来了却打不了这一局的人干等满 ABSENT_MS。
     *
     * 但**分数不能从那份快照里带过来**。从前这儿写的是 `next.score`（函数入口读到的、
     * 他走之前那一局的分），撞上屋主开下一局就是这样：记账把 `r:` 记进 `t:` 之后清掉，
     * 而这一句紧接着又把 200 写回 `r:`——`t:` 里有 200、`r:` 里又有 200，屏幕上
     * `total + score` 是 400，而下一次开局还会把它记第二遍。门是 check-room-races 的
     * ⑱，错位 10 量到的就是 400。重读之后写：记账已经清过，读到的就是 0；还没清，读到
     * 的就是他那 200——两种都对。
     *
     * 记账**正在跑**的时候干脆不写：那一格马上会被它清成 CLEAR_ROUND，而那恰好就是新
     * 一局该有的样子（他回来了，新这一局还没打）。问的是和 start / end 同一把锁（见
     * score() 里那一段「这一局正在收尾」，同一个理由、同一个写法）。
     *
     * 剩下一道窄缝：这儿读完之后、写进去之前，记账恰好抢到锁并清掉这一格。那需要两次
     * 库操作之间插进整段抢锁 + 清格——和 leave() 里那一处同一个量级，**这是这一处的天
     * 花板，不是没想到**。要彻底堵死得有一把座位级的锁，而认领是一次性动作，不值得。
     */
    const liveHash = await hgetall(roomKey(code));
    const banking =
      lockHeld(liveHash, startLockKey((Number(liveHash?.meta?.round) || 0) + 1)) || lockHeld(liveHash, END_LOCK);
    if (!banking) {
      await hset(roomKey(code), roundKey(field.slice(2)), {
        ...(liveHash?.[roundKey(field.slice(2))] || CLEAR_ROUND),
        finished: Boolean(next.finished),
      });
    }
    await expire(roomKey(code), ROOM_TTL_S);
    return send(res, 200, {
      playerId: field.slice(2),
      playerToken: token,
      rejoined: true,
      state: publicState(code, await freshRoom(code)),
    });
  }

  // 新座位叫什么（第 16 推，见 pickSeatName）。放在占椅子**之前**：名字不过关就别先占一把
  // 椅子再退回来——那一下屋里会闪出一个不存在的人。
  const picked = await pickSeatName(body, who);
  if (!picked.ok) return send(res, 400, { error: picked.error });

  const playerId = id(8);
  const token = id(16);
  // The seat count travels with the refusal, not just with a room you are
  // already inside. Joining from the home page is where "满了" is actually
  // read. 占椅子是原子的（claimSlot），两个人同时按《加入》也塞不进第九个。
  const slot = await claimSeat(code, playerId, hash);
  if (slot < 0) return send(res, 409, { error: 'full', seats: seatsFor(hash.meta) });
  // 名字和头像等占到椅子之后再定，而且是「抢」不是「算」：函数一进来读的那
  // 份快照，几个同时进来的人读到的是同一份（见 claimTag）。快照仍要用——屋
  // 主和认领回来的人没有走这条路，他们的名字只在快照里。
  const fresh = (await hgetall(roomKey(code))) || hash;
  const seatName = await claimTag(code, 'n:', playerId, nameCandidates(picked.typed, picked), namesTaken(fresh));
  const seatAvatar = await claimTag(
    code,
    'a:',
    playerId,
    avatarCandidates(cleanAvatar(body.avatar)),
    avatarsTaken(fresh),
  );
  await hset(roomKey(code), 'p:' + playerId, {
    token,
    name: seatName,
    avatar: seatAvatar,
    score: 0,
    finished: false,
    joinedAt: Date.now(),
    slot,
    /** 看过哪几族的教学。开局时用来判「这一局可不可能有新手」（见 start）。 */
    seen: cleanSeen(body.seen),
    /** 登录了的人坐下时记一枚账号标识：认领这把椅子要同一个账号（见 seatOwnerTag）。 */
    ...(who ? { owner: seatOwnerTag(who.id) } : {}),
  });
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, {
    playerId,
    playerToken: token,
    rejoined: false,
    state: publicState(code, await freshRoom(code)),
  });
}

/**
 * 往 meta 上打一个补丁：**重读之后往最新那一份上盖**，而且屋子散了、已经是下
 * 一局了、或者 start/end 正在办事，一律不写。
 *
 * 为什么非这么写不可：`meta` 不是一格一个字段，而是**整间屋子共用的一份 JSON
 * 文档**（小屋是一个 hash，meta 占一格）。所以改它只能读—改—写，而拿进函数时
 * 那份旧快照整份写回去，就会把这中间别人写进去的东西抹掉——和座位 `p:` 那五条
 * 路踩的是同一个坑（见 readRoom 上面那段、check-room-races 的 ①②③）。
 *
 * meta 里同时装着 `endedAt`（屋子散了）和 `round`（第几局），于是漏了这一道的
 * 后果是这样的：
 *
 *   · 屋里有人举手说「我还不会玩」，房间正等他学完，屋主这时按《解散小屋》。
 *     别人的手机每秒轮询一次，只要有一条恰好读到「还没散」的旧 meta、又在这
 *     一瞬走了放行那条路，`endedAt` 就被整个抹掉。房间在服务器那边看起来「没
 *     散」：还在等的人看到的是「等屋主开下一局」，要干等到 90 秒外的「房间被
 *     取消」，而不是当场那张该出现的结算战绩卡。
 *   · 同理，屋主按《再来一局》的那一下会被这条路把 `round` 悄悄拉回上一局。
 *
 * 窗口只有零点几秒，不是必现——所以门（check-room-races 的 ⑭）是**扫错位**量
 * 的：一把 Promise.all 同时发两条是绿的（两条读到同一份快照，写回去的值一样），
 * 只有把轮询那条往后推到恰好落在 end() 写完 meta 之后，才量得出来。
 *
 * `lockField` 是「这一次锁哪一格」。同一局里各做一次的事，各用各的锁——挂起和放行都
 * 只发生一次，但它们是**两件**事，共用一把一次性的锁会让后一件永远抢不到（见
 * holdSetLockKey 那段：倒数会被锁死 20 秒）。
 *
 * 三道保险，缺一不可：
 *   ① 抢一格一次性的锁——两条同时看到「学的人不见了」（轮询每秒一次、屋里几
 *      个人就有几条）只许一条动手；
 *   ② `lockHeld` 看一眼 start/end 是不是正在办事——它们要跑几十趟库才写到
 *      meta，这中间我们绝不能插一脚（和 score() 里那一道是同一个写法）；
 *   ③ 重读一遍，往**刚读到的那份**上盖，并且散了/换局了/别人已经放行过了都
 *      直接回头。
 */
async function patchMeta(code, round, lockField, patch) {
  if (!(await takeRoomLock(code, lockField))) return null;
  const live = await readRoom(code);
  if (!live) return null;
  const meta = live.meta || {};
  // 散场和开新局都要跑几十趟库才写到 meta。它们正在路上的时候我们一个字都不
  // 能写：写了就是把人家马上要落地的那一份提前作废。
  if (lockHeld(live, startLockKey((Number(meta.round) || 0) + 1)) || lockHeld(live, END_LOCK)) return null;
  if (meta.endedAt) return null;
  if ((Number(meta.round) || 0) !== round) return null;
  const next = { ...meta, ...patch(meta) };
  await hset(roomKey(code), 'meta', next);
  return next;
}

/**
 * 「有人在学」的挂起到此为止：开赛时刻重新盖一遍，大家一起从头数。
 * 学完了、走了、二十秒没动静，走到这儿的是同一件事。
 *
 * 三道门都落到这儿（轮询 state、学完了说一声 learn、学的人走了 leave），所以
 * 那一道「不许把别人写进去的东西抹掉」只补在这一处就够了——补在三个调用点上，
 * 下一条路会忘。写入那一段在 patchMeta 里，连同为什么。
 *
 * 回的是**此刻真正生效的那一份 meta**：没写成（散了、换局了、别人已经放行过）
 * 就回传进来的那一份，调用方照旧自己重读一次屋子（三处都这么做）。
 */
async function releaseHold(code, meta) {
  const round = Number(meta.round) || 0;
  const released = await patchMeta(code, round, holdLockKey(round), (live) => ({
    learnHold: false,
    startAt: Date.now() + countdownMsFor(live.mode),
    countFrom: countFromFor(live.mode),
  }));
  return released || meta;
}

async function state(res, body) {
  const code = String(body.code ?? '').trim();
  let hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  // 学的人二十秒没动静了（或者早走了）：不再等他。轮询是唯一稳定会跑到这
  // 儿的路，所以这一步放在这里而不是等谁来「说一声」。
  if (hash.meta.learnHold && (!anyoneLearning(hash) || holdExpired(hash.meta))) {
    await releaseHold(code, hash.meta);
    hash = (await readRoom(code)) || hash;
  }
  // 问一次状态，也就是报一次到。
  //
  // 从前只有交分数那条路会写 lastSeen，可小屋页（两局之间）根本不交分数：
  // 所有人坐在那儿，谁也没动，十二秒之后每个人都成了「不在」，屋里于是挂出
  // 一句《屋主正在修电缆》——网络一点问题都没有。轮询本身就是最诚实的心跳，
  // 它每秒都在发生；这里只是把它记下来。
  const seat = seatOf(hash, body.playerId, body.playerToken);
  // 屋里有人动了一下，这间屋子就该继续活着。
  //
  // TTL 只有二十分钟，而真正会延命的动作（开局、催、看教学）之间可以隔很久：
  // 四个人埋头打一局二十五分钟的棋，中间一次 start 都没有，屋子会在他们眼皮
  // 底下过期。所以把「动了一下」也算进来。
  //
  // 不拿轮询本身当心跳：轮询每秒都在发生，那等于永不过期，省不下任何东西。
  // 客户端只在自己页面上真的被点过之后，才在下一次轮询里带上 touched（见
  // engine/room.ts 的 noteTouch）——于是这条 EXPIRE 一分钟最多跑几次，而
  // 一间没人碰的屋子是真的没人碰。
  if (seat && body.touched) await expire(roomKey(code), ROOM_TTL_S);
  // 椅子被借走的人回来了：在他证明自己是谁的这一刻，顺手补一把椅子。
  //
  // 小屋坐满的时候有新朋友按《加入》，claimSeat 会把「网页已经关掉」的座位
  // 借给他，并把原主人的 slot 抹掉——名字、分数、打过几局都还在，只是不再占
  // 位子。原主人从别的设备回来走的是 join 的认领那条路，那儿会重新占一把；
  // 可他要是就在原来那台手机上切回来（切个应用、锁屏再解开——这才是最常见
  // 的那种「暂时不在」），带着 sessionStorage 里的身份直接接着轮询，而这条路
  // 从前只刷新 lastSeen，不管椅子。
  //
  // 于是他成了一个占着名额、却没有真实座位的幽灵：自己没有任何异常提示，照
  // 常出现在名单里，但再也分不到座位；屋里显示的人数会超过它自己号称的上限
  // （「9/8」），而那个名额一直到小屋过期都回收不了，新朋友反而进不来。
  //
  // 抢不到（真的一把空椅子都腾不出来）就先这样，下一次轮询再试——他的分数和
  // 局数一直都是好的，这里补的只是座位这本账。
  //
  // 补椅子这一下要独占。HSETNX 只保证「同一把椅子不会被两个人占到」，不保证
  // 「同一个人不会占到两把」：这台设备从后台切回前台、或者不小心开了两个标签
  // 页，并发发出两次轮询，两次各找到一把不同的空椅子、各自 HSETNX 成功，最后
  // 写 p: 的那一次赢，另一把刚占到的椅子就成了一条谁也认领不到、leave() 也回收
  // 不了的幽灵座位——屋里显示的人数比实际坐着的人多一个（这份代码自己点名过的
  // 「9/8 幽灵」），新朋友看着有空位却进不来，只能等二十分钟过期。join() 那条
  // 认领的路有 claimKey 挡着，state() 这条新路没覆盖到。
  //
  // 用 takeRoomLock 而不是 claimKey：claimKey 的格名里带着座位那把钥匙，而这条
  // 路上钥匙不换，抢过一次就永久占着——椅子哪天再被借走，就再也补不回来了。
  // takeRoomLock 过 LOCK_STALE_MS 会被接手，所以「借走—补回」来回多少次都成立。
  // 抢不到的那一次什么都不做，下一次轮询再试（本来就是这个约定）。
  if (seat && !seat.left && seat.slot === undefined && (await takeRoomLock(code, 'refill:' + body.playerId))) {
    const slot = await claimSeat(code, body.playerId, hash);
    if (slot >= 0) {
      // 写回去的这一份会带着 readRoom 折进来的成绩影子（见 readRoom 那段：
      // p: 里那几个字段是死数据，r: 存在就以 r: 为准），所以这儿只管椅子。
      await hset(roomKey(code), 'p:' + body.playerId, { ...seat, slot });
      await hset(roomKey(code), beatKey(body.playerId), { lastSeen: Date.now(), byeAt: 0 });
      return send(res, 200, publicState(code, await readRoom(code)));
    }
  }
  if (seat && Date.now() - (seat.lastSeen || 0) > SEEN_WRITE_MS && !seat.left) {
    // 只写心跳那一格，绝不碰座位——这一下和他自己那一刻的报分是并发的。
    await hset(roomKey(code), beatKey(body.playerId), { lastSeen: Date.now(), byeAt: 0 });
    return send(res, 200, publicState(code, await readRoom(code)));
  }
  return send(res, 200, publicState(code, hash));
}

/**
 * 关掉网页的那一下。
 *
 * 「他走了」这件事，光靠等超时要等 AWAY_MS 那么久。网页被关掉的时候浏览器
 * 允许发最后一个 beacon，这里就把 lastSeen 抹掉——屋里其他人下一次轮询就
 * 知道了，不用干等半分钟。
 *
 * 不做的事：不把座位标成 left。关掉标签页和「按下离开」是两回事，前者常常
 * 是手滑或者手机切了应用，人马上就回来了——座位得留着。
 */
async function bye(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 200, { ok: true });
  const seat = seatOf(hash, body.playerId, body.playerToken);
  if (seat && !seat.left) {
    // 写心跳那一格就够了，座位一个字不动——这一下常常和「最后一次报分」同时
    // 飞出去（打完最后一步随手切应用），从前两条路抢同一份座位，分数就停在
    // 中途那个数上。0 这个值 readRoom 会原样折回去，publicState 的 closed
    // （终端关了，和网差的 away 是两件事）照常成立。
    // byeAt 是「他什么时候说的这句话」：屋里要过了 BYE_GRACE_MS 还没再听见他
    // 才当真（见 seatClosed）——刷新一次页面发的是同一个 beacon，不能一收到就
    // 把正在打的那一局judge 掉。
    await hset(roomKey(code), beatKey(body.playerId), { lastSeen: 0, byeAt: Date.now() });
  }
  return send(res, 200, { ok: true });
}

async function start(res, body) {
  const code = String(body.code ?? '').trim();
  let hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  if (hash.meta.host !== body.playerId || !seatOf(hash, body.playerId, body.playerToken)) {
    return send(res, 403, { error: 'notHost' });
  }
  if (hash.meta.endedAt) return send(res, 409, { error: 'ended' });
  // A room is an evening, not a single game: the host may put up board after
  // board. What may not happen is a new one landing on players who are still
  // working through the last, so the only bar is that the round in progress
  // has finished.
  if (hash.meta.round && !roundOver(hash)) return send(res, 409, { error: 'started' });
  if (!MODES.has(body.mode)) return send(res, 400, { error: 'mode' });
  // 问的是「下场比的有几个」，不是「屋里有几个」：竞赛屋的主持人不参赛，
  // 「屋主 + 一个人」开出来是一个人自己跟自己比（见 playerCount）。
  if (playerCount(hash) < MIN_PLAYERS) return send(res, 409, { error: 'tooFew' });
  // 无限反转：只开在方块和小球上，100 秒，得分翻面来回翻——客户端按这个标记
  // 挂上那套规则；棋盘照旧从 seed 发，所以全屋仍是同一副牌。
  const flip = body.flip === true && FLIP_MODES.has(body.mode);
  // 随机得分目标只开在三个基础棋盘上。'same'：全屋从同一个种子里抽同一对
  // 图案；'own'：各自抽各自的。棋盘两种情况都一样——它照旧从 seed 发。
  // 无限反转那一局没有老虎机。
  const slot =
    !flip && SLOT_MODES.has(body.mode) && (body.slot === 'same' || body.slot === 'own') ? body.slot : null;

  // 这一局的开局权，抢到才办（见 startLockKey 上面那段）。抢不到说明已经有
  // 一条在开这一局了：回当前状态，不重复记账。
  const nextRound = (hash.meta.round || 0) + 1;
  if (!(await takeRoomLock(code, startLockKey(nextRound)))) {
    return send(res, 200, publicState(code, await readRoom(code)));
  }

  // 抢锁那一下也要跑一趟库（hsetnx 一个来回）。这中间恰好有人把最后一次分报
  // 上来，写进的是他的 `r:`（score() 只写那一格）——而上面那份快照里那一格
  // 还是旧的。照旧快照记账，紧接着又把 `r:` 清成 CLEAR_ROUND，新报的那一份
  // 连记带存两头落空：不报错，牌桌上也看不出来，玩家事后才发现少了一局。
  //
  // 所以写之前重读一次，和 leave() / learn() 一个做法（那两处的注释里写着同
  // 一句话）。昨天凌晨补的锁只挡住了「两条 start 互相撞」，「start 撞上一条真
  // 实报分」是另一种，当时没测到。门是 check-room-races 的 ⑩。
  const fresh = await readRoom(code);
  if (!fresh) return send(res, 404, { error: 'noRoom' });
  hash = fresh;

  /*
   * **屋主正在散场，就别开下一局了。**
   *
   * 两条路都会给刚打完那一局记账，而记账是「读一份累计账、加上这一局、写回去」——两条
   * 同时跑就是加两遍。锁各管各的（`ls:<round+1>` 和 `END_LOCK`），互相看不见，所以这
   * 儿明说一句。
   *
   * 让的是 start 这一头：屋主按了《解散小屋》之后再开一局，本来就不是他要的事；回一份
   * 当前状态，他那一端读到 `endedAt` 自己就进战绩卡了。反过来 end 不能「让」——那一按
   * 必须有结果，所以它只是跳过记账（见 end 里那一段）。
   */
  if (lockHeld(hash, END_LOCK)) return send(res, 200, publicState(code, hash));

  // The round that just ended is banked before the next one wipes the board,
  // because the closing card is the sum of all of them and a score only
  // exists on the server between one round and the next.
  const banked = {};
  for (const [field, seat] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !seat) continue;
    /**
     * 竞赛屋的主持人不参赛（见 isSpectator）：他没有分，账上不该有他。
     *
     * 他那台设备坐在实时榜单上，每一次轮询都会「交一次卷」（客户端那条 sitOut，
     * 好让屋里别人不等他）——不拦这一道，那些 0 分会被一局一局记进 total、
     * rounds，最后那张竞赛排名图上凭空多出一个打了十局全是 0 的人，还排在最后
     * 一名。这一局那一格照旧清掉，不然 readRoom 会把它折回来。
     */
    if (isSpectator(hash.meta, field.slice(2))) {
      // **不写 `p:`**（见 totalKey 那段）：这一格有六条路在写，而这儿手上是一份快照，
      // 整份写回去会把中间刚落地的改名、看教学抹掉。该清的是 `r:`，清它就够了——
      // readRoom 会把 `r:` 折回座位，`p:` 里那三样本来就是死数据。
      banked[field] = { ...seat, ...CLEAR_ROUND };
      await hset(roomKey(code), roundKey(field.slice(2)), { ...CLEAR_ROUND });
      continue;
    }
    // 和 end() 那条路同一把尺子：只有真的打完了这一局的人才记账——交了卷的，
    // 和已经走了的（leave 标成 finished）。
    //
    // 这一句非补不可，因为「这一局算结束了没有」（roundOver）除了这两种，还
    // 认第三种：某人 90 秒没消息，就不再等他。那时候他的 finished 还是 false
    // ——屋主一开下一局，从前这儿会把他掉线前最后一次心跳报上来的、根本没打
    // 完的那个分数当成最终成绩记进 total、best 和 rounds。他事后翻自己的战绩，
    // 会看到一个比实际打出来的高、又说不清哪来的数。
    //
    // 昨天只改了 end()，这半边留在了姊妹函数里。两条路必须信同一套：不能一
    // 条认「90 秒没动静=打完了」，另一条不认。
    const live = await liveSeat(code, field, seat);
    const done = Boolean(live.finished) || Boolean(live.left);
    // 累计账写**自己那一格**，`p:` 一个字都不碰（见 totalKey 那段）。
    if (done) {
      const totals = bankTotals(live, hash.meta.round, hash.meta.startAt || 0);
      await hset(roomKey(code), totalKey(field.slice(2)), totals);
      banked[field] = { ...live, ...CLEAR_ROUND, ...totals };
    } else {
      banked[field] = { ...live, ...CLEAR_ROUND };
    }
    // 这一局那一格也要清——不清的话 readRoom 会把上一局的分数折回来。
    await hset(roomKey(code), roundKey(field.slice(2)), { ...CLEAR_ROUND });
  }

  // 可能有新手：屋里有人没看过这一族的教学。那就多留四秒——那个人的设备会
  // 问他「会不会」，其他人的倒数从 8 数起（横屏玩法 9）。他答「会」什么都不
  // 变，大家一起数到 0；答「不会」走 learn 那条路，整屋等他。
  const family = familyOf(body.mode);
  const novice = NOVICE_FAMILIES.has(family) && Object.entries(hash).some(
    ([f, seat]) =>
      f.startsWith('p:') &&
      seat &&
      !seat.left &&
      // 竞赛屋的主持人不参赛（见 isSpectator），所以他会不会玩这一族跟这一局没关系。
      // 不排掉他的话：他那台设备从来不打，`seen` 里永远是空的，于是**每一局**都被判
      // 「屋里可能有新手」——全屋的倒数一直从 8 数起（横屏 9），而那四秒是留给一个
      // 压根不下场的人的。那四秒还会连着把「问他会不会」那一屏弹到他脸上。
      !isSpectator(hash.meta, f.slice(2)) &&
      !(seat.seen || []).includes(family),
  );
  const meta = {
    ...hash.meta,
    mode: body.mode,
    slot,
    flip,
    round: nextRound,
    // The one string from which every player builds the identical board.
    seed: id(8),
    startAt: Date.now() + countdownMsFor(body.mode) + (novice ? ASK_MS : 0),
    /** 屏幕上从几数起。多留的四秒也数出来：8-7-6-5-4-3-2-1。 */
    countFrom: countFromFor(body.mode) + (novice ? ASK_MS / 1000 : 0),
    /** 这一局有没有被「有人在学」挂起。 */
    learnHold: false,
  };
  await hset(roomKey(code), 'meta', meta);
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, publicState(code, { ...hash, ...banked, meta }));
}

/**
 * Folds a finished round into a seat's running totals and clears the board
 * for the next one. Called with `round` 0 - before anyone has played - it
 * only clears, so opening the first board never banks a phantom zero.
 *
 * 单局最快 is the quickest single round anyone put together, not the sum of
 * their times: a player who sat out one board should not win it by having
 * spent less of the evening playing.
 */
function bankRound(seat, round, startAt = 0) {
  const next = { ...seat, score: 0, finished: false, seconds: null };
  // 这一局该不该记账的判定在下面；记出来的那四样由 bankTotals 单独取走，写进 `t:`。
  // Nothing to bank: no round has been played, this seat arrived after the
  // last one had begun and sat it out, or whoever sat here had already gone
  // before it began.
  //
  // 两头都要挡，而且是对称的：来晚了（joinedAt 在开赛之后）不算这一局，走早
  // 了（left 在开赛之前）同样不算。原先只挡了前一头，于是打完第一局就退出的
  // 人，rounds 会跟着屋里其他人一路涨到 10——total 和 best 看不出来，他的
  // score 是 0，加零、取大都不动，只有 rounds 是无条件加一的。今天没有哪个
  // 界面在读这个数，所以没人看得见；等有人拿它去算人均得分，退出的人就会把
  // 平均分拉下去，而且从数上完全看不出问题出在哪。
  //
  // 注意挡的是「走之后才开的那些局」，不是「走了的人」。他离开时正打着的那
  // 一局要照记：分数在 leave 里原样留着（见那里的注释），那一局他确实打了，
  // 也确实要出现在最后那张竞赛排名图上。
  const goneBefore = (seat.left || 0) > 0 && seat.left <= startAt;
  if (!round || goneBefore || (seat.joinedAt || 0) > startAt) return next;
  const scored = Math.max(0, Math.floor(Number(seat.score) || 0));
  next.total = (seat.total || 0) + scored;
  next.best = Math.max(seat.best || 0, scored);
  next.rounds = (seat.rounds || 0) + 1;
  const took = Number(seat.seconds);
  if (Number.isFinite(took) && took > 0) {
    next.bestTime = seat.bestTime ? Math.min(seat.bestTime, took) : took;
  }
  return next;
}

/**
 * 这一局记完账之后，累计账那四样该是多少——**只回那四样**，写进 `t:`（见 totalKey）。
 *
 * 判定一个字都不重写：照旧走 bankRound，再把那四样挑出来。两份判定迟早会走样，而这一
 * 条判的是「这一局算不算他的」——来晚了、走早了、竞赛屋的主持人，三样都在里面。
 */
function bankTotals(seat, round, startAt = 0) {
  const next = bankRound(seat, round, startAt);
  const out = {};
  for (const k of TOTAL_FIELDS) if (next[k] !== undefined) out[k] = next[k];
  return out;
}

/**
 * 报上来的用时，允许比「这一局开到现在有多久」多出这么多秒。
 *
 * 留的是网路那一跳（报分这一条在路上走了多久）和两头各自的取整（客户端
 * `Math.round(elapsed)`，服务器这边再 round 一次）。十五秒：比一跳一跳能慢的
 * 量级宽得多，又远小于任何一局的真实长度（计时那几档都是 100 秒），所以一个
 * 真打完的人不会被它误伤。
 *
 * ⚠️ 这把尺子**只在开赛之后**才架起来（见 score 里那一段）。倒数还没走完的时候
 * `Date.now() - startAt` 是负的，拿它当上限会把一切都裁掉——第一版就是这么写
 * 的，check-room-races 的 ⑧乙 当场红了：那一节在倒数里摆了一次「交卷 20 秒」，
 * 于是「单局最快」整个没了。
 */
const SECONDS_SLACK_S = 15;

async function score(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  const seat = seatOf(hash, body.playerId, body.playerToken);
  if (!seat) return send(res, 403, { error: 'notInRoom' });

  // **屋子已经散了：这一条谁都不该再收。**
  //
  // 下面那道「收尾中」只挡 LOCK_STALE_MS（20 秒）那么宽——`lockHeld` 过了这个
  // 数就当那把锁是废的。可一份报分迟到二十秒是再平常不过的事（手机息屏、地铁
  // 里那一格信号、客户端拆计分板时补发的最后一条）。于是二十秒之后它一路畅通
  // 写进 `r:`，而这一局的分早就记进 `t:` 了——`readRoom` 把 `r:` 折回座位上，
  // 屋里还看着那张战绩卡的人，屏幕上的 `total + score` 就把最后一局**算了两
  // 遍**（和 end() 里那一脚是同一个洞的另一面，门是 check-room-races 的 ⑥）。
  //
  // 散了的屋子没有「下一局」，所以这儿不像上面两道那样有「自我纠正」可言：收
  // 下就是错的，照样走 scoreDropped 那个出口。
  if (hash.meta.endedAt) {
    return send(res, 200, { ...publicState(code, hash), scoreDropped: true });
  }

  // 这一份成绩是哪一局算出来的。
  //
  // 断线重连撞上的就是这里：一个人网断了 90 秒以上，这一局不再等他，屋主开
  // 了下一局；他网一恢复，手机上还在跑的是上一局，算完把上一局的分数发出
  // 来。从前这儿无条件覆盖写入，于是服务器把他记成「新的这一局已经打完并交
  // 卷了」——新一局还没打的人被这一票凑够了「全员交卷」，局就在他们手里断掉。
  //
  // 局次编号客户端本来就收到（publicState 的 round），报分数时带回来，对不上
  // 就整条丢掉：不写分数、不写交卷、连 lastSeen 都不动（那是在替另一局的他
  // 续命）。回的仍是当前状态 200，他那一端读到新的 round 自己就跟上了。
  //
  // **不带局次的一律不收**（2026-10-08 方案 1-1）。从前不带就照旧写入，留给「还没接上局次的
  // 调用」——两个调用点（ui/scoreboard.ts 的 report、ui/multiplayer.ts 的 sitOut）早就都带
  // 了（scoreboard 那头连「还不知道是第几局」都先攒着、不发），剩下会不带的只有手搓的请求，
  // 而那条后路恰好绕得过这道闸。屋里还没开过局（meta.round 为 0）的时候也没有哪一局可记。
  // 这一种什么都不写——不是「替他猜一个 0 分交卷」，那是下面「对不上」那一支的事。
  const saidRound = Math.floor(Number(body.round));
  const roundNow = Number(hash.meta && hash.meta.round) || 0;
  if (!(Number.isFinite(saidRound) && saidRound > 0) || roundNow <= 0) {
    return send(res, 200, { ...publicState(code, hash), scoreDropped: true });
  }
  if (saidRound !== roundNow) {
    // 他手上那一局已经不是这一局了。两件事一起做：
    //
    // 一、**别让全屋等他**。roundOver 等的是「每个还在的人都交卷了」，而他还
    //    在轮询（lastSeen 一直新鲜），所以那条「九十秒没消息就不等」的路永远
    //    走不到——全屋会一直卡着，直到有人受不了解散重开。他在这一局里本来
    //    就一分没打，和「开局之后才进来的人」是同一种情况（那种 join 里直接
    //    标 finished），所以这儿照样标上：不等他，这一局按 0 分算。
    //    自我纠正的：他下一次轮询就拿到新局次，报上来的 round 对得上，真实
    //    分数照常盖回去（这一段窗口落在开局倒数那几秒里，roundOver 那时本来
    //    就因为 startAt 还没到而为假）。
    const run = hash[roundKey(body.playerId)];
    if (!run || !run.finished) {
      await hset(roomKey(code), roundKey(body.playerId), { ...CLEAR_ROUND, finished: true });
    }
    // 二、**丢掉了要说一声**。从前这儿静默回 200，客户端看着和成功报到一模
    //    一样，会拿同一个对不上的局次一直报下去，而他那边每一次都收到「成
    //    功」。回包里本来就带着服务器现在的局次（客户端据此对表，见
    //    ui/scoreboard.ts），再明说一句，省得两边靠推断。
    return send(res, 200, { ...publicState(code, await readRoom(code)), scoreDropped: true });
  }

  // 这一局**正在收尾**：屋主刚按了《再来》或《解散小屋》，锁已经立在那儿，
  // 记账循环正在跑。
  //
  // 这一句是那条「分数悄悄消失」的最后一道门。上面那道（局次对不对）挡不住
  // 它：记账跑完之前 meta.round 还是旧的，这条报分看上去完全合法，于是写进
  // `r:`——而记账那边多半刚读过这一格、下一步就要把它清掉。写了等于没写，
  // 玩家那端还收到一个「成功」。四个人打了一晚上，屋主看着「都交了」按下
  // 《解散小屋》，那张发出去的战绩卡上就少了一个人的最后一局。
  //
  // 收尾中就当场回「这一条没收下」，和局次对不上那条走同一个出口
  // （scoreDropped，客户端认得，见 ui/scoreboard.ts）。剩下的两种情形都是好
  // 的：赶在立锁之前到的，被 start/end 抢到锁之后那次重读接住；立锁之后到
  // 的，这儿明说没收下。**没有第三种「回了成功、分却没了」。**
  //
  // 读的是本函数开头那次 readRoom 拿回来的同一份 hash，不多跑一趟库——锁和
  // 座位本来就在同一个 hash 里。窗口用 LOCK_STALE_MS（全站只有这一个数）：
  // 记账真跑那么久的话，那把锁也该被下一条认定为废锁接手了。
  if (lockHeld(hash, startLockKey((hash.meta.round || 0) + 1)) || lockHeld(hash, END_LOCK)) {
    return send(res, 200, { ...publicState(code, hash), scoreDropped: true });
  }

  // **这一局他已经交过最终成绩了**（`final`）——之后来的什么都盖不得，带不带 `finished` 都一样。
  //
  // 从前这儿只挡「没带 finished」的那种（下面那一大段说的后发先至），带着 finished 的照写，
  // 理由是「拆计分板的时候还会补一条」。可那一条报的是**钉死的那个数**（ui/scoreboard.ts 的
  // settleOnce：结算页的 dataset.total 只读一次），和交卷那一条一模一样，挡掉它什么都不少；
  // 而照写的那条路同时也让「交完卷再发一个带 finished 的包」能把已交的卷改成任意一个数——在
  // 竞赛屋里，那就是看完别人的分再改自己的（2026-10-08 方案 1-1）。所以收紧成：final 之后一律
  // 回 scoreDropped。
  //
  // 「替他猜的」那两种不受影响：局次对不上、开局之后才进来，写的都是 finished、**不写
  // final**（CLEAR_ROUND 里 final 是 false），他自己报上来的真实分数照常盖回去（门是
  // check-room-score 的 ④）。
  // 客户端一局里报很多次：打的过程中每 LOCAL_MS 一条（分数变了就发，没变也按
  // 心跳发，见 ui/scoreboard.ts），走完那一下报一条带 `finished` 的，拆计分板
  // 的时候再补一条。**它们是 `void` 发出去的，谁都没等谁**——网路上后发先至是
  // 常事。于是：交卷那一条先落地，半秒前那条「还在打、430 分」后落地，整格被
  // 盖回「没交卷、430 分」。屏幕上两件事一起错：他那个勾没了，分数退了一截；
  // 而 `roundOver` 等的是「每个还在的人都交卷了」——他人早就关了页面，屋里其
  // 他人就得干等满 ABSENT_MS（90 秒）才轮到下一局。
  //
  // 为什么要新开一位，不直接问 `finished`：`finished` 这一位有两个来路，一个是
  // 「他真的交卷了」，另一个是上面那条「局次对不上，就当他这一局 0 分交了」
  // ——后者是**替他猜的**，而且注释里写明「真实分数照常盖回去」。拿 `finished`
  // 当门，那条自我纠正的路当场就断了。`final` 只由带 `finished` 的那次报分写
  // 下，意思窄得多：**这是他自己说的最后一个数。**
  const prev = hash[roundKey(body.playerId)];
  if (prev && prev.final) {
    return send(res, 200, { ...publicState(code, hash), scoreDropped: true });
  }

  // **只写这一局那一格**（见 readRoom 上面那段）：座位一个字不动、心跳一个
  // 字不动。从前这儿的注释写的是「只写这个玩家自己那一格，四个人同时报分盖
  // 不掉彼此」——那句话对的是**跨玩家**，同一个人的五条写入路径（score /
  // state / bye / leave / learn）它一条都挡不住：拿函数入口那份旧快照整份写
  // 回去，中间落地的那一次就被抹掉了，玩家看到的就是「分数对不上」。
  const run = { ...CLEAR_ROUND };
  /**
   * **分数是客户端报上来的，服务器只收拾格式，不核实真伪。** 记在这儿，不是
   * 忘了：2026-09 盘点过，明知留着。
   *
   * 下面这两行只做三件事：负数归零、取整、非数字当 0；用时也只要求是个正数。
   * 所以一个会开开发者工具的人，能把自己这一局报成任意大的分、或者 0.01 秒，
   * 散场那张战绩卡上「单局最高 / 单局最快」就归他。
   *
   * 为什么还没修：
   *   · 从前这儿写的是「伤害面只到这一间私人小屋：坑得到的只有他自己叫来的朋友」。**这句
   *     话已经不成立了**：竞赛屋 21 把椅子、4 位房号、进屋不要账号（见 seatsFor 和 join），
   *     一张发出去的竞赛排名卡可以被一个陌生人报的假分顶掉第一名。2026-10-08 先堵了两个最便
   *     宜的洞（交完卷还能改分、不带局次的包也收，见上面那两段）；「理论上限」照下面那条路
   *     留作第二步，这一批不做。
   *   · （**全站排行榜不从这条路进**，它走 scores.js。不过说句实话：那边严的
   *     是「你是谁」——要账号、要令牌，报上去的分只挂在他自己名下、还按 runId
   *     去重、封顶 MAX_SCORE；至于「这个分是不是真打出来的」，那边同样没验。
   *     两处是同一件事的两个面，哪天要做真验证，得一起做。）
   *   · 真要验，只有两条路：把每一步都传上来在服务器重放一遍（工程量远超这
   *     个功能本身），或者给每个玩法定一个「理论上限」再卡（要先把八副棋盘的
   *     上限都算准，算错就是把正常高分误判成作弊——那比作弊更伤人）。
   *
   * 什么时候该回来做：朋友之间真的吵起来「你这分是假的」，或者小屋哪天不再
   * 只是熟人之间玩。那时候先做「理论上限」那一档，别一上来就重放。
   */
  run.score = Math.max(0, Math.floor(Number(body.score) || 0));
  run.finished = Boolean(body.finished);
  if (run.finished) run.final = true;
  // Only read off the HUD once the run is over, so 单局最快 is a finishing
  // time rather than however far into the board someone happened to be.
  //
  // 这个数有一把**真的尺子**，但只在开赛之后才量得出来：这一局是服务器自己盖的
  // 时刻开的（`startAt`），所以开赛之后报上来的「打完用了多久」，不可能比「这一
  // 局已经开了多久」还长。两头比的都是服务器的钟，玩家那台设备的钟准不准一点不
  // 相干（客户端倒数走的是 clockOffset，见 engine/room.ts）；多给
  // SECONDS_SLACK_S 是留给网路那一跳和两边各自的取整。
  //
  // **倒数还没走完的时候不量。** 那会儿「用了多久」压根不存在：这一局一步都还没
  // 走。倒数里真会来的那种「交卷」是客户端的 sitOut（开局之后才进来的人、竞赛屋
  // 的主持人），它本来就不带 seconds。拿一把量不出东西的尺子去裁，裁掉的只会是
  // 别的东西——所以这儿宁可不量，别装作量得出来。
  //
  // **量不过只丢这一个数，分照记。** 这两样是分开的：分数是这一局的成绩，用时
  // 只多喂一个「单局最快」。为了一个说不通的秒数把整份报分退回去，等于拿他这
  // 一局的分去赌我这把尺子没写错——而尺子写错过（check-coach-aim 那次阈值定在
  // 坏值下面，门绿着却什么都没守住）。宁可那张卡上少一行「最快」。
  //
  // 下限只有「大于 0」，而它拦不住「我这局 1 秒打完」：那需要知道每副棋盘最快
  // 能多快，而算错就是把正常成绩判成作弊。和上面那段「为什么不修」是同一个结
  // 论，别在注释里把这件事说得比它实际做到的更严。
  const took = Math.round(Number(body.seconds));
  const startAt = Number(hash.meta.startAt) || 0;
  const now = Date.now();
  const ranFor = startAt && now > startAt ? (now - startAt) / 1000 + SECONDS_SLACK_S : 0;
  if (run.finished && Number.isFinite(took) && took > 0 && (!ranFor || took <= ranFor)) {
    run.seconds = took;
  }
  await hset(roomKey(code), roundKey(body.playerId), run);
  const shown = { ...seat, ...run, finished: run.finished || Boolean(seat.left) };
  return send(res, 200, publicState(code, { ...hash, ['p:' + body.playerId]: shown }));
}

/**
 * 抢不到散场那把锁的那一条，回什么。
 *
 * 不能像 start() 那样「回一份当前状态就完事」。两条路对回包的用法完全不同：
 *
 *   · start() 的回包没有谁在读——所有人拼棋盘的种子、局次、开赛时刻，全是从每
 *     秒一次的轮询里拿的（ui/multiplayer.ts 的 beginCountdown）。
 *   · end() 的回包**就是那张小屋战绩卡**：ui/multiplayer.ts 第 294 行
 *     `const card = closed.ok && closed.value.round ? closed.value : null`，而且
 *     紧接着就 forgetRoom() 把轮询停掉了——没有第二次机会。
 *
 * 所以这一条要是回一份「记了一半」的状态，屋主手上那张要发给朋友看的卡就是残
 * 的。**丢的不是总分**——这一点差点写反：卡上的总分是 liveTotal = total + score
 * （ui/roomCard.ts 第 56 行），而记账干的事就是把 score 挪进 total，这个和记不
 * 记账都一样。丢的是只在 bankRound 里才被写、而卡上正在用的那两样：
 *
 *   · best —— 「单局最高 · 某某 N」那一行（roomCard.ts 第 164 行），也是排名的
 *     第二档（第 67 行，总分并列时比它）；
 *   · bestTime —— 「单局最快」那一行（第 165 行）。
 *
 * 撤掉这个函数实测过（check-room-races.mjs 的 ⑧乙）：回包里屋主 best=0、
 * bestTime=null，那两行在卡上就是空的或者写了错的人。那是把翻倍换成另一种错，
 * 不算修好。
 *
 * 等就是了：赢的那条把 endedAt 写在**整段记账的最后**，所以 endedAt 一出现，账
 * 就一定记齐了。三秒的预算是照记账的最坏情况给的（见 LOCK_STALE_MS 上面那段：
 * 20 座约 43 次 Redis 往返，最多八九秒；但真到八九秒那一条早该被平台掐了）。
 * 常见情形是一两百毫秒就等到。等不到就说明赢的那条自己也半路死了——那时回当前
 * 状态是唯一诚实的答案，而且锁已经变成废锁，下一次 end 会按 takeRoomLock 那套
 * 接手，把账记完。
 */
async function settled(code) {
  for (let i = 0; i < 30; i++) {
    const hash = await readRoom(code);
    if (!hash) break;
    if (hash.meta.endedAt) return publicState(code, hash);
    await new Promise((r) => setTimeout(r, 100));
  }
  const hash = await readRoom(code);
  return hash ? publicState(code, hash) : { error: 'noRoom' };
}

/**
 * 结束房间. The room is marked closed rather than deleted: everyone else is
 * still polling, and the closing card - who won the evening - is the last
 * thing any of them will see. Deleting it here would replace that with a
 * 「房间不存在」 for every player but the host.
 *
 * The final round is banked on the way out, so the card counts the board
 * they have only just finished.
 */
async function end(res, body) {
  const code = String(body.code ?? '').trim();
  let hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  if (hash.meta.host !== body.playerId || !seatOf(hash, body.playerId, body.playerToken)) {
    return send(res, 403, { error: 'notHost' });
  }
  if (hash.meta.endedAt) return send(res, 200, publicState(code, hash));
  // 上面那一句只是「看一眼」，两条 end 都过得去（见 END_LOCK 上面那段：实测
  // 屋主的总分从 100 变 200）。真正只许一条进来的是这一句。
  if (!(await takeRoomLock(code, END_LOCK))) return send(res, 200, await settled(code));

  // 和 start() 那一处一模一样的理由（见那段注释）：抢锁要跑一趟库，这中间落
  // 地的那次报分不在上面那份快照里。这一条更要命——散场没有「下一局」可以把
  // 分捡回来，那张发出去的小屋战绩卡上，那个人这一局直接是 0。
  // 门是 check-room-races 的 ⑪。
  const fresh = await readRoom(code);
  if (!fresh) return send(res, 404, { error: 'noRoom' });
  hash = fresh;

  /*
   * **屋主开下一局的那条路正在记账，这儿就别再记一遍。**
   *
   * 两条路记的是同一局，而记账是「读一份累计账、加上这一局、写回去」——同时跑就是加两
   * 遍（屋主的总分从 100 变 200，END_LOCK 那段注释里记的就是这件事的另一半）。
   *
   * end 不能像 start 那样「让开就不办了」：屋主按的是《解散小屋》，那一按必须有结果。
   * 所以这儿让的只是**记账**那一段——start 已经把这一局并进累计账了，再并一次就是重
   * 复；下面写 `endedAt`、回战绩卡照常走。
   */
  const startBanking = lockHeld(hash, startLockKey((Number(hash.meta.round) || 0) + 1));

  const banked = {};
  for (const [field, seat] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !seat) continue;
    // 竞赛屋的主持人不参赛：账上不该有他，那张要发出去的竞赛排名图上也不该有
    // （理由和 start() 那一处一模一样，见那段注释和 isSpectator）。
    // **不写 `p:`**：那一格有六条路在写，整份写回去会把刚落地的改名、看教学抹掉
    // （见 totalKey 那段）。
    if (isSpectator(hash.meta, field.slice(2))) {
      banked[field] = { ...seat, ...CLEAR_ROUND };
      await hset(roomKey(code), roundKey(field.slice(2)), { ...CLEAR_ROUND });
      continue;
    }
    // 只给真的打完了这一局的人记账：交了卷的，和已经走了的（leave 标成
    // finished）。正打到一半的人，这一局在小屋里不算数——他手上那盘棋原地转
    // 成单人接着打（ui/scoreboard.ts 的 goSolo），分归他自己。从前是不管打没
    // 打完，一律把此刻棋盘上的分当「最终成绩」记进战绩图，被腰斩的分谁都不认。
    const live = await liveSeat(code, field, seat);
    const done = Boolean(live.finished) || Boolean(live.left);
    if (!done) {
      banked[field] = { ...live, ...CLEAR_ROUND };
      await hset(roomKey(code), roundKey(field.slice(2)), { ...CLEAR_ROUND });
      continue;
    }
    // start 那条路正在记同一局：这儿只收尾，不再并一次账（见上面 startBanking）。
    const totals = startBanking
      ? {}
      : bankTotals(live, hash.meta.round, hash.meta.startAt || 0);
    if (!startBanking) await hset(roomKey(code), totalKey(field.slice(2)), totals);
    const next = { ...live, ...CLEAR_ROUND, ...totals };
    // score 不写回去——bankRound 已经把这一局并进 total 了。
    //
    // 从前这儿有一行 `next.score = seat.score`，本意是「最后这一局是这张卡要
    // 讲的事，留着别清零」。可屏幕上每一处总分算的都是 total + score（见
    // ui/roomCard.ts 的 liveTotal、multiplayer.ts 的排行、roomNotices.ts），于
    // 是最后一局被加了两遍：三个人实打 300 分，那张要发出去的小屋战绩图上写
    // 的是 500。开下一局那条路（next）不写回，所以只有「解散」这一条路上错。
    //
    // 留着也没有意义：没有任何一处单独读这一局的分，它只是 total 的加数。
    next.finished = true;
    next.seconds = live.seconds ?? null;
    banked[field] = next;
    // `p:` 不写（见 totalKey 那段）：这张卡要讲的两样（finished / seconds）都在下面那
    // 句 `r:` 里，而 readRoom 会把 `r:` 折回座位上。
    // 这一局那一格要跟着对齐（见 readRoom 上面那段：它会把 r: 折回座位上）。
    //
    // 这一句差点又把上面那个 bug 放回来。座位里 score 清成了 0，可 r: 那一格还
    // 留着这一局的 N 分；屋主手上这张卡是 end 的回包，banked 盖过了库里那份，
    // 看着没事——而屋里其他人照旧在轮询，他们那一份是从库里**重读**的，readRoom
    // 把 N 折回座位，屏幕上的 total + score 就成了 (old + N) + N。实测三个人各
    // 100/200 分，重读一次变 200/400。
    //
    // 清成和座位一模一样的三样，而不是一律归零：seconds 要留（这张卡上那一行
    // 「用时」读的就是它），finished 留 true。两份副本说同一句话，折不折都一样。
    await hset(roomKey(code), roundKey(field.slice(2)), {
      score: 0,
      finished: true,
      seconds: next.seconds ?? null,
    });
  }
  const meta = { ...hash.meta, endedAt: Date.now() };
  await hset(roomKey(code), 'meta', meta);
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, publicState(code, { ...hash, ...banked, meta }));
}

async function leave(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 200, { ok: true });
  const seat = seatOf(hash, body.playerId, body.playerToken);
  if (seat) {
    // 走的人不从名单里删掉，只是标一下走了。
    //
    // 原先这里是 hdel：座位一删，这个人连同他打出来的分数就从所有人的屏幕上
    // 消失了，最后那张竞赛排名图上也没有他——三个人打了一晚上，图上只剩两个。
    // 「他中途走了」是这场比赛的一部分，不是一件要抹掉的事。
    //
    // 「走了的人也算交了卷」还是要成立——roundOver 等的是「每个还在的人都交
    // 卷了」，一个永远不会再报到的座位会把整局吊在那里——只是这件事不再由这
    // 里写进座位，改由 readRoom 按 left 推导出来。理由是少一处写入就少一个能
    // 和报分抢的地方：从前这儿拿函数一进来的旧快照整份写回去，中间刚落地的那
    // 次报分就被抹掉了，而他离开时正打着的那一局本该照记（bankRound 那段注释里
    // 写着：挡的是「走之后才开的那些局」，不是「走了的人」），
    // 竞赛排名图上于是是 0 分。现在这里只写 left 一件事。
    //
    // 写之前仍然重读一次：同一份座位还有《看教学》那条路在写（learningAt /
    // seen）。那两条撞上的概率很低——看教学是开局前主动点的——而彻底堵死要
    // 一把座位级的锁；《离开》是一次性动作，重试代价极低，不值得为它上锁。
    // 这是这一处的天花板，不是没想到。
    // 这一处**故意**是裸 hgetall，不要「顺手」改成 readRoom：下一行就要把读到
    // 的那份座位原样写回 p:，而 readRoom 会把 h:/r: 折进座位里——折好的东西写
    // 回 p:，就等于亲手造出 readRoom 注释里说的那份「死数据影子」。读 p: 是为
    // 了写 p:，就只能读 p: 本身。（learn 里的 beforeLearn 同理。）
    const nowHash = await hgetall(roomKey(code));
    const latest = nowHash?.['p:' + body.playerId] || seat;
    await hset(roomKey(code), 'p:' + body.playerId, { ...latest, left: Date.now() });
    // 椅子交回去，后面的人才坐得进来（座位是按 s:i 原子占的，见 claimSlot）。
    if (seat.slot !== undefined) await hdel(roomKey(code), 's:' + seat.slot);
    // 走的正是大家在等的那个学生：不等了，大家继续。
    if (seatLearning(seat)) {
      const fresh = await hgetall(roomKey(code));
      if (fresh?.meta?.learnHold && !anyoneLearning(fresh)) await releaseHold(code, fresh.meta);
    }
  }
  return send(res, 200, { ok: true });
}

/**
 * 有人说自己不会这个玩法的规则，去看教学了；看完了再说一声。
 *
 * 记的是时刻不是布尔值，因为看教学的那台设备整页被教学占着，不再轮询——
 * 一个「正在学」的布尔值要是没人来清（关掉网页、切走再也不回来），整间小屋
 * 就永远开不了局。存时刻，超过 LEARN_MAX_MS 就当他不学了：这比心跳简单，
 * 而且断在哪一步都收得回来。
 */
async function learn(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  const seat = seatOf(hash, body.playerId, body.playerToken);
  if (!seat) return send(res, 403, { error: 'seat' });
  const learning = Boolean(body.learning);
  // 看完教学的人顺手把「看过了」带来——下一局就不用再为他多留四秒。
  const seen = Array.isArray(body.seen) ? cleanSeen(body.seen) : null;
  // learningAt 和 seen 是座位自己的属性，留在座位里；心跳走自己那一格。
  // 和 score / leave 一样，写之前重读一次——这中间可能刚落地一次报分。
  // 同 leave 里的 nowHash：读到的这份马上要写回 p:，所以必须是裸的那一份，
  // 不能用 readRoom（折好的写回去就是影子）。
  const beforeLearn = await hgetall(roomKey(code));
  await hset(roomKey(code), 'p:' + body.playerId, {
    ...(beforeLearn?.['p:' + body.playerId] || seat),
    learningAt: learning ? Date.now() : 0,
    ...(seen ? { seen } : {}),
  });
  await hset(roomKey(code), beatKey(body.playerId), { lastSeen: Date.now(), byeAt: 0 });
  let fresh = await freshRoom(code);
  const meta = fresh.meta || {};
  if (learning) {
    // 这一局第一次有人去学：把开赛挂起。同一局只挂一次——被放行之后（学完、
    // 走了、二十秒没动静）再来的「我在学」不再把大家拦住：他们已经在打了。
    /*
     * **只在开赛之前挂得起来。**
     *
     * 从前只问「这一局挂过没有」，于是开局之后再点开教学的人照样能挂住整屋：
     * `releaseHold` 把 `startAt` 重新盖成「从现在起再数 4 秒」，而大家**已经在打了**
     * ——屏幕上那一局好端端地进行着，服务器却把这一局的开赛时刻挪到了未来。下一次
     * 轮询读到的 `startAt` 在未来，客户端于是把还在打的人退回倒数屏。
     *
     * 教学本来就是开局前那一问（ASK_MS 那四秒）里的事；局中点开它的人是来复习的，
     * 不该停住别人。
     */
    if (meta.round && meta.heldRound !== meta.round && Date.now() < (Number(meta.startAt) || 0)) {
      // 走 patchMeta，不自己 hset：原先这一处拿进函数时读到的**整份** meta 写回去，
      // 中间只要 end() 写进了 endedAt、或者 start() 换了 round，这一写就把它们整个
      // 抹掉。玩家看到的是：屋主明明按了《解散小屋》，还在等的人却看到「等屋主开下
      // 一局」，要干等到 90 秒外的「房间被取消」，而不是当场那张该出现的战绩卡。
      //
      // patchMeta 那三道保险（抢锁、start/end 正在办事就不写、重读之后只往最新那份
      // 上盖）这一边全部原样继承。锁用的是自己那一格（holdSetLockKey）——和放行共用
      // 一把会把倒数锁死，见那个常量的说明。
      // heldRound 取**重读之后那一份**的 round（patch 收到的就是它），不取进函数时
      // 读到的那个。两者此刻一定相等（patchMeta 第三道保险就是「局次对不上直接回
      // 头」），写成 live.round 只是让这一行不必依赖那个前提。
      await patchMeta(code, meta.round, holdSetLockKey(meta.round), (live) => ({
        learnHold: true,
        heldRound: live.round,
        /** 这一次挂起是什么时候开始的——挂满 LEARN_MAX_MS 就放行，见 holdExpired。 */
        heldAt: Date.now(),
      }));
      fresh = await freshRoom(code);
    }
  } else if (meta.learnHold && !anyoneLearning(fresh)) {
    // 最后一个学完的人：把开赛时刻重新盖一遍，全屋一起从 4 数起。等的人看的
    // 是「还有谁在学」，学完这一刻他们的倒数才开始走。
    await releaseHold(code, meta);
    fresh = await freshRoom(code);
  }
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, { ok: true, state: publicState(code, fresh) });
}

/**
 * 局中改了昵称（第 16 推第 6 条）。
 *
 * 客户端在改名接口（api/scores.js 的 rename）成功之后、而且这台设备正坐在一间屋里时发一次
 * （src/engine/nickname.ts 的 setNickname）。屋里那个座位名换成**帐号此刻登记的昵称**——从
 * 服务器读，不收请求里报的名字：座位名必须就是那个帐号的昵称，不能借这条路给自己的座位起
 * 一个别的名字（那样就绕过了词表和唯一性）。
 *
 * 屋里已经有人（活着的座位）叫这个名字，**改名的人加「 2」**，不动别人（玩家定的：「局中某
 * 人把昵称改成屋里未登录玩家正在用的名字时，这一屋里由改名的人显示 2」）。那个人先坐下的，
 * 他一直叫这个名字，屋里一句话没说就被改成「阿花 2」是意料之外的界面。
 *
 * 要两样凭证：座位（playerId + playerToken，证明这把椅子是你的）和帐号令牌（证明这个昵称是
 * 你的）。缺哪一样都不改。
 */
async function renameSeat(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  const seat = seatOf(hash, body.playerId, body.playerToken);
  if (!seat) return send(res, 403, { error: 'seat' });
  const who = body.accountToken
    ? await identify({ email: body.email, accountToken: body.accountToken, holderCode: body.holderCode })
    : null;
  if (!who) return send(res, 401, { error: 'auth' });
  const nick = await nicknameOf(who.id);
  // 没登记昵称（不该发生：客户端是改名成功之后才来的），或者座位上本来就是它：什么都不动。
  if (!nick || String(seat.name ?? '').trim() === nick) {
    return send(res, 200, { ok: true, state: publicState(code, await freshRoom(code)) });
  }
  // 屋里别人正用着的名字（快照）。自己现在那个不算——改回大小写不同的同一个名字不该变成「 2」。
  const before = await hgetall(roomKey(code));
  const taken = namesTaken(before || hash);
  taken.delete(String(seat.name ?? '').trim().toLowerCase());
  const name = await claimTag(code, 'n:', body.playerId, nameCandidates(nick), taken, { mine: true });
  // 和 learn / score 一样：写之前重读一次座位那一格，只换 name 这一位。
  const live = await hgetall(roomKey(code));
  await hset(roomKey(code), 'p:' + body.playerId, { ...(live?.['p:' + body.playerId] || seat), name });
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, { ok: true, state: publicState(code, await freshRoom(code)) });
}

/**
 * 催屋主。
 *
 * 客人按一下，房间的计数加一；屋主那边轮询到数字变大，就往标题框里掉几个
 * 图形（见 src/ui/titleRain.ts）。只存一个数，不存谁按的——要的是「有人在
 * 催了」这件事本身，按了几下就掉几个，多按就多掉。
 */
async function nudge(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  if (!seatOf(hash, body.playerId, body.playerToken)) return send(res, 403, { error: 'seat' });
  // 计数是一步做完的（HINCRBY）。催促这颗键按下去不等回包（见 engine/room.ts
  // 的 nudgeHost：「催是一件可以连着按的事」），所以一个手快的人打出来的就是
  // 一串真正同时在飞的请求——「读一份、加一、写回去」会让那一串只算成一下。
  const nudges = Math.min(await hincrby(roomKey(code), NUDGE_COUNT, 1), 9_000_000);
  // 顺手记下这一下是什么时刻（只留最近四十下）：屋主那边按这些时刻之间的
  // 间隔一颗一颗掉，按得多快掉得多快，而不是一秒一批。
  //
  // 时刻这一份是一人一格的读-改-写：同一个人同一瞬间按下的两下里丢掉一个时
  // 刻，屏幕上看不出来（那两颗本来就是同时掉的），而**数目**一下都不会少。
  const field = nudgeField(body.playerId);
  const mine = hash[field] || {};
  const at = [...(Array.isArray(mine.at) ? mine.at : []), Date.now()].slice(-40);
  await hset(roomKey(code), field, { at });
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, { ok: true, nudges });
}
