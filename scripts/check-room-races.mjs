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
 *   ② score 撞 bye（关网页）  → 分数和交卷要留着，而且 closed 要成立
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
//   · bestTime —— 「最快玩家」那一行（第 165 行）。
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

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
