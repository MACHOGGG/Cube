/**
 * 头一回打开这个网站的那条路，从头走一遍。
 *
 *   node scripts/dev-server.mjs 8976 dist
 *   node scripts/check-first-play.mjs http://localhost:8976/
 *   node scripts/check-first-play.mjs http://localhost:8977/ 1440x900   ← 电脑宽屏整套再跑一遍
 *
 * （两遍各要一台自己的服务器：三角那一节要兑一张 TESTMONTH，一台服务器里一张码只兑得动
 * 一次。）
 *
 * 盯着玩家 2026-09 点名的四件事：
 *
 *   · 软锁——一局都没打过时，主菜单上只有《基础方块》和《基础小球》按得开；
 *     按到别的卡，那两张抖一下、光更亮一档，靠下的还会冒一个上滑箭头。打完
 *     第一局锁就永远撤掉。
 *   · 教学条——他玩的第一个基础玩法从第 1 条讲起，五段进度（2026-10 第二轮从四段改
 *     的，一步一条），第 1 条说的是
 *     「色块得分后会变成星星」。
 *
 *     四段不是五段：规则改成五条之前那六条里，第 6 条（综合得分）挪去了结算页，第 1、2 条
 *     按玩家的要求并成了一步（「第一第二条教学内容在进度条上合并为一条」，
 *     下面那条断言验的就是这一步摆着两条）。进度条一段一步，不是一段一条。
 *   · 三角——得分变成星星之后，那圈灰色圆角边框一直在（和消掉之后的空三角
 *     同一圈）。
 *
 * 这支脚本每一段都从 localStorage.clear() 重新做人，所以顺序无关，单跑也行。
 *
 * **主菜单上那几下为什么不用 `page.click()`。** 手机竖屏的主菜单 2026-09 改成了
 * 鱼眼轴（ui/modeAxis.ts）：十四张卡是绝对定位的，一次只有中间那几张在屏幕上，
 * 别的在视口外几百像素处待着。Playwright 的 `click()` 会先「滚动到可见」再按，
 * 而轴是自己管位置的（滚不动），于是它一直等到超时——门红的不是代码，是这把尺
 * 子。改成在页面里直接 `el.click()`：合成的这一下照样冒泡到轴和首玩期那道拦截
 * 上，量的还是同一件事。（check-knowhow 先踩过同一个坑。）
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8976/';
/**
 * 屏幕多大。默认手机竖屏；给 `1440x900` 就整套在电脑宽屏上跑一遍（第 14 推：宽屏那一
 * 版的炸弹卡漏了首玩锁，而这道门从前只在手机上跑，量不到）。
 */
const [VW, VH] = (process.argv[3] || '390x844').split('x').map(Number);
const WIDE = VW >= 1000;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };
console.log(`（${VW}×${VH}${WIDE ? '，电脑宽屏' : ''}）`);
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, isMobile: !WIDE, hasTouch: !WIDE });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
// 全新的人：只定语言，别的一格不填
await page.addInitScript(() => localStorage.setItem('slides_lang', 'zhHans'));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

// ── 软锁 ──────────────────────────────────────────────────────────────
/*
 * 去重：主菜单那条带子把内容摆了两份（无缝循环靠的就是这个），两张发光的
 * 卡于是各有一个分身。不去重的话这儿数出四张——不是多了两张能玩的。
 */
const glow = await page.$$eval('.home-icon-btn--glow', (bs) =>
  [...new Set(bs.map((b) => b.getAttribute('aria-label')))]);
check('新人进来：只有方块和小球两张亮着', glow.length === 2 && glow.includes('经典方块') && glow.includes('经典小球'), JSON.stringify(glow));

await page.$eval('.home-icon-btn[aria-label^="老虎机"]', (e) => e.click());
await page.waitForTimeout(260);
const after = await page.evaluate(() => ({
  onMenu: !!document.querySelector('.home-page'),
  nudging: document.querySelectorAll('.home-icon-btn--nudge').length,
  hint: !!document.querySelector('.home-up-hint--in'),
}));
check('按到锁着的玩法：人还在主菜单，没进去', after.onMenu, JSON.stringify(after));
check('两张基础卡抖起来了', after.nudging === 2, String(after.nudging));
/*
 * 指路的那个箭头。
 *
 * 窄版 2026-09 第十轮换成了一条横着跑的带子，能玩的那两张不再在「上面」
 * 而是在左边或右边，所以量的不再是「是不是上箭头」，是「有没有指路」。
 * 下一条接着量方向对不对——只看「有」的话，指错边也能蒙混过关。
 */
check('按不开的那一下，冒出了指路的箭头', after.hint === true, JSON.stringify(after));
const arrow = await page.evaluate(() => {
  const h = document.querySelector('.home-up-hint--in');
  if (!h) return null;
  // 带子是无缝循环的，能玩的那两张上下都可能：取离屏心最近的那一个比。
  const mid = window.innerHeight / 2;
  let nearest = null, best = Infinity;
  for (const el of document.querySelectorAll('[data-first-playable="1"]')) {
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < best) { best = d; nearest = r; }
  }
  const locked = document.querySelector('.home-icon-btn[aria-label^="老虎机"]').getBoundingClientRect();
  return { cls: h.className, playableAboveLocked: nearest.top < locked.top };
});
check(
  '而且指的是能玩的那一头',
  !!arrow && arrow.cls.includes(arrow.playableAboveLocked ? '--up' : '--down'),
  JSON.stringify(arrow),
);

// ── 炸弹那一块（第 14 推）──────────────────────────────────────────────
//
// 宽版（电脑、横屏）上它不是 .home-icon-btn，是一整块 .home-bomb-card；首玩锁那道拦截
// 从前只认前者，于是电脑上一局都没打过的人照样点得开炸弹的档位窗。窄版上它是
// .home-icon-btn.home-bomb-mini，本来就拦得住——两种都量：哪一种在这块屏幕上就点哪一种。
// 10-08 方案 3-G 起档位不再是一扇窗，是一整页（.bomb-page）；「没开」两样都认。
{
  const kind = await page.evaluate(() =>
    document.querySelector('.home-bomb-card') ? 'card' : document.querySelector('.home-bomb-mini') ? 'mini' : null);
  check(`（尺子）这块屏幕上的炸弹是${WIDE ? '宽版那一整块（.home-bomb-card）' : '窄版那一颗'}`,
    WIDE ? kind === 'card' : kind === 'mini', String(kind));
  // 先把上面按老虎机那一下留下的抖动摘掉——不摘的话「抖起来了」量到的是上一下的，
  // 锁没拦住也照样是 2（反证时真这么绿过一次）。
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('.home-icon-btn--nudge')) b.classList.remove('home-icon-btn--nudge');
  });
  await page.$eval('.home-bomb-card, .home-bomb-mini', (e) => e.click());
  await page.waitForTimeout(400);
  const bomb = await page.evaluate(() => ({
    onMenu: !!document.querySelector('.home-page'),
    picker: !!document.querySelector('.center-pick, .bomb-page'),
    nudging: document.querySelectorAll('.home-icon-btn--nudge').length,
  }));
  check('按炸弹：炸弹那一页没开，人还在主菜单（锁拦住了）', bomb.onMenu && !bomb.picker, JSON.stringify(bomb));
  check('按炸弹：两张基础卡也抖起来了', bomb.nudging >= 2, String(bomb.nudging));
}

// 玩过一局之后锁就没了
await page.evaluate(() => localStorage.setItem('slides_played_circle', '1'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$eval('.home-icon-btn[aria-label="菱形方块"]', (e) => e.click());
await page.waitForTimeout(800);
check('打过一局之后：锁撤了，点得进去', !(await page.$('.home-page')), '还在主菜单就是没撤');
check('也不再抖了', (await page.$$('.home-icon-btn--nudge')).length === 0);
// 尺子：锁撤了之后，同一下按炸弹真的开得出炸弹那一页——上面那条「没开」才是锁拦的，不是
// 这一下本来就点不着。
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$eval('.home-bomb-card, .home-bomb-mini', (e) => e.click());
const bombPage = await page.waitForSelector('.bomb-page', { timeout: 5000 }).then(() => true).catch(() => false);
check('（尺子）锁撤了之后，按炸弹开得出炸弹那一页', bombPage);

// ── 头一局的教学条 ────────────────────────────────────────────────────
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('slides_lang', 'zhHans'); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$eval('.home-icon-btn[aria-label="经典小球"]', (e) => e.click());
await page.waitForTimeout(600);
if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 25000 });
await page.waitForTimeout(600);
const coach = await page.evaluate(() => ({
  segs: document.querySelectorAll('.coach-seg').length,
  rows: [...document.querySelectorAll('.coach-row:not([hidden]) .coach-text')].map((e) => e.textContent.trim()),
}));
/*
 * 2026-10 第二轮：**五段，一步一条**（玩家点名）。
 *
 * 上一版是四段、第 1 步摆两条——这两条断言钉的就是那个样子，所以那一轮改完它们当场红，
 * 而**红得对**。拆开的理由记在《侵蚀阶梯决策》第 8 推那一条：第 2 条讲的「星星还能再
 * 用」合着的时候没有自己的那一下可做，两条共用「得两次分」，而第二次得分完全可能一颗
 * 星都没碰到。第 15 推又定了「一次只显示一条」（ui/coachBar.ts 的 PLAN_STEPS），这两条
 * 断言照旧成立。
 *
 * 「一段一步」那条规矩一个字没改，只是步数从四变成五；所以这儿照旧钉死一个数，不写
 * `>= 4`——数字本身就是玩家要的那件事。
 */
check('教学条：五段进度（一段一步）', coach.segs === 5, String(coach.segs));
check('第 1 步只摆第 1 条（一步一条）', coach.rows.length === 1, JSON.stringify(coach.rows.map((t) => t.slice(0, 12))));
/**
 * 第 1 条就是玩家原话那一句，逐字对。
 *
 * 原先这儿找的是子串「变成星星」——而 2026-09 规则改成五条之后，第 1 条的原话是「色块
 * 拼出得分图案会得分翻面，**变成其他颜色的星星**」，中间多了四个字，这条断言从那天起
 * 就一直红着（这道门不在 CI 里，所以没人看见）。
 *
 * 换成逐字比而不是换一个新子串：子串改一次就要跟一次，而这五句是玩家亲笔、改一个字都
 * 要回决策文档 §8 的（check-coach 那头也是逐字钉的）。
 */
check('第 1 条就是玩家原话那一句',
  coach.rows[0] === '色块拼出得分图案会得分翻面，变成其他颜色的星星。', coach.rows[0]);

// ── 三角那圈灰边 ──────────────────────────────────────────────────────
//
// ⚠️ 这一节 2026-10 修过一次量法，记在这儿：原先点的是 `aria-label="三角"` 那张卡，而
// **基础三角 2026-09 就删掉了**（《侵蚀阶梯》v1.2 PR-6：「删三角、六边三角天才化」）。
// 于是这道门从那天起每一次都崩在 `page.$eval` 上——崩在断言跑完之前，所以它上面那十几
// 条看着全绿，而这三条一次都没跑过。一道会崩的门比没有门更糟：它看着像在守着。
//
// 现在点的是《大三角》。它是天才限定，所以先兑一张 TESTMONTH——**一台 dev-server 里一
// 张码只兑得动一次**（CLAUDE.md 那几个坑的第一个），这道门因此要一台自己的服务器。
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['square', 'circle']) localStorage.setItem('slides_played_' + k, '1');
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.evaluate(async () => {
  const r = await fetch('/api/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }),
  }).then((x) => x.json());
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code,
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
const triCard = await page.$('.home-icon-btn[aria-label="六边形三角"]');
check('（尺子）菜单上找得到那张三角的卡', !!triCard, triCard ? '六边形三角' : '一张都没有');
if (!triCard) {
  console.log('\n没有三角那张卡，下面三条就没有意义——先看 ui/menu.ts 摆了哪几张。');
  await browser.close();
  process.exit(1);
}
await page.$eval('.home-icon-btn[aria-label="六边形三角"]', (e) => e.click());
await page.waitForTimeout(600);
if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
await page.waitForFunction(() => document.querySelectorAll('.tri').length > 0, { timeout: 25000 });
await page.waitForTimeout(900);
/**
 * 先逼出几个星星面来，才有东西可看。
 *
 * 这一段原来是照着 `.board` 的外框算落点，在同一条竖线上横滑 40 下，然后直
 * 接断言。实测三次里有两次一颗星都出不来——查下来不是运气：那些跑次里棋盘
 * 从头到尾一个格子都没动过。外框是在入场动画还没停稳的时候量的，量到的是
 * 一个还在变的矩形，于是之后每一下都滑在棋盘外面，滑多少下都一样。
 *
 * 现在改成从真正的棋子身上起手：每一下都现读一枚 .tri 的中心，棋盘在哪、多
 * 大、有没有动画都不影响。方向也补齐三条（三角能沿三条线拖），而且每滑一下
 * 就看一眼，出星星就停。
 */
const starCount = () => page.evaluate(() => document.querySelectorAll('.tri line').length);
/** 现读第 i 枚棋子的中心——不缓存，棋盘动过也不会算错。 */
const triCenter = (i) =>
  page.evaluate((n) => {
    const els = document.querySelectorAll('.tri');
    if (!els.length) return null;
    const r = els[n % els.length].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, i);
// 三角能沿这三条线拖，六个方向各来一份。
const DIRS = [
  [1, 0], [-1, 0],
  [0.5, 0.87], [-0.5, -0.87],
  [0.5, -0.87], [-0.5, 0.87],
];
let drags = 0;
let moved = false;
const boardSig = () =>
  page.evaluate(() => [...document.querySelectorAll('.tri path')].map((e) => e.getAttribute('fill')).join(','));
const sig0 = await boardSig();
outer: for (const span of [90, 140, 60]) {
  for (let i = 0; i < 25; i++) {
    for (const [dx, dy] of DIRS) {
      const c = await triCenter(i);
      if (!c) break outer;
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + dx * span, c.y + dy * span, { steps: 6 });
      await page.mouse.up();
      drags++;
      await page.waitForTimeout(170);
      if (await starCount()) break outer;
    }
  }
}
moved = (await boardSig()) !== sig0;
check('滑得动这副棋盘（滑不动的话下面两条就没在验渲染）', moved, `滑了 ${drags} 下`);
await page.waitForTimeout(1200);
const tri = await page.evaluate(() => {
  // 星星面认「有三笔线」；那圈灰边是同一块 svg 里一条带 stroke 的 path。
  const stars = [...document.querySelectorAll('.tri')].filter((el) => el.querySelector('line'));
  return { stars: stars.length, withRing: stars.filter((el) => el.querySelector('path[stroke]')).length };
});
check('三角上真的出现了星星面', tri.stars > 0, `${JSON.stringify(tri)} · 滑了 ${drags} 下`);
check('每一枚星星面都戴着那圈灰边', tri.stars > 0 && tri.withRing === tri.stars, JSON.stringify(tri));

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
