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
 * 这个文件把那件事按顺序走一遍。两半：
 *
 *   前半（邮箱账号）—— 兑码建号拿到一把令牌，拿它去 /api/scores 报到，再拿它去问一次权
 *     益：**回来的必须还是它自己那一把**。那个「每次登录换一把」的毛病今天换了个形状还会
 *     回来——只要有谁在问权益那一路上顺手 `issueToken` 一下。
 *   后半（免邮箱凭据账号）—— 真的两台设备：注册拿一把、登录再拿一把，两台一起报到；然后
 *     试一次 reset（10-09 补充方案 7-8 起回 410），两把都照旧在线。
 *
 * ⚠️ **前半只剩一台设备了（2026-10-02）。** 邮箱账号要拿第二把令牌，如今只有一条路：收一
 * 封验证码信（api/signin.js）——而这道门不收信（拿密码登录那一支随 E37 撤了）。邮箱账号的
 * 多设备那一条因此搬到了 `check-preclaim.mjs` 的 ④（在进程内驱动，读得到码）：两次验证码登
 * 录，两把令牌都要还在。真·HTTP 的两设备由后半那个免邮箱账号担着。
 *
 * 后半那一支 2026-10 从「改密码」换成了免邮箱凭据的 reset（密码取消了，E37/E38）；10-09 补充方案
 * 7-8 又撤了 reset——如今没有哪条路能凭第一串把别的设备踢下线，后半量的就是这件事。
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

// ---- 甲那台拿着它去报到 --------------------------------------------------
const mine = (token) => post('/api/scores', { action: 'mine', email: EMAIL, token });

const aAfter = await mine(deviceA);
check('甲那台认得（绑定回来那把令牌当得了身份）',
  aAfter.status === 200, `${aAfter.status} ${JSON.stringify(aAfter.body.error || '')}`);

// ---- 拿令牌换权益：回给这台设备的还是它自己那一把，没被顶掉 ---------------
//
// 这一条是前半的要害。每次开网页都会走这一路（engine/subscription.ts 的
// refreshEntitlement），所以这儿只要有谁顺手 `issueToken` 一下，玩家的另一台设备就会在
// 下一次打开时被告知「请重新登录」——那正是玩家报过的原话。
const refreshed = await post('/api/subscription', { email: EMAIL, token: deviceA });
check('拿令牌问权益：答得出，而且回的是甲自己那一把',
  refreshed.status === 200 && refreshed.body.token === deviceA,
  `${refreshed.status} ${refreshed.body.token}`);
// 问两次也不许变：换发那种写法第一次看不出来，第二次才露馅。
const again = await post('/api/subscription', { email: EMAIL, token: deviceA });
check('再问一次还是同一把（换发那种写法第二次才露馅）',
  again.status === 200 && again.body.token === deviceA, String(again.body.token));
check('问完权益之后，甲那台照旧报得到（库里那一串没被动过）',
  (await mine(deviceA)).status === 200);

// ---- 假令牌照旧挡住 ------------------------------------------------------
const forged = await mine('0'.repeat(48));
check('编一把令牌照旧进不来', forged.status === 401, String(forged.status));

// ---- 拿密码登录那一支撤了（E37）：真密码也进不去 --------------------------
const withPw = await post('/api/subscription', { email: EMAIL, password: PW });
check('真密码也答 401（那一支不许悄悄回来）', withPw.status === 401,
  `${withPw.status} ${JSON.stringify(withPw.body)}`);

// ---- 免邮箱凭据：两台都在线，而且谁都没法凭第一串把它们踢下线 ----------------
/*
 * 原先这一节用的是「改密码」，2026-10 换成免邮箱凭据的 reset（凭第一串重设第二串，踢光所有令
 * 牌——真被别人走了一趟，原主人掉线是他唯一能察觉的信号）。10-09 补充方案 7-8 把 reset 整个撤了：
 * 第一串可以被挨个试出来，凭它重设等于凭它接管。所以现在量的是反面：reset 回 410，两台都照旧在线。
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
check('reset 回 410（凭第一串重设那一支撤了）', reset.status === 410 && reset.body.error === 'gone',
  `${reset.status} ${JSON.stringify(reset.body)}`);
const stillA = await mineAs(hdlId, hdlA);
const stillB = await mineAs(hdlId, hdlB);
check('两台都照旧在线（没人能凭第一串把它们踢下线）', stillA.status === 200 && stillB.status === 200,
  `甲 ${stillA.status} / 乙 ${stillB.status}`);

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
