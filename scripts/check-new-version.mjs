/**
 * 「有新版本」那张卡——出得来、说对话、摆对地方，而且对局中、刚打完一局、屋主替整屋挑玩法时一个字都不说。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8976 dist
 *   node scripts/check-new-version.mjs http://localhost:8976/
 *
 * 这是个单页应用，进来之后不再整页跳转：一台开着不关的手机跑的还是上一次打开时下载的那
 * 一份（见 src/engine/newVersion.ts 的头注）。这道门拦的是这件事上的几种坏法：
 *
 *   ① **一直不说。** 线上换了版本，屏幕上没动静——而「永远没有新版本」和「这件事做好
 *      了」在屏幕上一模一样，所以必须有人替玩家去问一次。
 *   ② **在对局里说。** 说了他就会去按，而按下去就是刷新，这一局连没交卷的分一起扔掉
 *      ——「意料之外的疏漏操作」里最贵的一种。结算页上也不许说。
 *   ③ **刚打完一局就说**（10-11 方案 B-9 的体验冻结）：打完回到菜单正是他要接着开下一局的时候，两分钟里不说；
 *      屋主替整屋挑玩法（pickingForRoom）时也不说——那一下他在替一屋子人办事。
 *   ④ **压住别的东西。** 卡住在招牌底下那一格（和 GA 同意条同一个位置，ui/homeSlot.ts）。主菜单那条鱼眼滚轴
 *      占满整屏，卡片从招牌底下滑过去，这一屏上没有一块空地——浮在别处的那一版（10-11 之前写过、量过、撤掉过）
 *      压住的正是炸弹那张卡，而它自己收下点击，他冲着炸弹按下去，页面刷新了。所以④里那一条「不与任何玩法卡 /
 *      招牌 / 底部导航相交、不抢任何一张卡的点击」是这道门最要紧的一句，比「它出来了」要紧。
 *   ⑤⑥ **乱说**（尺子）：版本号没变、或者 `/version.json` 根本读不到的时候冒出一句——错要错在「不说」那一边。
 *   ⑦ **说错话**：有更新说明的那一种是「新版本：{说明}」，只有构建哈希变了是通用那一句；四种语言。
 *   ⑨ **只改文档也喊人刷新**（a2252da、da9c2b0、68c1f9a 三推都是这样）：/version.json 的 sha 现在是 dist 的构建
 *      哈希（scripts/build-version.mjs），dist 一个字节不变它就不变——换个目录、改个修改时间也不变，改一个字节就变。
 *   ⑩ 更新说明（src/changelog.ts）：每一条四种语言都在，而且是最简短的那种（简繁 ≤12 字、英 ≤40、法 ≤48）。
 *
 * 版本号这一问整条被 page.route 接走，不靠真的改 dist：第一问答一个，往后答另一个，于是「发现新版本」这件事在
 * 门里是**确定**的。
 *
 * 和 GA 同意条叠在一起的那几种样子（同意条在上、更新卡露 8px、答完之后更新卡升上来）归 check-consent 的 G 节：
 * 那一道自己出一份带 GA 编号的包、开在一个假的线上域名上，同意条才出得来。
 */
import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:8976/';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const sec = (t) => console.log('\n' + t);

/** 四种语言那几句的原文，直接从 i18n.ts 里读——门里不许再抄一份。 */
const I18N = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
const say = (lang, key) => {
  // `lang: {` 那一块里第一句 key。四块的次序是 en / fr / zhHant / zhHans。
  const at = I18N.indexOf(`\n  ${lang}: {`);
  if (at < 0) throw new Error('i18n.ts 里找不到 ' + lang + ' 那一块');
  const m = new RegExp(`\\n\\s+${key}: '([^']+)'`).exec(I18N.slice(at));
  if (!m) throw new Error('i18n.ts 的 ' + lang + ' 块里找不到 ' + key);
  return m[1];
};
/** 这一份构建自己的更新说明编号（src/changelog.ts 的 RELEASE）。 */
const RELEASE = Number((/export const RELEASE = (\d+);/.exec(readFileSync(new URL('../src/changelog.ts', import.meta.url), 'utf8')) || [])[1]);
/** ⑦ 用的一条假说明：线上那一版比这一份高一号，带着这四句。 */
const NOTE = {
  zhHans: '新增：每日挑战排名',
  zhHant: '新增：每日挑戰排名',
  en: 'New: daily challenge ranking',
  fr: 'Nouveau : classement du défi du jour',
};

/**
 * 把 `/version.json` 那一问接走。`answers` 一问一个答案（字符串是只有 sha 的老样子，对象原样回），用完之后一直答
 * 最后那一个；`null` 表示 404。
 */
async function serveVersions(ctx, answers) {
  let asked = 0;
  await ctx.route('**/version.json*', async (route) => {
    const a = answers[Math.min(asked, answers.length - 1)];
    asked++;
    if (a === null) return route.fulfill({ status: 404, body: 'no' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(typeof a === 'string' ? { sha: a, release: RELEASE } : a),
    });
  });
  return () => asked;
}

const CARD = '#newVersionCard';
const cardState = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { there: false, shown: false, text: '', btn: '', status: false, rect: null };
    const r = el.getBoundingClientRect();
    return {
      there: true,
      shown: getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0,
      text: (el.querySelector('.newver-text')?.textContent || '').trim(),
      btn: (el.querySelector('.newver-btn')?.textContent || '').trim(),
      status: !!el.querySelector('[role="status"]'),
      said: (el.querySelector('[role="status"]')?.textContent || '').trim(),
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height },
    };
  }, CARD);

/** 切回标签页那一刻（engine/newVersion.ts 两个问的时机之一；另一个是十分钟，门等不起）。 */
const comeBack = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

async function open(answers, { lang = 'zhHans', width = 390, height = 844, clock = false, seed = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 1000,
    isMobile: width < 1000,
    reducedMotion: 'reduce',
  });
  const asked = await serveVersions(ctx, answers);
  await ctx.addInitScript(
    ([l, s]) => {
      if (sessionStorage.getItem('__seeded') === '1') return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('slides_lang', l);
      if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    },
    [lang, seed],
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  // 假时钟（③ 用）：两分钟的冻结要快进过去，不能真等。照常走着，只在要的时候往前拨。
  if (clock) await page.clock.install();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  // 开机那一问是异步的（armNewVersionCard → watchVersion 里那句 `void check()`）。等它真的答完，不然「还没问到」
  // 和「问到了但没动静」在门里分不开。
  await page.waitForTimeout(300);
  return { ctx, page, asked, errs };
}

/** 发现新版本，等卡出来（这一格量位置要两帧）。 */
async function discover(page) {
  await comeBack(page);
  await page.waitForSelector(CARD, { state: 'visible', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
}

// ─────────────────────────────────────────────────────────────────
sec('① 版本号变了：主菜单上出来那张卡');
{
  const { ctx, page, asked, errs } = await open(['sha-old', 'sha-new']);
  const before = await cardState(page);
  check('（尺子）还没问出第二版之前，那张卡不在', !before.there, JSON.stringify(before.there));
  check('（尺子）开机真去问了一次 /version.json', asked() >= 1, asked() + ' 次');
  await discover(page);
  const now = await cardState(page);
  check('切回标签页：卡出来了', now.shown, JSON.stringify(now.shown));
  check(`只有构建变了（release 没涨，${RELEASE}）：说的是通用那一句「${say('zhHans', 'newVersionGeneric')}」`,
    now.text === say('zhHans', 'newVersionGeneric'), now.text);
  check(`那颗键是「${say('zhHans', 'newVersionReload')}」，高至少 44`,
    now.btn === say('zhHans', 'newVersionReload') && (await page.$eval(`${CARD} .newver-btn`, (b) => b.getBoundingClientRect().height)) >= 44, now.btn);
  check('卡里有一块 role="status"，出现那一刻念了一遍那一句', now.status && now.said === now.text, `${now.status} / 「${now.said}」`);
  const noClose = await page.$$eval(`${CARD} button`, (bs) => bs.length);
  check('没有关闭键（卡上只有那一颗）', noClose === 1, noClose + ' 颗');
  check('零报错', errs.length === 0, errs.join(' | '));

  sec('② 对局中一个字都不说，结算页也不说');
  // 跳过最上面那张《每日挑战》（第 19 推）：这儿按下标点的是玩法卡，下标从方块数起。
  await page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 25000 });
  await page.waitForTimeout(500);
  const inGame = await cardState(page);
  // 它不是「藏起来」，是**整个节点都不在**：卡住在主菜单那块招牌的盒子里，而打一局的时候屏幕上没有主菜单。
  check('打着一局：那张卡整个不在', !inGame.there, JSON.stringify(inGame.there));
  await page.click('#stopBtn');
  await page.waitForSelector('#pauseOverlay.show', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
  check('暂停那一屏：还是不说', !(await cardState(page)).there);
  await ctx.close();
}

// ③：打完一局回到主菜单，两分钟里不说；两分钟一过、人还在主菜单上，它自己出来，而且不用再去问一次服务器。
sec('③ 刚打完一局：两分钟里不说，过了自己出来（10-11 方案 B-9 的体验冻结）');
{
  const { ctx, page, asked, errs } = await open(['sha-old', 'sha-new'], { clock: true });
  await discover(page);
  check('（尺子）菜单上那张卡在', (await cardState(page)).shown);
  await page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.click('#stopBtn');
  await page.waitForSelector('#pauseFinishBtn', { state: 'visible', timeout: 6000 });
  await page.click('#pauseFinishBtn');
  await page.waitForSelector('#endOverlay.show', { timeout: 10000 });
  await page.waitForTimeout(600);
  check('结算页：不说', !(await cardState(page)).there);
  const askedBefore = asked();
  await page.click('#endBackBtn');
  await page.waitForSelector('.home-page', { timeout: 10000 });
  await page.waitForTimeout(600);
  check('打完回到主菜单：卡不在（两分钟里不说）', !(await cardState(page)).there);
  await page.clock.fastForward('01:30');
  await page.waitForTimeout(300);
  check('一分半之后：还不在', !(await cardState(page)).there);
  await page.clock.fastForward('00:45');
  await page.waitForSelector(CARD, { state: 'visible', timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
  const back = await cardState(page);
  check('两分钟过了、人还在主菜单上：卡自己出来了', back.shown, JSON.stringify(back.shown));
  check('而且没为这件事再去问一次服务器（发现过就记着）', asked() === askedBefore, askedBefore + ' → ' + asked());
  check('零报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// 「在菜单上就提示」——那就**只**在菜单上。`.home-head` 全站有好几处（个人主页、战绩页、天才特供页、小屋那两屏），
// 所以这一格的选择器前面必须带 `.home-page`。最要命的是小屋那两屏：那上头按一下刷新，正赶上一局要开，他那一局就没了。
sec('③半 只在主菜单上，不跟到别的页面去；没打完一局就回来，照样在');
{
  const { ctx, page } = await open(['sha-old', 'sha-new']);
  await discover(page);
  check('（尺子）菜单上那张卡在', (await cardState(page)).shown);
  for (const [id, screen, name] of [
    ['#navRecords', '.records-page', '战绩页'],
    ['#navProfile', '.profile-page', '个人主页'],
  ]) {
    await page.click(id);
    await page.waitForSelector(screen, { timeout: 10000 });
    await page.waitForTimeout(300);
    check(name + '上不说', !(await cardState(page)).there);
    const why = await page.evaluate(() => ({
      heads: document.querySelectorAll('.home-head').length,
      menu: Boolean(document.querySelector('.home-page')),
    }));
    // 那一页自己也有一块 `.home-head`，而主菜单已经不在屏幕上了——这正是选择器前面必须带 `.home-page` 的原因。
    check('（尺子）' + name + '上也有招牌那一层，而主菜单已经不在了', why.heads >= 1 && !why.menu, JSON.stringify(why));
    await page.click(id);
    await page.waitForSelector('.home-page', { timeout: 10000 });
    await page.waitForTimeout(400);
    check('从' + name + '回菜单：卡又在', (await cardState(page)).shown);
  }
  await ctx.close();
}

sec('③三 屋主替整屋挑玩法时不说（那一屏也是主菜单）');
{
  // 两个旧版本号：兑完码要刷新一次，刷新之后的那一问又是「头一问」（记下基准），新版本得留给再下一问。
  const { ctx, page, errs } = await open(['sha-old', 'sha-old', 'sha-new']);
  const granted = await page.evaluate(async () => {
    const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
    if (!r.active) return false;
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
    return true;
  });
  check('（尺子）TESTMONTH 兑到了开屋的权限', granted);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(300);
  await discover(page);
  check('（尺子）主菜单上那张卡在', (await cardState(page)).shown);
  await page.$eval('#navProfile', (e) => e.click());
  await page.waitForSelector('#multiRow', { timeout: 10000 });
  await page.$eval('#multiRow', (e) => e.click());
  await page.waitForSelector('#mpCreate', { timeout: 10000 });
  check('小屋页上不说', !(await cardState(page)).there);
  await page.fill('#mpName', '甲');
  await page.$eval('#mpCreate', (e) => e.click());
  await page.waitForSelector('.mp-code', { timeout: 10000 });
  check('开了屋、在小屋里：不说', !(await cardState(page)).there);
  await page.$eval('#mpPick', (e) => e.click());
  const picking = await page.waitForSelector('#roomPickBar', { timeout: 8000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1000);
  const isMenu = await page.evaluate(() => !!document.querySelector('.home-page .home-head'));
  check('（尺子）屋主替整屋挑玩法：这一屏就是主菜单（横幅挂着）', picking && isMenu);
  check('屋主替整屋挑玩法时不说', !(await cardState(page)).there);
  check('零报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────
// ④ 这一节是这道门最要紧的一节，比「它出来了」要紧：**它不许压住、不许抢走任何一张卡的点击**。量的是**相交**，
// 不是「卡的中心被盖住」：盖住一张卡的下半截同样是抢点击。四种语言 × A-14 那六种尺寸，另加横屏一档（手机横过来
// 是宽版那一套排布，同意条那一道没量它）。
sec('④ 摆位：A-14 那个位置，不压任何一张玩法卡、招牌、底部导航，一张卡的点击都没抢走');
const SIZES = [
  [390, 844],
  [360, 740],
  [320, 568],
  [1440, 900],
  [1366, 768],
  [1000, 700],
  [844, 390],
];
const table = [];
for (const lang of ['zhHans', 'zhHant', 'en', 'fr']) {
  for (const [w, h] of SIZES) {
    // 带说明的那一种字最长（法语那一句四十来个字符），量最挤的那一种。
    const { ctx, page, errs } = await open(['sha-old', { sha: 'sha-new', release: RELEASE + 1, note: NOTE }], { lang, width: w, height: h });
    await discover(page);
    const tag = `${lang} ${w}×${h}`;
    const m = await page.evaluate((sel) => {
      const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height });
      const card = document.querySelector(sel);
      if (!card) return null;
      const c = R(card.getBoundingClientRect());
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== 'hidden';
      };
      const parts = [...document.querySelectorAll('.home-page .home-icon-art, .home-page .home-icon-tag')]
        .filter(vis)
        .map((e) => ({ ...R(e.getBoundingClientRect()), name: e.closest('.home-icon-btn')?.getAttribute('aria-label') || '?' }));
      // 每一张看得见的卡，按它图的正中——落在那张卡自己身上（没被这张卡抢走）。
      const stolen = [];
      for (const art of document.querySelectorAll('.home-page .home-icon-art')) {
        if (!vis(art)) continue;
        const r = art.getBoundingClientRect();
        const x = (r.left + r.right) / 2;
        const y = (r.top + r.bottom) / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const at = document.elementFromPoint(x, y);
        if (at && card.contains(at)) stolen.push(art.closest('.home-icon-btn')?.getAttribute('aria-label') || '?');
      }
      const glass = document.querySelector('.home-page .home-head-glass');
      const nav = document.querySelector('.home-nav');
      const btn = card.querySelector('.newver-btn').getBoundingClientRect();
      const hitBtn = document.elementFromPoint((btn.left + btn.right) / 2, (btn.top + btn.bottom) / 2);
      return {
        card: c,
        parts,
        stolen,
        glass: glass ? R(glass.getBoundingClientRect()) : null,
        nav: nav ? R(nav.getBoundingClientRect()) : null,
        btnSelf: !!hitBtn && card.querySelector('.newver-btn').contains(hitBtn),
        btnH: btn.height,
        vw: document.documentElement.clientWidth,
        docW: document.documentElement.scrollWidth,
        room: document.querySelector('.home-page')?.style.getPropertyValue('--consent-room') || '',
      };
    }, CARD);
    if (!m) {
      check(`④ ${tag}：卡在`, false);
      await ctx.close();
      continue;
    }
    const inter = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const hitCards = m.parts.filter((p) => inter(m.card, p)).map((p) => p.name);
    check(`④ ${tag}：（尺子）量到的玩法卡至少两张`, m.parts.length >= 2, m.parts.length + ' 块');
    check(`④ ${tag}：不压任何一张玩法卡（图和卡底下那行字）`, hitCards.length === 0, [...new Set(hitCards)].join(' '));
    check(`④ ${tag}：不压招牌、不压底部导航`, !inter(m.card, m.glass) && !inter(m.card, m.nav));
    check(`④ ${tag}：一张卡的点击都没抢走（按每张卡图的正中，落在那张卡自己身上）`, m.stolen.length === 0, m.stolen.join(' '));
    check(`④ ${tag}：按那颗键的正中落在它自己身上，键高 ≥44`, m.btnSelf && m.btnH >= 44, `${m.btnSelf} / ${Math.round(m.btnH)}`);
    if (w >= 1000) {
      // 宽 360；右边那一截放不下「360 + 离招牌 12」时收窄（ui/homeSlot.ts 的 place）——1000 宽的法语是这一种。这道门
      // 开着减弱动态，副标题一上来就是整句（不打字），招牌一开始就是最宽的样子。
      const wantW = Math.min(360, Math.floor(m.vw - 24 - m.glass.r - 12));
      check(`④ ${tag}：电脑右上角——离右边、上边各 24px，宽 ${wantW === 360 ? '360' : `${wantW}（放不下 360 + 离招牌 12，收窄）`}`,
        Math.abs(m.vw - m.card.r - 24) <= 1 && Math.abs(m.card.t - 24) <= 1 && Math.abs(m.card.w - wantW) <= 1,
        `右 ${Math.round(m.vw - m.card.r)} 上 ${Math.round(m.card.t)} 宽 ${Math.round(m.card.w)}`);
      check(`④ ${tag}：离招牌至少 12px`, m.card.l - m.glass.r >= 12 - 0.5, `${Math.round((m.card.l - m.glass.r) * 10) / 10}`);
    } else {
      check(`④ ${tag}：手机——招牌下沿往下 12px、左右各 16px`,
        Math.abs(m.card.t - m.glass.b - 12) <= 1 && Math.abs(m.card.l - 16) <= 1 && Math.abs(m.vw - m.card.r - 16) <= 1,
        `下 ${Math.round(m.card.t - m.glass.b)} 左 ${Math.round(m.card.l)} 右 ${Math.round(m.vw - m.card.r)}`);
    }
    check(`④ ${tag}：整页没有横着滚`, m.docW <= m.vw, `${m.docW} / ${m.vw}`);
    check(`④ ${tag}：零报错`, errs.length === 0, errs.join(' | '));
    table.push(`${lang.padEnd(6)} ${String(w + '×' + h).padEnd(9)} ${String(Math.round(m.card.w)).padStart(3)}×${String(Math.round(m.card.h)).padStart(3)}  让 ${m.room || '0'}`);
    await ctx.close();
  }
}

// ─────────────────────────────────────────────────────────────────
sec('⑤ 尺子：版本号一直没变，一个字都不许冒');
{
  const { ctx, page } = await open(['sha-same']);
  await comeBack(page);
  await comeBack(page);
  await page.waitForTimeout(600);
  check('同一个 sha 问了三遍：卡不在', !(await cardState(page)).there);
  await ctx.close();
}

sec('⑥ 尺子：/version.json 读不到，也不许冒（宁可不说）');
{
  // 甲：一开始就读不到——自建部署没跑那一步构建脚本，整条按「没有新版本」走。
  const { ctx, page } = await open([null]);
  await comeBack(page);
  await comeBack(page);
  await page.waitForTimeout(600);
  check('甲 一直 404：卡不在', !(await cardState(page)).there);
  await ctx.close();
}
{
  // 乙：**问到过一次，之后才读不到**（正在部署、或者手机进了电梯）。少了 engine/newVersion.ts 里那句
  // `if (!now) return;`，读不到会被当成「和上一次不一样」，于是屏幕上冒出一句「有新版本」——而真相是网断了。
  const { ctx, page } = await open(['sha-old', null]);
  await comeBack(page);
  await comeBack(page);
  await page.waitForTimeout(600);
  check('乙 先问到、后断网：卡还是不在', !(await cardState(page)).there);
  await ctx.close();
}

// ⑦ 四种语言：通用那一句、带说明的那一句、键上的字；说明只认「线上的编号比这一份大」。
sec('⑦ 四种语言：说对了话');
for (const lang of ['zhHans', 'zhHant', 'en', 'fr']) {
  {
    const { ctx, page } = await open(['a', 'b'], { lang, width: 320, height: 568 });
    await discover(page);
    const st = await cardState(page);
    check(`${lang}：只有构建变了——「${say(lang, 'newVersionGeneric')}」·「${say(lang, 'newVersionReload')}」`,
      st.shown && st.text === say(lang, 'newVersionGeneric') && st.btn === say(lang, 'newVersionReload'), `${st.text} · ${st.btn}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(['a', { sha: 'b', release: RELEASE + 1, note: NOTE }], { lang, width: 320, height: 568 });
    await discover(page);
    const st = await cardState(page);
    const want = say(lang, 'newVersionNote').replace('{note}', NOTE[lang]);
    check(`${lang}：线上那一版高一号、带着说明——「${want}」`, st.shown && st.text === want, st.text);
    await ctx.close();
  }
}
{
  // 尺子：编号没涨（同一号、甚至更小）却带着说明——那是这一份自己已经有的东西，说通用那一句。
  const { ctx, page } = await open(['a', { sha: 'b', release: RELEASE, note: NOTE }]);
  await discover(page);
  const st = await cardState(page);
  check('（尺子）编号没涨、带着说明：照样说通用那一句', st.shown && st.text === say('zhHans', 'newVersionGeneric'), st.text);
  await ctx.close();
}
{
  // 线上那一版的说明里没有这种语言：说通用那一句，不留一个空的「新版本：」。
  const { ctx, page } = await open(['a', { sha: 'b', release: RELEASE + 1, note: { en: NOTE.en } }]);
  await discover(page);
  const st = await cardState(page);
  check('说明里缺这种语言：说通用那一句', st.shown && st.text === say('zhHans', 'newVersionGeneric'), st.text);
  await ctx.close();
}
{
  // 读屏只念一遍：回到主菜单再摆出来的那一张不再念。
  const { ctx, page } = await open(['a', 'b']);
  await discover(page);
  const first = await cardState(page);
  await page.click('#navRecords');
  await page.waitForSelector('.records-page', { timeout: 10000 });
  await page.click('#navRecords');
  await page.waitForSelector('.home-page', { timeout: 10000 });
  await page.waitForTimeout(500);
  const again = await cardState(page);
  check('读屏只念一遍：头一回念了，回到主菜单再摆出来的那一张那一块是空的', first.said !== '' && again.there && again.said === '',
    `「${first.said}」 → 「${again.said}」`);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────
sec('⑧ 源码：换语言、换屏两条路都把那一格重画一遍；只装一处盯哨；只有那颗键会刷新');
{
  // 行为门走不到换语言这一条：《语言》那颗键只长在个人主页上，而换语言是**原地换**（不换页，不经过
  // syncScreenClass）。这张卡是一直在的，语言换了它不能还说着上一种话——落点只能是 relocalizeChrome。
  const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const relocalize = /function relocalizeChrome\(lang: Lang\) \{([\s\S]*?)\n\}/.exec(MAIN);
  check('（尺子）找到了 relocalizeChrome', !!relocalize);
  check('relocalizeChrome 里叫了 syncHomeSlot(lang)', !!relocalize && /syncHomeSlot\(lang\)/.test(relocalize[1]));
  const screen = /function syncScreenClass\(\) \{([\s\S]*?)\n\}/.exec(MAIN);
  check('（尺子）找到了 syncScreenClass', !!screen);
  check('syncScreenClass 里也叫了一次（换屏那条路）', !!screen && /syncHomeSlot\(\)/.test(screen[1]));
  const armed = (MAIN.match(/armNewVersionCard\(/g) || []).length;
  check('盯哨只装一处（装两遍等于两个 setInterval）', armed === 1, armed + ' 处');
  const NV = readFileSync(new URL('../src/engine/newVersion.ts', import.meta.url), 'utf8');
  check('engine 那边一个字都没写 location.reload / 自动刷新', !/location\s*\.\s*reload/.test(NV));
  const CARDSRC = readFileSync(new URL('../src/ui/newVersionCard.ts', import.meta.url), 'utf8');
  check('刷新只挂在那颗键的 click 上（规矩①：按不按在玩家）', (CARDSRC.match(/location\.reload\(\)/g) || []).length === 1);
  check('旧的那一行（ui/newVersionPill.ts）撤掉了', !existsSync(new URL('../src/ui/newVersionPill.ts', import.meta.url)));
}

// ─────────────────────────────────────────────────────────────────
sec('⑨ /version.json 的 sha 是构建哈希：只改文档不变，换目录、改修改时间不变，改一个字节就变');
{
  const dist = join(ROOT, 'dist');
  const read = (dir) => JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8'));
  const run = (dir) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-version.mjs'), dir], { cwd: ROOT, encoding: 'utf8' });
  const live = read(dist);
  check('（尺子）dist/version.json 读得到，sha 是 64 位十六进制、release 是这一份的编号',
    /^[0-9a-f]{64}$/.test(live.sha) && live.release === RELEASE, JSON.stringify(live));
  const tmp = mkdtempSync(join(tmpdir(), 'newver-hash-'));
  try {
    cpSync(dist, tmp, { recursive: true });
    // 只改文档：文档不在 dist 里，构建出来的字节不变——这儿等价于「同一份 dist 在别处再算一遍」。
    utimesSync(join(tmp, 'index.html'), new Date('2001-01-01'), new Date('2001-01-01'));
    const r1 = run(tmp);
    check('（尺子）build-version 对别的目录跑得通', r1.status === 0, (r1.stderr || '').slice(0, 200));
    const same = read(tmp);
    check('换个目录、改个修改时间：sha 不变（只改文档的那一推不喊人刷新）', same.sha === live.sha, `${same.sha.slice(0, 12)} / ${live.sha.slice(0, 12)}`);
    const r2 = run(tmp);
    check('再算一遍（version.json 自己不进哈希）：还是那个数', r2.status === 0 && read(tmp).sha === live.sha);
    appendFileSync(join(tmp, 'index.html'), '\n');
    run(tmp);
    check('dist 里改一个字节：sha 就变了', read(tmp).sha !== live.sha, read(tmp).sha.slice(0, 12));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────
sec('⑩ 更新说明（src/changelog.ts）：四种语言都在、最简短');
{
  const r = spawnSync('npx', ['esbuild', 'src/changelog.ts', '--bundle', '--format=esm', '--log-level=error'], { cwd: ROOT, encoding: 'utf8' });
  check('（尺子）changelog.ts 打得了包', r.status === 0, (r.stderr || '').slice(0, 200));
  const mod = await import('data:text/javascript,' + encodeURIComponent(r.stdout));
  const { CHANGELOG, NOTE_MAX } = mod;
  /** 一条说明不合规的地方（空 = 合规）：四种语言都在、不是空白、不超长。 */
  const bad = (note) => {
    const out = [];
    for (const lang of ['zhHans', 'zhHant', 'en', 'fr']) {
      const t = note?.[lang];
      if (typeof t !== 'string' || !t.trim()) out.push(`${lang} 没写`);
      else if ([...t].length > NOTE_MAX[lang]) out.push(`${lang} ${[...t].length} > ${NOTE_MAX[lang]}`);
    }
    return out;
  };
  check('（尺子）同一把尺子喂一条坏的（缺法语、英语超长）：当场挑出来', bad({ zhHans: '新增：每日挑战排名', zhHant: '新增：每日挑戰排名', en: 'x'.repeat(41) }).length === 2);
  check('（尺子）喂 ⑦ 那条假说明：合规', bad(NOTE).length === 0, bad(NOTE).join(' · '));
  const entries = Object.entries(CHANGELOG);
  const wrong = entries.flatMap(([k, note]) => bad(note).map((x) => `第 ${k} 号 ${x}`));
  check(`每一条说明四种语言都在、不超长（${entries.length} 条）`, wrong.length === 0, wrong.join(' · '));
  check('没有比这一份的编号还新的说明', entries.every(([k]) => Number(k) <= RELEASE), entries.map(([k]) => k).join(','));
}

await browser.close();
console.log('\n── 各尺寸卡多大、往下让了多少（报告，不挡合并）──');
for (const line of table) console.log('  ' + line);
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
