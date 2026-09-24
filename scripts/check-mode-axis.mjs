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

  /**
   * 每一站等高——量的是**版面高度**（屏幕上那一份除掉这一帧的 scale），十四张
   * 全查，不挑「未形变」的那几张。
   *
   * 从前挑 `scale < 1.02` 的来比，是因为那时候 minScale 就是 1，远处的卡都恰好
   * 原大。第三轮把鱼眼拉开（0.8 → 1.4，玩家要「放大缩小更明显」）之后，离焦点
   * 两三格的卡各是 0.85、0.80……屏幕上的高度本来就不一样，那条断言于是红了——
   * 红的不是版式，是这把尺子。
   *
   * 版面高度才是那个不变量：一站 = 图 100 + 小字一行。它一旦不齐，相邻两站的
   * 间距就算不准，下面「永不相撞」那条也跟着失去意义。
   */
  const hs = s.cards.filter((c) => c.h > 0).map((c) => c.h / (c.scale || 1));
  const spread = Math.max(...hs) - Math.min(...hs);
  check('每一站等高（十四张的版面高度一致，差 < 2px）', spread < 2, `${Math.min(...hs).toFixed(1)}–${Math.max(...hs).toFixed(1)}px，共 ${hs.length} 张`);

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

// ── 4. 滑到底就停，两头各留一点空白 ────────────────────────────────
//
// 口径来回改过两轮，这是第三轮定的（玩家原话：「不要循环的，滑动到底（留有一点
// 空白）就停止」）：第二轮做成了环，用了一轮就撤。所以这一节量回「到头就停」，
// 外加那点空白——拉得出去、松手弹回来，滑到头的手感是「到边了」，不是撞墙。
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
  check('往上滑到头就停在第一张（不绕回最后一张）', focused.i === 0, `停在 ${focused.name}`);
  // 「留一点空白」：拉过头的那一瞬间，第一张会被拖到选中线**下面**去（回弹区），
  // 松手才弹回来。量的就是这个中间态——不量它，「到头就停」和「到头钉死」分不开。
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(box.x, box.y + k * 40);
  const pulled = await page.evaluate(() => {
    const host = document.querySelector('.mode-axis').getBoundingClientRect();
    const first = document.querySelector('.mode-axis > .home-icon-btn').getBoundingClientRect();
    return { gap: first.top + first.height / 2 - (host.top + host.height / 2) };
  });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const back = await page.evaluate(() => {
    const host = document.querySelector('.mode-axis').getBoundingClientRect();
    const first = document.querySelector('.mode-axis > .home-icon-btn').getBoundingClientRect();
    return { gap: first.top + first.height / 2 - (host.top + host.height / 2) };
  });
  check('到头了还能再拉出一点空白', pulled.gap > 20, `拉出 ${pulled.gap.toFixed(0)}px`);
  check('松手弹回来，第一张回到选中线', Math.abs(back.gap) < 2, `偏差 ${Math.abs(back.gap).toFixed(1)}px`);
  // 另一头：往下猛拖，停在最后一张
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(box.x, box.y - k * 160);
  await page.mouse.up();
  await page.waitForTimeout(900);
  s = await shot(page);
  focused = s.cards.reduce((a, b) => (b.scale > a.scale ? b : a));
  check('往下滑到头就停在最后一张', focused.i === 13, `停在 ${focused.name}`);
}

// ── 4b. 上下两头**什么都不盖**：从招牌和底排底下滑过去 ──────────────
//
// 玩家第三轮原话：「上方和下方仍然有渐变的覆盖，完全去除，就让这一列 icon 在
// slides title 板块、个人主页和记录排名的板块下面滑过」。前两轮两次都走岔了：
// 第一轮一刀切在轴的边上，第二轮改成渐变遮罩——玩家说那还是「覆盖」。
//
// 所以这一节现在量四件事，缺一条都能让它变成假绿：
//   ① 一张都不淡（看得见的卡全是实的）；
//   ② 容器上没有遮罩；
//   ③ 卡片**真的画到了轴的盒子外面**，而且是从招牌底下过去的——拿招牌上一个点
//      去打，打到的必须是招牌，不是卡片；
//   ④ 画出去不撑大页面（overflow: clip 那一截）。
{
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(700);
  const look = await page.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const hr = host.getBoundingClientRect();
    const cards = [...host.children].filter((e) => e.classList.contains('home-icon-btn'));
    const rects = cards.map((c) => c.getBoundingClientRect());
    // 看得见的＝矩形和视口有交集的那几张
    const onScreen = rects
      .map((r, i) => ({ i, r }))
      .filter((x) => x.r.bottom > 0 && x.r.top < window.innerHeight);
    const css = getComputedStyle(host);
    const head = document.querySelector('.home-head-glass').getBoundingClientRect();
    // 招牌正中偏下那一点：轴的卡片正从这一带底下走
    const hit = document.elementFromPoint(head.left + head.width / 2, head.bottom - 6);
    return {
      op: onScreen.map((x) => +(+getComputedStyle(cards[x.i]).opacity).toFixed(3)),
      mask: (css.webkitMaskImage || css.maskImage || 'none').slice(0, 30),
      overflow: css.overflow,
      // 有没有卡片探出盒子（上或下）
      outside: rects.some((r) => r.top < hr.top - 2 || r.bottom > hr.bottom + 2),
      hitTag: hit ? hit.className || hit.tagName : '',
      docH: document.documentElement.scrollHeight,
      legalBottom: Math.round(
        document.querySelector('.home-legal').getBoundingClientRect().bottom + window.scrollY,
      ),
    };
  });
  check(
    '一张都不淡（看得见的卡全是实的）',
    look.op.length >= 3 && look.op.every((v) => v >= 0.999),
    `${look.op.length} 张在屏幕上：${look.op.join(' / ')}`,
  );
  check('容器上没有遮罩了', !/gradient/.test(look.mask), look.mask);
  check('卡片画得出轴的盒子（要从两块板子底下过去）', look.outside);
  check(
    '招牌压在卡片上面（是卡从底下滑过，不是卡盖住招牌）',
    /home-head|home-title|home-sub/.test(String(look.hitTag)),
    String(look.hitTag),
  );
  // 画出去**不撑大页面**：探出去的卡如果算进可滚动区，文档会凭空高出几百像素，
  // 法务那五条就被推得更远。页面总高应该到法务链接那一排为止（加上 .app 的
  // 底部留白，给 140px 的余量）。
  check(
    '画出去不撑大页面（overflow: clip 那一截）',
    look.docH <= look.legalBottom + 140,
    `文档高 ${look.docH} / 法务底 ${look.legalBottom}`,
  );
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
      vw: window.innerWidth,
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
  /**
   * 轴现在是 `overflow: clip` + 一圈 clip-margin：**画得出去**（卡片要从招牌和
   * 底排底下滑过），但不建滚动容器、不撑大页面。
   *
   * 这一条从前写的是 `=== 'hidden'`——那是第一轮一刀切在边上的做法，第三轮改掉
   * 了。老内核（Chrome 61）不认 clip，整条声明丢掉之后退回前面那行 hidden，所以
   * 两个值都算合格；真正不合格的是 `visible`：那样横竖都不裁，文档被探出去的卡
   * 撑大，手机上整页被缩小塞进屏幕（实测 390→413 宽），按视口居中的弹窗就和卡
   * 片列差出十几个像素——玩家看到的「炸弹那一屏没居中」就是这么来的。
   */
  check(
    '轴是 clip（能画出去但不撑大页面；老内核退回 hidden）',
    geo.clipped === 'clip' || geo.clipped === 'hidden',
    geo.clipped,
  );
  // 上面那条只看轴自己。横向那一截是 `.home-page` 兜的（clip-margin 四面都给，
  // 横向会撑宽文档），所以这儿连着量：视口宽必须还是 390，不是被缩放过的 413。
  check('页面没有被撑宽（视口还是 390）', geo.vw === 390, `innerWidth ${geo.vw}`);
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
