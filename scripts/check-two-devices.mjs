/**
 * 一个账号，两台设备，都得算数。
 *
 *   npm run build
 *   ALLOW_MEMORY_STORE=1 node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-two-devices.mjs http://localhost:8815/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 从前账号上只有一把令牌，每次拿密码登录都换一把新的，旧的立刻作废。于是：
 * 手机上登录，电脑上再登录一次，手机那台下一次去看排行榜就被服务器认成陌生
 * 人（401），界面只能说「请重新登录」——玩家的原话是「登录之后一会儿关掉，
 * 再打开排行榜就要重新登录」。
 *
 * 这个文件把那件事按顺序走一遍：兑码建号（甲）→ 同一个账号再登录一次（乙）
 * → 两台一起去 /api/scores 报到。两台都得认。最后再验一次「该踢下线的时候
 * 确实踢得掉」：改一次密码，甲乙两把令牌一起作废。
 *
 * 用的是真的 HTTP 接口，不是把函数抓出来单测——中间那几层（identify、
 * tokenValid、resolveEntitlement 把哪一把令牌回给谁）正是出过错的地方。
 *
 * TESTMONTH 一台服务器只能兑一次——重跑请换端口重开服务器。
 * ─────────────────────────────────────────────────────────────────────────
 */
const BASE = (process.argv[2] || 'http://localhost:8815/').replace(/\/$/, '');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const EMAIL = 'two-devices@example.com';
const PW = '123456';

// ---- 兑一张内部码，绑上邮箱和密码：这是「甲」那台设备 --------------------
const redeemed = await post('/api/redeem', { code: 'TESTMONTH' });
check('兑码成功', redeemed.status === 200 && Boolean(redeemed.body.code),
  `${redeemed.status} ${JSON.stringify(redeemed.body.error || '')}`);

const bound = await post('/api/passcode', {
  code: redeemed.body.code,
  token: redeemed.body.token,
  email: EMAIL,
  password: PW,
});
check('绑定邮箱 + 设密码', bound.status === 200 && Boolean(bound.body.token),
  `${bound.status} ${JSON.stringify(bound.body.error || '')}`);
const deviceA = bound.body.token;

// ---- 同一个账号，在另一台设备上登录：这是「乙」 --------------------------
const signedIn = await post('/api/subscription', { email: EMAIL, password: PW });
check('乙台登录成功', signedIn.status === 200 && Boolean(signedIn.body.token),
  `${signedIn.status} ${JSON.stringify(signedIn.body.error || '')}`);
const deviceB = signedIn.body.token;
check('两台各拿各的令牌，不是同一把', Boolean(deviceA && deviceB) && deviceA !== deviceB);

// ---- 关键的一条：乙登录之后，甲那台还认不认 ------------------------------
const mine = (token) => post('/api/scores', { action: 'mine', email: EMAIL, token });

const aAfter = await mine(deviceA);
check('乙登录之后，甲那台仍然认得（这条从前是 401）',
  aAfter.status === 200, `${aAfter.status} ${JSON.stringify(aAfter.body.error || '')}`);
const bAfter = await mine(deviceB);
check('乙那台自然也认得', bAfter.status === 200,
  `${bAfter.status} ${JSON.stringify(bAfter.body.error || '')}`);

// ---- 拿旧令牌换权益：回给这台设备的还是它自己那一把，没被顶掉 ------------
const refreshed = await post('/api/subscription', { email: EMAIL, token: deviceA });
check('拿令牌问权益：答得出，而且回的是甲自己那一把',
  refreshed.status === 200 && refreshed.body.token === deviceA,
  `${refreshed.status} ${refreshed.body.token === deviceB ? '回成了乙那一把' : ''}`);

// ---- 假令牌照旧挡住 ------------------------------------------------------
const forged = await mine('0'.repeat(48));
check('编一把令牌照旧进不来', forged.status === 401, String(forged.status));

// ---- 改密码：所有设备一起下线，只有新签发的那一把还算数 ------------------
const changed = await post('/api/passcode', { email: EMAIL, password: PW, newPassword: '654321' });
check('改密码成功', changed.status === 200 && Boolean(changed.body.token),
  `${changed.status} ${JSON.stringify(changed.body.error || '')}`);
const aDead = await mine(deviceA);
const bDead = await mine(deviceB);
check('改完密码，甲乙两台一起下线', aDead.status === 401 && bDead.status === 401,
  `甲 ${aDead.status} / 乙 ${bDead.status}`);
const fresh = await mine(changed.body.token);
check('刚改完密码的那台还在线', fresh.status === 200, String(fresh.status));

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
