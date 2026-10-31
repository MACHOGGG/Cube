/**
 * 交卷待发队列（10-31 方案推08 Z-H01，10-14 I-3、debug G29、G34）。要 dev-server + Chromium。
 *
 *   node scripts/dev-server.mjs 8940 dist      （兑 TESTMONTH、TESTYEAR 各一次——一台新服务器）
 *   node scripts/check-push-queue.mjs http://localhost:8940/
 *
 * 原先交卷失败只隔 2 秒再试一次：库或函数抖动超过 2 秒、或者 2 秒内关了页面，这一局本机有、云上没有，永远补不上。
 * 现在交卷之前先在本机落一份（`slides_push_queue`），交上了 / 服务器明说不收才删。这道门只量队列三节（L-9 要的「看榜
 * 429」「400 mismatch 不再重报」已经在 check-scores-guard ⑬、check-rank-network ③ 里）：
 *
 *   ① page.route 让 /api/scores 的 push 连回两次 502 → 打完一局 → 刷新页面（第三次放行）→ 这一局被补交、队列空了、
 *      服务器那边他的存档里这一局只有 1 条。撤掉改法（交卷不入队）这一节必红：刷新之后没人再交它。
 *   ② push 回 400 implausible → 队列里不留这一局。
 *   ③ 甲登录时交卷失败的一项，换乙登录后**不发**（一条带这一局的 push 都没有），换回甲才发、发进甲的存档。
 *
 * 一局是「开局就从暂停面板结束」的真局：0 分，服务器照收进存档（0 分只是不上榜，api/scores.js），所以存档里数得到。
 * 身份是 dev-server 自己种的测试码兑出来的真令牌（甲 TESTMONTH、乙 TESTYEAR），who 是 'code:<码>'。
 */
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://localhost:8940/').replace(/\/*$/, '/');
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('pq_primed') === '1') return;
  sessionStorage.setItem('pq_primed', '1');
  for (const [k, v] of Object.entries({
    slides_lang: 'zhHans', slides_intro_seen: '1', slides_played_square: '1', slides_played_circle: '1',
    slides_played_finished: '1', slides_played_endcard: '1', slides_played_totaltip: '1', slides_cvd_offer: '1',
    slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
  })) localStorage.setItem(k, v);
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

/**
 * /api/scores 的 push 怎么答：'pass' 放行，'502' / 'implausible' 拦下来答。每一条 push 都记一笔（这一局的编号、
 * 拿谁的身份发的、答了什么）。别的动作（mine、board）一律放行。
 */
let policy = 'pass';
/** 每一条 push 怎么答（默认照 policy；① 那一节换成「这一局头两趟 502」）。 */
let decide = () => policy;
const pushes = [];
await ctx.route('**/api/scores', async (route) => {
  let body = null;
  try {
    body = route.request().postDataJSON();
  } catch {
    /* 不是 JSON：放行 */
  }
  if (body?.action !== 'push') return route.continue();
  const said = decide(body);
  pushes.push({ runId: body.runId, code: body.code ?? null, said, at: Date.now() });
  if (said === '502') return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream"}' });
  if (said === 'implausible') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"implausible"}' });
  return route.continue();
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 30000 });

/** 兑一张测试码，拿到真令牌（这一页同源 fetch）。交回那一份本机权益缓存。 */
const grant = (code) => page.evaluate(async (c) => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) })
    .then((x) => x.json());
  return r.active ? { active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code } : null;
}, code);
/** 换成这个身份登录着（写本机权益缓存再刷新）。 */
async function become(ent) {
  await page.evaluate((e) => localStorage.setItem('slides_genius', JSON.stringify(e)), ent);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 30000 });
}
/** 开一局方块、开局就从暂停面板结束，交回这一局的编号（和 engine/cloudScores.ts 的 runIdOf 同一个式子）。 */
async function playOne() {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.home-icon-btn[data-first-playable="1"]')?.click());
  await page.waitForSelector('#startBtn', { state: 'attached', timeout: 30000 });
  await page.evaluate(() => document.getElementById('startBtn').click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('stopBtn').click());
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('pauseFinishBtn').click());
  await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
  return page.evaluate(() => {
    let best = null;
    for (const k of Object.keys(localStorage)) {
      if (!k.endsWith('::runs')) continue;
      for (const r of JSON.parse(localStorage.getItem(k) || '[]')) if (r?.data && (!best || r.at > best.at)) best = r;
    }
    return best ? `${best.data.at}-${best.data.shapeId}-${best.data.modeKey}` : null;
  });
}
const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('slides_push_queue') || '[]'));
const queued = async (runId) => (await queue()).some((q) => q.runId === runId);
/** 等到这一局从队列里没了（最多 ms）。 */
const leaves = (runId, ms) =>
  page.waitForFunction((id) => !JSON.parse(localStorage.getItem('slides_push_queue') || '[]').some((q) => q.runId === id), runId, { timeout: ms, polling: 500 })
    .then(() => true).catch(() => false);
/** 服务器那边这个身份的存档里，这一局有几条。 */
const onServer = (ent, runId) => page.evaluate(async ([e, id]) => {
  const r = await fetch('/api/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'mine', code: e.code, token: e.token, ...(e.email ? { email: e.email } : {}) }),
  }).then((x) => x.json()).catch(() => null);
  return Array.isArray(r?.archive) ? r.archive.filter((a) => a.runId === id).length : -1;
}, [ent, runId]);
const pushesOf = (runId) => pushes.filter((p) => p.runId === runId);

const A = await grant('TESTMONTH');
const B = await grant('TESTYEAR');
check('（尺子）兑到了甲、乙两个身份（真令牌）', Boolean(A?.token && B?.token && A.code !== B.code), JSON.stringify({ A: A?.code, B: B?.code }));
await become(A);

// ── ① 连回两次 502，刷新之后补交上了 ────────────────────────────────────────────────
{
  policy = '502';
  const id = await playOne();
  await page.waitForTimeout(1500);
  check('①（尺子）拿到了这一局的编号，第一趟 push 真的发了（被答 502）', !!id && pushesOf(id).length >= 1, `${id} · ${pushesOf(id).length} 趟`);
  check('① 交卷失败：这一局在队列里', await queued(id));
  // 第二趟也 502，第三趟起放行（重发隔 15 秒；刷新之后由开机那一下接着排）。
  policy = 'pass';
  decide = (b) => (b.runId === id && pushesOf(id).length < 2 ? '502' : policy);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 30000 });
  const gone = await leaves(id, 50000);
  const tries = pushesOf(id);
  check('① 刷新之后补交上了：队列里没了这一局', gone, JSON.stringify(await queue()));
  check('① 一共发了三趟（两趟 502、第三趟放行）', tries.length === 3 && tries[2].said === 'pass', tries.map((t) => t.said).join(','));
  check('① 服务器那边甲的存档里这一局只有 1 条', (await onServer(A, id)) === 1, String(await onServer(A, id)));
  decide = () => policy;
}

// ── ② 400 implausible：不留 ────────────────────────────────────────────────────────
{
  policy = 'implausible';
  const id = await playOne();
  await page.waitForTimeout(2000);
  check('②（尺子）这一局的 push 被答了 400 implausible', pushesOf(id).some((p) => p.said === 'implausible'));
  check('② 服务器明说不收：队列里不留这一局', !(await queued(id)), JSON.stringify(await queue()));
  policy = 'pass';
}

// ── ③ 甲失败的一项：换乙不发，换回甲才发 ────────────────────────────────────────────
{
  policy = '502';
  const id = await playOne();
  await page.waitForTimeout(1500);
  const q = (await queue()).find((x) => x.runId === id);
  check('③（尺子）甲交卷失败，这一项在队列里、记着是甲交的', q?.who === 'code:' + A.code, JSON.stringify(q));
  policy = 'pass';
  const before = pushesOf(id).length;
  await become(B);
  // 乙登录着待一阵：开机那一下、online、15 秒的重发都过去了。
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(20000);
  const asB = pushesOf(id).slice(before);
  check('③ 换乙登录：这一局一趟都没发（不把甲的局交到乙名下）', asB.length === 0, JSON.stringify(asB));
  check('③ 换乙登录：这一项还在队列里', await queued(id));
  await become(A);
  const gone = await leaves(id, 40000);
  const asA = pushesOf(id).slice(before);
  check('③ 换回甲：补交了（队列里没了）', gone, JSON.stringify(await queue()));
  check('③ 补交那一趟拿的是甲的身份', asA.length >= 1 && asA.every((p) => p.code === A.code), JSON.stringify(asA));
  check('③ 进的是甲的存档', (await onServer(A, id)) === 1, String(await onServer(A, id)));
  check('③ 乙的存档里没有它', (await onServer(B, id)) === 0, String(await onServer(B, id)));
}

check('一路没有没接住的错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
