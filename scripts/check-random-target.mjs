/**
 * 《随机得分目标》：挑图形 → 老虎机转两个 → 开局，认的就是转出来的那两个。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-random-target.mjs http://localhost:8817/
 *
 * 这条线最容易出的毛病是「转是转了，盘上还是老一套」——转盘那一页看着完全
 * 正常，进了局才发现得分图示还是这个玩法自己那两三个。所以这里量的是开局
 * 之后棋盘上那一排图示，而且要和「直接从主菜单开同一个玩法」的那一排比：
 * 一样就是没接上。
 *
 * 另外看住没开通的那一份：页面照样打得开、图形照样画出来，只是按不动——这
 * 是玩家自己定的规矩（做好了的东西谁都点得进来看）。
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

/** 棋盘上那一排得分图示，按它们画出来的形状取指纹。 */
const LEGEND = () =>
  [...document.querySelectorAll('.pattern-hint--a .ph-part .pattern-icon')]
    .map((e) => e.querySelector('svg')?.innerHTML.length + ':' + (e.getAttribute('aria-label') || ''));

async function openPage(page, genius) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('#randomRow', { timeout: 10000 });
  await page.click('#randomRow');
  await page.waitForSelector('.slot-page', { timeout: 8000 });
  await page.waitForTimeout(300);
}

// ---- 没开通：看得见，按不动 ----------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, false);
  const page = await ctx.newPage();
  await openPage(page, false);
  const m = await page.evaluate(() => ({
    shapes: document.querySelectorAll('.slot-shape').length,
    disabled: [...document.querySelectorAll('.slot-shape')].every((b) => b.disabled),
    locks: document.querySelectorAll('.slot-lock').length,
    cta: Boolean(document.getElementById('slotGenius')),
    tagline: document.querySelector('.slot-tagline')?.textContent?.trim(),
  }));
  check('没开通：三个图形照样画出来', m.shapes === 3, `${m.shapes} 个`);
  check('没开通：按不动', m.disabled);
  check('没开通：三个都挂着锁', m.locks === 3, `${m.locks} 把`);
  check('没开通：给得出去开通的路', m.cta);
  check('没开通：那句话在', m.tagline?.includes('4-3-2-1'), m.tagline || '（没有）');
  // 按下去不该转起来。
  await page.evaluate(() => document.querySelector('.slot-shape')?.dispatchEvent(
    new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(600);
  const spun = await page.evaluate(() => !document.getElementById('slotReels').hidden);
  check('没开通：点了也不会转', !spun);
  await ctx.close();
}

// ---- 天才：三个族各转一次，转完开局，盘上认的就是转出来的 ----------------
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

  // 甲、直接从主菜单开这个玩法，记下它自己那一排图示——标准答案的反面。
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
  await openPage(page, true);
  await page.click(`.slot-shape[data-family="${fam.key}"]`);
  await page.waitForFunction(() => !document.getElementById('slotGo').hidden, { timeout: 8000 });
  const spun = await page.evaluate(() => ({
    reels: [...document.querySelectorAll('.slot-reel svg')].length,
    note: document.getElementById('slotNote')?.textContent?.trim() || '',
  }));
  check(`${fam.name}：转出两个图案`, spun.reels === 2, `${spun.reels} 个`);
  // 分数是 ceil(枚数² ÷ 2)，所以只可能是 2/5/8/13/18… 这几个数。
  const pts = [...spun.note.matchAll(/(\d+)\s*分/g)].map((m) => Number(m[1]));
  const legal = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => Math.ceil((n * n) / 2)));
  check(`${fam.name}：两个都标了分`, pts.length === 2 && pts.every((p) => legal.has(p)),
    `${pts.join(' / ')} 分`);

  await page.click('#slotGo');
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
    { timeout: 30000 });
  await page.waitForTimeout(700);
  const drawn = await page.evaluate(LEGEND);
  check(`${fam.name}：盘上就摆着转出来的那两个`, drawn.length === 2, `${drawn.length} 个`);
  check(
    `${fam.name}：不是这个玩法自己那一套`,
    drawn.join('|') !== plain.join('|'),
    `转出来 ${drawn.length} 个 · 原本 ${plain.length} 个`,
  );
  check(`${fam.name}：一路没报错`, errors.length === 0, errors[0] || '');
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
