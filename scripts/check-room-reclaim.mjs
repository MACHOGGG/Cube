/**
 * 坐满了的屋子，掉线九十秒的那把椅子要收回来——但收回来的只是椅子。
 *
 *   node scripts/check-room-reclaim.mjs
 *
 * 不起服务器、不开浏览器：库用进程内那一份（ALLOW_MEMORY_STORE）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 屋子坐满（8 把）之后，`claimSeat` 会去收那些「已经不在了」的椅子。从前只认一种：
 * **网页真的关掉了**（`seatClosed`——他自己发过 bye，而且过了宽限期没再回来）。可那
 * 恰恰是最少见的一种；常见的几种一个都不认：
 *
 *   手机进了后台、电没了、地铁里断网——这几样都不发 bye。
 *
 * 于是那把椅子一直占着，门外的人只能等整间小屋二十分钟过期。而这一局**早就不等他
 * 了**（roundOver 用的就是同一个 ABSENT_MS）：服务器一边认定他不在，一边替他留着椅
 * 子。现在同一个九十秒两头都认（`seatGone`）。
 *
 * 另一半同样要钉住：**`seatReclaimable` 一个字都不许动**。那是另一条路——「**同名的
 * 人**来认领这把椅子」，而认领拿到的是名字、分数、打过几局（那是他的身份）。把「一
 * 阵子没心跳」也算进那一条，就等于把一个人的成绩交给一个恰好同名的人，而他只是进了
 * 个隧道。这台门的 ⑤ 专量这件事。
 *
 * 一句话：**收椅子看九十秒，交身份只看他自己说了什么**（按了《离开》/ 关了网页）。
 *
 * ⑧（2026-10-08 方案 1-3）：登录的人坐过的椅子带一枚账号标识，只还给同一个账号——一个没登
 * 录的人敲他的名字，接不走他的累计分。
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
    { method: 'POST', headers: { 'x-forwarded-for': `198.23.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}` }, body },
    res,
  );
  return { status, body: JSON.parse(text || '{}') };
};

const account = newAccount('rrr888', 'code');
account.until = Date.now() + 9e8;
await saveAccount('reclaimhost@example.com', account);
const who = { email: 'reclaimhost@example.com', accountToken: account.token };

/** 开一间坐满的屋（屋主 + 7 位客人，共 8 把椅子）。 */
async function fullRoom() {
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const guests = [];
  for (let i = 0; i < 7; i++) {
    const g = await call({ action: 'join', code, name: '客' + i });
    if (g.status !== 200) throw new Error(`第 ${i} 位进不来：${g.status} ${g.body.error}`);
    guests.push({ playerId: g.body.playerId, playerToken: g.body.playerToken, name: '客' + i });
  }
  return { code, host, guests };
}

/** 把这个人的「最后一次露面」推到 ms 毫秒以前（心跳和 joinedAt 一起推）。 */
async function silentFor(code, playerId, ms) {
  const hash = await hgetall(roomKey(code));
  const when = Date.now() - ms;
  await hset(roomKey(code), 'h:' + playerId, { ...(hash['h:' + playerId] || {}), lastSeen: when, byeAt: 0 });
  await hset(roomKey(code), 'p:' + playerId, { ...hash['p:' + playerId], joinedAt: when });
}

/**
 * 库里那几把椅子，摆成一行行好读的样子。
 *
 * ⚠️ **分数要从 `r:` 那一格读**，不能读 `p:.score`：readRoom 的注释写着「`p:` 里
 * 同名的那几个字段从此是死数据」，而这台门直接 hgetall，拿到的正是那份影子。第一
 * 版就读了 `p:.score`，于是量到「掉线那个人的 250 分不见了」——分好好地在 `r:` 里，
 * 是门自己读错了地方。
 */
const seatsOf = async (code) => {
  const hash = await hgetall(roomKey(code));
  return Object.entries(hash)
    .filter(([k, v]) => k.startsWith('p:') && v)
    .map(([k, v]) => ({
      id: k.slice(2),
      name: v.name,
      slot: v.slot,
      left: v.left,
      score: hash['r:' + k.slice(2)]?.score ?? v.score,
    }));
};

// ---- ① 坐满了就是坐满了：谁都没掉线，第九个人进不来 ---------------------
{
  const { code } = await fullRoom();
  const nine = await call({ action: 'join', code, name: '第九' });
  check('① 八个人都好好的：第九个被挡住', nine.status === 409 && nine.body.error === 'full', `${nine.status} ${nine.body.error}`);
  check('① 挡回去的时候说了共几把椅子', nine.body.seats === 8, String(nine.body.seats));
}

// ---- ② 只是三十秒没动静（away）：椅子不收 -------------------------------
//
// 量程的另一头。三十秒是「屋里显示他暂时不在」，不是「他不在了」——这时候收椅子
// 就成了「接个电话回来发现自己被请出去了」。
{
  const { code, guests } = await fullRoom();
  await silentFor(code, guests[0].playerId, 35_000);
  const nine = await call({ action: 'join', code, name: '第九' });
  check('② 三十五秒没动静：椅子不收，第九个还是进不来', nine.status === 409 && nine.body.error === 'full',
    `${nine.status} ${nine.body.error}`);
}

// ---- ③ 九十秒没动静：椅子收回来，第九个进得来 ---------------------------
//
// #12 的正身。
{
  const { code, guests } = await fullRoom();
  const lost = guests[0];
  await silentFor(code, lost.playerId, 95_000);
  const nine = await call({ action: 'join', code, name: '第九' });
  check('③ 九十五秒没动静：第九个进得来', nine.status === 200 && Boolean(nine.body.playerId),
    `${nine.status} ${nine.body.error ?? ''}`);
  const seats = await seatsOf(code);
  const was = seats.find((s) => s.id === lost.playerId);
  const now = seats.find((s) => s.id === nine.body.playerId);
  check('③ 掉线那个人的座位还在（名字、分数都还是他的）', Boolean(was) && was.name === lost.name, JSON.stringify(was));
  check('③ 他手上没有椅子了（收回去的只是位子）', was && was.slot === undefined, String(was && was.slot));
  check('③ 新来的人拿到了一把椅子', now && typeof now.slot === 'number', String(now && now.slot));
  check('③ 他不是被标成「走了」（他没按过离开）', was && !was.left, String(was && was.left));
  // 椅子不许发重：收一把发一把，八个 s:i 格子对得上八把椅子。
  const taken = seats.filter((s) => typeof s.slot === 'number').map((s) => s.slot);
  check('③ 八把椅子一人一把，没发重', new Set(taken).size === taken.length && taken.length === 8,
    `${taken.length} 把：${taken.sort((a, b) => a - b).join(',')}`);
}

// ---- ④ 正在看教学的人：椅子不收 ----------------------------------------
//
// 他那台设备在教学页上，心跳走的是 learn 那条路；收了他的椅子，他看完回来就没地方
// 坐了，而屋里正为他挂着开赛。
{
  const { code, guests } = await fullRoom();
  const student = guests[1];
  await call({ action: 'learn', code, ...student, learning: true });
  await silentFor(code, student.playerId, 95_000);
  // learningAt 要留着新鲜的（silentFor 只动心跳和 joinedAt）。
  const nine = await call({ action: 'join', code, name: '第九' });
  check('④ 正在看教学的人：椅子不收', nine.status === 409 && nine.body.error === 'full',
    `${nine.status} ${nine.body.error}`);
}

// ---- ⑤ 屋主的椅子永远不收 ----------------------------------------------
{
  const { code, host } = await fullRoom();
  await silentFor(code, host.playerId, 95_000);
  const nine = await call({ action: 'join', code, name: '第九' });
  check('⑤ 屋主九十五秒没动静：他的椅子也不收', nine.status === 409 && nine.body.error === 'full',
    `${nine.status} ${nine.body.error}`);
}

// ---- ⑥ seatReclaimable 一个字没动：同名的人接不走他的身份 ---------------
//
// 屋子**没坐满**，所以这一条和收椅子无关：量的是「掉线九十秒的人，他的名字和分数
// 还归不归他」。
{
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const g = await call({ action: 'join', code, name: '甲' });
  const gone = { playerId: g.body.playerId, playerToken: g.body.playerToken };
  await call({ action: 'join', code, name: '乙' });
  await call({ action: 'start', code, ...host, mode: 'square' });
  await call({ action: 'score', code, ...gone, score: 250, finished: true, round: 1 });
  await silentFor(code, gone.playerId, 95_000);

  const twin = await call({ action: 'join', code, name: '甲' });
  check('⑥ 同名的人来了：不是「认回那把椅子」', twin.body.rejoined !== true, String(twin.body.rejoined));
  check('⑥ 他拿到的是另一个座位', twin.body.playerId !== gone.playerId, `${twin.body.playerId} / ${gone.playerId}`);
  const seats = await seatsOf(code);
  const was = seats.find((s) => s.id === gone.playerId);
  check('⑥ 掉线那个人的 250 分还在他名下', was && was.score === 250, JSON.stringify(was));
  check('⑥ 他的椅子也还在（屋子没坐满，没理由收）', was && typeof was.slot === 'number', String(was && was.slot));

  // 反过来：他自己**按过《离开》**，同名的人就该认回去（这一条是老规矩，
  // 量它是为了让上面那三条不至于变成「同名永远认不回」的空判）。
  const h2 = await call({ action: 'create', name: '屋主', ...who });
  const code2 = h2.body.code;
  const host2 = { playerId: h2.body.playerId, playerToken: h2.body.playerToken };
  const g2 = await call({ action: 'join', code: code2, name: '甲' });
  const left = { playerId: g2.body.playerId, playerToken: g2.body.playerToken };
  await call({ action: 'join', code: code2, name: '乙' });
  await call({ action: 'start', code: code2, ...host2, mode: 'square' });
  await call({ action: 'score', code: code2, ...left, score: 250, finished: true, round: 1 });
  await call({ action: 'leave', code: code2, ...left });
  const back = await call({ action: 'join', code: code2, name: '甲' });
  check('⑥ 量程：按过《离开》的人回来，认的是自己那把椅子', back.body.rejoined === true, String(back.body.rejoined));
  check('⑥ 量程：而且还是同一个 playerId', back.body.playerId === left.playerId, '同一个');
}

// ---- ⑧ 登录的人坐过的椅子：只还给同一个账号（2026-10-08 方案 1-3）-----------
//
// 从前认领只认名字。一个没登录的人敲一个登录玩家的名字，那人的椅子一空出来（按了《离
// 开》、网页关了），他就连同累计分一起接走。现在登录的人坐下时椅子上记一枚账号标识，认
// 领这种椅子要同一个账号的令牌；匿名的椅子照旧按名字认（⑥ 的量程那两条）。
{
  const mine = newAccount('', 'code');
  await saveAccount('reclaim-owner@example.com', mine);
  const owner = { email: 'reclaim-owner@example.com', accountToken: mine.token };
  const other = newAccount('', 'code');
  await saveAccount('reclaim-other@example.com', other);
  const stranger = { email: 'reclaim-other@example.com', accountToken: other.token };

  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const g = await call({ action: 'join', code, name: '丙', ...owner });
  const seat = { playerId: g.body.playerId, playerToken: g.body.playerToken };
  await call({ action: 'join', code, name: '丁' });
  await call({ action: 'start', code, ...host, mode: 'square' });
  await call({ action: 'score', code, ...seat, score: 300, finished: true, round: 1 });
  await call({ action: 'leave', code, ...seat });

  const raw = JSON.stringify(await hgetall(roomKey(code)));
  check('⑧ 库里那间屋没有邮箱原文（椅子上记的是一枚哈希）', !raw.includes('reclaim-owner@example.com'));
  const stamped = (await hgetall(roomKey(code)))['p:' + seat.playerId];
  check('⑧ 量程：登录的人那把椅子上真记了账号标识', /^[0-9a-f]{64}$/.test(String(stamped?.owner)), String(stamped?.owner));
  const pub = await call({ action: 'state', code, ...host });
  check('⑧ 那枚标识不往外发（publicState 里没有）', !JSON.stringify(pub.body).includes(String(stamped?.owner)));

  const anon = await call({ action: 'join', code, name: '丙' });
  check('⑧ 匿名的人敲了他的名字：认领被拒（不是「认回那把椅子」）', anon.body.rejoined !== true, String(anon.body.rejoined));
  check('⑧ 匿名的人拿到的是另一个座位', anon.status === 200 && anon.body.playerId !== seat.playerId,
    `${anon.status} ${anon.body.playerId}`);
  const someone = await call({ action: 'join', code, name: '丙', ...stranger });
  check('⑧ 换一个账号来敲这个名字：一样被拒', someone.body.rejoined !== true && someone.body.playerId !== seat.playerId,
    String(someone.body.rejoined));
  const seats = await seatsOf(code);
  const kept = seats.find((s) => s.id === seat.playerId);
  check('⑧ 他那 300 分还在他名下', kept && kept.score === 300, JSON.stringify(kept));

  const back = await call({ action: 'join', code, name: '丙', ...owner });
  check('⑧ 他自己带着令牌回来：认的是自己那把椅子', back.body.rejoined === true, String(back.body.rejoined));
  check('⑧ 而且还是同一个 playerId', back.body.playerId === seat.playerId, `${back.body.playerId} / ${seat.playerId}`);
}

// ---- ⑦ 源码：两条路各认各的 --------------------------------------------
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../api/room.js', import.meta.url), 'utf8');
  const recl = src.split('\n').find((l) => l.includes('const seatReclaimable'));
  check('⑦ 源码：seatReclaimable 只认 left / closed，不认 gone',
    Boolean(recl) && recl.includes('seat.left') && recl.includes('seatClosed') && !recl.includes('seatGone'),
    String(recl).trim());
  const free = src.split('\n').find((l) => l.includes('seatClosed(seat) || seatGone(seat'));
  check('⑦ 源码：收椅子那一处两种都认', Boolean(free), String(free).trim());
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
