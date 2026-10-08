/**
 * 发信失败必须留痕。
 *
 *   node scripts/check-mail-trace.mjs
 *
 * api/_mail.js 的 sendMail 失败时回 false。从前这个文件一句 console 都没有，而调用
 * 它的地方有的不看返回值（email.js 的 request 照样回 `{ sent: true }`；从前 unlock.js
 * 的 request 也是，为了防枚举），于是 Resend 那头出任何问题——密钥失效、域名验证掉了、
 * 被它限流、收件地址进了黑名单——玩家看到的都是「验证码已寄出」，然后等一封永远不来
 * 的信；**而服务端日志里查无此事**。这件事在轮换 Resend 密钥的时候最要命：配错一个
 * 字，发信整条路静默失效，没有任何信号。signin.js 后来改成如实回报（E51，回
 * `mailDown`），可日志这一头还是只有 sendMail 自己写得出来。
 *
 * 这道门钉两件事：
 *
 *   ① 读源码：两条失败路径（res.ok 为假、fetch 抛异常）都写日志，日志里不写收件地址。
 *   ② 真跑：把 Resend 那一跳换成必然失败的假货，sendMail 回 false、日志里有状态码和
 *      服务商的回话、没有玩家的邮箱；抛异常那条同理；发成功的时候一句都不写（尺子）。
 *
 * 第 20 推之前这道门叫 check-unlock-mail，② 是绕道 unlock.js 的 request 量的。
 * unlock.js 回 410 之后那条路走不到了，而它量的本来就是 _mail.js 自己的事，所以改成
 * 直接调 sendMail。从前 ② 里还有一条「有账号 / 没账号回包逐字一样」——那是 unlock.js
 * 的防枚举，跟着它一起退休了（signin.js 那一支的同一条由 check-auth-probe 守着）。
 *
 * 不连任何外部服务，不起服务器。
 */
// 配上一对假的：`mailConfigured()` 要两个都在才算数。真正静默的那条路是「**配好了**却
// 发失败」——完全没配的时候 sendMail 一个请求都不发，直接回 false。所以要测的是前者。
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

// ── ② 配好了却发失败：回 false，日志里留痕，不留地址 ──────────────────
const { mailConfigured, sendMail } = await import('../api/_mail.js');
check('这一台算「配好了邮件服务」', mailConfigured() === true);

const TO = 'someone-real@example.com';
const realFetch = globalThis.fetch;
const realErr = console.error;
/** 换一个假的 Resend 跑一次 sendMail，收下这一趟写出来的日志。 */
const attempt = async (fake) => {
  let hits = 0;
  const logged = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com')) {
      hits++;
      return fake(init);
    }
    return realFetch(url, init);
  };
  console.error = (...a) => { logged.push(a.map(String).join(' ')); };
  let ok;
  try {
    ok = await sendMail({ to: TO, subject: 'gate', text: 'code 123456' });
  } finally {
    console.error = realErr;
    globalThis.fetch = realFetch;
  }
  return { ok, hits, logged };
};

// 401 ＝ 密钥失效——正是轮换密钥时最可能出的那种错。
const refused = await attempt(async () => ({ ok: false, status: 401, text: async () => 'invalid api key' }));
check('真去敲了 Resend（桩生效了，否则下面几条量不到东西）', refused.hits === 1, `${refused.hits} 次`);
check('被拒：sendMail 回 false', refused.ok === false, String(refused.ok));
check(
  '被拒写进了日志，而且带着状态码和服务商的回话',
  refused.logged.some((l) => l.includes('resend failed') && l.includes('401') && l.includes('invalid api key')),
  JSON.stringify(refused.logged),
);
check('被拒那条日志里没有玩家的邮箱', !refused.logged.some((l) => l.includes(TO)), JSON.stringify(refused.logged));

// 网络断了、DNS 解析不出来：fetch 直接抛。
const thrown = await attempt(async () => { throw new Error('getaddrinfo ENOTFOUND api.resend.com'); });
check('抛异常：sendMail 回 false（不往上抛，调用点不至于 500）', thrown.ok === false, String(thrown.ok));
check(
  '抛异常也写进了日志，带着原因',
  thrown.logged.some((l) => l.includes('resend threw') && l.includes('ENOTFOUND')),
  JSON.stringify(thrown.logged),
);
check('抛异常那条日志里也没有玩家的邮箱', !thrown.logged.some((l) => l.includes(TO)), JSON.stringify(thrown.logged));

// 尺子：发成功的时候一句都不写。不然「写了日志」那几条在「什么时候都写」时也绿。
const fine = await attempt(async () => ({ ok: true, status: 200, json: async () => ({ id: 'stub' }) }));
check('（尺子）发成功：回 true，日志一句都没有', fine.ok === true && fine.logged.length === 0,
  `${fine.ok} ${JSON.stringify(fine.logged)}`);

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
