/**
 * 屋号那四格：打进去、打错了、打对了，三件事在屏幕上各有各的样子（E19 / PR-19）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8991 dist      （内存版，TESTMONTH 只能兑一次）
 *   node scripts/check-room-code.mjs http://localhost:8991/
 *
 * 四位打满是**直接进屋**的，没有《加入》那颗键（玩家 2026-09）。少了那颗键，「我按下
 * 去了」这一下的回执就只能长在这四格上：
 *
 *   · 还没填的格子底下一道横线——不然四根实心蓝长条上只剩「数字在不在」，还剩几位要
 *     数着看；
 *   · 当前那一格一根闪烁的光标条——告诉他下一下落在哪儿；
 *   · 打错了：抖一下 ＋ 每格一圈红 ＋ 清空回第一格；
 *   · 打对了：每格一圈绿逐格画过去，**画完才换页**。
 *
 * 最后那一条是这道门最要紧的一条，因为它最容易写成「写了等于没写」：进屋那一下是
 * `container.innerHTML = …`，整排格子连着被换掉。绿框如果不 await，它和换页在**同一
 * 拍**里发生，一帧都画不出来——代码里明明有、屏幕上永远看不见，而且不报任何错。所以
 * 这儿是在换页**之前**截一帧来量。
 *
 * ── 每一条都带反面尺子 ────────────────────────────────────
 *
 * 「有横线」要配「填上了就没横线」，「有光标」要配「不是当前那格没有、整排没焦点也没
 * 有」，不然量到的是一个恒真的东西。级联那一条量的是**四个不同的延迟**（0/45/90/135），
 * 只量「有类名」的话四圈一起亮也照样绿，而那正是要区分的两种样子。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) { console.log('用法：node scripts/check-room-code.mjs http://localhost:8991/'); process.exit(2); }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function newPlayer(reduce = false) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}

/** 到「开小屋 / 输屋号」那一屏。 */
async function toJoinScreen(page) {
  await page.click('#navProfile');
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate', { timeout: 15000 });
}

/** 四格此刻的样子。伪元素只能问 getComputedStyle，问不到 getBoundingClientRect。 */
const snap = (page) =>
  page.$eval('.mp-code-field', (box) => {
    const cells = [...box.querySelectorAll('.pin-cell')];
    const row = box.querySelector('.pin-row');
    const pseudo = (el, which) => {
      const cs = getComputedStyle(el, which);
      return {
        content: cs.content,
        h: cs.height,
        w: cs.width,
        anim: cs.animationName,
        opacity: cs.opacity,
      };
    };
    return {
      inputs: box.querySelectorAll('input').length,
      n: cells.length,
      rowOn: !!row?.classList.contains('pin-row--on'),
      rowBad: !!row?.classList.contains('pin-row--bad'),
      rowShake: !!row?.classList.contains('err-shake') || !!row?.classList.contains('err-flash'),
      value: box.querySelector('input')?.value ?? '',
      cells: cells.map((c) => ({
        text: c.textContent.trim(),
        glyph: c.querySelector('.pin-glyph')?.textContent ?? null,
        glyphAnim: c.querySelector('.pin-glyph') ? getComputedStyle(c.querySelector('.pin-glyph')).animationName : null,
        on: c.classList.contains('on'),
        at: c.classList.contains('pin-cell--at'),
        pop: c.classList.contains('pin-cell--pop'),
        ok: c.classList.contains('pin-cell--ok'),
        okDelay: c.style.getPropertyValue('--pin-ok-delay').trim(),
        badAnim: getComputedStyle(c).animationName,
        ringOpacity: c.querySelector('.pin-ring') ? getComputedStyle(c.querySelector('.pin-ring')).opacity : null,
        ringOffset: c.querySelector('.pin-ring rect') ? getComputedStyle(c.querySelector('.pin-ring rect')).strokeDashoffset : null,
        under: pseudo(c, '::before'),
        caret: pseudo(c, '::after'),
      })),
    };
  });

// ---------------------------------------------------------------------------
// 屋主开一间，拿到真屋号
// ---------------------------------------------------------------------------
const A = await newPlayer();
await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (r.active) localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
});
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');
await toJoinScreen(A.page);
await A.page.fill('#mpName', '甲');
await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 15000 });
const CODE = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
check('屋主开出了一间屋，屋号是四位数字', /^\d{4}$/.test(CODE), CODE);
/** 一个一定不存在的屋号：真屋号 +1，只有一间屋开着，撞不上。 */
const WRONG = String((Number(CODE) + 1) % 10000).padStart(4, '0');

// ---------------------------------------------------------------------------
// ① 空着的样子：四格一个 input、四道横线、没焦点就没光标
// ---------------------------------------------------------------------------
const B = await newPlayer();
await toJoinScreen(B.page);
await B.page.fill('#mpName', '乙');
const empty = await snap(B.page);
check('四格，而且只有一个真 input（四个各自独立的 input 是这类控件最常出问题的做法）',
  empty.n === 4 && empty.inputs === 1, `${empty.n} 格 / ${empty.inputs} 个 input`);
const under2px = empty.cells.every((c) => c.under.content !== 'none' && c.under.h === '2px');
check('空着的四格底下各有一道 2px 横线', under2px,
  empty.cells.map((c) => `${c.under.content}:${c.under.h}`).join(' '));
check('没焦点的时候一根光标条都不摆（反面尺子：不然「有光标」是恒真的）',
  !empty.rowOn && empty.cells.every((c) => c.caret.content === 'none'),
  `rowOn=${empty.rowOn} ${empty.cells.map((c) => c.caret.content).join(' ')}`);

// ---------------------------------------------------------------------------
// ② 点进来：光标条只在第一格，而且真的在闪
// ---------------------------------------------------------------------------
await B.page.focus('#mpCode');
await B.page.waitForTimeout(120);
const focused = await snap(B.page);
check('点进来之后整排有焦点', focused.rowOn);
check('光标条只摆在当前那一格（第 1 格），别的格子没有',
  focused.cells[0].caret.content !== 'none' && focused.cells.slice(1).every((c) => c.caret.content === 'none'),
  focused.cells.map((c) => c.caret.content).join(' '));
check('光标条在闪（挂着 pin-caret 那条动画，不是画一根死杠）',
  focused.cells[0].caret.anim === 'pin-caret', String(focused.cells[0].caret.anim));

// ---------------------------------------------------------------------------
// ③ 只认数字；填进去的字从下面升上来；横线和光标跟着往后走
// ---------------------------------------------------------------------------
await B.page.type('#mpCode', 'a', { delay: 30 });
await B.page.waitForTimeout(80);
const letter = await snap(B.page);
check('打一个字母：一格都没填上（反面尺子在下一条）', letter.value === '' && !letter.cells[0].on, `值=${letter.value}`);
await B.page.type('#mpCode', '7', { delay: 30 });
await B.page.waitForTimeout(80);
const one = await snap(B.page);
check('打一个数字：落进第一格', one.value === '7' && one.cells[0].on && one.cells[0].glyph === '7',
  `值=${one.value} 第一格=${one.cells[0].glyph}`);
check('那个字是从下面升上来的（pin-rise 挂在字上，不是整根条子在动）',
  one.cells[0].pop && one.cells[0].glyphAnim === 'pin-rise', `pop=${one.cells[0].pop} anim=${one.cells[0].glyphAnim}`);
check('填上的那一格横线收了，没填的三格还在',
  one.cells[0].under.content === 'none' && one.cells.slice(1).every((c) => c.under.content !== 'none'),
  one.cells.map((c) => c.under.content).join(' '));
check('光标条跟着挪到第二格', one.cells[1].caret.content !== 'none' && one.cells[0].caret.content === 'none');

// ---------------------------------------------------------------------------
// ④ 打错了：抖一下 ＋ 每格一圈红 ＋ 清空回第一格
// ---------------------------------------------------------------------------
await B.page.fill('#mpCode', '');
await B.page.type('#mpCode', WRONG, { delay: 40 });
// 抖那一下 520ms，红环 28% 处才亮——太早截会截到还没亮的那一帧。
await B.page.waitForTimeout(260);
const bad = await snap(B.page);
check('打错了：整排抖一下（reduced-motion 下换成 err-flash）', bad.rowShake, `rowBad=${bad.rowBad}`);
check('打错了：每一格各自一圈红（pin-bad），不是整排外头套一圈',
  bad.rowBad && bad.cells.every((c) => c.badAnim === 'pin-bad'),
  bad.cells.map((c) => c.badAnim).join(' '));
await B.page.waitForTimeout(400);
const cleared = await snap(B.page);
check('打错了：清空、回到第一格（他接着重读一遍别人屏幕上那四位）',
  cleared.value === '' && cleared.cells.every((c) => !c.on) && cleared.cells[0].at,
  `值=${cleared.value}`);

// ---------------------------------------------------------------------------
// ⑤ 打对了：四圈绿逐格画过去，**而且是在换页之前**
// ---------------------------------------------------------------------------
check('（尺子）还没打对的时候，四圈绿都是收着的',
  cleared.cells.every((c) => c.ringOpacity === '0'),
  cleared.cells.map((c) => c.ringOpacity).join(' '));
await B.page.type('#mpCode', CODE, { delay: 40 });
// 级联总共约 400ms，进屋在那之后。这儿趁格子还在，截一帧。
//
// **等不到就当场说清楚**，别让 Playwright 抛一个 TimeoutError 了事：等不到的唯一原因
// 就是 `pin.accept()` 没被 await（进屋和绿框在同一拍里发生，格子连着被换掉）。抛栈的
// 话看的人先去查网络、查屋号、查 Playwright，最后才想到那个 await。
const caught = await B.page
  .waitForFunction(() => !!document.querySelector('.mp-code-field .pin-cell--ok'), { timeout: 8000 })
  .then(() => true)
  .catch(() => false);
if (!caught) {
  check('打对了：绿框在换页之前画得出来（多半是 pin.accept() 没被 await）', false,
    (await B.page.$('.mp-code-card')) ? '已经进屋了，格子早没了' : '没进屋也没绿框');
  console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
  await browser.close();
  process.exit(1);
}
const good = await snap(B.page);
check('打对了：四格都挂上了绿框', good.cells.every((c) => c.ok), good.cells.map((c) => c.ok).join(','));
check('四圈是**逐格**画的：延迟 0/45/90/135ms，不是一起亮',
  good.cells.map((c) => c.okDelay).join(',') === '0ms,45ms,90ms,135ms',
  good.cells.map((c) => c.okDelay).join(','));
check('绿框真的露出来了（ring 不再是透明的）',
  good.cells.every((c) => c.ringOpacity === '1'), good.cells.map((c) => c.ringOpacity).join(' '));
// 这一条是「写了等于没写」的看门人：画完才换页，所以截这一帧的时候小屋页还没上来。
check('绿框画完之前还没换页（不 await 的话这四圈一帧都画不出来）',
  !(await B.page.$('.mp-code-card')), '');
await B.page.waitForSelector('.mp-code', { timeout: 15000 });
check('然后才进屋', true);
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 15000 })
  .then(() => check('屋主那台看见两个人了', true))
  .catch(() => check('屋主那台看见两个人了', false));

// ---------------------------------------------------------------------------
// ⑥ reduced-motion：每一样都还在，只是都不带过程
// ---------------------------------------------------------------------------
{
  const C = await newPlayer(true);
  await toJoinScreen(C.page);
  await C.page.focus('#mpCode');
  await C.page.waitForTimeout(120);
  await C.page.type('#mpCode', '5', { delay: 30 });
  await C.page.waitForTimeout(120);
  const r = await snap(C.page);
  check('reduced-motion：数字照样落进格子，只是不升', r.cells[0].glyph === '5' && r.cells[0].glyphAnim === 'none',
    `${r.cells[0].glyph} / ${r.cells[0].glyphAnim}`);
  check('reduced-motion：光标条不闪，但还摆着（它标的是「下一位落在这儿」）',
    r.cells[1].caret.content !== 'none' && r.cells[1].caret.anim === 'none' && r.cells[1].caret.opacity === '1',
    `${r.cells[1].caret.anim} / ${r.cells[1].caret.opacity}`);
  await C.ctx.close();
}

await A.ctx.close();
await B.ctx.close();
await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
