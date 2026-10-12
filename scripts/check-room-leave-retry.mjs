/**
 * 客人按《离开小屋》那一条没送到：后台再送三次（1 秒 / 3 秒 / 8 秒），不让他干等（10-11 方案 C-4）。
 *
 *   npx esbuild src/engine/room.ts --bundle --format=esm --platform=neutral --outfile=/tmp/mproom.mjs
 *   node scripts/check-room-leave-retry.mjs /tmp/mproom.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 原先 leaveRoom 只送一次：网晃一下没送到，本机已经忘了这间屋，服务器上他的椅子却还占着——满屋的时候新朋友进
 * 不来，要等九十秒没心跳才收得回（报告二 #12）。现在没送到就在后台隔 1、3、8 秒各再送一次。
 *
 * 量五件事：送到了就不再送；没送到就照那张时间表再送、送到为止、最多再送三次；每一次带的是同一把座位钥匙；
 * leaveRoom 本身在头一次回来就返回（走的人要马上看到那张总战绩图，ui/multiplayer.ts 的 leaveSeat 等的就是它）；
 * 本机的座位当场就清掉了，不等那几次。
 *
 * 不起服务器：fetch 换成一个会数次数、能按次失败的假货；setTimeout 换成「记下要等几毫秒、马上就跑」——真等
 * 十二秒，check 那一条的节奏就被拖慢了。
 */
const bundle = process.argv[2];
if (!bundle) {
  console.error('用法：node scripts/check-room-leave-retry.mjs <打好的 room.mjs>');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 模块顶层就会摸 localStorage 和 window，所以先把台子搭好再 import（check-room-start-once 同一个台子）。
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { addEventListener: () => {}, location: { origin: 'http://x' } };

/** 这一轮里第几次 leave 要失败（从 1 数）。 */
let failOn = new Set();
let hangOn = new Set();
let calls = [];
const reply = (ok, status, payload) => ({ ok, status, json: async () => payload, text: async () => JSON.stringify(payload) });
const roomState = { code: 'AAAA', host: 'h', round: 0, players: [], nudges: 0, nudgeAt: [], seats: 8, serverNow: 1 };
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  // 每一轮先进一次屋（joinRoom），座位才有：本机的座位在模块载入时读一次，之后只由进屋、离开写。
  if (body.action === 'join') return reply(true, 200, { playerId: 'p1', playerToken: 't1', state: roomState });
  if (body.action !== 'leave') throw new Error('这台门只该看到 join / leave，收到 ' + body.action);
  calls.push(body);
  const n = calls.length;
  if (hangOn.has(n)) await new Promise(() => {});
  if (failOn.has(n)) throw new TypeError('Failed to fetch');
  return reply(true, 200, { ok: true });
};
/**
 * 「等」的那几下：记下要等几毫秒，马上就跑。每一条请求自己还挂着一个钟（engine/fetchTimeout.ts 的 FETCH_TIMEOUT_MS，
 * 十五秒没回来就当失败）——那几个不是重送前的等，不记；也不能马上跑，不然请求还没回来就被它判成超时。
 */
let waits = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  if (ms >= 10_000) return realSetTimeout(fn, ms, ...rest);
  if (ms >= 500) waits.push(ms);
  return realSetTimeout(fn, 0, ...rest);
};

const { joinRoom, leaveRoom, randomAvatar } = await import(bundle);
const sitDown = () => joinRoom('AAAA', '客人', randomAvatar());
/** 后台那几次跑完（假的 setTimeout 是马上跑，几拍宏任务就够）。 */
const settle = () => new Promise((r) => realSetTimeout(r, 50));
const round = async (fails, hangs = []) => {
  calls = [];
  waits = [];
  failOn = new Set(fails);
  hangOn = new Set(hangs);
  await sitDown();
  const seated = mem.has('slides_mp_seat');
  calls = [];
  await leaveRoom();
  const seatGone = !mem.has('slides_mp_seat');
  const atReturn = calls.length;
  await settle();
  return { seated, atReturn, calls: calls.length, waits: [...waits], seatGone, bodies: [...calls] };
};

// ① 头一次就送到了：不再送。
{
  const r = await round([]);
  check('①（尺子）进屋之后本机记着座位', r.seated);
  check('① 头一次就送到了：只送一次', r.calls === 1, `${r.calls} 次`);
  check('① 不等任何一下', r.waits.length === 0, r.waits.join(','));
}

// ② 头两次没送到，第三次送到了：隔 1 秒、3 秒各再送一次，送到就停。
{
  const r = await round([1, 2]);
  check('② 没送到：照时间表再送，送到为止（一共 3 次）', r.calls === 3, `${r.calls} 次`);
  check('② 等的是 1 秒、3 秒', r.waits.join(',') === '1000,3000', r.waits.join(','));
  check('② 每一次带的都是同一把座位钥匙', r.bodies.every((b) => b.playerId === 'p1' && b.playerToken === 't1' && b.code === 'AAAA'),
    JSON.stringify(r.bodies.map((b) => b.playerId)));
}

// ③ 一直送不到：最多再送三次（1 + 3），然后就停。
{
  const r = await round([1, 2, 3, 4, 5, 6]);
  check('③ 一直送不到：一共送 4 次就停（不没完没了）', r.calls === 4, `${r.calls} 次`);
  check('③ 等的是 1 秒、3 秒、8 秒', r.waits.join(',') === '1000,3000,8000', r.waits.join(','));
}

// ④ leaveRoom 在头一次回来就返回，不等后面那几次；座位当场清掉。
{
  const r = await round([1], [2]);
  check('④ 头一次没送到：leaveRoom 照样当场返回（后面那几次在后台）', r.atReturn === 1, `返回时已送 ${r.atReturn} 次`);
  check('④ 本机的座位当场就清掉了', r.seatGone);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
