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
  // 第 16 推起每一局**不再带名字**上传（push 不读名字，昵称只走改名接口），所以「连同这一局
  // 的……和你取的名字一起存」那句成了假话，撤掉；末尾那个词组就是它。
  //
  // 2026-10-08（方案 3-C-4）个人主页的《图示》连同挑标签页图标那扇窗一起删了：本机不再存「选
  // 了哪个图标」，统计里也不再有「换图标时换成了哪一个」——两句都成了假话，末尾那两个词组就
  // 是它们（本机那一条和统计那一条各一个）。
  zhHans: ['订阅', 'Creem', '6 位密码', '支付信息', '刷卡', '玩法和您取的名字一起', '标签页图标'],
  zhHant: ['訂閱', 'Creem', '6 位密碼', '付款資訊', '刷卡', '玩法和您取的名字一起', '分頁圖示', '標籤頁圖示'],
  en: ['subscription', 'Creem', 'six-character passcode', 'payment details', 'card payment', 'which board, and the name you chose', 'tab icon'],
  fr: ['abonnement', 'Creem', 'code secret de six', 'données de paiement', 'le plateau et le pseudonyme choisi', 'icône d’onglet'],
};
/** 新的事实：每条给一组候选说法，命中一个就算写到了。 */
const MUST_SAY = {
  zhHans: {
    '验证码 30 分钟': ['30 分钟'],
    '第一串存的是 sha256': ['sha256'],
    '第二串存的是 scrypt 哈希': ['scrypt'],
    '免邮箱账号我们连邮箱都没有': ['连一个邮箱都没有', '连邮箱都没有'],
    '保留期改成「来信就删」': ['直到您来信要求删除'],
    '不写做不到的自动清理': ['做不到的期限'],
    '寄信走 Resend': ['Resend'],
    '云上只留 60 局': ['60 局'],
    '限速计数以 IP 段 / 邮箱 / 账号为键': ['限速计数'],
    // 第 16 推：方案给的原句。
    '昵称随账号存在服务器上、显示在排行榜和小屋里、全站唯一': ['昵称随账号存在服务器上'],
    '全站唯一': ['全站唯一'],
  },
  zhHant: {
    '驗證碼 30 分鐘': ['30 分鐘'],
    '第一串存的是 sha256': ['sha256'],
    '第二串存的是 scrypt 哈希': ['scrypt'],
    // 10-08 方案第四批第 3 条：繁体统一「信箱」，原先这儿认的是「連一個電子郵件都沒有」
    '免信箱帳號我們連信箱都沒有': ['連一個信箱都沒有', '連信箱都沒有'],
    '保留期改成「來信就刪」': ['直到您來信要求刪除'],
    '不寫做不到的自動清理': ['做不到的期限'],
    '寄信走 Resend': ['Resend'],
    '雲上只留 60 局': ['60 局'],
    '限速計數以 IP 段 / 信箱 / 帳號為鍵': ['限速計數'],
    '暱稱隨帳號存在伺服器上、顯示在排行榜和小屋裡、全站唯一': ['暱稱隨帳號存在伺服器上'],
    '全站唯一': ['全站唯一'],
  },
  en: {
    'code good for thirty minutes': ['thirty minutes'],
    'first string stored as sha256': ['sha256'],
    'second string stored as scrypt hash': ['scrypt'],
    'no email at all for address-free accounts': ['no email address at all'],
    'kept until you ask us to delete': ['until you write and ask us to delete'],
    'no fake inactivity deadline': ['we do not keep'],
    'mail goes through Resend': ['Resend'],
    'cloud keeps the last sixty runs': ['sixty runs'],
    'rate-limit counters keyed by IP / address / account': ['keep scanners out'],
    'nickname stored on the server with the account': ['nickname is stored on our server with your account'],
    'unique across the site': ['unique across the site'],
  },
  fr: {
    'code valable trente minutes': ['trente minutes'],
    'première chaîne en sha256': ['sha256'],
    'deuxième chaîne en hachage scrypt': ['scrypt'],
    'aucune adresse pour les comptes sans adresse': ['aucune adresse e-mail'],
    'conservé jusqu’à demande de suppression': ['jusqu’à ce que vous nous écriviez'],
    'pas de délai que nous ne tenons pas': ['que nous ne tenons pas'],
    'les courriels passent par Resend': ['Resend'],
    'le nuage garde les soixante dernières': ['soixante dernières'],
    'compteurs anti-balayage': ['anti-balayage'],
    'pseudonyme conservé sur le serveur avec le compte': ['pseudonyme est conservé sur notre serveur avec votre compte'],
    'unique sur tout le site': ['unique sur tout le site'],
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

  /*
   * **「我们不记你的 IP」这句话不许回来。**
   *
   * 它在 2026-10-03 之前一直写在《多人小屋》那一条里，而它是假的：全站每一道接口都带限
   * 速（api/_ratelimit.js 的 callerId），而那个计数的键就是**收到 IP 之后算出来的网段**，
   * 在库里活一小时左右。不是「记录你的行踪」，但也绝不是「不记」——说一句比实际更干净的
   * 话，是支付审核眼里最糟的那一类（「网站陈述与实际不符」）。
   *
   * 查的是「不记」「不记录」那几个词紧挨着 IP 出现，而不是「IP」本身——现在这份文档**该
   * 提 IP**（它要说清楚限速计数以 IP 段为键），所以禁的是那个否定句，不是那个词。
   */
  const DENY_IP = [
    /不记[^。]{0,12}IP/,
    /不記[^。]{0,12}IP/,
    /(?:record|collect|keep|store|log)\s+(?:neither|no)[^.]{0,24}IP/i,
    /n['\u2019]enregistrons\s+(?:ni|pas)[^.]{0,40}IP/i,
  ];
  const liar = DENY_IP.filter((re) => re.test(text)).map((re) => String(re));
  check(`${lang}：没有「我们不记你的 IP」这种说法`, liar.length === 0, liar.join(' | '));

  /*
   * **正文里不许有 `**`。**
   *
   * 这几份文档有两个出口：`build-legal.mjs` 出的静态页，和应用里那个弹窗。两边都把正文当
   * **纯文本**摆（弹窗那边还要走一次 escape），没有哪一头会把 Markdown 解成粗体——所以
   * 写 `**邮箱账号**` 的结果是玩家在法务页上看到四个星号。
   *
   * 要强调就用中文的角括号「」（英法两种语言里连它都不用：那两种语言的角括号是错的排
   * 版，冒号本身已经够了）。不要改成 `<b>`：这份正文从来没有 HTML，一处开了口，下一个人
   * 就会往里塞链接和列表，而那两个出口的 escape 规则并不相同。
   */
  check(`${lang}：正文里一个 ** 都没有`, !text.includes('**'),
    (text.match(/\*\*[^*]{0,20}\*\*/g) || []).slice(0, 3).join(' | '));

  for (const [what, says] of Object.entries(MUST_SAY[lang])) {
    check(`${lang}：说到了「${what}」`, says.some((w) => text.includes(w)),
      says.join(' / '));
  }
}

/*
 * ── ④ 「寄信走 Resend」那一句，只列真寄出去的码（10-08 方案第四批第 2 条）─────────────
 *
 * 那一句原先是「验证码、解锁码、后台寄的内部码都是它发的」，后两样都不是真的：
 *   · 内部码从来不寄信——mint.js 只把码写进账号的收件箱（_accounts.js 的 inbox），玩家登录
 *     之后在站内看到。方案点名这一条「本批最高优先」：支付审核引用过法务页，有前科。
 *   · 解锁码：第 20 推起 unlock.js 整条回 410，一封都不再寄。方案给的替换句是「只列『验证码、
 *     解锁码』」，那是按「解锁码还在寄」写的；照抄就是把一句新的假话写回去，所以只列验证码
 *     ——登录（signin.js）和换邮箱（email.js，码寄给新地址）这两处。
 *
 * 这一节**先读代码再读条款**：api/ 底下哪几个接口真的调 sendMail（handler 第一句就回 410 的
 * 不算），钉成「正好是登录和换邮箱」。哪天哪个接口开始寄别的东西（比如发码改成真寄信、
 * 解锁那条路回来了），这一条先红——那时候要回来改的正是这一句。
 */
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const apiDir = new URL('../api/', import.meta.url);
  const read = (f) => readFileSync(new URL(f, apiDir), 'utf8');
  const endpoints = readdirSync(apiDir).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
  const callsMail = endpoints.filter((f) => /\bsendMail\s*\(/.test(read(f)));
  // handler 一进门就回 410 的，下面那些 sendMail 走不到（原来的 unlock.js 就是这样；10-09 起它挪成了
  // _unlock_legacy.js，下划线开头，干脆不算接口了）
  const gone = (f) => /export default async function handler\s*\([^)]*\)\s*\{\s*return send\(res,\s*410/.test(read(f));
  const live = callsMail.filter((f) => !gone(f)).sort();
  check('（尺子）api/ 底下读到了接口，也认得出哪个在寄信', endpoints.length >= 8 && callsMail.length >= 1,
    `${endpoints.length} 个接口，调 sendMail 的 ${callsMail.join(' ')}`);
  check('真在寄信的正好是登录（signin.js）和换邮箱（email.js）——寄的都是验证码',
    live.join(' ') === 'email.js signin.js', live.join(' ') || '（一个都没有）');
  check('发内部码（mint.js）不寄信：码只写进账号的收件箱', !/\bsendMail\b/.test(read('mint.js')));

  // 每种语言：带 Resend 的那一句说到了登录和换邮箱，没说内部码、解锁码
  const RESEND = {
    zhHans: { says: ['验证码', '登录', '换邮箱'], never: ['内部码', '解锁码'] },
    zhHant: { says: ['驗證碼', '登入', '換信箱'], never: ['內部碼', '解鎖碼'] },
    en: { says: ['sign in', 'change your address'], never: ['unlock', 'insider', 'the codes we send you'] },
    fr: { says: ['vous connecter', 'changer d’adresse'], never: ['déblocage', 'Génie', 'codes que nous vous envoyons passent'] },
  };
  const resendSentence = (lang) => {
    const doc = LEGAL[lang]?.privacy;
    const body = doc?.items.map((i) => i.body).find((b) => b.includes('Resend')) || '';
    // 句子按句号切（中文「。」，英法「. 」）；括号里那一段和 Resend 在同一句
    return body.split(/(?<=。)|(?<=\.)\s+/).find((x) => x.includes('Resend')) || '';
  };
  for (const lang of LANGS) {
    const line = resendSentence(lang);
    const { says, never } = RESEND[lang];
    check(`${lang}：（尺子）找到了带 Resend 的那一句`, line.length > 20, line.slice(0, 60));
    if (line.length <= 20) continue;
    const miss = says.filter((w) => !line.includes(w));
    check(`${lang}：寄信那一句说的是登录和换邮箱的验证码`, miss.length === 0, miss.length ? `缺：${miss.join(' / ')}` : '');
    const lie = never.filter((w) => line.toLowerCase().includes(w.toLowerCase()));
    check(`${lang}：寄信那一句没有内部码、解锁码（一个不寄信、一个第 20 推起不再寄）`, lie.length === 0, lie.join(' / '));
  }
  // 反向对照：原先那一句塞回去，上面那一条会红
  const old = '寄信走 「Resend」（验证码、解锁码、后台寄的内部码都是它发的），所以你的邮箱地址会经过它。';
  check('（反向对照）原先那一句塞回去，「没有内部码、解锁码」会红',
    RESEND.zhHans.never.some((w) => old.includes(w)));
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
