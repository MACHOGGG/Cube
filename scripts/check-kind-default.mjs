/**
 * 缺 `kind` 字段的老账号，不许被判成刷卡用户。
 *
 *   node scripts/check-kind-default.mjs
 *
 * 不起服务器、不连 Redis、不真去问 Creem：账户库用进程内那份（ALLOW_MEMORY_STORE=1），
 * Creem 一次都不问（这道门整个跑在「Creem 没配」那一侧，而那正是要紧的那一侧）。
 *
 * ── 盯的是什么 ──────────────────────────────────────────────
 *
 * 账号上那个 `kind` 回答的是「权益记在谁家」：
 *
 *   'code' —— 记在我们自己库里（`account.until`）。
 *   'card' —— 记在 Creem 那边，我们本地**没有**副本，每次都得去问。
 *
 * 所以 Creem 没配的时候，这两种的答案天差地别：'code' 照实答（库里就有），'card'
 * 答 **503 notConfigured**——而 503 不带令牌，那个人登不进自己的账号
 * （见 api/subscription.js 末尾那一段：`status === 200 && account && issued` 才发令牌）。
 *
 * 2026-10 之后这不再是个边角：Creem 的三个环境变量清掉之后 `creemConfigured()` 永远
 * 是假，上面那一支就是**每一次登录都要走**的那一支。
 *
 * 于是「一个账号到底算哪种」这件事变得要命，而从前有两处把它判错：
 *
 *   ① `api/passcode.js` 的 change：`newAccount(..., account.kind || 'card')`。
 *      这是全站唯一一条不要任何付款凭据就能造出 'card' 账号的路。一个**没有 `kind`
 *      字段的老账号**，改一次密码就被打成刷卡用户——他做的只是改了个密码。
 *   ② `api/_entitlement.js` 两处判据写的是 `kind === 'code'`，而缺 `kind` 的老账号
 *      既不是 'code' 也不是 'card'，于是落在 503 那一侧。
 *
 * 两处错的是同一件事：把「不是 card」和「等于 code」当成了一回事。两处都改成只排除
 * 'card'。
 *
 * ── 怎么证明它量得出坏 ─────────────────────────────────────
 *
 * 下面那条反向尺子是**在内存里把源码改回去**（`!== 'card'` 还原成 `=== 'code'`）、写一
 * 份临时模块再 import 进来跑，所以它永远不过期。写成 `git show HEAD:…` 的话，这次一提
 * 交 HEAD 就是修好的那一版，对照当场变成空绿。
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

process.env.ALLOW_MEMORY_STORE = '1';
// 这道门整个跑在「Creem 没配」那一侧。**删掉而不是假设它没设**——机器上真有这个变量
// 的时候，整道门会安安静静地走另一条分支，一条断言都量不出东西。
delete process.env.CREEM_API_KEY;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① 源码：那个 'card' 兜底没了 ───────────────────────────────
{
  const pass = readFileSync(new URL('../api/passcode.js', import.meta.url), 'utf8');
  check("passcode.js 里不再有 `|| 'card'` 这个兜底", !pass.includes("|| 'card'"));
  // 尺子：那一行还在，而且兜底换成了 'code'。少了这一条，上面那句在「有人把整行删
  // 掉了」的时候也会绿。
  check("（尺子）兜底换成了 'code'，不是整行没了",
    /newAccount\(String\(newPassword\), account\.kind \|\| 'code'\)/.test(pass));
}

// ── 真跑一遍 resolveEntitlement ────────────────────────────────
const { saveAccount, issueToken } = await import('../api/_accounts.js');
const { resolveEntitlement } = await import('../api/_entitlement.js');
const { configured: creemConfigured } = await import('../api/_creem.js');

// 尺子：确认我们真的站在「Creem 没配」那一侧。前提没成立而断言还在跑，那叫空绿。
check('（尺子）这道门跑在「Creem 没配」那一侧', creemConfigured() === false);

/** 一个 2026 年之前开的老账号：有令牌、有到期日，**没有 `kind` 字段**。 */
const OLD = 'old-account@example.com';
const OLD_ACCOUNT = { token: 'TOKEN-OF-THE-OLD-ACCOUNT', until: 0, tokens: [] };
/** 一个真的刷卡订阅户：权益在 Creem 那边，所以本地 until 是 0。 */
const CARD = 'card-holder@example.com';
const CARD_ACCOUNT = { kind: 'card', token: 'TOKEN-OF-THE-CARD-HOLDER', until: 0, tokens: [] };
/** 一个内部码账号，当对照用。 */
const CODE = 'code-holder@example.com';
const CODE_ACCOUNT = { kind: 'code', token: 'TOKEN-OF-THE-CODE-HOLDER', until: 0, tokens: [] };

for (const [mail, acc] of [[OLD, OLD_ACCOUNT], [CARD, CARD_ACCOUNT], [CODE, CODE_ACCOUNT]]) {
  await saveAccount(mail, acc);
}

const ask = (mail, acc) => resolveEntitlement(mail, acc, acc.token);

{
  const old = await ask(OLD, OLD_ACCOUNT);
  check('② 缺 kind 的老账号：照实答，不是 503', old.status === 200, `status=${old.status} ${JSON.stringify(old.body)}`);
  check('② 而且令牌给回去了（不给就是登不进去）', old.body?.token === OLD_ACCOUNT.token, String(old.body?.token));

  const code = await ask(CODE, CODE_ACCOUNT);
  check('（对照）内部码账号照旧 200', code.status === 200, `status=${code.status}`);

  const card = await ask(CARD, CARD_ACCOUNT);
  check('③ 刷卡账号还是 503（判据没被改宽成「谁都放过」）',
    card.status === 503 && card.body?.error === 'notConfigured',
    `status=${card.status} ${JSON.stringify(card.body)}`);
  check('③ 503 那一支不许带令牌出去', card.body?.token === undefined, String(card.body?.token));
}

// ── 反向尺子：把判据改回 `=== 'code'`，缺 kind 的那个必须变成 503 ──
{
  const SRC = new URL('../api/_entitlement.js', import.meta.url);
  const TMP = new URL('../api/_entitlement.kindprobe.mjs', import.meta.url);
  const src = readFileSync(SRC, 'utf8');
  const broken = src.replaceAll("account.kind !== 'card'", "account.kind === 'code'");
  let ran = false;
  try {
    // 对照本身要先成立：真的改动了两处，不是零处。
    const hits = (src.match(/account\.kind !== 'card'/g) || []).length;
    check('（对照前提）判据恰好两处', hits === 2, `${hits} 处`);
    if (hits === 2) {
      writeFileSync(TMP, broken);
      const stale = await import(TMP.href);
      ran = true;
      const old = await stale.resolveEntitlement(OLD, OLD_ACCOUNT, OLD_ACCOUNT.token);
      check('反向尺子：判据写回 `=== \'code\'` → 缺 kind 的老账号变成 503',
        old.status === 503, `status=${old.status} ${JSON.stringify(old.body)}`);
      const card = await stale.resolveEntitlement(CARD, CARD_ACCOUNT, CARD_ACCOUNT.token);
      check('反向尺子：刷卡那一个两版都是 503（说明红的是「缺 kind」这一件事）',
        card.status === 503, `status=${card.status}`);
    }
  } finally {
    // 这份临时模块从不提交，跑完就扔。
    rmSync(TMP, { force: true });
  }
  if (!ran) check('反向尺子跑起来了', false, '临时模块没 import 成');
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
