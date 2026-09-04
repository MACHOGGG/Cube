import { randomBytes, randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { isGenius as isGeniusClaim } from './_entitlement.js';
import { expire, hdel, hgetall, hset, hsetnx, storeConfigured } from './_store.js';

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
 * Two numbers, not one, because they answer different questions.
 *
 * ROOM_CAPACITY is what the machinery can carry: a room is a Redis hash with
 * one field per player and every write touches only that player's own field,
 * so nothing here gets harder as the table grows — twelve is simply the size
 * the standings panel, the closing card and a four-digit room code space all
 * still read well at.
 *
 * MAX_PLAYERS is what is open today. Raising it is one number, and nothing
 * else has to move.
 */
const ROOM_CAPACITY = 12;
/** How many seats are open to players today. Raise this, not the line above. */
const OPEN_SEATS = 8;
const MAX_PLAYERS = Math.min(OPEN_SEATS, ROOM_CAPACITY);
const MIN_PLAYERS = 2;
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
const seatAway = (seat, meta) =>
  Date.now() - Math.max(seat.lastSeen || 0, seat.joinedAt || 0, meta.startAt || 0) > AWAY_MS;
/**
 * 太久没听见他了（ABSENT_MS）：这一局不再等他（roundOver 也是这个数）；他要
 * 是屋主，屋里其他人看到的就是「屋主离家出走了，小屋暂时解散」。走了的
 * （left）和关了网页的（closed）各有各的标记，不算在这儿。
 */
const seatGone = (seat, meta) =>
  !seat.left &&
  seat.lastSeen !== 0 &&
  Date.now() - Math.max(seat.lastSeen || 0, seat.joinedAt || 0, meta.startAt || 0) > ABSENT_MS;

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

/** Everything the room looks like - minus every player's private token. */
function publicState(code, hash) {
  const meta = hash.meta || {};
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
  const running = (p) => (p.total || 0) + (p.score || 0);
  players.sort((a, b) => running(b) - running(a) || String(a.name).localeCompare(String(b.name)));
  return {
    code,
    host: meta.host ?? null,
    mode: meta.mode ?? null,
    slot: meta.slot ?? null,
    /** 这一局是无限反转（60 秒、得分翻面来回翻）。 */
    flip: Boolean(meta.flip),
    seed: meta.seed ?? null,
    startAt: meta.startAt ?? null,
    /** 0 before the first match; every 开始 raises it by one. */
    round: meta.round || 0,
    /** Everyone is done: the host may pick the next board, or close up. */
    roundOver: roundOver(hash),
    /** The host has closed the room. What is left is the closing card. */
    ended: Boolean(meta.endedAt),
    /** Seats open today, so what the app says about a full room is one
     *  number rather than the word "four" written into four languages. */
    seats: MAX_PLAYERS,
    players,
    /** 被催了多少下。屋主那边看它变大就往标题里掉图形。 */
    nudges: meta.nudges || 0,
    /** 最近几十下催促各是什么时刻——屋主按这个节奏一颗一颗掉。 */
    nudgeAt: Array.isArray(meta.nudgeAt) ? meta.nudgeAt : [],
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
    // Walked in after this round began: they were never in it, so they
    // cannot be what it is waiting on.
    if ((seat.joinedAt || 0) > meta.startAt) return true;
    if (seat.finished) return true;
    // Counting from the start of the round, not from this seat's last report:
    // at the moment a round begins nobody has reported yet, and reading that
    // as "absent" would declare the round over before it had been played.
    const seen = Math.max(seat.lastSeen || 0, meta.startAt);
    return Date.now() - seen > ABSENT_MS;
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
 */
async function claimSlot(code, playerId) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (await hsetnx(roomKey(code), 's:' + i, playerId)) return i;
  }
  return -1;
}

// ---- the six things a room can be asked ---------------------------------

async function create(res, body) {
  if (!(await hostMayOpen(body))) return send(res, 403, { error: 'geniusOnly' });

  const playerId = id(8);
  const token = id(16);
  const meta = {
    host: playerId, createdAt: Date.now(),
    mode: null, seed: null, startAt: null,
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
      name: cleanName(body.name) || 'Host',
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
  const name = cleanName(body.name) || 'Player';
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
      sameName(seat.name, name) &&
      seatReclaimable(seat),
  );
  if (back) {
    const [field, seat] = back;
    const token = id(16);
    // 按过《离开》的座位早把椅子交回去了（见 leave）：回来先重新占一把。
    let slot = seat.slot;
    if (seat.left || slot === undefined) {
      slot = await claimSlot(code, field.slice(2));
      if (slot < 0) return send(res, 409, { error: 'full', seats: MAX_PLAYERS });
    }
    const next = { ...seat, token, slot, lastSeen: Date.now(), learningAt: 0, seen: cleanSeen(body.seen) };
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
  const slot = await claimSlot(code, playerId);
  if (slot < 0) return send(res, 409, { error: 'full', seats: MAX_PLAYERS });
  await hset(roomKey(code), 'p:' + playerId, {
    token,
    name: uniqueName(name, hash),
    avatar: distinctAvatar(cleanAvatar(body.avatar), hash),
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
    const next = bankRound(seat, hash.meta.round, hash.meta.startAt || 0);
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
  // Nothing to bank: no round has been played, or this seat arrived after
  // the last one had begun and sat it out.
  if (!round || (seat.joinedAt || 0) > startAt) return next;
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
    // The round just played is what the card is about, so it stays readable
    // rather than being zeroed for a next round that will never come.
    next.score = Math.max(0, Math.floor(Number(seat.score) || 0));
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
  const meta = hash.meta || {};
  // 上限是防一个按住不放的人把数字撑到没边；掉落那头本来也会在拥挤时加快
  // 消失，所以这里只要保证数字本身不失控就够。
  const next = Math.min((meta.nudges || 0) + 1, 9_000_000);
  // 顺手记下这一下是什么时刻（只留最近四十下）：屋主那边按这些时刻之间的
  // 间隔一颗一颗掉，按得多快掉得多快，而不是一秒一批。
  const nudgeAt = [...(Array.isArray(meta.nudgeAt) ? meta.nudgeAt : []), Date.now()].slice(-40);
  await hset(roomKey(code), 'meta', { ...meta, nudges: next, nudgeAt });
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, { ok: true, nudges: next });
}
