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
 *    从前这里有一个**允许不一样**的口子：订阅还活着、却从没设过密码那一种
 *    （付完款那一下标签页就关了）答 needsPasscode，送他去设一个。它 2026-10-02
 *    随密码一起没了，而且**不留任何人在门外**——那种人现在拿验证码登录，账号
 *    当场开出来（api/signin.js 的 confirm），Creem 照旧被问一次，于是他立刻就
 *    是天才。④ 因此反过来量：那个地址答的必须和「压根没有账号」一字不差。
 *    这比从前更严——needsPasscode 本身就是在说「这个地址是订户」。
 *
 * ② **改密码和账号中心要按来路限速。** 账号那头的计数（_accounts.js 的
 *    checkPin）是按账号数的：错 4 次锁 4 小时。那道闸挡的是「有人在猜我的
 *    密码」，可它同时也是一把递到陌生人手里的锁——知道你邮箱的人发四次乱
 *    填的请求就能把你关在门外四个小时。所以凡是「拿一样可猜的东西来验」的入口都要再
 *    按来路数一道：`api/handle.js` 顶上那个 `pairin`（30 次/小时）就是为此（2026-10-02
 *    补的）。从前登录那一支也有一个（`subpw`），它随密码那一支一起撤了——那一路现在
 *    只认 24 字节随机令牌，没有「撞」这回事可挡。
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
const LIVE_TOKEN = 'LIVE-DEVICE-TOKEN';
// 密码照旧设着（库里的老账号就是这样），但它**只是个摆设**：下面那一条反着量它进不去。
// 能当身份的是种进去的这把令牌，和 signin.js / handle.js 真发出来的那一种一模一样。
const hasAcct = newAccount(PW, 'card');
hasAcct.tokens = [{ t: LIVE_TOKEN, at: Date.now() }];
hasAcct.token = LIVE_TOKEN;
await saveAccount(HAS, hasAcct);

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

// 没误伤：真令牌照样登得上。这一条是整节的尺子——上面那几条「一律 401」要是靠「对谁都
// 答 401」混过去的，它当场红。
const good = await callOn(subscription, { email: HAS, token: LIVE_TOKEN }, '198.51.100.7');
check('真令牌照样登得上，还是拿得到令牌',
  good.status === 200 && good.body.email === HAS && good.body.token === LIVE_TOKEN,
  `${good.status} ${JSON.stringify(good.body.email)}`);
// 「登着」和「是天才」是两件事（CLAUDE.md 权益那一节）。HAS 是一个刷卡户，而上面那个假
// Creem 对它答 404——正是「订阅已经过期」那种人。他照样该登得进自己的账号（云端战绩、
// 寄给他的内部码都在里面），只是 active 如实是假。线上出过一次反的：身份验过了、令牌也
// 签了，却因为没有在续的订阅答成 NOBODY，前端报「这个邮箱名下没有有效的订阅」，把人挡
// 在自己的账号外面。这一条原先是 check-unlock-reset 的 ⑥，第 20 推 unlock.js 回 410、
// 那道门撤掉时挪到这儿（它守的是 subscription.js，不是 unlock.js）。
check('订阅已过期的刷卡户：令牌对了照样登得上，同时如实说不是天才',
  good.status === 200 && good.body.active !== true, `${good.status} active=${good.body.active}`);

// 拿**真密码**登录那一支撤了（E37）。它不许悄悄回来：回来一次，上面那一整节
// 「有账号 / 没账号答同一句」就又多出一条不一样的路。
const withPw = await callOn(subscription, { email: HAS, password: PW }, '198.51.100.9');
check('拿密码登录那一支撤了——真密码也答 401', withPw.status === 401,
  `${withPw.status} ${withPw.raw}`);

// ── ④ 「订着、却没有账号」也不许答得不一样 ───────────────────────────────
//
// 见文件顶上 ① 那段：needsPasscode 没了，这个地址必须和「压根没有账号」一字不差。
// 它在 Creem 那头有一份**活着的订阅**（上面那个假 fetch 只认它），所以这一条量的正是
// 「别拿订阅状态当查号机」。

const paid = await callOn(subscription, { email: PAID_NO_PASS, token: 'NOT-A-TOKEN' }, '198.51.100.8');
const plain = await callOn(subscription, { email: NONE, token: 'NOT-A-TOKEN' }, '198.51.100.10');
check('订阅活着但没有账号：和「压根没这个人」一字不差（不再有 needsPasscode）',
  paid.status === 401 && paid.raw === plain.raw, `${paid.status}:${paid.raw} / ${plain.raw}`);

// ── ② 两条新路也不许当查号机 ────────────────────────────────────────────
//
// 原先这一节量的是「改密码按来路限速」。改密码那一支 2026-10 撤了（E37，密码取消），所
// 以这一节换成那两条**新**路同一个主题的那一面：它们也不该告诉外面的人「这个地址 / 这一
// 串有没有人用」。
//
// ⚠️ 有一处是**故意泄露**的，写在这儿免得以后有人来「堵」它：`api/handle.js` 的
// `register` 撞名时答 409 taken。那是不得不说的——第一串必须唯一，玩家撞上了就得换一
// 串。代价（第一串可被枚举）玩家 2026-10-01 知情拍板，界面上如实告知；从前它还连着「reset 凭
// 第一串就能重设第二串」，10-09 补充方案 7-8 撤了。所以这一节量的是 `signin` 那一支，不是 `register`。
{
  const signinApi = (await import('../api/signin.js')).default;
  const handleApi = (await import('../api/handle.js')).default;

  // signin 的 request：有账号 / 没账号，一字不差（它给谁都发信，所以本来就没什么可藏，
  // 但回包一旦不一样，这条路就成了查号机）。
  const { createAccount, newAccount, pairKey } = await import('../api/_accounts.js');
  await createAccount('probe-has@example.com', newAccount('', 'code'));
  const had = await callOn(signinApi, { email: 'probe-has@example.com' }, '203.0.113.70');
  const hadnt = await callOn(signinApi, { email: 'probe-none@example.com' }, '203.0.113.71');
  // 回包里那张票（`challenge`，2026-10-02 起）每次都是新的随机数，所以比之前先把它抹掉
  // ——要量的是「除它以外一个字都不差」。不抹的话这一条永远红，而红的是门自己。
  const noTicket = (r) => r.raw.replace(/"challenge":"[0-9a-f]{16}"/, '"challenge":"<票>"');
  check('验证码那一支：有账号 / 没账号，回包一字不差（票除外，它本来就该每次不同）',
    had.status === hadnt.status && noTicket(had) === noTicket(hadnt), `${had.raw} / ${hadnt.raw}`);
  check('（反面尺子）两张票确实不一样（不是发了同一张给所有人）',
    had.body.challenge && had.body.challenge !== hadnt.body.challenge,
    `${had.body.challenge} / ${hadnt.body.challenge}`);

  // handle 的 signin：这一串没人用过，和第二串打错了，答同一句。
  await createAccount(pairKey('ProbePair1'), newAccount('rightpass', 'code'));
  const wrongSecond = await callOn(handleApi, { first: 'ProbePair1', second: 'wrongpass' }, '203.0.113.72');
  const noSuchFirst = await callOn(handleApi, { first: 'NoSuchPair', second: 'wrongpass' }, '203.0.113.72');
  check('免邮箱那一支：第一串没人用过 / 第二串打错，答同一句',
    wrongSecond.status === noSuchFirst.status && wrongSecond.raw === noSuchFirst.raw,
    `${wrongSecond.status}:${wrongSecond.raw} / ${noSuchFirst.status}:${noSuchFirst.raw}`);
  // 尺子：真对上了是另一句——不然上面那条在「这个接口对谁都答 401」时也绿。
  const right = await callOn(handleApi, { first: 'ProbePair1', second: 'rightpass' }, '203.0.113.72');
  check('（尺子）两串都对就进得去（不是对谁都答 401）', right.status === 200, String(right.status));
}

// ── ⑤ 旧的《忘记密码》接口关着 ──────────────────────────────────────────
//
// 第 20 推起 api/unlock.js 整条回 410（密码取消了，忘记密码这件事已经不存在）；10-09 补充方案 7-15
// 起连接口都撤了，代码挪到 api/_unlock_legacy.js（下划线开头，不是接口），/api/unlock 是 404。量的
// 是「关着」这件事本身：哪天有人把它挪回来、或者给那份旧代码接上一个 default 导出，一个能改密码、
// 能踢掉所有设备的入口就悄悄回来了，而界面上没有任何地方会提醒。
{
  const { existsSync, readFileSync, readdirSync } = await import('node:fs');
  const apiDir = new URL('../api/', import.meta.url);
  check('《忘记密码》那个接口不在了（没有 api/unlock.js）', !existsSync(new URL('unlock.js', apiDir)));
  const legacy = readFileSync(new URL('_unlock_legacy.js', apiDir), 'utf8');
  check('那份旧代码只是摆着：_unlock_legacy.js 没有 default 导出（接不成一个接口）', !/export default/.test(legacy));
  // 别的接口也没有谁 import 它（import 进来就等于又开了一扇门）。
  const importers = readdirSync(apiDir).filter((f) => f.endsWith('.js') && /_unlock_legacy/.test(readFileSync(new URL(f, apiDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
    .filter((f) => f !== '_unlock_legacy.js');
  check('没有哪个文件 import 那份旧代码', importers.length === 0, importers.join(' '));
}

// ── ③ 账号中心（Creem 客户门户）：同一把尺子 ────────────────────────────

// 这一支 2026-10 改成验**登录令牌**（E44，密码取消了，令牌是唯一还存在的证明）。
// 限速照旧：令牌本身不值得猜，挡的是「拿一份地址名单挨个来问」——每问一次我们都要往
// Creem 打两次 HTTP。
const PORTAL = '203.0.113.88';
const poTries = [];
for (let i = 0; i < 20; i++) {
  poTries.push((await callOn(portal, { email: `target${i}@example.com`, token: 'NOT-A-TOKEN' }, PORTAL)).status);
}
check('账号中心：前 20 次照常答「不对」', poTries.every((c) => c === 401),
  [...new Set(poTries)].join(','));
const poStopped = await callOn(portal, { email: 'target99@example.com', token: 'NOT-A-TOKEN' }, PORTAL);
check('账号中心：第 21 次被来源限速挡下',
  poStopped.status === 429 && poStopped.body.error === 'tooMany',
  `${poStopped.status} ${poStopped.raw}`);
const poOther = await callOn(portal, { email: 'target99@example.com', token: 'NOT-A-TOKEN' }, '203.0.113.89');
check('账号中心：换一个来源不受牵连', poOther.status === 401, String(poOther.status));
// 没有这个账号、和令牌对不上，必须是同一句——否则这一支成了「谁在订阅」的查询接口。
{
  const { createAccount, newAccount } = await import('../api/_accounts.js');
  await createAccount('portal-probe@example.com', newAccount('', 'code'));
  const exists = await callOn(portal, { email: 'portal-probe@example.com', token: 'NOT-A-TOKEN' }, '203.0.113.90');
  const nope = await callOn(portal, { email: 'portal-none@example.com', token: 'NOT-A-TOKEN' }, '203.0.113.90');
  check('账号中心：有账号 / 没账号，答同一句',
    exists.status === nope.status && exists.raw === nope.raw, `${exists.raw} / ${nope.raw}`);
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
