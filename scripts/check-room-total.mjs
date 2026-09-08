/**
 * 小屋的总分，就是各局之和——一分不多，一分不少。
 *
 *   node scripts/dev-server.mjs 8816 dist
 *   node scripts/check-room-total.mjs http://localhost:8816/
 *
 * 这个门只问一件事，而这件事之前没有任何一个门在问：屋子散场之后，每个人名
 * 下那个数，是不是正好等于他每一局得分的和。
 *
 * 为什么值得单独一个门：小屋的分数在服务器上分两处放着——`score` 是「手头
 * 这一局」，`total` 是「已经收进账的那些局」，屏幕上每一处显示的总分算的都
 * 是 total + score（见 ui/roomCard.ts 的 liveTotal）。开新一局那条路
 * （start）和散场那条路（end）各自把上一局收进账，两条路都对了，数才对。
 * 真出过的那次 bug 就是 end 收完账又把 score 写了回去，于是最后一局被加了两
 * 遍：三个人实打 300 分，发出去的战绩图上写 500。check-multiplayer、
 * check-room-rejoin、check-room-seats 都跑完了整套小屋流程，却没有一个去核
 * 对那个数，所以三个门全绿，图上照样是 500。
 *
 * 走的是 HTTP，不开浏览器：要证的是服务器那本账，不是画面。
 */
const BASE = (process.argv[2] || 'http://localhost:8816/').replace(/\/$/, '');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const room = (body) => post('/api/room', body);
const seatIn = (state, id) => (state.players || []).find((p) => p.id === id);
/** 屏幕上每一处的总分都是这个式子（ui/roomCard.ts 的 liveTotal）。 */
const liveTotal = (p) => (p ? p.total + p.score : NaN);

/**
 * 屋主先拿到天才：没有它开不出小屋。
 *
 * 内部码是一次性的，用掉就没了——dev-server 每次起来种四张（见它开头那行
 * 打印）。挨个试过去，所以同一台服务器上这个门可以连跑四遍，也不会跟别的
 * 门抢同一张。四张都用光了就该重起一台，下面那条会直说。
 */
async function becomeGenius() {
  for (const code of ['TESTLIFE', 'TESTYEAR', 'TESTHALF', 'TESTMONTH']) {
    const r = await post('/api/redeem', { code });
    if (r.body && r.body.active === true) return r.body;
  }
  return null;
}
const genius = await becomeGenius();
check('屋主用内部码开通天才', genius !== null, genius ? genius.period : '四张测试码都用掉了——换一台干净的 dev-server 再跑');
if (!genius) {
  console.log('\n1 条没过');
  process.exit(1);
}
const redeemed = { body: genius };

// ---- 开屋、进人 ------------------------------------------------------------
const made = await room({
  action: 'create',
  name: '甲',
  avatar: 0,
  seen: ['square', 'circle', 'triangle'],
  email: redeemed.body.email,
  accountToken: redeemed.body.token,
  holderCode: redeemed.body.code,
});
check('小屋开出来了', made.status === 200 && /^\d{4}$/.test(made.body.code || ''), made.body.code || JSON.stringify(made.body));
const code = made.body.code;
const host = { code, playerId: made.body.playerId, playerToken: made.body.playerToken };

const joined = await room({ action: 'join', code, name: '乙', avatar: 1, seen: ['square', 'circle', 'triangle'] });
check('客人进来了', joined.status === 200, JSON.stringify(joined.body).slice(0, 60));
const guest = { code, playerId: joined.body.playerId, playerToken: joined.body.playerToken };

/**
 * 开局那一刻服务器盖的是一个「几秒之后开赛」的时刻（4-3-2-1 那段倒数），而
 * 「这一局打完了没有」是从开赛之后才算的。所以要开下一局，得先等倒数走完，
 * 不然服务器会说这一局还没开始打（roundOver 里的第一行）。
 */
const untilStart = async (state) => {
  const wait = (state.startAt || 0) - Date.now() + 300;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
};

// ---- 第一局：甲 120，乙 70 -------------------------------------------------
const r1 = await room({ action: 'start', ...host, mode: 'square' });
check('第一局开起来了', r1.status === 200 && r1.body.round === 1, `round ${r1.body.round}`);
await untilStart(r1.body);
await room({ action: 'score', ...host, round: 1, score: 120, finished: true, seconds: 40 });
await room({ action: 'score', ...guest, round: 1, score: 70, finished: true, seconds: 55 });

// ---- 第二局：开局那一刻，第一局收进账 --------------------------------------
const r2 = await room({ action: 'start', ...host, mode: 'square' });
check('第二局开起来了', r2.status === 200 && r2.body.round === 2, `round ${r2.body.round}`);
check(
  '开第二局时，第一局已经收进账，手头那一局清零了',
  liveTotal(seatIn(r2.body, host.playerId)) === 120 && liveTotal(seatIn(r2.body, guest.playerId)) === 70,
  `甲 ${liveTotal(seatIn(r2.body, host.playerId))} · 乙 ${liveTotal(seatIn(r2.body, guest.playerId))}`,
);

// ---- 第二局：甲 80，乙 130 -------------------------------------------------
await untilStart(r2.body);
await room({ action: 'score', ...host, round: 2, score: 80, finished: true, seconds: 35 });
await room({ action: 'score', ...guest, round: 2, score: 130, finished: true, seconds: 30 });

// ---- 散场：这是出过 bug 的那条路 -------------------------------------------
const over = await room({ action: 'end', ...host });
check('屋主散了场', over.status === 200 && Boolean(over.body.ended), JSON.stringify(over.body.ended));

const a = seatIn(over.body, host.playerId);
const b = seatIn(over.body, guest.playerId);
check(
  '甲的总分正好是两局之和（120 + 80）',
  liveTotal(a) === 200,
  `total ${a && a.total} + score ${a && a.score} = ${liveTotal(a)}`,
);
check(
  '乙的总分正好是两局之和（70 + 130）',
  liveTotal(b) === 200,
  `total ${b && b.total} + score ${b && b.score} = ${liveTotal(b)}`,
);
// 上面那两条就能抓到重复计分，这一条说的是为什么：收完账那一局的分不该再留
// 在手头，留着就会被 total + score 加第二遍。
check('最后一局收完账就不再挂在手头', a.score === 0 && b.score === 0, `甲 ${a.score} · 乙 ${b.score}`);
check('两个人各打了两局', a.rounds === 2 && b.rounds === 2, `甲 ${a.rounds} · 乙 ${b.rounds}`);
check('单局最高记的是各自最好的那一局（甲 120 · 乙 130）', a.best === 120 && b.best === 130, `甲 ${a.best} · 乙 ${b.best}`);

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
