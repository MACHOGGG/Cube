/**
 * 电脑端的成绩页：两栏等宽（第 17 推；原先是 PR-18 / E27 的三栏）。
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
 * PR-18 先把三块并成一排（三栏）。第 17 推方案改成**两栏等宽**：左栏上面《累计得分》、下
 * 面《最近战绩》，右栏《排名》，「上下沿和左栏对齐」——三栏的毛病是《累计得分》那一栏里只
 * 有一个数，却被另两栏拉成一样高，中间空着一大块。
 *
 * 要守的是四件事，每一件都「屏幕上看得见、却没有任何一道门会红」：
 *
 * ① **左栏两块摞着、右栏一块对齐左栏的上下沿**，而不是「看着像」。grid 一处写错（比如
 *    招牌没跨满整行、某一块没摆进该在的格子）就会把一块挤进招牌那一行，或者让右栏短一截。
 * ② **两栏等宽**。`1fr` 的真身是 `minmax(auto, 1fr)`，那个 auto 的下限是内容的最小宽
 *    度——榜上出现一个十位数的分数（等宽字体、不折行、不省略号）时那一栏会按它撑开，把另一
 *    栏挤扁再把整页顶出屏幕。玩家 2026-09 实拍到过（榜首 1000000000）。所以这儿不光量「现
 *    在等宽」，还**往里塞撑不开的东西再量一遍**（十位数之外再加一段不折行的长串——两栏之
 *    后十位数自己已经撑不开一栏了，见下面那一节）。
 * ③ **不用往下滑**。这一页只有三块东西，要滑就是排版没做到。
 * ④ **窄屏一个像素都不许动**。两栏只在 ≥1000px 开门，999px 上必须还是原来那一套（竖着
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

// ── 电脑端：两栏 ──────────────────────────────────────────────
for (const [w, h] of [[1440, 900], [1000, 700], [1920, 1080]]) {
  head(`电脑 ${w}×${h}`);
  const { ctx, page } = await openRecords(w, h);
  const v = await measure(page);
  check('（尺子）三块都在（下面几条才有意义）', Boolean(v.total && v.rec && v.rank),
    JSON.stringify([v.total, v.rec, v.rank]));
  if (!(v.total && v.rec && v.rank)) { await ctx.close(); continue; }

  check('这一页在电脑上是 grid', v.display === 'grid', v.display);
  check('① 左栏：《累计得分》在上、《最近战绩》在下，左沿对齐',
    Math.abs(v.total.x - v.rec.x) <= 1 && v.rec.y >= v.total.y + v.total.h - 1,
    `总分 x${v.total.x} 底 ${v.total.y + v.total.h} / 战绩 x${v.rec.x} 顶 ${v.rec.y}`);
  check('① 右栏《排名》在左栏右边', v.rank.x >= v.total.x + v.total.w - 1,
    `排名 x${v.rank.x} / 左栏右沿 ${v.total.x + v.total.w}`);
  check('① 右栏的上沿对齐左栏的上沿（《累计得分》的顶）', Math.abs(v.rank.y - v.total.y) <= 1,
    `${v.rank.y} / ${v.total.y}`);
  check('① 右栏的下沿对齐左栏的下沿（《最近战绩》的底）',
    Math.abs(v.rank.y + v.rank.h - (v.rec.y + v.rec.h)) <= 1,
    `${v.rank.y + v.rank.h} / ${v.rec.y + v.rec.h}`);
  check('① 招牌独占上面一行（没被挤进第一格）',
    v.head && v.head.y + v.head.h <= Math.min(v.total.y, v.rank.y) + 2,
    `招牌底 ${v.head?.y + v.head?.h} / 两栏顶 ${Math.min(v.total.y, v.rank.y)}`);
  const ws = [v.total.w, v.rec.w, v.rank.w];
  check('② 两栏等宽（左栏两块、右栏一块，差不到 2px）', Math.max(...ws) - Math.min(...ws) <= 2, ws.join(' / '));
  check('③ 不用往下滑', !v.docScrolls);
  check('三块都在屏幕里', v.rightMost <= v.vw + 0.5 && v.lowest <= v.vh + 0.5,
    `右沿 ${Math.round(v.rightMost)}/${v.vw} 下沿 ${Math.round(v.lowest)}/${v.vh}`);

  /*
   * ② 的反面：**往每一块里塞一样撑不开的东西，再量一遍**。
   *
   * 这一条才是 `minmax(0, 1fr)` 那两道写法的理由。玩家 2026-09 实拍到过榜首
   * 1000000000 把半幅排版顶出屏幕。
   *
   * ⚠️ 两栏之后「塞一个十位数」**单靠它已经量不出东西了**（反证时撤掉 minmax，这一条照样
   * 绿）：累计分那个数现在会在卡里折行（30 位也只有 368 宽），缩略榜上的分数又由
   * engine/compactScore 缩写——真分数再大也撑不开一栏。可「栏宽和内容无关」这件事本身照旧
   * 要守：哪天谁往这几块里加了一样不折行的东西（一个名字、一个标签），没有那道 0，它就会把
   * 一栏撑宽、把另一栏挤扁。所以这儿往三块里**轮流**塞一段不折行的长串（40 个字、等宽字
   * 体，比一栏宽），每塞一次量一遍三块的宽。十位数那一下留着，它是那次真事。
   *
   * 反证：把那两道 minmax(0, …) 换回 1fr，塞在累计分卡里那一次两栏当场变成 522 / 294。
   */
  const wide = await page.evaluate(() => {
    const b = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { w: Math.round(r.width), right: r.right }; };
    const read = (tag) => ({
      tag,
      ws: [b('.total-card').w, b('.records-panel--records').w, b('.records-panel--ranks').w],
      rightMost: Math.max(b('.total-card').right, b('.records-panel--records').right, b('.records-panel--ranks').right),
    });
    const out = [];
    // 那次真事：榜首一个十位数。
    const v = document.querySelector('.total-card-value');
    const keep = v.textContent;
    v.textContent = '1000000000';
    out.push(read('累计分写成十位数'));
    v.textContent = keep;
    // 不折行的长串，三块轮流塞。
    for (const [host, name] of [['.total-card', '累计分卡'], ['.records-panel--records', '最近战绩'], ['.records-panel--ranks', '排名']]) {
      const probe = document.createElement('span');
      probe.textContent = '8'.repeat(40);
      probe.style.cssText = 'display:inline-block;white-space:nowrap;font:600 20px monospace';
      document.querySelector(host).appendChild(probe);
      const r = read(`${name}里塞一段不折行的长串`);
      // 量的是那段字本身有多宽（scrollWidth），不是它的盒子：两块面板是竖排的弹性盒，塞进去
      // 的东西横向被拉成面板的内宽（384），字照样伸出去——量盒子的话尺子自己先红。
      r.probeW = Math.round(Math.max(probe.getBoundingClientRect().width, probe.scrollWidth));
      out.push(r);
      probe.remove();
    }
    return { rows: out, vw: window.innerWidth };
  });
  // 尺子：那一段长串真的比一栏宽（不然「没撑开」是白给的）。
  const probeRows = wide.rows.filter((r) => r.probeW !== undefined);
  check('（尺子）塞进去的长串比一栏还宽', probeRows.every((r) => r.probeW > v.total.w),
    probeRows.map((r) => `${r.probeW}`).join(' / ') + ` > ${v.total.w}`);
  for (const r of wide.rows) {
    check(`② ${r.tag}：两栏还是等宽`, Math.max(...r.ws) - Math.min(...r.ws) <= 2, r.ws.join(' / '));
    check(`② ${r.tag}：整页还在屏幕里`, r.rightMost <= wide.vw + 0.5, `右沿 ${Math.round(r.rightMost)}/${wide.vw}`);
  }
  await ctx.close();
}

// ── ④ 窄屏一个像素都不许动 ────────────────────────────────────
head('窄屏 999×700（两栏那道门的下面一档）');
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
