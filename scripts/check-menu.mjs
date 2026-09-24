/**
 * 主菜单和它弹出来的那几个选择窗口。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-menu.mjs http://localhost:8815/
 *
 * 三件都是「不会报错，只会长得不对」的那种毛病，所以逐条量：
 *   · 换进来的 SVG 文件带着自己的 width/height，会压过 CSS 的 aspect-ratio，
 *     图标被拉成竖长条、选项散得满屏——放一个新文件进去就可能复发。
 *   · 窗口开着的时候，点在不是选项的地方应该是「我不选了」，不是开一局。
 *   · 从游戏里退回主菜单，位置应该还在刚才那儿。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.waitForTimeout(400);

// ---- 1. 尺寸由 CSS 定的那些图标，自己不许带 width/height -------------------
//
// 只查这几处的直接子 svg：它们的 CSS 只写了宽 + aspect-ratio，高度是算出来
// 的，所以文件上多一个 height 属性就会把比例顶掉。天才招牌不在此列——它的
// svg 宽高由 .genius-logo svg 那条 CSS 接管，文件上的属性压根轮不上。
const SIZED_BY_CSS = '.home-icon-art > svg, .center-pick-opt > svg, .start-mark > svg, .start-mark-art > svg';
const sized = await page.$$eval(SIZED_BY_CSS, (els) =>
  els.filter((e) => e.hasAttribute('width') || e.hasAttribute('height'))
     .map((e) => e.getAttribute('width') + '×' + e.getAttribute('height')),
);
check('图标的尺寸交给 CSS，SVG 自己不带 width/height', sized.length === 0, sized.join(', '));

// ---- 1b. 每颗图标都得真的画出东西来 ---------------------------------------
//
// 「图标一片空白」是不会报错的：文件在、元素在、尺寸也对，就是什么都没画。
// 基础方块那颗就这么消失过——设计软件把颜色导成了 color(display-p3 …)，旧
// 浏览器不认这个函数，而 SVG 的 fill 是表现属性，值非法时整条作废、去继承
// 父层，导出的文件父层恰好写着 fill="none"。刷新也没用，因为不是没加载。
//
// 所以不查「文件在不在」，查「有没有一块地方真的上了色」：每颗图标里至少要
// 有一个既不是 none 也不是全透明的填充或描边。顺带禁掉 color(…) 本身——
// customIcons.ts 会把 display-p3 换成十六进制，这条就是那道换算的哨兵。
const blank = await page.$$eval('.home-icon-btn', (btns) =>
  btns
    .map((btn) => {
      const painted = [...btn.querySelectorAll('rect, circle, path, polygon, ellipse, line')].some((el) => {
        const cs = getComputedStyle(el);
        const has = (v) => v && v !== 'none' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(v);
        return has(cs.fill) || has(cs.stroke);
      });
      const raw = /color\(/.test(btn.innerHTML);
      return painted && !raw ? null : `${btn.getAttribute('aria-label')}${raw ? '(还有 color() 没换)' : '(全空)'}`;
    })
    .filter(Boolean),
);
check('主菜单每颗图标都真的画出了东西', blank.length === 0, blank.join(' / '));

// ---- 2. 计时那三只秒表：一样大，挨在一起 ----------------------------------
await page.$$eval('.home-icon-btn--timed', (els) => els[0].click());
await page.waitForSelector('.center-pick-opt', { timeout: 8000 });
await page.waitForTimeout(1000); // 等飞入和散开都停下来
const boxes = await page.$$eval('.center-pick-opt', (els) =>
  els.map((e) => {
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  }),
);
check('计时弹窗里是三只表', boxes.length === 3, `看到 ${boxes.length} 个`);
check('三只一样大，而且是方的',
  boxes.every((b) => b.w === boxes[0].w && Math.abs(b.h - b.w) <= 1),
  JSON.stringify(boxes.map((b) => `${b.w}×${b.h}`)));
const span = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
check('三只挨在一起，没散开一屏', span <= boxes[0].h * 2 + 40, `上下共 ${span}px`);

// ---- 3. 点在不是选项的地方 = 不选了 ---------------------------------------
await page.mouse.click(195, 800);
await page.waitForTimeout(700);
const afterTap = await page.evaluate(() => ({
  picker: !!document.querySelector('.center-pick'),
  menu: !!document.querySelector('.home-page'),
  game: !!document.querySelector('.app--game'),
  dimmed: !!document.querySelector('.home-dimmed'),
}));
check('点空白处窗口关掉，回到主菜单', afterTap.picker === false && afterTap.menu === true, JSON.stringify(afterTap));
check('而且没有顺手开起一局来', afterTap.game === false);
check('背景的淡化也一并撤掉', afterTap.dimmed === false);

// ---- 4. 主菜单记得刚才翻到哪儿了 -------------------------------------------
await page.evaluate(() => window.scrollTo(0, 420));
await page.waitForTimeout(300);
const before = await page.evaluate(() => window.scrollY);
await page.$$eval('.home-icon-btn', (els) => els[0].click());
await page.waitForSelector('#startOverlay.show', { timeout: 15000 });
await page.waitForTimeout(250);
await page.click('#startBackBtn');
await page.waitForSelector('.home-page', { timeout: 8000 });
await page.waitForTimeout(600);
const after = await page.evaluate(() => window.scrollY);
check('从一局里退出来，主菜单还停在刚才那儿', Math.abs(after - before) <= 4, `${before} → ${after}`);

// ---- 5. 锁着的玩法：锁在正当中，招牌收在右下角，两者碰不到 -----------------
//
// 没开通的玩家在主菜单上看见五张锁着的卡（老虎机、无限反转、步步为营、七色圆球、进阶三角）。锁要正
// 正地压在图形中心，三把一样大；天才招牌收在卡片右下角，不许压到锁上，也不
// 许探出卡片去压到邻居。卡片的大小随屏幕变——手机竖着两列、横过来是电脑那
// 套版式但一张只剩 96px、电脑上二百多——三种都量一遍。
async function lockedCards(width, height) {
  const c = await browser.newContext({ viewport: { width, height } });
  await c.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn--locked', { timeout: 20000 });
  await p.waitForTimeout(400);
  const cards = await p.$$eval('.home-icon-btn--locked', (btns) =>
    btns.map((b) => {
      const box = (el) => {
        const q = el.getBoundingClientRect();
        return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height };
      };
      // 量的是「图」那一格，不是整张卡：窄屏上卡底下还有一行小字，卡的正中
      // 早就不是图的正中了，锁该对齐的是图。
      const card = box(b.querySelector('.home-icon-art') ?? b);
      const lock = box(b.querySelector('.center-pick-lock'));
      const badge = box(b.querySelector('.center-pick-genius'));
      const touch = (a, o) => a.l < o.r && o.l < a.r && a.t < o.b && o.t < a.b;
      const lockEl = b.querySelector('.center-pick-lock');
      return {
        name: (b.getAttribute('aria-label') || '').split(' ·')[0],
        card: `${Math.round(card.w)}×${Math.round(card.h)}`,
        // 锁的大小量的是**版面盒子**（offsetWidth/Height），不是屏幕上的矩形。
        // 竖屏的主菜单是那条鱼眼轴，卡片按「离焦点多远」被 scale 过——同一把
        // 34px 的锁，在焦点旁边那张上量出来是 39，隔两张是 35。那不是锁变大了，
        // 是整张卡被放大了，而 getBoundingClientRect 算的是变换之后的数。
        // 版面盒子不吃 transform，三种排法下都是同一个数。
        lock: `${Math.round(lockEl.offsetWidth)}×${Math.round(lockEl.offsetHeight)}`,
        off: [
          Math.round(lock.l + lock.w / 2 - card.l - card.w / 2),
          Math.round(lock.t + lock.h / 2 - card.t - card.h / 2),
        ],
        badge: `${Math.round(badge.w)}×${Math.round(badge.h)}`,
        overlap: touch(lock, badge),
        inside: badge.l >= card.l - 0.5 && badge.t >= card.t - 0.5 && badge.r <= card.r + 0.5 && badge.b <= card.b + 0.5,
      };
    }),
  );
  await c.close();
  return cards;
}
/**
 * 主菜单上摆了些什么、什么次序。
 *
 * 两种排法，所以两条路：
 *  · **宽屏**（电脑、手机横屏）还是一排一排的 `.home-row`，返回二维。
 *  · **手机竖屏** 2026-09 整个换成了一条鱼眼轴（`.mode-axis`，见 ui/modeAxis.ts）
 *    ——没有「排」这回事，十四张卡是一条链，返回一维。
 *
 * 这道门原先只认 `.home-row`：轴上线之后，竖屏那一轮在这儿等 20 秒然后抛异常，
 * **后面十几条一条都没跑**（而整个进程还是 exit 0，看着像跑完了）。所以这儿两
 * 条路都写死，找不到就红，不写成「找不到就跳过」。
 */
async function menuOrder(width, height) {
  const c = await browser.newContext({ viewport: { width, height } });
  await c.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-row .home-icon-btn, .mode-axis .home-icon-btn', { timeout: 20000 });
  await p.waitForTimeout(300);
  const out = await p.evaluate(() => {
    const name = (e) => (e.getAttribute('aria-label') || '').split(' ·')[0];
    const rows = [...document.querySelectorAll('.home-row')];
    if (rows.length) return { kind: 'rows', items: rows.map((r) => [...r.children].map(name)) };
    // 轴上只取**直接子元素**里的卡：两条点点轴（.axis-rail）也挂在同一个容器上。
    const axis = document.querySelector('.mode-axis');
    return {
      kind: 'axis',
      items: [...(axis?.children ?? [])].filter((e) => e.classList.contains('home-icon-btn')).map(name),
    };
  });
  await c.close();
  return out;
}

/** 主菜单上每张图标有多宽——用来核对「十四张一样大」。 */
async function cardWidths(width, height) {
  const c = await browser.newContext({ viewport: { width, height } });
  await c.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-row .home-icon-btn', { timeout: 20000 });
  await p.waitForTimeout(300);
  const out = await p.$$eval('.home-row > *', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  await c.close();
  return out;
}

for (const [w, h, label] of [[390, 844, '手机竖屏'], [844, 390, '手机横屏'], [1280, 800, '电脑']]) {
  const cards = await lockedCards(w, h);
  const brief = cards.map((c) => `${c.name} 卡${c.card} 锁${c.lock}@${c.off.join(',')} 招牌${c.badge}`).join(' / ');
  check(`${label}：五张锁着的卡都在`, cards.length === 5, brief);
  // 玩家点名的顺序，宽屏三排、窄屏五排——同一条链，断在不同的地方。
  const wide = w >= 720 || (w > h && w >= 560);
  const got = await menuOrder(w, h);
  const WANT = wide
    ? [
        ['方块', '圆球', '三角'],
        ['计时挑战', '基础炸弹', '多人游玩', '老虎机模式', '无限反转', '步步为营'],
        ['菱形方块', '六边圆球', '七色圆球', '大三角', '进阶三角'],
      ]
    : [
        // 窄屏：一排两张摆完为止，能玩的先摆，天才特供那四张（老虎机、无限
        // 反转、七色圆球、V 型三角）收在最后——玩家点的。
        ['方块', '圆球'],
        ['三角', '多人游玩'],
        ['计时挑战', '基础炸弹'],
        ['菱形方块', '六边圆球'],
        ['大三角', '老虎机模式'],
        // 两张都是竖长条的图，视觉分量相当。加上这一张之后窄屏正好排满七排，
        // 从前那张孤零零的「进阶三角」没有了。
        ['无限反转', '步步为营'],
        ['七色圆球', '进阶三角'],
      ];
  if (got.kind === 'rows') {
    const rows = got.items;
    check(`${label}：${WANT.length} 排，各 ${WANT.map((r) => r.length).join(' / ')} 张`,
      rows.length === WANT.length && rows.every((r, i) => r.length === WANT[i].length),
      rows.map((r) => r.length).join(' / '));
    check(`${label}：每一排的顺序都对`,
      JSON.stringify(rows) === JSON.stringify(WANT),
      rows.map((r) => r.join(' · ')).join('  |  '));
    // 十四张一样大：张数少的那几排不能因为人少就长得比别人大。
    // ⚠️ 宽屏第二排从五张变六张之后（menu.ts 的 WIDE_PER_ROW），这一条是
    // --home-card-cap 那道公式的岗哨：公式里少了「一排站得下几张」那一项，第二
    // 排的六张就会被挤得比第三排的五张窄，这里立刻红。
    const sizes = await cardWidths(w, h);
    const span = Math.max(...sizes) - Math.min(...sizes);
    check(`${label}：十四张图标一样大`, span <= 2, `${Math.min(...sizes)}–${Math.max(...sizes)}px`);
  } else {
    // 轴上没有「排」，只有一条链。摆的次序还是窄屏那一条（玩家点名的顺序），
    // 所以把 WANT 摊平了比——次序要是散了，这儿立刻红。
    //
    // 不在这儿量「每张一样大」：轴上的卡是被鱼眼缩放过的，本来就不一样大。
    // 「每一站等高、相邻两张不相撞」由 check-mode-axis 逐对量，那是它的活。
    const want = WANT.flat();
    check(`${label}：轴上 ${want.length} 站`, got.items.length === want.length, `${got.items.length} 张`);
    check(`${label}：轴上的次序就是窄屏那一条链`,
      JSON.stringify(got.items) === JSON.stringify(want),
      got.items.join(' · '));
  }
  check(`${label}：锁都在图形正当中`, cards.every((c) => Math.abs(c.off[0]) <= 1 && Math.abs(c.off[1]) <= 1));
  check(`${label}：四把锁一样大（34×34）`, cards.every((c) => c.lock === '34×34'));
  check(`${label}：招牌没压到锁`, cards.every((c) => !c.overlap));
  check(`${label}：招牌收在卡片里`, cards.every((c) => c.inside));
}

// ---- 连点两下不放大 -------------------------------------------------------
//
// 手机浏览器默认「同一个地方连点两下 = 放大」。这个网站上连点是常事（连着按
// 同一个玩法、在选择窗口里改主意），每一次都可能被当成放大手势，页面毫无预
// 兆地涨一截。touch-action: manipulation 只关这一个手势，滚动和两指捏合都还
// 在——捏合是无障碍功能，拿掉了才是问题。
//
// 查的是「算出来的值」而不是「CSS 里写没写」：touch-action 不继承，所以按钮
// 和空白得各自算过才算数。棋盘那块要的是 none（手指在上面拖不该滚页面），
// 那一条不能被这一条盖掉，也一起查。
await ctx.close();
const tctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await tctx.addInitScript(() => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
});
const tap = await tctx.newPage();
await tap.goto(BASE, { waitUntil: 'load' });
await tap.waitForSelector('.home-icon-btn', { timeout: 20000 });
// `.home-grid` 挑掉带 .mode-axis 的那一个：竖屏主菜单那条鱼眼轴自己要吃竖向手势
// （不吃的话手指一滑页面跟着滚，轴只走一半），和棋盘一样是 touch-action: none。
// 它不是漏网的，下面单列一条量它——挑出去而不量，才是把洞留在门上。
const zoomy = await tap.$$eval(
  'body, .app, .home-grid:not(.mode-axis), .home-row, .home-icon-btn, .home-head, .home-nav, .home-nav button',
  (els) =>
    els
      .map((e) => (getComputedStyle(e).touchAction === 'manipulation' ? null : `${e.className || e.tagName}=${getComputedStyle(e).touchAction}`))
      .filter(Boolean),
);
check('连点两下不放大：按钮和空白都算', zoomy.length === 0, zoomy.join(' / '));
const axisTA = await tap.$eval('.mode-axis', (e) => getComputedStyle(e).touchAction).catch(() => '没有轴');
check('鱼眼轴是 none（它自己吃竖向手势）', axisTA === 'none', axisTA);
// 开一局，确认棋盘那块还是 none。
await tap.$$eval('.home-icon-btn', (els) => els[0].click());
await tap.waitForSelector('.start-go, .board-wrap', { timeout: 8000 });
const goBtn = await tap.$('.start-go');
if (goBtn) {
  await goBtn.click();
  await tap.waitForSelector('.board-wrap', { timeout: 15000 });
}
const boardTA = await tap.$eval('.board-wrap', (e) => getComputedStyle(e).touchAction);
check('棋盘那块还是 none（手指在上面拖不滚页面）', boardTA === 'none', boardTA);
await tctx.close();

/**
 * 老虎机 / 无限反转 / 步步为营：按下去不是硬切。
 *
 * 玩家 2026-09 第七轮：「这几个版本，在点击主菜单 icon 到进入选择图形的过程做一
 * 个轻微的转化，而不是直接硬生生地切到下一个画面」。炸弹和计时本来就有（开的是
 * 居中挑选窗，从按到的那张卡飞到屏幕正中）；这三个进的是整页，整页从前是一次
 * DOM 替换——上一帧主菜单，下一帧另一屏。
 *
 * 量的是**过场真的演了**：旧页先挂上退场那一拍（.app--leave），新页带着入场那一
 * 拍（.app--enter）出来，然后两个类都撤掉。逐帧记下来，不是事后看一眼——事后那
 * 会儿动画早演完了，什么都看不见，那样的断言永远是绿的。
 *
 * 还量两件同样要紧的：退场那一拍**不接受点击**（免得那 120ms 里他又按开第二
 * 页），以及 reduced-motion 下一拍都不等。
 */
{
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await sctx.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem('slides_played_square', '1');
    // 这三张是天才特供，没权限按下去开的是订阅窗，不是那一页。
    localStorage.setItem(
      'slides_genius',
      JSON.stringify({ active: true, period: 'year', until: Date.now() + 30 * 864e5, channel: 'code' }),
    );
  });
  const watch = () => {
    window.__tl = [];
    const tick = () => {
      const el = document.querySelector('#app > *');
      if (el) {
        const tag = el.classList.contains('app--leave') ? 'leave' : el.classList.contains('app--enter') ? 'enter' : '-';
        const page = el.className.split(' ').filter((c) => c.endsWith('-page')).join(',');
        const line = `${tag}|${page}`;
        if (window.__tl[window.__tl.length - 1] !== line) window.__tl.push(line);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  for (const label of ['老虎机', '无限反转', '步步为营']) {
    const sp = await sctx.newPage();
    await sp.addInitScript(watch);
    await sp.goto(BASE, { waitUntil: 'load' });
    await sp.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
    await sp.waitForTimeout(600);
    const found = await sp.evaluate((l) => {
      const btn = [...document.querySelectorAll('.mode-axis > .home-icon-btn')]
        .find((b) => (b.getAttribute('aria-label') || '').startsWith(l));
      if (!btn) return false;
      btn.click();
      return true;
    }, label);
    check(`${label}：这张卡在轴上找得到（下面几条才有意义）`, found);
    await sp.waitForTimeout(1400);
    const tl = await sp.evaluate(() => window.__tl);
    const left = tl.some((t) => t.startsWith('leave|home-page'));
    const entered = tl.some((t) => t.startsWith('enter|') && !t.includes('home-page'));
    const settled = /^-\|/.test(tl[tl.length - 1] || '') && !(tl[tl.length - 1] || '').includes('home-page');
    check(`${label}：主菜单先淡出去（不是硬切）`, left, tl.join(' → '));
    check(`${label}：新那一屏带着入场那一拍出来`, entered, tl.join(' → '));
    check(`${label}：演完两个类都撤了（不会留在页面上）`, settled, tl[tl.length - 1] || '（什么都没记到）');
    await sp.close();
  }
  // 退场那 120ms 里按不动
  {
    const sp = await sctx.newPage();
    await sp.goto(BASE, { waitUntil: 'load' });
    await sp.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
    await sp.waitForTimeout(600);
    await sp.evaluate(() => {
      const btn = [...document.querySelectorAll('.mode-axis > .home-icon-btn')]
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('老虎机'));
      btn.click();
    });
    await sp.waitForTimeout(40);
    const pe = await sp.evaluate(() => {
      const el = document.querySelector('#app > *');
      return el ? getComputedStyle(el).pointerEvents : '没有页';
    });
    check('退场那一拍里整页按不动（不会再开出第二页）', pe === 'none', pe);
    await sp.close();
  }
  // reduced-motion：一拍都不等
  {
    const sp = await sctx.newPage();
    await sp.emulateMedia({ reducedMotion: 'reduce' });
    await sp.addInitScript(watch);
    await sp.goto(BASE, { waitUntil: 'load' });
    await sp.waitForSelector('.mode-axis .home-icon-btn', { timeout: 20000 });
    await sp.waitForTimeout(600);
    await sp.evaluate(() => {
      const btn = [...document.querySelectorAll('.mode-axis > .home-icon-btn')]
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('老虎机'));
      btn.click();
    });
    await sp.waitForTimeout(900);
    const tl = await sp.evaluate(() => window.__tl);
    check(
      'reduced-motion 下直接换，一拍都不等',
      !tl.some((t) => t.startsWith('leave') || t.startsWith('enter')),
      tl.join(' → '),
    );
    await sp.close();
  }
  await sctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
