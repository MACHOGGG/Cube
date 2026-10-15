/**
 * 小屋的两本账：谁还算「在」，和谁占着哪把椅子。
 *
 *   node scripts/check-room-seat.mjs
 *
 * 不起服务器、不开浏览器、也不真等九十秒：库用进程内的那一份
 * （ALLOW_MEMORY_STORE），直接叫 api/room.js 的 handler；而「还算不算在」那条
 * 规则本身是个纯函数（seenFrom），把时刻当参数递进去就量得出来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两件真出过的事
 *
 * ① **真断线的人让后面每一局都重新等满 90 秒。**
 *    「这一局还等不等他」的基准，是「他最后一次露面」和「这一局开局」两者取
 *    更晚的那个。开局那一下确实该往后挪（一局刚开始谁都还没来得及报，照上一
 *    次报到算会把整屋人一起判成「不在」，这一局还没打就先结束了）。可「开局
 *    时刻」每开一局刷新一次，而手机没电直接关机的人——来不及发 bye，最容易
 *    发生的那种断线——此后再也不会报到：从他消失的那一局起，后面每一局都要
 *    重新傻等满 ABSENT_MS 才进得了下一局。不是等一次，是场场都等，直到大家
 *    受不了只能解散重开；屋里还一直看不出是谁卡着（他每局开头都被这一挪重新
 *    算成「在」）。
 *
 * ② **座位被借走的人回来，成了占名额却没有椅子的幽灵。**
 *    满员时新朋友按《加入》，服务器会把「网页已经关掉」的座位借给他，并把原
 *    主人的 slot 抹掉。原主人从别的设备回来走的是认领那条路，那儿会重新占一
 *    把；可他要是就在原来那台手机上切回来（切个应用、锁屏再解开，这才是最常
 *    见的那种「暂时不在」），带着原来的身份直接接着轮询——这条路从前只刷新
 *    lastSeen，不管椅子。于是他从此占着名额却分不到椅子：屋里显示的人数会超
 *    过它自己号称的上限，那个名额到小屋过期都回收不了，新朋友反而进不来。
 *
 *    量它要绕一下：满员时借走那一下，屋里是真的一把空椅子都没有，补也补不
 *    上。所以这一台让借椅子的那位随后自己走掉——椅子空出来了，原主人下一次
 *    轮询就该把它坐回去。看得见的凭据是「再来一个人进不进得来」：他坐回去了
 *    就是满的，没坐回去就还空着一把。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const roomMod = await import('../api/room.js');
const room = roomMod.default;
const { seenFrom } = roomMod;
const { saveAccount, newAccount } = await import('../api/_accounts.js');
const { hset, hgetall } = await import('../api/_store.js');

/**
 * 把这个人说 bye 的时刻往前推到宽限期之外——等于「十秒过了他还没回来」。
 *
 * bye 现在不是当场生效的：api/room.js 的 BYE_GRACE_MS 给了十秒，专为「他只是
 * 刷新了一下网页」——浏览器刷新时先发 bye 再重新加载，不留这十秒的话按一下
 * F5 就等于退出。直接摆库里的状态，不然这一台要真的干等十秒。
 * check-room-race.mjs / check-room-races.mjs 里那两个同名的助手是同一个做法。
 */
async function agePast(code, playerId) {
  const hash = await hgetall('room:' + code);
  const beat = hash['h:' + playerId] || {};
  await hset('room:' + code, 'h:' + playerId, { ...beat, byeAt: 1 });
}

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

// ---- ① 谁还算「在」 ------------------------------------------------------
//
// ABSENT_MS 是 90 秒。下面几个时刻写成字面量是故意的：这一台盯的是「规则怎么
// 算」，不是「那个数是多少」。
{
  const T = 1_700_000_000_000; // 随便一个时刻，当作他最后一次露面
  const stillIn = seenFrom({ lastSeen: T }, { startAt: T + 10_000 });
  check('开局时他还算在：基准挪到开局时刻', stillIn === T + 10_000, `+${stillIn - T}ms`);

  const longGone = seenFrom({ lastSeen: T }, { startAt: T + 200_000 });
  check('开局时他早就不在了：按他自己最后一次露面算，不重新给宽限', longGone === T, `+${longGone - T}ms`);

  // 这一条才是玩家真正遇到的那件事：他消失之后的第二局、第三局……
  const later = seenFrom({ lastSeen: T }, { startAt: T + 600_000 });
  check('再开一局：基准不会又被推到新开局（不然场场重等 90 秒）', later === T, `+${later - T}ms`);

  // 刚坐下还没来得及报到的人，joinedAt 也算露面。
  const justJoined = seenFrom({ lastSeen: 0, joinedAt: T }, { startAt: T + 10_000 });
  check('刚坐下还没报到的人不算「不在」', justJoined === T + 10_000, `+${justJoined - T}ms`);
}

// ---- ② 椅子 -------------------------------------------------------------
{
  // 开小屋要天才身份。用一个内部码账号：权益记在我们自己的库里，不问 Creem。
  const account = newAccount('bbb222', 'code');
  account.until = Date.now() + 9e8;
  await saveAccount('seathost@example.com', account);
  const who = { email: 'seathost@example.com', accountToken: account.token };

  const opened = await call({ action: 'create', name: '屋主', ...who });
  check('屋主开得出小屋', opened.status === 200 && Boolean(opened.body.code), String(opened.status));
  const code = opened.body.code;
  const seats = opened.body.state.seats;
  const host = { playerId: opened.body.playerId, playerToken: opened.body.playerToken };

  // 坐满（屋主已经占了一把）。
  const guests = [];
  for (let i = 1; i < seats; i++) {
    const r = await call({ action: 'join', code, name: '客人' + i });
    if (r.status === 200) guests.push(r.body);
  }
  check(`坐满 ${seats} 个`, guests.length === seats - 1, `${guests.length + 1}/${seats}`);
  const over = await call({ action: 'join', code, name: '晚到的' });
  check('满了：下一个人进不来', over.status === 409 && over.body.error === 'full', `${over.status} ${over.body.error}`);

  // 有人切了个应用，浏览器发出了最后那一下 bye。
  const away = guests[0];
  await call({ action: 'bye', code, playerId: away.playerId, playerToken: away.playerToken });

  // 刚说完 bye 的那十秒里，椅子还不外借（BYE_GRACE_MS）：他可能只是刷新了
  // 一下网页，刷新时浏览器也发 bye。这一条不验的话，把宽限期整个删掉这道门
  // 照样绿。
  const tooSoon = await call({ action: 'join', code, name: '手快的' });
  check('刚说完 bye 的这十秒里，椅子还不外借（他可能只是刷新）',
    tooSoon.status === 409 && tooSoon.body.error === 'full',
    `${tooSoon.status} ${tooSoon.body.error}`);

  // 十秒过了他还没回来：这回椅子可以借出去了。
  await agePast(code, away.playerId);
  const borrower = await call({ action: 'join', code, name: '晚到的' });
  check('十秒过了人没回来，晚到的那位进来了（借走了那把椅子）', borrower.status === 200, String(borrower.status));

  // 借椅子的那位随后自己走了：椅子空出来一把。
  await call({ action: 'leave', code, playerId: borrower.body.playerId, playerToken: borrower.body.playerToken });

  // 原主人切回来，带着原来的身份接着轮询。
  const back = await call({ action: 'state', code, playerId: away.playerId, playerToken: away.playerToken });
  check('原主人回来了', back.status === 200, String(back.status));
  const me = (back.body.players || []).find((p) => p.id === away.playerId);
  check('他还在名单里，也不再显示成「网页关着」', Boolean(me) && me.closed === false, JSON.stringify(me || null).slice(0, 90));

  // 看得见的凭据：他把椅子坐回去了，屋子就该是满的。
  const after = await call({ action: 'join', code, name: '又来一个' });
  check(
    '他重新坐回了那把椅子——屋子又是满的，不再多出一个占名额的幽灵',
    after.status === 409 && after.body.error === 'full',
    `${after.status} ${after.body.error ?? 'ok'}`,
  );
  const st = await call({ action: 'state', code, ...host });
  const here = (st.body.players || []).filter((p) => !p.left).length;
  check('名单上的人数没有超过座位数', here <= seats, `${here}/${seats}`);
}

// ---- ③ 两个人同时按《加入》：一把收回来的椅子只坐得下一个人（10-11 方案 C-2）----------
//
// 满员，其中一把椅子的主人网页关了（bye 过了宽限期）。两个人同一瞬间按《加入》：两边读到的是同一份快照，都看见
// 「那把椅子收得回来」。原先收椅子是无条件删的：先到的那个收回来、坐上去；后到的照着旧快照再删一遍——删掉的已
// 经是先到那个人刚坐上的椅子，然后自己也坐上去。一把椅子两个人，屋里在座的人数超过上限（报告实测 10 次里 10 次）。
//
// 量三样：只进来一个、每把椅子上只有一个人（s:N 记的人和他座位上的 slot 对得上）、在座的人数不超过座位数。
// 和 check-room-races 一样扫错位：第二个人晚几个微任务才按，两条请求在每一次 await 交错的位置各不相同。
{
  const ticks = (n) =>
    new Promise((r) => {
      let i = 0;
      const go = () => (++i >= n ? r() : queueMicrotask(go));
      queueMicrotask(go);
    });
  // 一次调用一个假 IP：这一节开十几间屋、塞上百人次，全算成一个 IP 会撞上 create / join 的限速桶
  // （check-room-contest 同一个办法）。
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
    await room({ method: 'POST', headers: { 'x-forwarded-for': `198.18.${Math.floor(ipSeq / 254) % 254}.${(ipSeq % 254) + 1}` }, body }, res);
    return { status, body: JSON.parse(text || '{}') };
  };
  const account = newAccount('bbb333', 'code');
  account.until = Date.now() + 9e8;
  await saveAccount('seatrace@example.com', account);
  const who = { email: 'seatrace@example.com', accountToken: account.token };
  let worst = null;
  let swept = 0;
  for (const k of [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 20, 30]) {
    const opened = await call({ action: 'create', name: '屋主', ...who });
    const code = opened.body.code;
    const seats = opened.body.state.seats;
    const guests = [];
    for (let i = 1; i < seats; i++) {
      const r = await call({ action: 'join', code, name: '客人' + i });
      if (r.status === 200) guests.push(r.body);
    }
    const away = guests[0];
    await call({ action: 'bye', code, playerId: away.playerId, playerToken: away.playerToken });
    await agePast(code, away.playerId);
    const [a, b] = await Promise.all([
      call({ action: 'join', code, name: '同时甲' }),
      (async () => {
        await ticks(k);
        return call({ action: 'join', code, name: '同时乙' });
      })(),
    ]);
    swept++;
    const hash = await hgetall('room:' + code);
    const chairs = Object.entries(hash).filter(([f]) => f.startsWith('s:'));
    const owners = chairs.map(([, id]) => id);
    const twice = owners.find((id, i) => owners.indexOf(id) !== i);
    // 座位上记着 slot 的人，那把椅子上坐的得是他自己。
    const mismatch = Object.entries(hash)
      .filter(([f, v]) => f.startsWith('p:') && v && !v.left && v.slot !== undefined)
      .find(([f, v]) => hash['s:' + v.slot] !== f.slice(2));
    const seated = Object.entries(hash).filter(([f, v]) => f.startsWith('p:') && v && !v.left && v.slot !== undefined).length;
    const inCount = [a, b].filter((r) => r.status === 200).length;
    if (inCount !== 1 || twice || mismatch || seated > seats || chairs.length > seats) {
      worst = `错位 ${k}：进来 ${inCount} 个（${a.status}/${b.status}）· 椅子 ${chairs.length} 把 · 坐着 ${seated}/${seats}`
        + (twice ? ` · ${twice} 占了两把` : '')
        + (mismatch ? ` · ${mismatch[1].name} 记着 s:${mismatch[1].slot}，那把上坐的是别人` : '');
    }
  }
  check(`③ 两个人同时进满员的屋：${swept} 档错位，每一档都只进来一个、一把椅子一个人`, worst === null, worst || '');
}

// ---- ④ 一个人进来只收一把椅子；人数只数真的坐着一把椅子的人（10-15 补充 S4）----------------------------
//
// 原先 claimSeat 收椅子没有 break：8 人屋 3 人关页、第 9 人进来，3 把全收、自己只坐 1 把，s:* 只剩 6 把，屋里却显示
// 9/8（人数按「没按离开」数，被收了椅子的人照样算）；再来 3 个陌生人 200 / 200 / 409，11/8。竞赛屋 21 把坐满、4 人
// 关页：显示 24/20。量两种「收得回来」（关了页、九十秒没动静）各一遍，外加竞赛屋。
{
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
    await room({ method: 'POST', headers: { 'x-forwarded-for': `198.19.${Math.floor(ipSeq / 254) % 254}.${(ipSeq % 254) + 1}` }, body }, res);
    return { status, body: JSON.parse(text || '{}') };
  };
  const account = newAccount('bbb444', 'code');
  account.until = Date.now() + 9e8;
  await saveAccount('seatone@example.com', account);
  const who = { email: 'seatone@example.com', accountToken: account.token };
  /** 九十秒没动静：心跳那一格和坐下的时刻都往前拨（seatGone 看的是这两样里晚的那一个）。 */
  async function ageGone(code, playerId) {
    const hash = await hgetall('room:' + code);
    const long = Date.now() - 200_000;
    await hset('room:' + code, 'h:' + playerId, { ...(hash['h:' + playerId] || {}), lastSeen: long, byeAt: 0 });
    await hset('room:' + code, 'p:' + playerId, { ...hash['p:' + playerId], joinedAt: long, lastSeen: long });
  }
  const chairsOf = (hash) => Object.keys(hash).filter((f) => f.startsWith('s:')).length;

  for (const how of ['关了页', '九十秒没动静']) {
    const opened = await call({ action: 'create', name: '屋主', ...who });
    const code = opened.body.code;
    const seats = opened.body.state.seats;
    const host = { code, playerId: opened.body.playerId, playerToken: opened.body.playerToken };
    const guests = [];
    for (let i = 1; i < seats; i++) {
      const r = await call({ action: 'join', code, name: '客' + i });
      if (r.status === 200) guests.push(r.body);
    }
    const away = guests.slice(0, 3);
    for (const g of away) {
      if (how === '关了页') {
        await call({ action: 'bye', code, playerId: g.playerId, playerToken: g.playerToken });
        await agePast(code, g.playerId);
      } else {
        await ageGone(code, g.playerId);
      }
    }
    const first = await call({ action: 'join', code, name: '新人1' });
    let hash = await hgetall('room:' + code);
    const st = await call({ action: 'state', ...host });
    const robbed = away.filter((g) => hash['p:' + g.playerId]?.slot === undefined).length;
    check(`④ ${how}：满屋 3 人${how}、1 个新人进来——只收 1 把`, first.status === 200 && robbed === 1, `进来 ${first.status}，收走 ${robbed} 把`);
    check(`④ ${how}：椅子还是 ${seats} 把，「几/几」不超过座位数`, chairsOf(hash) === seats && st.body.playersIn <= seats,
      `s:* ${chairsOf(hash)} 把 · 显示 ${st.body.playersIn}/${st.body.playerSeats ?? seats}`);
    const flags = new Map((st.body.players || []).map((p) => [p.id, p.seated]));
    const robbedIds = away.filter((g) => hash['p:' + g.playerId]?.slot === undefined).map((g) => g.playerId);
    const others = (st.body.players || []).filter((p) => !p.left && !robbedIds.includes(p.id));
    check(`④ ${how}：被收走椅子的那个人 seated 是 false，其余都是 true`,
      robbedIds.every((id) => flags.get(id) === false) && others.every((p) => p.seated === true),
      robbedIds.map((id) => flags.get(id)).join(',') + ' / ' + others.filter((p) => p.seated !== true).map((p) => p.name).join(','));
    const more = [];
    for (let i = 2; i <= 4; i++) more.push(await call({ action: 'join', code, name: '新人' + i }));
    hash = await hgetall('room:' + code);
    const st2 = await call({ action: 'state', ...host });
    check(`④ ${how}：之后每来一人各收一把，收完就 full`,
      more[0].status === 200 && more[1].status === 200 && more[2].status === 409 && more[2].body.error === 'full',
      more.map((r) => `${r.status}${r.body.error ? ' ' + r.body.error : ''}`).join(' / '));
    check(`④ ${how}：收完之后 ${seats}/${seats}，椅子 ${seats} 把`, st2.body.playersIn === seats && chairsOf(hash) === seats,
      `显示 ${st2.body.playersIn} · s:* ${chairsOf(hash)}`);
  }
  {
    const opened = await call({ action: 'create', name: '主持', contest: true, ...who });
    const code = opened.body.code;
    const seats = opened.body.state.seats;
    const host = { code, playerId: opened.body.playerId, playerToken: opened.body.playerToken };
    const guests = [];
    for (let i = 1; i < seats; i++) {
      const r = await call({ action: 'join', code, name: '选手' + i });
      if (r.status === 200) guests.push(r.body);
    }
    for (const g of guests.slice(0, 4)) {
      await call({ action: 'bye', code, playerId: g.playerId, playerToken: g.playerToken });
      await agePast(code, g.playerId);
    }
    const four = [];
    for (let i = 1; i <= 4; i++) four.push(await call({ action: 'join', code, name: '后来' + i }));
    const fifth = await call({ action: 'join', code, name: '后来5' });
    const st = await call({ action: 'state', ...host });
    check('④ 竞赛屋 21 把坐满、4 人关页、4 人加入：20/20',
      four.every((r) => r.status === 200) && st.body.playersIn === 20 && st.body.playerSeats === 20,
      `${four.map((r) => r.status).join('/')} · 显示 ${st.body.playersIn}/${st.body.playerSeats}`);
    check('④ 竞赛屋：第 5 个 full', fifth.status === 409 && fifth.body.error === 'full', `${fifth.status} ${fifth.body.error}`);
  }
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
