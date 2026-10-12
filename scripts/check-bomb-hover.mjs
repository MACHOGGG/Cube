/**
 * 电脑宽版主菜单上那张炸弹卡，鼠标悬停也放大——和同一排的计时卡一样（10-08 补充方案 7-19）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8982 dist
 *   node scripts/check-bomb-hover.mjs http://localhost:8982/
 *
 * 宽版上炸弹那一块不是 .home-icon-btn，是 .home-bomb-card（ui/menu.ts），style.css 里「悬停放大 1.06」那两条原先
 * 只写了 .home-icon-btn：同一排的计时卡一悬停就放大，炸弹卡不动，看着像按不了。方案的验收原样搬进来：
 *
 *   ① 1440×900：悬停 300ms 后炸弹卡宽高 = 原来的 1.06 倍（±1px），和同一排计时卡放大的倍数一样；移开复原。
 *   ② 减弱动态：炸弹卡和计时卡一个样（这一条规则不看减弱动态，两张都照样放大——要的是「同别的卡」）。
 *   ③（尺子）计时卡自己真的放大了：「两张一样」不能是「两张都没动」。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-bomb-hover.mjs http://localhost:8982/');
  process.exit(2);
}
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const box = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });

for (const motion of ['no-preference', 'reduce']) {
  const tag = motion === 'reduce' ? '减弱动态' : '平常';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: motion });
  await ctx.addInitScript(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['square', 'circle', 'finished']) localStorage.setItem('slides_played_' + k, '1');
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-page--wide .home-bomb-card', { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  const ratio = async (sel) => {
    const a = await box(page, sel);
    await page.mouse.move(a.x, a.y);
    await page.waitForTimeout(300);
    const b = await box(page, sel);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const c = await box(page, sel);
    return { a, b, c, rw: b.w / a.w, rh: b.h / a.h };
  };
  const bomb = await ratio('.home-page--wide .home-bomb-card');
  const timed = await ratio('.home-page--wide .home-icon-btn--timed');
  check(`${tag}：（尺子）计时卡悬停 300ms 真的放大了`, timed.rw > 1.03, `×${timed.rw.toFixed(3)}`);
  check(`${tag}：炸弹卡悬停 300ms 后宽高 = 原来的 1.06 倍（±1px）`,
    Math.abs(bomb.b.w - bomb.a.w * 1.06) <= 1 && Math.abs(bomb.b.h - bomb.a.h * 1.06) <= 1,
    `${bomb.a.w.toFixed(1)}×${bomb.a.h.toFixed(1)} → ${bomb.b.w.toFixed(1)}×${bomb.b.h.toFixed(1)}`);
  check(`${tag}：和同一排的计时卡放大的倍数一样`, Math.abs(bomb.rw - timed.rw) <= 0.005 && Math.abs(bomb.rh - timed.rh) <= 0.005,
    `炸弹 ×${bomb.rw.toFixed(3)} / 计时 ×${timed.rw.toFixed(3)}`);
  check(`${tag}：移开复原`, Math.abs(bomb.c.w - bomb.a.w) <= 0.5 && Math.abs(bomb.c.h - bomb.a.h) <= 0.5,
    `${bomb.c.w.toFixed(1)}×${bomb.c.h.toFixed(1)}`);
  await ctx.close();
}
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
