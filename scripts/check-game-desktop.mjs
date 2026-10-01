/**
 * 电脑端游戏页的五块牌：各在哪儿、多大、什么色（玩家 2026-10 那张效果图）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8941 dist
 *   node scripts/check-game-desktop.mjs http://localhost:8941/
 *
 * 稿上是一张 1500×974 的横屏：
 *
 *     左 分数（竖牌）┆ 上 得分图案 ┆ 中 棋盘 ┆ 下 暂停 ┆ 右 教学
 *
 * 玩家的原话：「板块大小比例参考，位置左右上下居中（除了游戏主板块）其他的基本完全参
 * 考设计图色号关系比例」。
 *
 * ── 这道门盯的是三类「不报错的走样」 ──────────────────────
 *
 * ① **位置**。五块牌全靠一张栅格摆着，而栅格最爱做的一件事就是**把没安排的东西塞进第
 *    一个空格子**——计时那颗药丸从前正是这么跑到左上角去的（量出来 14, 96），而 PR-7
 *    说的是「暂停药丸正上方」。这种错不崩、不报错，只是摆错了地方。
 * ② **居中**。「上下居中」是这一轮的原话，而它很容易被一条不对称的留白悄悄破坏（内容
 *    盒上下不一样厚的时候，`align-self: center` 算出来就不是屏幕正中）。所以这儿量的
 *    是**到屏幕中线的距离**，不是「有没有写 center」。
 * ③ **色**。六个色号是从稿上取样来的，这道门自己抄一份（不从 CSS 变量读——那只能证明
 *    「大家用的是同一个变量」，证明不了「那个变量是稿上那个色」）。
 *
 * ── 还有一条反面尺子：手机端一个像素都不许跟着变 ────────────
 *
 * 玩家要改的是**电脑网页端**。所以最后一节在 390×844 上再跑一遍，要求那儿**不是**这一
 * 套：底色还是米白、分数牌还是那条矮的。少了这一条，把整站配色改掉也照样绿。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) { console.log('用法：node scripts/check-game-desktop.mjs http://localhost:8941/'); process.exit(2); }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
/** 稿上取样出来的六个色号（见文件头）。这道门自己抄一份。 */
const C = {
  背景: 'rgb(247, 223, 176)',
  牌面: 'rgb(221, 147, 0)',
  棋盘: 'rgb(128, 99, 82)',
  牌面字: 'rgb(255, 255, 255)',
  图案块: 'rgb(68, 97, 184)',
  图案块描边: 'rgb(255, 255, 255)',
  虚线: 'rgb(46, 36, 48)',
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

/**
 * 开一局。`新人: true` 的那一路**什么键都不预设**。
 *
 * ⚠️ 这儿有一个坑，真坑过人：预设 `slides_tutorial_seen` 会把这台浏览器变成「老玩
 * 家」，头一局那块教学条于是整个不出现。它不是 bug——`engine/firstPlay.ts` 的
 * `firstTimeIn` 先问 `playedBefore`，而方块/小球那两条认的正是这把**旧钥匙**（那段分
 * 镜动画从前是进这个玩法的必经之路，看过就等于打开过）。预设它本来是为了跳过分镜，
 * 可分镜从 2026-09 起本来就不自动弹了（见 main.ts 的 showGame），所以这个预设如今
 * 只剩副作用：它悄悄关掉了被测的那样东西，而屏幕上什么都不报。
 */
async function open(w, h, pick, 新人 = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([新人]) => {
    if (!新人) {
      for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    }
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
  }, [新人]);
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  await pick(p);
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 20000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 25000 });
  await p.waitForTimeout(700);
  return { ctx, p };
}
/** 主菜单那几张卡要在页面里自己 click()：鱼眼轴上离焦点远的卡坐在视口外，page.click 滚不进去。 */
const tapSquare = (p) => p.$$eval('.home-icon-btn', (els) => {
  const it = els.find((e) => (e.getAttribute('aria-label') || '') === '方块');
  (it || els[0]).click();
});

const SNAP = () => {
  const box = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), bottom: Math.round(r.bottom) };
  };
  const cs = (s, prop) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[prop] : null; };
  const svg = document.querySelector('.hud-block--pattern .pat-icon > svg');
  return {
    vw: innerWidth, vh: innerHeight,
    score: box('.hud-block--score'), pattern: box('.hud-block--pattern'),
    board: box('#boardWrap'), stop: box('#stopBtn'), coach: box('#coachBar'), pill: box('#timerPill'),
    色: {
      背景: cs('.app--game', 'backgroundColor'),
      牌面: cs('.hud-block--score', 'backgroundColor'),
      棋盘: cs('#boardWrap', 'backgroundColor'),
      牌面字: cs('.hud-block--score', 'color'),
      图案块: svg ? getComputedStyle(svg).fill : null,
      图案块描边: svg ? getComputedStyle(svg).stroke : null,
      虚线: cs('.hud-block--pattern .pat-ring-lit', 'color'),
    },
    // 有没有谁探出这一屏
    溢出: [...document.querySelectorAll('.app--game > *, .app--game > .hud > *')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.bottom > innerHeight + 1 || r.top < -1); })
      .map((e) => e.className),
  };
};

// ---------------------------------------------------------------------------
// ① 1500×970：五块牌的位置、大小、色
// ---------------------------------------------------------------------------
{
  const { ctx, p } = await open(1500, 970, tapSquare);
  const s = await p.evaluate(SNAP);
  check('五块里的四块都在（分数 / 得分图案 / 棋盘 / 暂停）',
    !!(s.score && s.pattern && s.board && s.stop), JSON.stringify({ score: !!s.score, pattern: !!s.pattern, board: !!s.board, stop: !!s.stop }));

  // —— 位置：左右 ——
  check('得分图案横向居中', near(s.pattern.cx, s.vw / 2, 2), `${s.pattern.cx} / ${s.vw / 2}`);
  check('棋盘横向居中', near(s.board.cx, s.vw / 2, 2), `${s.board.cx} / ${s.vw / 2}`);
  check('暂停横向居中', near(s.stop.cx, s.vw / 2, 2), `${s.stop.cx} / ${s.vw / 2}`);
  // —— 位置：上下。这一条量到屏幕中线的距离，不是「写没写 center」 ——
  check('分数牌竖直居中在屏幕上（不是在某一行里居中）', near(s.score.cy, s.vh / 2, 3), `${s.score.cy} / ${s.vh / 2}`);
  // —— 次序：图案在棋盘上面，暂停在棋盘下面 ——
  check('得分图案在棋盘**上方**', s.pattern.bottom <= s.board.y, `${s.pattern.bottom} ≤ ${s.board.y}`);
  check('暂停在棋盘**下方**', s.stop.y >= s.board.bottom, `${s.stop.y} ≥ ${s.board.bottom}`);
  check('分数牌在棋盘**左边**', s.score.x + s.score.w <= s.board.x, `${s.score.x + s.score.w} ≤ ${s.board.x}`);

  // —— 大小：稿上的比例 ——
  check('分数牌是竖着的（稿上 194×280）', s.score.w === 194 && s.score.h === 280, `${s.score.w}×${s.score.h}`);
  check('得分图案 246×104（稿上 245×104）', s.pattern.w === 246 && s.pattern.h === 104, `${s.pattern.w}×${s.pattern.h}`);
  check('暂停和得分图案同宽（这一页只有一个牌宽）', s.stop.w === s.pattern.w, `${s.stop.w} / ${s.pattern.w}`);
  check('棋盘是正方的', near(s.board.w, s.board.h, 2), `${s.board.w}×${s.board.h}`);
  check('棋盘约占屏宽四成（稿上 600/1500）', near(s.board.w / s.vw, 0.4, 0.04), (s.board.w / s.vw).toFixed(3));

  // —— 色：稿上取样的那几个 ——
  for (const [k, want] of Object.entries(C)) {
    if (k === '图案块' || k === '图案块描边' || k === '虚线') continue;
    check(`色号 ${k} = ${want}`, s.色[k] === want, String(s.色[k]));
  }
  check('得分图案里的块是《色卡》那个蓝', s.色.图案块 === C.图案块, String(s.色.图案块));
  check('而且**有外边**（白描边，玩家点名要回来的那一样）', s.色.图案块描边 === C.图案块描边, String(s.色.图案块描边));
  check('那圈虚线是深色的（牌面字色改成白之后它不能跟着白）', s.色.虚线 === C.虚线, String(s.色.虚线));
  check('这一屏没有谁探出去', s.溢出.length === 0, s.溢出.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ② 教学那一栏：右边，和左边那张分数牌关于中线对称
//
// 走的是**真·头一回打方块**那条路（`新人: true`，什么键都不预设），不是炸弹那条提示
// 路——头一局那块教学条才是这一栏最容易被弄丢的东西，见 open() 上面那段。
// ---------------------------------------------------------------------------
{
  const { ctx, p } = await open(1500, 970, tapSquare, true);
  await p.waitForTimeout(1200);
  const s = await p.evaluate(SNAP);
  check('真·头一回打方块：右栏那块教学在', !!s.coach, s.coach ? `${s.coach.w}×${s.coach.h}` : '（没有——多半是谁又预设了 slides_tutorial_seen）');
  if (s.coach) {
    check('教学栏竖直居中在屏幕上', near(s.coach.cy, s.vh / 2, 3), `${s.coach.cy} / ${s.vh / 2}`);
    check('教学栏在棋盘**右边**', s.coach.x >= s.board.x + s.board.w, `${s.coach.x} ≥ ${s.board.x + s.board.w}`);
    // 稿上两块宽度不一样（194 对 270），但两块的中心到中线一样远——各自在自己那一栏里居中。
    const 左 = s.vw / 2 - s.score.cx;
    const 右 = s.coach.cx - s.vw / 2;
    check('左右两块关于中线对称（稿上 531 对 535）', near(左, 右, 8), `${左} / ${右}`);
  }
  check('这一屏没有谁探出去', s.溢出.length === 0, s.溢出.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ③ 计时那一档：药丸在暂停**正上方**，不在左上角
// ---------------------------------------------------------------------------
{
  const { ctx, p } = await open(1500, 970, async (p) => {
    await p.$$eval('.home-icon-btn--timed', (els) => els[0]?.click());
    await p.waitForSelector('.timed-page #timedShapes', { timeout: 20000 });
    await p.$eval('#timedShapes .slot-pick-opt[data-family="square"]', (e) => e.click());
  });
  const s = await p.evaluate(SNAP);
  check('计时局有那颗药丸（尺子：没有的话下面两条是空的）', !!s.pill, s.pill ? JSON.stringify([s.pill.x, s.pill.y]) : '（没有）');
  if (s.pill) {
    check('药丸横向居中（从前它被栅格塞到左上角，量出来 x=14）', near(s.pill.cx, s.vw / 2, 3), `${s.pill.cx} / ${s.vw / 2}`);
    check('药丸在暂停**正上方**（PR-7 定的位置）', s.pill.bottom <= s.stop.y && s.pill.y >= s.board.bottom,
      `药丸 ${s.pill.y}–${s.pill.bottom}，棋盘底 ${s.board.bottom}，暂停顶 ${s.stop.y}`);
  }
  check('计时局棋盘照样是正方的（药丸那一行要从高度里让出来）', near(s.board.w, s.board.h, 2), `${s.board.w}×${s.board.h}`);
  check('这一屏没有谁探出去', s.溢出.length === 0, s.溢出.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ④ 最矮的那一档电脑屏：不许有人探出去
// ---------------------------------------------------------------------------
{
  const { ctx, p } = await open(1000, 561, tapSquare);
  const s = await p.evaluate(SNAP);
  check('1000×561：没有谁探出这一屏', s.溢出.length === 0, s.溢出.join(' | '));
  check('1000×561：分数牌照样竖直居中', near(s.score.cy, s.vh / 2, 3), `${s.score.cy} / ${s.vh / 2}`);
  check('1000×561：棋盘还画得出来（不是被挤成一条）', s.board.w > 150 && near(s.board.w, s.board.h, 2), `${s.board.w}×${s.board.h}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ⑤ 反面尺子：手机端一个像素都不跟着变
// ---------------------------------------------------------------------------
{
  const { ctx, p } = await open(390, 844, tapSquare);
  const s = await p.evaluate(SNAP);
  check('手机端底色**不是**电脑那一套（玩家这一轮改的是电脑端）', s.色.背景 !== C.背景, String(s.色.背景));
  check('手机端那张分数牌还是矮的（不是 280 高的竖牌）', s.score.h < 120, `${s.score.h}`);
  check('手机端得分图案还在顶排和分数并排（y 一样）', near(s.score.y, s.pattern.y, 3), `${s.score.y} / ${s.pattern.y}`);
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
