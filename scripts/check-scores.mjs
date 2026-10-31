/**
 * 战绩存云端 + 两张排行榜，在一个进程里从头走一遍。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-scores.mjs
 *
 * 不起浏览器也不起服务器：直接叫 api/scores.js 的 handler，用内存里那个
 * Redis 替身。要验的是几件容易写错、又不会报错的事：
 *
 *   · 令牌对不上就什么都拿不到（不是「先当作是他」）；
 *   · 同一局报两次不会被算两次；
 *   · 单局榜只上不下——打了一局差的，榜上还是那个最好的；
 *   · 看榜是三行筛选（族 / 普通·Pro / 玩法，10-31 方案推14 Z-B15）：选中的几张榜合起来，每人取最高的那一局；默认
 *     「全部 · 全部 · 全部」就是原先的总榜（旧总榜 lb:total 退役，不再写、不再读）；行上带着那一局是哪副棋盘、哪个
 *     玩法、是不是 Pro；
 *   · 同分同名次（Z-B16）；
 *   · 「我排第几」在我不在前五十名的时候也要对；
 *   · 每日挑战、小屋、敲代号开的局都进对应玩法的常规榜（Z-B17，推翻 10-08 方案 3-B）；
 *   · 重建能照存档重算，并且清得掉指定的那一种局。
 */
process.env.ALLOW_MEMORY_STORE = '1';

const { default: handler } = await import('../api/scores.js');
const accounts = await import('../api/_accounts.js');
const store = await import('../api/_store.js');

import { readFileSync } from 'node:fs';
import { fakeRun, fillRun } from './lib/fakeRun.mjs';

let fail = 0;

const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 现行的计分规则版本，从 `src/engine/scoring.ts` 现读。
 *
 * 服务端**手抄**了一份（`api/` 是纯 .js、import 不进 ts），下面有一条断言专门钉
 * 「两处一个字不差」——漏改一处的后果是全站没有一局入得了榜，而屏幕上一个字的错都
 * 没有。
 */
const SCORING_V = (() => {
  const src = readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8');
  const m = /export const SCORING_RULES_VERSION = '([^']+)'/.exec(src);
  if (!m) throw new Error('读不到 SCORING_RULES_VERSION');
  return m[1];
})();

/**
 * 叫一次接口，把状态码和回包一起拿回来。
 *
 * **交卷那一路自动补上现行的规则版本**：服务端只收现行这一版（《侵蚀阶梯》v1.2
 * §6），而这道门测的是交卷、排榜、存档那一整套，不是版本闸。版本闸另有一条断言，
 * 那一条故意不补。
 *
 * **顺手把那两处对齐**（`data.totalScore` ← `score`、`data.shapeId` ← `mode`）：真客户
 * 端报的就是这样——它那两个字段正是从 `data` 里算出来的（engine/cloudScores.ts：
 * `mode: data.shapeId`、`score: round(data.totalScore)`），而服务端 2026-10-03 起要
 * 求两处说同一件事（对不上就 400 mismatch，见 check-scores-guard）。这道门从前的
 * 夹具只填一半，于是每一条都踩在那道新检查上——**夹具欠的债，不是服务端松了口**。
 * 显式写了 `data` 的那几条照旧按自己写的来（下面那两条「旧规则的局」就是），所以这
 * 一补不会盖掉任何一条有意摆出来的不一致。
 */
/**
 * **名字先从改名接口登记，push 本身不带名字**（第 16 推）。
 *
 * 这道门是靠名字认榜上哪一行是谁的（夹具里每一局都带一个 `name`）。第 16 推起服务器不读 push
 * 里的名字了——昵称只走改名接口（`action: 'name'`），push 带的 `name` 原样扔掉。所以在这儿替
 * 夹具做新客户端会做的那件事：报这一局之前，先把那个名字登记成这个帐号的昵称（同一个帐号同
 * 一个名字只登记一次），然后报一局不带名字的。名字登记不上就当场停：后面每一条都靠名字认人，
 * 带着一张没名字的榜往下量只会红出一串跟名字无关的假症状。
 */
/**
 * 步步为营那一局「被消除几枚、几颗星」：拼得出这个综合分（被消除 × 10 + 星 × 5），两样加起来不超过
 * 全盘 36 枚。10-11 方案 A-3 起服务器对这一笔账（api/_maxscore.js 的 vetRun），原先夹具写死的
 * `cleared: 0, stars: 0` 配一个 300 分就对不上了。这道门量的是榜，不是这笔账——摆一份对得上的就行。
 * （361、900 那几条拦在「枚数 × 10」那道闸上，比对账早，这儿拼出个小数也碰不到。）
 */
function pzTally(score) {
  const cleared = Math.min(36, Math.floor(score / 10));
  return { cleared, stars: (score - cleared * 10) / 5 };
}

const registered = new Map();
async function call(body) {
  if (body?.action === 'push' && typeof body.name === 'string' && body.name) {
    const who = body.email || body.code;
    if (registered.get(who) !== body.name) {
      const got = await callRaw({ action: 'name', email: body.email, code: body.code, token: body.token, name: body.name });
      if (got.status !== 200) {
        throw new Error(`夹具登记昵称没成：${who} ${JSON.stringify(body.name)} → ${got.status} ${JSON.stringify(got.payload)}`);
      }
      registered.set(who, body.name);
    }
    const { name: _name, ...rest } = body;
    body = rest;
  }
  return callRaw(body);
}

async function callRaw(body) {
  if (body?.action === 'push' && !body.__raw) {
    /*
     * 明细由夹具拼齐（10-11 方案 A-3，scripts/lib/fakeRun.mjs）：服务器从那以后对每一局对一遍账，缺
     * 字段的一局不上榜，而这道门量的是榜本身。夹具按这一局的棋盘、玩法、分数拼一份对得上的明细，
     * 这道门自己写的那几位（modeKey、slot、seedSource……）盖在上面。
     *
     * 「第几版规则」那几位（bombRules / flipRules / puzzleRules）**只用这道门自己写的**：好几节故意
     * 不写它们，好让那一局落进归档的老榜（square:bomb、square:flip……）——夹具默认带的现行版本会把
     * 那几局搬到现行榜上去，量的就不是那件事了。
     */
    body = { ...body, data: { ...fillRun(body.mode, body.score, body.data || {}), rules: SCORING_V } };
  }
  const req = { method: 'POST', body };
  const res = {
    code: 200,
    payload: null,
    status(c) { res.code = c; return res; },
    setHeader() { return res; },
    end(text) {
      try { res.payload = JSON.parse(text); } catch { res.payload = text; }
      return res;
    },
  };
  await handler(req, res);
  return { status: res.code, payload: res.payload };
}

/** 造一个已经开通了的账号，返回它的登录令牌。 */
async function makePlayer(email, days = 30) {
  const account = accounts.newAccount('secret', 'code');
  account.until = Date.now() + days * 24 * 3600e3;
  await accounts.saveAccount(email, account);
  return { email, token: account.token };
}

/** 一个认得出、但权益已经过期的账号——他上得了榜，看不了榜。 */
async function makeLapsed(email) {
  const account = accounts.newAccount('secret', 'code');
  account.until = Date.now() - 1000;
  await accounts.saveAccount(email, account);
  return { email, token: account.token };
}

/**
 * 看一张（几张合并的）榜（推14 Z-B15）：`q` 是三行选择 { families?, tiers?, modes? }（不传 = 全部），或 { mode: 'daily' }。
 *
 * 合并榜在服务端缓存 15 秒（`lbq:`）：这道门一路交卷、一路看榜，缓存会让刚交的局看不见——每次看之前把那几格删掉。
 * 缓存本身另有 check-lb-merge 量（第二次请求命中缓存、ZRANGE 不再增加）。
 */
async function board(who, q = {}) {
  for (const k of await store.scanKeys('lbq:*')) await store.del(k);
  return call({ action: 'board', ...who, ...q });
}
/** 常用的几种选择。方块族的基础 = 经典方块 + 菱形方块两张（这道门里没人打菱形方块，所以等于经典方块那一张）。 */
const SQ_BASE = { families: ['square'], modes: ['base'] };
const ALL = {};

const A = await makePlayer('a@example.com');
const B = await makePlayer('b@example.com');
const C = await makeLapsed('c@example.com');

// ---- 认人 ---------------------------------------------------------------
const noToken = await call({ action: 'mine', email: A.email });
check('没有令牌，什么都拿不到', noToken.status === 401, JSON.stringify(noToken.payload));

const wrongToken = await call({ action: 'mine', email: A.email, token: 'nope' });
check('令牌不对也拿不到', wrongToken.status === 401, JSON.stringify(wrongToken.payload));

const empty = await call({ action: 'mine', ...A });
check('新账号是一张白纸', empty.payload?.total === 0 && empty.payload.archive.length === 0,
  JSON.stringify(empty.payload));

// ---- 交一局 -------------------------------------------------------------
const one = await call({
  action: 'push', ...A, runId: 'r1', mode: 'square', score: 500, name: '甲',
  data: { shapeId: 'square', totalScore: 500 },
});
check('第一局收下了', one.payload?.ok === true && one.payload.total === 500,
  JSON.stringify(one.payload));

const again = await call({ action: 'push', ...A, runId: 'r1', mode: 'square', score: 500 });
check('同一局报两次不算两次', again.payload?.duplicate === true && again.payload.total === 500,
  JSON.stringify(again.payload));

// 同一个玩法打了一局更差的：总分要涨，单局榜不能掉。
await call({ action: 'push', ...A, runId: 'r2', mode: 'square', score: 120 });
const mineA = await call({ action: 'mine', ...A });
check('总分是两局加起来', mineA.payload?.total === 620, JSON.stringify(mineA.payload?.total));
check('单局最好成绩还是 500', mineA.payload?.best?.['square:base'] === 500,
  JSON.stringify(mineA.payload?.best));
check('存档里两局都在，新的在前', mineA.payload?.archive?.length === 2 &&
  mineA.payload.archive[0].runId === 'r2', JSON.stringify(mineA.payload?.archive?.map((r) => r.runId)));
check('存档留着整局的原始数据（记录页要靠它重画战绩图）',
  mineA.payload?.archive?.[1]?.data?.totalScore === 500);

// 离谱的分数：超出这副棋盘在规则下打得出的最大值（10-11 方案 A-3：小球一局最多 504,896），回 400
// implausible，**什么都不写**——从前它照收、记进 best，总榜第一就是它。
const absurd = await call({ action: 'push', ...A, runId: 'r3x', mode: 'circle', score: 999999999 });
const afterAbsurd = await call({ action: 'mine', ...A });
check('离谱的分数被拒（400 implausible），存档、累计、榜一样都没进',
  absurd.status === 400 && absurd.payload?.error === 'implausible' &&
    afterAbsurd.payload?.total === 620 && afterAbsurd.payload?.best?.['circle:base'] === undefined &&
    !afterAbsurd.payload?.archive?.some((r) => r.runId === 'r3x'),
  `${absurd.status} ${JSON.stringify(absurd.payload)} total=${afterAbsurd.payload?.total}`);
// 一局打得出来的高分照收：甲在小球上那一局就是下面总榜上他那一行。
await call({ action: 'push', ...A, runId: 'r3', mode: 'circle', score: 4000 });
const capped = await call({ action: 'mine', ...A });
check('打得出来的高分照收', capped.payload?.best?.['circle:base'] === 4000,
  JSON.stringify(capped.payload?.best));

// ---- 第二个人 -----------------------------------------------------------
await call({ action: 'push', ...B, runId: 's1', mode: 'square', score: 900, name: '乙' });
await call({ action: 'push', ...B, runId: 's2', mode: 'square', score: 100 });

// ---- 榜 -----------------------------------------------------------------
const squareBoard = await board(A, SQ_BASE);
check('单局榜按最好的那一局排', squareBoard.payload?.rows?.map((r) => r.score).join() === '900,500',
  JSON.stringify(squareBoard.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
check('榜上写的是玩家自己取的名字',
  squareBoard.payload?.rows?.map((r) => r.name).join() === '乙,甲',
  JSON.stringify(squareBoard.payload?.rows?.map((r) => r.name)));
check('自己那一行标出来了', squareBoard.payload?.rows?.filter((r) => r.me).length === 1);
check('「我排第几」是第二', squareBoard.payload?.me?.rank === 2 && squareBoard.payload.me.score === 500,
  JSON.stringify(squareBoard.payload?.me));

const totalBoard = await board(A, ALL);
// 默认选择（全部 · 全部 · 全部）就是原先的总榜：每人上榜的是他所有玩法里最高的那一局——甲是圆球那一局
// （4000），乙是方块的 900。不是累计总分。
check('默认选择（全部）：每人各玩法里最高的那一局，不是累计总分',
  totalBoard.payload?.rows?.map((r) => r.score).join() === '4000,900',
  JSON.stringify(totalBoard.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
check('每一行带着那一局是哪副棋盘、哪个玩法（画行首那两枚小图用）',
  totalBoard.payload?.rows?.map((r) => `${r.board}/${r.kind}/${r.pro}`).join() === 'circle/base/false,square/base/false',
  JSON.stringify(totalBoard.payload?.rows?.map((r) => `${r.board}/${r.kind}/${r.pro}`)));
check('单张榜上的行也带着棋盘和玩法（行首图照画），而且就是那一张',
  squareBoard.payload?.rows?.every((r) => r.board === 'square' && r.kind === 'base' && r.pro === false),
  JSON.stringify(squareBoard.payload?.rows?.map((r) => `${r.board}/${r.kind}`)));
check('默认选择上「我排第几」也是按最高单局算的', totalBoard.payload?.me?.rank === 1 && totalBoard.payload.me.score === 4000,
  JSON.stringify(totalBoard.payload?.me));
check('回包里不带人数（players，lb-filter §10 删了）', !('players' in (totalBoard.payload ?? {})), Object.keys(totalBoard.payload ?? {}).join(' '));

const otherMode = await board(A, { families: ['triangle'] });
check('没人打过的玩法，榜是空的', otherMode.payload?.rows?.length === 0);
check('自己没打过就没有名次（不是第一名）', otherMode.payload?.me === null,
  JSON.stringify(otherMode.payload?.me));

// ---- 门开在看的那一侧 ---------------------------------------------------
await call({ action: 'push', ...C, runId: 't1', mode: 'square', score: 700, name: '丙' });
const lapsedBoard = await board(C, SQ_BASE);
// 10-31 方案推11 Z-J01（10-14 F-1 c）：看榜只要登录，权益过期了也照看——原先这一条是「过期 → 403 geniusOnly」。
check('权益过期的人登录着照样看得了榜（200，不再是 403 geniusOnly）', lapsedBoard.status === 200,
  `${lapsedBoard.status} ${JSON.stringify(lapsedBoard.payload)}`);

const withC = await board(A, SQ_BASE);
check('但他打的成绩确确实实在榜上（上榜不要钱）',
  withC.payload?.rows?.some((r) => r.name === '丙' && r.score === 700),
  JSON.stringify(withC.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
check('他自己的存档照样读得到（那是他自己的东西）',
  (await call({ action: 'mine', ...C })).payload?.total === 700);

// ---- 旧总榜 lb:total 退役（推14 Z-B15 ⑦）--------------------------------------
// ero2 起交卷不再写它，看榜也不再读它（默认选择是从各张现行榜合出来的）。原先这儿量「老版本留下的累计总分，
// 看一眼榜就按存档改回来」（healTotalBoard）——那段代码随旧总榜一起删了。现在量反面：上面那几局一行都没写进
// lb:total；往里伪造一行大数，默认选择也看不见它。
check('交卷不再写旧总榜 lb:total', (await store.zTop('lb:total', 50)).length === 0,
  JSON.stringify(await store.zTop('lb:total', 50)));
await store.zadd('lb:total', 777777, C.email);
const healed = await board(A, ALL);
const cRow = healed.payload?.rows?.find((r) => r.name === '丙');
check('往旧总榜里伪造一个大数：默认选择上丙还是他最高那一局（旧总榜不读）',
  cRow?.score === 700 && cRow?.board === 'square', JSON.stringify(cRow));
check('默认选择的顺序', healed.payload?.rows?.map((r) => r.score).join() === '4000,900,700',
  JSON.stringify(healed.payload?.rows?.map((r) => `${r.name}:${r.score}`)));

// ---- 一局都没得过分的人不上总榜 ------------------------------------------
// 玩家看到「总榜上显示了名字但没有标识」：老版本按累计总分写榜，一局都没得
// 分的人也占一行 0 分，而 0 分没有「最高的那一局」可标，行首就空着。现在
// 报一局 0 分不会上总榜；老版本留下的那种 0 分行，谁看一眼榜就撤下来。
const D = await makePlayer('d@example.com');
const zero = await call({ action: 'push', ...D, runId: 'd1', mode: 'square', score: 0, name: '丁' });
const afterZero = await board(A, ALL);
check('报一局 0 分：默认选择上没有这一行', !afterZero.payload?.rows?.some((r) => r.name === '丁'),
  JSON.stringify(afterZero.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
// **0 分不上榜**（10-11 方案 B-13 第 10 条，玩家 Q7 定案）：照常回 200、进存档、记局数，只是哪一张榜上
// 都不多一行 0——从前单局榜上会多一行 0 分（总榜本来就只认 >0）。
const mineD = await call({ action: 'mine', ...D });
check('0 分那一局：回 200、存档里有、局数记上了',
  zero.status === 200 && mineD.payload?.archive?.some((r) => r.runId === 'd1') && mineD.payload?.runs === 1,
  `${zero.status} runs=${mineD.payload?.runs}`);
check('0 分那一局：各张榜上都没有他（单局榜不多一行 0）',
  (await store.zscore('lb:square:base', D.email)) === null && (await store.zscore('lb:total', D.email)) === null,
  String(await store.zscore('lb:square:base', D.email)));
// 老版本留下的 0 分行：伪造一行在旧总榜上——默认选择不读旧总榜，看不见它，别的行不动。
await store.zadd('lb:total', 0, D.email);
const swept = await board(A, ALL);
check('旧总榜上那种 0 分行，默认选择上看不见，别的行不动',
  !swept.payload?.rows?.some((r) => r.name === '丁') && swept.payload?.rows?.length === 3 &&
    swept.payload?.rows?.every((r) => typeof r.board === 'string' && r.board.length > 0),
  JSON.stringify(swept.payload?.rows?.map((r) => `${r.name}:${r.score}:${r.board}`)));

// ---- 玩法 id 不能变成一把写任意键的钥匙 ---------------------------------
const bad = await call({ action: 'push', ...A, runId: 'x1', mode: 'lb:total', score: 5 });
check('玩法 id 不合规就拒收', bad.status === 400 && bad.payload?.error === 'run',
  `${bad.status} ${JSON.stringify(bad.payload)}`);
const stillTotal = await board(A, ALL);
check('榜没被那一下写坏', stillTotal.payload?.rows?.length === 3,
  JSON.stringify(stillTotal.payload?.rows?.length));

// ---- 有序集合本身 -------------------------------------------------------
await store.zaddIfHigher('zt', 5, 'x');
await store.zaddIfHigher('zt', 3, 'x');
check('GT：低的分数写不进去', (await store.zscore('zt', 'x')) === 5);
await store.zaddIfHigher('zt', 9, 'x');
check('GT：高的分数写得进去', (await store.zscore('zt', 'x')) === 9);
await store.zadd('zt', 1, 'x');
check('覆盖写就是覆盖写', (await store.zscore('zt', 'x')) === 1);
check('不在榜上的人没有名次', (await store.zrevrank('zt', 'nobody')) === null);

// ---- 榜按玩法分开记，三行筛选把选中的几张合起来 --------------------------------
//
// 一局报上来的 mode 是棋盘 id，玩法（flip / timed / bomb / 老虎机）写在存档那
// 份 data 里。榜的 id 由这两样拼出来（square:base、square:flip…）；看榜时三行选择
// （推14 Z-B15，取代原先的母标签 g:base、g:flip…）把选中的几张合起来、每人取最高的那一分。
{
  const H = await makePlayer('h@example.com');
  const I = await makePlayer('i@example.com');
  await call({ action: 'push', ...H, runId: 'h1', mode: 'square', score: 400, name: '辛',
    data: { shapeId: 'square', modeKey: 'base', totalScore: 400 } });
  await call({ action: 'push', ...H, runId: 'h2', mode: 'square', score: 900,
    data: { shapeId: 'square', modeKey: 'timed', totalScore: 900 } });
  await call({ action: 'push', ...H, runId: 'h3', mode: 'square', score: 700,
    data: { shapeId: 'square', modeKey: 'base', slot: true, totalScore: 700 } });
  await call({ action: 'push', ...I, runId: 'i1', mode: 'circle', score: 600, name: '壬',
    data: { shapeId: 'circle', modeKey: 'base', totalScore: 600 } });

  const mineH = await call({ action: 'mine', ...H });
  check('同一块棋盘，基础 / 计时 / 老虎机各记各的榜',
    mineH.payload?.best?.['square:base'] === 400 &&
      mineH.payload?.best?.['square:timed'] === 900 &&
      mineH.payload?.best?.['square:slot'] === 700,
    JSON.stringify(mineH.payload?.best));

  const timedBoard = await board(H, { families: ['square'], modes: ['timed'] });
  check('计时方块那张榜上只有那一局的 900',
    timedBoard.payload?.rows?.map((r) => r.score).join() === '900',
    JSON.stringify(timedBoard.payload?.rows));

  const baseGroup = await board(H, { modes: ['base'] });
  const rowsG = baseGroup.payload?.rows ?? [];
  const names = rowsG.map((r) => `${r.name}:${r.score}`);
  check('「全部 · 全部 · 基础」把各副棋盘的基础榜合起来，每人取自己最高的那一局基础玩法',
    names.includes('辛:400') && names.includes('壬:600'), names.join(' '));
  check('不掺别的玩法（辛那 900 是计时的、700 是老虎机的，不算在这儿）',
    !names.includes('辛:900') && !names.includes('辛:700'), names.join(' '));
  check('从高到低排', names.indexOf('壬:600') < names.indexOf('辛:400'), names.join(' '));
  check('每一行带着是哪块棋盘、玩法都是基础（画行首那两枚小图用）',
    rowsG.every((r) => typeof r.board === 'string' && r.board.length > 0 && r.kind === 'base'),
    JSON.stringify(rowsG.map((r) => `${r.board}/${r.kind}`)));
  check('合并榜上「我排第几」也算得出来',
    baseGroup.payload?.me?.score === 400 &&
      baseGroup.payload?.me?.rank === rowsG.findIndex((r) => r.name === '辛') + 1,
    JSON.stringify(baseGroup.payload?.me));

  // 非法参数一律 400（不是一张空榜）：不认识的值、不是数组、过长、空交集（三角没有炸弹）。
  const bad1 = await board(H, { modes: ['nope'] });
  check('不认识的玩法是 400，不是一张空榜', bad1.status === 400 && bad1.payload?.error === 'mode', `${bad1.status} ${JSON.stringify(bad1.payload)}`);
  const bad2 = await board(H, { families: 'square' });
  check('不是数组是 400', bad2.status === 400, `${bad2.status} ${JSON.stringify(bad2.payload)}`);
  const bad3 = await board(H, { tiers: ['normal', 'pro', 'normal'] });
  check('比这一行的药丸还多是 400', bad3.status === 400, `${bad3.status} ${JSON.stringify(bad3.payload)}`);
  const bad4 = await board(H, { families: ['triangle'], modes: ['bomb'] });
  check('不存在的组合（三角 · 炸弹）是 400 empty', bad4.status === 400 && bad4.payload?.error === 'empty', `${bad4.status} ${JSON.stringify(bad4.payload)}`);
  const bad5 = await board(H, { mode: 'square:base' });
  check('旧格式（mode 写榜号）是 400：mode 只给今日榜用', bad5.status === 400, `${bad5.status} ${JSON.stringify(bad5.payload)}`);

  // Pro 和普通互不出现在对方的结果里（选了其中一档时）。辛交一局 Pro 基础方块 1600（比他的普通 400 高）。
  const proRun = await call({ action: 'push', ...H, runId: 'h-pro', mode: 'square', score: 1600,
    data: { shapeId: 'square', modeKey: 'base', pro: true, totalScore: 1600 } });
  check('（尺子）Pro 那一局收下了、记在 square:base:pro 上',
    proRun.payload?.ok === true && proRun.payload?.best?.['square:base:pro'] === 1600, JSON.stringify(proRun.payload));
  const onlyNormal = await board(H, { families: ['square'], tiers: ['normal'], modes: ['base'] });
  const onlyPro = await board(H, { families: ['square'], tiers: ['pro'], modes: ['base'] });
  const bothTiers = await board(H, SQ_BASE);
  const xin = (b) => b.payload?.rows?.find((r) => r.name === '辛');
  check('只选普通：辛那一行是普通的 400，没有 Pro 的行', xin(onlyNormal)?.score === 400 && xin(onlyNormal)?.pro === false &&
    (onlyNormal.payload?.rows ?? []).every((r) => r.pro === false), JSON.stringify(onlyNormal.payload?.rows));
  check('只选 Pro：只有 Pro 的行（辛 1600，挂 pro）', (onlyPro.payload?.rows ?? []).length === 1 && xin(onlyPro)?.score === 1600 &&
    xin(onlyPro)?.pro === true, JSON.stringify(onlyPro.payload?.rows));
  check('普通和 Pro 都选（第二行「全部」）：Pro 原分混排，辛取高的那一局 1600', xin(bothTiers)?.score === 1600 && xin(bothTiers)?.pro === true,
    JSON.stringify(xin(bothTiers)));

  /*
   * 炸弹分**三版**规则，各记各的榜（`bombRules` 说了算，见 api/scores.js 的 kindOf）：
   *   第 1 版（老档没有 bombRules）—— 六枚永不翻面的红块 → `square:bomb`
   *   第 2 版 —— 炸弹可拆，但留一枚永久炸弹      → `square:bomb2`
   *   第 3 版（现行，玩家 2026-09-25 拍板取消那一枚）→ `square:bomb3`
   * 躲六枚、躲一枚、一枚都不躲，打出来的分不是一把尺子量的。少分一档，老纪录会压在
   * 新榜前列，新规则等于白改。
   */
  await call({ action: 'push', ...H, runId: 'h4', mode: 'square', score: 250,
    data: { shapeId: 'square', modeKey: 'bomb', totalScore: 250 } });
  await call({ action: 'push', ...H, runId: 'h5', mode: 'square', score: 1100,
    data: { shapeId: 'square', modeKey: 'bomb', bombRules: 2, totalScore: 1100 } });
  await call({ action: 'push', ...H, runId: 'h5b', mode: 'square', score: 900,
    data: { shapeId: 'square', modeKey: 'bomb', bombRules: 3, totalScore: 900 } });
  // 定时炸弹也是炸弹的一种，不是第七块榜——它跟着同一个版本号走。
  await call({ action: 'push', ...H, runId: 'h6', mode: 'square', score: 1500,
    data: { shapeId: 'square', modeKey: 'bombTimed', bombRules: 3, totalScore: 1500 } });

  const mineBomb = await call({ action: 'mine', ...H });
  // 推14 Z-B14 起：算出来的榜号不在 ALL_BOARDS（现行那 36 张）里就不上榜、不进 best，存档照收——还开着旧页面的人交的
  // 第 1、2 版炸弹局从此不再写进归档榜（原先这两条量的是「写进各自的归档榜」）。
  check('第一版那局炸弹：存档照收，不进 best、不上任何榜',
    mineBomb.payload?.best?.['square:bomb'] === undefined && mineBomb.payload?.archive?.some((r) => r.runId === 'h4') &&
      (await store.zscore('lb:square:bomb', H.email)) === null, JSON.stringify(mineBomb.payload?.best));
  check('第二版那局：同上（不写 bomb2），也没被搬到现行榜上',
    mineBomb.payload?.best?.['square:bomb2'] === undefined && mineBomb.payload?.archive?.some((r) => r.runId === 'h5') &&
      (await store.zscore('lb:square:bomb2', H.email)) === null, JSON.stringify(mineBomb.payload?.best));
  check('现行规则的炸弹（含定时炸弹）记在 bomb3 上',
    mineBomb.payload?.best?.['square:bomb3'] === 1500, JSON.stringify(mineBomb.payload?.best));

  const bombBoard = await board(H, { families: ['square'], modes: ['bomb'] });
  check('方块 · 炸弹看的是现行那张：只有现行规则那两局里高的那一个',
    bombBoard.payload?.rows?.map((r) => r.score).join() === '1500',
    JSON.stringify(bombBoard.payload?.rows));
  // 归档榜看榜时选不到了（三行筛选只拼现行版本号，api/scores.js 的 LB_KIND）——直接读库，量它们原样留着。
  check('两张归档榜一行都没被写（旧版本的局不再上榜）',
    (await store.zTop('lb:square:bomb', 50)).length === 0 && (await store.zTop('lb:square:bomb2', 50)).length === 0,
    JSON.stringify([await store.zTop('lb:square:bomb', 50), await store.zTop('lb:square:bomb2', 50)]));

  const bombGroup = await board(H, { modes: ['bomb'] });
  check('「全部 · 全部 · 炸弹」看的也是现行那几张',
    (bombGroup.payload?.rows ?? []).map((r) => `${r.score}`).join() === '1500',
    JSON.stringify(bombGroup.payload?.rows));

  /*
   * 步步为营分三版（`puzzleRules` 说了算）：
   *   第 1 版（老档没有 puzzleRules）—— 消线只退一步 → `square:puzzle`（归档）
   *   第 2 版 —— 消线退两步，底稿 §7 / E14          → `square:puzzle2`（归档，10-15 补充 S9 起）
   *   第 3 版（现行）—— 空走额度，起手按棋盘、没有退步 → `square:puzzle3`
   * 每一版一局能走多久、终局盘上有多少枚被消除整条都变了，所以不能放一起比。这儿顺带钉住一个**只在这一档会犯的
   * 错**：`kindOf` 里那一行从前写的是 `mk === PUZZLE_KIND`，而常量从 'puzzle' 改成 'puzzle2' 之后，存档里的
   * modeKey 永远还是 'puzzle'——照旧那么写的话每一局步步为营都会掉进 base 那张榜，而且不报错。
   */
  await call({ action: 'push', ...H, runId: 'h7', mode: 'square', score: 320,
    data: { shapeId: 'square', modeKey: 'puzzle', totalScore: 320 } });
  // 340 而不是原先的 640：方块一盘 36 枚，步步为营满打满算 360 分（第 14 推起服务端拦超过
  // 「枚数 × 10」的分），640 是一局打不出来的数。
  await call({ action: 'push', ...H, runId: 'h8', mode: 'square', score: 340,
    data: { shapeId: 'square', modeKey: 'puzzle', puzzleRules: 2, totalScore: 340 } });
  await call({ action: 'push', ...H, runId: 'h9', mode: 'square', score: 350,
    data: { shapeId: 'square', modeKey: 'puzzle', puzzleRules: 3, totalScore: 350 } });
  const minePuzzle = await call({ action: 'mine', ...H });
  // 同炸弹（推14 Z-B14）：第 1、2 版的局存档照收、不上任何榜。
  check('消线退一步那一版：不进 best、不上老榜 square:puzzle',
    minePuzzle.payload?.best?.['square:puzzle'] === undefined && (await store.zscore('lb:square:puzzle', H.email)) === null,
    JSON.stringify(minePuzzle.payload?.best));
  check('第 2 版（消线退两步）：不进 best、不上归档榜 square:puzzle2',
    minePuzzle.payload?.best?.['square:puzzle2'] === undefined && (await store.zscore('lb:square:puzzle2', H.email)) === null,
    JSON.stringify(minePuzzle.payload?.best));
  check('现行那一版（第 3 版）记在 square:puzzle3 上',
    minePuzzle.payload?.best?.['square:puzzle3'] === 350, JSON.stringify(minePuzzle.payload?.best));
  // 反面：三局步步为营**一局都不许掉进 base 那张榜**（上面那个 kindOf 的坑）。
  check('步步为营没有一局掉进 base 榜',
    ![320, 340, 350].includes(minePuzzle.payload?.best?.['square:base']),
    JSON.stringify(minePuzzle.payload?.best?.['square:base']));
}

// ---- 管理员维护：照存档重建所有榜，顺手清掉《无限反转》 ----------------------
{
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
  const F = await makePlayer('f@example.com');
  const G = await makePlayer('g@example.com');
  // 己：基础方块 300，无限反转 6000，小球只打过无限反转 4000。（无限反转的综合分 = 拼出分 × 反转系数，推14 Z-B06：方块 ×6、
  // 小球 ×2.5——夹具要它是系数的整数倍，原先的 5000 改成 6000。）
  await call({ action: 'push', ...F, runId: 'f1', mode: 'square', score: 300, name: '己',
    data: { shapeId: 'square', modeKey: 'base', totalScore: 300 } });
  // flipRules: 2 —— 现行那一版（榜号 flip2）。不写的话是第 1 版，推14 起不上任何榜（Z-B14），这一节就量不到「清掉」。
  await call({ action: 'push', ...F, runId: 'f2', mode: 'square', score: 6000,
    data: { shapeId: 'square', modeKey: 'flip', flipRules: 2, totalScore: 6000 } });
  await call({ action: 'push', ...F, runId: 'f3', mode: 'circle', score: 4000,
    data: { shapeId: 'circle', modeKey: 'flip', flipRules: 2, totalScore: 4000 } });
  // 庚：一局无限反转都没打过——他的榜不该被动。
  await call({ action: 'push', ...G, runId: 'g1', mode: 'square', score: 800, name: '庚',
    data: { shapeId: 'square', modeKey: 'base', totalScore: 800 } });

  const before = await call({ action: 'mine', ...F });
  check('清之前：无限反转那两局在它们自己的榜上',
    before.payload?.best?.['square:flip2'] === 6000 &&
      before.payload?.best?.['circle:flip2'] === 4000,
    JSON.stringify(before.payload?.best));

  // drop 点的是榜号里的那个玩法名（kindOf：现行无限反转是 flip2）。
  const noToken = await call({ action: 'rebuild', drop: ['flip2'] });
  check('没有管理员令牌，重建不了', noToken.status === 401, String(noToken.status));
  const wrongToken = await call({ action: 'rebuild', token: 'y'.repeat(32), drop: ['flip2'] });
  check('令牌不对也重建不了', wrongToken.status === 401, String(wrongToken.status));

  const done = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, drop: ['flip2'] });
  check('重建了，报了动过几个人', done.payload?.ok === true && done.payload.players > 0,
    JSON.stringify(done.payload));

  const after = await call({ action: 'mine', ...F });
  check('无限反转那两张榜清空了', after.payload?.best?.['square:flip2'] === undefined &&
    after.payload?.best?.['circle:flip2'] === undefined, JSON.stringify(after.payload?.best));
  check('他自己那局基础方块原样留着', after.payload?.best?.['square:base'] === 300,
    JSON.stringify(after.payload?.best));
  check('累计得分一个字没动（那是他的记录，不是榜）',
    after.payload?.total === before.payload?.total,
    `${before.payload?.total} → ${after.payload?.total}`);
  check('存档一局都没少', after.payload?.archive?.length === before.payload?.archive?.length);

  const flipBoard = await board(F, { modes: ['flip'] });
  check('「全部 · 全部 · 无限反转」上一个人都没有了', (flipBoard.payload?.rows ?? []).length === 0,
    JSON.stringify(flipBoard.payload?.rows));

  const sq = await board(F, SQ_BASE);
  const rows = sq.payload?.rows?.map((r) => `${r.name}:${r.score}`) ?? [];
  check('基础方块榜上再没有那个六千', !rows.some((r) => r.includes('6000')), rows.join(' '));
  check('没打过无限反转的人分毫未动', rows.includes('庚:800'), rows.join(' '));

  const total = await board(F, ALL);
  const mine = total.payload?.rows?.find((r) => r.name === '己');
  check('默认选择上己按新的最高单局重排', mine?.score === 300 && mine?.board === 'square' && mine?.kind === 'base',
    JSON.stringify(mine));

  const twice = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, drop: ['flip2'] });
  check('再重建一次，结果一样（重建是幂等的）', twice.payload?.ok === true,
    JSON.stringify(twice.payload));
  const stillGone = await call({ action: 'mine', ...F });
  check('第二次之后无限反转还是空的', stillGone.payload?.best?.['square:flip2'] === undefined);

  /*
   * ── `scrubNames: true`：把库里那些长得像凭据的旧名字清掉（#2，2026-10-02）──
   *
   * 那些条目是旧客户端存进去的（`leaderboardName()` 从前在玩家没取名字时拿他的登录凭据
   * 顶上）。读榜那一头已经在过滤它们了（`shownName`，门在 check-board-no-id），所以这一
   * 步不是为了「榜上别印」——那已经做到了——而是为了**库里别留着**。一份存着的凭据和一
   * 份印出来的凭据，前者只是还没被人看见。
   *
   * ⚠️ 要紧的那一条在最后：**回包里一个名字都不许有。** 这个接口的回包是会被贴进工单、
   * 贴进对话的（它就是给人看的那种维护接口），而要清的东西恰恰是凭据——把它们列出来等
   * 于把这次清理本身变成一次泄露。
   */
  {
    const { hgetall, hset } = await import('../api/_store.js');
    const NAMES = 'lbnames';
    // 三条：一条像第一串（旧，该删）、一条像邮箱（旧，该删）、一条是玩家自己敲的（带
    // v，不许动，哪怕它也长得像第一串）。
    const HDL_OLD = 'hdl:' + 'a'.repeat(64);
    const HDL_NEW = 'hdl:' + 'b'.repeat(64);
    await hset(NAMES, HDL_OLD, { name: 'Abcdefghij', avatar: null });
    await hset(NAMES, 'scrubme@example.com', { name: 'scrubme', avatar: null });
    await hset(NAMES, HDL_NEW, { name: 'Zyxwvutsrq', avatar: null, v: 2 });

    const scrubbed = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, scrubNames: true });
    check('清名字：答 200，而且报了删了几条',
      scrubbed.payload?.ok === true && scrubbed.payload?.namesDropped === 2,
      JSON.stringify(scrubbed.payload));

    const left = await hgetall(NAMES);
    check('清名字：像第一串的那条删了', !left[HDL_OLD], JSON.stringify(left[HDL_OLD] ?? null));
    check('清名字：像邮箱的那条删了', !left['scrubme@example.com'],
      JSON.stringify(left['scrubme@example.com'] ?? null));
    check('清名字：玩家自己敲的那条（带 v）**没动**', left[HDL_NEW]?.name === 'Zyxwvutsrq',
      JSON.stringify(left[HDL_NEW] ?? null));
    // 上面那几个人的真昵称（甲乙丙…）也不许被顺手删掉。
    check('清名字：别人的好名字一个都没少',
      Object.values(left).some((row) => row?.name === '庚'), JSON.stringify(Object.values(left).map((r) => r?.name)));

    const text = JSON.stringify(scrubbed.payload);
    for (const leaked of ['Abcdefghij', 'scrubme', 'Zyxwvutsrq', '庚']) {
      check(`清名字：回包里找不到「${leaked}」`, !text.includes(leaked), text.slice(0, 160));
    }

    // 不勾那个旗子就什么都不清——它是一次性的维护动作，不许变成每次重建的副作用。
    await hset(NAMES, 'scrubme@example.com', { name: 'scrubme', avatar: null });
    const plain = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
    check('不勾 scrubNames：一条都不清（namesDropped 是 0）', plain.payload?.namesDropped === 0,
      JSON.stringify(plain.payload));
    check('不勾 scrubNames：那条旧的还在（反面尺子）',
      Boolean((await hgetall(NAMES))['scrubme@example.com']));
  }
  delete process.env.ADMIN_TOKEN;
}

// ---- 步步为营：清盘剩几步（第 14 推）---------------------------------------
//
// 同分的两局，剩得多的排前面；榜上印的照旧是原综合分；没清盘的局没有 left。存的是拼起来
// 的数（分数 × 1000 ＋ 清盘时剩的步数，见 api/scores.js 的 PUZZLE_SCALE），这几条量的是
// 「拼起来、拆开、排对、搬家和重建都不丢」。
{
  // 重建要管理员令牌（上面那一节用完删掉了）。
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
  const CLEAR = '全部方块已翻成点面';
  const pz = (score, left, cleared = true, extra = {}) => ({
    shapeId: 'square', modeKey: 'puzzle', puzzleRules: 3, boardTiles: 36, totalScore: score,
    reason: cleared ? CLEAR : '步数用尽',
    // 走的步数跟着「剩几步」算（10-31 方案推09 起服务器对这三个数的账：left = max(0, 起手 22 − (spent − scoredMoves))）。
    // 原先一律「走 20、得分 5」配各种 left，账对不上，加了账核对之后整节被拒。
    puzzle: { ...pzTally(score), spent: 22 - left + 5, scoredMoves: 5, left },
    ...extra,
  });
  // 名字也是故意挑的：并列时内存替身按成员名**正序**破平（pz-a… 在 pz-z… 前面）。清三是
  // pz-a、清七是 pz-z，同分不加步数的话清三就排到前面去——那一条只有真的按步数排了才过。
  const P = await makePlayer('pz-z7@example.com');
  const Q = await makePlayer('pz-a3@example.com');
  const R = await makePlayer('pz-r@example.com');
  const S = await makePlayer('pz-s@example.com');
  const T = await makePlayer('pz-t@example.com');
  await call({ action: 'push', ...Q, runId: 'q1', mode: 'square', score: 300, name: '清三', data: pz(300, 3) });
  await call({ action: 'push', ...P, runId: 'p1', mode: 'square', score: 300, name: '清七', data: pz(300, 7) });
  await call({ action: 'push', ...R, runId: 'r1', mode: 'square', score: 300, name: '没清', data: pz(300, 0, false) });
  await call({ action: 'push', ...S, runId: 's1', mode: 'square', score: 250, name: '没清二', data: pz(250, 0, false) });
  await call({ action: 'push', ...T, runId: 't1', mode: 'square', score: 200, name: '清九', data: pz(200, 9) });

  // 上面那一节的「辛」也在这张榜上（340，没清盘）。这儿只看这一节自己的五个人，排序也只
  // 比他们之间的先后。
  const OURS = new Set(['清七', '清三', '没清', '没清二', '清九']);
  const SQ_PZ = { families: ['square'], modes: ['puzzle'] };
  const one = await board(P, SQ_PZ);
  const rows = (one.payload?.rows ?? []).filter((r) => OURS.has(r.name));
  const seen = rows.map((r) => `${r.name}:${r.score}${r.left !== undefined ? '/' + r.left : ''}`).join(' ');
  check('（尺子）步步为营那张榜上五个人都在', rows.length === 5, seen);
  check('清盘剩 7 步的排在剩 3 步的前面', rows.findIndex((r) => r.name === '清七') < rows.findIndex((r) => r.name === '清三'), seen);
  check('同分时清盘的排在没清盘的前面（剩下的步数只在同分时起作用）',
    rows.findIndex((r) => r.name === '清三') < rows.findIndex((r) => r.name === '没清'), seen);
  check('分数照旧是第一位：没清盘的 250 排在清盘剩 9 步的 200 前面',
    rows.findIndex((r) => r.name === '没清二') < rows.findIndex((r) => r.name === '清九'), seen);
  check('显示的分数等于原综合分（不是拼起来的那个数）',
    rows.map((r) => r.score).join() === '300,300,300,250,200', seen);
  check('清盘的局带着剩几步', rows.find((r) => r.name === '清七')?.left === 7 && rows.find((r) => r.name === '清九')?.left === 9, seen);
  check('没清盘的局没有 left', rows.filter((r) => r.name.startsWith('没清')).every((r) => !('left' in r)), seen);
  const myPlace = (one.payload?.rows ?? []).findIndex((r) => r.name === '清七') + 1;
  check('「我排第几」那一格的分数也拆开了', one.payload?.me?.score === 300 && one.payload?.me?.rank === myPlace,
    JSON.stringify(one.payload?.me));

  const group = await board(P, { modes: ['puzzle'] });
  const g = (group.payload?.rows ?? []).filter((r) => OURS.has(r.name))
    .map((r) => `${r.name}:${r.score}${r.left !== undefined ? '/' + r.left : ''}`).join(' ');
  check('「全部 · 全部 · 步步为营」上同样拆开、同样排', g.startsWith('清七:300/7 清三:300/3 没清:300 没清二:250 清九:200/9'), g);

  // 默认选择、「方块 · 全部」不被步步为营的 ×1000 盖住（推14 Z-B15：合并之前先拆）：清七那一行还是原分 300，排在别的
  // 玩法的高分（乙的基础方块 900）后面——拆之前那个数是 300007，会压在所有人头上。
  const total = await board(P, ALL);
  const mineRow = (total.payload?.rows ?? []).find((r) => r.name === '清七');
  check('默认选择上还是原分 300（不是 300007）', mineRow?.score === 300 && mineRow?.left === 7, JSON.stringify(mineRow));
  const sqAll = await board(P, { families: ['square'] });
  const sqRows = sqAll.payload?.rows ?? [];
  const at = (n) => sqRows.findIndex((r) => r.name === n);
  check('「方块 · 全部」：步步为营那几行是原分，排在乙的 900 后面（没被 ×1000 盖住）',
    at('乙') >= 0 && at('清七') > at('乙') && sqRows.every((r) => r.score <= 100000) &&
      sqRows.every((r, i) => i === 0 || sqRows[i - 1].score >= r.score),
    sqRows.slice(0, 8).map((r) => `${r.name}:${r.score}`).join(' '));

  // 同一个人再打一局同分、剩得更多：榜上换成新那一局；剩得少：不动。
  await call({ action: 'push', ...Q, runId: 'q2', mode: 'square', score: 300, data: pz(300, 8) });
  await call({ action: 'push', ...Q, runId: 'q3', mode: 'square', score: 300, data: pz(300, 1) });
  const q = (await board(Q, SQ_PZ)).payload?.rows?.find((r) => r.name === '清三');
  check('同分剩得更多的那一局顶掉旧的，剩得少的不往回拉', q?.left === 8, JSON.stringify(q));

  // 老写法（原分）的那一行：上线之前存进去的。重建之前照原分读，不显示成 0。
  // （重建照 stats:* 和名字表找人，旧总榜退役之后不再从它拉名单——夹具在下面重建之前补 stats。）
  const L = await makePlayer('pz-legacy@example.com');
  await store.zadd('lb:square:puzzle3', 280, L.email);
  const legacy = (await board(P, SQ_PZ)).payload?.rows?.find((r) => r.score === 280);
  check('还没重建的老数照原分读（280，不是 0）', Boolean(legacy) && !('left' in legacy), JSON.stringify(legacy));

  // 上限：步步为营的分数不能超过「枚数 × 10」。用另一个人交——拿清九交的话他的最高分变成
  // 360，排到两位没清盘的前面去，下面「重建之后排法不变」那一条就量不出没清盘的局有没有
  // 被写错（它们本来就在最底下了）。
  const U = await makePlayer('pz-cap@example.com');
  const capOk = await call({ action: 'push', ...U, runId: 't2', mode: 'square', score: 360, data: pz(360, 2) });
  check('满打满算 36 × 10 = 360 收下', capOk.status === 200 && capOk.payload?.ok === true, `${capOk.status} ${JSON.stringify(capOk.payload)}`);
  const capBad = await call({ action: 'push', ...U, runId: 't3', mode: 'square', score: 361, data: pz(361, 2) });
  check('361 超过枚数 × 10，拒收', capBad.status === 400 && capBad.payload?.error === 'score', `${capBad.status} ${JSON.stringify(capBad.payload)}`);
  const capLie = await call({ action: 'push', ...U, runId: 't4', mode: 'square', score: 900, data: pz(900, 2, true, { boardTiles: 999 }) });
  check('报一个 999 枚也抬不高上限（方块就是 36 枚）', capLie.status === 400 && capLie.payload?.error === 'score',
    `${capLie.status} ${JSON.stringify(capLie.payload)}`);
  const notPz = await call({ action: 'push', ...U, runId: 't5', mode: 'square', score: 900, data: { shapeId: 'square', modeKey: 'base', boardTiles: 36 } });
  check('别的玩法不受这道上限（反向对照）', notPz.status === 200 && notPz.payload?.ok === true, `${notPz.status} ${JSON.stringify(notPz.payload)}`);

  // 头像不再存。
  // 第 16 推起 push 一个字的名字都不存（名字只走改名接口），头像更不用说。这一条照旧量：push
  // 里塞着名字和头像，库里那一行还是改名接口登记的那个样子——没有头像、名字也没被这一局改动。
  await callRaw({ action: 'push', ...S, runId: 's2', mode: 'square', score: 10, name: '别的名字', avatar: { x: 1 }, data: pz(10, 0, false) });
  const nameRow = await store.hget('lbnames', S.email);
  check('（尺子）名字还是登记的那个（push 里塞的名字没进来）', nameRow?.name === '没清二', JSON.stringify(nameRow));
  check('头像不再存', nameRow && !('avatar' in nameRow), JSON.stringify(nameRow));
  check('榜上那一行也不再带 avatar', (one.payload?.rows ?? []).every((r) => !('avatar' in r)), JSON.stringify(rows[0]));

  // 重建：照存档重算，步步为营那几张写回拼起来的数（老写法那一行也换成新写法）。
  // 存档里那一局得是一份对得上账的明细（10-11 方案 A-5：重建只认 vetRun 过得去的局）——直接写库，没走
  // callRaw，所以这儿自己拿夹具补齐。
  await store.set('runs:' + L.email, [{ runId: 'l1', mode: 'square', score: 280, at: Date.now(),
    data: { ...fakeRun({ board: 'square', modeKey: 'puzzle', total: 280 }), ...pz(280, 4), rules: SCORING_V } }]);
  await store.set('stats:' + L.email, { total: 280, runs: 1, best: { 'square:puzzle3': 280 }, seen: ['l1'] });
  const order = async () => ((await board(P, SQ_PZ)).payload?.rows ?? [])
    .filter((r) => OURS.has(r.name)).map((r) => `${r.name}:${r.score}${r.left !== undefined ? '/' + r.left : ''}`).join(' ');
  const beforeRebuild = await order();
  const rb = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  check('（尺子）重建跑通了', rb.status === 200 && rb.payload?.ok === true, JSON.stringify(rb.payload));
  check('重建之后清七那一行存的是 300 × 1000 + 7', (await store.zscore('lb:square:puzzle3', P.email)) === 300007,
    String(await store.zscore('lb:square:puzzle3', P.email)));
  check('老写法那一行重建成了新写法（280 × 1000 + 4）', (await store.zscore('lb:square:puzzle3', L.email)) === 280004,
    String(await store.zscore('lb:square:puzzle3', L.email)));
  // 重建是照存档把每张榜重写一遍——写法要和交卷时一模一样，不然重建一次排法就变了（比如
  // 没清盘的局重建成原分，就全掉到清盘的局底下去了）。交卷那一路有「和历史最高分 × 1000
  // 取大」兜着，这种错只在重建之后才露出来，所以单量这一条。
  check('重建之后排法一点没变', (await order()) === beforeRebuild, `${beforeRebuild}  →  ${await order()}`);
  const after = (await board(P, SQ_PZ)).payload?.rows ?? [];
  check('重建之后印出来的还是原分和剩几步',
    after.find((r) => r.name === '清七')?.score === 300 && after.find((r) => r.name === '清七')?.left === 7,
    JSON.stringify(after.find((r) => r.name === '清七')));

  // 换邮箱搬家：抄的是榜上那个拼起来的数，不是 stats.best 的原分。
  const { renameScoreOwner } = await import('../api/scores.js');
  await renameScoreOwner(P.email, 'pz-p2@example.com');
  check('换邮箱之后新地址上还是 300 × 1000 + 7', (await store.zscore('lb:square:puzzle3', 'pz-p2@example.com')) === 300007,
    String(await store.zscore('lb:square:puzzle3', 'pz-p2@example.com')));
  check('旧地址撤干净了', (await store.zscore('lb:square:puzzle3', P.email)) === null);

  // 归档榜（10-15 补充 S9）：第 2 版那张 square:puzzle2 上存的也是拼起来的数。isPuzzleBoard 原先只认现行那张，
  // 升到 puzzle3 之后 300007 会被当成三十万分印出来，还开着旧页面的人交的第 2 版局也按原分写进去混排。
  // 归档榜看榜时选不到了（推14 Z-B15）；拆数那一步由 mergeTop 直接量（它和看榜、重建共用 decodeBoard）。
  const Z = await makePlayer('pz-arch@example.com');
  await store.zadd('lb:square:puzzle2', 300007, Z.email);
  const { mergeTop } = await import('../api/scores.js');
  const arch = (await mergeTop(['square:puzzle2'])).find((r) => r.m === Z.email);
  check('归档榜 square:puzzle2 上的 300007 读出来是 300 · 剩 7', arch?.s === 300 && arch?.l === 7, JSON.stringify(arch));
  const O = await makePlayer('pz-old@example.com');
  const oldRun = await call({ action: 'push', ...O, runId: 'o1', mode: 'square', score: 250, data: pz(250, 4, true, { puzzleRules: 2 }) });
  check('（尺子）还开着旧页面的人交的第 2 版清盘局照收', oldRun.status === 200 && oldRun.payload?.ok === true,
    `${oldRun.status} ${JSON.stringify(oldRun.payload)}`);
  // 推14 Z-B14 起旧版本的局不上任何榜（原先这一条量「写进归档榜 250 × 1000 + 4」）。
  check('第 2 版清盘局：存档照收，归档榜上也没有他', (await store.zscore('lb:square:puzzle2', O.email)) === null,
    String(await store.zscore('lb:square:puzzle2', O.email)));
  check('现行那张 square:puzzle3 上没有他', (await store.zscore('lb:square:puzzle3', O.email)) === null,
    String(await store.zscore('lb:square:puzzle3', O.email)));
  delete process.env.ADMIN_TOKEN;
}

// ---- 计分规则版本闸（《侵蚀阶梯》v1.2 §6）-------------------------------
//
// 服务端只收现行这一版打出来的局：那一版把得分图案、翻面分、整线消除、综合分全换
// 了一套，旧局和新局不是一把尺子量的，混在一张榜上比就是把老局钉死在榜首。
{
  // 服务端那份常量是**手抄**的（api/ 是纯 .js，import 不进 src 里的 ts）。漏改一
  // 处的后果是全站没有一局入得了榜，而屏幕上一个字的错都没有——所以钉死它。
  const api = readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8');
  const apiV = /const SCORING_RULES = '([^']+)'/.exec(api)?.[1];
  check('服务端抄的那份规则版本和 src 里的一个字不差', apiV === SCORING_V, `api: ${apiV} / src: ${SCORING_V}`);

  const E = await makePlayer('e@example.com');
  // __raw：绕过 call() 那个自动补版本号的便利，这一条要的正是「没带版本号」。
  const old1 = await call({
    __raw: true, action: 'push', ...E, runId: 'e1', mode: 'square', score: 4242, name: '戊',
    data: { shapeId: 'square', totalScore: 4242 },
  });
  check('旧规则的局：收下但不入库（200 + stored:false，不是报错）',
    old1.status === 200 && old1.payload?.stored === false && old1.payload?.reason === 'rules',
    `${old1.status} ${JSON.stringify(old1.payload)}`);
  const old2 = await call({
    __raw: true, action: 'push', ...E, runId: 'e2', mode: 'square', score: 4242,
    data: { shapeId: 'square', totalScore: 4242, rules: 'nope' },
  });
  check('版本对不上的也一样', old2.payload?.stored === false, JSON.stringify(old2.payload));
  const mineE = await call({ action: 'mine', ...E });
  check('这两局一局都没进存档，总分还是 0',
    mineE.payload?.total === 0 && mineE.payload?.archive?.length === 0,
    JSON.stringify(mineE.payload));
  // 反向对照：同一个人带上现行版本号交一局，照收不误——上面那两条红不是因为
  // 「这个账号交不上」。
  const good = await call({ action: 'push', ...E, runId: 'e3', mode: 'square', score: 77, name: '戊' });
  check('带着现行版本号的局照收不误（反向对照）', good.payload?.ok === true && good.payload?.total === 77,
    JSON.stringify(good.payload));
}

// ---- 每日挑战、小屋、敲代号开的局都进对应玩法的常规榜（推14 Z-B17，站长 10-22 D12）------------------
// 推翻 10-08 方案 3-B（代号局不上榜）：「都进入，排在这个玩法对应的榜单」＋「代号局也进对应玩法的榜」。
// 照收、照记存档和累计、进 best、写榜；重建也把它们算进去。今日榜那一半由 check-daily-push 量。
{
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
  const K = await makePlayer('k@example.com');
  const base = (runId, score, seedSource) => ({
    action: 'push', ...K, runId, mode: 'square', score,
    data: { shapeId: 'square', modeKey: 'base', totalScore: score, ...(seedSource ? { seedSource } : {}) },
  });
  const rowOf = async (who, q) => (await board(who, q)).payload?.rows?.find((r) => r.me)?.score ?? null;
  const r1 = await call({ ...base('k1', 300, 'random'), name: '癸' });
  check('（尺子）随手开的一局照常上榜', r1.payload?.ok === true && (await rowOf(K, SQ_BASE)) === 300,
    JSON.stringify(r1.payload));
  const r2 = await call(base('k2', 900, 'entered'));
  check('敲代号开的一局：照收（200 ok），累计照加', r2.status === 200 && r2.payload?.ok === true && r2.payload?.total === 1200,
    `${r2.status} ${JSON.stringify(r2.payload)}`);
  const mineK = await call({ action: 'mine', ...K });
  check('敲代号开的一局：存档里有它', mineK.payload?.archive?.some((r) => r.runId === 'k2' && r.data?.seedSource === 'entered'),
    JSON.stringify(mineK.payload?.archive?.map((r) => r.runId)));
  check('敲代号开的一局：进 best（900）', mineK.payload?.best?.['square:base'] === 900, JSON.stringify(mineK.payload?.best));
  check('敲代号开的一局：基础方块榜上是 900', (await rowOf(K, SQ_BASE)) === 900, String(await rowOf(K, SQ_BASE)));
  check('敲代号开的一局：默认选择上也是 900', (await rowOf(K, ALL)) === 900, String(await rowOf(K, ALL)));
  const r3 = await call(base('k3', 950, 'room'));
  check('小屋那一局（seedSource room）进常规榜', r3.payload?.ok === true && (await rowOf(K, SQ_BASE)) === 950, String(await rowOf(K, SQ_BASE)));
  const r4 = await call(base('k4', 1000, 'daily'));
  check('每日挑战那一局（seedSource daily）进常规榜', r4.payload?.ok === true && (await rowOf(K, SQ_BASE)) === 1000,
    String(await rowOf(K, SQ_BASE)));
  // 重建也把代号局算进去：另一个人只打过一局代号局。
  const K2 = await makePlayer('k2@example.com');
  await call({ action: 'push', ...K2, runId: 'k2-1', mode: 'square', score: 700, name: '代号庚',
    data: { shapeId: 'square', modeKey: 'base', totalScore: 700, seedSource: 'entered' } });
  const rebuilt = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  check('（尺子）重建跑了', rebuilt.payload?.ok === true, JSON.stringify(rebuilt.payload));
  check('重建照存档重算：代号局照样上榜（只打过代号局的人 700、癸 1000）',
    (await rowOf(K2, SQ_BASE)) === 700 && (await rowOf(K, SQ_BASE)) === 1000,
    `${await rowOf(K2, SQ_BASE)} / ${await rowOf(K, SQ_BASE)}`);
  // 步步为营那几张榜写的是「这一局自己的数」和 best 取大（boardValue）——同样进榜。
  const W = await makePlayer('k-pz@example.com');
  const pz = (score, seedSource) => ({
    shapeId: 'square', modeKey: 'puzzle', puzzleRules: 3, boardTiles: 36, totalScore: score, reason: '步数用尽',
    // 剩 0：走 27、得分 5（空走 22 步正好用完，见上面那一节的说明）。
    puzzle: { ...pzTally(score), spent: 27, scoredMoves: 5, left: 0 },
    ...(seedSource ? { seedSource } : {}),
  });
  await call({ action: 'push', ...W, runId: 'w1', mode: 'square', score: 120, name: '代号壬', data: pz(120, 'random') });
  const SQ_PZ = { families: ['square'], modes: ['puzzle'] };
  check('（尺子）步步为营：随手开的一局照常上榜', (await rowOf(W, SQ_PZ)) === 120, String(await rowOf(W, SQ_PZ)));
  await call({ action: 'push', ...W, runId: 'w2', mode: 'square', score: 330, data: pz(330, 'entered') });
  check('步步为营：敲代号开的一局也进榜（330）', (await rowOf(W, SQ_PZ)) === 330, String(await rowOf(W, SQ_PZ)));
  delete process.env.ADMIN_TOKEN;
}

// ---- 同分同名次（推14 Z-B16，站长 D38 甲）：1、1、3 -------------------------------------------
// 三个人在一张没人打过的榜上（小球 · 计时）：两个 500、一个 400。两个 500 都是第 1，400 是第 3；「我的名次」同样口径。
{
  const T1 = await makePlayer('tie-1@example.com');
  const T2 = await makePlayer('tie-2@example.com');
  const T3 = await makePlayer('tie-3@example.com');
  for (const [who, score, name] of [[T1, 500, '并一'], [T2, 500, '并二'], [T3, 400, '并三']]) {
    await call({ action: 'push', ...who, runId: 'tie-' + name, mode: 'circle', score, name,
      data: { shapeId: 'circle', modeKey: 'timed', totalScore: score } });
  }
  const CT = { families: ['circle'], modes: ['timed'] };
  const v3 = await board(T3, CT);
  const ranks = (v3.payload?.rows ?? []).map((r) => `${r.score}#${r.rank}`).join(' ');
  check('同分同名次：500、500、400 → 第 1、第 1、第 3', ranks === '500#1 500#1 400#3', ranks);
  check('「我的名次」：400 那个人是第 3', v3.payload?.me?.rank === 3 && v3.payload?.me?.score === 400, JSON.stringify(v3.payload?.me));
  const v2 = await board(T2, CT);
  check('「我的名次」：并列的那个人也是第 1', v2.payload?.me?.rank === 1, JSON.stringify(v2.payload?.me));
}

// ---- 看榜只取画出来的那几行的名字（10-09 补充方案 7-13 第 7 条）------------------------
//
// 名字表（NAMES）和总榜的玩法记号（TOTAL_MODE）都是全站一人一行的大表，原先每看一次榜就 hgetall
// 整张。现在只 hmget 那五十行。hmget 最容易错的是**对不齐**：问的是 [甲, 乙, 丙]，回来的是按位置排
// 的三格，哪一格错了位，榜上就是「乙的名字配着甲的分」，而且不报错。所以这一节让六十个人各打一个
// 一眼认得出的分（名字「榜07」↔ 分数 7007），量每一行的名字和分数是不是同一个人的。
{
  // ① hmget 自己（本地和 CI 跑的都是内存版，它得和真 Redis 一个样子）
  await store.hset('hmget-probe', 'a', { name: '甲' });
  await store.hset('hmget-probe', 'b', 'square:base');
  const got = await store.hmget('hmget-probe', ['a', 'nobody', 'b', 'a']);
  check('hmget：问到的那几格解好了回来，没有的不出现，重复的只算一次',
    JSON.stringify(got) === JSON.stringify({ a: { name: '甲' }, b: 'square:base' }), JSON.stringify(got));
  check('hmget：一格都不问就是空的', JSON.stringify(await store.hmget('hmget-probe', [])) === '{}');
  check('hmget：整张表不在也是空的（不抛）', JSON.stringify(await store.hmget('hmget-no-such-hash', ['a'])) === '{}');

  // ② 六十个人的一张榜：五十行，每一行的名字和分数是同一个人的
  const crowd = [];
  for (let i = 0; i < 60; i++) {
    const p = await makePlayer(`hm${i}@example.com`);
    const n = String(i).padStart(2, '0');
    const r = await call({ action: 'push', ...p, runId: 'hm' + n, mode: 'circleSeven', score: 7000 + i, name: '榜' + n });
    if (r.payload?.ok !== true) throw new Error(`夹具：第 ${i} 个人那一局没收下 ${JSON.stringify(r.payload)}`);
    crowd.push(p);
  }
  const paired = (rows) => rows.filter((r) => /^榜\d\d$/.test(r.name));
  const mismatched = (rows) => paired(rows).filter((r) => r.score !== 7000 + Number(r.name.slice(1)));
  const one = await board(crowd[0], { families: ['circle'], modes: ['base'] });
  const rows1 = one.payload?.rows || [];
  check('小球 · 基础：六十个人只回五十行', rows1.length === 50, String(rows1.length));
  check('小球 · 基础：五十行每一行都有名字，名字和分数是同一个人的', paired(rows1).length === 50 && mismatched(rows1).length === 0,
    `${paired(rows1).length} 行有名字，${mismatched(rows1).length} 行错位：${mismatched(rows1).slice(0, 3).map((r) => r.name + ':' + r.score).join(' ')}`);
  check('小球 · 基础：「我排第几」照旧（第 0 个人在这六十个人里分最低，排第 60）', one.payload?.me?.rank === 60, JSON.stringify(one.payload?.me));
  const total = await board(crowd[0], ALL);
  const rowsT = total.payload?.rows || [];
  check('默认选择：名字和分数对得上，每一行都带着棋盘',
    paired(rowsT).length > 0 && mismatched(rowsT).length === 0 && rowsT.every((r) => typeof r.board === 'string' && r.board.length > 0),
    `${paired(rowsT).length} 行是这六十个人，${mismatched(rowsT).length} 行错位，没有棋盘的 ${rowsT.filter((r) => !r.board).length} 行`);
  check('默认选择：这六十个人那几行的棋盘是七色圆球', paired(rowsT).every((r) => r.board === 'circleSeven'),
    paired(rowsT).filter((r) => r.board !== 'circleSeven').map((r) => `${r.name}:${r.board}`).join(' '));
  const group = await board(crowd[0], { families: ['circle'] });
  const rowsG = group.payload?.rows || [];
  check('「小球 · 全部」：名字和分数对得上', paired(rowsG).length > 0 && mismatched(rowsG).length === 0,
    `${paired(rowsG).length} 行是这六十个人，${mismatched(rowsG).length} 行错位`);

  // ③ 源码：board() 里不许再有 hgetall(（原先还有每次都要先跑的 healTotalBoard()，推14 随旧总榜一起删了）
  const src = readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8');
  const fnBody = (name) => {
    const at = src.indexOf(`async function ${name}(`);
    return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at));
  };
  const body = fnBody('board');
  check('源码：board() 里没有 hgetall(（名字只按行取）', body.length > 0 && !body.includes('hgetall('), body ? '' : '没找到这个函数');
  check('源码：healTotalBoard 随旧总榜删了', fnBody('healTotalBoard') === '');
  check('源码：board() 按行取名字（hmget(NAMES）', /hmget\(NAMES,/.test(fnBody('board')));
}

// ---- 看战绩、看榜：每个登录的人每分钟各 60 次（10-11 方案 A-13）--------------
//
// 按登录者的 id 数，不按来路（教室里几十个人共用一个 IP）。第 61 次答 429；同一分钟里另一个账号
// 照常看。两个动作各算各的：看榜看满了，自己的战绩照样打得开。
{
  // 限速是按整分钟分桶的（_ratelimit.js 的 windowKey）：一串 61 次要是正好跨过整分钟，后半截落进新
  // 的一桶，第 61 次就不会被挡——骑在边界上的断言就是偶发红。离整分钟不到 5 秒就先等过去。
  const sameMinute = async () => {
    const left = 60_000 - (Date.now() % 60_000);
    if (left < 5_000) await new Promise((r) => setTimeout(r, left + 50));
  };
  const R = await makePlayer('rate-reader@example.com');
  const R2 = await makePlayer('rate-other@example.com');
  await sameMinute();
  const boards = [];
  for (let i = 0; i < 61; i++) boards.push((await call({ action: 'board', email: R.email, token: R.token })).status);
  check('看榜：同一个人一分钟里前 60 次照常', boards.slice(0, 60).every((c) => c === 200), [...new Set(boards.slice(0, 60))].join(','));
  check('看榜：第 61 次答 429', boards[60] === 429, String(boards[60]));
  const other = await call({ action: 'board', email: R2.email, token: R2.token });
  check('看榜：同一分钟里另一个账号不受牵连（按人数，不按来路）', other.status === 200, String(other.status));
  await sameMinute();
  const own = await call({ action: 'mine', email: R.email, token: R.token });
  check('看榜看满了，自己的战绩照样打得开（两个动作各算各的）', own.status === 200, String(own.status));
  const mines = [own.status];
  for (let i = 0; i < 60; i++) mines.push((await call({ action: 'mine', email: R.email, token: R.token })).status);
  check('看战绩：第 61 次答 429', mines.slice(0, 60).every((c) => c === 200) && mines[60] === 429,
    `${[...new Set(mines.slice(0, 60))].join(',')} → ${mines[60]}`);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
