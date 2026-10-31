/**
 * 首玩记号不许白白烧掉（10-31 方案推06 Z-C04 ③④，站长 10-14 J-2、10-22 Q1）。
 *
 *   node scripts/dev-server.mjs 8939 dist
 *   node scripts/check-first-play-burn.mjs http://localhost:8939/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 站长 10-14：「在微信点开……有新手拦截但点开后没有新手教学。」能复现出同样画面的两条路：
 *
 *   A 首玩记号写早了。原先点卡那一刻就写 slides_played_square 和 slides_tutorial_seen（main.ts 的 basicCoach），
 *     倒数中退出、打到一半刷新，记号就被用掉了——下次再点方块，教学条没了，可这时候他一局都没打完过。
 *   B 同一份存储开着两个页面：一页写了记号，另一页的主菜单不跟着变，还摆着拦截和那圈光。
 *
 * 站长 10-22 Q1 定的口径：**只有走到结算页才写「看过」**。10-31 方案推12 起主菜单一步一步出现（engine/menuStage.ts）：
 * 新人第 1 步菜单上只有小球一张，所以这道门量的是小球那一局。量：
 *
 *   1. 倒数中按《<》、history.back()、整页刷新三种退法：本机没有 slides_played_circle、没有 slides_tutorial_seen*、
 *      也没有 slides_cvd_offer（色盲开关「数完才记」，10-18 T2）；菜单上《我会玩》还在、只有小球一张、亮着；再点
 *      小球 → 教学条摆着、五段、第 1 条是站长原话（附录甲 §15）。
 *   2. 开打以后、走到结算页之前刷新：首玩记号同上一个都没写。色盲开关那一把这时已经写了——倒数数完、真开局了，
 *      照 10-18 T2「数完才记」（方案推06 ③：这一条口径不改，两种口径并存，C-25），所以这一节反过来断言它是 "1"。
 *   3. 打到结算页（暂停 →《结束游戏》）：slides_played_circle、slides_tutorial_seen_circle 都写上了；回主菜单是第 2 步——
 *      方块出现、亮光，小球熄光。
 *   4. 两个页面（同一个浏览器上下文，共用一份 localStorage）：甲走到结算页之后，乙的主菜单当场跟着到第 2 步（方块出现、
 *      亮着）——乙一下都没碰（storage 事件）。
 *
 * 反证（手跑，记在提交说明里）：把 basicCoach 改回点卡那一刻就写记号，第 1 节红；把主菜单的 storage 监听摘掉，
 * 第 4 节红。（推06 那一版量的是方块——那时候新人菜单上两张基础卡都在。）
 *
 * **什么键都不预设，只设语言**（CLAUDE.md「跑门时的坑」第四条：预设 slides_tutorial_seen 会把头一局那块教学条
 * 整个关掉）。倒数页上会有色盲开关（10-18 T2），所以不断言「倒数页上没有别的」。
 * ─────────────────────────────────────────────────────────────────────────
 */
import { chromium } from 'playwright';

const arg = process.argv[2] || '8939';
const BASE = /^\d+$/.test(arg) ? `http://127.0.0.1:${arg}/` : arg.replace(/\/*$/, '/');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
const open = async () => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  return p;
};
const page = await open();

/** 从头做人：只留语言。 */
async function fresh(p) {
  await p.goto(BASE, { waitUntil: 'load' });
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
  });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
}
async function toMenu(p) {
  await p.waitForSelector('.home-page .home-icon-btn', { timeout: 30000 });
  await p.waitForTimeout(300);
}
/** 在页面里自己 click()（主菜单是鱼眼轴时，离焦点远的卡坐在视口外；check-first-play 那段说明）。 */
const tapCircle = (p) => p.$eval('#homeGrid [data-card="circle"]', (e) => e.click());
/** 点小球，停在倒数页上（还没数完）。 */
async function intoCountdown(p) {
  await tapCircle(p);
  await p.waitForSelector('#startOverlay.show', { timeout: 20000 });
  await p.waitForTimeout(400);
}
/** 本机这几把钥匙此刻是什么。 */
const marks = (p) => p.evaluate(() => {
  const keys = Object.keys(localStorage);
  return {
    played: localStorage.getItem('slides_played_circle'),
    tutorial: keys.filter((k) => k.startsWith('slides_tutorial_seen')),
    cvd: localStorage.getItem('slides_cvd_offer'),
  };
});
/** 主菜单此刻的样子：《我会玩》在不在、摆着哪几张、哪几张亮着。 */
const menu = (p) => p.evaluate(() => ({
  onMenu: !!document.querySelector('.home-page'),
  knowHow: !!document.querySelector('.know-how-btn'),
  cards: [...document.querySelectorAll('#homeGrid [data-card]')].map((c) => c.dataset.card),
  glow: [...new Set([...document.querySelectorAll('.home-icon-btn--glow')].map((b) => b.getAttribute('aria-label')))],
}));
/** 量一遍「什么都没烧掉」：记号、菜单、再点方块那一局的教学条。 */
async function unburnt(p, tag, { counted = false } = {}) {
  const m = await marks(p);
  check(`${tag}：没写 slides_played_circle`, m.played === null, String(m.played));
  check(`${tag}：没写 slides_tutorial_seen*`, m.tutorial.length === 0, m.tutorial.join(','));
  if (counted) check(`${tag}：色盲开关那一把照 T2 已经写了（倒数数完、真开了局）`, m.cvd === '1', String(m.cvd));
  else check(`${tag}：没写 slides_cvd_offer（色盲开关没数完不算见过）`, m.cvd === null, String(m.cvd));
  const v = await menu(p);
  check(`${tag}：回到主菜单，《我会玩》还在、仍是第 1 步（只有小球）`, v.onMenu && v.knowHow && v.cards.join() === 'circle', JSON.stringify(v));
  check(`${tag}：小球还亮着`, v.glow.join() === '经典小球', JSON.stringify(v.glow));
  await tapCircle(p);
  await p.waitForSelector('.coach-bar:not([hidden])', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(500);
  const c = await p.evaluate(() => ({
    shown: !!document.querySelector('.coach-bar:not([hidden])'),
    segs: document.querySelectorAll('.coach-seg').length,
    first: document.querySelector('.coach-row:not([hidden]) .coach-text')?.textContent.trim() ?? '',
  }));
  check(`${tag}：再点小球，教学条照旧摆着`, c.shown, JSON.stringify(c));
  check(`${tag}：五段进度`, c.segs === 5, String(c.segs));
  check(`${tag}：第 1 条是站长原话`, c.first === '同色的色块或星星连起得分图案可以得分', c.first);
}
/** 暂停 →《结束游戏》→ 结算页。 */
async function finish(p) {
  await p.$eval('#stopBtn', (e) => e.click());
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.$eval('#pauseFinishBtn', (e) => e.click());
  await p.waitForSelector('#endOverlay.show', { timeout: 15000 });
  await p.waitForTimeout(400);
}

// ── 1. 倒数中退出：三种退法 ──────────────────────────────────────────────
await fresh(page);
{
  const v = await menu(page);
  check('（尺子）新人进来：《我会玩》在、只有小球一张、亮着', v.knowHow && v.cards.join() === 'circle' && v.glow.join() === '经典小球', JSON.stringify(v));
}
await intoCountdown(page);
await page.$eval('#startBackBtn', (e) => e.click());
await toMenu(page);
await unburnt(page, '1 倒数中按《<》');

await fresh(page);
await intoCountdown(page);
await page.evaluate(() => history.back());
await toMenu(page);
await unburnt(page, '1 倒数中 history.back()');

await fresh(page);
await intoCountdown(page);
await page.reload({ waitUntil: 'load' });
await toMenu(page);
await unburnt(page, '1 倒数中刷新');

// ── 2. 开打以后、走到结算页之前刷新 ───────────────────────────────────────
await fresh(page);
await tapCircle(page);
await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 30000 });
await page.waitForTimeout(1500);
check('（尺子）2 这一局真开打了（倒数数完、条子摆着）', !(await page.$('#startOverlay.show')));
await page.reload({ waitUntil: 'load' });
await toMenu(page);
// unburnt 最后又点开了一局小球（停在开打以后）——第 3 节就接着用这一局。
await unburnt(page, '2 打到一半刷新', { counted: true });

// ── 3. 走到结算页才写 ─────────────────────────────────────────────────
await finish(page);
{
  const m = await marks(page);
  check('3 走到结算页：slides_played_circle 写上了', m.played === '1', String(m.played));
  check('3 走到结算页：slides_tutorial_seen_circle 写上了', m.tutorial.includes('slides_tutorial_seen_circle'), m.tutorial.join(','));
  await page.$eval('#endBackBtn', (e) => e.click());
  await toMenu(page);
  const v = await menu(page);
  check('3 回主菜单是第 2 步：方块出现、亮光，小球熄光', v.cards.join() === 'square,circle' && v.glow.join() === '经典方块', JSON.stringify(v));
}

// ── 4. 两个页面：甲写了，乙的主菜单跟上 ────────────────────────────────
await fresh(page);
const other = await open();
await other.goto(BASE, { waitUntil: 'load' });
await toMenu(other);
{
  const v = await menu(other);
  check('（尺子）4 乙打开时：第 1 步（只有小球、亮着）', v.knowHow && v.cards.join() === 'circle' && v.glow.includes('经典小球'), JSON.stringify(v));
}
await tapCircle(page);
await page.waitForSelector('.coach-bar:not([hidden])', { timeout: 30000 });
await page.waitForTimeout(800);
{
  // 甲打到一半：乙不该动（记号还没写）。
  const v = await menu(other);
  check('4 甲打到一半：乙的主菜单照旧（记号还没写）', v.cards.join() === 'circle', JSON.stringify(v));
}
await finish(page);
await other.waitForFunction(() => !!document.querySelector('#homeGrid [data-card="square"]'), null, { timeout: 5000 }).catch(() => {});
{
  const v = await menu(other);
  check('4 甲走到结算页之后：乙的主菜单跟着到第 2 步（方块出现、亮着）', v.onMenu && v.cards.join() === 'square,circle' && v.glow.includes('经典方块'), JSON.stringify(v));
  check('4 乙那张小球不再亮', !v.glow.includes('经典小球'), JSON.stringify(v.glow));
}

check('全程零报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
