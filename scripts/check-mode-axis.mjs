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
  check('聚焦那张是最大的一张', focused.scale > 1.2, `scale ${focused.scale}`);

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
  check('松手后只有一张是放大的（没停在两项中间）', s.cards.filter((c) => c.scale > 1.24).length === 1, `${s.cards.filter((c) => c.scale > 1.24).length} 张`);
}

// ── 4. 循环：没有「到头了」这回事 ───────────────────────────────────
//
// 玩家 2026-09 第二轮改的口径（原先是「手机端不循环，滑到两端就停」）：
// 「没有做到任何循环的效果」。这一节原来量的正是「滑到头就停」，现在反过来量：
// 从第一张往上猛滑，应该绕到后半段去，而不是钉在第 0 项。
{
  const box = await page.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // 先回到第 0 项
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(box.x, box.y + k * 160);
  await page.mouse.up();
  await page.waitForTimeout(800);
  let s = await shot(page);
  let focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  const first = focused.i;
  // 这儿不下断言——猛拖 20×160px 走的格数取决于间距，落在哪一项不是这道门要钉的
  // 事（钉了就成了「抄实现」）。真正要量的是下面两条：再往上走会**绕过去**。
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(box.x, box.y + k * 60);
  await page.mouse.up();
  await page.waitForTimeout(800);
  s = await shot(page);
  focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  check(
    '从前几项再往上滑，绕到后几项（环闭上了）',
    focused.i > 9,
    `${first} → ${focused.i}（${focused.name}）`,
  );
  // 反方向也走得通：从这儿往下猛滑，绕回前几项
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(box.x, box.y - k * 60);
  await page.mouse.up();
  await page.waitForTimeout(800);
  s = await shot(page);
  const back = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  check('反方向也绕得回来', back.i < 4, `→ ${back.i}（${back.name}）`);
}

// ── 4b. 上下两头是**化开**的，不是一刀切 ────────────────────────────
//
// 玩家原话：「上和下的部分不应该是遮盖的，而是透明的，不应该只有中间这一部分
// 能看到」。原先的写法是「离中心超过半屏就 opacity: 0」——于是轴上永远只看得见
// 三张，边缘一条硬线。现在改成随距离连续掉，容器再叠一层同向的渐变遮罩。
//
// 量两件事：**有**半透明的那一张（不是非 0 即 1），以及遮罩真的挂上了。
{
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(700);
  const fade = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.mode-axis > .home-icon-btn')];
    const o = cards.map((c) => +(+getComputedStyle(c).opacity).toFixed(3));
    const css = getComputedStyle(document.querySelector('.mode-axis'));
    return {
      o,
      half: o.filter((v) => v > 0.02 && v < 0.98).length,
      solid: o.filter((v) => v >= 0.98).length,
      mask: (css.webkitMaskImage || css.maskImage || 'none').slice(0, 40),
    };
  });
  check(
    '上下两头有淡出的卡（不是非 0 即 1 的一刀切）',
    fade.half >= 1,
    `全不透明 ${fade.solid} 张、半透明 ${fade.half} 张：${fade.o.filter((v) => v > 0).join(' / ')}`,
  );
  check(
    '一屏看得见的不止中间那一张（≥ 3 张全不透明）',
    fade.solid >= 3,
    `${fade.solid} 张`,
  );
  check('容器挂着渐隐遮罩', /gradient/.test(fade.mask), fade.mask);
}

// ── 4c. 两侧的点点轴 ────────────────────────────────────────────────
//
// 效果图上左右两边各一列小圆点，中间那几颗大而亮。它是「我在这 14 项的哪儿」的
// 唯一提示——轴上一次只看得见四五张卡，没有它玩家不知道自己滑到了第几项。
{
  const rail = await page.evaluate(() => {
    const rails = [...document.querySelectorAll('.axis-rail')];
    const dots = rails.map((r) =>
      [...r.querySelectorAll('.axis-dot')].map((d) => {
        const cs = getComputedStyle(d);
        const b = d.getBoundingClientRect();
        return { w: +parseFloat(cs.width).toFixed(1), o: +(+cs.opacity).toFixed(3), cy: b.top + b.height / 2 };
      }),
    );
    const host = document.querySelector('.mode-axis').getBoundingClientRect();
    return { rails: rails.length, dots, hostCy: host.top + host.height / 2, pe: rails[0] && getComputedStyle(rails[0]).pointerEvents };
  });
  check('左右各一条点点轴', rail.rails === 2, `${rail.rails} 条`);
  check('每条轴上一项一颗点', rail.dots.every((d) => d.length === 14), rail.dots.map((d) => d.length).join(' / '));
  const widest = rail.dots[0].reduce((a, b) => (b.w > a.w ? b : a));
  const smallest = rail.dots[0].reduce((a, b) => (b.w < a.w ? b : a));
  check('最大那颗明显比最小那颗大（有大小梯度）', widest.w - smallest.w > 2, `${smallest.w} → ${widest.w}px`);
  check('最大那颗对着选中线（± 6px）', Math.abs(widest.cy - rail.hostCy) < 6, `${widest.cy.toFixed(0)} / ${rail.hostCy.toFixed(0)}`);
  // 它是路标不是控件：按在点子上那一下要能照常拖轴。
  check('点点轴不吃手势（pointer-events: none）', rail.pe === 'none', String(rail.pe));
}

// ── 4d. 图层不再逐帧建了又拆 ────────────────────────────────────────
//
// 玩家原话：「没有丝滑顺畅的快速的感觉，现在很卡都很慢」。原先 paint() 每帧按
// 「离焦点近不近」设/清每张卡的 willChange——反复建图层再拆图层，正好发生在最忙
// 的那几帧里。现在 will-change 由 CSS 常设，JS 一帧只写变了的 transform/opacity。
// 这儿量的是成效：拖完之后每张卡的 will-change 还在，没被逐帧清掉。
{
  const wc = await page.evaluate(() =>
    [...document.querySelectorAll('.mode-axis > .home-icon-btn')].map((c) => getComputedStyle(c).willChange),
  );
  check(
    '卡片的 will-change 是常设的（不再逐帧开关）',
    wc.length > 0 && wc.every((v) => /transform/.test(v)),
    [...new Set(wc)].join(' | '),
  );
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
    // 底排那一条叫 `.home-nav`（bottomNav.ts 挂在 <body> 上的 <nav>）。这儿原先
    // 猜的是 `.bottom-nav`，全站没有这个类名，于是 navTop 恒为 -1，下面那条
    // 「底排不被压住」被 if 整条跳过——门是绿的，量的是空气。同一个错的类名当时
    // 也写进了 modeAxis.ts 的 measure()，轴因此一路铺到屏幕最底、压在底排底下。
    const navEl = document.querySelector('.home-nav');
    const nav = navEl?.getBoundingClientRect() ?? null;
    const dockHits = [...document.querySelectorAll('.home-nav-btn')].map((b) => {
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.bottom - 8);
      return { label: b.getAttribute('aria-label') || '', hit: !!el && (el === b || b.contains(el)) };
    });
    const cards = [...document.querySelector('.mode-axis').children]
      .filter((e) => e.classList.contains('home-icon-btn') && Number(getComputedStyle(e).opacity) > 0.01)
      .map((e) => e.getBoundingClientRect());
    return {
      hostBottom: host.bottom,
      legalTop: legal?.top ?? -1, legalBottom: legal?.bottom ?? -1,
      navTop: nav?.top ?? -1,
      navH: nav?.height ?? 0,
      dockBlocked: dockHits.filter((h) => !h.hit).map((h) => h.label),
      dockN: dockHits.length,
      lowestCard: Math.max(...cards.map((r) => r.bottom)),
      clipped: getComputedStyle(document.querySelector('.mode-axis')).overflow,
      vh: window.innerHeight,
    };
  });
  /**
   * 法务那五条链接：在轴下面，而且**第一屏看不见**——要往下滑才露出来。
   *
   * 玩家 2026-09 第二轮：「不要一直展示在屏幕的下方……放在最底下就是只有滑到最
   * 最最底下的时候才能看到」。它们不能删（收单方的审核要在落地页上找得到，见
   * menu.ts 那段注释），所以做成普通网站页脚的样子。
   *
   * 两条一起量，缺一条就成了假绿：只量「在第一屏外」的话，把它们整个删掉也通过；
   * 只量「滑到底看得见」的话，挂在屏幕下方也通过。
   */
  check(
    '法务五条在轴下面，而且第一屏之外（不再一直挂在屏幕下方）',
    geo.legalTop >= geo.hostBottom - 1 && geo.legalTop >= geo.vh - 1,
    `轴底 ${geo.hostBottom.toFixed(0)} / 链接顶 ${geo.legalTop.toFixed(0)} / 屏高 ${geo.vh}`,
  );
  {
    const bottom = await p3.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
      const legal = document.querySelector('.home-legal').getBoundingClientRect();
      const nav = document.querySelector('.home-nav')?.getBoundingClientRect() ?? null;
      const links = [...document.querySelectorAll('.home-legal a')].map((a) => {
        const r = a.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { text: a.textContent.trim(), hit: !!el && (el === a || a.contains(el)) };
      });
      return {
        scrollable: document.documentElement.scrollHeight > window.innerHeight + 4,
        top: legal.top, bottom: legal.bottom, vh: window.innerHeight,
        navTop: nav?.top ?? -1,
        blocked: links.filter((l) => !l.hit).map((l) => l.text),
        n: links.length,
      };
    });
    check('这一页滑得动（不然那五条永远到不了）', bottom.scrollable);
    check(
      '滑到底之后五条整个在屏幕里',
      bottom.top >= -1 && bottom.bottom <= bottom.vh + 1,
      `${bottom.top.toFixed(0)}–${bottom.bottom.toFixed(0)} / 屏高 ${bottom.vh}`,
    );
    check(
      '滑到底之后五条都点得着（没被底排压住）',
      bottom.n === 5 && bottom.blocked.length === 0,
      bottom.blocked.length ? `点不着：${bottom.blocked.join(' ')}` : `${bottom.n} 条都点得着`,
    );
  }
  // getBoundingClientRect 不认裁剪：一张探到轴外面的卡，rect 照样报它的完整位
  // 置，而屏幕上那一截是被 overflow 切掉的。所以这儿量的是「裁真的在裁」，越出
  // 多少由上面那条（轴底 ≤ 法务链接顶）管。
  check('轴在裁掉探出去的那一截（overflow: hidden）', geo.clipped === 'hidden', geo.clipped);
  /**
   * 底排：先量「找得到」，再量「没被压住」。
   *
   * 少了第一条就是上面那个事故的翻版——类名一写错，第二条自动变成真空。
   *
   * 「没被压住」量两样：轴的**底边**在底排上沿之上（画不到那儿去），以及底排那
   * 两颗**真的点得着**（用 elementFromPoint 打它们的下半截——最靠近轴的那一侧）。
   * 只量矩形不够：轴是 overflow: hidden 的，探出去的卡片 rect 照样报在底排上，
   * 屏幕上其实被切掉了；只量点击也不够：轴要是画到了底排底下，玩家看到的是两颗
   * 键叠在卡片上，点是点得着，但画面是错的。
   */
  check('底排找得到（.home-nav，类名没写错）', geo.navTop > 0 && geo.navH > 0, `top ${geo.navTop.toFixed(0)} / 高 ${geo.navH.toFixed(0)}`);
  check('轴的底边在底排上面', geo.hostBottom <= geo.navTop + 1, `轴底 ${geo.hostBottom.toFixed(0)} / 底排顶 ${geo.navTop.toFixed(0)}`);
  check(
    '底排那两颗点得着',
    geo.dockN === 2 && geo.dockBlocked.length === 0,
    geo.dockBlocked.length ? `点不着：${geo.dockBlocked.join(' ')}` : `${geo.dockN} 颗都点得着`,
  );
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
