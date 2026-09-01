/**
 * 主菜单和它弹出来的那几个选择窗口。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-menu.mjs http://localhost:8815/
 *
 * 三件都是「不会报错，只会长得不对」的那种毛病，所以逐条量：
 *   · 换进来的 SVG 文件带着自己的 width/height，会压过 CSS 的 aspect-ratio，
 *     图标被拉成竖长条、选项散得满屏——放一个新文件进去就可能复发。
 *   · 窗口开着的时候，点在不是选项的地方应该是「我不选了」，不是开一局。
 *   · 从游戏里退回主菜单，位置应该还在刚才那儿。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
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
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.waitForTimeout(400);

// ---- 1. 尺寸由 CSS 定的那些图标，自己不许带 width/height -------------------
//
// 只查这几处的直接子 svg：它们的 CSS 只写了宽 + aspect-ratio，高度是算出来
// 的，所以文件上多一个 height 属性就会把比例顶掉。天才招牌不在此列——它外面
// 那层 span 宽高都写死了，属性压根轮不上。
const SIZED_BY_CSS = '.home-icon-btn > svg, .center-pick-opt > svg, .start-mark > svg, .start-mark-art > svg';
const sized = await page.$$eval(SIZED_BY_CSS, (els) =>
  els.filter((e) => e.hasAttribute('width') || e.hasAttribute('height'))
     .map((e) => e.getAttribute('width') + '×' + e.getAttribute('height')),
);
check('图标的尺寸交给 CSS，SVG 自己不带 width/height', sized.length === 0, sized.join(', '));

// ---- 2. 计时那三只秒表：一样大，挨在一起 ----------------------------------
await page.$$eval('.home-icon-btn--timed', (els) => els[0].click());
await page.waitForSelector('.center-pick-opt', { timeout: 8000 });
await page.waitForTimeout(1000); // 等飞入和散开都停下来
const boxes = await page.$$eval('.center-pick-opt', (els) =>
  els.map((e) => {
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  }),
);
check('计时弹窗里是三只表', boxes.length === 3, `看到 ${boxes.length} 个`);
check('三只一样大，而且是方的',
  boxes.every((b) => b.w === boxes[0].w && Math.abs(b.h - b.w) <= 1),
  JSON.stringify(boxes.map((b) => `${b.w}×${b.h}`)));
const span = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
check('三只挨在一起，没散开一屏', span <= boxes[0].h * 2 + 40, `上下共 ${span}px`);

// ---- 3. 点在不是选项的地方 = 不选了 ---------------------------------------
await page.mouse.click(195, 800);
await page.waitForTimeout(700);
const afterTap = await page.evaluate(() => ({
  picker: !!document.querySelector('.center-pick'),
  menu: !!document.querySelector('.home-page'),
  game: !!document.querySelector('.app--game'),
  dimmed: !!document.querySelector('.home-dimmed'),
}));
check('点空白处窗口关掉，回到主菜单', afterTap.picker === false && afterTap.menu === true, JSON.stringify(afterTap));
check('而且没有顺手开起一局来', afterTap.game === false);
check('背景的淡化也一并撤掉', afterTap.dimmed === false);

// ---- 4. 主菜单记得刚才翻到哪儿了 -------------------------------------------
await page.evaluate(() => window.scrollTo(0, 420));
await page.waitForTimeout(300);
const before = await page.evaluate(() => window.scrollY);
await page.$$eval('.home-icon-btn', (els) => els[0].click());
await page.waitForSelector('#startOverlay.show', { timeout: 15000 });
await page.waitForTimeout(250);
await page.click('#startBackBtn');
await page.waitForSelector('.home-page', { timeout: 8000 });
await page.waitForTimeout(600);
const after = await page.evaluate(() => window.scrollY);
check('从一局里退出来，主菜单还停在刚才那儿', Math.abs(after - before) <= 4, `${before} → ${after}`);

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
