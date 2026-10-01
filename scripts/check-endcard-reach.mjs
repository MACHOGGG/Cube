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

async function newPage(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['square', 'circle', 'bomb', 'slot', 'flip', 'timed', 'layout', 'endcard']) localStorage.setItem('slides_played_' + k, '1');
  });
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

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);
