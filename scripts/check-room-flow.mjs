/**
 * 小屋里几条「意料之外」的路，逐条走一遍（玩家的原话：「不要出现意料外的界面……
 * 也不要让玩家在系统里出现我们意料之外的疏漏的操作/行为」）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist      （内存版，TESTMONTH 只能兑一次）
 *   node scripts/check-room-flow.mjs http://localhost:8817/
 *
 *   · 连点三下《开小屋》只开一间；
 *   · 倒数期间刷新：座位还在，一打开就回到小屋页，跟着大家入局；
 *   · 开赛好几秒之后才回来（局中刷新、走神）：坐等待页，不拿一块新起的表跳进
 *     别人打了一半的局，而且向服务器交一次卷，别人不用等他到 90 秒缺席；
 *   · 屋主解散之后，客人拿到的是通知/战绩，不留在旧小屋页。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0; const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };
async function newPlayer() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1'); localStorage.setItem('slides_lang', 'zhHans'); });
  const page = await ctx.newPage(); await page.goto(BASE, { waitUntil: 'load' }); await page.waitForSelector('#navProfile', { timeout: 20000 }); return { ctx, page };
}
const A = await newPlayer(); const B = await newPlayer();
// 局中刷新会弹浏览器自己的「离开此页？」——这里替玩家按下「离开」。
B.page.on('dialog', (d) => d.accept()); A.page.on('dialog', (d) => d.accept());
await A.page.evaluate(async () => { const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json()); if (r.active) localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code })); });
await A.page.reload({ waitUntil: 'load' }); await A.page.waitForSelector('#navProfile');
await A.page.click('#navProfile'); await A.page.click('#multiRow'); await A.page.waitForSelector('#mpCreate');
// ---- 连点两下《开小屋》只开一间
const creates = []; A.page.on('request', (r) => { if (r.url().endsWith('/api/room') && r.method() === 'POST') { try { const b = JSON.parse(r.postData() || '{}'); if (b.action === 'create') creates.push(1); } catch {} } });
await A.page.fill('#mpName', '甲');
await A.page.evaluate(() => { const b = document.getElementById('mpCreate'); b.click(); b.click(); b.click(); });
await A.page.waitForSelector('.mp-code', { timeout: 10000 }); await A.page.waitForTimeout(800);
check('连点三下《开小屋》只发了一次建屋请求', creates.length === 1, `${creates.length} 次`);
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
// ---- 客人进屋
await B.page.click('#navProfile'); await B.page.click('#multiRow'); await B.page.waitForSelector('#mpCreate');
// 四位打满自动进屋，没有《加入》那颗键了（玩家 2026-09 的设计稿；见 ui/multiplayer.ts
// 的 joinNow）。所以上面那句 fill 本身就是「进屋」——这儿不再有一次点击。
await B.page.fill('#mpName', '乙'); await B.page.fill('#mpCode', code); await B.page.waitForSelector('.mp-code');
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2);
// ---- 屋主开局；客人在倒数时刷新
await A.page.click('#mpPick'); await A.page.waitForSelector('#roomPickBar');
await A.page.$$eval('.home-icon-btn', (els) => els[0].click());
await B.page.waitForSelector('.mp-countdown-page .cd-window', { timeout: 10000 });
await B.page.reload({ waitUntil: 'load' });
await B.page.waitForSelector('.home-page, .mp-page', { timeout: 30000 });
const landed = await B.page.evaluate(() => ({ mp: !!document.querySelector('.mp-page'), menu: !!document.querySelector('.home-page') && !document.querySelector('.mp-page') }));
check('刷新之后直接回到小屋页，不落在主菜单', landed.mp && !landed.menu, JSON.stringify(landed));
// 倒数还没数完（4.5 秒）就回来了：应当照常入局（开赛时刻还在前面或刚过）
const bBoard = await B.page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 15000 }).then(() => true).catch(() => false);
check('倒数没数完就回来的人照常入局', bBoard);
await A.page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 15000 });
// ---- 客人离开这一局（去主菜单），过 7 秒再回来：这一局早开了，坐等待页
// 开赛五秒之内回来的仍算「没来晚」（LATE_MS），所以先等六秒再刷新。
await B.page.waitForTimeout(6000);
await B.page.goto(BASE, { waitUntil: 'load' }).catch((e) => console.log('goto err', String(e).slice(0, 80))); // 刷新：座位还在，直接回小屋页
const arrived = await B.page.waitForSelector('.mp-page, .home-page', { timeout: 30000 }).then(() => true).catch(() => false);
if (!arrived) console.log('B stuck at:', await B.page.evaluate(() => ({ url: location.href, cls: document.documentElement.className, top: document.querySelector('#app')?.firstElementChild?.className, text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160) })).catch((e) => String(e).slice(0, 80)));
await B.page.waitForSelector('#mpWait', { timeout: 15000 }).catch(() => {});
await B.page.waitForTimeout(800);
const late = await B.page.evaluate(() => ({ wait: !!document.querySelector('#mpWait'), board: document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length, count: !!document.querySelector('.mp-countdown-page') }));
check('开赛好几秒之后才回来的人坐等待页，不进这一局', late.wait && late.board === 0 && !late.count, JSON.stringify(late));
// ---- 屋主打完；客人的等待页应放下、回到小屋页
await A.page.click('#finishBtn'); await A.page.waitForSelector('#finishConfirm', { timeout: 6000 }); await A.page.click('#mpFinishYes');
const back = await B.page.waitForFunction(() => !document.querySelector('#mpWait') && !!document.querySelector('.mp-page'), { timeout: 30000 }).then(() => true).catch(() => false);
check('这一局打完，等待页放下，回到小屋页', back);
// ---- 小屋没了（屋主解散）之后客人页面上的样子
await A.page.waitForFunction(() => !document.querySelector('#mpWait') && !!document.querySelector('#mpLeave'), { timeout: 30000 });
await A.page.click('#mpLeave'); await A.page.waitForSelector('#leaveRoomConfirm', { timeout: 5000 });
// 那颗确认键现在是**按住 600ms** 才生效（ui/confirmLeaveRoom.ts 的 §13 长按确认）：
// 一次 `.click()` 什么都不会发生，于是屋主根本没散场，下面那一条量到的是「客人还在小屋
// 页」——红的是这把尺子，不是代码。按住 750ms 再松手。
// 顺带把「按文字找那颗键」改成按 id 找：键上的字已经从《还是离开》换成了《按住离开》，
// 靠文字认迟早会认错人。
await A.page.waitForSelector('#mpLeaveYes', { timeout: 5000 });
{
  const b = await A.page.$eval('#mpLeaveYes', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await A.page.mouse.move(b.x, b.y);
  await A.page.mouse.down();
  await A.page.waitForTimeout(750);
  await A.page.mouse.up();
}
const gone = await B.page.waitForFunction(() => !!document.querySelector('#roomCancelled') || !!document.querySelector('.mp-final, .room-final, #mpFinalDone') || (document.querySelector('#mpCreate') && !document.querySelector('.mp-code')), { timeout: 20000 }).then(() => true).catch(() => false);
check('屋主解散后，客人看到通知或战绩，不再留在旧小屋页', gone, await B.page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120)));
console.log(fail ? `${fail} 项失败` : '全部通过');
await browser.close();
