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
 *   · 没密钥时，要问 Creem 的那条路回 503「答不上来」，不是 200「没订阅」
 *   · 库里没有的地址，和「令牌不对」答同一句（别把这个接口变成查号机）
 *   · 有密钥时，一切照旧
 *
 * ⚠️ 凭据是**登录令牌**，不是密码（2026-10-02）。拿密码登录那一支随 E37 撤了。
 *
 * 那把令牌原先由 `/api/passcode` 的 bind（内部码绑邮箱）一起带回来；10-11 方案 A-2 起 bind
 * 回 410（它不验那个邮箱是谁的）。现在的夹具是今天真实的那条路：先注册一个免邮箱账号
 * （`/api/handle`，回一把令牌），再带着它的 id / 令牌去 `/api/redeem` 把码兑进**这个账号**。
 * 兑完之后权益记在我们自己的库里，`/api/subscription` 答的 `kind` 照旧是 'code'——这道门要
 * 的正是这样一个「答案在本地、Creem 从没听说过」的账号。
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

/**
 * 开一个免邮箱账号、把一张码兑进去，拿到一个如假包换的内部码账号（见文件头 ⚠️）。
 * `first` 是第一串（账号 id 由服务器算成 `hdl:` 开头的那一位，回包里的 `id`）。
 */
async function codeAccount(base, code, first) {
  const made = await post(base, '/api/handle', { action: 'register', first, second: 'GateSecond9' });
  if (made.status !== 200 || !made.body.id || !made.body.token) {
    throw new Error(`免邮箱账号开不出来：${made.status} ${JSON.stringify(made.body)}`);
  }
  const spent = await post(base, '/api/redeem', { code, email: made.body.id, token: made.body.token });
  if (spent.status !== 200 || spent.body.active !== true) {
    throw new Error(`${code} 兑不进这个账号：${spent.status} ${JSON.stringify(spent.body)}`);
  }
  return { email: made.body.id, token: made.body.token };
}

const noKey = await serve(8831, '');
const dummy = await serve(8832, 'creem_test_dummy');

try {
  // ---- 没有 CREEM_API_KEY 的那一台 ---------------------------------------
  console.log('— 没配 Creem 密钥 —');
  const holder = await codeAccount(noKey.base, 'TESTLIFE', 'GateCodeUser1');

  const inCode = await post(noKey.base, '/api/subscription', { email: holder.email, token: holder.token });
  check('内部码账号照常登录（这一条就是修的那个 bug）',
    inCode.status === 200 && inCode.body.active === true && inCode.body.kind === 'code',
    `${inCode.status} active=${inCode.body.active}`);

  // 一个库里根本没有账号的地址。
  //
  // 这一条原先验的是 503「答不上来」。后来堵账号枚举那一处改了它（见
  // api/subscription.js 的 fromEmail、scripts/check-auth-probe.mjs）：没有账
  // 号的地址一律和「令牌不对」答同一句，否则拿一份邮箱名单挨个打过来就能筛
  // 出谁是本站用户。
  //
  // 这条门要守的东西一个字没变——**绝不能静默地答 200「你没订阅」**。401 离
  // 那句话比 503 还远：它说的是「这把钥匙不对」，不是「你的码失效了」。真正
  // 「要问 Creem 却问不了」的那条路是**有账号、令牌也对**的刷卡用户，那一路
  // 仍然是 503（resolveEntitlement 里 kind !== 'code' 那一支），另外它下面
  // 「刚付完款回来」那条也还钉着同一件事。
  const stranger = await post(noKey.base, '/api/subscription', { email: 'nobody@test.com', token: 'NOT-A-TOKEN' });
  check('库里没有的地址：和「令牌不对」同一句，既不是 200「你没订阅」，也不说有没有账号',
    stranger.status === 401 && stranger.body.error === 'wrong',
    `${stranger.status} ${JSON.stringify(stranger.body)}`);

  const settle = await post(noKey.base, '/api/subscription', { checkoutId: 'ch_whatever' });
  check('刚付完款回来也是 503，不是静默的「没订阅」',
    settle.status === 503 && settle.body.error === 'notConfigured',
    `${settle.status} ${JSON.stringify(settle.body)}`);

  const wrong = await post(noKey.base, '/api/subscription', { email: holder.email, token: 'NOT-A-TOKEN' });
  check('令牌不对还是 401（凭证判断仍然排在 Creem 前面）',
    wrong.status === 401, String(wrong.status));
  // 密码那一支撤了：真密码也进不去。这个账号的「密码」就是它的第二串（夹具里那一把）。
  const withPw = await post(noKey.base, '/api/subscription', { email: holder.email, password: 'GateSecond9' });
  check('拿密码登录那一支撤了——真密码也 401', withPw.status === 401,
    `${withPw.status} ${JSON.stringify(withPw.body)}`);

  // ---- 配了密钥的那一台：确认没把正常的路改坏 ------------------------------
  console.log('\n— 配了密钥 —');
  const holder2 = await codeAccount(dummy.base, 'TESTLIFE', 'GateCodeUser2');
  const inCode2 = await post(dummy.base, '/api/subscription', { email: holder2.email, token: holder2.token });
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
