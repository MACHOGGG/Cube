/**
 * 兑换码绑定（`/api/passcode` 的 bind）——**10-11 起整支回 410**（方案 A-2）。
 *
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-bind-race.mjs http://localhost:8815
 *
 * 这道门原先量的是绑定的竞态：花码本身是原子的（GETDEL），可绑定——把这个码换来的权益挂到一
 * 个邮箱账号上——中间有四步：读凭证、查邮箱有没有被占、写新账号、删凭证，四步之间任何一处让
 * 出去，一张码就能变成两个账号。那件事修好了（takeAccount + createAccount），一直守在这里。
 *
 * 10-11 查出 bind 本身就不该开着：它从来不验「这个邮箱是你的」，兑一张码就能把它绑到**别人**
 * 的地址上（拿回来的新令牌问权益得 `active:true`），还顺手替那个人订上营销邮件。界面上的入口
 * 早撤了（E41），兑码如今直接带着登录的 email / token 落进他自己的账号。所以 bind 整支回 410，
 * 代码留着（api/passcode.js 分发那一行写着改回来之前要先补什么）。
 *
 * 现在量的是「关得干净」：
 *   · 同时两个 bind 都回 410，谁都没绑成；
 *   · 码寄存处一个字没动——410 排在取凭证（GETDEL）之前，所以手里那张码不会因此被弄丢：拿持有
 *     凭证去 /api/scores 报到照旧认得；
 *   · 令牌猜错、地址被占那几条分支也都走不到了：关掉的路不再分辨对错，一律 410。
 */

const base = (process.argv[2] || 'http://localhost:8815').replace(/\/$/, '');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// ---- 先花一张码，拿到「持有凭证」 --------------------------------------
// TESTYEAR，不是 TESTMONTH：check-multiplayer 花的是那一张，两个脚本
// 用同一张码的话，先跑的那个会把后跑的那个饿死。
const spent = await post('/api/redeem', { code: 'TESTYEAR' });
if (!spent.body.active || !spent.body.code) {
  console.error('拿不到未绑定的兑换码权益，服务器说：', spent.status, JSON.stringify(spent.body));
  console.error('（TESTYEAR 是一次性的，重启 dev-server 会重新种一张。）');
  process.exit(2);
}
const { code, token } = spent.body;
console.log(`拿到持有凭证：码 ${code}\n`);

/** 拿持有凭证去报到：码寄存处还在、令牌还对，服务器就认得。 */
const held = () => post('/api/scores', { action: 'mine', code, token });
check('（尺子）绑之前，持有凭证认得', (await held()).status === 200);

// ---- 两个邮箱同时来绑 ---------------------------------------------------
const [a, b] = await Promise.all([
  post('/api/passcode', { code, token, email: 'race-a@test.com', password: '123456' }),
  post('/api/passcode', { code, token, email: 'race-b@test.com', password: '123456' }),
]);
console.log(`甲 ${a.status} ${JSON.stringify(a.body.error ?? 'ok')}`);
console.log(`乙 ${b.status} ${JSON.stringify(b.body.error ?? 'ok')}\n`);
check('两个 bind 都回 410 gone，谁都没绑成',
  [a, b].every((r) => r.status === 410 && r.body.error === 'gone' && !r.body.token));

// ---- 关掉的路不能把码弄丢 -----------------------------------------------
const after = await held();
check('码寄存处原样还在：持有凭证照旧认得（410 排在取凭证之前）', after.status === 200,
  `${after.status} ${JSON.stringify(after.body.error || '')}`);

// ---- 令牌猜错、地址被占：都走不到了 -------------------------------------
const badToken = await post('/api/passcode', {
  code, token: 'not-the-right-token', email: 'x@test.com', password: '123456',
});
check('令牌不对也是 410（关掉的路不再分辨对错）', badToken.status === 410 && badToken.body.error === 'gone',
  `${badToken.status} ${JSON.stringify(badToken.body)}`);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
