/**
 * 战绩存云端，以及两张全球排行榜。
 *
 * 三个动作，一个入口：
 *
 *   push   打完一局，把这一局挂到账号上；顺手更新两张榜。
 *   mine   我自己的存档——换台设备登录，记录跟着回来。
 *   board  排行榜。所有人都上榜，但只有天才看得见（见下面那段）。
 *   rebuild  管理员维护：照存档把所有榜重算一遍（可以顺手清掉某一种局），见文件末尾。
 *
 * ── 关于「谁上榜」和「谁看得见」 ──────────────────────────────
 *
 * 上榜不要钱：一个新玩家打出好成绩，那一行本来就该在榜上，否则这张榜记的
 * 不是「谁打得好」而是「谁付了钱」。看得见才是天才特权。门开在看的那一侧，
 * 榜本身是真的。
 *
 * ── 关于作弊 ────────────────────────────────────────────
 *
 * 分数是客户端报上来的，服务器没法复算——真要复算，就得把整副牌和每一步都
 * 传上来再跑一遍引擎，那是另一个量级的工程。所以这里只做两件诚实的事：
 *
 *   · 一个上限（MAX_SCORE）。它挡不住认真作弊的人，但挡得住「把 999999999
 *     填进去」这种一分钟就试得出来的玩法，也挡住了一个坏数字把整张榜的刻度
 *     毁掉——榜首是十亿分的时候，剩下所有人看起来都是零。
 *   · 一个已收过的清单（seen）。同一局报两次不会被算两次。
 *
 * 剩下的写在《服务条款》里：发现作弊或明显异常的数据，我们会清除相关记录。
 */
import { timingSafeEqual } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { identify, isGenius } from './_entitlement.js';
import { callerId, tooMany } from './_ratelimit.js';
import {
  del,
  get,
  hdel,
  hget,
  hgetall,
  hset,
  set,
  storeConfigured,
  withLock,
  zadd,
  zaddIfHigher,
  zcard,
  zrem,
  zrevrank,
  zscore,
  zTop,
} from './_store.js';

/**
 * 一局的综合得分上限。见文件头「关于作弊」。
 *
 * 原来是一百万：无限反转早先那版计分（同一步里 ×3 连锁、翻来翻去不停）真能
 * 打到七位数，超过的一律记成一百万，榜上就出现一排一模一样的数——玩家的原
 * 话：「过了上限以后都按照同一数字显示了」。现在放到十亿：正常怎么打都够不
 * 着，又仍然挡得住「把 999999999999 填进去」那种一眼假的数。
 */
const MAX_SCORE = 1_000_000_000;
/** 存档留多少局。够翻很久，又不至于让一个账号的文档大到读不动。 */
const KEEP_RUNS = 60;
/** 「这一局我收过了」记多少条。比 KEEP_RUNS 长一点，防的是重复提交。 */
const KEEP_SEEN = 120;
/** 一张榜一次给多少行。 */
const TOP_N = 50;

const statsKey = (id) => 'stats:' + id;
const runsKey = (id) => 'runs:' + id;
/**
 * 这个人那份战绩的锁（_store.js 的 withLock）。
 *
 * `stats:<id>` 是一份 JSON 大文档，`runs:<id>` 是他的存档，而榜上那几行是从这
 * 两样算出来的。三样必须一起改，否则重建和交卷会互相盖掉——见 push 和 rebuild
 * 各自那段说明，以及 scripts/check-stats-race.mjs。
 */
const statsLockKey = (id) => 'statslock:' + id;
const boardKey = (mode) => 'lb:' + mode;
/**
 * 总榜：不分玩法，每个人上榜的是他在所有玩法里有史以来最高的那一局（玩家的
 * 原话：「总榜上是不分什么玩法……该玩家在各个玩法中有史以来最高分的那个记录
 * 被放在总榜上」）。它不是累计总分——那个数在《记录与排名》的《累计得分》
 * 卡上，是本机自己算的。
 */
const TOTAL_BOARD = 'lb:total';
/** id → 总榜上那一局是哪张榜。一张哈希表，画行首那个小图形用。 */
const TOTAL_MODE = 'lb:total:mode';

/**
 * 一张榜的名字。
 *
 * 三块基础棋盘按玩法分开记——`square:base`、`square:timed`、`square:bomb`、
 * `square:slot`、`square:flip`。它们本来共用一张榜，可这几种局的分根本不是
 * 一把尺子：无限反转翻来翻去、老虎机认的是另一对图案、计时局只有六十秒，混
 * 在一起比谁高没有意义（玩家的原话：排行榜要分成基础、计时、炸弹、特殊布局、
 * 老虎机、无限反转几块）。
 *
 * 别的布局各自一张，不再往下分：一张 V 形三角的榜就是「V 形三角打得最好的
 * 人」，它上面的炸弹局、计时局都算在里头——那几块棋盘本来玩的人就少，再切成
 * 五份只会切出五张空榜。
 *
 * 定时炸弹归到炸弹里（bombTimed → bomb）：它是炸弹的一种，不是第七块。
 *
 * 炸弹还分两版规则。2026-09 之前一局里每一枚红块都是炸弹、永不翻面；之后炸弹
 * 挨着得分图案会被连带拆成星星，整局只剩一枚永久炸弹。同一副棋盘，躲六枚和躲
 * 一枚打出来的分不是一把尺子量的，所以新规则记在 `square:bomb2` 这样的新榜
 * 上，老的 `square:bomb` 原样归档——它不在 ALL_BOARDS 里，重建时不撤人，存档
 * 里那些老局照旧算回它自己那张榜（见 kindOf）。
 */
const BASE_SHAPES = ['square', 'circle', 'triangle'];
const LAYOUT_BOARDS = ['squareDiamond', 'circleHex', 'circleSeven', 'triangleBig', 'triangleAdvanced'];
/** 炸弹这一档现在叫什么。改规则就往上加一版，老的那个名字留着当归档榜。 */
const BOMB_KIND = 'bomb2';
/**
 * 步步为营这一档。
 *
 * **它没有版本后缀**（不是 'puzzle1'），因为这是新开的一张榜，没有旧局要归档
 * ——不是忘了。将来《外边消除》改了消除规则、这一局的分不再是同一把尺子量出
 * 来的时候，再照 bomb → bomb2 那条路往上加一版，把这一张留着当归档榜。
 */
const PUZZLE_KIND = 'puzzle';
const KINDS = ['base', 'timed', BOMB_KIND, 'slot', 'flip', PUZZLE_KIND];

/** 这一局算哪一种。存档里那份 data 说了算（modeKey 加老虎机那个标记）。 */
function kindOf(data) {
  const mk = String(data?.modeKey || 'base');
  // 排在 timed 前面：步步为营这一局没有钟，modeKey 也不会是 'timed'，可顺序照
  // 规矩摆——一局只归一档，越专的档越先问。
  if (mk === PUZZLE_KIND) return PUZZLE_KIND;
  if (mk === 'flip') return 'flip';
  // 老档没有 bombRules，读出来是 undefined——那是第一版规则，归老榜。
  if (mk === 'bomb' || mk === 'bombTimed') return Number(data?.bombRules) >= 2 ? BOMB_KIND : 'bomb';
  if (mk === 'timed') return 'timed';
  return data?.slot ? 'slot' : 'base';
}
const boardIdOf = (mode, data) =>
  BASE_SHAPES.includes(mode) ? `${mode}:${kindOf(data)}` : mode;

/** 现在一共有哪些榜。重建的时候要照着它把人先撤干净。 */
const ALL_BOARDS = [
  ...BASE_SHAPES.flatMap((shape) => KINDS.map((kind) => `${shape}:${kind}`)),
  ...LAYOUT_BOARDS,
];
/** 老版本那一套：一块棋盘一张榜，不分玩法。重建时顺手撤掉。 */
const LEGACY_BOARDS = [...BASE_SHAPES, ...LAYOUT_BOARDS];

/**
 * 母标签旗下的几张榜。点《基础》看到的是它们合起来的样子——每个人取自己在
 * 这几张榜上最高的那一分（见 groupRows），点《方块》才是单独那一张。
 */
const GROUPS = {
  base: BASE_SHAPES.map((s) => `${s}:base`),
  timed: BASE_SHAPES.map((s) => `${s}:timed`),
  bomb: BASE_SHAPES.map((s) => `${s}:${BOMB_KIND}`),
  layout: LAYOUT_BOARDS,
  slot: BASE_SHAPES.map((s) => `${s}:slot`),
  flip: ['square:flip', 'circle:flip'],
  puzzle: BASE_SHAPES.map((s) => `${s}:${PUZZLE_KIND}`),
};
/** 合并一张母榜时，每张子榜先取前多少名。 */
const GROUP_SCAN = 200;

/** 一个账号有史以来最高的那一局：分数和玩法。一局都没有就是 null。 */
function bestOverall(stats) {
  let top = null;
  for (const [mode, score] of Object.entries(stats.best || {})) {
    const n = num(score);
    if (n > 0 && (!top || n > top.score)) top = { mode, score: n };
  }
  return top;
}
/** id → 榜上显示的名字。一张哈希表，不是每人一个键。 */
const NAMES = 'lbnames';

/**
 * 棋盘 id：只收长得像 id 的字符串，别让它变成一把能写任意键的钥匙。上报的一
 * 局只说棋盘（square），玩法由存档里那份 data 说了算——所以这里不许带冒号。
 */
const MODE_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;
const cleanMode = (v) => (MODE_RE.test(String(v || '')) ? String(v) : '');
/** 要看的那张榜：棋盘、棋盘:玩法，或者母标签 g:xxx。只读，不用它拼写入的键。
 *  玩法那一截允许带数字，因为它带着规则版本号（bomb2，见 BOMB_KIND）。 */
const BOARD_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}(:[a-zA-Z][a-zA-Z0-9]{0,7})?$/;
const cleanBoard = (v) => (BOARD_RE.test(String(v || '')) ? String(v) : '');

/** 榜上那个名字：十二个字，去掉会把一行撑坏的东西。 */
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g;
const cleanName = (v) => String(v ?? '').replace(CTRL_RE, '').trim().slice(0, 12);

const num = (v, cap = MAX_SCORE) => {
  const n = Math.round(Number(v) || 0);
  return n > 0 ? Math.min(n, cap) : 0;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = await readBody(req);

  // 管理员维护：不认玩家，认的是 ADMIN_TOKEN，所以排在 identify 前面。
  if (body?.action === 'rebuild') return await rebuild(req, res, body);

  const claim = {
    email: body?.email,
    accountToken: body?.token,
    holderCode: body?.code,
    storeClaim: Boolean(body?.storeClaim),
  };

  try {
    const who = await identify(claim);
    // 三个动作都要先认得出你是谁：存的是你的档，看的是你的名次。
    if (!who) return send(res, 401, { error: 'auth' });

    switch (body?.action) {
      case 'push':
        return await push(res, body, who);
      case 'mine':
        return await mine(res, who);
      case 'board':
        return await board(res, body, who, claim);
      default:
        return send(res, 400, { error: 'action' });
    }
  } catch {
    return send(res, 502, { error: 'upstream' });
  }
}

/** 这个账号目前的样子。没有就是一张白纸。 */
async function loadStats(id) {
  const raw = (await get(statsKey(id))) || {};
  return {
    total: num(raw.total, Number.MAX_SAFE_INTEGER),
    runs: num(raw.runs, 1e9),
    best: raw.best && typeof raw.best === 'object' ? raw.best : {},
    seen: Array.isArray(raw.seen) ? raw.seen : [],
  };
}

/**
 * 打完一局。
 *
 * **整段在这个人自己那把锁里**（statsLockKey）。这里原先写着「同一个人不会在两
 * 台设备上同时交卷，所以这里的读改写没有别人来抢」——那句话是假的，两个方向都
 * 假：
 *
 *   · 有别人来抢：管理员点《重建榜单》（见下面的 rebuild）读的、写的正是这两
 *     份文档。它读出整份 stats 之后要走二十几次撤榜上榜才轮到写入，那几百毫秒
 *     里交上来的这一局先写进去、随即被它整份盖掉。实测三个数一起回退，而重建
 *     只重算 best，**total 和 runs 再重建一次也救不回来**。
 *   · 同一个人也真会撞自己：网差重发、返回键再点一下、两个标签页——实测两局几
 *     乎同时交，后写的把先写的盖掉，玩家那一局连存档里都没有。
 *
 * 为什么榜上那几笔也在锁里，而不只是两次写入：重建在它自己的锁里撤榜上榜，如果
 * 交卷这一侧在锁外面 zadd，重建刚撤掉的那一行会被它重新加回去（点了《清掉无限
 * 反转》那一档尤其明显）。凡是「从这两份文档算出来的」写入，都归这把锁管。
 */
async function push(res, body, who) {
  const runId = String(body?.runId || '').slice(0, 64);
  const mode = cleanMode(body?.mode);
  const score = num(body?.score);
  if (!runId || !mode) return send(res, 400, { error: 'run' });

  // 这一局记在哪张榜上：基础三块棋盘分玩法，别的布局各一张（见 boardIdOf）。
  const boardId = boardIdOf(mode, body?.data);
  const name = cleanName(body?.name);

  const got = await withLock(statsLockKey(who.id), async () => {
    const stats = await loadStats(who.id);
    // 同一局报两次不算两次。网差重发、返回键再点一下，都会走到这儿。
    if (stats.seen.includes(runId)) return { duplicate: true, stats };

    stats.total += score;
    stats.runs += 1;
    stats.best[boardId] = Math.max(stats.best[boardId] || 0, score);
    stats.seen = [runId, ...stats.seen].slice(0, KEEP_SEEN);
    await set(statsKey(who.id), stats);

    // 存档。整局的原始数据都留着——记录页要靠它把那张战绩图重新画出来。
    // 它必须和上面那份 stats 在同一把锁里：重建是从**存档**重算 best 的，两样
    // 分开写就会出现「存档里有这一局、汇总里没有」的半截状态。
    const archive = await get(runsKey(who.id));
    const list = Array.isArray(archive) ? archive : [];
    list.unshift({ runId, mode, score, at: Date.now(), data: body?.data ?? null });
    await set(runsKey(who.id), list.slice(0, KEEP_RUNS));

    if (name) await hset(NAMES, who.id, { name, avatar: body?.avatar ?? null });

    // 单局榜只上不下（GT）。总榜写的是他所有玩法里最高的那一局——覆盖写，
    // 因为它是从 stats.best 重算出来的：老版本往这里写的是累计总分，这一笔
    // 顺手把它改正。
    await zaddIfHigher(boardKey(boardId), stats.best[boardId], who.id);
    const top = bestOverall(stats);
    if (top) {
      await zadd(TOTAL_BOARD, top.score, who.id);
      await hset(TOTAL_MODE, who.id, top.mode);
    } else {
      // 一局都没得过分：0 不算「最高」，总榜上不该有这一行。老版本按累计总分
      // 写榜，0 分也会占一行，这里顺手撤掉。
      await zrem(TOTAL_BOARD, who.id);
    }
    return { duplicate: false, stats };
  });

  // 约一秒八都没抢到锁：明说一句，让客户端过一会再报。**不能默默丢掉**——这一局
  // 是玩家刚打完的东西，客户端那边还留着，重报一次就好（runId 一样，seen 认得
  // 出来，不会算两次）。
  if (!got.ok) return send(res, 503, { error: 'busy' });

  const { duplicate, stats } = got.value;
  if (duplicate) {
    return send(res, 200, { ok: true, duplicate: true, total: stats.total, runs: stats.runs });
  }
  return send(res, 200, { ok: true, total: stats.total, runs: stats.runs, best: stats.best });
}

/** 我自己的存档和数字。是自己的东西，不设门。 */
async function mine(res, who) {
  const [stats, archive] = await Promise.all([loadStats(who.id), get(runsKey(who.id))]);
  return send(res, 200, {
    ok: true,
    total: stats.total,
    runs: stats.runs,
    best: stats.best,
    // seen 是内部账本，不往外说。
    archive: Array.isArray(archive) ? archive : [],
  });
}

/**
 * 总榜上没有玩法记号的行：老版本留下的累计总分。按各人的存档重算成「最高的
 * 那一局」写回去。只看前五十名和看榜的人自己——这就是这一次会画出来的全部。
 */
async function healTotalBoard(myId) {
  const [top, modes] = await Promise.all([zTop(TOTAL_BOARD, TOP_N), hgetall(TOTAL_MODE)]);
  const ids = new Set(top.map((row) => row.member));
  ids.add(myId);
  for (const id of ids) {
    if (typeof modes[id] === 'string') continue;
    const stats = await loadStats(id);
    const best = bestOverall(stats);
    if (!best) {
      // 存档里一局得分的都没有（老版本按累计总分写榜，一局都没得分的人也占
      // 一行 0 分）：没有玩法可标，行首就空着——玩家看到的正是「显示了名字
      // 但没有标识」。0 不算「最高」，撤下来。
      await zrem(TOTAL_BOARD, id);
      continue;
    }
    await zadd(TOTAL_BOARD, best.score, id);
    await hset(TOTAL_MODE, id, best.mode);
  }
}

/**
 * 母榜：旗下每张子榜先取前 GROUP_SCAN 名，一个人取他在这几张里最高的那一分，
 * 再排一次。
 *
 * 为什么不是把几张榜加起来：这一栏问的是「基础玩法打得最好的是谁」，那就该
 * 看他最好的那一局，和总榜同一个道理——把三局加起来，比的会变成「谁打得多」。
 */
async function groupTop(boards) {
  const lists = await Promise.all(boards.map((id) => zTop(boardKey(id), GROUP_SCAN)));
  const best = new Map();
  lists.forEach((list, i) => {
    for (const row of list) {
      const had = best.get(row.member);
      if (!had || row.score > had.score) best.set(row.member, { score: row.score, board: boards[i] });
    }
  });
  return [...best.entries()]
    .map(([member, v]) => ({ member, score: v.score, board: v.board }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 一张榜。
 *
 * mode 给了就是那个玩法的单局榜，没给就是总榜——每个人所有玩法里最高的那一局。回的除了前五十名，还有
 * 「我自己排第几」——榜再长，玩家真正想知道的还是这一件事，而它不在前五十
 * 名里的时候恰恰最想知道。
 */
async function board(res, body, who, claim) {
  if (!(await isGenius(claim, who.account))) {
    return send(res, 403, { error: 'geniusOnly' });
  }

  const mode = cleanBoard(body?.mode);
  // 母标签（g:base、g:layout…）：旗下几张榜合起来看。
  if (mode.startsWith('g:')) {
    const boards = GROUPS[mode.slice(2)];
    if (!boards) return send(res, 400, { error: 'mode' });
    const [rows, names] = await Promise.all([groupTop(boards), hgetall(NAMES)]);
    const mine = rows.findIndex((r) => r.member === who.id);
    return send(res, 200, {
      ok: true,
      mode,
      rows: rows.slice(0, TOP_N).map((row, i) => ({
        rank: i + 1,
        score: row.score,
        name: names[row.member]?.name || '',
        avatar: names[row.member]?.avatar ?? null,
        me: row.member === who.id,
        // 母榜上几块棋盘混在一起，所以每一行也画个小图形说明是哪一块。
        mode: row.board.split(':')[0],
      })),
      players: rows.length,
      me: mine < 0 ? null : { rank: mine + 1, score: rows[mine].score },
    });
  }
  const key = mode ? boardKey(mode) : TOTAL_BOARD;
  // 总榜上还有老版本写进去的累计总分（那时总榜就是总分榜）：上面没有玩法
  // 记号的那几行就是它们。看到一行就把那一个人的数从他的存档里重算一遍、
  // 改回去，改完再取一次榜——只要有人看过一回榜，榜就是对的了。
  if (!mode) await healTotalBoard(who.id);
  const [top, myScore, myRank, size, names, modes] = await Promise.all([
    zTop(key, TOP_N),
    zscore(key, who.id),
    zrevrank(key, who.id),
    zcard(key),
    hgetall(NAMES),
    mode ? Promise.resolve({}) : hgetall(TOTAL_MODE),
  ]);

  const rows = top.map((row, i) => ({
    rank: i + 1,
    score: row.score,
    name: names[row.member]?.name || '',
    avatar: names[row.member]?.avatar ?? null,
    me: row.member === who.id,
    // 总榜每一行是哪块棋盘的那一局（单局榜不用说，就是这一块）。存的是榜的
    // id（square:flip），画图形只要棋盘那一截。
    ...(mode
      ? {}
      : { mode: typeof modes[row.member] === 'string' ? modes[row.member].split(':')[0] : '' }),
  }));

  return send(res, 200, {
    ok: true,
    mode,
    rows,
    players: size,
    // 没打过这个玩法就没有名次，这里就是 null——别拿 0 冒充「第一名」。
    me: myScore === null ? null : { rank: (myRank ?? 0) + 1, score: myScore },
  });
}

// ---- 管理员维护 -----------------------------------------------------------

/** 一个来源一小时最多敲多少次门。和 api/mint.js 同一个数。 */
const CALLS_PER_HOUR = 20;

/** 和 api/mint.js 同一把锁：ADMIN_TOKEN，等长比较，不泄露比到第几位。 */
function tokenOk(given) {
  const want = process.env.ADMIN_TOKEN || '';
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

/**
 * 重建榜单：照每个人自己的存档，把所有榜从头算一遍。
 *
 *   POST /api/scores
 *   { "action": "rebuild", "token": "…", "drop": ["flip"] }
 *
 * 两件事一起做完：
 *
 *   · 换榜。以前一块棋盘一张榜，基础、计时、炸弹、老虎机、无限反转的分全挤
 *     在一起；现在按玩法分开（见 boardIdOf），旧的那几张要按存档重新拆开。
 *   · 清掉指定的那几种局（drop）。《无限反转》早先那版计分能打到七位数，还
 *     被上限削成同一个数，玩家要的就是「把之前无限反转的榜单清空」——它写在
 *     drop 里，重建时直接不计。这只动榜：人家自己的存档、累计得分一个字不改，
 *     那是他的记录。
 *
 * 做法：先把这个人从每一张榜（含老版本那几张）撤下来，再按重算的账写回去，
 * 总榜跟着重算。存档只留最近 60 局（KEEP_RUNS），更早的翻不出来也就不算——
 * 回包里报了动过几个人、写了几行、跳过了几个人。
 *
 * ── 一个人一把锁，而且是整段进锁 ──────────────────────────────
 *
 * 这一段从前不带锁，于是它和玩家交卷会互相盖掉：读出整份 stats 之后要走二十几
 * 次撤榜上榜才轮到写入，那几百毫秒里交上来的那一局先写进去、随即被这里的整份
 * set 抹掉。实测 total 600→100、runs 2→1、best 500→100 三个数一起回退，而**这
 * 里只重算 best**——再点一次重建救得回 best，`total` 和 `runs` 永久错着。
 *
 * 为什么不是「写之前重读一次」：那只把窗口从二十几次往返缩到一次，没关上。而
 * best 是从**存档**算出来的，重读也救不了——算完之后还要撤榜上榜，中间只要松过
 * 锁，新交的那一局就溜进了存档，而 best 已经按旧存档算完了。所以读存档、算
 * best、撤榜上榜、写 stats 必须整段在同一把锁里（实测过四个版本，只有这一版三
 * 个数都对；见 scripts/check-stats-race.mjs）。
 *
 * 一个人的这一段是二十几次顺序往返，几百毫秒，远在锁的十秒 TTL 之内；而锁是一
 * 人一把，五千个人依次来，谁也不等别人。**抢不到锁的人跳过、不盖掉**——他正在
 * 打这一局，那份存档一会儿就是新的，下次重建自然算对。跳过的人数报在
 * `skipped` 里：跳过比盖掉好，但得看得见。
 */
async function rebuild(req, res, body) {
  // 先限速，再验令牌——挡的正是「一直猜这个令牌」。和 api/mint.js 同一套
  // （_ratelimit.js），同一个数：管理员一小时重建不了几次榜，猜密码的人先撞上
  // 它。这一条尤其该限：重建要把全站每个人的存档翻一遍再重写所有榜，是站里最
  // 贵的一次调用，敲开门之前就已经不便宜了。
  if (await tooMany('scores:rebuild', callerId(req), CALLS_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (!tokenOk(body?.token)) return send(res, 401, { error: 'wrong' });
  const drop = new Set((Array.isArray(body?.drop) ? body.drop : []).map((k) => String(k)));

  // 所有可能在榜上的人：总榜上的（有过正分就在）加上留过名字的。
  const [ranked, names] = await Promise.all([zTop(TOTAL_BOARD, 5000), hgetall(NAMES)]);
  const ids = new Set([...ranked.map((row) => row.member), ...Object.keys(names || {})]);

  let players = 0;
  let rowsWritten = 0;
  /** 这一轮没抢到锁、因此原样放过的人。正在打这一局的人就落在这里。 */
  const skipped = [];
  for (const id of ids) {
    const got = await withLock(statsLockKey(id), async () => {
      const [stats, archive] = await Promise.all([loadStats(id), get(runsKey(id))]);
      const runs = Array.isArray(archive) ? archive : [];

      const best = {};
      for (const run of runs) {
        const mode = cleanMode(run?.mode);
        if (!mode) continue;
        if (drop.has(kindOf(run?.data))) continue;
        const boardId = boardIdOf(mode, run?.data);
        const score = num(run.score);
        if (score > 0 && score > (best[boardId] || 0)) best[boardId] = score;
      }

      let rows = 0;
      // 先撤干净：新榜、老榜都撤，没算出成绩的那几张就此空着。
      for (const boardId of [...ALL_BOARDS, ...LEGACY_BOARDS]) {
        if (best[boardId] === undefined) await zrem(boardKey(boardId), id);
      }
      for (const [boardId, score] of Object.entries(best)) {
        // zadd 而不是 zaddIfHigher：这一次要的正是把它改成重算出来的那个数。
        await zadd(boardKey(boardId), score, id);
        rows++;
      }

      // 只改 best。total 和 runs 是玩家自己攒下来的，这里压根不重算它们——读出
      // 来的那一份原样带回去，别的字段（seen）同理。
      stats.best = best;
      await set(statsKey(id), stats);
      const top = bestOverall(stats);
      if (top) {
        await zadd(TOTAL_BOARD, top.score, id);
        await hset(TOTAL_MODE, id, top.mode);
      } else {
        await zrem(TOTAL_BOARD, id);
      }
      return rows;
    });
    if (!got.ok) {
      skipped.push(id);
      continue;
    }
    rowsWritten += got.value;
    players++;
  }
  return send(res, 200, {
    ok: true,
    players,
    rows: rowsWritten,
    skipped: skipped.length,
    dropped: [...drop],
  });
}

/**
 * 换邮箱的时候，把这个人的战绩一起搬过去（api/email.js 调它）。
 *
 * 为什么在这个文件里：`stats:` `runs:` `lb:*` `lbnames` 这几把钥匙是这个文件
 * 造出来的，别处不知道它们长什么样。搬家的活儿留在拥有钥匙的这一边，将来加
 * 一张榜也只用改这一处。
 *
 * 榜上的成员就是玩家的 id（也就是邮箱本身），所以「搬」= 在新 id 上重新写一
 * 遍，再把旧 id 从每张榜上撤掉。写哪几张榜不用去猜：`stats.best` 里记着他打
 * 过的每一张，逐张照抄就是了。
 *
 * 顺序是**先写新的，最后删旧的**——中间摔了，他的战绩在两个 id 底下各有一
 * 份（多一份，不好看，但一分没丢）；反过来先删就可能什么都不剩。这条和
 * redeem.js 那次「码烧掉却没到账」是同一条教训。
 *
 * **整段在旧 id 那把锁里**（statsLockKey(from)，和 push / rebuild 同一把）。
 * 没有这把锁的话：换邮箱这几秒里（要走好几次网络往返，跨度不短）旧邮箱那台设
 * 备上正好有一局收尾交卷，push 读的是「搬走之前」的那份 stats，写回旧 id；而这
 * 边已经把旧 id 的存档删掉了——那一局的分数彻底消失，两边都回 200，玩家和客服
 * 都查不出异常。现实里完全撞得上：在电脑上确认换邮箱，手机上那局正好打完。
 *
 * 新地址 to 不用锁：它是刚刚建出来的，这一刻不可能有别人在写它。
 *
 * 抢不到锁就抛——api/email.js 那一段本来就为「renameScoreOwner 摔了」准备了
 * 补偿（把刚占住的新地址退回去，让玩家「再走一遍」重新成立）。
 */
export async function renameScoreOwner(from, to) {
  if (!from || !to || from === to) return;
  const got = await withLock(statsLockKey(from), () => moveScores(from, to));
  if (!got.ok) throw new Error('战绩搬家没抢到锁：' + from);
}

async function moveScores(from, to) {
  const stats = await get(statsKey(from));
  const runs = await get(runsKey(from));
  const name = await hget(NAMES, from);

  if (stats) await set(statsKey(to), stats);
  if (runs) await set(runsKey(to), runs);
  if (name) await hset(NAMES, to, name);

  // 每一张他上过的榜。zadd 而不是 zaddIfHigher：新 id 上本来就该是这个数，
  // 而不是「和已有的比一比」——新邮箱按规矩是个没有账号的地址，榜上不该有它。
  const best = (stats && typeof stats.best === 'object' && stats.best) || {};
  for (const [boardId, score] of Object.entries(best)) {
    const n = Number(score) || 0;
    if (n <= 0) continue;
    await zadd(boardKey(boardId), n, to);
    await zrem(boardKey(boardId), from);
  }

  // 总榜单独记一笔玩法（行首那个小图形靠它画）。
  const top = bestOverall({ best });
  if (top) {
    await zadd(TOTAL_BOARD, top.score, to);
    await hset(TOTAL_MODE, to, top.mode);
  }
  await zrem(TOTAL_BOARD, from);
  await hdel(TOTAL_MODE, from);
  await hdel(NAMES, from);

  // 旧 id 下的存档最后清。到这一行为止，新 id 那边什么都齐了。
  await del(statsKey(from));
  await del(runsKey(from));
}
