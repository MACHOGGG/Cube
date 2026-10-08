/**
 * 屋主「不等了」：一个人挂机，屋主替他交卷，下一局照常开（2026-10-08 方案 2-6）。
 *
 *   node scripts/check-room-force.mjs
 *
 * 不起服务器、不开浏览器：库用进程内那一份（ALLOW_MEMORY_STORE），直接调 api/room.js。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 普通局**不限时**：开下一局的唯一门槛是 roundOver——还在这一局里的人都交了卷（或者走了、关
 * 了网页、90 秒没消息）。一个人人还在、手机亮着、就是放着不打，他的设备每秒都在报到，90 秒
 * 那条永远轮不到他，整屋干等，屋主一点办法都没有。
 *
 * 方案 A（玩家拍板）：屋主一颗「不等了」——没交卷的人按 sitOut 那一条替他交卷（分数按服务器
 * 记着的那一份，0 分照记），这一局就算结束，下一局照常开。「不限时」本身不动。
 *
 *   ①（尺子）不按「不等了」：一人挂机，开下一局被拒（started）——不然后面几条什么都没证明。
 *   ② 屋主按了：挂机那一位交上了卷（finished，分数是服务器记着的那份），这一局算结束了。
 *   ③ 下一局照常开；记账：挂机那一位这一局照记（30 分、rounds 1），0 分的那一位也照记
 *      （rounds 1，「0 分照记」）。
 *   ④ 挂机那一位过后真打完报上来的分：收不下（final 挡着，方案 1-1 那一道），账上还是 30。
 *   ⑤ 只有屋主按得动：客人按 → notHost。
 *   ⑥ 倒数还没走完：notStarted（这一局还没开打，没有「不等了」可言）。
 *   ⑦ 不替谁交：这一局开了之后才进来的那一位不动；竞赛屋的主持人不动。
 *   ⑧ 这一局本来就结束了：按了什么都不改（回当前状态）。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const room = (await import('../api/room.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');
const { hgetall, hset } = await import('../api/_store.js');
const roomKey = (code) => 'room:' + code;

let ipSeq = 0;
const call = async (body) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await room(
    { method: 'POST', headers: { 'x-forwarded-for': `198.31.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}` }, body },
    res,
  );
  return { status, body: JSON.parse(text || '{}') };
};

const account = newAccount('frc999', 'code');
account.until = Date.now() + 9e8;
await saveAccount('forcehost@example.com', account);
const who = { email: 'forcehost@example.com', accountToken: account.token };

const SEEN = ['square', 'circle'];
/**
 * 开一间打着第一局的屋：屋主 + `guests` 个客人，开赛时刻摆到 `ranForS` 秒以前（0 = 倒数还没走
 * 完）。和 check-room-score 的 openRoom 同一个做法：**摆库，不是真等**，连 joinedAt 一起往前挪
 * （不挪的话所有人都成了「开赛之后才进来的」）。
 */
async function openRoom({ guests = 1, ranForS = 20, contest = false } = {}) {
  const h = await call({ action: 'create', name: '屋主', ...who, ...(contest ? { contest: true } : {}) });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  await call({ action: 'learn', code, ...host, learning: false, seen: SEEN });
  const people = [];
  for (let i = 0; i < guests; i++) {
    const g = await call({ action: 'join', code, name: '客人' + (i + 1), seen: SEEN });
    people.push({ playerId: g.body.playerId, playerToken: g.body.playerToken });
  }
  const st = await call({ action: 'start', code, ...host, mode: 'square' });
  let startAt = st.body.startAt;
  if (ranForS > 0) {
    const hash = await hgetall(roomKey(code));
    startAt = Date.now() - ranForS * 1000;
    await hset(roomKey(code), 'meta', { ...hash.meta, startAt });
    for (const id of [host.playerId, ...people.map((p) => p.playerId)]) {
      await hset(roomKey(code), 'p:' + id, { ...hash['p:' + id], joinedAt: startAt - 1000 });
    }
  }
  return { code, host, guests: people, startAt, startStatus: st.status };
}
const seatIn = (st, id) => (st.body.players || []).find((p) => p.id === id) || {};
const state = (code, me) => call({ action: 'state', code, ...me });

// ── ①–⑤ 一人挂机 ─────────────────────────────────────────────────────────
{
  const { code, host, guests } = await openRoom({ guests: 2 });
  const [afk, zero] = guests;
  // 屋主打完交卷；挂机那一位报过一次「还在打、30 分」（心跳），之后再没动；另一位一分没报。
  await call({ action: 'score', code, ...host, score: 120, finished: true, seconds: 12, round: 1 });
  await call({ action: 'score', code, ...afk, score: 30, finished: false, round: 1 });

  const blocked = await call({ action: 'start', code, ...host, mode: 'circle' });
  check('①（尺子）不按「不等了」：一人挂机，下一局开不了', blocked.status === 409 && blocked.body.error === 'started',
    `${blocked.status} ${blocked.body.error}`);

  const byGuest = await call({ action: 'force', code, ...afk });
  check('⑤ 客人按不动「不等了」（notHost）', byGuest.status === 403 && byGuest.body.error === 'notHost',
    `${byGuest.status} ${byGuest.body.error}`);

  const forced = await call({ action: 'force', code, ...host });
  check('② 屋主按「不等了」：回 200', forced.status === 200, `${forced.status} ${JSON.stringify(forced.body).slice(0, 80)}`);
  const a = seatIn(forced, afk.playerId);
  const z = seatIn(forced, zero.playerId);
  check('② 挂机那一位交上了卷，分数是服务器记着的那一份（30）', a.finished === true && a.score === 30, JSON.stringify(a));
  check('② 一分没报的那一位也交上了（0 分照记）', z.finished === true && z.score === 0, JSON.stringify(z));
  check('② 这一局算结束了（roundOver）', forced.body.roundOver === true, String(forced.body.roundOver));
  const raw = (await hgetall(roomKey(code)))['r:' + afk.playerId];
  check('② 写进去的和 sitOut 那一条一模一样：finished + final，没有用时', raw && raw.finished === true && raw.final === true && raw.seconds === null,
    JSON.stringify(raw));

  const next = await call({ action: 'start', code, ...host, mode: 'circle' });
  check('③ 下一局照常开', next.status === 200 && next.body.round === 2, `${next.status} round=${next.body.round}`);
  const a2 = seatIn(next, afk.playerId);
  const z2 = seatIn(next, zero.playerId);
  const h2 = seatIn(next, host.playerId);
  check('③ 记账：挂机那一位这一局照记（30 分、1 局）', a2.total === 30 && a2.rounds === 1, `total ${a2.total} rounds ${a2.rounds}`);
  check('③ 记账：0 分那一位也照记一局', z2.total === 0 && z2.rounds === 1, `total ${z2.total} rounds ${z2.rounds}`);
  check('③ 记账：屋主自己那一局照常（120）', h2.total === 120 && h2.rounds === 1, `total ${h2.total} rounds ${h2.rounds}`);

  // ④ 挂机那一位回过神来，把第 1 局打完报上来：收不下，账上不变。
  const late = await call({ action: 'score', code, ...afk, score: 500, finished: true, seconds: 30, round: 1 });
  check('④ 他过后打完报上来的第 1 局：收不下（scoreDropped）', late.body.scoreDropped === true, String(late.body.scoreDropped));
  const after = seatIn(await state(code, host), afk.playerId);
  check('④ 账上还是 30', after.total === 30, String(after.total));
}

// ── ⑥ 倒数还没走完 ───────────────────────────────────────────────────────
{
  const { code, host } = await openRoom({ guests: 1, ranForS: 0 });
  const r = await call({ action: 'force', code, ...host });
  check('⑥ 倒数还没走完：notStarted（这一局还没开打）', r.status === 409 && r.body.error === 'notStarted',
    `${r.status} ${r.body.error}`);
}

// ── ⑦ 不替谁交 ───────────────────────────────────────────────────────────
{
  // 普通屋：一位正经在打（挂机），一位这一局开了之后才进来。
  const { code, host, guests, startAt } = await openRoom({ guests: 1 });
  const [afk] = guests;
  const lateJoin = await call({ action: 'join', code, name: '晚到', seen: SEEN });
  const lateId = lateJoin.body.playerId;
  const hash = await hgetall(roomKey(code));
  check('⑦（尺子）晚到那一位确实是开赛之后进来的', (hash['p:' + lateId]?.joinedAt || 0) > startAt);
  await call({ action: 'score', code, ...host, score: 80, finished: true, seconds: 9, round: 1 });
  const forced = await call({ action: 'force', code, ...host });
  check('⑦（尺子）挂机那一位被替交了', seatIn(forced, afk.playerId).finished === true);
  const raw = (await hgetall(roomKey(code)))['r:' + lateId];
  check('⑦ 这一局开了之后才进来的那一位：不替他交（这一局本来就不是他的）', !raw || raw.final !== true, JSON.stringify(raw));
}
{
  // 竞赛屋：主持人不参赛，不该被替交卷（他也按得动「不等了」——他就是屋主）。
  const { code, host, guests } = await openRoom({ guests: 2, contest: true });
  const [p1] = guests;
  await call({ action: 'score', code, ...p1, score: 50, finished: true, seconds: 15, round: 1 });
  const forced = await call({ action: 'force', code, ...host });
  check('⑦（尺子）竞赛屋：主持人按得动，回 200', forced.status === 200, `${forced.status} ${forced.body.error ?? ''}`);
  const raw = (await hgetall(roomKey(code)))['r:' + host.playerId];
  check('⑦ 竞赛屋的主持人：不替他交（他不参赛）', !raw || raw.final !== true, JSON.stringify(raw));
  check('⑦ 竞赛屋：另一位选手被替交了，这一局算结束', forced.body.roundOver === true && seatIn(forced, guests[1].playerId).finished === true);
}

// ── ⑧ 这一局本来就结束了 ─────────────────────────────────────────────────
{
  const { code, host, guests } = await openRoom({ guests: 1 });
  await call({ action: 'score', code, ...host, score: 70, finished: true, seconds: 8, round: 1 });
  await call({ action: 'score', code, ...guests[0], score: 90, finished: true, seconds: 9, round: 1 });
  const before = await hgetall(roomKey(code));
  const r = await call({ action: 'force', code, ...host });
  const after = await hgetall(roomKey(code));
  check('⑧ 这一局本来就结束了：回 200、什么都没改', r.status === 200 && JSON.stringify(before) === JSON.stringify(after));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
