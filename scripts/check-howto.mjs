/**
 * 暂停里那颗《怎么玩》：每个玩法只讲自己那一局的事。
 *
 *   node scripts/dev-server.mjs 8941 dist
 *   node scripts/check-howto.mjs http://localhost:8941/
 *
 * 盯着三件玩家点过名的事：
 *
 *   · 用词——只剩「色块」和「星星」两个词。第 1 条就是「色块得分后会变成星
 *     星」，六条里再不出现翻面、反面、正面（玩家 2026-09 定的：不再有「翻
 *     面」这件事硬性存在的中间概念）。
 *   · 无限反转——第 4、5 条整条抽掉（那一局星星同色不消除，也不会「全部翻成
 *     星星就结束」），剩下四条重新从 1 编号。
 *   · 底下那几条附注——一个玩法一条，讲的是它比基础规矩多出来的那一层。基础
 *     局一条也没有；老虎机那一条要配着**当局现抽**的两个得分图案；计时和特殊
 *     布局没有配图，那块 5.2em 的格子也不该空着占位；特殊布局左边那个词是这
 *     副棋盘自己的名字。
 *
 * 天才那三个玩法（无限反转 / 老虎机 / 特殊布局里锁着的几副）要先兑一张
 * TESTMONTH——一台服务器只能兑一次，重跑请换端口重开服务器。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8941/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('dialog', (d) => d.accept());
await page.addInitScript(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
  localStorage.setItem('slides_intro_seen', '1');
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

async function openHowto() {
  await page.waitForSelector('#stopBtn', { timeout: 15000 });
  await page.click('#stopBtn');
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await page.click('#howBtn');
  await page.waitForSelector('.howto-modal', { timeout: 8000 });
  return page.evaluate(() => {
    const nums = [...document.querySelectorAll('.howto-list .tut-rule:not(.tut-rule--extra) .tut-rule-num')].map((e) => e.textContent);
    const texts = [...document.querySelectorAll('.howto-list .tut-rule:not(.tut-rule--extra) .tut-rule-text')].map((e) => e.textContent.trim());
    const extras = [...document.querySelectorAll('.howto-list .tut-rule--extra')].map((e) => ({
      tag: e.querySelector('.tut-rule-num--word')?.textContent || '',
      art: !!e.querySelector('.tut-rule-art'),
      text: (e.querySelector('.tut-rule-text')?.textContent || '').slice(0, 24),
    }));
    return { nums, texts, extras };
  });
}
async function closeAll() {
  await page.click('#howtoOkBtn').catch(() => {});
  await page.waitForTimeout(300);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(600);
}
async function startFrom(prefix, after) {
  // 用 el.click() 而不是 page.click(选择器)。
  //
  // 手机竖屏的主菜单 2026-09 换成了一条鱼眼轴（ui/modeAxis.ts）：焦点附近那几
  // 张卡才看得见，远处的卡 opacity 是 0，而指针事件归那条轴自己（它要认滑动）。
  // 所以按坐标点一张远处的卡，点到的是轴本身——真玩家是先把轴滑到那张卡上再
  // 点的。这道门量的是《怎么玩》那一屏里写了什么，不是主菜单点不点得着（那是
  // check-mode-axis 的活），所以这儿直接叫它的 click()。
  const hit = await page.$$eval('.home-icon-btn', (els, want) => {
    const el = els.find((e) => (e.getAttribute('aria-label') || '').startsWith(want));
    if (!el) return false;
    el.click();
    return true;
  }, prefix);
  if (!hit) throw new Error(`主菜单上找不到《${prefix}》那张卡`);
  await page.waitForTimeout(800);
  if (after) await after();
  if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 25000 });
  await page.waitForTimeout(900);
}

// ── 1. 基础方块 ──────────────────────────────────────────────────────
await startFrom('方块');
let r = await openHowto();
check('基础方块：六条规则', r.nums.join(',') === '1,2,3,4,5,6', r.nums.join(','));
check('基础方块：一条附注也没有', r.extras.length === 0, JSON.stringify(r.extras));
check('基础方块：第 1 条就是「色块得分后会变成星星」', r.texts[0].includes('色块') && r.texts[0].includes('变成星星'), r.texts[0]);
check(
  '六条里一个「反面／正面／翻面」都没有',
  r.texts.every((t) => !/反面|正面|翻面/.test(t)),
  JSON.stringify(r.texts.filter((t) => /反面|正面|翻面/.test(t))),
);
// 《星星跟随色块消除》上线之后，第 3 条必须讲到「整组都是星星也能得分」。
//
// 漏掉它的后果不是看不懂，是**玩家整局都在做低分的事**：凑一组纯星星 4 颗就
// 16 分，而 4 枚色块只有 4 分。而且这一条上线那天，第 3 条原来的尾巴（「但图
// 案里至少要有一个色块」）当场变成了假话——规则改了、文案没跟上，这道门就是
// 为了不让那种事再悄悄过去。
check(
  '基础方块：第 3 条讲了「整组都是星星也能得分」',
  /整组都是星星/.test(r.texts[2]) && /16/.test(r.texts[2]),
  r.texts[2],
);
check(
  '基础方块：第 3 条不再写「至少要有一个色块」（那句现在是假的）',
  !/至少要有一个色块/.test(r.texts[2]),
  r.texts[2],
);
// 第 5 条（结束条件）2026-09 也因为星星消除改过。原话是「全部变成星星，这一局
// 结束」——星星会被消成空图形之后这句话成了假话，而且玩家撞上过：结算页写着
// 「全部已變成星星」，盘面上还躺着四颗同色蓝星，明明凑得出图案。
check(
  '基础方块：第 5 条讲的是「全部消完才结束」，不是「变成星星就结束」',
  /全部消完/.test(r.texts[4]) && !/变成星星，这一局结束/.test(r.texts[4]),
  r.texts[4],
);
await closeAll();

// ── 2. 无限反转 ──────────────────────────────────────────────────────
await startFrom('无限反转', async () => {
  await page.click('[data-family="square"]').catch(() => {});
  await page.waitForTimeout(800);
});
r = await openHowto();
check('无限反转：只剩四条，编号 1234', r.nums.join(',') === '1,2,3,4', r.nums.join(','));
check('无限反转：不再讲整行消除', !r.texts.some((t) => t.includes('消除')), JSON.stringify(r.texts.map((t) => t.slice(0, 10))));
// 第 5 条（结束条件）整条抽掉了，所以这一屏不该出现「结束」二字。
//
// 这一条原先量的是 `includes('全部翻成星星')`——那句话早就不在 i18n 里了（第 5
// 条 2026-09 改成「全部消完」，更早还改过一次措辞），于是它把「谁也没写过的一
// 句话不在」当成了通过，是一条空断言。改成量那一整条在不在。
check(
  '无限反转：不讲结束条件（第 5 条整条抽掉了）',
  !r.texts.some((t) => /结束|消完/.test(t)),
  JSON.stringify(r.texts.map((t) => t.slice(0, 12))),
);
// 反过来的一条：纯星星的图案在**这一局**不得分（toggleOnMatch 开着，见
// engine/scoring.ts 的 starsScore），所以这一屏绝不能出现基础局那句「整组都是
// 星星也能得分」，第 3 条要换回老说法（i18n 的 TUTORIAL_RULE3_FLIP）。
check(
  '无限反转：第 3 条讲的是老规矩「至少要有一个色块」',
  r.texts.some((t) => /至少要有一个色块/.test(t)) && !r.texts.some((t) => /整组都是星星/.test(t)),
  JSON.stringify(r.texts.map((t) => t.slice(0, 16))),
);
check('无限反转：底下只一条，写着《无限反转》', r.extras.length === 1 && r.extras[0].tag === '无限反转', JSON.stringify(r.extras));
await closeAll();

// ── 3. 老虎机 ────────────────────────────────────────────────────────
await startFrom('老虎机', async () => {
  await page.click('.slot-pick-opt[data-family="square"], [data-family="square"]').catch(() => {});
  await page.waitForTimeout(10000);
});
r = await openHowto();
check('老虎机：底下有《老虎机》那一条', r.extras.some((e) => e.tag === '老虎机'), JSON.stringify(r.extras));
check('老虎机：那一条配着当局的两个图案', r.extras.find((e) => e.tag === '老虎机')?.art === true, '');
await closeAll();

// ── 4. 计时挑战 ──────────────────────────────────────────────────────
await startFrom('计时挑战', async () => {
  await page.click('.center-pick-opt[aria-label="方块"]');
  await page.waitForTimeout(900);
});
r = await openHowto();
check('计时：底下有《计时》那一条', r.extras.some((e) => e.tag === '计时'), JSON.stringify(r.extras));
check('计时：那一条不摆空配图', r.extras.find((e) => e.tag === '计时')?.art === false, '');
await closeAll();

// ── 5. 特殊布局（菱形方块）──────────────────────────────────────────
await startFrom('菱形方块');
r = await openHowto();
check('菱形方块：底下有一条，词是这副棋盘的名字', r.extras.length === 1 && r.extras[0].tag === '菱形方块', JSON.stringify(r.extras));
check('菱形方块：说的是「规则相同，布局不同」', (r.extras[0]?.text || '').includes('规则相同'), r.extras[0]?.text);
check('菱形方块：六条规则还在', r.nums.join(',') === '1,2,3,4,5,6', r.nums.join(','));
await closeAll();

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
