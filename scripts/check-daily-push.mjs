/**
 * 每日挑战的「今日」榜：服务器只收那一天、那一串码、那一个玩法（第 19 推）。
 *
 *   node scripts/check-daily-push.mjs
 *
 * 不起服务器、不开浏览器：直接叫 api/scores.js 的 handler，库用进程内那一份。钟用的是这个进程
 * 自己的 Date.now——这道门把它换成一个手拨的钟，才量得到「零点后宽限几分钟」那条线的两边。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么（方案原话：「服务器拒绝伪造的 daily」）
 *
 * 客户端说「这一局是 10 月 3 日的每日挑战」，服务器不信这句话：
 *
 *   ① 日子是服务器眼里的今天（北京时间）；零点后 DAILY_GRACE_MS 以内还收前一天的，过了就是
 *      late；明天的、不是日期的，一律 rejected。
 *   ② 种子是服务器**自己算**的那一串（_seedcode.js 的 dailySeed）——换一串、随手编一串，都
 *      不收。
 *   ③ 玩法和棋盘就是那一天轮到的那一个——拿当天那串码报一局别的玩法，不收。
 *   ④ 收下的进 `lb:daily:YYYYMMDD`，每人取当天最好的一局（GT）；看榜走 board、mode 'daily'，
 *      前五十名＋我排第几。
 *   ⑤ 被拒的那一局**照样记进存档和常规榜**——它是一局真打出来的游戏，只是不算那一天的挑战。
 *
 * 每一条都先摆尺子：真的那一局确实收下了、榜上确实有人，拒掉的那几条才说明得了什么。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { readFileSync } = await import('node:fs');
const SC = await import('../api/_seedcode.js');
const { default: handler } = await import('../api/scores.js');
const accounts = await import('../api/_accounts.js');

const SCORING_V = (() => {
  const src = readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8');
  const m = /export const SCORING_RULES_VERSION = '([^']+)'/.exec(src);
  if (!m) throw new Error('读不到 SCORING_RULES_VERSION');
  return m[1];
})();
/** 宽限多久，从 api/scores.js 现读（别在这儿抄第二遍）。 */
const GRACE = (() => {
  const src = readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8');
  const m = /const DAILY_GRACE_MS = ([0-9_ *]+);/.exec(src);
  if (!m) throw new Error('读不到 DAILY_GRACE_MS');
  return Function(`return ${m[1].replace(/_/g, '')}`)();
})();

// ---- 手拨的钟 --------------------------------------------------------------
const realNow = Date.now.bind(Date);
let fakeNow = null;
Date.now = () => (fakeNow === null ? realNow() : fakeNow);
const setNow = (t) => {
  fakeNow = t;
};

async function call(body) {
  const res = {
    code: 200,
    payload: null,
    status(c) { res.code = c; return res; },
    setHeader() { return res; },
    end(text) {
      try { res.payload = JSON.parse(text); } catch { res.payload = text; }
      return res;
    },
  };
  await handler({ method: 'POST', body }, res);
  return { status: res.code, payload: res.payload };
}
async function makePlayer(email) {
  const account = accounts.newAccount('secret', 'code');
  account.until = realNow() + 30 * 24 * 3600e3;
  await accounts.saveAccount(email, account);
  return { email, token: account.token };
}

/** 编号表那一行（玩法）→ 存档里的 modeKey 和老虎机标记。和客户端 modeKeyOf 同一张对照。 */
const MODE_KEY = { base: 'base', timed: 'timed', bomb: 'bomb', bombTimed: 'bombTimed', bombAdv: 'bomb', slot: 'base', flip: 'flip', puzzle: 'puzzle' };
const TILES = { square: 36, circle: 28 };

/** 一局像样的存档：那一天、那一串码、那一个玩法（`over` 拿来改坏其中一样）。 */
function dailyData(day, score, over = {}) {
  const v = SC.VARIANTS[SC.dailyVariant(day)];
  return {
    shapeId: v.board,
    shapeFallback: v.board,
    modeKey: MODE_KEY[v.mode],
    ...(v.mode === 'slot' ? { slot: true } : {}),
    ...(v.mode === 'puzzle' ? { boardTiles: TILES[v.board] ?? 36, puzzleRules: 2 } : {}),
    ...(v.mode === 'flip' ? { flipRules: 2 } : {}),
    ...(v.mode.startsWith('bomb') ? { bombRules: 3 } : {}),
    totalScore: score,
    score,
    ratePercent: 80,
    bonusMult: 1.5,
    elapsedSec: 60,
    moves: 40,
    best: score,
    reason: 'cleared',
    neverFlipped: 0,
    unflippedScale: 1,
    timeMult: 1,
    patternPoints: score,
    comboBonusPoints: 0,
    linePoints: 0,
    extraPenalty: 0,
    extraPenaltyReason: '',
    hazardEnd: false,
    rules: SCORING_V,
    seed: SC.dailySeed(day),
    seedSource: 'daily',
    daily: SC.dayKey(day),
    ...over,
  };
}
let runN = 0;
const push = (who, data) =>
  call({ action: 'push', ...who, runId: `daily-${++runN}`, mode: data.shapeId, score: data.totalScore, data });
const todayBoard = (who) => call({ action: 'board', ...who, mode: 'daily' });

// 「今天」钉在北京时间中午：离两头的零点都远，量的是 ①②③ 而不是宽限那条线。
const NOON = SC.dayStartOf(SC.dayIndexOf(realNow())) + 12 * 3600e3;
setNow(NOON);
const today = SC.dayIndexOf(NOON);
const todayKey = SC.dayKey(today);
const todayV = SC.VARIANTS[SC.dailyVariant(today)];
console.log(`今天（北京）${todayKey}：${todayV.mode} / ${todayV.board}，种子 ${SC.dailySeed(today)}`);

// ── ① 真的那一局：收下，榜上有它 ────────────────────────────────────────────
const A = await makePlayer('daily-a@example.com');
{
  const r = await push(A, dailyData(today, 120));
  check('① 尺子：今天、今天那串码、今天那个玩法——收下（stored）', r.status === 200 && r.payload?.daily === 'stored',
    `${r.status} ${JSON.stringify(r.payload?.daily)}`);
  const b = await todayBoard(A);
  check('① 今日榜上有这一个人、这一分', b.status === 200 && b.payload?.rows?.length === 1 && b.payload.rows[0].score === 120 && b.payload.rows[0].me === true,
    JSON.stringify(b.payload?.rows));
  check('① 我排第几：第 1 名、120 分', b.payload?.me?.rank === 1 && b.payload.me.score === 120, JSON.stringify(b.payload?.me));
  check('① 回包说的是今天那一张（day）', b.payload?.day === todayKey, String(b.payload?.day));
}

// ── ④ 当天最好的一局（GT）────────────────────────────────────────────────────
{
  await push(A, dailyData(today, 90));
  let b = await todayBoard(A);
  check('④ 打得更差的一局不把榜上那一分拉下来', b.payload?.rows?.[0]?.score === 120, JSON.stringify(b.payload?.rows?.[0]));
  await push(A, dailyData(today, 150));
  b = await todayBoard(A);
  check('④ 打得更好的一局顶上去', b.payload?.rows?.[0]?.score === 150 && b.payload.rows.length === 1, JSON.stringify(b.payload?.rows));
}

// ── ② 种子不对 ──────────────────────────────────────────────────────────────
const B = await makePlayer('daily-b@example.com');
{
  // 同一个玩法、另一串码（随手编的，校验位照样对——客户端算得出来的那种）。
  const forged = SC.encodeSeed(SC.DEAL_VERSION, SC.dailyVariant(today), 12345);
  const r1 = await push(B, dailyData(today, 999 % 200, { seed: forged }));
  check('② 换一串码冒充今天：rejected', r1.payload?.daily === 'rejected', JSON.stringify(r1.payload?.daily));
  const r2 = await push(B, dailyData(today, 150, { seed: SC.dailySeed(today - 1) }));
  check('② 拿昨天那串码冒充今天：rejected', r2.payload?.daily === 'rejected', JSON.stringify(r2.payload?.daily));
  const r3 = await push(B, dailyData(today, 150, { seed: undefined }));
  check('② 不带种子：rejected', r3.payload?.daily === 'rejected', JSON.stringify(r3.payload?.daily));
  const b = await todayBoard(B);
  check('② 今日榜上没有 B', !b.payload?.rows?.some((r) => r.me), JSON.stringify(b.payload?.rows));
  // ⑤ 被拒的照样进存档。
  const mine = await call({ action: 'mine', ...B });
  check('⑤ 被拒的那几局照样记进存档（它们是真打出来的局）', mine.payload?.runs === 3, `runs=${mine.payload?.runs}`);
}

// ── ③ 玩法不对 ──────────────────────────────────────────────────────────────
const C = await makePlayer('daily-c@example.com');
{
  // 当天那串码、换一副棋盘报上来（方块那一天报小球，别的一律报方块）。
  const otherBoard = todayV.board === 'square' ? 'circle' : 'square';
  const r1 = await push(C, dailyData(today, 150, { shapeId: otherBoard, shapeFallback: otherBoard }));
  check(`③ 当天那串码、换一副棋盘（${otherBoard}）：rejected`, r1.payload?.daily === 'rejected', JSON.stringify(r1.payload?.daily));
  // 当天那串码、换一个玩法（基础那一天报计时，别的一律报基础）。
  const otherMode = MODE_KEY[todayV.mode] === 'base' && todayV.mode !== 'slot' ? 'timed' : 'base';
  const r2 = await push(C, dailyData(today, 150, { modeKey: otherMode, slot: undefined, boardTiles: undefined }));
  check(`③ 当天那串码、换一个玩法（${otherMode}）：rejected`, r2.payload?.daily === 'rejected', JSON.stringify(r2.payload?.daily));
  const b = await todayBoard(C);
  check('③ 今日榜上没有 C', !b.payload?.rows?.some((r) => r.me), JSON.stringify(b.payload?.rows));
}

// ── ① 日子：明天的、不是日期的 ─────────────────────────────────────────────
{
  const r1 = await push(C, dailyData(today + 1, 150));
  check('① 明天的每日挑战（明天那串码）：rejected', r1.payload?.daily === 'rejected', JSON.stringify(r1.payload?.daily));
  const r2 = await push(C, dailyData(today, 150, { daily: '20261340' }));
  check('① 不是一个真日期（13 月 40 号）：rejected', r2.payload?.daily === 'rejected', JSON.stringify(r2.payload?.daily));
  const r3 = await push(C, dailyData(today, 150, { daily: 'today' }));
  check('① 不是日期的那种字：rejected', r3.payload?.daily === 'rejected', JSON.stringify(r3.payload?.daily));
  const r4 = await push(C, dailyData(today - 3, 150));
  check('① 三天前那一局（那一天那串码、那个玩法）：late', r4.payload?.daily === 'late', JSON.stringify(r4.payload?.daily));
}

// ── ① 零点后的宽限 ──────────────────────────────────────────────────────────
const D = await makePlayer('daily-d@example.com');
{
  const midnight = SC.dayStartOf(today);
  const yKey = SC.dayKey(today - 1);
  setNow(midnight + GRACE);
  const r1 = await push(D, dailyData(today - 1, 130));
  check(`① 零点后 ${GRACE / 60000} 分钟整：昨天那一局还收（stored）`, r1.payload?.daily === 'stored', JSON.stringify(r1.payload?.daily));
  setNow(midnight + GRACE + 1);
  const r2 = await push(D, dailyData(today - 1, 140));
  check('① 再晚一毫秒：late', r2.payload?.daily === 'late', JSON.stringify(r2.payload?.daily));
  // 收下的那一局进的是**昨天**那一张，不是今天：拨回昨天中午去看那一天的「今日」榜。
  setNow(midnight - 12 * 3600e3);
  const b = await todayBoard(D);
  check(`① 宽限里收下的那一局进的是 ${yKey} 那一张`, b.payload?.day === yKey && b.payload.rows.some((r) => r.me && r.score === 130),
    JSON.stringify(b.payload));
  setNow(NOON);
  const t = await todayBoard(D);
  check('① 今天那一张上没有它', !t.payload?.rows?.some((r) => r.me), JSON.stringify(t.payload?.rows));
}

// ── ⑦ 不是每日挑战的局不碰今日榜 ─────────────────────────────────────────────
const E = await makePlayer('daily-e@example.com');
{
  const plain = dailyData(today, 199, { seedSource: 'entered', daily: undefined });
  const r = await push(E, plain);
  check('⑦ 输进来的码（不带 daily）：回包里没有 daily 那一项', r.status === 200 && r.payload?.daily === undefined, JSON.stringify(r.payload));
  const b = await todayBoard(E);
  check('⑦ 今日榜上没有它（哪怕那串码正好是今天的）', !b.payload?.rows?.some((x) => x.me), JSON.stringify(b.payload?.rows));
}

// ── 看榜要天才（和别的榜同一道门）─────────────────────────────────────────
{
  const account = accounts.newAccount('secret', 'code');
  account.until = realNow() - 3 * 24 * 3600e3; // 过期了
  await accounts.saveAccount('daily-f@example.com', account);
  const r = await todayBoard({ email: 'daily-f@example.com', token: account.token });
  check('看今日榜和别的榜一样要天才：过期的 403', r.status === 403, `${r.status} ${JSON.stringify(r.payload)}`);
}

Date.now = realNow;
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
