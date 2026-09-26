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
 * 八条场景（并发四条，「同一件事存了两份」一条，抢锁三条）：
 *
 *   ① score 撞 state（心跳）  → 分数和交卷都要留着
 *   ② score 撞 bye（关网页）  → 分数和交卷要留着；closed 要等过了宽限期
 *   ⑬ 屋主只是刷新了一下网页    → 这几秒里屋里其他人不许看见「屋主走了」
 *   ③ score 撞 leave（离开）  → 分数要留着，left 和 finished 要为真
 *   ④ 拿旧局次报分            → 不记分，但座位要放下，而且回包说得出来
 *   ⑥ 散场之后重读一次        → 最后一局不能被算两遍
 *   ⑦ 两条 start 落在一起      → 记账不能记两遍
 *   ⑧ 两条 end 落在一起        → 同上，那张要发出去的战绩卡上分数不能翻倍
 *   ⑧乙 抢不到锁的那一条        → 要等出一张记完的卡（多人页就是拿它画的）
 *   ⑨ 抢到锁之后半路死掉      → 废锁要能被接手，屋子不许卡到过期
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

const { readFileSync } = await import('node:fs');
const room = (await import('../api/room.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');

/**
 * 每一次调用派一个新的假 IP。
 *
 * api/room.js 现在按 callerId（也就是 IP）分桶限速，而这道门从前发的是空
 * headers——几十个模拟玩家全算成同一个 'unknown'。在没有限速的年代那无所谓；
 * 有了之后，这道门在循环里开十几间小屋就会撞上 create 那个桶（20 次/小时），
 * 于是 create 回 429、code 是 undefined、后面那句 state 回 404，最后崩在
 * `after.body.players is not iterable` 上——看起来像小屋的 bug，其实是门自己
 * 把几十个人挤进了一个 IP。
 *
 * 线上每个人各有自己的 IP，所以这里一人一个（其实是一次一个，更宽松）才是
 * 真实的模型。限速本身归 scripts/check-room-rate.mjs 管，那道门专门量「该挡
 * 的挡住、该放过的不误伤」；这道门量的是服务端的并发写入，两件事不该互相绑住。
 */
let ipSeq = 0;
const nextIp = () => {
  ipSeq++;
  return `198.18.${Math.floor(ipSeq / 254) % 254}.${(ipSeq % 254) + 1}`;
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
// ⑨ 和 ⑩ 要直接摆库里的状态（废锁、推老的心跳），从外面是摆不出来的。
const { hset: hsetRace, hgetall } = await import('../api/_store.js');
const roomKey = (code) => 'room:' + code;
/**
 * 把这个人说 bye 的时刻往前推，推到 BYE_GRACE_MS 以外——等于「时间到了他还
 * 没回来」。直接摆库里的状态，不然这一台要真的干等十秒。
 */
async function agePast(code, playerId) {
  const hash = await hgetall(roomKey(code));
  const beat = hash['h:' + playerId] || {};
  await hsetRace(roomKey(code), 'h:' + playerId, { ...beat, byeAt: 1 });
}

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
  // closed 不再是「一收到 bye 就成立」——刷新一次页面发的是同一个 beacon，见
  // BYE_GRACE_MS。刚发完的这一下只能是 away（屏幕上写「等一下就来」）。
  check('② 报分撞关网页：closed 先不成立（还在宽限期里）', p.closed !== true, String(p.closed));
  // 把 byeAt 往前推过宽限期 = 时间到了他还没回来。
  await agePast(code, guest.playerId);
  const after = seatOf(await call({ action: 'state', code, ...host }), guest.playerId);
  check('② 宽限期过了还没回来：closed 成立', after.closed === true, String(after.closed));
}

// ---- ⑬ 屋主只是刷新了一下网页 --------------------------------------------
//
// 刷新页面和关掉页面，浏览器给的是同一个事件（pagehide，persisted 为假），
// 客户端分不出来，所以两种都会发 bye。从前服务器一收到就把座位标成「终端关
// 了」：屋主的手机自己重载一下（2-4 秒），屋里其他人下一次轮询就看见「屋主走
// 了」——正打着的那一局当场被转单人或者弹「小屋暂时关闭」，一两秒后屋主刷新
// 完人还在，别人却已经被请出这一局，回不去。
//
// 现在要过了 BYE_GRACE_MS 还没再听见他才算数，而刷新完的那台设备一轮询就把
// byeAt 抹掉，自己把自己救回来。
{
  const { code, host, guest } = await openRoom();
  // 屋主的网页被重载：beacon 发出去了。
  await call({ action: 'bye', code, ...host });
  const mid = await call({ action: 'state', code, ...guest });
  const h1 = seatOf(mid, host.playerId);
  check('⑬ 刷新那几秒：客人看不到「屋主走了」', h1.closed !== true, String(h1.closed));
  check('⑬ 刷新那几秒：屋主的座位还在', Boolean(h1.id), JSON.stringify(h1.id));
  // 刷新完了，同一台设备带着同一个身份回来轮询。
  await call({ action: 'state', code, ...host });
  const h2 = seatOf(await call({ action: 'state', code, ...guest }), host.playerId);
  check('⑬ 刷新完：closed 被自己抹掉了', h2.closed !== true, String(h2.closed));
  // 而且这一下之后再怎么等也不会突然变成「走了」：byeAt 已经归零，而 seatClosed
  // 只认大于 0 的 byeAt——「等多久」这件事根本无从谈起。直接量那一格的值，比
  // 再摆一次库里的状态诚实（摆成 1 等于伪造一次他没说过的 bye）。
  const beat = (await hgetall(roomKey(code)))['h:' + host.playerId] || {};
  check('⑬ 回来之后 byeAt 归零，再等多久也不算走', Number(beat.byeAt) === 0, JSON.stringify(beat));
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
  check('④乙 局次对上了：用时也跟上（单局最快要用它）', p.seconds === 33, String(p.seconds));
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

// ---- ⑦ 屋主双击《再来》：两条 start 落在一起，记账不能记两遍 -----------
//
// 客户端那道闸（engine/room.ts 的 startMatch）合并的是同一个网页里的连点，挡
// 不住两个来源：两个分页、手机加电脑、或者请求在路上时页面被刷新（闸随之消
// 失）再按一次。
//
// 服务器这一侧从前没锁。要命的不是种子分叉——那一条躲过去了：所有人拼棋盘的
// 种子都是从每秒一次的轮询里读的，不是开局回包（ui/multiplayer.ts 的
// beginCountdown）——而是**记账记了两遍**：B 的读恰好落在 A 的记账循环中间，
// A 已经把屋主那一格并进 total、meta 还没写，B 就读到一个「记过一半、局次还
// 是旧的、roundOver 还是真」的屋子，把记过的又记一遍。
//
// 实测：屋主 total=200、rounds=2，而他那一局只打了 100 分。要撞上它得让两条
// 请求错开恰好两个微任务——所以这儿不是一把 Promise.all 了事，而是把错位量从
// 0 到 20 挨个走一遍，哪一档都不许记重。
{
  const ticks = (n) =>
    new Promise((r) => {
      let i = 0;
      const go = () => (++i >= n ? r() : queueMicrotask(go));
      queueMicrotask(go);
    });
  let worst = null;
  for (const k of [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 20]) {
    const { code, host, guest } = await openRoom();
    const st = await call({ action: 'state', code, ...host });
    // 开局倒数走完才算得上「这一局打过了」（roundOver 有 startAt 那道门槛）。
    await new Promise((r) => setTimeout(r, Math.max(0, st.body.startAt - Date.now() + 40)));
    await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
    await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
    await Promise.all([
      call({ action: 'start', code, ...host, mode: 'square' }),
      (async () => {
        await ticks(k);
        return call({ action: 'start', code, ...host, mode: 'square' });
      })(),
    ]);
    const after = await call({ action: 'state', code, ...host });
    for (const p of after.body.players) {
      const should = p.id === host.playerId ? 100 : 200;
      if (p.rounds !== 1 || p.total !== should) {
        worst = `错位 ${k}：${p.name} total=${p.total}（该是 ${should}）rounds=${p.rounds}`;
      }
    }
  }
  check('⑦ 双击《再来》：十一档错位，一档都没记重', worst === null, worst || '');
}

// ---- ⑧ 屋主双击《解散小屋》：两条 end 落在一起，记账不能记两遍 ---------
//
// 和 ⑦ 一模一样的账，只是另外半边。今天凌晨只给 start() 加了锁，end() 这个几乎
// 逐字相同的口子留在了原地：第 1266 行的 `if (hash.meta.endedAt) return` 只是
// 「看一眼有没有结束」，不是原子的；而真正写 endedAt 是在整个记账循环**跑完之
// 后**。两条 end 都能过那道闸。
//
// 屋主在手机和平板上同时开着同一间屋，或者网络卡了一下对着《解散小屋》按了两
// 下——三个人这一局各打 100/200/300，那张要发给朋友看的小屋战绩卡上写的是
// 200/400/600。
//
// 和 ⑦ 一样要扫错位：真正同时（错位 0）反而是安全的——两条读到的是同一份快照，
// 各自算出同一个结果，写回去的值一模一样。危险的是 B 的读落在 A 「写完 p: 还没
// 写 r:」那两步之间（或者落在记账循环中途），所以 Promise.all 一把了事很可能是
// 绿的，什么都量不到。
//
// 也和 ⑥ 一样要重读：end 的回包里 banked 盖过了库里那一份，只看回包看不出来。
{
  const ticks = (n) =>
    new Promise((r) => {
      let i = 0;
      const go = () => (++i >= n ? r() : queueMicrotask(go));
      queueMicrotask(go);
    });
  let worst = null;
  for (const k of [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 20]) {
    const { code, host, guest } = await openRoom();
    await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
    await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
    const both = await Promise.all([
      call({ action: 'end', code, ...host }),
      (async () => {
        await ticks(k);
        return call({ action: 'end', code, ...host });
      })(),
    ]);
    const after = await call({ action: 'state', code, ...guest });
    for (const p of after.body.players) {
      const should = p.id === host.playerId ? 100 : 200;
      const sum = (p.total || 0) + (p.score || 0);
      if (sum !== should || p.rounds !== 1) {
        worst = `错位 ${k}：${p.name} 总分=${sum}（该是 ${should}）rounds=${p.rounds}`;
      }
    }
    void both;
  }
  check('⑧ 双击《解散小屋》：十一档错位，战绩卡上一档都没翻倍', worst === null, worst || '');
}

// ---- ⑧乙 抢不到锁的那一条，回的必须是一张记完了的卡 --------------------
//
// 多人页就是拿 end 的回包画那张小屋战绩卡的（ui/multiplayer.ts 第 294 行
// `const card = closed.ok && closed.value.round ? closed.value : null`），而且紧
// 接着 forgetRoom() 就把轮询停了——没有第二次机会。所以抢不到锁的那一条要是直
// 接回「当时库里那一份」，赢的那条还在记账循环里，屋主手上那张要发给朋友看的卡
// 就是记了一半的。那是把翻倍换成另一种错，不算修好。服务端 settled() 等的就是
// 这个：endedAt 写在整段记账的最后，出现即记齐。
//
// **验的是 best 和 bestTime，不是总分。** 这一点差点写错：卡上的总分是
// liveTotal = total + score（roomCard.ts 第 56 行），而记账干的事就是把 score 挪
// 进 total——这个和记不记账都一样，拿它当断言是个恒等式，永远绿。真正只在
// bankRound 里才被写、而且卡上正在用的是这两样：
//   · best —— 「单局最高 · 某某 N」那一行（第 164 行），也是排名的第二档
//     （第 67 行，总分并列时比它）；
//   · bestTime —— 「单局最快」那一行（第 165 行）。
//
// **不靠抢，直接摆出那个状态。** 上面 ⑧ 那样扫错位量不到这件事：内存版的库每
// 次调用一个微任务就回，赢的那条把两个座位记完比输的那条读一次还快，窗口在这
// 台机器上是关着的。真 Redis 上每次往返 50–200ms、二十个座位四十多次往返，窗
// 口敞开着。所以这儿先手写一把新鲜的锁让 end 必定抢不到，200 毫秒之后再放开、
// 让一条真的 end 去记账——量的就是「等没等到账记完」，和快慢无关。
{
  const { hset, hdel } = await import('../api/_store.js');
  const roomKey = (c) => 'room:' + c;
  const { code, host, guest } = await openRoom();
  await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
  await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
  // 装成「已经有一条 end 抢到锁、正在记账」
  await hset(roomKey(code), 'le:end', { at: Date.now() });
  const waiting = call({ action: 'end', code, ...host });
  setTimeout(async () => {
    await hdel(roomKey(code), 'le:end');
    await call({ action: 'end', code, ...host });
  }, 200);
  const card = await waiting;
  let bad = null;
  for (const p of card.body.players || []) {
    const should = p.id === host.playerId ? 100 : 200;
    const time = p.id === host.playerId ? 10 : 20;
    if (p.best !== should || p.bestTime !== time) {
      bad = `${p.name} best=${p.best}（该是 ${should}）bestTime=${p.bestTime}（该是 ${time}）`;
    }
  }
  check('⑧乙 抢不到锁的那一条，等出了一张记完的卡', bad === null, bad || '');
  check('⑧乙 而且那张卡上的总分没被记两遍',
    (card.body.players || []).every((p) => (p.total || 0) + (p.score || 0) === (p.id === host.playerId ? 100 : 200)));
}

// ---- ⑨ 抢到锁之后半路死掉：废锁要能被接手 ------------------------------
//
// 锁本身带来的新毛病。抢锁（hsetnx ls:<局次>）和把新局次写进 meta 之间，隔着一
// 整段记账循环——20 个座位就是 40 次 Redis 往返。这中间任何一次超时抛错，最外层
// 的 catch 回一个 502，而 **meta.round 一步没动、锁也没人删**。
//
// 于是屋主再点《再来一局》，服务器算出来的「下一局」局次和刚才失败那次一模一样
// （拿的是没变过的旧局次），锁的位置也没变，永远抢不到——而且回的是 200，一份
// 「什么都没变」的状态，连错都不报。屋主怎么点都没反应，其他人卡在「等屋主选玩
// 法」，一晚上的战绩只能等这间屋自己过期作废。
//
// 不用真去制造一次 Redis 超时：那次失败留下的唯一痕迹就是「一把没人再动的锁」，
// 所以直接往库里种一把旧时间戳的锁，效果一样，而且量得准。
//
// 三条，两头都要钉住：废锁要接得手，**新鲜的锁绝不许被抢走**（不然就等于没锁，
// ⑦ 和 ⑧ 白修），两条同时来接也只能有一条接到。
{
  const { hset, hget } = await import('../api/_store.js');
  const roomKey = (c) => 'room:' + c;

  // 甲：一把 60 秒前的废锁，挡不住下一局
  {
    const { code, host, guest } = await openRoom();
    const st = await call({ action: 'state', code, ...host });
    await new Promise((r) => setTimeout(r, Math.max(0, st.body.startAt - Date.now() + 40)));
    await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
    await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
    await hset(roomKey(code), 'ls:2', { at: Date.now() - 60_000 });
    const back = await call({ action: 'start', code, ...host, mode: 'square' });
    check('⑨甲 废锁被接手：第 2 局开起来了', back.body.round === 2, `round=${back.body.round}`);
    const after = await call({ action: 'state', code, ...host });
    const h = after.body.players.find((p) => p.id === host.playerId);
    check('⑨甲 接手之后照样只记一遍', h.total === 100 && h.rounds === 1, `total=${h.total} rounds=${h.rounds}`);
  }

  // 乙：一把刚写下的锁，不许抢——这一条守的是「⑦⑧ 修的东西没被自愈机制拆掉」
  {
    const { code, host, guest } = await openRoom();
    const st = await call({ action: 'state', code, ...host });
    await new Promise((r) => setTimeout(r, Math.max(0, st.body.startAt - Date.now() + 40)));
    await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
    await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
    await hset(roomKey(code), 'ls:2', { at: Date.now() });
    const back = await call({ action: 'start', code, ...host, mode: 'square' });
    check('⑨乙 新鲜的锁没被抢走：还是第 1 局', back.body.round === 1, `round=${back.body.round}`);
  }

  // 丙：两条同时来接同一把废锁，只能有一条接到（不然记账又是两遍）
  {
    const { code, host, guest } = await openRoom();
    const st = await call({ action: 'state', code, ...host });
    await new Promise((r) => setTimeout(r, Math.max(0, st.body.startAt - Date.now() + 40)));
    await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
    await call({ action: 'score', code, ...guest, score: 200, finished: true, seconds: 20, round: 1 });
    await hset(roomKey(code), 'ls:2', { at: Date.now() - 60_000 });
    await Promise.all([
      call({ action: 'start', code, ...host, mode: 'square' }),
      call({ action: 'start', code, ...host, mode: 'square' }),
    ]);
    const after = await call({ action: 'state', code, ...host });
    const bad = after.body.players.find((p) => p.rounds !== 1);
    check('⑨丙 两条同时接手，记账还是只记一遍', !bad, bad ? `${bad.name} rounds=${bad.rounds}` : '');
    check('⑨丙 接手之后锁是新鲜的', Number((await hget(roomKey(code), 'ls:2'))?.at) > Date.now() - 30_000);
  }
}

// ---- ⑩ 屋主开下一局，撞上一条真的报分 ----------------------------------
//
// ⑦ 扫的是「两条 start 互相撞」，这一条扫的是「一条 start 撞上一条 score」——
// 昨天凌晨（878da16）补的锁把前者堵住了，后者一个字都没测到，于是漏网。
//
// start() 一进门读一次库，然后去抢开局锁，抢到之后**照着那份旧快照**结算。
// 抢锁这中间要跑一趟库（hsetnx 一个来回），恰好这时候有人把最后一次分报上来
// ——那一份写进的是 `r:<id>`（score() 只写这一格），而旧快照里那一格还是旧
// 的。于是记账按旧的记，紧接着又把 `r:` 清成 CLEAR_ROUND：新报的分连记带存
// 两头落空，凭空消失。
//
// 最常见的真实场景：客人网卡了一下被判成「九十秒没消息」，其实他正在补报最后
// 一次分；屋主看着「都交了」就按了《再来》。两件事前后脚到服务器。
//
// 和 ⑦ 一样扫错位：真正同时（错位 0）反而安全（score 在 start 读库之前就落地
// 了）。危险的是它落在「start 读完库」和「start 开始写」之间那几个微任务里。
{
  const ticks = (n) =>
    new Promise((r) => {
      let i = 0;
      const go = () => (++i >= n ? r() : queueMicrotask(go));
      queueMicrotask(go);
    });
  let worst = null;
  for (const k of [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 20]) {
    const { code, host, guest } = await openRoom();
    const st = await call({ action: 'state', code, ...host });
    await new Promise((r) => setTimeout(r, Math.max(0, st.body.startAt - Date.now() + 40)));
    await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
    // 客人被判成「九十秒没消息」——这一局不再等他，屋主于是按得下《再来》。
    // 这正是玩家描述的那一幕：他其实没走，网卡了一下，正在把最后一次分补报
    // 上来。不把心跳推老的话 roundOver 为假，start 直接回 409，这一档什么都
    // 量不到（第一版就是这样，看着「全档失败」，其实是根本没开成局）。
    // 心跳和 joinedAt 都要推老：seenFrom 取的是两者的较大值（刚进屋的人
    // joinedAt 就是此刻，只推心跳的话他照样算「在」，roundOver 为假，start
    // 直接回 409——那一档等于什么都没量到）。
    const rawX = await hgetall('room:' + code);
    await hsetRace(roomKey(code), 'p:' + guest.playerId, { ...rawX['p:' + guest.playerId], joinedAt: Date.now() - 95_000 });
    await hsetRace(roomKey(code), 'h:' + guest.playerId, { lastSeen: Date.now() - 95_000 });
    let told = false;
    await Promise.all([
      call({ action: 'start', code, ...host, mode: 'square' }),
      (async () => {
        await ticks(k);
        const r = await call({ action: 'score', code, ...guest, score: 777, finished: true, seconds: 33, round: 1 });
        told = Boolean(r.body.scoreDropped);
      })(),
    ]);
    const after = await call({ action: 'state', code, ...host });
    const g = seatOf(after, guest.playerId);
    // 只有两种结局算对：
    //   · 赶在立锁之前到的 → 记进 total（抢到锁之后那次重读接住了它）；
    //   · 立锁之后到的     → 一个字都没写，而且**明说没收下**（scoreDropped，
    //                        客户端认得这句，见 ui/scoreboard.ts）。
    // 不许出现第三种：回了成功，分却蒸发。那正是玩家碰上的那一种。
    const banked = (g.total || 0) === 777;
    const refused = (g.total || 0) === 0 && (g.score || 0) === 0 && told;
    if (!banked && !refused) {
      worst = `错位 ${k}：客人 total=${g.total} score=${g.score} 告知=${told}`;
    }
  }
  check('⑩ 开下一局撞上报分：要么记进账，要么明说没收下', worst === null, worst || '');
}

// ---- ⑪ 屋主解散小屋，撞上一条真的报分 ----------------------------------
//
// ⑩ 的另外半边，一模一样的病：end() 也是「先读一次、再抢锁、抢到之后照旧快照
// 结算」。最后一局大家陆续交卷，屋主一看「好像都交了」就按《解散小屋》——这个
// 动作和某个人最后一次报分前后脚到服务器，是最普通不过的场景。那张发出去的小
// 屋战绩卡上，那个人这一局就是 0 分，客户端和服务端都不报错。
{
  const ticks = (n) =>
    new Promise((r) => {
      let i = 0;
      const go = () => (++i >= n ? r() : queueMicrotask(go));
      queueMicrotask(go);
    });
  let worst = null;
  for (const k of [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 20]) {
    const { code, host, guest } = await openRoom();
    await call({ action: 'score', code, ...host, score: 100, finished: true, seconds: 10, round: 1 });
    let told = false;
    await Promise.all([
      call({ action: 'end', code, ...host }),
      (async () => {
        await ticks(k);
        const r = await call({ action: 'score', code, ...guest, score: 888, finished: true, seconds: 44, round: 1 });
        told = Boolean(r.body.scoreDropped);
      })(),
    ]);
    // 和 ⑥ 一样重读：end 的回包里 banked 盖过了库里那一份，只看回包看不出来。
    const after = await call({ action: 'state', code, ...guest });
    const g = seatOf(after, guest.playerId);
    const sum = (g.total || 0) + (g.score || 0);
    // 判定和 ⑩ 一样：要么记进那张卡，要么明说没收下。散场这一条更要紧——没有
    // 「下一局」可以把分捡回来。
    if (!(sum === 888 || (sum === 0 && told))) {
      worst = `错位 ${k}：客人 total+score=${sum} 告知=${told}`;
    }
  }
  check('⑪ 解散小屋撞上报分：要么记进卡，要么明说没收下', worst === null, worst || '');
}

// ---- ⑫ 两台设备同时认领同一把离线的椅子 --------------------------------
//
// 抢椅子本身是原子的（claimSlot 用 HSETNX 占 s:i），可抢到之后「往座位里写一
// 把新钥匙」不是：两台都读到「这把椅子空着」，各自生成一把新钥匙写进同一个
// `p:<id>`，后写的赢，先写的那把当场作废。
//
// 最容易踩到的是同一个人：手机快没电换平板接着玩（手机那个标签页没关），或者
// 网络卡顿时对着《加入》点了两下。输掉那台设备表面上一切正常——小屋画面、名
// 单、倒数照常——可从那一刻起报分、催屋主、看教学、离开，服务器全都安静地拒
// 绝，界面上一个字的错都不弹。他打完一整局，回到小屋才发现自己那一行一直是 0。
{
  const { code, host } = await openRoom();
  await call({ action: 'join', code, name: '回头客' });
  // 先让他走掉，椅子才认领得回来（seatReclaimable）。
  const first = await call({ action: 'join', code, name: '回头客2' });
  await call({ action: 'leave', code, playerId: first.body.playerId, playerToken: first.body.playerToken });
  const both = await Promise.all([
    call({ action: 'join', code, name: '回头客2' }),
    call({ action: 'join', code, name: '回头客2' }),
  ]);
  const won = both.filter((r) => r.status === 200 && r.body.playerToken);
  check('⑫ 两台同时认领：只有一台拿到钥匙', won.length === 1, `${won.length} 台都说成功了`);
  // 拿到钥匙的那一台，钥匙必须真的能用。
  let usable = 0;
  for (const r of won) {
    const st = await call({
      action: 'score', code, playerId: r.body.playerId, playerToken: r.body.playerToken,
      score: 55, finished: true, seconds: 9, round: 1,
    });
    if (st.status === 200 && !st.body.error) usable++;
  }
  check('⑫ 拿到的那把钥匙真的开得了门', usable === won.length, `${usable}/${won.length} 把能用`);
  // 没抢到的那一台要收到一句看得懂的话，而不是一把表面成功、其实作废的钥匙。
  const lost = both.filter((r) => !(r.status === 200 && r.body.playerToken));
  check('⑫ 没抢到的那一台收到了明说的错', lost.every((r) => r.status >= 400 && r.body.error),
    lost.map((r) => `${r.status}:${r.body.error || '（没说）'}`).join(' '));
  // 椅子不许漏。直接数库里的 `s:i`（占位格）对不对得上坐着的人——从外面
  // 看不出来：漏一把椅子的表现是「屋里明明还有空位，却报满了」，要等到第
  // 九个人来敲门才发觉。两台各占一把、只有一台写进座位，就会漏。
  const raw = await hgetall(roomKey(code));
  const taken = Object.keys(raw).filter((f) => f.startsWith('s:')).length;
  const sitting = Object.entries(raw).filter(([f, v]) => f.startsWith('p:') && v && !v.left).length;
  check('⑫ 椅子没漏出去（占位格和坐着的人对得上）', taken === sitting, `占位=${taken} 在座=${sitting}`);
}

// ---- ⑭ 有人在学规则，屋主同时散场／开新局 ------------------------------
//
// 「有人在学」这个挂起状态（meta.learnHold）是**整间屋子**的东西，而放行它的
// 那一步（releaseHold）把 meta **整份**写回去——拿的还是进函数时那份快照。
// meta 里同时装着 endedAt（屋子散了）和 round（第几局），于是：
//
//   · 屋里有人举手说「我还不会玩」，房间正等他学完，屋主这时按《解散小屋》。
//     别人的手机每秒轮询一次，只要有一条恰好读到「还没散」的旧 meta、又在
//     这一瞬走了放行那条路，就会把 endedAt 整个抹掉。房间在服务器那边看起来
//     「没散」：还在等的人看到的是「等屋主开下一局」，要干等到 90 秒外的
//     「房间被取消」，而不是当场那张该出现的结算战绩卡。
//   · 同理，屋主按《再来一局》的那一下也可能被这条路把 round 悄悄拉回上一局。
//
// 窗口只有零点几秒，不是必现——所以这儿和 ⑩⑪ 一样把错位扫一遍（0…20 个
// 微任务），哪一档都不许出事。
{
  const ticks = (n) =>
    new Promise((r) => {
      let i = 0;
      const go = () => (++i >= n ? r() : queueMicrotask(go));
      queueMicrotask(go);
    });
  /**
   * 把「他还在学」那一刻推到 LEARN_IDLE_MS（20 秒）以外——等于「学的人二十秒
   * 没动静了」，于是任何一次轮询都会走放行那条路。直接摆库里的状态，不然这一
   * 台要真的干等二十秒（同 agePast）。
   */
  const ageLearning = async (code, playerId) => {
    const hash = await hgetall(roomKey(code));
    const seat = hash['p:' + playerId] || {};
    await hsetRace(roomKey(code), 'p:' + playerId, { ...seat, learningAt: 1 });
  };
  /**
   * 把开赛时刻拨到过去——`roundOver` 的第一道门槛是「倒数走完了没有」，不拨的话
   * 屋主按《再来一局》一律回 409 started，这一节量到的会是「局次没动」，而那是
   * 门自己摆错了状态（头一版就这么红的）。
   *
   * ⑦ 那一节是真的 setTimeout 等四秒；这儿要扫十七档错位，等不起，直接摆库。
   */
  const ageStart = async (code) => {
    const hash = await hgetall(roomKey(code));
    await hsetRace(roomKey(code), 'meta', { ...hash.meta, startAt: Date.now() - 1000 });
  };
  /*
   * 错位要扫到很后面。放行那一步在 state() 的**最开头**，而 endedAt 是 end()
   * 记完账（一人两次 hset）才写的——想让放行的写入落在 endedAt 之后，轮询这条
   * 必须一直等到 end() 快办完。⑩⑪ 那两节的 0…20 在这儿不够（实测全绿），
   * 那是「量不到」，不是「没问题」。
   */
  const OFFSETS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 20, 30, 45, 60, 80, 120, 200];

  /*
   * 放行有**三道门**：轮询（state）、学完了说一声（learn false）、学的人走了
   * （leave）。三条最后都落到同一个 releaseHold 上，所以补一处就都补上了。
   *
   * 这儿拿「学完了说一声」当撞的那一条：它在写 meta 之前要跑六趟库（读屋子、
   * 读裸 p:、写 p:、写心跳、再读屋子），和 end() 记完账再写 meta 的长度相当，
   * 于是这个错位真的扫得到。轮询那条只跑两趟，在内存库里怎么排都落在 endedAt
   * 之前——扫出来全绿是「量不到」，不是「没问题」（真 Redis 上每一步都是一次
   * 网络往返，谁先谁后没有保证）。所以下面那条正面的放行断言也照样量着
   * state() 这道门。
   */
  let worstEnd = null;
  for (const k of OFFSETS) {
    const { code, host, guest } = await openRoom();
    await call({ action: 'learn', code, ...guest, learning: true });
    await Promise.all([
      call({ action: 'end', code, ...host }),
      (async () => {
        await ticks(k);
        await call({ action: 'learn', code, ...guest, learning: false });
      })(),
    ]);
    // 直接读库：回包里那份是各自函数手上的快照，看不出最后落在库里的是哪一份。
    const raw = await hgetall(roomKey(code));
    if (!raw?.meta?.endedAt) worstEnd = `错位 ${k}：endedAt 没了`;
  }
  check('⑭ 有人在学 + 屋主散场：房间真的散了（放行不许抹掉 endedAt）', worstEnd === null, worstEnd || '');

  let worstRound = null;
  for (const k of OFFSETS) {
    const { code, host, guest } = await openRoom();
    // 两个人都交卷，这一局才算完，屋主才开得了下一局（roundOver）。
    await call({ action: 'score', code, ...host, score: 10, finished: true, seconds: 5, round: 1 });
    await call({ action: 'score', code, ...guest, score: 20, finished: true, seconds: 6, round: 1 });
    await ageStart(code);
    // 两局之间有人去读《怎么玩》：这一局的挂起立起来了。
    await call({ action: 'learn', code, ...guest, learning: true });
    // 撞的那一条同样用「学完了说一声」，理由和上面散场那一节一样（轮询只跑两趟
    // 库，它的写入在内存库里永远落在 start 写 meta 之前——扫出来全绿是量不到）。
    // 这一条头一版用的是轮询，反向对照当场露馅：把 releaseHold 换回旧写法它照样
    // 全绿。
    const [s1] = await Promise.all([
      call({ action: 'start', code, ...host, mode: 'circle' }),
      (async () => {
        await ticks(k);
        await call({ action: 'learn', code, ...guest, learning: false });
      })(),
    ]);
    const raw = await hgetall(roomKey(code));
    // 先立住尺子：屋主这一下**真的**开出了第二局。头一版没有这一句，而当时
    // start() 一路回 409（开赛倒数没走完，见 ageStart），于是「局次是 1」被当
    // 成了倒退——量的是门自己摆错的状态。
    if (s1.status !== 200 || s1.body.error) worstRound = `错位 ${k}：屋主压根没开出下一局（${s1.status} ${s1.body.error || ''}）`;
    else if (Number(raw?.meta?.round) !== 2) worstRound = `错位 ${k}：局次是 ${raw?.meta?.round}，该是 2`;
  }
  check('⑭ 有人在学 + 屋主开新局：局次不许被拉回上一局', worstRound === null, worstRound || '');

  // 放行本身**还要真的管用**——上面两条都是「不许写坏」，只写这两条的话，把
  // releaseHold 整个删掉也全绿：屋子不散、局次不退，代价是全屋永远等一个早就
  // 不在学的人。所以这儿正面量一次：学的人没动静了，开赛挂起必须被放掉。
  {
    const { code, host, guest } = await openRoom();
    await call({ action: 'learn', code, ...guest, learning: true });
    const held = await hgetall(roomKey(code));
    await ageLearning(code, guest.playerId);
    await call({ action: 'state', code, ...guest });
    const after = await hgetall(roomKey(code));
    check(
      '⑭ 学的人没动静了，开赛挂起要被放掉（不然全屋白等）',
      held?.meta?.learnHold === true && after?.meta?.learnHold === false,
      `挂起 ${held?.meta?.learnHold} → ${after?.meta?.learnHold}`,
    );
  }

  // ---- ⑮ 挂起那一半也要有保险，而且不许把倒数锁死 ----------------------
  //
  // ⑭ 补的是**放行**那一半。挂起那一半（learn 里「这一局第一次有人去学」）原先自己
  // 一句 hset，把进函数时读到的整份 meta 写回去——和放行那一半是同一个毛病，只是没
  // 人补：中间 end() 写进的 endedAt、start() 换上的 round，都会被它抹掉。
  //
  // 修法只有一条路走得通：挂起也过 patchMeta，但**用自己那一格锁**。takeRoomLock
  // 抢到就不还（一局里「放行」只许发生一次，这是故意的），所以挂起要是和放行共用
  // lh:N，顺序就成了「挂起抢走 → 他学完了 → 放行抢不到 → 倒数永远不放行，全屋干等
  // 到锁过期」。那比原来那个 bug 严重得多：原来是零点几秒的窗口里偶尔撞上，这个是
  // 每次有人说「不会」都必然发生。所以这一节两条都要量。
  {
    // ① 挂起撞散场：endedAt 不许被抹掉。
    let worstHeldEnd = null;
    for (const n of OFFSETS) {
      const { code, host, guest } = await openRoom();
      await ageStart(code);
      const [, ] = await Promise.all([
        call({ action: 'end', code, ...host }),
        ticks(n).then(() => call({ action: 'learn', code, ...guest, learning: true })),
      ]);
      const after = await hgetall(roomKey(code));
      if (!after?.meta?.endedAt) { worstHeldEnd = `错位 ${n}：endedAt 被抹了`; break; }
    }
    check('⑮ 挂起撞散场：endedAt 不许被抹掉', worstHeldEnd === null, worstHeldEnd || `${OFFSETS.length} 档都扫过`);

    // ② 挂起撞开新局：round 不许被拉回上一局。
    let worstHeldRound = null;
    for (const n of OFFSETS) {
      const { code, host, guest } = await openRoom();
      await ageStart(code);
      const before = (await hgetall(roomKey(code)))?.meta?.round ?? 0;
      await Promise.all([
        call({ action: 'start', code, ...host, mode: 'square' }),
        ticks(n).then(() => call({ action: 'learn', code, ...guest, learning: true })),
      ]);
      const after = (await hgetall(roomKey(code)))?.meta?.round ?? 0;
      if (after < before) { worstHeldRound = `错位 ${n}：局次 ${before} → ${after}`; break; }
    }
    check('⑮ 挂起撞开新局：局次不许被拉回上一局', worstHeldRound === null, worstHeldRound || `${OFFSETS.length} 档都扫过`);

    // ③ **同一局里，挂起之后放行必须成功。** 这一条防的是上面说的那个死锁——两把锁
    //    共用一格的话它必然红，而 ①② 两条在那种写法下**照样是绿的**（挂起写成功了，
    //    只是之后再也放不行）。所以缺了这一条，那个更严重的毛病会从门底下溜过去。
    {
      const { code, host, guest } = await openRoom();
      await call({ action: 'learn', code, ...guest, learning: true });
      const held = (await hgetall(roomKey(code)))?.meta?.learnHold;
      // 学完了说一声：走 releaseHold。
      await call({ action: 'learn', code, ...guest, learning: false });
      const after = (await hgetall(roomKey(code)))?.meta?.learnHold;
      check(
        '⑮ 同一局里，挂起之后放行必须成功（两把锁不许共用一格）',
        held === true && after === false,
        `挂起 ${held} → 放行后 ${after}`,
      );
      void host;
    }
  }

  // ---- ⑯ 直接写 meta 的地方只许有三处 --------------------------------------
  //
  // 上面 ⑭⑮ 补的是两个具体的调用点。这一条防的是**第四个悄悄长出来**：读整份 meta、
  // 改两个字段、整份写回去，这个写法本身就是那个 bug，下一个人照旁边抄一遍就又来一次。
  //
  // 三处是允许的：patchMeta 自己（它就是那套保险）、start() 和 end()——那两个要跑几十
  // 趟库才写到 meta，各自有更重的一次性锁，硬塞进 patchMeta 只会把两套锁搅在一起。
  {
    const src = readFileSync(new URL('../api/room.js', import.meta.url), 'utf8');
    const lines = src.split('\n');
    /** 某一行落在哪个 function 里——从它往上找最近的一行 `function 名字(`。 */
    const ownerOf = (idx) => {
      for (let i = idx; i >= 0; i--) {
        const m = lines[i].match(/^(?:async )?function ([A-Za-z0-9_]+)\s*\(/);
        if (m) return m[1];
      }
      return '(顶层)';
    };
    const writers = lines
      .map((l, i) => (l.includes("hset(roomKey(code), 'meta'") ? ownerOf(i) : null))
      .filter(Boolean);
    const allowed = ['patchMeta', 'start', 'end'];
    const stray = writers.filter((w) => !allowed.includes(w));
    check('⑯ 直接写 meta 的只有 patchMeta / start / end', stray.length === 0, `写 meta 的是：${writers.join('、')}`);
    // 量程：上面那句要真的找得到几处写入。一处都没找到（正则失配、文件改了写法）
    // 的话 stray 也是空的，这一条会变成空判——那是最难发现的一种假绿。
    check('⑯ 量程：真的找到了三处写 meta', writers.length === 3, `${writers.length} 处`);
  }
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
