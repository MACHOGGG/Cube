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

/** 个人主页 → 《老虎机模式》那一行 → 介绍页（三台转着的机器）。 */
async function openIntro(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('#randomRow', { timeout: 10000 });
  await page.click('#randomRow');
  await page.waitForSelector('.slot-intro-page', { timeout: 8000 });
  await page.waitForTimeout(300);
}

// ---- 没开通：看得见，但开不了局 ------------------------------------------
//
// 介绍页：三台机器上下排着、都在转，底下一颗红色 STOP；按下去三台从上到下一
// 台一台停稳，键变成绿色的《开始》，再按又转起来。没开通的人没有右下角那颗
// 《开始 〉》——看得见这一幕，开不了局。
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, false);
  const page = await ctx.newPage();
  await openIntro(page);
  const m = await page.evaluate(() => ({
    machines: document.querySelectorAll('.slot-intro-item .slot-machine').length,
    reels: document.querySelectorAll('.slot-intro-item .slot-reel').length,
    spinning: [...document.querySelectorAll('.slot-intro-item .slot-strip')].every((s) => s.children.length > 0),
    set: document.querySelectorAll('.slot-intro-item .slot-reel--set').length,
    btn: document.getElementById('slotDemoBtn')?.textContent.trim(),
    red: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--stop')),
    go: Boolean(document.getElementById('slotGo')),
    icons: document.querySelectorAll('.slot-pick-opt').length,
    nav: getComputedStyle(document.querySelector('.home-nav')).display,
    // 三台一样宽、上下等距、左右居中。
    boxes: [...document.querySelectorAll('.slot-intro-item')].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), w: Math.round(r.width), t: Math.round(r.top), b: Math.round(r.bottom) };
    }),
    mid: Math.round(document.documentElement.clientWidth / 2),
  }));
  check('没开通：三台机器、六个轮子', m.machines === 3 && m.reels === 6, `${m.machines} 台 · ${m.reels} 个轮子`);
  check('没开通：进来就都在转', m.spinning && m.set === 0, `停稳 ${m.set} 个`);
  check('没开通：三台一样宽、左右居中',
    m.boxes.every((b) => b.w === m.boxes[0].w && Math.abs(b.x - m.mid) <= 1), JSON.stringify(m.boxes));
  check('没开通：上下等距',
    m.boxes.length === 3 && Math.abs((m.boxes[1].t - m.boxes[0].b) - (m.boxes[2].t - m.boxes[1].b)) <= 1,
    `${m.boxes[1]?.t - m.boxes[0]?.b} / ${m.boxes[2]?.t - m.boxes[1]?.b}`);
  check('没开通：底下一颗红色 STOP', m.btn === 'STOP' && m.red, `${m.btn} · ${m.red ? '红' : '不红'}`);
  check('没开通：没有右下角那颗《开始 〉》', !m.go);
  check('这一屏上没有三张图（那是下一屏的事）', m.icons === 0, `${m.icons} 张`);
  check('这一屏不留底排导航', m.nav === 'none', m.nav);

  // 按 STOP：三台从上到下一台一台停。记下每台「两个轮子都停稳」的先后。
  await page.evaluate(() => {
    const w = window;
    w.__order = [];
    const obs = new MutationObserver(() => {
      document.querySelectorAll('.slot-intro-item').forEach((it, k) => {
        const done = [...it.querySelectorAll('.slot-reel')].every((r) => r.classList.contains('slot-reel--set'));
        if (done && !w.__order.includes(k)) w.__order.push(k);
      });
    });
    obs.observe(document.getElementById('slotIntroStack'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.click('#slotDemoBtn');
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => ({
    set: document.querySelectorAll('.slot-intro-item .slot-reel--set').length,
    red: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--stop')),
  }));
  check('按下 STOP 的头半秒：还没有一个停稳，键还是 STOP', mid.set === 0 && mid.red, `停稳 ${mid.set} 个`);
  await page.waitForFunction(() => document.querySelectorAll('.slot-intro-item .slot-reel--set').length === 6, { timeout: 9000 });
  const after = await page.evaluate(() => ({
    order: window.__order,
    btn: document.getElementById('slotDemoBtn')?.textContent.trim(),
    green: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--start')),
  }));
  check('三台从上到下一台一台停', JSON.stringify(after.order) === '[0,1,2]', JSON.stringify(after.order));
  check('全停稳了，STOP 变成绿色的《开始》', after.btn === '开始' && after.green, `${after.btn} · ${after.green ? '绿' : '不绿'}`);
  await page.click('#slotDemoBtn');
  await page.waitForTimeout(400);
  const again = await page.evaluate(() => ({
    set: document.querySelectorAll('.slot-intro-item .slot-reel--set').length,
    red: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--stop')),
    spinning: [...document.querySelectorAll('.slot-intro-item .slot-strip')].every((s) => s.children.length > 0),
  }));
  check('按《开始》又转起来，键变回红色 STOP', again.set === 0 && again.red && again.spinning, `停稳 ${again.set} 个`);
  // 《退出》回个人主页，不是主菜单。
  await page.click('#slotBack');
  check('没开通：《退出》回到个人主页', await page.waitForSelector('.profile-page', { timeout: 8000 }).then(() => true).catch(() => false));
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

  // 乙、走一遍老虎机：介绍页右下角的《开始 〉》→ 挑图形 → 转。
  await openIntro(page);
  check(`${fam.name}：开通了：介绍页右下角有《开始 〉》`, Boolean(await page.$('#slotGo')));
  await page.click('#slotGo');
  await page.waitForSelector('.slot-pick-opt', { timeout: 8000 });
  await page.click(`.slot-pick-opt[data-family="${fam.key}"]`);
  await page.waitForSelector('#startOverlay .slot-machine', { timeout: 8000 });
  // 记下每个轮子停稳的时刻（用 MutationObserver 盯 class），不靠「恰好在两次
  // 停之间去看一眼」——那一眼总有一天会晚到。
  await page.evaluate(() => {
    const w = window;
    w.__stops = [];
    const reels = [...document.querySelectorAll('#startOverlay .slot-reel')];
    reels.forEach((r, i) => {
      if (r.classList.contains('slot-reel--set')) w.__stops.push([i, performance.now()]);
      new MutationObserver(() => {
        if (r.classList.contains('slot-reel--set') && !w.__stops.some((s) => s[0] === i)) w.__stops.push([i, performance.now()]);
      }).observe(r, { attributes: true, attributeFilter: ['class'] });
    });
  });
  const stage = await page.evaluate(() => ({
    art: Boolean(document.querySelector('#startOverlay .slot-machine-art svg')),
    // 两个窗口，两个都在转。
    spinning: [...document.querySelectorAll('#startOverlay .slot-reel')]
      .map((r) => r.querySelector('.slot-strip').children.length > 0),
    // 轮子还在转，倒数窗口还不该露面。
    countHidden: getComputedStyle(document.getElementById('startCount')).visibility === 'hidden',
    digits: document.querySelectorAll('#startCount .cd-digit').length,
    // 图案的描边：白窗口上要的是圆角黑边，不是白边。
    edge: getComputedStyle(document.querySelector('#startOverlay .slot-reel')).getPropertyValue('--mark-edge').trim(),
  }));
  check(`${fam.name}：那台老虎机就是给的那张图`, stage.art);
  check(`${fam.name}：两个窗口、两个滚筒都在转`,
    JSON.stringify(stage.spinning) === JSON.stringify([true, true]), stage.spinning.join(','));
  check(`${fam.name}：转的时候倒数还没露面`, stage.countHidden && stage.digits === 0,
    `visibility ${stage.countHidden ? 'hidden' : 'visible'} · ${stage.digits} 个数字`);
  check(`${fam.name}：图案描的是黑边`, /2E2430/i.test(stage.edge), stage.edge || '（空）');

  // 第二个轮子停稳了才开始数，而且从 5 起。
  await page.waitForFunction(() => document.querySelectorAll('.slot-reel--set').length >= 2, { timeout: 6000 });
  await page.waitForFunction(() => document.querySelector('#startCount .cd-digit'), { timeout: 4000 });
  const first = await page.evaluate(() => ({
    digit: document.querySelector('#startCount .cd-digit')?.textContent,
    shown: getComputedStyle(document.getElementById('startCount')).visibility !== 'hidden',
  }));
  check(`${fam.name}：停稳之后倒数才露面，从 5 起`, first.digit === '5' && first.shown, first.digit || '（没数）');

  await page.waitForFunction(() => document.querySelectorAll('.slot-reel--set').length === 2, { timeout: 6000 });
  // 从左到右先后停：左边那个停稳的时刻要早于右边那个，中间隔得开。
  const stops = await page.evaluate(() => window.__stops.slice().sort((a, b) => a[0] - b[0]));
  const gap = stops.length === 2 ? stops[1][1] - stops[0][1] : NaN;
  check(`${fam.name}：从左到右一个一个停`, stops.length === 2 && stops[0][0] === 0 && gap > 400,
    `左 → 右相隔 ${Math.round(gap)}ms`);
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
