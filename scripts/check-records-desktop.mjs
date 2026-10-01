/**
 * 电脑端的成绩页：三栏并排（PR-18 / E27）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8891 dist
 *   node scripts/check-records-desktop.mjs http://localhost:8891/
 *
 * ── 为什么要有这道门 ────────────────────────────────────────
 *
 * 玩家的话和个人主页那一段是同一句：「更合理地使用左右空间」。这一页在电脑上从前是屏幕中
 * 间一条 460px 的窄栏，自上而下三块：《累计得分》整幅一张，底下《记录》《排行榜》各占一
 * 半——三块加起来 460px 宽，屏幕上剩下的全是空的，而且**要往下滑**才看得全，可这一页只有
 * 三块东西。
 *
 * 并成一排之后要守的是四件事，每一件都「屏幕上看得见、却没有任何一道门会红」：
 *
 * ① **三块真的在同一行上**，而不是「看着像」。grid 一处写错（比如招牌没跨满整行）就会把
 *    《累计得分》挤进第一格去和招牌并排，而那是整页唯一一处「上面一行」。
 * ② **三栏等宽**。`1fr` 的真身是 `minmax(auto, 1fr)`，那个 auto 的下限是内容的最小宽
 *    度——榜上出现一个十位数的分数（等宽字体、不折行、不省略号）时那一栏会按它撑开，把另两
 *    栏挤扁再把整页顶出屏幕。玩家 2026-09 实拍到过（榜首 1000000000）。所以这儿不光量「现
 *    在等宽」，还**塞一个十位数进去再量一遍**。
 * ③ **不用往下滑**。这一页只有三块东西，要滑就是排版没做到。
 * ④ **窄屏一个像素都不许动**。三栏只在 ≥1000px 开门，999px 上必须还是原来那一套（竖着
 *    叠、两块面板并排）——不然这道门守住了电脑却悄悄改了手机。
 */
import { chromium } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('用法: node scripts/check-records-desktop.mjs http://localhost:<端口>/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};
const head = (t) => console.log('\n' + t);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 开一张干净的页面，走到成绩页。 */
async function openRecords(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
  });
  await page.reload();
  // 等元素，不盲等秒数（开场动画三秒多，CI 的机器更慢）。
  await page.waitForSelector('.home-nav-btn', { timeout: 25000 });
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('.home-nav-btn')];
    const me = els.find((e) => /记录|排名|成绩/.test(e.getAttribute('aria-label') || e.textContent || ''));
    (me || els[0]).click();
  });
  await page.waitForSelector('.records-panels', { timeout: 15000 });
  await page.waitForTimeout(350);
  return { ctx, page };
}

const measure = (page) =>
  page.evaluate(() => {
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const page_ = document.querySelector('.records-page');
    return {
      display: getComputedStyle(page_).display,
      pageW: Math.round(page_.getBoundingClientRect().width),
      head: box('.home-head'),
      total: box('.total-card'),
      rec: box('.records-panel--records'),
      rank: box('.records-panel--ranks'),
      docScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
      // 三块都在屏幕里吗（右沿、下沿）。
      rightMost: Math.max(
        ...['.total-card', '.records-panel--records', '.records-panel--ranks']
          .map((s) => document.querySelector(s)?.getBoundingClientRect().right ?? 0),
      ),
      lowest: Math.max(
        ...['.total-card', '.records-panel--records', '.records-panel--ranks']
          .map((s) => document.querySelector(s)?.getBoundingClientRect().bottom ?? 0),
      ),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });

// ── 电脑端：三栏 ──────────────────────────────────────────────
for (const [w, h] of [[1440, 900], [1000, 700], [1920, 1080]]) {
  head(`电脑 ${w}×${h}`);
  const { ctx, page } = await openRecords(w, h);
  const v = await measure(page);
  check('（尺子）三块都在（下面几条才有意义）', Boolean(v.total && v.rec && v.rank),
    JSON.stringify([v.total, v.rec, v.rank]));
  if (!(v.total && v.rec && v.rank)) { await ctx.close(); continue; }

  check('这一页在电脑上是 grid', v.display === 'grid', v.display);
  check('① 三块在同一行上（顶边对齐）',
    Math.abs(v.total.y - v.rec.y) <= 2 && Math.abs(v.rec.y - v.rank.y) <= 2,
    `${v.total.y} / ${v.rec.y} / ${v.rank.y}`);
  check('① 招牌独占上面一行（没被挤进第一格）',
    v.head && v.head.y + v.head.h <= v.total.y + 2, `招牌底 ${v.head?.y + v.head?.h} / 第一栏顶 ${v.total.y}`);
  const ws = [v.total.w, v.rec.w, v.rank.w];
  check('② 三栏等宽（差不到 2px）', Math.max(...ws) - Math.min(...ws) <= 2, ws.join(' / '));
  check('② 三块等高（一排才像一排）',
    Math.max(v.total.h, v.rec.h, v.rank.h) - Math.min(v.total.h, v.rec.h, v.rank.h) <= 2,
    `${v.total.h} / ${v.rec.h} / ${v.rank.h}`);
  check('③ 不用往下滑', !v.docScrolls);
  check('三块都在屏幕里', v.rightMost <= v.vw + 0.5 && v.lowest <= v.vh + 0.5,
    `右沿 ${Math.round(v.rightMost)}/${v.vw} 下沿 ${Math.round(v.lowest)}/${v.vh}`);

  /*
   * ② 的反面：**塞一个十位数进去再量一遍**。
   *
   * 这一条才是 `minmax(0, 1fr)` 那三道写法的理由。玩家 2026-09 实拍到过榜首
   * 1000000000 把半幅排版顶出屏幕；三栏之后同一条坑照旧在，所以照旧要量。等宽字体、不折
   * 行、不省略号（省略号写在数字上就是在撒谎），所以唯一的出路是那道 minmax 的 0。
   */
  const wide = await page.evaluate(() => {
    const v = document.querySelector('.total-card-value');
    const keep = v.textContent;
    v.textContent = '1000000000';
    // 榜那一半也塞一个：两边都可能是撑开的那一个。
    const row = document.querySelector('.records-panel--ranks .records-row-score')
      || document.querySelector('.records-panel--ranks .rank-score');
    const keepRow = row?.textContent;
    if (row) row.textContent = '1000000000';
    const read = () => {
      const b = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { w: Math.round(r.width), right: r.right }; };
      return {
        ws: [b('.total-card').w, b('.records-panel--records').w, b('.records-panel--ranks').w],
        rightMost: Math.max(b('.total-card').right, b('.records-panel--records').right, b('.records-panel--ranks').right),
        vw: window.innerWidth,
      };
    };
    const out = read();
    v.textContent = keep;
    if (row && keepRow !== undefined) row.textContent = keepRow;
    return out;
  });
  check('② 塞一个十位数：三栏还是等宽',
    Math.max(...wide.ws) - Math.min(...wide.ws) <= 2, wide.ws.join(' / '));
  check('② 塞一个十位数：整页还在屏幕里',
    wide.rightMost <= wide.vw + 0.5, `右沿 ${Math.round(wide.rightMost)}/${wide.vw}`);
  await ctx.close();
}

// ── ④ 窄屏一个像素都不许动 ────────────────────────────────────
head('窄屏 999×700（三栏那道门的下面一档）');
{
  const { ctx, page } = await openRecords(999, 700);
  const v = await measure(page);
  check('④ 999px 上还是 flex 柱，不是 grid', v.display === 'flex', v.display);
  check('④ 《累计得分》照旧整幅（比一块面板宽得多）',
    v.total.w > v.rec.w * 1.8, `总分 ${v.total.w} / 面板 ${v.rec.w}`);
  check('④ 两块面板照旧并排、在总分下面',
    Math.abs(v.rec.y - v.rank.y) <= 2 && v.rec.y > v.total.y + v.total.h - 2,
    `${v.rec.y} / ${v.rank.y} / 总分底 ${v.total.y + v.total.h}`);
  check('④ 页宽照旧是那条 460 的窄栏', v.pageW <= 460, String(v.pageW));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);
