/**
 * 方块：拖满一整圈，盘面原样回来，**不算一步**（2026-10-08 方案 2-12）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8998 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-square-fullturn.mjs http://localhost:8998/
 *
 * 方块的 applyDrag 从前自己转，只拦了「没动」（shift 为 0）：一行拖满 6 格，盘面原样回来，却照样
 * 记一步。步步为营里就是白扣一步余步——这一台就在步步为营里量（左上那一格印的是余步，看得见）。
 * 现在它和其余五副一样走 engine/slideLine：转了整圈不算一步。读源码那一半由 check-slide-line 钉着。
 *
 *   ① 一行拖满一整圈：余步一步不扣，那一行原样。
 *   ② 一列拖满一整圈：同上。
 *   ③（尺子）同样的手法只拖一格：那一行真的变了（拖法本身没问题，①② 不是因为根本没拖动才绿）。
 *
 * 电脑的视口：手机竖屏上拖满一整圈，手指要拖出屏幕。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-square-fullturn.mjs http://localhost:8998/');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle',
    'slides_played_square', 'slides_played_circle', 'slides_know_how']) localStorage.setItem(k, '1');
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
// 《步步为营》是天才特供：兑一张码。
const granted = await page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return false;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
  return true;
});
check('（尺子）TESTMONTH 兑到了权益（步步为营要它）', granted);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$$eval('.home-icon-btn', (els) => els.find((e) => /步步为营/.test(e.getAttribute('aria-label') || ''))?.click());
await page.waitForSelector('.slot-pick-opt[data-family="square"]', { timeout: 15000 });
await page.$eval('.slot-pick-opt[data-family="square"]', (e) => e.click());
await page.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
await page.$eval('#startBtn', (e) => e.click());
const up = await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile[data-r]').length === 36, { timeout: 20000 })
  .then(() => true).catch(() => false);
check('（尺子）步步为营·方块开起来了，36 枚', up);
await page.waitForTimeout(800);

const stepsLeft = () => page.$eval('#hud-time', (e) => e.textContent.trim()).catch(() => '');
const snap = () =>
  page.$$eval('#boardWrap .tile[data-r]', (els) =>
    Object.fromEntries(els.map((e) => [e.dataset.r + ',' + e.dataset.c, getComputedStyle(e).backgroundColor + '|' + e.dataset.face])));
const center = (r, c) =>
  page.$eval(`#boardWrap .tile[data-r="${r}"][data-c="${c}"]`, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
/** 从 (r, c) 那一枚的正中按下，拖 (dx, dy)，松手，等这一下落定。 */
async function drag(r, c, dx, dy) {
  const p = await center(r, c);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

const a = await center(0, 0);
const b = await center(0, 1);
const d = await center(1, 0);
const stepX = b.x - a.x;
const stepY = d.y - a.y;
const before = await snap();
const s0 = await stepsLeft();
check('（尺子）开局余步是 8', s0 === '8', s0);

// ① 一行拖满一整圈（6 格）。
await drag(0, 0, stepX * 6, 0);
const afterRow = await snap();
check('① 一行拖满一整圈：余步一步不扣', (await stepsLeft()) === '8', await stepsLeft());
check('① 那一行原样', [0, 1, 2, 3, 4, 5].every((c) => afterRow['0,' + c] === before['0,' + c]));

// ② 一列拖满一整圈。
await drag(0, 0, 0, stepY * 6);
const afterCol = await snap();
check('② 一列拖满一整圈：余步一步不扣', (await stepsLeft()) === '8', await stepsLeft());
check('② 那一列原样', [0, 1, 2, 3, 4, 5].every((r) => afterCol[r + ',0'] === before[r + ',0']));

// ③ 尺子：同样的手法只拖一格，那一行真的变了。
await drag(0, 0, stepX, 0);
const afterOne = await snap();
check('③（尺子）同样的手法拖一格：那一行真的变了', [0, 1, 2, 3, 4, 5].some((c) => afterOne['0,' + c] !== before['0,' + c]));

check('全程零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
