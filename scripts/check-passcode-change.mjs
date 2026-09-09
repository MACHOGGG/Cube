/**
 * 改一把钥匙，别顺手动别的东西。
 *
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-passcode-change.mjs http://localhost:8817/
 *
 * （管理口令默认取 dev-server 打印的那个 dev-admin；自己设过就当第二个参数
 * 传进来。）
 *
 * 为什么值得单独一个门：api/passcode.js 的 change() 是这么拼新账号的——
 *
 *     { ...account, ...fresh, until, plan }
 *
 * `fresh` 是 newAccount() 现造的一份，它带着十来个字段的出厂值，谁在这一行
 * 里没被显式写回去，谁就被那份出厂值盖掉。真出过的那次就是这样：玩家改一次
 * 密码，勾过的「愿意收邮件」被清成不愿意，注册时间被改成今天——一个老玩家改
 * 一次密码，发码页上看就成了刚注册的新账号。
 *
 * 这种事在界面上一点声音都没有，只有翻后台才看得见，所以让门来看着。以后
 * newAccount 再多一个字段，谁忘了在 change() 里带过去，这儿就会红。
 *
 * 反过来，那几样「本来就该换掉」的也一并盯着：旧密码必须失效、新密码必须能
 * 用——不然这个门就成了「什么都不改也能全绿」。
 */
const BASE = (process.argv[2] || 'http://localhost:8817/').replace(/\/$/, '');
const ADMIN = process.argv[3] || 'dev-admin';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// 密码一律是正好 6 位数字或字母（_accounts.js 的 PASS_RE）。
const FIRST = 'first1';
const SECOND = 'secnd2';
const THIRD = 'third3';
const EMAIL = 'passcode-gate@example.com';

/** 内部码是一次性的，dev-server 每次起来种四张。挨个试，同一台服务器上能连跑四遍。 */
async function redeemOne() {
  for (const code of ['TESTHALF', 'TESTLIFE', 'TESTYEAR', 'TESTMONTH']) {
    const r = await post('/api/redeem', { code });
    if (r.body && r.body.active === true) return r.body;
  }
  return null;
}

const granted = await redeemOne();
check('内部码兑出来了', granted !== null, granted ? granted.period : '四张测试码都用掉了——换一台干净的 dev-server 再跑');
if (!granted) {
  console.log('\n1 条没过');
  process.exit(1);
}

// 绑邮箱、设密码，并且明确勾了「愿意收邮件」。
const bound = await post('/api/passcode', {
  code: granted.code,
  token: granted.token,
  email: EMAIL,
  password: FIRST,
  news: true,
});
check('绑上邮箱、设了密码、勾了愿意收信', bound.status === 200 && bound.body.ok === true, JSON.stringify(bound.body).slice(0, 70));

/** 发码页的 list 是唯一看得到 news / createdAt 的地方。 */
const readBack = async () => {
  const r = await post('/api/mint', { token: ADMIN, action: 'list' });
  if (r.status !== 200) return { err: `${r.status} ${JSON.stringify(r.body).slice(0, 60)}` };
  return (r.body.players || []).find((p) => p.email === EMAIL) || null;
};

const before = await readBack();
check('后台读得回这个账号', before && !before.err, JSON.stringify(before));
if (!before || before.err) {
  console.log('\n（读不回来就没法比对——管理口令对不上的话，把它当第二个参数传进来）');
  console.log('\n1 条没过');
  process.exit(1);
}
check('它现在是「愿意收信」', before.news === true, String(before.news));
check('它有一个注册时间', (before.createdAt || 0) > 0, String(before.createdAt));

// 隔开一点，好让「被悄悄改成此刻」这件事在毫秒上看得出来。
await new Promise((r) => setTimeout(r, 1200));

const changed = await post('/api/passcode', { email: EMAIL, password: FIRST, newPassword: SECOND });
check('改密码成功了', changed.status === 200 && changed.body.ok === true, JSON.stringify(changed.body).slice(0, 60));

const after = await readBack();
check('「愿意收信」还在——改钥匙不该顺手改掉这个意愿', after.news === true, String(after.news));
check('注册时间没变——老玩家不该因为改了次密码就变成新注册的', after.createdAt === before.createdAt, `${before.createdAt} → ${after.createdAt}`);
check('账号值多少钱也没变（到期时间）', after.until === before.until, `${before.until} → ${after.until}`);
check('订阅档位也没变', after.plan === before.plan, `${before.plan} → ${after.plan}`);

// 该换的确实换了——否则上面几条「什么都没变」就毫无意义。
const withOld = await post('/api/passcode', { email: EMAIL, password: FIRST, newPassword: THIRD });
check('旧密码已经不好使了', withOld.status === 401, String(withOld.status));
const withNew = await post('/api/passcode', { email: EMAIL, password: SECOND, newPassword: THIRD });
check('新密码是好使的（说明这次改密码真的生效了）', withNew.status === 200, String(withNew.status));

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
