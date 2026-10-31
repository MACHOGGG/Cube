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
import { unlockAll } from './lib/unlockAll.mjs';
import { fillRun, SCORING_RULES } from './lib/fakeRun.mjs';

const BASE = process.argv[2] || 'http://localhost:8815/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await unlockAll(ctx);
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

// 推14 Z-B15 起榜单是「全球榜 / 今日挑战」两个页签 ＋ 三行药丸（棋盘 / 普通·Pro / 玩法），原先那一排母标签、下一行子标签整个
// 换掉了。三行药丸的点法规则（变灰、收回「全部」、只剩三角回退）另有 check-lb-cells 穷举，这儿量的是界面接没接上。
const chipsOf = (row) => page.$$eval(`.records-panel--big .rank-chips[data-row="${row}"] .rank-chip`, (els) =>
  els.map((e) => ({ v: e.dataset.chip, on: e.getAttribute('aria-pressed') === 'true', grey: e.getAttribute('aria-disabled') === 'true', text: e.textContent.trim() })));
const tapChip = (row, v) => page.click(`.records-panel--big .rank-chip[data-row="${row}"][data-chip="${v}"]`);
const pressedOf = async (row) => (await chipsOf(row)).filter((c) => c.on).map((c) => c.v).join(',');

// ---- 还没登录：榜上说的是「登录之后才会上榜」，不是一句「敬请期待」 ------
await page.click('#navRecords');
await page.waitForTimeout(400);
await page.click('#ranksPanel');
await page.waitForSelector('.records-panel--big .rank-chip', { timeout: 8000 });
const scope = await page.$$eval('.records-panel--big .rank-scope-tab', (els) => els.map((e) => e.textContent.trim()));
check('两个页签：全球榜、今日挑战', scope.join(' ') === '全球榜 今日挑战', scope.join(' '));
const fam0 = await chipsOf('families');
const tier0 = await chipsOf('tiers');
const mode0 = await chipsOf('modes');
check('三行药丸：棋盘（全部 方块 小球 三角）、普通 / Pro、玩法（全部 + 六个）',
  fam0.map((c) => c.v).join(' ') === 'all square circle triangle' && tier0.map((c) => c.v).join(' ') === 'all normal pro' &&
    mode0.map((c) => c.v).join(' ') === 'all base timed bomb slot flip puzzle',
  `${fam0.map((c) => c.text).join(' ')} | ${tier0.map((c) => c.text).join(' ')} | ${mode0.map((c) => c.text).join(' ')}`);
check('打开就是「全部 · 全部 · 全部」', (await pressedOf('families')) === 'all' && (await pressedOf('tiers')) === 'all' && (await pressedOf('modes')) === 'all');
check('没登录时说的是「登录之后，您的成绩才会上榜」',
  (await page.$eval('#rankBody', (e) => e.textContent.trim())) === '登录之后，您的成绩才会上榜',
  await page.$eval('#rankBody', (e) => e.textContent.trim()));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---- 注册一个免邮箱账号（两串自己定的字）----------------------------------------
// 原先这儿兑一张内部码、再设密码：那条路（#insiderRow → #redeemCode → #pwNew）早撤了（第 20 推起没有密码、10-11 起内部码不再开
// 账号），这道门手跑、没人发现它从那时起就走不下去。推12 起锁着的布局卡直接开登录窗（和 check-axis-overlay 同一条路）。
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.mode-axis .home-icon-btn--locked', { timeout: 20000 });
await page.evaluate(() => document.querySelector('.mode-axis .home-icon-btn--locked').click());
await page.waitForSelector('#authAlt', { timeout: 10000 });
await page.click('#authAlt');
await page.waitForSelector('#authPairForm:not([hidden]) input', { timeout: 10000 });
{
  const inputs = await page.$$('#authPairForm input');
  const tag = Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '');
  await inputs[0].fill(`rankfirst${tag}`);
  if (inputs[1]) await inputs[1].fill(`ranksecond${tag}`);
}
await page.click('#authGo');
await page.waitForSelector('#statusDone', { timeout: 15000 });
await page.click('#statusDone');
await page.waitForTimeout(800);

// ---- 打一局，交卷 -------------------------------------------------------
// 重开一次而不是点回主菜单：权益存在 localStorage 里，活得过刷新，而这样
// 顺带也验了「关掉再打开，这台设备还认得这个账号」。
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
// 跳过最上面那张《每日挑战》（第 19 推）：这儿按下标点的是玩法卡，下标从方块数起。
await page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
await page.waitForSelector('#stopBtn', { timeout: 25000 });
// 等 4-3-2-1 数完、棋盘真的起来：开局页还盖着的时候《完成》按下去不算数
// （那一局还没开始，doFinish 直接返回）。
await page.waitForFunction(
  () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
  { timeout: 25000 },
);
// 原先这儿在网络层把上报的分数改成 4321，好让榜上有东西可看。服务器 2026-10-03 起要求 score 和 data.totalScore 一致（对不上
// 400 mismatch）、10-11 起还对一遍账——改过的那一局一律被拒，这道门手跑、没人发现。现在这一局照实交（0 分，进存档、不上榜），
// 榜上那一行在下面用同一个账号另交一局 300 分。
await page.waitForTimeout(300);
// 单人局的《完成》搬进了暂停面板：先按《暂停》，再按《结束游戏》。
await page.$eval('#stopBtn', (el) => el.click());
await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
await page.$eval('#pauseFinishBtn', (el) => el.click());
await page.waitForSelector('#endOverlay.show', { timeout: 10000 });
await page.waitForTimeout(1200);

// ---- 结算页：总分是滚筒，而这一种终局没有通关章 ------------------------
//
// 这一局是按《结束游戏》收的（手动结束），不是「全部翻成点面」。所以那枚章
// **不该存在**——不是存在而藏着：一枚藏着的「完成」章迟早会因为某一条 CSS 露出
// 来，而它露出来说的是假话（见 engine/kinetics.ts 的 endCheckEligible）。
const endBits = await page.evaluate(() => {
  const score = document.getElementById('endScore');
  const stamp = document.getElementById('endStamp');
  return {
    rolls: !!score && score.classList.contains('odometer'),
    boxes: score ? score.querySelectorAll('.digit-box').length : 0,
    strips: score ? score.querySelectorAll('.digit-strip span').length : 0,
    readable: score?.dataset.score ?? null,
    stampSvgs: stamp ? stamp.querySelectorAll('svg').length : -1,
  };
});
check('结算页的总分是滚筒（一位一格、每格十个数字）',
  endBits.rolls && endBits.boxes >= 1 && endBits.strips === endBits.boxes * 10,
  JSON.stringify(endBits));
check('滚筒留下了读得出来的那一份（dataset.score）',
  /^\d+$/.test(endBits.readable ?? ''), String(endBits.readable));
check('手动结束这一局：结算页里根本没有那枚通关章的 SVG',
  endBits.stampSvgs === 0, `svg × ${endBits.stampSvgs}`);

const push = pushes.find((b) => b.action === 'push');
check('结算的时候真的往云上报了一条', Boolean(push), JSON.stringify(pushes.map((b) => b.action)));
if (push) {
  // 免邮箱账号的 id 是 hdl:<sha256>（交卷照样放在 email 那一格）。
  check('报的是这个账号（账号 id + 令牌都带上了）',
    typeof push.email === 'string' && push.email.startsWith('hdl:') && typeof push.token === 'string' && push.token.length > 8,
    JSON.stringify({ email: push.email, token: push.token?.slice(0, 6) + '…' }));
  // 分数不是「大于零」——一局什么都没得的棋也是一局，也该记上。要验的是
  // 「报上去的那个数就是结算页上那个数」，这才是会写错的地方。
  const shown = Number(await page.$eval('#endOverlay', (e) => e.dataset.total));
  check('带着玩法 id，报的分数就是结算页记下的综合得分',
    push.mode === 'square' && push.score === shown, `${push.mode} / ${push.score} vs ${shown}`);
  // 第 16 推起上报不带名字（昵称只走改名接口，engine/nickname.ts）；原先这一条量「push.name 就是小屋里那个」，早过期了。
  check('上报里不带名字（昵称只走改名接口）', !('name' in push), JSON.stringify(Object.keys(push)));
  check('整局的原始数据也一起存了（记录页要靠它重画战绩图）',
    Boolean(push.data && push.data.shapeId === 'square'));
  check('这一局有自己的编号（同一局报两次才认得出来）',
    typeof push.runId === 'string' && push.runId.includes('square'), push.runId);
}

// ---- 回记录页看榜 -------------------------------------------------------
await page.click('#endBackBtn');
await page.waitForSelector('.home-page', { timeout: 10000 });
// 上面那一局开局就按了结束，是 0 分——0 分照常进存档、不上榜（10-11 方案 B-13 第 10 条）。榜上要有「我」这一行，再用同一个账号
// 交一局 300 分的经典方块（明细由夹具拼齐、照现行规则版本，和真客户端交的同一个形状）。
{
  const data = { ...fillRun('square', 300, {}), rules: SCORING_RULES };
  const r = await page.evaluate(async (data) => {
    const g = JSON.parse(localStorage.getItem('slides_genius') || '{}');
    const res = await fetch('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'push', email: g.email, token: g.token, runId: `rank-300-${Date.now()}`, mode: 'square', score: 300, data }) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, data);
  check('（尺子）同一个账号再交一局 300 分，收下了', r.status === 200 && r.body?.ok === true && r.body?.stored !== false, JSON.stringify(r));
}
await page.click('#navRecords');
await page.waitForTimeout(600);
await page.click('#ranksPanel');
await page.waitForSelector('.rank-row', { timeout: 10000 });
// 缩略图上也画着几行（总榜前三名），它和点开的这一版同时在文档里。所以
// 下面每一句都指明是点开的那一版，不然数出来的是两份加起来。
const rows = await page.$$eval('.records-panel--big .rank-row', (els) =>
  els.map((e) => ({
    name: e.querySelector('.rank-name')?.textContent.trim(),
    // 自己那一行的分数是滚筒（engine/odometer.ts）——十条 0–9 竖排，textContent
    // 说明不了任何事。滚筒把读得出来的那一份留在 dataset.score 上（和 HUD 那一路
    // 同一个约定）。
    score: (() => {
      const el = e.querySelector('.rank-score');
      return el ? (el.dataset.score ?? el.textContent.trim()) : undefined;
    })(),
    me: e.classList.contains('rank-row--me'),
  })));
check('总榜上有我这一行', rows.length === 1 && rows[0].name === '甲', JSON.stringify(rows));
// §2 的落点只有两处：结算页的总分，和排行榜上**自己**那一行。别人那几行不滚——
// 它们就在眼前，能直接比，整表一起滚只是噪音。
const rollScope = await page.evaluate(() => {
  const panel = document.querySelector('.records-panel--big');
  const all = Array.from(panel?.querySelectorAll('.rank-row') ?? []);
  const scoreOf = (row) => row.querySelector('.rank-score');
  return {
    rows: all.length,
    mineRolls: all.some((r) => r.classList.contains('rank-row--me') && scoreOf(r)?.classList.contains('odometer')),
    others: all.filter((r) => !r.classList.contains('rank-row--me')).length,
    othersRolling: all.filter((r) => !r.classList.contains('rank-row--me') && scoreOf(r)?.classList.contains('odometer')).length,
  };
});
check('自己那一行的分数在滚', rollScope.mineRolls, JSON.stringify(rollScope));
// 这一条的量程要说清楚：这张榜上现在只有他自己（others = 0），所以「别人不滚」
// 此刻是空判——数字照实印出来，哪天这个 mock 里多了人，它就有牙了。
check(`别人那几行不滚（这张榜上另有 ${rollScope.others} 人）`,
  rollScope.othersRolling === 0, JSON.stringify(rollScope));
// ---- 弹窗底下那颗《返回》圆盘 --------------------------------------------
// 玩家的原话：「在成绩点开后的弹窗下方加入一个“<”作为退出到上一页的按钮，注意
// 不要遮蔽任何内容（后面个人主页和成绩与排名可以在此时隐藏）」。量的是位置：
// 圆盘整个在面板下方、又在屏幕里；底排导航这时候收起来了。
const geo = await page.evaluate(() => {
  const panel = document.querySelector('.records-panel--big')?.getBoundingClientRect();
  const back = document.querySelector('.center-pick-back')?.getBoundingClientRect();
  const nav = document.querySelector('.home-nav');
  return {
    panelBottom: panel ? Math.round(panel.bottom) : null,
    back: back ? { top: Math.round(back.top), bottom: Math.round(back.bottom), w: Math.round(back.width) } : null,
    navShown: nav ? getComputedStyle(nav).display !== 'none' : null,
    vh: innerHeight,
  };
});
check('弹窗底下有一颗《返回》圆盘，整个在面板下方、又在屏幕里',
  Boolean(geo.back && geo.panelBottom !== null && geo.back.top >= geo.panelBottom && geo.back.bottom <= geo.vh && geo.back.w > 30),
  JSON.stringify(geo));
check('弹窗开着的时候底排导航收起来了', geo.navShown === false, JSON.stringify(geo.navShown));
check('自己那一行被标出来了', rows[0]?.me === true);
// 玩家的原话：「取消《1人在榜，您在榜1》的文字」——榜底下不再有那一句。
check('榜底下没有《N 人在榜 · 您排第 N》那句',
  (await page.$$eval('.records-panel--big .rank-foot', (e) => e.length)) === 0 &&
    !/人在榜|[你您]排第/.test(await page.$eval('.records-panel--big', (e) => e.textContent)));

// ---- 三行药丸（推14 Z-B15，站长 10-22：「点击了三角，玩法的部分就是灰色的不能点开」）----------------------
// 自己那一行带着两枚行首图：棋盘、玩法（rank-glyph、rank-glyph--mode），读屏念得出名字。
const glyphs = await page.$$eval('.records-panel--big .rank-row--me .rank-glyph', (els) => els.map((e) => e.getAttribute('aria-label') || ''));
check('自己那一行行首两枚图：棋盘、玩法（读屏念得出名字）', glyphs.length === 2 && glyphs.every(Boolean), JSON.stringify(glyphs));

// 点三角：玩法行只剩「全部」「基础」可点，别的都灰（aria-disabled）。
await tapChip('families', 'triangle');
await page.waitForTimeout(500);
const triModes = await chipsOf('modes');
check('点三角：玩法行只有「全部」「基础」不灰', triModes.filter((c) => !c.grey).map((c) => c.v).join(' ') === 'all base',
  triModes.map((c) => `${c.v}${c.grey ? '(灰)' : ''}`).join(' '));
// 点一下灰的「计时」：不选中，三行下面说一句（读屏区 aria-live 里）。
// 灰的那颗带 aria-disabled，Playwright 的 click 会等它「可用」——直接派一次点击（玩家照样点得到它，那一下只出一句说明）。
await page.$eval('.records-panel--big .rank-chip[data-row="modes"][data-chip="timed"]', (e) => e.click());
await page.waitForTimeout(300);
const say = await page.$eval('#rankSay', (e) => e.textContent.trim());
check('点灰的「计时」：不选中，下面说「三角没有计时玩法」', (await pressedOf('modes')) === 'all' && say.includes('三角') && say.includes('计时'), `${await pressedOf('modes')} · ${say}`);
check('那句话在 aria-live 区里', await page.$eval('#rankSay', (e) => Boolean(e.closest('[aria-live="polite"]'))));
await page.waitForFunction(() => !document.querySelector('.records-panel--big .rank-row--me'), { timeout: 8000 }).then(() => true).catch(() => false);
check('三角那张榜上没有我（我打的是方块）', (await page.$$eval('.records-panel--big .rank-row--me', (e) => e.length)) === 0);

// 一行每一颗都点上就收回「全部」。
await tapChip('families', 'square');
await page.waitForTimeout(200);
await tapChip('families', 'circle');
await page.waitForTimeout(500);
check('棋盘那一行三颗全点上：收回「全部」', (await pressedOf('families')) === 'all', await pressedOf('families'));
await page.waitForSelector('.records-panel--big .rank-row--me', { timeout: 8000 });

// 方块 · 普通 · 基础：有我，没有 Pro 小标。
await tapChip('families', 'square');
await tapChip('tiers', 'normal');
await tapChip('modes', 'base');
await page.waitForTimeout(700);
await page.waitForSelector('.records-panel--big .rank-row--me', { timeout: 8000 });
check('方块 · 普通 · 基础：榜上有我', (await page.$$eval('.records-panel--big .rank-row--me', (e) => e.length)) === 1);
check('选了普通：没有一行挂「Pro」', !(await page.$eval('.records-panel--big .rank-body', (e) => /\bPro\b/.test(e.textContent))));
// 只选 Pro：我那一局不是 Pro 局，榜上没有我。（先把「普通」点掉：普通、Pro 两颗都点上就是一整行，收回「全部」。）
await tapChip('tiers', 'normal');
await page.waitForTimeout(300);
await tapChip('tiers', 'pro');
await page.waitForTimeout(700);
await page.waitForFunction(() => !document.querySelector('.records-panel--big .rank-row--me'), { timeout: 8000 }).then(() => true).catch(() => false);
check('只选 Pro：我那一局不是 Pro 局，不在这张榜上', (await page.$$eval('.records-panel--big .rank-row--me', (e) => e.length)) === 0);

// 「今日挑战」页签：三行收起，切回来三行是切走前的样子。
const before = `${await pressedOf('families')}|${await pressedOf('tiers')}|${await pressedOf('modes')}`;
await page.click('.records-panel--big .rank-scope-tab[data-scope="daily"]');
await page.waitForTimeout(500);
check('今日挑战：三行药丸收起来', await page.$eval('#rankFilters', (e) => e.hidden));
await page.click('.records-panel--big .rank-scope-tab[data-scope="global"]');
await page.waitForTimeout(500);
const after = `${await pressedOf('families')}|${await pressedOf('tiers')}|${await pressedOf('modes')}`;
check('切回全球榜：三行还是切走前那样', before === after && !(await page.$eval('#rankFilters', (e) => e.hidden)), `${before} → ${after}`);

// 按那颗《返回》：弹窗关掉，底排导航回来。
await page.click('.center-pick-back');
await page.waitForSelector('.center-pick', { state: 'detached', timeout: 5000 });
check('按《返回》关掉弹窗，底排导航回来了',
  await page.$eval('.home-nav', (n) => getComputedStyle(n).display !== 'none'));

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
