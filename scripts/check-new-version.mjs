/**
 * 「有新版本，点一下刷新」——出得来，而且对局中一个字都不说。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8976 dist
 *   node scripts/check-new-version.mjs http://localhost:8976/
 *
 * 这是个单页应用，进来之后不再整页跳转：一台开着不关的手机跑的还是上一次打开时下载的那
 * 一份（见 src/engine/newVersion.ts 的头注）。这道门拦的是这件事上的三种坏法：
 *
 *   ① **一直不说。** 线上换了版本，屏幕上没动静——而「永远没有新版本」和「这件事做好
 *      了」在屏幕上一模一样，所以必须有人替玩家去问一次。
 *   ② **在对局里说。** 说了他就会去按，而按下去就是刷新，这一局连没交卷的分一起扔掉
 *      ——「意料之外的疏漏操作」里最贵的一种。结算页上也不许说（那一屏上三颗键挤得满）。
 *   ③ **乱说。** 版本号没变、或者 `/version.json` 根本读不到（断网、自建部署没跑那一步构
 *      建脚本）的时候，屏幕上冒出一句「有新版本」。错要错在「不说」那一边。
 *
 * 版本号这一问整条被 page.route 接走，不靠真的改 dist：第一问答一个 sha，往后答另一个，
 * 于是「发现新版本」这件事在门里是**确定**的（真去改文件再重出包，这道门就得跑两次构
 * 建，而且两次之间还要等）。
 *
 * ⑤⑥ 两节是尺子：同一套动作，只把答案换成「版本号没变」和「404」，那一行就一个字都不许
 * 冒。少了这两节，①那一节在「这一行永远都在」的实现下也会全绿。
 *
 * ④那一节还钉着**摆在哪儿**这件事：那一行长在招牌那块玻璃里（`.home-head-glass`），不是
 * 浮在屏幕上的一块。浮的那一版写过、量过、撤掉了——主菜单那条鱼眼滚轴占满整屏，卡片从招牌
 * 和底排底下滑过去，所以这一屏上没有一块空地：一块 192×37 摆在底排上面 8px 处，压住的正是
 * 炸弹那张卡和它的两枚 chip，而它自己要收下点击。所以④里那一条「没有一张卡和它相
 * 交」是这道门最要紧的一句，比「它出来了」要紧。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8976/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const sec = (t) => console.log('\n' + t);

/** 四种语言那一句的原文，直接从 i18n.ts 里读——门里不许再抄一份。 */
const I18N = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
const tipOf = (lang) => {
  // `lang: {` 那一块里第一句 newVersionTip。四块的次序是 en / fr / zhHant / zhHans。
  const at = I18N.indexOf(`\n  ${lang}: {`);
  if (at < 0) throw new Error('i18n.ts 里找不到 ' + lang + ' 那一块');
  const m = /newVersionTip: '([^']+)'/.exec(I18N.slice(at));
  if (!m) throw new Error('i18n.ts 的 ' + lang + ' 块里找不到 newVersionTip');
  return m[1];
};

/**
 * 把 `/version.json` 那一问接走。`shas` 一问一个答案，用完之后一直答最后那一个；
 * `null` 表示 404。
 */
async function serveVersions(ctx, shas) {
  let asked = 0;
  await ctx.route('**/version.json*', async (route) => {
    const sha = shas[Math.min(asked, shas.length - 1)];
    asked++;
    if (sha === null) return route.fulfill({ status: 404, body: 'no' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sha }),
    });
  });
  return () => asked;
}

const PILL = '#newVersionPill';
const pillState = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { there: false, shown: false, text: '', rect: null };
    const r = el.getBoundingClientRect();
    return {
      there: true,
      shown: !el.hidden && r.width > 0 && r.height > 0,
      text: (el.textContent || '').trim(),
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    };
  }, PILL);

/** 切回标签页那一刻（engine/newVersion.ts 两个问的时机之一；另一个是十分钟，门等不起）。 */
const comeBack = (page) =>
  page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

async function open(shas, { lang = 'zhHans', width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  const asked = await serveVersions(ctx, shas);
  await ctx.addInitScript((l) => localStorage.setItem('slides_lang', l), lang);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  // 开机那一问是异步的（armNewVersionPill → watchVersion 里那句 `void check()`）。等它真
  // 的答完，不然「还没问到」和「问到了但没动静」在门里分不开。
  await page.waitForTimeout(300);
  return { ctx, page, asked };
}

// ─────────────────────────────────────────────────────────────────
sec('① 版本号变了：菜单上冒出那一行');
{
  const { ctx, page, asked } = await open(['sha-old', 'sha-new']);
  const before = await pillState(page);
  check('（尺子）还没问出第二版之前，那一行不在', !before.shown, JSON.stringify(before.there));
  check('（尺子）开机真去问了一次 /version.json', asked() >= 1, asked() + ' 次');

  await comeBack(page);
  await page.waitForSelector(PILL, { state: 'visible', timeout: 5000 }).catch(() => {});
  const now = await pillState(page);
  check('切回标签页：那一行出来了', now.shown, JSON.stringify(now.shown));
  check('说的就是 i18n 里那一句（简体）', now.text === tipOf('zhHans'), now.text);

  sec('② 对局中一个字都不说，结算页也不说');
  await page.$$eval('.home-icon-btn', (els) => els[0].click());
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
    { timeout: 25000 },
  );
  await page.waitForTimeout(500);
  const inGame = await pillState(page);
  // 它不是「藏起来」，是**整个节点都不在**：这一行长在主菜单那块招牌玻璃里，而打一局的时
  // 候屏幕上没有主菜单。这条断言写成「不在」而不是「不显示」，钉的就是这个机制。
  check('打着一局：那一行整个不在了', !inGame.there && !inGame.shown, JSON.stringify(inGame.there));

  await page.click('#stopBtn');
  await page.waitForSelector('#pauseOverlay.show, #pauseOverlay[style*="opacity: 1"]', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  const paused = await pillState(page);
  check('暂停那一屏：还是不说', !paused.shown, JSON.stringify(paused.shown));

  await page.click('#pauseFinishBtn');
  await page.waitForFunction(
    () => {
      const o = document.querySelector('#endOverlay');
      return !!o && getComputedStyle(o).opacity === '1';
    },
    { timeout: 10000 },
  );
  await page.waitForTimeout(400);
  const ended = await pillState(page);
  check('结算页：还是不说（那一屏三颗键挤得满）', !ended.shown, JSON.stringify(ended.shown));

  sec('③ 这一局真的结束了，它自己回来——不用再问一次服务器');
  const askedBefore = asked();
  await page.click('#endBackBtn');
  await page.waitForSelector('.home-page', { timeout: 10000 });
  await page.waitForTimeout(400);
  const back = await pillState(page);
  check('回到菜单：那一行又在了', back.shown, JSON.stringify(back.shown));
  check(
    '而且没为这件事再去问一次（发现过就记着）',
    asked() === askedBefore,
    askedBefore + ' → ' + asked(),
  );
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────
// 「在菜单上就提示」——那就**只**在菜单上。`.home-head-glass` 全站有七处（个人主页、战绩
// 页、天才特供页、小屋那两屏、小屋卡片页，还有主菜单），所以那个选择器前面必须带
// `.home-page`。最要命的是小屋那两屏：那上头按一下刷新，正赶上一局要开，他那一局就没了。
sec('③半 只在主菜单上，不跟到别的页面去');
{
  const { ctx, page } = await open(['sha-old', 'sha-new']);
  await comeBack(page);
  await page.waitForSelector(PILL, { state: 'visible', timeout: 5000 }).catch(() => {});
  check('（尺子）菜单上那一行在', (await pillState(page)).shown);
  for (const [id, screen, name] of [
    ['#navRecords', '.records-page', '战绩页'],
    ['#navProfile', '.profile-page', '个人主页'],
  ]) {
    await page.click(id);
    await page.waitForSelector(screen, { timeout: 10000 });
    await page.waitForTimeout(300);
    const st = await pillState(page);
    check(name + '上不说', !st.shown, JSON.stringify(st.there));
    // 那一页自己也有一块 `.home-head-glass`，而主菜单已经不在屏幕上了——这正是选择器前面
    // 必须带 `.home-page` 的原因。少了这把尺子，上面那条「不说」在「这一行从来不出现」的
    // 实现下也会绿。
    const why = await page.evaluate(() => ({
      glasses: document.querySelectorAll('.home-head-glass').length,
      menu: Boolean(document.querySelector('.home-page')),
    }));
    check(
      '（尺子）' + name + '上也有招牌玻璃，而主菜单已经不在了',
      why.glasses >= 1 && !why.menu,
      JSON.stringify(why),
    );
    await page.click(id);
    await page.waitForSelector('.home-page', { timeout: 10000 });
    await page.waitForTimeout(300);
    check('从' + name + '回菜单：那一行又在', (await pillState(page)).shown);
  }
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────
// ④ 这一节是这道门最要紧的一节，比「它出来了」要紧：**它不许抢走任何一张卡的点击**。
//
// 浮在屏幕上的那一版就是在这儿倒的。主菜单那条鱼眼滚轴占满整屏（见 style.css 的
// `.mode-axis`：招牌和底排本来就在轴的盒子里面，卡片从它们底下滑过去），所以这一屏上没有
// 一块空地——量过：一块摆在底排上面 8px 处的横条，压着的正是炸弹那张卡和它的两枚 chip，而
// 它自己收下点击，他冲着炸弹按下去页面就刷新了。
//
// 所以量的是**相交**，不是「卡的中心被盖住」：盖住一张卡的下半截同样是抢点击，而中心那
// 一版在横条瘦一点的时候就放过去了（反证时真的放过去过）。三档屏幕各量一遍——主菜单在手
// 机竖屏是鱼眼轴、横屏和电脑是 `.home-row` 宽版，两套排布。
sec('④ 摆位：长在招牌那块玻璃里，一张卡的点击都没抢走');
for (const vp of [
  { name: '竖屏 390×844', width: 390, height: 844 },
  { name: '横屏 844×390', width: 844, height: 390 },
  { name: '电脑 1280×800', width: 1280, height: 800 },
]) {
  const { ctx, page } = await open(['sha-old', 'sha-new'], { width: vp.width, height: vp.height });
  await comeBack(page);
  await page.waitForSelector(PILL, { state: 'visible', timeout: 5000 }).catch(() => {});
  const st = await pillState(page);
  check(vp.name + '：（尺子）那一行真在屏幕上', st.shown, JSON.stringify(st.shown));
  const seat = await page.evaluate((sel) => {
    const pill = document.querySelector(sel);
    const p = pill.getBoundingClientRect();
    const g = document.querySelector('.home-head-glass').getBoundingClientRect();
    const over = [];
    let seen = 0;
    for (const c of document.querySelectorAll('.home-icon-btn')) {
      const r = c.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      seen++;
      if (r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top)
        over.push(c.className.split(' ').slice(0, 2).join('.'));
    }
    const at = document.elementFromPoint((p.left + p.right) / 2, (p.top + p.bottom) / 2);
    return {
      glass: { top: g.top, bottom: g.bottom, left: g.left, right: g.right, w: g.width, h: g.height },
      pill: { top: p.top, bottom: p.bottom, left: p.left, right: p.right },
      seen,
      over,
      hit: at === pill || pill.contains(at) ? 'self' : at ? at.className || at.tagName : 'none',
    };
  }, PILL);
  check(
    vp.name + '：（尺子）招牌那块玻璃有宽有高',
    seat.glass.w > 60 && seat.glass.h > 40,
    Math.round(seat.glass.w) + '×' + Math.round(seat.glass.h),
  );
  check(
    vp.name + '：那一行整个在那块玻璃里面',
    seat.pill.top >= seat.glass.top - 1 &&
      seat.pill.bottom <= seat.glass.bottom + 1 &&
      seat.pill.left >= seat.glass.left - 1 &&
      seat.pill.right <= seat.glass.right + 1,
    '行 ' + Math.round(seat.pill.top) + '–' + Math.round(seat.pill.bottom) +
      ' / 玻璃 ' + Math.round(seat.glass.top) + '–' + Math.round(seat.glass.bottom),
  );
  check(vp.name + '：（尺子）量到的卡不止四张', seat.seen >= 4, seat.seen + ' 张');
  check(
    vp.name + '：没有一张卡和它相交',
    seat.over.length === 0,
    seat.over.length ? seat.over.join(' / ') : '0 张',
  );
  check(vp.name + '：按下去落在它自己身上', seat.hit === 'self', String(seat.hit));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────
sec('⑤ 尺子：版本号一直没变，一个字都不许冒');
{
  const { ctx, page } = await open(['sha-same']);
  await comeBack(page);
  await comeBack(page);
  await page.waitForTimeout(600);
  const st = await pillState(page);
  check('同一个 sha 问了三遍：那一行不在', !st.shown, JSON.stringify(st));
  await ctx.close();
}

sec('⑥ 尺子：/version.json 读不到，也不许冒（宁可不说）');
{
  // 甲：一开始就读不到——自建部署没跑那一步构建脚本，整条按「没有新版本」走。
  const { ctx, page } = await open([null]);
  await comeBack(page);
  await comeBack(page);
  await page.waitForTimeout(600);
  const st = await pillState(page);
  check('甲 一直 404：那一行不在', !st.shown, JSON.stringify(st));
  await ctx.close();
}
{
  // 乙：**问到过一次，之后才读不到**（正在部署、或者手机进了电梯）。这一节是真尺子：少了
  // engine/newVersion.ts 里那句 `if (!now) return;`，读不到会被当成「和上一次不一样」，于
  // 是屏幕上冒出一句「有新版本」——而真相是网断了。
  const { ctx, page } = await open(['sha-old', null]);
  await comeBack(page);
  await comeBack(page);
  await page.waitForTimeout(600);
  const st = await pillState(page);
  check('乙 先问到、后断网：那一行还是不在', !st.shown, JSON.stringify(st));
  await ctx.close();
}

// 四种语言各看一眼，而且是在**最窄那一档**（320×568）上看：英法两句比中文长一倍，而招牌那
// 块玻璃是 inline-block——宽度跟着里头最宽的一行走。这一行要是不换行，那块玻璃就被撑出屏幕
// 去了，而「横着顶出屏幕」在这个仓库里是算过账的毛病（见 check-oldcss 每一屏都查的那一条）。
sec('⑦ 四种语言：说对了话，而且没把招牌撑出屏幕');
for (const lang of ['zhHans', 'zhHant', 'en', 'fr']) {
  const { ctx, page } = await open(['a', 'b'], { lang, width: 320, height: 568 });
  await comeBack(page);
  await page.waitForSelector(PILL, { state: 'visible', timeout: 5000 }).catch(() => {});
  const st = await pillState(page);
  check(lang + '：说的就是 i18n 里那一句', st.shown && st.text === tipOf(lang), st.text);
  const fit = await page.evaluate(() => {
    const g = document.querySelector('.home-page .home-head-glass').getBoundingClientRect();
    return {
      win: window.innerWidth,
      left: Math.round(g.left),
      right: Math.round(g.right),
      scrollW: document.documentElement.scrollWidth,
    };
  });
  check(
    lang + '：招牌那块玻璃还在屏幕里，整页也没横着滚',
    fit.left >= 0 && fit.right <= fit.win && fit.scrollW <= fit.win,
    '玻璃 ' + fit.left + '–' + fit.right + ' / 屏 ' + fit.win + ' / 文档宽 ' + fit.scrollW,
  );
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────
sec('⑧ 源码：换语言那一条路也得把这一行重画一遍');
{
  // 行为门走不到这一条：《语言》那颗键只长在个人主页上，而换语言是**原地换**（不换页，
  // 不经过 syncScreenClass）。这一行是一直在的，语言换了它不能还说着上一种话——落点只能
  // 是 relocalizeChrome，所以在这儿钉住。
  const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const relocalize = /function relocalizeChrome\(lang: Lang\) \{([\s\S]*?)\n\}/.exec(MAIN);
  check('（尺子）找到了 relocalizeChrome', !!relocalize);
  check(
    'relocalizeChrome 里叫了 syncNewVersionPill(lang)',
    !!relocalize && /syncNewVersionPill\(lang\)/.test(relocalize[1]),
  );
  const screen = /function syncScreenClass\(\) \{([\s\S]*?)\n\}/.exec(MAIN);
  check('（尺子）找到了 syncScreenClass', !!screen);
  check(
    'syncScreenClass 里也叫了一次（换屏那条路）',
    !!screen && /syncNewVersionPill\(\)/.test(screen[1]),
  );
  const armed = (MAIN.match(/armNewVersionPill\(/g) || []).length;
  check('盯哨只装一处（装两遍等于两个 setInterval）', armed === 1, armed + ' 处');
  const NV = readFileSync(new URL('../src/engine/newVersion.ts', import.meta.url), 'utf8');
  check('engine 那边一个字都没写 location.reload / 自动刷新', !/location\s*\.\s*reload/.test(NV));
  const PILLSRC = readFileSync(new URL('../src/ui/newVersionPill.ts', import.meta.url), 'utf8');
  check(
    '刷新只挂在那颗键的 click 上（规矩①：按不按在玩家）',
    (PILLSRC.match(/location\.reload\(\)/g) || []).length === 1,
  );
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
await browser.close();
process.exit(fail ? 1 : 0);
