/**
 * 榜没拉下来，说「没拉下来」，不说「还没有人」（2026-10-08 方案 2-8）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8995 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-rank-network.mjs http://localhost:8995/
 *
 * 记录页上那块榜的缩略图（ui/leaderboard.ts 的 mountBoardThumb）和点开之后那一整页（同一个文件的
 * 拉榜那一段），拉不到的时候从前都落在 rankEmpty（「这张榜上还没有人」）上：网断了一下，玩家看着
 * 一张空榜，以为真没人玩。两处各量一次：
 *
 *   ① 拉榜那一条请求断掉：缩略图底下那句、整页那句，都是 rankNetwork。
 *   ② 尺子：放行之后再开一次，这台新服务器上确实没人——这时候说的才是「还没有人」。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-rank-network.mjs http://localhost:8995/');
  process.exit(2);
}
const NETWORK = '榜没加载出来，检查一下网络。';
const EMPTY = '这张榜上还没有人';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#navProfile', { timeout: 20000 });
// 榜要登录、要天才：兑一张内部码，那份权益里就带着邮箱和令牌。
const granted = await page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return false;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
  return true;
});
check('（尺子）TESTMONTH 兑到了权益（榜要它）', granted);

// 拉榜那一条断掉（像网断了一样，fetch 直接抛），别的照常放行。
let blocking = true;
let cut = 0;
await page.route('**/api/scores', async (route) => {
  let action = '';
  try {
    action = JSON.parse(route.request().postData() || '{}').action;
  } catch {}
  if (blocking && action === 'board') {
    cut++;
    return route.abort('failed');
  }
  return route.continue();
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#navRecords', { timeout: 20000 });

/** 记录页那块缩略图底下那一句，等它不再是「加载中」。 */
const thumbNote = () =>
  page.waitForFunction(() => {
    const t = document.querySelector('#ranksPanel .rank-foot')?.textContent?.trim() ?? '';
    return t && t !== '加载中…' ? t : false;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => '');
/** 点开之后那一整页的那一句。 */
const pageNote = () =>
  page.waitForFunction(() => {
    const t = document.querySelector('.rank-empty')?.textContent?.trim() ?? '';
    return t && t !== '加载中…' ? t : false;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => '');

// ── ① 断掉 ───────────────────────────────────────────────────────────────
await page.$eval('#navRecords', (e) => e.click());
await page.waitForSelector('#ranksPanel', { timeout: 10000 });
const t1 = await thumbNote();
check('①（尺子）拉榜那一条真的断了', cut >= 1, `${cut} 次`);
check('① 缩略图：说的是「没拉下来」，不是「还没有人」', t1 === NETWORK, t1);
await page.$eval('#ranksPanel', (e) => e.click());
const p1 = await pageNote();
check('① 点开那一整页：也是「没拉下来」', p1 === NETWORK, p1);

// ── ② 尺子：放行之后，这台新服务器上确实没人 ─────────────────────────────
blocking = false;
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#navRecords', { timeout: 20000 });
await page.$eval('#navRecords', (e) => e.click());
await page.waitForSelector('#ranksPanel', { timeout: 10000 });
const t2 = await thumbNote();
check('②（尺子）放行之后：缩略图说的是「还没有人」（这台服务器上确实没人）', t2 === EMPTY, t2);
await page.$eval('#ranksPanel', (e) => e.click());
const p2 = await pageNote();
check('②（尺子）放行之后：整页也是「还没有人」', p2 === EMPTY, p2);

check('全程零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
