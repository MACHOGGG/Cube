/**
 * 两个 ADMIN_TOKEN 接口的限速：发码（api/mint.js）和重建榜（api/scores.js）。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-mint-limit.mjs
 *
 * 这两处是站里权限最高的地方，只靠 ADMIN_TOKEN 挡着：发码能批量发内部码、也能
 * 列出全部玩家的邮箱；重建榜要把全站每个人的存档翻一遍再重写所有榜，是站里最
 * 贵的一次调用——敲开门之前就已经不便宜了。两处用的是同一套限速
 * （_ratelimit.js）、同一个数（20 次/小时），所以摆在一起验。
 *
 * 要验的是四件事：
 *
 *   · 一个来源一小时敲够 20 次就 429，第 21 次连令牌都不看；
 *   · 换一个来源不受牵连（限的是来源，不是整个接口）；
 *   · 令牌对的时候照常发码——限速不该挡住真正的管理员；
 *   · 重建榜那一处也一样，而且**限速在验令牌之前**（下面最后一段）。
 *
 * 另有两条是令牌本身的（10-11 方案 A-11）：比对量不出令牌有多长（交一串等长、含多字节字符的
 * 东西也是 401，不是 500）；服务器上那把短于 32 位（没配也算），后台整个关着（503），日志里只
 * 有「ADMIN_TOKEN 太短」那一句、不带值。
 *
 * 重建榜那两条是补记的：它在 885c154 就接上限速了，可巡检报告直到今天还把
 * 「排行榜重建接口缺限速」列成高优先级未办事项。没有断言守着的修复，隔几周
 * 就会被当成没修过——这两条就是拿来钉住它的。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.ADMIN_TOKEN = 'T'.repeat(32);

const { default: handler } = await import('../api/mint.js');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 叫一次接口。ip 就是这一次的来源（限速按它分桶）。 */
async function call(body, ip) {
  const req = { method: 'POST', body, headers: { 'x-forwarded-for': ip } };
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

const GUESSER = '203.0.113.7';
const ADMIN = '198.51.100.9';

// 猜令牌的人：前 20 次是「令牌不对」，第 21 次开始连看都不看。
const codes = [];
for (let i = 0; i < 20; i++) {
  codes.push((await call({ token: 'wrong'.padEnd(32, 'x'), plan: 'month', count: 1 }, GUESSER)).status);
}
check('前 20 次答的是「令牌不对」（401），不是限速', codes.every((c) => c === 401),
  [...new Set(codes)].join(','));
const blocked = await call({ token: 'wrong'.padEnd(32, 'x'), plan: 'month', count: 1 }, GUESSER);
check('第 21 次就 429 了', blocked.status === 429 && blocked.payload?.error === 'tooMany',
  `${blocked.status} ${JSON.stringify(blocked.payload)}`);
const blockedRight = await call({ token: process.env.ADMIN_TOKEN, plan: 'month', count: 1 }, GUESSER);
check('这个来源连拿对令牌也被挡（限的是敲门次数）', blockedRight.status === 429,
  String(blockedRight.status));

// 换个来源：不受牵连。
const other = await call({ token: 'wrong'.padEnd(32, 'x'), plan: 'month', count: 1 }, ADMIN);
check('换一个来源照常答「令牌不对」', other.status === 401, String(other.status));

// 真管理员：照常发码。
const minted = await call({ token: process.env.ADMIN_TOKEN, plan: 'month', count: 2 }, ADMIN);
check('令牌对了就发码，限速不挡真管理员',
  minted.status === 200 && minted.payload?.count === 2 && minted.payload.codes?.length === 2,
  `${minted.status} ${JSON.stringify(minted.payload?.count)}`);

// ── 重建榜（api/scores.js 的 action:'rebuild'）：同一套尺子 ────────────────
//
// 顺序是关键：限速要在验令牌**之前**。反过来的话，猜管理员令牌的人有无限次
// 机会，而每一次都还要让服务器先把整张榜的活干一遍。

const { default: scores } = await import('../api/scores.js');
const REBUILDER = '192.0.2.44';
const wrong = 'w'.repeat(process.env.ADMIN_TOKEN.length);

async function rebuild(token, ip) {
  const req = { method: 'POST', body: { action: 'rebuild', token }, headers: { 'x-forwarded-for': ip } };
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

const tries = [];
for (let i = 0; i < 20; i++) tries.push((await rebuild(wrong, REBUILDER)).status);
check('重建榜：前 20 次答的是「令牌不对」（401），不是限速', tries.every((c) => c === 401),
  [...new Set(tries)].join(','));

const stopped = await rebuild(process.env.ADMIN_TOKEN, REBUILDER);
check('重建榜：第 21 次连**拿对令牌**也被 429 挡下——限速在验令牌之前',
  stopped.status === 429 && stopped.payload?.error === 'tooMany',
  `${stopped.status} ${JSON.stringify(stopped.payload)}`);

// ── 同时打进来的 200 次，也只能放行 20 次 ───────────────────────────────
//
// 上面每一条都是「一个一个地发」——发一次、等回来、再发下一次。限速原先那个
// 写法（读一次数字 → 加一 → 写回去）在这种发法下是对的，所以上面那些断言一
// 直是绿的，而门其实是虚掩的：三步之间隔着两次往返，同一瞬间打进来的请求会
// 读到同一个旧值，整整一批只被记成一次。实测过一回：并发打 200 次，本该 20
// 次/小时的上限一次都没拦住。
//
// 这条断言就是拿来钉住「已经改成原子的」这件事的。它必须在 Promise.all 里
// 一起发——顺序发的版本永远是绿的，验不出任何东西。
const SWARM = '203.0.113.99';
const swarm = await Promise.all(
  Array.from({ length: 200 }, () =>
    call({ token: 'wrong'.padEnd(32, 'x'), plan: 'month', count: 1 }, SWARM)),
);
const letIn = swarm.filter((r) => r.status !== 429).length;
check('200 次并发只放行 20 次（限速是一步做完的，不是读-改-写）', letIn === 20,
  `放行了 ${letIn} 次，挡下 ${200 - letIn} 次`);

// ── 令牌比对量不出长度（10-11 方案 A-11）──────────────────────────────
//
// 原先是「长度不等就 401、等长才逐字节比」，而 Buffer.from 按 UTF-8 编码：交一串和真令牌**字符数**
// 相同、却含多字节字符的东西，两个 Buffer 字节数不同，timingSafeEqual 当场抛——平台回 500。500 和
// 401 一对照，令牌有几个字符就量出来了。现在两边各做一次 sha256 再比，怎么交都是同一句 401。
// （处理函数要是抛了，这儿记成 500——和线上平台回的一样。）
{
  const PROBE = '198.51.100.77';
  const probe = async (token) => {
    try {
      return (await call({ token, plan: 'month', count: 1 }, PROBE)).status;
    } catch {
      return 500;
    }
  };
  const sameLen = await probe('é'.repeat(process.env.ADMIN_TOKEN.length));
  const otherLen = await probe('é'.repeat(process.env.ADMIN_TOKEN.length - 1));
  check('令牌等长、含多字节字符：答 401，不是 500（和长度不对的答同一句，量不出令牌有多长）',
    sameLen === 401 && otherLen === 401, `等长 ${sameLen} · 差一位 ${otherLen}`);
}

// ── 服务器上那把太短：后台整个关着（10-11 方案 A-11）────────────────────
//
// 拿那把短令牌本身来也不开门——宁可把后台关掉，也不拿一把能猜的锁守着它。日志里写一句「ADMIN_TOKEN
// 太短」，**不打印值**。没配（空串）也算短。
{
  const realToken = process.env.ADMIN_TOKEN;
  const logged = [];
  const origErr = console.error;
  console.error = (...a) => logged.push(a.map(String).join(' '));
  const SHORT = 'S'.repeat(31);
  const answers = [];
  try {
    process.env.ADMIN_TOKEN = SHORT;
    answers.push(await call({ token: SHORT, plan: 'month', count: 1 }, '198.51.100.78'));
    answers.push(await call({ token: SHORT, action: 'list' }, '198.51.100.78'));
    process.env.ADMIN_TOKEN = '';
    answers.push(await call({ token: '', plan: 'month', count: 1 }, '198.51.100.78'));
  } finally {
    console.error = origErr;
    process.env.ADMIN_TOKEN = realToken;
  }
  check('服务器上那把短于 32 位（或没配）：发码、列名单一律 503 adminToken',
    answers.every((a) => a.status === 503 && a.payload?.error === 'adminToken'),
    answers.map((a) => `${a.status}:${a.payload?.error}`).join(' '));
  check('日志写「ADMIN_TOKEN 太短」，不带令牌的值',
    logged.some((l) => l.includes('ADMIN_TOKEN 太短')) && !logged.some((l) => l.includes(SHORT)),
    JSON.stringify(logged.slice(0, 3)));
  const back = await call({ token: realToken, plan: 'month', count: 1 }, '198.51.100.79');
  check('（尺子）换回一把够长的，照常发码', back.status === 200, String(back.status));
}

// ── grant 一次最多 20 个地址；大小写不同的同一个地址只发一批（10-15 补充 S7，L-4 ⑥）──────────────
//
// 原先没有上限：21 个照发；同一个地址大小写不同写两遍，发两批。超过整批拒、一张都不铸。
{
  const { newAccount, saveAccount, loadAccount } = await import('../api/_accounts.js');
  const GRANTER = '198.51.100.80';
  const many = Array.from({ length: 21 }, (_, i) => `grant${i}@example.com`);
  for (const m of many) await saveAccount(m, newAccount('', 'code'));
  const inboxOf = async (m) => ((await loadAccount(m))?.inbox || []).length;
  const tooMany = await call({ token: process.env.ADMIN_TOKEN, action: 'grant', plan: 'month', count: 1, emails: many }, GRANTER);
  check('grant 21 个地址：整批拒，400 emails、max 20', tooMany.status === 400 && tooMany.payload?.error === 'emails' && tooMany.payload?.max === 20,
    `${tooMany.status} ${JSON.stringify(tooMany.payload)}`);
  let got = 0;
  for (const m of many) got += await inboxOf(m);
  check('grant 21 个地址：一张码都没铸（谁的收件箱里都没有）', got === 0, `${got} 张`);
  const twenty = await call({ token: process.env.ADMIN_TOKEN, action: 'grant', plan: 'month', count: 1, emails: many.slice(0, 20) }, GRANTER);
  check('（尺子）grant 正好 20 个地址：照发', twenty.status === 200 && twenty.payload?.sent?.length === 20,
    `${twenty.status} ${twenty.payload?.sent?.length}`);
  const twice = await call({ token: process.env.ADMIN_TOKEN, action: 'grant', plan: 'month', count: 1,
    emails: ['Grant20@Example.com', 'grant20@example.com', ' GRANT20@EXAMPLE.COM '] }, GRANTER);
  check('同一个地址大小写不同写三遍：只发一批', twice.status === 200 && twice.payload?.sent?.length === 1 && (await inboxOf('grant20@example.com')) === 1,
    `${twice.status} sent=${twice.payload?.sent?.length} 收件箱 ${await inboxOf('grant20@example.com')} 张`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
