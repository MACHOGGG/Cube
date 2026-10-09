/**
 * 《服务条款》里讲账号的那两条，说的是代码此刻真做的事（10-08 方案第四批第 4 条）。
 *
 *   npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs
 *   node scripts/check-terms-accounts.mjs /tmp/legal.mjs
 *
 * 纯算术，不开浏览器，进得了 CI。
 *
 * 方案原话：「条款『内部码开通的账号』条改写（legal.ts）：按现行免邮箱双串体系与 handle.js 实际锁定行为重写
 * （现文还写着 6 位密码、锁 4 小时）。虽暂不展示，按『法务文本=代码行为陈述』铁律本批一起改。」
 *
 * 原先那两条讲的是 2026-10 改制之前的那一套：刷卡订阅之后「为这个邮箱设一组 6 位密码」、「用内部码开通时会
 * 留下邮箱和一组 6 位密码」、「错 4 次锁 4 小时，错到 6 次就一直锁着，要通过邮箱验证才能重新开启」。现在没有
 * 密码了（邮箱账号每次登录寄一组验证码），内部码也不再开账号；还在「锁」的只有免邮箱账号的第二串，而且它
 * **永远不封号**（handle.js 调 checkPin 时传 `block: false`）。
 *
 * 所以这道门**先读代码，再读条款**：锁线（LOCK_AFTER）、锁多久（LOCK_MS）、两串的长度（PAIR_RE）、会不会封号、
 * 有没有「重设第二串」、能不能绑定邮箱，都从 api/ 的源码里读出来，再看四种语言的条款是不是这么说的。哪天代码改了
 * （比如锁线从 4 改成 5），这道门先红——那时候要回来改的正是这两条。
 *
 * 10-09 补充方案 7-8：撤了「凭第一串重设第二串」（handle.js 的 reset 回 410），给的退路是登录之后绑定邮箱
 * （api/email.js 认 `hdl:` 那把 id）。原先这儿量的是「重设会把所有设备踢下线」；现在量的是条款说了「没有重设」
 * 和「可以绑定邮箱」，而且旧的那几句（凭第一串就能重设、不想等就重设）一句都不许留。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-terms-accounts.mjs <打包好的 legal.mjs>');
  console.error('  npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs');
  process.exit(2);
}
const { LEGAL } = await import(src);
const { readFileSync } = await import('node:fs');
const api = (f) => readFileSync(new URL(`../api/${f}`, import.meta.url), 'utf8');

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

// ── 先读代码 ──────────────────────────────────────────────────────────────
const acc = api('_accounts.js');
const handle = api('handle.js');
const lockAfter = Number((acc.match(/const LOCK_AFTER = (\d+);/) || [])[1]);
const lockHours = Number((acc.match(/const LOCK_MS = (\d+) \* 3600e3;/) || [])[1]);
const pair = acc.match(/export const PAIR_RE = \/\^\[A-Za-z0-9\]\{(\d+),(\d+)\}\$\/;/) || [];
const [pairMin, pairMax] = [Number(pair[1]), Number(pair[2])];
// handle.js 里登录那一支调 checkPin 的那一句（整行取出来再看带没带 block: false——参数里有 `String(second ?? '')`
// 这种带括号的写法，拿「到第一个右括号为止」去匹配会在半路停下，把「不封号」读成 false、那条断言就被悄悄跳过）
const pinCall = (handle.match(/await checkPin\(([^\n]*)\);/) || [])[1] || '';
const noBlock = /\{\s*block:\s*false\s*\}/.test(pinCall);
// 重设第二串还在不在：reset 那一支回 410、也没有 reset() 这个函数，才算撤了。
const resetGone = /body\.action === 'reset'\) return send\(res, 410/.test(handle) && !handle.includes('async function reset(');
// 绑定邮箱：email.js 的「现在这个地址」认不认 `hdl:` 那把 id（accountId = 邮箱或 hdl:）。
const email = api('email.js');
const bindable = /if \(!accountId\(address\)/.test(email);
check('（尺子）代码里读到了锁线、锁多久、两串的长度', lockAfter > 0 && lockHours > 0 && pairMin > 0 && pairMax > pairMin,
  `错 ${lockAfter} 次锁 ${lockHours} 小时，两串 ${pairMin}–${pairMax} 位`);
check('（尺子）handle.js 里读到了调 checkPin 的那一句', pinCall.length > 10,
  `checkPin(${pinCall}) → 不封号=${noBlock}，重设撤了=${resetGone}，能绑定邮箱=${bindable}`);

// ── 再读条款 ──────────────────────────────────────────────────────────────
const EN_NUM = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 8: 'eight', 12: 'twelve', 24: 'twenty-four' };
const FR_NUM = { 1: 'une', 2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq', 6: 'six', 8: 'huit', 12: 'douze', 24: 'vingt-quatre' };
const SPEC = {
  zhHans: {
    term: '免邮箱账号',
    says: [`${pairMin} 到 ${pairMax} 位`, `输错 ${lockAfter} 次`, `锁 ${lockHours} 小时`,
      ...(noBlock ? ['不会永久封号'] : []), ...(resetGone ? ['没有「重设」这条路'] : []), ...(bindable ? ['绑定一个邮箱'] : [])],
    accounts: '账号',
  },
  zhHant: {
    term: '免信箱帳號',
    says: [`${pairMin} 到 ${pairMax} 位`, `輸錯 ${lockAfter} 次`, `鎖 ${lockHours} 小時`,
      ...(noBlock ? ['不會永久封號'] : []), ...(resetGone ? ['沒有「重設」這條路'] : []), ...(bindable ? ['綁定一個信箱'] : [])],
    accounts: '帳號',
  },
  en: {
    term: 'Address-free accounts',
    says: [`${pairMin} to ${pairMax} letters`, `${EN_NUM[lockAfter]} wrong`, `${EN_NUM[lockHours]} hours`,
      ...(noBlock ? ['never closed for good'] : []), ...(resetGone ? ['cannot be reset'] : []), ...(bindable ? ['link an email'] : [])],
    accounts: 'Accounts',
  },
  fr: {
    term: 'Comptes sans adresse',
    says: [`de ${pairMin} à ${pairMax} lettres`, `${FR_NUM[lockAfter]} erreurs`, `${FR_NUM[lockHours]} heures`,
      ...(noBlock ? ['jamais fermé définitivement'] : []), ...(resetGone ? ['ni redéfinie'] : []), ...(bindable ? ['associez une adresse'] : [])],
    accounts: 'Comptes',
  },
};
/** 改制之前那一套的说法：在这两条里一句都不许有。 */
const GONE = ['6 位密码', '6 位密碼', 'six-character passcode', 'mot de passe de six caractères',
  '内部码开通', '內部碼開通', 'made by a code', 'créés par un code',
  '银行卡', '刷卡', '信用卡', 'by card', 'par carte', '错到 6 次', '錯到 6 次',
  // 「凭第一串重设第二串」那一套（10-09 补充方案 7-8 撤了）——只在代码里真的撤了的时候才算旧说法。
  ...(resetGone ? ['凭第一串重设', '憑第一串重設', '只凭第一串就能重设', '只憑第一串就能重設', 'alone is enough to reset',
    'reset the second string with the first', 'suffit à elle seule pour redéfinir', 'redéfinissez la seconde chaîne',
    '所有设备上的登录一起失效', '所有裝置上的登入一起失效', 'signs out every device', 'déconnecte tous vos appareils'] : [])];

for (const [lang, spec] of Object.entries(SPEC)) {
  const items = LEGAL[lang]?.terms?.items || [];
  check(`${lang}（尺子）《服务条款》读到了`, items.length >= 5, `${items.length} 条`);
  const handleItem = items.find((i) => i.term === spec.term);
  const accItem = items.find((i) => i.term === spec.accounts);
  check(`${lang}：有「${spec.term}」那一条`, Boolean(handleItem), items.map((i) => i.term).join(' / '));
  check(`${lang}：有「${spec.accounts}」那一条`, Boolean(accItem));
  if (handleItem) {
    const body = handleItem.body.toLowerCase();
    const miss = spec.says.filter((w) => !body.includes(w.toLowerCase()));
    check(`${lang}：「${spec.term}」说的锁线、锁多久、长度、封不封号、有没有重设、能不能绑定邮箱和代码一致`, miss.length === 0,
      miss.length ? `缺：${miss.join(' / ')}` : '');
  }
  const both = [handleItem, accItem].filter(Boolean).map((i) => `${i.term} ${i.body}`).join('\n');
  const left = GONE.filter((w) => both.toLowerCase().includes(w.toLowerCase()));
  check(`${lang}：这两条里没有改制之前的说法（6 位密码、内部码开通、刷卡、错到 6 次、凭第一串重设）`, left.length === 0, left.join(' / '));
  // 内部码那一条整个不在了（它说的那种账号已经不存在）
  const old = items.find((i) => /内部码|內部碼|by a code|par un code/i.test(i.term));
  check(`${lang}：「内部码开通的账号」那一条不在了`, !old, old ? old.term : '');
}

check('（尺子）重设第二串确实撤了、确实能绑定邮箱（不然上面那几句「没有重设」「绑定一个邮箱」根本没被量）', resetGone && bindable,
  `重设撤了=${resetGone} 能绑定=${bindable}`);

// 反向对照：把锁线改成 5（假装代码改了），zhHans 那一条该红
{
  const body = (LEGAL.zhHans?.terms?.items || []).find((i) => i.term === '免邮箱账号')?.body || '';
  check('（反向对照）代码的锁线要是改成 5，条款里「输错 4 次」对不上，会红', !body.includes(`输错 ${lockAfter + 1} 次`));
}

console.log(fail ? `\n${fail} 条红` : '\nALL PASS');
process.exit(fail ? 1 : 0);
