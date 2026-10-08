/**
 * 管理员那两件「一次做一大批」的事不再撞函数时限（10-08 方案第五批第 2 条）。
 *
 *   node scripts/check-admin-batches.mjs
 *
 * 纯 node，不起服务器，几秒钟，进得了 CI。
 *
 * 方案原话：「发码与重建榜单抗超时：mintCodes 改一步写入（pipeline/mset），单批上限 50 张；榜单
 * 重建分批、可从断点续跑。」
 *
 * ── 发码（api/_codes.js 的 mintCodes）──────────────────────────────────────
 *
 * 原先一张码两次往返（先 GET 看有没有人、再 SET），一次最多两百张就是四百次。这一半**起一台本
 * 机的假 Upstash**（几十行，只认这道门用得到的几条命令），数它真的收到了几个请求：
 *
 *   ① 一批 50 张 = **一个请求**，那个请求是一条 MSETNX，100 个参数；50 张码各不相同，库里
 *      每一张都记着等级和来路；
 *   ② 要 200 张也只造 50 张（单批上限），仍然一个请求；
 *   ③ 撞上了（假服务器让第一条 MSETNX 回 0——真 Redis 里就是「这一批里有一张已经在库里」）：
 *      第一批**一张都没写进去**，换一整批新的再来，回的是第二批；
 *   ④ 内存版 store（dev-server 用的那一份）的 MSETNX 同样是「一个不在才全写」；
 *   ⑤ api/mint.js 的单次上限就是 MINT_BATCH_MAX，发码页上那句「最多 N」、输入框的 max、页面
 *      自己的封顶是同一个数——不然管理员填 200，只拿回 50 张还不知道为什么；
 *   ⑥ 走一遍 api/mint.js：要 120 张，回 50 张。
 *
 * ── 重建榜单（api/scores.js 的 rebuild）────────────────────────────────────
 *
 * 原先一次调用把名单上的人全算完；人一多就跑满时限被掐掉，回包没发出去，管理员只看见一个超
 * 时。现在一批一批算，没算完回一张票（resume）。这一半走内存版 store，造 25 个人：
 *
 *   ⑦ batch: 3 拆开来算：每一批回 done: false + 一张 32 位十六进制的票 + 还剩几个；最后一批
 *      done: true，一共算了 25 个人、写了 25 行——一个没漏、一个没算两遍；
 *   ⑧ 断点记在库里：一批算完，票上的「算到了谁」就是这一批最后那个人（按 id 排序），下一批
 *      从他后面接着算；
 *   ⑨ 同一轮的选项照第一批定下的：第一批说了 drop: ['flip']，后面几批请求里不写（或者写别
 *      的）也照样清掉无限反转——不然一轮重建前后几批各按各的规矩算；
 *   ⑩ 续跑不吃限速：batch: 1 跑满 25 批（超过一小时 20 次的限速）一次 429 都没有；
 *   ⑪ 编的票照普通的一次算：不认识的票回 410 resume，而且照样计入限速（第 21 次是 429）；
 *      令牌不对，带着真票也是 401；
 *   ⑫ 这一轮算完，票就删了：再带着它来是 410；
 *   ⑬ 一批就算得完的（人少的时候，也就是从前所有门里的那种用法）：一次调用 done: true，
 *      回包的字段和原先一样（players / rows / skipped / dropped / wiped / namesDropped / nicknames）。
 *
 * **不量的**：真的在半路被掐掉（函数超时）之后再续——那要让一次调用在算到某个人的时候死掉，
 * 这儿造不出来。票是每算完一个人就写一次（⑧ 量的是一批结束时票上的样子），掐在谁身上谁就
 * 再算一遍——一个人的重建本来是幂等的（check-scores 的「再重建一次，结果一样」）。
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ═══ 发码：一台假的 Upstash ═══════════════════════════════════════════════════
const kv = new Map();
const reqs = [];
let refuseNext = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const args = JSON.parse(body || '[]');
    reqs.push(args);
    const cmd = String(args[0]).toUpperCase();
    let result = null;
    if (cmd === 'MSETNX') {
      const keys = args.filter((_, i) => i % 2 === 1);
      if (refuseNext > 0) {
        refuseNext--;
        result = 0;
      } else if (keys.some((k) => kv.has(k))) result = 0;
      else {
        for (let i = 1; i < args.length; i += 2) kv.set(args[i], args[i + 1]);
        result = 1;
      }
    } else if (cmd === 'GET') result = kv.get(args[1]) ?? null;
    else if (cmd === 'SET') {
      kv.set(args[1], args[2]);
      result = 'OK';
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `假服务器不认识 ${cmd}` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.KV_REST_API_URL = `http://127.0.0.1:${server.address().port}`;
process.env.KV_REST_API_TOKEN = 'check-admin-batches';
delete process.env.ALLOW_MEMORY_STORE;

const { mintCodes, MINT_BATCH_MAX, codeKey } = await import('../api/_codes.js');
const store = await import('../api/_store.js');

check('（尺子）单批上限是 50', MINT_BATCH_MAX === 50, String(MINT_BATCH_MAX));
{
  reqs.length = 0;
  const codes = await mintCodes('year', 50, undefined, { source: 'mint' });
  const sent = reqs.map((a) => `${a[0]}×${a.length - 1}`);
  check('① 一批 50 张 = 一个请求，是一条 MSETNX、100 个参数', reqs.length === 1 && reqs[0][0] === 'MSETNX' && reqs[0].length === 101,
    sent.join(' '));
  check('① 50 张，各不相同', codes.length === 50 && new Set(codes).size === 50, `${codes.length} 张`);
  const docs = codes.map((c) => JSON.parse(kv.get(codeKey(c)) || 'null'));
  check('① 库里每一张都记着等级和来路', docs.every((d) => d?.plan === 'year' && d?.source === 'mint' && d?.mintedAt > 0),
    JSON.stringify(docs[0]));
}
{
  reqs.length = 0;
  const codes = await mintCodes('month', 200);
  check('② 要 200 张也只造 50 张，仍然一个请求', codes.length === 50 && reqs.length === 1, `${codes.length} 张 / ${reqs.length} 个请求`);
}
{
  reqs.length = 0;
  const before = kv.size;
  refuseNext = 1;
  const codes = await mintCodes('half', 10);
  const first = reqs[0] ? reqs[0].filter((_, i) => i % 2 === 1) : [];
  check('③ 撞上了：换一整批再来（两个请求，都是 MSETNX）', reqs.length === 2 && reqs.every((a) => a[0] === 'MSETNX'), `${reqs.length} 个请求`);
  check('③ 撞上的那一批一张都没写进去', first.length === 10 && first.every((k) => !kv.has(k)), `${first.filter((k) => kv.has(k)).length} 张写进去了`);
  check('③ 回的是第二批，10 张都在库里', codes.length === 10 && codes.every((c) => kv.has(codeKey(c))) && kv.size === before + 10,
    `${codes.length} 张`);
}
await new Promise((r) => server.close(r));

// ═══ 换成内存版 store ═══════════════════════════════════════════════════════
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.ALLOW_MEMORY_STORE = '1';
{
  await store.set('code:AAAAAA', { plan: 'year' });
  const clash = await store.msetnx([['code:AAAAAA', { plan: 'month' }], ['code:BBBBBB', { plan: 'month' }]]);
  const a = await store.get('code:AAAAAA');
  const b = await store.get('code:BBBBBB');
  check('④ 内存版 MSETNX：有一个已经在，就一个都不写', clash === false && a?.plan === 'year' && b === null, JSON.stringify({ clash, a, b }));
  const ok = await store.msetnx([['code:CCCCCC', { plan: 'life' }], ['code:DDDDDD', { plan: 'life' }]]);
  check('④ 内存版 MSETNX：都不在就全写', ok === true && (await store.get('code:DDDDDD'))?.plan === 'life');
}

// ── ⑤ 上限：接口、发码页三处是同一个数 ────────────────────────────────────
{
  const mint = read('api/mint.js');
  const page = read('public/mint.html');
  check('⑤ api/mint.js 的单次上限就是 MINT_BATCH_MAX', /const MAX_PER_CALL = MINT_BATCH_MAX;/.test(mint));
  const label = (page.match(/<label for="count">数量（最多 (\d+)）<\/label>/) || [])[1];
  const max = (page.match(/<input id="count" type="number" min="1" max="(\d+)"/) || [])[1];
  const clamp = (page.match(/const count = Math\.max\(1, Math\.min\((\d+), Number\(\$\('count'\)\.value\)/) || [])[1];
  check('⑤ 发码页上那句「最多 N」、输入框的 max、页面自己的封顶都是 50', [label, max, clamp].every((v) => Number(v) === MINT_BATCH_MAX),
    `最多 ${label} · max ${max} · 封顶 ${clamp}`);
}

// ── 两个接口的假请求 ──────────────────────────────────────────────────────
process.env.ADMIN_TOKEN = 'b'.repeat(32);
const TOKEN = process.env.ADMIN_TOKEN;
const { default: mintHandler } = await import('../api/mint.js');
const { default: scores } = await import('../api/scores.js');
const accounts = await import('../api/_accounts.js');

const SCORING_V = (/export const SCORING_RULES_VERSION = '([^']+)'/.exec(read('src/engine/scoring.ts')) || [])[1];
check('（尺子）读到了计分规则版本', Boolean(SCORING_V), String(SCORING_V));

async function call(handler, body, ip = '10.0.0.1') {
  const req = { method: 'POST', body, headers: { 'x-forwarded-for': ip } };
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
  return { status: res.code, body: res.payload };
}

// ── ⑥ 走一遍 api/mint.js ──────────────────────────────────────────────────
{
  const r = await call(mintHandler, { token: TOKEN, plan: 'year', count: 120 }, '10.9.9.9');
  check('⑥ 发码接口：要 120 张，回 50 张', r.status === 200 && r.body?.count === 50 && r.body?.codes?.length === 50,
    `${r.status} ${r.body?.count}`);
}

// ═══ 重建榜单 ═══════════════════════════════════════════════════════════════
/** 造一个开通了的账号，打一局基础方块、一局无限反转。 */
async function player(i) {
  const email = `p${String(i).padStart(2, '0')}@example.com`;
  const acct = accounts.newAccount('secret', 'code');
  acct.until = Date.now() + 30 * 24 * 3600e3;
  await accounts.saveAccount(email, acct);
  for (const [runId, modeKey, score] of [[`b${i}`, 'base', 100 + i], [`f${i}`, 'flip', 900 + i]]) {
    const r = await call(scores, {
      action: 'push', email, token: acct.token, runId, mode: 'square', score,
      data: { shapeId: 'square', modeKey, totalScore: score, rules: SCORING_V },
    }, `10.1.0.${i}`);
    if (r.status !== 200) throw new Error(`夹具交卷没成：${email} ${r.status} ${JSON.stringify(r.body)}`);
  }
  return email;
}
const N = 25;
const emails = [];
for (let i = 1; i <= N; i++) emails.push(await player(i));
const ids = [...emails].sort();
const flipBoard = async () => (await store.zTop('lb:square:flip', 100)).length;
check('（尺子）25 个人都在无限反转那张榜上', (await flipBoard()) === N, String(await flipBoard()));

// ── ⑦ ⑧ ⑨ 拆成几批算完 ──────────────────────────────────────────────────────
{
  const replies = [];
  let r = await call(scores, { action: 'rebuild', token: TOKEN, drop: ['flip'], batch: 3 }, '10.2.0.1');
  replies.push(r);
  const firstTicket = r.body?.resume;
  check('⑦ 第一批：没算完，回一张票（32 位十六进制）、还剩几个',
    r.status === 200 && r.body?.done === false && /^[0-9a-f]{32}$/.test(String(firstTicket)) && r.body?.players === 3 && r.body?.left === N - 3,
    JSON.stringify(r.body));
  const saved = await store.get('rebuild:resume:' + firstTicket);
  check('⑧ 断点记在库里：票上「算到了谁」是这一批最后那个人（按 id 排序）', saved?.after === ids[2] && saved?.players === 3,
    `${saved?.after} vs ${ids[2]}`);
  let guard = 0;
  while (r.body?.done === false && guard++ < 50) {
    // 后面几批请求里不再写 drop——照票上记的选项算（⑨）
    r = await call(scores, { action: 'rebuild', token: TOKEN, resume: r.body.resume, batch: 3, drop: [] }, '10.2.0.1');
    replies.push(r);
  }
  const counts = replies.map((x) => x.body?.players);
  check('⑦ 最后一批 done: true；一共 25 个人、25 行（一个没漏、一个没算两遍）',
    r.status === 200 && r.body?.done === true && r.body?.players === N && r.body?.rows === N && replies.length === Math.ceil(N / 3),
    `${replies.length} 批，累计 ${counts.join(' → ')}，rows ${r.body?.rows}`);
  check('⑦ 每一批都只往前走（累计人数只增不减、每批最多 3 个）',
    counts.every((c, i) => i === 0 || (c > counts[i - 1] && c - counts[i - 1] <= 3)), counts.join(' → '));
  check('⑨ 选项照第一批的：后面几批没写 drop，无限反转那张榜照样清空了', (await flipBoard()) === 0, `还剩 ${await flipBoard()} 个`);
  const base = await store.zTop('lb:square:base', 100);
  check('⑦ 基础方块那张榜一个人都没少', base.length === N, `${base.length} 个`);
  // ⑫ 算完票就删了
  const again = await call(scores, { action: 'rebuild', token: TOKEN, resume: firstTicket }, '10.2.0.1');
  check('⑫ 这一轮算完，票就删了：再带着它来是 410 resume', again.status === 410 && again.body?.error === 'resume',
    `${again.status} ${JSON.stringify(again.body)}`);
  check('⑫ 库里也没有这张票了', (await store.get('rebuild:resume:' + firstTicket)) === null);
}

// ── ⑩ 续跑不吃限速 ────────────────────────────────────────────────────────
{
  const statuses = [];
  let r = await call(scores, { action: 'rebuild', token: TOKEN, batch: 1 }, '10.3.0.1');
  statuses.push(r.status);
  let guard = 0;
  while (r.body?.done === false && guard++ < 60) {
    r = await call(scores, { action: 'rebuild', token: TOKEN, resume: r.body.resume, batch: 1 }, '10.3.0.1');
    statuses.push(r.status);
  }
  check('⑩ batch: 1 跑满 25 批（超过一小时 20 次）一次 429 都没有，最后算完', statuses.length === N && statuses.every((s) => s === 200) && r.body?.done === true,
    `${statuses.length} 次：${[...new Set(statuses)].join(',')}`);
}

// ── ⑪ 编的票、错的令牌 ─────────────────────────────────────────────────────
{
  const start = await call(scores, { action: 'rebuild', token: TOKEN, batch: 2 }, '10.4.0.1');
  const wrong = await call(scores, { action: 'rebuild', token: 'c'.repeat(32), resume: start.body?.resume, batch: 2 }, '10.4.0.1');
  check('⑪ 令牌不对，带着真票也是 401', wrong.status === 401, String(wrong.status));
  const statuses = [];
  for (let i = 0; i < 21; i++) {
    statuses.push((await call(scores, { action: 'rebuild', token: TOKEN, resume: 'f'.repeat(32) }, '10.5.0.1')).status);
  }
  check('⑪ 编的票：回 410，而且照样计入限速（第 21 次是 429）',
    statuses.slice(0, 20).every((s) => s === 410) && statuses[20] === 429, statuses.join(','));
  // 把那一轮收完，免得一张活票留在库里（门之间互不干扰）
  let r = start;
  let guard = 0;
  while (r.body?.done === false && guard++ < 60) r = await call(scores, { action: 'rebuild', token: TOKEN, resume: r.body.resume, batch: 2 }, '10.4.0.1');
}

// ── ⑬ 一批就算得完：一次调用，回包和原先一样 ─────────────────────────────
{
  const r = await call(scores, { action: 'rebuild', token: TOKEN }, '10.6.0.1');
  const keys = ['players', 'rows', 'skipped', 'dropped', 'wiped', 'namesDropped', 'nicknames'];
  check('⑬ 人少的时候一次就算完（done: true），回包的字段和原先一样',
    r.status === 200 && r.body?.done === true && r.body?.players === N && keys.every((k) => k in (r.body || {})),
    JSON.stringify(r.body));
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
