/**
 * 交卷撞上《重建榜单》：那一局会不会被重建整份覆写掉。
 *
 *   node scripts/check-stats-race.mjs
 *
 * 不起服务器、不开浏览器：库用进程内那一份（ALLOW_MEMORY_STORE），直接叫
 * api/scores.js 的 handler。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * `stats:<id>` 是**一份 JSON 大文档**，里头四个字段：total（累计得分）、runs
 * （打过几局）、best（各榜最高）、seen（收过哪些局）。两条路都会「读整份 → 改
 * → 写整份回去」：
 *
 *   · push     玩家交卷。加 total、加 runs、更新 best、记 seen。
 *   · rebuild  管理员点《重建榜单》。照存档重算 best，**只改 best**，写整份。
 *
 * 从前两条路都不带锁。重建读出整份之后，还要走 25 次撤榜、若干次上榜才轮到写
 * 入——中间那几百毫秒里玩家交了卷，他那一局先写进了 stats，紧接着被重建的整份
 * 覆写盖掉。实测（2026-09，给内存库注入 3ms 往返延迟后扫时序）：
 *
 *   正确答案：total=600 runs=2 best=500
 *   交卷比重建晚 10…60ms → total=100 runs=1 best=100    三个数全回退
 *   再重建一次           → total=100 runs=1 best=500    只救得回 best
 *
 * **最后那一行是这道门存在的理由。** 重建从存档重算 best，所以 best 还能自愈；
 * 它**从来不重算 total 和 runs**，那两个数一旦被盖掉就永久错着。玩家看到的是
 * 《记录与排名》上的累计得分凭空少了一局——而管理员那一侧全绿。
 *
 * 现在两条路都走 _store.js 的 withLock（`statslock:<id>`），而且是**整段进锁**：
 * 读存档、算 best、撤榜上榜、写 stats 全在一把锁里。只把写入圈进去是不够的
 * ——best 是从存档算出来的，算完到写完之间松一次锁，新交的那一局就溜进了存档，
 * 而 best 已经按旧存档算好了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 怎么把窗口撑开
 *
 * 内存库一次往返是一个微任务，比真 Redis 快几个数量级，照常并发根本撞不上。所
 * 以这里不注入延迟（那要在被测代码里留个口子），而是**扫微任务时序**：先把
 * rebuild 发出去、不 await，再让出 k 个微任务，然后才交卷。k 从 0 数到 UPTO，
 * 于是交卷落在重建那一段里的每一个位置都试过一遍。
 *
 * 一档一档都跑，是因为这种洞只在某几档上现形：k=0（还没读存档）和 k 很大（早
 * 写完了）都是安全的，危险的是中间那一段。只试一个 k 的门是一道假门。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.ADMIN_TOKEN = 'x'.repeat(32);

const scores = (await import('../api/scores.js')).default;
const { renameScoreOwner } = await import('../api/scores.js');
const A = await import('../api/_accounts.js');
const S = await import('../api/_store.js');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 每次调用换一个来源 IP。
 *
 * rebuild 一小时只让一个来源敲 20 次（和 api/mint.js 同一个数）。这道门一轮要
 * 起几十次重建，全用同一个「unknown」会在第 21 次开始吃 429，门就从「查竞态」
 * 变成「查限速」了——check-room-races 踩过一次，这里照它的办法来。
 * 198.18.0.0/15 是 RFC 2544 的测试网段，不会撞上真地址。
 */
let ipN = 0;
const nextIp = () => `198.18.${(ipN >> 8) & 255}.${ipN++ & 255}`;

async function call(body) {
  const req = { method: 'POST', headers: { 'x-vercel-forwarded-for': nextIp() }, body };
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
  await scores(req, res);
  return { status: res.code, payload: res.payload };
}

/** 让出 n 个微任务。内存库一次往返就是一两个微任务，所以这是这里的「时钟」。 */
async function ticks(n) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** 开一个有权益的账号，回它的登录凭据。 */
async function freshPlayer(tag) {
  const email = `${tag}@example.com`;
  const account = A.newAccount('secret', 'code');
  account.until = Date.now() + 30 * 24 * 3600e3;
  await A.saveAccount(email, account);
  return { email, token: account.token };
}

/**
 * 把这个人从库里彻底抹掉。
 *
 * 不是为了干净，是为了这道门量的东西还是它想量的：rebuild 的名单来自总榜加名
 * 字表，上一档留下的人会一直算进去，跑到第三十档时它要翻三十个人的存档——那时
 * 微任务偏移早就落在别人那一段里了，等于什么都没测。所以一档一个人，跑完抹掉。
 */
async function wipe(id) {
  await S.del('stats:' + id);
  await S.del('runs:' + id);
  await S.zrem('lb:total', id);
  await S.hdel('lb:total:mode', id);
  await S.hdel('lbnames', id);
  await S.zrem('lb:square:base', id);
}

// ---------------------------------------------------------------------------
// 一档一档扫：交卷落在重建那一段的每个位置
// ---------------------------------------------------------------------------
//
// 一局 100 分打完（进了总榜，重建的名单才认得他），起重建、不等它，让出 k 个
// 微任务，再交一局 500 分。正确答案永远是 total=600 / runs=2 / best=500。
const UPTO = 120;
const STEP = 4;
const bad = [];
let scanned = 0;

for (let k = 0; k <= UPTO; k += STEP) {
  const who = await freshPlayer(`race${k}`);
  const id = who.email;

  const first = await call({ action: 'push', email: who.email, token: who.token, runId: 'r1', mode: 'square', score: 100 });
  if (first.status !== 200) {
    console.error(`第一局就没交上（k=${k}）：`, first.status, JSON.stringify(first.payload));
    process.exit(2);
  }

  const rebuilding = call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  await ticks(k);
  const second = await call({ action: 'push', email: who.email, token: who.token, runId: 'r2', mode: 'square', score: 500 });
  const done = await rebuilding;

  const after = (await call({ action: 'mine', email: who.email, token: who.token })).payload || {};
  const got = {
    total: after.total,
    runs: after.runs,
    best: after.best?.['square:base'],
  };
  const ok =
    second.status === 200 &&
    done.status === 200 &&
    got.total === 600 &&
    got.runs === 2 &&
    got.best === 500;
  if (!ok) {
    bad.push(
      `k=${k}：total=${got.total}（该 600）runs=${got.runs}（该 2）best=${got.best}（该 500）` +
        (second.status !== 200 ? `，交卷回了 ${second.status}` : '') +
        (done.status !== 200 ? `，重建回了 ${done.status}` : ''),
    );
  }
  scanned++;
  await wipe(id);
}

check(
  `扫了 ${scanned} 档时序偏移（0…${UPTO} 微任务），每一档交的那一局都没被重建盖掉`,
  bad.length === 0,
  bad.length ? `\n      ` + bad.join('\n      ') : '',
);

// ---------------------------------------------------------------------------
// 顺带守两件事：重建不该动 total/runs，抢不到锁的人要被数出来
// ---------------------------------------------------------------------------
//
// 第一件是上面那个洞的另一半：就算没撞上并发，重建也绝不该改这两个数——它压根
// 不重算它们，一旦改了就只有「被覆写」这一种可能。
{
  const who = await freshPlayer('quiet');
  await call({ action: 'push', email: who.email, token: who.token, runId: 'q1', mode: 'square', score: 111 });
  await call({ action: 'push', email: who.email, token: who.token, runId: 'q2', mode: 'circle', score: 222 });
  const before = (await call({ action: 'mine', email: who.email, token: who.token })).payload;
  const done = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  const after = (await call({ action: 'mine', email: who.email, token: who.token })).payload;

  check(
    '没有并发时，重建把 total 和 runs 原样留着',
    after.total === before.total && after.runs === before.runs,
    `total ${before.total}→${after.total}，runs ${before.runs}→${after.runs}`,
  );
  check(
    '没有并发时，重建照存档把 best 算回原样',
    after.best['square:base'] === 111 && after.best['circle:base'] === 222,
    JSON.stringify(after.best),
  );
  check(
    '回包里有 skipped 这一栏（抢不到锁的人要数得出来）',
    typeof done.payload?.skipped === 'number',
    JSON.stringify({ players: done.payload?.players, rows: done.payload?.rows, skipped: done.payload?.skipped }),
  );
  await wipe(who.email);
}

// ---------------------------------------------------------------------------
// 同一局报两次，仍然只算一次（seen 也住在那份文档里，别被锁改坏）
// ---------------------------------------------------------------------------
{
  const who = await freshPlayer('dupe');
  const a = await call({ action: 'push', email: who.email, token: who.token, runId: 'same', mode: 'square', score: 300 });
  const b = await call({ action: 'push', email: who.email, token: who.token, runId: 'same', mode: 'square', score: 300 });
  const mine = (await call({ action: 'mine', email: who.email, token: who.token })).payload;
  check('同一局报两次，第二次明说是重复', a.status === 200 && b.payload?.duplicate === true);
  check('同一局报两次，只算一次', mine.total === 300 && mine.runs === 1, `total=${mine.total} runs=${mine.runs}`);
  await wipe(who.email);
}

// ---------------------------------------------------------------------------
// 同一个人两局同时交（两台设备、网差重发）：两局都要在
// ---------------------------------------------------------------------------
//
// 这是 push 撞 push。原来那段注释写着「同一个人不会在两台设备上同时交卷，所以
// 这里的读改写没有别人来抢」——两台设备是真的少见，但两次重发不是，而且 rebuild
// 本来就会来抢。锁一加，这一路也顺带守住了。
{
  const who = await freshPlayer('both');
  const [x, y] = await Promise.all([
    call({ action: 'push', email: who.email, token: who.token, runId: 'x1', mode: 'square', score: 100 }),
    call({ action: 'push', email: who.email, token: who.token, runId: 'y1', mode: 'circle', score: 200 }),
  ]);
  const mine = (await call({ action: 'mine', email: who.email, token: who.token })).payload;
  check('两局同时交，都回了 200', x.status === 200 && y.status === 200, `${x.status} / ${y.status}`);
  check(
    '两局同时交，两局都在（total=300、runs=2、两张榜都有分）',
    mine.total === 300 && mine.runs === 2 && mine.best['square:base'] === 100 && mine.best['circle:base'] === 200,
    `total=${mine.total} runs=${mine.runs} best=${JSON.stringify(mine.best)}`,
  );
  check('两局同时交，存档里两局都留着', (mine.archive || []).length === 2, `存了 ${(mine.archive || []).length} 局`);
  await wipe(who.email);
}

// ---------------------------------------------------------------------------
// 换邮箱搬家撞上交卷：那一局会不会在两个地址之间掉下去
// ---------------------------------------------------------------------------
//
// renameScoreOwner 是第三条「读整份 → 写到新 id → 删旧 id」的裸路。补锁那次给
// push 和 rebuild 都套上了 statsLockKey，唯独漏了它。
//
// 触发条件：玩家正在换邮箱（要走好几次网络往返，这几秒跨度不短），而旧邮箱那台
// 设备上正好有一局收尾交卷——比如在电脑上确认换邮箱，手机上那局刚好打完。两边
// 都回 200、都不报错，可新邮箱名下少了这一局，旧邮箱的存档已经删掉了：这一局的
// 分数彻底消失，玩家自己和客服都查不出任何异常。
//
// 这道门守的是**一分都没丢**：那一局要么跟着搬到了新地址，要么还留在旧地址上
// （多一份不好看，但一分没丢，和 renameScoreOwner 那段注释里的「先写新、最后删
// 旧」同一条教训）。两个地址加起来必须还是 600 分、2 局。
const MOVE_UPTO = 24;
for (let k = 0; k <= MOVE_UPTO; k++) {
  const who = await freshPlayer(`move${k}`);
  const from = who.email;
  const to = `moved${k}@example.com`;

  const first = await call({ action: 'push', email: from, token: who.token, runId: 'm1', mode: 'square', score: 100 });
  if (first.status !== 200) {
    console.error(`第一局就没交上（k=${k}）：`, first.status);
    process.exit(2);
  }

  const moving = renameScoreOwner(from, to).catch((err) => ({ err }));
  await ticks(k);
  const second = await call({ action: 'push', email: from, token: who.token, runId: 'm2', mode: 'square', score: 500 });
  await moving;

  const oldStats = (await S.get('stats:' + from)) || { total: 0, runs: 0 };
  const newStats = (await S.get('stats:' + to)) || { total: 0, runs: 0 };
  const total = Number(oldStats.total || 0) + Number(newStats.total || 0);
  const runs = Number(oldStats.runs || 0) + Number(newStats.runs || 0);
  const ok = second.status === 200 && total === 600 && runs === 2;
  if (!ok || k === MOVE_UPTO) {
    check(
      `搬家撞交卷（让出 ${k} 个微任务）：两个地址加起来一分没丢`,
      ok,
      `交卷 ${second.status}，旧 ${oldStats.total}/${oldStats.runs} + 新 ${newStats.total}/${newStats.runs} = ${total}/${runs}`,
    );
  }
  if (!ok) break;
  await wipe(from);
  await wipe(to);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
