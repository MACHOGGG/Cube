/**
 * 「有人去看教学了，大家等他」——这一挂只许挂在开赛之前，而且挂得有个头。
 *
 *   node scripts/check-room-learn.mjs
 *
 * 不起服务器、不开浏览器：库用进程内那一份（ALLOW_MEMORY_STORE），直接叫
 * api/room.js 的 handler。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 挂起（`meta.learnHold`）是一件对**全屋**生效的事：放行那一下会把开赛时刻重新盖一
 * 遍，所有人一起从 4 数起。三种走偏，三种都真的发生过：
 *
 *   ① **开局之后还挂得起来。** 从前只问「这一局挂过没有」，于是开打之后点开教学复习
 *      的人照样能把整屋拦住：`releaseHold` 把 `startAt` 盖成「从现在起再数 4 秒」，而
 *      大家**已经在打了**——下一次轮询读到一个在未来的 `startAt`，客户端把还在打的人
 *      退回倒数屏。教学本来就是开局前那一问里的事。
 *
 *   ② **一个人可以把开赛无限期推下去。** 「二十秒没点就不等他」（LEARN_IDLE_MS）要有
 *      人来问才生效——放行写在 `state()` 的轮询里。屋里全切到后台、或者只剩那个正在看
 *      教学的，那一问就不会发生，而他每点一下还把二十秒续上。所以要有一个硬顶
 *      （LEARN_MAX_MS，90 秒，和 ABSENT_MS 同一个数）。
 *
 *   ③ **放行之后还在说「正在等他」。** `publicState.learning` 从前只看那个人自己
 *      （`seatLearning`）。挂起被放行之后倒数已经在走，可他那台设备还在教学页上一下一
 *      下地点——屋里所有人于是看着一句「等他看教学」而倒数正在归零，数到 0 直接开局。
 *      这一位在屏幕上的意思是「大家在等他」，不是「他在看教学」。
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

// 一次一个假 IP：这个文件要开好几间屋，挤在一个 IP 上会撞 create 的限速
// （理由见 check-room-races 里 nextIp 那段）。
let ipSeq = 0;
const nextIp = () => `198.19.${Math.floor(++ipSeq / 254) % 254}.${(ipSeq % 254) + 1}`;
const call = async (body) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await room({ method: 'POST', headers: { 'x-forwarded-for': nextIp() }, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};

const account = newAccount('lll111', 'code');
account.until = Date.now() + 9e8;
await saveAccount('learnhost@example.com', account);
const who = { email: 'learnhost@example.com', accountToken: account.token };

/** 开一间屋，开一局（方块），回屋主和客人的钥匙。倒数 4.5 秒还没走完。 */
async function openRoom() {
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const g = await call({ action: 'join', code, name: '客人' });
  const guest = { playerId: g.body.playerId, playerToken: g.body.playerToken };
  // seen 两族都填上：不然 start 会判「屋里可能有新手」，多留四秒（ASK_MS）。
  // 这台门要量的是挂起，不是那四秒。
  await call({ action: 'learn', code, ...host, learning: false, seen: ['square', 'circle'] });
  await call({ action: 'learn', code, ...guest, learning: false, seen: ['square', 'circle'] });
  const st = await call({ action: 'start', code, ...host, mode: 'square' });
  return { code, host, guest, startAt: st.body.startAt };
}
const metaOf = async (code) => (await hgetall(roomKey(code))).meta;
const seatIn = (st, id) => (st.body.players || []).find((p) => p.id === id) || {};

// ---- ① 开赛之前：挂得起来，而且记下是什么时候挂的 -----------------------
{
  const { code, guest, host } = await openRoom();
  const r = await call({ action: 'learn', code, ...guest, learning: true });
  check('① 开赛前说「我在学」：整屋挂起', r.body.state.learnHold === true, String(r.body.state.learnHold));
  const meta = await metaOf(code);
  check('① 挂起时记下了 heldAt（挂满 90 秒要靠它）', Number(meta.heldAt) > 0, String(meta.heldAt));
  check('① heldRound 记的是这一局', Number(meta.heldRound) === 1, String(meta.heldRound));
  // ③ 的量程：这会儿屋里确实在等他。
  const st = await call({ action: 'state', code, ...host });
  check('① 挂起中：那个人身上的「大家在等他」是真的', seatIn(st, guest.playerId).learning === true,
    String(seatIn(st, guest.playerId).learning));
  check('① 挂起中：没在学的人身上是假的', seatIn(st, host.playerId).learning === false,
    String(seatIn(st, host.playerId).learning));
}

// ---- ② 开赛之后再点开教学：挂不起来，开赛时刻一个字都不许动 -------------
//
// 不等真的 4.5 秒（这台门要跑十几遍），直接把 startAt 推到过去——等价于「倒数走
// 完了」。
{
  const { code, guest } = await openRoom();
  const before = await metaOf(code);
  const already = Date.now() - 1000;
  await hset(roomKey(code), 'meta', { ...before, startAt: already });
  const r = await call({ action: 'learn', code, ...guest, learning: true });
  check('② 开赛之后说「我在学」：挂不起来', r.body.state.learnHold === false, String(r.body.state.learnHold));
  const meta = await metaOf(code);
  // 比的是**原来那个数本身**，不是「它还在过去」：放行会把 startAt 盖成「从现在
  // 起再数 4.5 秒」，而那个数在将来——写成「还在过去」也拦得住这一种，可拦不住
  // 「被盖成另一个过去的时刻」。一个数该不该动，就量它有没有动。
  check('② 开赛时刻一个字没动（不然还在打的人被退回倒数屏）',
    Number(meta.startAt) === already, `挪了 ${meta.startAt - already}ms`);
  check('② 没留下 heldAt', !meta.heldAt, String(meta.heldAt));
  check('② publicState 也不说「在等他」', r.body.state.players.find((p) => p.id === guest.playerId).learning === false,
    String(r.body.state.players.find((p) => p.id === guest.playerId).learning));
}

// ---- ③ 走神二十秒：下一次轮询就放行（LEARN_IDLE_MS，老规矩） -------------
{
  const { code, guest, host } = await openRoom();
  await call({ action: 'learn', code, ...guest, learning: true });
  const hash = await hgetall(roomKey(code));
  // 他那一格的 learningAt 推到 21 秒前：等于「二十秒没点一下」。
  await hset(roomKey(code), 'p:' + guest.playerId, { ...hash['p:' + guest.playerId], learningAt: Date.now() - 21_000 });
  const st = await call({ action: 'state', code, ...host });
  check('③ 走神二十秒：放行', st.body.learnHold === false, String(st.body.learnHold));
  check('③ 放行之后开赛时刻重新盖了一遍（全屋从 4 数起）', st.body.startAt > Date.now(), String(st.body.startAt - Date.now()));
}

// ---- ④ 挂满 90 秒：他还在点，也放行 -------------------------------------
//
// #11 的正身。摆的状态是「`heldAt` 在 91 秒前，而他那一格的 learningAt 是新鲜的」
// ——也就是「一个人一直点着教学，屋里别人全切到后台」那一幕。
{
  const { code, guest, host } = await openRoom();
  await call({ action: 'learn', code, ...guest, learning: true });
  const hash = await hgetall(roomKey(code));
  await hset(roomKey(code), 'meta', { ...hash.meta, heldAt: Date.now() - 91_000 });
  // 他确实还在点（量程：learningAt 新鲜，所以放行不是因为走神）。
  await hset(roomKey(code), 'p:' + guest.playerId, { ...hash['p:' + guest.playerId], learningAt: Date.now() });
  const st = await call({ action: 'state', code, ...host });
  check('④ 挂满 90 秒：放行（哪怕他还在点）', st.body.learnHold === false, String(st.body.learnHold));
  check('④ 量程：他那一格确实是新鲜的（不是走神放行的）',
    Date.now() - Number((await hgetall(roomKey(code)))['p:' + guest.playerId].learningAt) < 20_000, 'ok');
  // ③ 那个毛病的正身：放行之后，屋里不许再说「在等他」。
  check('④ 放行之后：publicState 不再说「大家在等他」', seatIn(st, guest.playerId).learning === false,
    String(seatIn(st, guest.playerId).learning));
}

// ---- ⑤ 老的 meta 没有 heldAt：当成挂满，放行 ----------------------------
//
// 上线那一刻正挂着的屋子就是这样（挂起是旧代码写的，没有这一位）。宁可早放一
// 拍，不能挂到小屋过期。
{
  const { code, guest, host } = await openRoom();
  await call({ action: 'learn', code, ...guest, learning: true });
  const hash = await hgetall(roomKey(code));
  const meta = { ...hash.meta };
  delete meta.heldAt;
  await hset(roomKey(code), 'meta', meta);
  const st = await call({ action: 'state', code, ...host });
  check('⑤ 老 meta 没有 heldAt：当成挂满，放行', st.body.learnHold === false, String(st.body.learnHold));
}

// ---- ⑥ 学完那一下：最后一个学完的人放行，全屋从头数 ---------------------
{
  const { code, guest, host } = await openRoom();
  await call({ action: 'learn', code, ...guest, learning: true });
  await call({ action: 'learn', code, ...host, learning: true });
  const mid = await call({ action: 'state', code, ...host });
  check('⑥ 量程：两个人都在学的时候还挂着', mid.body.learnHold === true, String(mid.body.learnHold));
  await call({ action: 'learn', code, ...guest, learning: false, seen: ['square'] });
  const one = await call({ action: 'state', code, ...host });
  check('⑥ 还有一个在学：接着挂', one.body.learnHold === true, String(one.body.learnHold));
  const r = await call({ action: 'learn', code, ...host, learning: false, seen: ['square'] });
  check('⑥ 最后一个学完：放行', r.body.state.learnHold === false, String(r.body.state.learnHold));
  check('⑥ 放行之后开赛时刻在将来（4-3-2-1 重新走）', r.body.state.startAt > Date.now(),
    String(r.body.state.startAt - Date.now()));
}

// ---- ⑦ 同一局只挂一次：放行之后再说「我在学」拦不住人 -------------------
{
  const { code, guest, host } = await openRoom();
  await call({ action: 'learn', code, ...guest, learning: true });
  await call({ action: 'learn', code, ...guest, learning: false, seen: ['square'] });
  const again = await call({ action: 'learn', code, ...guest, learning: true });
  check('⑦ 同一局放行之后再点：挂不起来', again.body.state.learnHold === false, String(again.body.state.learnHold));
  const st = await call({ action: 'state', code, ...host });
  check('⑦ 而且不说「在等他」', seatIn(st, guest.playerId).learning === false, String(seatIn(st, guest.playerId).learning));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
