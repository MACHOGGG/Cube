/**
 * 登录之后，云上那份战绩要回到这台设备。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8891 dist      （内存版，TESTMONTH 只能兑一次）
 *   node scripts/check-restore.mjs http://localhost:8891/
 *
 * 玩家撞上的那一幕：「重新登录之后累计得分和所有成绩都消除了」。根因不是删了
 * 谁的东西——记录一直只存在这台设备的 localStorage 里，而云上那份从来没有被
 * 取回来过。换台设备、清过缓存、或者从 iOS 桌面图标打开（那是另一个存储空
 * 间），本地就是一张白纸，尽管服务器上什么都没丢。
 *
 * 这里就照那一幕走一遍：打一局 → 确认云上有了 → 把本地存储清空（等于换了个
 * 存储空间）→ 带着同一个账号回来 → 记录和累计得分都得回来。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [page error] ' + e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#navProfile', { timeout: 20000 });

// ---- 登录（用内部码换一个身份）-----------------------------------------------
const auth = await page.evaluate(async () => {
  const r = await fetch('/api/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }),
  }).then((x) => x.json());
  if (!r.active) return null;
  const rec = { active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code };
  localStorage.setItem('slides_genius', JSON.stringify(rec));
  return rec;
});
check('拿到一个能上报成绩的身份', Boolean(auth && auth.token));
if (!auth) { await browser.close(); process.exit(1); }

// ---- 报三局上去（走的就是打完一局那条路）-------------------------------------
const RUNS = [
  { at: 1_700_000_001_000, shapeId: 'square', modeKey: 'base', totalScore: 1234 },
  { at: 1_700_000_002_000, shapeId: 'circle', modeKey: 'timed', totalScore: 777 },
  { at: 1_700_000_003_000, shapeId: 'triangle', modeKey: 'bomb', totalScore: 88 },
];
const pushed = await page.evaluate(async ({ who, runs }) => {
  const out = [];
  for (const r of runs) {
    const data = { ...r, shapeFallback: r.shapeId, score: r.totalScore, seconds: 30, ratePercent: 50, reason: '', penalties: [] };
    const res = await fetch('/api/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: who.email, code: who.code, token: who.token,
        action: 'push', runId: `${r.at}-${r.shapeId}-${r.modeKey}`, mode: r.shapeId,
        score: r.totalScore, name: '甲', data,
      }),
    }).then((x) => x.json()).catch(() => null);
    out.push(Boolean(res && res.ok));
  }
  return out;
}, { who: auth, runs: RUNS });
check('三局都报上去了', pushed.every(Boolean), JSON.stringify(pushed));

// ---- 把这台设备的存储清空：等于换了台手机 / 从桌面图标打开 --------------------
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#navProfile', { timeout: 20000 });
const emptied = await page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.endsWith('::runs')).length);
check('存储清空之后，本地一局都不剩', emptied === 0, `${emptied} 个存档键`);

// ---- 带着同一个账号回来 -------------------------------------------------------
await page.evaluate((rec) => {
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_genius', JSON.stringify(rec));
}, auth);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#navRecords', { timeout: 20000 });
await page.click('#navRecords');
await page.waitForSelector('.records-page', { timeout: 10000 });
// 取回来是一次网络往返，给它几秒。
const back = await page.waitForFunction(
  () => {
    const v = document.getElementById('totalValue');
    return v && v.textContent.trim() !== '0' ? v.textContent.trim() : null;
  },
  { timeout: 15000 },
).then((h) => h.jsonValue()).catch(() => null);
check('登录之后，累计得分回来了', back !== null, String(back));
const rows = await page.$$eval('.records-row-score', (els) => els.map((e) => Number(e.textContent.trim())));
check('三局记录都回来了', rows.length >= 3 && [1234, 777, 88].every((n) => rows.includes(n)), JSON.stringify(rows));
check('累计得分是这三局的和（2099）', back === '2099', String(back));

// ---- 再取一次不会翻倍 ---------------------------------------------------------
await page.click('#navRecords');
await page.click('#navRecords');
await page.waitForSelector('.records-page', { timeout: 10000 });
await page.waitForTimeout(1500);
const again = await page.$eval('#totalValue', (e) => e.textContent.trim());
check('再进一次不会重复计入', again === '2099', again);

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
