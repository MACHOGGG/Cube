/**
 * 「屋里可能有新手」只对有教学的那两族成立。
 *
 *   node scripts/check-room-novice.mjs
 *
 * 不起服务器、不开浏览器：库用进程内那一份（ALLOW_MEMORY_STORE）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 开局时服务器要判一句「这一局要不要多留四秒（ASK_MS）」：屋里有人没看过这一族的
 * 教学，就多留——那四秒里他那台设备会问他「会不会玩」，其他人的倒数从 8 数起。
 *
 * 判断读的是座位上的 `seen`（客户端报上来的「我看过哪几族的教学」）。而网页那头的
 * `seenTutorials()` **只会回 square 和 circle**：教学本来就只有这两族，基础三角
 * 2026-09 删了，剩下的大三角是天才特供，没有自己那一份教学。
 *
 * 于是三角那一族的 `seen` 里**永远是空的**，而那一句问的是「有人没看过这一族的教
 * 学」——大三角那间屋子**每一局**都被判成「可能有新手」：全屋的倒数永远从 8 数起，
 * 而且每一局都把「你会不会玩」那一屏弹到每个人脸上。屋里没有一个人能让它停下来：
 * 答「会」也不写 `seen`（写了也没有三角那一项可写）。
 *
 * 所以这一台钉两头：
 *   · 有教学的那两族（square / circle）照旧认 `seen`——没报过就多留四秒，报过就不留；
 *   · 没有教学的那几副（triangleBig / squareDiamond / circleHex / circleSeven）一律
 *     不多留，哪怕一个人都没报过 `seen`。
 *
 * ⚠️ 这里的「族」是按 `familyOf`（id 前缀）算的，不是按棋盘 id：`squareDiamond` 是
 * square 族，`circleHex` / `circleSeven` 是 circle 族。所以这几副**仍然**认 seen——
 * 它们和基础那两副共用同一份教学（同一族）。真正被这一改放开的只有三角那一族。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const room = (await import('../api/room.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');

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
    { method: 'POST', headers: { 'x-forwarded-for': `198.22.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}` }, body },
    res,
  );
  return { status, body: JSON.parse(text || '{}') };
};

const account = newAccount('nnn777', 'code');
account.until = Date.now() + 9e8;
await saveAccount('novicehost@example.com', account);
const who = { email: 'novicehost@example.com', accountToken: account.token };

/**
 * 开一间屋、开一局，回「倒数多长」和「屏幕上从几数起」。
 *
 * @param seen 两个人各自报的 seen（null 表示这一局一个字都不报）。
 */
async function round(mode, seen) {
  const h = await call({ action: 'create', name: '屋主', ...who });
  const code = h.body.code;
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  const g = await call({ action: 'join', code, name: '客人', ...(seen ? { seen } : {}) });
  const guest = { playerId: g.body.playerId, playerToken: g.body.playerToken };
  if (seen) await call({ action: 'learn', code, ...host, learning: false, seen });
  const st = await call({ action: 'start', code, ...host, mode });
  if (st.status !== 200) throw new Error(`${mode} 开局失败：${st.status} ${st.body.error}`);
  return { ms: st.body.startAt - Date.now(), countFrom: st.body.countFrom, guest, host, code };
}

// 这两个数要和 api/room.js 一致：倒数 4.5 秒（横屏那副 5.5），多留 4 秒。
const BASE_MS = 4500;
const WIDE_MS = 5500;
const ASK_MS = 4000;
/** 时间比的是区间，不是等号：开局到读这个数之间隔着几毫秒。 */
const about = (ms, want) => Math.abs(ms - want) < 400;

// ---- ① 有教学的那两族：没报过 seen，就多留四秒 --------------------------
for (const mode of ['square', 'circle']) {
  const r = await round(mode, null);
  check(`① ${mode}：没人报过 seen → 多留四秒`, about(r.ms, BASE_MS + ASK_MS), `${r.ms}ms`);
  check(`① ${mode}：屏幕上从 8 数起`, r.countFrom === 8, String(r.countFrom));
}

// ---- ② 同一族，报过 seen 就不留 ----------------------------------------
{
  const r = await round('square', ['square']);
  check('② square：两个人都看过了 → 不多留', about(r.ms, BASE_MS), `${r.ms}ms`);
  check('② square：屏幕上从 4 数起', r.countFrom === 4, String(r.countFrom));
}
{
  const r = await round('circle', ['circle']);
  check('② circle：两个人都看过了 → 不多留', about(r.ms, BASE_MS), `${r.ms}ms`);
}
// 报的是另一族：这一族还是没看过，照样多留。（量程：上面那两条不是「只要报了
// 就不留」。）
{
  const r = await round('circle', ['square']);
  check('② 只报过 square 的人进 circle 屋 → 还是多留四秒', about(r.ms, BASE_MS + ASK_MS), `${r.ms}ms`);
}

// ---- ③ 同族的另外几副棋盘也认 seen（它们共用那一份教学） ----------------
for (const [mode, family, base] of [
  ['squareDiamond', 'square', BASE_MS],
  ['circleHex', 'circle', BASE_MS],
  ['circleSeven', 'circle', WIDE_MS],
]) {
  const none = await round(mode, null);
  check(`③ ${mode}（${family} 族）：没人报过 → 多留四秒`, about(none.ms, base + ASK_MS), `${none.ms}ms`);
  const did = await round(mode, [family]);
  check(`③ ${mode}：报过 ${family} → 不多留`, about(did.ms, base), `${did.ms}ms`);
}

// ---- ④ 三角那一族：一个字都没报，也不许多留 -----------------------------
//
// #13 的正身。`seenTutorials()` 永远不会回 triangle，所以这里就是线上每一局的样子。
{
  const r = await round('triangleBig', null);
  check('④ triangleBig：没人报过 seen，也不多留四秒', about(r.ms, BASE_MS), `${r.ms}ms`);
  check('④ triangleBig：屏幕上从 4 数起（不是 8）', r.countFrom === 4, String(r.countFrom));
}
// 就算真有人报了 'triangle'（旧客户端、手搓的请求），结果也该一样——这一条是说
// 「三角不看 seen」，不是「三角要靠报 seen 来关掉」。
{
  const r = await round('triangleBig', ['triangle']);
  check('④ triangleBig：报了 triangle 也是同一个数', about(r.ms, BASE_MS), `${r.ms}ms`);
}

// ---- ⑤ 源码：那张表只收 square 和 circle -------------------------------
//
// 上面都是行为。这一条钉的是**那张表本身**：它要是哪天又被写成三族，④ 当场红；反
// 过来，这一条红的时候④还绿着，说明有人把判断整个挪走了——两头各看一次。
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../api/room.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes('const NOVICE_FAMILIES'));
  check('⑤ 源码：NOVICE_FAMILIES 就是 {square, circle}',
    Boolean(line) && line.includes("'square'") && line.includes("'circle'") && !line.includes("'triangle'"),
    String(line).trim());
  const used = src.split('\n').filter((l) => l.includes('NOVICE_FAMILIES.has('));
  check('⑤ 源码：判新手那一处真的问了它（量程）', used.length === 1, `${used.length} 处`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
