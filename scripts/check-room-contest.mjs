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
 *
 * ⑦（10-11 方案 C-1）：竞赛屋那张卡上的分要有服务器的尺子——倒数里报的分记 0 不钉 final、用时不短于服务器
 * 量的「开到现在 − 3 秒」、分数不超过这一局的棋盘和玩法打得出的上界。
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

// ---- ⑥ 「屋里可能有新手」不算主持人 ---------------------------------------
//
// 开局时如果屋里有人没看过这一族的教学，全屋的倒数多留四秒（ASK_MS），而那个人的
// 设备会问他「会不会玩」。竞赛屋的主持人**不参赛**（见 isSpectator），所以他会不会
// 玩这一族跟这一局没关系。
//
// 不排掉他的话：他那台设备从来不打，`seen` 里永远是空的，于是**每一局**都被判「可能
// 有新手」——倒数一直从 8 数起、每一局都白等四秒，而那四秒是留给一个压根不下场的人
// 的；那一屏「你会玩吗」也会弹到他脸上。屏幕上不报错，只是每局都慢四秒。
//
// 量的是 countFrom：没有新手就是 4（横屏玩法 5），有新手就 +4。
{
  const { code, host } = await open(true);
  const a = await join(code, '甲');
  const b = await join(code, '乙');
  // 两名选手都说自己看过方块这一族了；主持人什么都没说（他不下场）。
  await call({ action: 'learn', code, ...a, learning: false, seen: ['square'] });
  await call({ action: 'learn', code, ...b, learning: false, seen: ['square'] });
  const st = await call({ action: 'start', code, ...host, mode: 'square' });
  check(
    '⑥ 竞赛屋：两名选手都看过教学 → 倒数不多留那四秒（主持人不算新手）',
    st.body.countFrom === 4,
    `countFrom=${st.body.countFrom}`,
  );
  // 尺子：这一条得真的量到了「多留四秒」这件事，不然上面那条在一个永远回 4 的实现
  // 里也是绿的。让一名选手变回「没看过」，倒数必须变长。
  const { code: c2, host: h2 } = await open(true);
  const a2 = await join(c2, '甲');
  const b2 = await join(c2, '乙');
  await call({ action: 'learn', code: c2, ...a2, learning: false, seen: ['square'] });
  void b2; // 乙一句没说 = 没看过
  const st2 = await call({ action: 'start', code: c2, ...h2, mode: 'square' });
  check(
    '⑥ 尺子：真有一名选手没看过 → 倒数确实多留四秒',
    st2.body.countFrom === 8,
    `countFrom=${st2.body.countFrom}`,
  );
}

// ---- ⑦ 报上来的分数和用时有一把服务器的尺子（10-11 方案 C-1）-----------------------
//
// 原先竞赛屋里倒数还没走完就能报一份「999999999 / 交卷 / 1 秒」：`final` 当场钉死，之后他自己真打的那几条一律
// 丢掉，那张要发出去的竞赛排名卡上第一名和「单局最快」都归他。三把尺子：
//   甲 倒数里报的分记 0、不钉 final（坐场边那些人的「这一局不打」照记交卷，不让别人等）；
//   乙 用时不短于服务器量的「开到现在 − 3 秒」；
//   丙 分数不超过这一局的棋盘和玩法打得出的上界（_maxscore.js 那一套：基础 T、老虎机 S、无限反转的宽松上界）。
{
  const { stepCeiling, slotCeiling, flipCeiling } = await import('../api/_maxscore.js');
  const raw = async (code, id) => (await hgetall(roomKey(code)))['r:' + id] || {};

  // 甲：倒数里报分
  const { code, host } = await open(true);
  const a = await join(code, '甲');
  const b = await join(code, '乙');
  const started = await call({ action: 'start', code, ...host, mode: 'square' });
  check('⑦甲（尺子）报分那一刻还在倒数', started.body.startAt > Date.now(), `${started.body.startAt - Date.now()}ms`);
  const early = await call({ action: 'score', code, ...a, score: 999999999, finished: true, seconds: 1, round: 1 });
  const ea = seatOf(early.body, a.playerId);
  const ra = await raw(code, a.playerId);
  check('⑦甲 倒数里报的 999999999 记成 0', ea.score === 0 && ra.score === 0, `回包 ${ea.score} / 库里 ${ra.score}`);
  check('⑦甲 而且不钉 final、用时不记', ra.final !== true && (ra.seconds === null || ra.seconds === undefined),
    JSON.stringify(ra));
  check('⑦甲 带着交卷来的照记交卷（坐场边的人不让别人等）', ra.finished === true, String(ra.finished));
  // 开赛之后他自己真打的那一条盖得回去（没有 final 挡着）。
  await ageStart(code);
  const real = await call({ action: 'score', code, ...a, score: 520, finished: true, seconds: 3, round: 1 });
  const ra2 = await raw(code, a.playerId);
  check('⑦甲 开赛之后他真打的分盖得回去', seatOf(real.body, a.playerId).score === 520 && ra2.final === true,
    `${seatOf(real.body, a.playerId).score} / final=${ra2.final}`);

  // 乙：报 1 秒。把开赛时刻拨到 30 秒前（两名选手的 joinedAt 也拨到那之前，不然他们成了「开赛之后才进来的」）。
  const hash = await hgetall(roomKey(code));
  const startAt = Date.now() - 30_000;
  await hset(roomKey(code), 'meta', { ...hash.meta, startAt });
  await hset(roomKey(code), 'p:' + b.playerId, { ...hash['p:' + b.playerId], joinedAt: startAt - 1000 });
  await call({ action: 'score', code, ...b, score: 300, finished: true, seconds: 1, round: 1 });
  const rb = await raw(code, b.playerId);
  check('⑦乙 开了 30 秒报「1 秒打完」：用时按服务器量的记（30 − 3 = 27 上下）', rb.seconds >= 26 && rb.seconds <= 28,
    `seconds=${rb.seconds}`);
  // 尺子：老实报的不动。
  const { code: c2, host: h2 } = await open(true);
  const a2 = await join(c2, '甲');
  await join(c2, '乙');
  await call({ action: 'start', code: c2, ...h2, mode: 'square' });
  await ageStart(c2);
  await call({ action: 'score', code: c2, ...a2, score: 300, finished: true, seconds: 12, round: 1 });
  const honest = await raw(c2, a2.playerId);
  check('⑦乙（尺子）刚开赛就交卷、报 12 秒：照记 12', honest.seconds === 12, `seconds=${honest.seconds}`);

  // 丙：超上界按上界截断。三种玩法各一间，同一份 999999999。
  for (const [label, extra, want] of [
    ['基础方块（T）', {}, Math.floor(stepCeiling('square'))],
    ['老虎机方块（S）', { slot: 'same' }, Math.floor(slotCeiling('square'))],
    ['无限反转方块（宽松上界）', { flip: true }, Math.floor(flipCeiling('square'))],
    ['六边形小球（T）', { mode: 'circleHex' }, Math.floor(stepCeiling('circleHex'))],
  ]) {
    const { code: c, host: h } = await open(true);
    const x = await join(c, '甲');
    await join(c, '乙');
    await call({ action: 'start', code: c, ...h, mode: 'square', ...extra });
    await ageStart(c);
    await call({ action: 'score', code: c, ...x, score: 999999999, finished: true, seconds: 40, round: 1 });
    const r = await raw(c, x.playerId);
    check(`⑦丙 ${label}：999999999 截到 ${want}`, r.score === want, `score=${r.score}`);
  }
  // 尺子：上界以内的分一分不动。
  {
    const { code: c, host: h } = await open(true);
    const x = await join(c, '甲');
    await join(c, '乙');
    await call({ action: 'start', code: c, ...h, mode: 'square' });
    await ageStart(c);
    await call({ action: 'score', code: c, ...x, score: 12345, finished: true, seconds: 40, round: 1 });
    check('⑦丙（尺子）上界以内的 12345 一分不动', (await raw(c, x.playerId)).score === 12345);
  }
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
