/**
 * 竞赛小屋：上限 20 人，开屋的人不参赛、只看实时榜单。
 *
 *   node scripts/check-room-contest.mjs
 *
 * 不起服务器、不开浏览器：库用进程内的那一份（ALLOW_MEMORY_STORE），直接叫
 * api/room.js 的 handler。纯逻辑、几百毫秒，进 CI。
 *
 * 玩家 2026-09 定的：「增加一个《竞赛》的入口在多人小屋里，点击后是上限 20 人、
 * 发起人不参加游戏单独看到实时榜单情况的版本」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 「主持人不参赛」听着像一条界面规矩，其实是**服务端**的三件事，少一件就出事：
 *
 *   · **这一局不等他。** 他那台设备坐在实时榜单上，永远不会交卷——算进
 *     `roundOver` 的话，屋里所有人交完卷都要干等满 ABSENT_MS（90 秒）才开得了
 *     下一局。
 *   · **账上不能有他。** 榜单那台设备每次轮询都会「交一次卷」（客户端的 sitOut，
 *     好让别人不等他）。不拦的话那些 0 分会一局一局记进 total / rounds，最后那张
 *     竞赛排名图上凭空多出一个打了十局全是 0 的人，还挂在最后一名。
 *   · **两个人才算一场比赛。** 开局那道门槛问的必须是「下场比的有几个」：竞赛屋
 *     里「屋主 + 一个人」只有一名选手，开出来是一个人自己跟自己比。
 *
 * 还有一件同样要紧的：**这一切一个字都不许影响普通八人屋**。那儿屋主照旧打自己
 * 的局，照旧要等他交卷。所以每一条都配了一条普通屋的对照。
 *
 * 以及那道边界：座位数是**跟着屋子走**的（meta.seats + seatsFor），不是跟着请求
 * 走的——不然一个 `seats: 99999` 就能让 claimSlot 空转十万圈。
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

// 一次调用一个假 IP：这个文件要开好几间屋、塞二十来个人，全算成一个 IP 会撞上
// create / join 那两个限速桶（理由和 check-room-races 文件头那段一样）。
let ipSeq = 0;
const nextIp = () => {
  ipSeq++;
  return `198.19.${Math.floor(ipSeq / 254) % 254}.${(ipSeq % 254) + 1}`;
};
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

// 开屋要天才身份。内部码账号：权益记在我们自己的库里，不问 Creem。
const account = newAccount('ccc444', 'code');
account.until = Date.now() + 9e8;
await saveAccount('contest@example.com', account);
const who = { email: 'contest@example.com', accountToken: account.token };

/** 开一间屋，回屋主的钥匙。`contest` 决定是竞赛屋还是普通屋。 */
async function open(contest, extra = {}) {
  const h = await call({ action: 'create', name: '主持人', ...who, ...(contest ? { contest: true } : {}), ...extra });
  return {
    code: h.body.code,
    host: { playerId: h.body.playerId, playerToken: h.body.playerToken },
    state: h.body.state,
  };
}
const join = async (code, name) => {
  const g = await call({ action: 'join', code, name });
  return g.body.playerToken ? { playerId: g.body.playerId, playerToken: g.body.playerToken } : null;
};
/**
 * 把开赛时刻拨到「刚刚过去」：`roundOver` 的第一道门槛是「倒数走完了没有」，
 * 真等四秒半这一台就慢得没法看。
 *
 * **必须拨到所有人加入之后**，不是随便一个过去的时刻。roundOver 和 bankRound 都
 * 认一条「joinedAt 在开赛之后 = 这一局他不在，不等他、也不记他」——拨到大家加入
 * 之前，等于把全屋都标成「中途进来的」：这一局立刻算完（一个人交卷就为真），最后
 * 谁的账都不记。头一版就这么写的，四条断言一起红，红的全是这把尺子。
 */
const ageStart = async (code) => {
  const hash = await hgetall(roomKey(code));
  const joined = Object.entries(hash)
    .filter(([k, v]) => k.startsWith('p:') && v)
    .map(([, v]) => Number(v.joinedAt) || 0);
  const at = Math.max(0, ...joined) + 1;
  await hset(roomKey(code), 'meta', { ...hash.meta, startAt: at });
  // 拨完还要让 Date.now() 真的走过那一刻（roundOver 的第一道门槛是严格小于）。
  await new Promise((r) => setTimeout(r, 5));
};
const seatOf = (st, id) => (st.players || []).find((p) => p.id === id) || {};

// ---- ① 两种屋子，两个座位数 ----------------------------------------------
{
  const plain = await open(false);
  const contest = await open(true);
  check('普通屋还是 8 把椅子', plain.state.seats === 8, String(plain.state.seats));
  // 21 把，不是 20：玩家拍的板是「要 20 名选手（连主持人 21 人）」——主持人不参赛，
  // 但座位就是身份，他也要占一把。
  check('竞赛屋是 21 把椅子（20 名选手 + 主持人）', contest.state.seats === 21, String(contest.state.seats));
  check('普通屋不是竞赛屋', plain.state.contest === false, String(plain.state.contest));
  check('竞赛屋报得出自己是竞赛屋（客户端拿它决定开不开棋盘）', contest.state.contest === true, String(contest.state.contest));
  // 屏幕上那个「几/几」数的是**选手**，不是椅子：照椅子数会写成 21/21，而那行小字
  // 写的是「最多 20 人」，两个数对不上就是「意料之外的界面」。
  check('竞赛屋报的「几/几」是选手那一对（上限 20）', contest.state.playerSeats === 20, String(contest.state.playerSeats));
  check('刚开屋时选手数是 0（主持人不算）', contest.state.playersIn === 0, String(contest.state.playersIn));
  check('普通屋那一对还是座位（8）', plain.state.playerSeats === 8 && plain.state.playersIn === 1,
    `${plain.state.playersIn}/${plain.state.playerSeats}`);
  // 座位数只认 contest 这一位，不认请求里随便塞的数——不然 claimSlot 会空转十万圈。
  const forged = await open(false, { seats: 99999 });
  check('请求里塞 seats 不管用（座位数跟着屋子走）', forged.state.seats === 8, String(forged.state.seats));
}

// ---- ② 二十个人进得去，第二十一个进不去 -----------------------------------
{
  const { code, state } = await open(true);
  let joined = 0;
  let refused = null;
  // 屋主已经占了一把，所以还能进 20 个；第 21 个该被拒。
  for (let i = 1; i <= 21; i++) {
    const r = await call({ action: 'join', code, name: '选手' + i });
    if (r.body.playerToken) joined++;
    else if (!refused) refused = `第 ${i} 个：${r.status} ${r.body.error}（seats=${r.body.seats}）`;
  }
  check('竞赛屋坐得下 20 名选手（连主持人 21 人）', joined === 20, `进了 ${joined} 个`);
  check('第 21 名选手被挡住，而且话说得明白', /full/.test(refused || ''), refused || '（一个都没被挡）');
  const full = await call({ action: 'state', code, ...{} });
  check('名单上二十一个人都在', (full.body.players || []).length === 21, `${(full.body.players || []).length} 人`);
  // 屏幕上该写「20/20」——满员时选手正好 20 名。
  check('满员时那一对是 20/20（不是 21/21）',
    full.body.playersIn === 20 && full.body.playerSeats === 20,
    `${full.body.playersIn}/${full.body.playerSeats}`);
  void state;
}

// ---- ③ 两个人才算一场比赛（主持人不算） -----------------------------------
{
  const { code, host } = await open(true);
  await join(code, '独苗');
  const one = await call({ action: 'start', code, ...host, mode: 'square' });
  check('竞赛屋只有一名选手：开不了局，而且说得出为什么', one.status === 409 && one.body.error === 'tooFew',
    `${one.status} ${one.body.error}`);
  await join(code, '第二人');
  const two = await call({ action: 'start', code, ...host, mode: 'square' });
  check('竞赛屋有两名选手：开得了局', two.status === 200 && !two.body.error, `${two.status} ${two.body.error || 'ok'}`);
}
{
  // 普通屋的对照：屋主自己就是选手，「屋主 + 一个人」就是两个人，开得了局。
  const { code, host } = await open(false);
  await join(code, '客人');
  const r = await call({ action: 'start', code, ...host, mode: 'square' });
  check('普通屋照旧：屋主 + 一个人就开得了局（这一改没碰八人屋）',
    r.status === 200 && !r.body.error, `${r.status} ${r.body.error || 'ok'}`);
}

// ---- ④ 这一局不等主持人 ---------------------------------------------------
//
// 他那台设备坐在榜单上，永远不会交卷。把他算进 roundOver 的话，两名选手交完卷
// 之后屋主想开下一局会收到 409 started，要干等满 ABSENT_MS（90 秒）。
{
  const { code, host } = await open(true);
  const a = await join(code, '甲');
  const b = await join(code, '乙');
  await call({ action: 'start', code, ...host, mode: 'square' });
  await ageStart(code);
  await call({ action: 'score', code, ...a, score: 100, finished: true, seconds: 10, round: 1 });
  const half = await call({ action: 'state', code, ...host });
  check('只有一个人交卷时，这一局还没完（尺子：不是一律为真）', half.body.roundOver === false, String(half.body.roundOver));
  await call({ action: 'score', code, ...b, score: 200, finished: true, seconds: 20, round: 1 });
  const done = await call({ action: 'state', code, ...host });
  check('两名选手都交卷 → 这一局就算完了（不等主持人）', done.body.roundOver === true, String(done.body.roundOver));
  const next = await call({ action: 'start', code, ...host, mode: 'circle' });
  check('主持人当场开得了下一局', next.status === 200 && !next.body.error, `${next.status} ${next.body.error || 'ok'}`);
}
{
  // 普通屋的对照：屋主是选手，他不交卷这一局就没完。
  const { code, host } = await open(false);
  const a = await join(code, '甲');
  await call({ action: 'start', code, ...host, mode: 'square' });
  await ageStart(code);
  await call({ action: 'score', code, ...a, score: 100, finished: true, seconds: 10, round: 1 });
  const st = await call({ action: 'state', code, ...host });
  check('普通屋照旧：屋主没交卷，这一局就还没完', st.body.roundOver === false, String(st.body.roundOver));
}

// ---- ⑤ 账上没有主持人 -----------------------------------------------------
//
// 榜单那台设备每次轮询都会「交一次卷」（客户端的 sitOut）。不拦的话这些 0 分会
// 一局一局记进 total / rounds，最后那张竞赛排名图上多一个打了十局全是 0 的人。
{
  const { code, host } = await open(true);
  const a = await join(code, '甲');
  const b = await join(code, '乙');
  for (const round of [1, 2]) {
    await call({ action: 'start', code, ...host, mode: 'square' });
    await ageStart(code);
    // 主持人那台设备照客户端的做法报一次「我不打了」
    await call({ action: 'score', code, ...host, score: 0, finished: true, round });
    await call({ action: 'score', code, ...a, score: 100 * round, finished: true, seconds: 10, round });
    await call({ action: 'score', code, ...b, score: 200 * round, finished: true, seconds: 20, round });
  }
  const card = await call({ action: 'end', code, ...host });
  const me = seatOf(card.body, host.playerId);
  const ga = seatOf(card.body, a.playerId);
  check('主持人身上一局都没记（rounds = 0）', (me.rounds || 0) === 0, `rounds=${me.rounds}`);
  check('主持人身上一分都没记（总分 = 0）', (me.total || 0) + (me.score || 0) === 0, `${me.total}+${me.score}`);
  check('主持人身上没有「单局最高」', (me.best || 0) === 0, `best=${me.best}`);
  // 尺子：选手的账是真记上了——不然上面三条在一间什么都没记的屋子里也是绿的。
  check('选手的账真的记上了（尺子）', (ga.total || 0) + (ga.score || 0) === 300 && ga.rounds === 2,
    `甲 ${ga.total}+${ga.score} / ${ga.rounds} 局`);
}
{
  // 普通屋的对照：屋主的分照旧要记。
  const { code, host } = await open(false);
  const a = await join(code, '甲');
  await call({ action: 'start', code, ...host, mode: 'square' });
  await ageStart(code);
  await call({ action: 'score', code, ...host, score: 77, finished: true, seconds: 7, round: 1 });
  await call({ action: 'score', code, ...a, score: 88, finished: true, seconds: 8, round: 1 });
  const card = await call({ action: 'end', code, ...host });
  const me = seatOf(card.body, host.playerId);
  check('普通屋照旧：屋主的分记在账上', (me.total || 0) + (me.score || 0) === 77 && me.rounds === 1,
    `${me.total}+${me.score} / ${me.rounds} 局`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
