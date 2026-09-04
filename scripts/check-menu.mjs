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
// 没开通的玩家在主菜单上看见四张锁着的卡（老虎机、无限反转、七色圆球、进阶三角）。锁要正
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
      return {
        name: (b.getAttribute('aria-label') || '').split(' ·')[0],
        card: `${Math.round(card.w)}×${Math.round(card.h)}`,
        lock: `${Math.round(lock.w)}×${Math.round(lock.h)}`,
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
/** 主菜单每一排上都摆了些什么，按排返回它们的名字。 */
async function menuRows(width, height) {
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
  const rows = await p.$$eval('.home-row', (rs) =>
    rs.map((r) => [...r.children].map((k) => (k.getAttribute('aria-label') || '').split(' ·')[0])),
  );
  await c.close();
  return rows;
}

/** 主菜单上每张图标有多宽——用来核对「十三张一样大」。 */
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
  check(`${label}：四张锁着的卡都在`, cards.length === 4, brief);
  // 玩家点名的顺序，宽屏三排、窄屏五排——同一条链，断在不同的地方。
  const wide = w >= 720 || (w > h && w >= 560);
  const rows = await menuRows(w, h);
  const WANT = wide
    ? [
        ['方块', '圆球', '三角'],
        ['计时挑战', '基础炸弹', '多人游玩', '老虎机模式', '无限反转'],
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
        ['无限反转', '七色圆球'],
        ['进阶三角'],
      ];
  check(`${label}：${WANT.length} 排，各 ${WANT.map((r) => r.length).join(' / ')} 张`,
    rows.length === WANT.length && rows.every((r, i) => r.length === WANT[i].length),
    rows.map((r) => r.length).join(' / '));
  check(`${label}：每一排的顺序都对`,
    JSON.stringify(rows) === JSON.stringify(WANT),
    rows.map((r) => r.join(' · ')).join('  |  '));
  // 十三张一样大：张数少的那几排不能因为人少就长得比别人大。
  const sizes = await cardWidths(w, h);
  const span = Math.max(...sizes) - Math.min(...sizes);
  check(`${label}：十三张图标一样大`, span <= 2, `${Math.min(...sizes)}–${Math.max(...sizes)}px`);
  // 窄屏的图标是「上限 165，装不下就按这一排减掉间距再对半分」——所以这个数
  // 随屏幕变（390 的手机上是 158），只查它没越过上限、也没被挤没。同一块屏
  // 幕上十三张一样大那一条在上面已经查过了。
  if (!wide)
    check(`${label}：一张不超过 165px 见方`, sizes.every((n) => n <= 165 && n >= 120),
      `${Math.min(...sizes)}–${Math.max(...sizes)}px`);
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
const zoomy = await tap.$$eval(
  'body, .app, .home-grid, .home-row, .home-icon-btn, .home-head, .home-nav, .home-nav button',
  (els) =>
    els
      .map((e) => (getComputedStyle(e).touchAction === 'manipulation' ? null : `${e.className || e.tagName}=${getComputedStyle(e).touchAction}`))
      .filter(Boolean),
);
check('连点两下不放大：按钮和空白都算', zoomy.length === 0, zoomy.join(' / '));
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

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
