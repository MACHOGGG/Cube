/**
 * 分镜动画教学的体检台：该弹的弹、不该弹的不弹、弹过一次就不再弹。
 *
 *   npm run check:story
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 教学是这一版少数几处「有状态」的东西——它记着你看过没有。这类东西最容易
 * 出的两种错，一种比一种难发现：
 *
 *   · **该弹的不弹**。第一次玩的人直接掉进棋盘，不知道怎么滑。这一条只有
 *     用一台干净的设备才试得出来——自己开发时早就看过了，localStorage 里那
 *     一格一直是 1，怎么点都不会再弹。
 *   · **不该弹的弹了**。炸弹、老虎机、无限反转前面插一段「这个形状怎么玩」，
 *     是把人从他自己的节奏里拽出来。这一条更隐蔽：功能都是好的，只是烦。
 *
 * 所以每一条都用一个全新的浏览器上下文跑（localStorage 是空的），一条一条
 * 点过去。顺带核三件事：这一屏确实**一个字都没有**（玩家定的「纯动画」）、
 * 下面那四颗键和网页版一样、六条规则那一屏没有跟着自动跳出来。
 *
 * 最后在强制降级层下再跑一遍——这一屏是网页版原件，不是我画的，它在
 * Chrome 61 上塌不塌得看过才算数。
 *
 * 跑之前要先出一次包和预览页：
 *
 *   npm run build:xhs && node xhs/preview.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(here, 'preview.html')).href;
let fails = 0;
const say = (ok, t, x = '') => { if (!ok) fails++; console.log((ok ? '  PASS  ' : '  FAIL  ') + t + (x ? '  ' + x : '')); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function open(old = false) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (old) await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(PAGE);
  await p.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}
const card = (p, i) => p.$$eval('.home-icon-btn', (e, k) => e[k].click(), i);
const has = (p, sel) => p.$(sel).then((e) => !!e);

// ---- 1. 第一次开方块：该弹方块那一段 ----
{
  const { ctx, p, errs } = await open();
  await card(p, 0);
  await p.waitForTimeout(1500);
  say(await has(p, '.story-tut'), '第一次开《经典方块》：分镜动画弹出来了');
  const ctl = await p.$$eval('.story-controls .story-ctl', (e) => e.map((b) => b.getAttribute('aria-label')));
  say(JSON.stringify(ctl) === '["上一条","再一次","下一条","完成"]', '下方四颗键和网页版一样', JSON.stringify(ctl));
  const segs = await p.$$eval('.story-prog-seg', (e) => e.length);
  say(segs > 0, '顶上的分段进度条在', segs + ' 段');
  const sq = await p.$$eval('.story-board .story-cell svg rect', (e) => e.length);
  const ci0 = await p.$$eval('.story-board .story-cell svg circle', (e) => e.length);
  // 方块那一段里也会出现两个圆——最后一条消除之后换的是「小球消失」那一帧
  // （网页版有意为之）。所以判据是「方块占压倒多数」，不是「一个圆都没有」。
  say(sq > 0 && sq > ci0 * 3, '弹的是方块那一段（棋盘上画的是圆角方块）', `方块 ${sq} 个 / 圆 ${ci0} 个`);
  const words = await p.$eval('.story-tut', (e) => (e.textContent || '').trim());
  say(words === '', '这一屏没有一个字（纯动画）', words ? `出现了「${words.slice(0, 30)}」` : '');
  say(!(await has(p, '.xhs-tut')), '六条规则那一屏没有自动跳出来');

  // 按《完成》→ 进这一局
  await p.click('#stFinish');
  await p.waitForTimeout(1800);
  say(await has(p, '.start-stage'), '按《完成》之后进了开局页');
  say(errs.length === 0, '这一路零报错', errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- 2. 同一台设备再开一次方块：不该再弹 ----
{
  const { ctx, p } = await open();
  await ctx.addInitScript('');
  await p.evaluate(() => localStorage.setItem('slides.xhs.story.square', '1'));
  await p.reload();
  await p.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await p.waitForTimeout(800);
  await card(p, 0);
  await p.waitForTimeout(1500);
  say(!(await has(p, '.story-tut')), '看过之后再开方块：不再弹');
  say(await has(p, '.start-stage'), '直接到开局页');
  await ctx.close();
}

// ---- 3. 第一次开小球：该弹小球那一段 ----
{
  const { ctx, p } = await open();
  await card(p, 1);
  await p.waitForTimeout(1500);
  say(await has(p, '.story-tut'), '第一次开《经典小球》：分镜动画弹出来了');
  // 分镜的棋子是 SVG：球画成 <circle>，方块画成 <rect>（storyTutorial 的
  // cellSvg）。所以「有圆、没有方」就是「弹的确实是小球那一段」。
  const ci = await p.$$eval('.story-board .story-cell svg circle', (e) => e.length);
  const rc = await p.$$eval('.story-board .story-cell svg rect', (e) => e.length);
  say(ci > 0 && rc === 0, '弹的是小球那一段（棋盘上画的是圆）', `圆 ${ci} 个 / 方块 ${rc} 个`);
  await ctx.close();
}

// ---- 4. 炸弹 / 老虎机 / 无限反转：都不该弹 ----
for (const [i, name, pick] of [[2, '炸弹', true], [3, '老虎机', true], [4, '无限反转', true]]) {
  const { ctx, p } = await open();
  await card(p, i);
  await p.waitForTimeout(1200);
  say(!(await has(p, '.story-tut')), `点开《${name}》：不弹分镜动画`);
  if (pick) {
    const sq = await p.$('[data-family="square"]');
    if (sq) {
      await sq.click();
      await p.waitForTimeout(i === 3 ? 9500 : 1200);
      say(!(await has(p, '.story-tut')), `《${name}》挑完方块开局：还是不弹`);
    }
  }
  await ctx.close();
}

// ---- 5. 两个手动入口还在 ----
{
  const { ctx, p } = await open();
  await p.click('#xhsProfile');
  await p.waitForTimeout(1000);
  say(await has(p, '.xhs-how'), '成绩与说明页上那颗《怎么玩》还在');
  await p.click('.xhs-how');
  await p.waitForTimeout(800);
  const n = await p.$$eval('.xhs-tut .tut-rule', (e) => e.length).catch(() => 0);
  say(n === 6, '点开是六条规则（有字有配图）', n + ' 条');
  await ctx.close();
}
{
  const { ctx, p } = await open();
  await p.evaluate(() => localStorage.setItem('slides.xhs.story.square', '1'));
  await p.reload();
  await p.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await p.waitForTimeout(800);
  await card(p, 0);
  await p.waitForTimeout(1200);
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.click('#stopBtn');
  await p.waitForTimeout(900);
  const btns = await p.$$eval('#pauseOverlay .modal button', (e) => e.map((b) => (b.textContent || '').trim()));
  say(btns.indexOf('怎么玩') >= 0, '暂停面板里那颗《怎么玩》还在', JSON.stringify(btns));
  await ctx.close();
}

// ---- 6. 老内核上也跑得起来 ----
{
  const { ctx, p, errs } = await open(true);
  await card(p, 0);
  await p.waitForTimeout(2000);
  say(await has(p, '.story-tut'), '强制降级层：分镜动画照样弹得出来');
  const box = await p.$eval('.story-tut', (e) => {
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
  });
  say(box.right <= 391, '没有横着顶出屏幕', JSON.stringify(box));
  const bd = await p.$eval('.story-board', (e) => {
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }).catch(() => ({ w: 0, h: 0 }));
  say(bd.w > 40 && bd.h > 40, '棋盘画出来了（不是塌成 0）', JSON.stringify(bd));
  await p.waitForTimeout(3000);
  say(errs.length === 0, '老内核上零报错', errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
