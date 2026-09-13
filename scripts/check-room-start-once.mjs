/**
 * 屋主连点两下《再来》，只能开出一局。
 *
 *   npx esbuild src/engine/room.ts --bundle --format=esm --platform=neutral \
 *     --outfile=/tmp/room.mjs
 *   node scripts/check-room-start-once.mjs /tmp/room.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 开局有两颗按钮：主菜单上屋主挑的那张图（main.ts 的 startRoundFor），和结算
 * 页上的《再来》（ui/scoreboard.ts）。原先只有前者自己挡了连点，《再来》直接
 * 调 startMatch——双击就是两条 start 请求。
 *
 * 服务器两条都办，而且都能办成：两条看到的是同一份「上一局已经结束」的快照，
 * 所以两条都过了那道 `if (round && !roundOver) return 409` 的闸。记账不会翻倍
 * （bankRound 读的是同一份快照，算出来的 total/rounds 一样），**可种子会分
 * 叉**：每条 start 各自随机一个新 seed 写回去。库里留的是后到那一条的，而屋主
 * 这台设备用的是先回来那一条——于是屋主和屋里其他人发的不是同一副牌，同一步
 * 棋一个得分一个不得分。startAt 同理，两个不同的开赛时刻。
 *
 * 已经量到过：两条并发的 start 回来的 seed 分别是 dd774397… 和 00df5393…，
 * 库里留下 00df5393…。
 *
 * 挡在 startMatch 里而不是每个按钮各挡一遍：开局只有这一条路通到服务器。第二
 * 次调用接上同一个请求（不是假装成功，也不是直接失败），两个调用者拿到同一份
 * 回包、同一副牌。
 *
 * 这台门不起服务器：把 fetch 换成一个会数次数的假货就够了——要量的正是「发出
 * 去了几条」。
 */
const bundle = process.argv[2];
if (!bundle) {
  console.error('用法：node scripts/check-room-start-once.mjs <打好的 room.mjs>');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 模块顶层就会摸 localStorage 和 window，所以先把台子搭好再 import。
const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
globalThis.localStorage = storage;
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { addEventListener: () => {}, location: { origin: 'http://x' } };
// navigator 不用搭：node 自带一个，而这份代码只在 bye() 里
// `navigator.sendBeacon?.()` 这么用（可选链），这台门走不到那条路。

/** 每条 start 都开一个新棋盘：服务器就是这么干的（seed: id(8)）。 */
let seedN = 0;
let sent = 0;
let release = () => {};
const held = new Promise((r) => {
  release = r;
});
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  if (body.action !== 'start') throw new Error('这台门只该看到 start，收到 ' + body.action);
  sent++;
  // 真实的那一下：请求在路上待着，双击的第二下正落在这个窗口里。
  await held;
  const seed = 'seed' + ++seedN;
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 'AAAA', host: 'h', mode: body.mode, slot: null, flip: false, seed, startAt: 1, learnHold: false, round: 2, roundOver: false, ended: false, seats: 8, players: [], nudges: 0, nudgeAt: [], countFrom: 4, serverNow: 1 }),
  };
};

// 先坐进一个座位，startMatch 才有身份可带。
mem.set('slides_mp_seat', JSON.stringify({ code: 'AAAA', playerId: 'p1', playerToken: 't1', at: Date.now() }));
const { startMatch } = await import(bundle);

// ---- 连点两下 ------------------------------------------------------------
const a = startMatch('square');
const b = startMatch('square');
release();
const [ra, rb] = await Promise.all([a, b]);

check('双击《再来》只发出一条 start', sent === 1, `发了 ${sent} 条`);
check('两次调用都拿到回包', ra.ok === true && rb.ok === true, `${ra.ok} / ${rb.ok}`);
check(
  '两次调用是同一副牌（种子不分叉）',
  ra.ok && rb.ok && ra.value.seed === rb.value.seed,
  ra.ok && rb.ok ? `${ra.value.seed} / ${rb.value.seed}` : '',
);

// ---- 闸要放开：这一局结束后还得开得了下一局 ------------------------------
//
// 用 finally 而不是 then，就是为了这一条：请求失败（网断了、服务器回 409）也
// 要放开。不放开的话屋主这一整晚都开不了第二局，那颗键按下去没反应。
release = () => {};
const again = new Promise((r) => {
  release = r;
});
globalThis.fetch = async (_url, init) => {
  JSON.parse(init.body);
  sent++;
  await again;
  return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
};
const c = startMatch('circle');
release();
await c;
check('上一次办完了，闸放开了', sent === 2, `一共发了 ${sent} 条`);

globalThis.fetch = async () => {
  sent++;
  return { ok: true, status: 200, json: async () => ({ players: [], serverNow: 2, seed: 'seedZ' }) };
};
await startMatch('circle');
check('上一次失败了，闸照样放开（不然屋主一整局开不了第二次）', sent === 3, `一共发了 ${sent} 条`);

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
