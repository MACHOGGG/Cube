/**
 * 运维日志里不许躺着玩家的邮箱。
 *
 *   node scripts/check-log-redact.mjs
 *
 * ── 为什么 ────────────────────────────────────────────────────
 *
 * `_accounts.js` 里四处「名单没删掉 / 名单没记上」、`updateAccount` 那句「锁忙」、`mint.js`
 * 的「这张码撤不回去了」——2026-10-02 之前全都把邮箱原文（或者码原文）直接 `console.error`
 * 出去。平时没人看，可那份日志在 Vercel 后台留 30 天、任何拿到那个项目读权限的人都翻得到，
 * 而**我们从来没向玩家承诺过「你的邮箱会出现在运维日志里」**：隐私条款写的是「只存这几个字
 * 段」，日志这一份不在那张清单上。一条和实际行为不符的隐私陈述，支付审核按 false
 * information 算（CLAUDE.md 那条）。
 *
 * 更实际的一面：这些 `console.error` 恰好都挂在**出错**的那条路上，而出错的时候人是最可能
 * 把整段日志贴进工单、贴进对话、贴进 issue 的。一次手滑就是一串真实邮箱外泄。
 *
 * 改法见 `api/_redact.js`：sha256 的前 12 位。对账够用（同一个人在两分钟里报三条错，看得出
 * 是同一个人），而外人从 12 个十六进制字符里拿不回邮箱。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 *   ① `redact()` 本身：确定、12 位十六进制、不同输入不同桶、**输出里不含输入**。
 *   ② `api/` 里每一句 `console.*`，参数里不许出现裸的身份变量——除非它套在 `redact()` 里。
 *   ③ 那**一处有意的例外**还在：`redeem.js` 的 `giveBack` 仍然写码的原文，旁边那段写明理由
 *      的注释也还在。哪天有人「顺手」把它也改成指纹，这一条当场红——他就会先读到那段话。
 *
 * 读源码，不打包、不起服务器。②③ 各配一条反向对照。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { redact } from '../api/_redact.js';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① redact() 本身 ────────────────────────────────────────────
{
  const a = 'someone@example.com';
  check('① 同一个输入永远同一个指纹', redact(a) === redact(a), redact(a));
  check('① 12 位小写十六进制', /^[0-9a-f]{12}$/.test(redact(a)), redact(a));
  check('① 两个不同的邮箱不是同一个指纹', redact(a) !== redact('other@example.com'));
  check('① 只差一个字母也不是同一个', redact(a) !== redact('someone@example.cop'));
  // 要害那一条：输出里不许留下输入的任何一截。打星号那种写法（a***@gmail.com）正好相反
  // ——它把最有用的两样（首字母、域名）原样留着。
  check('① 指纹里不含邮箱的任何一截',
    !redact(a).includes('someone') && !redact(a).includes('example') && !redact(a).includes('@'));
  check('① 空值不返回空字符串（日志里要看得出「这儿本来有东西」）',
    redact('') === '(空)' && redact(undefined) === '(空)' && redact(null) === '(空)');
  // 和账号 key 不是一回事，别互相替用：那一个是 sha256 全长、带 hdl: 前缀。
  check('① 不是 pairKey 那种（长度就不一样）', redact(a).length === 12);
}

/** 注释先剥掉：注释里出现 email 不算问题，而不剥的话 ② 会把说明文字当成代码。 */
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.replace(/\s\/\/.*$/, ''))
    .join('\n');

/** 把一份源码里所有 `console.x(...)` 的参数文本取出来（配对括号，容得下跨行）。 */
function consoleCalls(src) {
  const out = [];
  const re = /console\.\w+\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    out.push(src.slice(from, i - 1));
  }
  return out;
}

/** 这些名字在 api/ 里装的都是一个人的地址。`ticket`（码）不在里面——见 ③。 */
const IDENTITY = ['email', 'address', 'wanted', 'who'];

/** 判一份源码：返回「裸着出现在 console 里」的那几处。 */
function judge(name, src) {
  const bad = [];
  for (const args of consoleCalls(strip(src))) {
    // 把 redact(...) 整个挖掉再看——套在里面的就不算裸着。
    const naked = args.replace(/redact\([^()]*\)/g, '');
    for (const id of IDENTITY) {
      if (new RegExp(`\\b${id}\\b`).test(naked)) bad.push(`${name}: console(…${id}…)`);
    }
  }
  return bad;
}

// ── ② api/ 里每一句 console ────────────────────────────────────
const dir = new URL('../api/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
{
  const bad = [];
  let calls = 0;
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    calls += consoleCalls(strip(src)).length;
    bad.push(...judge(f, src));
  }
  check(`② api/ 里 ${calls} 句 console，没有一句裸着写身份`, bad.length === 0,
    bad.join(' / ') || `扫了 ${files.length} 个文件`);
  // 尺子：别让「扫了 0 句」当成绿。
  check('（尺子）真的扫到了 console 调用', calls > 5, `${calls} 句`);
  // 尺子：redact 真的在用，不是全靠「没人写日志」混过去的。
  const using = files.filter((f) => readFileSync(new URL(f, dir), 'utf8').includes('redact('));
  check('（尺子）redact 真的被几个文件用着', using.length >= 3, using.join(' '));
}

// ── ③ 那一处有意的例外 ────────────────────────────────────────
{
  const redeem = readFileSync(new URL('redeem.js', dir), 'utf8');
  check("③ redeem 的 giveBack 仍然写码的原文（那是唯一还能把它补给玩家的东西）",
    /console\.error\('兑换码放不回去了', ticket, err\);/.test(redeem));
  check('③ 旁边那段写明理由的注释还在（不读它的人会以为这是个疏漏）',
    /这一行有意写码的原文/.test(redeem));
  check('③ `_redact.js` 里也记着这件事（两头都写，少一头就会有人去「修」）',
    /兑换码那一处例外/.test(readFileSync(new URL('_redact.js', dir), 'utf8')));
  // 而同一个文件里另一句（兑换记录没写上）是指纹——两句挨着，正好说明「不是忘了改」。
  check('③ 同一个文件里另一句是指纹（说明那一处不是漏改的）',
    /console\.error\('兑换记录没写上（权益已经到账，不影响玩家）', redact\(ticket\), err\);/.test(redeem));
}

// ── 反向对照 ───────────────────────────────────────────────────
{
  const accounts = readFileSync(new URL('_accounts.js', dir), 'utf8');
  const CONTROLS = [
    ['在 _accounts.js 里加一句裸写邮箱的日志', true,
      () => judge('_accounts.js', accounts.replace(
        "export const loadAccount = (email) => get(accountKey(email));",
        "export const loadAccount = (email) => { console.error('读账号', email); return get(accountKey(email)); };",
      ))],
    ['把某一处的 redact() 去掉', true,
      () => judge('_accounts.js', accounts.replace("console.error('名单没删掉', redact(email), err);",
        "console.error('名单没删掉', email, err);"))],
    ['跨行写的 console 也要抓得住', true,
      () => judge('_accounts.js', accounts.replace("export const loadAccount = (email) => get(accountKey(email));",
        "export const loadAccount = (email) => {\n  console.error(\n    '读账号',\n    email,\n  );\n  return get(accountKey(email));\n};"))],
    ['套在 redact 里就不算（这一条必须**不**红）', false,
      () => judge('_accounts.js', accounts.replace("export const loadAccount = (email) => get(accountKey(email));",
        "export const loadAccount = (email) => { console.error('读账号', redact(email)); return get(accountKey(email)); };"))],
  ];
  for (const [name, wantRed, run] of CONTROLS) {
    const bad = run();
    check(`反向对照：${name}`, wantRed ? bad.length > 0 : bad.length === 0,
      bad.length ? bad.join(' / ') : '没抓到');
  }
  // ③ 的反向对照：把那一处例外也改成指纹，③ 的第一条就该红。
  const redeem = readFileSync(new URL('redeem.js', dir), 'utf8');
  const fixed = redeem.replace("console.error('兑换码放不回去了', ticket, err);",
    "console.error('兑换码放不回去了', redact(ticket), err);");
  check('反向对照：有人把那一处例外也「修」成指纹 → ③ 要红',
    fixed !== redeem && !/console\.error\('兑换码放不回去了', ticket, err\);/.test(fixed));
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
