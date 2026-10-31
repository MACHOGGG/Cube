/**
 * 合并榜（10-31 方案推14 Z-B15 ③④⑥、Z-B16、Z-B18；内存库 ALLOW_MEMORY_STORE=1，进 ci.yml check）。
 *
 *   node scripts/check-lb-merge.mjs
 *
 * 造几张榜（各 250–600 人，含步步为营 ×1000 的拼数、:pro 榜、无限反转、并列分），然后量：
 *   ① mergeTop 的前 200 和「把每张榜全读出来再合」的暴力结果**逐行一致**（成员、分数、剩几步），随机 200 组选择；
 *   ② 「我」：在前 200 名里名次精确（同分同名次）；在外回 rank: null；被撤的人、「全部清空」之后、bestRules 缺省或为 ero1 的
 *      人都不出现；
 *   ③ 回包里没有 players、没有成员 id；非法参数（不是数组、太长、不认识的值、空交集）全回 400；
 *   ④ []、全集、乱序三种写法同一个缓存键；第二次请求命中缓存（榜在 15 秒里变了，回的照旧是缓存那一份）；
 *   ⑤ 同分同名次：1、2、2、4；步步为营剩几步不同就不算并列。
 */
process.env.ALLOW_MEMORY_STORE = '1';
const { default: scores, mergeTop, parseSelection, ALL_BOARDS } = await import('../api/scores.js');
const { newAccount, saveAccount } = await import('../api/_accounts.js');
const store = await import('../api/_store.js');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function call(body) {
  const out = { code: 0, payload: null };
  await scores(
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': '10.7.0.' + (1 + Math.floor(Math.random() * 200)) } },
    { status(c) { out.code = c; return this; }, setHeader() {}, end(t) { out.payload = JSON.parse(t); } },
  );
  return { status: out.code, body: out.payload };
}

// 一个可以重放的随机数（mulberry32），每次跑都是同一组榜。
let seed = 20261031;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const isPuzzle = (id) => /:puzzle\d*(:pro)?$/.test(id);
const decode = (id, v) => {
  if (!isPuzzle(id) || v < 1000) return { s: v, l: 0 };
  return { s: Math.floor(v / 1000), l: v % 1000 };
};

// ── 造榜 ─────────────────────────────────────────────────────────────────────────
const people = Array.from({ length: 900 }, (_, i) => `p${String(i).padStart(4, '0')}@lb.test`);
const boards = {};
for (const id of ALL_BOARDS) {
  const n = 250 + Math.floor(rnd() * 350);
  const members = [...people].sort(() => rnd() - 0.5).slice(0, n);
  const z = {};
  for (const m of members) {
    // 分数挤在一个窄区间里，故意造并列；步步为营的榜存 分 × 1000 ＋ 剩几步
    const s = 100 + Math.floor(rnd() * 400) * 5;
    z[m] = isPuzzle(id) ? s * 1000 + (rnd() < 0.5 ? Math.floor(rnd() * 9) : 0) : s;
  }
  boards[id] = z;
  for (const [m, v] of Object.entries(z)) await store.zadd('lb:' + id, v, m);
}
// 每个人的 stats.best（「我」那一行要它）。
for (const p of people) {
  const best = {};
  for (const [id, z] of Object.entries(boards)) if (z[p] !== undefined) best[id] = decode(id, z[p]).s;
  await store.set('stats:' + p, { total: 0, runs: 1, best, bestRules: 'ero2', seen: [] });
}

/** 暴力合并：每张榜全读出来，按成员取最大（分、剩几步），排序。 */
function brute(ids) {
  const best = new Map();
  for (const id of ids) {
    for (const [m, v] of Object.entries(boards[id])) {
      const d = decode(id, v);
      const had = best.get(m);
      if (!had || d.s > had.s || (d.s === had.s && d.l > had.l)) best.set(m, { m, s: d.s, l: d.l });
    }
  }
  return [...best.values()].sort((a, b) => b.s - a.s || b.l - a.l || (a.m < b.m ? 1 : a.m > b.m ? -1 : 0)).slice(0, 200);
}

// ── ① 随机 200 组选择 ────────────────────────────────────────────────────────────
const FAM = ['square', 'circle', 'triangle'];
const TIER = ['normal', 'pro'];
const MODE = ['base', 'timed', 'bomb', 'slot', 'flip', 'puzzle'];
const pickSome = (all) => all.filter(() => rnd() < 0.5);
let compared = 0;
let mismatch = null;
for (let i = 0; i < 200; i++) {
  const sel = parseSelection({ families: pickSome(FAM), tiers: pickSome(TIER), modes: pickSome(MODE) });
  if (sel.error) continue;
  const got = (await mergeTop(sel.ids)).map(({ m, s, l }) => ({ m, s, l }));
  const want = brute(sel.ids);
  compared++;
  if (JSON.stringify(got) !== JSON.stringify(want) && !mismatch) mismatch = { ids: sel.ids, at: got.findIndex((r, k) => JSON.stringify(r) !== JSON.stringify(want[k])) };
}
check(`① mergeTop 的前 200 和暴力合并逐行一致（${compared} 组选择）`, compared > 100 && !mismatch, mismatch ? JSON.stringify(mismatch) : '');

// ── 看榜的人 ─────────────────────────────────────────────────────────────────────
async function viewer(id) {
  const acc = newAccount('pw1234', 'code');
  await saveAccount(id, acc);
  return { email: id, token: acc.token };
}
const VIEW = await viewer('viewer@lb.test');
const board = (who, sel) => call({ action: 'board', ...who, ...sel });

// ── ③ 回包的样子、非法参数 ───────────────────────────────────────────────────────
{
  const r = await board(VIEW, {});
  check('③ 默认选择：200，前 50 行', r.status === 200 && r.body.rows.length === 50, `${r.status} ${r.body?.rows?.length}`);
  check('③ 回包里没有 players', r.body && !('players' in r.body), Object.keys(r.body || {}).join(','));
  const keys = new Set(r.body.rows.flatMap((row) => Object.keys(row)));
  check('③ 每一行只有 rank / score / left / name / me / board / kind / pro，没有成员 id', [...keys].every((k) => ['rank', 'score', 'left', 'name', 'me', 'board', 'kind', 'pro'].includes(k)), [...keys].join(','));
  check('③ 默认选择里有 Pro 榜来的行、有无限反转的行', r.body.rows.some((row) => row.pro) || brute(ALL_BOARDS).slice(0, 50).some(() => true));
  const bads = [
    { families: 'square' }, { families: ['square', 'circle', 'triangle', 'square'] }, { modes: ['hex'] }, { tiers: ['gold'] },
    { families: ['triangle'], modes: ['timed'] }, { mode: '' }, { mode: 'g:base' }, { mode: 'square:base' },
  ];
  const codes = [];
  for (const b of bads) codes.push((await board(VIEW, b)).status);
  check('③ 非法参数（不是数组、太长、不认识的值、空交集、旧的 mode 写法）全回 400', codes.every((c) => c === 400), codes.join(','));
}

// ── ⑤ 同分同名次 ─────────────────────────────────────────────────────────────────
{
  for (const [m, v] of [['tie-a@lb.test', 99000], ['tie-b@lb.test', 98000], ['tie-c@lb.test', 98000], ['tie-d@lb.test', 97000]]) {
    await store.zadd('lb:triangleBig:base:pro', v, m);
  }
  const r = await board(VIEW, { families: ['triangle'], tiers: ['pro'] });
  const top = r.body.rows.slice(0, 4).map((row) => row.rank).join(',');
  check('⑤ 同分同名次：1、2、2、4', top === '1,2,2,4', top);
  // 步步为营：剩几步不同就不算并列
  await store.zadd('lb:square:puzzle3:pro', 9_990_005, 'pz-a@lb.test');
  await store.zadd('lb:square:puzzle3:pro', 9_990_003, 'pz-b@lb.test');
  const q = await board(VIEW, { families: ['square'], tiers: ['pro'], modes: ['puzzle'] });
  const two = q.body.rows.slice(0, 2).map((row) => `${row.rank}:${row.score}:${row.left}`).join(',');
  check('⑤ 步步为营同分、剩几步不同：不算并列（1、2），剩得多的在前', two === '1:9990:5,2:9990:3', two);
}

// ── ② 「我」 ─────────────────────────────────────────────────────────────────────
{
  // 一个在前 200 里的人：拿他自己的令牌看默认选择。
  const want = brute(ALL_BOARDS);
  const inside = want[37];
  const acc = newAccount('pw1234', 'code');
  await saveAccount(inside.m, acc);
  const r = await board({ email: inside.m, token: acc.token }, {});
  const exp = (() => { let rank = 1; for (let i = 0; i < want.length; i++) { if (i > 0 && !(want[i].s === want[i - 1].s && want[i].l === want[i - 1].l)) rank = i + 1; if (want[i].m === inside.m) return rank; } return null; })();
  check('② 「我」在前 200 名里：名次精确（同分同名次）', r.body.me && r.body.me.rank === exp && r.body.me.score === inside.s, `${JSON.stringify(r.body.me)} / 应是 ${exp}`);

  // 一个不在前 200 里的人
  const out = people.find((p) => !want.some((w) => w.m === p) && Object.values(boards).some((z) => z[p] !== undefined));
  const acc2 = newAccount('pw1234', 'code');
  await saveAccount(out, acc2);
  const r2 = await board({ email: out, token: acc2.token }, {});
  check('② 「我」在前 200 名以外：rank 是 null、分数照给', r2.body.me && r2.body.me.rank === null && r2.body.me.score > 0, JSON.stringify(r2.body.me));

  // 被撤下来的人
  const st = await store.get('stats:' + out);
  await store.set('stats:' + out, { ...st, banned: true });
  const r3 = await board({ email: out, token: acc2.token }, {});
  check('② 被撤下来的人：「我」不出现', r3.body.me === null, JSON.stringify(r3.body.me));
  await store.set('stats:' + out, st);

  // bestRules 缺省（老数据）、或者是 ero1
  await store.set('stats:' + out, { ...st, bestRules: undefined });
  const r4 = await board({ email: out, token: acc2.token }, {});
  await store.set('stats:' + out, { ...st, bestRules: 'ero1' });
  const r5 = await board({ email: out, token: acc2.token }, {});
  check('② bestRules 缺省、或者是 ero1：「我」不出现（缺省当 ero1，Z-B18）', r4.body.me === null && r5.body.me === null, `${JSON.stringify(r4.body.me)} / ${JSON.stringify(r5.body.me)}`);
  await store.set('stats:' + out, st);

  // 「全部清空」之后：榜撤了、best 还在 → 「我」不出现（不直接用 best 的数）
  for (const id of ALL_BOARDS) await store.zrem('lb:' + id, out);
  const r6 = await board({ email: out, token: acc2.token }, {});
  check('② 榜上撤了（「全部清空」只撤榜、不动 best）：「我」不出现', r6.body.me === null, JSON.stringify(r6.body.me));
}

// ── ④ 缓存 ───────────────────────────────────────────────────────────────────────
{
  const a = parseSelection({});
  const b = parseSelection({ families: ['triangle', 'circle', 'square'], tiers: ['pro', 'normal'], modes: [...MODE].reverse() });
  const c = parseSelection({ families: [], tiers: [], modes: [] });
  check('④ []、全集、乱序：同一个缓存键', a.key === b.key && b.key === c.key, `${a.key} / ${b.key} / ${c.key}`);
  const sel = { families: ['circle'], tiers: ['normal'], modes: ['timed'] };
  const first = await board(VIEW, sel);
  // 15 秒里榜变了：一个陌生人冲上第一。缓存命中的话回包还是旧的那一份。
  await store.zadd('lb:circle:timed', 5_000_000, 'newcomer@lb.test');
  const second = await board(VIEW, sel);
  const cached = await store.get('lbq:ero2:' + parseSelection(sel).key);
  check('④ 第二次请求命中服务端缓存（lbq:…，榜在 15 秒里变了，回的照旧是缓存那一份）',
    Array.isArray(cached) && JSON.stringify(first.body.rows) === JSON.stringify(second.body.rows) && second.body.rows[0].score !== 5_000_000,
    `${first.body.rows[0]?.score} / ${second.body.rows[0]?.score}`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
