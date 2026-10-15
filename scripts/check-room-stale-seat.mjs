/**
 * 拿着对不上的座位来问小屋：服务器要说清楚，不能照样回 200（10-15 补充 S4，L-2 ②）。
 *
 *   node scripts/check-room-stale-seat.mjs
 *
 * 不起服务器：库用进程内那一份（ALLOW_MEMORY_STORE），直接叫 api/room.js 的 handler。
 *
 * 钥匙都是 p: 写进库之后才回给客户端的；bye、被收椅子、leave 之后钥匙都不变。所以「带着 playerId 却对不上」只有
 * 两种，各自一个词：
 *   (a) 钥匙被同名认领换掉了——旧手机还拿着旧钥匙轮询 → 403 seat。原先照样回 200，旧手机 8.5 秒里报分 18 条全
 *       是 403，屏幕上一个字都没有，打完一局是 0 分。
 *   (b) 号码上根本没有这个 id（旧屋过期了、号码被一间新屋占了）→ 409 ended。原先照样回 200，旧设备看到的是陌生人
 *       的屋子。
 * 合法的那几种照旧 200：屋主、bye 之后、椅子被收走之后、leave 之后、不带身份。旧钥匙报分也是 403 seat（原先是
 * notInRoom，客户端不认得这个词）。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const room = (await import('../api/room.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');
const { hset, hgetall } = await import('../api/_store.js');

let ipSeq = 0;
const call = async (body) => {
  ipSeq++;
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await room({ method: 'POST', headers: { 'x-forwarded-for': `198.20.${Math.floor(ipSeq / 254) % 254}.${(ipSeq % 254) + 1}` }, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};
/** bye 之后的十秒宽限（BYE_GRACE_MS）直接拨过去：等于「他真的把网页关了」。 */
async function agePast(code, playerId) {
  const hash = await hgetall('room:' + code);
  await hset('room:' + code, 'h:' + playerId, { ...(hash['h:' + playerId] || {}), byeAt: 1 });
}
const seatOf = (code, r) => ({ code, playerId: r.body.playerId, playerToken: r.body.playerToken });

const account = newAccount('stale1', 'code');
account.until = Date.now() + 9e8;
await saveAccount('stale@example.com', account);
const who = { email: 'stale@example.com', accountToken: account.token };

// 一间屋：屋主、Bob（会被同名认领）、Cat（会按《离开》）、Dan（会关页、椅子被收走）
const opened = await call({ action: 'create', name: '屋主', ...who });
const code = opened.body.code;
const host = seatOf(code, opened);
const bob = seatOf(code, await call({ action: 'join', code, name: 'Bob' }));
const cat = seatOf(code, await call({ action: 'join', code, name: 'Cat' }));
const dan = seatOf(code, await call({ action: 'join', code, name: 'Dan' }));
check('（尺子）开得出屋、坐得下三个人', Boolean(code && bob.playerId && cat.playerId && dan.playerId));

// (a) Bob 关了页，另一台设备用同一个名字认领回来——钥匙换了
await call({ action: 'bye', ...bob });
await agePast(code, bob.playerId);
const bob2 = await call({ action: 'join', code, name: 'Bob' });
check('（尺子）同名认领回来了：同一个 playerId、换了一把新钥匙',
  bob2.status === 200 && bob2.body.rejoined === true && bob2.body.playerId === bob.playerId && bob2.body.playerToken !== bob.playerToken,
  `${bob2.status} rejoined=${bob2.body.rejoined}`);
const oldBob = await call({ action: 'state', ...bob });
check('(a) 旧手机拿着旧钥匙轮询：403 seat', oldBob.status === 403 && oldBob.body.error === 'seat', `${oldBob.status} ${oldBob.body.error}`);
const oldScore = await call({ action: 'score', ...bob, score: 12, round: 0 });
check('(a) 旧钥匙报分：403 seat（原先是 notInRoom）', oldScore.status === 403 && oldScore.body.error === 'seat', `${oldScore.status} ${oldScore.body.error}`);
const newBob = await call({ action: 'state', code, playerId: bob.playerId, playerToken: bob2.body.playerToken });
check('(a) 新手机拿新钥匙：200', newBob.status === 200, String(newBob.status));

// (b) 号码上根本没有这个 id：拿 A 屋的座位去问 B 屋（等于 A 屋过期、号码被 B 屋占了）
const other = await call({ action: 'create', name: '别人', ...who });
const elsewhere = await call({ action: 'state', code: other.body.code, playerId: cat.playerId, playerToken: cat.playerToken });
check('(b) 号码上没有这个 id：409 ended', elsewhere.status === 409 && elsewhere.body.error === 'ended', `${elsewhere.status} ${elsewhere.body.error}`);

// 合法的几种：照旧 200
const asHost = await call({ action: 'state', ...host });
check('屋主轮询：200', asHost.status === 200, String(asHost.status));
await call({ action: 'bye', ...dan });
const afterBye = await call({ action: 'state', ...dan });
check('bye 之后（刷新了一下网页）回来轮询：200', afterBye.status === 200, String(afterBye.status));
// Dan 关页过了宽限期，满屋时被收走椅子
await call({ action: 'bye', ...dan });
await agePast(code, dan.playerId);
const seats = opened.body.state.seats;
for (let i = 0; i < seats; i++) {
  const r = await call({ action: 'join', code, name: '填' + i });
  if (r.status !== 200) break;
}
const robbed = (await hgetall('room:' + code))['p:' + dan.playerId];
check('（尺子）Dan 的椅子被收走了', robbed && robbed.slot === undefined, JSON.stringify(robbed?.slot ?? null));
const afterRob = await call({ action: 'state', ...dan });
check('椅子被收走之后从原来那台手机回来轮询：200（照旧让他打）', afterRob.status === 200, String(afterRob.status));
const danRow = (afterRob.body.players || []).find((p) => p.id === dan.playerId);
check('名单上他那一行 seated 是 false（标「没有座位」）', danRow && danRow.seated === false, JSON.stringify(danRow?.seated));
await call({ action: 'leave', ...cat });
const afterLeave = await call({ action: 'state', ...cat });
check('leave 之后还拿着座位问一次：200', afterLeave.status === 200, String(afterLeave.status));
const anon = await call({ action: 'state', code });
check('不带身份：200', anon.status === 200, String(anon.status));

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
