/**
 * `.env.example` 和 `api/` 真读的那些环境变量，必须对得上。
 *
 *   node scripts/check-env-example.mjs
 *
 * ── 为什么要一道门守一份模板 ────────────────────────────────────
 *
 * `.env` 是 gitignore 的，生产值填在 Vercel 后台。所以 `.env.example` 是**唯一**一份「这个
 * 项目要配哪几样」的清单——配漏一样的后果写在 CLAUDE.md 里，每一条都真的发生过：
 *
 *   · 少 `KV_REST_API_*` → 小屋和兑换码报「这个功能还没开」。
 *   · 只填了 `RESEND_API_KEY`、漏了 `MAIL_FROM` → 忘记密码那一屏说「目前还无法自动寄信」。
 *   · 换了 Creem 密钥没换商品 id → `/api/checkout` 答 502，玩家看到「服务器出了点问题」。
 *     （网站挂着测试密钥去申请审核，被拒的理由正是「the subscription checkout does not
 *     complete when selected」。）
 *
 * 而 `GENIUS_GRANT_WINDOW` 这一条**从来就没写进模板**：它决定「登录即送终身天才」开不开，
 * 而界面上那句「注册后免费立即解锁全部内容」是写死在 i18n 里的。模板里没有它，新开一份部
 * 署就默认是关的，于是玩家照着那句承诺去登录，登得进、却不是天才，**屏幕上什么都不报**。
 * 这正是这道门最先要钉住的那一条。
 *
 * ── 量的是什么 ──────────────────────────────────────────────────
 *
 *   ① `api/` 里 `process.env.X` 读到的每一个名字，模板里都要出现（注掉的后备名字也算）。
 *   ② 反过来：模板里每个**没注掉**的赋值行，都得真的有人读——不然是一条误导人的清单。
 *   ③ 几个有名的坑各钉一条：Creem 那三个要一起在、Resend 那两个要一起在、
 *      `GENIUS_GRANT_WINDOW` 要在而且默认写成 1。
 *   ④ 模板里**不许有真值**：除了 `GENIUS_GRANT_WINDOW=1` 这一个开关，别的赋值行右边必须
 *      是空的。一份带着真密钥的模板提交进来，就是把密钥提交进了仓库。
 *
 * 白名单只有一个：`ALLOW_MEMORY_STORE`（它是本地/测试用的开关，`scripts/dev-server.mjs`
 * 自己设，不该出现在部署的清单里）。
 */
import { readFileSync, readdirSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const root = new URL('..', import.meta.url);
const example = readFileSync(new URL('.env.example', root), 'utf8');

/** 模板里的名字：`X=` 这种（生效的），和 `# X=` 这种（注掉的后备 / 备忘）。 */
const assigned = new Set();
const commented = new Set();
for (const line of example.split('\n')) {
  const live = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (live) {
    assigned.add(live[1]);
    continue;
  }
  const off = /^#\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim());
  if (off) commented.add(off[1]);
}
const listed = new Set([...assigned, ...commented]);

/** `api/` 真读的那些名字。 */
const read = new Set();
for (const file of readdirSync(new URL('api/', root))) {
  if (!file.endsWith('.js')) continue;
  const src = readFileSync(new URL('api/' + file, root), 'utf8');
  for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) read.add(m[1]);
}

/** 本地/测试用的开关，不该进部署清单。 */
const LOCAL_ONLY = new Set(['ALLOW_MEMORY_STORE']);

// ── ① api/ 读的，模板里都要有 ──────────────────────────────────
{
  const missing = [...read].filter((n) => !LOCAL_ONLY.has(n) && !listed.has(n)).sort();
  check('① api/ 读到的每个名字模板里都有', missing.length === 0, missing.join(' ') || `共 ${read.size} 个`);
  check('① 本地开关没混进模板', [...LOCAL_ONLY].every((n) => !listed.has(n)),
    [...LOCAL_ONLY].filter((n) => listed.has(n)).join(' '));
}

// ── ② 模板里生效的那些，都得真有人读 ──────────────────────────
{
  const orphan = [...assigned].filter((n) => !read.has(n)).sort();
  check('② 模板里每个生效的名字都真的有人读', orphan.length === 0,
    orphan.join(' ') || `共 ${assigned.size} 个`);
}

// ── ③ 几个有名的坑 ────────────────────────────────────────────
{
  const CREEM = ['CREEM_API_KEY', 'CREEM_PRODUCT_MONTHLY', 'CREEM_PRODUCT_YEARLY'];
  check('③ Creem 那三个一起在（只换密钥不换商品 id 咬过一次）',
    CREEM.every((n) => assigned.has(n)), CREEM.filter((n) => !assigned.has(n)).join(' '));
  const MAIL = ['RESEND_API_KEY', 'MAIL_FROM'];
  check('③ Resend 那两个一起在（只填密钥漏了 MAIL_FROM 踩过一次）',
    MAIL.every((n) => assigned.has(n)), MAIL.filter((n) => !assigned.has(n)).join(' '));
  check('③ 两个 KV 的在', ['KV_REST_API_URL', 'KV_REST_API_TOKEN'].every((n) => assigned.has(n)));
  check('③ ADMIN_TOKEN 在，而且旁边写着「至少 32 个随机字符」',
    assigned.has('ADMIN_TOKEN') && /至少\s*32/.test(example));

  check('③ GENIUS_GRANT_WINDOW 在模板里', assigned.has('GENIUS_GRANT_WINDOW'));
  check('③ 而且默认就写成 1（界面上那句承诺是写死的，关着就成了假话）',
    /^GENIUS_GRANT_WINDOW=1$/m.test(example));
  // 这一条钉的是**那段警告还在**：关它之前必须先改那句文案。注释一删，下一个人只会看到
  // 一个看着无害的开关。
  check('③ 旁边那段「关掉它会让界面上那句话变成假话」还在',
    /关掉它会让界面上那句话变成假话/.test(example));
}

// ── ④ 模板里不许有真值 ────────────────────────────────────────
{
  const WITH_VALUE_OK = new Set(['GENIUS_GRANT_WINDOW']);
  const filled = [];
  for (const line of example.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line.trim());
    if (m && !WITH_VALUE_OK.has(m[1])) filled.push(`${m[1]}=${m[2].slice(0, 8)}…`);
  }
  check('④ 除了那个开关，所有赋值行右边都是空的（模板里带真密钥等于提交密钥）',
    filled.length === 0, filled.join(' '));
}

// ── 反向对照：每一条都要量得出坏 ───────────────────────────────
//
// 判定上面是直接写在流程里的，所以这儿把那四类改坏各做一遍、重跑一遍同一套判定。做法是把
// 判定抽成一个只收「模板文本 + 读到的名字集合」的纯函数——和上面那几节用的是同一套规则。
function judge(text, reads) {
  const live = new Set();
  const off = new Set();
  for (const line of text.split('\n')) {
    const l = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (l) { live.add(l[1]); continue; }
    const c = /^#\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (c) off.add(c[1]);
  }
  const all = new Set([...live, ...off]);
  const bad = [];
  if ([...reads].some((n) => !LOCAL_ONLY.has(n) && !all.has(n))) bad.push('missing');
  if ([...live].some((n) => !reads.has(n))) bad.push('orphan');
  if (!/^GENIUS_GRANT_WINDOW=1$/m.test(text)) bad.push('grantOn');
  if (!/关掉它会让界面上那句话变成假话/.test(text)) bad.push('grantWarning');
  for (const line of text.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line.trim());
    if (m && m[1] !== 'GENIUS_GRANT_WINDOW') { bad.push('secretInTemplate'); break; }
  }
  return bad;
}

const CONTROLS = [
  ['删掉 GENIUS_GRANT_WINDOW 那一行', 'missing',
    (t) => t.replace(/^GENIUS_GRANT_WINDOW=1$/m, '')],
  ['把它默认改成关', 'grantOn',
    (t) => t.replace(/^GENIUS_GRANT_WINDOW=1$/m, 'GENIUS_GRANT_WINDOW=0')],
  ['把那段警告删掉', 'grantWarning',
    (t) => t.replace(/关掉它会让界面上那句话变成假话/, '可以随便关')],
  ['模板里多一个没人读的名字', 'orphan',
    (t) => t + '\nSOME_UNUSED_THING=\n'],
  ['模板里填了一个真值（等于把密钥提交进来）', 'secretInTemplate',
    (t) => t.replace(/^ADMIN_TOKEN=$/m, 'ADMIN_TOKEN=1234567890abcdef1234567890abcdef')],
];

{
  const clean = judge(example, read);
  check('（尺子）真模板这一套判定全过', clean.length === 0, clean.join(' '));
  for (const [name, want, fn] of CONTROLS) {
    const broken = fn(example);
    if (broken === example) {
      check(`反向对照：${name}`, false, '没改动任何东西（对照本身失效了）');
      continue;
    }
    const bad = judge(broken, read);
    check(`反向对照：${name} → 要红在 ${want}`, bad.includes(want),
      bad.length ? `实际红了：${bad.join(' ')}` : '实际全绿（空绿）');
  }
}

// ⑤ 两样会带凭据的东西不许进仓库：.vercel/（vercel link / pull 写的项目 id、拉下来的环境变量）和 .npmrc（npm 的
//    _authToken）。.gitignore 里要有它们，而且此刻仓库里一个都没被跟踪（10-08 方案第五批第 8 条）。
{
  const { execFileSync } = await import('node:child_process');
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  for (const name of ['.vercel', '.npmrc']) {
    check(`⑤ .gitignore 里有 ${name}`, ignore.includes(name) || ignore.includes(name + '/'));
  }
  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files', '--', '.vercel', '.npmrc', '**/.npmrc'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
    }).trim();
  } catch {
    tracked = '（git ls-files 跑不起来）';
  }
  check('⑤ 仓库里没有被跟踪的 .vercel/ 或 .npmrc', tracked === '', tracked);
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
