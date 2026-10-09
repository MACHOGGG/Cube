/**
 * 降级那一下全盘重找，在**真棋盘**上走一遍（10-09 补充方案 6-3）。
 *
 *   npx vite --port 8952 --strictPort &            ← 必须是 **dev** 服务器，见下面那段
 *   node scripts/check-erosion-live.mjs http://localhost:8952/
 *
 * ⚠️ **手跑，不进 CI**（和 check-residue-live 一样：它要一台 vite dev 服务器，CI 里那几道浏览器门跑的
 * 都是 `dist`）。
 *
 * 方案原话：「方块基础局走到解锁 1×1，断言当场色块全部翻面、分数和连锁记录正确；降到 1×3 时，若盘面
 * 已有现成的 1×3，当场结算。」
 *
 * 连锁步进器加上「降级就全盘重找」那一下，check-erosion 第 ⑦ 节拿合成盘面在 node 里量过了；这一道补的
 * 是真棋盘那一头——方块自己的认组（findMatches 在图案 1 枚时认不认得出每一枚）、控制器真的接上了、屏幕
 * 上真的翻了、分数真的记了。
 *
 * ── 为什么是 dev 服务器 ───────────────────────────────────────
 *
 * 手摆盘面（`slides.devDeal`）和开局先扣几段（`slides.devErosion`）都藏在 `import.meta.env.DEV` 后面
 * （engine/devDeal.ts）——**正式包里根本不存在**：一个能手摆盘面、能把侵蚀拨到任意一级的入口在线上等
 * 于一个作弊器，而排行榜是真的。
 *
 * ── 两副盘面 ──────────────────────────────────────────────────
 *
 * 颜色按 (2r + c) mod 6 排（横着挨的差 1、竖着挨的差 2，哪儿都没有两枚同色挨着），星星翻出来的颜色另
 * 按 (r + 2c + 3) mod 6 排（全翻完也没有一整行一整列同色——不然会多出整线消除的分）。两副都拿
 * scratchpad 里的 design63.py 逐格验过：除了设计好的那几组，哪儿都凑不出组。
 *
 *   甲 先扣 31 段（在 1×2、剩 1 段）；(2,0) 换成 1 号。第 1 行往右滑一格，(1,5) 的 1 号转到 (1,0)，
 *      和 (2,0) 竖着挨成一组 1×2——只有这一组。翻这两枚就到 1 枚：场上剩下 34 枚色块当场全部翻掉。
 *      36 枚 × 2 = 72 分。
 *   乙 先扣 14 段（在 1×4、剩 1 段）；第 5 行左边三枚 0 号、(4,3) 也是 0 号，第 1 行左边三枚 4 号（现
 *      成的 1×3，1×4 的时候不算）。第 3 列往下滑一格，(4,3) 补进 (5,3)，第 5 行凑成 1×4——只有这一
 *      组。翻这四枚就降到 1×3：第 1 行那组现成的 1×3 不在这一步动过的格子上，照旧当场结算。7 枚 ×
 *      2 = 14 分，新一级 11 段扣掉 3 + 3 剩 5 段。
 */
import { chromium } from 'playwright';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('用法: node scripts/check-erosion-live.mjs http://localhost:8952/');
  console.error('⚠️ 要 **vite dev** 服务器（npx vite --port 8952 --strictPort），不是 dist。');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** `正面>星星` 一格（engine/devDeal.ts 的格式）。 */
const A = [
  '0>3 1>5 2>1 3>3 4>5 5>1',
  '2>4 3>0 4>2 5>4 0>0 1>2',
  '1>5 5>1 0>3 1>5 2>1 3>3',
  '0>0 1>2 2>4 3>0 4>2 5>4',
  '2>1 3>3 4>5 5>1 0>3 1>5',
  '4>2 5>4 0>0 1>2 2>4 3>0',
];
const B = [
  '0>3 1>5 2>1 3>3 4>5 5>1',
  '4>4 4>0 4>2 5>4 0>0 1>2',
  '4>5 5>1 0>3 1>5 2>1 3>3',
  '0>0 1>2 2>4 3>0 4>2 5>4',
  '2>1 3>3 4>5 0>1 0>3 1>5',
  '0>2 0>4 0>0 1>2 2>4 3>0',
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];

/** 一格此刻的面、颜色；分数、《得分图案》那一块念的数。 */
const READ = () => {
  const tiles = {};
  for (const el of document.querySelectorAll('#boardWrap .tile[data-r][data-c]')) {
    tiles[`${el.dataset.r},${el.dataset.c}`] = el.dataset.face;
  }
  const score = Number(document.querySelector('#scoreReel')?.dataset.score ?? NaN);
  const pattern = document.querySelector('#patternBlock')?.getAttribute('aria-label') ?? '';
  return { tiles, score, pattern, n: Number((pattern.match(/\d+/) || [NaN])[0]) };
};

async function open(rows, spent) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errs.push(String(e.message)));
  // reduced-motion：每一拍都立刻跑完。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ rows, spent }) => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
    for (const k of ['slides_played_square', 'slides_played_circle', 'slides_played_finished', 'slides_tutorial_seen', 'slides_tutorial_seen_circle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides.devDeal', JSON.stringify({ square: rows }));
    localStorage.setItem('slides.devErosion', String(spent));
  }, { rows, spent });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.$eval('.home-icon-btn[aria-label^="经典方块"]', (el) => el.click());
  await page.waitForSelector('#startBtn', { timeout: 15000, state: 'attached' });
  await page.$eval('#startBtn', (el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile[data-r][data-c]').length === 36, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  return page;
}

/** 从 (r0,c0) 那一枚的正中拖到 (r1,c1) 那一枚的正中（一格）。 */
async function drag(page, [r0, c0], [r1, c1]) {
  const at = await page.evaluate(([a, b]) => {
    const box = (r, c) => document.querySelector(`#boardWrap .tile[data-r="${r}"][data-c="${c}"]`).getBoundingClientRect();
    const p = box(...a);
    const q = box(...b);
    return { x0: p.left + p.width / 2, y0: p.top + p.height / 2, x1: q.left + q.width / 2, y1: q.top + q.height / 2 };
  }, [[r0, c0], [r1, c1]]);
  await page.mouse.move(at.x0, at.y0);
  await page.mouse.down();
  for (let k = 1; k <= 14; k++) await page.mouse.move(at.x0 + ((at.x1 - at.x0) * k) / 14, at.y0 + ((at.y1 - at.y0) * k) / 14);
  await page.mouse.up();
}

/** 等这一步的连锁走完：盘面和分数连着 600ms 不动。 */
async function settle(page) {
  let last = '';
  let since = Date.now();
  for (let k = 0; k < 80; k++) {
    await page.waitForTimeout(150);
    const sig = JSON.stringify(await page.evaluate(READ));
    if (sig !== last) {
      last = sig;
      since = Date.now();
    } else if (Date.now() - since >= 600) break;
  }
  return page.evaluate(READ);
}

const faces = (o) => Object.values(o.tiles);

console.log('甲 走到解锁 1×1：场上剩下的色块当场全部翻面');
{
  const page = await open(A, 31);
  const o0 = await page.evaluate(READ);
  check('甲（尺子）手摆那副牌生效了：36 枚全是色块', faces(o0).length === 36 && faces(o0).every((f) => f === 'flavor'), `${faces(o0).filter((f) => f === 'flavor').length} 枚色块`);
  check('甲（尺子）开局先扣的 31 段生效了：《得分图案》此刻是 2 枚', o0.n === 2, o0.pattern);
  await drag(page, [1, 0], [1, 1]);
  const o1 = await settle(page);
  const left = faces(o1).filter((f) => f === 'flavor').length;
  check('甲 那一组 1×2 一翻就到 1 枚：场上一枚色块都不剩', left === 0, `剩 ${left} 枚`);
  check('甲 《得分图案》到了 1 枚', o1.n === 1, o1.pattern);
  check('甲 分数是 36 枚 × 2 = 72（那一组 2 枚 + 剩下的 34 枚，没有整线消除）', o1.score === 72, String(o1.score));
  await page.close();
}

console.log('\n乙 降到 1×3：盘上那组现成的 1×3 当场结算');
{
  const page = await open(B, 14);
  const o0 = await page.evaluate(READ);
  check('乙（尺子）手摆那副牌生效了：36 枚全是色块', faces(o0).length === 36 && faces(o0).every((f) => f === 'flavor'));
  check('乙（尺子）开局先扣的 14 段生效了：《得分图案》此刻是 4 枚', o0.n === 4, o0.pattern);
  await drag(page, [0, 3], [1, 3]);
  const o1 = await settle(page);
  const flipped = Object.entries(o1.tiles).filter(([, f]) => f === 'dot').map(([k]) => k).sort();
  const want = ['1,0', '1,1', '1,2', '5,0', '5,1', '5,2', '5,3'].sort();
  check('乙 翻的正好是第 5 行那组 1×4 和第 1 行那组现成的 1×3（不在这一步动过的格子上）', flipped.join(' ') === want.join(' '), flipped.join(' '));
  check('乙 《得分图案》降到 3 枚', o1.n === 3, o1.pattern);
  check('乙 分数是 7 枚 × 2 = 14', o1.score === 14, String(o1.score));
  await page.close();
}

check('全程零报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
