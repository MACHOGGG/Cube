/**
 * 头一回打开这个网站的那条路，从头走一遍。
 *
 *   node scripts/dev-server.mjs 8976 dist
 *   node scripts/check-first-play.mjs http://localhost:8976/
 *
 * 盯着玩家 2026-09 点名的四件事：
 *
 *   · 软锁——一局都没打过时，主菜单上只有《基础方块》和《基础小球》按得开；
 *     按到别的卡，那两张抖一下、光更亮一档，靠下的还会冒一个上滑箭头。打完
 *     第一局锁就永远撤掉。
 *   · 教学条——他玩的第一个基础玩法从第 1 条讲起，五段进度（第 6 条挪去了结
 *     算页），第 1 条说的是「色块得分后会变成星星」。
 *   · 三角——得分变成星星之后，那圈灰色圆角边框一直在（和消掉之后的空三角
 *     同一圈）。
 *
 * 这支脚本每一段都从 localStorage.clear() 重新做人，所以顺序无关，单跑也行。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8976/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
// 全新的人：只定语言，别的一格不填
await page.addInitScript(() => localStorage.setItem('slides_lang', 'zhHans'));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

// ── 软锁 ──────────────────────────────────────────────────────────────
const glow = await page.$$eval('.home-icon-btn--glow', (bs) => bs.map((b) => b.getAttribute('aria-label')));
check('新人进来：只有方块和小球两张亮着', glow.length === 2 && glow.includes('方块') && glow.includes('圆球'), JSON.stringify(glow));

await page.click('.home-icon-btn[aria-label^="老虎机"]');
await page.waitForTimeout(260);
const after = await page.evaluate(() => ({
  onMenu: !!document.querySelector('.home-page'),
  nudging: document.querySelectorAll('.home-icon-btn--nudge').length,
  hint: !!document.querySelector('.home-up-hint--in'),
}));
check('按到锁着的玩法：人还在主菜单，没进去', after.onMenu, JSON.stringify(after));
check('两张基础卡抖起来了', after.nudging === 2, String(after.nudging));
check('那张在下面，冒出了上滑箭头', after.hint === true);

// 玩过一局之后锁就没了
await page.evaluate(() => localStorage.setItem('slides_played_circle', '1'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.click('.home-icon-btn[aria-label="菱形方块"]');
await page.waitForTimeout(800);
check('打过一局之后：锁撤了，点得进去', !(await page.$('.home-page')), '还在主菜单就是没撤');
check('也不再抖了', (await page.$$('.home-icon-btn--nudge')).length === 0);

// ── 头一局的教学条 ────────────────────────────────────────────────────
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('slides_lang', 'zhHans'); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.click('.home-icon-btn[aria-label="圆球"]');
await page.waitForTimeout(600);
if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 25000 });
await page.waitForTimeout(600);
const coach = await page.evaluate(() => ({
  segs: document.querySelectorAll('.coach-seg').length,
  rows: [...document.querySelectorAll('.coach-row:not([hidden]) .coach-text')].map((e) => e.textContent.trim()),
}));
check('教学条：五段进度（第 6 条挪去结算页了）', coach.segs === 5, String(coach.segs));
check('第 1 步摆的是前两条', coach.rows.length === 2, JSON.stringify(coach.rows.map((t) => t.slice(0, 12))));
check('第 1 条讲的是色块变星星', (coach.rows[0] || '').includes('变成星星'), coach.rows[0]);

// ── 三角那圈灰边 ──────────────────────────────────────────────────────
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['square', 'circle']) localStorage.setItem('slides_played_' + k, '1');
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.click('.home-icon-btn[aria-label="三角"]');
await page.waitForTimeout(600);
if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
await page.waitForFunction(() => document.querySelectorAll('.tri').length > 0, { timeout: 25000 });
await page.waitForTimeout(900);
// 逼出几个星星面：直接翻不了，就查渲染代码有没有把边画上——先滑几下拿到得分
const box = await page.$eval('.board', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
for (let i = 0; i < 40; i++) {
  const row = 0.12 + (i % 6) * 0.15;
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * row);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.5 + (i % 2 ? 70 : -70), box.y + box.h * row, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(240);
}
await page.waitForTimeout(1200);
const tri = await page.evaluate(() => {
  // 星星面认「有三笔线」；那圈灰边是同一块 svg 里一条带 stroke 的 path。
  const stars = [...document.querySelectorAll('.tri')].filter((el) => el.querySelector('line'));
  return { stars: stars.length, withRing: stars.filter((el) => el.querySelector('path[stroke]')).length };
});
check('三角上真的出现了星星面', tri.stars > 0, JSON.stringify(tri));
check('每一枚星星面都戴着那圈灰边', tri.stars > 0 && tri.withRing === tri.stars, JSON.stringify(tri));

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
