/**
 * 登录之后那扇《账户》窗背后的三条路：**兑码、改密码、改邮箱。**
 *
 *   node scripts/check-account-hub.mjs
 *
 * 盯的是玩家一次点名的三件事（原话）：
 *
 *   「如果玩家在过去有账户的情况下也是应该能够登录，指示没有权限而已」
 *   「内部码不能加入过去已有的账户」
 *   「需要在个人主页里加入 更换邮箱/更换密码的按钮」
 *
 * 前两条是连着的：登不上，signedInEmail() 就是空的，兑码那一趟没有身份可
 * 报，服务器只好把这个月挂在码自己名下——玩家换台设备就找不着了。所以 ②
 * 验的是「一个订阅过期、但登着的人，码要落到他账户上」。
 *
 * 换邮箱是这里面唯一动数据的：账号存在 acct:<邮箱> 底下，排行榜上的成员也是
 * 这个地址，所以换邮箱是搬家。④⑤⑥ 分别验：码寄给**新**地址（不是现在这
 * 个）、账号和战绩确实搬过去了、以及几种该拦下来的。
 *
 * 不起服务器、不连 Redis、不真发信也不真问 Creem：库用进程内的那份，两个外
 * 部 HTTP 各用一个假 fetch 顶掉——顺便把验证码从那封假邮件里读出来。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.RESEND_API_KEY = 're_stub';
process.env.MAIL_FROM = 'Slides <noreply@example.com>';
// Creem 配着、也答得出话——答的是「这个人没有订阅」。这正是「有账号、但订阅
// 过期」那一支，也就是玩家撞上的那一种。
process.env.CREEM_API_KEY = 'creem_test_stub';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

let mails = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.resend.com')) {
    const body = JSON.parse(init.body);
    mails.push({ to: body.to[0], subject: body.subject, text: body.text });
    return { ok: true, status: 200, json: async () => ({ id: 'stub' }) };
  }
  if (u.includes('creem.io')) {
    return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
  }
  throw new Error('unexpected fetch: ' + u);
};
const lastCode = () => (mails.at(-1)?.text.match(/\b(\d{6})\b/) || [])[1] ?? null;

const subscription = (await import('../api/subscription.js')).default;
const redeem = (await import('../api/redeem.js')).default;
const passcode = (await import('../api/passcode.js')).default;
const emailApi = (await import('../api/email.js')).default;
const { saveAccount, loadAccount, checkPin, newAccount } = await import('../api/_accounts.js');
const { set, get } = await import('../api/_store.js');

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

const EMAIL = 'lapsed@example.com';
const PW = 'aaa111';

// 一个订阅早就过期的老玩家：账号还在，我们自己库里没有到期日（刷卡的那一
// 支，权益在 Creem 那边，而 Creem 答的是查无此人）。
await saveAccount(EMAIL, newAccount(PW, 'card'));

// ---- ① 登得上，而且如实说没有权限 ------------------------------------------

const signedIn = await callOn(subscription, { email: EMAIL, password: PW });
check('订阅过期的人，密码对了就登得上', signedIn.status === 200, String(signedIn.status));
check('回了邮箱和令牌——前端拿这两样认「我是谁」',
  signedIn.body.email === EMAIL && typeof signedIn.body.token === 'string' && signedIn.body.token,
  JSON.stringify(signedIn.body));
check('同时如实说不是天才', signedIn.body.active !== true);

const token = signedIn.body.token;

// ---- ② 内部码落到这个账户上，不是挂在码自己名下 ----------------------------

await set('code:GATE01', { plan: 'month' });
const spent = await callOn(redeem, { code: 'GATE01', email: EMAIL, token });
check('兑码答 200', spent.status === 200, String(spent.status));
check('答复里带着这个邮箱——说明落到账户上了', spent.body.email === EMAIL, JSON.stringify(spent.body));
check('**没有** code 字段（有它才表示还挂在码自己名下）', spent.body.code === undefined);
check('这一刻成了天才', spent.body.active === true);
check('回的是这台设备自己那把令牌，没被换掉', spent.body.token === token);
const afterCode = await loadAccount(EMAIL);
check('账户上真的记了到期日', (afterCode.until || 0) > Date.now());
check('码从库里没了', (await get('code:GATE01')) === null || (await get('code:GATE01')) === undefined);

// ---- ③ 换密码：旧密码是唯一凭据，换完别的设备下线 --------------------------

const twoDevices = await loadAccount(EMAIL);
twoDevices.tokens = [...(twoDevices.tokens || []), { t: 'OTHER-DEVICE', at: Date.now() }];
await saveAccount(EMAIL, twoDevices);

const wrongOld = await callOn(passcode, { email: EMAIL, password: 'zzz999', newPassword: 'bbb222' });
check('旧密码不对就改不了', wrongOld.status === 401, String(wrongOld.status));

const tooWeak = await callOn(passcode, { email: EMAIL, password: PW, newPassword: '12' });
check('新密码不合规矩（不是正好 6 位）也改不了', tooWeak.status === 400, String(tooWeak.status));

const changed = await callOn(passcode, { email: EMAIL, password: PW, newPassword: 'bbb222' });
check('旧密码对了才换得成', changed.status === 200 && changed.body.ok === true, String(changed.status));
check('回了一把新令牌给这台设备',
  typeof changed.body.token === 'string' && changed.body.token.length > 0,
  JSON.stringify(changed.body));
const afterPw = await loadAccount(EMAIL);
check('新密码好使', (await checkPin(EMAIL, 'bbb222', afterPw)) === 'ok');
check('旧密码不好使了', (await checkPin(EMAIL, PW, await loadAccount(EMAIL))) !== 'ok');
check('别的设备被撤下线，只留刚改完这一台',
  afterPw.tokens.length === 1 && afterPw.tokens[0].t === changed.body.token,
  `${afterPw.tokens.length} 台`);
check('内部码换来的那段时间没被改密码抹掉',
  (afterPw.until || 0) > Date.now(),
  String(afterPw.until));

const live = changed.body.token;

// ---- ④ 换邮箱：码寄给**新**地址 --------------------------------------------

const NEXT = 'moved@example.com';
mails = [];
const asked = await callOn(emailApi, { email: EMAIL, token: live, newEmail: NEXT, lang: 'zhHans' });
check('要码这一步答 200', asked.status === 200, String(asked.status));
check('只发了一封', mails.length === 1, `${mails.length} 封`);
check('**寄给新地址**，不是现在这个', mails[0]?.to === NEXT, String(mails[0]?.to));
check('信里有六位码', /^\d{6}$/.test(lastCode() || ''), String(lastCode()));
check('按界面语言写，并附了一份英文',
  mails[0]?.text.includes('确认码') && mails[0]?.text.includes('confirmation code'),
  JSON.stringify(mails[0]?.subject));

// 令牌不对：一句话都不该往下走。
const noToken = await callOn(emailApi, { email: EMAIL, token: 'NOT-A-TOKEN', newEmail: NEXT });
check('拿不出令牌就换不了邮箱', noToken.status === 401, String(noToken.status));

// ---- ⑤ 码对上了，账号连同战绩一起搬 ----------------------------------------

// 先给他记一笔战绩和一个榜上的位置，好验「搬家搬全了」。
const { zscore } = await import('../api/_store.js');
await set('stats:' + EMAIL, { total: 900, runs: 3, best: { square: 900 }, seen: [] });
await set('runs:' + EMAIL, [{ score: 900 }]);

const moved = await callOn(emailApi, {
  action: 'confirm', email: EMAIL, token: live, newEmail: NEXT, code: lastCode(),
});
check('码对了就搬', moved.status === 200 && moved.body.moved === true, String(moved.status));
check('答复里是新地址', moved.body.email === NEXT, JSON.stringify(moved.body));
check('令牌一把没动——换的是门牌不是钥匙', moved.body.token === live);

const atNew = await loadAccount(NEXT);
check('新地址底下有账号了', Boolean(atNew));
check('密码还是那一把', atNew && (await checkPin(NEXT, 'bbb222', atNew)) === 'ok');
check('内部码那段时间跟着过来了', (atNew?.until || 0) > Date.now());
check('旧地址底下清干净了', !(await loadAccount(EMAIL)));

check('战绩搬过来了', Boolean(await get('stats:' + NEXT)), JSON.stringify(await get('stats:' + NEXT)));
check('存档也搬过来了', Boolean(await get('runs:' + NEXT)));
check('旧地址下的战绩清掉了', !(await get('stats:' + EMAIL)));
check('排行榜上换成了新地址', (await zscore('lb:square', NEXT)) === 900, String(await zscore('lb:square', NEXT)));
check('排行榜上旧地址撤了', (await zscore('lb:square', EMAIL)) === null,
  String(await zscore('lb:square', EMAIL)));

// 换完之后，新地址真的登得上——这一条是「搬家搬活了」的收尾。
const reSignIn = await callOn(subscription, { email: NEXT, password: 'bbb222' });
check('新邮箱登得上', reSignIn.status === 200 && reSignIn.body.email === NEXT, String(reSignIn.status));
check('而且还是天才（内部码那段时间还在）', reSignIn.body.active === true);

// ---- ⑥ 该拦下来的几种 -------------------------------------------------------

const token2 = reSignIn.body.token;
const same = await callOn(emailApi, { email: NEXT, token: token2, newEmail: NEXT });
check('填的就是现在这个地址：拦下来', same.status === 400 && same.body.error === 'sameEmail',
  JSON.stringify(same.body));

const OTHER = 'somebody-else@example.com';
await saveAccount(OTHER, newAccount('ccc333', 'card'));
const taken = await callOn(emailApi, { email: NEXT, token: token2, newEmail: OTHER });
check('那个地址上已经有账号：拦下来，别把两个人并成一个',
  taken.status === 409 && taken.body.error === 'taken', JSON.stringify(taken.body));

// 拿 A 收到的码去认领 B：服务器记着「码是对着哪个地址发的」，对不上就不算。
mails = [];
await callOn(emailApi, { email: NEXT, token: token2, newEmail: 'first@example.com' });
const swapped = await callOn(emailApi, {
  action: 'confirm', email: NEXT, token: token2, newEmail: 'second@example.com', code: lastCode(),
});
check('中途把新地址换成别的，那张码不认', swapped.status === 400, String(swapped.status));
check('而且没有搬走', Boolean(await loadAccount(NEXT)));

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
