/**
 * 注册 / 登录那一条路：一个邮箱，一张六位验证码（E37）。
 *
 *   node scripts/check-signin-otp.mjs
 *
 * **不起服务器、不开浏览器、不发真信。** 直接 import `api/signin.js` 的 handler，拿一对
 * 假的 req/res 喂它；账号库用进程内那份（ALLOW_MEMORY_STORE=1）；Resend 那一次 HTTP 用
 * 一个假的 fetch 顶掉，**而且可以让它失败**——那正是 E51 要量的那一支。
 *
 * 在进程里跑还有一个非这样不行的理由：**验证码只存在库里和那封信里**。起服务器的话这道
 * 门根本读不到码，只能去断言「回了 200」，而那是最没用的那种断言。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 * ① 发码 → 验码 → 拿到令牌，而且账号真的建出来了；
 * ② 新地址 `created: true`、老地址 `created: false`——界面靠这一位决定要不要问「愿不愿
 *    意收更新邮件」，问错了就等于拿一个出厂不勾的框把老玩家当初勾过的意愿抹掉；
 * ③ **有账号和没账号的 `request` 回包一字不差**。这一支给谁都发信，所以它不该泄露「这
 *    个地址有没有号」；
 * ④ 发信失败回 `{ sent:false, reason:'mailDown' }`（E51），**两种地址也一字不差**。
 *    _unlock_legacy.js（原 unlock.js）那条路是吞掉失败的（它只给有账号的地址发，如实回报会泄露账号存不存
 *    在）；这一支给谁都发，所以如实回报不泄露任何东西，而吞掉有害：Resend 额度一满，
 *    所有人都收不到码，界面上却看不出异常；
 * ⑤ 第 6 次尝试连码都不读就被挡（照 _unlock_legacy.js 那一段，先占号再比对）；
 * ⑥ 码过期 / 根本没发过码 → 400 expired；
 * ⑦ **登录不踢别的设备**——`issueToken` 只添一把。这一条错了不报错，只是玩家在手机上
 *    登一次，平板上那台悄悄掉线。
 *
 * ⚠️ 2026-10-02 起每一次要码都带回**一张票**（`challenge`），码和计数都存在那张票底下
 * （见 api/signin.js 顶上那段「为什么要有票」）。所以这道门里每一次 `confirm` 都要把票递
 * 回去，读库也要带着票。票本身那一套性质（外人破坏不了别人那一张、冒号地址被拒……）另有
 * 一道门：`check-signin-challenge.mjs`。
 */
import { get } from '../api/_store.js';

process.env.ALLOW_MEMORY_STORE = '1';
process.env.GENIUS_GRANT_WINDOW = '1';
// 这两个一起在才算「配好了发信」（_mail.js 的 mailConfigured）。真不真不要紧，下面那个
// 假 fetch 才是说了算的。
process.env.RESEND_API_KEY = 'stub';
process.env.MAIL_FROM = 'noreply@example.com';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── 假的 Resend：想让它成功就成功，想让它失败就失败 ──────────────
let mailOk = true;
let sentTo = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.includes('resend.com')) throw new Error('unexpected fetch: ' + u);
  sentTo.push(JSON.parse(init.body).to[0]);
  return { ok: mailOk, status: mailOk ? 200 : 429, text: async () => 'stub' };
};

const { default: signin } = await import('../api/signin.js');

/**
 * 一对够用的假 req/res（handler 只用到 headers / method / body，和 res 那三个方法）。
 *
 * ⚠️ **每一节自己带一个来路 IP。** 按来路那道限速是 10 封 / 小时
 * （`signin:from` + `callerId(req)`），而 `callerId` 在没有头的时候对所有请求返回同一个
 * 桶——整道门于是共用那 10 封，跑到一半就开始回 429，而红的是门自己不是代码。第一版就
 * 是这样：⑤⑦ 两节莫名其妙全红，错在没有头。
 */
let fromIp = '10.0.0.1';
async function call(body) {
  const res = { code: 0, payload: null };
  await signin(
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': fromIp } },
    {
      status(c) { res.code = c; return this; },
      setHeader() {},
      end(text) { res.payload = JSON.parse(text); },
    },
  );
  return { status: res.code, body: res.payload };
}
/** 换一个来路（每一节开头叫一次，免得挤在同一个桶里）。 */
let ipSeq = 0;
const freshIp = () => { fromIp = `10.0.${++ipSeq}.1`; };

/** 要一张码。回包里那张票（`challenge`）单独摆出来，下面每一步都要用它。 */
const ask = async (email, extra = {}) => {
  const r = await call({ email, ...extra });
  return { ...r, ticket: String(r.body?.challenge ?? '') };
};
const confirm = (email, code, ticket, extra = {}) =>
  call({ action: 'confirm', email, code, challenge: ticket, ...extra });
/** 库里那张码。门能读到它，是这道门能量出东西的前提。键里带着票。 */
const codeFor = async (email, ticket) => (await get('signin:' + email + ':' + ticket))?.code;
/**
 * 比两个回包时把票抹掉。
 *
 * 票是随机的，所以两次要码的回包**必然**不一样——要量的是「除它以外一个字都不差」。不抹
 * 的话 ③④ 那两条永远红，而红的是门自己。
 */
const masked = (r) =>
  JSON.stringify({ status: r.status, body: { ...r.body, challenge: '<票>' } });

freshIp();
const FRESH = 'fresh@example.com';
const SECOND = 'second@example.com';

// ── ① 发码 → 验码 → 令牌 ───────────────────────────────────────
{
  const asked = await ask(FRESH);
  check('① 要码：200 sent', asked.status === 200 && asked.body?.sent === true, JSON.stringify(asked.body));
  check('① 回包里有一张 16 位十六进制的票', /^[0-9a-f]{16}$/.test(asked.ticket), asked.ticket);
  const code = await codeFor(FRESH, asked.ticket);
  check('（尺子）库里真有一张六位码', /^\d{6}$/.test(String(code)), String(code));
  check('（尺子）信真的发给了这个地址', sentTo.includes(FRESH), sentTo.join(' '));

  const bad = await confirm(FRESH, '000000' === code ? '111111' : '000000', asked.ticket);
  check('码不对 → 401 wrongCode', bad.status === 401 && bad.body?.error === 'wrongCode', JSON.stringify(bad.body));

  const ok = await confirm(FRESH, code, asked.ticket, { news: true });
  check('码对了 → 200 并拿到令牌', ok.status === 200 && typeof ok.body?.token === 'string' && ok.body.token.length > 0,
    `${ok.status} ${JSON.stringify(ok.body).slice(0, 90)}`);
  check('② 新地址 created: true', ok.body?.created === true, String(ok.body?.created));
  check('窗口开着，这一下就是天才', ok.body?.active === true, String(ok.body?.active));
  check('码用掉就没了（同一张不能再用）', (await codeFor(FRESH, asked.ticket)) === undefined);
}

// ── ② 老地址再来一次：created 必须是 false ─────────────────────
{
  freshIp();
  const re = await ask(FRESH);
  const again = await confirm(FRESH, await codeFor(FRESH, re.ticket), re.ticket);
  check('② 老地址 created: false', again.body?.created === false, String(again.body?.created));
  check('（尺子）还是登得进去，拿得到令牌', again.status === 200 && typeof again.body?.token === 'string');
}

// ── ③④ request 的回包不许泄露「这个地址有没有号」 ──────────────
//
// ⚠️ 每个地址一小时只许三封（`signin:to`）。所以这两节各用**一对新地址**：一个先建好账
// 号（花掉 1 封），一个全新的。第一版拿上面那个 FRESH 来比，它已经花掉 2 封，第 3、4 封
// 撞在限速上回了 429——两边的回包于是「不一样」，而红的其实是门自己。
{
  freshIp();
  const HAS = 'has-account@example.com';
  const first = await ask(HAS);
  await confirm(HAS, await codeFor(HAS, first.ticket), first.ticket);

  mailOk = true;
  const had = await ask(HAS);
  const hadnt = await ask('no-account@example.com');
  check('③ 有账号 / 没账号，要码的回包一字不差（票除外，它本来就该每次不同）',
    masked(had) === masked(hadnt), `${JSON.stringify(had.body)} vs ${JSON.stringify(hadnt.body)}`);
  check('（反面尺子）两张票确实不一样（不是发了同一张给所有人）',
    had.ticket !== hadnt.ticket && had.ticket.length === 16);
  check('（尺子）两边都真发了信（不是都没发）',
    sentTo.includes(HAS) && sentTo.includes('no-account@example.com'));
}
{
  freshIp();
  const HAS2 = 'has-account-2@example.com';
  const seed = await ask(HAS2);
  await confirm(HAS2, await codeFor(HAS2, seed.ticket), seed.ticket);

  mailOk = false;
  const downHad = await ask(HAS2);
  const downNew = await ask('third@example.com');
  check('④ 发信失败 → 200 { sent: false, reason: mailDown }',
    downHad.status === 200 && downHad.body?.sent === false && downHad.body?.reason === 'mailDown',
    JSON.stringify(downHad.body));
  check('④ 失败时两种地址也一字不差（票除外）',
    masked(downHad) === masked(downNew), `${JSON.stringify(downHad.body)} vs ${JSON.stringify(downNew.body)}`);
  // 信没发出去，码照旧留在库里——真实情况里「Resend 回了错但信其实寄到了」是有的。
  check('④ 发信失败也把码留着（万一那封信其实到了）',
    /^\d{6}$/.test(String(await codeFor('third@example.com', downNew.ticket))));
  // 而票也照旧回给他：码可能在他手上，那把能用它的钥匙就不该被我们弄丢。
  check('④ 发信失败也把票回给他', /^[0-9a-f]{16}$/.test(downNew.ticket), downNew.ticket);
  mailOk = true;
}

// ── 限速：一个地址一小时三封，第四封挡住 ──────────────────────
{
  freshIp();
  const SPAM = 'spam-target@example.com';
  const got = [];
  for (let i = 0; i < 4; i++) got.push((await ask(SPAM)).status);
  check('同一个地址第 4 封被挡（429），前 3 封放过', got.join(' ') === '200 200 200 429', got.join(' '));

  /*
   * 按来路那一道：同一个 IP 换着地址来，前 10 封放过、第 11 封挡住。
   *
   * **换一个干净的 IP 再数**，不接着上面那 4 封算。那 4 封里第 4 封是被**按地址**那道
   * 挡掉的，而那一道排在按来路之前（`request` 里的次序），所以它压根没进来路那个桶——
   * 第一版照「4 封都算」去数索引，结果差一位。两道限速各有各的桶，别混着算。
   */
  freshIp();
  const byCaller = [];
  for (let i = 0; i < 11; i++) byCaller.push((await ask(`spray-${i}@example.com`)).status);
  check('同一个来路换着地址来：前 10 封放过，第 11 封挡住',
    byCaller.slice(0, 10).every((x) => x === 200) && byCaller[10] === 429,
    byCaller.join(' '));
}

// ── ⑤ 第 6 次尝试：连码都不读就挡 ──────────────────────────────
{
  freshIp();
  const VICTIM = 'victim@example.com';
  const t = (await ask(VICTIM)).ticket;
  const real = await codeFor(VICTIM, t);
  const wrong = real === '000000' ? '111111' : '000000';
  const seen = [];
  for (let i = 1; i <= 6; i++) seen.push((await confirm(VICTIM, wrong, t)).status);
  check('⑤ 前 5 次是 401，第 6 次是 429', seen.slice(0, 5).every((s) => s === 401) && seen[5] === 429, seen.join(' '));
  // 第 6 次把码一起作废了，所以就算这时打对的那一张也进不去——这是对的：
  // 一张被猜过 5 次的码不该还有效。
  const after = await confirm(VICTIM, real, t);
  check('⑤ 挡住之后连正确的码也不好使了', after.status === 400 && after.body?.error === 'expired', JSON.stringify(after.body));
}

// ── ⑥ 没发过码 ────────────────────────────────────────────────
{
  freshIp();
  const none = await confirm('nobody@example.com', '123456', 'a1b2c3d4e5f60718');
  check('⑥ 压根没发过码 → 400 expired', none.status === 400 && none.body?.error === 'expired', JSON.stringify(none.body));
}

// ── ⑦ 登录不踢别的设备 ────────────────────────────────────────
{
  freshIp();
  const TWO = 'twodevices@example.com';
  const t1 = (await ask(TWO)).ticket;
  const first = await confirm(TWO, await codeFor(TWO, t1), t1);
  const t2 = (await ask(TWO)).ticket;
  const second = await confirm(TWO, await codeFor(TWO, t2), t2);
  check('（尺子）两台设备拿到的是两把不同的令牌', first.body.token !== second.body.token);
  check('（尺子）两台设备用的是两张不同的票', t1 !== t2);

  const { loadAccount, tokenValid } = await import('../api/_accounts.js');
  const account = await loadAccount(TWO);
  check('⑦ 第二台登录之后，第一台那把令牌还好使（没被踢）',
    tokenValid(account, first.body.token) === true);
  check('（尺子）第二台那把当然也好使', tokenValid(account, second.body.token) === true);
  check('（反面尺子）瞎编的令牌不好使', tokenValid(account, 'nope') === false);
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
