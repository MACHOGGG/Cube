/**
 * 同一个账号几乎同时兑两张码，两张的时长都要真的加上去。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-redeem-race.mjs
 *
 * 守的是这一幕：网站给年付用户发两张一个月的礼品码，玩家手快连点两下（或者
 * 开了两个标签页，或者网络凑巧），两条请求都读到「账号现在到期日是几号」，
 * 各自在这个基础上加一个月，后写的那一份把前一次整个盖掉。结果是**两张码都
 * 真的被吃掉了**（取码那一步 takeOnce 是 GETDEL，本来就是原子的），两次都告
 * 诉玩家「兑换成功」，而账号上实际只多了一个月。玩家发现不了（两次都说成
 * 功），客服也查不出来（码已经从库里拿走了，查无此码）。
 *
 * 这个仓库别处早就处理过同一类问题——开账号用 SET NX、认领码用 GETDEL、猜密
 * 码计数用 INCR——唯独「给已经存在的账号加时长」还是朴素的读—改—写。现在它走
 * _accounts.js 的 updateAccount（带 TTL 的短命锁），这一台量的就是那把锁。
 *
 * 不起服务器、不开浏览器：库用进程内那一份，直接叫 api/redeem.js 的 handler，
 * 两条用 Promise.all 一起发——一条一条发的版本永远是绿的，量不到任何东西。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const redeem = (await import('../api/redeem.js')).default;
const { newAccount, saveAccount, loadAccount } = await import('../api/_accounts.js');
const { set } = await import('../api/_store.js');

const call = async (body) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  // callerId 按来源限速（一小时二十次）。每一次换一个来源，免得这一台自己把
  // 自己限住——要量的是并发覆盖，不是限速。
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
    body,
  };
  await redeem(req, res);
  return { status, body: JSON.parse(text || '{}') };
};

const DAY = 24 * 3600 * 1000;
const email = 'racecode@example.com';

/** 开一个登录着的账号，外加 n 张一个月的码。 */
async function setup(n) {
  const account = newAccount('seed00', 'code');
  account.until = Date.now() + 30 * DAY;
  await saveAccount(email, account);
  const codes = [];
  for (let i = 0; i < n; i++) {
    const ticket = `RACE${i}${Date.now().toString(36).slice(-4)}`.toUpperCase();
    await set('code:' + ticket, { plan: 'month', mintedAt: Date.now() });
    codes.push(ticket);
  }
  return { account, codes, before: account.until };
}

// ---------------------------------------------------------------------------
// 1. 两张码同时兑：两个月都要在
// ---------------------------------------------------------------------------
{
  const { account, codes, before } = await setup(2);
  const out = await Promise.all(
    codes.map((code) => call({ code, email, token: account.token })),
  );
  check('两条都回了成功', out.every((r) => r.status === 200), JSON.stringify(out.map((r) => r.status)));

  const after = await loadAccount(email);
  const days = Math.round((after.until - before) / DAY);
  // extend('month') 加的是一个月。两张码就该是两个月——29~32 天是一个月的正常
  // 跨度（月份长短不同），所以两个月落在 58~63 天里。
  check('两张码的时长都加上去了（大约两个月）', days >= 58 && days <= 63, `多了 ${days} 天`);
  // 这一条单独写出来，是因为它正是那个 bug 的样子：只多了一个月。
  check('不是只加了一张（那就是被盖掉了）', days > 40, `多了 ${days} 天`);
}

// ---------------------------------------------------------------------------
// 2. 四张一起兑也不丢
// ---------------------------------------------------------------------------
{
  const { account, codes, before } = await setup(4);
  await Promise.all(codes.map((code) => call({ code, email, token: account.token })));
  const after = await loadAccount(email);
  const days = Math.round((after.until - before) / DAY);
  check('四张码一起兑，四个月都在', days >= 118 && days <= 125, `多了 ${days} 天`);
}

// ---------------------------------------------------------------------------
// 3. 一张一张兑，结果一样（锁不该把正常的一次兑换弄坏）
// ---------------------------------------------------------------------------
{
  const { account, codes, before } = await setup(2);
  for (const code of codes) await call({ code, email, token: account.token });
  const after = await loadAccount(email);
  const days = Math.round((after.until - before) / DAY);
  check('依次兑两张，还是两个月', days >= 58 && days <= 63, `多了 ${days} 天`);
}

// ---------------------------------------------------------------------------
// 4. 码只能用一次（GETDEL 那一层没被锁改坏）
// ---------------------------------------------------------------------------
{
  const { account, codes } = await setup(1);
  const first = await call({ code: codes[0], email, token: account.token });
  const again = await call({ code: codes[0], email, token: account.token });
  check('第一次兑得上', first.status === 200, String(first.status));
  check('同一张码兑第二次：查无此码', again.status === 404, String(again.status));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
