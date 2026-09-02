/**
 * 令牌过期的时候，排行榜有没有说话。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-rank-expired.mjs http://localhost:8815/
 *
 * 上线之后榜一直空着，查出来是这个：这台设备手里那份令牌和服务器上的对不上，
 * /api/scores 一路回 401，八次上报一条都没写进去。而客户端把 401 当成一般的
 * 网络失败吞掉了，玩家那头只看到一张永远空着的榜——没有任何一句话告诉他
 * 「你的成绩其实没上传」，也没有任何一条路告诉他该去做什么。
 *
 * 所以这里验的是「会不会说话」，不是「能不能上榜」：把 /api/scores 全部改判
 * 401，然后看《记录与排名》说了什么、给没给出路。
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
  // 有权益、也有令牌——只是服务器不认这一份了。这正是那八次 401 的样子：
  // 小屋照开（那边问的是「是不是天才」），上榜过不去（这边要令牌对得上）。
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, channel: 'code', until: Date.now() + 30 * 864e5,
    code: 'STALE1', token: 'a-token-the-server-no-longer-knows',
  }));
});
const page = await ctx.newPage();

// 服务器那头一律回 401，模拟令牌过期。
await page.route('**/api/scores', (route) =>
  route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"auth"}' }));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#navRecords', { timeout: 20000 });
await page.click('#navRecords');
await page.waitForTimeout(500);

// ---- 缩略图：话要说到 ----------------------------------------------------
const thumb = await page.$eval('#ranksPanel', (e) => e.textContent.replace(/\s+/g, ''));
check('缩略图上写的是「登录已过期」，不是「这张榜上还没有人」',
  thumb.includes('登录已过期'), thumb.slice(0, 60));

// ---- 点开全页：话 + 一条走得通的路 ---------------------------------------
await page.click('#ranksPanel');
await page.waitForSelector('.rank-tab', { timeout: 8000 });
await page.waitForTimeout(600);
const big = await page.evaluate(() => {
  const p = document.querySelector('.records-panel--big');
  return {
    line: p?.querySelector('.rank-lock-line')?.textContent.trim() ?? '',
    cta: p?.querySelector('#rankReLoginCta')?.textContent.trim() ?? '',
    ghosts: p?.querySelectorAll('.rank-row--ghost').length ?? 0,
    geniusCta: !!p?.querySelector('#rankGeniusCta'),
  };
});
check('全页上明写「登录已过期，重新登录后成绩才会上榜」',
  big.line === '登录已过期，重新登录后成绩才会上榜', big.line);
check('给了一颗《重新登录》', big.cta === '重新登录', big.cta);
check('给的不是《成为 Slides 天才》——这个人已经付过钱了', big.geniusCta === false);
check('底下还是灰条，不编造名次', big.ghosts > 0, `${big.ghosts} 条`);

// ---- 那颗键真的走得通 ----------------------------------------------------
//
// 要落在「能重新输邮箱密码」的地方，不是个人主页。这台设备本地还以为自己订
// 阅着，个人主页上那颗宽键这时写的是《订阅状态》，点开是看订单的——绕过去
// 就没路了。这一条是写这个脚本时才发现的，本来的接法正是错的那一种。
await page.click('#rankReLoginCta');
await page.waitForTimeout(900);
const landed = await page.evaluate(() => {
  const w = document.querySelector('.genius-modal, .modal');
  return {
    modal: !!w,
    hasEmail: !!document.querySelector('input[type="email"], #authEmail, #pwUser'),
    hasPass: !!document.querySelector('input[type="password"], #authPass, #pwNew'),
    text: (w?.textContent || '').replace(/\s+/g, '').slice(0, 40),
  };
});
check('按下去开的是登录那一窗', landed.modal, JSON.stringify(landed));
check('窗里能重新输邮箱和密码（令牌就是这样换新的）',
  landed.hasEmail && landed.hasPass, JSON.stringify(landed));

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
