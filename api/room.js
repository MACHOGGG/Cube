import { randomBytes, randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { isGenius as isGeniusClaim } from './_entitlement.js';
import { expire, hdel, hgetall, hincrby, hset, hsetnx, storeConfigured } from './_store.js';

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
 * CONTEST_SEATS 是竞赛小屋的——「竞赛版本开放到 20 人上限」。
 *
 * 要紧的是第三件事：**座位数是跟着屋子走的，不是跟着这个文件走的**。一间屋
 * 开出来的那一刻就把自己的座位数写进 meta.seats，往后满不满、名单上写
 * 「3/8」还是「3/20」，都问它自己那一个数（seatsFor）。所以以后调这儿的常
 * 数，不会把正开着的那些屋子从「3/8」变成「3/20」——玩家盯着的那个数在一
 * 局中间自己变了，正是「意料之外的界面」。meta 里没有 seats 的老屋（这次改
 * 动之前开的）按 OPEN_SEATS 算，和从前一模一样。
 */
const ROOM_CAPACITY = 20;
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
const CONTEST_SEATS = 20;
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
 */
const WIDE_MODES = new Set(['circleSeven', 'triangleAdvanced']);
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

/** The boards a host may choose. Anything else is not a mode we ship. */
const MODES = new Set([
  'square', 'circle', 'triangle',
  'squareDiamond', 'circleHex', 'circleSeven', 'triangleBig', 'triangleAdvanced',
]);
const AVATAR_SHAPES = new Set(['circle', 'triangle', 'square']);
/** 随机得分目标能开在哪几副棋盘上——就是三个基础玩法。 */
const SLOT_MODES = new Set(['square', 'circle', 'triangle']);
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
 *   ASK_MS           4 s   开局前「会不会规则」那一问留的时间（倒数多数这几秒）
 *   ROOM_TTL_S      20 min 小屋多久没人碰就过期
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
const anyoneLearning = (hash) =>
  Object.entries(hash).some(([k, v]) => k.startsWith('p:') && v && !v.left && seatLearning(v));

const roomKey = (code) => 'room:' + code;
const id = (bytes) => randomBytes(bytes).toString('hex');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
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

function distinctAvatar(wanted, hash) {
  const taken = new Set(
    Object.entries(hash || {})
      .filter(([field, value]) => field.startsWith('p:') && value?.avatar)
      .map(([, value]) => avatarKey(cleanAvatar(value.avatar))),
  );
  if (!taken.has(avatarKey(wanted))) return wanted;

  const shapes = [...AVATAR_SHAPES];
  for (const shape of shapes) {
    const tryIt = { shape, hue: wanted.hue };
    if (!taken.has(avatarKey(tryIt))) return tryIt;
  }
  // 三个形状都被占了，就沿着色环挪，一圈之内一定有空位——房间最多 12 个人，
  // 而形状乘上色相段有 27 个格子。
  const buckets = Math.round(360 / HUE_STEP);
  for (let step = 1; step <= buckets; step++) {
    for (const shape of shapes) {
      const tryIt = { shape, hue: (wanted.hue + step * HUE_STEP) % 360 };
      if (!taken.has(avatarKey(tryIt))) return tryIt;
    }
  }
  return wanted; // 挤不下了也不拦人进来，重一个图形总比进不来强。
}

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
       * 只有 bye 那条路会把 lastSeen 写成 0（见下面的注释），而 bye 只在
       * pagehide 且不进 bfcache 的时候发——切个应用、锁个屏都不算。所以这个
       * 布尔值说的是「终端关了」，和 away（听不见他，可能只是网差）是两件事：
       * 屋主终端关了，这间小屋就散了；屋主网差，大家等他。
       */
      closed: value.lastSeen === 0,
      /** 正在看这个玩法的教学——全屋等他学完再一起数 4-3-2-1。 */
      learning: seatLearning(value),
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
    /** 这一局是无限反转（60 秒、得分翻面来回翻）。 */
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
    .filter(([field, value]) => field.startsWith('p:') && value)
    .map(([, value]) => value);
  if (!seats.length) return false;
  return seats.every((seat) => {
    // 走掉的人不是这一局在等的人。leave 已经把他标成 finished 了，这一行
    // 是把意图写明白：名单上留着他，不代表整局要等他。
    if (seat.left) return true;
    // 网页已经关了，而且是他的浏览器自己说的（bye 把 lastSeen 抹成 0，见
    // publicState 的 closed）。
    //
    // 这一句原先没有，于是服务器明明已经知道「这个人走了」，却还是只认「九十
    // 秒没消息」那一条：屋里一个人中途直接关掉网页——很常见——其余所有人交
    // 完卷都要干等到第 90 秒才开得了下一局。已经收到的消息就该当消息用。
    if (seat.lastSeen === 0) return true;
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

const readRoom = async (code) => {
  const hash = await hgetall(roomKey(code));
  return hash && hash.meta ? hash : null;
};

/** Checks that this really is the player it claims to be. */
function seatOf(hash, playerId, token) {
  const seat = hash['p:' + playerId];
  return seat && seat.token && seat.token === token ? seat : null;
}

/** 还坐着的人。走掉的座位留在表里（见 leave），但它不占位子。 */
const seatCount = (hash) =>
  Object.entries(hash).filter(([k, v]) => k.startsWith('p:') && v && !v.left).length;

/** 同一个昵称——不分大小写，两头的空白不算。 */
const sameName = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * 这把椅子能不能让同名的人认领：只认按过《离开》（left）和网页真的关掉了
 * （bye 把 lastSeen 抹成 0）的座位。
 *
 * 只是一阵子没心跳（away）的不算。那个人多半只是锁了屏、接了个电话，座位、
 * 名字、分数都还是他的。从前这一条把 away 的座位也交给同名的人——而两个都
 * 没取名字的人在服务器眼里名字一模一样（都是占位那一句），于是先来的人接
 * 个电话回来，座位连同分数已经是后来那个人的了。正在看教学的也不算——那台
 * 设备整页被教学占着、不轮询，看着像没人，人其实在。
 */
const seatReclaimable = (seat) => (Boolean(seat.left) || seat.lastSeen === 0) && !seatLearning(seat);

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
    if (seat.lastSeen !== 0 || seatLearning(seat)) continue;
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
async function claimTag(code, prefix, playerId, candidates, taken) {
  let last = null;
  for (const c of candidates) {
    last = c.value;
    if (taken.has(c.key)) continue;
    if (await hsetnx(roomKey(code), prefix + c.key, playerId)) return c.value;
  }
  return last;
}

/** 没取名字的人发字母；取了名字的人重了就加编号。候选按老规矩排。 */
function nameCandidates(typed) {
  const trimmed = String(typed ?? '').trim();
  if (!trimmed) {
    return Array.from({ length: 26 }, (_, i) => {
      const letter = String.fromCharCode(65 + i);
      return { key: letter.toLowerCase(), value: letter };
    });
  }
  const list = [{ key: trimmed.toLowerCase(), value: trimmed }];
  for (let n = 2; n < 100; n++) {
    list.push({ key: `${trimmed} ${n}`.toLowerCase(), value: `${trimmed} ${n}` });
  }
  return list;
}

/** 头像候选：先本形状，再换形状，再沿色环挪。和 distinctAvatar 同一条路。 */
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
    await hset(roomKey(code), 's:0', playerId);
    await hset(roomKey(code), 'p:' + playerId, {
      token,
      // 空的名字发一个字母。这间屋刚开，谁都没坐，所以屋主拿到的是 A。
      name: cleanName(body.name) || freeLetter({}),
      avatar: cleanAvatar(body.avatar),
      score: 0,
      finished: false,
      joinedAt: Date.now(),
      slot: 0,
      seen: cleanSeen(body.seen),
    });
    await expire(roomKey(code), ROOM_TTL_S);
    return send(res, 200, {
      code,
      playerId,
      playerToken: token,
      state: publicState(code, await hgetall(roomKey(code))),
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
  const back = Object.entries(hash).find(
    ([field, seat]) =>
      field.startsWith('p:') &&
      seat &&
      field.slice(2) !== hash.meta.host &&
      sameName(seat.name, typed) &&
      seatReclaimable(seat),
  );
  // typed 是空的时候上面那个 find 一定落空（座位名字不会是空的），不必另写
  // 一句判断——留着这行注释是因为「空名字不认领」是有意的，不是漏了。
  if (back) {
    const [field, seat] = back;
    const token = id(16);
    // 按过《离开》的座位早把椅子交回去了（见 leave）：回来先重新占一把。
    let slot = seat.slot;
    if (seat.left || slot === undefined) {
      slot = await claimSeat(code, field.slice(2), hash);
      if (slot < 0) return send(res, 409, { error: 'full', seats: seatsFor(hash.meta) });
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
    await expire(roomKey(code), ROOM_TTL_S);
    return send(res, 200, {
      playerId: field.slice(2),
      playerToken: token,
      rejoined: true,
      state: publicState(code, await hgetall(roomKey(code))),
    });
  }

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
  const seatName = await claimTag(code, 'n:', playerId, nameCandidates(typed), namesTaken(fresh));
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
  });
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, {
    playerId,
    playerToken: token,
    rejoined: false,
    state: publicState(code, await hgetall(roomKey(code))),
  });
}

/**
 * 「有人在学」的挂起到此为止：开赛时刻重新盖一遍，大家一起从头数。
 * 学完了、走了、二十秒没动静，走到这儿的是同一件事。
 */
async function releaseHold(code, meta) {
  const released = {
    ...meta,
    learnHold: false,
    startAt: Date.now() + countdownMsFor(meta.mode),
    countFrom: countFromFor(meta.mode),
  };
  await hset(roomKey(code), 'meta', released);
  return released;
}

async function state(res, body) {
  const code = String(body.code ?? '').trim();
  let hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  // 学的人二十秒没动静了（或者早走了）：不再等他。轮询是唯一稳定会跑到这
  // 儿的路，所以这一步放在这里而不是等谁来「说一声」。
  if (hash.meta.learnHold && !anyoneLearning(hash)) {
    await releaseHold(code, hash.meta);
    hash = await hgetall(roomKey(code));
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
  if (seat && !seat.left && seat.slot === undefined) {
    const slot = await claimSeat(code, body.playerId, hash);
    if (slot >= 0) {
      await hset(roomKey(code), 'p:' + body.playerId, { ...seat, slot, lastSeen: Date.now() });
      return send(res, 200, publicState(code, await hgetall(roomKey(code))));
    }
  }
  if (seat && Date.now() - (seat.lastSeen || 0) > SEEN_WRITE_MS && !seat.left) {
    await hset(roomKey(code), 'p:' + body.playerId, { ...seat, lastSeen: Date.now() });
    return send(res, 200, publicState(code, await hgetall(roomKey(code))));
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
    await hset(roomKey(code), 'p:' + body.playerId, { ...seat, lastSeen: 0 });
  }
  return send(res, 200, { ok: true });
}

async function start(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
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
  if (seatCount(hash) < MIN_PLAYERS) return send(res, 409, { error: 'tooFew' });
  // 无限反转：只开在方块和小球上，60 秒，得分翻面来回翻——客户端按这个标记
  // 挂上那套规则；棋盘照旧从 seed 发，所以全屋仍是同一副牌。
  const flip = body.flip === true && FLIP_MODES.has(body.mode);
  // 随机得分目标只开在三个基础棋盘上。'same'：全屋从同一个种子里抽同一对
  // 图案；'own'：各自抽各自的。棋盘两种情况都一样——它照旧从 seed 发。
  // 无限反转那一局没有老虎机。
  const slot =
    !flip && SLOT_MODES.has(body.mode) && (body.slot === 'same' || body.slot === 'own') ? body.slot : null;

  // The round that just ended is banked before the next one wipes the board,
  // because the closing card is the sum of all of them and a score only
  // exists on the server between one round and the next.
  const banked = {};
  for (const [field, seat] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !seat) continue;
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
    const done = Boolean(seat.finished) || Boolean(seat.left);
    const next = done
      ? bankRound(seat, hash.meta.round, hash.meta.startAt || 0)
      : { ...seat, score: 0, finished: false, seconds: null };
    banked[field] = next;
    await hset(roomKey(code), field, next);
  }

  // 可能有新手：屋里有人没看过这一族的教学。那就多留四秒——那个人的设备会
  // 问他「会不会」，其他人的倒数从 8 数起（横屏玩法 9）。他答「会」什么都不
  // 变，大家一起数到 0；答「不会」走 learn 那条路，整屋等他。
  const family = familyOf(body.mode);
  const novice = Object.entries(hash).some(
    ([f, seat]) => f.startsWith('p:') && seat && !seat.left && !(seat.seen || []).includes(family),
  );
  const meta = {
    ...hash.meta,
    mode: body.mode,
    slot,
    flip,
    round: (hash.meta.round || 0) + 1,
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
 * 最快玩家 is the quickest single round anyone put together, not the sum of
 * their times: a player who sat out one board should not win it by having
 * spent less of the evening playing.
 */
function bankRound(seat, round, startAt = 0) {
  const next = { ...seat, score: 0, finished: false, seconds: null };
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

async function score(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  const seat = seatOf(hash, body.playerId, body.playerToken);
  if (!seat) return send(res, 403, { error: 'notInRoom' });

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
  const saidRound = Math.floor(Number(body.round));
  if (Number.isFinite(saidRound) && saidRound > 0 && hash.meta && hash.meta.round && saidRound !== hash.meta.round) {
    return send(res, 200, publicState(code, hash));
  }

  seat.score = Math.max(0, Math.floor(Number(body.score) || 0));
  seat.finished = Boolean(body.finished);
  // Only read off the HUD once the run is over, so 最快玩家 is a finishing
  // time rather than however far into the board someone happened to be.
  const took = Math.round(Number(body.seconds));
  if (seat.finished && Number.isFinite(took) && took > 0) seat.seconds = took;
  seat.lastSeen = Date.now();
  // Only this player's own field is written, so four reports arriving at
  // once cannot overwrite one another.
  await hset(roomKey(code), 'p:' + body.playerId, seat);
  return send(res, 200, publicState(code, { ...hash, ['p:' + body.playerId]: seat }));
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
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  if (hash.meta.host !== body.playerId || !seatOf(hash, body.playerId, body.playerToken)) {
    return send(res, 403, { error: 'notHost' });
  }
  if (hash.meta.endedAt) return send(res, 200, publicState(code, hash));

  const banked = {};
  for (const [field, seat] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !seat) continue;
    // 只给真的打完了这一局的人记账：交了卷的，和已经走了的（leave 标成
    // finished）。正打到一半的人，这一局在小屋里不算数——他手上那盘棋原地转
    // 成单人接着打（ui/scoreboard.ts 的 goSolo），分归他自己。从前是不管打没
    // 打完，一律把此刻棋盘上的分当「最终成绩」记进战绩图，被腰斩的分谁都不认。
    const done = Boolean(seat.finished) || Boolean(seat.left);
    if (!done) {
      const next = { ...seat, score: 0, finished: false, seconds: null };
      banked[field] = next;
      await hset(roomKey(code), field, next);
      continue;
    }
    const next = bankRound(seat, hash.meta.round, hash.meta.startAt || 0);
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
    next.seconds = seat.seconds ?? null;
    banked[field] = next;
    await hset(roomKey(code), field, next);
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
    // 标成 finished 是必须的：roundOver 等的是「每个还在的人都交卷了」，
    // 一个永远不会再报到的座位会把整局吊在那里。
    await hset(roomKey(code), 'p:' + body.playerId, {
      ...seat,
      left: Date.now(),
      finished: true,
    });
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
  await hset(roomKey(code), 'p:' + body.playerId, {
    ...seat,
    learningAt: learning ? Date.now() : 0,
    lastSeen: Date.now(),
    ...(seen ? { seen } : {}),
  });
  let fresh = await hgetall(roomKey(code));
  const meta = fresh.meta || {};
  if (learning) {
    // 这一局第一次有人去学：把开赛挂起。同一局只挂一次——被放行之后（学完、
    // 走了、二十秒没动静）再来的「我在学」不再把大家拦住：他们已经在打了。
    if (meta.round && meta.heldRound !== meta.round) {
      await hset(roomKey(code), 'meta', { ...meta, learnHold: true, heldRound: meta.round });
      fresh = await hgetall(roomKey(code));
    }
  } else if (meta.learnHold && !anyoneLearning(fresh)) {
    // 最后一个学完的人：把开赛时刻重新盖一遍，全屋一起从 4 数起。等的人看的
    // 是「还有谁在学」，学完这一刻他们的倒数才开始走。
    await releaseHold(code, meta);
    fresh = await hgetall(roomKey(code));
  }
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, { ok: true, state: publicState(code, fresh) });
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
