/**
 * 认证那几扇门，从外面看过去长什么样。
 *
 *   node scripts/check-auth-probe.mjs
 *
 * 两件事，都属于「玩家一点感觉都没有，可是坏人看得很清楚」的那一类：
 *
 * ① **不能拿登录接口当查号机。** 项目里写死过一条规矩——「不管有没有账号，
 *    答案必须一样，不能被拿来查人」（passcode.js 的 change、portal.js 都照
 *    做了），唯独登录那一支（subscription.js 的 fromEmail）漏了：有账号的
 *    地址密码不对答 401，没账号的地址干脆把整段跳过去、答 200「你还没订
 *    阅」。两句不一样的话摆在一起，拿一份邮箱名单挨个打过来，哪些是本站用
 *    户一目了然。
 *
 *    唯一允许不一样的是**订阅还活着、却从没设过密码**那一种（付完款那一下
 *    标签页就关了）：那一句 needsPasscode 是故意要说的，不说这个人就被永久
 *    挡在他已经付过钱的东西外面。④ 守着这一条别被「堵漏」顺手堵死。
 *
 * ② **改密码和账号中心要按来路限速。** 账号那头的计数（_accounts.js 的
 *    checkPin）是按账号数的：错 4 次锁 4 小时。那道闸挡的是「有人在猜我的
 *    密码」，可它同时也是一把递到陌生人手里的锁——知道你邮箱的人发四次乱
 *    填的请求就能把你关在门外四个小时。登录那一支早就按来路数了
 *    （subscription.js 的 subpw），这两处一直没有。
 *
 *    注意这道限速**不能**把 ② 那种骚扰彻底消掉（四次还是发得出来，而二十
 *    次的上限拦不住四次）。它挡的是「一台机器拿一份名单把所有人挨个锁一
 *    遍」。真正给被锁的人留的出路是《忘记密码》——那条路在界面上是通的。
 *
 * 不起服务器、不连 Redis、不真问 Creem：库用进程内的那份，Creem 用一个假
 * fetch 顶掉（只认一个「订着但没设过密码」的地址）。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.CREEM_API_KEY = 'creem_test_stub';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 只有这一个地址在 Creem 那头有一份活着的订阅（而我们库里没有它的账号）。 */
const PAID_NO_PASS = 'paid-nopass@example.com';

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname === '/v1/customers') {
    if (u.searchParams.get('email') === PAID_NO_PASS) {
      return { ok: true, status: 200, json: async () => ({ id: 'cus_1', email: PAID_NO_PASS }) };
    }
    return { ok: false, status: 404, text: async () => 'not found' };
  }
  if (u.pathname.startsWith('/v1/customers/cus_1/subscriptions')) {
    return {
      ok: true, status: 200,
      json: async () => ({ items: [{ id: 'sub_1', status: 'active', customer: { email: PAID_NO_PASS } }] }),
    };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};

const subscription = (await import('../api/subscription.js')).default;
const passcode = (await import('../api/passcode.js')).default;
const portal = (await import('../api/portal.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');

/** 叫一次接口。ip 是这一次的来源（限速按它分桶）。 */
const callOn = async (handler, body, ip = '203.0.113.1') => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await handler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body }, res);
  return { status, raw: text || '{}', body: JSON.parse(text || '{}') };
};

// ── ① 登录：有账号和没账号，答的必须是同一句 ─────────────────────────────

const HAS = 'has-account@example.com';
const NONE = 'no-such-account@example.com';
const PW = 'aaa111';
await saveAccount(HAS, newAccount(PW, 'card'));

const mineWrong = await callOn(subscription, { email: HAS, password: 'zzz999' }, '198.51.100.1');
const theirs = await callOn(subscription, { email: NONE, password: 'zzz999' }, '198.51.100.2');
check('有账号、密码不对：401', mineWrong.status === 401, String(mineWrong.status));
check('没有账号、同一个密码：也是 401（原先是 200「你还没订阅」）',
  theirs.status === 401, String(theirs.status));
check('两条路的回包一个字都不差', mineWrong.raw === theirs.raw,
  `${mineWrong.raw} / ${theirs.raw}`);

// 格式本身就不合规矩的密码：两条路也要一样（有账号那一路在格式这一关就退
// 回了，没账号那一路以前连这一关都不走）。
const mineShort = await callOn(subscription, { email: HAS, password: 'ab' }, '198.51.100.3');
const theirShort = await callOn(subscription, { email: NONE, password: 'ab' }, '198.51.100.4');
check('密码格式不合规矩时，两条路也是同一句',
  mineShort.status === theirShort.status && mineShort.raw === theirShort.raw,
  `${mineShort.status}:${mineShort.raw} / ${theirShort.status}:${theirShort.raw}`);

// 拿令牌来的那条路同理。
const mineTok = await callOn(subscription, { email: HAS, token: 'NOT-A-TOKEN' }, '198.51.100.5');
const theirTok = await callOn(subscription, { email: NONE, token: 'NOT-A-TOKEN' }, '198.51.100.6');
check('乱给令牌时，两条路也是同一句',
  mineTok.status === theirTok.status && mineTok.raw === theirTok.raw,
  `${mineTok.status}:${mineTok.raw} / ${theirTok.status}:${theirTok.raw}`);

// 没误伤：真密码照样登得上。
const good = await callOn(subscription, { email: HAS, password: PW }, '198.51.100.7');
check('真密码照样登得上，还是拿得到令牌',
  good.status === 200 && good.body.email === HAS && typeof good.body.token === 'string',
  `${good.status} ${JSON.stringify(good.body.email)}`);

// ── ④ 「订着、却还没设过密码」那一句不能被顺手堵死 ───────────────────────

const paid = await callOn(subscription, { email: PAID_NO_PASS, password: 'aaa111' }, '198.51.100.8');
check('订阅活着但没设过密码：仍然答 needsPasscode，送他去设一个',
  paid.status === 200 && paid.body.needsPasscode === true, `${paid.status} ${paid.raw}`);

// ── ② 改密码：按来路限速 ────────────────────────────────────────────────
//
// 挨个换邮箱打，所以账号那头的锁定计数一次都数不上——原先这一处就完全没有
// 第二道闸，一台机器可以一直打下去。

const MANY = '203.0.113.77';
const pwTries = [];
for (let i = 0; i < 20; i++) {
  pwTries.push((await callOn(passcode,
    { email: `victim${i}@example.com`, password: 'zzz999', newPassword: 'bbb222' }, MANY)).status);
}
check('改密码：前 20 次照常答「密码不对」', pwTries.every((c) => c === 401),
  [...new Set(pwTries)].join(','));
const pwStopped = await callOn(passcode,
  { email: 'victim99@example.com', password: 'zzz999', newPassword: 'bbb222' }, MANY);
check('改密码：第 21 次被来源限速挡下',
  pwStopped.status === 429 && pwStopped.body.error === 'tooMany',
  `${pwStopped.status} ${pwStopped.raw}`);
const pwOther = await callOn(passcode,
  { email: 'victim99@example.com', password: 'zzz999', newPassword: 'bbb222' }, '203.0.113.78');
check('改密码：换一个来源不受牵连', pwOther.status === 401, String(pwOther.status));

// ── ③ 账号中心（Creem 客户门户）：同一把尺子 ────────────────────────────

const PORTAL = '203.0.113.88';
const poTries = [];
for (let i = 0; i < 20; i++) {
  poTries.push((await callOn(portal, { email: `target${i}@example.com`, password: 'zzz999' }, PORTAL)).status);
}
check('账号中心：前 20 次照常答「密码不对」', poTries.every((c) => c === 401),
  [...new Set(poTries)].join(','));
const poStopped = await callOn(portal, { email: 'target99@example.com', password: 'zzz999' }, PORTAL);
check('账号中心：第 21 次被来源限速挡下',
  poStopped.status === 429 && poStopped.body.error === 'tooMany',
  `${poStopped.status} ${poStopped.raw}`);
const poOther = await callOn(portal, { email: 'target99@example.com', password: 'zzz999' }, '203.0.113.89');
check('账号中心：换一个来源不受牵连', poOther.status === 401, String(poOther.status));

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
