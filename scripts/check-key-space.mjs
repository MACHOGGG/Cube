/**
 * 三种账号 id 的键空间永不相交。
 *
 *   node scripts/check-key-space.mjs
 *
 * 纯 node，不连任何东西：只算 key。
 *
 * ── 为什么值得单独一道门 ────────────────────────────────────
 *
 * 账号都住在 `acct:<id>` 底下（`_accounts.js` 的 accountKey），而 id 有三种来路：
 *
 *   · 邮箱                  —— `acct:someone@example.com`
 *   · 还没绑邮箱的内部码     —— `acct:code:ABC123`（`codeHolder`，全大写）
 *   · 免邮箱凭据（E38）      —— `acct:hdl:<sha256>`（`pairKey`）
 *
 * 两种撞法都是**静默**的，而且后果是「两个人共用一个账号」：
 *
 *   ① 有人注册一个第一串，算出来的 key 恰好等于某个邮箱或某张码的 key；
 *   ② 有人把邮箱填成 `code:ABC123` 或 `hdl:...` 这样的字符串，去冒认别人的账号。
 *
 * ② 不是假想：`EMAIL_RE` 只要求「有个 @、有个点」，而 `codeHolder` 把输入**转成大写**、
 * `pairKey` 的输出**只有小写 hex**——这几条加起来才让三者分得开。门把这几条钉住，因为
 * 它们分散在三个函数里，任何一处「顺手」改一下（比如让 codeHolder 不再转大写）就会开一
 * 条缝，而屏幕上什么都不报。
 */
import { codeHolder, pairKey, normalizeEmail, PAIR_KEY_RE, EMAIL_RE, accountId } from '../api/_accounts.js';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 账号真正落地的那把 key（和 _accounts.js 的 accountKey 同一条规矩）。 */
const acct = (id) => 'acct:' + normalizeEmail(id);

const EMAILS = ['someone@example.com', 'A.B+tag@Example.COM', 'hdl@example.com', 'code@example.com'];
const CODES = ['ABC123', 'abc123', 'seed01'];
const FIRSTS = ['Abc12345', 'abc12345', 'ABC12345', 'hdl12345', 'code1234'];

const keys = [
  ...EMAILS.map((e) => ['邮箱', e, acct(e)]),
  ...CODES.map((c) => ['内部码', c, acct(codeHolder(c))]),
  ...FIRSTS.map((f) => ['免邮箱', f, acct(pairKey(f))]),
];

// ── 一个 key 都不许重复 ───────────────────────────────────────
{
  const seen = new Map();
  const clash = [];
  for (const [kind, raw, k] of keys) {
    if (seen.has(k)) clash.push(`${k} ← ${seen.get(k)} 和 ${kind}:${raw}`);
    else seen.set(k, `${kind}:${raw}`);
  }
  // 'ABC123' 和 'abc123' 这两张码**本来就该**是同一个（codeHolder 转大写，码不分大小
  // 写），所以这里算的是「去掉那一对之后」还有没有重复。
  const expected = 1;
  check('（尺子）数得到那一对本来就该相同的（两张只差大小写的码）', clash.length === expected,
    `${clash.length} 处：${clash.join(' | ')}`);
  check('除那一对之外，三种 id 的 key 两两不同', clash.length <= expected);
  check('（尺子）确实算了十二把 key（不是数组空的）', keys.length === 12, String(keys.length));
}

// ── 三种 id 的形状互相排斥 ────────────────────────────────────
{
  for (const f of FIRSTS) {
    const k = pairKey(f);
    check(`免邮箱 id「${f}」只含 hdl: 和小写 hex`, PAIR_KEY_RE.test(k), k.slice(0, 20));
    check(`免邮箱 id「${f}」不是合法邮箱（EMAIL_RE 不认）`, !EMAIL_RE.test(k));
    check(`免邮箱 id「${f}」不以 code: 开头`, !k.startsWith('code:'));
  }
  for (const c of CODES) {
    const k = codeHolder(c);
    check(`内部码 id「${c}」转成了大写`, k === k.toUpperCase().replace('CODE:', 'code:'), k);
    check(`内部码 id「${c}」不符合 hdl: 的形状`, !PAIR_KEY_RE.test(k));
    check(`内部码 id「${c}」不是合法邮箱`, !EMAIL_RE.test(k));
  }
}

// ── 反过来：拿别人的形状当邮箱填进来，冒认不了 ──────────────
{
  // `pairKey` 的输出进了 `acct:` 之后长这样。有人把它当邮箱填进来呢？
  const impostor = pairKey('Abc12345');
  check('拿一个 hdl: id 当邮箱填 → EMAIL_RE 不收', !EMAIL_RE.test(impostor), impostor.slice(0, 20));
  check('拿一张 code: id 当邮箱填 → EMAIL_RE 不收', !EMAIL_RE.test(codeHolder('ABC123')));
  // 而 accountId 认两种形状——它是那两处闸用的（passcode 的 bind、redeem 认登录）。
  check('accountId 认邮箱', accountId('someone@example.com'));
  check('accountId 认 hdl: id', accountId(impostor));
  check('accountId 不认 code: id（那不是一个人，是一张码的寄存处）', !accountId(codeHolder('ABC123')));
  check('accountId 不认瞎编的串', !accountId('whatever') && !accountId('hdl:tooshort'));
}

// ── 带 @ 的第一串怎么办 ───────────────────────────────────────
{
  // PAIR_RE 只收字母数字，所以这种串连注册那一步都过不去。顺手确认一下：哪天有人放宽
  // PAIR_RE，这条会提醒他 pairKey 的输出照旧安全（sha256 吃什么都吐 hex）。
  const weird = pairKey('someone@example.com');
  check('就算拿一个邮箱去算 pairKey，出来的也还是 hdl: 形状', PAIR_KEY_RE.test(weird));
  check('而且它和那个邮箱自己的 key 不是一个', acct(weird) !== acct('someone@example.com'));
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
