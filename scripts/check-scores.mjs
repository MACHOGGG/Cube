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
 *   · 「我排第几」在我不在前五十名的时候也要对。
 */
process.env.ALLOW_MEMORY_STORE = '1';

const { default: handler } = await import('../api/scores.js');
const accounts = await import('../api/_accounts.js');
const store = await import('../api/_store.js');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 叫一次接口，把状态码和回包一起拿回来。 */
async function call(body) {
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
check('单局最好成绩还是 500', mineA.payload?.best?.square === 500,
  JSON.stringify(mineA.payload?.best));
check('存档里两局都在，新的在前', mineA.payload?.archive?.length === 2 &&
  mineA.payload.archive[0].runId === 'r2', JSON.stringify(mineA.payload?.archive?.map((r) => r.runId)));
check('存档留着整局的原始数据（记录页要靠它重画战绩图）',
  mineA.payload?.archive?.[1]?.data?.totalScore === 500);

// 分数上限：一个离谱的数字不该把整张榜的刻度毁掉。
await call({ action: 'push', ...A, runId: 'r3', mode: 'circle', score: 999999999 });
const capped = await call({ action: 'mine', ...A });
check('离谱的分数被削到上限', capped.payload?.best?.circle === 999999999,
  JSON.stringify(capped.payload?.best?.circle));

// ---- 第二个人 -----------------------------------------------------------
await call({ action: 'push', ...B, runId: 's1', mode: 'square', score: 900, name: '乙' });
await call({ action: 'push', ...B, runId: 's2', mode: 'square', score: 100 });

// ---- 榜 -----------------------------------------------------------------
const squareBoard = await call({ action: 'board', ...A, mode: 'square' });
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

const otherMode = await call({ action: 'board', ...A, mode: 'triangle' });
check('没人打过的玩法，榜是空的', otherMode.payload?.rows?.length === 0);
check('自己没打过就没有名次（不是第一名）', otherMode.payload?.me === null,
  JSON.stringify(otherMode.payload?.me));

// ---- 门开在看的那一侧 ---------------------------------------------------
await call({ action: 'push', ...C, runId: 't1', mode: 'square', score: 700, name: '丙' });
const lapsedBoard = await call({ action: 'board', ...C, mode: 'square' });
check('权益过期的人看不了榜', lapsedBoard.status === 403 && lapsedBoard.payload?.error === 'geniusOnly',
  `${lapsedBoard.status} ${JSON.stringify(lapsedBoard.payload)}`);

const withC = await call({ action: 'board', ...A, mode: 'square' });
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
const dRow = (await store.zTop('lb:square', 50)).find((r) => r.score === 0);
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

// ---- 管理员维护：把《无限反转》从榜上抹掉 --------------------------------
//
// 一局报上来的 mode 是棋盘 id，玩法（flip / timed / bomb）只在存档那一份 data
// 里——所以无限反转的分和基础玩法记在同一张榜上。sweep 要做的是：把这一种局
// 从榜上抹掉，人家自己的存档和累计得分一个字不动。
{
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
  const F = await makePlayer('f@example.com');
  const G = await makePlayer('g@example.com');
  // 己：基础方块 300，无限反转 5000（榜上现在是 5000），小球只打过无限反转 4000。
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
  check('抹之前：己方块榜上是无限反转那 5000', before.payload?.best?.square === 5000 &&
    before.payload?.best?.circle === 4000, JSON.stringify(before.payload?.best));

  const noToken = await call({ action: 'sweep', modeKey: 'flip' });
  check('没有管理员令牌，抹不动', noToken.status === 401, String(noToken.status));
  const wrongToken = await call({ action: 'sweep', token: 'y'.repeat(32), modeKey: 'flip' });
  check('令牌不对也抹不动', wrongToken.status === 401, String(wrongToken.status));

  const done = await call({ action: 'sweep', token: process.env.ADMIN_TOKEN, modeKey: 'flip' });
  check('抹了：动了一个人，改一行、撤一行', done.payload?.ok === true &&
    done.payload.touched === 1 && done.payload.rowsChanged === 1 && done.payload.rowsDropped === 1,
    JSON.stringify(done.payload));

  const after = await call({ action: 'mine', ...F });
  check('方块榜回到他自己那局基础玩法的 300', after.payload?.best?.square === 300,
    JSON.stringify(after.payload?.best));
  check('小球上他只打过无限反转：这一行整个撤下来', after.payload?.best?.circle === undefined,
    JSON.stringify(after.payload?.best));
  check('他自己的存档一局都没少（那是他的记录，不是榜）', after.payload?.archive?.length === 3,
    JSON.stringify(after.payload?.archive?.map((r) => r.runId)));
  check('累计得分也没动', after.payload?.total === 9300, JSON.stringify(after.payload?.total));

  const board = await call({ action: 'board', ...F, mode: 'square' });
  const rows = board.payload?.rows?.map((r) => `${r.name}:${r.score}`) ?? [];
  check('方块榜上再没有那个五千', !rows.some((r) => r.includes('5000')), rows.join(' '));
  check('没打过无限反转的人分毫未动', rows.includes('庚:800'), rows.join(' '));
  const circle = await call({ action: 'board', ...F, mode: 'circle' });
  check('小球榜上没有己那一行', !(circle.payload?.rows ?? []).some((r) => r.name === '己'),
    JSON.stringify(circle.payload?.rows?.map((r) => r.name)));
  const total = await call({ action: 'board', ...F });
  const mine = total.payload?.rows?.find((r) => r.name === '己');
  check('总榜上己按新的最高单局重排', mine?.score === 300 && mine?.mode === 'square',
    JSON.stringify(mine));

  const twice = await call({ action: 'sweep', token: process.env.ADMIN_TOKEN, modeKey: 'flip' });
  check('再抹一次什么都不动（抹干净了就是干净的）', twice.payload?.touched === 0,
    JSON.stringify(twice.payload));
  delete process.env.ADMIN_TOKEN;
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
