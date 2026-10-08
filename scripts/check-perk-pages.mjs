/**
 * 个人主页里天才特供那几行点进去的页，和它们的《退出》。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-perk-pages.mjs http://localhost:8815/
 *
 * 量的是玩家点名的几件事：
 *   · 《随机得分目标》改叫《老虎机模式》；《世界排名和好友排名》改叫《世界排名》
 *     而且不再「敬请期待」；更多得分目标 / 更多布局也点得开了。
 *   · 《更多得分目标》三列二十个图案；《更多布局》四个圆角框两两一排（10-08 方案 3-C-5：
 *     菱形方块、六边圆球、七色圆球、大三角，和主菜单「更多布局」那一组同一份、同一个次序）；
 *     《更多玩法》的圆角框并排；
 *     《世界排名》整页只有榜，没有个人总分和成绩。
 *   · 从这些页（还有多人游玩、老虎机模式）按《退出》回到个人主页刚才看的位
 *     置，不是主菜单、也不是页顶。
 *   · 没开通的人看《解锁更多配色》：颜色不压暗。
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
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#navProfile', { timeout: 20000 });
await page.click('#navProfile');
await page.waitForSelector('.profile-page', { timeout: 10000 });
await page.waitForTimeout(300);

// ---- 1. 那几行 -------------------------------------------------------------
const rows = await page.evaluate(() => {
  const label = (id) => document.querySelector(`#${id} .profile-row-label`)?.textContent.trim() ?? null;
  const lock = (id) => Boolean(document.querySelector(`#${id} .profile-row-glyph--lock`));
  return {
    random: label('randomRow'), randomLock: lock('randomRow'),
    targets: label('moreTargetsRow'), targetsLock: lock('moreTargetsRow'),
    layouts: label('moreLayoutsRow'), layoutsLock: lock('moreLayoutsRow'),
    rank: label('worldRankRow'), rankLock: lock('worldRankRow'),
    modes: label('moreModesRow'), modesLock: lock('moreModesRow'),
    modesValue: document.querySelector('#moreModesRow .profile-row-value')?.textContent.trim() ?? '',
    soon: [...document.querySelectorAll('.profile-row--locked .profile-row-label')].map((e) => e.textContent.trim()),
    oldRank: document.body.textContent.includes('世界排名和好友排名'),
  };
});
check('《随机得分目标》改叫《老虎机模式》', rows.random === '老虎机模式', rows.random);
check('《更多得分目标》《更多布局》点得开了', rows.targets === '更多得分目标' && rows.layouts === '更多布局',
  `${rows.targets} / ${rows.layouts}`);
check('《世界排名和好友排名》改叫《世界排名》，不再敬请期待',
  rows.rank === '世界排名' && !rows.oldRank && !rows.soon.includes('世界排名'), `${rows.rank}`);
check('没开通：做好了的五行行首都挂着锁',
  rows.randomLock && rows.targetsLock && rows.layoutsLock && rows.rankLock && rows.modesLock);
/**
 * 《更多玩法》右边**只有那个「〉」**，不再列里面那几个玩法的名字。
 *
 * 玩家 2026-09：「《更多玩法》后面的文字太多了，去除掉《老虎机模式……》恢复排版」。三个
 * 名字连起来是「老虎机模式 · 无限反转 · 真正解密 · 步步为营」——比它左边那个标题还长，于
 * 是这一行和上下几行对不齐，整段的排版被它一行撑歪。
 *
 * 这一条从「写着那几个玩法」翻成「一个玩法名都不写」。翻过来而不是删掉：删掉就没人守着
 * 这件事了，而把名字加回去不报错、不白屏，只是那一行又把排版撑歪一次。
 * 那三个名字点进去第一屏就是（下面第 2 节量的就是那一屏）。
 */
check('《更多玩法》点得开了，而且右边只剩那个「〉」',
  rows.modes === '更多玩法' &&
    !/老虎机|无限反转|步步为营/.test(rows.modesValue) &&
    rows.modesValue.replace(/[\s\u00a0]/g, '') === '\u203a',
  `${rows.modes} · 右边「${rows.modesValue}」`);
check('还在敬请期待的只剩三行', rows.soon.length === 3, rows.soon.join(' / '));

// ---- 2. 三页，和《退出》回原位 -------------------------------------------
const SCROLL = 320;
async function openFrom(rowId, pageSel) {
  await page.evaluate((y) => window.scrollTo(0, y), SCROLL);
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => window.scrollY);
  await page.click(`#${rowId}`);
  await page.waitForSelector(pageSel, { timeout: 10000 });
  await page.waitForTimeout(300);
  return before;
}
async function backToProfile(before, label, backSel = '#backBtn') {
  await page.click(backSel);
  await page.waitForSelector('.profile-page', { timeout: 10000 });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.scrollY);
  check(`${label}：《退出》回到个人主页刚才看的位置`, Math.abs(after - before) <= 4, `${before} → ${after}`);
}

// 更多得分目标
{
  const before = await openFrom('moreTargetsRow', '.tgt-page');
  const t = await page.evaluate(() => ({
    cols: [...document.querySelectorAll('.tgt-col')].map((c) => `${c.dataset.family}:${c.querySelectorAll('.tgt-cell').length}`),
    cells: document.querySelectorAll('.tgt-cell').length,
    drawn: [...document.querySelectorAll('.tgt-cell')].every((c) => c.querySelector('.pattern-icon svg')),
    heads: document.querySelectorAll('.tgt-col-head svg').length,
    // 并排，不是叠着。
    sameRow: (() => {
      const tops = [...document.querySelectorAll('.tgt-col')].map((c) => Math.round(c.getBoundingClientRect().top));
      return tops.length === 2 && tops.every((t) => t === tops[0]);
    })(),
  }));
  // **两列，不是三列**（《侵蚀阶梯》v1.2 PR-6）：老虎机只开在方块和小球两族上了
  // ——三角那副基础棋盘删了。三角那一族的目标数据在 engine/targets.ts 里留着没删
  // （PR-8：永不被抽到），所以这一页少一列，那边一个字没动。
  check('更多得分目标：方块 / 小球两列并排', t.sameRow && t.cols.join(',') === 'square:8,circle:7', t.cols.join(' '));
  check('更多得分目标：十五个图案都画出来了', t.cells === 15 && t.drawn && t.heads === 2, `${t.cells} 格`);
  await backToProfile(before, '更多得分目标');
}
// 更多布局
{
  const before = await openFrom('moreLayoutsRow', '.lay-page');
  const l = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.lay-card')].map((c) => ({
      id: c.dataset.layout, name: c.querySelector('.lay-name')?.textContent.trim(),
      svg: Boolean(c.querySelector('.lay-thumb svg')),
      radius: parseFloat(getComputedStyle(c).borderTopLeftRadius) || 0,
      border: getComputedStyle(c).borderTopStyle,
      top: Math.round(c.getBoundingClientRect().top),
    })),
  }));
  check('更多布局：四个圆角框，各装一张缩图',
    l.cards.length === 4 && l.cards.every((c) => c.svg && c.radius >= 8 && c.border !== 'none'),
    JSON.stringify(l.cards));
  // 两两一排：第一、二张一行，第三、四张一行，第二行在第一行底下（不是四张挤成一排，也不是
  // 3 ＋ 1 吊着一张）。
  const tops = l.cards.map((c) => c.top);
  check('更多布局：两两一排，排成两行',
    tops.length === 4 && Math.abs(tops[0] - tops[1]) <= 1 && Math.abs(tops[2] - tops[3]) <= 1 && tops[2] > tops[0] + 20,
    tops.join(' / '));
  // 10-08 方案 3-C-5：加上菱形方块和六边圆球，和主菜单「更多布局」那一组同一份——方块、小球、
  // 三角三族的次序。原先只有七色圆球和大三角（天才特供那两副，《侵蚀阶梯》v1.2 PR-6 起）。
  check('更多布局：菱形方块、六边圆球、七色圆球、大三角，按这个次序',
    l.cards.map((c) => c.id).join(',') === 'squareDiamond,circleHex,circleSeven,triangleBig' &&
      ['菱形方块', '六边圆球', '七色圆球', '大三角'].every((n, i) => (l.cards[i]?.name || '').includes(n)),
    l.cards.map((c) => `${c.id}:${c.name}`).join(' / '));
  await backToProfile(before, '更多布局');
}
// 世界排名
{
  const before = await openFrom('worldRankRow', '.rank-page');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    view: Boolean(document.querySelector('.rank-page .rank-view')),
    tabs: document.querySelectorAll('.rank-page .rank-tab').length,
    body: (document.querySelector('.rank-page .rank-body')?.textContent || '').trim().length > 0,
    total: Boolean(document.querySelector('.total-card')),
    records: Boolean(document.querySelector('.records-panel--records')),
    label: document.querySelector('.rank-page .menu-section-label')?.textContent.trim(),
  }));
  check('世界排名：整页就是那张榜（切页 + 榜）', r.view && r.tabs >= 2 && r.body, `${r.tabs} 个切页`);
  check('世界排名：没有个人总分、没有个人成绩', !r.total && !r.records);
  check('世界排名：标题就叫世界排名', r.label === '世界排名', r.label);
  await backToProfile(before, '世界排名');
}
// 更多玩法：陈列页——三个圆角框，老虎机和无限反转一排，步步为营落到第二行左边；
// 要玩得回主菜单那三张卡
{
  const before = await openFrom('moreModesRow', '.modes-page');
  const m = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.modes-page .lay-card')].map((c) => ({
      mode: c.dataset.mode, name: c.querySelector('.lay-name')?.textContent.trim(),
      svg: Boolean(c.querySelector('.lay-thumb svg')),
      radius: parseFloat(getComputedStyle(c).borderTopLeftRadius) || 0,
      border: getComputedStyle(c).borderTopStyle,
      buttons: c.querySelectorAll('button').length,
      top: Math.round(c.getBoundingClientRect().top),
      left: Math.round(c.getBoundingClientRect().left),
      bottom: Math.round(c.getBoundingClientRect().bottom),
      nameTop: Math.round(c.querySelector('.lay-name').getBoundingClientRect().top),
    })),
    picker: Boolean(document.querySelector('.flip-page')),
    label: document.querySelector('.modes-page .menu-section-label')?.textContent.trim(),
  }));
  check('更多玩法：三个圆角框，老虎机 / 无限反转 / 步步为营，底下各写着名字',
    m.cards.length === 3 && m.cards.map((c) => c.mode).join(',') === 'slot,flip,puzzle' &&
      m.cards.every((c) => c.svg && c.radius >= 8 && c.border !== 'none') &&
      m.cards[0].name === '老虎机模式' && m.cards[1].name === '无限反转' &&
      m.cards[2].name === '真正解密 · 步步为营',
    JSON.stringify(m.cards));
  // 头两张并排，不是上下叠着：卡片的上沿在同一条线上。
  check('更多玩法：头两张并排（不换行）', Math.abs(m.cards[0].top - m.cards[1].top) <= 1,
    `${m.cards[0].top} / ${m.cards[1].top}`);
  // 两张图一横一竖，名字仍要落在同一条线上。
  check('更多玩法：前两个名字对齐', Math.abs(m.cards[0].nameTop - m.cards[1].nameTop) <= 1,
    `${m.cards[0].nameTop} / ${m.cards[1].nameTop}`);
  // 「罗列到第二行的左边对齐」这句话的机器读法（玩家定的）：第三张的左边缘和
  // 第一张对齐，而且它确实落在第一排下面——从前 .lay-grid 是 flex + 居中，第
  // 三张会居中吊在第二行正中间，那不是罗列，是孤零零站着。
  check('更多玩法：第三张落在第二行，左边缘和第一张对齐',
    Math.abs(m.cards[2].left - m.cards[0].left) <= 1 && m.cards[2].top >= m.cards[0].bottom,
    `左 ${m.cards[0].left} / ${m.cards[2].left} · 上 ${m.cards[2].top} vs 第一张底 ${m.cards[0].bottom}`);
  check('更多玩法：只是陈列，不是挑图形页，图也按不动',
    !m.picker && m.cards.every((c) => c.buttons === 0));
  check('更多玩法：标题就叫更多玩法', m.label === '更多玩法', m.label);
  await backToProfile(before, '更多玩法');
}
// 老虎机模式（介绍页）
{
  const before = await openFrom('randomRow', '.slot-intro-page');
  await backToProfile(before, '老虎机模式', '#slotBack');
}
// 多人游玩
{
  const before = await openFrom('multiRow', '#mpBack');
  await backToProfile(before, '多人游玩', '#mpBack');
}

// ---- 3. 没开通的人看《解锁更多配色》：颜色不压暗 ---------------------------
await page.click('#paletteRow');
await page.waitForSelector('.pal-opt', { timeout: 8000 });
const pal = await page.evaluate(() =>
  [...document.querySelectorAll('.pal-opt')].map((el) => ({
    locked: el.classList.contains('pal-opt--locked'),
    opacity: getComputedStyle(el).opacity,
    ink: getComputedStyle(el).color,
    swatches: [...el.querySelectorAll('.pal-strip span')].map((s) => getComputedStyle(s).opacity),
  })),
);
check('没开通：三套配色照样锁着', pal.length === 3 && pal.every((p) => p.locked), `${pal.length} 套`);
check('没开通：颜色不压暗（整行不透明度 1）', pal.every((p) => p.opacity === '1' && p.swatches.every((o) => o === '1')),
  pal.map((p) => p.opacity).join(','));
check('没开通：锁着的行字色不是浏览器的灰', pal.every((p) => !/rgba\(16, 16, 16/.test(p.ink)), pal[0]?.ink);
await page.click('#palClose');

// ---- 4. 教学挑选页：两个图形、五条规则、一颗《返回》，一屏装下 --------------
async function pickerAt(width, height) {
  const c = await browser.newContext({ viewport: { width, height } });
  await c.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('#navProfile', { timeout: 20000 });
  await p.click('#navProfile');
  await p.waitForSelector('#howToRow', { timeout: 10000 });
  await p.click('#howToRow');
  await p.waitForSelector('.tut-pick', { timeout: 10000 });
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => {
    const nav = document.querySelector('.home-nav');
    const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    const back = document.getElementById('backBtn')?.getBoundingClientRect();
    const rules = [...document.querySelectorAll('.tut-rule')];
    return {
      // 五条上头从前摆着两颗分镜键（.tut-shape-btn）。第 14 推撤了：那两段分镜还在教旧
      // 规则（入口下线，不重做）。所以这里量的是「一颗都没有」。
      shapeBtns: document.querySelectorAll('.tut-shape-btn, .tut-pick-shapes').length,
      rules: rules.length,
      arts: rules.filter((r) => r.querySelector('.tut-rule-art .ra-tile, .tut-rule-art svg')).length,
      // 玩家的原话：「教学内容下面的文字配套的图/动画，要能够清晰地展示对应的教学
      // 内容」——每幅都
      // 得是会动的（有 CSS 动画在跑），不是一张静图。
      animated: rules.filter((r) => [...r.querySelectorAll('.tut-rule-art *')].some((e) => getComputedStyle(e).animationName !== 'none')).length,
      texts: rules.map((r) => r.querySelector('.tut-rule-text')?.textContent.trim().length || 0),
      oldTitle: /如何滑|重新观看/.test(document.body.textContent),
      backGlyph: Boolean(document.querySelector('#backBtn svg')),
      backText: (document.getElementById('backBtn')?.textContent || '').trim(),
      backBottomOk: back ? back.bottom <= navTop + 1 && back.bottom <= window.innerHeight : false,
      backIsLast: (() => {
        const els = [...document.querySelectorAll('.tut-pick *')].filter((e) => e.getBoundingClientRect().height > 0);
        const maxBottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
        return back ? Math.abs(back.bottom - maxBottom) <= 1 : false;
      })(),
      scrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  });
  await c.close();
  return m;
}
for (const [w, h, label] of [[390, 844, '手机'], [375, 667, '小手机']]) {
  const m = await pickerAt(w, h);
  check(`${label} · 《如何滑？》那一页：分镜键撤了（第 14 推）`, m.shapeBtns === 0, `${m.shapeBtns} 个`);
  // 五条，不是六条：教学 2026-09 改成玩家亲笔的五条（《侵蚀阶梯》v1.2）。这个数
  // 写死是有意的——配图是按下标取的（rulesModal 的 art[i]），条数和幅数一旦对不
  // 上，屏幕上看不出是错位，只看得出「这幅图和这句话没关系」。
  // 每条的字数只是一条「不是空的」的尺子，从前写的是 > 8。玩家 2026-09-27 亲笔
  // 的第 5 条是「尝试全部消除吧～」，正好 8 个字——门当场红了，而红的不是代码，是
  // 玩家的句子。尺子要能认出空字符串，不该顺带规定他一句话得写多长。
  check(`${label} · 五条规则，每条配图`, m.rules === 5 && m.arts === 5 && m.texts.every((n) => n > 4), `${m.rules} 条 · ${m.arts} 幅 · 字数 ${m.texts.join('/')}`);
  check(`${label} · 五幅配图都在动`, m.animated === 5, `${m.animated} 幅`);
  check(`${label} · 没有《如何滑……重新观看》那两行字`, !m.oldTitle);
  check(`${label} · 《返回》是「<」的图示，在最下面，不压底排`, m.backGlyph && m.backText === '' && m.backIsLast && m.backBottomOk);
  check(`${label} · 整页一屏装下，不用滚`, !m.scrolls);
}
// 《如何滑？》那一页的《返回》和系统返回键。
//
// 从前这一段先点一颗分镜键、量分镜里那四颗图示键，再在分镜里按返回回挑选页。分镜
// 第 14 推下线了（还在教旧规则），那四颗键所在的那一屏已经走不到——剩下的是这一页自
// 己的两条退路。
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript(() => { localStorage.setItem('slides_lang', 'zhHans'); localStorage.setItem('slides_tutorial_seen', '1'); localStorage.setItem('slides_tutorial_seen_circle', '1'); localStorage.setItem('slides_tutorial_seen_triangle', '1'); });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('#navProfile', { timeout: 20000 });
  await p.click('#navProfile'); await p.click('#howToRow');
  await p.waitForSelector('.tut-pick #backBtn', { timeout: 10000 });
  // 挑选页按《返回》：回刚才那个个人主页，不是主菜单——这一页只有个人主页
  // 一个入口，退到主菜单等于把人从他原来待的地方赶走。
  await p.click('#backBtn');
  await p.waitForTimeout(600);
  check('教学挑选页按《返回》，回到个人主页', Boolean(await p.$('.profile-page')),
    await p.$eval('.app', (e) => e.className).catch(() => '(没有 .app)'));
  // 系统返回键走同一条路。
  await p.click('#howToRow');
  await p.waitForSelector('#backBtn', { timeout: 10000 });
  await p.goBack();
  await p.waitForTimeout(600);
  check('教学挑选页按系统返回键，也回到个人主页', Boolean(await p.$('.profile-page')));
  await c.close();
}

// ---- 4b. 开通了的人：主菜单那张卡进挑图形页，真开得了局，钟从 1:40 往下数 ------
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'FLIPCHK' }));
  });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('#navProfile', { timeout: 20000 });
  /*
   * 《更多玩法》那一行是陈列页；要玩走的是主菜单上那张卡。
   *
   * **先把轴滑到那张卡那儿再点。** 手机竖屏的主菜单是那条鱼眼轴
   * （ui/modeAxis.ts），一次只看得见四五张，而「无限反转」是第 10 站——离第一张
   * 十站远，画在屏幕外面。轴不是滚动容器，Playwright 的自动滚动够不着它，于是
   * 这一行会一直重试到超时抛异常，**后面那十几条一条都没跑过**（而这道门第十一
   * 轮把菜单换回轴之后就一直是这个样子）。
   *
   * 滑法用轴自己那一格 sessionStorage（menu.ts 的 AXIS_KEY，玩家定的「停在你
   * 上次看的那一项」），下标当场从 DOM 里数出来——写死数字的话，哪天卡的次序一
   * 变这儿就会去点别的玩法，而且还是绿的。
   */
  await p.waitForSelector('.mode-axis > .home-icon-btn', { timeout: 20000 });
  const flipIdx = await p.evaluate(() =>
    [...document.querySelectorAll('.mode-axis > .home-icon-btn')]
      .findIndex((b) => (b.getAttribute('aria-label') || '').startsWith('无限反转')),
  );
  check('主菜单的轴上找得到《无限反转》（下面几条才有意义）', flipIdx >= 0, `第 ${flipIdx} 站`);
  await p.evaluate((i) => {
    try { sessionStorage.setItem('slides_axis_focus', String(i)); } catch { /* 无痕模式 */ }
  }, flipIdx);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.mode-axis > .home-icon-btn', { timeout: 20000 });
  await p.waitForTimeout(500);
  await p.click('.home-icon-btn[aria-label="无限反转"]');
  await p.waitForSelector('.flip-page', { timeout: 8000 });
  check('开通了：两张图都不挂锁', (await p.$$('.flip-page .slot-pick-lock')).length === 0);
  await p.click('.flip-page .slot-pick-opt[data-family="square"]');
  const started = await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 }).then(() => true).catch(() => false);
  check('开通了：挑方块就开了一局', started);
  await p.waitForTimeout(300);
  // 钟从 2026-09 起不在顶排了（《侵蚀阶梯》v1.2 PR-7 把它挪到暂停药丸正上方那块
  // .timer-pill）。这一条同时是那次搬家的看门人：搬完头一版把条件写成
  // `meta.timed && !meta.flip`，无限反转那 100 秒的硬上限于是没了读数——时间到了
  // 棋盘直接结算，玩家不知道为什么。所以这儿量的不只是「数字在走」，还有「这一局
  // 屏幕上真的有一个钟」。
  const has = await p.$('#timerPill');
  check('无限反转：这一局有钟（100 秒是硬上限，不能不给读数）', !!has);
  const t1 = await p.$eval('#timerPill', (e) => e.textContent.trim());
  await p.waitForTimeout(2200);
  const t2 = await p.$eval('#timerPill', (e) => e.textContent.trim());
  const sec = (t) => { const m = t.match(/(\d+):(\d+)/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  check('无限反转：钟从 1:40 往下数', sec(t1) <= 100 && sec(t1) >= 95 && sec(t2) < sec(t1), `${t1} → ${t2}`);
  await c.close();
}

// ---- 5. 主菜单那张卡也改名了 ---------------------------------------------
await page.click('#navProfile');
await page.waitForSelector('.home-page', { timeout: 10000 });
const card = await page.$$eval('.home-icon-btn', (els) =>
  els.map((e) => e.getAttribute('aria-label') || '').find((l) => l.startsWith('老虎机模式')) || '');
check('主菜单那张卡叫《老虎机模式》', card.startsWith('老虎机模式'), card);
check('一路没报错', errors.length === 0, errors[0] || '');

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
