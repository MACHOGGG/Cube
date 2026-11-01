/**
 * 教学呼吸灯在浏览器里真的在呼吸（10-14 方案 D-5；10-31 方案推15 Z-C06 第 4 条）。**手跑**，不进 CI。
 *
 *   node scripts/dev-server.mjs 8xxx dist &          # 正式包就行；npx vite 的开发服务器也行
 *   node scripts/check-coach-anim.mjs http://localhost:8xxx/
 *
 * node 那一半（check-coach ⑬）量的是 style.css 的源码：.coach-glow 挂的是 glow-pulse-coach、减弱动态效果时换成静止光晕。这一道
 * 量浏览器里**实际生效**的：每一枚 .coach-glow 的 getComputedStyle(el).animationName 里有 glow-pulse-coach（翻面还没落地的那几枚，
 * 呼吸灯接在行内动画列表最后，所以认「含」不认「等于」）；减弱动态效果时一个动画都没有、filter 里有 drop-shadow。
 *
 * 方案写的是「vite 开发服务器＋手摆盘面」：头一局小球一开局 A 就亮（10-29 起 A 也亮一组），用不着手摆，所以正式包也能跑。
 * 夹具同 check-coach-budget：只写语言和 slides_cvd_offer，什么「看过」「打过」都不预设（不然教学条不出）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.log('用法: node scripts/check-coach-anim.mjs <服务器地址>');
  process.exit(1);
}
let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const reduce of [false, true]) {
  const tag = reduce ? '减弱动态效果' : '正常动效';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => {
    try {
      if (sessionStorage.getItem('ca_primed') !== '1') {
        sessionStorage.setItem('ca_primed', '1');
        localStorage.clear();
      }
      localStorage.setItem('slides_lang', 'zhHans');
      localStorage.setItem('slides_cvd_offer', '1');
    } catch {
      /* 无痕 */
    }
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#homeGrid [data-card="circle"]', { timeout: 30000 });
  await page.$eval('#homeGrid [data-card="circle"]', (e) => e.click());
  await page.waitForFunction(() => !document.querySelector('#startOverlay.show') && document.querySelectorAll('#boardWrap .coach-glow').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(reduce ? 300 : 1200);
  const lit = await page.$$eval('#boardWrap .coach-glow', (els) => els.map((e) => {
    const cs = getComputedStyle(e);
    return { anim: cs.animationName, filter: cs.filter };
  }));
  check(`${tag}：头一局小球一开局（A）就有亮着的`, lit.length > 0, `${lit.length} 枚`);
  if (reduce) {
    check(`${tag}：每一枚都没有动画（animationName 是 none）`, lit.every((x) => x.anim === 'none'), [...new Set(lit.map((x) => x.anim))].join(' / '));
    check(`${tag}：每一枚的 filter 里有 drop-shadow（静止光晕）`, lit.every((x) => /drop-shadow/.test(x.filter)), [...new Set(lit.map((x) => x.filter))].join(' / ').slice(0, 160));
  } else {
    check(`${tag}：每一枚实际生效的动画里有 glow-pulse-coach`, lit.every((x) => x.anim.split(',').map((a) => a.trim()).includes('glow-pulse-coach')),
      [...new Set(lit.map((x) => x.anim))].join(' / '));
  }
  check(`${tag}：一路没有页面报错`, errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} 条没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
