/**
 * 成绩与说明那一屏：底下那颗橙色的键，和收起来的成绩。
 *
 *   npm run build:xhs && node xhs/preview.mjs && node xhs/check-profile.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 玩家点名的两件事，都是「看着对不对」，而看着对不对最容易在改别的东西时被
 * 顺手弄坏，又不会有任何报错：
 *
 *   · **那颗键要一直在同一个位置。** 从前这一页底下是一颗会跟着内容滚的
 *     《返回》圆盘（.page-back），滑到哪儿它跟到哪儿；玩家要的是主菜单上那
 *     颗橙色的键原样留着——钉在屏幕上不动，再按一下回主菜单，按下去亮一下。
 *   · **成绩只摆最近 5 场。** 从前是一股脑全摆：打过三十局的人，底下那段介
 *     绍被顶得很远，要一直滑才看得见。
 *
 * 外加一条只有老内核上才出事的：点开成绩那一层时底排要收起来。网页版靠
 * `body:has(.center-pick--back) .home-nav` 让位，而 **Chrome 61 不认得
 * :has()**，整条会被丢掉——《返回》圆盘和那颗橙色的键就叠在一起了。所以这
 * 一版改成认类（.xhs-modal），这里量的是那个类真的起了作用。
 *
 * 存档是自己塞进去的九局假记录：不塞就永远是「还没有记录」那一屏，
 * 「只摆 5 场」这条根本量不到。
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(here, 'preview.html')).href;
let fails = 0;
const say = (ok, t, x = '') => { if (!ok) fails++; console.log((ok ? '  PASS  ' : '  FAIL  ') + t + (x ? '  ' + x : '')); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** @param old 强制走 Chrome 61 降级层 */
async function open(old = false) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  if (old) await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  await ctx.addInitScript(() => {
    try {
      // 跳过「头一回打开」那一局，直接是主菜单。
      localStorage.setItem('slides.xhs.firstRun', '1');
      localStorage.setItem('slides.xhs.story.circle', '1');
      // 九局假记录，摊在两本存档里（键名见 shapes/*.ts 的 bestKey，
      // 后缀见 engine/persistence.ts 的 RUNS_SUFFIX）。
      const mk = (i, id) => {
        const at = Date.now() - i * 86400000;
        return { at, data: { shapeId: id, shapeFallback: id, modeKey: '', totalScore: 900 - i * 37, at } };
      };
      const a = [], b = [];
      for (let i = 0; i < 9; i++) (i % 2 ? b : a).push(mk(i, i % 2 ? 'square' : 'circle'));
      localStorage.setItem('sugarcube_circles_best::runs', JSON.stringify(a));
      localStorage.setItem('sugarcube_best::runs', JSON.stringify(b));
    } catch {
      /* 存不进去这一台就量不成，下面自己会红 */
    }
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(PAGE);
  await p.waitForSelector('.home-icon-btn', { timeout: 40000 });
  return { ctx, p, errs };
}

// ---- 1. 那颗橙色的键 ----
{
  const { ctx, p, errs } = await open();
  say(!(await p.$('.home-nav-btn--active')), '主菜单上那颗键是暗着的（这一页不是它）');
  await p.click('#xhsProfile');
  await p.waitForTimeout(900);
  say(!!(await p.$('.xhs-profile .home-nav')), '信息栏底下留着那颗橙色的键');
  say(!!(await p.$('.home-nav-btn--active')), '在信息栏里它亮着——再按一下就是收起来');
  say(!(await p.$('#xhsProfileBack')), '从前那颗会跟着滚的《返回》圆盘已经撤掉');
  const pos = await p.$eval('.xhs-profile .home-nav', (e) => getComputedStyle(e).position);
  say(pos === 'fixed', '它钉在屏幕上', pos);
  const before = await p.$eval('#xhsProfile', (e) => e.getBoundingClientRect().top);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(400);
  const after = await p.$eval('#xhsProfile', (e) => e.getBoundingClientRect().top);
  say(Math.abs(before - after) < 1, '上下滑动它不动', `${Math.round(before)} → ${Math.round(after)}`);
  const gap = await p.evaluate(() => {
    const about = document.querySelector('.xhs-about').getBoundingClientRect();
    const nav = document.querySelector('.home-nav-dock').getBoundingClientRect();
    return Math.round(nav.top - about.bottom);
  });
  say(gap >= 0, '滑到底时它没压住那段说明', gap + 'px');
  // 按下去亮一下。动画是从 pointerdown 起的，不等 click——这一下往往同时换屏。
  await p.$eval('#xhsProfile', (e) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  const anim = await p.$eval('.xhs-profile .home-nav-art', (e) => e.getAnimations().map((a) => a.animationName || '').join(','));
  say(anim.indexOf('xhs-nav-breath') >= 0, '按下去亮一下的动画挂上了', anim || '（一个都没有）');
  await p.click('#xhsProfile');
  await p.waitForTimeout(800);
  say(!!(await p.$('.home-icon-btn')), '再按一下：回主菜单');
  say(errs.length === 0, '这一路零报错', errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- 2. 成绩收起来，点开看全部 ----
for (const old of [false, true]) {
  const tag = old ? '（强制降级层）' : '';
  const { ctx, p, errs } = await open(old);
  await p.click('#xhsProfile');
  await p.waitForTimeout(900);
  const rows = await p.$$eval('#xhsRuns .records-row', (e) => e.length);
  say(rows === 5, `缩略面板只摆最近 5 场${tag}`, rows + ' 条');
  await p.$eval('#xhsRuns', (e) => e.click());
  await p.waitForTimeout(900);
  const big = await p.$$eval('.center-pick .records-row', (e) => e.length);
  say(big === 9, `点开那一层摆的是全部 9 场${tag}`, big + ' 条');
  const scrolls = await p.$eval('.records-panel--big', (e) => e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY === 'auto');
  say(scrolls, `那一层滑得动${tag}`);
  const clash = await p.evaluate(() => {
    const panel = document.querySelector('.records-panel--big').getBoundingClientRect();
    const foot = document.querySelector('.center-pick-back').getBoundingClientRect();
    return Math.round(foot.top - panel.bottom);
  });
  say(clash >= 0, `《返回》圆盘不压在那一层上${tag}`, clash + 'px');
  say(
    (await p.$eval('.home-nav', (e) => getComputedStyle(e).display)) === 'none',
    `那一层开着的时候底排收起来${tag}——认的是类不是 :has()`,
  );
  await p.$eval('.center-pick-back', (e) => e.click());
  await p.waitForTimeout(700);
  say((await p.$eval('.home-nav', (e) => getComputedStyle(e).display)) !== 'none', `关掉之后那颗键回来了${tag}`);
  // 点一行：那一层要自己先关掉，不然它盖在战绩图上头（它挂在 <body> 上，不
  // 跟着 #app 一起被换掉）。
  await p.$eval('#xhsRuns', (e) => e.click());
  await p.waitForTimeout(700);
  await p.$eval('.center-pick .records-row', (e) => e.click());
  await p.waitForTimeout(900);
  say(!(await p.$('.center-pick')), `点一行看那一局：那一层先关掉了${tag}`);
  say(errs.length === 0, `这一路零报错${tag}`, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
