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
import { readFileSync } from 'node:fs';

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
// 第四局是**老规则**的炸弹局（没有 bombRules）：2026-09 炸弹改成「一局只剩一枚
// 永久炸弹」之后，老局归到老的 _bomb 存档键下，《记录与排名》不再摆出来，所以它
// 取回来了也不该出现在下面那三行里、更不该进累计得分。少了这一条，从云端取回的
// 老局会写进新键，和新规则的分混在一起比。
// 炸弹那一局的规则版本**从源码现读**，不写死。写死过一次，代价就是这道门：规则从 2
// 升到 3 之后，这儿还在种 `bombRules: 2`，于是那一局被当成老规则挡在外面，门红了三条
// ——看着像「云端取回坏了」，其实只是门自己过期了。
const BOMB_RULES = Number(
  /export const BOMB_RULES_VERSION = (\d+)/.exec(readFileSync(new URL('../src/engine/bomb.ts', import.meta.url), 'utf8'))?.[1],
);
if (!Number.isFinite(BOMB_RULES)) { console.log('FAIL  读不到 BOMB_RULES_VERSION'); process.exit(1); }
const RUNS = [
  { at: 1_700_000_001_000, shapeId: 'square', modeKey: 'base', totalScore: 1234 },
  { at: 1_700_000_002_000, shapeId: 'circle', modeKey: 'timed', totalScore: 777 },
  { at: 1_700_000_003_000, shapeId: 'triangle', modeKey: 'bomb', totalScore: 88, bombRules: BOMB_RULES },
  { at: 1_700_000_004_000, shapeId: 'triangle', modeKey: 'bomb', totalScore: 50_000 },
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
check('四局都报上去了', pushed.every(Boolean), JSON.stringify(pushed));

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
// 读的是 dataset.score，不是 textContent：累计得分变了的时候那个数会滚一遍
// （engine/odometer.ts），滚起来之后元素里装的是十个面的滚筒，textContent 读出来是
// 「0123456789…」。滚筒那一套从一开始就规定「想读这个数的代码读 dataset.score」。
const readTotal = (el) => (el ? (el.dataset.score ?? el.textContent.trim()) : null);
const back = await page.waitForFunction(
  () => {
    const v = document.getElementById('totalValue');
    const n = v ? (v.dataset.score ?? v.textContent.trim()) : null;
    return n && n !== '0' ? n : null;
  },
  { timeout: 15000 },
).then((h) => h.jsonValue()).catch(() => null);
check('登录之后，累计得分回来了', back !== null, String(back));
const rows = await page.$$eval('.records-row-score', (els) => els.map((e) => Number(e.textContent.trim())));
check('三局记录都回来了', rows.length >= 3 && [1234, 777, 88].every((n) => rows.includes(n)), JSON.stringify(rows));
check('老规则那局炸弹没混进来', !rows.includes(50_000), JSON.stringify(rows));
check('累计得分是这三局的和（2099）', back === '2099', String(back));

// ---- 累计得分：变了才滚，没变不滚 ---------------------------------------------
// 玩家 2026-09：「Total score 的地方，每次打开的时候都是从上一次打开时的数字按照动画
// 刷新」——他要的是「只有数字变了才滚」。
//
// 这台设备刚清过存储，所以「上次看到多少」也一并没了：**头一次看不滚**（没有任何东
// 西可以对比，那一下什么也说明不了）。
const first = await page.$eval('#totalValue', (e) => ({
  odometer: e.classList.contains('odometer'),
  text: e.textContent.trim(),
}));
check('头一次看（本机没记过）不滚', !first.odometer && first.text === '2099', JSON.stringify(first));

// ---- 再取一次不会翻倍，而且这一次照样不滚 -------------------------------------
await page.click('#navRecords');
await page.click('#navRecords');
await page.waitForSelector('.records-page', { timeout: 10000 });
await page.waitForTimeout(1500);
const againEl = await page.$eval('#totalValue', (e) => ({
  score: e.dataset.score ?? e.textContent.trim(),
  text: e.textContent.trim(),
  odometer: e.classList.contains('odometer'),
}));
check('再进一次不会重复计入', againEl.score === '2099', JSON.stringify(againEl));
// 同一个数第二次打开：一个像素都不动。这一条是这次改动的要害——从前每次打开都刷一遍。
check('数字没变，第二次打开就不滚了',
  !againEl.odometer && againEl.text === '2099', JSON.stringify(againEl));

// ---- 真的变了：本机再添一局，回到这一页就该滚一遍 -----------------------------
// 直接往存档里写一局（和打完一局落下来的是同一份结构），所以这一条量的正是「数变了」
// 这一件事，不掺别的。
const bumped = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.endsWith('::runs'));
  if (!key) return null;
  const list = JSON.parse(localStorage.getItem(key));
  const at = Date.now();
  list.unshift({ at, data: { ...list[0].data, at, totalScore: 500 }, start: null, end: null });
  localStorage.setItem(key, JSON.stringify(list));
  return key;
});
check('往本机存档里又添了一局', Boolean(bumped), String(bumped));
await page.click('#navRecords');
await page.click('#navRecords');
await page.waitForSelector('.records-page', { timeout: 10000 });
await page.waitForTimeout(800);
const rolled = await page.$eval('#totalValue', (e) => ({
  odometer: e.classList.contains('odometer'),
  score: e.dataset.score ?? '',
  boxes: e.querySelectorAll('.digit-box').length,
}));
check('数字变了，这一次滚了一遍（2599，四个滚筒）',
  rolled.odometer && rolled.score === '2599' && rolled.boxes === 4, JSON.stringify(rolled));

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
