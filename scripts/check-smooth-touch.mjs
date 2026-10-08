/**
 * 触屏不接 Lenis 的平滑滚动，电脑的滚轮照旧有（10-08 方案 3-J）。
 *
 *   node scripts/dev-server.mjs 8967 dist
 *   node scripts/check-smooth-touch.mjs http://localhost:8967/
 *
 * 方案原话（玩家拍板，照执行不讨论）：「移动端触摸列表一律不做 Lenis 式平滑滚动；桌面版开工时再单
 * 独评估『仅桌面、仅营销/规则页』。」
 *
 * 从前（2026-09 第八轮）engine/smoothScroll.ts 开着 `syncTouch: true`——手机、平板上一根手指滑内容
 * 页，滚的是 Lenis 插值推出来的那一份，不是原生的惯性。现在触屏设备一次都不建 Lenis（主要指点设
 * 备不精的，`(pointer: fine)` 不成立就不建），建了的那几台（电脑）也不接手指那一路。
 *
 * 怎么看「建没建」：Lenis 一建出来就往 <html> 上挂一个 `lenis` 类（它自己的 updateClassName），
 * 第一次启用时还往 <head> 里贴一段 `#lenis-styles`（smoothScroll.ts 的 ensure）。
 *
 *   ① 手机 390×844（触屏）：进个人主页——内容页，start() 会去要阻尼——<html> 上没有 lenis、
 *      head 里没有那段样式。尺子：这台「手机」的 `(pointer: coarse)` 成立。
 *   ② 电脑 1280×800（鼠标）：同一页上 Lenis 建出来了（尺子：被测的那条路在电脑上还活着——不
 *      然 ① 那一条是「什么都没建」的假绿）。
 *   ③ 源码：smoothScroll.ts 里手指那一路关着（`syncTouch: false`），ensure() 开头问的是
 *      `(pointer: fine)`。带触摸屏的笔记本主要指点设备算细的，会建实例；它的手指照旧原生滚，
 *      靠的是这一句——浏览器里模拟不出「细指点 ＋ 手指」那种机器，所以读源码钉住。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-smooth-touch.mjs http://localhost:8967/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const SEED = `
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  localStorage.setItem('slides_played_square', '1');
  localStorage.setItem('slides_played_finished', '1');
`;
const PROBE = () => ({
  coarse: matchMedia('(pointer: coarse)').matches,
  fine: matchMedia('(pointer: fine)').matches,
  lenis: document.documentElement.classList.contains('lenis'),
  styles: !!document.getElementById('lenis-styles'),
  profile: !!document.querySelector('.profile-page'),
});

for (const [w, h, touch, label] of [[390, 844, true, '① 手机 390×844（触屏）'], [1280, 800, false, '② 电脑 1280×800（鼠标）']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
  await ctx.addInitScript(SEED);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 10000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(PROBE);
  await ctx.close();
  check(`${label}：（尺子）指点设备${touch ? '是粗的（触屏）' : '是细的（鼠标）'}`, touch ? m.coarse && !m.fine : m.fine && !m.coarse, JSON.stringify({ coarse: m.coarse, fine: m.fine }));
  check(`${label}：（尺子）进到了个人主页（内容页，会去要阻尼的那一种）`, m.profile);
  if (touch) {
    check(`${label}：Lenis 一次都没建（<html> 上没有 lenis，head 里没有它那段样式）`, !m.lenis && !m.styles, JSON.stringify({ lenis: m.lenis, styles: m.styles }));
  } else {
    check(`${label}：滚轮的阻尼还在（Lenis 建出来了）`, m.lenis && m.styles, JSON.stringify({ lenis: m.lenis, styles: m.styles }));
  }
  check(`${label}：零报错`, errs.length === 0, errs.slice(0, 2).join(' | '));
}

// ③ 源码
const src = readFileSync(new URL('../src/engine/smoothScroll.ts', import.meta.url), 'utf8');
check('③ 源码：手指那一路关着（syncTouch: false）', /\n\s*syncTouch:\s*false,/.test(src) && !/\n\s*syncTouch:\s*true/.test(src));
check('③ 源码：ensure() 开头问的是 (pointer: fine)，不精就不建', /matchMedia\('\(pointer: fine\)'\)\.matches\)\s*return null;/.test(src));

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
