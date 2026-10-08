/**
 * 统一的《退出》（第 18 推第 1 条）和手机战绩页（第 5 条）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8964 dist
 *   node scripts/check-page-exit.mjs http://localhost:8964/
 *
 * 方案给这道门的单子：
 *
 *   第 1 条：360×740、390×844、430×932、1512×982 下各页退出按钮中心一致（≤1px）、62px、
 *            完整可见、不压内容。
 *   第 5 条：360×740、390×844、430×932 下 scrollHeight ≤ innerHeight，面板 ≥ 1.5 倍原高，
 *            按钮完整可见、互不重叠。
 *
 * 七页：计时、老虎机（主菜单进的挑图形页，和个人主页进的介绍页）、无限反转、步步为营、炸弹
 * （10-08 方案 3-G 起是一整页，从前是一扇挑选窗）、多人小屋、成绩与排名。小红书那几张二级页走的是同一颗 .page-exit，样式由
 * xhs/check-pickup.mjs 在那一端的包上量。
 *
 * ── 量法 ─────────────────────────────────────────────────────────
 *
 * 「中心一致」：每一页量到的中心都要等于「水平正中、离底 116 ＋ 31」（安全区在这儿报 0，
 * 116 ＝ 102 ＋ max(0, 14)，见 style.css 的 .page-exit），而且同一个尺寸下七页之间彼此差不
 * 过 1px。只比七页彼此会漏掉「七页一起站错了地方」，只比定值会漏掉「定值改了、某一页没跟
 * 上」——两条都量。
 *
 * 「完整可见」：整颗在视口里，而且 elementFromPoint 在它的正中和四个边点上拿到的都是它自
 * 己——被别的东西盖住一半的键，矩形照样在视口里。
 *
 * 「不压内容」：这一页里看得见的每一个「内容件」（叶子节点、键、图、输入框）的框都不和它相
 * 交；而且滑到底时最下面那一件离它上沿还有 ≥ 16px（方案：每页底部留白 ≥ 按钮离底距离 ＋
 * 78px，78 ＝ 62 ＋ 16）。容器不算（整页那个 div 当然「包着」它）。
 *
 * 「面板 ≥ 1.5 倍原高」：原高是改之前在同一尺寸上量到的（base 那一列，见 PANEL_BASE）。
 * 方案同时给了优先级——「退出按钮完整露出 > 1.5 倍；矮屏上面板自动缩短，页面不需要滑动」——
 * 而 390×844 和 360×740 上 1.5 倍在几何上就放不下（退出键的位置全站统一，它上面只剩那么
 * 多）。所以放得下的尺寸量 1.5 倍；放不下的尺寸量「面板下沿正好落在退出键上沿往上 16px
 * （±1）」——剩下的高度一个像素都没浪费，而且量出来的倍数照实印出来。哪天招牌或累计分卡
 * 变矮了、放得下了，这一条会自己切到 1.5 倍那一支。
 *
 * 每一条都带尺子：页真的打开了、键真的量到了，量不到就是红，不是空绿。
 *
 * ── 10-08 方案 3-C-3 之后 ─────────────────────────────────────────
 *
 * 成绩页那颗换成了全站《退出》的尺寸 token（--exit-disc：73–99，跟着屏宽，基准是开局倒数页
 * 那两颗圆盘，见 style.css）；3-F-2 起七页全是它（「多人小屋、计时、炸弹、老虎机、今日挑战全部
 * 引用」——今日挑战那一页不在这七页里，它的倒数页由 check-count-stage 量）。离底的那条线没变——底边还在
 * 「底排的高度 ＋ 16」上，变大的那一截往上长。所以「位置」量的是**底边和水平中线**（方案
 * 3-F-2 的原话就是「位置统一到底部同一坐标」），不再量中心：两种尺寸的中心本来就不在一个
 * 高度上。成绩页的页底留白跟着按它自己的尺寸算（离底 ＋ 它 ＋ 16）。
 *
 * 累计得分卡那一节：数字放大到 3rem（原来 2.3rem 的 1.3 倍）；点开的大卡底下不再挂《退出》，
 * 点外面、Esc 照样关得掉。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8964/';
const SIZES = [
  { n: '360×740', w: 360, h: 740, phone: true },
  { n: '390×844', w: 390, h: 844, phone: true },
  { n: '430×932', w: 430, h: 932, phone: true },
  { n: '1512×982', w: 1512, h: 982, phone: false },
].filter((z) => !process.env.ONLY_SIZE || String(z.w) === process.env.ONLY_SIZE);

/** 改之前（0f623c0）在这三个尺寸上量到的两块面板的高（中文、没有战绩）。 */
const PANEL_BASE = { 360: 317, 390: 317, 430: 299 };

/** 离底的定值：102 ＋ max(安全区 0, 14)。 */
const EXIT_BOTTOM = 116;
/** 全站《退出》的尺寸 token（--exit-disc）：clamp(73px, 19.5vw, 99px)。成绩页先用上（10-08 方案 3-C-3），
 *  3-F-2 起七页都是它（从前是 62）。 */
const disc = (w) => Math.min(99, Math.max(73, 0.195 * w));

let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  — ${extra}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 一个尺寸一个上下文。开通天才只兑一次码（一台服务器上同一张码只能兑一次），之后各上下文抄那份。 */
let genius = null;
async function openCtx(size) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, reducedMotion: 'reduce' });
  await ctx.addInitScript((g) => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    // 头一局那把锁（firstPlay.ts）：不预设的话主菜单只摆方块和小球两张。
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    if (g) localStorage.setItem('slides_genius', g);
  }, genius);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 25000 });
  if (!genius) {
    genius = await page.evaluate(async () => {
      const r = await fetch('/api/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }),
      }).then((x) => x.json());
      const g = JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code });
      localStorage.setItem('slides_genius', g);
      return g;
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 25000 });
  }
  return { ctx, page, errors };
}

const home = async (page) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn, .home-bomb-card', { timeout: 25000 });
  await page.waitForTimeout(300);
};
/** 主菜单那几张卡要在页面里自己 click()：鱼眼轴上离焦点远的卡坐在视口外面（见 check-flip-batch）。 */
const tap = (page, sel) => page.$eval(sel, (el) => el.click());

const PAGES = [
  { n: '计时', open: (p) => tap(p, '.home-icon-btn--timed'), root: '.timed-page', exit: '#timedBack', back: '.home-page', pad: '.timed-page .start-stage' },
  { n: '老虎机', open: (p) => tap(p, '.home-icon-btn[aria-label="老虎机模式"]'), root: '.slot-page:not(.flip-page):not(.timed-page)', exit: '#slotBack', back: '.home-page', pad: '.slot-page .start-stage' },
  {
    n: '老虎机介绍',
    open: async (p) => {
      await p.click('#navProfile');
      await p.waitForSelector('#randomRow', { timeout: 10000 });
      await p.click('#randomRow');
    },
    root: '.slot-intro-page', exit: '#slotBack', back: '.profile-page', pad: '.slot-intro-page .start-stage',
  },
  { n: '无限反转', open: (p) => tap(p, '.home-icon-btn[aria-label="无限反转"]'), root: '.flip-page', exit: '#flipBack', back: '.home-page', pad: '.flip-page .start-stage' },
  { n: '步步为营', open: (p) => tap(p, '.home-icon-btn[aria-label="步步为营"]'), root: '.flip-page', exit: '#puzzleBack', back: '.home-page', pad: '.flip-page .start-stage' },
  // 炸弹那一页：10-08 方案 3-G 起是一整页（从前是主菜单上弹出来的一扇窗，那时量的是「按下去这一层关掉了」）。
  { n: '炸弹', open: (p) => tap(p, '.home-bomb-mini, .home-bomb-card'), root: '.bomb-page', exit: '#bombBack', back: '.home-page', pad: '.bomb-page .start-stage' },
  { n: '多人小屋', open: (p) => tap(p, '.home-icon-btn[aria-label="多人游玩"]'), root: '.mp-page--home', exit: '#mpBack', back: '.home-page', blue: true, pad: '.mp-page--home' },
  { n: '成绩与排名', open: (p) => p.click('#navRecords'), root: '.records-page', exit: '#recordsBack', back: '.home-page', records: true, pad: '.records-page' },
];

/** 在页面里量：键、内容件、几处颜色。 */
const MEASURE = ([rootSel, exitSel]) => {
  const root = document.querySelector(rootSel);
  const exit = document.querySelector(exitSel);
  if (!root || !exit) return { root: !!root, exit: !!exit };
  const r = exit.getBoundingClientRect();
  const box = { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  // 正中和四个边点（往里收 4px）：拿到的都得是它自己。
  const pts = [[box.cx, box.cy], [box.cx, box.t + 4], [box.cx, box.b - 4], [box.l + 4, box.cy], [box.r - 4, box.cy]];
  const onTop = pts.every(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === exit || exit.contains(hit));
  });
  // 内容件：叶子、键、图、输入框。容器（包着别的元素的 div）不算——整页那个 div 当然包着它。
  const items = [];
  for (const el of root.querySelectorAll('*')) {
    if (el === exit || exit.contains(el) || el.contains(exit)) continue;
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const tag = el.tagName.toLowerCase();
    const leafish = el.children.length === 0 || ['button', 'input', 'svg', 'img', 'p', 'label', 'h1', 'h2'].includes(tag);
    if (!leafish) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    // 被祖先裁掉的部分不算（老虎机的滚筒是一长条图，只露出窗口里那一格——窗口外那几张
    // 被 overflow: hidden 裁掉了，看不见，也就压不着谁）。一路往上，和每一层会裁的祖先求交。
    const b0 = el.getBoundingClientRect();
    let b = { left: b0.left, top: b0.top, right: b0.right, bottom: b0.bottom };
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ac = getComputedStyle(a);
      if (ac.overflowX === 'visible' && ac.overflowY === 'visible') continue;
      const ab = a.getBoundingClientRect();
      b = { left: Math.max(b.left, ab.left), top: Math.max(b.top, ab.top), right: Math.min(b.right, ab.right), bottom: Math.min(b.bottom, ab.bottom) };
    }
    if (b.right - b.left < 1 || b.bottom - b.top < 1) continue;
    // 隐藏掉的倒数键之类（.start-hidden-go）上面已经被 display:none 筛掉了。
    items.push({ what: `${tag}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ')[0]}`, l: b.left, t: b.top, r: b.right, b: b.bottom });
  }
  // 不压内容：没有一件和它相交——往外放 8px 再比，贴着它的也算挤。
  const hits = items.filter((i) => i.l < box.r + 8 && i.r > box.l - 8 && i.t < box.b + 8 && i.b > box.t - 8);
  // 底部留白量的是**它那一列**（左右各放 16px）：内容最低到哪儿。站在它旁边同一行的键
  // （老虎机介绍页右边那颗《开始 〉》）不在这一列里，不算——那是摆在它旁边，不是压在它
  // 上面；它们俩挤不挤由上面那一条管。
  const col = items.filter((i) => i.l < box.r + 16 && i.r > box.l - 16);
  const contentBottom = col.reduce((m, i) => Math.max(m, i.b), 0);
  const circle = exit.querySelector('svg circle');
  const mark = exit.querySelector('svg path');
  const nav = document.querySelector('.home-nav');
  const navShown = nav && getComputedStyle(nav).display !== 'none';
  const dock = document.querySelector('.home-nav-dock');
  return {
    root: true, exit: true, box, onTop,
    isPageExit: exit.classList.contains('page-exit'),
    label: exit.getAttribute('aria-label') || '',
    disc: circle ? getComputedStyle(circle).fill : '',
    markColor: mark ? getComputedStyle(mark).stroke : '',
    items: items.length, hits: hits.map((h) => h.what), contentBottom,
    navTop: navShown && dock ? dock.getBoundingClientRect().top : null,
    vw: innerWidth, vh: innerHeight,
    scrollH: document.documentElement.scrollHeight,
  };
};

const RECORDS_MEASURE = () => {
  const r = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { t: b.top, b: b.bottom, h: b.height, l: b.left, r: b.right };
  };
  // 两块面板里那六格的上沿（第 17 推定的「两块并排时一行对一行」）。
  const tops = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().top);
  return {
    total: r('.total-card'), rec: r('.records-panel--records'), ranks: r('.records-panel--ranks'),
    exit: r('#recordsBack'), dock: r('.home-nav-dock'),
    recRows: tops('.records-panel--records > .records-row, .records-panel--records > .records-rule'),
    // 最后一格的底、面板的底和它的下内边距（留给那句话的那一截）：最后一格不能越过那一截的上沿。
    recRowH: (() => {
      const row = document.querySelector('.records-panel--records > .records-row, .records-panel--records > .records-rule');
      return row ? row.getBoundingClientRect().height : null;
    })(),
    recLast: (() => {
      const rows = document.querySelectorAll('.records-panel--records > .records-row, .records-panel--records > .records-rule');
      return rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : null;
    })(),
    recPadB: parseFloat(getComputedStyle(document.querySelector('.records-panel--records')).paddingBottom),
    rankRows: tops('.records-panel--ranks > .rank-row'),
    scrollH: document.documentElement.scrollHeight, vh: innerHeight,
  };
};

const overlap = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

for (const size of SIZES) {
  console.log(`\n━━ ${size.n} ━━`);
  const { ctx, page, errors } = await openCtx(size);
  const expCx = size.w / 2;
  const expB = size.h - EXIT_BOTTOM;
  const centers = [];
  for (const pg of PAGES) {
    const tag = `${size.n} ${pg.n}`;
    await home(page);
    await pg.open(page);
    const opened = await page.waitForSelector(pg.root, { timeout: 10000 }).then(() => true).catch(() => false);
    check(`${tag}：（尺子）这一页打开了`, opened);
    if (!opened) continue;
    await page.waitForTimeout(500);
    // 滑到底再量：「不压内容」量的是滑到底时最下面那一件。
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    const m = await page.evaluate(MEASURE, [pg.root, pg.exit]);
    // 每页底部留白 ≥ 按钮离底距离 ＋ 78px（方案原话）：量的是写在这一页上的那条下内边距本身。
    // 下面「不压内容」量的是效果，可内容离得远的时候效果量不出规则没写——两样都量。
    const padB = await page.$eval(pg.pad, (e) => parseFloat(getComputedStyle(e).paddingBottom)).catch(() => -1);
    check(`${tag}：（尺子）量到了那颗《退出》`, m.exit && m.root, JSON.stringify({ root: m.root, exit: m.exit }));
    if (!m.exit || !m.root) continue;
    check(`${tag}：（尺子）这一页量到了内容件`, m.items >= 3, `${m.items} 件`);
    check(`${tag}：是统一的那颗 .page-exit`, m.isPageExit);
    check(`${tag}：有 aria-label（只放图标的键）`, m.label.trim().length > 0, m.label);
    const want = disc(size.w);
    check(`${tag}：用全站《退出》的尺寸 token（${want.toFixed(1)}px，73–99 跟着屏宽）`,
      Math.abs(m.box.w - want) <= 0.5 && Math.abs(m.box.h - want) <= 0.5, `${m.box.w.toFixed(1)}×${m.box.h.toFixed(1)}`);
    check(`${tag}：水平正中（≤1px）`, Math.abs(m.box.cx - expCx) <= 1, `中心 x ${m.box.cx.toFixed(1)} / ${expCx}`);
    check(`${tag}：底边离底 116（≤1px）`, Math.abs(m.box.b - expB) <= 1, `底边 ${m.box.b.toFixed(1)} / ${expB}`);
    check(`${tag}：页底留白 ≥ 它离底的距离 ＋ 它自己 ＋ 16px（${(EXIT_BOTTOM + want + 16).toFixed(1)}）`, padB >= EXIT_BOTTOM + want + 16 - 0.5, `${pg.pad} 的下内边距 ${padB}px`);
    check(`${tag}：完整在屏幕里`, m.box.l >= 0 && m.box.t >= 0 && m.box.r <= m.vw && m.box.b <= m.vh);
    check(`${tag}：没被别的东西盖住（正中和四边点到的都是它）`, m.onTop);
    check(`${tag}：不压内容（没有内容件和它相交，四周还空着 8px）`, m.hits.length === 0, m.hits.join(' / '));
    check(`${tag}：滑到底，它那一列最下面那一件离它上沿 ≥ 16px`, m.contentBottom <= m.box.t - 16 + 0.5,
      `内容底 ${m.contentBottom.toFixed(1)} / 键顶 ${m.box.t.toFixed(1)}`);
    if (m.navTop !== null) {
      check(`${tag}：站在底排上面 16px`, Math.abs(m.navTop - 6 - m.box.b - 16) <= 1,
        `键底 ${m.box.b.toFixed(1)} / 底排顶 ${(m.navTop - 6).toFixed(1)}`);
    }
    if (pg.blue) {
      check(`${tag}：小屋那颗还是蓝的（#4C68B0）`, m.disc === 'rgb(76, 104, 176)', m.disc);
      check(`${tag}：没被拉成整行宽`, m.box.w <= disc(size.w) + 0.5, `${m.box.w.toFixed(1)}px`);
    } else {
      check(`${tag}：白底`, m.disc === 'rgb(255, 255, 255)', m.disc);
      check(`${tag}：深红箭头（--accent-ink #7A2E37）`, m.markColor === 'rgb(122, 46, 55)', m.markColor);
    }
    centers.push({ n: pg.n, cx: m.box.cx, b: m.box.b });
    // 老虎机介绍页右下角那颗《开始 〉》（开通了的人才有）和《退出》中线对齐（style.css 的 .slot-go）。
    // 它的离底是照《退出》的半个高度算的：10-08 方案 3-F-2 之前那半个高度写死是 31（62 的一半），
    // 《退出》改成跟着屏宽变大小之后，那一行要是没跟上，两颗就一高一低。
    if (pg.n === '老虎机介绍') {
      const go = await page.evaluate(() => {
        const r = document.querySelector('#slotGo')?.getBoundingClientRect();
        return r ? { cy: r.top + r.height / 2 } : null;
      });
      check(`${tag}：（尺子）开通了的人，右下角有《开始 〉》`, !!go);
      if (go) {
        check(`${tag}：《开始 〉》和《退出》中线对齐（≤1px）`, Math.abs(go.cy - m.box.cy) <= 1,
          `《开始》中线 ${go.cy.toFixed(1)} / 《退出》中线 ${m.box.cy.toFixed(1)}`);
      }
    }

    // ── 第 5 条：手机战绩页 ──
    if (pg.records && size.phone) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const rr = await page.evaluate(RECORDS_MEASURE);
      check(`${tag}：一屏装下，不用滑（scrollHeight ≤ innerHeight）`, rr.scrollH <= rr.vh, `${rr.scrollH} / ${rr.vh}`);
      const base = PANEL_BASE[size.w];
      const want = base * 1.5;
      const room = rr.exit.t - 16 - rr.rec.t; // 面板顶到「退出上沿往上 16px」之间的全部高度
      for (const [nm, p] of [['最近战绩', rr.rec], ['排名', rr.ranks]]) {
        const ratio = (p.h / base).toFixed(2);
        if (room >= want - 0.5) {
          check(`${tag}：${nm}面板 ≥ 1.5 倍原高`, p.h >= want - 0.5, `${p.h.toFixed(1)} / 原高 ${base}（${ratio} 倍）`);
        } else {
          // 放不下 1.5 倍：方案的优先级——退出完整露出 > 1.5 倍、页面不滑。剩下的高度全给面板。
          check(`${tag}：${nm}面板吃满剩下的高度（这一档放不下 1.5 倍，按方案的优先级来）`,
            Math.abs(p.b - (rr.exit.t - 16)) <= 1,
            `${p.h.toFixed(1)} / 原高 ${base}（${ratio} 倍）；面板底 ${p.b.toFixed(1)} / 键顶 ${rr.exit.t.toFixed(1)}`);
        }
      }
      check(`${tag}：两块面板一样高`, Math.abs(rr.rec.h - rr.ranks.h) <= 1, `${rr.rec.h.toFixed(1)} / ${rr.ranks.h.toFixed(1)}`);
      // 面板变高之后六格摊开了；两块底下那句话不一样长（法文三行），它要是一起分高度，两边的
      // 六格就上下错开。量的是每一格的上沿逐个对齐。
      const misalign = rr.recRows.length === 6 && rr.rankRows.length === 6
        ? Math.max(...rr.recRows.map((t, i) => Math.abs(t - rr.rankRows[i])))
        : Infinity;
      check(`${tag}：两块面板的六格一行对一行（≤ 1px）`, misalign <= 1,
        `${rr.recRows.length} / ${rr.rankRows.length} 格，最大差 ${misalign === Infinity ? '—' : misalign.toFixed(1)}px`);
      // 六格等距。第 18 推这儿还量「摊满」（最后一格正好落在底下那一截——留给那句话的下内边距——
      // 的上沿）；10-08 方案 3-C-2 把缝压到 0–4px、两块一套行高行距（那一套数由
      // check-records-rows 量），六格从上往下排，面板长高的那一截留在最后一格底下。所以这儿反过来
      // 量「没有摊开」：相邻两格之间只隔一道 ≤ 4px 的缝，最后一格也没越过底下那一截。
      const gaps = rr.recRows.slice(1).map((t, i) => t - rr.recRows[i]);
      check(`${tag}：六格等距（相邻两格的距离一样，≤ 1px）`,
        gaps.length === 5 && Math.max(...gaps) - Math.min(...gaps) <= 1, gaps.map((g) => g.toFixed(1)).join(' / '));
      check(`${tag}：六格从上往下排、没有摊开（两格之间的缝 ≤ 4px）`,
        gaps.length === 5 && rr.recRowH !== null && Math.max(...gaps) - rr.recRowH <= 4.5,
        `格高 ${rr.recRowH?.toFixed(1)}，两格上沿相距 ${gaps.map((g) => g.toFixed(1)).join(' / ')}`);
      check(`${tag}：最后一格没越过底下那一截（留给那句话的下内边距）`,
        rr.recLast !== null && rr.recLast <= rr.rec.b - rr.recPadB + 0.5,
        `最后一格底 ${rr.recLast?.toFixed(1)} / 面板底 ${rr.rec.b.toFixed(1)} − 下内边距 ${rr.recPadB}`);
      check(`${tag}：累计分卡、两块面板、退出键、底排互不重叠`,
        !overlap(rr.total, rr.rec) && !overlap(rr.total, rr.ranks) && !overlap(rr.rec, rr.ranks) &&
          !overlap(rr.rec, rr.exit) && !overlap(rr.ranks, rr.exit) && !overlap(rr.exit, rr.dock));
    }

    // 按一下：回到该回的地方。（从前炸弹那一格是一扇窗，这儿还有一支「按下去这一层关掉了」；
    // 10-08 方案 3-G 起它也是一整页，每一页都有一个该回的地方。）
    await page.click(pg.exit);
    const ok = await page.waitForSelector(pg.back, { timeout: 8000 }).then(() => true).catch(() => false);
    check(`${tag}：按下去回到 ${pg.back}`, ok);
  }
  // 七页彼此：水平中线、底边差不过 1px（成绩页那颗大一号，比中心就比错了，见文件头）。
  if (centers.length) {
    const xs = centers.map((c) => c.cx);
    const bs = centers.map((c) => c.b);
    const spread = (a) => Math.max(...a) - Math.min(...a);
    check(`${size.n}：（尺子）${PAGES.length} 页都量到了`, centers.length === PAGES.length, `${centers.length} 页`);
    check(`${size.n}：各页的退出键水平中线、底边彼此一致（≤1px）`, spread(xs) <= 1 && spread(bs) <= 1,
      centers.map((c) => `${c.n} ${c.cx.toFixed(1)},${c.b.toFixed(1)}`).join(' / '));
  }
  check(`${size.n}：全程没有报错`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 第 4 条：累计得分卡（「卡上只显示大数字，字体不变；点开后显示『累计得分』＋数字，同步
// 提示也移到点开后；读屏读『累计得分 N』」）。没登录的人量一遍（有同步提示），天才量一遍
// （那句提示本来就没有，点开之后也不该冒出来）。
{
  const VERSION = /SCORING_RULES_VERSION = '([^']+)'/.exec(readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8'))[1];
  const RUNS_KEY = `sugarcube_best_${VERSION}::runs`;
  const runs = [120, 157, 194].map((score, i) => ({
    at: Date.now() - i * 3600e3, start: null, end: null,
    data: { shapeId: 'square', shapeFallback: '方块', modeKey: 'base', totalScore: score, at: Date.now() - i * 3600e3 },
  }));
  const want = 120 + 157 + 194;
  for (const asGenius of [false, true]) {
    const tag = `累计得分卡${asGenius ? '（天才）' : '（没登录）'}`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(([key, r, g]) => {
      localStorage.setItem('slides_lang', 'zhHans');
      if (g) localStorage.setItem('slides_genius', g);
      else localStorage.removeItem('slides_genius');
      // 开机那一次清档（engine/wipeOldRules.ts）跑完之后才塞——它只在第一次开的时候清。
      if (sessionStorage.getItem('seeded')) localStorage.setItem(key, JSON.stringify(r));
      sessionStorage.setItem('seeded', '1');
    }, [RUNS_KEY, runs, asGenius ? genius : null]);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
    await page.click('#navRecords');
    await page.waitForSelector('.records-page .total-card', { timeout: 10000 });
    await page.waitForTimeout(400);
    const card = await page.$eval('.records-page .total-card', (e) => ({
      kids: [...e.children].map((c) => c.className),
      text: e.textContent.trim(),
      label: e.getAttribute('aria-label') || '',
      font: (e.querySelector('.total-card-value') || {}).style?.fontSize || '',
    }));
    check(`${tag}：（尺子）卡上那个数就是塞进去那三局的和`, card.text === String(want), `「${card.text}」/ ${want}`);
    check(`${tag}：卡上只有那个数（没有标题、没有同步提示）`, card.kids.length === 1 && card.kids[0] === 'total-card-value', card.kids.join(' / '));
    // 第 18 推这一条是「字体不变（短数字还是 2.3rem）」；10-08 方案 3-C-3 要「数字放大」——1.3 倍。
    check(`${tag}：数字放大到 3rem（原来 2.3rem 的 1.3 倍）`, Math.abs(parseFloat(card.font) - 3) < 0.005 && card.font.endsWith('rem'), card.font);
    check(`${tag}：读屏念「累计得分 ${want}」`, card.label === `累计得分 ${want}`, card.label);
    await page.click('.records-page .total-card');
    await page.waitForSelector('.center-pick .total-card--big', { timeout: 8000 });
    const big = await page.$eval('.center-pick .total-card--big', (e) => ({
      title: (e.querySelector('.total-card-title') || {}).textContent || '',
      value: (e.querySelector('.total-card-value') || {}).textContent || '',
      sub: (e.querySelector('.total-card-sub') || {}).textContent || '',
    }));
    check(`${tag}：点开之后写着「累计得分」和那个数`, big.title === '累计得分' && big.value === String(want), JSON.stringify(big));
    if (asGenius) check(`${tag}：天才点开之后也没有同步提示`, big.sub === '', big.sub);
    else check(`${tag}：同步提示挪到了点开之后`, big.sub.includes('云端'), big.sub);
    // 10-08 方案 3-C-3：点开的大卡底下不挂《退出》。关它靠点外面（和别的那几扇一样）。
    const exits = await page.evaluate(() => [...document.querySelectorAll('.center-pick .page-exit, .center-pick .center-pick-back')].length);
    check(`${tag}：点开的大卡底下没有《退出》`, exits === 0, `${exits} 颗`);
    await page.mouse.click(8, 8);
    const closed = await page.waitForFunction(() => !document.querySelector('.center-pick'), null, { timeout: 5000 }).then(() => true).catch(() => false);
    check(`${tag}：点外面关得掉`, closed);
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${pass} 条通过，${fail} 条没过`);
process.exit(fail ? 1 : 0);
