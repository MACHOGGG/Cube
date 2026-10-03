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
 * 点过去，顺带核五条规则那一屏没有跟着自动跳出来。
 *
 * 第 14 推起分镜动画整个下线了（那两段还在教旧规则）：这一台从「该弹的弹」变成
 * 「哪儿都不弹、连手动的入口也没有」——《怎么玩》上不再摆分镜键。最后在强制降级层
 * 下再走一遍《怎么玩》，看那一屏在 Chrome 61 上立不立得起来。
 *
 * 跑之前要先出一次包和预览页：
 *
 *   npm run build:xhs && node xhs/preview.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensurePreview } from './ensurePreview.mjs';


// 读的是产物 preview.html，它不提交、也不会自己重出——过期了就在这儿重出一次
// （理由在 ensurePreview.mjs 的文件头：不这么做，这道门会在旧样式上全绿）。
ensurePreview();
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
// 跳过最上面那张《每日挑战》（第 19 推）：这儿按下标点的是玩法卡，下标从方块数起。
const card = (p, i) => p.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (e, k) => e[k].click(), i);
const has = (p, sel) => p.$(sel).then((e) => !!e);

// ---- 1. 第一次开方块：分镜不再自己弹出来 ----
//
// 玩家定的：网页端和小红书端都不再主动播放这段动画。它是一段没有互动的片
// 子，把刚决定要玩的人挡在门外；规矩改由棋盘底下那块教学条一条一条讲。片子
// 后来连手动入口也撤了（第 14 推：还在教旧规则，见段 5）。
{
  const { ctx, p, errs } = await open();
  await card(p, 0);
  await p.waitForTimeout(1500);
  say(!(await has(p, '.story-tut')), '第一次开《经典方块》：不再自己弹分镜');
  say(await has(p, '.start-stage'), '直接到开局页');
  say(!(await has(p, '.howto-ov')), '五条规则那一屏也没有自动跳出来');
  say(errs.length === 0, '这一路零报错', errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- 2. 看过分镜的设备再开方块：一样直接进局 ----
{
  const { ctx, p } = await open(false, true);
  await card(p, 0);
  await p.waitForSelector('.start-stage', { timeout: 20000 }).catch(() => {});
  say(!(await has(p, '.story-tut')), '看过之后再开方块：不弹');
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

// ---- 5. 《怎么玩》还在，分镜那个手动入口撤了 ----
{
  const { ctx, p } = await open();
  await p.click('#xhsProfile');
  await p.waitForTimeout(1000);
  say(await has(p, '.xhs-how'), '成绩与说明页上那颗《怎么玩》还在');
  await p.click('.xhs-how');
  await p.waitForTimeout(800);
  const n = await p
    .$$eval('.howto-ov .tut-rule:not(.tut-rule--extra)', (e) => e.length)
    .catch(() => 0);
  // 五条，不是六条：教学 2026-09 改成玩家亲笔的五条（i18n 的 TUTORIAL_RULES）。
  say(n === 5, '点开是五条规则（有字有配图）', n + ' 条');
  // 五条底下还有一节：炸弹和无限反转各自加的那一层，隔着一道圆角黑线。那两
  // 句原本只在头一回进那个玩法时出现，玩家要能随时回头看（他定的）。
  const extra = await p
    .$$eval('.howto-ov .tut-rule--extra .tut-rule-text', (e) => e.map((x) => x.textContent.trim()))
    .catch(() => []);
  say(extra.length === 2, '底下还有炸弹和无限反转那两条', extra.length + ' 条');
  say(
    extra.every((t) => t.length > 10),
    '那两条都有字',
    extra.map((t) => t.slice(0, 12)).join(' / '),
  );
  say(await has(p, '.howto-ov .howto-split'), '中间隔着那道圆角黑线');

  // 五条规则上头从前摆着两颗分镜键（方块 / 小球），那是分镜动画唯一的入口。第 14 推
  // 那两段下线了（还在教旧规则，方案定的是「直接下线入口，不重做」），所以这里量的是
  // 「一颗都没有」，而且按《知道了》就回成绩与说明页。
  const stories = await p.$$eval('.howto-story', (e) => e.length);
  say(stories === 0, '五条上头不再摆分镜键（第 14 推下线）', stories + ' 颗');
  await p.click('#howtoOkBtn');
  await p.waitForTimeout(800);
  say(!(await has(p, '.howto-ov')) && (await has(p, '.xhs-how')), '按《知道了》回成绩与说明页');
  say(!(await has(p, '.story-tut')), '一路上分镜动画一次都没出现');
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
  // 收成一行再比：那颗《怎么玩》右边还挂着一个「〉」（面板改版之后加的，见
  // gameShell 里 .pause-chev 那段），textContent 里于是夹着换行和缩进。
  const btns = await p.$$eval('#pauseOverlay .modal button', (e) =>
    e.map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()),
  );
  say(btns.some((x) => x.indexOf('怎么玩') === 0), '暂停面板里那颗《怎么玩》还在', JSON.stringify(btns));
  // 面板改版之后这一层里的四件事（玩家定的顺序）：教学、色盲友好、再来一局、
  // 结束游戏，最后一颗《继续》回棋盘。
  //
  // **正好五颗，多一颗也不行。** 网页版 2026-09 在色盲那一行旁边加了一颗《Pro》
  // （棋盘上描出「这一枚会变成什么颜色」），那是完整版的东西——这一版玩家定了
  // 「无 pro 模式」，所以 xhs/src/main.ts 挂完之后把那一行整行摘掉。这一条就是那
  // 件事的看门人：它红过一次，红的正是那颗漏进来的 Pro。
  say(
    btns.length === 5 &&
      btns[1].indexOf('色盲') === 0 &&
      btns[2] === '再来一局' &&
      btns[3] === '结束游戏' &&
      btns[4] === '继续',
    '面板里就是那四件事 + 一颗《继续》',
    JSON.stringify(btns),
  );
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
//
// 从前这一段从《怎么玩》点进分镜、量它在 Chrome 61 上塌不塌。分镜第 14 推下线了，
// 老内核这一趟改量它现在唯一剩下的东西：《怎么玩》那一屏五条规则连配图（老内核
// 上的逐盒对照在 check-oldcss 里，这里只管「立得起来、没有分镜键、零报错」）。
{
  const { ctx, p, errs } = await open(true);
  await p.click('#xhsProfile');
  await p.waitForTimeout(1000);
  await p.click('.xhs-how');
  await p.waitForTimeout(900);
  const how = await p.evaluate(() => ({
    rules: document.querySelectorAll('.howto-ov .tut-rule:not(.tut-rule--extra)').length,
    arts: document.querySelectorAll('.howto-ov .tut-rule:not(.tut-rule--extra) .tut-rule-art').length,
    story: document.querySelectorAll('.howto-story').length,
    right: Math.round((document.querySelector('.howto-modal') || document.body).getBoundingClientRect().right),
  }));
  say(how.rules === 5 && how.arts === 5, '强制降级层：《怎么玩》五条规则连配图都在', JSON.stringify(how));
  say(how.story === 0, '强制降级层：也没有分镜键');
  say(how.right <= 391, '没有横着顶出屏幕', String(how.right));
  await p.waitForTimeout(1500);
  say(errs.length === 0, '老内核上零报错', errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
