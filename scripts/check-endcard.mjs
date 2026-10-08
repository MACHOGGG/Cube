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
    // 通关那枚章也摆上（10-08 方案 3-I：88px，在分数底下、明细左边——抬头换成两列的那种排法）。只有
    // 「全部翻成点面」那一种终局才有它，而那一种正是这一窗最挤的时候——不摆上去，下面那几条量的是较
    // 松的那一版。
    ov.classList.add('end--stamp');
    document.getElementById('endStamp').innerHTML =
      '<svg viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle class="end-stamp-ring" cx="20" cy="20" r="17" fill="none" stroke="var(--end-ok)" stroke-width="5.9"/>' +
      '<path class="end-stamp-tick" d="M11.3 18.2 L16.6 25.6 L28.6 12.6" fill="none" stroke="var(--end-ok)"' +
      ' stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    document.getElementById('endStamp').classList.add('end-stamp--drawn');
    document.getElementById('endBadges').innerHTML = '<span class="end-badge">清盘</span><span class="end-badge">解锁 1 枚</span>';
    document.getElementById('endBreakdown').innerHTML =
      '<div class="end-row"><span>翻面 28 枚 ×2</span><span>56</span></div>' +
      '<div class="end-row end-row--sum"><span>拼出分</span><span>612</span></div>' +
      '<div class="end-row end-row--sum end-row--total"><span>综合分</span><span>1286</span></div>' +
      // 「该玩法您的均分」3-I 起是明细的最后一行（从前是分数底下单独一行 #endAvg）。
      '<div class="end-row end-row--avg"><span>该玩法您的均分 = 940</span></div>';
    // 战绩图现在就摆在结算页上（玩家定的「整合分享和结算」），它是这一窗里最高的一块——不摆上去，
    // 下面那几条「按得到吗」量的就不是真的排版。720×976，和真图（3-I 起的单人卡）同比例。
    const c = document.createElement('canvas');
    c.width = 720; c.height = 976;
    const g = c.getContext('2d');
    g.fillStyle = '#3D3128';
    g.fillRect(0, 0, 720, 976);
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
   * **「不用下滑」那一条又翻了一次面**（10-08 方案 3-I）。
   *
   * 最早整窗一起滚，要守的是「别滚起来」——滚起来底下那排键就被推进滚动区的最下面（玩家报的「结算
   * 弹窗下方的退出按钮甚至划不到」）。E21 起窗分三段：头部固定、中间 `.end-scroll` 滚、底排键钉在
   * 窗底。3-I 起照设计图什么都不滑（玩家拍板：「横线下方……overflow:hidden + touch-action:none，禁上
   * 下左右滑；内容压进固定高度」）：中间那一块是那张图，它自己缩；明细进了抬头。
   *
   * 所以这儿守的是：整窗和中间那一块都不滑（overflow hidden、手指拖不动）；明细就算长到离谱（塞 30
   * 行），整窗也不长、那排键不挪、还在屏幕里——挤掉的是明细自己的尾巴（抬头被压、多出来的裁掉）。
   *
   * 不用 JS 设 scrollTop 去量「滚不滚得动」：overflow hidden 的盒子脚本照样滚得动，那是空绿。
   */
  const three = await page.evaluate(async () => {
    const m = document.querySelector('#endOverlay .modal');
    const body = m.querySelector('.end-body');
    const bd = document.getElementById('endBreakdown');
    const keep = bd.innerHTML;
    const cs = (e) => getComputedStyle(e);
    const still = {
      modal: [cs(m).overflowY, cs(m).touchAction].join(' '),
      body: body ? [cs(body).overflowY, cs(body).touchAction].join(' ') : '没有 .end-body',
    };
    const btnBefore = m.querySelector('.end-actions').getBoundingClientRect().top;
    const modalBefore = m.getBoundingClientRect();
    bd.innerHTML = keep + Array.from({ length: 30 },
      (_, i) => `<div class="end-row"><span>撑长 ${i}</span><span>${i}</span></div>`).join('');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const mAfter = m.getBoundingClientRect();
    const btns = m.querySelector('.end-actions').getBoundingClientRect();
    const out = {
      still,
      modalGrew: Math.round(mAfter.height - modalBefore.height),
      btnMoved: Math.round(Math.abs(btns.top - btnBefore)),
      btnBottomOver: Math.round(btns.bottom - Math.min(innerHeight, mAfter.bottom)),
      modalOver: Math.round(Math.max(-mAfter.top, mAfter.bottom - innerHeight)),
    };
    bd.innerHTML = keep;
    return out;
  });
  check(`${tag} · 结算页：整窗和中间那一块都不滑（overflow hidden、touch-action none）`,
    three.still.modal === 'hidden none' && three.still.body === 'hidden none', JSON.stringify(three.still));
  check(`${tag} · 结算页：明细撑长 30 行，整窗也不长`, three.modalGrew <= 0 && three.modalOver <= 0, JSON.stringify(three));
  check(`${tag} · 结算页：明细撑长 30 行，那排键不挪、还在窗里`, three.btnMoved <= 1 && three.btnBottomOver <= 0, JSON.stringify(three));

  /*
   * 那枚通关章：88px（设计图），在分数底下、明细左边，在抬头里。
   *
   * E21 那一版是「自己一行、居中、72px」——那三条随 3-I 换成了设计图的摆法。
   */
  const stamp = await page.evaluate(() => {
    const st = document.getElementById('endStamp')?.getBoundingClientRect();
    const sc = document.getElementById('endScore')?.getBoundingClientRect();
    const bd = document.getElementById('endBreakdown')?.getBoundingClientRect();
    const head = document.querySelector('#endOverlay .end-head')?.getBoundingClientRect();
    if (!st || !sc || !head || !bd) return null;
    return {
      w: Math.round(st.width), h: Math.round(st.height),
      belowScore: st.top >= sc.bottom - 1,
      leftOfRows: st.right <= bd.left + 0.5,
      inHead: st.top >= head.top - 1 && st.bottom <= head.bottom + 1,
    };
  });
  check(`${tag} · 结算页：章 88px（设计图）`, stamp && stamp.w === 88 && stamp.h === 88, JSON.stringify(stamp));
  check(`${tag} · 结算页：章在分数底下、明细左边`, stamp && stamp.belowScore && stamp.leftOfRows, JSON.stringify(stamp));
  check(`${tag} · 结算页：章在抬头里`, stamp && stamp.inHead, JSON.stringify(stamp));

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
