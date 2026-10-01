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
 * 确实踢得掉」——那一支 2026-10 从「改密码」换成了免邮箱凭据的 reset（密码取消了，
 * E37/E38）：两串凭据注册、两台登着、reset 一次，两把令牌一起作废。
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

// ---- 该踢下线的时候踢得掉：免邮箱凭据的 reset ----------------------------
/*
 * 原先这一节用的是「改密码」。那一支 2026-10 撤了（E37，密码取消），而「把所有设备一起
 * 踢下线」这件事本身还在，只是搬到了另一条路上：免邮箱凭据账号（E38）忘了第二串，凭第
 * 一串 reset。
 *
 * 那条路**必须**踢光所有令牌，而且理由比改密码更硬：谁知道第一串就走得通这条路，所以真
 * 被别人走了一趟，原主人下一次打开发现自己掉线——那是他唯一能察觉的信号。换成「添一把令
 * 牌」的话，别人接管了账号而本人一无所知。
 *
 * 走真的 HTTP，和这个文件别处一样：中间那几层（identify 认 hdl: 那种 id、tokenValid 走
 * 整串令牌）正是出过错的地方。
 */
const FIRST = 'TwoDevice1';
const made = await post('/api/handle', { action: 'register', first: FIRST, second: 'firstpass' });
check('免邮箱账号注册成功', made.status === 200 && Boolean(made.body.token),
  `${made.status} ${JSON.stringify(made.body.error || '')}`);
const hdlA = made.body.token;
const hdlId = made.body.id;
const second = await post('/api/handle', { first: FIRST, second: 'firstpass' });
check('第二台也登得进来，拿到另一把令牌',
  second.status === 200 && second.body.token && second.body.token !== hdlA, String(second.status));
const hdlB = second.body.token;

/** 拿这把令牌去 /api/scores 报到——认不认由服务器说。 */
const mineAs = (id, token) =>
  post('/api/scores', { action: 'mine', email: id, token });
check('（尺子）reset 之前两台都认得',
  (await mineAs(hdlId, hdlA)).status === 200 && (await mineAs(hdlId, hdlB)).status === 200);

const reset = await post('/api/handle', { action: 'reset', first: FIRST, newSecond: 'secondpas' });
check('reset 成功，回一把新令牌', reset.status === 200 && Boolean(reset.body.token),
  `${reset.status} ${JSON.stringify(reset.body.error || '')}`);
const deadA = await mineAs(hdlId, hdlA);
const deadB = await mineAs(hdlId, hdlB);
check('reset 之后两台一起下线', deadA.status === 401 && deadB.status === 401,
  `甲 ${deadA.status} / 乙 ${deadB.status}`);
const live = await mineAs(hdlId, reset.body.token);
check('刚 reset 那台还在线', live.status === 200, String(live.status));

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
