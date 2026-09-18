/**
 * 发信失败必须留痕，而回包必须一个字都不变。
 *
 *   node scripts/check-unlock-mail.mjs
 *
 * 《忘记密码》整条路是通的（按钮常驻、限速两道、猜码先占后比、重设后作废别的
 * 设备），生产的 RESEND_API_KEY / MAIL_FROM 也都配好了。可它有一处**静默失败**：
 *
 *   api/_mail.js 的 sendMail 失败时回 false，而两个调用点（unlock.js 的
 *   request、email.js 的 request）都是 `await sendMail(...)` 之后不看返回值，
 *   紧接着回一句 `{ sent: true }`——而那个文件从前一句 console 都没有。
 *
 * 于是 Resend 那头出任何问题（密钥失效、域名验证掉了、被它限流、收件地址进了
 * 黑名单），玩家看到的都是「验证码已寄出」，然后等一封永远不来的信，码在 Redis
 * 里躺三十分钟自己过期；**而服务端日志里查无此事**。这件事在轮换 Resend 密钥
 * 的时候最要命：配错一个字，忘记密码整条路静默失效，没有任何信号。
 *
 * 这道门钉两件事：
 *
 *   ① 两条失败路径（res.ok 为假、fetch 抛异常）都得写日志。
 *   ② 回包**不许**跟着发信成败变化。这不是懒，是防枚举：unlock.js 里「地址没
 *      有账号也照回 sent: true」那一整套就是为了不让外人拿这个接口点名；回包
 *      一旦分出「发成功 / 发失败」，那套就白做了。所以这里反过来断言：没配邮件
 *      服务（sendMail 必然回 false）时，有账号和没账号的回包要一模一样。
 *
 * 不连任何外部服务：库用进程内那份，邮件干脆不配。
 */
process.env.ALLOW_MEMORY_STORE = '1';
// 配上一对假的：`mailConfigured()` 要两个都在才算数。真正静默的那条路是「**配
// 好了**却发失败」——完全没配的时候 unlock.js 反而很诚实，回 503 noMail，告诉
// 玩家写信到支持邮箱（见 CLAUDE.md 里 RESEND 那一段）。所以要测的是前者。
process.env.RESEND_API_KEY = 're_fake_for_the_gate';
process.env.MAIL_FROM = 'gate@example.invalid';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① 两条失败路径都留痕 ───────────────────────────────────────────────
const { readFileSync } = await import('node:fs');
const mail = readFileSync(new URL('../api/_mail.js', import.meta.url), 'utf8');
const body = mail.slice(mail.indexOf('export async function sendMail'),
                        mail.indexOf('export function compose') >= 0
                          ? mail.indexOf('export function compose')
                          : mail.length);
check('res.ok 为假时写日志', /if \(!res\.ok\)[\s\S]{0,120}console\.error/.test(body));
check('fetch 抛异常时也写日志', /catch \(err[\s\S]{0,120}console\.error/.test(body));
check(
  '日志里不写收件地址（玩家的邮箱不该躺在日志里）',
  !/console\.error\([^)]*\bto\b/.test(body),
);

// ── ② 配好了却发失败：回包一个字不变，但日志里必须留痕 ────────────────
const { mailConfigured } = await import('../api/_mail.js');
check('这一台算「配好了邮件服务」', mailConfigured() === true);

// 把 Resend 那一跳换成必然失败的假货（401，等于密钥失效——正是轮换密钥时最可
// 能出的那种错）。不连网。
const realFetch = globalThis.fetch;
let hits = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes('api.resend.com')) {
    hits++;
    return { ok: false, status: 401, text: async () => 'invalid api key' };
  }
  return realFetch(url);
};
const logged = [];
const realErr = console.error;
console.error = (...a) => { logged.push(a.map(String).join(' ')); };

const unlock = (await import('../api/unlock.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');
const HAS = 'has-account@example.com';
await saveAccount(HAS, newAccount('aaa111', 'code'));

const ask = async (email, ip) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await unlock({ method: 'POST', headers: { 'x-forwarded-for': ip },
                 body: { action: 'request', email } }, res);
  return { status, body: text };
};

const withAcct = await ask(HAS, '203.0.113.11');
const without = await ask('nobody-here@example.com', '203.0.113.12');
console.error = realErr;
globalThis.fetch = realFetch;

check('真去敲了 Resend（桩生效了，否则下面几条量不到东西）', hits >= 1, `${hits} 次`);
check(
  '发信失败，回的仍然是 200 { sent: true }（回包不许跟着成败变化）',
  withAcct.status === 200 && /"sent"\s*:\s*true/.test(withAcct.body),
  `${withAcct.status} ${withAcct.body}`,
);
check(
  '有账号 / 没账号，两种回包逐字一样（外人拿不到「这个地址注册过」）',
  withAcct.status === without.status && withAcct.body === without.body,
  `${withAcct.status} ${withAcct.body} ／ ${without.status} ${without.body}`,
);
check(
  '失败写进了日志，而且带着状态码和服务商的回话',
  logged.some((l) => l.includes('resend failed') && l.includes('401')),
  JSON.stringify(logged),
);
check(
  '日志里没有玩家的邮箱',
  !logged.some((l) => l.includes(HAS)),
  JSON.stringify(logged),
);

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
