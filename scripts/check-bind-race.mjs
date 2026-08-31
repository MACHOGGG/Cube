/**
 * 兑换码绑定的竞态测试。
 *
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-bind-race.mjs http://localhost:8815
 *
 * 花码本身是原子的（GETDEL），两个人抢同一个码不会都抢到。但绑定——把这个
 * 码换来的权益挂到一个邮箱账号上——中间有四步：读凭证、查邮箱有没有被占、
 * 写新账号、删凭证。这四步之间任何一处让出去，另一个请求都能从头再走一遍，
 * 于是一张码变成两个账号。
 *
 * 这里就是同时发两个 bind（同一个 code/token，两个不同邮箱），看服务器
 * 是不是只认一个。
 */

const base = (process.argv[2] || 'http://localhost:8815').replace(/\/$/, '');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// ---- 先花一张码，拿到「持有凭证」 --------------------------------------
// TESTYEAR，不是 TESTMONTH：check-multiplayer 花的是那一张，两个脚本
// 用同一张码的话，先跑的那个会把后跑的那个饿死。
const spent = await post('/api/redeem', { code: 'TESTYEAR' });
if (!spent.body.active || !spent.body.code) {
  console.error('拿不到未绑定的兑换码权益，服务器说：', spent.status, JSON.stringify(spent.body));
  console.error('（TESTYEAR 是一次性的，重启 dev-server 会重新种一张。）');
  process.exit(2);
}
const { code, token } = spent.body;
console.log(`拿到持有凭证：码 ${code}\n`);

// ---- 两个邮箱同时来绑 ---------------------------------------------------
const [a, b] = await Promise.all([
  post('/api/passcode', { action: 'bind', code, token, email: 'race-a@test.com', password: '123456' }),
  post('/api/passcode', { action: 'bind', code, token, email: 'race-b@test.com', password: '123456' }),
]);

const won = [a, b].filter((r) => r.status === 200);
console.log(`甲 ${a.status} ${JSON.stringify(a.body.error ?? 'ok')}`);
console.log(`乙 ${b.status} ${JSON.stringify(b.body.error ?? 'ok')}\n`);

check('同一张码只能绑成一个账号', won.length === 1, `实际成功 ${won.length} 个`);

// ---- 输的那一个不该白白丢掉权益 ----------------------------------------
// 抢输了不代表这张码作废：另一个邮箱已经拿到了它，所以凭证消失是对的；
// 但如果两个都失败，那就是把玩家的东西弄丢了。
check('不会两个都失败（码没有凭空蒸发）', won.length >= 1);

// ---- 赢的那个账号真的能登录 --------------------------------------------
if (won.length === 1) {
  const winner = won[0].body.email;
  const back = await post('/api/subscription', { email: winner, password: '123456' });
  check('赢的那个账号能用邮箱+密码登录', back.status === 200 && back.body.active === true,
    `${winner} → ${back.status}`);
}

// ---- 抢不到的时候，码不能被弄丢 ----------------------------------------
// 认领是 GETDEL，一步就把持有凭证拿走了。所以每一条不成功的出口都必须把它
// 放回去，否则一次「这个邮箱已经有账号了」就等于没收了玩家的码。
{
  const fresh = await post('/api/redeem', { code: 'TESTLIFE' });
  if (!fresh.body.code) {
    console.log('\n（TESTLIFE 已被用掉，跳过「令牌猜错」这一项）');
  } else {
    const { code: c2, token: t2 } = fresh.body;

    // 令牌不对：不该碰这张码。
    const badToken = await post('/api/passcode', {
      action: 'bind', code: c2, token: 'not-the-right-token', email: 'x@test.com', password: '123456',
    });
    const afterBad = await post('/api/passcode', {
      action: 'bind', code: c2, token: t2, email: 'still-works@test.com', password: '123456',
    });
    check('令牌猜错之后，这张码还能正常绑定',
      badToken.status === 401 && afterBad.status === 200,
      `猜错 ${badToken.status} · 之后 ${afterBad.status}`);
  }
}

{
  const fresh = await post('/api/redeem', { code: 'TESTHALF' });
  if (!fresh.body.code) {
    console.log('（没有 TESTHALF，跳过「邮箱被占用」那一项）');
  } else {
    const { code: c3, token: t3 } = fresh.body;
    // 绑到一个已经有账号的邮箱上：应该被拒，而且码要还回来。
    const taken = await post('/api/passcode', {
      action: 'bind', code: c3, token: t3, email: 'race-a@test.com', password: '123456',
    });
    const retry = await post('/api/passcode', {
      action: 'bind', code: c3, token: t3, email: 'another@test.com', password: '123456',
    });
    check('邮箱被占用被拒之后，这张码还能换个邮箱绑',
      taken.status === 409 && retry.status === 200,
      `被拒 ${taken.status} · 改绑 ${retry.status}`);
  }
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
