/**
 * 「我还不会玩」不再让全屋等他；上线前就挂着的屋子照样放得开（10-11 方案 C-5）。
 *
 *   node scripts/check-room-learn.mjs
 *
 * 不起服务器、不开浏览器：库用进程内那一份（ALLOW_MEMORY_STORE），直接叫
 * api/room.js 的 handler。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 原先小屋里有人答「不会，教我」，客户端报一声 `learning: true`，服务器把这一局的开赛挂起（`meta.learnHold`），
 * 全屋看着「小屋里有人在学习，稍等」最多等 90 秒。「是不是新手」是客户端自报的，谁都能拿这一声把整屋拦住
 * （报告一 #11）。玩家定的新流程（Q3-d）：答「我还不会玩」的人这一局坐场边看规则，其他人照常开局，他下一局入局。
 * 所以服务器这一头：
 *
 *   ① **`learning: true` 不再挂起**——开赛前、开赛后都一样；开赛时刻一个字不动，屋里也不说「在等他」。
 *   ② **`seen` 照记**：答「我会玩」、看完规则的人报上来的「看过哪几族」，下一局就不再为他多留四秒（ASK_MS）。
 *   ③ **上线那一刻已经挂着的屋子要放得开**：放行那几条路（走神二十秒、挂满九十秒、老 meta 没有 heldAt、最后一
 *      个学完的人报一声）一条都没删。这几间屋子摆不出来了（新代码不再挂），所以**直接把挂起写进 meta**。
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

/**
 * 开一间屋，开一局（方块），回屋主和客人的钥匙。倒数 4.5 秒还没走完。
 *
 * @param seen 两个人开局前报上去的「看过哪几族」。两族都填：start 不判「屋里可能有新手」、不多留四秒。
 */
async function openRoom(seen = ['square', 'circle']) {
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const g = await call({ action: 'join', code, name: '客人' });
  const guest = { playerId: g.body.playerId, playerToken: g.body.playerToken };
  await call({ action: 'learn', code, ...host, learning: false, seen });
  await call({ action: 'learn', code, ...guest, learning: false, seen });
  const st = await call({ action: 'start', code, ...host, mode: 'square' });
  return { code, host, guest, startAt: st.body.startAt, countFrom: st.body.countFrom };
}
const metaOf = async (code) => (await hgetall(roomKey(code))).meta;
const seatIn = (st, id) => (st.body.players || []).find((p) => p.id === id) || {};
/**
 * 把这一局摆成「上线前就挂着」：旧代码在开赛前有人说「我在学」时写的就是这三位。他那一格的 learningAt 也摆上
 * （旧客户端还在教学页上一下一下地点）。
 */
async function heldBefore(code, learnerId, { heldAt = Date.now(), learningAt = Date.now() } = {}) {
  const hash = await hgetall(roomKey(code));
  await hset(roomKey(code), 'meta', { ...hash.meta, learnHold: true, heldRound: hash.meta.round, heldAt });
  await hset(roomKey(code), 'p:' + learnerId, { ...hash['p:' + learnerId], learningAt });
}

// ---- ① 开赛之前说「我在学」：不挂起，开赛时刻不动，屋里不说「在等他」 -------------
{
  const { code, guest, host, startAt } = await openRoom();
  check('①（尺子）这会儿还在倒数', startAt > Date.now(), `${startAt - Date.now()}ms`);
  const r = await call({ action: 'learn', code, ...guest, learning: true });
  check('① 开赛前说「我在学」：不挂起', r.body.state.learnHold === false, String(r.body.state.learnHold));
  const meta = await metaOf(code);
  check('① 开赛时刻一个字没动（其他人照常开局）', Number(meta.startAt) === startAt, `挪了 ${meta.startAt - startAt}ms`);
  check('① 没留下 heldAt / heldRound', !meta.heldAt && !meta.heldRound, `${meta.heldAt} / ${meta.heldRound}`);
  const st = await call({ action: 'state', code, ...host });
  check('① 屋里不说「大家在等他」', seatIn(st, guest.playerId).learning === false, String(seatIn(st, guest.playerId).learning));
  // 他那一格的 learningAt 照记：在途的旧客户端还在看教学，满员时他那把椅子不被收走（claimSeat 的 seatLearning）。
  const raw = (await hgetall(roomKey(code)))['p:' + guest.playerId];
  check('① learningAt 照记（旧客户端看教学时椅子不被收走）', Number(raw.learningAt) > 0, String(raw.learningAt));
  // 连说两遍、两个人一起说：一样挂不起来（原先「同一局只挂一次」那一条的反面）。
  await call({ action: 'learn', code, ...host, learning: true });
  const again = await call({ action: 'learn', code, ...guest, learning: true });
  check('① 两个人都说「我在学」：照样不挂', again.body.state.learnHold === false, String(again.body.state.learnHold));
}

// ---- ② 开赛之后再说「我在学」：一样不挂，开赛时刻一个字都不许动 ---------------------
{
  const { code, guest } = await openRoom();
  const before = await metaOf(code);
  const already = Date.now() - 1000;
  await hset(roomKey(code), 'meta', { ...before, startAt: already });
  const r = await call({ action: 'learn', code, ...guest, learning: true });
  check('② 开赛之后说「我在学」：挂不起来', r.body.state.learnHold === false, String(r.body.state.learnHold));
  const meta = await metaOf(code);
  check('② 开赛时刻一个字没动（不然还在打的人被退回倒数屏）', Number(meta.startAt) === already, `挪了 ${meta.startAt - already}ms`);
}

// ---- ③ seen 照记：答「我会玩」、看完规则的人，下一局不再为他多留四秒 ------------------
{
  // 客人一族都没报过：第一局倒数多留四秒（ASK_MS）——尺子，证明下面那一条量得到「多留」。
  const { code, guest, host, countFrom } = await openRoom([]);
  check('③（尺子）屋里有人一族都没报过：倒数从 8 数起（多留四秒问他）', countFrom === 8, `countFrom=${countFrom}`);
  await call({ action: 'learn', code, ...guest, learning: false, seen: ['square'] });
  await call({ action: 'learn', code, ...host, learning: false, seen: ['square'] });
  const raw = (await hgetall(roomKey(code)))['p:' + guest.playerId];
  check('③ 报上来的「看过方块」记在他座位上', Array.isArray(raw.seen) && raw.seen.includes('square'), JSON.stringify(raw.seen));
  // 下一局还是方块：不再多留四秒。
  const hash = await hgetall(roomKey(code));
  await hset(roomKey(code), 'meta', { ...hash.meta, startAt: Date.now() - 1000 });
  for (const p of [host, guest]) {
    await call({ action: 'score', code, ...p, score: 10, finished: true, seconds: 5, round: 1 });
  }
  const next = await call({ action: 'start', code, ...host, mode: 'square' });
  check('③ 下一局方块：倒数从 4 数起，不再多留', next.body.countFrom === 4, `countFrom=${next.body.countFrom}`);
}

// ---- ④ 上线前就挂着的屋子：走神二十秒，下一次轮询放行（LEARN_IDLE_MS） ----------------
{
  const { code, guest, host } = await openRoom();
  await heldBefore(code, guest.playerId, { learningAt: Date.now() - 21_000 });
  check('④（尺子）摆出来的这一局确实挂着', (await metaOf(code)).learnHold === true);
  const st = await call({ action: 'state', code, ...host });
  check('④ 走神二十秒：放行', st.body.learnHold === false, String(st.body.learnHold));
  check('④ 放行之后开赛时刻重新盖了一遍（全屋从 4 数起）', st.body.startAt > Date.now(), String(st.body.startAt - Date.now()));
}

// ---- ⑤ 上线前就挂着的屋子：挂满 90 秒，他还在点也放行（LEARN_MAX_MS） ------------------
{
  const { code, guest, host } = await openRoom();
  await heldBefore(code, guest.playerId, { heldAt: Date.now() - 91_000, learningAt: Date.now() });
  const st = await call({ action: 'state', code, ...host });
  check('⑤ 挂满 90 秒：放行（哪怕他还在点）', st.body.learnHold === false, String(st.body.learnHold));
  check('⑤ 放行之后：屋里不再说「大家在等他」', seatIn(st, guest.playerId).learning === false,
    String(seatIn(st, guest.playerId).learning));
}

// ---- ⑥ 上线前就挂着、meta 里还没有 heldAt 的老屋子：当成挂满，放行 -----------------------
{
  const { code, guest, host } = await openRoom();
  await heldBefore(code, guest.playerId);
  const hash = await hgetall(roomKey(code));
  const meta = { ...hash.meta };
  delete meta.heldAt;
  await hset(roomKey(code), 'meta', meta);
  const st = await call({ action: 'state', code, ...host });
  check('⑥ 老 meta 没有 heldAt：当成挂满，放行', st.body.learnHold === false, String(st.body.learnHold));
}

// ---- ⑦ 上线前就挂着的屋子：最后一个学完的人报一声，放行，全屋从头数 --------------------
{
  const { code, guest, host } = await openRoom();
  await heldBefore(code, guest.playerId);
  const mid = await call({ action: 'state', code, ...host });
  check('⑦（尺子）他还在学的时候还挂着', mid.body.learnHold === true, String(mid.body.learnHold));
  check('⑦（尺子）挂着的时候屋里说「在等他」', seatIn(mid, guest.playerId).learning === true,
    String(seatIn(mid, guest.playerId).learning));
  const r = await call({ action: 'learn', code, ...guest, learning: false, seen: ['square'] });
  check('⑦ 他学完了：放行', r.body.state.learnHold === false, String(r.body.state.learnHold));
  check('⑦ 放行之后开赛时刻在将来（4-3-2-1 重新走）', r.body.state.startAt > Date.now(), String(r.body.state.startAt - Date.now()));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
