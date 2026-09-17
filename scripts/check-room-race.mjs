/**
 * 小屋里两件「谁写谁赢」的事。
 *
 *   node scripts/check-room-race.mjs
 *
 * ① **催屋主和开局不能抢同一份数据。** 房间的「这一局是什么」（回合数、种
 *    子、开赛时刻）存在 meta 那一格里；催促的计数从前也住在那儿，而催一下是
 *    「读一份 meta → 改两个字段 → 整份写回去」。屋主按《开始》写的也是整份
 *    meta。两个请求前后脚撞上，后写的把先写的整段盖掉，于是出过两种事：客人
 *    那一下被吃掉（计数没动，他自己不知道），或者更糟——屋主自己进了棋盘，
 *    别人的画面还停在等待页，round / seed / startAt 一起被旧 meta 盖回去了。
 *    而「等屋主开局的时候一直点催促」恰好是玩家最常做的那个动作。
 *
 * ② **网页已经关了的人，不该让全屋再等九十秒。** 关标签页那一下浏览器发一个
 *    beacon（bye），服务器把这一刻记进 byeAt——它**已经知道**这个人走了。可
 *    结算判定（roundOver）只认「九十秒没消息」那一条，座位也一直占着：屋里
 *    其余人交完卷要干等到第 90 秒才开得了下一局，新朋友也进不来，得等整间屋
 *    二十分钟过期。
 *
 *    这里还压着后来加的那道宽限期（api/room.js 的 BYE_GRACE_MS，十秒）。原先
 *    bye 是当场生效的，于是**刷新一下网页**和**关掉网页**在服务器看来一模一
 *    样——屋主按 F5，浏览器先发 bye 再重新加载，全屋的这一局当场被判完，人还
 *    在就散了场。所以现在 bye 只是记一个时刻：十秒之内他回来（任何一次轮询都
 *    算），当没发生过；十秒过了还没回来，才真的算关了网页。下面两段分别量这
 *    十秒之内和之外——只量之外的话，把宽限期整个删掉这道门照样绿。
 *
 * 不起服务器、不开浏览器：库用进程内的那份，直接叫 api/room.js 的 handler。
 * 并发那几条必须用 Promise.all 一起发——一个一个发的版本永远是绿的。
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

/**
 * 把这个人说 bye 的时刻往前推到宽限期之外——等于「十秒过了他还没回来」。
 *
 * 直接摆库里的状态，不然这一台要真的干等十秒。和 check-room-races.mjs 里那个
 * 同名的助手是同一个做法。
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

// 开小屋要天才身份。用一个内部码账号：权益记在我们自己的库里，不问 Creem。
const HOST_MAIL = 'roomhost@example.com';
const account = newAccount('aaa111', 'code');
account.until = Date.now() + 9e8;
await saveAccount(HOST_MAIL, account);
const who = { email: HOST_MAIL, accountToken: account.token };

const opened = await call({ action: 'create', name: 'HOST', ...who });
check('屋主开得出小屋', opened.status === 200 && opened.body.code, JSON.stringify(opened.body.code));
const code = opened.body.code;
const host = { code, playerId: opened.body.playerId, playerToken: opened.body.playerToken };

const joined = await call({ action: 'join', code, name: 'GUEST' });
check('客人进得来', joined.status === 200, String(joined.status));
const guest = { code, playerId: joined.body.playerId, playerToken: joined.body.playerToken };

const stateOf = async () =>
  (await call({ action: 'state', ...host })).body;

// ── ① 催促和开局同时打进来 ────────────────────────────────────────────────

const [, nudged] = await Promise.all([
  call({ action: 'start', ...host, mode: 'square' }),
  call({ action: 'nudge', ...guest }),
]);
const after = await stateOf();
check('开局活下来了：回合数、种子、开赛时刻都在',
  after.round === 1 && Boolean(after.seed) && Boolean(after.startAt),
  `round=${after.round} seed=${after.seed} startAt=${after.startAt}`);
check('那一下催促也算数了（没被开局吃掉）', after.nudges === 1,
  `nudges=${after.nudges} 回包=${nudged.body.nudges}`);
check('掉落用的时刻也留下了一条', (after.nudgeAt || []).length === 1,
  JSON.stringify(after.nudgeAt));

// 再来一轮，这回一起打八下：一下都不能少。
const swarm = await Promise.all(Array.from({ length: 8 }, () => call({ action: 'nudge', ...guest })));
const after2 = await stateOf();
check('八下同时打进来，八下都记上了', after2.nudges === 9, `nudges=${after2.nudges}`);
check('八个回包都是 200', swarm.every((r) => r.status === 200));
check('这一局还是好好的', after2.round === 1 && after2.seed === after.seed);

// ── ② 关了网页的人 ───────────────────────────────────────────────────────

// 等 4-3-2-1 数完。开赛时刻还没到的时候这一局当然没完（roundOver 头一句就
// 是这个判断），不等满就验不到要验的那条路。
//
// 睡到服务器给的 startAt，不写死一个数：这一局屋里两个人都没报过「看过教
// 学」，所以它是「可能有新手」的那一种，开赛前多留了四秒（ASK_MS）。
const openAt = (await stateOf()).startAt;
await new Promise((r) => setTimeout(r, Math.max(0, openAt - Date.now()) + 300));

// 屋主交卷；客人一声不吭地把网页关了。
await call({ action: 'score', ...host, score: 100, finished: true, seconds: 20, round: 1 });
const beforeBye = await stateOf();
check('客人还在打，这一局当然没完', beforeBye.roundOver === false, String(beforeBye.roundOver));

await call({ action: 'bye', ...guest });

// 宽限期之内：还不算数。这十秒是留给「他只是刷新了一下」的——这一局不能就
// 这么判完，椅子也不能这就让出去。
const inGrace = await stateOf();
check('刚说完 bye 的这十秒里，这一局还不算完（他可能只是刷新）',
  inGrace.roundOver === false, String(inGrace.roundOver));
check('这十秒里也还不标「关了」',
  inGrace.players.every((p) => p.id !== guest.playerId || p.closed !== true),
  JSON.stringify(inGrace.players.map((p) => [p.name, p.closed])));

// 十秒过了他还没回来：这回是真走了。
await agePast(code, guest.playerId);
const afterBye = await stateOf();
check('十秒过了人没回来，这一局就算完，不用再等九十秒',
  afterBye.roundOver === true, String(afterBye.roundOver));
check('他还留在名单和排名里，只是标着「关了」',
  afterBye.players.some((p) => p.id === guest.playerId && p.closed === true),
  JSON.stringify(afterBye.players.map((p) => [p.name, p.closed])));

// 满座时，那把椅子让得出来。
const fill = [];
for (let i = 0; i < 6; i++) {
  fill.push(await call({ action: 'join', code, name: 'F' + i }));
}
check('剩下六把椅子都坐满了（屋主 + 关了网页那位 + 六个 = 8）',
  fill.every((r) => r.status === 200), fill.map((r) => r.status).join(','));

const ninth = await call({ action: 'join', code, name: 'LATE' });
check('第九个人进得来——关了网页那把椅子让给他',
  ninth.status === 200, `${ninth.status} ${JSON.stringify(ninth.body.error ?? '')}`);
const packed = await stateOf();
check('让座之后仍然只有八把椅子在用（没有凭空多出一把）',
  new Set(packed.players.filter((p) => !p.left && !p.closed).map((p) => p.id)).size === 8,
  String(packed.players.length));
check('屋主还是屋主', packed.host === host.playerId);

// 再来一个：这回真的满了。
const tenth = await call({ action: 'join', code, name: 'LATER' });
check('十个人就真的满了', tenth.status === 409 && tenth.body.error === 'full',
  `${tenth.status} ${JSON.stringify(tenth.body)}`);

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
