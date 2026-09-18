/**
 * Sending one kind of message: the code that unlocks an account whose
 * passcode has been got wrong six times.
 *
 * Nothing else in the app sends email — Creem writes its own receipts and
 * renewal notices, and the stores write theirs — so this is deliberately
 * one function over one REST call rather than a mail library.
 *
 * With no provider configured it says so instead of pretending to send.
 * The caller then tells the player to write to the support address, which
 * is a real way out rather than a dead end, and is where the five published
 * documents already point.
 */

const key = () => process.env.RESEND_API_KEY || '';
const from = () => process.env.MAIL_FROM || '';

export const mailConfigured = () => Boolean(key() && from());

/**
 * 发一封信。回 false = 没发出去。
 *
 * **失败必须留痕**，这是这个函数里唯一不为了发信而存在的一段代码。
 *
 * 两个调用点（unlock.js 的 request、email.js 的 request）都是 `await
 * sendMail(...)` 之后不看返回值，紧接着回一句 `{ sent: true }`——那是故意的，
 * 因为回包一旦跟着发信成败变化，外人就能拿它区分「这个地址注册过没有」
 * （unlock.js 里「地址没账号也回 sent: true」那一整套防枚举就白做了）。
 *
 * 可代价是：Resend 那头出任何问题——密钥失效、域名验证掉了、被它限流、收件
 * 地址进了黑名单——玩家看到的都是「验证码已寄出」，然后等一封永远不来的信，
 * 码在 Redis 里躺三十分钟自己过期。而这个文件从前一句 console 都没有，所以
 * **服务端日志里也看不到任何痕迹**：玩家说「点了没反应」，这边查无此事。
 *
 * 所以回包照旧不动（防枚举那条更要紧），但失败一定写进日志。日志里不写收件
 * 地址——那是玩家的邮箱，不该躺在日志里；只写状态码和服务商的回话，足够分辨
 * 是密钥失效、域名没验证，还是对方限流。
 */
export async function sendMail({ to, subject, text }) {
  if (!mailConfigured()) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: from(), to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error('resend failed:', res.status, await res.text().catch(() => ''));
    }
    return res.ok;
  } catch (err) {
    console.error('resend threw:', err?.message || err);
    return false;
  }
}

/**
 * 一封信写哪几种语言——所有要发信的地方共用这一条规矩。
 *
 * 两句话：
 *   · 玩家界面上是哪种语言，信就用哪种写。这一串是客户端报上来的，所以只认
 *     名单里那四个，别的一律当英文——一个陌生人拿到的信，英文总比一种他读不
 *     懂的文字强。
 *   · **英文永远附一份在后面**（英文那档除外）。收信的可能是他手机上一个只
 *     认英文的客户端、也可能是他换了台设备、还可能是他人在国外——一封只有他
 *     此刻界面语言的信，读不懂就等于没发。多这几行字换「一定读得懂」，值。
 *
 * 信的正文各写各的（就放在用它的那个接口里，改文案时看得见上下文），这里只
 * 管挑语言和拼那一份英文。
 */
const LANGS = ['en', 'zhHans', 'zhHant', 'fr'];

export const mailLang = (want) => (LANGS.includes(String(want || '')) ? String(want) : 'en');

/**
 * @param table {{ [lang: string]: { subject: string, body: (...a) => string } }}
 * @param lang  mailLang() 挑好的那一个
 * @param args  交给 body 的参数（验证码之类）
 */
export function compose(table, lang, ...args) {
  const pick = table[lang] || table.en;
  const english = table.en.body(...args);
  return {
    subject: pick.subject,
    text: lang === 'en' ? english : `${pick.body(...args)}\n\n${english}`,
  };
}
