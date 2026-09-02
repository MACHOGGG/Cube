/**
 * 《图形翻面速度》那根拉杆：拉了到底有没有用。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-flip-speed.mjs http://localhost:8817/
 *
 * 一个设置项最容易出的毛病不是「点不动」，是「点得动但什么都没变」——存进
 * 去了、界面上的数字也跟着改了，可翻面还是老样子。所以这里量的是真的那一
 * 下：窗口里那枚演示棋子从开始翻到翻完，实际用了多少毫秒。最慢那一档该是
 * 最快那一档的四倍（0.5 倍 ↔ 2 倍），差得出来才算这根拉杆接上了。
 *
 * 另外两件事也在这儿看住：
 *   · 刻度和圆钮对不对得上——两边都从 --flip-thumb 算，对不上就是有人动了
 *     其中一边（见 style.css 里那段注释）；
 *   · 没开通的人进得来、拉不动——这一条是玩家自己定的规矩（看得见但拿不到
 *     好过「敬请期待」），一改就得知道。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 页面开起来之前先铺好的那点东西。
 *
 * 写成「函数 + 参数」而不是一个闭包：addInitScript 是把函数序列化成字符串
 * 丢进页面里跑的，外面那层闭包变量根本过不去——写成 seed(true) 的样子，
 * 页面里读到的是 undefined，于是「天才」那一半会静悄悄地按没订阅跑。
 */
const seed = (genius) => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
  // 这里不去清 slides_flip_speed：新开的 context 本来就是空的，而这段脚本
  // 每次导航都会重跑一遍——清一下，「刷新之后还是这一档」那条就永远看的是
  // 被自己抹掉的结果，绿也是假绿，红也是假红。
  if (genius) {
    localStorage.setItem('slides_genius', JSON.stringify({
      active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'FLIPTEST',
    }));
  }
};

/** 打开个人主页，把《图形翻面速度》那一行点开。 */
async function openPicker(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('#flipRow', { timeout: 10000 });
  await page.click('#flipRow');
  await page.waitForSelector('.flip-modal', { timeout: 5000 });
}

/** 演示棋子安静下来（没有正在翻的）。 */
const settled = (page) =>
  page.waitForFunction(() => !document.getElementById('flipDemo')?.dataset.flipping, { timeout: 8000 });

/** 拉杆的几何：圆钮的心从「左边 + 半个钮」走到「右边 − 半个钮」。 */
const railGeo = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('flipRange').getBoundingClientRect();
    const thumb = parseFloat(
      getComputedStyle(document.querySelector('.flip-slider')).getPropertyValue('--flip-thumb'));
    return { left: r.left, right: r.right, top: r.top, h: r.height, thumb };
  });

/**
 * 真的用鼠标去点第 step 档。
 *
 * 不是 dispatchEvent 一个 input 事件——那一条对「拉不动」根本不成立：
 * disabled 拦的是人的手，程序派发的事件照样会走到监听里去，于是那条断言会
 * 一直绿着（或者一直红着），两种都不是它该量的东西。
 */
async function clickStep(page, step) {
  const g = await railGeo(page);
  const inner = g.right - g.left - g.thumb;
  await page.mouse.click(g.left + g.thumb / 2 + (step / 9) * inner, g.top + g.h / 2);
}

/** 把拉杆推到第 step 档，量这一档翻一次要多少毫秒。 */
async function timeFlip(page, step) {
  await settled(page);
  await clickStep(page, step);
  await page.waitForFunction(
    () => document.getElementById('flipDemo')?.dataset.flipping === '1', { timeout: 8000 });
  const t0 = Date.now();
  await settled(page);
  return Date.now() - t0;
}

// ---- 天才：拉得动，而且拉了真的变 ----------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, true);
  const page = await ctx.newPage();
  await openPicker(page);

  const enabled = await page.$eval('#flipRange', (el) => !el.disabled);
  check('天才：拉杆拉得动', enabled);

  // 刻度和圆钮对得上：第一格该压在「左边 + 半个钮」上，最后一格压在
  // 「右边 − 半个钮」上。这是刻度条唯一的对齐依据，差 1px 都不该有。
  const align = await page.evaluate(() => {
    const rr = document.getElementById('flipRange').getBoundingClientRect();
    const ticks = [...document.querySelectorAll('.flip-tick')];
    const thumb = parseFloat(
      getComputedStyle(document.querySelector('.flip-slider')).getPropertyValue('--flip-thumb'));
    const mid = (el) => { const b = el.getBoundingClientRect(); return b.left + b.width / 2; };
    return {
      n: ticks.length,
      first: mid(ticks[0]) - (rr.left + thumb / 2),
      last: mid(ticks[ticks.length - 1]) - (rr.right - thumb / 2),
    };
  });
  check('刻度是十格', align.n === 10, `${align.n} 格`);
  check('刻度压在圆钮走到的地方', Math.abs(align.first) <= 1 && Math.abs(align.last) <= 1,
    `首格差 ${align.first.toFixed(2)}px · 末格差 ${align.last.toFixed(2)}px`);

  const slow = await timeFlip(page, 0);
  const fast = await timeFlip(page, 9);
  // 设计值 350ms：最慢档 700ms，最快档 175ms。留足余量——测的是真实动画，
  // 掉几帧是常事；要看住的是「差了四倍」，不是「正好 700」。
  check('最慢那一档真的慢下来了', slow >= 520 && slow <= 950, `${slow}ms（该 ~700）`);
  check('最快那一档真的快起来了', fast >= 110 && fast <= 300, `${fast}ms（该 ~175）`);
  check('两头差出四倍来', slow / fast >= 2.5, `${(slow / fast).toFixed(2)} 倍`);

  const stored = await page.evaluate(() => localStorage.getItem('slides_flip_speed'));
  check('选的那一档存下来了', stored === '9', `存的是 ${stored}`);

  // 关掉窗口，那一行右边该写着这一档的倍率。
  await page.click('#flipClose');
  await page.waitForTimeout(200);
  const rowValue = await page.$eval('#flipRow .profile-row-value', (el) => el.textContent.trim());
  check('那一行右边写着倍率', rowValue.startsWith('2.0'), `写的是「${rowValue}」`);

  // 刷新一次还在——存了才算数。
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('#flipRow', { timeout: 10000 });
  const kept = await page.$eval('#flipRow .profile-row-value', (el) => el.textContent.trim());
  check('刷新之后还是这一档', kept.startsWith('2.0'), `写的是「${kept}」`);

  await ctx.close();
}

// ---- 没开通：进得来、看得见、拉不动 --------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, false);
  const page = await ctx.newPage();
  await openPicker(page);

  const shape = await page.evaluate(() => ({
    disabled: document.getElementById('flipRange')?.disabled === true,
    lock: Boolean(document.querySelector('.flip-slider--locked .flip-lock')),
    cta: Boolean(document.getElementById('flipGo')),
    ticks: document.querySelectorAll('.flip-tick').length,
    demo: Boolean(document.getElementById('flipDemo')),
  }));
  check('没开通：窗口照样打得开', shape.ticks === 10 && shape.demo);
  check('没开通：拉杆拉不动', shape.disabled);
  check('没开通：挂着锁', shape.lock);
  check('没开通：给得出去开通的路', shape.cta);

  // 演示照样翻——「看得见但拿不到」的重点在看得见。
  await page.waitForFunction(
    () => document.getElementById('flipDemo')?.dataset.flipping === '1', { timeout: 8000 })
    .then(() => check('没开通：演示照样翻给他看', true))
    .catch(() => check('没开通：演示照样翻给他看', false, '一直没翻'));

  // 真的去点最右边那一档：拉不动就不该改到任何东西。
  await clickStep(page, 9);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    stored: localStorage.getItem('slides_flip_speed'),
    value: document.getElementById('flipRange').value,
  }));
  check('没开通：点了也拉不动', after.value === '4', `拉杆停在 ${after.value}`);
  check('没开通：点了也改不到设置', after.stored === null, `存的是 ${after.stored}`);

  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
