/**
 * 从「打完一局」到「榜上有我」，在浏览器里走一遍。
 *
 *   npm run build
 *   ALLOW_MEMORY_STORE=1 node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-leaderboard.mjs http://localhost:8815/
 *
 * check-scores.mjs 验的是服务器那一头的算术，这里验的是中间那几根线接没接上：
 * 结算的时候到底有没有发那一条上报、身份带对没有、拿回来的榜画不画得出来。
 * 这几根线断了一根，游戏照玩，只是永远没有人上榜——不会报错，也没人发现。
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
  // 榜上写的名字就是多人小屋里那个——先给它取好，省得回落到邮箱那一截。
  localStorage.setItem('slides_mp_name', '甲');
});
const page = await ctx.newPage();

// 这一条是整个链子的第一节：结算的时候到底发没发。
const pushes = [];
page.on('request', (r) => {
  if (!r.url().endsWith('/api/scores') || r.method() !== 'POST') return;
  try {
    pushes.push(JSON.parse(r.postData() || '{}'));
  } catch {
    /* 读不出来就算了，下面的断言会说话 */
  }
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#navRecords', { timeout: 20000 });

// ---- 还没登录：榜上说的是「登录之后才会上榜」，不是一句「敬请期待」 ------
await page.click('#navRecords');
await page.waitForTimeout(400);
await page.click('#ranksPanel');
await page.waitForSelector('.rank-tab', { timeout: 8000 });
const tabs = await page.$$eval('.rank-tab', (els) => els.map((e) => e.textContent.trim()));
check('一张总榜加八个玩法，一共九个切页', tabs.length === 9 && tabs[0] === '总榜', tabs.join(' '));
check('没登录时说的是「登录之后，你的成绩才会上榜」',
  (await page.$eval('#rankBody', (e) => e.textContent.trim())) === '登录之后，你的成绩才会上榜',
  await page.$eval('#rankBody', (e) => e.textContent.trim()));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---- 兑一张内部码，成为天才 ---------------------------------------------
await page.click('#navProfile');
await page.waitForTimeout(400);
await page.click('#insiderRow');
await page.waitForTimeout(500);
await page.fill('#redeemCode', 'TESTMONTH');
await page.click('#redeemGo');
await page.waitForSelector('#pwNews', { timeout: 15000 });
await page.fill('#pwUser', 'rank@example.com');
await page.fill('#pwNew', '123456');
await page.click('#pwGo');
await page.waitForSelector('#pwNews', { state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

// ---- 打一局，交卷 -------------------------------------------------------
// 重开一次而不是点回主菜单：权益存在 localStorage 里，活得过刷新，而这样
// 顺带也验了「关掉再打开，这台设备还认得这个账号」。
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.$$eval('.home-icon-btn', (els) => els[0].click());
await page.waitForSelector('#finishBtn', { timeout: 25000 });
// 等 4-3-2-1 数完、棋盘真的起来：开局页还盖着的时候《完成》按下去不算数
// （那一局还没开始，doFinish 直接返回）。
await page.waitForFunction(
  () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
  { timeout: 25000 },
);
// 结算要有一个非零的分数才看得出榜上排的是不是它（0 分的一局不上总榜——
// 总榜写的是每人最高的那一局，0 不算「最高」）。得分靠拖太慢，而交上去的
// 那个数是 gameController 从棋局算出来的，页面上改不动；所以在网络这一层
// 把上报的分数改成 4321——客户端照常上报（下面照常验它），服务器存下的是
// 4321，榜上才有东西可看。
await page.route('**/api/scores', async (route) => {
  const req = route.request();
  if (req.method() === 'POST') {
    try {
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'push') { b.score = 4321; return route.continue({ postData: JSON.stringify(b) }); }
    } catch { /* 读不出来就原样放行 */ }
  }
  return route.continue();
});
await page.waitForTimeout(300);
await page.$eval('#finishBtn', (el) => el.click());
await page.waitForSelector('#endOverlay.show', { timeout: 10000 });
await page.waitForTimeout(1200);

const push = pushes.find((b) => b.action === 'push');
check('结算的时候真的往云上报了一条', Boolean(push), JSON.stringify(pushes.map((b) => b.action)));
if (push) {
  check('报的是这个账号（邮箱 + 令牌都带上了）',
    push.email === 'rank@example.com' && typeof push.token === 'string' && push.token.length > 8,
    JSON.stringify({ email: push.email, token: push.token?.slice(0, 6) + '…' }));
  // 分数不是「大于零」——一局什么都没得的棋也是一局，也该记上。要验的是
  // 「报上去的那个数就是结算页上那个数」，这才是会写错的地方。
  const shown = Number(await page.$eval('#endOverlay', (e) => e.dataset.total));
  check('带着玩法 id，报的分数就是结算页记下的综合得分',
    push.mode === 'square' && push.score === shown, `${push.mode} / ${push.score} vs ${shown}`);
  check('榜上写的名字就是小屋里那个', push.name === '甲', push.name);
  check('整局的原始数据也一起存了（记录页要靠它重画战绩图）',
    Boolean(push.data && push.data.shapeId === 'square'));
  check('这一局有自己的编号（同一局报两次才认得出来）',
    typeof push.runId === 'string' && push.runId.includes('square'), push.runId);
}

// ---- 回记录页看榜 -------------------------------------------------------
await page.click('#endBackBtn');
await page.waitForSelector('.home-page', { timeout: 10000 });
await page.click('#navRecords');
await page.waitForTimeout(600);
await page.click('#ranksPanel');
await page.waitForSelector('.rank-row', { timeout: 10000 });
// 缩略图上也画着几行（总榜前三名），它和点开的这一版同时在文档里。所以
// 下面每一句都指明是点开的那一版，不然数出来的是两份加起来。
const rows = await page.$$eval('.records-panel--big .rank-row', (els) =>
  els.map((e) => ({
    name: e.querySelector('.rank-name')?.textContent.trim(),
    score: e.querySelector('.rank-score')?.textContent.trim(),
    me: e.classList.contains('rank-row--me'),
  })));
check('总榜上有我这一行', rows.length === 1 && rows[0].name === '甲', JSON.stringify(rows));
check('自己那一行被标出来了', rows[0]?.me === true);
// 玩家的原话：「取消《1人在榜，您在榜1》的文字」——榜底下不再有那一句。
check('榜底下没有《N 人在榜 · 你排第 N》那句',
  (await page.$$eval('.records-panel--big .rank-foot', (e) => e.length)) === 0 &&
    !/人在榜|你排第/.test(await page.$eval('.records-panel--big', (e) => e.textContent)));

// 换一张榜：方块那一张也该有我，三角那一张一个人都没有。
await page.$$eval('.rank-tab', (els) => els.find((e) => e.textContent.trim() === '方块').click());
await page.waitForSelector('.records-panel--big .rank-row', { timeout: 8000 });
check('方块那张单局榜上也有我',
  (await page.$$eval('.records-panel--big .rank-row', (e) => e.length)) === 1);
await page.$$eval('.rank-tab', (els) => els.find((e) => e.textContent.trim() === '三角').click());
await page.waitForFunction(
  () => !document.querySelector('.records-panel--big .rank-row'), { timeout: 8000 })
  .then(() => true).catch(() => false);
check('没打过的玩法，榜是空的，而且明说「这个玩法你还没打过」',
  (await page.$eval('#rankBody', (e) => e.textContent)).includes('这张榜上还没有人'),
  await page.$eval('#rankBody', (e) => e.textContent.trim()));

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
