/**
 * 中文用字统一：简体「账号」、繁体「帳號」「信箱」、全站「您」（10-08 方案第四批第 3 条；称呼 10-09 补充方案
 * 第一部分第 6 条改成「您」）。
 *
 *   node scripts/check-zh-terms.mjs
 *
 * 读源码，不打包、不开浏览器，零点几秒，进得了 CI。
 *
 * 方案原话：「用字统一：简体全站『账号』（legal.ts 昵称/多人小屋两条现用『帐号』）；繁体统一『帳號』『信箱』；
 * 您/你 全站统一（grep 取现状多数后统一，别一半一半）。」
 *
 * 改之前量的现状（只算玩家看得到的字，注释不算）：
 *   · 简体：「账号」是绝大多数；「帐号」只剩隐私政策《昵称》《多人小屋》两条和管理员页，「账户」两处
 *     （免邮箱「新账户登录成功……」那一句、换邮箱那封信）。
 *   · 繁体：法务页说「信箱」，界面那十三句却全写「電子郵件」（輸入框的名字、《免電子郵件》那颗键……），
 *     隐私政策同一句里「電子郵件帳號」和「免信箱帳號」并排；「帳戶」两处（同上两句的繁体）。
 *   · 「你」对「您」：界面 18 比 3、法务 51 比 0。「您」只在「该玩法您的均分」和联系那一段里。
 * 所以统一成：简体「账号」、繁体「帳號」「信箱」（说的是邮件本身时用「郵件」）、全站「你」。
 *
 * **称呼后来翻过来了**：10-09 补充方案第一部分第 6 条，玩家答复「中文和法语全站统一用『您 / vous』；玩家那两句
 * 原话（『新账户登录成功……』、联系那段）里的字也跟着统一」。于是这道门量的是「不许有『你』」。法文本来就全是
 * vous（i18n 里没有一处 tu），不用动。两处例外，不算在「看得到的字」里：
 *   · api/_badwords.js——那是昵称的脏话词表，里面的「你」是被拦的词，不是对玩家说的话；
 *   · xhs/src/shareActions.ts 发笔记的那几句（标题「Slides小工具单局…分，你咧？」、正文「供你来玩～」）——那是玩
 *     家自己挑的 D 版原话，是发帖的人对看笔记的人说的，不是站点对玩家说话。
 *
 * 量法：把会被玩家看到的字所在的源文件挨个读出来，先挖掉注释（`//`、`/* *\/`、HTML 的 `<!-- -->`——模板
 * 字符串里的 HTML 注释进了 DOM 也看不见），剩下的里面一处都不许有下面这些词。管理员页（public/mint.html）
 * 也算「全站」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

/** 不许出现的词，和它该换成什么（只拿来写报错）。 */
const BANNED = [
  ['帐号', '账号'],
  ['帐户', '账号'],
  ['账户', '账号'],
  ['帳戶', '帳號'],
  ['賬號', '帳號'],
  ['賬戶', '帳號'],
  ['電子郵件', '信箱（说的是邮件本身就写「郵件」）'],
  ['郵箱', '信箱'],
  ['電郵', '信箱'],
  ['你', '您'],
  // 繁体（10-09 补充方案 7-14）：「裝置」一个说法；名词「紀錄」（「記錄」是动词，界面上没有要说「記錄」这个动作的
  // 地方）——只有「記錄商戶」（merchant of record）照它原来的写法。
  ['設備', '裝置'],
  [/記錄(?!商戶)/g, '紀錄（「記錄商戶」除外）'],
];

/** 玩家看得到的字住在这些地方。 */
function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}
const FILES = [
  ...walk(join(root, 'src'), (p) => /\.ts$/.test(p) && !/\.d\.ts$/.test(p)),
  ...walk(join(root, 'xhs/src'), (p) => /\.ts$/.test(p)),
  // 脏话词表不算：里面的「你」是被拦的词（见文件头）
  ...walk(join(root, 'api'), (p) => /\.js$/.test(p) && !/_badwords\.js$/.test(p)),
  join(root, 'index.html'),
  ...walk(join(root, 'public'), (p) => /\.html$/.test(p) && !/[\\/]xhs[\\/]/.test(p)),
];

/**
 * 挖掉注释。粗一点不要紧：挖多了只会漏报，不会把注释里的字当成界面上的字报出来。
 * 注释里的换行留着，报出来的行号就是源文件里的行号。
 */
const keepNewlines = (m) => m.replace(/[^\n]/g, '');
function stripComments(text, file) {
  let t = text.replace(/<!--[\s\S]*?-->/g, keepNewlines);
  if (/\.(ts|js)$/.test(file)) {
    t = t.replace(/\/\*[\s\S]*?\*\//g, keepNewlines);
    // 行尾注释：`//` 前面不是冒号（https://、http:// 那种留着）
    t = t.replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
  }
  return t;
}

// 尺子：读到了这几样，而且里面真有中文——空读一圈「一个都没找到」是假绿。
/** 发笔记的那几句原话（文件头说的例外）：挖掉再量，别的地方照量。 */
const NOTE_LINES = [/`Slides小工具单局\$\{score\}分，你咧？`/, /`Slides单局\$\{score\}分，你咧？`/, /'以及更多进阶玩法和布局供你来玩～'/];
const dropNotes = (t, f) => (/shareActions\.ts$/.test(f) ? NOTE_LINES.reduce((x, re) => x.replace(re, "''"), t) : t);
const texts = FILES.map((f) => ({ f, t: dropNotes(stripComments(readFileSync(f, 'utf8'), f), f) }));
{
  const raw = readFileSync(join(root, 'xhs/src/shareActions.ts'), 'utf8');
  check('（尺子）发笔记那三句原话还在原处（例外只认这三句，改了字就得回来改这儿）', NOTE_LINES.every((re) => re.test(raw)));
}
const hanCount = texts.reduce((n, { t }) => n + (t.match(/[一-鿿]/g) || []).length, 0);
check('（尺子）读到了界面、法务、邮件、管理员页的源码，而且里面有中文', FILES.length >= 40 && hanCount > 5000,
  `${FILES.length} 个文件，${hanCount} 个汉字`);
for (const must of ['src/i18n.ts', 'src/legal.ts', 'api/email.js', 'api/signin.js', 'public/mint.html']) {
  check(`（尺子）${must} 在扫的范围里`, FILES.some((f) => relative(root, f).replace(/\\/g, '/') === must));
}

for (const [bad, good] of BANNED) {
  const hits = [];
  for (const { f, t } of texts) {
    // 一条规矩可以是一个词，也可以是一条正则（要带例外的那种，比如「記錄商戶」）。
    const at = typeof bad === 'string'
      ? (() => { const out = []; let i = t.indexOf(bad); while (i >= 0) { out.push([i, bad.length]); i = t.indexOf(bad, i + 1); } return out; })()
      : [...t.matchAll(bad)].map((m) => [m.index, m[0].length]);
    for (const [i, len] of at) {
      const line = t.slice(0, i).split('\n').length;
      hits.push(`${relative(root, f)}:${line}「…${t.slice(Math.max(0, i - 8), i + len + 8).replace(/\s+/g, ' ')}…」`);
    }
  }
  const name = typeof bad === 'string' ? bad : '記錄';
  check(`没有「${name}」（统一成「${good}」）`, hits.length === 0, hits.slice(0, 4).join(' ｜ ') + (hits.length > 4 ? ` …共 ${hits.length} 处` : ''));
}
// 反向对照：「記錄商戶」那个例外真的放过了、别的「記錄」真的抓得到。
{
  const re = BANNED.find(([b]) => b instanceof RegExp)[0];
  check('（反向对照）「記錄商戶」放过，「您的記錄」抓到',
    [...'Creem 是記錄商戶'.matchAll(re)].length === 0 && [...'您自己的記錄裡還在'.matchAll(re)].length === 1);
}

// 反向对照：挖注释那一步没把字符串里的字一起挖掉——拿一句带注释的样本量
{
  const sample = "const a = '新帐号'; // 这一句注释里的帐号不算\n/* 帐号 */ const b = `<!-- 帐号 -->${'你'}`;";
  const left = stripComments(sample, 'x.ts');
  check('（反向对照）字符串里的「帐号」「你」挖完注释还在，注释里的没了',
    left.includes("'新帐号'") && left.includes("'你'") && (left.match(/帐号/g) || []).length === 1, JSON.stringify(left));
}

console.log(fail ? `\n${fail} 条红` : '\nALL PASS');
process.exit(fail ? 1 : 0);
