/**
 * 「谁算天才」这道题，问的人得先证明自己是谁。
 *
 *   node scripts/check-entitlement.mjs
 *
 * 盯的是一个真出过的漏洞：判断刷卡订阅那一支，原来只看请求里写的邮箱，不
 * 看打请求的人是不是这个邮箱的主人。于是任何人——不用注册、不用登录、不用
 * 花一分钱——只要报出一个正在付费的邮箱（收据上就印着，写过信的人都知道），
 * 就能开走一间本该收费的小屋、看到本该锁着的排行榜，而付钱那位毫不知情。
 *
 * 这里不起服务器、不连 Redis、也不真去问 Creem：账户库用进程内的那份
 * （ALLOW_MEMORY_STORE=1），Creem 的两次 HTTP 用一个假的 fetch 顶掉——顺便
 * 数一数它被叫了几次。「一次都没叫」本身就是结论：连问都不该问。
 *
 * 加 --old 会把上一版的 _entitlement.js 拉出来跑同一套，用来确认这些断言
 * 在修之前确实是红的（不是写了一堆永远会过的话）。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

process.env.ALLOW_MEMORY_STORE = '1';
process.env.CREEM_API_KEY = 'creem_test_stub';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---- 假的 Creem：谁来问都说「这个邮箱正在付费」 --------------------------
let asked = 0;
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.includes('creem.io')) throw new Error('unexpected fetch: ' + u);
  asked++;
  if (/\/v1\/customers\/[^/]+\/subscriptions/.test(u)) return json({ items: [{ status: 'active' }] });
  if (u.includes('/v1/customers')) return json({ id: 'cus_1', email: 'paying@example.com' });
  return json({});
};

const useOld = process.argv.includes('--old');
const OLD = 'api/_entitlement.old.mjs';
if (useOld) {
  writeFileSync(OLD, execFileSync('git', ['show', 'HEAD:api/_entitlement.js'], { encoding: 'utf-8' }));
}
const { isGenius } = await import('../' + (useOld ? OLD : 'api/_entitlement.js'));
const { saveAccount } = await import('../api/_accounts.js');

// 一个真的刷卡订阅户：我们自己的库里只有账号和令牌，权益在 Creem 那边，
// 所以 until 是 0——这正是那条「去问 Creem」的分支存在的理由。
await saveAccount('paying@example.com', { token: 'TOKEN-OF-THE-PAYER', until: 0 });
// 一个自己也有账号、但没付钱的人。他有一个完全合法的令牌。
await saveAccount('freeloader@example.com', { token: 'TOKEN-OF-THE-FREELOADER', until: 0 });

asked = 0;
check('光报一个别人的邮箱，不算天才',
  (await isGenius({ email: 'paying@example.com' })) === false);
check('连问都不该去问 Creem', asked === 0, `问了 ${asked} 次`);

asked = 0;
check('拿一个乱编的令牌也不算',
  (await isGenius({ email: 'paying@example.com', accountToken: 'GUESS' })) === false);
check('同样一次也不问', asked === 0, `问了 ${asked} 次`);

asked = 0;
check('自己有合法令牌，但报的是别人的邮箱，还是不算',
  (await isGenius({ email: 'paying@example.com', accountToken: 'TOKEN-OF-THE-FREELOADER' })) === false);
check('这一次也不问', asked === 0, `问了 ${asked} 次`);

asked = 0;
check('本人拿着自己的令牌来，才算',
  (await isGenius({ email: 'paying@example.com', accountToken: 'TOKEN-OF-THE-PAYER' })) === true);
check('这时候才去问 Creem', asked > 0, `问了 ${asked} 次`);

asked = 0;
check('光说一句「我是商店买的」，不算（商店版上线前接收据校验，见 _entitlement.js）',
  (await isGenius({ storeClaim: true })) === false);
check('说这句也不去问 Creem', asked === 0, `问了 ${asked} 次`);

if (useOld) rmSync(OLD, { force: true });
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
