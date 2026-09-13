/**
 * 小屋的并发门：同一名玩家的几条路同时落地，谁也不能把谁写回去。
 *
 *   node scripts/check-room-races.mjs
 *
 * 不起服务器、不开浏览器：库用进程内的那一份（ALLOW_MEMORY_STORE），直接叫
 * api/room.js 的 handler，并发那几条用 Promise.all 一起发——一个一个发的版本
 * 永远是绿的，量不到任何东西。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * api/room.js 开头那条原则——「小屋存成 Redis hash，一个玩家一个 field」——
 * 只贯彻了一半：**跨玩家**确实互不相干，可**同一个玩家**的座位 `p:<id>` 仍
 * 是一份 JSON 文档，而写它的有五条路（score / state / bye / leave / learn），
 * 全是读—改—写。两条路同时落地，后写的那份带着自己进函数时读到的旧快照，
 * 把中间那次写入整个盖掉。
 *
 * 客户端的两个循环本来就互不协调，所以这不是极端情况，是日常：
 *
 *   · watchRoom 每秒轮询一次（ui/scoreboard.ts），心跳每 4 秒真写一次库
 *     （SEEN_WRITE_MS）——大约每四次报分就有一次撞上的窗口；
 *   · 关网页那一下的 beacon（engine/room.ts 的 bye）和拆卸时最后一次报分
 *     同时飞出去；
 *   · 点《离开》和最后一次报分同理。
 *
 * 玩家看到的就是「分数对不上」：打完一局分数回退成中途那个数，或者干脆是
 * 0；交卷标记一起丢掉之后，全屋还要继续等一个已经交过卷的人。
 *
 * 五条场景（前四条是并发，第五条是「同一件事存了两份」）：
 *
 *   ① score 撞 state（心跳）  → 分数和交卷都要留着
 *   ② score 撞 bye（关网页）  → 分数和交卷要留着，而且 closed 要成立
 *   ③ score 撞 leave（离开）  → 分数要留着，left 和 finished 要为真
 *   ④ 拿旧局次报分            → 不记分，但座位要放下，而且回包说得出来
 *   ⑥ 散场之后重读一次        → 最后一局不能被算两遍
 *
 * ④ 的守卫本身没问题，它挡的正是断线重连带回来的旧分。要守的是它挡完之后的
 * 两件事：**座位要放下**（不然全屋等一个在打旧局的人，等到天荒地老），以及
 * **丢掉了要说得出来**（从前静默回 200，客户端会拿同一个对不上的局次一直报
 * 下去，每一次都收到「成功」）。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const room = (await import('../api/room.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');

const call = async (body) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await room({ method: 'POST', headers: {}, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};

// 开小屋要天才身份。用一个内部码账号：权益记在我们自己的库里，不问 Creem。
const account = newAccount('ccc333', 'code');
account.until = Date.now() + 9e8;
await saveAccount('racehost@example.com', account);
const who = { email: 'racehost@example.com', accountToken: account.token };

/** 开一间打着一局的小屋，返回屋主和一位客人的钥匙。 */
async function openRoom() {
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const g = await call({ action: 'join', code, name: '客人' });
  const guest = { playerId: g.body.playerId, playerToken: g.body.playerToken };
  await call({ action: 'start', code, ...host, mode: 'square' });
  return { code, host, guest };
}
const seatOf = (st, id) => (st.body.players || []).find((p) => p.id === id) || {};

// ---- ① 报分撞上心跳 ------------------------------------------------------
{
  const { code, host, guest } = await openRoom();
  await Promise.all([
    call({ action: 'score', code, ...guest, score: 500, finished: true, seconds: 30 }),
    call({ action: 'state', code, ...guest }),
  ]);
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('① 报分撞心跳：分数留着', p.score === 500, String(p.score));
  check('① 报分撞心跳：交卷标记留着', p.finished === true, String(p.finished));
}

// ---- ② 报分撞上关网页 ----------------------------------------------------
//
// 玩家打完最后一步随手切应用或锁屏：pagehide 的 beacon 和拆卸时最后一次报分
// 同时飞出去。分数要留着，而「终端关了」也要照常成立——closed 和 away（网差）
// 是两件事，屋主 closed 整间小屋就散了。
{
  const { code, host, guest } = await openRoom();
  await Promise.all([
    call({ action: 'score', code, ...guest, score: 900, finished: true, seconds: 42 }),
    call({ action: 'bye', code, ...guest }),
  ]);
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('② 报分撞关网页：分数留着', p.score === 900, String(p.score));
  check('② 报分撞关网页：交卷标记留着', p.finished === true, String(p.finished));
  check('② 报分撞关网页：closed 照常成立', p.closed === true, String(p.closed));
}

// ---- ③ 报分撞上离开 ------------------------------------------------------
//
// leave() 自己的注释写得很清楚：「他离开时正打着的那一局要照记，分数在
// leave 里原样留着」。竞态把这个意图打败了——竞赛排名图上那一局是 0 分。
{
  const { code, host, guest } = await openRoom();
  await Promise.all([
    call({ action: 'score', code, ...guest, score: 700, finished: true, seconds: 55 }),
    call({ action: 'leave', code, ...guest }),
  ]);
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('③ 报分撞离开：分数留着', p.score === 700, String(p.score));
  check('③ 报分撞离开：算他交了卷（不然全屋等一个走了的人）', p.finished === true, String(p.finished));
  check('③ 报分撞离开：标着走了', p.left === true, String(p.left));
}

// ---- ④ 拿旧局次报分：不记分、不卡屋、说得出来 --------------------------
//
// 三件事一起要成立。「不卡屋」这一条守的是断线重连：他网断了一分半，这一局
// 不再等他，屋主开了下一局；他网回来把上一局的分报上来，守卫挡住。挡得对，
// 可光挡不够：他那一端轮询没停，lastSeen 一直新鲜，「九十秒没消息就不等」那
// 条路于是永远走不到，而他在新这一局里又永远不会交卷——全屋无限期卡在等他，
// 直到有人受不了解散重开。所以守卫挡下来的同时还要把他这一局的座位放下。
//
// 这儿量的是座位上的 finished，不是 roundOver：roundOver 就是「每个还在的座位
// 都 finished」这个纯函数（已经有别的门盯着），而它多一道 startAt 门槛——要等
// 开局倒数真的走完。为把一个纯函数再推一遍而让这台门干等八秒半，不值。
{
  const { code, host, guest } = await openRoom();
  const r = await call({ action: 'score', code, ...guest, score: 400, finished: true, seconds: 20, round: 99 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('④ 旧局次：分数一个字不写', p.score === 0, String(p.score));
  check('④ 旧局次：把座位放下（不然全屋无限期等一个在打旧局的人）', p.finished === true, String(p.finished));
  check('④ 旧局次：回包带着服务器现在的局次（客户端据此对表）', r.body.round === 1, String(r.body.round));
  check('④ 旧局次：回包明说「这一份被丢掉了」', r.body.scoreDropped === true, String(r.body.scoreDropped));
}

// ---- ④乙 局次对上了就要盖回来 --------------------------------------------
//
// 上一条把座位标成了「0 分交卷」，这一条守的是它能自己纠正回来：他下一次轮询
// 拿到新局次，报上来的 round 对得上，真实分数照常写进去。要是一次旧局次就把
// 他钉死在 0 分，这一局他白打。
{
  const { code, host, guest } = await openRoom();
  await call({ action: 'score', code, ...guest, score: 400, finished: true, seconds: 20, round: 99 });
  await call({ action: 'score', code, ...guest, score: 640, finished: true, seconds: 33, round: 1 });
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('④乙 局次对上了：真实分数盖回来', p.score === 640, String(p.score));
  check('④乙 局次对上了：用时也跟上（最快玩家要用它）', p.seconds === 33, String(p.seconds));
}

// ---- ⑤ 教学那条路也不能把分数写回去 --------------------------------------
//
// learn() 同样是读整个座位、加上 learningAt 再整份写回去。撞上报分的概率比
// 心跳低（看教学是开局前主动点的），机制完全一样。
{
  const { code, host, guest } = await openRoom();
  await Promise.all([
    call({ action: 'score', code, ...guest, score: 300, finished: true, seconds: 12 }),
    call({ action: 'learn', code, ...guest, learning: false }),
  ]);
  const p = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('⑤ 报分撞看教学：分数留着', p.score === 300, String(p.score));
  check('⑤ 报分撞看教学：交卷标记留着', p.finished === true, String(p.finished));
}

// ---- ⑥ 散场之后重读一次，最后一局不能被算两遍 --------------------------
//
// 这一条不是并发，是「同一件事存了两份」的那个坑，而它正是把成绩搬进 r: 那一格
// 之后新开的坑（所以钉在这台门上）。
//
// 屏幕上每一处总分算的都是 total + score（ui/roomCard.ts 的 liveTotal、
// multiplayer.ts 的排行、roomNotices.ts）。end() 把这一局并进 total，座位里的
// score 清成 0——可 r: 那一格要是没跟着清，readRoom 会把 N 折回座位上，
// total + score 就成了 (old + N) + N。
//
// 屋主看不出来：他手上那张卡是 end 的回包，banked 盖过了库里那一份。屋里其他
// 人照旧在轮询，他们那一份是从库里**重读**的——于是只有别人的屏幕上翻倍。所以
// 这里必须多问一次 state，光看 end 的回包是绿的。
//
// 2026-09 量到过一次：两人各 100 / 200 分，重读一次变 200 / 400。
{
  const { code, host, guest } = await openRoom();
  await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
  await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
  const card = await call({ action: 'end', code, ...host });
  const sum = (st, id) => {
    const p = seatOf(st, id);
    return (p.total || 0) + (p.score || 0);
  };
  check('⑥ 散场回包：客人的总分是 200', sum(card, guest.playerId) === 200, String(sum(card, guest.playerId)));
  const reread = await call({ action: 'state', code, ...guest });
  check('⑥ 重读一次：还是 200，没算两遍', sum(reread, guest.playerId) === 200, String(sum(reread, guest.playerId)));
  check('⑥ 重读一次：屋主还是 100', sum(reread, host.playerId) === 100, String(sum(reread, host.playerId)));
  // 用时不能跟着清掉——那张卡上「用时」那一行读的就是它。
  check('⑥ 重读一次：用时还在（卡上要印）', seatOf(reread, guest.playerId).seconds === 20, String(seatOf(reread, guest.playerId).seconds));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
