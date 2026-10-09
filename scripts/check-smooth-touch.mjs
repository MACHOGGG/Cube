/**
 * 整页滚动不接平滑滚动：电脑、手机都是原生的（10-09 补充方案第一部分第 10 条 ＋ 6-8）。
 *
 *   node scripts/dev-server.mjs 8967 dist
 *   node scripts/check-smooth-touch.mjs http://localhost:8967/
 *
 * 来历：2026-09 第八轮给整页滚动加了一层 Lenis 阻尼（engine/smoothScroll.ts），手机电脑都接。10-08
 * 方案 3-J 先把触屏摘掉（「移动端触摸列表一律不做 Lenis 式平滑滚动」），只留电脑的滚轮——这道门
 * 原先量的就是那一半：手机上没建、电脑上建了。10-09 玩家再拍板「电脑端滚轮那层平滑滚动**整个拿
 * 掉**」，6-8 又确认「GSAP、Lenis 都不进共享 src/」。所以 smoothScroll.ts 和它在小红书那边的空替身
 * 一起删了，lenis 也从依赖里撤了。
 *
 * 文件名照旧叫 smooth-touch：browser 那几片的清单按脚本路径认门（check-ci-browser ⑥），换名字等于撤
 * 一道、加一道，而它量的还是同一件事，只是口径从「触屏不接」放宽成「谁都不接」。
 *
 * 怎么看「建没建」：Lenis 一建出来就往 <html> 上挂一个 `lenis` 类（它自己的 updateClassName），原先
 * 的 ensure() 还往 <head> 里贴一段 `#lenis-styles`。
 *
 *   ① 手机 390×844（触屏）、② 电脑 1280×800（鼠标）：进个人主页（内容页，原先 start() 就是在这种页
 *      上去要阻尼的），滚轮滚一下——<html> 上没有 lenis 类、head 里没有那段样式；页面长过一屏的话，
 *      滚轮真的把它滚动了（尺子：「没有阻尼」不能是「根本滚不动」）。
 *   ③ 源码：package.json 不依赖 lenis / gsap；src/ 和 xhs/src/ 里没有一处 import 它们；smoothScroll.ts
 *      和它的替身都不在了，xhs/vite.config.ts 的 SWAP 表里也没有那一行。带反面尺子：一句
 *      `import Lenis from 'lenis'` 喂进同一个匹配器，必须认得出来。
 */
import { chromium } from 'playwright';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

// ── ③ 源码先量（不用开浏览器）────────────────────────────────────────────────
const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
{
  const pkg = JSON.parse(read('package.json'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const banned = Object.keys(deps).filter((d) => /^(lenis|@studio-freight\/lenis|gsap|@gsap\/.*)$/.test(d));
  check('③ package.json 不依赖 lenis / gsap', banned.length === 0, banned.join(' / ') || '干净');

  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(join(root, dir))) {
      const p = `${dir}/${f}`;
      if (statSync(join(root, p)).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(f)) files.push(p);
    }
  };
  walk('src');
  walk('xhs/src');
  check('（尺子）读到了两端的源码', files.length > 100, `${files.length} 个文件`);
  const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](?:lenis|@studio-freight\/lenis|gsap)(?:\/[^'"]*)?['"]/;
  const users = files.filter((f) => IMPORT.test(read(f)));
  check('③ src/ 和 xhs/src/ 里没有一处 import lenis / gsap', users.length === 0, users.join(' / ') || '干净');
  check('③（反面尺子）import Lenis / 它的样式 / gsap 喂进同一个匹配器都认得出来',
    IMPORT.test("import Lenis from 'lenis';") &&
      IMPORT.test("import lenisCss from 'lenis/dist/lenis.css?inline';") &&
      IMPORT.test("import { gsap } from 'gsap';"));

  const left = ['src/engine/smoothScroll.ts', 'xhs/src/stubs/smoothScroll.ts'].filter((p) => existsSync(join(root, p)));
  check('③ smoothScroll.ts 和小红书那边的替身都不在了', left.length === 0, left.join(' / ') || '都删了');
  check('③ xhs/vite.config.ts 的 SWAP 表里没有 smoothScroll 那一行', !/smoothScroll/.test(read('xhs/vite.config.ts')));
}

// ── ①② 真开一页量 ────────────────────────────────────────────────────────────
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
  y: window.scrollY,
  tall: document.documentElement.scrollHeight > window.innerHeight + 40,
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
  const before = await page.evaluate(PROBE);
  await page.mouse.move(w / 2, h / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(700);
  const m = await page.evaluate(PROBE);
  await ctx.close();
  check(`${label}：（尺子）指点设备${touch ? '是粗的（触屏）' : '是细的（鼠标）'}`, touch ? m.coarse && !m.fine : m.fine && !m.coarse, JSON.stringify({ coarse: m.coarse, fine: m.fine }));
  check(`${label}：（尺子）进到了个人主页（原先会去要阻尼的那一种内容页）`, m.profile);
  check(`${label}：没有平滑滚动（<html> 上没有 lenis，head 里没有它那段样式）`, !m.lenis && !m.styles, JSON.stringify({ lenis: m.lenis, styles: m.styles }));
  if (before.tall) check(`${label}：（尺子）滚轮滚得动这一页（原生滚动还在）`, m.y > before.y, `${before.y} → ${m.y}`);
  else console.log(`NOTE  ${label}：这一页没长过一屏，「滚得动」那一条无从量，不假装查过`);
  check(`${label}：零报错`, errs.length === 0, errs.slice(0, 2).join(' | '));
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
