/**
 * 管理员页《重建榜单》那张卡：四个勾（第 16 推加了「建立昵称索引」）、一句确认（第 14 推）。
 *
 *   node scripts/dev-server.mjs 8983 dist
 *   node scripts/check-mint-rebuild.mjs http://localhost:8983/
 *
 * 不碰真的服务器：`/api/scores` 在浏览器里拦下来，量的是**这一页实际发出去了什么**、
 * 拿到回包之后**写了什么**。所以不需要 ADMIN_TOKEN，也不会真的重算任何一张榜。
 *
 *   ① 四个勾默认都不勾——从前「清空《无限反转》的旧榜」默认勾着，每一次例行重建都顺
 *      手把它清一遍，点的人未必知道自己清了什么。
 *   ② 勾了「全部清空」再按：先弹「确定清空所有排行榜吗？」，点取消就**一个请求都不
 *      发**；点确定才发，发的是 all: true。
 *   ③ 勾了「清理旧名字」：发 scrubNames: true，回包里那个数写到页上（零条也写）；不勾
 *      就不发、也不写。
 *   ④ 勾了「建立昵称索引」（第 16 推的一次性迁移）：发 nicknames: true，回包那几个数写到页
 *      上；不勾就发 false、也不写。页上一个名字都不许出现——回包里塞一个名字进来（服务器不
 *      该这么做，这儿当它做了），页上也不许照抄。
 *   ①b 令牌读到之后从地址栏抹掉，请求里照样带着它（10-15 补充 S7，L-4 ⑨）。
 *   ⑤ 分批（10-08 方案第五批第 2 条）：服务器回 done: false + 一张票，这一页**自己接着点下
 *      一批**，后面几批只带票（选项照第一批的，服务器那头记着）；全部算完才写那句「重算完
 *      了」。断在半路（某一批回 500）：页上说「再按一次接着算」，再按一次发出去的是**那张票**
 *      而不是从头来一遍；全清那一句也不再问第二遍。票过期（410 resume）：忘掉它，下次从头来。
 *
 * ⑥ 是另一半（10-11 方案 A-5）：上面量的是这一页发了什么，⑥ 量服务器收到之后**重算出了什么**。
 *    它不走浏览器，直接在这个进程里叫 api/scores.js（库用进程内那一份，令牌是门自己设的）：
 *      · 61 局以前打的最高分，重建之后不掉（存档只留最近 60 局，翻不出它）；
 *      · 只打过 0 分局、又没起昵称的人，「全部清空」之后榜上没有他（从前名单里压根没有这个人）；
 *      · 超出这张榜上界的旧最高分，重建之后换成存档里算得出来的那个（伪造的不许永远留着）；
 *      · 换过计分规则的旧最高分不留；全清之后点一次普通重建，同规则、没超上界的老高分回来
 *        （public/mint.html 那句「全清是可逆的」说的就是这个）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8983/';
const PAGE = new URL('mint.html#token=check-mint-rebuild-not-a-real-token', BASE).href;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 开一页：/api/scores 拦下来，记下每一次发出去的 body，回一份假回包。 */
async function open(reply) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const sent = [];
  const dialogs = [];
  await page.route('**/api/scores', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('#rebuild', { timeout: 15000 });
  return { ctx, page, sent, dialogs };
}
const msg = (page) => page.$eval('#rebuildMsg', (e) => e.textContent.trim());
const settle = (page) => page.waitForFunction(() => !document.querySelector('#rebuild').disabled, { timeout: 8000 });

// ── ① 默认一个都不勾 ────────────────────────────────────────────────
{
  const { ctx, page, sent } = await open({ ok: true, players: 3, rows: 9, dropped: [], namesDropped: 0, skipped: 0 });
  const boxes = await page.evaluate(() =>
    ['dropFlip', 'scrubNames', 'buildNicknames', 'wipeAll'].map((id) => {
      const el = document.getElementById(id);
      return { id, there: Boolean(el), checked: el ? el.checked : null };
    }));
  check('（尺子）四个勾都在页上', boxes.every((b) => b.there), JSON.stringify(boxes));
  // 10-15 补充 S7（L-4 ⑨）：读到令牌就从地址栏抹掉（历史、书签里不再有带令牌的地址），令牌留在页面内存里照常用。
  check('令牌读到之后从地址栏抹掉了', !page.url().includes('token') && !page.url().includes('#'), page.url());
  check('四个勾默认都不勾（「清空无限反转」从前默认勾着）', boxes.every((b) => b.checked === false), JSON.stringify(boxes));
  // 什么都不勾直接按：发的是一次干净的重算。
  await page.click('#rebuild');
  await settle(page);
  check('抹掉之后令牌照样带在请求里（留在页面内存里）', sent[0]?.token === 'check-mint-rebuild-not-a-real-token', String(sent[0]?.token));
  check('什么都不勾：发了一次重算，不清任何一张、不清名字',
    sent.length === 1 && sent[0].action === 'rebuild' && sent[0].all === false && sent[0].scrubNames === false &&
      Array.isArray(sent[0].drop) && sent[0].drop.length === 0,
    JSON.stringify(sent[0]));
  check('没勾「清理旧名字」：回包里那个数也不写', !/旧名字/.test(await msg(page)), await msg(page));
  check('没勾「建立昵称索引」：发的是 nicknames: false，页上也不提昵称',
    sent[0]?.nicknames === false && !/昵称/.test(await msg(page)), `${JSON.stringify(sent[0])} / ${await msg(page)}`);
  await ctx.close();
}

// ── ② 全部清空：先问一句 ───────────────────────────────────────────
{
  const { ctx, page, sent } = await open({ ok: true, players: 3, rows: 0, dropped: [], skipped: 0 });
  let asked = '';
  page.once('dialog', async (d) => {
    asked = d.message();
    await d.dismiss();
  });
  await page.check('#wipeAll');
  await page.click('#rebuild');
  await page.waitForTimeout(400);
  check('勾了「全部清空」再按：先弹那一句', asked === '确定清空所有排行榜吗？', JSON.stringify(asked));
  check('点《取消》：一个请求都没发', sent.length === 0, `${sent.length} 个`);
  check('点《取消》：按钮还能按（没卡在「正在重算」）', await page.$eval('#rebuild', (e) => !e.disabled));
  page.once('dialog', (d) => d.accept());
  await page.click('#rebuild');
  await settle(page);
  check('点《确定》：才发出去，发的是全部清空', sent.length === 1 && sent[0].all === true, JSON.stringify(sent[0]));
  await ctx.close();
}
{
  // 尺子：不勾全清就不问——上面那一句是全清才有的，不是每一次都弹。
  const { ctx, page, sent } = await open({ ok: true, players: 1, rows: 1, dropped: [], skipped: 0 });
  let asked = false;
  page.on('dialog', async (d) => {
    asked = true;
    await d.dismiss();
  });
  await page.check('#dropFlip');
  await page.click('#rebuild');
  await settle(page);
  check('（尺子）不勾全清：不问，直接发', !asked && sent.length === 1 && sent[0].drop.join() === 'flip', JSON.stringify(sent[0]));
  await ctx.close();
}

// ── ③ 清理旧名字 ────────────────────────────────────────────────────
for (const n of [3, 0]) {
  const { ctx, page, sent } = await open({ ok: true, players: 5, rows: 12, dropped: [], namesDropped: n, skipped: 0 });
  await page.check('#scrubNames');
  await page.click('#rebuild');
  await settle(page);
  check(`勾了「清理旧名字」：发的是 scrubNames: true（回包 ${n} 条）`, sent.length === 1 && sent[0].scrubNames === true && sent[0].all === false,
    JSON.stringify(sent[0]));
  const text = await msg(page);
  check(`回包那个数写到页上了（${n} 条${n === 0 ? '，零也写' : ''}）`, text.includes(`删掉了 ${n} 条旧名字`), text);
  await ctx.close();
}

// ── ④ 建立昵称索引（第 16 推）──────────────────────────────────────
{
  const counts = { merged: 2, invalid: 3, cleared: 4, indexed: 17, stale: 1 };
  // 回包里多塞一个名字：服务器不该这么做（buildNicknameIndex 只回计数），可页面这一头也不
  // 许把回包里别的东西照抄上去——量的是「页上只有那几个数」。
  const { ctx, page, sent } = await open({
    ok: true, players: 5, rows: 12, dropped: [], skipped: 0, nicknames: { ...counts, leak: '阿花@example.com' },
  });
  await page.check('#buildNicknames');
  await page.click('#rebuild');
  await settle(page);
  check('勾了「建立昵称索引」：发的是 nicknames: true（别的勾照旧不勾）',
    sent.length === 1 && sent[0].nicknames === true && sent[0].all === false && sent[0].scrubNames === false,
    JSON.stringify(sent[0]));
  const text = await msg(page);
  check('回包那几个数都写到页上了',
    text.includes('登记 17 个') && text.includes('重名清掉 4 个') && text.includes('不能用的清掉 3 个') &&
      text.includes('旧码 2 个') && text.includes('过期索引 1 个'),
    text);
  check('页上一个名字都没有（回包里多塞的那个也没照抄）', !text.includes('阿花') && !text.includes('@'), text);
  await ctx.close();
}

// ── ⑤ 分批：自己接着点；断在半路，再按一次从断点接着算 ─────────────────────
/** 和 open 一样，只是回包按次序一个一个给：{ status, body }。 */
async function openSeq(replies) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const sent = [];
  await page.route('**/api/scores', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'));
    const r = replies[Math.min(sent.length - 1, replies.length - 1)];
    await route.fulfill({ status: r.status ?? 200, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('#rebuild', { timeout: 15000 });
  return { ctx, page, sent };
}
const T = 'a'.repeat(32);
{
  const { ctx, page, sent } = await openSeq([
    { body: { ok: true, done: false, resume: T, players: 100, skipped: 0, left: 150 } },
    { body: { ok: true, done: false, resume: T, players: 200, skipped: 0, left: 50 } },
    { body: { ok: true, done: true, players: 250, rows: 600, skipped: 0, dropped: ['flip'], namesDropped: 2, nicknames: null } },
  ]);
  await page.check('#dropFlip');
  await page.check('#scrubNames');
  await page.click('#rebuild');
  await settle(page);
  check('⑤ 没算完：页面自己接着点，三批三个请求', sent.length === 3, `${sent.length} 个`);
  check('⑤ 第一批带选项，后面几批只带票（不再带选项）',
    sent[0]?.drop?.join() === 'flip' && sent[0]?.scrubNames === true && !('resume' in (sent[0] || {})) &&
      sent.slice(1).every((b) => b.resume === T && b.action === 'rebuild' && !('drop' in b) && !('scrubNames' in b)),
    JSON.stringify(sent));
  const text = await msg(page);
  check('⑤ 全部算完才写「重算完了」，数是最后那一批的累计（250 个人、600 行）',
    text.includes('重算完了：250 个人，写了 600 行') && text.includes('删掉了 2 条旧名字'), text);
  await ctx.close();
}
{
  const { ctx, page, sent } = await openSeq([
    { body: { ok: true, done: false, resume: T, players: 100, skipped: 0, left: 150 } },
    { status: 500, body: { error: 'boom' } },
    { body: { ok: true, done: true, players: 250, rows: 500, skipped: 0, dropped: [], namesDropped: 0, nicknames: null } },
  ]);
  let asked = 0;
  page.on('dialog', async (d) => {
    asked++;
    await d.accept();
  });
  await page.check('#wipeAll');
  await page.click('#rebuild');
  await settle(page);
  const broke = await msg(page);
  check('⑤ 断在半路：页上说「再按一次接着算」', /再按一次《重建榜单》从断开的地方接着算/.test(broke) && sent.length === 2, `${sent.length} 个 / ${broke}`);
  await page.click('#rebuild');
  await settle(page);
  check('⑤ 再按一次：发出去的是那张票，不是从头来一遍', sent.length === 3 && sent[2].resume === T && !('all' in sent[2]), JSON.stringify(sent[2]));
  check('⑤ 全清那一句只问了一次（接着算的那一下不再问）', asked === 1, `问了 ${asked} 次`);
  check('⑤ 接着算完了', (await msg(page)).includes('重算完了：250 个人'), await msg(page));
  await ctx.close();
}
{
  const { ctx, page, sent } = await openSeq([
    { body: { ok: true, done: false, resume: T, players: 100, skipped: 0, left: 150 } },
    { status: 410, body: { error: 'resume' } },
    { body: { ok: true, done: true, players: 250, rows: 500, skipped: 0, dropped: [], namesDropped: 0, nicknames: null } },
  ]);
  await page.click('#rebuild');
  await settle(page);
  check('⑤ 票过期（410 resume）：说清楚要从头来', (await msg(page)).includes('从头再点一次'), await msg(page));
  await page.click('#rebuild');
  await settle(page);
  check('⑤ 票过期之后再按：从头来（带选项、不带票）', sent.length === 3 && !('resume' in sent[2]) && Array.isArray(sent[2].drop), JSON.stringify(sent[2]));
  await ctx.close();
}

await browser.close();

// ── ⑥ 服务器那一头：重算出了什么（10-11 方案 A-5）──────────────────────────────
//
// 不走浏览器、不碰 dev-server：直接在这个进程里叫 api/scores.js，库用进程内那一份。每一节一个新的人，
// 交卷走真的 push（明细由夹具拼齐，scripts/lib/fakeRun.mjs），重建走真的 rebuild。
{
  process.env.ALLOW_MEMORY_STORE = '1';
  process.env.ADMIN_TOKEN = 'm'.repeat(40);
  const { readFileSync } = await import('node:fs');
  const { default: scores } = await import('../api/scores.js');
  const accounts = await import('../api/_accounts.js');
  const store = await import('../api/_store.js');
  const { fillRun } = await import('./lib/fakeRun.mjs');
  const SCORING_V = /export const SCORING_RULES_VERSION = '([^']+)'/.exec(readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8'))[1];
  let ip = 0;
  const call = async (body) => {
    const res = {
      code: 200, payload: null,
      status(c) { res.code = c; return res; }, setHeader() { return res; },
      end(t) { try { res.payload = JSON.parse(t); } catch { res.payload = t; } return res; },
    };
    await scores({ method: 'POST', body, headers: { 'x-vercel-forwarded-for': `198.18.9.${++ip & 255}` } }, res);
    return { status: res.code, payload: res.payload };
  };
  const player = async (email) => {
    const acct = accounts.newAccount('secret', 'code');
    acct.until = Date.now() + 30 * 24 * 3600e3;
    await accounts.saveAccount(email, acct);
    return { email, token: acct.token };
  };
  let runN = 0;
  const push = (who, score, mode = 'square') =>
    call({ action: 'push', ...who, runId: `rb-${++runN}`, mode, score, data: { ...fillRun(mode, score, {}), rules: SCORING_V } });
  const rebuild = (extra = {}) => call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, ...extra });
  const on = (board, id) => store.zscore('lb:' + board, id);

  // 61 局以前的最高分：先 900，再 60 局 100——存档只留最近 60 局，900 那一局翻不出来了。
  const P = await player('rb-old-best@example.com');
  await push(P, 900);
  for (let i = 0; i < 60; i++) await push(P, 100);
  const archive = (await store.get('runs:' + P.email)) || [];
  check('⑥（尺子）存档只剩最近 60 局，900 那一局已经不在里头', archive.length === 60 && !archive.some((r) => r.score === 900),
    `${archive.length} 局，最高 ${Math.max(...archive.map((r) => r.score))}`);
  const r1 = await rebuild();
  check('⑥ 61 局以前的最高分重建之后不掉：方块基础榜、总榜上都还是 900',
    r1.status === 200 && (await on('square:base', P.email)) === 900 && (await on('total', P.email)) === 900,
    `${r1.status} 榜 ${await on('square:base', P.email)} 总榜 ${await on('total', P.email)}`);

  // 全清之后点一次普通重建：同规则、没超上界的老高分回来（mint.html 那句「全清是可逆的」）。
  const w = await rebuild({ all: true });
  check('⑥ 全部清空：900 那一行撤了', w.status === 200 && (await on('square:base', P.email)) === null && (await on('total', P.email)) === null,
    `${w.status} ${await on('square:base', P.email)}`);
  await rebuild();
  check('⑥ 全清之后普通重建：900 回来了（存档里翻不出它，靠的是留着的最高分记录）',
    (await on('square:base', P.email)) === 900 && (await on('total', P.email)) === 900, String(await on('square:base', P.email)));

  // 只打过 0 分局、又没起昵称：旧版本留下的那一行 0 分（那时 0 分也上榜）。
  const Z = await player('rb-zero@example.com');
  await push(Z, 0);
  await store.zadd('lb:square:base', 0, Z.email);
  const names = await store.hget('lbnames', Z.email);
  check('⑥（尺子）这个人没有昵称、不在总榜上，只在方块基础榜上躺着一行 0 分',
    !names && (await on('total', Z.email)) === null && (await on('square:base', Z.email)) === 0, `${JSON.stringify(names)} · ${await on('square:base', Z.email)}`);
  await rebuild({ all: true });
  check('⑥ 无昵称、只有 0 分局的人：全部清空之后榜上没有他', (await on('square:base', Z.email)) === null, String(await on('square:base', Z.email)));

  // 超上界的旧最高分：stats 里记着一个九位数（伪造的），存档里只有一局 300。
  const X = await player('rb-forged@example.com');
  await push(X, 300);
  const sx = await store.get('stats:' + X.email);
  await store.set('stats:' + X.email, { ...sx, best: { ...sx.best, 'square:base': 999999999 } });
  await store.zadd('lb:square:base', 999999999, X.email);
  await store.zadd('lb:total', 999999999, X.email);
  await rebuild();
  const sx2 = await store.get('stats:' + X.email);
  check('⑥ 超出方块基础榜上界（1,469,664）的旧最高分：重建之后换成存档算得出来的 300',
    (await on('square:base', X.email)) === 300 && (await on('total', X.email)) === 300 && sx2?.best?.['square:base'] === 300,
    `榜 ${await on('square:base', X.email)} 总榜 ${await on('total', X.email)} best ${JSON.stringify(sx2?.best)}`);

  // 换过计分规则的旧最高分：stats.bestRules 不是现行那一版。
  const R = await player('rb-old-rules@example.com');
  await push(R, 200);
  const sr = await store.get('stats:' + R.email);
  await store.set('stats:' + R.email, { ...sr, best: { ...sr.best, 'square:base': 5000 }, bestRules: 'older' });
  await rebuild();
  check('⑥ 换过计分规则的旧最高分不留：重建之后是存档里的 200', (await on('square:base', R.email)) === 200, String(await on('square:base', R.email)));
  delete process.env.ADMIN_TOKEN;
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
