/**
 * 隐私政策说的，是这套代码此刻真做的那件事（E52）。
 *
 *   npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs
 *   node scripts/check-privacy-truth.mjs /tmp/legal.mjs
 *
 * 纯算术，不开浏览器，进得了 CI。
 *
 * ── 为什么逐条重写而不是只加一节 ───────────────────────────
 *
 * CLAUDE.md 那条：「法务文本里的每一句都是**对代码实际行为的陈述**。」2026-10 的改制
 * （E37/E38/E40）换掉了身份这件事本身：没有密码了、没有订阅了、多了一种连邮箱都没有的账
 * 号。原来那份隐私政策里**大半条目描述的是订阅 / 内部码 / 密码模型**——只加一节「现在还
 * 有免邮箱账号」的话，新旧两段会在同一页上互相打脸，而「网站陈述与实际不符」比缺一份文
 * 档严重。
 *
 * 所以这道门钉三件事：
 *
 * ① **撤掉的说法不许留在正文里**：订阅、Creem、6 位密码、支付信息那几条。
 * ② **新的事实要写出来**：验证码 30 分钟、第一串存的是 sha256、第二串存的是 scrypt 哈
 *    希、免邮箱账号我们连邮箱都没有、保留期改成「来信就删」。
 * ③ **四种语言一个都不能漏。** 法务文本最容易只改中文。
 *
 * ⚠️ 两处**故意留着**的词，写在这儿免得以后有人来「清」它们：
 *
 *   · 「内部码」/「insider code」—— 后端 `api/redeem.js` 和 `api/mint.js` 一行没动，账号
 *     上真的可能存着后台寄来的码，所以那一条是**必须披露**的事实。撤掉它反而让政策变得
 *     不准。
 *   · 法语的 `désabonnement`（退订链接）—— 它含着 abonnement 这个词根，但说的是「每封营
 *     销邮件底部都有退订链接」，那是 GDPR 要求写的一句。
 *
 * 所以下面查「订阅」那几个词是**按词查、并且把那两处排除掉**，不是粗暴地禁一个词根。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-privacy-truth.mjs <打包好的 legal.mjs>');
  console.error('  npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs');
  process.exit(2);
}
const { LEGAL } = await import(src);

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];

/** 一份文档的全文（抬头 + 引言 + 每条的词条和正文）拼成一个串。 */
const flat = (doc) =>
  [doc.title, doc.intro, ...doc.items.flatMap((i) => [i.term, i.body])].join('\n');

/** 撤掉的说法：按语言各给一组词。查之前先把那两处故意留的挖掉。 */
const GONE = {
  zhHans: ['订阅', 'Creem', '6 位密码', '支付信息', '刷卡'],
  zhHant: ['訂閱', 'Creem', '6 位密碼', '付款資訊', '刷卡'],
  en: ['subscription', 'Creem', 'six-character passcode', 'payment details', 'card payment'],
  fr: ['abonnement', 'Creem', 'code secret de six', 'données de paiement'],
};
/** 新的事实：每条给一组候选说法，命中一个就算写到了。 */
const MUST_SAY = {
  zhHans: {
    '验证码 30 分钟': ['30 分钟'],
    '第一串存的是 sha256': ['sha256'],
    '第二串存的是 scrypt 哈希': ['scrypt'],
    '免邮箱账号我们连邮箱都没有': ['连一个邮箱都没有', '连邮箱都没有'],
    '保留期改成「来信就删」': ['直到你来信要求删除'],
    '不写做不到的自动清理': ['做不到的期限'],
  },
  zhHant: {
    '驗證碼 30 分鐘': ['30 分鐘'],
    '第一串存的是 sha256': ['sha256'],
    '第二串存的是 scrypt 哈希': ['scrypt'],
    '免信箱帳號我們連信箱都沒有': ['連一個電子郵件都沒有', '連電子郵件都沒有'],
    '保留期改成「來信就刪」': ['直到你來信要求刪除'],
    '不寫做不到的自動清理': ['做不到的期限'],
  },
  en: {
    'code good for thirty minutes': ['thirty minutes'],
    'first string stored as sha256': ['sha256'],
    'second string stored as scrypt hash': ['scrypt'],
    'no email at all for address-free accounts': ['no email address at all'],
    'kept until you ask us to delete': ['until you write and ask us to delete'],
    'no fake inactivity deadline': ['we do not keep'],
  },
  fr: {
    'code valable trente minutes': ['trente minutes'],
    'première chaîne en sha256': ['sha256'],
    'deuxième chaîne en hachage scrypt': ['scrypt'],
    'aucune adresse pour les comptes sans adresse': ['aucune adresse e-mail'],
    'conservé jusqu’à demande de suppression': ['jusqu’à ce que vous nous écriviez'],
    'pas de délai que nous ne tenons pas': ['que nous ne tenons pas'],
  },
};
/** 故意留着的那两处，查「撤掉的说法」之前挖掉（见文件头）。 */
const ALLOWED = [
  /内部码[^。]*?（[^）]*）/g, /內部碼[^。]*?（[^）]*）/g,
  /désabonnement/g,
];

for (const lang of LANGS) {
  const doc = LEGAL[lang]?.privacy;
  // 尺子先行：**正文长度 > 300**。少了它，底下每一句「不许出现 X」在文档是空串时全是真
  // 的——那是这个仓库最常见的那种假绿。
  const text = doc ? flat(doc) : '';
  check(`${lang}（尺子）隐私政策读到了，而且不短`, text.length > 300, `${text.length} 字`);
  if (text.length <= 300) continue;

  let hunt = text;
  for (const re of ALLOWED) hunt = hunt.replace(re, '');
  const left = GONE[lang].filter((w) => hunt.toLowerCase().includes(w.toLowerCase()));
  check(`${lang}：撤掉的那几个说法一个都不在`, left.length === 0, left.join(' | '));

  for (const [what, says] of Object.entries(MUST_SAY[lang])) {
    check(`${lang}：说到了「${what}」`, says.some((w) => text.includes(w)),
      says.join(' / '));
  }
}

// ── 反向对照：这道门量得出「悄悄把一条删掉」吗 ─────────────────────────
{
  const doc = { ...LEGAL.zhHans.privacy };
  // 把「账号」那一条整个拿掉，②那几句就该红。
  const broken = { ...doc, items: doc.items.filter((i) => i.term !== '账号') };
  const text = flat(broken);
  const missing = Object.entries(MUST_SAY.zhHans).filter(([, says]) => !says.some((w) => text.includes(w)));
  check('（反向对照）把《账号》那一条删掉，②那几句会红', missing.length >= 3,
    `红了 ${missing.length} 句：${missing.map(([w]) => w).join(' ')}`);
  // 反过来：把「订阅」塞回正文，①那一条也该红。
  const sneaky = flat({ ...doc, items: [...doc.items, { term: '订阅', body: '每月自动续费。' }] });
  let hunt = sneaky;
  for (const re of ALLOWED) hunt = hunt.replace(re, '');
  check('（反向对照）把「订阅」塞回正文，①那一条会红',
    GONE.zhHans.some((w) => hunt.includes(w)));
}

console.log(fail ? `\n${fail} 条红` : '\nALL PASS');
process.exit(fail ? 1 : 0);
