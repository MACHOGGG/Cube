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
    // 通关那枚章也摆上：它现在自己一行、72px（E21），量的就是「多了这 72px 之后这一窗
    // 还装不装得下」。只有「全部翻成点面」那一种终局才有它，而那一种正是这一窗最挤的时
    // 候——不摆上去，下面那几条量的是较松的那一版。
    document.getElementById('endStamp').innerHTML =
      '<svg viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle class="end-stamp-ring" cx="20" cy="20" r="17" fill="none" stroke="#5C8A72" stroke-width="3"/>' +
      '<path class="end-stamp-tick" d="M12 20.5 L17.5 26 L28 14" fill="none" stroke="#5C8A72"' +
      ' stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    document.getElementById('endStamp').classList.add('end-stamp--drawn');
    document.getElementById('endAvg').textContent = '这个玩法你平均 940 分';
    document.getElementById('endBreakdown').innerHTML =
      '<div class="end-row"><span>基础得分</span><span>612</span></div>' +
      '<div class="end-row"><span>时间系数</span><span>×1.32</span></div>' +
      '<div class="end-row"><span>有效得分率</span><span>+59%</span></div>';
    // 战绩图现在就摆在结算页上（玩家定的「整合分享和结算」），它是这一窗里
    // 最高的一块——不摆上去，下面那三条「按得到吗」量的就不是真的排版。
    // 720×940，和真图同比例。
    const c = document.createElement('canvas');
    c.width = 720; c.height = 940;
    const g = c.getContext('2d');
    g.fillStyle = '#3D3128';
    g.fillRect(0, 0, 720, 940);
    document.getElementById('endShare').removeAttribute('hidden');
    document.getElementById('endShareImg').src = c.toDataURL();
  });
  await page.waitForTimeout(600);
  const end = await page.evaluate(() => {
    const ov = document.getElementById('endOverlay');
    const m = ov.querySelector('.modal').getBoundingClientRect();
    return { over: Math.round(Math.max(-m.top, m.bottom - innerHeight)), scroll: ov.scrollHeight > ov.clientHeight + 1 };
  });
  check(`${tag} · 结算页：整窗装得进屏幕`, end.over <= 0, `超出 ${end.over}px`);
  /*
   * **「不用下滑」那一条翻了面**（E21 / PR-16）。
   *
   * 这一页从前是整窗一起滚，所以那时要守的是「别滚起来」——滚起来底下那排键就被推进滚动
   * 区的最下面，而玩家报的正是「结算弹窗下方的退出按钮甚至划不到」。
   *
   * 现在窗分三段：头部固定、中间 `.end-scroll` 滚、底排键钉在窗底。所以**中间那一段就是
   * 该滚的**（摆上一张 720×940 的战绩图之后必然滚），而要守的三件事换成：
   *   · 整窗不滚（外层 overflow: hidden，滚的是里面那一段）；
   *   · 头部不随着滚走（滚到底，总分还在原处）；
   *   · 底排键一直在屏幕里、而且点得着（下面那一组 REACH）。
   */
  const three = await page.evaluate(async () => {
    const m = document.querySelector('#endOverlay .modal');
    const sc = m.querySelector('.end-scroll');
    /*
     * **先往明细里塞到一定会溢出，再滚。**
     *
     * 第一版直接滚、直接量「滚得动吗」，于是横屏那一档红了：那一档的明细本来就短
     * （六行），滚动段装得下，`scrollTop` 自然是 0——红的是尺子不是代码。而「装得下就不
     * 滚」恰恰是对的。
     *
     * 要量的是「长到装不下的时候，滚的是中间那一段，而不是整窗」。所以先把它撑长：这样两
     * 档屏幕上这条断言都量得出东西，也不会在哪天明细变短时变成空绿。
     */
    const bd = document.getElementById('endBreakdown');
    const keep = bd.innerHTML;
    bd.innerHTML = keep + Array.from({ length: 30 },
      (_, i) => `<div class="end-row"><span>撑长 ${i}</span><span>${i}</span></div>`).join('');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const scoreBefore = document.getElementById('endScore').getBoundingClientRect().top;
    const btnBefore = m.querySelector('.btn-row').getBoundingClientRect().top;
    const modalBefore = m.getBoundingClientRect();
    sc.scrollTop = sc.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = {
      modalScrolls: m.scrollHeight > m.clientHeight + 1,
      innerScrolls: sc.scrollHeight > sc.clientHeight + 1,
      scrolledBy: Math.round(sc.scrollTop),
      scoreMoved: Math.round(Math.abs(document.getElementById('endScore').getBoundingClientRect().top - scoreBefore)),
      btnMoved: Math.round(Math.abs(m.querySelector('.btn-row').getBoundingClientRect().top - btnBefore)),
      // 撑长 30 行之后整窗还在屏幕里吗（底排键是不是又被顶出去了）。
      modalOver: Math.round(Math.max(-modalBefore.top, modalBefore.bottom - innerHeight)),
      btnBottomOver: Math.round(m.querySelector('.btn-row').getBoundingClientRect().bottom - innerHeight),
    };
    bd.innerHTML = keep;
    return out;
  });
  check(`${tag} · 结算页：明细撑长 30 行，中间那一段真的滚得动（尺子）`,
    three.innerScrolls && three.scrolledBy > 10, JSON.stringify(three));
  check(`${tag} · 结算页：整窗自己不滚（滚的是中间那一段）`, !three.modalScrolls, JSON.stringify(three));
  check(`${tag} · 结算页：滚到底，总分还钉在原处`, three.scoreMoved <= 1, `挪了 ${three.scoreMoved}px`);
  check(`${tag} · 结算页：滚到底，那排键也还钉在原处`, three.btnMoved <= 1, `挪了 ${three.btnMoved}px`);
  check(`${tag} · 结算页：明细再长，整窗也不长出屏幕`, three.modalOver <= 0, `超出 ${three.modalOver}px`);
  check(`${tag} · 结算页：明细再长，那排键也还在屏幕里`, three.btnBottomOver <= 0, `超出 ${three.btnBottomOver}px`);

  /*
   * 那枚通关章：**自己一行、居中、72px**（E21）。
   *
   * 这三条原先是反过来的（「和总分同一行」「没把行顶高」「比总分矮」）——那是 34px 挤在分
   * 数旁边那一版。一局真通关是这一页上最该被看见的那件事，而 34px 的勾在 2.4rem 的数字旁
   * 边像个标点。
   */
  const stamp = await page.evaluate(() => {
    const st = document.getElementById('endStamp')?.getBoundingClientRect();
    const sc = document.getElementById('endScore')?.getBoundingClientRect();
    const head = document.querySelector('#endOverlay .end-head')?.getBoundingClientRect();
    if (!st || !sc || !head) return null;
    return {
      w: Math.round(st.width), h: Math.round(st.height),
      belowScore: st.top >= sc.bottom - 1,
      // 居中：章的中线和头部的中线对齐。
      offCenter: Math.round(Math.abs(st.left + st.width / 2 - (head.left + head.width / 2))),
      inHead: st.top >= head.top - 1 && st.bottom <= head.bottom + 1,
    };
  });
  check(`${tag} · 结算页：章放大到 72px`, stamp && stamp.w === 72 && stamp.h === 72, JSON.stringify(stamp));
  check(`${tag} · 结算页：章自己一行，排在总分下面`, stamp && stamp.belowScore, JSON.stringify(stamp));
  check(`${tag} · 结算页：章居中（偏离中线 ≤ 1px）`, stamp && stamp.offCenter <= 1, JSON.stringify(stamp));
  check(`${tag} · 结算页：章在固定头部里（滚不走）`, stamp && stamp.inHead, JSON.stringify(stamp));

  const endBtns = await page.evaluate(REACH, ['endBackBtn', 'shareBtn', 'restartBtn']);
  for (const [id, state] of Object.entries(endBtns)) {
    check(`${tag} · 结算页：《${id}》按得到`, state === 'ok', state);
  }

  // ---- 分享窗 -----------------------------------------------------------
  await page.evaluate(() => {
    document.getElementById('endOverlay').classList.remove('show');
    // 上面结算页那张占位图，放大看的这一窗用同一张。
    document.getElementById('shareImage').src = document.getElementById('endShareImg').src;
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
