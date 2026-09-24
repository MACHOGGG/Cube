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
 *   · **法务那五条链接和底排导航都不被压住。** 轴占满整屏，卡片从底排底下滑过
 *     ——所以量的不是「轴够不着底排」，是底排那两颗照样点得着、照样画在上面。
 *   · **轴从屏幕最顶铺到最底。** 玩家第四轮点名的（「鱼眼转盘的范围一直从头到尾
 *     延伸」）。上一版停在底排上沿，两头各空一条带子，在他眼里就是「被挡住」。
 *   · **力道分档。** 同样的位移，快甩要比慢拖走得远（第四轮：「根据力道会有不同
 *     速度」「现在的 0.75 倍作为正常滑动的灵敏度」）。
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

/**
 * 把「上次停在哪一项」那一格抹掉，让下一次载入回到第一张。
 *
 * 轴的位置现在记在 sessionStorage 里（玩家定的「停在你上次看的那一项」，见
 * menu.ts 的 axisFocus）——刷新**不再**是回到第一项，所以凡是「先回到第一项再
 * 量」的那几段，都得自己先抹一下。不抹的话，第二把手势从上一把停的地方接着走，
 * 一路撞到轴的端点，两把量出来一样远（4g 那条倍率就是这么红的）。
 */
const forgetAxis = (pg) => pg.evaluate(() => {
  try {
    sessionStorage.removeItem('slides_axis_focus');
  } catch {
    /* 无痕模式：本来就没存 */
  }
});

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
    /*
     * 「选中线」不再是轴盒子的正中。
     *
     * 玩家 2026-09 第十二轮把整条轴（卡片 + 两侧点点 + 中线）往上挪了屏高的 1/5，具体
     * 像素数在 `--axis-shift` 里（modeAxis 的 measure 喝进去的）。这道门里凡是「哪一张
     * 对着选中线」的量法都要减它。**读变量而不写死 1/5**：写死的话，改了那一个
     * 数的那天这道门会红在**尺子**上而不是代码上。
     */
    const SH = (parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0);
    return { host: { top: hr.top, bottom: hr.bottom, h: hr.height, cy: hr.top + hr.height / 2 - SH, shift: SH }, cards };
  });

// ── 1. 轴立起来了，13 张卡都在上面 ───────────────────────────────────
let page = await menuPage({ slides_played_square: '1' });
{
  const s = await shot(page);
  check('轴上有 14 张卡', s.cards.length === 14, `${s.cards.length} 张：${s.cards.map((c) => c.name).join(' ')}`);
  /**
   * 卡片底下那行小字缩过一档（玩家第九轮：「主菜单的文字整体缩小字号」）。
   *
   * 量出来的数而不是 CSS 里那行 clamp()：clamp 有三个值，只改中间那个在 390 的
   * 屏上看不出来。12.5px 是改之前的，所以门设在 11——回到旧值立刻红。
   */
  const tagPx = await page.evaluate(() => {
    const t = document.querySelector('.mode-axis .home-icon-tag');
    return t ? parseFloat(getComputedStyle(t).fontSize) : -1;
  });
  check('卡片底下那行小字缩了一档（≤ 11px，原先 12.5）', tagPx > 0 && tagPx <= 11, `${tagPx}px`);
  /**
   * 轴占**整块屏幕**：上沿贴视口顶，下沿贴视口底。
   *
   * 玩家第四轮原话：「鱼眼转盘的范围一直从头到尾延伸」。上一版量的是「高度 > 300
   * 且底边不超出屏幕」——那条断言在「轴只有半屏高」的时候照样是绿的，正是它让
   * 「两头各空一条带子」一路活到玩家手里。所以这儿改成逐边对齐视口，留 1px 的
   * 取整余量。
   */
  check(
    '轴从屏幕最顶铺到最底（上沿 0、下沿 = 屏高）',
    Math.abs(s.host.top) <= 1 && Math.abs(s.host.bottom - 844) <= 1,
    `上沿 ${s.host.top.toFixed(1)} / 下沿 ${s.host.bottom.toFixed(1)} / 屏高 844`,
  );

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
    const el = document.querySelector('.mode-axis');
    const host = el.getBoundingClientRect();
    const first = document.querySelector('.mode-axis > .home-icon-btn').getBoundingClientRect();
    // 选中线往上挪了 --axis-shift（见 shot 里那段）。
    const mid = host.top + host.height / 2 - (parseFloat(getComputedStyle(el).getPropertyValue('--axis-shift')) || 0);
    return { gap: first.top + first.height / 2 - mid };
  });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const back = await page.evaluate(() => {
    const el = document.querySelector('.mode-axis');
    const host = el.getBoundingClientRect();
    const first = document.querySelector('.mode-axis > .home-icon-btn').getBoundingClientRect();
    // 选中线往上挪了 --axis-shift（见 shot 里那段）。
    const mid = host.top + host.height / 2 - (parseFloat(getComputedStyle(el).getPropertyValue('--axis-shift')) || 0);
    return { gap: first.top + first.height / 2 - mid };
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
  /**
   * 先把选中项摆回**中间**再量。
   *
   * 上一节末尾把轴拖到了最后一张，而选中项记在 sessionStorage 的
   * `slides_axis_focus` 里（menu.ts 那个 AXIS_KEY），同一个标签页里 goto 一次
   * 不会清掉它——于是这一节一进来就停在第 14 张：线以上堆着十三张，线以下一张
   * 都没有。这一节要量的偏偏是「上下两头」，少了一头就只剩半条路。
   *
   * 第十二轮整体上移屏幕 1/5 之后这件事才露出来：线从 422 挪到 253，线底下空
   * 出 591px，停在最后一张时那一大片全是空的，屏幕上只剩两张卡，
   * 「一张都不淡」和「靠边的卡是虚的」双双变红——红的是量法，不是代码。
   */
  await page.evaluate(() => sessionStorage.setItem('slides_axis_focus', '6'));
  await page.reload({ waitUntil: 'load' });
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
      vh: window.innerHeight,
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
  /**
   * 画出去**不撑大页面**，而且这一页正好一屏。
   *
   * 轴是 overflow: clip + 一圈 220px 的 clip-margin：卡片画得到招牌和底排那两带
   * 去，但不该把文档撑高。第五轮法务那五条从主菜单挪走之后，轴底下什么都没有
   * 了——于是「不撑大」可以量得更死：整页高度就该等于一屏（留 8px 取整余量）。
   * 多出来的那一截会让人以为下面还有东西，其实是空白。
   */
  check(
    '画出去不撑大页面，整页正好一屏',
    look.docH <= look.vh + 8,
    `文档高 ${look.docH} / 屏高 ${look.vh}`,
  );
  /**
   * 两头那一点**虚**。
   *
   * 玩家第四轮：「可以在上下两端有点轻微的模糊处理」。这是「不盖任何东西」之后
   * 唯一剩下的交代方式——不是淡出、不是遮罩（那两样他都否过），是景深。
   *
   * 三条一起量，缺一条都能成假绿：
   *   ① 靠边的那几张真的虚了；
   *   ② 正中那张一点都不虚（整条都糊 = 另一种事故）；
   *   ③ 虚的量是**量化过**的（0.5px 一档）——逐帧改 filter 要软件光栅化，量化是
   *      那条性能红线的实现手段，写进断言才不会被后来人顺手改掉。
   */
  const blur = await page.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const hr = host.getBoundingClientRect();
    const mid = hr.top + hr.height / 2 - (parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0);  // 选中线，见 shot 里那段
    return [...host.children]
      .filter((e) => e.classList.contains('home-icon-btn'))
      .map((e) => {
        const r = e.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        const m = /blur\(([\d.]+)px\)/.exec(e.style.filter || '');
        // room＝这张卡的中心离**最近那条屏幕边**还有多远，和 modeAxis.ts 里
        // `edgeOf(at) - far` 算的是同一件事。
        const room = Math.min(cy, window.innerHeight - cy);
        return { cy, room, d: Math.abs(cy - mid), px: m ? +m[1] : 0, on: cy > -100 && cy < window.innerHeight + 100 };
      })
      .filter((c) => c.on);
  });
  /**
   * 「靠边」原先写成「离选中线 > 300px」。那是个**代理量**，只在选中线正好在
   * 屏幕正中时才等于「靠近屏幕边」——第十二轮把整条轴上移屏幕 1/5 之后，线挪到
   * 了 253，线底下 300px 处是 553，离底边还有 291px，一点都不该虚，于是这条断言
   * 找不到「靠边的卡」直接红了。
   *
   * 改成量**离最近那条屏幕边的距离**，门槛照抄代码里的 BLUR_EDGE（150px）——量
   * 的和判的从此是同一件事，中线再挪也不用回来改这个数。
   */
  const BLUR_EDGE = 150; // 和 src/ui/modeAxis.ts 里那个常量对齐
  const nearEdge = blur.filter((c) => c.room < BLUR_EDGE);
  const atLine = blur.filter((c) => c.d < 60);
  check('靠近屏幕两端的卡是虚的', nearEdge.length > 0 && nearEdge.every((c) => c.px > 0),
    nearEdge.map((c) => `${c.cy.toFixed(0)}(边距${c.room.toFixed(0)})→${c.px}px`).join(' ') || '屏幕上没有靠边的卡');
  check('正中那张一点都不虚', atLine.length > 0 && atLine.every((c) => c.px === 0),
    atLine.map((c) => `${c.cy.toFixed(0)}→${c.px}px`).join(' '));
  check('虚的量是 0.5px 一档（量化过，不逐帧改 filter）',
    blur.every((c) => Math.abs(c.px * 2 - Math.round(c.px * 2)) < 1e-6),
    [...new Set(blur.map((c) => c.px))].sort((a, b) => a - b).join(' / '));
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
        // 量**画出来的**那个矩形，不是 computed width：点子的大小现在由
        // transform: scale() 给（逐帧改宽高太贵，见 modeAxis 的 paint），
        // computed width 十四颗全是 9px，照它量等于没量。
        return { w: +b.width.toFixed(1), o: +(+cs.opacity).toFixed(3), cy: b.top + b.height / 2 };
      }),
    );
    const el = document.querySelector('.mode-axis');
    const host = el.getBoundingClientRect();
    // 选中的那张：按**写出来的 scale** 认，和 shot() 一个认法。
    const cards = [...el.children].filter((e) => e.classList.contains('home-icon-btn'));
    const scaleOf = (e) => {
      const m = /scale\(([\d.]+)\)/.exec(e.style.transform || '');
      return m ? +m[1] : 0;
    };
    const fr = cards.reduce((a, b) => (scaleOf(b) > scaleOf(a) ? b : a)).getBoundingClientRect();
    const dv = document.querySelector('.mode-axis > .axis-divider');
    const dvr = dv && dv.getBoundingClientRect();
    return {
      rails: rails.length, dots,
      // 选中线往上挪了 --axis-shift（见 shot 里那段）。
      hostCy: host.top + host.height / 2 - (parseFloat(getComputedStyle(el).getPropertyValue('--axis-shift')) || 0),
      pe: rails[0] && getComputedStyle(rails[0]).pointerEvents,
      vh: window.innerHeight,
      cardCy: fr.top + fr.height / 2,
      dividerCy: dvr ? dvr.top + dvr.height / 2 : null,
    };
  });
  check('左右各一条点点轴', rail.rails === 2, `${rail.rails} 条`);
  check('每条轴上一项一颗点', rail.dots.every((d) => d.length === 14), rail.dots.map((d) => d.length).join(' / '));
  const widest = rail.dots[0].reduce((a, b) => (b.w > a.w ? b : a));
  const smallest = rail.dots[0].reduce((a, b) => (b.w < a.w ? b : a));
  check('最大那颗明显比最小那颗大（有大小梯度）', widest.w - smallest.w > 2, `${smallest.w} → ${widest.w}px`);
  check('最大那颗对着选中线（± 6px）', Math.abs(widest.cy - rail.hostCy) < 6, `${widest.cy.toFixed(0)} / ${rail.hostCy.toFixed(0)}`);
  // 它是路标不是控件：按在点子上那一下要能照常拖轴。
  check('点点轴不吃手势（pointer-events: none）', rail.pe === 'none', String(rail.pe));
  /**
   * 第十二轮：**整条轴上移屏幕的 1/5**。玩家原话「把主菜单中的两侧的点点快捷
   * 滑动（包括中线）和鱼眼转盘整体上移屏幕的 1/5 大概」——三样东西挂在同一条线
   * 上，一起挪才叫「整体」，挪了卡片没挪点点就是错位。
   *
   * 量的是**画出来的绝对位置**（该在 0.3 屏高处），不是 `--axis-shift` 这个变量
   * 本身：照着那个变量量等于拿尺子量尺子——SHIFT_FRAC 改回 0，上面那几条用
   * hostCy 的断言会跟着一起挪、照样全绿，只有这一条会红。
   */
  const wantCy = rail.vh / 2 - rail.vh / 5;
  const movedAll =
    Math.abs(rail.cardCy - wantCy) < 6 &&
    rail.dots.every((d) => Math.abs(d.reduce((a, b) => (b.w > a.w ? b : a)).cy - wantCy) < 6) &&
    (rail.dividerCy === null || Math.abs(rail.dividerCy - wantCy) < 6);
  check(
    '卡片、两侧点点、中线一起上移了屏幕的 1/5（该在 ' + wantCy.toFixed(0) + 'px）',
    movedAll,
    `卡 ${rail.cardCy.toFixed(0)} / 点 ${rail.dots.map((d) => d.reduce((a, b) => (b.w > a.w ? b : a)).cy.toFixed(0)).join(' ')} / 中线 ${rail.dividerCy === null ? '无' : rail.dividerCy.toFixed(0)}`,
  );
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

// ── 4e. 力道分档：同样的位移，快甩走得比慢拖远 ──────────────────────
//
// 玩家第四轮原话：「我希望滑动鱼眼转盘是根据力道会有不同速度的……现在的 0.75 倍
// 作为正常滑动的灵敏度，然后但用户上下滑动点点快速滑动的时候是现在这样的灵敏
// 度」。所以慢拖打 0.75 折、快甩不打折（modeAxis 的 SLOW_K / V_SLOW / V_FAST）。
//
// 量法：同一段 200px 的位移走两遍——一遍分 20 小步、每步停 30ms（慢），一遍分 5
// 大步、不停（快）——比走过了几项。每遍之前都先回到第一项：不回的话第二遍会撞上
// 轴的端点，走不动，量出来的是「一样远」（写这道门的时候就先掉进过这个坑）。
{
  const p5 = await menuPage({ slides_played_square: '1' });
  const box = await p5.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const focusedIndex = () => p5.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const hr = host.getBoundingClientRect();
    const mid = hr.top + hr.height / 2 - (parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0);  // 选中线，见 shot 里那段
    const cards = [...host.children].filter((e) => e.classList.contains('home-icon-btn'));
    let best = -1, bd = 1e9;
    cards.forEach((e, i) => {
      const r = e.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  });
  const toFirst = async () => {
    for (let i = 0; i < 3; i++) {
      await p5.mouse.move(box.x, box.y);
      await p5.mouse.down();
      for (let k = 1; k <= 10; k++) await p5.mouse.move(box.x, box.y + k * 60);
      await p5.mouse.up();
      await p5.waitForTimeout(220);
    }
    await p5.waitForTimeout(300);
  };
  const stroke = async (steps, pause) => {
    await toFirst();
    const from = await focusedIndex();
    await p5.mouse.move(box.x, box.y);
    await p5.mouse.down();
    for (let k = 1; k <= steps; k++) {
      await p5.mouse.move(box.x, box.y - (k * 200) / steps);
      if (pause) await p5.waitForTimeout(pause);
    }
    await p5.mouse.up();
    await p5.waitForTimeout(450);
    return (await focusedIndex()) - from;
  };
  const slow = await stroke(20, 30);
  const fast = await stroke(5, 0);
  check('慢拖也走得动（不是推不动）', slow >= 2, `慢拖 200px 走了 ${slow} 项`);
  check('同样 200px，快甩走得比慢拖远', fast > slow, `慢 ${slow} 项 / 快 ${fast} 项`);
  check('快甩也没飞到底（还停得住）', fast < 13, `${fast} 项`);
  await p5.close();
}

// ── 4f. 每滑过一项，震一下 ──────────────────────────────────────────
//
// 玩家第四轮：「每一经过一个玩法都有一点经过每一小卡的感觉」。声音本来就有（滑过
// 一项一声 scan），这一轮补上震动。桌面浏览器没有振动马达，所以这儿把
// navigator.vibrate 换成一个记账的桩——量的是「叫了几次、每次多长」，不是真的震。
{
  const p6 = await menuPage({ slides_played_square: '1' });
  await p6.evaluate(() => {
    window.__vib = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (ms) => { window.__vib.push(ms); return true; },
    });
  });
  const box = await p6.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p6.mouse.move(box.x, box.y);
  await p6.mouse.down();
  for (let k = 1; k <= 20; k++) { await p6.mouse.move(box.x, box.y - k * 12); await p6.waitForTimeout(16); }
  await p6.mouse.up();
  await p6.waitForTimeout(500);
  const vib = await p6.evaluate(() => window.__vib);
  check('滑过好几项就震好几下（一项一记）', vib.length >= 3, `震了 ${vib.length} 下`);
  check('每一记都很短（8ms，不是嗡一声）', vib.length > 0 && vib.every((v) => v === 8), [...new Set(vib)].join('/'));
  await p6.close();
}

// ── 4g. 第六轮：两档灵敏度、松手的那点惯性、炸弹缩图 ───────────────
//
// 玩家 2026-09 第六轮原话：「滑动侧边的点点快捷上下滑动滚轮按照现在的灵敏度，整体
// 滑动的动画更丝滑有轻微的物理动感，然后灵敏度调稍微低一点，明显要能感受到上下滑
// 动点点要比上下滑动主菜单内容要更快速便捷」。
//
// 这一段量四件事，每一件都是真出过的事故：
//
//   · **两档灵敏度**：同一段位移，靠边那一带（拨点点）要比中间（拖卡片）走得明显
//     更远。「明显」得有个数：这儿要求 ≥ 1.2 倍（代码里是 1 ÷ CARD_K ≈ 1.39）。
//   · **屏幕最边上那一条也要拖得动**。轴从前只占 `.home-page` 的内容宽（390 的屏
//     上是 22–368），屏幕最边上那两条 22px 宽的带子按下去打到的是页面，轴一动不
//     动——而那正是拇指从边上摸过来时最常落的地方，点点就画在旁边。
//   · **点点不许跟着挪**。上面那条是靠「盒子撑到视口、点点往回缩」做的，缩错了点
//     点就会贴到屏幕边上去。所以这儿按**页面内容框**对一遍位置。
//   · **松手那点惯性**：手指还在动的时候松开，要比「停下来再松」多走一点（但只多
//     走一点）。两遍手势的轨迹一模一样，差别只有「松手前停没停」，所以量到的差就
//     是惯性本身，不掺别的。
{
  const p7 = await menuPage({ slides_played_square: '1' });
  /** 每次刷新之后都要重装一遍（刷新会把这两样一起清掉）。 */
  const install = () => p7.evaluate(() => {
    /** 连续的焦点：哪一项的中心正落在选中线上（跨线的两张之间线性插值）。 */
    window.__focus = () => {
      const host = document.querySelector('.mode-axis');
      const hr = host.getBoundingClientRect();
      const mid = hr.top + hr.height / 2 - (parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0);  // 选中线，见 shot 里那段
      const cs = [...host.children]
        .filter((e) => e.classList.contains('home-icon-btn'))
        .map((el, i) => { const r = el.getBoundingClientRect(); return { i, d: r.top + r.height / 2 - mid }; });
      for (let k = 1; k < cs.length; k++) {
        const a = cs[k - 1], b = cs[k];
        if (a.d <= 0 && b.d >= 0) return a.i + (a.d === b.d ? 0 : -a.d / (b.d - a.d));
      }
      return cs[0] && cs[0].d > 0 ? cs[0].i : cs.length - 1;
    };
    // 松手**那一刻**的焦点：拿 window 的捕获阶段记，它比轴自己的 pointerup 先到。
    // 事后再用 evaluate 去问就晚了——那会儿弹簧已经在走，量到的是终点不是起点。
    addEventListener('pointerup', () => { window.__atUp = window.__focus(); }, true);
  });
  await install();
  /**
   * 从头上拖一把：x 决定走哪一档（靠边＝拨点点），hold 是松手前停多久。
   *
   * 每把之前先刷新回第一项——不回的话第二把会撞上轴的端点，两把都「走到底」，
   * 量出来的是「一样远」（4e 那一段就先掉进过这个坑）。
   */
  const swipe = async (x, { dist = 240, steps = 8, wait = 12, hold = 0 } = {}) => {
    await forgetAxis(p7);
    await p7.reload({ waitUntil: 'load' });
    await p7.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
    await p7.waitForTimeout(500);
    await install();
    const y0 = 620;
    const from = await p7.evaluate(() => window.__focus());
    await p7.mouse.move(x, y0);
    await p7.mouse.down();
    for (let k = 1; k <= steps; k++) {
      await p7.mouse.move(x, y0 - Math.round((dist * k) / steps));
      if (wait) await p7.waitForTimeout(wait);
    }
    if (hold) await p7.waitForTimeout(hold);
    await p7.mouse.up();
    await p7.waitForTimeout(900);
    const r = await p7.evaluate(() => ({ atUp: window.__atUp, final: window.__focus() }));
    return { from, atUp: r.atUp, final: r.final, went: r.final - from };
  };
  const mid = await p7.evaluate(() => {
    const r = document.querySelector('.mode-axis').getBoundingClientRect();
    return r.left + r.width / 2;
  });
  /**
   * 两条路各量各的，最后比的是**每走一项要多少手指位移**，不是「同样位移走了
   * 几项」。
   *
   * 后者在这儿会说谎：滚轮 240px 能翻十八项，可轴上一共才十四项——量出来是「到
   * 头了」（13），再拿它去除卡片的 7，得到 1.86，看着两者差不多。换成 px/项就
   * 没有这回事：滚轮拿一把不会到头的 120px 量，卡片拿 240px 量，各自算各自的斜
   * 率。
   */
  const card = await swipe(mid, { dist: 240 });
  const rail = await swipe(6, { dist: 120 });
  // 先立住尺子：两边本身都得真走得动，不然下面那条是拿 0 做除数。
  check('拖卡片：240px 真的走得动（下面那条才有意义）', card.went >= 3, `走了 ${card.went.toFixed(2)} 项`);
  check(
    '屏幕最边上那一条也拖得动（拇指从边上摸过来那一下）',
    rail.went >= 3,
    `x=6，120px 走了 ${rail.went.toFixed(2)} 项`,
  );
  const cardPer = 240 / card.went;
  const railPer = 120 / rail.went;
  check(
    '拨点点和拖卡片是两个灵敏度，而且差得出来（每项的手指位移差一倍以上）',
    railPer * 2 <= cardPer,
    `卡片 ${cardPer.toFixed(1)}px/项　点点 ${railPer.toFixed(1)}px/项　＝ 快 ${(cardPer / railPer).toFixed(1)} 倍`,
  );
  /**
   * 滚轮是**位置映射**：手指原路退回去，轴也原路退回来。
   *
   * 这一条把「两个控件」钉死了——卡片那条带加速度，原路退回去是回不到原点的
   * （快拨出去、慢拨回来，净走一段）。只有位置映射的滚轮才严格可逆，所以它一
   * 旦被改回「同一条路乘个数」，这一条立刻红。
   */
  // 先忘掉「上次停在哪一项」：不抹的话这一把从上一段停的地方（多半已经到底）开
  // 始，拨出去就撞在端点上，「原路退回来」量的是橡皮筋不是映射。
  await forgetAxis(p7);
  await p7.reload({ waitUntil: 'load' });
  await p7.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
  await p7.waitForTimeout(500);
  await install();
  const trip = await (async () => {
    const y0 = 620;
    const from = await p7.evaluate(() => window.__focus());
    await p7.mouse.move(6, y0);
    await p7.mouse.down();
    for (let k = 1; k <= 10; k++) { await p7.mouse.move(6, y0 - k * 12); await p7.waitForTimeout(16); }
    const far = await p7.evaluate(() => window.__focus());
    const lit = await p7.evaluate(() => document.querySelector('.mode-axis').classList.contains('mode-axis--rail'));
    for (let k = 9; k >= 0; k--) { await p7.mouse.move(6, y0 - k * 12); await p7.waitForTimeout(16); }
    const home = await p7.evaluate(() => window.__focus());
    await p7.mouse.up();
    await p7.waitForTimeout(500);
    const off = await p7.evaluate(() => document.querySelector('.mode-axis').classList.contains('mode-axis--rail'));
    return { from, far, home, lit, off };
  })();
  check('滚轮拨得出去（下面那条才有意义）', trip.far - trip.from >= 5, `从 ${trip.from.toFixed(2)} 拨到 ${trip.far.toFixed(2)} 项`);
  check(
    '滚轮是位置映射：手指原路退回去，轴也回到原处',
    Math.abs(trip.home - trip.from) < 0.05,
    `出发 ${trip.from.toFixed(2)} → 退回来 ${trip.home.toFixed(2)} 项`,
  );
  check('拨的时候那一列点子亮着（看得见自己抓住了哪一个）', trip.lit === true);
  check('松手就灭（不会一直亮着）', trip.off === false);
  // 反证：拖中间的卡片不该点亮点点——不然「亮」就不是在说「你抓住的是滚轮」。
  await forgetAxis(p7);
  await p7.reload({ waitUntil: 'load' });
  await p7.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
  await p7.waitForTimeout(500);
  const cardLit = await (async () => {
    const y0 = 620;
    await p7.mouse.move(mid, y0);
    await p7.mouse.down();
    for (let k = 1; k <= 6; k++) { await p7.mouse.move(mid, y0 - k * 20); await p7.waitForTimeout(16); }
    const lit = await p7.evaluate(() => document.querySelector('.mode-axis').classList.contains('mode-axis--rail'));
    await p7.mouse.up();
    return lit;
  })();
  check('拖中间的卡片不点亮点点（亮着就是「你抓的是滚轮」）', cardLit === false);
  // 点点还在老地方：`.home-page` 内容框左边 + 6（轨）+ 7（半个轨宽）。
  const dots = await p7.evaluate(() => {
    const page = document.querySelector('.home-page');
    const pr = page.getBoundingClientRect();
    const cs = getComputedStyle(page);
    const l = pr.left + parseFloat(cs.paddingLeft);
    const r = pr.right - parseFloat(cs.paddingRight);
    const dl = document.querySelector('.axis-rail--l .axis-dot').getBoundingClientRect();
    const dr = document.querySelector('.axis-rail--r .axis-dot').getBoundingClientRect();
    return {
      left: dl.left + dl.width / 2, want: l + 13,
      right: dr.left + dr.width / 2, wantR: r - 13,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check(
    '点点还在页面内容框里，没被推到屏幕边上',
    Math.abs(dots.left - dots.want) <= 1.5 && Math.abs(dots.right - dots.wantR) <= 1.5,
    `左 ${dots.left.toFixed(1)}（该在 ${dots.want.toFixed(1)}）/ 右 ${dots.right.toFixed(1)}（该在 ${dots.wantR.toFixed(1)}）`,
  );
  check('轴撑到视口也没撑出横向滚动', dots.overflow === 0, `多出 ${dots.overflow}px`);

  // 惯性：同一把手势，一遍松手时手还在动，一遍停 150ms 再松。
  const fling = await swipe(mid, { steps: 6, wait: 6 });
  const put = await swipe(mid, { steps: 6, wait: 6, hold: 150 });
  check(
    '手还在动的时候松开，会比「停下来再松」多滑一点（这就是那点物理动感）',
    fling.final - put.final >= 1,
    `甩 ${fling.final.toFixed(0)} / 放 ${put.final.toFixed(0)}（松手时都在 ${fling.atUp.toFixed(2)}）`,
  );
  check(
    '但也只多滑一点，不会自己飞走好几项',
    fling.final - put.final <= 2,
    `多走 ${(fling.final - put.final).toFixed(2)} 项`,
  );
  check(
    '停下来再松手，就停在眼睛看着的那一项（不会凭空跳一格）',
    Math.abs(put.final - Math.round(put.atUp)) < 0.01,
    `松手时 ${put.atUp.toFixed(2)} → 停在 ${put.final.toFixed(0)}`,
  );
  await p7.close();
}

// ── 4h. 炸弹那张缩图：三层等高，整个装得进格子 ──────────────────────
//
// 玩家 2026-09 报的：「点开前缩图里三个小的圆角矩形上下空间不等距，最下面那个的一
// 部分被卡走了」。根子是 `.bomb-row` 的 `flex: 1` 配上默认的 `min-height: auto`：
// 中间那层里 90s 那道星芒比别人高，整块内容 97 > 格子里的 83，第三层于是被挤到格
// 子外面，让轴那一格的 overflow 一刀切掉——上下也就不等距了（顶上是内边距，底下是
// 溢出）。量的是比例，不是像素：这张卡在轴上随时被 scale 着，像素每帧都不一样。
{
  const p8 = await menuPage({ slides_played_square: '1' });
  const m = await p8.evaluate(() => {
    const mini = document.querySelector('.mode-axis .home-bomb-mini');
    if (!mini) return null;
    const panel = mini.querySelector('.bomb-panel') || mini;
    const pr = panel.getBoundingClientRect();
    const rows = [...panel.querySelectorAll('.bomb-row')].map((r) => r.getBoundingClientRect());
    const chips = [...panel.querySelectorAll('.bomb-chip')].map((c) => c.getBoundingClientRect());
    const burst = panel.querySelector('.bomb-90s')?.getBoundingClientRect();
    return {
      rows: rows.map((r) => ({ h: r.height, top: r.top - pr.top, bottom: pr.bottom - r.bottom })),
      panelH: pr.height,
      // 小片顶出自己那一层多少（负数＝还在层里）。前三颗在第一层，后三颗在第三层。
      chipOut: chips.length
        ? Math.max(...chips.map((c, i) => {
            const r = rows[i < 3 ? 0 : 2];
            return Math.max(r.top - c.top, c.bottom - r.bottom);
          }))
        : null,
      burstPos: burst ? getComputedStyle(panel.querySelector('.bomb-90s')).position : null,
      burstOff: burst
        ? Math.max(
            Math.abs(burst.left + burst.width / 2 - (pr.left + pr.width / 2)),
            Math.abs(burst.top + burst.height / 2 - (pr.top + pr.height / 2)),
          )
        : null,
    };
  });
  check('炸弹缩图找得到（下面几条才有意义）', !!m && m.rows.length === 3, m ? `${m.rows.length} 层` : '没找到');
  if (m && m.rows.length === 3) {
    const hs = m.rows.map((r) => r.h);
    const spread = (Math.max(...hs) - Math.min(...hs)) / m.panelH;
    check('三层等高（差不到整块的 2%）', spread < 0.02, `${hs.map((h) => h.toFixed(1)).join(' / ')}px`);
    const padTop = m.rows[0].top;
    const padBottom = m.rows[2].bottom;
    check(
      '上下等距（最下面那层没有被卡掉）',
      Math.abs(padTop - padBottom) / m.panelH < 0.02 && padBottom > -0.5,
      `顶上 ${padTop.toFixed(1)}px / 底下 ${padBottom.toFixed(1)}px`,
    );
    const gaps = [m.rows[1].top - (m.rows[0].top + hs[0]), m.rows[2].top - (m.rows[1].top + hs[1])];
    check('三层之间两道缝也一样宽', Math.abs(gaps[0] - gaps[1]) / m.panelH < 0.02, `${gaps.map((g) => g.toFixed(1)).join(' / ')}px`);
    /**
     * 下面两条守的是**那三条为什么成立**，不是它们成立没有。
     *
     * 小片改成按板宽定大小（不按 flex 分出来的层高）、星芒改成绝对定位（不参与
     * 分高），为的是别再踩「百分比高度在 Safari 上算不准」那一脚——这张卡上一次
     * 出事（整张溢到屏幕外）就只在 iPhone 上复现得出来，而这儿的门跑在 Chromium
     * 上，量不到那种差异。所以量的是「有没有留出余量」和「星芒在不在流里」：这
     * 两样一旦回到老写法，Chromium 上也立刻看得见。
     */
    check(
      '小片整个待在自己那一层里（留着余量，不是刚好卡住）',
      m.chipOut !== null && m.chipOut < -0.02 * m.panelH,
      `离层边还有 ${(-m.chipOut).toFixed(1)}px`,
    );
    check(
      '星芒不参与分高（绝对定位，钉在板正中）',
      m.burstPos === 'absolute' && m.burstOff < 1,
      `position: ${m.burstPos} / 偏离板心 ${m.burstOff?.toFixed(1)}px`,
    );
  }
  await p8.close();
}

// ── 4i. 回到主菜单，停在他离开时那一项 ──────────────────────────────
//
// 玩家 2026-09 定的：「停在你上次看的那一项」。主菜单每次都是**重画**的（轴活不
// 到下一次），所以位置记在 menu.ts 的 axisFocus 里，再存一份到 sessionStorage。
//
// 存那一份是给 iPhone 的：Safari 切到后台过一会儿会把整个标签页丢掉重新载入——玩
// 家自己什么都没做，回来却从第一张开始。只记在模块变量里的话，这道门的「退回来
// 还在」是绿的，而真机上那条路是红的。所以这儿**刷新一次再量一遍**。
//
// 同时也量反面：**新开一个标签页要从第一张开始**。用 sessionStorage 不用
// localStorage 就是为了这个——隔天再来还停在第九张上是另一种「意料之外的界面」。
{
  const p9 = await menuPage({ slides_played_square: '1' });
  const focusedNow = () => p9.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    if (!host) return null;
    const hr = host.getBoundingClientRect();
    const mid = hr.top + hr.height / 2 - (parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0);  // 选中线，见 shot 里那段
    let best = null, bd = 1e9, idx = -1, i = -1;
    for (const el of [...host.children]) {
      if (!el.classList.contains('home-icon-btn')) continue;
      i++;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bd) { bd = d; best = el; idx = i; }
    }
    return { i: idx, name: best.getAttribute('aria-label') };
  });
  /**
   * 往下挪几项：**拨侧边那条点点**，不是拖中间的卡片。
   *
   * 从前这儿拖的是卡片，一把 54px、拨三把。第七轮把两条路分开之后，卡片那条
   * 明显钝了（玩家要的「灵敏度稍微低一点」），54px 一项都不走——这一段于是停在
   * 第 0 项，后面「退回来还在原处」就成了空话（停在 0 怎么退都在 0）。
   * 滚轮一把 40px 正好三项，稳当，也顺带证明了滚轮真的在工作。
   */
  await p9.mouse.move(6, 620);
  await p9.mouse.down();
  for (let k = 1; k <= 6; k++) { await p9.mouse.move(6, 620 - k * 7); await p9.waitForTimeout(30); }
  await p9.waitForTimeout(160);
  await p9.mouse.up();
  await p9.waitForTimeout(600);
  const left = await focusedNow();
  // 先立前提：真的挪开了。停在第 0 项的话，下面两条「还在原处」自己就成立了。
  check('先滑开几项（下面两条才有意义）', left && left.i > 0, `停在第 ${left?.i} 项 ${left?.name}`);
  await p9.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const hr = host.getBoundingClientRect();
    const mid = hr.top + hr.height / 2 - (parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0);  // 选中线，见 shot 里那段
    let best = null, bd = 1e9;
    for (const el of [...host.children]) {
      if (!el.classList.contains('home-icon-btn')) continue;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bd) { bd = d; best = el; }
    }
    best.click();
  });
  await p9.waitForTimeout(1200);
  check('点进去了（离开了主菜单）', !(await p9.$('.mode-axis')));
  await p9.evaluate(() => history.back());
  await p9.waitForSelector('.mode-axis .home-icon-btn', { timeout: 15000 });
  await p9.waitForTimeout(700);
  const back = await focusedNow();
  check(
    '退回主菜单：还停在他离开时那一项',
    back && left && back.i === left.i,
    `走的时候 ${left?.name}（第 ${left?.i} 项）/ 回来 ${back?.name}（第 ${back?.i} 项）`,
  );
  // iPhone 把标签页丢掉重载的那条路。
  await p9.reload({ waitUntil: 'load' });
  await p9.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
  await p9.waitForTimeout(700);
  const reloaded = await focusedNow();
  check(
    '刷新之后也还在那一项（iPhone 会自己把标签页丢掉重载）',
    reloaded && left && reloaded.i === left.i,
    `${reloaded?.name}（第 ${reloaded?.i} 项）`,
  );
  await p9.close();
  // 反面：另开一个标签页，从第一张开始。
  const p10 = await menuPage({ slides_played_square: '1' });
  const fresh = await p10.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const hr = host.getBoundingClientRect();
    const mid = hr.top + hr.height / 2 - (parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0);  // 选中线，见 shot 里那段
    let bd = 1e9, idx = -1, i = -1, name = '';
    for (const el of [...host.children]) {
      if (!el.classList.contains('home-icon-btn')) continue;
      i++;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bd) { bd = d; idx = i; name = el.getAttribute('aria-label'); }
    }
    return { i: idx, name };
  });
  check('新开一个标签页还是从第一张（基础方块）开始', fresh.i === 0, `${fresh.name}（第 ${fresh.i} 项）`);
  await p10.close();
}

// ── 5. 点一下就开，滑一下不开 ────────────────────────────────────────
{
  // 从第一张开始：这一段要点的是**滑到哪儿就是哪儿**的那张卡，从上一段停的位置
  // 接着滑会落到天才那几张锁着的上面——点锁着的开的是订阅窗，不是玩法。
  await forgetAxis(page);
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

// ── 6. 首玩期：十四张全在轴上，除了两张基础的都锁着 ────────────────
//
// 口径 2026-09 第五轮换过一次。上一版是「轴上只摆那两张」，玩家改成：「转盘也可
// 以看到所有内容只是有锁而已，在基础的方块、小球玩法下面写着『我会玩』，下面是
// 其他的玩法。玩家如果点击了『我会玩』就解锁了」。
//
// 所以这一节量四件事：都在、锁对了、锁着的按不动、《我会玩》排在两张基础卡后面。
{
  const p2 = await menuPage();
  const s = await shot(p2);
  check('首玩期十四张全在轴上', s.cards.length === 14, `${s.cards.length} 张`);
  const shape = await p2.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const cards = [...host.children].filter((e) => e.classList.contains('home-icon-btn'));
    const div = host.querySelector('.axis-divider');
    const cy = (e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; };
    return {
      list: cards.map((e) => ({
        name: (e.getAttribute('aria-label') || '').split(' ·')[0].trim(),
        locked: e.classList.contains('home-icon-btn--locked'),
        cy: cy(e),
      })),
      // 分界线在第几张和第几张之间（按这一帧画出来的位置算，不按 DOM 顺序）
      divAbove: div ? cards.filter((c) => cy(c) < cy(div)).length : -1,
      divCy: div ? cy(div) : null,
      hasDiv: !!div,
    };
  });
  const order = shape.list;
  check('前两张是基础方块和基础小球，而且没锁',
    order.slice(0, 2).every((o) => !o.locked) && /方块/.test(order[0].name) && /圆球|小球/.test(order[1].name),
    order.slice(0, 2).map((o) => o.name).join(' '));
  /**
   * 《我会玩》是**两站之间那条分界线**，不是轴上的一站。
   *
   * 玩家 2026-09 第九轮：「《我会玩》上方有巨大的空格，按理说就是一个小小的文字
   * （文字两边是分割线分出上面基础方块、小球玩法和其他锁住的）和按钮不占额外的
   * 位置」。上一版把它塞成轴上的一项，站距是均匀的 150–210px，而它只有 44px 高
   * ——上下各空出一大截。
   *
   * 所以这儿量的不再是「它排第几项」（那是旧设计的尺子），而是两件现在才成立的
   * 事：**轴还是十四站**（它没占位），**画出来正好落在第 2 张和第 3 张之间**。
   * 前者是玩家那句话的直接翻译，后者保证它还在分该分的那条缝。
   */
  check('轴上还是十四站（《我会玩》没占掉一站）', order.length === 14, `${order.length} 站`);
  check('有那条分界线', shape.hasDiv);
  check(
    '分界线落在两张基础卡和锁着的那些之间',
    shape.divAbove === 2,
    `线上头有 ${shape.divAbove} 张（该是 方块 圆球 两张）`,
  );
  check('其余十二张都锁着', order.filter((o) => o.locked).length === 12, `锁着 ${order.filter((o) => o.locked).length} 张`);
  /**
   * 锁着的那张**按不动**。
   *
   * 这一条是这一轮真出过的事故：拦截那段（armFirstPlayLock）从前是靠
   * `.home-icon-btn--glow` 认「哪几张能玩」——头一回打开的人一圈光都没有，于是
   * 它一次都没装上，新玩家点哪张都能直接开局。所以这儿不光量「还在菜单上」，
   * 还量「两张基础卡抖了一下」，两条一起才说明拦截真的在。
   */
  const blocked = await p2.evaluate(async () => {
    const host = document.querySelector('.mode-axis');
    const locked = [...host.children].find((e) => e.classList.contains('home-icon-btn--locked'));
    locked.click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      stay: !!document.querySelector('.mode-axis'),
      nudge: document.querySelectorAll('.home-icon-btn--nudge').length,
    };
  });
  check('点锁着的那张：开不了局', blocked.stay);
  check('点锁着的那张：两张基础卡抖一下（拦截真的装上了）', blocked.nudge === 2, `${blocked.nudge} 张`);
  check('首玩期那颗《我会玩》还在', await p2.evaluate(() => !!document.querySelector('.know-how-btn')));
  /**
   * 《我会玩》现在是**轴上的一项**，不是浮在底排上方的那颗了（第五轮改的：它排
   * 在两张基础卡和其余玩法之间）。所以量的东西也跟着换：
   *   · 它跟着轴走——绝对定位在轴里，横向居中；
   *   · **热区只有文字那么宽**。整幅宽的话，那一行左右两截看上去空空如也，手指
   *     落一下就把整套引导撤了（玩家点名不要的「意料之外的疏漏操作」）。同一高
   *     度的最左最右各打一下，打到的不能是它。
   */
  const skip = await p2.evaluate(() => {
    const e = document.querySelector('.know-how-btn');
    const host = document.querySelector('.mode-axis');
    const r = e.getBoundingClientRect();
    const at = (x) => {
      const t = document.elementFromPoint(x, r.top + r.height / 2);
      return !!t && (t === e || e.contains(t));
    };
    const box = e.closest('.axis-divider') || e;
    return {
      inAxis: box.parentElement === host,
      pos: getComputedStyle(box).position,
      w: r.width, vw: window.innerWidth,
      cx: r.left + r.width / 2,
      left: at(10), right: at(window.innerWidth - 10),
    };
  });
  check('《我会玩》住在轴上（跟着卡片一起滑）', skip.inAxis && skip.pos === 'absolute', `父级=${skip.inAxis ? '轴' : '别处'} / ${skip.pos}`);
  check('《我会玩》横向居中', Math.abs(skip.cx - skip.vw / 2) < 2, `中心 ${skip.cx.toFixed(0)} / 屏心 ${skip.vw / 2}`);
  check('《我会玩》的热区没有横贯整屏', !skip.left && !skip.right && skip.w < skip.vw * 0.5, `宽 ${skip.w.toFixed(0)} / 屏宽 ${skip.vw}`);
  // 按下《我会玩》→ 锁全撤、那一项自己也没了
  await p2.evaluate(() => document.querySelector('.know-how-btn').click());
  await p2.waitForTimeout(800);
  const s2 = await shot(p2);
  check('按了《我会玩》轴上还是 14 项', s2.cards.length === 14, `${s2.cards.length} 张`);
  const after = await p2.evaluate(() => ({
    locked: document.querySelectorAll('.mode-axis > .home-icon-btn--locked').length,
    skip: !!document.querySelector('.axis-know-how'),
  }));
  // 剩下那 5 张锁是 Slides 天才那一套（老虎机 · 无限反转 · 步步为营 · 七色圆球 ·
  // 进阶三角），和首玩期这道锁是两回事，不该被一起撤掉。
  check('按了《我会玩》之后只剩天才那 5 把锁', after.locked === 5, `${after.locked} 把`);
  check('《我会玩》自己也从轴上撤了', after.skip === false);
  await p2.close();
}

// ── 7. 轴从底排底下过去，但底排照样点得着 ──────────────────────────
{
  const p3 = await menuPage({ slides_played_square: '1' });
  const geo = await p3.evaluate(() => {
    const host = document.querySelector('.mode-axis').getBoundingClientRect();
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
    // 底排那块圆角面板正中打一下：打到的必须是底排自己，不能是从底下滑过去的卡。
    const dockEl = document.querySelector('.home-nav-dock');
    const dr = dockEl?.getBoundingClientRect() ?? null;
    const overDock = dr
      ? (() => {
          const t = document.elementFromPoint(dr.left + dr.width / 2, dr.top + dr.height / 2);
          return t ? (t.className || t.tagName) : '';
        })()
      : '';
    const cards = [...document.querySelector('.mode-axis').children]
      .filter((e) => e.classList.contains('home-icon-btn') && Number(getComputedStyle(e).opacity) > 0.01)
      .map((e) => e.getBoundingClientRect());
    return {
      hostBottom: host.bottom,
      hasLegal: !!document.querySelector('.home-legal'),
      navTop: nav?.top ?? -1,
      navH: nav?.height ?? 0,
      dockBlocked: dockHits.filter((h) => !h.hit).map((h) => h.label),
      dockN: dockHits.length,
      overDock: String(overDock),
      lowestCard: Math.max(...cards.map((r) => r.bottom)),
      clipped: getComputedStyle(document.querySelector('.mode-axis')).overflow,
      vh: window.innerHeight,
      vw: window.innerWidth,
    };
  });
  /**
   * 主菜单上**不再有**法务那五条链接。
   *
   * 玩家 2026-09 第五轮：「主页省略下方的价格、法律等部分，只留在个人主页的部
   * 分」。（宽版本来就不摆，所以这一改之后宽窄一个样。）它们没有消失：个人主页
   * 最底下那五行、以及 /pricing /terms /refund /privacy /contact 五个真网址都还
   * 在——那一半由 check-legal-pages 和 check-creem-review 守着，不在这道门里。
   *
   * 这儿只量「主菜单上没有了」，外加下面那条「整页正好一屏」——两条合起来才是
   * 玩家要的那个样子：滑到底也没有多出来的一截。
   */
  check('主菜单上没有法务那五条了', geo.hasLegal === false);
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
   * 「没被压住」这一条第四轮换了口径。从前量的是「轴的底边在底排上沿之上」——
   * 那是上一版的排法（轴停在底排那儿）。现在轴铺满整屏，卡片**本来就要从底排底
   * 下滑过去**（玩家原话：「就让这一列 icon 在……个人主页和记录排名的板块下面滑
   * 过」），再量那个反而是逼着人把玩家要的效果改回去。
   *
   * 所以改量两件真正要紧的事：
   *   · 底排那两颗**真的点得着**（elementFromPoint 打它们的下半截——最靠近轴的那
   *     一侧）。这一条是「卡片不许截走底排的手势」。
   *   · 底排**画在卡片上面**（打中的是底排自己，不是某张卡）。只量点得着不够：
   *     真出事的时候是两颗键叠在一张卡上面，点还是点得着，画面却是错的。
   * 再加上第一条「底排找得到」——类名一写错，后面两条自动变成真空（`.bottom-nav`
   * 那次就是这么绿了一整轮的）。
   */
  check('底排找得到（.home-nav，类名没写错）', geo.navTop > 0 && geo.navH > 0, `top ${geo.navTop.toFixed(0)} / 高 ${geo.navH.toFixed(0)}`);
  check('轴一直铺到底排底下（第四轮：从头到尾）', geo.hostBottom >= geo.navTop + 10, `轴底 ${geo.hostBottom.toFixed(0)} / 底排顶 ${geo.navTop.toFixed(0)}`);
  check(
    '底排那两颗点得着',
    geo.dockN === 2 && geo.dockBlocked.length === 0,
    geo.dockBlocked.length ? `点不着：${geo.dockBlocked.join(' ')}` : `${geo.dockN} 颗都点得着`,
  );
  check(
    '底排画在卡片上面（是卡从底下滑过，不是卡盖住底排）',
    /home-nav/.test(geo.overDock),
    geo.overDock,
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

// ── 9. 每张图的尺寸和位置 ────────────────────────────────────────────
/**
 * **这一节守的是「图标本身」，前面八节一条都没管到。**
 *
 *   1. **每张图的格子都正好是 --axis-art × --axis-art。** style.css 里那段注释记
 *      着：窄屏那条
 *      `.home-page:not(.home-page--wide) .home-icon-btn { max-width: min(165px, …) }`
 *      特指度 0,3,0，压得过 `.mode-axis > .home-icon-btn` 的 0,2,0——轴上的卡于是
 *      被按在 157px 宽，宽画布的那几张图溢出去压住左右。**当时要是有这一条，那件
 *      事不会发生第二次。**
 *   2. **图完整落在格子里，四边都不越界。** 这一条专门抓炸弹：它那张的「图」不是
 *      svg 而是一块 `.bomb-panel`（block + aspect-ratio），在「宽度 auto」的盒子里
 *      `width:auto` 是一道循环，Chromium 解成 112、**Safari 解成整幅可用宽**——同
 *      一份代码两个内核算出不同的数，iPhone 上那块红板子于是撑成三百多像素宽。
 *      玩家为这个 bug 报过两轮。
 *   3. **每张卡的水平中心都对准轴的中线。** 排布歪了在截图上看着像「没对齐」，
 *      实际是热区和眼睛看到的位置对不上。
 *
 * **量的是版面盒子（offsetWidth/offsetHeight），不是屏幕上的矩形。** 轴上的卡被
 * 鱼眼 scale 过，getBoundingClientRect 算的是变换之后的数——同一把 112px 的格子，
 * 在焦点那张上量出来是 179，隔两张是 81。那不是格子变了，是整张卡被放大了。
 * （溢出那一条例外：图和格子被同一个 scale 缩过，两者相减仍然是有意义的。）
 *
 * **`--axis-art` 是读出来的，不写死 112。** 写死的话，改 token 的那天这道门会红在
 * 「尺子」上而不是代码上；读出来则两边永远一致，而「被外面压住」照样抓得住。
 *
 * 三种视口都过一遍。568×320 走的是宽版排布（没有轴），那一台会明说跳过——
 * **跳过要说出来**，免得「没量」被当成「量过了，没问题」。
 */
for (const [vw, vh, label] of [[390, 844, '390×844'], [360, 640, '360×640'], [568, 320, '568×320']]) {
  const c = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: true, hasTouch: true });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
  await pg.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem('slides_played_square', '1');
    localStorage.setItem('slides_played_circle', '1');
  });
  await pg.goto(BASE, { waitUntil: 'load' });
  const onAxis = await pg.waitForSelector('.mode-axis .home-icon-btn', { timeout: 15000 }).then(() => true).catch(() => false);
  if (!onAxis) {
    check(`${label}：这台不走鱼眼轴（宽版排布），本节跳过`, true, '');
    await c.close();
    continue;
  }
  await pg.waitForTimeout(500);

  const art = await pg.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    const token = parseFloat(getComputedStyle(host).getPropertyValue('--axis-art')) || 0;
    const hr = host.getBoundingClientRect();
    const midX = hr.left + hr.width / 2;
    // 直接子元素，不是后代：炸弹那张卡里嵌着九颗也顶着 .home-icon-btn 的小片
    // （pointer-events: none，是画不是控件），用后代选择器会把它们也算成轴上的站。
    const rows = [...host.children]
      .filter((e) => e.classList.contains('home-icon-btn'))
      .map((el) => {
        const a = el.querySelector(':scope > .home-icon-art');
        const kid = a && a.firstElementChild;
        const ar = a && a.getBoundingClientRect();
        const kr = kid && kid.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') || '').split(' ·')[0],
          // 版面盒子：不受 scale 影响，这才是「格子有多大」。
          boxW: a ? a.offsetWidth : -1,
          boxH: a ? a.offsetHeight : -1,
          cardW: el.offsetWidth,
          cardMaxW: getComputedStyle(el).maxWidth,
          kind: kid
            ? (kid.tagName.toLowerCase() === 'svg' ? 'svg' : (kid.className || '').toString().trim() || kid.tagName.toLowerCase())
            : '（空）',
          // 有没有图。没有的话下面两条会自动通过——那是在量空气，所以要报出来。
          hasArt: !!(a && kid),
          // 图比格子多出来多少（正数=溢出）。四边取最大的那一边。
          over: ar && kr
            ? Math.max(ar.left - kr.left, kr.right - ar.right, ar.top - kr.top, kr.bottom - ar.bottom)
            : 0,
          offX: er.left + er.width / 2 - midX,
        };
      });
    /*
     * 把轴上那条 `.bomb-panel` 规则的**源文本**读出来。
     *
     * 不能读 computed style：那边 `width: auto` 会被解成一个具体的 px 值，看不出来。
     * 而这一条要守的恰恰是「源码里一个 auto 都不能留」——因为 auto 在这儿是一道
     * 循环，Chromium 解成 112、**Safari 解成整幅可用宽**。开 Chromium 的门看不见那个
     * 内核差异，只看得见「有没有留下那个循环」。
     */
    let bombRule = '';
    for (const sh of document.styleSheets) {
      let rules;
      try { rules = sh.cssRules; } catch { continue; }
      for (const r of rules || []) {
        if (r.selectorText && /\.mode-axis[^,{]*\.bomb-panel/.test(r.selectorText)) {
          bombRule += r.style.cssText + ' ';
        }
      }
    }
    return { token, rows, hostW: host.clientWidth, bombRule: bombRule.trim() };
  });

  // ④ 一张表：出问题时一眼看得见是哪张，不用猜
  console.log(`\n  ${label}  --axis-art = ${art.token}px`);
  console.log('  ' + '卡'.padEnd(14) + '格子'.padEnd(12) + '图'.padEnd(14) + '溢出'.padEnd(8) + '卡宽'.padEnd(8) + '偏中线');
  for (const r of art.rows) {
    console.log(
      '  ' + String(r.name).padEnd(14) +
      `${r.boxW}×${r.boxH}`.padEnd(14) + String(r.kind).padEnd(16) +
      `${r.over.toFixed(1)}`.padEnd(9) + `${r.cardW}`.padEnd(9) + `${r.offX.toFixed(1)}`,
    );
  }

  const withArt = art.rows.filter((r) => r.hasArt);
  check(
    `${label}：十四张卡都量到图了（下面三条才有意义）`,
    art.rows.length === 14 && withArt.length === 14 && art.token > 0,
    `${art.rows.length} 张卡 / ${withArt.length} 张有图 / token ${art.token}px`,
  );

  // ① 格子正好是 token × token
  const wrong = art.rows.filter((r) => Math.abs(r.boxW - art.token) > 1 || Math.abs(r.boxH - art.token) > 1);
  check(
    `${label}：每张图的格子都是 ${art.token}×${art.token}（容差 1px）`,
    wrong.length === 0,
    wrong.length
      ? wrong.map((r) => `${r.name} ${r.boxW}×${r.boxH}（卡宽 ${r.cardW}，max-width ${r.cardMaxW}）`).join(' / ')
      : '',
  );

  /**
   * ①b **每张卡本身是整幅宽。**
   *
   * 这一条才是真正抳住 157px 那次事故的。反向验过：把
   * `.home-page:not(.home-page--wide) .home-icon-btn { max-width: 157px }` 注回去，
   * **上面那两条纹丝不动**——因为这一版的格子是 `width/height: var(--axis-art)`
   * 写死的，卡变窄根本不影响格子（当年那个 bug 就是从这一层堆死的）。但卡
   * 本身会被压成 157，而它应该是整幅宽——图在卡里自己居中靠的就是这一点。
   * 所以量卡宽：压回去立刻红。
   */
  const narrow = art.rows.filter((r) => Math.abs(r.cardW - art.hostW) > 1);
  check(
    `${label}：每张卡都是整幅宽（没被外面的 max-width 压住）`,
    narrow.length === 0,
    narrow.length
      ? narrow.map((r) => `${r.name} 卡宽 ${r.cardW} ≠ 轴宽 ${art.hostW}（max-width ${r.cardMaxW}）`).join(' / ')
      : `卡宽 ${art.hostW}`,
  );

  // ② 图完整落在格子里（炸弹那张就靠这条）
  const spill = art.rows.filter((r) => r.over > 0.6);
  check(
    `${label}：每张图都完整落在格子里（炸弹那张的 .bomb-panel 就靠这条）`,
    spill.length === 0,
    spill.length ? spill.map((r) => `${r.name}（${r.kind}）溢出 ${r.over.toFixed(1)}px`).join(' / ') : '',
  );

  // ③ 水平中心对准中线
  const off = art.rows.filter((r) => Math.abs(r.offX) > 1);
  check(
    `${label}：每张卡的水平中心都对准中线（容差 1px）`,
    off.length === 0,
    off.length ? off.map((r) => `${r.name} 偏 ${r.offX.toFixed(1)}px`).join(' / ') : '',
  );
  /**
   * ⑤ **轴上那条 `.bomb-panel` 规则里，宽高一个 auto 都不能留。**
   *
   * modeAxis 那段注释记着：炸弹那张的「图」不是 svg，是一块 `.bomb-panel`
   * （block + aspect-ratio）。给它 `width: auto; height: 100%` 的话，块级元素的
   * `width: auto` 在「收缩到内容」的盒子里是一道循环：Chromium 按 aspect-ratio
   * 解成 112，**Safari 解成整幅可用宽**，那块红板子于是撑成三百多像素宽、从
   * 112 的格子里往左溢出去半个屏幕。玩家为这个 bug 报过两轮。
   *
   * **这道门跑的是 Chromium，看不见 Safari 那个解法。** 上面那几条量的是渲染结
   * 果，在 Chromium 上永远是 112——反向验证过，把 auto 注回去它们一条都不红。所
   * 以这一条量的不是结果，是**源码里还有没有留下那个循环**——唯一一个开
   * Chromium 也能守住的角度。
   */
  check(
    `${label}：炸弹那块板子的宽高都写死了（一个 auto 都没留 — Safari 专用防线）`,
    art.bombRule.length > 0 && !/\b(width|height)\s*:\s*auto/.test(art.bombRule),
    art.bombRule || '（根本没找到这条规则）',
  );
  await c.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);
