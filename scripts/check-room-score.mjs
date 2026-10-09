/**
 * 报分这一条路上三件事：散场之后不收、交过卷的不许被盖回去、用时说不通只丢用时。
 *
 *   node scripts/check-room-score.mjs
 *
 * 不起服务器、不开浏览器：库用进程内那一份（ALLOW_MEMORY_STORE）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 一局里客户端报很多次分：打的过程中每隔一会儿一条（分数变了就发，没变也按心跳发，
 * 见 ui/scoreboard.ts），走完那一下报一条带 `finished` 的，拆计分板的时候再补一条。
 * **它们是 `void` 发出去的，谁都没等谁**——网路上后发先至是常事。
 *
 * ① **散场之后到的那些。** 上面那道「收尾中」只挡 LOCK_STALE_MS（20 秒）那么宽，而
 *    一份报分迟到二十秒太平常（手机息屏、地铁里那一格信号）。写进去的话：这一局的
 *    分早就记进 `t:` 了，而 `readRoom` 把 `r:` 折回座位上——屋里还看着那张战绩卡的人，
 *    屏幕上的 `total + score` 把最后一局**算了两遍**。
 *
 * ② **交过卷之后到的那条「还在打」。** 交卷那一条先落地，半秒前那条「还在打、430
 *    分」后落地，整格被盖回「没交卷、430 分」：他那个勾没了、分数退了一截，而
 *    `roundOver` 等的是「每个还在的人都交卷了」——他人早就关了页面，屋里其他人要干等
 *    满 ABSENT_MS（90 秒）。
 *
 *    **带着 finished 的也一样盖不动**（2026-10-08 方案 1-1）。从前那一条照写，理由是「拆
 *    计分板时还会补一条」；可那一条报的是钉死的同一个数（ui/scoreboard.ts 的 settleOnce），
 *    挡掉什么都不少，而照写等于让人交完卷再改分——竞赛屋里就是看完别人的分再改自己的。
 *
 *    挡这件事用的是 `final` 这一位，不是 `finished`：后者有两个来路，一个是「他真的交
 *    卷了」，另一个是「局次对不上，就当他这一局 0 分交了」——后者是**替他猜的**，而且
 *    必须能被真实分数纠正回来（见 ④）。
 *
 * ⑩ **不带局次的、屋里还没开局的：一个字都不写。** 两个调用点早就都带局次了，剩下会不带
 *    的只有手搓的请求，而「不带就照写」那条后路恰好绕得过 ④ 那道闸（方案 1-1）。
 *
 * ③ **用时说不通的时候只丢用时，分照记。** 分数是这一局的成绩，用时只多喂一个「单局
 *    最快」；为一个说不通的秒数把整份报分退回去，等于拿他这一局的分去赌这把尺子没写
 *    错。尺子只在**开赛之后**架得起来（倒数里「用了多久」压根不存在）。
 *
 * ⑪ **报上来的分封在 MAX_SCORE（十亿）以内，累计总分保持有限数**（10-09 补充方案 7-6）。从前
 *    只收拾负数和非数字：一份 1e300 原样存下，名单上印着 1e+300；1e308 两局一加溢出成 Infinity，
 *    写进库里（JSON）变成 null，读回来是 0——一晚上的累计总分悄悄清零。封顶之前就存进去的旧数，
 *    记账（bankRound）那一头再夹一次。上限和排行榜是同一个常量（api/_maxscore.js）。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const room = (await import('../api/room.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');
const { hdel, hgetall, hset } = await import('../api/_store.js');
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
    { method: 'POST', headers: { 'x-forwarded-for': `198.24.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}` }, body },
    res,
  );
  return { status, body: JSON.parse(text || '{}') };
};

const account = newAccount('sss999', 'code');
account.until = Date.now() + 9e8;
await saveAccount('scorehost@example.com', account);
const who = { email: 'scorehost@example.com', accountToken: account.token };

/** 这一局「已经开了多久」——`openRoom(RAN_FOR_S)` 摆的就是这个数。 */
const RAN_FOR_S = 20;

/**
 * 开一间打着第一局的屋。
 *
 * @param ranForS 大于 0 就把开赛时刻摆到这么多秒以前（这一局已经开了这么久）；0 是
 *   「倒数还没走完」。
 *
 * **摆库，不是真等**：倒数是 4.5 秒（屋里有人没看过教学还要再加 4 秒），这台门十来节各
 * 等一遍就是半分钟——而 `check` 那条 CI 的节奏不许被拖慢（等得久的检查最后一定会被人跳
 * 过）。摆出来的状态和等出来的一模一样，而且**更准**：量那把用时的尺子要的正是「这一局
 * 开了多久」这个确定的数，等出来的是 0.06 秒，摆出来的是 20 秒。
 */
async function openRoom(ranForS = 0) {
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const g = await call({ action: 'join', code, name: '客人', seen: ['square', 'circle'] });
  const guest = { playerId: g.body.playerId, playerToken: g.body.playerToken };
  await call({ action: 'learn', code, ...host, learning: false, seen: ['square', 'circle'] });
  const st = await call({ action: 'start', code, ...host, mode: 'square' });
  let startAt = st.body.startAt;
  if (ranForS > 0) {
    const hash = await hgetall(roomKey(code));
    startAt = Date.now() - ranForS * 1000;
    await hset(roomKey(code), 'meta', { ...hash.meta, startAt });
    // ⚠️ 两个人的 `joinedAt` 也要跟着往前挪。记账那一句挡「来晚了的人」用的是
    // `joinedAt > startAt`（bankRound），而他们是在**真的**开赛时刻之前几毫秒进来的
    // ——把开赛时刻摆到 20 秒前，他们俩就都成了「这一局开了之后才进来的」，于是
    // 散场那张卡上两个人都是 0 分。第一版漏了这一句，①那一节当场红。
    for (const id of [host.playerId, guest.playerId]) {
      await hset(roomKey(code), 'p:' + id, { ...hash['p:' + id], joinedAt: startAt - 1000 });
    }
  }
  return { code, host, guest, startAt };
}
const seatOf = (st, id) => (st.body.players || []).find((p) => p.id === id) || {};
const runOf = async (code, id) => (await hgetall(roomKey(code)))['r:' + id];

// ---- ① 散场之后报上来的分：一个字都不写 ---------------------------------
//
// **故意把那把 end 锁拆掉**再报：留着的话挡住它的可能是「收尾中」那一道（锁还新鲜），
// 量到的就不是这一条。拆掉之后屋里只剩 `endedAt` 这一个事实——线上二十秒后的样子。
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
  await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
  const card = await call({ action: 'end', code, ...host });
  const before = seatOf(card, guest.playerId);
  check('① 量程：散场那张卡上客人是 200 分', (before.total || 0) + (before.score || 0) === 200,
    `${before.total} + ${before.score}`);
  await hdel(roomKey(code), 'le:end');
  const late = await call({ action: 'score', code, ...guest, score: 190, finished: false, round: 1 });
  check('① 散场之后报分：回包明说没收下', late.body.scoreDropped === true, String(late.body.scoreDropped));
  const run = await runOf(code, guest.playerId);
  check('① 那一格一个字都没写（不然战绩卡把最后一局算两遍）', !run || run.score === 0, JSON.stringify(run));
  const after = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('① 重读一张卡：客人还是 200', (after.total || 0) + (after.score || 0) === 200,
    `${after.total} + ${after.score}`);
}

// ---- ② 交过卷之后，迟到的那条「还在打」盖不动它 -------------------------
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  // 12 秒落在尺子里面（这一局摆成已经开了 RAN_FOR_S＝20 秒，上限是 20＋15）。这一节量
  // 的是 final，不是尺子——报一个说不通的秒数，那一下会看起来像「用时莫名丢了」。
  await call({ action: 'score', code, ...guest, score: 500, finished: true, seconds: 12, round: 1 });
  const late = await call({ action: 'score', code, ...guest, score: 430, finished: false, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('② 迟到那条不带 finished：回包明说没收下', late.body.scoreDropped === true, String(late.body.scoreDropped));
  check('② 分数还是 500', p.score === 500, String(p.score));
  check('② 交卷的勾还在（不然全屋等一个已经走的人）', p.finished === true, String(p.finished));
  check('② 用时也还在', p.seconds === 12, String(p.seconds));
  // 交完卷再来一条带 finished 的（想改分）：也盖不动。拆计分板时补的那一条报的是钉死的
  // 同一个数，挡掉什么都不少（见文件头 ②）。
  const last = await call({ action: 'score', code, ...guest, score: 9999, finished: true, seconds: 13, round: 1 });
  const q = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('② final 之后再发一条带 finished 的：被丢，回包明说没收下', last.body.scoreDropped === true,
    String(last.body.scoreDropped));
  check('② 分数还是交卷那一刻的 500（不许交完卷再改分）', q.score === 500, String(q.score));
  check('② 用时也还是交卷那一刻的', q.seconds === 12, String(q.seconds));
}

// ---- ③ 没交卷之前，一条条盖上去是正常的 --------------------------------
//
// ② 的量程：别把「打着的时候每隔一会儿报一次」也挡掉了。
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  await call({ action: 'score', code, ...guest, score: 100, finished: false, round: 1 });
  await call({ action: 'score', code, ...guest, score: 260, finished: false, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('③ 打着的时候：后一条照旧盖得上去', p.score === 260, String(p.score));
  check('③ 而且没被当成丢掉', p.finished === false, String(p.finished));
}

// ---- ④ 「局次对不上」那条自我纠正，不许被 final 挡住 --------------------
//
// 这一条是 `final` 为什么要和 `finished` 分开的正身。拿旧局次报分，服务器会把他的座位
// 标成「0 分交卷」（不然全屋无限期等一个在打旧局的人）——那是**替他猜的**，而注释里写
// 着「真实分数照常盖回去」。要是那一下也写了 `final`，他接下来那条「还在打」就被挡
// 住，他这一局白打。
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  const dropped = await call({ action: 'score', code, ...guest, score: 400, finished: true, seconds: 20, round: 99 });
  check('④ 量程：旧局次那一条确实被丢掉了', dropped.body.scoreDropped === true, String(dropped.body.scoreDropped));
  const mid = await runOf(code, guest.playerId);
  check('④ 量程：座位被放下了（finished），但没有 final', mid.finished === true && !mid.final, JSON.stringify(mid));
  check('④ 带错局次的那 400 分没写进这一局', mid.score === 0, String(mid.score));
  const fix = await call({ action: 'score', code, ...guest, score: 120, finished: false, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('④ 局次对上的那条「还在打」：写得进去', p.score === 120, String(p.score));
  check('④ 而且没被当成丢掉', fix.body.scoreDropped === undefined, String(fix.body.scoreDropped));
}

// ---- ⑤ 用时：开赛之后，比「这一局开了多久」还长的那个数丢掉 -------------
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  // 这一局开了 20 秒，报一个「打了一小时」。
  const r = await call({ action: 'score', code, ...guest, score: 700, finished: true, seconds: 3600, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑤ 说不通的用时：丢掉', p.seconds === null, String(p.seconds));
  check('⑤ 分照记（不拒掉整份）', p.score === 700, String(p.score));
  check('⑤ 交卷的勾照记', p.finished === true, String(p.finished));
  check('⑤ 没被当成丢掉（那是另一件事）', r.body.scoreDropped === undefined, String(r.body.scoreDropped));
}

// ---- ⑥ 用时：尺子两头各量一次 ------------------------------------------
//
// ⑤ 的量程，而且是**贴着边界**量的：这一局摆成已经开了 RAN_FOR_S（20 秒），尺子就是
// 20 ＋ SECONDS_SLACK_S（15）＝ 35 秒。只拿「一小时」那种离谱的数量，这把尺子是 35 还是
// 3500 都看不出来——那就成了「尺子在不在」的门，不是「尺子对不对」的门。
//
// 两头各开一间屋：交过卷（final）之后同一个座位什么都写不进去了（见 ②），所以不能在同一
// 个座位上先报 30 再报 45。
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  await call({ action: 'score', code, ...guest, score: 700, finished: true, seconds: 30, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑥ 30 秒（线里面）：照记', p.seconds === 30, String(p.seconds));
}
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  await call({ action: 'score', code, ...guest, score: 710, finished: true, seconds: 45, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑥ 45 秒（线外面）：丢掉，分照记', p.seconds === null && p.score === 710, `${p.seconds} / ${p.score}`);
}

// ---- ⑦ 倒数还没走完的时候不量 ------------------------------------------
//
// 那会儿「用了多久」压根不存在（这一局一步都还没走），`Date.now() - startAt` 是负的。
// 拿一把量不出东西的尺子去裁，裁掉的只会是别的东西——倒数里真会来的那种「交卷」是客
// 户端的 sitOut（开局之后才进来的人、竞赛屋的主持人），它本来就不带 seconds。
{
  const { code, host, guest, startAt } = await openRoom(0);
  check('⑦ 量程：这会儿倒数还没走完', startAt > Date.now(), `还有 ${startAt - Date.now()}ms`);
  await call({ action: 'score', code, ...guest, score: 300, finished: true, seconds: 20, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑦ 倒数里报的用时：照记（这儿没有尺子，不装作有）', p.seconds === 20, String(p.seconds));
}

// ---- ⑧ 用时不是个数 / 是负数：只丢用时 ---------------------------------
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  await call({ action: 'score', code, ...guest, score: 800, finished: true, seconds: -5, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑧ 负数用时：丢掉，分照记', p.seconds === null && p.score === 800, `${p.seconds} / ${p.score}`);
}
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  await call({ action: 'score', code, ...guest, score: 900, finished: true, seconds: '快得很', round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑧ 不是个数：丢掉，分照记', p.seconds === null && p.score === 900, `${p.seconds} / ${p.score}`);
}

// ---- ⑨ 没交卷的时候，用时一律不记 --------------------------------------
//
// 老规矩（「单局最快」量的是打完用了多久，不是打到哪儿了），一起钉住。
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  await call({ action: 'score', code, ...guest, score: 300, finished: false, seconds: 5, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑨ 还没交卷：用时不记', p.seconds === null, String(p.seconds));
}

// ---- ⑩ 不带局次的、屋里还没开局的：一个字都不写 -------------------------
{
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  const bare = await call({ action: 'score', code, ...guest, score: 666, finished: true, seconds: 10 });
  check('⑩ 不带局次：回包明说没收下', bare.body.scoreDropped === true, String(bare.body.scoreDropped));
  const run = await runOf(code, guest.playerId);
  check('⑩ 不带局次：那一格一个字都没写（不替他猜交卷，那是对不上局次那一支的事）',
    !run || (run.score === 0 && !run.finished), JSON.stringify(run));
  const junk = await call({ action: 'score', code, ...guest, score: 666, finished: true, round: '第一局' });
  check('⑩ 局次不是个数：一样被丢', junk.body.scoreDropped === true, String(junk.body.scoreDropped));
  // 尺子：同一个人带对了局次照写——不然上面两条在「谁报都丢」时也绿。
  const ok = await call({ action: 'score', code, ...guest, score: 321, finished: false, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑩ （尺子）带对局次照写', ok.body.scoreDropped === undefined && p.score === 321,
    `${ok.body.scoreDropped} / ${p.score}`);
}
{
  // 屋里还没开过局：没有哪一局可记。
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const g = await call({ action: 'join', code, name: '客人' });
  const r = await call({ action: 'score', code, playerId: g.body.playerId, playerToken: g.body.playerToken,
    score: 50, finished: true, round: 1 });
  check('⑩ 还没开局就报分：被丢', r.body.scoreDropped === true, String(r.body.scoreDropped));
  const run = await runOf(code, g.body.playerId);
  check('⑩ 还没开局：那一格没写', !run || (run.score === 0 && !run.finished), JSON.stringify(run));
}

// ---- ⑪ 报分封顶：1e300 存下来是十亿，累计总分一直是有限数（10-09 补充方案 7-6） ----------
{
  const { MAX_SCORE } = await import('../api/_maxscore.js');
  const scoresSrc = (await import('node:fs')).readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8');
  check('⑪（尺子）上限是十亿，排行榜从同一个文件取（不再自己写一份）',
    MAX_SCORE === 1e9 && /import \{ MAX_SCORE \} from '\.\/_maxscore\.js'/.test(scoresSrc) && !/const MAX_SCORE\s*=/.test(scoresSrc),
    String(MAX_SCORE));
  const { code, host, guest } = await openRoom(RAN_FOR_S);
  const live = await call({ action: 'score', code, ...guest, score: 1e300, finished: false, round: 1 });
  check('⑪ 报 1e300（还在打）：照收，没被丢', live.status === 200 && live.body.scoreDropped === undefined, `${live.status} ${live.body.scoreDropped}`);
  check('⑪ 存下来的是十亿', (await runOf(code, guest.playerId))?.score === MAX_SCORE, JSON.stringify(await runOf(code, guest.playerId)));
  check('⑪ 名单上也是十亿（不是 1e+300）', seatOf(live, guest.playerId).score === MAX_SCORE, String(seatOf(live, guest.playerId).score));
  await call({ action: 'score', code, ...guest, score: 1e308, finished: true, seconds: 12, round: 1 });
  check('⑪ 交卷那一条报 1e308：存下来的还是十亿', (await runOf(code, guest.playerId))?.score === MAX_SCORE,
    JSON.stringify(await runOf(code, guest.playerId)));
  await call({ action: 'score', code, ...host, score: 10, finished: true, seconds: 10, round: 1 });
  const r2 = await call({ action: 'start', code, ...host, mode: 'circle' });
  const g2 = seatOf(r2, guest.playerId);
  check('⑪ 记完第 1 局：累计十亿，是有限数', r2.body.round === 2 && g2.total === MAX_SCORE && Number.isFinite(g2.total),
    `round ${r2.body.round} total ${g2.total}`);

  // 封顶之前就存进去的旧数：直接摆进 `r:`（一份 1e308、交了卷），看记账那一头夹不夹。连着两局——
  // 不夹的话第二局 1e308 + 1e308 溢出成 Infinity，存进库里是 null，读回来是 0。
  for (const round of [2, 3]) {
    // 新开的这一局还在倒数（startAt 在几秒之后），倒数里谁交了卷这一局都不算完、开不了下一局：
    // 和 openRoom 一样把开赛时刻摆到 RAN_FOR_S 秒以前。
    const meta = (await hgetall(roomKey(code))).meta;
    await hset(roomKey(code), 'meta', { ...meta, startAt: Date.now() - RAN_FOR_S * 1000 });
    await hset(roomKey(code), 'r:' + guest.playerId, { score: 1e308, finished: true, seconds: 9, final: true, forced: false });
    await call({ action: 'score', code, ...host, score: 10, finished: true, seconds: 10, round });
    const nx = await call({ action: 'start', code, ...host, mode: round === 2 ? 'square' : 'circle' });
    const g = seatOf(nx, guest.playerId);
    check(`⑪ 库里摆着封顶之前的旧数 1e308，记完第 ${round} 局：累计 ${round} × 十亿，是有限数`,
      nx.body.round === round + 1 && g.total === round * MAX_SCORE && Number.isFinite(g.total) && g.best === MAX_SCORE,
      `round ${nx.body.round} total ${g.total} best ${g.best}`);
  }
  const card = await call({ action: 'end', code, ...host });
  const last = seatOf(card, guest.playerId);
  check('⑪ 散场那张卡上：累计总分是有限数，单局最高是十亿', Number.isFinite(last.total) && last.total === 3 * MAX_SCORE && last.best === MAX_SCORE,
    `total ${last.total} best ${last.best}`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
