/**
 * 开局那一幕，从头到尾走一遍。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-start-page.mjs http://localhost:8815/
 *
 * 这一页现在自己会把游戏开起来（3、2、1 数完替玩家按下那颗藏起来的键），暂停
 * 又会把它按住——一条线断了都不会报错，只会安静地卡在那里或者安静地重发一次
 * 牌，所以这里逐条量。
 *
 * 最后两条是给战绩图上那两个小标志留的岗哨。它们是把 SVG 画进画布，而画不出来
 * 的方式全是静悄悄的：少一个 xmlns、多一份 width，图片就加载失败，画布上什么
 * 也不会少——只是标志没了。所以不看代码，看像素。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function open({ genius = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (genius) {
    // 七色圆球和进阶三角是天才特供，主菜单上锁着。这里只要本地那份凭据——
    // 开房间才需要服务器认，点开一个玩法不需要。
    await ctx.addInitScript(() => {
      localStorage.setItem('slides_genius', JSON.stringify({
        active: true, period: 'yearly', until: Date.now() + 30 * 864e5, channel: 'code',
        email: '', token: 'x'.repeat(48), code: 'LOCALONLY',
      }));
    });
  }
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

const PIECES = '#boardWrap .tile, #boardWrap .ball, #boardWrap .tri';
const pieces = (page) => page.evaluate((sel) => document.querySelectorAll(sel).length, PIECES);

// ---- 1. 普通一局：图 + 倒数 + 两颗键，没有标题 -----------------------------
{
  const { ctx, page } = await open();
  await page.$$eval('.home-icon-btn', (els) => els[0].click());
  await page.waitForSelector('#startOverlay.show', { timeout: 15000 });
  await page.waitForTimeout(250);

  const shape = await page.evaluate(() => ({
    art: !!document.querySelector('#startOverlay .start-mark-art svg'),
    window: !!document.querySelector('#startOverlay .cd-window'),
    back: !!document.querySelector('#startOverlay #startBackBtn'),
    pause: !!document.querySelector('#startOverlay #startPauseBtn'),
    headings: document.querySelectorAll('#startOverlay h2, #startOverlay p:not(.rotate-hint-copy)').length,
    marks: document.querySelectorAll('#startOverlay .start-mark').length,
  }));
  check('开局页摆着这个玩法的图', shape.art);
  check('开局页有倒数窗口', shape.window);
  check('开局页有《返回》和《暂停》两颗键', shape.back && shape.pause);
  check('开局页不再有标题和说明文字', shape.headings === 0, `找到 ${shape.headings} 段`);
  check('普通一局只摆一张图，没有别的标志', shape.marks === 1, `摆了 ${shape.marks} 张`);

  const first = await page.$eval('#startCount .cd-digit', (el) => el.textContent);
  check('倒数从 4 开始', first === '4', `看到 ${first}`);

  await page.waitForTimeout(1100);
  const second = await page.$eval('#startCount .cd-digit', (el) => el.textContent).catch(() => null);
  check('一秒之后是 3', second === '3', `看到 ${second}`);

  // 四个数字一秒一个，等过第四秒。
  await page.waitForTimeout(3300);
  const after = await page.evaluate((sel) => ({
    overlay: document.querySelector('#startOverlay')?.classList.contains('show'),
    n: document.querySelectorAll(sel).length,
  }), PIECES);
  check('数完自己开局，不用再按一下', after.overlay === false && after.n > 0, JSON.stringify(after));
  await ctx.close();
}

// ---- 2. 暂停会把倒数按住，回来重新从 4 数 ---------------------------------
{
  const { ctx, page } = await open();
  await page.$$eval('.home-icon-btn', (els) => els[0].click());
  await page.waitForSelector('#startOverlay.show', { timeout: 15000 });
  await page.waitForTimeout(1200); // 数到 3 了
  await page.click('#startPauseBtn');
  await page.waitForTimeout(1800); // 比剩下的倒数还久

  const held = await page.evaluate((sel) => ({
    pause: document.querySelector('#pauseOverlay')?.classList.contains('show'),
    start: document.querySelector('#startOverlay')?.classList.contains('show'),
    digits: document.querySelectorAll('#startCount .cd-digit').length,
    n: document.querySelectorAll(sel).length,
  }), PIECES);
  check('按暂停就弹出暂停面板', held.pause === true);
  check('暂停期间倒数停住，一局也没开起来', held.start === true && held.digits === 0 && held.n === 0,
    JSON.stringify(held));

  await page.click('#continueBtn');
  await page.waitForTimeout(250);
  const back = await page.$eval('#startCount .cd-digit', (el) => el.textContent).catch(() => null);
  check('继续之后从 4 重新数', back === '4', `看到 ${back}`);
  await ctx.close();
}

// ---- 3. 炸弹局：图旁边挂一颗炸弹 ------------------------------------------
let bombShare = null;
{
  const { ctx, page } = await open();
  await page.$$eval('.home-bomb-mini, .home-bomb-card', (els) => els[0].click());
  await page.waitForTimeout(800);
  await page.$$eval('.center-pick .bomb-chip', (els) => els[0].click());
  await page.waitForSelector('#startOverlay.show', { timeout: 15000 });
  await page.waitForTimeout(250);
  const marks = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('#startOverlay .start-mark'));
    const w = all.map((e) => Math.round(e.getBoundingClientRect().width));
    return {
      bomb: !!document.querySelector('#startOverlay .mode-badge--bomb svg'),
      room: !!document.querySelector('#startOverlay .mode-badge--room'),
      n: all.length,
      widths: w,
      sameRow: all.length > 1 && new Set(all.map((e) => Math.round(e.getBoundingClientRect().top))).size === 1,
    };
  });
  check('炸弹局的开局页挂着炸弹标志', marks.bomb);
  check('单人炸弹局不挂那扇多人的门', marks.room === false);
  // 这一页只有三秒，角标那么小的东西来不及被看见——所以要求它和玩法图一样
  // 大、并排站着，不是挂在角上。
  check('炸弹标志和玩法图一样大，并排一行', marks.n === 2 && marks.sameRow &&
    new Set(marks.widths).size === 1, JSON.stringify(marks));

  // 打完一局，把战绩图取回来
  await page.waitForSelector('#startBtn', { timeout: 15000, state: 'attached' });
  await page.$eval('#startBtn', (el) => el.click());
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, PIECES, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.click('#finishBtn');
  await page.waitForSelector('#endOverlay.show', { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.click('#shareBtn');
  await page.waitForSelector('#shareOverlay.show', { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('shareImage')?.naturalWidth > 0, { timeout: 15000 });

  // 标志画在玩法名右边那一条里。背景是米白、玩法名是灰的，只有标志是红的
  // ——所以数「明显偏红」的像素，有就是画上去了。
  bombShare = await page.evaluate(async () => {
    const img = document.getElementById('shareImage');
    const scale = img.naturalWidth / 720; // 画布是按 720 的逻辑宽出的
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    // 玩法名右边、标题那一行：x 从 80+80 起，y 在 84..116
    const x0 = Math.round(160 * scale), y0 = Math.round(84 * scale);
    const w = Math.round(300 * scale), h = Math.round(34 * scale);
    const d = c.getContext('2d').getImageData(x0, y0, w, h).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] - d[i + 2] > 60 && d[i] > 120) red++;
    }
    return { red, sampled: (w * h) | 0 };
  });
  check('战绩图上真的画出了炸弹标志', bombShare.red > 200, JSON.stringify(bombShare));
  await ctx.close();
}

// ---- 建议横着玩的玩法：倒数从 5 数起，多出来的一秒是给转手机的 ----------
//
// 七色圆球的菱形要转四分之一圈才躺得下，进阶三角是个横着张开的 V——这两个的
// 开局页底下都写着「把手机转过来」。跟别人一样长的时间里既要看清这是哪副棋
// 盘、又要把手机转过来，那句话就等于白写；多给一秒，它才是一句能照做的话。
{
  const { ctx, page } = await open({ genius: true });
  // 主菜单最后两张就是这两个玩法（都挂着天才特供的锁）。
  const wide = await page.$$eval('.home-icon-btn', (els) =>
    els.map((e, i) => [i, (e.getAttribute('aria-label') || '')])
      .filter(([, l]) => /七色圆球|进阶三角/.test(l)));
  check('主菜单上找得到那两个建议横着玩的玩法', wide.length === 2, JSON.stringify(wide));

  for (const [idx, label] of wide) {
    await page.$$eval('.home-icon-btn', (els, i) => els[i].click(), idx);
    await page.waitForSelector('#startOverlay.show', { timeout: 15000 });
    await page.waitForTimeout(250);
    const first = await page.$eval('#startCount .cd-digit', (el) => el.textContent);
    check(`${label.split(' ')[0]}：倒数从 5 数起`, first === '5', `看到 ${first}`);
    check(`${label.split(' ')[0]}：底下挂着「把手机转过来」`,
      !!(await page.$('#startOverlay .rotate-hint')));
    // 4.4 秒：四个数字的局这时早开了，五个数字的还在数最后一个 1。
    await page.waitForTimeout(4150);
    const late = await page.evaluate(() => ({
      overlay: document.querySelector('#startOverlay')?.classList.contains('show'),
      digit: document.querySelector('#startCount .cd-digit')?.textContent ?? null,
    }));
    check(`${label.split(' ')[0]}：4.4 秒时还在数最后一个 1`,
      late.overlay === true && late.digit === '1', JSON.stringify(late));
    await page.waitForTimeout(1200);
    const started = await page.evaluate((sel) => ({
      overlay: document.querySelector('#startOverlay')?.classList.contains('show'),
      n: document.querySelectorAll(sel).length,
    }), PIECES);
    check(`${label.split(' ')[0]}：五秒数完自己开局`,
      started.overlay === false && started.n > 0, JSON.stringify(started));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  }
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
