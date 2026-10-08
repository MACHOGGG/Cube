/**
 * 两件「打不开 / 按不到」：《步步为营》进得去吗，结算页那三颗键够得着吗。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8945 dist      （内存版，TESTMONTH 只能兑一次）
 *   node scripts/check-endcard-reach.mjs http://localhost:8945/
 *
 * ── ① 《步步为营》整档打不开 ──────────────────────────────
 *
 * `gameShell` 那个三目在 `meta.steps` 为真时只画 `#hud-time`，不画 `#scoreReel`，而
 * 底下 `scoreReelEl: req('scoreReel')` 的 `req()` 取不到就**抛**。实测症状：挑完形状
 * 按下开局，棋盘一枚都不画，控制台一句 `gameShell: missing #scoreReel`——不白屏、不
 * 报错给玩家看，就是「这个玩法打不开」。
 *
 * ── ② 结算页那三颗键够不着 ────────────────────────────
 *
 * `#endOverlay .modal` 那条 id 规则（1-1-0）用 `overflow: hidden` 简写，压掉了
 * `.overlay--end .modal`（0-2-0）里的 `overflow-y: auto`。矮屏上的实测（修之前）：
 *
 *     320×568  内容被裁 118px，三颗键在屏下 56px，**滚不动** → 打完一局卡死
 *     360×640  内容被裁  80px，三颗键在屏下 13px，滚不动
 *
 * **判「够得着」不要用 JS 去设 scrollTop**：`overflow: hidden` 的盒子脚本照样滚得动，
 * 那样量出来是空绿。要问的是「浏览器会不会让手指滚」——`overflow-y` 的计算值是不是
 * `auto|scroll`，以及真的有没有超出的内容。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) { console.log('用法：node scripts/check-endcard-reach.mjs http://localhost:8945/'); process.exit(2); }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * `tipSeen`：「综合分是怎么来的」那句只在头一局讲（engine/firstPlay.ts 的 totaltip）。② ④ 量最挤的那一
 * 种（带着它），③ 量战绩图平常有多大（不带）——E28 那条底线说的是平常那一页。
 */
async function newPage(w, h, tipSeen = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((tipSeen) => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['square', 'circle', 'bomb', 'slot', 'flip', 'timed', 'layout', 'endcard']) localStorage.setItem('slides_played_' + k, '1');
    if (tipSeen) localStorage.setItem('slides_played_totaltip', '1');
  }, tipSeen);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  return { ctx, p, errs };
}

// ---------------------------------------------------------------------------
// ① 《步步为营》：天才特供，先兑一张码
// ---------------------------------------------------------------------------
{
  const { ctx, p, errs } = await newPage(390, 844);
  await p.evaluate(async () => {
    const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
    if (r.active) localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  // 主菜单那几张卡要在页面里自己 click()：鱼眼轴上离焦点远的卡坐在视口外。
  const 有卡 = await p.$$eval('.home-icon-btn', (els) => {
    const it = els.find((e) => /步步为营/.test(e.getAttribute('aria-label') || ''));
    if (it) it.click();
    return Boolean(it);
  });
  check('开通了的人在主菜单上找得到《步步为营》（尺子）', 有卡);
  await p.waitForSelector('.slot-pick-opt[data-family="square"]', { timeout: 15000 });
  await p.$eval('.slot-pick-opt[data-family="square"]', (e) => e.click());
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  const 开了 = await p
    .waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('《步步为营》真的发出了一副牌', 开了);
  const st = await p.evaluate(() => ({
    枚数: document.querySelectorAll('#boardWrap .tile').length,
    余步: document.querySelector('#hud-time')?.textContent ?? null,
    有卷轴: !!document.querySelector('#scoreReel'),
    卷轴看得见: (() => { const e = document.querySelector('#scoreReel'); return !!e && !e.hasAttribute('hidden'); })(),
  }));
  check('棋盘 36 枚', st.枚数 === 36, String(st.枚数));
  check('左上那一块印的是余步（8），不是分数', st.余步 === '8', String(st.余步));
  // 这一条是修法本身的尺子：`#scoreReel` 必须**在**（req 取得到），但**看不见**
  // （这一档那一格印的是余步）。少了前半条就是从前那个崩；少了后半条就是屏幕上
  // 多出一个一直在涨的数，而玩家会把它当成这一局的回报。
  check('卷轴在、但藏着（req 取得到，玩家看不见）', st.有卷轴 && !st.卷轴看得见,
    JSON.stringify([st.有卷轴, st.卷轴看得见]));
  check('一路没有页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ② 结算页：三档矮屏上那三颗键够得着
// ---------------------------------------------------------------------------
for (const [w, h] of [[320, 568], [360, 640], [375, 667], [390, 844]]) {
  const { ctx, p } = await newPage(w, h);
  await p.$$eval('.home-icon-btn', (els) => {
    const it = els.find((e) => (e.getAttribute('aria-label') || '') === '方块');
    (it || els[0]).click();
  });
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 20000 });
  await p.waitForTimeout(400);
  await p.click('#stopBtn');
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.click('#pauseFinishBtn');
  await p.waitForSelector('#endOverlay.show', { timeout: 8000 });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const m = document.querySelector('#endOverlay .modal');
    const row = document.querySelector('#endOverlay .btn-row');
    const btns = [...(row?.querySelectorAll('button') ?? [])];
    const rr = row.getBoundingClientRect();
    return {
      overflowY: getComputedStyle(m).overflowY,
      有超出: m.scrollHeight > m.clientHeight + 1,
      键底距屏底: Math.round(innerHeight - rr.bottom),
      颗数: btns.length,
    };
  });
  check(`${w}×${h}：结算页那一排有三颗键（尺子）`, r.颗数 === 3, String(r.颗数));
  // 够得着 = 要么本来就在屏内，要么浏览器真的让手指滚得到。
  const 够得着 = r.键底距屏底 >= 0 || (['auto', 'scroll'].includes(r.overflowY) && r.有超出);
  check(`${w}×${h}：《主页 / 分享 / 再来》够得着`, 够得着,
    `键底距屏底 ${r.键底距屏底}px，overflow-y: ${r.overflowY}，有超出 ${r.有超出}`);
  if (r.键底距屏底 < 0) {
    check(`${w}×${h}：够不着的那一档，弹窗的 overflow-y 必须是 auto/scroll`,
      ['auto', 'scroll'].includes(r.overflowY), r.overflowY);
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ③ 战绩图够大（E28），而且**没把横屏那一档压坏**
//
// E28 那一版是三条 CSS 一起：弹窗放宽到 460、图突破 24px 的左右内边距、高度上限改成自限公式。
// 10-08 方案 3-I 照玩家的设计图重排之后，那三条换成了设计图的尺寸：窗 334×695、卡 279 宽、左右
// 各留 27.5、在窗里居中（门 check-end-design 逐块量着）。所以这一节量的改成：
//   · 那张图照旧 ≥ 屏高的 40%（手机）/ 42%（电脑）——E28 那两条底线照旧。量的是平常那一页（「综
//     合分是怎么来的」那句头一局才讲，这儿预设它讲过了）；电脑上那一窗是设计图的 695 高，不跟着屏
//     幕长，378 高的卡正好过 42%；
//   · 图在窗里居中，宽不超过窗宽减去左右各 27.5（设计图那张 279 宽的卡）。
// 横屏那一档另一条：窗还是宽的两栏（图在右边吃满高），不是被竖屏那一档压窄。
// ---------------------------------------------------------------------------
for (const [w, h, 下限] of [[390, 844, 40], [1440, 900, 42]]) {
  const { ctx, p } = await newPage(w, h, true);
  await p.$$eval('.home-icon-btn', (els) => {
    const it = els.find((e) => (e.getAttribute('aria-label') || '') === '方块');
    (it || els[0]).click();
  });
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 20000 });
  await p.waitForTimeout(400);
  await p.click('#stopBtn');
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.click('#pauseFinishBtn');
  await p.waitForSelector('#endOverlay.show', { timeout: 8000 });
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const img = document.querySelector('#endShareImg');
    const m = document.querySelector('#endOverlay .modal');
    const rr = img?.getBoundingClientRect();
    return {
      有图: !!rr && rr.height > 0,
      占屏: rr ? +((rr.height / innerHeight) * 100).toFixed(1) : 0,
      图宽: rr ? +rr.width.toFixed(1) : 0,
      图高: rr ? Math.round(rr.height) : 0,
      窗宽: +m.getBoundingClientRect().width.toFixed(1),
      偏中: rr ? +Math.abs(rr.left + rr.width / 2 - (m.getBoundingClientRect().left + m.getBoundingClientRect().width / 2)).toFixed(1) : 99,
    };
  });
  check(`${w}×${h}：战绩图画出来了（尺子）`, r.有图, JSON.stringify(r));
  check(`${w}×${h}：战绩图占屏高 ≥ ${下限}%（E28 之前是 33–41%）`, r.占屏 >= 下限, `${r.占屏}%`);
  // 图是 279:378 的竖卡，在中间那一块里按比例缩：被宽卡住时宽 = 窗宽 − 55，被高卡住时更窄。
  check(`${w}×${h}：图在窗里居中，宽不超过窗宽减去左右各 27.5（设计图那张 279 宽的卡）`,
    r.偏中 <= 1 && r.图宽 <= r.窗宽 - 55 + 0.5, `图宽 ${r.图宽} / 窗宽 ${r.窗宽}，偏中 ${r.偏中}`);
  await ctx.close();
}
{
  // 横屏那一档：弹窗必须还是 680，不是被 460 压过去。
  const { ctx, p } = await newPage(844, 390);
  await p.$$eval('.home-icon-btn', (els) => {
    const it = els.find((e) => (e.getAttribute('aria-label') || '') === '方块');
    (it || els[0]).click();
  });
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 20000 });
  await p.waitForTimeout(400);
  await p.click('#stopBtn');
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.click('#pauseFinishBtn');
  await p.waitForSelector('#endOverlay.show', { timeout: 8000 });
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const img = document.querySelector('#endShareImg');
    const m = document.querySelector('#endOverlay .modal');
    const rr = img?.getBoundingClientRect();
    return { 窗宽: Math.round(m.getBoundingClientRect().width), 占屏: rr ? +((rr.height / innerHeight) * 100).toFixed(1) : 0 };
  });
  check('844×390 横屏：弹窗还是宽的两栏（没被竖屏那一档的 334 压窄）', r.窗宽 >= 600, `${r.窗宽}px`);
  check('844×390 横屏：图没有变小（E28 之前是 38%）', r.占屏 >= 35, `${r.占屏}%`);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ④ 横屏三档：那张战绩图整块都在弹窗里，一点都没被裁掉
//
// 横屏的战绩图是**绝对定位**在窗子右半边的（`.overlay--end .end-share`），而
// `#endOverlay .modal` 两个轴都是 `overflow: hidden`——溢出去的部分不是「滚得到」，
// 是**看不见**。
//
// 原先那一版用 `top: 50%` ＋ `translateY(-50%)` 居中，高度由里头的东西自己撑。
//
// ⚠️ **真出事的是小红书那一端，不是网页端。** 那一版图底下不是一行「长按或右键保存」，
// 而是两颗键加一句说明（高出七十来像素，见 xhs/src/pages.css）——844×390 上量出来整块
// 354 高，而这一窗只有 315：上下各顶出 38px，于是图的顶上被切掉一截、那两颗键整条不见。
// 网页端那一行字只有二十来像素，恰好塞得下，所以**这几条在网页端从一开始就是绿的**：
// 它们守的是「别哪天在这边也裁起来」，而那次真事是 xhs/check-oldcss 的「`.end-share`
// 整个在弹窗里面」逮到的（修之前量出来「出界 上38 下38」）。写明白，免得下一个人以为
// 这一节是那次的现场。
//
// 三档都是真机上常见的横屏尺寸（844×390 是 iPhone 14/15 横过来，740×360 是常见安卓，
// 667×375 是 iPhone SE/8）。量的是**整块**（`.end-share`，不只是那张图）：被裁掉的恰恰
// 是图以外的那几样。
// ---------------------------------------------------------------------------
for (const [w, h] of [[844, 390], [740, 360], [667, 375]]) {
  const { ctx, p } = await newPage(w, h);
  await p.$$eval('.home-icon-btn', (els) => {
    const it = els.find((e) => (e.getAttribute('aria-label') || '') === '方块');
    (it || els[0]).click();
  });
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 20000 });
  await p.waitForTimeout(400);
  await p.click('#stopBtn');
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.click('#pauseFinishBtn');
  await p.waitForSelector('#endOverlay.show', { timeout: 8000 });
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const m = document.querySelector('#endOverlay .modal');
    const share = document.querySelector('#endOverlay .end-share');
    const img = document.querySelector('#endShareImg');
    if (!m || !share) return null;
    const mb = m.getBoundingClientRect();
    const sb = share.getBoundingClientRect();
    const ib = img && img.getBoundingClientRect();
    const out = (b) => ({
      上: Math.round(mb.top - b.top),
      下: Math.round(b.bottom - mb.bottom),
      左: Math.round(mb.left - b.left),
      右: Math.round(b.right - mb.right),
    });
    return {
      卡: out(sb),
      图: ib ? out(ib) : null,
      图大小: ib ? [Math.round(ib.width), Math.round(ib.height)] : null,
      有图: Boolean(img && img.getAttribute('src')),
      窗高: Math.round(mb.height),
    };
  });
  check(`${w}×${h} 横屏：战绩图真的画出来了（尺子）`, Boolean(r && r.有图 && r.图大小[1] > 0),
    r ? JSON.stringify(r.图大小) : '(没有弹窗)');
  const 最多出 = r ? Math.max(r.卡.上, r.卡.下, r.卡.左, r.卡.右) : 999;
  check(`${w}×${h} 横屏：那一整块都在弹窗里（没有被裁）`, 最多出 <= 1,
    r ? `出界 上${r.卡.上} 下${r.卡.下} 左${r.卡.左} 右${r.卡.右}（窗高 ${r.窗高}）` : '');
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
