/**
 * 转屏之后、还没碰棋盘之前，棋盘有没有跟着重排。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-rotate.mjs http://localhost:8817/
 *
 * 这条线断过不止一次，而且断得很安静：转完屏什么都不报错，棋盘照样在那儿，
 * 只是还按上一个方向排着——横屏里方块要溢出底边三十几个像素，玩家看到的就
 * 是「棋盘没显示全」。碰一下棋盘（拖一次会触发 render）它就好了，所以从截
 * 图和录屏里也很难抓住。
 *
 * 断的原因是排版最后那一步：squareFloor 会把地板钉成一个固定像素的正方形。
 * 钉住之后地板自己就不再跟着屏幕变了，而「要不要重排」当初只看地板的框——
 * 于是转屏之后它说「什么都没动」。
 *
 * 所以这里的判据不是「有没有报错」，也不是「棋子在不在地板里」（不重排也
 * 在），而是：转过去、手不碰，排出来的东西要和「一开始就是这个方向」一模
 * 一样。这一条不重排是绝对过不了的。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const ONLY = process.argv[3];
const TOL = 1.5; // 亚像素的舍入不算差别

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const SHAPES = ['方块', '圆球', '三角', '菱形方块', '六边圆球', '大三角', '七色圆球', '进阶三角'];

const seed = () => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
  // 七色圆球和进阶三角在订阅墙后面。这里直接写权益，不去兑码——码是一次性的。
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'ROTCHECK',
  }));
};

/** 排出来的样子：地板多大、棋子铺开多大、有没有戳出去。 */
const MEASURE = () => {
  const wrap = document.querySelector('.app--game .board-wrap');
  if (!wrap) return null;
  const w = wrap.getBoundingClientRect();
  const cell = wrap.parentElement?.getBoundingClientRect();
  const pieces = [...wrap.querySelectorAll('.tile, .ball, .tri')];
  if (!pieces.length) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const p of pieces) {
    const q = p.getBoundingClientRect();
    if (q.width <= 0 || q.height <= 0) continue;
    l = Math.min(l, q.left); t = Math.min(t, q.top);
    r = Math.max(r, q.right); b = Math.max(b, q.bottom);
  }
  const R = (n) => Math.round(n * 10) / 10;
  return {
    floor: { w: R(w.width), h: R(w.height) },
    span: { w: R(r - l), h: R(b - t) },
    // 棋子戳出地板多少（正数是戳出去了）
    outFloor: R(Math.max(w.left - l, w.top - t, r - w.right, b - w.bottom)),
    // 棋子戳出屏幕多少
    outView: R(Math.max(-l, -t, r - innerWidth, b - innerHeight)),
    // 地板戳出它那一格多少
    outCell: cell
      ? R(Math.max(cell.left - w.left, cell.top - w.top, w.right - cell.right, w.bottom - cell.bottom))
      : 0,
    n: pieces.length,
  };
};

/** 开一局，等棋盘定下来。开不起来返回 null。 */
async function openGame(page, shape) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  const found = await page.$$eval('.home-icon-btn', (els, n) => {
    const hit = els.find((e) => (e.getAttribute('aria-label') || '') === n);
    if (!hit) return false;
    hit.click();
    return true;
  }, shape);
  if (!found) return false;
  const started = await page
    .waitForFunction(
      () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
      { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (!started) return false;
  await page.waitForTimeout(1000);
  return true;
}

const near = (a, b) => Math.abs(a - b) <= TOL;
const shapes = ONLY ? SHAPES.filter((s) => s === ONLY) : SHAPES;

for (const shape of shapes) {
  // 两个方向各来一次：竖 → 横，横 → 竖。
  for (const [fromName, from, toName, to] of [
    ['竖屏', PORTRAIT, '横屏', LANDSCAPE],
    ['横屏', LANDSCAPE, '竖屏', PORTRAIT],
  ]) {
    // 甲、一开始就是「到」这个方向，排出来是什么样——这是标准答案。
    const ctxA = await browser.newContext({ viewport: to });
    await ctxA.addInitScript(seed);
    const pageA = await ctxA.newPage();
    const okA = await openGame(pageA, shape);
    const want = okA ? await pageA.evaluate(MEASURE) : null;
    await ctxA.close();
    if (!want) {
      check(`${shape}：${toName}开得起来`, false, '开不起来或量不到');
      continue;
    }

    // 乙、从「从」这个方向转过去，中间一下都不碰棋盘。
    const ctxB = await browser.newContext({ viewport: from });
    await ctxB.addInitScript(seed);
    const pageB = await ctxB.newPage();
    const okB = await openGame(pageB, shape);
    if (!okB) {
      check(`${shape}：${fromName}开得起来`, false, '开不起来');
      await ctxB.close();
      continue;
    }
    const before = await pageB.evaluate(MEASURE);
    await pageB.setViewportSize(to);
    await pageB.waitForTimeout(1000);
    const got = await pageB.evaluate(MEASURE);
    await ctxB.close();

    // 丙、同一件事，但模拟手机上真实的那一下：屏幕已经转过去了，浏览器报的
    // innerWidth / innerHeight 还是旧的。桌面 Chromium 的 setViewportSize 是
    // 原子的——尺寸和重排一起到，两条线（窗口尺寸、那一格的框）都会响，所以
    // 上面那一轮过了不代表手机上过得了。把 innerWidth / innerHeight 冻住，就
    // 只剩「装地板那一格」这一条线；第一版的修法在这里是直接不动的。
    const ctxC = await browser.newContext({ viewport: from });
    await ctxC.addInitScript(seed);
    const pageC = await ctxC.newPage();
    const okC = await openGame(pageC, shape);
    let lag = null;
    if (okC) {
      await pageC.evaluate(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        Object.defineProperty(window, 'innerWidth', { get: () => w, configurable: true });
        Object.defineProperty(window, 'innerHeight', { get: () => h, configurable: true });
      });
      await pageC.setViewportSize(to);
      await pageC.waitForTimeout(1000);
      lag = await pageC.evaluate(MEASURE);
    }
    await ctxC.close();

    const tag = `${shape} ${fromName}→${toName}`;
    check(
      `${tag}：手不碰也重排了`,
      near(got.floor.w, want.floor.w) && near(got.floor.h, want.floor.h) &&
      near(got.span.w, want.span.w) && near(got.span.h, want.span.h),
      `转出来 ${got.floor.w}×${got.floor.h}（棋子 ${got.span.w}×${got.span.h}）` +
      ` · 该是 ${want.floor.w}×${want.floor.h}（棋子 ${want.span.w}×${want.span.h}）` +
      ` · 转之前 ${before.floor.w}×${before.floor.h}`,
    );
    check(`${tag}：棋子没戳出屏幕`, got.outView <= 0.5, `越界 ${got.outView}px`);
    check(`${tag}：地板没戳出那一格`, got.outCell <= 0.5, `越界 ${got.outCell}px`);
    check(
      `${tag}：浏览器晚报尺寸也照样重排`,
      Boolean(lag) && near(lag.floor.w, want.floor.w) && near(lag.floor.h, want.floor.h),
      lag ? `转出来 ${lag.floor.w}×${lag.floor.h} · 该是 ${want.floor.w}×${want.floor.h}` : '开不起来',
    );
  }
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
