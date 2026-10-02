/**
 * 终身授予那一句挂在哪儿——位置本身就是正确性。
 *
 *   node scripts/check-grant-callsite.mjs
 *
 * 不起服务器、不打包：读 `api/subscription.js` 的**源码**。理由是这一句的四个要害全
 * 在「它写在第几行」上，而每一个写错了都**不报错**：
 *
 *   ① 没 import 就用 —— `/api/subscription` 运行时 `ReferenceError`。那是登录接口，
 *      挂了就是**全站登不进去**，而本地 `node --check` 过得去（自由变量不是语法错）、
 *      `npm run typecheck` 也管不到 api/（纯 .js，不过 tsc）。
 *   ② 排在 `resolveEntitlement` **后面** —— 权益先算完再写授予，这一次登录屏幕上还是
 *      「不是天才」，要等下一次启动才认。玩家会以为没生效。
 *   ③ 身份那道闸没了、或者排在授予后面 —— 身份还没证明就送权益。邮箱地址本身不是证
 *      据，它印在收据上，谁都知道得到（CLAUDE.md 那条铁律）。
 *
 *      ⚠️ 这一条 2026-10-02 改过形状：从前那一句写成 `if (account && issued) account =
 *      await grant…`，守卫是**行内的那个 `issued`**，而 `issued` 是「密码验过了」的产
 *      物。密码那一支随 E37 撤了，现在这一路只认登录令牌，守卫也跟着变成**一道提前返
 *      回**（`if (!tokenValid(account, token)) return send(res, 401, …)`）。所以这道门
 *      现在量的是「授予那一句排在那道闸的后面」，而不再是「那一句里有没有 issued」——
 *      照旧量的是同一件事：**走到那一行时身份必须已经成立**。
 *   ④ 不把结果赋回 `account` —— 库里写进去了，可手上这份还是旧的，`resolveEntitlement`
 *      照旧答「不是天才」。症状和 ② 一模一样，而且更难看出来。
 *
 * 所以这道门不量行为，量**那一句在源码里的位置和形状**。
 *
 * 下面每一条都配了反向对照：把源码按那一条的反面改坏一次，这道门必须跟着红。空绿是
 * 这个仓库最常犯的病，一条量不出坏的断言比没有断言更糟。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const SRC_PATH = 'api/subscription.js';
const GRANT = 'grantLifetimeIfWindow';

/**
 * 注释先剥掉。不剥的话「在注释里写一句 issued」就能把守卫那一条骗过去——而注释骗得过
 * 的断言，等于没有断言。
 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/**
 * 判这一份源码的四条，返回红了的那几条的名字。
 *
 * 做成纯函数是为了下面那一排反向对照：同一套判定喂改坏的源码，必须红。
 */
function judge(raw) {
  const src = strip(raw);
  const bad = [];

  // ① import 里有它。认的是「从 _entitlement.js 那一行里带着它」，不是「全文出现过」
  //    ——全文出现过的话调用自己就算，那条断言就成了永远真。
  const impLine = src
    .split('\n')
    .find((l) => l.includes('_entitlement.js') && l.trimStart().startsWith('import'));
  if (!impLine || !impLine.includes(GRANT)) bad.push('imported');

  // ② 调用恰好一处（import 那一行不算）。
  const callLines = src
    .split('\n')
    .filter((l) => l.includes(`${GRANT}(`) && !l.trimStart().startsWith('import'));
  if (callLines.length !== 1) bad.push(`callOnce(${callLines.length})`);

  const call = callLines[0] ?? '';
  const at = (needle) => src.indexOf(needle);
  const callAt = call ? src.indexOf(call) : -1;

  // ③ 排在 resolveEntitlement 之前。
  const resolveAt = at('await resolveEntitlement(');
  if (callAt < 0 || resolveAt < 0 || callAt > resolveAt) bad.push('beforeResolve');

  // ④ 那道身份闸还在。认的是**整句**，不是「出现过 tokenValid」：换成 `if (!token)`
  //    这种「只看带没带」的写法，形状上还很像，可它谁都放进来。
  const guardAt = at("if (!tokenValid(account, token)) return send(res, 401");
  if (guardAt < 0) bad.push('proofGuard');

  // ⑤ 结果赋回 account，不然手上这份还是旧的。
  if (!/\baccount\s*=\s*await\s+grantLifetimeIfWindow\(/.test(call)) bad.push('assignedBack');

  // ⑥ 排在那道闸后面。挪到 loadAccount 边上虽然 ③⑤ 都还成立，身份却还没证明。
  if (guardAt < 0 || callAt < guardAt) bad.push('afterProof');

  return bad;
}

const real = readFileSync(SRC_PATH, 'utf8');

// —— 正向：真源码五条全过 ————————————————————————————————
const got = judge(real);
check(`${SRC_PATH}：那一句的位置和形状`, got.length === 0, got.length ? `红了：${got.join(' ')}` : '');

// —— 反向对照：每一条都要量得出坏 ——————————————————————————
/** 把源码按某一条的反面改坏一次，返回改坏的那一份（改不动就抛，免得对照变成空绿）。 */
const sabotage = (name, fn) => {
  const broken = fn(real);
  if (broken === real) throw new Error(`反向对照「${name}」没改动任何东西`);
  return broken;
};

const CONTROLS = [
  [
    '去掉 import 里的它',
    'imported',
    (s) => s.replace(`{ ${GRANT}, resolveEntitlement }`, '{ resolveEntitlement }'),
  ],
  [
    '删掉那一句调用',
    'callOnce(0)',
    (s) => s.replace(/^.*account = await grantLifetimeIfWindow\(.*\n/m, ''),
  ],
  [
    '同一句写两遍',
    'callOnce(2)',
    (s) =>
      s.replace(
        /^(.*account = await grantLifetimeIfWindow\(.*)\n/m,
        '$1\n$1\n',
      ),
  ],
  [
    '挪到 resolveEntitlement 后面',
    'beforeResolve',
    (s) => {
      const line = /^.*account = await grantLifetimeIfWindow\(.*\n/m.exec(s)[0];
      return s
        .replace(line, '')
        .replace(
          /^(\s*const \{ status, body \} = await resolveEntitlement\(.*\n)/m,
          `$1${line}`,
        );
    },
  ],
  [
    // 真实的写错法：以为「带了令牌」就等于「令牌是对的」。
    '把那道闸换成只看带没带令牌',
    'proofGuard',
    (s) =>
      s.replace(
        "if (!tokenValid(account, token)) return send(res, 401",
        "if (!token) return send(res, 401",
      ),
  ],
  [
    '不把结果赋回 account',
    'assignedBack',
    (s) =>
      s.replace(
        'account = await grantLifetimeIfWindow(',
        'await grantLifetimeIfWindow(',
      ),
  ],
  [
    '挪到身份证明之前（loadAccount 边上）',
    'afterProof',
    (s) => {
      const line = /^.*account = await grantLifetimeIfWindow\(.*\n/m.exec(s)[0];
      return s
        .replace(line, '')
        .replace(/^(\s*let account = await loadAccount\(address\);\n)/m, `$1${line}`);
    },
  ],
];

for (const [name, want, fn] of CONTROLS) {
  let bad;
  try {
    bad = judge(sabotage(name, fn));
  } catch (err) {
    check(`反向对照：${name}`, false, String(err.message));
    continue;
  }
  check(
    `反向对照：${name} → 要红在 ${want}`,
    bad.includes(want),
    bad.length ? `实际红了：${bad.join(' ')}` : '实际全绿（空绿）',
  );
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
