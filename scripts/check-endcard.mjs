/**
 * 结算页和分享窗，一屏之内看得完、按得到。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-endcard.mjs http://localhost:8817/
 *
 * 玩家报的：横屏打完一局，结算页要先往下滑一下才按得到《再来》；点开分享
 * 战绩也一样，图一高，《关闭》就顶到屏幕外面去了。
 *
 * 所以这里量两件事，而且都用 elementFromPoint 而不是「DOM 里有没有」——一
 * 颗在屏幕外面的按钮，DOM 里一直都在。
 *   · 那一窗整个装在屏幕里，遮罩不出现滚动条；
 *   · 每一颗键的正中点下去，点到的就是它自己。
 *
 * 这两页真打一局才出得来，太慢也太看运气，所以直接把遮罩摆出来、塞一张同
 * 比例的占位图——量的是排版，不是那一局打了多少分。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const seed = () => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
};

/** 一颗键在不在屏幕里，而且点得到。 */
const REACH = (ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = 'missing'; continue; }
    const r = el.getBoundingClientRect();
    const inView = r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out[id] = inView ? (hit?.closest(`#${id}`) ? 'ok' : `被 ${hit?.id || hit?.tagName} 挡着`) : '在屏幕外';
  }
  return out;
};

for (const [tag, vp] of [['横屏 844×390', { width: 844, height: 390 }], ['竖屏 390×844', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.$$eval('.home-icon-btn', (els) =>
    els.find((e) => e.getAttribute('aria-label') === '方块')?.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 });
  await page.waitForTimeout(900);

  // ---- 结算页 -----------------------------------------------------------
  await page.evaluate(() => {
    const ov = document.getElementById('endOverlay');
    ov.classList.add('show');
    document.getElementById('endScore').textContent = '1,286';
    document.getElementById('endAvg').textContent = '这个玩法你平均 940 分';
    document.getElementById('endBreakdown').innerHTML =
      '<div class="end-row"><span>基础得分</span><span>612</span></div>' +
      '<div class="end-row"><span>时间系数</span><span>×1.32</span></div>' +
      '<div class="end-row"><span>有效得分率</span><span>+59%</span></div>';
  });
  await page.waitForTimeout(600);
  const end = await page.evaluate(() => {
    const ov = document.getElementById('endOverlay');
    const m = ov.querySelector('.modal').getBoundingClientRect();
    return { over: Math.round(Math.max(-m.top, m.bottom - innerHeight)), scroll: ov.scrollHeight > ov.clientHeight + 1 };
  });
  check(`${tag} · 结算页：整窗装得进屏幕`, end.over <= 0, `超出 ${end.over}px`);
  check(`${tag} · 结算页：不用下滑`, !end.scroll);
  const endBtns = await page.evaluate(REACH, ['endBackBtn', 'shareBtn', 'restartBtn']);
  for (const [id, state] of Object.entries(endBtns)) {
    check(`${tag} · 结算页：《${id}》按得到`, state === 'ok', state);
  }

  // ---- 分享窗 -----------------------------------------------------------
  await page.evaluate(() => {
    document.getElementById('endOverlay').classList.remove('show');
    // 战绩图是 720 宽、九百多高的一张。同比例的占位图就够量排版了。
    const c = document.createElement('canvas');
    c.width = 720; c.height = 940;
    const g = c.getContext('2d');
    g.fillStyle = '#3D3128';
    g.fillRect(0, 0, 720, 940);
    document.getElementById('shareImage').src = c.toDataURL();
    document.getElementById('shareOverlay').classList.add('show');
  });
  await page.waitForTimeout(700);
  const share = await page.evaluate(() => {
    const ov = document.getElementById('shareOverlay');
    const m = ov.querySelector('.modal').getBoundingClientRect();
    const img = document.getElementById('shareImage').getBoundingClientRect();
    const btn = document.getElementById('shareCloseBtn').getBoundingClientRect();
    return {
      over: Math.round(Math.max(-m.top, m.bottom - innerHeight)),
      scroll: ov.scrollHeight > ov.clientHeight + 1,
      beside: btn.left >= img.right - 0.5,
      imgH: Math.round(img.height),
    };
  });
  check(`${tag} · 分享窗：整窗装得进屏幕`, share.over <= 0, `超出 ${share.over}px`);
  check(`${tag} · 分享窗：不用下滑`, !share.scroll);
  const shareBtn = await page.evaluate(REACH, ['shareCloseBtn']);
  check(`${tag} · 分享窗：《关闭》按得到`, shareBtn.shareCloseBtn === 'ok', shareBtn.shareCloseBtn);
  if (tag.startsWith('横屏')) {
    check(`${tag} · 分享窗：《关闭》在图的侧边`, share.beside, share.beside ? '' : '还在图底下');
    // 挪到侧边的意义就在这儿：图能吃满这一屏的高度，而不是为了给键让位缩小。
    check(`${tag} · 分享窗：图撑得起来`, share.imgH >= 300, `图高 ${share.imgH}px`);
  }
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
