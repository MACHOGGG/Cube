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
 *   · 总榜是每个人各玩法里最高的那一局（不是累计总分），行上带着那一局的玩法；
 *   · 老版本往总榜写的累计总分，看一眼榜就按存档改回来；
 *   · 榜上人人都在，但没订阅的人看不见——这是玩家自己定的分界；
 *   · 「我排第几」在我不在前五十名的时候也要对；
 *   · 榜按玩法分开记，母标签把旗下几张合起来；
 *   · 重建能照存档重算，并且清得掉指定的那一种局。
 */
process.env.ALLOW_MEMORY_STORE = '1';

const { default: handler } = await import('../api/scores.js');
const accounts = await import('../api/_accounts.js');
const store = await import('../api/_store.js');

import { readFileSync } from 'node:fs';

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
    body = {
      ...body,
      data: {
        shapeId: body.mode,
        totalScore: body.score,
        ...(body.data || {}),
        rules: SCORING_V,
      },
    };
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

// 分数上限：一个离谱的数字不该把整张榜的刻度毁掉。
await call({ action: 'push', ...A, runId: 'r3', mode: 'circle', score: 999999999 });
const capped = await call({ action: 'mine', ...A });
check('离谱的分数被削到上限', capped.payload?.best?.['circle:base'] === 999999999,
  JSON.stringify(capped.payload?.best?.circle));

// ---- 第二个人 -----------------------------------------------------------
await call({ action: 'push', ...B, runId: 's1', mode: 'square', score: 900, name: '乙' });
await call({ action: 'push', ...B, runId: 's2', mode: 'square', score: 100 });

// ---- 榜 -----------------------------------------------------------------
const squareBoard = await call({ action: 'board', ...A, mode: 'square:base' });
check('单局榜按最好的那一局排', squareBoard.payload?.rows?.map((r) => r.score).join() === '900,500',
  JSON.stringify(squareBoard.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
check('榜上写的是玩家自己取的名字',
  squareBoard.payload?.rows?.map((r) => r.name).join() === '乙,甲',
  JSON.stringify(squareBoard.payload?.rows?.map((r) => r.name)));
check('自己那一行标出来了', squareBoard.payload?.rows?.filter((r) => r.me).length === 1);
check('「我排第几」是第二', squareBoard.payload?.me?.rank === 2 && squareBoard.payload.me.score === 500,
  JSON.stringify(squareBoard.payload?.me));

const totalBoard = await call({ action: 'board', ...A });
// 总榜不分玩法：每人上榜的是他所有玩法里最高的那一局——甲是圆球那一局
// （削到上限的十亿差一），乙是方块的 900。不是累计总分。
check('不给玩法就是总榜：每人各玩法里最高的那一局，不是累计总分',
  totalBoard.payload?.rows?.map((r) => r.score).join() === '999999999,900',
  JSON.stringify(totalBoard.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
check('总榜每一行带着那一局是哪个玩法（画行首那个小图形用）',
  totalBoard.payload?.rows?.map((r) => r.mode).join() === 'circle,square',
  JSON.stringify(totalBoard.payload?.rows?.map((r) => r.mode)));
check('单局榜上不带玩法记号——整张都是同一个玩法',
  squareBoard.payload?.rows?.every((r) => r.mode === undefined));
check('总榜上「我排第几」也是按最高单局算的', totalBoard.payload?.me?.rank === 1 && totalBoard.payload.me.score === 999999999,
  JSON.stringify(totalBoard.payload?.me));

const otherMode = await call({ action: 'board', ...A, mode: 'triangle:base' });
check('没人打过的玩法，榜是空的', otherMode.payload?.rows?.length === 0);
check('自己没打过就没有名次（不是第一名）', otherMode.payload?.me === null,
  JSON.stringify(otherMode.payload?.me));

// ---- 门开在看的那一侧 ---------------------------------------------------
await call({ action: 'push', ...C, runId: 't1', mode: 'square', score: 700, name: '丙' });
const lapsedBoard = await call({ action: 'board', ...C, mode: 'square:base' });
check('权益过期的人看不了榜', lapsedBoard.status === 403 && lapsedBoard.payload?.error === 'geniusOnly',
  `${lapsedBoard.status} ${JSON.stringify(lapsedBoard.payload)}`);

const withC = await call({ action: 'board', ...A, mode: 'square:base' });
check('但他打的成绩确确实实在榜上（上榜不要钱）',
  withC.payload?.rows?.some((r) => r.name === '丙' && r.score === 700),
  JSON.stringify(withC.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
check('他自己的存档照样读得到（那是他自己的东西）',
  (await call({ action: 'mine', ...C })).payload?.total === 700);

// ---- 老版本留下的累计总分：看一眼榜就改正 ------------------------------
// 从前总榜写的是累计总分。把丙那一行伪造成那时候的样子（一个大数、没有玩法
// 记号），甲一看榜，服务器就该按丙的存档把它改回他最高的那一局。
const staleRow = (await store.zTop('lb:total', 50)).find((r) => r.score === 700);
await store.zadd('lb:total', 777777, staleRow.member);
await store.hdel('lb:total:mode', staleRow.member);
const healed = await call({ action: 'board', ...A });
const cRow = healed.payload?.rows?.find((r) => r.name === '丙');
check('老版本留下的累计总分，看一眼榜就按存档改回最高单局',
  cRow?.score === 700 && cRow?.mode === 'square', JSON.stringify(cRow));
check('改过之后榜的顺序也对了', healed.payload?.rows?.map((r) => r.score).join() === '999999999,900,700',
  JSON.stringify(healed.payload?.rows?.map((r) => `${r.name}:${r.score}`)));

// ---- 一局都没得过分的人不上总榜 ------------------------------------------
// 玩家看到「总榜上显示了名字但没有标识」：老版本按累计总分写榜，一局都没得
// 分的人也占一行 0 分，而 0 分没有「最高的那一局」可标，行首就空着。现在
// 报一局 0 分不会上总榜；老版本留下的那种 0 分行，谁看一眼榜就撤下来。
const D = await makePlayer('d@example.com');
await call({ action: 'push', ...D, runId: 'd1', mode: 'square', score: 0, name: '丁' });
const afterZero = await call({ action: 'board', ...A });
check('报一局 0 分：总榜上没有这一行', !afterZero.payload?.rows?.some((r) => r.name === '丁'),
  JSON.stringify(afterZero.payload?.rows?.map((r) => `${r.name}:${r.score}`)));
const dRow = (await store.zTop('lb:square:base', 50)).find((r) => r.score === 0);
await store.zadd('lb:total', 0, dRow.member);
check('（伪造成老版本的 0 分行之后它确实在总榜上）',
  (await store.zTop('lb:total', 50)).some((r) => r.member === dRow.member));
const swept = await call({ action: 'board', ...A });
check('老版本留下的 0 分行，看一眼榜就撤下来，别的行不动',
  !swept.payload?.rows?.some((r) => r.name === '丁') && swept.payload?.rows?.length === 3 &&
    swept.payload?.rows?.every((r) => typeof r.mode === 'string' && r.mode.length > 0),
  JSON.stringify(swept.payload?.rows?.map((r) => `${r.name}:${r.score}:${r.mode}`)));

// ---- 玩法 id 不能变成一把写任意键的钥匙 ---------------------------------
const bad = await call({ action: 'push', ...A, runId: 'x1', mode: 'lb:total', score: 5 });
check('玩法 id 不合规就拒收', bad.status === 400 && bad.payload?.error === 'run',
  `${bad.status} ${JSON.stringify(bad.payload)}`);
const stillTotal = await call({ action: 'board', ...A });
check('总榜没被那一下写坏', stillTotal.payload?.rows?.length === 3,
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

// ---- 榜按玩法分开记，母标签把旗下几张合起来 --------------------------------
//
// 一局报上来的 mode 是棋盘 id，玩法（flip / timed / bomb / 老虎机）写在存档那
// 份 data 里。榜的 id 由这两样拼出来（square:base、square:flip…），母标签
// （g:base、g:flip…）看的是旗下几张合起来、每人取最高的那一分。
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

  const timedBoard = await call({ action: 'board', ...H, mode: 'square:timed' });
  check('计时方块那张榜上只有那一局的 900',
    timedBoard.payload?.rows?.map((r) => r.score).join() === '900',
    JSON.stringify(timedBoard.payload?.rows));

  const baseGroup = await call({ action: 'board', ...H, mode: 'g:base' });
  const rowsG = baseGroup.payload?.rows ?? [];
  const names = rowsG.map((r) => `${r.name}:${r.score}`);
  check('《基础》母榜把三块棋盘合起来，每人取自己最高的那一局基础玩法',
    names.includes('辛:400') && names.includes('壬:600'), names.join(' '));
  check('母榜上不掺别的玩法（辛那 900 是计时的，不算在这儿）',
    !names.includes('辛:900') && !names.includes('辛:700'), names.join(' '));
  check('母榜从高到低排', names.indexOf('壬:600') < names.indexOf('辛:400'), names.join(' '));
  check('母榜每一行带着是哪块棋盘（画行首那个小图形用）',
    rowsG.every((r) => typeof r.mode === 'string' && r.mode.length > 0),
    JSON.stringify(rowsG.map((r) => r.mode)));
  check('母榜上「我排第几」也算得出来',
    baseGroup.payload?.me?.score === 400 &&
      baseGroup.payload?.me?.rank === rowsG.findIndex((r) => r.name === '辛') + 1,
    JSON.stringify(baseGroup.payload?.me));

  const noSuchGroup = await call({ action: 'board', ...H, mode: 'g:nope' });
  check('没有的母标签是 400，不是一张空榜', noSuchGroup.status === 400, String(noSuchGroup.status));

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
  check('第一版那局炸弹留在最老那张榜上',
    mineBomb.payload?.best?.['square:bomb'] === 250, JSON.stringify(mineBomb.payload?.best));
  check('第二版那局留在 bomb2（没被现行规则顶走）',
    mineBomb.payload?.best?.['square:bomb2'] === 1100, JSON.stringify(mineBomb.payload?.best));
  check('现行规则的炸弹（含定时炸弹）记在 bomb3 上',
    mineBomb.payload?.best?.['square:bomb3'] === 1500, JSON.stringify(mineBomb.payload?.best));

  const bombBoard = await call({ action: 'board', ...H, mode: 'square:bomb3' });
  check('现行那张榜上只有现行规则那两局里高的那一个',
    bombBoard.payload?.rows?.map((r) => r.score).join() === '1500',
    JSON.stringify(bombBoard.payload?.rows));
  const oldBombBoard = await call({ action: 'board', ...H, mode: 'square:bomb' });
  check('最老那张榜原样留着，没被新局顶掉',
    oldBombBoard.payload?.rows?.map((r) => r.score).join() === '250',
    JSON.stringify(oldBombBoard.payload?.rows));
  const midBombBoard = await call({ action: 'board', ...H, mode: 'square:bomb2' });
  check('第二版那张榜也原样留着（两张归档榜互不相干）',
    midBombBoard.payload?.rows?.map((r) => r.score).join() === '1100',
    JSON.stringify(midBombBoard.payload?.rows));

  const bombGroup = await call({ action: 'board', ...H, mode: 'g:bomb' });
  check('《炸弹》母榜看的是现行那张',
    (bombGroup.payload?.rows ?? []).map((r) => `${r.score}`).join() === '1500',
    JSON.stringify(bombGroup.payload?.rows));

  /*
   * 步步为营 2026-10-02 起也分两版（`puzzleRules` 说了算）：
   *   第 1 版（老档没有 puzzleRules）—— 消线只退一步 → `square:puzzle`
   *   第 2 版（现行）—— 消线退两步，底稿 §7 / E14  → `square:puzzle2`
   * 消线的回报翻倍，一局能走多久、终局盘上有多少枚被消除整条都变了，所以两版不能
   * 放一起比。这儿顺带钉住一个**只在这一档会犯的错**：`kindOf` 里那一行从前写的是
   * `mk === PUZZLE_KIND`，而常量从 'puzzle' 改成 'puzzle2' 之后，存档里的 modeKey
   * 永远还是 'puzzle'——照旧那么写的话每一局步步为营都会掉进 base 那张榜，而且不报错。
   */
  await call({ action: 'push', ...H, runId: 'h7', mode: 'square', score: 320,
    data: { shapeId: 'square', modeKey: 'puzzle', totalScore: 320 } });
  // 340 而不是原先的 640：方块一盘 36 枚，步步为营满打满算 360 分（第 14 推起服务端拦超过
  // 「枚数 × 10」的分），640 是一局打不出来的数。
  await call({ action: 'push', ...H, runId: 'h8', mode: 'square', score: 340,
    data: { shapeId: 'square', modeKey: 'puzzle', puzzleRules: 2, totalScore: 340 } });
  const minePuzzle = await call({ action: 'mine', ...H });
  check('消线退一步那一版留在老榜 square:puzzle 上',
    minePuzzle.payload?.best?.['square:puzzle'] === 320, JSON.stringify(minePuzzle.payload?.best));
  check('现行那一版记在 square:puzzle2 上',
    minePuzzle.payload?.best?.['square:puzzle2'] === 340, JSON.stringify(minePuzzle.payload?.best));
  // 反面：两局步步为营**一局都不许掉进 base 那张榜**（上面那个 kindOf 的坑）。
  check('步步为营没有一局掉进 base 榜',
    minePuzzle.payload?.best?.['square:base'] !== 320 && minePuzzle.payload?.best?.['square:base'] !== 340,
    JSON.stringify(minePuzzle.payload?.best?.['square:base']));
}

// ---- 管理员维护：照存档重建所有榜，顺手清掉《无限反转》 ----------------------
{
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
  const F = await makePlayer('f@example.com');
  const G = await makePlayer('g@example.com');
  // 己：基础方块 300，无限反转 5000，小球只打过无限反转 4000。
  await call({ action: 'push', ...F, runId: 'f1', mode: 'square', score: 300, name: '己',
    data: { shapeId: 'square', modeKey: 'base', totalScore: 300 } });
  await call({ action: 'push', ...F, runId: 'f2', mode: 'square', score: 5000,
    data: { shapeId: 'square', modeKey: 'flip', totalScore: 5000 } });
  await call({ action: 'push', ...F, runId: 'f3', mode: 'circle', score: 4000,
    data: { shapeId: 'circle', modeKey: 'flip', totalScore: 4000 } });
  // 庚：一局无限反转都没打过——他的榜不该被动。
  await call({ action: 'push', ...G, runId: 'g1', mode: 'square', score: 800, name: '庚',
    data: { shapeId: 'square', modeKey: 'base', totalScore: 800 } });

  const before = await call({ action: 'mine', ...F });
  check('清之前：无限反转那两局在它们自己的榜上',
    before.payload?.best?.['square:flip'] === 5000 &&
      before.payload?.best?.['circle:flip'] === 4000,
    JSON.stringify(before.payload?.best));

  const noToken = await call({ action: 'rebuild', drop: ['flip'] });
  check('没有管理员令牌，重建不了', noToken.status === 401, String(noToken.status));
  const wrongToken = await call({ action: 'rebuild', token: 'y'.repeat(32), drop: ['flip'] });
  check('令牌不对也重建不了', wrongToken.status === 401, String(wrongToken.status));

  const done = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, drop: ['flip'] });
  check('重建了，报了动过几个人', done.payload?.ok === true && done.payload.players > 0,
    JSON.stringify(done.payload));

  const after = await call({ action: 'mine', ...F });
  check('无限反转那两张榜清空了', after.payload?.best?.['square:flip'] === undefined &&
    after.payload?.best?.['circle:flip'] === undefined, JSON.stringify(after.payload?.best));
  check('他自己那局基础方块原样留着', after.payload?.best?.['square:base'] === 300,
    JSON.stringify(after.payload?.best));
  check('累计得分一个字没动（那是他的记录，不是榜）',
    after.payload?.total === before.payload?.total,
    `${before.payload?.total} → ${after.payload?.total}`);
  check('存档一局都没少', after.payload?.archive?.length === before.payload?.archive?.length);

  const flipBoard = await call({ action: 'board', ...F, mode: 'g:flip' });
  check('《无限反转》母榜上一个人都没有了', (flipBoard.payload?.rows ?? []).length === 0,
    JSON.stringify(flipBoard.payload?.rows));

  const board = await call({ action: 'board', ...F, mode: 'square:base' });
  const rows = board.payload?.rows?.map((r) => `${r.name}:${r.score}`) ?? [];
  check('基础方块榜上再没有那个五千', !rows.some((r) => r.includes('5000')), rows.join(' '));
  check('没打过无限反转的人分毫未动', rows.includes('庚:800'), rows.join(' '));

  const total = await call({ action: 'board', ...F });
  const mine = total.payload?.rows?.find((r) => r.name === '己');
  check('总榜上己按新的最高单局重排', mine?.score === 300 && mine?.mode === 'square',
    JSON.stringify(mine));

  const twice = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, drop: ['flip'] });
  check('再重建一次，结果一样（重建是幂等的）', twice.payload?.ok === true,
    JSON.stringify(twice.payload));
  const stillGone = await call({ action: 'mine', ...F });
  check('第二次之后无限反转还是空的', stillGone.payload?.best?.['square:flip'] === undefined);

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
    shapeId: 'square', modeKey: 'puzzle', puzzleRules: 2, boardTiles: 36, totalScore: score,
    reason: cleared ? CLEAR : '步数用尽',
    puzzle: { cleared: 0, stars: 0, spent: 20, scoredMoves: 5, streakRefunds: 0, edgeRefunds: 2, left, peak: 9 },
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
  const one = await call({ action: 'board', ...P, mode: 'square:puzzle2' });
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

  const group = await call({ action: 'board', ...P, mode: 'g:puzzle' });
  const g = (group.payload?.rows ?? []).filter((r) => OURS.has(r.name))
    .map((r) => `${r.name}:${r.score}${r.left !== undefined ? '/' + r.left : ''}`).join(' ');
  check('《步步为营》母榜上同样拆开、同样排', g.startsWith('清七:300/7 清三:300/3 没清:300 没清二:250 清九:200/9'), g);

  // 总榜不受拼法影响：它照 stats.best（原分）算。
  const total = await call({ action: 'board', ...P });
  const mineRow = (total.payload?.rows ?? []).find((r) => r.name === '清七');
  check('总榜上还是原分 300（stats.best 不跟着乘 1000）', mineRow?.score === 300, JSON.stringify(mineRow));

  // 同一个人再打一局同分、剩得更多：榜上换成新那一局；剩得少：不动。
  await call({ action: 'push', ...Q, runId: 'q2', mode: 'square', score: 300, data: pz(300, 8) });
  await call({ action: 'push', ...Q, runId: 'q3', mode: 'square', score: 300, data: pz(300, 1) });
  const q = (await call({ action: 'board', ...Q, mode: 'square:puzzle2' })).payload?.rows?.find((r) => r.name === '清三');
  check('同分剩得更多的那一局顶掉旧的，剩得少的不往回拉', q?.left === 8, JSON.stringify(q));

  // 老写法（原分）的那一行：上线之前存进去的。重建之前照原分读，不显示成 0。
  // 真的老玩家总榜上一定有他（交过卷就有），重建就是照总榜和名字表找人的——夹具照这个样子摆。
  const L = await makePlayer('pz-legacy@example.com');
  await store.zadd('lb:square:puzzle2', 280, L.email);
  await store.zadd('lb:total', 280, L.email);
  const legacy = (await call({ action: 'board', ...P, mode: 'square:puzzle2' })).payload?.rows?.find((r) => r.score === 280);
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
  await store.set('runs:' + L.email, [{ runId: 'l1', mode: 'square', score: 280, at: Date.now(), data: { ...pz(280, 4), rules: SCORING_V } }]);
  await store.set('stats:' + L.email, { total: 280, runs: 1, best: { 'square:puzzle2': 280 }, seen: ['l1'] });
  const order = async () => ((await call({ action: 'board', ...P, mode: 'square:puzzle2' })).payload?.rows ?? [])
    .filter((r) => OURS.has(r.name)).map((r) => `${r.name}:${r.score}${r.left !== undefined ? '/' + r.left : ''}`).join(' ');
  const beforeRebuild = await order();
  const rb = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  check('（尺子）重建跑通了', rb.status === 200 && rb.payload?.ok === true, JSON.stringify(rb.payload));
  check('重建之后清七那一行存的是 300 × 1000 + 7', (await store.zscore('lb:square:puzzle2', P.email)) === 300007,
    String(await store.zscore('lb:square:puzzle2', P.email)));
  check('老写法那一行重建成了新写法（280 × 1000 + 4）', (await store.zscore('lb:square:puzzle2', L.email)) === 280004,
    String(await store.zscore('lb:square:puzzle2', L.email)));
  // 重建是照存档把每张榜重写一遍——写法要和交卷时一模一样，不然重建一次排法就变了（比如
  // 没清盘的局重建成原分，就全掉到清盘的局底下去了）。交卷那一路有「和历史最高分 × 1000
  // 取大」兜着，这种错只在重建之后才露出来，所以单量这一条。
  check('重建之后排法一点没变', (await order()) === beforeRebuild, `${beforeRebuild}  →  ${await order()}`);
  const after = (await call({ action: 'board', ...P, mode: 'square:puzzle2' })).payload?.rows ?? [];
  check('重建之后印出来的还是原分和剩几步',
    after.find((r) => r.name === '清七')?.score === 300 && after.find((r) => r.name === '清七')?.left === 7,
    JSON.stringify(after.find((r) => r.name === '清七')));

  // 换邮箱搬家：抄的是榜上那个拼起来的数，不是 stats.best 的原分。
  const { renameScoreOwner } = await import('../api/scores.js');
  await renameScoreOwner(P.email, 'pz-p2@example.com');
  check('换邮箱之后新地址上还是 300 × 1000 + 7', (await store.zscore('lb:square:puzzle2', 'pz-p2@example.com')) === 300007,
    String(await store.zscore('lb:square:puzzle2', 'pz-p2@example.com')));
  check('旧地址撤干净了', (await store.zscore('lb:square:puzzle2', P.email)) === null);
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

// ---- 敲代号开的那一局不上榜（10-08 方案 3-B，玩家拍板方案 A）-------------------
// 照收、照记存档和累计，只是不进 best、不写任何一张榜——best 也不能碰，因为榜上那个数就是从
// best 来的：让它进了 best，下一局随手打的那一局写榜时就把它带上去了。重建也不许把它请回来。
// 每日挑战那一局（seedSource 'daily'）不在此列，照常进榜（今日榜那一半由 check-daily-push 量）。
{
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
  const K = await makePlayer('k@example.com');
  const base = (runId, score, seedSource) => ({
    action: 'push', ...K, runId, mode: 'square', score,
    data: { shapeId: 'square', modeKey: 'base', totalScore: score, ...(seedSource ? { seedSource } : {}) },
  });
  const rowOf = async (mode) => {
    const b = await call({ action: 'board', ...K, ...(mode ? { mode } : {}) });
    return b.payload?.rows?.find((r) => r.me)?.score ?? null;
  };
  const r1 = await call({ ...base('k1', 300, 'random'), name: '癸' });
  check('（尺子）随手开的一局照常上榜', r1.payload?.ok === true && (await rowOf('square:base')) === 300,
    JSON.stringify(r1.payload));
  const r2 = await call(base('k2', 900, 'entered'));
  check('敲代号开的一局：照收（200 ok），累计照加', r2.status === 200 && r2.payload?.ok === true && r2.payload?.total === 1200,
    `${r2.status} ${JSON.stringify(r2.payload)}`);
  const mineK = await call({ action: 'mine', ...K });
  check('敲代号开的一局：存档里有它（那是他自己的历史）',
    mineK.payload?.archive?.some((r) => r.runId === 'k2' && r.data?.seedSource === 'entered'),
    JSON.stringify(mineK.payload?.archive?.map((r) => r.runId)));
  check('敲代号开的一局：best 不动（还是 300）', mineK.payload?.best?.['square:base'] === 300, JSON.stringify(mineK.payload?.best));
  check('敲代号开的一局：单局榜上还是 300', (await rowOf('square:base')) === 300, String(await rowOf('square:base')));
  check('敲代号开的一局：总榜上也还是 300', (await rowOf()) === 300, String(await rowOf()));
  // 漏网的那条路：它进了 best 的话，下一局（哪怕更差）写榜时会把 900 带上去。
  await call(base('k3', 200, 'random'));
  check('下一局随手打的（更差）写榜时，没把那个 900 带上去', (await rowOf('square:base')) === 300, String(await rowOf('square:base')));
  const rebuilt = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  check('（尺子）重建跑了', rebuilt.payload?.ok === true, JSON.stringify(rebuilt.payload));
  check('重建照存档重算：敲代号那一局还是不上榜', (await rowOf('square:base')) === 300 && (await rowOf()) === 300,
    `${await rowOf('square:base')} / ${await rowOf()}`);
  const r4 = await call(base('k4', 1000, 'daily'));
  check('每日挑战那一局（seedSource daily）照常上榜（别误伤）', r4.payload?.ok === true && (await rowOf('square:base')) === 1000,
    String(await rowOf('square:base')));
  // 步步为营那几张榜写的不是 best，是「这一局自己的数」和 best 取大（boardValue）——best 挡不住
  // 这一条，挡住它的只有「敲代号的局一张榜都不碰」那一句。
  const W = await makePlayer('k-pz@example.com');
  const pz = (score, seedSource) => ({
    shapeId: 'square', modeKey: 'puzzle', puzzleRules: 2, boardTiles: 36, totalScore: score, reason: '步数用尽',
    puzzle: { cleared: 0, stars: 0, spent: 20, scoredMoves: 5, streakRefunds: 0, edgeRefunds: 2, left: 0, peak: 9 },
    ...(seedSource ? { seedSource } : {}),
  });
  await call({ action: 'push', ...W, runId: 'w1', mode: 'square', score: 120, name: '代号壬', data: pz(120, 'random') });
  const pzRow = async () =>
    (await call({ action: 'board', ...W, mode: 'square:puzzle2' })).payload?.rows?.find((r) => r.me)?.score ?? null;
  check('（尺子）步步为营：随手开的一局照常上榜', (await pzRow()) === 120, String(await pzRow()));
  await call({ action: 'push', ...W, runId: 'w2', mode: 'square', score: 330, data: pz(330, 'entered') });
  check('步步为营：敲代号开的一局也不上榜（还是 120）', (await pzRow()) === 120, String(await pzRow()));
  delete process.env.ADMIN_TOKEN;
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
  const one = await call({ action: 'board', ...crowd[0], mode: 'circleSeven' });
  const rows1 = one.payload?.rows || [];
  check('单局榜：六十个人只回五十行', rows1.length === 50, String(rows1.length));
  check('单局榜：五十行每一行都有名字，名字和分数是同一个人的', paired(rows1).length === 50 && mismatched(rows1).length === 0,
    `${paired(rows1).length} 行有名字，${mismatched(rows1).length} 行错位：${mismatched(rows1).slice(0, 3).map((r) => r.name + ':' + r.score).join(' ')}`);
  check('单局榜：「我排第几」照旧（第 0 个人分最低，排第 60）', one.payload?.me?.rank === 60, JSON.stringify(one.payload?.me));
  const total = await call({ action: 'board', ...crowd[0] });
  const rowsT = total.payload?.rows || [];
  check('总榜：名字和分数对得上，每一行都带着玩法记号',
    paired(rowsT).length > 0 && mismatched(rowsT).length === 0 && rowsT.every((r) => typeof r.mode === 'string' && r.mode.length > 0),
    `${paired(rowsT).length} 行是这六十个人，${mismatched(rowsT).length} 行错位，没有记号的 ${rowsT.filter((r) => !r.mode).length} 行`);
  check('总榜：这六十个人那几行的记号是七色圆球', paired(rowsT).every((r) => r.mode === 'circleSeven'),
    paired(rowsT).filter((r) => r.mode !== 'circleSeven').map((r) => `${r.name}:${r.mode}`).join(' '));
  const group = await call({ action: 'board', ...crowd[0], mode: 'g:layout' });
  const rowsG = group.payload?.rows || [];
  check('母榜：名字和分数对得上', paired(rowsG).length > 0 && mismatched(rowsG).length === 0,
    `${paired(rowsG).length} 行是这六十个人，${mismatched(rowsG).length} 行错位`);

  // ③ 源码：board() 和它每次都要先跑的 healTotalBoard() 里不许再有 hgetall(
  const src = readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8');
  const fnBody = (name) => {
    const at = src.indexOf(`async function ${name}(`);
    return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at));
  };
  for (const name of ['board', 'healTotalBoard']) {
    const body = fnBody(name);
    check(`源码：${name}() 里没有 hgetall(（名字和玩法记号只按行取）`, body.length > 0 && !body.includes('hgetall('),
      body ? '' : '没找到这个函数');
  }
  check('源码：board() 按行取名字（hmget(NAMES）', /hmget\(NAMES,/.test(fnBody('board')));
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
