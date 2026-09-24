/**
 * 主菜单那条竖着跑的带子（ui/modeStrip.ts + engine/marquee.ts）。
 *
 * ⚠️ **第十一轮主菜单换回了鱼眼轴，这条带子没有接线，所以这道门跑不通。**
 * 它现在量的是一块不在页面上的界面：跑它只会在等选择器的地方超时。带子那一版
 * 和 engine/marquee.ts 一起留着当后备（见 ui/modeStrip.ts 文件头），这道门也就
 * 一起留着——哪天再换回带子，它是现成的。**现行菜单的门是
 * scripts/check-mode-axis.mjs 和 scripts/check-menu.mjs。**
 * 写明这一句的理由照 9c73a07 的教训：没接线的东西不写明，下一个人会以为它是
 * 现行的，然后拿一道注定红的门去怀疑好好的代码。
 *
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-mode-strip.mjs http://localhost:8815/
 *
 * 方向和以前的鱼眼轴**一样是竖的**，换的只是效果（玩家原话：「滑动是竖向的
 * 滑动，和现在鱼眼转盘一样的方向只是效果不同」）。
 *
 * 这道门接的是 check-mode-axis 的班：玩家 2026-09 第十轮把鱼眼轴换成了
 * 这条带子，轴那道门量的是一块已经不存在的界面，所以整条换掉。能搬过来的不变量
 * 都搬了（十四张卡、首玩期的锁、《我会玩》夹在中间、停在上次那一项、小字字号），
 * 新加的是带子自己那几条规格。
 *
 * **最该盯的是「点移动靶」。** 玩家点名要这个效果，我提过风险他确认了，所以这
 * 儿把防护逐条量出来：手指按下带子就停、拖过 10px 不算点、第二份（克隆的）点下
 * 去也得开局。少任何一条，玩家都会「按了一下，开的不是我要的那个」。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-mode-strip.mjs http://localhost:8815/');
  process.exit(2);
}

let fail = 0;
let n = 0;
const check = (name, ok, extra = '') => {
  n++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 一台干净的手机，落到主菜单上。`store` 里的东西在页面跑起来之前种进去。 */
async function menuPage(store = {}, opts = {}) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  const pg = await ctx.newPage();
  await pg.addInitScript((s) => {
    localStorage.setItem('slides_lang', 'zhHans');
    for (const k in s) localStorage.setItem(k, s[k]);
  }, store);
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.waitForSelector('.home-grid', { timeout: 20000 });
  await pg.waitForTimeout(500);
  return { ctx, pg };
}
/** 老玩家：十四张全开。 */
const PLAYED = { slides_played_square: '1', slides_played_circle: '1' };

/** 带子这一帧的样子。 */
const shot = (pg) => pg.evaluate(() => {
  const host = document.querySelector('.mode-strip');
  if (!host) return null;
  const track = host.querySelector('.marquee-track');
  const copies = [...host.querySelectorAll('.marquee-copy')];
  const idxOf = (c) => [...c.querySelectorAll('[data-strip-idx]')].map((e) => e.dataset.stripIdx);
  // 竖着走：translate3d(0px, Ypx, 0px)——要的是第二个数。
  const m = /translate3d\(-?[\d.]+px,\s*(-?[\d.]+)px[^)]*\).*skewX\((-?[\d.]+)deg\)/.exec(track?.style.transform || '');
  return {
    copies: copies.length,
    aria: copies.map((c) => c.getAttribute('aria-hidden')),
    idx0: idxOf(copies[0] || host),
    idx1: copies[1] ? idxOf(copies[1]) : [],
    copyW: copies[0]?.getBoundingClientRect().height ?? 0,
    hostW: host.clientHeight,
    offset: m ? parseFloat(m[1]) : NaN,
    skew: m ? parseFloat(m[2]) : NaN,
    docW: document.documentElement.scrollWidth,
    winW: window.innerHeight,
    screenW: window.innerWidth,
    docH: document.documentElement.scrollHeight,
    winH: window.innerHeight,
    tagPx: parseFloat(getComputedStyle(host.querySelector('.home-icon-tag')).fontSize),
  };
});

// ── 一、骨架：两份，第二份是画 ────────────────────────────────────────────
{
  const { ctx, pg } = await menuPage(PLAYED);
  const s = await shot(pg);
  check('主菜单是那条带子（不是别的什么）', !!s);
  check('一份里十四张卡', s.idx0.length === 14, `${s.idx0.length} 张`);
  /**
   * **正好两份，不是三份。**
   *
   * 玩家给的做法里点名了这一条：「两份就够，三份是多余的——只要一份的宽度 ≥ 视
   * 口宽」。下一条量的就是那个前提：一份没屏幕宽的话，减掉一份之后右边会空出一
   * 块，「无缝」当场破功。
   */
  check('正好摆两份', s.copies === 2, `${s.copies} 份`);
  check('一份比屏幕高（无缝的前提）', s.copyW >= s.winW, `一份 ${s.copyW.toFixed(0)}px / 屏高 ${s.winW}`);
  check('两份内容一模一样（接缝处看不出来）', s.idx0.join(',') === s.idx1.join(','));
  /* 读屏只该听见一遍：复制出来的那一份整个 aria-hidden。 */
  check('第二份是 aria-hidden（读屏不念两遍）', s.aria[0] !== 'true' && s.aria[1] === 'true', JSON.stringify(s.aria));
  check('页面不横向滚', s.docW === s.screenW, `${s.docW} / ${s.screenW}`);
  /*
   * 带子自己滚，**不带着页面滚**。
   *
   * 两份内容加起来四千多像素，留在文流里的话整页跟着被撑到 4657px，手指
   * 一滑滑出一片空白。现在它是绝对定位的（见 .mode-strip），文档就是一屏。
   */
  check('页面不多出一截可滚的空白', s.docH <= s.winH + 1, `文档 ${s.docH} / 屏高 ${s.winH}`);
  // 第九轮玩家要的「主菜单文字整体缩小字号」，换成带子之后这条仍然成立。
  check('卡片底下那行小字还是缩过的（≤ 11px）', s.tagPx > 0 && s.tagPx <= 11, `${s.tagPx}px`);
  await ctx.close();
}

// ── 二、自己在走，而且绕得回来 ────────────────────────────────────────────
{
  const { ctx, pg } = await menuPage(PLAYED);
  const a = await shot(pg);
  await pg.waitForTimeout(1200);
  const b = await shot(pg);
  const moved = Math.abs(b.offset - a.offset);
  check('带子自己在往上走', b.offset < a.offset || moved > a.copyW / 2, `${a.offset.toFixed(0)} → ${b.offset.toFixed(0)}`);
  /**
   * 位移永远关在一份宽度里——这就是「无缝」的全部秘密（走过一份就减掉一份）。
   *
   * 关不住的话位移会一路变成好几千，两份很快都被推出屏幕，带子就空了。
   */
  const inRange = await pg.evaluate(async () => {
    const track = document.querySelector('.marquee-track');
    const copyW = document.querySelector('.marquee-copy').getBoundingClientRect().height;
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const v = parseFloat(/translate3d\(-?[\d.]+px,\s*(-?[\d.]+)px/.exec(track.style.transform)[1]);
      if (v > 0 || v <= -copyW) worst = v;
    }
    return { worst, copyW };
  });
  check('位移始终关在一份高度里', inRange.worst === 0, `越界过 ${inRange.worst}（一份 ${inRange.copyW.toFixed(0)}）`);
  await ctx.close();
}

// ── 三、倾斜跟着滚动走，但有上限 ──────────────────────────────────────────
{
  const { ctx, pg } = await menuPage(PLAYED);
  /*
   * 倾斜跟着**滑动速度**走。
   *
   * 主菜单是一屏装下的、而且带子自己吃掉了竖向手势，window.scrollY 永远是 0
   * ——所以玩家眼里的「滑动速度」就是他自己拖的那一下（见 marquee 的 drive）。
   * 这儿就真拖一把，量两件事：**真的斜了**（> 0.5°），而且**守住了上限**（≤ 6°）。
   * 两条缺一条都不算数：只看上限的话，「永远不斜」也能蒙混过关。
   */
  let skew = 0;
  await pg.mouse.move(195, 600);
  await pg.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await pg.mouse.move(195, 600 - i * 34);
    const m = await pg.evaluate(() => /skewX\((-?[\d.]+)deg\)/.exec(document.querySelector('.marquee-track').style.transform));
    if (m) skew = Math.max(skew, Math.abs(parseFloat(m[1])));
  }
  await pg.mouse.up();
  check('拖一把，带子真的斜了', skew > 0.5, `最大 ${skew.toFixed(2)}°`);
  check('但倾斜不超过 ±6°', skew <= 6.01, `最大 ${skew.toFixed(2)}°`);
  await ctx.close();
}

// ── 四、手指：按下就停、拖动不开局、轻点开局、克隆那一份也算数 ────────────
{
  const { ctx, pg } = await menuPage(PLAYED);
  const t = (p) => p.evaluate(() => document.querySelector('.marquee-track')?.style.transform ?? '（没了）');
  await pg.mouse.move(195, 420);
  await pg.mouse.down();
  const t1 = await t(pg);
  await pg.waitForTimeout(600);
  const t2 = await t(pg);
  check('手指按着的时候带子停住（点的那一刻它不动）', t1 === t2, `${t1} → ${t2}`);
  // 拖过 10px：这一下是「拖」，不是「点」，松手不许开局。
  for (let i = 1; i <= 8; i++) await pg.mouse.move(195, 420 - i * 15);
  const t3 = await t(pg);
  check('拖动的时候带子跟着手指走', t3 !== t2, `${t2} → ${t3}`);
  await pg.mouse.up();
  await pg.waitForTimeout(400);
  const stillMenu = await pg.evaluate(() => !!document.querySelector('.mode-strip') && !document.querySelector('.start-go, .board-wrap, .center-pick'));
  check('往上拖 120px 之后没有误开局', stillMenu);
  await pg.waitForTimeout(500);
  const t4 = await t(pg);
  check('松开之后带子又走起来', t4 !== t3, `${t3} → ${t4}`);
  await ctx.close();
}
{
  /**
   * **点第二份（克隆的那一份）也得开局。**
   *
   * 第二份是 `cloneNode` 出来的，监听器不会跟过去。第一版靠 `e.target` 找那张卡，
   * 而 `setPointerCapture` 会把 pointerup 一律改派给 host——于是带子上的卡**一张
   * 都点不动**。现在命中判定走落点（elementFromPoint），克隆的那一份由真身代打。
   */
  const { ctx, pg } = await menuPage(PLAYED);
  const target = await pg.evaluate(() => {
    const copies = [...document.querySelectorAll('.marquee-copy')];
    for (const el of copies[1].querySelectorAll('[data-strip-idx]')) {
      const r = el.getBoundingClientRect();
      if (r.top > 4 && r.bottom < window.innerHeight - 4) return { idx: el.dataset.stripIdx, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  check('屏幕上看得见第二份里的卡（下一条才有意义）', !!target, target ? `第 ${target.idx} 张` : '（一张都没有）');
  if (target) {
    await pg.mouse.click(target.x, target.y);
    await pg.waitForTimeout(900);
    const opened = await pg.evaluate(() => !document.querySelector('.mode-strip') || !!document.querySelector('.start-go, .board-wrap, .center-pick'));
    check('轻点第二份里的卡：开局了（克隆的那份不是死的）', opened, `第 ${target.idx} 张`);
  }
  await ctx.close();
}

// ── 五、页面切到后台就停 rAF ──────────────────────────────────────────────
{
  const { ctx, pg } = await menuPage(PLAYED);
  const t = () => pg.evaluate(() => document.querySelector('.marquee-track').style.transform);
  /* 先证明它**本来就在走**——否则下面那条「停了」在带子压根儿不动的时候也会绿。 */
  const before = await t();
  await pg.waitForTimeout(500);
  check('（先核一下）这会儿它本来在走', (await t()) !== before);
  await pg.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pg.waitForTimeout(120);
  const h1 = await t();
  await pg.waitForTimeout(700);
  const h2 = await t();
  check('切到后台：rAF 停了（回来不会瞬移一大截）', h1 === h2, `${h1} → ${h2}`);
  await pg.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pg.waitForTimeout(600);
  check('回到前台：又走起来了', (await t()) !== h2);
  await ctx.close();
}

// ── 六、减弱动态效果：不自动滚，只留手动横滑 ──────────────────────────────
{
  const { ctx, pg } = await menuPage(PLAYED, { reducedMotion: 'reduce' });
  const s = await pg.evaluate(() => {
    const host = document.querySelector('.mode-strip');
    return {
      manual: host?.classList.contains('marquee--manual'),
      copies: host?.querySelectorAll('.marquee-copy').length,
      overflowY: host ? getComputedStyle(host).overflowY : '',
      transform: host?.querySelector('.marquee-track')?.style.transform || '',
    };
  });
  check('开了「减弱动态效果」：不自动滚', s.manual === true && !s.transform, `manual=${s.manual} transform="${s.transform}"`);
  // 只摆一份：手动滑是有头有尾的，摆两份会让人以为内容出了重影。
  check('这时候只摆一份', s.copies === 1, `${s.copies} 份`);
  check('外壳可以手动竖着滑', /auto|scroll/.test(s.overflowY), s.overflowY);
  await ctx.close();
}

// ── 七、首玩期：全摆出来、只有两张能按、《我会玩》夹在中间 ────────────────
{
  const { ctx, pg } = await menuPage();
  const s = await shot(pg);
  check('首玩期也是十四张全摆出来', s.idx0.length === 14, `${s.idx0.length} 张`);
  const first = await pg.evaluate(() => {
    const copy = document.querySelector('.marquee-copy');
    const cards = [...copy.children].filter((e) => e.classList.contains('home-icon-btn'));
    const div = copy.querySelector('.axis-divider');
    // 竖着摆：用布局坐标 offsetTop，不用屏幕坐标——带子每帧都在走。
    const ly = (e) => e.offsetTop + e.offsetHeight / 2;
    return {
      locked: cards.filter((e) => e.classList.contains('home-icon-btn--locked')).length,
      hasDiv: !!div,
      before: div ? cards.filter((e) => ly(e) < ly(div)).length : -1,
      beforeLocked: div ? cards.filter((e) => ly(e) < ly(div)).some((e) => e.classList.contains('home-icon-btn--locked')) : true,
    };
  });
  check('除两张基础卡外都锁着', first.locked === 12, `锁着 ${first.locked} 张`);
  check('有《我会玩》那条分界线', first.hasDiv);
  check('分界线上面正好两张，而且都没锁', first.before === 2 && first.beforeLocked === false, `上面 ${first.before} 张`);
  /* 锁着的那张**按不动**：这一条要和上一条一起看，不然锁只是一张图。 */
  const lockedTap = await pg.evaluate(() => {
    const el = [...document.querySelectorAll('.home-icon-btn--locked')].find((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0;
    });
    if (!el) return null;
    el.click();
    return true;
  });
  await pg.waitForTimeout(500);
  const stayed = await pg.evaluate(() => !!document.querySelector('.mode-strip'));
  check('锁着的那张按下去开不了局', lockedTap === true && stayed, `找到锁着的卡=${lockedTap}`);
  await ctx.close();
}

// ── 八、停在上次看的那一项 ────────────────────────────────────────────────
{
  const { ctx, pg } = await menuPage(PLAYED);
  // 把某一项摆到正中，记下它是谁；刷新之后该还在附近。
  await pg.evaluate(() => sessionStorage.setItem('slides_axis_focus', '7'));
  await pg.reload({ waitUntil: 'networkidle' });
  await pg.waitForSelector('.mode-strip', { timeout: 20000 });
  await pg.waitForTimeout(150);
  const near = await pg.evaluate(() => {
    const host = document.querySelector('.mode-strip');
    const mid = host.clientHeight / 2;
    let best = -1, bestD = Infinity;
    for (const e of host.querySelectorAll('[data-strip-idx]')) {
      const r = e.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) { bestD = d; best = Number(e.dataset.stripIdx); }
    }
    return { best, bestD };
  });
  check('刷新之后停在上次看的那一项（第 7 项）', near.best === 7, `正中是第 ${near.best} 项，差 ${near.bestD.toFixed(0)}px`);
  // 反过来量一次，防止上一条是「碰巧 7」：换个数还得跟着换。
  await pg.evaluate(() => sessionStorage.setItem('slides_axis_focus', '2'));
  await pg.reload({ waitUntil: 'networkidle' });
  await pg.waitForSelector('.mode-strip', { timeout: 20000 });
  await pg.waitForTimeout(150);
  const near2 = await pg.evaluate(() => {
    const host = document.querySelector('.mode-strip');
    const mid = host.clientHeight / 2;
    let best = -1, bestD = Infinity;
    for (const e of host.querySelectorAll('[data-strip-idx]')) {
      const r = e.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) { bestD = d; best = Number(e.dataset.stripIdx); }
    }
    return best;
  });
  check('换一项，停的地方跟着换（不是碰巧）', near2 === 2, `正中是第 ${near2} 项`);
  await ctx.close();
}

await br.close();
console.log(`\n${fail === 0 ? '全部通过' : `${fail} 条没过`}（共 ${n} 条）`);
process.exit(fail === 0 ? 0 : 1);
