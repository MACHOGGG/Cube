/**
 * 主菜单的鱼眼轴（手机竖屏）。
 *
 *   node scripts/dev-server.mjs 8958 dist
 *   node scripts/check-mode-axis.mjs http://localhost:8958/
 *
 * 形变的数学本身有 check-fisheye 守着（纯函数，不开浏览器）。这道门量的是**摆到
 * 真实 DOM 上之后**才会出错的那几件事：
 *
 *   · **每一站等高，而且相邻两张不相撞。** 轴上有两张画布不是正方形的卡（炸弹是
 *     195×452 的竖板、V 型三角是 2:1 的横板）。照各自比例摆，站高就不再统一，相
 *     邻两张会叠上——叠的后果不是难看，是**点错**：两张卡的热区叠在一起，他按到
 *     的不是他看到的那一张。
 *   · **被聚焦的那张正对着选中线。** 形变把位置也挪了，算错一点就是「选中框没对
 *     准图标」。
 *   · **点一下就开，滑一下不开。** 从前网格上点一下就开局；轴上要是变成「先点一
 *     下聚焦、再点一下开」，全站最常用的那一下就变成两下。反过来，滑动的尾巴被
 *     当成点击就会把人扔进一个他没想玩的玩法。
 *   · **滑不出两端。** 不循环是玩家定的，所以最后一张之后不能再滑出新东西。
 *   · **首玩期轴上只有两张。** 也是玩家定的；按了《我会玩》当场长成 14 张。
 *     （14 不是 13——menu.ts 那句「十三张」的注释漏算了后来加的步步为营。）
 *   · **法务那五条链接和底排导航都不被压住。** 轴的高度是算出来的，算错就压人。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8958/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
ctx.on('page', (p) => p.on('pageerror', (e) => errs.push(e.message)));

/** 一台打过一局的手机（锁撤了，14 张卡都在轴上）。 */
async function menuPage(extra = {}) {
  const page = await ctx.newPage();
  await page.addInitScript((ex) => {
    if (sessionStorage.getItem('gate_primed') === '1') return;
    sessionStorage.setItem('gate_primed', '1');
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const [k, v] of Object.entries(ex)) localStorage.setItem(k, v);
  }, extra);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(500);
  return page;
}

/** 轴上每张卡的实测矩形，按渲染位置从上往下排。 */
const shot = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const hr = host.getBoundingClientRect();
    // **直接子元素**，不是后代：炸弹那张卡里嵌着一整块「预览图」，那块里的九颗
    // 小片也顶着 .home-icon-btn（但 pointer-events: none，是画不是控件）。用后代
    // 选择器会把它们也算成轴上的站，于是数出 21 张、量出 32.9px 的「站高」。
    const cards = [...host.children].filter((e) => e.classList.contains('home-icon-btn')).map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        i,
        name: (el.getAttribute('aria-label') || '').split(' ·')[0],
        top: r.top, bottom: r.bottom, h: r.height, w: r.width,
        cy: r.top + r.height / 2,
        // 轴外的卡是用 opacity 藏的（不能用 visibility：那样键盘聚焦不到）。
        vis: Number(getComputedStyle(el).opacity) > 0.01,
        // 「墨」——真正画出来的那块（图格里那个 svg 或面板）的实测矩形。
        ink: (() => {
          const art = el.querySelector(':scope > .home-icon-art');
          const kid = art && art.firstElementChild;
          if (!art || !kid) return null;
          const a = art.getBoundingClientRect();
          const k = kid.getBoundingClientRect();
          return { dw: k.width - a.width, dh: k.height - a.height };
        })(),
        scale: Number((el.style.transform.match(/scale\(([\d.]+)\)/) || [0, '1'])[1]),
      };
    });
    return { host: { top: hr.top, bottom: hr.bottom, h: hr.height, cy: hr.top + hr.height / 2 }, cards };
  });

// ── 1. 轴立起来了，13 张卡都在上面 ───────────────────────────────────
let page = await menuPage({ slides_played_square: '1' });
{
  const s = await shot(page);
  check('轴上有 14 张卡', s.cards.length === 14, `${s.cards.length} 张：${s.cards.map((c) => c.name).join(' ')}`);
  check('轴的高度是算出来的（不是 0，也没顶出屏幕）', s.host.h > 300 && s.host.bottom <= 844 + 1, `${s.host.h.toFixed(0)}px，底边 ${s.host.bottom.toFixed(0)}`);

  // 每一站等高：拿「未形变」的那几张（离焦点远、scale≈1）互相比。
  const flat = s.cards.filter((c) => c.scale < 1.02 && c.h > 0);
  const hs = flat.map((c) => c.h);
  const spread = Math.max(...hs) - Math.min(...hs);
  check('每一站等高（未形变的几张高度一致，差 < 2px）', spread < 2, `${Math.min(...hs).toFixed(1)}–${Math.max(...hs).toFixed(1)}px，共 ${hs.length} 张`);

  // 聚焦那张：正对选中线（容器正中），而且是最大的一张。
  const focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  check('聚焦那张正对着选中线（偏差 < 2px）', Math.abs(focused.cy - s.host.cy) < 2, `${focused.name}：中心 ${focused.cy.toFixed(1)} / 选中线 ${s.host.cy.toFixed(1)}`);
  check('聚焦那张是最大的一张', focused.scale > 1.3, `scale ${focused.scale}`);

  // **量墨，不量盒。** 这一条是补的：前一版只量按钮的矩形，于是炸弹那块板
  // （从宽度算高度，撑成 157×175）和三张宽画布的图（svg 宽到 200，图格只有
  // 157）全都「盒子合格、画出来的东西溢出去压住邻居」，门一片绿、屏幕上一塌
  // 糊涂。盒子量不出溢出，得去量图格和它里面那块画的差。
  const spill = s.cards.filter((c) => c.ink && (c.ink.dw > 1.5 || c.ink.dh > 1.5));
  check(
    '画出来的东西不溢出自己的格子（量墨不量盒）',
    spill.length === 0,
    spill.length ? spill.map((c) => `${c.name} 溢出 ${c.ink.dw.toFixed(0)}×${c.ink.dh.toFixed(0)}`).join('；') : '14 张全部在格子里',
  );
}

// ── 2. 逐对量「不相撞」：焦点扫过整条轴 ──────────────────────────────
{
  let worst = { gap: 999, at: '' };
  for (let target = 0; target < 14; target++) {
    // 直接把焦点设过去（不经手势），一次一项地量。
    await page.evaluate((i) => {
      const cards = [...document.querySelector('.mode-axis').children].filter((e) =>
        e.classList.contains('home-icon-btn'),
      );
      cards[i]?.focus();
    }, target);
    await page.waitForTimeout(420);
    const s = await shot(page);
    const vis = s.cards.filter((c) => c.vis).sort((a, b) => a.top - b.top);
    for (let k = 0; k + 1 < vis.length; k++) {
      const gap = vis[k + 1].top - vis[k].bottom;
      if (gap < worst.gap) worst = { gap, at: `焦点在第 ${target} 项时，${vis[k].name} 与 ${vis[k + 1].name} 之间` };
    }
  }
  check('相邻两张永不相撞（整条轴扫一遍）', worst.gap > 0, `最紧一对剩 ${worst.gap.toFixed(1)}px —— ${worst.at}`);
  check('最紧的一对也还留得下缝（> 4px）', worst.gap > 4, `${worst.gap.toFixed(1)}px`);
}

// ── 3. 拖动：跟手、松手定格在整项上 ──────────────────────────────────
{
  await page.evaluate(() => {
    const c = document.querySelector('.mode-axis .home-icon-btn');
    c?.blur();
  });
  await page.evaluate(() => {
    [...document.querySelector('.mode-axis').children].filter((e) => e.classList.contains('home-icon-btn'))[0]?.focus();
  });
  await page.waitForTimeout(450);
  const before = (await shot(page)).cards.reduce((a, b) => (b.scale > a.scale ? b : a)).name;
  // 往上拖两站多一点，松手应当定格在整项上（不停在两项中间）。
  const box = await page.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(box.x, box.y - (k * 320) / 12);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const s = await shot(page);
  const focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  check('拖动换得了聚焦项', focused.name !== before, `${before} → ${focused.name}`);
  check('松手定格在整项上（聚焦那张正对选中线）', Math.abs(focused.cy - s.host.cy) < 2, `偏差 ${Math.abs(focused.cy - s.host.cy).toFixed(2)}px`);
  check('松手后只有一张是放大的（没停在两项中间）', s.cards.filter((c) => c.scale > 1.25).length === 1, `${s.cards.filter((c) => c.scale > 1.25).length} 张`);
}

// ── 4. 滑不出两端（不循环，玩家定的）────────────────────────────────
{
  const box = await page.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // 往下猛拖，远超第 0 项
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(box.x, box.y + k * 160);
  await page.mouse.up();
  await page.waitForTimeout(800);
  let s = await shot(page);
  let focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  check('往上滑到头就停在第一张', focused.i === 0, `停在 ${focused.name}`);
  // 往上猛拖，远超最后一项
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(box.x, box.y - k * 160);
  await page.mouse.up();
  await page.waitForTimeout(800);
  s = await shot(page);
  focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  check('往下滑到头就停在最后一张', focused.i === 13, `停在 ${focused.name}`);
}

// ── 5. 点一下就开，滑一下不开 ────────────────────────────────────────
{
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(500);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // ① 滑一下（大位移）不该开局
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(box.x, box.y - k * 20);
  await page.mouse.up();
  await page.waitForTimeout(900);
  check('滑一下不会误开玩法', await page.evaluate(() => !!document.querySelector('.mode-axis')));
  // ② 点聚焦那张：一下就进
  await page.waitForTimeout(400);
  const s = await shot(page);
  const focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  await page.mouse.click(box.x, focused.cy);
  await page.waitForTimeout(1200);
  const gone = await page.evaluate(
    () => !document.querySelector('.mode-axis') || !!document.querySelector('#startBtn') || !!document.querySelector('.center-pick'),
  );
  check('点一下就进那个玩法（不用点两下）', gone, `点的是 ${focused.name}`);
}
await page.close();

// ── 6. 首玩期轴上只有两张 ───────────────────────────────────────────
{
  const p2 = await menuPage();
  const s = await shot(p2);
  check('首玩期轴上只摆两张', s.cards.length === 2, `${s.cards.length} 张：${s.cards.map((c) => c.name).join(' ')}`);
  check('那两张就是基础方块和基础小球', s.cards.every((c) => /方块|圆球|小球/.test(c.name)), s.cards.map((c) => c.name).join(' '));
  check('首玩期那颗《我会玩》还在', await p2.evaluate(() => !!document.querySelector('.know-how-btn')));
  // 按下《我会玩》→ 轴当场长成 13 项
  await p2.click('.know-how-btn');
  await p2.waitForTimeout(800);
  const s2 = await shot(p2);
  check('按了《我会玩》轴长成 14 项', s2.cards.length === 14, `${s2.cards.length} 张`);
  await p2.close();
}

// ── 7. 轴不压住法务链接和底排 ───────────────────────────────────────
{
  const p3 = await menuPage({ slides_played_square: '1' });
  const geo = await p3.evaluate(() => {
    const host = document.querySelector('.mode-axis').getBoundingClientRect();
    const legal = document.querySelector('.home-legal')?.getBoundingClientRect() ?? null;
    const nav = document.querySelector('.bottom-nav, .dock, [class*="bottom-nav"]')?.getBoundingClientRect() ?? null;
    const cards = [...document.querySelector('.mode-axis').children]
      .filter((e) => e.classList.contains('home-icon-btn') && Number(getComputedStyle(e).opacity) > 0.01)
      .map((e) => e.getBoundingClientRect());
    return {
      hostBottom: host.bottom,
      legalTop: legal?.top ?? -1, legalBottom: legal?.bottom ?? -1,
      navTop: nav?.top ?? -1,
      lowestCard: Math.max(...cards.map((r) => r.bottom)),
      clipped: getComputedStyle(document.querySelector('.mode-axis')).overflow,
      vh: window.innerHeight,
    };
  });
  check('法务那五条链接在轴下面，而且整条在屏幕里', geo.legalTop >= geo.hostBottom - 1 && geo.legalBottom <= geo.vh + 1,
    `轴底 ${geo.hostBottom.toFixed(0)} / 链接 ${geo.legalTop.toFixed(0)}–${geo.legalBottom.toFixed(0)} / 屏高 ${geo.vh}`);
  // getBoundingClientRect 不认裁剪：一张探到轴外面的卡，rect 照样报它的完整位
  // 置，而屏幕上那一截是被 overflow 切掉的。所以这儿量的是「裁真的在裁」，越出
  // 多少由上面那条（轴底 ≤ 法务链接顶）管。
  check('轴在裁掉探出去的那一截（overflow: hidden）', geo.clipped === 'hidden', geo.clipped);
  if (geo.navTop > 0) check('底排不被卡片压住', geo.lowestCard <= geo.navTop + 1, `${geo.lowestCard.toFixed(0)} / ${geo.navTop.toFixed(0)}`);
  await p3.close();
}

// ── 8. reduced-motion：不形变、直接定格 ─────────────────────────────
{
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  const p4 = await ctx2.newPage();
  p4.on('pageerror', (e) => errs.push('reduce: ' + e.message));
  await p4.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem('slides_played_square', '1');
  });
  await p4.goto(BASE, { waitUntil: 'load' });
  await p4.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
  await p4.waitForTimeout(500);
  const s = await shot(p4);
  const scales = s.cards.map((c) => c.scale);
  check('reduced-motion 下一张都不放大（§5.1 退化成离散翻页）', Math.max(...scales) <= 1.001, `最大 scale ${Math.max(...scales)}`);
  check('reduced-motion 下站距均匀', (() => {
    const vis = s.cards.filter((c) => c.vis).sort((a, b) => a.cy - b.cy);
    const gaps = vis.slice(1).map((c, i) => c.cy - vis[i].cy);
    return Math.max(...gaps) - Math.min(...gaps) < 1;
  })(), '');
  // 拖完立刻就位，不等弹簧
  const box = await p4.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p4.mouse.move(box.x, box.y);
  await p4.mouse.down();
  for (let k = 1; k <= 6; k++) await p4.mouse.move(box.x, box.y - (k * 300) / 6);
  await p4.mouse.up();
  await p4.waitForTimeout(80); // 只等 80ms：有过渡的话这时候还在路上
  const s2 = await shot(p4);
  const vis = s2.cards.filter((c) => c.vis);
  const onLine = vis.some((c) => Math.abs(c.cy - s2.host.cy) < 2);
  check('reduced-motion 下松手立刻就位（80ms 内已经对准选中线）', onLine, '');
  await ctx2.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
