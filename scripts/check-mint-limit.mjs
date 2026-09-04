/**
 * 发码接口（api/mint.js）的限速。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-mint-limit.mjs
 *
 * 这个接口能批量发内部码、也能列出全部玩家的邮箱，是站里权限最高的一处，只靠
 * ADMIN_TOKEN 挡着。从前它是唯一没接限速的敏感接口——redeem、unlock 都接了。
 * 要验的是三件事：
 *
 *   · 一个来源一小时敲够 20 次就 429，第 21 次连令牌都不看；
 *   · 换一个来源不受牵连（限的是来源，不是整个接口）；
 *   · 令牌对的时候照常发码——限速不该挡住真正的管理员。
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

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
