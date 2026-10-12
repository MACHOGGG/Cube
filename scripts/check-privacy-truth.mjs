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
  zhHans: ['订阅', 'Creem', '6 位密码', '支付信息', '刷卡', '玩法和您取的名字一起', '标签页图标',
    // 10-11 方案 A-1：「IP 段」（IPv4 存的是完整地址）、「一小时左右」（锁定计数留 24 小时、锁最长 4 小时）、
    // 「服务器只拿它认出您」（椅子上记着一枚由账号算出来的标识）、GA「在配置了的情况下」就开（现在要先点接受）。
    'IP 段', '一小时左右', '服务器只拿它认出您', '在配置了的情况下', 'Google Analytics 会使用 Cookie'],
  zhHant: ['訂閱', 'Creem', '6 位密碼', '付款資訊', '刷卡', '玩法和您取的名字一起', '分頁圖示', '標籤頁圖示',
    'IP 段', '一小時左右', '伺服器只拿它認出您', '在有設定的情況下', 'Google Analytics 會使用 Cookie'],
  en: ['subscription', 'Creem', 'six-character passcode', 'payment details', 'card payment', 'which board, and the name you chose', 'tab icon',
    'IP range', 'in about an hour', 'uses only to recognise you', 'where it is configured', 'Google Analytics sets cookies'],
  fr: ['abonnement', 'Creem', 'code secret de six', 'données de paiement', 'le plateau et le pseudonyme choisi', 'icône d’onglet',
    'plage d’IP', 'en une heure environ', 'se sert seulement pour vous reconnaître', 'lorsqu’il est configuré', 'Google Analytics dépose des cookies'],
};
/** 新的事实：每条给一组候选说法，命中一个就算写到了。 */
const MUST_SAY = {
  zhHans: {
    '验证码 30 分钟': ['30 分钟'],
    // 10-11 方案 A-1 起小屋那一条也写着 sha256（椅子上那枚账号标识），只认「sha256」会被那一条顶上，
    // 反向对照（删掉《账号》那一条）就量不出来了——所以认原句。
    '第一串存的是 sha256': ['第一串经 sha256'],
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
    // ── 10-11 方案 A-1 / A-14 ──
    'GA 只在点了「接受」之后才加载': ['点了「接受」之后才加载'],
    'GA 的两个 Cookie 叫什么': ['_ga 和 _ga_'],
    'GA 的 Cookie 留 2 年': ['各保留 2 年'],
    '撤回：隐私政策窗顶上那颗开关': ['「Google Analytics 统计」开关'],
    '拒绝后 6 个月内不再问': ['6 个月内不再问'],
    '点了接受，统计也送到 Google': ['使用统计也会送到 Google'],
    '平台自己记的页面浏览': ['自动记一次「打开了这一页」'],
    '限速：IPv4 是完整地址': ['IPv4 是完整地址'],
    '限速：IPv6 取 /64': ['/64'],
    '输错次数留 24 小时': ['24 小时'],
    '锁定最长 4 小时': ['最长 4 小时'],
    '本机统计计数 13 个月清零': ['13 个月'],
    '0 分的局不上榜': ['0 分的局'],
    '账对不上的局整局不收': ['整局不收'],
    '云上存的是整份记录': ['整份记录'],
    '小屋上传用时和是否交卷': ['用时和是否交卷'],
    '小屋上传看过哪几族的教学': ['看过哪几族的教学'],
    '小屋椅子上记着一枚账号标识': ['由账号算出来的标识'],
    '邮箱账号里那几个格式字段': ['随机盐'],
  },
  zhHant: {
    '驗證碼 30 分鐘': ['30 分鐘'],
    '第一串存的是 sha256': ['第一串經 sha256'],
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
    'GA 只在點了「接受」之後才載入': ['點了「接受」之後才載入'],
    'GA 的兩個 Cookie 叫什麼': ['_ga 和 _ga_'],
    'GA 的 Cookie 留 2 年': ['各保留 2 年'],
    '撤回：隱私政策窗頂上那顆開關': ['「Google Analytics 統計」開關'],
    '拒絕後 6 個月內不再問': ['6 個月內不再問'],
    '點了接受，統計也送到 Google': ['使用統計也會送到 Google'],
    '平台自己記的頁面瀏覽': ['自動記一次「打開了這一頁」'],
    '限速：IPv4 是完整位址': ['IPv4 是完整位址'],
    '限速：IPv6 取 /64': ['/64'],
    '輸錯次數留 24 小時': ['24 小時'],
    '鎖定最長 4 小時': ['最長 4 小時'],
    '本機統計計數 13 個月歸零': ['13 個月'],
    '0 分的局不上榜': ['0 分的局'],
    '帳對不上的局整局不收': ['整局不收'],
    '雲上存的是整份紀錄': ['整份紀錄'],
    '小屋上傳用時和是否交卷': ['用時和是否交卷'],
    '小屋上傳看過哪幾族的教學': ['看過哪幾族的教學'],
    '小屋椅子上記著一枚帳號標識': ['由帳號算出來的標識'],
    '信箱帳號裡那幾個格式欄位': ['隨機鹽'],
  },
  en: {
    'code good for thirty minutes': ['thirty minutes'],
    'first string stored as sha256': ['the sha256 of the first string'],
    'second string stored as scrypt hash': ['scrypt'],
    'no email at all for address-free accounts': ['no email address at all'],
    'kept until you ask us to delete': ['until you write and ask us to delete'],
    'no fake inactivity deadline': ['we do not keep'],
    'mail goes through Resend': ['Resend'],
    'cloud keeps the last sixty runs': ['sixty runs'],
    'rate-limit counters keyed by IP / address / account': ['keep scanners out'],
    'nickname stored on the server with the account': ['nickname is stored on our server with your account'],
    'unique across the site': ['unique across the site'],
    'GA loads only after Accept': ['loads only after you tap “Accept”'],
    'the two GA cookie names': ['_ga and _ga_'],
    'GA cookies last 2 years': ['each kept for 2 years'],
    'withdraw: the switch atop the privacy window': ['“Google Analytics stats” switch'],
    'not asked again for 6 months after declining': ['do not ask again for 6 months'],
    'accepting also sends statistics to Google': ['usage statistics also go to Google'],
    'platform page views': ['records a page view on its own'],
    'rate limits: full IPv4 address': ['the full address for IPv4'],
    'rate limits: IPv6 /64': ['/64'],
    'wrong tries counted 24 hours': ['24 hours'],
    'lock lasts at most 4 hours': ['at most 4 hours'],
    'device counters reset after 13 months': ['reset after 13 months'],
    'a 0-point run stays off the boards': ['a run that scored 0'],
    'a run that does not add up is refused': ['refused outright and not stored at all'],
    'the cloud keeps the whole run record': ['the whole run record'],
    'rooms upload time taken and hand-in': ['time taken and whether you have handed in'],
    'rooms upload which tutorials were seen': ['which families’ tutorials you have seen'],
    'the seat carries an account tag': ['a tag derived from your account'],
    'the placeholder fields of email accounts': ['a random salt'],
  },
  fr: {
    'code valable trente minutes': ['trente minutes'],
    'première chaîne en sha256': ['le sha256 de la première chaîne'],
    'deuxième chaîne en hachage scrypt': ['scrypt'],
    'aucune adresse pour les comptes sans adresse': ['aucune adresse e-mail'],
    'conservé jusqu’à demande de suppression': ['jusqu’à ce que vous nous écriviez'],
    'pas de délai que nous ne tenons pas': ['que nous ne tenons pas'],
    'les courriels passent par Resend': ['Resend'],
    'le nuage garde les soixante dernières': ['soixante dernières'],
    'compteurs anti-balayage': ['anti-balayage'],
    'pseudonyme conservé sur le serveur avec le compte': ['pseudonyme est conservé sur notre serveur avec votre compte'],
    'unique sur tout le site': ['unique sur tout le site'],
    'GA seulement après « Accepter »': ['ne se charge qu’après que vous avez touché « Accepter »'],
    'les deux cookies GA': ['_ga et _ga_'],
    'cookies GA conservés 2 ans': ['conservés chacun 2 ans'],
    'retrait : l’interrupteur en haut de la fenêtre': ['l’interrupteur « Statistiques Google Analytics »'],
    'pas redemandé pendant 6 mois après un refus': ['nous ne redemandons pas avant 6 mois'],
    'accepter envoie aussi les statistiques chez Google': ['les statistiques d’usage partent aussi chez Google'],
    'pages vues des plateformes': ['enregistre aussi d’elle-même une page vue'],
    'limites : adresse IPv4 complète': ['l’adresse complète en IPv4'],
    'limites : réseau IPv6 /64': ['/64'],
    'essais erronés comptés 24 heures': ['24 heures'],
    'verrouillage d’au plus 4 heures': ['au plus 4 heures'],
    'compteurs remis à zéro au bout de 13 mois': ['au bout de 13 mois'],
    'partie à 0 point hors classement': ['une partie à 0 point'],
    'partie dont les comptes ne tombent pas juste refusée': ['refusée en entier'],
    'le nuage garde l’enregistrement complet': ['enregistrement complet'],
    'les salles reçoivent la durée et le rendu': ['sa durée et le fait d’avoir rendu'],
    'les salles reçoivent les tutoriels vus': ['les familles dont vous avez vu le tutoriel'],
    'la place porte un repère tiré du compte': ['un repère tiré de votre compte'],
    'les champs réservés des comptes avec adresse': ['un sel aléatoire'],
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

/*
 * ── ⑤ 统计事件：代码里报的每一个事件、每一个属性，政策里都写着（10-11 方案 A-1）────────────
 *
 * 原先这一段政策写着「送出去的就是下面这些，没有别的」，而 session_start（第几次来、隔了几天、以前打过
 * 几局、语言、屏幕档位）、session_end（停留秒数、看了几屏……）四种语言一个字都没写；game_end 的 first、
 * tutorial_end 的 beats 也没写——「没有别的」成了一句假话。
 *
 * 所以这一节**先读代码**：把 src/ 底下每一处 `report('事件名', { … })` 抽出来，连同对象里的属性名（缩写
 * 的 `{ shape }` 也算）。每个事件必须在下面这张表里登记，登记的属性必须盖住代码里报的属性，四种语言里
 * 那几句话必须都在。代码里多报一个事件、一个属性，这一节先红——那时候要回来改的正是政策那一段。
 */
const EVENTS = {
  session_start: {
    props: ['visit', 'returning', 'days_since_first', 'days_since_last', 'new_player', 'games_before', 'lang', 'screen'],
    say: {
      zhHans: ['这台设备第几次来', '以前来过没有', '离第一次和上一次来各隔了几天', '以前打没打过、打过几局', '界面语言', '屏幕大致是哪一档'],
      zhHant: ['這台裝置第幾次來', '以前來過沒有', '離第一次和上一次來各隔了幾天', '以前打沒打過、打過幾局', '介面語言', '螢幕大致是哪一檔'],
      en: ['which visit this is for this device', 'whether it has been here before', 'how many days since its first and its last visit', 'whether this device has played before and how many runs', 'the interface language', 'a rough screen class'],
      fr: ['le numéro de la visite pour cet appareil', 's’il est déjà venu', 'le nombre de jours depuis sa première et sa dernière visite', 's’il a déjà joué et combien de parties', 'la langue de l’interface', 'une classe d’écran approximative'],
    },
  },
  session_end: {
    props: ['seconds', 'bucket', 'screens', 'games', 'played'],
    say: {
      zhHans: ['在前台停留了多少秒（连同一个时长档位）', '看了几屏', '开了几局', '有没有开过局'],
      zhHant: ['在前景停留了多少秒（連同一個時長檔位）', '看了幾屏', '開了幾局', '有沒有開過局'],
      en: ['how many seconds the game was in front of you this time (plus a duration bucket)', 'how many screens you saw', 'how many runs you started', 'whether you started any'],
      fr: ['combien de secondes le jeu est resté au premier plan cette fois-ci (avec une tranche de durée)', 'combien d’écrans vous avez vus', 'combien de parties vous avez lancées', 'si vous en avez lancé une'],
    },
  },
  screen_view: {
    props: ['screen'],
    say: { zhHans: ['打开了哪一屏'], zhHant: ['打開了哪一屏'], en: ['which screen was opened'], fr: ['quel écran a été ouvert'] },
  },
  game_start: {
    props: ['shape', 'mode', 'first'],
    say: {
      zhHans: ['开始一局时的玩法和布局，以及这是不是这台设备的第一局'],
      zhHant: ['開始一局時的玩法和版面，以及這是不是這台裝置的第一局'],
      en: ['on starting a run, the mode and board and whether it is this device’s first run'],
      fr: ['au début d’une partie, le mode et le plateau, et s’il s’agit de la première partie de cet appareil'],
    },
  },
  game_end: {
    props: ['shape', 'mode', 'score', 'moves', 'seconds', 'duration', 'reason', 'hazard', 'scored', 'first'],
    say: {
      zhHans: ['结束一局时的玩法、布局、得分、步数、秒数（连同一个时长档位）、怎么结束的、是不是炸弹收场、这一局有没有得过分、是不是这台设备的第一局'],
      zhHant: ['結束一局時的玩法、版面、分數、步數、秒數（連同一個時長檔位）、怎麼結束的、是不是炸彈收場、這一局有沒有得過分、是不是這台裝置的第一局'],
      en: ['on finishing one, the mode, board, score, number of moves, seconds (plus a duration bucket), how it ended, whether a bomb ended it, whether it scored at all, and whether it was this device’s first run'],
      fr: ['à la fin, le mode, le plateau, le score, le nombre de coups, les secondes (avec une tranche de durée), comment elle s’est terminée, si une bombe y a mis fin, si elle a rapporté des points et s’il s’agissait de la première partie de cet appareil'],
    },
  },
  tutorial_start: {
    props: ['shape'],
    say: { zhHans: ['看教学时看的是哪一族'], zhHant: ['看教學時看的是哪一族'], en: ['for a tutorial, which family'], fr: ['pour un tutoriel, quelle famille'] },
  },
  tutorial_end: {
    props: ['shape', 'finished', 'beat', 'beats', 'progress'],
    say: {
      zhHans: ['看完了没有、停在第几拍、一共几拍、看了几成'],
      zhHant: ['看完了沒有、停在第幾拍、一共幾拍、看了幾成'],
      en: ['whether you watched it through, which beat you stopped on, how many beats it has and how far that is in percent'],
      fr: ['s’il a été vu jusqu’au bout, à quel temps vous vous êtes arrêté, combien il en compte et quel pourcentage cela représente'],
    },
  },
  language_set: {
    props: ['lang', 'source'],
    say: {
      zhHans: ['语言定下来时的语种', '照浏览器自动选的、还是您自己换的'],
      zhHant: ['語言定下來時的語種', '照瀏覽器自動選的、還是您自己換的'],
      en: ['when the language is set, the language', 'picked automatically from your browser on the first visit or by you'],
      fr: ['quand la langue est fixée, la langue', 'choisie automatiquement d’après votre navigateur à la première visite ou par vous'],
    },
  },
  share_open: {
    props: ['source'],
    say: { zhHans: ['点开分享时是从哪一屏点的'], zhHant: ['點開分享時是從哪一屏點的'], en: ['on opening share, which screen it was opened from'], fr: ['à l’ouverture du partage, depuis quel écran'] },
  },
};
/*
 * 订阅那三个（engine/subscription.ts）：代码还在，网页没有入口、App 版 isLiveSite 为假，**现在发不出去**。
 * 政策里写的是「目前不发送」，所以这三个登记的是那一句，属性不逐个写（它们发不出去）。哪天重开售卖、
 * 它们真的会发了，回来把这三个挪进上面那张表、照实写属性。
 */
const DORMANT = {
  names: ['subscribe_start', 'subscribe_result', 'subscribe_restore'],
  say: {
    zhHans: ['开始付款、付款结果、恢复购买', '目前不发送'],
    zhHant: ['開始付款、付款結果、恢復購買', '目前不發送'],
    en: ['starting a purchase, its outcome, restoring a purchase', 'not sent at present'],
    fr: ['début d’achat, résultat, restauration d’achat', 'pas envoyés à l’heure actuelle'],
  },
};

const { readdirSync, readFileSync, statSync } = await import('node:fs');
const SRC = new URL('../src/', import.meta.url);
/** src/ 底下每一个 .ts（不进 node_modules，src 里本来也没有）。 */
function tsFiles(dir = SRC) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const u = new URL(name, dir);
    if (statSync(u).isDirectory()) out.push(...tsFiles(new URL(name + '/', dir)));
    else if (name.endsWith('.ts')) out.push(u);
  }
  return out;
}
const SOURCES = tsFiles().map((u) => ({ file: u.pathname.split('/src/')[1], text: readFileSync(u, 'utf8') }));

/** 从 `report('名', {` 开始，括号配对取出整个对象，按最外层的逗号切开，取每一段的属性名（含缩写）。 */
function reportedEvents(sources) {
  const found = new Map();
  for (const { file, text } of sources) {
    const code = text.replace(/\/\/[^\n]*/g, '');
    const re = /\breport\(\s*'([a-z_]+)'\s*(,\s*\{)?/g;
    let m;
    while ((m = re.exec(code))) {
      const name = m[1];
      const props = new Set();
      if (m[2]) {
        let i = m.index + m[0].length;
        let depth = 1;
        let quote = '';
        let part = '';
        const parts = [];
        for (; i < code.length && depth > 0; i++) {
          const c = code[i];
          if (quote) {
            part += c;
            if (c === '\\') { part += code[++i]; continue; }
            if (c === quote) quote = '';
            continue;
          }
          if (c === "'" || c === '"' || c === '`') { quote = c; part += c; continue; }
          if ('({['.includes(c)) depth++;
          if (')}]'.includes(c)) depth--;
          if (depth === 0) break;
          if (c === ',' && depth === 1) { parts.push(part); part = ''; continue; }
          part += c;
        }
        parts.push(part);
        for (const p of parts) {
          const k = p.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/);
          if (k) props.add(k[1]);
        }
      }
      const had = found.get(name) || { files: new Set(), props: new Set() };
      had.files.add(file);
      for (const p of props) had.props.add(p);
      found.set(name, had);
    }
  }
  return found;
}

function checkEvents(found, docs, label = '') {
  let red = 0;
  const say = (n, ok, extra) => { if (!ok) red++; if (!label) check(n, ok, extra); };
  // 函数本体那一处 `report(name, …)` 的第一个参数是变量，不是字符串——正则本来就认不得它，不用排除。
  say('⑤（尺子）从 src/ 抽出了事件，而且不少', found.size >= 9, [...found.keys()].join(' '));
  for (const [name, { files, props }] of found) {
    if (DORMANT.names.includes(name)) continue;
    const row = EVENTS[name];
    say(`⑤ 事件 ${name} 登记过（${[...files].join(' ')}）`, !!row, row ? '' : '代码里在报，政策那一段没写——先把它写进四种语言，再登记进 EVENTS');
    if (!row) continue;
    const extra = [...props].filter((p) => !row.props.includes(p));
    say(`⑤ 事件 ${name} 报的属性都登记过`, extra.length === 0, extra.length ? `没登记：${extra.join(' ')}` : [...props].join(' '));
  }
  for (const name of [...Object.keys(EVENTS), ...DORMANT.names]) {
    say(`⑤ 表里的 ${name} 代码里真的还在报（不留死条目）`, found.has(name));
  }
  for (const lang of LANGS) {
    const text = docs[lang];
    const miss = [];
    for (const [name, row] of Object.entries(EVENTS)) for (const w of row.say[lang]) if (!text.includes(w)) miss.push(`${name}：${w}`);
    for (const w of DORMANT.say[lang]) if (!text.includes(w)) miss.push(`订阅那三个：${w}`);
    say(`⑤ ${lang}：每个事件、每个属性政策里都写着`, miss.length === 0, miss.slice(0, 4).join(' | '));
  }
  return red;
}

const PRIVACY_TEXT = Object.fromEntries(LANGS.map((l) => [l, LEGAL[l]?.privacy ? flat(LEGAL[l].privacy) : '']));
const EVENTS_FOUND = reportedEvents(SOURCES);
checkEvents(EVENTS_FOUND, PRIVACY_TEXT);

/*
 * ── ⑥ 本机存储：代码里用到的每一个键，都落在政策写着的某一类里（10-11 方案 A-1）────────────────
 *
 * 原先《只存在您自己设备上的》那一条列的是「语言、教学、色盲、声音、配色、登录缓存、小屋昵称和座位、
 * 最高分」，而代码里还有统计计数、深色界面、翻面速度、Pro、横屏、第一次打开的记号、注册到一半的暂存……
 * 一共漏了十来个。这一节把 src/ 里所有像存储键的字面量抽出来（'slides_…'、'slides.…'、`slides_…${…}`、
 * 'sugarcube_…'，以及战绩那几个 '::…' 后缀），每一个必须落进下面某一类；每一类在四种语言里各有一句话
 * 必须出现。
 *
 * 按前缀分类（方案原话：后面加键只需落进已有的类）：slides_played_*、slides_bulb_*（P14）落进「进度」，
 * slides_consent_* 落进「答复」，slides_daily_*（P17）单独一类、还没有说法——P17 加键的那一推必须把它写
 * 进政策、在这儿补上 say，不然这一节红。
 */
const KEY_CLASSES = [
  { cls: '设置', keys: ['slides_lang', 'slides_colorblind', 'slides_cvd_palette', 'slides_piece_palette', 'slides_sound', 'slides_pro', 'slides_theme', 'slides_theme_paint', 'slides_flip_speed'],
    say: { zhHans: ['设置（语言'], zhHant: ['設定（語言'], en: ['settings (language'], fr: ['réglages (langue'] } },
  // slides_signin_hint_day：结算页那句登录提示上一次是哪一天说的（10-11 方案 B-14，engine/signInHint.ts）。这一类
  // 的说法是一张清单，加一个键就要在清单里多一项——所以它自己那一项也写进 say。
  { cls: '进度', prefixes: ['slides_tutorial_seen', 'slides_played_', 'slides_bulb_'], keys: ['slides_know_how', 'slides_first_run', 'slides_landscape_played', 'slides_total_seen', 'slides_signin_hint_day'],
    say: { zhHans: ['进度（每个教学', '结算页上那句登录提示今天说过没有'], zhHant: ['進度（每個教學', '結算頁上那句登入提示今天說過沒有'],
      en: ['progress (which tutorials', 'whether today’s sign-in tip on the result screen has been shown'],
      fr: ['progression (les tutoriels', 'si le conseil de connexion de l’écran de fin a déjà été affiché aujourd’hui'] } },
  // slides_slot_split_v1：老虎机旧局从基础那一本搬出去的记号（10-11 方案 B-7，engine/slotSplit.ts）——政策里「几枚
  // 『旧记录已经整理过』的记号」那一句本来就是清单式的复数，不用加字。
  { cls: '战绩', prefixes: ['sugarcube_', 'slides_wipe_', '::'], keys: ['slides_runkey_fix_v1', 'slides_slot_split_v1'],
    say: { zhHans: ['战绩（最高分'], zhHant: ['戰績（最高分'], en: ['records (your best scores'], fr: ['parties (vos meilleurs scores'] } },
  { cls: '登录缓存', keys: ['slides_genius', 'slides_pending_account'],
    say: { zhHans: ['登录状态的本地缓存'], zhHant: ['登入狀態的本機快取'], en: ['the cached state of being signed in'], fr: ['l’état de votre connexion mis en cache'] } },
  { cls: '多人', prefixes: ['slides_mp_'],
    say: { zhHans: ['多人游玩（您在小屋里取的昵称'], zhHant: ['多人遊玩（您在小屋裡取的暱稱'], en: ['multiplayer (the nickname you use in rooms'], fr: ['multijoueur (le pseudonyme utilisé dans les salles'] } },
  { cls: '统计计数', prefixes: ['slides_analytics_'],
    say: { zhHans: ['四个统计计数'], zhHant: ['四個統計計數'], en: ['four statistics counters'], fr: ['quatre compteurs de statistiques'] } },
  { cls: '答复', prefixes: ['slides_consent_'],
    say: { zhHans: ['您对 Google Analytics 的答复'], zhHant: ['您對 Google Analytics 的答覆'], en: ['your answer about Google Analytics'], fr: ['votre réponse au sujet de Google Analytics'] } },
  { cls: '这个标签页（sessionStorage）', keys: ['slides_axis_focus'],
    say: { zhHans: ['主菜单停在哪一项'], zhHant: ['主選單停在哪一項'], en: ['which item the main menu was resting on'], fr: ['l’élément sur lequel le menu principal s’était arrêté'] } },
  { cls: '每日挑战（P17 起）', prefixes: ['slides_daily_'] },
  // 调试用的三个：应用自己从不写它们（axisTune 只有开发者手动写进去才有；devDeal / devErosion 整段在
  // import.meta.env.DEV 后面，正式包里连代码都没有），所以不写进政策。
  { cls: '调试（不写进政策）', prefixes: ['slides.'], exempt: true },
];

function storageKeys(sources) {
  const keys = new Map();
  const add = (k, file) => { const s = keys.get(k) || new Set(); s.add(file); keys.set(k, s); };
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/'(slides[_.][A-Za-z0-9_.]*|sugarcube_[A-Za-z0-9_]+|::[A-Za-z]+)'/g)) add(m[1], file);
    for (const m of text.matchAll(/`(slides[_.][A-Za-z0-9_.]*)\$\{/g)) add(m[1], file);
  }
  return keys;
}
const classOf = (k) => KEY_CLASSES.find((c) => (c.keys || []).includes(k) || (c.prefixes || []).some((p) => k.startsWith(p)));

function checkKeys(keys, docs, label = '') {
  let red = 0;
  const say = (n, ok, extra) => { if (!ok) red++; if (!label) check(n, ok, extra); };
  say('⑥（尺子）从 src/ 抽出了存储键，而且不少', keys.size >= 25, `${keys.size} 个`);
  const loose = [...keys.keys()].filter((k) => !classOf(k));
  say('⑥ 每一个存储键都落在某一类里', loose.length === 0,
    loose.length ? `没归类：${loose.map((k) => `${k}（${[...keys.get(k)].join(' ')}）`).join(' | ')}` : '');
  for (const c of KEY_CLASSES) {
    const mine = [...keys.keys()].filter((k) => classOf(k) === c);
    if (c.exempt || mine.length === 0) continue;
    say(`⑥「${c.cls}」这一类写进了政策（${mine.length} 个键）`, !!c.say, c.say ? '' : `这一类还没有说法：${mine.join(' ')}`);
    if (!c.say) continue;
    for (const lang of LANGS) {
      const miss = c.say[lang].filter((w) => !docs[lang].includes(w));
      say(`⑥ ${lang}：「${c.cls}」那一句在`, miss.length === 0, miss.join(' / '));
    }
  }
  return red;
}
const KEYS_FOUND = storageKeys(SOURCES);
checkKeys(KEYS_FOUND, PRIVACY_TEXT);

/*
 * ── ⑦ 正文里不许有 < > & ────────────────────────────────────────────
 *
 * 应用里那扇窗（ui/legalWindow.ts）把正文直接放进 innerHTML，不转义（静态页那一头 build-legal 转义）。
 * 写 `_ga_<编号>` 的结果是 `<编号>` 被当成一个标签吞掉——两个出口显示的不是同一句话。A-1 写 GA 那两个
 * Cookie 名字时差一点就这么写了。
 */
for (const lang of LANGS) {
  const bad = (PRIVACY_TEXT[lang].match(/[<>&]/g) || []).join('');
  check(`⑦ ${lang}：正文里没有 < > &（应用里那扇窗不转义）`, bad === '', bad);
}

// ⑤⑥ 的反向对照：多报一个没登记的事件 / 属性、多一个没归类的键、把《只存在您自己设备上的》删掉，各自会红。
{
  const fakeEv = new Map(EVENTS_FOUND);
  fakeEv.set('secret_event', { files: new Set(['（假的）']), props: new Set() });
  check('（反向对照）代码里多报一个没登记的事件，⑤ 会红', checkEvents(fakeEv, PRIVACY_TEXT, 'quiet') > 0);
  const fakeProp = new Map(EVENTS_FOUND);
  const ge = EVENTS_FOUND.get('game_end');
  fakeProp.set('game_end', { files: ge.files, props: new Set([...ge.props, 'email']) });
  check('（反向对照）game_end 多带一个没登记的属性，⑤ 会红', checkEvents(fakeProp, PRIVACY_TEXT, 'quiet') > 0);
  const fakeKeys = new Map(KEYS_FOUND);
  fakeKeys.set('slides_secret_thing', new Set(['（假的）']));
  check('（反向对照）多一个没归类的存储键，⑥ 会红', checkKeys(fakeKeys, PRIVACY_TEXT, 'quiet') > 0);
  const daily = new Map(KEYS_FOUND);
  daily.set('slides_daily_sync', new Set(['（假的）']));
  check('（反向对照）P17 那个 slides_daily_sync 不补说法就进来，⑥ 会红', checkKeys(daily, PRIVACY_TEXT, 'quiet') > 0);
  const noLocal = { ...PRIVACY_TEXT, zhHans: flat({ ...LEGAL.zhHans.privacy, items: LEGAL.zhHans.privacy.items.filter((i) => i.term !== '只存在您自己设备上的') }) };
  check('（反向对照）把《只存在您自己设备上的》删掉，⑥ 会红', checkKeys(KEYS_FOUND, noLocal, 'quiet') > 0);
  const noStats = { ...PRIVACY_TEXT, en: flat({ ...LEGAL.en.privacy, items: LEGAL.en.privacy.items.filter((i) => i.term !== 'Usage statistics') }) };
  check('（反向对照）把英文的《Usage statistics》删掉，⑤ 会红', checkEvents(EVENTS_FOUND, noStats, 'quiet') > 0);
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
