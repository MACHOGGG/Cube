/**
 * 《随机得分目标》：挑图形 → 老虎机在开局页上转 → 5-4-3-2-1 → 开局，认的
 * 就是轮子上停下来的那两个。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-random-target.mjs http://localhost:8817/
 *
 * 这条线最容易出的毛病是「转是转了，盘上还是老一套」——转盘那一幕看着完全
 * 正常，进了局才发现得分图示还是这个玩法自己那两三个。所以这里量两件事：
 * 轮子停下来的那两张，和开局之后棋盘上那一排——它们必须是同两个；而且要
 * 和「直接从主菜单开同一个玩法」的那一排不一样，一样就是根本没接上。
 *
 * 另外看住没开通的那一份：页面照样打得开、图形照样画出来，只是按下去开的是
 * 订阅那扇窗，不是一局游戏——这是玩家自己定的规矩（做好了的东西谁都点得进
 * 来看）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const seed = (genius) => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
  if (genius) {
    localStorage.setItem('slides_genius', JSON.stringify({
      active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'SLOTCHK',
    }));
  }
};

/** 棋盘上那一排得分图示，按它们的编号取指纹。 */
const LEGEND = () =>
  [...document.querySelectorAll('.pattern-hint--a .ph-part .pattern-icon')]
    .map((e) => e.getAttribute('aria-label') || '');

/** 三个轮子当前正对着窗口的那一张（transform 走了几格就是第几张）。 */
const REELS = () =>
  [...document.querySelectorAll('.slot-reel')].map((r) => {
    const strip = r.querySelector('.slot-strip');
    const cell = r.getBoundingClientRect().height || 1;
    const y = Math.abs(parseFloat((strip.style.transform.match(/-?[\d.]+/) || [0])[0])) || 0;
    const k = Math.round(y / cell);
    const cellEl = strip.children[k];
    return {
      set: r.classList.contains('slot-reel--set'),
      label: cellEl?.querySelector('[aria-label]')?.getAttribute('aria-label') || '',
    };
  });

async function openPage(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('#randomRow', { timeout: 10000 });
  await page.click('#randomRow');
  await page.waitForSelector('.slot-page', { timeout: 8000 });
  await page.waitForTimeout(300);
}

// ---- 没开通：看得见，但开不了局 ------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, false);
  const page = await ctx.newPage();
  await openPage(page);
  const m = await page.evaluate(() => ({
    opts: document.querySelectorAll('.slot-pick-opt').length,
    locks: document.querySelectorAll('.slot-pick-lock').length,
    machine: Boolean(document.querySelector('.slot-page .slot-machine')),
    art: Boolean(document.querySelector('.slot-machine-art svg')),
    // 这一屏只该有一颗键（挑图形那三张不算「额外的按钮」）。
    extras: [...document.querySelectorAll('.slot-page button')]
      .filter((b) => !b.classList.contains('slot-pick-opt')).length,
    nav: getComputedStyle(document.querySelector('.home-nav')).display,
  }));
  check('没开通：三个图形照样画出来', m.opts === 3, `${m.opts} 个`);
  check('没开通：三个都挂着锁', m.locks === 3, `${m.locks} 把`);
  check('那台老虎机就是给的那张图', m.machine && m.art);
  check('底下只有一颗《退出》', m.extras === 1, `${m.extras} 颗`);
  check('这一屏不留底排导航', m.nav === 'none', m.nav);

  await page.click('.slot-pick-opt[data-family="square"]');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    board: document.querySelectorAll('#boardWrap .tile').length,
    paywall: Boolean(document.querySelector('.auth-modal, .subscribe, .genius-window, .overlay .modal')),
  }));
  check('没开通：点了不会开局', after.board === 0, `${after.board} 块`);
  await ctx.close();
}

// ---- 天才：三个族各走一遍 -------------------------------------------------
const FAMILIES = [
  { key: 'square', name: '方块' },
  { key: 'circle', name: '圆球' },
  { key: 'triangle', name: '三角' },
];
for (const fam of FAMILIES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, true);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 甲、直接从主菜单开这个玩法，记下它自己那一排图示——反面的标准答案。
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.$$eval('.home-icon-btn', (els, n) =>
    els.find((e) => e.getAttribute('aria-label') === n)?.click(), fam.name);
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
    { timeout: 25000 });
  await page.waitForTimeout(700);
  const plain = await page.evaluate(LEGEND);

  // 乙、走一遍老虎机。
  await openPage(page);
  await page.click(`.slot-pick-opt[data-family="${fam.key}"]`);
  await page.waitForSelector('#startOverlay .slot-machine', { timeout: 8000 });

  // 倒数从 5 起——比别的玩法多一秒，那一秒就是让轮子停完的。
  await page.waitForFunction(() => document.querySelector('#startCount .cd-digit'), { timeout: 4000 });
  const first = await page.evaluate(() => document.querySelector('#startCount .cd-digit')?.textContent);
  check(`${fam.name}：倒数从 5 起`, first === '5', first || '（没数）');

  // 从左到右先后停：第一个停住的时候，第二、第三个还在转。
  await page.waitForFunction(() => document.querySelectorAll('.slot-reel--set').length === 1, { timeout: 4000 });
  const staggered = await page.evaluate(() =>
    [...document.querySelectorAll('.slot-reel')].map((r) => r.classList.contains('slot-reel--set')));
  check(`${fam.name}：从左到右一个一个停`, staggered[0] && !staggered[1] && !staggered[2],
    staggered.map((b) => (b ? '停' : '转')).join(''));

  await page.waitForFunction(() => document.querySelectorAll('.slot-reel--set').length === 3, { timeout: 6000 });
  const reels = await page.evaluate(REELS);
  const spun = [reels[0].label, reels[1].label];
  check(`${fam.name}：左边两个转出两个不同的图案`,
    spun[0] && spun[1] && spun[0] !== spun[1], spun.join(' / ') || '（空）');

  // 开局：倒数完自己会把局叫起来。
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
    { timeout: 30000 });
  await page.waitForTimeout(700);
  const drawn = await page.evaluate(LEGEND);
  check(`${fam.name}：盘上认的就是轮子上停下来的那两个`,
    drawn.length === 2 && drawn.slice().sort().join('|') === spun.slice().sort().join('|'),
    `盘上 ${drawn.join('/')} · 轮子 ${spun.join('/')}`);
  check(`${fam.name}：不是这个玩法自己那一套`,
    drawn.join('|') !== plain.join('|'),
    `转出来 ${drawn.length} 个 · 原本 ${plain.length} 个`);
  check(`${fam.name}：一路没报错`, errors.length === 0, errors[0] || '');
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
