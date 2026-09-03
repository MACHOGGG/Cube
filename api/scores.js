/**
 * 战绩存云端，以及两张全球排行榜。
 *
 * 三个动作，一个入口：
 *
 *   push   打完一局，把这一局挂到账号上；顺手更新两张榜。
 *   mine   我自己的存档——换台设备登录，记录跟着回来。
 *   board  排行榜。所有人都上榜，但只有天才看得见（见下面那段）。
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
import { send, readBody } from './_creem.js';
import { identify, isGenius } from './_entitlement.js';
import {
  get,
  hgetall,
  hset,
  set,
  storeConfigured,
  zadd,
  zaddIfHigher,
  zcard,
  zrem,
  zrevrank,
  zscore,
  zTop,
} from './_store.js';

/** 一局的综合得分上限。见文件头「关于作弊」。 */
const MAX_SCORE = 1000000;
/** 存档留多少局。够翻很久，又不至于让一个账号的文档大到读不动。 */
const KEEP_RUNS = 60;
/** 「这一局我收过了」记多少条。比 KEEP_RUNS 长一点，防的是重复提交。 */
const KEEP_SEEN = 120;
/** 一张榜一次给多少行。 */
const TOP_N = 50;

const statsKey = (id) => 'stats:' + id;
const runsKey = (id) => 'runs:' + id;
const boardKey = (mode) => 'lb:' + mode;
/**
 * 总榜：不分玩法，每个人上榜的是他在所有玩法里有史以来最高的那一局（玩家的
 * 原话：「总榜上是不分什么玩法……该玩家在各个玩法中有史以来最高分的那个记录
 * 被放在总榜上」）。它不是累计总分——那个数在《记录与排名》的《累计得分》
 * 卡上，是本机自己算的。
 */
const TOTAL_BOARD = 'lb:total';
/** id → 总榜上那一局是哪个玩法。一张哈希表，画行首那个小图形用。 */
const TOTAL_MODE = 'lb:total:mode';

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

/** 玩法 id：只收长得像玩法 id 的字符串，别让它变成一把能写任意键的钥匙。 */
const MODE_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;
const cleanMode = (v) => (MODE_RE.test(String(v || '')) ? String(v) : '');

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
 * 读一次、写一次，写的都是这个账号自己的文档——同一个人不会在两台设备上同
 * 时交卷，所以这里的「读改写」没有别人来抢。榜上那两笔是分开的两条命令，
 * 因为有序集合本来就该这么用。
 */
async function push(res, body, who) {
  const runId = String(body?.runId || '').slice(0, 64);
  const mode = cleanMode(body?.mode);
  const score = num(body?.score);
  if (!runId || !mode) return send(res, 400, { error: 'run' });

  const stats = await loadStats(who.id);
  // 同一局报两次不算两次。网差重发、返回键再点一下，都会走到这儿。
  if (stats.seen.includes(runId)) {
    return send(res, 200, { ok: true, duplicate: true, total: stats.total, runs: stats.runs });
  }

  stats.total += score;
  stats.runs += 1;
  stats.best[mode] = Math.max(stats.best[mode] || 0, score);
  stats.seen = [runId, ...stats.seen].slice(0, KEEP_SEEN);
  await set(statsKey(who.id), stats);

  // 存档。整局的原始数据都留着——记录页要靠它把那张战绩图重新画出来。
  const archive = await get(runsKey(who.id));
  const list = Array.isArray(archive) ? archive : [];
  list.unshift({ runId, mode, score, at: Date.now(), data: body?.data ?? null });
  await set(runsKey(who.id), list.slice(0, KEEP_RUNS));

  const name = cleanName(body?.name);
  if (name) await hset(NAMES, who.id, { name, avatar: body?.avatar ?? null });

  // 单局榜只上不下（GT）。总榜写的是他所有玩法里最高的那一局——覆盖写，
  // 因为它是从 stats.best 重算出来的：老版本往这里写的是累计总分，这一笔
  // 顺手把它改正。
  await zaddIfHigher(boardKey(mode), stats.best[mode], who.id);
  const top = bestOverall(stats);
  if (top) {
    await zadd(TOTAL_BOARD, top.score, who.id);
    await hset(TOTAL_MODE, who.id, top.mode);
  } else {
    // 一局都没得过分：0 不算「最高」，总榜上不该有这一行。老版本按累计总分
    // 写榜，0 分也会占一行，这里顺手撤掉。
    await zrem(TOTAL_BOARD, who.id);
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

  const mode = cleanMode(body?.mode);
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
    // 总榜每一行是哪个玩法的那一局（单局榜不用说，就是这个玩法）。
    ...(mode ? {} : { mode: typeof modes[row.member] === 'string' ? modes[row.member] : '' }),
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
