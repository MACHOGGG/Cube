/**
 * 排行榜防刷（10-09 补充方案 7-1，审计 #1）：只认六副正式棋盘、重建清掉乱名的榜、管理员能把一个人整个撤下来、
 * 步步为营的上限按写进哪张榜判断、只读的分数统计只回数。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-scores-mode-whitelist.mjs
 *
 * 不起浏览器也不起服务器：直接叫 api/scores.js 的 handler，用内存里那个 Redis 替身（和 check-scores 同一套）。
 *
 * ── 审计核实过的那几条（都是真的，而且比报的更严重）───────────────────────────
 *
 *   · 任意一个像样的 mode 名都会新开一张榜：`lb:hacker` 没人看得见，可它进了 stats.best，总榜那一行是从
 *     best 里挑最高的——一个乱名一局 999999999 就把总榜第一占了；
 *   · `rebuild` 照存档把这些乱名的局重新写回榜上，点一次重建就复活一次；
 *   · 步步为营的上限只在 `data.modeKey === 'puzzle'` 时检查——闸和「写进哪张榜」两处各判各的。
 *
 * 方案要的门：「未知 mode 回 400；rebuild 清掉垃圾榜；purge 之后此人不在任何榜，再推也上不去；modeKey:'base'
 * 推到步步为营榜照样被上限挡住」。最后那一条照现在的 kindOf 摆不出来——modeKey 不是 'puzzle' 的局根本进不了
 * 步步为营那几张榜（它进的是基础那一张），所以这儿量的是它的两半：写进步步为营榜的局一律套上限（连归档的
 * `…:puzzle` 也套）；modeKey 写成 'base' 的大分进的是基础榜，步步为营榜上没有他。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.ADMIN_TOKEN = 'z'.repeat(32);

const { default: handler } = await import('../api/scores.js');
const accounts = await import('../api/_accounts.js');
const store = await import('../api/_store.js');
const seed = await import('../api/_seedcode.js');

import { readFileSync } from 'node:fs';

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const SCORING_V = (() => {
  const m = /export const SCORING_RULES_VERSION = '([^']+)'/.exec(readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8'));
  if (!m) throw new Error('读不到 SCORING_RULES_VERSION');
  return m[1];
})();

/** 叫一次接口。交卷那一路照真客户端的样子补齐 data（shapeId / totalScore / rules），和 check-scores 一样。 */
async function call(body, ip = '203.0.113.7') {
  if (body?.action === 'push') {
    body = { ...body, data: { shapeId: body.mode, totalScore: body.score, ...(body.data || {}), rules: SCORING_V } };
  }
  const req = { method: 'POST', body, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
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
  await handler(req, res);
  return { status: res.code, payload: res.payload };
}

async function makePlayer(email) {
  const account = accounts.newAccount('secret', 'code');
  account.until = Date.now() + 30 * 24 * 3600e3;
  await accounts.saveAccount(email, account);
  return { email, token: account.token };
}

const TOKEN = process.env.ADMIN_TOKEN;
const BOARDS = ['square:base', 'circle:base', 'square:timed', 'square:puzzle2', 'circle:puzzle2', 'squareDiamond', 'circleHex', 'circleSeven', 'triangleBig'];
/** 这个人此刻在哪几张榜上（含总榜、总榜的玩法标记、今天的每日榜）。 */
async function boardsOf(id) {
  const on = [];
  for (const b of BOARDS) if ((await store.zscore('lb:' + b, id)) !== null) on.push(b);
  if ((await store.zscore('lb:total', id)) !== null) on.push('total');
  if ((await store.hget('lb:total:mode', id)) !== null) on.push('total:mode');
  const today = seed.dayKey(seed.dayIndexOf(Date.now()));
  if ((await store.zscore('lb:daily:' + today, id)) !== null) on.push('daily');
  return on;
}

const A = await makePlayer('a@example.com');
const B = await makePlayer('b@example.com');
const X = await makePlayer('x@example.com');

// ── ① 未知 mode 回 400 ─────────────────────────────────────────────────────
{
  const bad = await call({ action: 'push', ...A, runId: 'junk-1', mode: 'hacker', score: 999999999 });
  check('① 六副正式棋盘以外的 mode：400 mode', bad.status === 400 && bad.payload?.error === 'mode', JSON.stringify(bad));
  const retired = await call({ action: 'push', ...A, runId: 'junk-2', mode: 'triangleAdvanced', score: 500 });
  check('① 删掉的棋盘（triangleAdvanced）也一样：400 mode', retired.status === 400 && retired.payload?.error === 'mode', JSON.stringify(retired));
  const mine = await call({ action: 'mine', ...A });
  check('① 被拦下的两局一局都没记：累计 0、存档 0', mine.payload?.total === 0 && mine.payload?.archive?.length === 0, JSON.stringify(mine.payload?.total));
  check('① 库里没有长出 lb:hacker 这张榜', (await store.zscore('lb:hacker', A.email)) === null);
  for (const mode of ['square', 'circle', 'squareDiamond', 'circleHex', 'circleSeven', 'triangleBig']) {
    const ok = await call({ action: 'push', ...B, runId: `ok-${mode}`, mode, score: 120 });
    check(`① （尺子）正式棋盘 ${mode} 照收`, ok.status === 200 && ok.payload?.ok === true, JSON.stringify(ok));
  }
  // 旧客户端（规则版本对不上）照旧走那条温和的 200，不吃新那道 400——闸的次序没乱。
  const oldClient = await call({ action: 'push', ...A, runId: 'old-1', mode: 'hacker', score: 1, data: { rules: 'old' } });
  // call() 会把 rules 补成现行版本，这一条要绕开它：直接叫 handler。
  const req = { method: 'POST', body: { action: 'push', ...A, runId: 'old-2', mode: 'hacker', score: 1, data: { shapeId: 'hacker', totalScore: 1, rules: 'old' } } };
  const res = { code: 200, payload: null, status(c) { res.code = c; return res; }, setHeader() { return res; }, end(t) { res.payload = JSON.parse(t); return res; } };
  await handler(req, res);
  check('① 规则版本对不上的旧客户端照旧 200 stored:false（规则闸在 mode 闸前面）', res.code === 200 && res.payload?.stored === false, JSON.stringify(res.payload));
  void oldClient;
}

// ── ② 重建清掉乱名的榜 ───────────────────────────────────────────────────────
{
  // 照审计摆出从前那种局面：从前 push 收任意 mode，乱名的榜、best、存档、总榜都是这么写进去的。
  const id = X.email;
  await store.set('stats:' + id, { total: 999999999 + 300, runs: 2, best: { hacker: 999999999, 'square:base': 300 }, seen: ['h1', 's1'] });
  await store.set('runs:' + id, [
    { runId: 'h1', mode: 'hacker', score: 999999999, at: Date.now(), data: { shapeId: 'hacker', totalScore: 999999999, rules: SCORING_V } },
    { runId: 's1', mode: 'square', score: 300, at: Date.now() - 1000, data: { shapeId: 'square', totalScore: 300, rules: SCORING_V } },
  ]);
  await store.zadd('lb:hacker', 999999999, id);
  await store.zadd('lb:square:base', 300, id);
  await store.zadd('lb:total', 999999999, id);
  await store.hset('lb:total:mode', id, 'hacker');
  // 归档榜上的一行（老规则时代留下的）：重建不碰归档榜，这一行得原样留着。
  await store.zadd('lb:square:bomb2', 77, id);
  const s0 = await store.get('stats:' + id);
  s0.best['square:bomb2'] = 77;
  await store.set('stats:' + id, s0);

  const rb = await call({ action: 'rebuild', token: TOKEN });
  check('② 重建跑完了', rb.status === 200 && rb.payload?.done === true, JSON.stringify(rb.payload));
  check('② 乱名那张榜上没有他了', (await store.zscore('lb:hacker', id)) === null);
  check('② 总榜换成他正式棋盘上的最高分（300），玩法标记跟着换', (await store.zscore('lb:total', id)) === 300 && (await store.hget('lb:total:mode', id)) === 'square:base',
    `${await store.zscore('lb:total', id)} / ${await store.hget('lb:total:mode', id)}`);
  const st = await store.get('stats:' + id);
  check('② 新算的 best 里没有乱名', st?.best && !('hacker' in st.best) && st.best['square:base'] === 300, JSON.stringify(st?.best));
  check('② 存档一个字没动（两局都还在）', (await store.get('runs:' + id))?.length === 2);
  check('② 归档榜上那一行原样留着（重建不碰归档榜，清垃圾时也认得它）', (await store.zscore('lb:square:bomb2', id)) === 77, String(await store.zscore('lb:square:bomb2', id)));
  const again = await call({ action: 'rebuild', token: TOKEN });
  check('② 再重建一次，乱名的局也不会照存档请回榜上', again.status === 200 && (await store.zscore('lb:hacker', id)) === null);
}

// ── ③ 步步为营的上限按写进哪张榜判断 ─────────────────────────────────────────
{
  const over = await call({ action: 'push', ...A, runId: 'pz-1', mode: 'square', score: 361, data: { modeKey: 'puzzle', puzzleRules: 2, boardTiles: 36 } });
  check('③ 写进 square:puzzle2 的局超过「36 枚 × 10」：400 score', over.status === 400 && over.payload?.error === 'score', JSON.stringify(over));
  const archived = await call({ action: 'push', ...A, runId: 'pz-2', mode: 'square', score: 5000, data: { modeKey: 'puzzle', puzzleRules: 1, boardTiles: 36 } });
  check('③ 写进归档的 square:puzzle 也套同一道上限', archived.status === 400 && archived.payload?.error === 'score', JSON.stringify(archived));
  const liar = await call({ action: 'push', ...A, runId: 'pz-3', mode: 'square', score: 900, data: { modeKey: 'puzzle', puzzleRules: 2, boardTiles: 999 } });
  check('③ 报一个 999 枚抬不高上限（取服务端知道的 36）', liar.status === 400 && liar.payload?.error === 'score', JSON.stringify(liar));
  const fine = await call({ action: 'push', ...A, runId: 'pz-4', mode: 'square', score: 360, data: { modeKey: 'puzzle', puzzleRules: 2, boardTiles: 36 } });
  check('③ （尺子）满分 360 照收', fine.status === 200 && fine.payload?.ok === true, JSON.stringify(fine));
  const base = await call({ action: 'push', ...A, runId: 'pz-5', mode: 'square', score: 50000, data: { modeKey: 'base', boardTiles: 36 } });
  check('③ modeKey 写成 base 的大分进的是基础榜', base.status === 200 && (await store.zscore('lb:square:base', A.email)) === 50000, JSON.stringify(base));
  const onPuzzle = await store.zscore('lb:square:puzzle2', A.email);
  check('③ 步步为营榜上他还是那 360（×1000 的拼法），没被那 50000 顶上去', onPuzzle !== null && Math.floor(onPuzzle / 1000) === 360, String(onPuzzle));
  // 源码那一头：闸问的是写进哪张榜，不再是 modeKey。
  const src = readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8');
  check('③ 源码：上限那道闸按 boardId 判（/:puzzle2?$/），不再问 data.modeKey', /if \(\/:puzzle2\?\$\/\.test\(boardId\)\)/.test(src) && !/if \(String\(data\.modeKey \|\| ''\) === 'puzzle'\)/.test(src));
}

// ── ④ purge：撤下所有榜，再推也上不去，重建也不请回来 ─────────────────────────
{
  const id = B.email;
  // 他留过昵称：重建走的是「总榜上的人 + 留过昵称的人」，撤下来之后他不在总榜上了，没有昵称的话重建
  // 根本不会碰他——那样「重建不请回来」这一条就是空绿（第一版就是这么空绿的）。
  const named = await call({ action: 'name', ...B, name: '乙乙' });
  check('④ （尺子）他留过昵称（重建会走到他）', named.status === 200, JSON.stringify(named));
  // 先让他上几张榜，外加今天的每日榜（直接写，每日挑战那一局的种子、玩法另有门在量）。
  const today = seed.dayKey(seed.dayIndexOf(Date.now()));
  await store.zadd('lb:daily:' + today, 123, id);
  const before = await boardsOf(id);
  check('④ （尺子）撤之前他在好几张榜上', before.length >= 4, before.join(' '));

  const noToken = await call({ action: 'purge', id }, '198.51.100.9');
  check('④ 没有令牌：401', noToken.status === 401, JSON.stringify(noToken));
  const unknown = await call({ action: 'purge', token: TOKEN, id: 'nobody@example.com' }, '198.51.100.9');
  check('④ 库里没有的 id：404，不新建一份「banned」', unknown.status === 404 && (await store.get('stats:nobody@example.com')) === null, JSON.stringify(unknown));
  const emptyId = await call({ action: 'purge', token: TOKEN, id: '  ' }, '198.51.100.9');
  check('④ 空 id：400', emptyId.status === 400, JSON.stringify(emptyId));

  const done = await call({ action: 'purge', token: TOKEN, id }, '198.51.100.9');
  check('④ 撤下来了：200，回包里只有 ok（没有他是谁、上过几张榜）', done.status === 200 && JSON.stringify(done.payload) === '{"ok":true}', JSON.stringify(done.payload));
  check('④ 他不在任何一张榜上（含总榜、玩法标记、今天的每日榜）', (await boardsOf(id)).length === 0, (await boardsOf(id)).join(' '));
  const st = await store.get('stats:' + id);
  check('④ stats 记上 banned、best 清空；累计和局数照旧', st?.banned === true && Object.keys(st.best || {}).length === 0 && st.runs === 6, JSON.stringify({ banned: st?.banned, best: st?.best, runs: st?.runs }));
  check('④ 存档一个字没动', (await store.get('runs:' + id))?.length === 6);

  const pushAgain = await call({ action: 'push', ...B, runId: 'after-1', mode: 'circle', score: 9999 });
  check('④ 再推一局：照收（200），存档多一局', pushAgain.status === 200 && (await store.get('runs:' + id))?.length === 7, JSON.stringify(pushAgain.payload));
  check('④ 再推一局：一张榜都没上', (await boardsOf(id)).length === 0, (await boardsOf(id)).join(' '));
  const st2 = await store.get('stats:' + id);
  check('④ 交卷写回去的 stats 里 banned 还在（loadStats 没把它丢掉）', st2?.banned === true && Object.keys(st2.best || {}).length === 0, JSON.stringify({ banned: st2?.banned, best: st2?.best }));

  const rb = await call({ action: 'rebuild', token: TOKEN }, '198.51.100.9');
  check('④ 重建之后他还是不在任何一张榜上（存档里那几局不再替他算）', rb.status === 200 && (await boardsOf(id)).length === 0, (await boardsOf(id)).join(' '));
  check('④ 重建之后 banned 还在', (await store.get('stats:' + id))?.banned === true);

  // 他自己去看总榜：老版本那条「没有玩法标记就按存档补回总榜」（healTotalBoard）不能把他补回去。
  const look = await call({ action: 'board', ...B, mode: '' });
  check('④ 他自己打开总榜那一下，也没被补回总榜', look.status === 200 && (await store.zscore('lb:total', id)) === null, JSON.stringify(look.status));
  // 再狠一点：banned 记着、best 里却还留着数（比如一份更老的写法写回去的 stats）。补总榜那一步认的
  // 是 banned，不是「best 恰好是空的」。
  const st3 = await store.get('stats:' + id);
  await store.set('stats:' + id, { ...st3, best: { 'circle:base': 9999 } });
  await store.hdel('lb:total:mode', id);
  await call({ action: 'board', ...B, mode: '' });
  check('④ banned 记着、best 里还留着数：打开总榜也不会把他补回去', (await store.zscore('lb:total', id)) === null, String(await store.zscore('lb:total', id)));
  await store.set('stats:' + id, st3);

  // 尺子：没被撤的人照样上榜。
  const other = await call({ action: 'push', ...A, runId: 'after-2', mode: 'circleSeven', score: 777 });
  check('④ （尺子）别人照样上榜', other.status === 200 && (await store.zscore('lb:circleSeven', A.email)) === 777);
}

// ── ⑤ 只读的分数统计：只回数 ────────────────────────────────────────────────
{
  const no = await call({ action: 'scoreStats', token: 'nope' }, '192.0.2.5');
  check('⑤ 令牌不对：401', no.status === 401, JSON.stringify(no));
  const st = await call({ action: 'scoreStats', token: TOKEN }, '192.0.2.5');
  const boards = st.payload?.boards || {};
  check('⑤ 回了每一张现行的榜', st.status === 200 && ['square:base', 'circle:base', 'square:puzzle2', 'circleSeven', 'triangleBig'].every((b) => b in boards), Object.keys(boards).join(' '));
  check('⑤ 每一张只有 n / max / p999 三个数', Object.values(boards).every((v) => Object.keys(v).sort().join() === 'max,n,p999' && Object.values(v).every((x) => typeof x === 'number')));
  check('⑤ 步步为营那张拆回了分数（360，不是 360000）', boards['square:puzzle2']?.max === 360, JSON.stringify(boards['square:puzzle2']));
  check('⑤ 基础榜的最高分是那 50000', boards['square:base']?.max === 50000, JSON.stringify(boards['square:base']));
  const text = JSON.stringify(st.payload);
  check('⑤ 回包里一个 id 都没有', !/@example\.com|hdl:|code:/.test(text), text.slice(0, 120));
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
