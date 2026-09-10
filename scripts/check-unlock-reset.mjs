/**
 * 认证那两条路：**验过了就要说验过了**，别拿下一问的结果去汇报上一步。
 *
 *   node scripts/check-unlock-reset.mjs
 *
 * 盯的是一个真出过的 bug。api/unlock.js 的 confirm 是这个顺序：
 *
 *     换密码 → 作废所有设备的令牌 → 删掉验证码      ← 三件事都回不去了
 *            → 再问一句「这个人是不是天才」          ← 这一问可以答「不是」
 *
 * 最后那一问有两种答案既不是成功也不是故障：这个账号此刻**没有在续的订阅**
 * （如实答 active: false），以及**压根问不出来**（Creem 没配密钥 / 挂了）。
 * 原先这两种都把整趟说成失败——前者被前端读成 'network'（屏幕上写「连不上
 * 网络」），后者直接 502。而玩家看到失败一定会再点一次，这一次验证码已经删
 * 了，他收到的是「验证码已过期」。他于是拿着一把自己不知道已经生效的新密
 * 码，被告知什么都没发生。
 *
 * 线上真的这么发生过一次，日志长这样：
 *
 *     01:58:25  POST /api/unlock  200   ← 密码在这一刻就已经换好了
 *     01:58:27  POST /api/unlock  400   ← 玩家再点一次：「验证码已过期」
 *
 * 和 redeem.js 那次「码烧掉却没到账」（scripts 里那条 giveBack）是同一种病。
 *
 * 登录那一支（api/subscription.js）也犯了同一个错，而且更狠：密码验过了、令
 * 牌也签发了，可因为这个账号此刻没有在续的订阅，答的是 NOBODY——身上既没有
 * token 也没有 email。前端于是报「这个邮箱名下没有有效的订阅」，把人挡在他
 * 自己的账号外面。那个账号里有他的云端战绩、有寄给他的内部码；进不去还会连
 * 环，因为兑码要令牌。⑥ 盯的就是这一条。
 *
 * 不起服务器、不连 Redis、不真发信也不真问 Creem：库用进程内的那份，两个外
 * 部 HTTP 各用一个假 fetch 顶掉——顺便把验证码从那封假邮件里读出来。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.RESEND_API_KEY = 're_stub';
process.env.MAIL_FROM = 'Slides <noreply@example.com>';
// 线上出事的那一趟，Creem 是配着的、也答得出话——答的是「这个人没有订阅」。
// 不设这一把，下面①跑的就是「问不出来」那条分支，和⑤重复，而真正咬人的那条
// 一次都没走到。
process.env.CREEM_API_KEY = 'creem_test_stub';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---- 假的外部世界 -----------------------------------------------------------
//
// Resend：把验证码从信里抠出来，不真发。
// Creem：一律答 404「查无此人」——这正是「有账号、但没有在续的订阅」那一支。
let sentCode = null;
let mails = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.resend.com')) {
    mails++;
    sentCode = (JSON.parse(init.body).text.match(/\b(\d{6})\b/) || [])[1] ?? null;
    return { ok: true, status: 200, json: async () => ({ id: 'stub' }) };
  }
  if (u.includes('creem.io')) {
    return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
  }
  throw new Error('unexpected fetch: ' + u);
};

const unlock = (await import('../api/unlock.js')).default;
const subscription = (await import('../api/subscription.js')).default;
const { saveAccount, loadAccount, checkPin, newAccount } = await import('../api/_accounts.js');

/** api/ 里的 handler 是照着 Vercel 的 res 写的，这儿搭一个够用的。 */
const callOn = async (handler, body) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await handler({ method: 'POST', headers: {}, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};
const call = (body) => callOn(unlock, body);

const EMAIL = 'card-subscriber@example.com';
const OLD_PW = 'aaa111';
const NEW_PW = 'bbb222';

// 一个刷卡订阅户：我们自己的库里只有账号和令牌，权益在 Creem 那边，所以
// until 是 0。他在三台设备上登着。
const account = newAccount(OLD_PW, 'card');
account.tokens = [
  { t: 'DEVICE-A', at: Date.now() },
  { t: 'DEVICE-B', at: Date.now() },
  { t: 'DEVICE-C', at: Date.now() },
];
account.token = 'DEVICE-C';
await saveAccount(EMAIL, account);

// ---- ① 要一张码 ------------------------------------------------------------

const asked = await call({ email: EMAIL });
check('要码这一步答 200', asked.status === 200, String(asked.status));
check('真的发了一封信', mails === 1, `${mails} 封`);
check('信里有一个六位数的码', /^\d{6}$/.test(sentCode || ''), String(sentCode));

// ---- ② 拿码去换密码：Creem 说「这个人没有订阅」 -----------------------------

const done = await call({ action: 'confirm', email: EMAIL, code: sentCode, password: NEW_PW });

check('换密码这一趟答的是 200，不是 502', done.status === 200, String(done.status));
check('明说 reset: true——密码换好了', done.body.reset === true, JSON.stringify(done.body));
check('同时如实说「不是天才」（Creem 答得出，答的是查无此人）', done.body.active !== true);
check('回了一把令牌给这台设备', typeof done.body.token === 'string' && done.body.token.length > 0);

// 这一条是整个门的要害：把 reset 拿掉，前端就只剩 active 可看，而 active 是
// false——于是「密码已经换好」会被读成失败，玩家再点一次就撞上「已过期」。
check('没有 reset 这个字段的话，前端只能看见 active: false（所以它非有不可）',
  done.body.reset === true && done.body.active !== true);

// ---- ③ 密码是真的换了 ------------------------------------------------------

const after = await loadAccount(EMAIL);
check('新密码好使', (await checkPin(EMAIL, NEW_PW, after)) === 'ok');
const again = await loadAccount(EMAIL);
check('旧密码不好使了', (await checkPin(EMAIL, OLD_PW, again)) !== 'ok');
check('别的设备被踢下线，只留刚验过邮箱的这一台',
  after.tokens.length === 1 && after.tokens[0].t === done.body.token,
  `${after.tokens.length} 台`);

// ---- ④ 码用掉了就是用掉了 --------------------------------------------------

const twice = await call({ action: 'confirm', email: EMAIL, code: sentCode, password: 'ccc333' });
check('同一张码再用一次：被拒', twice.status !== 200, String(twice.status));
const stillNew = await loadAccount(EMAIL);
check('而且第二次没有把密码改成别的', (await checkPin(EMAIL, NEW_PW, stillNew)) === 'ok');

// ---- ⑤ 另一条分支：Creem 压根问不出来（没配密钥），同样不能说成失败 --------

delete process.env.CREEM_API_KEY;
const EMAIL2 = 'no-creem@example.com';
await saveAccount(EMAIL2, newAccount(OLD_PW, 'card'));
mails = 0;
sentCode = null;
await call({ email: EMAIL2 });
const noCreem = await call({ action: 'confirm', email: EMAIL2, code: sentCode, password: NEW_PW });
check('问不出权益（没配 Creem）也答 200', noCreem.status === 200, String(noCreem.status));
check('reset 照样是 true', noCreem.body.reset === true, JSON.stringify(noCreem.body));
const after2 = await loadAccount(EMAIL2);
check('密码确实换了', (await checkPin(EMAIL2, NEW_PW, after2)) === 'ok');

// ---- ⑥ 登录：密码对了就是登上了，哪怕这个账号没有在续的订阅 ----------------

process.env.CREEM_API_KEY = 'creem_test_stub';
const EMAIL3 = 'lapsed@example.com';
await saveAccount(EMAIL3, newAccount(OLD_PW, 'card'));

const signedIn = await callOn(subscription, { email: EMAIL3, password: OLD_PW });
check('订阅过期的人，密码对了就该登得上', signedIn.status === 200, String(signedIn.status));
check('回了令牌——没有它前端就当没登上',
  typeof signedIn.body.token === 'string' && signedIn.body.token.length > 0,
  JSON.stringify(signedIn.body));
check('也回了邮箱（前端拿它认「我是谁」）', signedIn.body.email === EMAIL3);
check('同时如实说不是天才', signedIn.body.active !== true);

const wrongPw = await callOn(subscription, { email: EMAIL3, password: 'zzz999' });
check('密码不对照旧进不来', wrongPw.status === 401, String(wrongPw.status));

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
