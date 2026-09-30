/**
 * 暂停里那颗《怎么玩》：每个玩法只讲自己那一局的事。
 *
 *   node scripts/dev-server.mjs 8941 dist
 *   node scripts/check-howto.mjs http://localhost:8941/
 *
 * 盯着三件玩家点过名的事：
 *
 *   · 用词——棋盘上只有两样东西：「色块」和「星星」。五条里不出现「反面」「正
 *     面」（玩家 2026-09 定的：那是从做的人那边看过去的说法）。
 *     **「翻面」不在禁用之列**：玩家 2026-09-27 亲笔定的第 1 条就是「色块拼出得
 *     分图案会得分翻面，变成其他颜色的星星」。这一条从前连「翻面」一起禁，改成
 *     五条之后就成了「门比玩家的原话还严」——照它办只能去改玩家的句子。
 *   · 无限反转——第 4、5 条整条抽掉（那一局星星同色不消除，也没有「全部消除」这
 *     个目标，它是固定 100 秒），剩下三条重新从 1 编号。
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
      // 配图里画了几枚图案。只问「有没有配图」的话，一对改成一个那一步漏改也是绿的
      // （屏幕上两张图，「有没有」照样 true）——所以数出来。
      artIcons: e.querySelectorAll('.tut-rule-art .pattern-icon').length,
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
check('基础方块：五条规则', r.nums.join(',') === '1,2,3,4,5', r.nums.join(','));
check('基础方块：一条附注也没有', r.extras.length === 0, JSON.stringify(r.extras));
check('基础方块：第 1 条就是「色块拼出得分图案……变成其他颜色的星星」', r.texts[0].includes('色块') && r.texts[0].includes('星星'), r.texts[0]);
check(
  '五条里一个「反面／正面」都没有',
  r.texts.every((t) => !/反面|正面/.test(t)),
  JSON.stringify(r.texts.filter((t) => /反面|正面/.test(t))),
);
// 第 3 条讲的是侵蚀阶梯（《侵蚀阶梯》v1.2 §2）：得分图案从 4 枚一路降到 1 枚。
//
// 这一条上线前，这儿量的是上一套规则里的那一条——「整组都是星星也能得分，按星
// 星个数的平方算，4 颗就是 16 分」。那套算法 2026-09 整个换掉了（1×N 图案、每枚
// +2，见 engine/scoring.ts），于是这一条连同它守着的那句话一起成了假话。留着它
// 的话，门会逼着文案写回一个引擎里已经不存在的规矩。
check(
  '基础方块：第 3 条讲的是「得分图案会变」',
  /得分图案/.test(r.texts[2]) && /变/.test(r.texts[2]),
  r.texts[2],
);
check(
  '基础方块：第 3 条不再写「整组都是星星」那一套（算法早换了）',
  !/整组都是星星/.test(r.texts[2]) && !/16/.test(r.texts[2]),
  r.texts[2],
);
// 第 4 条按棋盘分两套（i18n 的 TUTORIAL_RULE4）：方块 36 说「整行整列 → 棋盘合
// 拢」，外边族说「最外面的一条线、最少 3 枚 → 一圈圈变小」。在方块那一局讲外边
// 族那一套，玩家会去凑一条根本不存在的「最外边」。
check(
  '基础方块：第 4 条说的是整行整列、棋盘合拢',
  /整行/.test(r.texts[3]) && /合拢/.test(r.texts[3]) && !/最外面/.test(r.texts[3]),
  r.texts[3],
);
// 第 5 条是目标，不是结束条件。
//
// 从前它写的是「全部消完，这一局结束」，更早还写过「全部变成星星，这一局结束」
// ——后面那句玩家撞上过：结算页写着「全部已變成星星」，盘面上还躺着四颗同色蓝
// 星，明明凑得出图案。现在这一条是玩家 2026-09-27 亲笔的「尝试全部消除吧～」。
check(
  '基础方块：第 5 条讲的是「全部消除」这个目标',
  /全部消除/.test(r.texts[4]) && !/变成星星/.test(r.texts[4]),
  r.texts[4],
);
await closeAll();

// ── 2. 无限反转 ──────────────────────────────────────────────────────
await startFrom('无限反转', async () => {
  await page.click('[data-family="square"]').catch(() => {});
  await page.waitForTimeout(800);
});
r = await openHowto();
check('无限反转：只剩三条，编号 123', r.nums.join(',') === '1,2,3', r.nums.join(','));
check('无限反转：不讲消除（第 4、5 条整条抽掉了）', !r.texts.some((t) => t.includes('消除')), JSON.stringify(r.texts.map((t) => t.slice(0, 10))));
// 这一条原先量的是 `includes('全部翻成星星')`——那句话早就不在 i18n 里了（第 5
// 条改过两回措辞），于是它把「谁也没写过的一句话不在」当成了通过，是一条空断
// 言。改成量那一整条在不在。
check(
  '无限反转：不讲结束条件（那一局是固定 100 秒）',
  !r.texts.some((t) => /结束|消完/.test(t)),
  JSON.stringify(r.texts.map((t) => t.slice(0, 12))),
);
// 反过来的一条：那一局**不吃侵蚀**（玩家 2026-09-27 拍板的 E15——翻过去还能翻回
// 来，吃侵蚀的话几步就降到 1×1、随便一枚都得分，玩法当场塌了）。所以通稿第 3 条
// 那句「得分图案会随着游戏解锁而变化」在这一局是假话，要换成 TUTORIAL_RULE3_FLIP。
check(
  '无限反转：第 3 条讲的是「图案不会变小，整局都是 4 枚」',
  r.texts.some((t) => /不会变小/.test(t) && /4 枚/.test(t)) && !r.texts.some((t) => /随着游戏解锁/.test(t)),
  JSON.stringify(r.texts.map((t) => t.slice(0, 20))),
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
// 一局只认**一个**得分目标（《侵蚀阶梯》v1.2 PR-8，从前是一对），所以那一条底下
// 配的图也只该有一枚。数出来，不只问「有没有配图」——从一对改成一个的时候，配图那
// 一头要是漏改，屏幕上是两张图，而「有没有」照样是 true。
check('老虎机：那一条配着当局的那一个图案（正好一枚）',
  r.extras.find((e) => e.tag === '老虎机')?.artIcons === 1,
  `${r.extras.find((e) => e.tag === '老虎机')?.artIcons} 枚`);
await closeAll();

// ── 4. 计时挑战 ──────────────────────────────────────────────────────
//
// 挑形状这一步走的是**整页**那一套（ui/timedMode.ts 的 #timedShapes 里两颗
// `.slot-pick-opt`），不是居中弹窗。2026-09 的「改动二」把这一屏从 `.center-pick`
// 换成了和《无限反转》《老虎机》同一副骨架，这儿原先还点着 `.center-pick-opt`，于是
// 这道门在这一步 30 秒超时、整个进程抛异常挂掉——**后面菱形方块那五条一条都没跑
// 过**，而它们正是「第 4 条按 ruleShape 讲对了没有」那一组。
await startFrom('计时挑战', async () => {
  await page.click('#timedShapes .slot-pick-opt[data-family="square"]');
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
check('菱形方块：五条规则还在', r.nums.join(',') === '1,2,3,4,5', r.nums.join(','));
// 菱形方块归外边族：它长得是方块，消行却和小球一路（shapes/squareDiamond.ts 文件
// 头那段——按方块那套算，实测清盘率从 23–27/30 跌到 2–6/30）。所以第 4 条要说外
// 边那一套，不能跟着「长得像方块」去说整行整列。
check(
  '菱形方块：第 4 条说的是最外面那一条线，不是整行整列',
  /最外面/.test(r.texts[3]) && !/整行/.test(r.texts[3]),
  r.texts[3],
);
await closeAll();

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
