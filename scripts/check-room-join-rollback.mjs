/**
 * 进屋进到一半库摔了：不许留下孤儿椅子（10-15 补充 S4，L-2 ⑨）。
 *
 *   node scripts/check-room-join-rollback.mjs
 *
 * 不起服务器：库用进程内那一份（ALLOW_MEMORY_STORE），直接叫 api/room.js 的 handler。「库摔了」靠 api/_store.js 的
 * command() 开头那一句钩子（globalThis.__storeHook，只在内存库下生效、只给门用）：在指定的那一条命令之前抛错一次。
 *
 * 原先（已复现）：
 *   · 新座位在抢名字（HSETNX n:）或写座位（HSET p:）时摔了 → 502，s:<i> 挂着一个没有 p: 的 id：屋里显示 7/8，
 *     下一个人却 409 full，而且永远没人认领得了它（claimSeat 只扫 p:）；
 *   · p: 已经写下、续命（keepAlive）摔了 → 502，客户端拿不到钥匙，那把椅子要等九十秒没动静才收得回来；
 *   · 认领回来那一支写座位时摔了 → 椅子孤儿、认领锁（c:<id>:<旧钥匙>）没还，之后再按《加入》永远 409 claimed。
 * 现在：前两种把椅子、名字、头像交回去再 502；p: 写下之后续命、重读摔了照样回 200 交钥匙；认领那一支摔了把认领锁
 * 和这一趟新占的椅子交回去。
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
const roomKey = (code) => 'room:' + code;

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
  await room({ method: 'POST', headers: { 'x-forwarded-for': `198.24.${Math.floor(ipSeq / 254) % 254}.${(ipSeq % 254) + 1}` }, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};
/** 下一条满足 `when(args)` 的库命令之前抛一次错。 */
const breakOnce = (when) => {
  let armed = true;
  globalThis.__storeHook = async (args) => {
    if (armed && when(args)) {
      armed = false;
      throw new Error('store 503（门里注入的）');
    }
  };
};
const unbreak = () => {
  globalThis.__storeHook = undefined;
};
/**
 * 孤儿：s:<i> / n:<名> / a:<头像> 上记着的 id 没有座位（p:）；或者椅子上记的那个人已经按过《离开》、他的座位记的不是
 * 这把椅子（按过《离开》的座位 p: 里还留着旧的 slot，所以要连 left 一起看）。
 */
async function orphans(code) {
  const hash = await hgetall(roomKey(code));
  const out = [];
  for (const [f, v] of Object.entries(hash)) {
    if (f.startsWith('s:')) {
      const seat = hash['p:' + v];
      if (!seat || seat.left || String(seat.slot) !== f.slice(2)) out.push(`${f}→${v}`);
    } else if (f.startsWith('n:') || f.startsWith('a:')) {
      if (!hash['p:' + v]) out.push(`${f}→${v}`);
    }
  }
  return out;
}

const account = newAccount('jrb111', 'code');
account.until = Date.now() + 9e8;
await saveAccount('rollback@example.com', account);
const who = { email: 'rollback@example.com', accountToken: account.token };

for (const [tag, when] of [
  ['抢名字（HSETNX n:）时摔了', (a) => a[0] === 'HSETNX' && String(a[2]).startsWith('n:')],
  ['抢头像（HSETNX a:）时摔了', (a) => a[0] === 'HSETNX' && String(a[2]).startsWith('a:')],
  ['写座位（HSET p:）时摔了', (a) => a[0] === 'HSET' && String(a[2]).startsWith('p:')],
]) {
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const seats = h.body.state.seats;
  for (let i = 1; i < seats - 1; i++) await call({ action: 'join', code, name: '客' + i });
  breakOnce(when);
  const broke = await call({ action: 'join', code, name: '摔了的' });
  unbreak();
  check(`新座位${tag}：这一下回 502`, broke.status === 502, `${broke.status} ${broke.body.error ?? ''}`);
  const left = await orphans(code);
  check(`新座位${tag}：没有孤儿（椅子、名字、头像都交回去了）`, left.length === 0, left.join(' '));
  const next = await call({ action: 'join', code, name: '下一个' });
  check(`新座位${tag}：下一个人坐得进来（最后一把空椅子还在）`, next.status === 200, `${next.status} ${next.body.error ?? ''}`);
  const full = await call({ action: 'join', code, name: '再下一个' });
  check(`新座位${tag}：坐满之后才 full`, full.status === 409 && full.body.error === 'full', `${full.status} ${full.body.error ?? ''}`);
}

{
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  // 只摔续命那一条（小屋那个键的 EXPIRE）；限速计数那一条 EXPIRE 不碰（那是另一件事，见 10-15 补充 L-4 ⑧）。
  breakOnce((a) => a[0] === 'EXPIRE' && String(a[1]) === roomKey(code));
  const r = await call({ action: 'join', code, name: '续命摔了' });
  unbreak();
  check('p: 写下之后续命（EXPIRE）摔了：照样回 200、交出钥匙', r.status === 200 && !!r.body.playerToken, `${r.status} ${r.body.error ?? ''}`);
  const st = await call({ action: 'state', code, playerId: r.body.playerId, playerToken: r.body.playerToken });
  check('那把钥匙用得上（轮询 200）', st.status === 200, String(st.status));
}

{
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const bob = await call({ action: 'join', code, name: 'Bob' });
  // Bob 按了《离开》：椅子交回去了，回来认领时要重新占一把（这一趟「新占的椅子」）
  await call({ action: 'leave', code, playerId: bob.body.playerId, playerToken: bob.body.playerToken });
  breakOnce((a) => a[0] === 'HSET' && String(a[2]) === 'p:' + bob.body.playerId);
  const broke = await call({ action: 'join', code, name: 'Bob' });
  unbreak();
  check('认领回来那一支写座位时摔了：这一下回 502', broke.status === 502, `${broke.status} ${broke.body.error ?? ''}`);
  const left = await orphans(code);
  check('认领那一支摔了：这一趟新占的椅子交回去了（没有孤儿）', left.length === 0, left.join(' '));
  const hash = await hgetall(roomKey(code));
  const locks = Object.keys(hash).filter((f) => f.startsWith('c:'));
  check('认领那一支摔了：认领锁还回去了', locks.length === 0, locks.join(' '));
  const again = await call({ action: 'join', code, name: 'Bob' });
  check('再按一次《加入》：认领回来了（不是 409 claimed）', again.status === 200 && again.body.rejoined === true && again.body.playerId === bob.body.playerId,
    `${again.status} ${again.body.error ?? ''} rejoined=${again.body.rejoined}`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
