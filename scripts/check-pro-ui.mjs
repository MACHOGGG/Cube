/**
 * 《Pro》在真界面上跑一遍（要 dev-server + Chromium）。
 *
 *   node scripts/dev-server.mjs 8931 dist
 *   node scripts/check-pro-ui.mjs http://localhost:8931/
 *
 * 源码那一半（八副棋盘描的是不是 dotColor、两处开关在不在、线多细）由
 * scripts/check-pro.mjs 守着，纯 node，在 CI 里。这一道守的是**摆到真 DOM 上之后**才
 *看得出的那几件：
 *
 *   · **默认是关的**，棋盘上一条多余的线都没有。一个没开它的人，屏幕必须和从前一模
 *     一样——这是这类「多给一层信息」的开关最容易破掉的一条。
 *   · 个人主页上拨一下就开，刷新之后还记得。
 *   · 三族棋盘**各自都画出来了**：方块是虚线、小球是整圈、三角是贴着边的一条。三族
 *     走的是三条不同的实现（SVG 虚线 / CSS ::after / SVG 描边压轮廓），少哪一条都不
 *     报错，只是那一副棋盘上什么都没有。
 *   · **描的颜色不是这一枚自己的颜色**：那圈线要是画成了它现在的颜色，屏幕上看着一
 *     样热闹，说的却是一句废话。
 *   · 在局中从暂停面板拨开关，**当场就看得见**（方块和三角那两族是真节点，要重画）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8931/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];

async function fresh(pro) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((on) => {
    for (const [k, v] of Object.entries({
      slides_lang: 'zhHans', slides_intro_seen: '1', slides_played_square: '1',
      slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
    })) localStorage.setItem(k, v);
    if (on) localStorage.setItem('slides_pro', '1');
  }, pro);
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  return { ctx, p };
}

/** 开一局，停在棋盘上（开局那一幕要数几秒）。 */
async function play(p, card) {
  await p.evaluate((name) => {
    [...document.querySelectorAll('.mode-axis > .home-icon-btn')]
      .find((b) => (b.getAttribute('aria-label') || '') === name)?.click();
  }, card);
  await p.waitForSelector('.app--game .board-wrap', { timeout: 20000 });
  // 3-2-1 那一幕之后棋子才在。
  await p.waitForFunction(() => document.querySelectorAll('.tile, .ball, .tri').length > 0, { timeout: 20000 });
  await p.waitForTimeout(500);
}

/** 这一副棋盘上，提示画出来了几处、正面的棋子有几枚、颜色和棋子自己重不重。 */
const look = (p) =>
  p.evaluate(() => {
    const flavor = [...document.querySelectorAll('.tile[data-face="flavor"], .ball[data-face="flavor"], .tri[data-face="flavor"]')];
    const rings = document.querySelectorAll('.pro-square, .pro-circle, .pro-tri').length;
    let dashed = 0, sameColor = 0, pairs = 0;
    for (const el of flavor) {
      const line = el.querySelector('.pro-square rect, .pro-circle circle, .pro-tri path');
      // 三族都得是**虚线**（玩家 2026-09：「小球的外边不是虚线的，需要和我上传的设计
      // 图一样」「也没用按照设计图上的版本制作虚线」）。
      if (line && (line.getAttribute('stroke-dasharray') || '').trim()) dashed++;
      const ring = line?.getAttribute('stroke') ?? '';
      const own = el.classList.contains('tri')
        ? getComputedStyle(el.querySelector('.fill') ?? el).backgroundColor
        : getComputedStyle(el).backgroundColor;
      if (ring) {
        pairs++;
        // 两边写法不同（一个是 rgb()，一个是 #rrggbb），化成同一种再比。
        const hex = (s) => {
          const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
          return m ? '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('') : s.toLowerCase();
        };
        if (hex(ring) === hex(own)) sameColor++;
      }
    }
    // 两枚挨着的棋子，它们的线之间还看不看得见底板（玩家：「方块的贴合的太近了以至
    // 于没有缝隙看不清两个边框」）。量的是同一行相邻两枚之间的空当减去一个线宽——线
    // 压在各自的轮廓上，每枚只吃掉半个。
    let gapLeft = null;
    if (flavor.length >= 2) {
      const boxes = flavor.map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top || a.left - b.left);
      for (let i = 1; i < boxes.length; i++) {
        if (Math.abs(boxes[i].top - boxes[i - 1].top) < 2 && boxes[i].left > boxes[i - 1].right) {
          const w = parseFloat(document.querySelector('.pro-square rect, .pro-circle circle, .pro-tri path')?.getAttribute('stroke-width') ?? '0');
          gapLeft = +(boxes[i].left - boxes[i - 1].right - w).toFixed(2);
          break;
        }
      }
    }
    return { flavor: flavor.length, rings, dashed, sameColor, pairs, gapLeft,
             dataPro: document.documentElement.getAttribute('data-pro') };
  });

// ---- 1. 默认是关的：一条多余的线都没有 ----------------------------------
{
  const { ctx, p } = await fresh(false);
  check('默认没开（<html> 上没有 data-pro）', (await p.evaluate(() => document.documentElement.getAttribute('data-pro'))) === null);
  for (const card of ['方块', '圆球', '三角']) {
    await play(p, card);
    const v = await look(p);
    check(`[${card}] 没开 Pro 的时候，棋盘上一条提示都没有`,
      v.flavor > 0 && v.rings === 0 && v.dashed === 0, JSON.stringify(v));
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  }
  // 个人主页上那颗：拨一下就开，而且记得住。
  await p.click('#navProfile');
  await p.waitForSelector('#proRow', { timeout: 10000 });
  check('个人主页上那颗开关一开始是关的', (await p.getAttribute('#proRow', 'aria-checked')) === 'false');
  await p.click('#proRow');
  check('拨一下就开了', (await p.getAttribute('#proRow', 'aria-checked')) === 'true'
    && (await p.evaluate(() => document.documentElement.getAttribute('data-pro'))) === '1');
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  check('刷新之后还记得',
    (await p.evaluate(() => localStorage.getItem('slides_pro'))) === '1'
    && (await p.evaluate(() => document.documentElement.getAttribute('data-pro'))) === '1');
  await ctx.close();
}

// ---- 2. 开着的时候：三族各画各的，而且不是描的自己 -----------------------
{
  const { ctx, p } = await fresh(true);
  for (const card of ['方块', '圆球', '三角']) {
    await play(p, card);
    const v = await look(p);
    check(`[${card}] 每一枚正面的棋子都描上了`, v.flavor > 0 && v.rings === v.flavor, JSON.stringify(v));
    // 三族都是虚线，一个不落（小球那一版从前是整整一圈实线，玩家指出来了）。
    check(`[${card}] 描的是虚线，不是整整一圈`, v.dashed === v.flavor, `${v.dashed}/${v.flavor}`);
    if (card === '三角') {
      // 三角没有「同一行里并排两枚」这回事：它们是互相咬合的，上下交错铺满，谁的右
      // 边都紧挨着另一枚的斜边。所以这一副量的是另一件事——**线描了两倍宽**：三角的
      // 棋子被 clip-path 剪着，外面那一半会被剪掉，露出来的正好是一个线宽。少了这个
      // 两倍，屏幕上那条线就只有说好的一半粗。
      const tri = await p.evaluate(() => {
        const path = document.querySelector('.pro-tri path');
        const el = path?.closest('.tri');
        return { w: Number(path?.getAttribute('stroke-width')), box: el ? Math.round(el.getBoundingClientRect().width) : 0 };
      });
      // proHintWidth：棋子的 3%，上限 2px。三角一条边一百来像素，所以是 2 × 2 = 4。
      const want = Math.min(2, Math.max(1.2, Math.round(tri.box * 0.03 * 10) / 10)) * 2;
      check('[三角] 线描了两倍宽（外面那一半会被剪掉）',
        Math.abs(tri.w - want) < 0.01, `stroke-width ${tri.w}，按 ${tri.box}px 的棋子该是 ${want}`);
      check('[三角] 它没有「并排两枚」这回事（所以上面那条不适用）', v.gapLeft === null, String(v.gapLeft));
    } else {
      // 两枚挨着的棋子，线和线之间还看得见底板。2px 是「看得出是两条线」的下限（方块
      // 之间的缝一共才 4px）。
      check(`[${card}] 两枚之间还留得下缝（看得出是两条线）`,
        v.gapLeft !== null && v.gapLeft >= 2, `剩 ${v.gapLeft}px`);
    }
    // 描的是「将来那一颗」：和棋子自己现在的颜色重合的只能是零星几枚（两面同色是
    // 可能的），绝不能是一片。描成自己那一色的话，这里会是 100%。
    check(`[${card}] 描的不是它自己现在那一色`,
      v.pairs > 0 && v.sameColor <= Math.ceil(v.pairs * 0.25), `${v.sameColor}/${v.pairs} 枚重合`);
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  }
  await ctx.close();
}

// ---- 3. 局中从暂停面板拨：当场就看得见 ----------------------------------
{
  const { ctx, p } = await fresh(false);
  await play(p, '方块');
  const before = await look(p);
  await p.click('#stopBtn');
  await p.waitForSelector('#proBtn', { timeout: 10000 });
  check('暂停面板里那颗开关在，而且是关着的', (await p.getAttribute('#proBtn', 'aria-checked')) === 'false');
  await p.click('#proBtn');
  check('拨过去了', (await p.getAttribute('#proBtn', 'aria-checked')) === 'true');
  // 回到棋盘：方块那一族的提示是真节点，拨开关必须当场重画出来。
  await p.click('#resumeBtn').catch(async () => { await p.keyboard.press('Escape'); });
  await p.waitForTimeout(600);
  const after = await look(p);
  check('局中拨开之后，棋盘上当场就有了（不用等下一步棋）',
    before.rings === 0 && after.rings === after.flavor && after.flavor > 0,
    `${before.rings} → ${after.rings} / ${after.flavor} 枚`);
  await ctx.close();
}

check('全程没有脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);
