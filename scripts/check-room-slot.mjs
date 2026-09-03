/**
 * 小屋里的随机得分目标：《相同》全屋同一对图案，《不同》各转各的，棋盘都一样。
 *
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-room-slot.mjs http://localhost:8817/
 *
 * 两台浏览器进同一间小屋。屋主去挑玩法那一屏点《随机得分目标》——这时那一
 * 屏上多一个《相同 / 不同》开关。相同：两台设备棋盘上认的两个图案要一模一
 * 样（它们是从小屋那个种子里抽的）；不同：两台各抽各的，可棋盘仍然要一模
 * 一样（棋盘照旧从种子发，抽图案不碰那条流）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function newPlayer(label) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} page error] ${e.message}`));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}
const LEGEND = () =>
  [...document.querySelectorAll('.pattern-hint--a .ph-part .pattern-icon')].map((e) => e.getAttribute('aria-label') || '');
const boardSignature = (page) =>
  page.$$eval('#boardWrap *', (els) =>
    els.map((e) => e.style.backgroundColor || e.getAttribute('fill') || '').filter(Boolean).join(','));

const A = await newPlayer('host');
const B = await newPlayer('guest');
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return r;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until,
    channel: 'code', email: r.email, token: r.token, code: r.code }));
  return r;
});
check('屋主用内部码开通天才', granted.active === true);
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');
await A.page.click('#navProfile'); await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
await A.page.fill('#mpName', '甲'); await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
await B.page.click('#navProfile'); await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 10000 });
await B.page.fill('#mpName', '乙'); await B.page.fill('#mpCode', code); await B.page.click('#mpJoin');
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });

/** 屋主走一趟：为大家挑 → 个人主页 → 随机得分目标 → 拨开关 → 点方块。 */
async function hostPicks(slot) {
  await A.page.click('#mpPick');
  await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
  await A.page.click('#navProfile');
  await A.page.waitForSelector('#randomRow', { timeout: 8000 });
  await A.page.click('#randomRow');
  await A.page.waitForSelector('.slot-page', { timeout: 8000 });
  const sw = await A.page.evaluate(() => ({
    seg: Boolean(document.querySelector('.slot-share')),
    on: document.querySelector('.slot-share-opt--on')?.dataset.slot,
    banner: Boolean(document.getElementById('roomPickBar')),
  }));
  check(`屋主替整屋挑时那一屏有《相同 / 不同》开关（默认相同）`, sw.seg && sw.on === 'same', JSON.stringify(sw));
  if (slot === 'own') await A.page.click('.slot-share-opt[data-slot="own"]');
  await A.page.click('.slot-pick-opt[data-family="square"]');
}
async function bothBoards() {
  for (const P of [A, B]) {
    await P.page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 40000 });
  }
  await A.page.waitForTimeout(800);
  return {
    la: await A.page.evaluate(LEGEND), lb: await B.page.evaluate(LEGEND),
    sa: await boardSignature(A.page), sb: await boardSignature(B.page),
  };
}
async function finishBoth() {
  for (const P of [A, B]) {
    await P.page.click('#finishBtn');
    const yes = await P.page.waitForSelector('#mpFinishYes', { timeout: 5000 }).catch(() => null);
    if (yes) await yes.click();
  }
  await A.page.waitForSelector('#mpPick', { timeout: 20000 });
}

// ---- 第一局：相同 ---------------------------------------------------------
await hostPicks('same');
const r1 = await bothBoards();
check('相同：两边棋盘上认的是同两个图案', r1.la.length === 2 && r1.la.join('|') === r1.lb.join('|'),
  `甲 ${r1.la.join('/')} · 乙 ${r1.lb.join('/')}`);
check('相同：两边棋盘一模一样', r1.sa.length > 0 && r1.sa === r1.sb);
await finishBoth();

// ---- 第二局：不同 ---------------------------------------------------------
await hostPicks('own');
const r2 = await bothBoards();
check('不同：两边各有两个图案', r2.la.length === 2 && r2.lb.length === 2, `甲 ${r2.la.join('/')} · 乙 ${r2.lb.join('/')}`);
check('不同：棋盘仍然一模一样（抽图案不碰发牌的那条随机流）', r2.sa.length > 0 && r2.sa === r2.sb);
check('第二局的棋盘和第一局不是同一副', r2.sa !== r1.sa);

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
