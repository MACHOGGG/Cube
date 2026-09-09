/**
 * 「这是不是他的第一局」——后台那条广告漏斗全靠它。
 *
 *   node scripts/dev-server.mjs 8818 dist
 *   node scripts/check-first-game.mjs http://localhost:8818/
 *
 * 漏斗是四格：进来 → 开了第一局 → 打完第一局 → 次日回来。中间两格靠
 * game_start / game_end 上带的 `first` 标记，而 ③÷② 要能直接相除，前提是这
 * 两条事件数的是同一批局。
 *
 * 真出过两次问题，都在这上面：
 *
 *   一、《再来一局》从前直接调 newGame，绕开了 trackGameStart。于是重开的局
 *       只有 game_end 没有 game_start，而 first 是在 trackGameStart 里定的，
 *       不再报就不再重算——第二局、第三局的 game_end 还带着 first: true。一
 *       个新玩家连打三局（最平常不过的操作），后台的「首局完成率」就会超过
 *       100%，一个不可能出现的数。
 *
 *   二、终身局数原先只在 initAnalytics 里读一次，而那个函数有两条提前返回的
 *       路。走了那两条它就是 0，再写回去等于把一个老玩家抹成新玩家。
 *
 * 这个门量的是 localStorage 里那个终身局数（slides_analytics_games）——它就
 * 是 first 的来源：开局那一刻读到 0 才叫第一局。本机不上报（isLiveSite 为
 * 假），但这个数照记，所以在这儿量它既准确又不用去截网络请求。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8818/';
const KEY = 'slides_analytics_games';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  // 首玩封锁只开基础两张；教学都标成看过，免得开局前多一层问答。
  for (const k of ['square', 'circle']) localStorage.setItem('slides_played_' + k, '1');
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));

const games = () => page.evaluate((k) => localStorage.getItem(k), KEY);

/** 从主菜单开一局方块。 */
async function openSquare() {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.$$eval('.home-icon-btn', (els) =>
    els.find((e) => e.getAttribute('aria-label') === '方块')?.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 });
  await page.waitForTimeout(700);
}

await openSquare();
check('头一局：终身局数记成 1（所以这一局的 first 是真）', (await games()) === '1', String(await games()));

// 《再来一局》那颗键的监听器是开局那会儿就挂上的，所以把结算页露出来直接按
// 真的那一颗——这正是玩家走的那条路。
for (const n of [2, 3]) {
  await page.evaluate(() => document.getElementById('endOverlay').classList.add('show'));
  await page.click('#restartBtn');
  await page.waitForTimeout(700);
  check(`按第 ${n - 1} 次《再来一局》：记成 ${n}（不再是第一局了）`, (await games()) === String(n), String(await games()));
}
check('《再来一局》真的重开了一盘棋', (await page.$$('#boardWrap .tile')).length > 0);

// 刷新之后再开一局：这个数是终身的，不是这一次打开的。
await openSquare();
check('刷新之后再开一局：记成 4（不是又回到 1）', (await games()) === '4', String(await games()));

// 从存储里抹掉，模拟一台干干净净的设备：第一局又该是第一局了。
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await openSquare();
check('换一台新设备（清掉这个数）：又从 1 起算', (await games()) === '1', String(await games()));

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
