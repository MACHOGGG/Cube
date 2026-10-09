/**
 * 六边圆球中心那颗空心球：画在洞位上，碰不着（2026-10-08 方案 2-4 B）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8988 dist
 *   node scripts/check-hex-hole.mjs http://localhost:8988/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 《侵蚀阶梯》「格子离场」那一版把空位一律不画了，六边圆球中心那个**永久**空位也跟着没了——
 * 盘中间空出一个洞，看着像缺了一枚。玩家 2026-10-08 拍板 (a)：中心画回一颗空心球，**纯视觉**：
 * 不可停留、不可翻，引擎一个字不动。
 *
 * 「纯视觉」有两头要守，两头错了都不报错：
 *
 *   · 画出来了、画对了地方：在洞位上、和旁边的球一样大、真的是一圈（截图量像素，不量 DOM 上
 *     有没有那个元素——元素在、样式掉了，屏幕上照样什么都没有）；
 *   · 碰不着：它不是棋子（不挂 `.ball`、不挂 `data-r/c`，机器人和几道门都按这两样认棋子），
 *     手指按在它上面落到的是底下的棋盘——按在洞上拖，什么都不动。尺子：按在旁边那枚真球上
 *     同样一拖，那一行真的滑了，而且滑完洞还在原地、没有哪一枚停在洞上。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-hex-hole.mjs http://localhost:8988/');
  process.exit(2);
}
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  // 头一局那块教学条会在棋盘底下多摆一行字，量的不是它（CLAUDE.md「跑门时的坑」里那一条反过来
  // 用：这儿就是要关掉它）。
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle',
    'slides_played_square', 'slides_played_circle', 'slides_know_how']) localStorage.setItem(k, '1');
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
// el.click()，不用 page.click()：手机竖屏的主菜单是一条鱼眼轴，远处的卡在视口外面。
const opened = await page.$$eval('.home-icon-btn', (els) => {
  const el = els.find((e) => (e.getAttribute('aria-label') || '').trim() === '六边形小球');
  if (!el) return false;
  el.click();
  return true;
});
check('（尺子）主菜单上找得到《六边圆球》', opened);
await page.waitForTimeout(500);
if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
const up = await page
  .waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
check('（尺子）棋盘出来了', up);
await page.waitForTimeout(600);

/** 此刻盘上每一枚：行列 → 颜色和面。认棋子只认 data-r/c（和机器人一个口径）。 */
const snapshot = () =>
  page.$$eval('#boardWrap [data-r][data-c]', (els) =>
    Object.fromEntries(els.map((e) => [e.dataset.r + ',' + e.dataset.c, getComputedStyle(e).backgroundColor + '|' + e.dataset.face])));
const rectOf = (sel) =>
  page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  });

// ── ① 画出来了、画对了地方 ───────────────────────────────────────────────
const dom = await page.evaluate(() => {
  const holes = [...document.querySelectorAll('#boardWrap .hex-hole')];
  const h = holes[0];
  return {
    holes: holes.length,
    pieces: document.querySelectorAll('#boardWrap [data-r][data-c]').length,
    isBall: Boolean(h && h.classList.contains('ball')),
    hasRC: Boolean(h && (h.dataset.r !== undefined || h.dataset.c !== undefined)),
    pe: h ? getComputedStyle(h).pointerEvents : '',
    onTop: h ? h === h.parentElement.lastElementChild : false,
    firstBall: h ? [...h.parentElement.children].indexOf(h) < [...h.parentElement.children].findIndex((e) => e.dataset.r !== undefined) : false,
  };
});
check('① 盘上有一颗、只有一颗空心球', dom.holes === 1, `${dom.holes} 颗`);
check('①（尺子）棋子照旧是 36 枚（空心球不算一枚）', dom.pieces === 36, `${dom.pieces} 枚`);
check('① 它不是棋子：不挂 .ball，不挂 data-r / data-c', !dom.isBall && !dom.hasRC, JSON.stringify(dom));
check('① 它不接手指（pointer-events: none）', dom.pe === 'none', dom.pe);
check('① 它压在所有棋子底下（拖动时球从它上面滑过去）', dom.firstBall, JSON.stringify(dom));

const hole = dom.holes ? await rectOf('#boardWrap .hex-hole') : null;
const left = await rectOf('#boardWrap [data-r="3"][data-c="2"]');
const right = await rectOf('#boardWrap [data-r="3"][data-c="4"]');
const mid = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
check('① 在洞位上：正好在中间一行左右两枚的正中', hole && Math.abs(hole.x - mid.x) < 1.5 && Math.abs(hole.y - mid.y) < 1.5,
  hole ? `空心球 (${hole.x.toFixed(1)}, ${hole.y.toFixed(1)})、两枚中点 (${mid.x.toFixed(1)}, ${mid.y.toFixed(1)})` : '没有');
check('① 和旁边的球一样大', hole && Math.abs(hole.w - left.w) < 1 && Math.abs(hole.h - left.h) < 1,
  hole ? `${hole.w.toFixed(1)}×${hole.h.toFixed(1)} / ${left.w.toFixed(1)}×${left.h.toFixed(1)}` : '');

// 截图量像素：一圈有颜色、圈里是空的。
if (hole) {
  const pad = 4;
  const clip = { x: hole.x - hole.w / 2 - pad, y: hole.y - hole.h / 2 - pad, width: hole.w + 2 * pad, height: hole.h + 2 * pad };
  const shot = await page.screenshot({ clip });
  const r = hole.w / 2;
  const cx = hole.w / 2 + pad;
  const cy = hole.h / 2 + pad;
  // 一圈上取四个点（右、左、上、下，各在圈宽的正中），圈里取正中一点。
  const pts = [[cx + r - 1.5, cy], [cx - r + 1.5, cy], [cx, cy - r + 1.5], [cx, cy + r - 1.5], [cx, cy]];
  const px = await page.evaluate(async ({ b64, pts }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    return pts.map(([x, y]) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)));
  }, { b64: shot.toString('base64'), pts });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const inside = px[4];
  const ringDiff = px.slice(0, 4).map((p) => dist(p, inside));
  check('① 截图上真的是一圈：圈上四个点都和圈里明显不一样', ringDiff.every((d) => d > 40),
    `圈上 ${px.slice(0, 4).map((p) => p.join(',')).join(' / ')}，圈里 ${inside.join(',')}，差 ${ringDiff.map((d) => d.toFixed(0)).join('/')}`);
  // 圈里是空的：和棋盘的底色一样（取洞和右边那枚球之间那道缝当底色）。
  const gapShot = await page.screenshot({ clip: { x: (hole.x + hole.w / 2 + right.x - right.w / 2) / 2 - 1, y: hole.y - 1, width: 3, height: 3 } });
  const gap = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(1, 1, 1, 1).data.slice(0, 3));
  }, gapShot.toString('base64'));
  check('① 圈里是空的（和棋盘底色一样，不是一枚实心的暗球）', dist(inside, gap) < 12, `圈里 ${inside.join(',')}、底色 ${gap.join(',')}`);
}

// ── ② 碰不着 ─────────────────────────────────────────────────────────────
if (hole) {
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? (el.className || el.tagName) + '' : '';
  }, hole);
  check('② 洞的正中按下去，按到的不是那颗空心球', !/hex-hole/.test(hit), hit);

  const step = (right.x - left.x) / 2; // 一格的宽
  const drag = async (from) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + step * 1.05, from.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(900);
  };
  const before = await snapshot();
  await drag(hole);
  const afterHole = await snapshot();
  check('② 按在洞上往右拖一格：什么都没动', JSON.stringify(before) === JSON.stringify(afterHole));

  // 尺子：同样一拖，按在左边那一枚真球上——那一行真的滑了（证明上一条不是因为拖法不对才没动）。
  const leftNow = await rectOf('#boardWrap [data-r="3"][data-c="1"]');
  await drag(leftNow);
  const afterBall = await snapshot();
  const rowChanged = Object.keys(afterBall).some((k) => k.startsWith('3,') && afterBall[k] !== before[k]);
  check('②（尺子）同样一拖按在真球上：那一行真的滑了', rowChanged);
  const holeNow = await rectOf('#boardWrap .hex-hole').catch(() => null);
  check('② 滑完洞还在原地', holeNow && Math.abs(holeNow.x - hole.x) < 1.5 && Math.abs(holeNow.y - hole.y) < 1.5,
    holeNow ? `(${holeNow.x.toFixed(1)}, ${holeNow.y.toFixed(1)})` : '没了');
  check('② 没有哪一枚停在洞上（盘上没有 [3,3] 那一枚）', !(await page.$('#boardWrap [data-r="3"][data-c="3"]')));
  check('② 棋子照旧是 36 枚', Object.keys(afterBall).length === 36, `${Object.keys(afterBall).length} 枚`);
}

check('全程零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
