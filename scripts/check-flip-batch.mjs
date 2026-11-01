/**
 * 《无限反转》这一批改动 + iOS 后台暂停 + 小屋里的无限反转卡，逐条核对。
 *
 *   node scripts/dev-server.mjs 8930 dist
 *   node scripts/check-flip-batch.mjs http://localhost:8930/
 *
 *   · 主菜单那张卡进挑图形页，《退出》和返回键都回主菜单（不是个人主页）；
 *   · 个人主页《更多玩法》是陈列页：圆角框里那张四层翻面的图 + 名字，《退出》回个人主页；
 *   · 开局页：摆的是挑的那个图形（不是秒表），倒数底下一块「图标 + 连击减弱 / 没有时间奖励」；
 *   · 一局 100 秒；切到后台立刻暂停，回来按《继续》接着打；
 *   · 结算页没有《用时系数》那一行；
 *   · 结算页四行（含反转系数）：图案分、拼出得分、反转系数（方块 ×6.00）、综合得分（10-31 方案推14 Z-B06）；
 *   · 头一局反转讲 endTipFlip（综合分怎么来），只讲一次——同一个上下文里再开一局反转就不讲了（推14 Z-B07）；
 *   · 基础局「综合得分是怎么来的」那一句没被反转局烧掉：开局就结束的那一局有九折那一行，不讲、不记账（站长 10-31），接着
 *     一局计时方块打到钟响才讲；
 *   · 屋主替小屋挑玩法时按到这张卡：只提示「不是小屋玩法」，人还在主菜单。
 *
 * 10-31 方案推15 Z-K08 修好：原先靠兑 TESTMONTH 开通天才（F-1 之后没有天才这一层了）；结算页量的还是 ero2 之前那几行
 * （「翻面」是退役的那一行），反转局「不摆 .end-row--tip」在 Z-B07 之后也不对了——这道门在推15 之前一直是红的。
 * 夹具改用 scripts/lib/unlockAll.mjs；第 5 节屋主开小屋要真登录（推11 起开小屋只问登录了没有、服务端认令牌），用
 * 免邮箱账号注册一个（api/handle.js，内存版服务器），照登录窗那样把回包记进本机缓存。
 */
import { chromium } from 'playwright';
import { unlockAll } from './lib/unlockAll.mjs';

const BASE = process.argv[2] || 'http://localhost:8930/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const has = (page, sel) => page.$(sel).then(Boolean);
const shown = (page, sel) => page.$eval(sel, (el) => el.classList.contains('show')).catch(() => false);
const back = async (page, ms = 500) => {
  await page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
// 4b 要一局计时方块打到钟响（不剩九折那一行）：假钟要在进页面之前装上；装上之后时间照常走，只在那一局快进。
await page.clock.install();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
// 「什么都解锁了的老玩家」＋ 语言和几把「看过」键（原先手写的那几把并进来）。
await unlockAll(page, {
  extra: {
    slides_lang: 'zhHans',
    slides_tutorial_seen: '1',
    slides_tutorial_seen_circle: '1',
    slides_tutorial_seen_triangle: '1',
    slides_intro_seen: '1',
  },
});
// 这道门要量两句话的**头一回**：反转局的 endTipFlip、基础局的 endTipComposite。unlockAll 从推14 起预设了
// slides_played_fliptip（不然所有打反转的门头一局多一行字），这儿在它之后删掉；slides_played_totaltip 它没预设，也一并
// 删一下（以后谁往 unlockAll 里加了它，这一条照样量得到头一回）。addInitScript 每次整页导航都跑——下面全程是页内导航
// （goBack 也是同一份文档），所以「第二局反转不讲」量得到。
await page.addInitScript(() => {
  try {
    localStorage.removeItem('slides_played_fliptip');
    localStorage.removeItem('slides_played_totaltip');
  } catch {
    /* 存不进就算了 */
  }
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

const FLIP_CARD = '.home-icon-btn[aria-label="无限反转"]';
/**
 * 主菜单那张卡要**在页面里**自己 click()，不能用 page.click()。
 *
 * 主菜单换成鱼眼滚轴之后，离焦点远的卡是真的坐在视口外面的（那是它的样子，不是
 * bug）。Playwright 的 page.click 会先滚到可见、再等「稳定」，滚不进来就一直重试
 * 到超时——这道门从前正是这么红的：第 56 行超时，后面二十几条一条都没跑过，而红的
 * 原因和被测的东西（无限反转那一局）毫无关系。**一道跑不起来的门比没有门更糟**，
 * 它红在那儿，看的人要么去查一个不存在的 bug，要么迟早给它加 continue-on-error。
 */
const tapCard = (pg, sel) => pg.$eval(sel, (el) => el.click());
check('主菜单上有《无限反转》那张卡，而且没锁', (await has(page, FLIP_CARD)) && !(await has(page, `${FLIP_CARD}.home-icon-btn--locked`)));

// 1. 主菜单 → 挑图形页 → 《退出》→ 主菜单
await tapCard(page, FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
check('挑图形页那句规矩写的是 100 秒', (await page.$eval('.flip-tagline', (el) => el.textContent)).includes('100 秒'));
await page.click('#flipBack');
await page.waitForTimeout(300);
check('挑图形页《退出》→ 主菜单（不是个人主页）', (await has(page, '.home-page')) && !(await has(page, '.profile-page')));

// 2. 主菜单 → 挑图形页 → 返回键 → 主菜单
await tapCard(page, FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
await page.waitForTimeout(120);
check('挑图形页立着哨兵', (await page.evaluate(() => history.state?.slides)) === 'guard');
await back(page);
check('挑图形页按返回键 → 主菜单', (await has(page, '.home-page')) && !(await has(page, '.profile-page')));

// 3. 个人主页《更多玩法》是陈列页
await page.click('#navProfile');
await page.waitForSelector('#moreModesRow', { timeout: 8000 });
await page.click('#moreModesRow');
await page.waitForSelector('.modes-page', { timeout: 8000 });
check('《更多玩法》是陈列页，不是挑图形页', !(await has(page, '.flip-page')));
check('陈列页里一个圆角框，装着无限反转那张图', (await has(page, '.modes-page .lay-card[data-mode="flip"] .lay-thumb svg')));
// 这一页并排陈列三张卡：老虎机模式、无限反转、步步为营（ui/perkPages.ts 的
// renderModesShowcase）。从前只有无限反转一张，所以这里取的是第一个 .lay-name——那
// 一版它就是无限反转；后来加到两张，再后来加到三张，而这一条一直写着两张，于是它
// 红着，红的原因和被测的东西无关，后面二十几条一条都没跑过。
// **整串比对、不只数个数**：只数个数的话，哪一张被换成了别的玩法照样绿。
check(
  '三张卡并排：老虎机模式、无限反转、步步为营',
  (await page.$$eval('.modes-page .lay-name', (els) => els.map((e) => e.textContent.trim()).join('|'))) === '老虎机模式|无限反转|真正解密 · 步步为营',
  await page.$$eval('.modes-page .lay-name', (els) => els.map((e) => e.textContent.trim()).join('|')),
);
check(
  '无限反转那张框底下写着它自己的名字',
  (await page.$eval('.modes-page .lay-card[data-mode="flip"] .lay-name', (el) => el.textContent.trim())) === '无限反转',
);
check('陈列页的图不能按（没有按钮）', !(await has(page, '.modes-page .lay-card button')));
await page.click('#backBtn');
await page.waitForTimeout(300);
check('陈列页《退出》→ 个人主页', await has(page, '.profile-page'));
await page.click('#moreModesRow');
await page.waitForSelector('.modes-page', { timeout: 8000 });
await page.waitForTimeout(120);
await back(page);
check('陈列页按返回键 → 个人主页', await has(page, '.profile-page'));
await back(page);
check('个人主页再按返回键 → 主菜单', await has(page, '.home-page'));

// 4. 开局页：图形（没有说明块）；100 秒；后台暂停；结算页没有用时系数
await tapCard(page, FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
await page.click('.slot-pick-opt[data-family="square"]');
await page.waitForSelector('#startOverlay.show', { timeout: 8000 });
// 这一屏从前解释计分怎么算（连击 ×1.5、没有时间奖励），玩家后来定下不要了：
// 4-3-2-1 数完就开打，上半屏那张图已经说清「你选的是这个玩法」。所以这里反过
// 来立着哨兵——那块说明不许回来。小屋的倒数页仍然摆它（见 multiplayer.ts）。
check('开局页倒数底下没有计分说明', !(await has(page, '#startOverlay .flip-hint')));
const markHtml = await page.$eval('#startOverlay .start-marks', (el) => el.innerHTML);
// 玩家给的 SVG 里每个 id 都带着文件名前缀（customIcons.ts）：base-square-… 是方块那张，timed-… 是秒表。
check('开局页摆的是方块那张图，不是秒表', markHtml.includes('base-square-') && !markHtml.includes('timed'), markHtml.slice(0, 80));
await page.screenshot({ path: '/tmp/claude-0/-home-user-Cube/31e4410f-1c28-5dc5-871f-485b2d55eb01/scratchpad/flip-start.png' });
await page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 15000 });
await page.waitForTimeout(300);
// 钟从 2026-09 起不在顶排了：PR-7 把它挪到暂停药丸正上方那块 .timer-pill（id
// #timerPill），顶排那个 hud-time 的 id 已经不存在——照旧读它是当场抛，不是 FAIL，
// 所以后面「后台暂停」那几条一条都没跑过。check-perk-pages 那边早就改过来了。
const clock = await page.$eval('#timerPill', (el) => el.textContent.trim());
// 无限反转一局 100 秒（engine/modeClock.ts 的 FLIP_SECONDS；推14 起计时、定时炸弹按棋盘另算，反转单独拆出来），
// 所以钟从 1:40 起；留几秒余量给启动那一下，不然 CI 上会偶发红。
check('一局 100 秒（开打时钟上是 1:40 附近）', /^1:(40|3\d)$/.test(clock), clock);

// 切到后台：立刻暂停
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(200);
check('切到后台 → 暂停页盖上', await shown(page, '#pauseOverlay'));
const clockPaused = await page.$eval('#timerPill', (el) => el.textContent.trim());
await page.waitForTimeout(1500);
check('暂停着的时候钟不走', (await page.$eval('#timerPill', (el) => el.textContent.trim())) === clockPaused, clockPaused);
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(200);
check('回到前台不自动继续——还是暂停页，等玩家按《继续》', await shown(page, '#pauseOverlay'));
await page.click('#continueBtn');
await page.waitForTimeout(200);
check('按《继续》→ 接着打', !(await shown(page, '#pauseOverlay')));
// 再切一次：已经暂停着的不重复处理；结算之后也不暂停
// 单人局的《完成》搬进了暂停面板：先按《暂停》，再按《结束游戏》。
await page.click('#stopBtn');
await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
await page.click('#pauseFinishBtn');
await page.waitForSelector('#endOverlay.show', { timeout: 8000 });
const rows = await page.$$eval('#endBreakdown .end-row', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
check('结算页没有《用时系数》那一行', !rows.some((r) => r.includes('用时系数')), rows.join(' | '));
// 《侵蚀阶梯》§5 把「有效得分率」这一行**退役了**（engine/runRecord.ts 那段注释点着
// 名：连击加成、有效得分率、用时系数、0.95^未翻面，一行不留——摆一行「×1.00」等于
// 告诉玩家有这回事）。这一条从前写的是「还有得分率那一行」，PR-4 之后它就一直红着，
// 而红的原因和被测的东西（无限反转那一局）无关。改成钉这一版真正该有的那三行。
//
// `.end-row--tip` 要摘掉：那是「综合分是怎么来的」那句教学，它自己就含「步数系数」
// 四个字，不摘的话下面「不摆步数系数那一行」会被它误伤成红。
const bodyRows = await page.$$eval('#endBreakdown .end-row:not(.end-row--tip)', (els) =>
  els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
);
// 中文叫法 10-11 起统一成「拼出得分」「综合得分」（方案 B-13.3）。反转局摆的是这一局真正的分数来源（runRecord.ts 的
// 反转分支）：图案分 →（有连击时）连击加成 → 拼出得分 → 反转系数 → 综合得分。「翻面 n 枚 ×2」在反转局是**退役**的那一行
// （反转不按翻面给分）——原先这一条要它在，所以推15 之前一直红着（10-31 方案推15 Z-K08）。
check(
  '结算页摆的是新那四行：图案分、拼出得分、反转系数、综合得分',
  ['图案分', '拼出得分', '反转系数', '综合得分'].every((w) => bodyRows.some((r) => r.includes(w))),
  bodyRows.join(' | '),
);
// 门用简体（slides_lang = zhHans），系数是点号；法文的逗号由 check-breakdown 管。
check('反转系数那一行：方块 ×6.00', bodyRows.some((r) => /^反转系数\s*×6\.00$/.test(r)), bodyRows.join(' | '));
check(
  '退役的那几行一行不留（有效得分率 / 用时系数 / 翻面 n 枚 / 剩余色块）',
  !bodyRows.some((r) => /有效得分率|用时系数|翻面 \d+ 枚|剩余色块/.test(r)),
  bodyRows.join(' | '),
);
// 「连击加成」有连击时是合法的一行（不列为退役）；它在的话，值以 + 开头。
check('有连击加成那一行时，它的值以 + 开头', bodyRows.filter((r) => r.startsWith('连击加成')).every((r) => /^连击加成\s*\+\d+$/.test(r)),
  bodyRows.filter((r) => r.startsWith('连击加成')).join(' | ') || '（这一局没有连击）');
// 无限反转不乘步数系数（§5），所以那一行不许摆——runRecord.ts 按「par 在不在」判，
// 这儿从屏幕上再问一遍。
check('无限反转：不摆步数系数那一行', !bodyRows.some((r) => r.includes('步数系数')), bodyRows.join(' | '));
// 结算页底下那句注解：头一局反转讲它自己那一句（endTipFlip「综合得分 = 拼出得分 × 反转系数……」，推14 Z-B07），
// 而且只讲这一句——步数系数那一句（endTipComposite）在这一档不许讲：这一局不乘步数系数，讲了他照着往上看找不到那个
// 系数（原先这儿钉的正是这一件）。
const FLIP_TIP = '综合得分 = 拼出得分 × 反转系数（经典方块 ×6，经典小球 ×2.5）。连续得分越多分越高，连击最多算 5 次。';
const tips1 = await page.$$eval('#endBreakdown .end-row--tip', (els) => els.map((el) => el.textContent.trim()));
check('头一局反转：底下恰好一句注解，就是 endTipFlip', tips1.length === 1 && tips1[0] === FLIP_TIP, JSON.stringify(tips1));
check('头一局反转：那句注解不讲「步数系数」', tips1.every((t) => !t.includes('步数系数')), JSON.stringify(tips1));
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(200);
check('结算页上切到后台不会盖暂停页', !(await shown(page, '#pauseOverlay')));
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
await page.click('#endBackBtn');
await page.waitForTimeout(300);
check('结算页《主页》→ 挑图形页（从哪儿来回哪儿）', await has(page, '.flip-page'));

// 同一个上下文里再开一局反转：那句注解只讲一次，第二局不讲了（slides_played_fliptip 记过账）。
await page.click('.slot-pick-opt[data-family="square"]');
await page.waitForSelector('#startOverlay.show', { timeout: 8000 });
await page.waitForFunction(() => !document.querySelector('#startOverlay')?.classList.contains('show'), { timeout: 15000 });
await page.waitForTimeout(300);
await page.click('#stopBtn');
await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
await page.click('#pauseFinishBtn');
await page.waitForSelector('#endOverlay.show', { timeout: 8000 });
check('第二局反转：那句注解不再讲（.end-row--tip 没有）', !(await has(page, '#endBreakdown .end-row--tip')),
  JSON.stringify(await page.$$eval('#endBreakdown .end-row--tip', (els) => els.map((el) => el.textContent.trim()))));
await page.click('#endBackBtn');
await page.waitForTimeout(300);
await page.click('#flipBack');
await page.waitForTimeout(300);
check('再《退出》→ 主菜单', await has(page, '.home-page'));

// 4b. 反面尺子：那句注解在**乘系数**的那一档照旧要讲。
//
// 少了这一条，上面那句「反转局不讲」就是恒真的——把注解整个删掉它也绿。
// 顺带钉住一件更细的事：反转局那一局**不许把这一次性的教学烧掉**。
// `claimFirstTotalTip()` 一问就记账，所以 gameController 那儿写的是
// `usesStepCoef && hooks.shouldTeachTotal?.()`——左边先判。右边先跑的话，这个人的
// 「头一回」用在了一局根本不显示它的反转局上，他从此再也看不到这句话。这儿正是
// 同一个浏览器上下文里的第二局，所以它真能验出那个顺序。
await tapCard(page, '.home-icon-btn[aria-label="经典方块"]');
await page.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
await page.$eval('#startBtn', (e) => e.click());
await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 });
await page.waitForTimeout(400);
await page.click('#stopBtn');
await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
await page.click('#pauseFinishBtn');
await page.waitForSelector('#endOverlay.show', { timeout: 8000 });
const baseRows = await page.$$eval('#endBreakdown .end-row', (els) =>
  els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
);
const COMPOSITE_TIP = '综合得分 = 拼出得分 × 步数系数。步数越少系数越高，最低 ×1.00；没清盘就结束时，剩下的色块每枚再打一次九折。';
const baseTips = await page.$$eval('#endBreakdown .end-row--tip', (els) => els.map((el) => el.textContent.trim()));
check('基础方块：步数系数那一行也在（它真的乘了）',
  baseRows.some((r) => r.includes('步数系数')), baseRows.join(' | '));
// 这一局开局就按《结束游戏》收场：盘上的色块几乎都还在，剩余色块那一行在、值以 ×0. 开头（推14 Z-B08 九折的真局验证）。
check('基础方块：按《结束游戏》收场，剩余色块那一行在、值以 ×0. 开头',
  baseRows.some((r) => /^剩余色块 \d+ 枚\s*×0\.\d\d$/.test(r)), baseRows.join(' | '));
// 明细里有九折那一行的这一局不讲那一句、也不记账，留到下一局（站长 10-31，推14：横屏装不下）。
check('基础方块（开局就结束、有九折那一行）：那一句留到下一局，这一窗不讲', baseTips.length === 0, JSON.stringify(baseTips));
check('反转局、这一局都没把「头一回」烧掉（slides_played_totaltip 还没写）',
  (await page.evaluate(() => localStorage.getItem('slides_played_totaltip'))) === null);
await page.click('#endBackBtn');
await page.waitForTimeout(300);
// 再一局计时方块，打到钟响（时间到不打九折，明细里没有那一行）：那一句这一局讲，就是 endTipComposite。前面一局反转、一局
// 开局就结束都没把它烧掉，这儿才真讲得出来（尺子：不然「反转局不讲」那条是恒真的）。
await page.$$eval('.home-icon-btn--timed', (els) => els[0]?.click());
await page.waitForSelector('.timed-page #timedShapes', { timeout: 15000 });
await page.$eval('#timedShapes .slot-pick-opt[data-family="square"]', (e) => e.click());
await page.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
await page.$eval('#startBtn', (e) => e.click());
await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 });
await page.clock.fastForward(101_000);
await page.waitForSelector('#endOverlay.show', { timeout: 15000 });
await page.waitForTimeout(1300);
const timedTips = await page.$$eval('#endBreakdown .end-row--tip', (els) => els.map((el) => el.textContent.trim()));
check('计时方块打到钟响：那一句讲了，就是 endTipComposite（反转局没把它烧掉）',
  timedTips.length === 1 && timedTips[0] === COMPOSITE_TIP, JSON.stringify(timedTips));
await page.click('#endBackBtn');
await page.waitForTimeout(300);
await page.waitForSelector('.timed-page #timedShapes, .home-page', { timeout: 8000 });
if (await has(page, '.timed-page')) {
  await page.click('.timed-page .page-exit, #timedBack').catch(() => {});
  await page.waitForTimeout(300);
}

// 5. 屋主替小屋挑玩法：按到无限反转进挑图形页（小屋那圈粉边还在），《退出》回主菜单，横幅还在
//    （挑完真开局的那条路在 check-room-flip.mjs 里，那儿有两台浏览器）
//
// 开小屋要真登录（推11 起服务端只问 identify() 认不认得出这个人，认的是令牌）。注册一个免邮箱账号（内存版服务器），
// 照登录窗那样把回包记进本机缓存（engine/subscription.ts 的 signInWithCode 那几位），再整页刷新一次让它生效。
// 刷新会再跑一遍上面那两段 addInitScript——反转、基础那两句「头一回」都已经量完了，不碍事。
await page.evaluate(async () => {
  const first = 'flipbatch' + Math.random().toString(36).slice(2, 10);
  const r = await fetch('/api/handle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'register', first, second: 'zq8w7e6r5t' }),
  }).then((x) => x.json());
  localStorage.setItem('slides_genius', JSON.stringify({ active: Boolean(r.active), period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.click('#navProfile');
await page.waitForSelector('#multiRow', { timeout: 8000 });
await page.click('#multiRow');
await page.waitForSelector('#mpCreate', { timeout: 8000 });
await page.fill('#mpName', '甲');
await page.click('#mpCreate');
await page.waitForSelector('#mpPick', { timeout: 15000 });
await page.click('#mpPick');
await page.waitForSelector('#roomPickBar', { timeout: 8000 });
await tapCard(page, FLIP_CARD);
await page.waitForSelector('.flip-page', { timeout: 8000 });
check('屋主挑玩法时按无限反转：进挑图形页，小屋那圈粉边还在', await page.evaluate(() => document.body.classList.contains('is-room-host')));
check('没有一个人开进局里', !(await has(page, '.app--game')));
await page.click('#flipBack');
await page.waitForTimeout(300);
check('挑图形页《退出》→ 主菜单，替小屋挑玩法的横幅还在', (await has(page, '.home-page')) && (await has(page, '#roomPickBar')));

check('一路没有页面报错', errors.length === 0, errors.join(' / '));
await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
