/**
 * 战绩存云端，以及两张全球排行榜。
 *
 * 三个动作，一个入口：
 *
 *   push   打完一局，把这一局挂到账号上；顺手更新两张榜。**不再带名字**（第 16 推）。
 *   mine   我自己的存档——换台设备登录，记录跟着回来。连同我的昵称。
 *   name   改昵称（第 16 推）：一个帐号一个、全站唯一，榜上那个名字只有这一条路写得进来。
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
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { send, readBody } from './_creem.js';
import { identify, isGenius } from './_entitlement.js';
import { loadAccount, pairKey } from './_accounts.js';
import { callerId, tooMany } from './_ratelimit.js';
import {
  VARIANTS,
  dailySeed,
  dailyVariant,
  dayIndexOf,
  dayIndexOfKey,
  dayKey,
  dayStartOf,
  normalizeSeed,
  seedModeOf,
} from './_seedcode.js';
import {
  NAMES,
  NICK_INDEX,
  NICK_V,
  checkNickname,
  nickKey,
  nicknameOf,
  registerNickname,
  repointNickname,
} from './_nickname.js';
import {
  del,
  expire,
  get,
  hdel,
  hget,
  hgetall,
  hset,
  hsetnx,
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
/**
 * 一个账号一小时最多交几局。
 *
 * 三百局 ＝ 平均十二秒一局，连打带交卷，一小时不停。**人做不到**（最短的那几档玩法
 * 本身就是 100 秒），所以这个数拦不住任何一个真玩家，只拦住「拿脚本一直往这个接口
 * 灌」——而这条路灌进来的每一局都要走一把锁、一次整份 stats、一次整份存档、二十几次
 * 榜上写入，是全站第二贵的调用（最贵的是 rebuild，它早就限过速了）。
 *
 * 和别处几道门不同，这一道的键是**账号**，不是 IP（callerId）：这条路非认得出你是谁
 * 不可（上面 identify 那一关），而要拦的恰恰是「同一个账号往自己名下灌」。换 IP 绕不
 * 过它，换账号要先有账号。
 */
const PUSHES_PER_HOUR = 300;
/**
 * 一局那份 `data` 最多多少个字符（JSON 串起来数）。
 *
 * 为什么要有这个数：这份 `data` 会被原样塞进存档（`runs:`），而存档是一份整体读写
 * 的 JSON——六十局摞在一起，每一次 `mine` 要整份读出来、每一次 `rebuild` 要把**全站
 * 每个人**的那一份都读一遍。谁往里塞一兆字节，塞的是那个账号从此读不动的存档，而且
 * 一次重建就能把整站拖垮。
 *
 * 四千是量出来的：把 `RunData` 每一位都填满、字符串全用中文长句，`JSON.stringify`
 * 出来 641 个字符。留六倍的余量给将来新加的字段，同时把一份存档的上限钉在 60 × 4096
 * ≈ 240KB（Upstash 单值 1MB 以内）。真有一天 `RunData` 长到接近它，门会先红
 * （check-scores-guard），而不是线上先炸。
 */
const DATA_MAX_CHARS = 4096;
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

/*
 * ── 每日挑战的「今日」榜（第 19 推）──────────────────────────────
 *
 * 一天一张：`lb:daily:YYYYMMDD`（北京日期）。每人一行，取他**当天最好的一局**（ZADD GT）。8 天
 * 过期——榜上只看「今日」，留一周是给零点前后、时区不同的人留的余地，再久的没人看，不必一直
 * 占着 Upstash 的空间。
 *
 * **服务器不信客户端说的「这是每日挑战」**：它自己照那一天算出种子码（_seedcode.js 的
 * dailySeed，和客户端同一套算法），对不上就不收；还要核对这一局的玩法和棋盘就是那一天的那一个
 * ——不然拿当天那串码、报一局更好打的玩法上来，照样能进榜。见 pushDaily。
 *
 * 不新增接口（方案原话：「放在 scores.js 里；api/ 已有 12 个函数，留意 Vercel 方案的函数数量上
 * 限」）：交卷还是 push，看榜还是 board，mode 传 'daily'。
 */
const dailyBoardKey = (key) => 'lb:daily:' + key;
/** 零点之后还收前一天那一局多久：在 23:59 开局的人，打完已经是第二天了。 */
const DAILY_GRACE_MS = 10 * 60_000;
const DAILY_TTL_S = 8 * 86_400;

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
 * 炸弹分**三版**规则。第 1 版：一局里每一枚红块都是炸弹、永不翻面（躲六枚）。第 2
 * 版：炸弹挨着得分图案会被连带拆成星星，但留一枚永久炸弹（躲一枚）。第 3 版（玩家
 * 2026-09-25 拍板的《外边消除决策》D1b）：那一枚也取消，一局打到最后一枚活炸弹都不
 * 剩。同一副棋盘，躲六枚、躲一枚、一枚都不躲，打出来的分不是一把尺子量的，所以现行
 * 规则记在 `square:bomb3` 这样的新榜上，老的两张（`square:bomb`、`square:bomb2`）原样
 * 归档——它们不在 ALL_BOARDS 里，重建时不撤人，存档里那些老局照旧算回自己那张榜
 * （见 kindOf）；除非 `drop` 点名，那时候连归档榜一起撤（见 droppedBoards）。
 */
const BASE_SHAPES = ['square', 'circle'];
const LAYOUT_BOARDS = ['squareDiamond', 'circleHex', 'circleSeven', 'triangleBig'];
/**
 * 已经删掉的棋盘。
 *
 * 2026-09（《侵蚀阶梯》v1.2 PR-6）删了两副三角：原《三角》（id `triangle`）和 V 形
 * （`triangleAdvanced`）。它们从 BASE_SHAPES / LAYOUT_BOARDS 里摘掉了，所以新的一局
 * 再也进不了这几张榜。
 *
 * **但重建时还得撤人**：从 ALL_BOARDS 里摘掉的后果是 rebuild 再也不碰那几张榜，榜上
 * 按旧棋盘打出来的分就永远留在那儿——《无限反转》改版时踩过一模一样的一脚（见下面
 * rebuild 里那段注释，check-scores 逮到的那条）。所以单列一张表，下面拼进要撤的清单。
 */
const RETIRED_BOARDS = ['triangle', 'triangleAdvanced'];
/**
 * 现行的计分规则版本——**要和 `src/engine/scoring.ts` 的 `SCORING_RULES_VERSION`
 * 一模一样**。
 *
 * 这一行是手抄的：`api/` 是纯 .js、不过 tsc，import 不进 src 里的 ts。改规则版本时
 * 两处一起改，漏一处的后果是全站没有一局入得了榜（服务端认不出客户端报的版本），
 * 而屏幕上一个字的错都没有。
 */
const SCORING_RULES = 'ero1';
/** 炸弹这一档现在叫什么。改规则就往上加一版，老的那个名字留着当归档榜。 */
const BOMB_KIND = 'bomb3';
/**
 * 步步为营这一档现在叫什么。
 *
 * 2026-10-02 消线奖励从「退一步」改成「退两步」（`src/engine/puzzleScore.ts` 的
 * `PUZZLE_EDGE_BONUS`，底稿 §7 / E14 一直写的就是 +2，代码落错了半年）。它退的是步
 * 数不是分数，可一局能走多久直接决定终局盘上有多少枚被消除、多少枚翻成星星，而综合
 * 分就是按终局盘面算的——两版打出来的分不是一把尺子量的。
 *
 * 所以照 bomb → bomb2 那条路往上加一版，老的 `square:puzzle` 原样归档（它不在
 * ALL_BOARDS 里，重建时不撤人，存档里那些老局照旧算回它自己那张榜，见 kindOf）。
 * 这一步上面那一版注释里本来就预告过：「将来……再照 bomb → bomb2 那条路往上加一版，
 * 把这一张留着当归档榜。」
 */
const PUZZLE_KIND = 'puzzle2';
/**
 * 无限反转这一档现在叫什么。
 *
 * 2026-09 给连击倍率加了封顶（`src/engine/scoring.ts` 的 FLIP_STREAK_CAP，1.5¹⁰ ≈
 * 57.7 倍）。封顶之前那是个不封的指数：4 分的图案连续第 49 次单次得分就超过
 * MAX_SCORE，一局能打穿这张榜的上限。封顶前后打出来的分不是一把尺子量的，所以照
 * bomb → bomb2 那条路往上加一版，老的 `square:flip` 原样归档（它不在 ALL_BOARDS
 * 里，重建时不撤人，存档里那些老局照旧算回它自己那张榜，见 kindOf）。
 */
const FLIP_KIND = 'flip2';
const KINDS = ['base', 'timed', BOMB_KIND, 'slot', FLIP_KIND, PUZZLE_KIND];

/** 这一局算哪一种。存档里那份 data 说了算（modeKey 加老虎机那个标记）。 */
function kindOf(data) {
  const mk = String(data?.modeKey || 'base');
  // 排在 timed 前面：步步为营这一局没有钟，modeKey 也不会是 'timed'，可顺序照
  // 规矩摆——一局只归一档，越专的档越先问。
  //
  // ⚠️ 比的是 **modeKey 那个字面量 `'puzzle'`**，不是 PUZZLE_KIND。两者从 2026-10-02
  // 起不是同一个字符串了（榜叫 'puzzle2'，而存档里 modeKey 永远是 'puzzle'）——照旧写
  // `mk === PUZZLE_KIND` 的话，每一局步步为营都会掉到最后一行去，归进 base 那张榜。
  // 老档没有 puzzleRules，读出来是 undefined，那是消线只退一步那一版，归老榜。
  if (mk === 'puzzle') return Number(data?.puzzleRules) >= 2 ? PUZZLE_KIND : 'puzzle';
  // 老档没有 flipRules，读出来是 undefined——那是没封顶那一版，归老榜。
  if (mk === 'flip') return Number(data?.flipRules) >= 2 ? FLIP_KIND : 'flip';
  // 老档没有 bombRules，读出来是 undefined——那是第一版规则，归老榜。
  // 三档：没有 bombRules 的老档是第 1 版，2 是留一枚永久炸弹那一版，3 起是现行规则。
  if (mk === 'bomb' || mk === 'bombTimed') {
    const v = Number(data?.bombRules) || 1;
    return v >= 3 ? BOMB_KIND : v >= 2 ? 'bomb2' : 'bomb';
  }
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
const LEGACY_BOARDS = [...BASE_SHAPES, ...LAYOUT_BOARDS, ...RETIRED_BOARDS];
/** 删掉的那几副棋盘在每一种玩法下的榜，重建时也要撤干净。 */
const RETIRED_BOARD_KEYS = RETIRED_BOARDS.flatMap((shape) => KINDS.map((kind) => `${shape}:${kind}`));

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
  flip: [`square:${FLIP_KIND}`, `circle:${FLIP_KIND}`],
  puzzle: BASE_SHAPES.map((s) => `${s}:${PUZZLE_KIND}`),
};
/** 合并一张母榜时，每张子榜先取前多少名。 */
const GROUP_SCAN = 200;

/*
 * ── 步步为营那几张榜上存的数：分数 ×1000，清盘的局再加剩下的步数（第 14 推）──────
 *
 * 玩家要的是「分数相同时，剩得多的排前面」。一张有序集合只有一个数可排，所以把两样拼进一
 * 个数里：`分数 × 1000 + 剩下的步数`。读的时候拆开（`decodeBoard`），榜上印的照旧是原
 * 综合分，清盘的局另外带一个 `left`。
 *
 * **没清盘的局也乘 1000**（只是不加步数）。方案原话是「清完全盘的局存 score×1000 +
 * min(left,999)」「没清盘的局排法不变」——要是没清盘的局还存原分，清盘的一局 300 分会排
 * 在没清盘的一局 3000 分前面（×1000 之后谁都比不过它），那就不是「分数相同时」才比剩几
 * 步了。全榜同一把尺子，没清盘的局之间的先后才真的一点没变。
 *
 * `stats.best` **不跟着乘**：它是原分，总榜（bestOverall）和母榜以外的地方都从它算，乘了
 * 总榜就被步步为营一档霸占。只有这几张榜上的那个数是拼起来的。
 *
 * 清盘认的是存档里那句与语言无关的终局原因（`src/engine/kinetics.ts` 的
 * `ALL_FLIPPED_REASON`，手抄过来，理由同 SCORING_RULES）。剩几步读 `data.puzzle.left`。
 *
 * **还没重建过的老数**：上线之前存进去的是原分（没乘 1000）。步步为营一局最多「枚数 ×
 * 10」分（方块 36 枚 → 360，小球 28 枚 → 280，见 push 里那道上限），所以榜上一个不到
 * 1000 的数只可能是老的原分，照原分读。管理员重建一次之后榜上就全是新写法了；在那之前这
 * 一条让老数照旧读得对，不会显示成 0 分。
 */
const PUZZLE_SCALE = 1000;
const ALL_FLIPPED_REASON = '全部方块已翻成点面';
const isPuzzleBoard = (boardId) => String(boardId).endsWith(`:${PUZZLE_KIND}`);
/** 清盘的局剩几步（封到 999，放得进那三位）；没清盘就是 0。 */
function puzzleLeft(data) {
  if (String(data?.reason || '') !== ALL_FLIPPED_REASON) return 0;
  const n = Math.floor(Number(data?.puzzle?.left));
  return Number.isFinite(n) && n > 0 ? Math.min(n, PUZZLE_SCALE - 1) : 0;
}
/** 这一局在这张榜上该存的那个数。不是步步为营的榜就是分数本身。 */
function boardValue(boardId, score, data) {
  return isPuzzleBoard(boardId) ? score * PUZZLE_SCALE + puzzleLeft(data) : score;
}
/** 榜上那个数 → 印出来的分数（＋ 清盘的局剩几步）。 */
function decodeBoard(boardId, v) {
  const n = Number(v) || 0;
  if (!isPuzzleBoard(boardId) || n < PUZZLE_SCALE) return { score: n };
  const left = n % PUZZLE_SCALE;
  const score = Math.floor(n / PUZZLE_SCALE);
  return left > 0 ? { score, left } : { score };
}
/**
 * 步步为营每副棋盘一共几枚。push 拿它给「分数不能超过枚数 × 10」那道上限封顶：客户端
 * 报的 `data.boardTiles` 只能往小里信，不能往大里信（报一个 999 枚就能把上限抬上天）。
 * 手抄的（`src/shapes/square.ts` 的 BOARD_DIM²、`circle.ts` 的 PER_COLOR × 4 色），哪天
 * 改了棋盘大小两处一起改；漏改的后果是那副棋盘的步步为营打满分时被拦，check-scores 量这件事。
 */
const PUZZLE_TILES = { square: 36, circle: 28 };

/** 一个账号有史以来最高的那一局：分数和玩法。一局都没有就是 null。 */
function bestOverall(stats) {
  let top = null;
  for (const [mode, score] of Object.entries(stats.best || {})) {
    const n = num(score);
    if (n > 0 && (!top || n > top.score)) top = { mode, score: n };
  }
  return top;
}
/*
 * id → 榜上显示的名字：`NAMES`（'lbnames'），一张哈希表，不是每人一个键。它和昵称索引
 * `NICK_INDEX` 两张表现在归 _nickname.js 管（第 16 推）——小屋那头也要读写同一份。
 */

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

/**
 * 名字这件事的版本号。第 3 推那一版的客户端跟着每一局报上来（`nameV: 2`）：到了 2 就表示
 * 「这个名字是玩家自己敲的」，而不是从他的凭据里猜出来的。
 *
 * 第 16 推起 push 不再写名字，这个数只剩**读老条目**一个用处（shownName）：库里那些 v2 和
 * 没有 v 的老名字，在管理员跑《建立昵称索引》之前照旧这样判。新登记的是 v3（_nickname.js
 * 的 NICK_V），比它大，读的时候直接放行。
 */
const NAME_V = 2;

/** 第一串被截成 12 位之后长什么样。PAIR_RE 是 8–64 位字母数字，截完就是 8–12 位。 */
const HANDLE_SHAPED = /^[A-Za-z0-9]{8,12}$/;

/**
 * 这个名字**长得像一份凭据**吗（#2，2026-10-02）。
 *
 * ── 那次泄露 ──────────────────────────────────────────────────
 *
 * `engine/cloudScores.ts` 的 `leaderboardName()` 从前在玩家没取名字时拿他的登录凭据
 * 顶上：免邮箱账号印第一串的前 12 位，邮箱账号印 `邮箱.split('@')[0]` 的前 12 位。两样
 * 都被摆到一张**公开**的榜上，而玩家没做任何选择、也完全不知道。
 *
 * 第一串那一种更糟：它**就是那把钥匙**（api/handle.js 顶上写着，知道第一串的人凭
 * `reset` 就能接管那个账号）。所以那不只是隐私，是把账号挂了出去。
 *
 * ── 为什么服务端也要判一遍 ────────────────────────────────────
 *
 * 客户端那一头已经改了（只报玩家自己敲的名字），可**旧版本的包还在外面跑**：装着旧
 * App 的手机、没刷新的那个标签页、小红书里那一份。它们照旧会把凭据报上来，而那一份名
 * 字会被存进 `lbnames`、然后出现在每一张榜上。所以这儿不信客户端：
 *
 *   · `nameV >= 2` —— 新客户端报的，玩家真敲过。**照存**（哪怕它正好长得像第一串：
 *     那是他自己取的名字）。
 *   · 没有 nameV —— 旧客户端。名字长得像凭据就**不存、也不显示**。
 *
 * （第 16 推起 push 一个名字都不存了——上面两条说的是那之前存进库里的老条目怎么读。新登记
 * 的昵称走改名接口，凭据形状在那儿当场拦，见 isOwnCredential。）
 *
 * ── 认哪两种形状 ──────────────────────────────────────────────
 *
 *   · `hdl:` 开头的 id（免邮箱账号）＋ 名字是 8–12 位字母数字 → 像第一串。
 *   · 名字正好等于这个邮箱 @ 前面那一截的前 12 位 → 像邮箱。
 *
 * 两条都会误伤一些**真的**昵称（一个邮箱叫 `panda@x.com`、昵称也取 `panda` 的人，名
 * 字会被当成泄露）。这是故意选的方向：误删一个昵称的代价是榜上那一行变成「匿名玩家」，
 * 而漏掉一个的代价是把一把钥匙挂在公开页面上。而且新客户端报上来的那一份带着 `nameV`，
 * 不受这两条管——所以那个人下次打一局，他的昵称就回来了。（第 16 推之后的说法：他登记一
 * 次昵称，那一行就回来了。）
 */
function leakShaped(id, name) {
  const who = String(id || '');
  const n = String(name || '');
  if (!n) return false;
  if (who.startsWith('hdl:') && HANDLE_SHAPED.test(n)) return true;
  const at = who.indexOf('@');
  if (at > 0 && n === who.slice(0, at).slice(0, 12)) return true;
  return false;
}

/**
 * 这一行榜上该印的名字。
 *
 * 读的时候再过一遍 `leakShaped`，不只在写的时候拦——因为**库里躺着的旧条目要到管理员
 * 跑一次 `rebuild { scrubNames: true }` 才清掉**，而那是手动的一次操作。在那之前每一张
 * 榜都在把它们印出来。两头都拦，才是「从这一刻起榜上看不到」。
 */
function shownName(id, row) {
  const name = String(row?.name || '');
  if (!name) return '';
  if (Number(row?.v) >= NAME_V) return name;
  return leakShaped(id, name) ? '' : name;
}

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
      case 'name':
        return await rename(res, body, who);
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
  const data = body?.data;
  if (!runId || !mode) return send(res, 400, { error: 'run' });
  /*
   * **带了 `data` 就得是一份记录**（对象，不是字符串、不是数组）。
   *
   * 它会被原样存进存档（`runs:`），而记录页、战绩图、重建都从那一份读；塞个字符串
   * 或者数组进来，存档里就多一条谁都读不懂的记录。
   *
   * 这一句排在下面那道规则闸**前面**，是因为它必须**够得着**：规则闸问的是
   * `data.rules`，而一个字符串、一个数组都答不出那个字段，于是一律走「旧客户端」那条
   * 温和的 200——摆在闸后面的话，这一句一辈子都跑不到（第一版就是这么写的：一道永远
   * 为假的门，看着在守，其实一行都没验过）。
   *
   * 反过来，**压根没带 `data`** 的仍然走那条温和的路，不在这儿拦：那正是在途的旧客户
   * 端该走的出口（见下面那段）。
   */
  if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    return send(res, 400, { error: 'data' });
  }

  /*
   * **只收现行这一版计分规则打出来的局**（《侵蚀阶梯》v1.2 §6）。
   *
   * 那一版把得分图案、翻面分、整线消除、综合分全换了一套，旧局和新局不是一把尺子
   * 量出来的——混在一张榜上比，就是把老局钉死在榜首（无限反转封顶那次的原话）。
   *
   * 回的是 **200 + stored: false**，不是 4xx：在途的旧客户端（没刷新的那个标签页、
   * 装着旧包的 App）打完那一局，他的结算页照常给他看，只是不入榜——给个错误码只会
   * 让他看见一句「上传失败」，而那一局本来就不该入榜，不是他的错。客户端那头照
   * `stored` 在结算页上注一句「本局不入榜」。
   */
  if (String(data?.rules || '') !== SCORING_RULES) {
    return send(res, 200, { ok: true, stored: false, reason: 'rules' });
  }

  /*
   * 限速。排在规则那一关后面，是因为那一关一次库都不碰（在途旧客户端走的就是它），
   * 而这一句本身是一次往返——先放掉最便宜的那条路，别让它去抢这个账号的额度。
   *
   * 到上限回 429。客户端对它和对「网抖了一下」是同一个反应：隔两秒重报一次，再不成
   * 这一局就不入榜了（engine/cloudScores.ts 的 pushRun）。这对真玩家不要紧——三百局
   * 一小时他根本到不了；到得了的那个人，丢的正是他灌进来的那些。
   */
  if (await tooMany('scores:push', who.id, PUSHES_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  /*
   * ── 这一份东西长得对不对 ───────────────────────────────────────
   *
   * 下面两道都是**格式**，不是反作弊：一个会开开发者工具的人照样能报一个真打不出来
   * 的分（文件头「关于作弊」那一段说清楚了，这儿不多担保一个字）。它们拦的是另一
   * 件事——**同一局在库里留下两份互相打脸的记录**。
   *
   * ① **榜上那个数和存档里那个数必须是同一个**（`score` ↔ `data.totalScore`，
   *    `mode` ↔ `data.shapeId`）。客户端本来就是从后者算出前者的（见
   *    engine/cloudScores.ts：`mode: data.shapeId`、`score: round(data.totalScore)`），
   *    所以对不上的只有手搓的请求。为什么非拦不可：**榜是 `score` 写的，重建是照
   *    存档里的 `run.score` 重算的，而玩家自己那一页画的是 `data.totalScore`**——
   *    对不上就成了「榜上写 999999，点开这一局的战绩图写 300」，而且谁都说不出哪
   *    个是真的。一局一个数，这是能便宜地守住的那一半。
   *
   * ② 那份 `data` 不许大过 DATA_MAX_CHARS（见上面那段：存档是整体读写的）。
   *
   * （「得是一份记录」那一条在上面，规则闸之前——理由写在那儿。）
   */
  if (num(data.totalScore) !== score || cleanMode(data.shapeId) !== mode) {
    return send(res, 400, { error: 'mismatch' });
  }
  if (JSON.stringify(data).length > DATA_MAX_CHARS) {
    return send(res, 400, { error: 'tooBig' });
  }
  /*
   * ③ **步步为营的分数不能超过「枚数 × 10」**（第 14 推）。这一档的综合分是「被消除的枚
   *    数 × 10 + 星星 × 5」（src/engine/puzzleScore.ts），满打满算就是一盘全消掉。超过这
   *    个数的只可能是手搓的请求——而且它会撞坏上面 PUZZLE_SCALE 那套拼法（分数一过 1000
   *    就分不清新老写法了）。枚数取客户端报的和服务端自己知道的那一个里**小的**。
   */
  if (String(data.modeKey || '') === 'puzzle') {
    const reported = Math.floor(Number(data.boardTiles));
    const known = PUZZLE_TILES[mode];
    const tiles = Math.min(reported > 0 ? reported : Infinity, known ?? Infinity);
    if (!Number.isFinite(tiles) || score > tiles * 10) {
      return send(res, 400, { error: 'score' });
    }
  }
  /*
   * **上限这件事先只记一笔，不拦。**
   *
   * `num()` 早就把存下来的数封在 MAX_SCORE 以内（文件头「关于作弊」），所以榜的刻度
   * 不会被一个坏数字毁掉——这一句不改那个，它只是把「真有人报出过超上限的分吗」记到
   * 日志里。先量再拦：现在还不知道正常打能打到多高（无限反转封顶那次就差点把正常高分
   * 一起拦掉），凭感觉在这儿加一条 4xx，第一个被拦住的很可能是个打得特别好的人。
   *
   * 日志里**不写他是谁**：`who.id` 就是邮箱地址（见 _entitlement 的 identify），而日志
   * 是会被整段贴进工单的东西。`runId` 已经足够把这一局找回来（它是「时刻-棋盘-玩法」，
   * 见 engine/cloudScores.ts 的 runIdOf），里头没有任何凭据。
   */
  if (Number(body?.score) > MAX_SCORE) {
    console.warn('[scores] over cap', { runId, mode, raw: Number(body.score), cap: MAX_SCORE });
  }

  // 这一局记在哪张榜上：基础三块棋盘分玩法，别的布局各一张（见 boardIdOf）。
  const boardId = boardIdOf(mode, data);
  /*
   * **玩家自己敲代号开的那一局不上榜**（10-08 方案 3-B，玩家拍板方案 A）。
   *
   * 代号就是那一副牌：知道代号，就能把同一副牌打到熟、再交一局「漂亮的」——这样的分和随
   * 手开的一局摆在一张榜上不公平。所以这一局照收：存档、累计得分、局数都照记（那是他自己
   * 的历史），只是**不进 best、不写任何一张榜**。best 也不能碰，是因为榜上那个数就是从
   * best 来的：今天让它进了 best，明天他随手打一局，那一局写榜时带上的正是这个 best。
   *
   * 每日挑战那一局（seedSource 'daily'）不在此列：它照常进常规榜，也照常进今日榜。认的是
   * 客户端报的来路，和别的字段一样只是格式，不是反作弊（文件头「关于作弊」）。
   */
  const ranked = data?.seedSource !== 'entered';
  /*
   * **名字一个字都不读**（第 16 推）。`body.name` / `body.nameV` 在途的旧客户端还会报上来，
   * 这里照收这一局、名字原样扔掉：昵称只有改名接口（rename）写得进来，否则一台装着旧包的
   * 手机打完一局，就把他在另一台设备上刚改好的名字盖回去了——那正是「换台手机打一局名字就
   * 变回去」那个毛病。
   */

  const got = await withLock(statsLockKey(who.id), async () => {
    const stats = await loadStats(who.id);
    // 同一局报两次不算两次。网差重发、返回键再点一下，都会走到这儿。
    if (stats.seen.includes(runId)) return { duplicate: true, stats };

    stats.total += score;
    stats.runs += 1;
    if (ranked) stats.best[boardId] = Math.max(stats.best[boardId] || 0, score);
    stats.seen = [runId, ...stats.seen].slice(0, KEEP_SEEN);
    await set(statsKey(who.id), stats);

    // 存档。整局的原始数据都留着——记录页要靠它把那张战绩图重新画出来。
    // 它必须和上面那份 stats 在同一把锁里：重建是从**存档**重算 best 的，两样
    // 分开写就会出现「存档里有这一局、汇总里没有」的半截状态。
    const archive = await get(runsKey(who.id));
    const list = Array.isArray(archive) ? archive : [];
    list.unshift({ runId, mode, score, at: Date.now(), data });
    await set(runsKey(who.id), list.slice(0, KEEP_RUNS));

    // 单局榜只上不下（GT）。总榜写的是他所有玩法里最高的那一局——覆盖写，
    // 因为它是从 stats.best 重算出来的：老版本往这里写的是累计总分，这一笔
    // 顺手把它改正。
    //
    // 步步为营那几张榜上是拼起来的数（boardValue）：这一局自己的那个数，和「历史最高分、
    // 不算步数」那个数，取大的。GT 会留住两者里更高的那一个，所以同分剩得多的那一局会顶
    // 掉剩得少的，老写法（原分）的那一行也在这个人下一次交卷时被换成新写法。
    //
    // 敲代号开的那一局（ranked 为假，见上）一张榜都不碰：存档写完就回去。
    if (!ranked) return { duplicate: false, stats };
    const onBoard = isPuzzleBoard(boardId)
      ? Math.max(boardValue(boardId, score, data), stats.best[boardId] * PUZZLE_SCALE)
      : stats.best[boardId];
    await zaddIfHigher(boardKey(boardId), onBoard, who.id);
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
  // 每日挑战那一局：再进一张「今日」榜（第 19 推）。只有这一局自称是每日挑战的时候才问；它照
  // 常记进存档和常规榜（上面那一段），这儿只决定今日榜收不收。
  //
  // **重报的那一次也问**（2026-10-08 方案 1-4）。从前 duplicate 那一支在这一句之前就回去了：
  // 头一次交卷时存档写成了、今日榜这一步却摔了（库抖一下、函数超时），客户端照规矩重报，被
  // 判成「同一局报两次」直接回——**今日榜从此永远缺这一局**，而玩家那边收到的是成功。pushDaily
  // 走 zaddIfHigher（只上不下），同一局再写一遍是幂等的，所以重报时照样写一次、回包照样带
  // daily，没有任何东西会被算两遍。
  const daily = data?.daily !== undefined ? await pushDaily(who.id, mode, score, data) : undefined;
  if (duplicate) {
    return send(res, 200, { ok: true, duplicate: true, total: stats.total, runs: stats.runs, daily });
  }
  return send(res, 200, { ok: true, total: stats.total, runs: stats.runs, best: stats.best, daily });
}

/**
 * 每日挑战那一局进「今日」榜（第 19 推）。回的是一个词：stored / late / rejected。
 *
 * 三道关，一道不过就不收（这一局本身照样记进存档和常规榜——它是一局真打出来的游戏，只是不算
 * 那一天的挑战）：
 *
 *   ① **日子**：`data.daily` 是一个真日期，而且就是服务器眼里的今天（北京时间）；零点之后
 *      DAILY_GRACE_MS 以内还收前一天的。服务器的钟说了算，不看客户端的。
 *   ② **种子**：`data.seed` 就是那一天的种子码——服务器自己算（dailySeed），不信客户端报的。
 *   ③ **玩法**：这一局的玩法和棋盘就是那一天轮到的那一个（VARIANTS[dailyVariant(day)]）。
 *
 * 步步为营那一天，榜上存的是拼起来的数（boardValue：分数 × 1000 ＋ 剩下的步数），和步步为营
 * 自己那几张榜一个规矩——同分剩得多的排前面。
 */
async function pushDaily(id, mode, score, data) {
  const day = dayIndexOfKey(String(data.daily ?? ''));
  if (day === null) return 'rejected';
  const now = Date.now();
  const today = dayIndexOf(now);
  const inGrace = day === today - 1 && now - dayStartOf(today) <= DAILY_GRACE_MS;
  if (day !== today && !inGrace) return day < today ? 'late' : 'rejected';
  if (normalizeSeed(data.seed) !== dailySeed(day)) return 'rejected';
  const want = VARIANTS[dailyVariant(day)];
  if (!want || want.board !== mode || seedModeOf(data.modeKey, mode, Boolean(data.slot)) !== want.mode) {
    return 'rejected';
  }
  const key = dailyBoardKey(dayKey(day));
  await zaddIfHigher(key, boardValue(dailyBoardId(want), score, data), id);
  await expire(key, DAILY_TTL_S);
  return 'stored';
}

/**
 * 那一天的玩法在常规榜里对应哪一张——只为了借 boardValue / decodeBoard 那一套（步步为营那一天
 * 要拼步数）。别的玩法不拼，回什么都一样。
 */
const dailyBoardId = (v) => (v.mode === 'puzzle' ? `${v.board}:${PUZZLE_KIND}` : v.board);

/** 我自己的存档和数字。是自己的东西，不设门。 */
async function mine(res, who) {
  const [stats, archive, nickname] = await Promise.all([
    loadStats(who.id),
    get(runsKey(who.id)),
    nicknameOf(who.id),
  ]);
  return send(res, 200, {
    ok: true,
    total: stats.total,
    runs: stats.runs,
    best: stats.best,
    // seen 是内部账本，不往外说。
    archive: Array.isArray(archive) ? archive : [],
    /*
     * 我的昵称（第 16 推）。服务器是唯一来源：客户端拿到它就盖掉本机那一份（src/engine/
     * nickname.ts 的 adoptServerNickname）。空串 = 还没登记过——老条目（v2）不算，见
     * _nickname.js 的 nicknameOf。
     */
    nickname,
  });
}

/** 一个帐号一小时最多改几次昵称（第 16 推，方案原数）。 */
const RENAMES_PER_HOUR = 10;

/**
 * 这个名字是不是**他自己的凭据**（第 16 推第 4 条）。
 *
 * 和 leakShaped 是同一件事的另一头：那边拦旧客户端从凭据里猜出来的名字，这边拦玩家自己把
 * 凭据敲成名字——多半不是故意的（「名字就填我平时用的那个呗」），可一个公开的榜上挂着他
 * 邮箱的前半截，和从前那次泄露没有两样。
 *
 *   · 邮箱帐号：等于 @ 前面那一整段，或者它的前 12 位（从前泄露的正是这个形状）。
 *   · 免邮箱帐号：服务器只存第一串的 sha256（_accounts.js 的 pairKey），猜不回原文——
 *     只认得出「名字就是整条第一串」那一种（第一串只有 8–12 位的时候）。截成前 12 位的
 *     那一种只有客户端认得出（它手上有原文），在 src/engine/nickname.ts 里拦。
 *
 * 比的是规范化之后的样子（nickKey）：`Panda` 和 `panda@x.com` 照样算撞上。
 */
function isOwnCredential(id, name) {
  const who = String(id || '');
  const key = nickKey(name);
  if (!key) return false;
  const at = who.indexOf('@');
  if (at > 0) {
    const local = nickKey(who.slice(0, at));
    return key === local || key === local.slice(0, 12);
  }
  return who.startsWith('hdl:') && pairKey(name) === who;
}

/**
 * 改昵称（第 16 推）：`POST /api/scores { action: 'name', name, …凭据 }`。
 *
 * 必须登录（handler 那一关的 identify 已经过了）。先验格式（不碰库）、再限速、最后进这个人那
 * 把锁里登记（_nickname.js 的 registerNickname）。
 *
 * 回的错只有那四种（required / bad / blocked / taken），外加限速和忙——客户端按它们各说一
 * 句话。**撞了哪个词不说**，名字被谁占了也不说。
 *
 * 和原来的名字一样（规范化之后、而且显示的样子也一样）就不登记、不扣次数：客户端「登录之
 * 后把本机的名字传上去」那一下多半就是这种，为它扣掉一次很冤。
 */
async function rename(res, body, who) {
  const checked = checkNickname(body?.name);
  if (!checked.ok) return send(res, 400, { error: checked.error });
  if (isOwnCredential(who.id, checked.name)) return send(res, 400, { error: 'blocked' });
  if ((await nicknameOf(who.id)) === checked.name) {
    return send(res, 200, { ok: true, name: checked.name });
  }
  if (await tooMany('scores:name', who.id, RENAMES_PER_HOUR, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  // 和 push / rebuild / 换邮箱同一把锁：换邮箱正在把这个人的名字搬到新 id 上的那几秒里，
  // 这边要是在旧 id 上登记一个新名字，搬过去的就是旧的那个，而索引上新名字指着一个马上就
  // 不存在的 id。
  const got = await withLock(statsLockKey(who.id), () => registerNickname(who.id, checked.name));
  if (!got.ok) return send(res, 503, { error: 'busy' });
  if (got.value === 'taken') return send(res, 409, { error: 'taken' });
  return send(res, 200, { ok: true, name: checked.name });
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
        // 步步为营那几张榜上是拼起来的数，这儿拆开（decodeBoard）：印的是原综合分，清
        // 盘的局多一个 left。别的母榜上 decodeBoard 原样返回。
        ...decodeBoard(row.board, row.score),
        name: shownName(row.member, names[row.member]),
        me: row.member === who.id,
        // 母榜上几块棋盘混在一起，所以每一行也画个小图形说明是哪一块。
        mode: row.board.split(':')[0],
      })),
      players: rows.length,
      me: mine < 0 ? null : { rank: mine + 1, score: decodeBoard(rows[mine].board, rows[mine].score).score },
    });
  }
  // 「今日」榜（第 19 推）：服务器眼里的今天那一张，前五十名＋我排第几。
  if (mode === 'daily') {
    const day = dayIndexOf(Date.now());
    const want = VARIANTS[dailyVariant(day)];
    const dkey = dailyBoardKey(dayKey(day));
    const [top, myScore, myRank, size, names] = await Promise.all([
      zTop(dkey, TOP_N),
      zscore(dkey, who.id),
      zrevrank(dkey, who.id),
      zcard(dkey),
      hgetall(NAMES),
    ]);
    const bid = dailyBoardId(want);
    return send(res, 200, {
      ok: true,
      mode,
      day: dayKey(day),
      rows: top.map((row, i) => ({
        rank: i + 1,
        ...decodeBoard(bid, row.score),
        name: shownName(row.member, names[row.member]),
        me: row.member === who.id,
      })),
      players: size,
      me: myScore === null ? null : { rank: (myRank ?? 0) + 1, score: decodeBoard(bid, myScore).score },
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
    // 步步为营的单张榜同样要拆（见 decodeBoard）；总榜和别的榜原样。
    ...(mode ? decodeBoard(mode, row.score) : { score: row.score }),
    name: shownName(row.member, names[row.member]),
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
    me:
      myScore === null
        ? null
        : { rank: (myRank ?? 0) + 1, score: mode ? decodeBoard(mode, myScore).score : myScore },
  });
}

// ---- 管理员维护 -----------------------------------------------------------

/** 一个来源一小时最多敲多少次门。和 api/mint.js 同一个数。 */
const CALLS_PER_HOUR = 20;

/**
 * 重建分批（10-08 方案第五批第 2 条：「榜单重建分批、可从断点续跑」）。
 *
 * 一个人要撤一遍所有的榜再写回去，几十次顺序往返；原先一次调用把名单上的人全算完，人一多就跑
 * 满函数时限被掐掉——掐在谁身上谁就停在半路，回包没发出去，管理员只看见一个超时，也不知道算到
 * 了哪儿。现在一次最多算 REBUILD_BATCH 个人、或者花满 REBUILD_BUDGET_MS 就停（先到哪个算哪个，
 * 至少算完一个），没算完就回一张「接着来」的票（resume）。
 *
 * 票存在库里（rebuildTicketKey），记着这一轮的选项和算到了谁——**每算完一个人就记一次**，所以就
 * 算哪一次调用真的被掐掉了，再带着同一张票来，也是从那个人后面接着算（掐在半路的那一个人重算一
 * 遍：一个人的重建本来就是幂等的）。名单按 id 排好序，「算到了谁」记的是最后一个 id，中途有新
 * 人上榜也不会让谁被算两遍或者漏掉一个老人。
 *
 * 40 秒是给 60 秒的函数时限（vercel.json 的 maxDuration，Hobby 档的上限）留的余量：一个人最慢
 * 也就几百毫秒，检查在每个人之间做。
 */
const REBUILD_BATCH = 100;
const REBUILD_BUDGET_MS = 40_000;
/** 票在库里留多久。一轮重建不会拖这么久；过期了就从头再点一次。 */
const REBUILD_TICKET_TTL_S = 3600;
const rebuildTicketKey = (t) => 'rebuild:resume:' + t;

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
  /*
   * 接着上一次没算完的那一轮：带着服务器发的票来（见 REBUILD_BATCH 那一段）。票在，这一次就不
   * 再计入限速——一轮分成二三十批是常事，每一批都算一次「敲门」，人一多重建自己先把一小时二十
   * 次用完了。不怕有人拿它绕开限速猜令牌：票只发给验过令牌的人，是 128 位随机数，猜不中；令牌
   * 照样每一次都验。不认识的票（过期了、编的）照普通的一次算，先撞限速。
   */
  const ticketId = typeof body?.resume === 'string' && /^[0-9a-f]{32}$/.test(body.resume) ? body.resume : null;
  const ticket = ticketId ? await get(rebuildTicketKey(ticketId)) : null;
  // 先限速，再验令牌——挡的正是「一直猜这个令牌」。和 api/mint.js 同一套
  // （_ratelimit.js），同一个数：管理员一小时重建不了几次榜，猜密码的人先撞上
  // 它。这一条尤其该限：重建要把全站每个人的存档翻一遍再重写所有榜，是站里最
  // 贵的一次调用，敲开门之前就已经不便宜了。
  if (!ticket && (await tooMany('scores:rebuild', callerId(req), CALLS_PER_HOUR, 3600))) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (!tokenOk(body?.token)) return send(res, 401, { error: 'wrong' });
  // 带了票、票却不在了（过期，或者那一轮已经算完删掉了）：说清楚，让管理员从头再点一次。
  if (body?.resume !== undefined && !ticket) return send(res, 410, { error: 'resume' });
  // 接着算的那几批，选项一律照票上记的（第一批定下的），不看这一次请求里写了什么——同一轮重建
  // 前后几批各按各的选项算，榜就成了几种规矩拼起来的。
  const opts = ticket?.opts ?? {
    drop: (Array.isArray(body?.drop) ? body.drop : []).map((k) => String(k)),
    all: body?.all === true,
    scrubNames: body?.scrubNames === true,
    nicknames: body?.nicknames === true,
  };
  const drop = new Set(opts.drop);
  /**
   * 全部清空：一张榜都不留。
   *
   * 和 drop 不是一回事——drop 是「这几种玩法别上榜」，要一一点名，漏一种就留一
   * 种。改记分尺子的时候要的是「全清」，点名法太脆（2026-09 改星星那套计分就撞
   * 上了：得把所有 kind 都数出来才算清干净）。
   *
   * 做法是干脆不算 best：下面那个 best 保持空的，于是每个人在每一张榜上都走
   * zrem 那一支，总榜连同行首那个玩法标记一起撤掉。
   *
   * **它是可逆的**：存档（runs:）一个字不动，所以再点一次**不勾**全清的《重建
   * 榜单》就会照存档把榜重算回来。反过来说也是个坑——清完之后别手滑再点一次普通
   * 重建，那会把旧尺子量出来的分从存档里请回榜上。
   */
  const wipeAll = opts.all === true;
  /**
   * 把库里那些**长得像凭据**的旧名字清掉（#2，见 leakShaped）。
   *
   * 这件事只有管理员手动跑一次：那些条目是旧客户端存进去的，没有任何自动的时机能认出
   * 「该清了」。读榜那一头已经在过滤它们了（`shownName`），所以这一步不是为了「榜上别
   * 印」——那已经做到了——而是为了**库里别留着**。一份存着的凭据和一份印出来的凭据，前
   * 者只是还没被人看见。
   *
   * ⚠️ **回包里一个名字都不许有，只回删了几条。** 这个接口的回包是会被贴进工单、贴进对
   * 话的（它就是给人看的那种维护接口），而要清的东西恰恰是凭据——把它们列出来等于把这
   * 次清理变成一次泄露。`v >= NAME_V` 的那些不动：那是玩家自己敲的昵称，哪怕它正好长得
   * 像第一串。
   */
  const scrubNames = opts.scrubNames === true;
  /**
   * 点名要 drop 的那几种，**它们的榜也要撤干净——包括已经归档的那几张**。
   *
   * `ALL_BOARDS` 只有现行的 kind（`KINDS`），而改过规则的老档位（`…:bomb`、
   * `…:flip`）不在里面：那是有意的，归档榜不该被每一次重建重写。可 `drop` 的意思
   * 是「这几种玩法别上榜」——点了名却清不掉，那句话就没做到。
   *
   * check-scores 的「《无限反转》母榜上一个人都没有了」逮到的正是这一处：给连击加
   * 封顶、`flip` → `flip2` 之后，`…:flip` 成了归档榜，rebuild 再也不碰它，那张榜上
   * 按老尺子量出来的分就永远留在那儿。`…:bomb` 其实一直有同一个洞，只是没人点过
   * 它的名。
   */
  const droppedBoards = [...drop].flatMap((kind) => BASE_SHAPES.map((shape) => `${shape}:${kind}`));
  /**
   * 建立昵称索引（第 16 推第 8 条，一次性迁移）：把 `lbnames` 里那些老条目整理成「一个帐号
   * 一个、全站唯一」，补齐 `nickidx`。见文件末尾的 buildNicknameIndex。
   *
   * 排在榜重算**之后**做：重名时谁留下名字看的是总榜分数，要拿重算过的那一份比。
   */
  const buildNicknames = opts.nicknames === true;

  // 所有可能在榜上的人：总榜上的（有过正分就在）加上留过名字的。按 id 排好序，「算到了谁」
  // 才说得清（见 REBUILD_BATCH 那一段）；这一批只算排在上一批最后那个人后面的。
  const [ranked, names] = await Promise.all([zTop(TOTAL_BOARD, 5000), hgetall(NAMES)]);
  const after = ticket ? String(ticket.after ?? '') : '';
  const ids = [...new Set([...ranked.map((row) => row.member), ...Object.keys(names || {})])]
    .sort()
    .filter((id) => id > after);
  /** 这一轮的票：头一批就开一张，每算完一个人更新一次，算完删掉。 */
  const tid = ticketId ?? randomBytes(16).toString('hex');
  const tally = {
    players: Number(ticket?.players) || 0,
    rows: Number(ticket?.rows) || 0,
    skipped: Number(ticket?.skipped) || 0,
    namesDropped: Number(ticket?.namesDropped) || 0,
  };
  const saveTicket = (lastId) =>
    set(rebuildTicketKey(tid), { opts, after: lastId, ...tally, startedAt: ticket?.startedAt ?? Date.now() }, REBUILD_TICKET_TTL_S);
  // 门里用 batch 把一轮拆成好几批来量（只许往小里调）。
  const batch = Math.max(1, Math.min(REBUILD_BATCH, Math.floor(Number(body?.batch)) || REBUILD_BATCH));
  const startedAt = Date.now();

  let namesDropped = 0;
  // 清旧名字是对整张名单做一遍，只在一轮的头一批做。
  if (scrubNames && !ticket) {
    for (const [id, row] of Object.entries(names || {})) {
      if (!row || Number(row.v) >= NAME_V) continue;
      if (!leakShaped(id, row.name)) continue;
      await hdel(NAMES, id);
      namesDropped++;
    }
  }

  tally.namesDropped += namesDropped;
  if (!ticket) await saveTicket('');

  let handled = 0;
  for (const id of ids) {
    // 这一批到头了：人数够了，或者时候不早了（至少算完一个人，不然一轮永远走不完）。
    if (handled >= batch || (handled > 0 && Date.now() - startedAt > REBUILD_BUDGET_MS)) break;
    handled++;
    const got = await withLock(statsLockKey(id), async () => {
      const [stats, archive] = await Promise.all([loadStats(id), get(runsKey(id))]);
      const runs = Array.isArray(archive) ? archive : [];

      const best = {};
      /*
       * 榜上该写的那个数。多数榜就是 best；步步为营那几张是拼起来的数（boardValue：分数 ×
       * 1000，清盘的局加剩下的步数），要按每一局单独算再取最大——同分的两局，剩得多的那
       * 一局才是该上榜的。这一步也是老写法（原分）换成新写法的那一次（见 PUZZLE_SCALE）。
       */
      const onBoard = {};
      // 全清那一路直接跳过：best 空着，下面每张榜都走 zrem。
      if (!wipeAll) {
        for (const run of runs) {
          const mode = cleanMode(run?.mode);
          if (!mode) continue;
          // 上一套计分规则打的局不再上榜（《侵蚀阶梯》v1.2 §6）。存档里留着它们
          // ——那是这个人的历史，没必要毁掉——但重建的时候一律跳过，否则每点一次
          // 《重建榜单》都会把旧尺子量出来的分请回榜上（`flip` → `flip2` 那次踩
          // 过一模一样的一脚，见下面那段）。
          if (String(run?.data?.rules || '') !== SCORING_RULES) continue;
          if (drop.has(kindOf(run?.data))) continue;
          // 敲代号开的那一局：存档里留着，重建时也不上榜（和 push 那一处同一条，10-08 方案 3-B）。
          if (run?.data?.seedSource === 'entered') continue;
          const boardId = boardIdOf(mode, run?.data);
          const score = num(run.score);
          if (score > 0 && score > (best[boardId] || 0)) best[boardId] = score;
          if (score > 0) {
            const v = boardValue(boardId, score, run?.data);
            if (v > (onBoard[boardId] || 0)) onBoard[boardId] = v;
          }
        }
      }

      let rows = 0;
      // 先撤干净：新榜、老榜都撤，没算出成绩的那几张就此空着。
      for (const boardId of [...ALL_BOARDS, ...LEGACY_BOARDS, ...RETIRED_BOARD_KEYS, ...droppedBoards]) {
        if (best[boardId] === undefined) await zrem(boardKey(boardId), id);
      }
      for (const boardId of Object.keys(best)) {
        // zadd 而不是 zaddIfHigher：这一次要的正是把它改成重算出来的那个数。
        await zadd(boardKey(boardId), onBoard[boardId], id);
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
        // 行首那个玩法小图形靠 TOTAL_MODE 画。人从总榜上撤了，这一格也得撤——
        // 留着就是一条指向不存在的行的死数据。
        await hdel(TOTAL_MODE, id);
      }
      return rows;
    });
    /** 这一轮没抢到锁、因此原样放过的人（正在打这一局的人就落在这里）记个数。 */
    if (!got.ok) tally.skipped++;
    else {
      tally.rows += got.value;
      tally.players++;
    }
    await saveTicket(id);
  }

  // 没算完：回票，管理员页带着它接着来（public/mint.html 的《重建榜单》会自己接着点）。
  if (handled < ids.length) {
    return send(res, 200, { ok: true, done: false, resume: tid, players: tally.players, skipped: tally.skipped, left: ids.length - handled });
  }

  await del(rebuildTicketKey(tid));
  // 昵称索引排在榜重算之后（重名时谁留下看重算过的总榜分数），所以等最后一批算完才做。
  const nicknames = buildNicknames ? await buildNicknameIndex() : null;
  return send(res, 200, {
    ok: true,
    done: true,
    players: tally.players,
    rows: tally.rows,
    skipped: tally.skipped,
    dropped: [...drop],
    wiped: wipeAll,
    // 只有一个数（理由见 scrubNames 那一段：这个回包不许带名字）。
    namesDropped: tally.namesDropped,
    // 同上：只有几个数。没勾这一项就是 null。
    nicknames,
  });
}

/**
 * 一次性迁移：建立昵称索引（第 16 推第 8 条）。
 *
 * 第 16 推之前名字是随每一局报上来的，所以 `lbnames` 里躺着的是一堆没人管过唯一性的老条
 * 目（v2 和没有 v 的）。这一步把它们整理成和改名接口一样的样子：
 *
 *   ① **先合并已经绑定了邮箱的 `code:` 行。** 兑了码还没绑邮箱的人，战绩记在 `code:<码>`
 *      底下；后来他绑了邮箱（api/passcode.js 的 bind），那个寄存处被整个取走（GETDEL），
 *      人从此住在邮箱那个 id 底下，接着打的每一局、报的名字都在那边。留在 `code:` 底下
 *      的那一行名字没有主人了——谁也登不进一个不存在的帐号——却还会和他自己邮箱底下那一
 *      行抢同一个名字。所以寄存处已经不在的 `code:` 行，名字并到他现在那个帐号上去：**库
 *      里没有「这张码绑到了哪个邮箱」的记录**（bind 不留），所以「并」只能是把这一行撤
 *      掉，他的名字由邮箱底下那一行代表。寄存处还在的（码兑了、还没绑邮箱）是活帐号，照
 *      常参加下面的整理。
 *   ② **不能用的名字清掉**：读不出来的（shownName 判成像凭据的老条目）、过不了改名接口
 *      那一关的（超过 12 个码点、词表、保留名、单个字母——从前小屋发的「B」就是这么上了
 *      榜的）。不清的话索引里就有一个改名接口自己都不收的名字。
 *   ③ 索引里指向「已经不叫这个名字的帐号」的格子删掉（某次改名摔在两步之间留下的）。
 *      排在挑人之前：不删的话，下面抢索引会撞上这一格，整组人一个名字都留不下。
 *   ④ **按规范化之后的名字分组，一组只留一个**：
 *        · 索引里这个名字已经登记了（第 16 推上线之后、迁移之前有人从改名接口登记过），
 *          而且那个帐号此刻真叫这个名字 → 归他。那是一次明明白白的「这个名字我要了」，
 *          比老条目谁分高更算数；
 *        · 否则总榜分数最高的那个帐号留下（玩家定的），分数一样按 id 排、取第一个，保证
 *          重跑一遍结果一样。
 *      其余的清掉——下次他打开网页，头卡上写的是「设置昵称」。
 *   ⑤ 留下来的写成 v3、补进索引。写索引用 HSETNX：迁移跑着的这几秒里要是正好有人从改名
 *      接口抢到了这个名字，**他先到**，迁移这边让出来。
 *
 * 每清一行之前都重读一遍（见 clear）：迁移读完整张表之后，有人从改名接口登记了新名字，那
 * 一行就不是迁移手上那一份了，不动它。
 *
 * ⚠️ **回包只有计数，一个名字都不许有。** 理由和 scrubNames 一样：这个接口的回包是会被
 * 贴进工单、贴进对话的，而清掉的那些名字里可能正有当年泄露出去的凭据。
 *
 * 跑两遍和跑一遍一样（第二遍时所有条目都已经是 v3、索引都对得上，什么都不动）。
 */
async function buildNicknameIndex() {
  let merged = 0;
  let invalid = 0;
  let cleared = 0;
  let indexed = 0;
  let stale = 0;

  const rows = await hgetall(NAMES);
  /**
   * 两份是不是同一行：名字一样、版本一样。版本按字符串比——老条目压根没有 `v`，
   * `Number(undefined)` 是 NaN，而 NaN 和谁都不相等（第一版就是这么写的，于是没有 v 的老条
   * 目永远「对不上」，一条都清不掉、一条都留不下来）。
   */
  const sameRow = (a, b) => Boolean(a && b) && a.name === b.name && String(a.v ?? '') === String(b.v ?? '');
  /**
   * 清掉一行之前**重读一遍**：迁移读完整张表之后的这几秒里，这个人可能刚从改名接口登记了一
   * 个名字（v3）。那是他此刻明明白白的选择，迁移手上那份是旧的——对不上就不动他。
   */
  const clear = async (id, seen) => {
    const now = await hget(NAMES, id);
    if (!sameRow(now, seen)) return false;
    await hdel(NAMES, id);
    return true;
  };

  // ① 绑定过邮箱的 code: 行。
  for (const id of Object.keys(rows)) {
    if (!id.startsWith('code:')) continue;
    if (await loadAccount(id)) continue;
    if (await clear(id, rows[id])) merged++;
    delete rows[id];
  }

  // ② 不能用的名字；顺手按规范化之后的名字分组（④ 用）。
  const groups = new Map();
  for (const [id, row] of Object.entries(rows)) {
    const shown = shownName(id, row);
    const checked = shown ? checkNickname(shown) : { ok: false };
    if (!checked.ok) {
      if (await clear(id, row)) invalid++;
      continue;
    }
    const key = nickKey(checked.name);
    const list = groups.get(key) ?? [];
    list.push({ id, name: checked.name, row });
    groups.set(key, list);
  }

  // ③ 索引里过期的格子：指着一个「已经不叫这个名字」的帐号（某次改名摔在两步之间留下的）。
  // 放在分组**之后**、挑人**之前**：不删的话，下面 HSETNX 会撞上这一格，整组人一个名字都留
  // 不下。
  for (const [key, id] of Object.entries(await hgetall(NICK_INDEX))) {
    const row = rows[id];
    const holds = row && Number(row.v) >= NICK_V && typeof row.name === 'string' && nickKey(row.name) === key;
    if (holds) continue;
    // 重读：这一格这几秒里要是刚被人登记过（改名接口），它就不是过期的。
    const live = await hget(NAMES, id);
    if (live && Number(live.v) >= NICK_V && nickKey(live.name) === key) continue;
    if ((await hget(NICK_INDEX, key)) !== id) continue;
    await hdel(NICK_INDEX, key);
    stale++;
  }

  // ④ 一组只留一个。
  for (const [key, list] of groups) {
    const owner = await hget(NICK_INDEX, key);
    const registered = typeof owner === 'string' ? list.find((m) => m.id === owner) : null;
    let keep = registered && Number(registered.row?.v) >= NICK_V ? registered : null;
    if (!keep) {
      const scored = await Promise.all(
        list.map(async (m) => ({ ...m, score: Number(await zscore(TOTAL_BOARD, m.id)) || 0 })),
      );
      scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      keep = scored[0];
    }
    // ⑤ 留下来的那一个：先抢索引（HSETNX），抢到了（或者本来就是他）才写成 v3。抢不到——这
    // 几秒里有人从改名接口登记了这个名字——他先到，这一组一个都不留（他自己那一行是 v3、和手
    // 上这份对不上，clear 不会动他）。
    let won = await hsetnx(NICK_INDEX, key, keep.id);
    if (!won) won = (await hget(NICK_INDEX, key)) === keep.id;
    if (won) {
      const now = await hget(NAMES, keep.id);
      if (sameRow(now, keep.row)) {
        await hset(NAMES, keep.id, { name: keep.name, v: NICK_V });
        indexed++;
      } else if (!(now && Number(now.v) >= NICK_V && nickKey(now.name) === key)) {
        // 这几秒里他自己改成了别的名字：刚抢到的这一格不是他的了，还回去。
        if ((await hget(NICK_INDEX, key)) === keep.id) await hdel(NICK_INDEX, key);
        won = false;
      }
    }
    for (const m of list) {
      if (won && m.id === keep.id) continue;
      if (await clear(m.id, m.row)) cleared++;
    }
  }

  return { merged, invalid, cleared, indexed, stale };
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
  // 昵称那一行（{ name, v }）原样抄过去，索引在最后才改指（见下面）。
  const name = await hget(NAMES, from);

  if (stats) await set(statsKey(to), stats);
  if (runs) await set(runsKey(to), runs);
  if (name) await hset(NAMES, to, name);

  // 每一张他上过的榜。zadd 而不是 zaddIfHigher：新 id 上本来就该是这个数，
  // 而不是「和已有的比一比」——新邮箱按规矩是个没有账号的地址，榜上不该有它。
  //
  // 抄的是**榜上现在那个数**，不是 stats.best：步步为营那几张榜上存的是拼起来的数（分数
  // × 1000 + 剩下的步数，见 PUZZLE_SCALE），照 best（原分）抄过去，搬一次家他在那张榜上
  // 就从 300000 掉成 300。榜上没有他（还没上过榜、或者被清过）才退回 best。
  const best = (stats && typeof stats.best === 'object' && stats.best) || {};
  for (const [boardId, score] of Object.entries(best)) {
    const n = Number(score) || 0;
    if (n <= 0) continue;
    const there = await zscore(boardKey(boardId), from);
    await zadd(boardKey(boardId), there === null ? boardValue(boardId, n, null) : there, to);
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
  /*
   * 昵称索引那一格改指向新 id（第 16 推第 7 条）。**排在拆旧名字的前一步、而不是和上面抄名
   * 字那一步放在一起**：中间任何一步摔了，email.js 会把新地址整个退回去（deleteAccount →
   * dropNickname 会删掉指向新 id 的那一格）；要是索引早早就改指了新 id，退回去之后旧 id 底
   * 下的名字就成了一个没登记的名字，别人取得走。挪到这儿，摔在前面的都还指着旧 id。
   */
  await repointNickname(name, from, to);
  await hdel(NAMES, from);

  // 旧 id 下的存档最后清。到这一行为止，新 id 那边什么都齐了。
  await del(statsKey(from));
  await del(runsKey(from));
}
