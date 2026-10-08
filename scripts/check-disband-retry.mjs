/**
 * 屋主按了《解散小屋》、服务器那头没办成：留在原页，屋子不忘，再问一次（2026-10-08 方案 2-7）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8994 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-disband-retry.mjs http://localhost:8994/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 解散有两个入口：小屋页上那颗键（ui/multiplayer.ts 的 leaveSeat），和局中那一排 / 主菜单那条
 * 横幅（main.ts 的 leaveRoomWithCard）。两处从前都**不看 endRoom() 的结果**，照样 forgetRoom()：网
 * 断了一下、服务器忙，本机就把屋子忘了，服务器上却还挂着一间有屋主的屋——屋里的人干坐着等一个再也
 * 回不来的屋主，他自己连回这间屋的座位都扔了。
 *
 * 把「end」那一条请求拦下来让它失败（别的照常放行），两个入口各按一次：
 *
 *   · 还在原页（小屋页 / 主菜单那条横幅）；
 *   · 那一问原样又问了一次，上面多一行「小屋还没解散」；
 *   · 本机记的座位还在（slides_mp_seat）；
 *   · 屋里另一位那头小屋照旧开着（没收到「散了」）；
 *   · 尺子：放行之后再按一次，真的散了（屋主那头座位清掉，客人那头收到散场）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-disband-retry.mjs http://localhost:8994/');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function newPlayer() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}

const A = await newPlayer();
// 屋主：兑一张内部码才开得了屋。
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return false;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
  return true;
});
check('（尺子）TESTMONTH 兑到了开屋的权限', granted);
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');
await A.page.click('#navProfile');
await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate');
await A.page.fill('#mpName', '甲');
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());

const B = await newPlayer();
await B.page.click('#navProfile');
await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCreate');
await B.page.fill('#mpName', '乙');
await B.page.fill('#mpCode', code);
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 15000 });

// 拦下 end 那一条，别的照常放行。
let blocking = true;
let blocked = 0;
await A.page.route('**/api/room', async (route) => {
  let action = '';
  try {
    action = JSON.parse(route.request().postData() || '{}').action;
  } catch {}
  if (blocking && action === 'end') {
    blocked++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'busy' }) });
  }
  return route.continue();
});

/** 在那一问里按住《按住离开》（§13 长按确认：按住 600ms 才算）。 */
async function holdLeave(page) {
  await page.waitForSelector('#leaveRoomConfirm #mpLeaveYes', { timeout: 8000 });
  const b = await page.$eval('#leaveRoomConfirm #mpLeaveYes', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}
const seat = (page) => page.evaluate(() => localStorage.getItem('slides_mp_seat'));
const note = (page) =>
  page.waitForSelector('#leaveRoomConfirm .leave-note', { timeout: 8000 })
    .then((el) => el.textContent()).then((t) => t.trim()).catch(() => '');
const WANT = '小屋还没解散，再按一次试试。';

// ── ① 小屋页上那颗《解散小屋》 ───────────────────────────────────────────
await A.page.click('#mpLeave');
await holdLeave(A.page);
const n1 = await note(A.page);
check('①（尺子）那一条 end 真的被拦下了', blocked === 1, `${blocked} 次`);
check('① 那一问又问了一次，上面多一行「小屋还没解散」', n1 === WANT, n1);
check('① 还在小屋页上', Boolean(await A.page.$('#mpLeave')) && Boolean(await A.page.$('.mp-code')));
check('① 本机记的座位还在', (await seat(A.page)) !== null);
await B.page.waitForTimeout(2500);
check('① 客人那头小屋照旧开着', Boolean(await B.page.$('#mpLeave')) && !(await B.page.$('#roomCancelled, #mpFinalDone')));
// 先「留下」，换另一个入口再试。
await A.page.click('#leaveRoomConfirm #mpLeaveNo');
await A.page.waitForTimeout(400);
check('①（尺子）按「留下」那一问收起来了', !(await A.page.$('#leaveRoomConfirm')));

// ── ② 主菜单那条横幅上的《离开》（main.ts 的 leaveRoomWithCard） ────────────
await A.page.click('#mpPick');
await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
// el.click()，不用 page.click()：手机竖屏上主菜单那条鱼眼轴（#homeGrid）铺满整屏、压在这条横幅上
// 面，Playwright 按坐标点会被它截走（2026-10-08 跑这道门时撞见的，线上就是这样，另行回报）。这道
// 门量的是「解散没办成」那一下，不是横幅点不点得着。
await A.page.$eval('#roomPickLeave', (e) => e.click());
await holdLeave(A.page);
const n2 = await note(A.page);
check('②（尺子）那一条 end 又被拦下了一次', blocked === 2, `${blocked} 次`);
check('② 横幅那条路：那一问又问了一次，带着「小屋还没解散」', n2 === WANT, n2);
check('② 还在主菜单上，横幅还挂着', Boolean(await A.page.$('#roomPickBar')));
check('② 本机记的座位还在', (await seat(A.page)) !== null);

// ── ③ 尺子：放行之后再按一次，真的散了 ───────────────────────────────────
blocking = false;
await holdLeave(A.page);
const gone = await A.page.waitForFunction(() => localStorage.getItem('slides_mp_seat') === null, { timeout: 10000 })
  .then(() => true).catch(() => false);
check('③（尺子）放行之后再按一次：散了，屋主那头座位清掉了', gone);
const bSaw = await B.page.waitForSelector('#roomCancelled, #mpFinalDone, #mpCreate', { timeout: 15000 })
  .then(() => true).catch(() => false);
check('③（尺子）客人那头收到了散场', bSaw);

await A.ctx.close();
await B.ctx.close();
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
