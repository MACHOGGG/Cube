/**
 * 换邮箱验证码的猜测次数：按新地址算、一小时一桶，申请新码不清零（10-15 补充 S7，L-4 ①）。
 *
 *   node scripts/check-chmail-guess.mjs
 *
 * 不起服务器、不发真信：库用进程内那一份（ALLOW_MEMORY_STORE），Resend 那一跳换成一个回 200 的桩，直接叫
 * api/email.js 的 handler；码从库里读（chmail:<旧地址>）。
 *
 * 原先计数按旧地址记（chmail:tries:<旧地址>），每申请一张新码就清零，输错 5 次把码连同计数一起删。申请受 chmail:to
 * 限（同一个新地址每小时 3 次），于是同一个新地址每小时最多被比对 15 次（跨整点 30 次），换几个帐号来申请还各算各的。
 * 猜中之后 bound() 写上 emailVerifiedAt，signin 那头的抢注清理就永远不会触发——这个地址从此归猜中的人。
 *
 * 量的是：
 *   ① 输错 5 次之后第 6 次 429 guessCapped（原先回 expired，界面说「请重新寄一次」，可新寄的那张也用不了）；
 *   ② 同一个窗口里再申请一张新码，第一次输入就是 429（申请不清零）；
 *   ③ 换一个帐号申请到同一个新地址，额度共用；
 *   ④ 手上没有寄往这个新地址的码时不记账（别人随手填一个地址烧不掉它的额度）；
 *   ⑤ 正常换邮箱照旧成功，成功之后那个计数删掉。
 * 撤掉改法（email.js 换回原来那一份），①②③④ 都红。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.RESEND_API_KEY = 're_fake_for_the_gate';
process.env.MAIL_FROM = 'gate@example.invalid';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) =>
  String(url).includes('api.resend.com') ? { ok: true, status: 200, text: async () => '{}', json: async () => ({ id: 'stub' }) } : realFetch(url, init);

const email = (await import('../api/email.js')).default;
const { newAccount, saveAccount, loadAccount } = await import('../api/_accounts.js');
const { get } = await import('../api/_store.js');

let ipSeq = 0;
const call = async (body) => {
  ipSeq++;
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  // 每一下换一个来路：chmail:from（同来路每小时 10 次）不是这道门要量的。
  await email({ method: 'POST', headers: { 'x-forwarded-for': `198.30.${Math.floor(ipSeq / 254) % 254}.${(ipSeq % 254) + 1}` }, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};
async function person(addr) {
  const account = newAccount('', 'code');
  account.until = Date.now() + 9e8;
  await saveAccount(addr, account);
  return { email: addr, token: account.token };
}
const ask = (who, newEmail) => call({ email: who.email, token: who.token, newEmail, lang: 'zhHans' });
const tryCode = (who, newEmail, code) => call({ action: 'confirm', email: who.email, token: who.token, newEmail, code });
const codeOf = async (who) => (await get('chmail:' + who.email))?.code;
const wrongFor = (real) => (real === '000000' ? '111111' : '000000');

// ── ①② 输错 5 次之后 429；同一窗口里再申请一张新码，第一次输入就是 429 ─────────────────────────
{
  const a = await person('guess-a@example.com');
  const W = 'wanted-1@example.com';
  check('（尺子）申请得到一张码', (await ask(a, W)).status === 200 && Boolean(await codeOf(a)));
  const wrong = wrongFor(await codeOf(a));
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push(await tryCode(a, W, wrong));
  check('① 前 5 次 401 wrongCode', seen.slice(0, 5).every((r) => r.status === 401 && r.body.error === 'wrongCode'), seen.map((r) => r.status).join(' '));
  check('① 第 6 次 429 guessCapped', seen[5].status === 429 && seen[5].body.error === 'guessCapped', `${seen[5].status} ${seen[5].body.error}`);
  check('（尺子）再申请一张新码：照样寄得出去（申请那道闸是另一回事）', (await ask(a, W)).status === 200);
  const right = await tryCode(a, W, await codeOf(a));
  check('② 同一窗口里新申请的码，第一次输入（哪怕是对的）就是 429 guessCapped', right.status === 429 && right.body.error === 'guessCapped',
    `${right.status} ${right.body.error}`);
  check('②（尺子）还是旧地址上的帐号：没搬走', Boolean(await loadAccount(a.email)) && !(await loadAccount(W)));
}

// ── ③ 换一个帐号申请到同一个新地址：额度共用 ────────────────────────────────────────
{
  const b = await person('guess-b@example.com');
  const c = await person('guess-c@example.com');
  const W = 'wanted-2@example.com';
  await ask(b, W);
  const wb = wrongFor(await codeOf(b));
  const byB = [];
  for (let i = 0; i < 3; i++) byB.push((await tryCode(b, W, wb)).status);
  await ask(c, W);
  const wc = wrongFor(await codeOf(c));
  const byC = [];
  for (let i = 0; i < 3; i++) byC.push((await tryCode(c, W, wc)).status);
  check('③ B 输错 3 次、C 再输：C 的第 3 次（这个新地址的第 6 次）就是 429', byB.join(' ') === '401 401 401' && byC.join(' ') === '401 401 429',
    `B ${byB.join(' ')} · C ${byC.join(' ')}`);
}

// ── ④ 手上没有寄往这个新地址的码：不记账 ──────────────────────────────────────────
{
  const d = await person('guess-d@example.com');
  const e = await person('guess-e@example.com');
  const W = 'wanted-3@example.com';
  const blank = [];
  for (let i = 0; i < 8; i++) blank.push((await tryCode(d, W, '123456')).status);
  check('④ 没申请过就填码：一律 400 expired', blank.every((s) => s === 400), blank.join(' '));
  // d 手上有一张码，却是寄往别的地址的：拿它来填 W，也不算 W 的账
  await ask(d, 'elsewhere@example.com');
  const other = [];
  for (let i = 0; i < 3; i++) other.push((await tryCode(d, W, '123456')).status);
  check('④ 手上的码寄往别的地址、却填 W：一律 400 expired', other.every((s) => s === 400), other.join(' '));
  await ask(e, W);
  const we = wrongFor(await codeOf(e));
  const byE = [];
  for (let i = 0; i < 5; i++) byE.push((await tryCode(e, W, we)).status);
  check('④ 之后真申请到 W 的人：五次机会一次都没少（5 次都是 401）', byE.every((s) => s === 401), byE.join(' '));
}

// ── ⑤ 正常换邮箱照旧成功，成功之后计数删掉 ───────────────────────────────────────────
{
  const f = await person('guess-f@example.com');
  const W = 'wanted-4@example.com';
  await ask(f, W);
  const real = await codeOf(f);
  const miss = await tryCode(f, W, wrongFor(real));
  check('（尺子）输错一次：401', miss.status === 401, String(miss.status));
  const moved = await tryCode(f, W, real);
  check('⑤ 对的码：搬家成功', moved.status === 200 && moved.body.moved === true && moved.body.email === W, `${moved.status} ${moved.body.error ?? ''}`);
  check('⑤ 新地址上有帐号、旧地址上没了', Boolean(await loadAccount(W)) && !(await loadAccount(f.email)));
  check('⑤ 成功之后那个猜测计数删掉了', (await get('chmail:guess:' + W)) === null, JSON.stringify(await get('chmail:guess:' + W)));
}

globalThis.fetch = realFetch;
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
