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

/**
 * @param old   强制走 Chrome 61 降级层
 * @param seen  这台设备「方块那一段已经看过」——从前是先开页面、evaluate 写
 *   一格 localStorage、再 reload。那一手在满负荷跑整套门禁时会掉：reload 有
 *   时换了一个渲染进程，刚写下的那一格还没落到存储后端，新进程读回来是空
 *   的，于是方块的分镜又弹了一次，量出来就是「看过之后再开方块：不再弹」
 *   莫名其妙地红。改成开页面之前就把那一格塞进去，一次加载定死，不再有中间
 *   那次 reload。
 */
async function open(old = false, seen = false) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (old) await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  if (seen) await ctx.addInitScript("try { localStorage.setItem('slides.xhs.story.square', '1'); } catch (e) {}");
  // 「头一回打开」那一条单独在最底下量。这里每一条量的是「点开某张卡该不该
  // 弹分镜」，铺的是**走过头一回之后**那台设备的真实状态：头一回那一局会把
  // 小球那把钥匙一起记上（main.ts 的 firstScreen 里 markStorySeen('circle')），
  // 所以两格都塞。只塞 firstRun 的话，量到的是一个玩家永远走不到的状态。
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('slides.xhs.firstRun', '1');
      localStorage.setItem('slides.xhs.story.circle', '1');
    } catch {
      /* 存不进去也不影响这一台：它只是想跳过头一回那一屏 */
    }
  });
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
  const { ctx, p } = await open(false, true);
  await card(p, 0);
  await p.waitForSelector('.start-stage', { timeout: 20000 }).catch(() => {});
  say(!(await has(p, '.story-tut')), '看过之后再开方块：不再弹');
  say(await has(p, '.start-stage'), '直接到开局页');
  await ctx.close();
}

// ---- 3. 开小球：分镜一律不放 ----
//
// 玩家定的：头一回进来直接落进小球那一局，规矩靠棋盘底下那块教学条讲，小球
// 那段分镜从此不再出现——他已经边玩边学过一遍了。所以这里量的是「不弹」。
{
  const { ctx, p } = await open();
  await card(p, 1);
  await p.waitForSelector('.start-stage', { timeout: 20000 }).catch(() => {});
  say(!(await has(p, '.story-tut')), '开《经典小球》：不再弹分镜（头一局里已经学过）');
  say(await has(p, '.start-stage'), '直接到开局页');
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
  const { ctx, p } = await open(false, true);
  await card(p, 0);
  // 开局键是藏起来的（gameShell 的 .start-hidden-go），所以只等它「挂上来」，
  // 不等它「看得见」——等看得见会一直等到超时。
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 20000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.click('#stopBtn');
  await p.waitForTimeout(900);
  const btns = await p.$$eval('#pauseOverlay .modal button', (e) => e.map((b) => (b.textContent || '').trim()));
  say(btns.indexOf('怎么玩') >= 0, '暂停面板里那颗《怎么玩》还在', JSON.stringify(btns));
  await ctx.close();
}

// ---- 5.5 头一回打开：不落主菜单，也不放分镜，直接开一局小球 ----
//
// 这一条要的正是上面 open() 特意跳过的那一屏，所以在这儿自己开一台全新的
// 浏览器上下文——localStorage 一格都没有，和玩家头一次点进小工具一样。
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(PAGE);
  await p.waitForSelector('.start-stage', { timeout: 40000 }).catch(() => {});
  say(!(await has(p, '.home-icon-btn')), '头一回打开：主菜单没有先闪一下');
  say(!(await has(p, '.story-tut')), '头一回打开：不放分镜动画');
  say(await has(p, '.start-stage'), '头一回打开：直接是小球那一局的开局页');
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .ball').length > 0, { timeout: 40000 });
  await p.waitForTimeout(900);
  const balls = await p.$$eval('#boardWrap .ball', (e) => e.length);
  say(balls > 0, '摆的确实是小球', balls + ' 颗');
  say(await has(p, '.coach-bar'), '棋盘底下那块教学条在');
  say(
    (await p.evaluate(() => localStorage.getItem('slides.xhs.story.circle'))) === '1',
    '小球那把钥匙记成了「看过」——以后自己点开也不会再弹',
  );
  say(errs.length === 0, '这一路零报错', errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- 5.6 第二回打开：这才是主菜单 ----
{
  const { ctx, p } = await open();
  say(await has(p, '.home-icon-btn'), '第二回打开：直接是主菜单');
  say(!(await has(p, '.story-tut')), '第二回打开：不再按进那一局');
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
