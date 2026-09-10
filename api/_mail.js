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
    return res.ok;
  } catch {
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
