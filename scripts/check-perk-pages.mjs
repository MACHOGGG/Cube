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
 *   · 《更多得分目标》三列二十个图案；《更多布局》两个圆角框里各一张缩图；
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
    soon: [...document.querySelectorAll('.profile-row--locked .profile-row-label')].map((e) => e.textContent.trim()),
    oldRank: document.body.textContent.includes('世界排名和好友排名'),
  };
});
check('《随机得分目标》改叫《老虎机模式》', rows.random === '老虎机模式', rows.random);
check('《更多得分目标》《更多布局》点得开了', rows.targets === '更多得分目标' && rows.layouts === '更多布局',
  `${rows.targets} / ${rows.layouts}`);
check('《世界排名和好友排名》改叫《世界排名》，不再敬请期待',
  rows.rank === '世界排名' && !rows.oldRank && !rows.soon.includes('世界排名'), `${rows.rank}`);
check('没开通：做好了的四行行首都挂着锁',
  rows.randomLock && rows.targetsLock && rows.layoutsLock && rows.rankLock);
check('还在敬请期待的只剩四行', rows.soon.length === 4, rows.soon.join(' / '));

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
    // 三列并排，不是叠着。
    sameRow: (() => {
      const tops = [...document.querySelectorAll('.tgt-col')].map((c) => Math.round(c.getBoundingClientRect().top));
      return tops.length === 3 && tops.every((t) => t === tops[0]);
    })(),
  }));
  check('更多得分目标：方块 / 小球 / 三角三列并排', t.sameRow && t.cols.join(',') === 'square:8,circle:7,triangle:5', t.cols.join(' '));
  check('更多得分目标：二十个图案都画出来了', t.cells === 20 && t.drawn && t.heads === 3, `${t.cells} 格`);
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
    })),
  }));
  check('更多布局：两个圆角框，各装一张缩图',
    l.cards.length === 2 && l.cards.every((c) => c.svg && c.radius >= 8 && c.border !== 'none'),
    JSON.stringify(l.cards));
  check('更多布局：是菱形七色小球和 V 形三角',
    l.cards.map((c) => c.id).join(',') === 'circleSeven,triangleAdvanced' &&
      /七色圆球/.test(l.cards[0]?.name || '') && /进阶三角/.test(l.cards[1]?.name || ''),
    l.cards.map((c) => c.name).join(' / '));
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

// ---- 4. 主菜单那张卡也改名了 ---------------------------------------------
await page.click('#navProfile');
await page.waitForSelector('.home-page', { timeout: 10000 });
const card = await page.$$eval('.home-icon-btn', (els) =>
  els.map((e) => e.getAttribute('aria-label') || '').find((l) => l.startsWith('老虎机模式')) || '');
check('主菜单那张卡叫《老虎机模式》', card.startsWith('老虎机模式'), card);
check('一路没报错', errors.length === 0, errors[0] || '');

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
