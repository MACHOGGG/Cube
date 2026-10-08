/**
 * 屋主替小屋挑玩法时，主菜单顶上那条横幅：两颗键手指按得着（2026-10-08）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8999 dist      （内存版，TESTMONTH 只能兑一次——一台新服务器）
 *   node scripts/check-room-pick-tap.mjs http://localhost:8999/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 手机竖屏的主菜单是那条鱼眼轴（.mode-axis）：它用一截负外边距把自己顶到视口最上沿（modeAxis 的
 * measure），整屏都是它的盒子；它又是定位元素（position: relative + z-index: 0）。横幅
 * （#roomPickBar）原先什么都没写，没定位的块画在定位元素底下——看得见，按不着：「小屋里」「离开小
 * 屋」两颗键的落点全被轴吃掉，手指按上去是在拖轴。屋主挑玩法挑到一半，回不去小屋、也走不了。
 * Playwright 的 page.click 一样会被截走（check-disband-retry 当初就是这么撞见的）。
 *
 * 所以这一台用真的手机（isMobile + hasTouch）、真的手指（触摸事件，不是 el.click()）：
 *
 *   ①（尺子）走的是鱼眼轴那一版，而且轴的盒子真的铺过横幅那一带——不然这道门绿，可能只是因为
 *      根本没叠上。
 *   ① 静止时：两颗键正中那一点，最上面那一层就是键自己。
 *   ② 按在轴上往上推一把，让卡片滑进横幅那一带（尺子：真有一张卡和横幅叠上了——轴也还拖得动），
 *      再量一遍。
 *   ③ 手指点「小屋里」：回到小屋页（横幅收了，#mpPick 又在）。
 *   ④ 再进来、再推一把，手指点「离开小屋」：那一问出来了（按「留下」收起，不真走）。
 *   ⑤ 换一块小屏（360×640，算掉浏览器那几条之后的可视尺寸）再量 ①②。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-room-pick-tap.mjs http://localhost:8999/');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('gate_primed') === '1') return;
  sessionStorage.setItem('gate_primed', '1');
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#navProfile', { timeout: 20000 });
// 开小屋要天才：兑一张内部码。
const granted = await page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return false;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
  return true;
});
check('（尺子）TESTMONTH 兑到了开屋的权限', granted);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#navProfile', { timeout: 20000 });
await page.$eval('#navProfile', (e) => e.click());
await page.waitForSelector('#multiRow', { timeout: 10000 });
await page.$eval('#multiRow', (e) => e.click());
await page.waitForSelector('#mpCreate', { timeout: 10000 });
await page.fill('#mpName', '甲');
await page.$eval('#mpCreate', (e) => e.click());
await page.waitForSelector('.mp-code', { timeout: 10000 });

/** 从小屋页按《挑玩法》，回到主菜单、横幅挂上，等轴量完自己。 */
async function toPicking() {
  await page.$eval('#mpPick', (e) => e.click());
  await page.waitForSelector('#roomPickBar', { timeout: 8000 });
  await page.waitForTimeout(1200);
}

// 真的手指：CDP 的触摸事件（轴认的是 pointer，触摸来的 pointer 和鼠标来的走同一条路，但这一台
// 量的是手机，就用手机的那一种）。
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
/** 按在 (x, y0)，一路拖到 (x, y1)，松手，等轴落定。 */
async function swipe(x, y0, y1, steps = 20) {
  await touch('touchStart', x, y0);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd');
  await page.waitForTimeout(1500);
}

/** 横幅这一带的情况：两颗键正中那一点最上面是谁、轴铺没铺过来、有没有卡片和它叠着。 */
const band = () =>
  page.evaluate(() => {
    const bar = document.getElementById('roomPickBar');
    const axis = document.querySelector('#homeGrid.mode-axis');
    if (!bar) return null;
    const b = bar.getBoundingClientRect();
    const top = (id) => {
      const el = document.getElementById(id);
      if (!el) return { self: false, who: '（没有这颗键）' };
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { self: Boolean(t && (t === el || el.contains(t))), who: t ? t.id || String(t.className) : 'null' };
    };
    const a = axis?.getBoundingClientRect();
    const cards = axis
      ? [...axis.querySelectorAll(':scope > .home-icon-btn')].filter((c) => {
          const r = c.getBoundingClientRect();
          return r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right;
        }).map((c) => c.getAttribute('aria-label') || '')
      : [];
    return {
      axis: Boolean(axis),
      covers: Boolean(a && a.top <= b.top && a.bottom >= b.bottom),
      back: top('roomPickBack'),
      leave: top('roomPickLeave'),
      cards,
    };
  });
/** 一颗键正中，视口坐标。 */
const centerOf = (sel) =>
  page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

/** ①② 在一块屏上量一遍。 */
async function measure(tag, w, h) {
  const rest = await band();
  check(`${tag}①（尺子）走的是鱼眼轴那一版，轴的盒子铺过横幅那一带`, Boolean(rest?.axis && rest.covers), JSON.stringify(rest));
  check(`${tag}① 静止时：「小屋里」正中最上面是它自己`, Boolean(rest?.back.self), rest?.back.who);
  check(`${tag}① 静止时：「离开小屋」正中最上面是它自己`, Boolean(rest?.leave.self), rest?.leave.who);
  // 按在轴的下半截（横幅那一带以外）往上推，卡片跟着往上走、滑进横幅那一带。
  await swipe(w / 2, h * 0.77, h * 0.39);
  const moved = await band();
  check(`${tag}②（尺子）推了一把，真有卡片滑进横幅那一带`, (moved?.cards.length ?? 0) > 0, (moved?.cards ?? []).join('、'));
  check(`${tag}② 卡片在底下滑过：「小屋里」正中最上面仍是它自己`, Boolean(moved?.back.self), moved?.back.who);
  check(`${tag}② 卡片在底下滑过：「离开小屋」正中最上面仍是它自己`, Boolean(moved?.leave.self), moved?.leave.who);
}

// ── ①② 390×844 ─────────────────────────────────────────────────────────
await toPicking();
await measure('390×844 · ', 390, 844);

// ── ③ 手指点「小屋里」 ─────────────────────────────────────────────────
{
  const p = await centerOf('#roomPickBack');
  await page.touchscreen.tap(p.x, p.y);
  const back = await page
    .waitForFunction(() => !document.getElementById('roomPickBar') && Boolean(document.getElementById('mpPick')), null, { timeout: 8000 })
    .then(() => true).catch(() => false);
  check('③ 手指点「小屋里」：回到了小屋页', back);
  // 没点着的话横幅还挂着：替它按一下（不量这一下），后面几条照样量完。
  if (!back) {
    await page.$eval('#roomPickBack', (e) => e.click()).catch(() => {});
    await page.waitForSelector('#mpPick', { timeout: 8000 }).catch(() => {});
  }
}

// ── ④ 手指点「离开小屋」 ───────────────────────────────────────────────
await toPicking();
await swipe(195, 650, 330);
{
  const p = await centerOf('#roomPickLeave');
  await page.touchscreen.tap(p.x, p.y);
  const asked = await page.waitForSelector('#mpLeaveYes', { timeout: 8000 }).then(() => true).catch(() => false);
  // 旧的那一版里这一下更糟：手指落在横幅底下那张卡上，「离开小屋」反而替小屋挑了那个玩法。
  const where = asked ? '' : await page.evaluate(() => (document.getElementById('roomPickBar') ? '还在主菜单' : '主菜单都不在了'));
  check('④ 手指点「离开小屋」：那一问出来了', asked, where);
  if (asked) {
    await page.$eval('#mpLeaveNo', (e) => e.click());
    await page.waitForTimeout(400);
    check('④（尺子）按「留下」：那一问收起来了，横幅还挂着',
      !(await page.$('#mpLeaveYes')) && Boolean(await page.$('#roomPickBar')));
  }
}

// ── ⑤ 小屏 360×640 ─────────────────────────────────────────────────────
// 换屏之前先回小屋页再进来：横幅和轴都按新的屏重新摆一遍，不量「转屏中途」那一拍。
await page.$eval('#roomPickBack', (e) => e.click()).catch(() => {});
const inRoom = await page.waitForSelector('#mpPick', { timeout: 8000 }).then(() => true).catch(() => false);
if (inRoom) {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(600);
  await toPicking();
  await measure('360×640 · ', 360, 640);
} else {
  check('⑤ 回得到小屋页、换小屏再量（前面那一下把页面带走了）', false);
}

check('全程零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
