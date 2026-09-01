/**
 * 「Creem 那道门」的回归测试。
 *
 *   node scripts/check-creem-gate.mjs
 *
 * /api/subscription 是全站唯一回答「这个人是不是天才」的接口，两种账号都
 * 从这里进：刷卡的（答案在 Creem 那边）和内部码的（答案在我们自己的库里，
 * Creem 压根没听说过这个人）。
 *
 * 原先这个接口第一句就是「没配 CREEM_API_KEY 就回 200 没有订阅」。于是少了
 * 一个环境变量，内部码用户也一起被判成「你不是天才」——而且是静默的：日志
 * 干干净净，玩家看到的是自己的码失效了。换正式密钥的那几分钟正好会踩到。
 *
 * 所以这里同时起两台 dev-server，一台不给密钥、一台给个假的，验证：
 *   · 没密钥时，内部码账号照常登录（它本来就不该问 Creem）
 *   · 没密钥时，要问 Creem 的那几条路回 503「答不上来」，不是 200「没订阅」
 *   · 有密钥时，一切照旧
 */
import { spawn } from 'node:child_process';

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const post = (base, path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/** 起一台 dev-server，等它真的开始应答再返回。 */
async function serve(port, creemKey) {
  const env = { ...process.env };
  if (creemKey) env.CREEM_API_KEY = creemKey;
  else delete env.CREEM_API_KEY;
  const child = spawn(process.execPath, ['scripts/dev-server.mjs', String(port), 'dist'], {
    env,
    stdio: 'ignore',
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + '/api/subscription', { method: 'POST', body: '{}' });
      return { base, stop: () => child.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  child.kill();
  throw new Error(`dev-server ${port} 没起来`);
}

/** 花一张码、绑一个邮箱，拿到一个如假包换的内部码账号。 */
async function codeAccount(base, code, email) {
  const spent = await post(base, '/api/redeem', { code });
  if (!spent.body.code) throw new Error(`${code} 兑不出来：${JSON.stringify(spent.body)}`);
  const bound = await post(base, '/api/passcode', {
    code: spent.body.code, token: spent.body.token, email, password: '123456',
  });
  if (bound.status !== 200) throw new Error(`绑定失败 ${bound.status} ${JSON.stringify(bound.body)}`);
  return email;
}

const noKey = await serve(8831, '');
const dummy = await serve(8832, 'creem_test_dummy');

try {
  // ---- 没有 CREEM_API_KEY 的那一台 ---------------------------------------
  console.log('— 没配 Creem 密钥 —');
  const holder = await codeAccount(noKey.base, 'TESTLIFE', 'code-user@test.com');

  const inCode = await post(noKey.base, '/api/subscription', { email: holder, password: '123456' });
  check('内部码账号照常登录（这一条就是修的那个 bug）',
    inCode.status === 200 && inCode.body.active === true && inCode.body.kind === 'code',
    `${inCode.status} active=${inCode.body.active}`);

  const stranger = await post(noKey.base, '/api/subscription', { email: 'nobody@test.com', password: '123456' });
  check('要问 Creem 的那条路说「答不上来」，不是「你没订阅」',
    stranger.status === 503 && stranger.body.error === 'notConfigured',
    `${stranger.status} ${JSON.stringify(stranger.body)}`);

  const settle = await post(noKey.base, '/api/subscription', { checkoutId: 'ch_whatever' });
  check('刚付完款回来也是 503，不是静默的「没订阅」',
    settle.status === 503 && settle.body.error === 'notConfigured',
    `${settle.status} ${JSON.stringify(settle.body)}`);

  const wrong = await post(noKey.base, '/api/subscription', { email: holder, password: '999999' });
  check('密码错还是 401（凭证判断仍然排在 Creem 前面）',
    wrong.status === 401, String(wrong.status));

  // ---- 配了密钥的那一台：确认没把正常的路改坏 ------------------------------
  console.log('\n— 配了密钥 —');
  const holder2 = await codeAccount(dummy.base, 'TESTLIFE', 'code-user@test.com');
  const inCode2 = await post(dummy.base, '/api/subscription', { email: holder2, password: '123456' });
  check('内部码账号一样能登录', inCode2.status === 200 && inCode2.body.active === true,
    `${inCode2.status} active=${inCode2.body.active}`);

  const settle2 = await post(dummy.base, '/api/subscription', { checkoutId: 'ch_whatever' });
  check('结算订单这条路放行到 Creem（不再被门挡住）', settle2.status !== 503,
    `${settle2.status} ${JSON.stringify(settle2.body)}`);
} finally {
  noKey.stop();
  dummy.stop();
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
