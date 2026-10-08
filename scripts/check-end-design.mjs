/**
 * 结算弹窗照玩家的两张设计图（10-08 方案 3-I）：每一块落在图上那个位置；横线下方不滑；四种语言装得下。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8966 dist
 *   node scripts/check-end-design.mjs http://localhost:8966/
 *
 * 方案原话：「横线下方（得分计算 + 战绩分享）容器 overflow:hidden + touch-action:none，禁上下左右滑；内容
 * 压进固定高度，四语验收放得下」＋「其余设计调整严格按玩家上传的设计图像素对齐」。
 *
 * ── 设计图上量出来的数（402×875 的手机，逐像素扫墨的外框；第一张没有通关勾，第二张有）──────────────
 *
 *   窗        x34–367 y90–784（334×695），圆角 44，白
 *   标题      「综合得分」墨 x107–193 / x68–154，y118–140，黑
 *   分数      墨 x98–196 / x59–157，y153–199，#943D40（Fraunces 400，63px）
 *   徽章      70×28、圆角 8、底 #93E7A3、字 #00AC00（11px 粗）；第一张 x220.5 y174.5，第二张 x180.5 / x275
 *   通关勾    墨 x66–153 y213–301（88 见方，环宽 13），#00AC00
 *   明细      11px、行距 17、#943D40，只有「综合分」那一行粗；抬头左沿 110 / 180，数那一栏 250 / 321，
 *             第一行墨顶 218；第二张最后一行是「该玩法您的均分」（墨顶 302）
 *   卡        279×378、圆角 28、底 #FFEDC8；第二张那张在 y329.5（第一张少一行均分，在 323.5）
 *   卡里      （卡内坐标）Slides 32–119 × 32–62；「圆球」33–75；横杠 72–76；炸弹标志 93–113 × 62–82；
 *             分数 26–124 × 91–138；两块棋盘 4–135.5 / 144.5–276 × 177–309（#EAD3AE，圆角 18）；
 *             全部消完只摆一块 42–238 × 166–362；二维码那一块中心 (222, 70)；说明两行墨顶 114 / 127
 *   三颗键    91×36、相隔 9、y723.5、圆角 15；#C05B5C / #4461B8 / 橙（色卡那支 #F7821B，图上取样 #F27F1C）
 *
 * ── 这道门怎么量 ──────────────────────────────────────────────────────────────────────
 *
 * 那两种结局（真通关盖勾、解锁 1 枚）一局里打不出来，所以 ① ② 先真打一局方块、按《结束游戏》拿到真的
 * 结算弹窗，再按 gameController 拼的那几种结构把设计图上那一局填进去（我们自己的文案）；卡是从成绩页
 * 那条路画的（存档里塞一局「圆球 · 炸弹 · 代号 57GY-N5W8」，和图上那张一样），再挂到弹窗上。然后
 * 402×875、一倍像素截图，按上面那张表逐块扫墨的外框比。容差 3px；分数宽另说（见 ①）。
 *
 * ④ 不填东西：真打一局四种语言，看 gameController 拼出来的结构就是 ① 量的那一种。⑤ 六种屏幕 × 四种
 * 语言（头一局，带「综合分是怎么来的」那一句——最长的那一种）：整窗在屏里、每一块在窗里、谁也不压谁、
 * 什么都没被裁、三颗键的正中点得到。
 *
 * 改坏法：拿 3-I 之前的构建跑，① 头一条就红（窗不是 334×695），② 的卡整张对不上。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8966/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

const SCORING_VER = (readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8').match(/SCORING_RULES_VERSION\s*=\s*'([^']+)'/) || [, ''])[1];
const BOMB_VER = Number((readFileSync(new URL('../src/engine/bomb.ts', import.meta.url), 'utf8').match(/BOMB_RULES_VERSION\s*=\s*(\d+)/) || [, '0'])[1]);
if (!SCORING_VER || !BOMB_VER) {
  console.error('读不出计分 / 炸弹规则的版本号——存档键会落空，先修这儿。');
  process.exit(2);
}

/** 进主菜单之前要有的那几把钥匙：跳过开场、教学、头一回的招待。 */
const SEED = (lang) => {
  localStorage.setItem('slides_lang', lang);
  localStorage.setItem('slides_intro_seen', '1');
  for (const k of ['square', 'circle', 'bomb', 'slot', 'flip', 'timed', 'layout', 'endcard', 'finished']) localStorage.setItem('slides_played_' + k, '1');
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) localStorage.setItem(k, '1');
};

/** 真打一局方块，按《暂停》→《结束游戏》，等结算弹窗出来、分数滚完。 */
async function endARun(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 30000 });
  // 主菜单那几张卡要在页面里自己 click()：鱼眼轴上离焦点远的卡坐在视口外。
  await page.$$eval('.home-icon-btn', (els) =>
    (els.find((e) => /^(方块|方塊|Squares?|Carrés?)$/i.test(e.getAttribute('aria-label') || '')) || els[0]).click());
  await page.waitForSelector('#startBtn', { state: 'attached', timeout: 15000 });
  await page.$eval('#startBtn', (e) => e.click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.$eval('#stopBtn', (e) => e.click());
  await page.waitForSelector('#pauseFinishBtn', { state: 'visible', timeout: 5000 });
  await page.$eval('#pauseFinishBtn', (e) => e.click());
  await page.waitForSelector('#endOverlay.show', { timeout: 10000 });
  await page.waitForTimeout(1300);
}

// ---------------------------------------------------------------------------
// 设计图上那一局：圆球 · 炸弹 · 430 分 · 代号 57GY-N5W8；第二张全部消完了（终局那一块一枚不剩）
// ---------------------------------------------------------------------------
function designRun(swept) {
  const board = (face) => {
    const cells = [];
    const colors = ['#4461B8', '#C05B5C', '#008703', '#F7821B', '#725AAF', '#4C4C4C'];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++)
      cells.push({ kind: 'circle', cx: (c + 0.5) / 6, cy: (r + 0.5) / 6, r: 0.07, face, color: colors[(r * 6 + c) % 6] });
    return { cells };
  };
  return {
    at: Date.now(),
    data: {
      shapeId: 'circle', shapeFallback: '圆球', modeKey: 'bomb', bombRules: BOMB_VER, rules: SCORING_VER,
      totalScore: 430, score: 198, ratePercent: 0, bonusMult: 1, elapsedSec: 61, moves: 19, best: 430,
      reason: swept ? 'cleared' : 'manual', neverFlipped: 0, unflippedScale: 1, timeMult: 1,
      patternPoints: 0, comboBonusPoints: 0, linePoints: 142, extraPenalty: 0, extraPenaltyReason: '',
      hazardEnd: false, flips: 28, defused: 0, lines: 9, par: 28, stepCoef: 2.17, cleared: 36, boardTiles: 36,
      swept, unlockedOne: true, seed: '57GYN5W8', seedSource: 'entered', at: Date.now(),
    },
    start: board('flavor'),
    end: swept ? board('blank') : board('flavor'),
  };
}

/** 成绩页那条路画出来的那张卡（renderShareCard 的单人那一张）。 */
async function cardUrl(swept) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await ctx.addInitScript(([key, run]) => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem(key, '430');
    localStorage.setItem(key + '::runs', JSON.stringify([run]));
  }, ['sugarcube_best_' + SCORING_VER, designRun(swept)]);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navRecords', { timeout: 20000 });
  await page.click('#navRecords');
  await page.waitForSelector('#recordsPanel', { timeout: 10000 });
  await page.click('#recordsPanel');
  await page.waitForTimeout(500);
  await page.click('.center-pick .records-row');
  await page.waitForSelector('.overlay--top .share-modal img', { timeout: 10000 });
  const src = await page.$eval('.overlay--top .share-modal img', (e) => e.getAttribute('src'));
  await ctx.close();
  return src;
}

/**
 * 量墨的外框：把一张截图（或卡的 PNG，先缩到 279 宽）解回画布，每一块在给的范围里找「离底色远」的
 * 像素。底色取那一块左上角那一点。
 */
const lab = await (await browser.newContext()).newPage();
async function inkBoxes(png, regions, scaleTo = 0) {
  return lab.evaluate(async ({ src, regions, scaleTo }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = scaleTo || img.naturalWidth;
    const h = scaleTo ? Math.round((img.naturalHeight * scaleTo) / img.naturalWidth) : img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const out = {};
    for (const [name, x0, y0, x1, y1, thr, bgHex] of regions) {
      const bg = bgHex ? [1, 3, 5].map((k) => parseInt(bgHex.slice(k, k + 2), 16)) : px(x0, y0);
      let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (dist(px(x, y), bg) > thr) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
      }
      out[name] = bx1 < 0 ? null : { x0: bx0, x1: bx1, y0: by0, y1: by1 };
    }
    return out;
  }, { src: 'data:image/png;base64,' + png.toString('base64'), regions, scaleTo });
}
const fmt = (b) => (b ? `x${b.x0}-${b.x1} y${b.y0}-${b.y1}` : '没找到');

// ---------------------------------------------------------------------------
// ① 弹窗本身：设计图上那一局，两张图各一遍
// ---------------------------------------------------------------------------
const cards = [await cardUrl(false), await cardUrl(true)];
{
  const ctx = await browser.newContext({ viewport: { width: 402, height: 875 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.addInitScript(SEED, 'zhHans');
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await endARun(page);

  // 先看结构在不在：① 往这几格里填设计图上那一局。缺了就记一条红、跳过 ① 的对位（后面几节照跑），
  // 而不是在填的那一步抛错退出——那样红是红了，却说不出红在哪。
  const missing = await page.evaluate(() =>
    ['#endTitle', '#endScore', '#endBadges', '#endStamp', '#endBreakdown', '#endShare', '#endShareImg', '#endOverlay .end-actions', '#endOverlay .end-body']
      .filter((s) => !document.querySelector(s)));
  check('① 结算弹窗的结构在（标题、分数、徽章格、勾、明细、图、三颗键那一排、中间那一块）', missing.length === 0, missing.length ? '缺 ' + missing.join(' ') : '');

  for (const stamp of missing.length ? [] : [false, true]) {
    const tag = stamp ? '① 有通关勾（第二张图）' : '① 没有通关勾（第一张图）';
    await page.evaluate(([src, stamp]) => {
      const ov = document.getElementById('endOverlay');
      ov.classList.toggle('end--stamp', stamp);
      // 分数：滚筒滚完的样子，和 engine/odometer.ts 的 rollOdometer 摆出来的一样。
      const host = document.getElementById('endScore');
      host.classList.add('odometer');
      host.textContent = '';
      for (const ch of '430') {
        const box = document.createElement('div');
        box.className = 'digit-box';
        const strip = document.createElement('div');
        strip.className = 'digit-strip';
        strip.style.transition = 'none';
        for (let d = 0; d < 10; d++) {
          const c = document.createElement('span');
          c.textContent = String(d);
          strip.appendChild(c);
        }
        strip.style.transform = `translateY(-${Number(ch) * 1.1}em)`;
        box.appendChild(strip);
        host.appendChild(box);
      }
      // 徽章、明细、均分、勾：gameController 的 endGame / stampEndCheck 拼的就是这几种结构。
      document.getElementById('endBadges').innerHTML = (stamp ? ['清盘', '解锁 1 枚'] : ['解锁 1 枚'])
        .map((b) => `<span class="end-badge">${b}</span>`).join('');
      const rows = [['翻面 28 枚 ×2', '56', ''], ['削线 9 条（星星数²）', '+142', ''], ['拼出分', '198', ' end-row--sum'],
        ['步数系数（19步，基准28）', '×2.17', ''], ['综合分', '430', ' end-row--sum end-row--total']];
      document.getElementById('endBreakdown').innerHTML =
        rows.map(([l, v, cls]) => `<div class="end-row${cls}"><span>${l}</span><span>${v}</span></div>`).join('') +
        '<div class="end-row end-row--avg"><span>该玩法您的均分 = 430</span></div>';
      const st = document.getElementById('endStamp');
      st.innerHTML = stamp
        ? '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="end-stamp-ring" cx="20" cy="20" r="17" fill="none" stroke="var(--end-ok)" stroke-width="5.9"/>' +
          '<path class="end-stamp-tick" d="M11.3 18.2 L16.6 25.6 L28.6 12.6" fill="none" stroke="var(--end-ok)" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '';
      st.classList.toggle('end-stamp--drawn', stamp);
      document.getElementById('endShare').removeAttribute('hidden');
      const img = document.getElementById('endShareImg');
      img.src = src;
      return img.decode();
    }, [cards[stamp ? 1 : 0], stamp]);
    await page.waitForTimeout(500);

    const dom = await page.evaluate(() => {
      const bb = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      const cs = (s) => getComputedStyle(document.querySelector(s));
      const badges = [...document.querySelectorAll('#endBadges .end-badge')].map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, bg: c.backgroundColor, fg: c.color, r: c.borderRadius, fs: c.fontSize, fw: c.fontWeight }; });
      const btns = [...document.querySelectorAll('#endOverlay .end-actions > button')].map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); const s = e.querySelector('svg')?.getBoundingClientRect(); return { id: e.id, x: r.left, y: r.top, w: r.width, h: r.height, bg: c.backgroundColor, r: c.borderRadius, svg: s ? { w: s.width, h: s.height, cx: s.left + s.width / 2 - (r.left + r.width / 2), cy: s.top + s.height / 2 - (r.top + r.height / 2) } : null, text: e.textContent.trim() }; });
      const rowCells = [...document.querySelectorAll('#endBreakdown .end-row:not(.end-row--avg):not(.end-row--tip) > span:last-child')].map((e) => e.getBoundingClientRect().left);
      const ring = document.querySelector('#endStamp .end-stamp-ring');
      return {
        modal: bb('#endOverlay .modal'), img: bb('#endShareImg'), stamp: bb('#endStamp'),
        modalRadius: cs('#endOverlay .modal').borderTopLeftRadius,
        imgRadius: cs('#endShareImg').borderTopLeftRadius,
        title: { fs: cs('#endTitle').fontSize, fw: cs('#endTitle').fontWeight, color: cs('#endTitle').color },
        score: { fs: cs('#endScore').fontSize, color: cs('#endScore').color },
        rows: { fs: cs('#endBreakdown').fontSize, lh: cs('#endBreakdown').lineHeight, color: cs('#endBreakdown').color,
          total: getComputedStyle(document.querySelector('#endBreakdown .end-row--total')).fontWeight,
          built: getComputedStyle(document.querySelector('#endBreakdown .end-row--sum:not(.end-row--total)')).fontWeight },
        ring: ring ? { stroke: getComputedStyle(ring).stroke, sw: ring.getAttribute('stroke-width') } : null,
        badges, btns, valueLefts: rowCells,
        lines: [...document.querySelectorAll('#endOverlay .end-rule, #endOverlay hr')].length,
        actionsBorder: cs('#endOverlay .end-actions').borderTopWidth,
      };
    });
    const shot = await page.screenshot();
    // 扫墨的范围：每一块在它那个位置周围放宽一圈。
    const R = stamp
      ? [['title', 50, 105, 200, 147, 120, '#ffffff'], ['score', 40, 146, 172, 212, 120, '#ffffff'], ['check', 50, 206, 172, 312, 60, '#ffffff'],
         ['row1L', 172, 214, 300, 230, 120, '#ffffff'], ['row1R', 305, 214, 352, 230, 120, '#ffffff'], ['rowLast', 172, 298, 352, 316, 120, '#ffffff']]
      : [['title', 80, 105, 215, 147, 120, '#ffffff'], ['score', 70, 146, 212, 212, 120, '#ffffff'],
         ['row1L', 100, 214, 240, 230, 120, '#ffffff'], ['row1R', 240, 214, 300, 230, 120, '#ffffff']];
    const ink = await inkBoxes(shot, R);

    check(`${tag}：窗 334×695 在 (34, 90)，圆角 44`,
      near(dom.modal.x, 34, 1) && near(dom.modal.y, 90, 1) && near(dom.modal.w, 334, 1) && near(dom.modal.h, 695, 1) && dom.modalRadius === '44px',
      `${dom.modal.x.toFixed(1)},${dom.modal.y.toFixed(1)} ${dom.modal.w.toFixed(1)}×${dom.modal.h.toFixed(1)} r${dom.modalRadius}`);
    check(`${tag}：没有横线（设计图上没有线；键上面那道边也撤了）`, dom.lines === 0 && dom.actionsBorder === '0px', `${dom.lines} 道，键上边 ${dom.actionsBorder}`);
    check(`${tag}：「综合得分」墨在 ${stamp ? 'x68–154' : 'x107–193'} y118–140（±3）`,
      !!ink.title && near(ink.title.x0, stamp ? 68 : 107) && near(ink.title.x1, stamp ? 154 : 193) && near(ink.title.y0, 118) && near(ink.title.y1, 140),
      fmt(ink.title));
    check(`${tag}：标题 22px 常规字重、黑`, dom.title.fs === '22px' && dom.title.fw === '400' && dom.title.color === 'rgb(0, 0, 0)', JSON.stringify(dom.title));
    // 分数：滚筒一位一格（engine/odometer.ts），格宽装得下最宽那个 0 就比设计图上比例宽的数字宽 6——中线
    // 对齐，宽度给到 108。
    const sc = ink.score;
    const scMid = sc ? (sc.x0 + sc.x1) / 2 : 0;
    check(`${tag}：分数墨的中线在 ${stamp ? 108 : 147}（±2）、上下 153–199（±2）、宽不超过 108`,
      !!sc && near(scMid, stamp ? 108 : 147, 2) && near(sc.y0, 153, 2) && near(sc.y1, 199, 2) && sc.x1 - sc.x0 + 1 <= 108,
      fmt(sc));
    check(`${tag}：分数 63px、#943D40`, dom.score.fs === '63px' && dom.score.color === 'rgb(148, 61, 64)', JSON.stringify(dom.score));
    const wantBadges = stamp ? [[180.5, 172.5], [275, 172.5]] : [[220.5, 174.5]];
    check(`${tag}：徽章 ${wantBadges.length} 枚，各在图上那个位置（±3），70×28、圆角 8`,
      dom.badges.length === wantBadges.length && dom.badges.every((b, i) => near(b.x, wantBadges[i][0]) && near(b.y, wantBadges[i][1], 3) && near(b.w, 70, 1) && near(b.h, 28, 0.5) && b.r === '8px'),
      dom.badges.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(0)}×${b.h.toFixed(0)} r${b.r}`).join(' | '));
    check(`${tag}：徽章底 #93E7A3、字 #00AC00、11px 粗`,
      dom.badges.every((b) => b.bg === 'rgb(147, 231, 163)' && b.fg === 'rgb(0, 172, 0)' && b.fs === '11px' && Number(b.fw) >= 700),
      dom.badges.map((b) => `${b.bg} ${b.fg} ${b.fs} ${b.fw}`).join(' | '));
    check(`${tag}：明细 11px、行距 17、#943D40；「综合分」那一行粗，「拼出分」不粗`,
      dom.rows.fs === '11px' && dom.rows.lh === '17px' && dom.rows.color === 'rgb(148, 61, 64)' && Number(dom.rows.total) >= 700 && Number(dom.rows.built) < 600,
      JSON.stringify(dom.rows));
    check(`${tag}：明细第一行抬头墨的左沿 ${stamp ? 180 : 110}、墨顶 218（±3）`,
      !!ink.row1L && near(ink.row1L.x0, stamp ? 180 : 110) && near(ink.row1L.y0, 218), fmt(ink.row1L));
    check(`${tag}：数那一栏在 ${stamp ? 321 : 250}（±3），每一行的数左沿对齐`,
      !!ink.row1R && near(ink.row1R.x0, stamp ? 321 : 250) && dom.valueLefts.every((x) => Math.abs(x - dom.valueLefts[0]) < 0.5),
      `${fmt(ink.row1R)}  各行 ${dom.valueLefts.map((x) => x.toFixed(1)).join(' ')}`);
    if (stamp) {
      check(`${tag}：通关勾墨 x66–153 y213–301（±3）`, !!ink.check && near(ink.check.x0, 66) && near(ink.check.x1, 153) && near(ink.check.y0, 213) && near(ink.check.y1, 301), fmt(ink.check));
      check(`${tag}：勾的环宽 13（画布 40 格里 5.9）、颜色 #00AC00`, !!dom.ring && dom.ring.sw === '5.9' && dom.ring.stroke === 'rgb(0, 172, 0)', JSON.stringify(dom.ring));
      check(`${tag}：最后一行「该玩法您的均分」墨顶 302（±3），左沿和明细抬头一齐`, !!ink.rowLast && near(ink.rowLast.y0, 302) && near(ink.rowLast.x0, 180), fmt(ink.rowLast));
      check(`${tag}：卡 279×378（±2）、顶在 329.5（±3）、在窗里居中，圆角 10% / 7.4%（设计图 28px）`,
        near(dom.img.w, 279, 2) && near(dom.img.h, 378, 2) && near(dom.img.y, 329.5) && near(dom.img.x + dom.img.w / 2, 201, 1) && dom.imgRadius.startsWith('10%'),
        `${dom.img.x.toFixed(1)},${dom.img.y.toFixed(1)} ${dom.img.w.toFixed(1)}×${dom.img.h.toFixed(1)} r${dom.imgRadius}`);
    }
    const wantBtn = [['restartBtn', 'rgb(192, 91, 92)', 29, 30], ['shareBtn', 'rgb(68, 97, 184)', 20, 27], ['endBackBtn', 'rgb(247, 130, 27)', 34, 34]];
    check(`${tag}：三颗键依次是再来 · 分享 · 主页，只有记号没有字`,
      dom.btns.map((b) => b.id).join(',') === 'restartBtn,shareBtn,endBackBtn' && dom.btns.every((b) => !!b.svg && b.text === ''),
      dom.btns.map((b) => `${b.id}${b.text ? '「' + b.text + '」' : ''}`).join(' '));
    check(`${tag}：三颗键 91×36、圆角 15、相隔 9，在 x55 / 155.3 / 255.7、y723.5（±1.5）`,
      dom.btns.length === 3 && dom.btns.every((b, i) => near(b.x, 55 + i * 100.33, 1.5) && near(b.y, 723.5, 1.5) && near(b.w, 91.33, 1) && near(b.h, 36, 0.5) && b.r === '15px'),
      dom.btns.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(1)}×${b.h.toFixed(1)} r${b.r}`).join(' | '));
    check(`${tag}：键的颜色是色卡那三支（玫红 / 蓝 / 橙）`, dom.btns.every((b, i) => b.bg === wantBtn[i][1]), dom.btns.map((b) => b.bg).join(' | '));
    check(`${tag}：键上的记号照图上的尺寸（再来 29×30、分享 20×27、主页那副圆盘 34）且在键正中（±1）`,
      dom.btns.every((b, i) => near(b.svg.w, wantBtn[i][2], 0.5) && near(b.svg.h, wantBtn[i][3], 0.5) && Math.abs(b.svg.cx) <= 1 && Math.abs(b.svg.cy) <= 1),
      dom.btns.map((b) => `${b.svg.w.toFixed(1)}×${b.svg.h.toFixed(1)} (${b.svg.cx.toFixed(1)},${b.svg.cy.toFixed(1)})`).join(' | '));
  }
  check('① 零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ② 卡里面：缩到设计图上那 279 宽，逐块比
// ---------------------------------------------------------------------------
for (const [i, swept] of [[0, false], [1, true]]) {
  const tag = swept ? '② 卡（全部消完了）' : '② 卡（没消完）';
  const png = Buffer.from(cards[i].split(',')[1], 'base64');
  const C = '#ffedc8';
  const ink = await inkBoxes(png, [
    ['corner', 2, 2, 8, 8, 6, C], ['slides', 20, 25, 140, 62, 120, C], ['modeText', 25, 63, 68, 83, 200, C], ['dash', 66, 64, 84, 82, 120, C],
    // 标志顶边和「Slides」的底边在设计图上是挨着的（都在 62），从 63 起扫才不会把 es 两个字母框进来。
    ['badge', 86, 63, 128, 86, 100, C], ['score', 20, 88, 170, 145, 120, C], ['qr', 170, 20, 275, 112, 60, C],
    ['cap1', 175, 112, 270, 124, 150, C], ['cap2', 175, 125, 270, 140, 150, C],
    ['panelA', 1, 150, 139, 375, 20, C], ['panelB', 140, 150, 278, 375, 20, C], ['one', 20, 150, 260, 375, 20, C],
  ], 279);
  check(`${tag}：底色是 #FFEDC8（四角）`, ink.corner === null, fmt(ink.corner));
  check(`${tag}：「Slides」墨 32–119 × 32–62（±2）`, !!ink.slides && near(ink.slides.x0, 32, 2) && near(ink.slides.x1, 119, 2) && near(ink.slides.y0, 32, 2) && near(ink.slides.y1, 62, 2), fmt(ink.slides));
  check(`${tag}：「圆球」墨 33–75 × 66–80（±3）`, !!ink.modeText && near(ink.modeText.x0, 33) && near(ink.modeText.y0, 66) && near(ink.modeText.y1, 80), fmt(ink.modeText));
  check(`${tag}：横杠 72–76（±2），炸弹标志 93–113 × 62–82（±2）`,
    !!ink.dash && near(ink.dash.x0, 72, 2) && near(ink.dash.x1, 76, 2) && !!ink.badge && near(ink.badge.x0, 93, 2) && near(ink.badge.x1, 113, 2) && near(ink.badge.y0, 63, 1) && near(ink.badge.y1, 82, 2),
    `横杠 ${fmt(ink.dash)} / 标志 ${fmt(ink.badge)}`);
  check(`${tag}：分数墨 26–124 × 91–138（±2）`, !!ink.score && near(ink.score.x0, 26, 2) && near(ink.score.x1, 124, 2) && near(ink.score.y0, 91, 2) && near(ink.score.y1, 138, 2), fmt(ink.score));
  // 二维码：设计图上那一块是二维码这张图的占位（含四格静区），我们的码子落在那块的正中。
  const qrMid = ink.qr ? [(ink.qr.x0 + ink.qr.x1) / 2, (ink.qr.y0 + ink.qr.y1) / 2] : [0, 0];
  check(`${tag}：二维码在图上那一块的正中 (222, 70)（±3）`, !!ink.qr && near(qrMid[0], 222) && near(qrMid[1], 70), fmt(ink.qr));
  check(`${tag}：说明两行在二维码底下、居中（墨顶 114 / 127，±2）`,
    !!ink.cap1 && !!ink.cap2 && near(ink.cap1.y0, 114, 2) && near(ink.cap2.y0, 127, 2) && near((ink.cap1.x0 + ink.cap1.x1) / 2, 221, 3) && near((ink.cap2.x0 + ink.cap2.x1) / 2, 221, 3),
    `${fmt(ink.cap1)} / ${fmt(ink.cap2)}`);
  if (swept) {
    check(`${tag}：只摆一块棋盘，42–238 × 166–362（±2）`, !!ink.one && near(ink.one.x0, 42, 2) && near(ink.one.x1, 238, 2) && near(ink.one.y0, 166, 2) && near(ink.one.y1, 362, 2), fmt(ink.one));
  } else {
    check(`${tag}：两块棋盘 4–135.5 / 144.5–276 × 177–309（±2）`,
      !!ink.panelA && !!ink.panelB && near(ink.panelA.x0, 4, 2) && near(ink.panelA.x1, 135, 2) && near(ink.panelB.x0, 144, 2) && near(ink.panelB.x1, 276, 2) &&
        near(ink.panelA.y0, 177, 2) && near(ink.panelA.y1, 309, 2),
      `${fmt(ink.panelA)} / ${fmt(ink.panelB)}`);
  }
}

// ---------------------------------------------------------------------------
// ③ 不滑：整窗、中间那一块都是 overflow hidden、touch-action none，里面什么都没被裁
// ④ 真打一局（四种语言）：gameController 拼出来的就是 ① 量的那种结构
// ---------------------------------------------------------------------------
const L = {
  zhHans: { title: '综合得分', again: '再来', share: '分享', home: '主页' },
  zhHant: { title: '綜合得分', again: '再來', share: '分享', home: '主頁' },
  en: { title: 'Final score', again: 'Again', share: 'Share', home: 'Home' },
  fr: { title: 'Score final', again: 'Rejouer', share: 'Partager', home: 'Accueil' },
};
for (const lang of Object.keys(L)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(SEED, lang);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await endARun(page);
  const r = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const cs = (s) => getComputedStyle(q(s));
    const rows = [...document.querySelectorAll('#endBreakdown > .end-row')];
    return {
      title: q('#endTitle').textContent.trim(),
      overflow: q('#endOverlay .end-body') ? [cs('#endOverlay').overflowY, cs('#endOverlay .modal').overflowX, cs('#endOverlay .modal').overflowY, cs('#endOverlay .end-body').overflowY] : ['没有 .end-body'],
      touch: q('#endOverlay .end-body') ? [cs('#endOverlay .modal').touchAction, cs('#endOverlay .end-body').touchAction] : ['没有 .end-body'],
      clipped: [...document.querySelectorAll('#endOverlay .modal, #endOverlay .end-head, #endOverlay .end-body')].filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className),
      badgesHost: !!q('#endOverlay .end-head > #endBadges'),
      avgLast: (() => { const data = rows.filter((x) => !x.classList.contains('end-row--tip')); return data.length > 0 && data[data.length - 1].classList.contains('end-row--avg') && data.filter((x) => x.classList.contains('end-row--avg')).length === 1; })(),
      total: rows.filter((x) => x.classList.contains('end-row--total')).length,
      oldBits: ['#endAvg', '.end-score-label', '.end-scroll', '.end-rule', '#endShareHint'].filter((s) => q('#endOverlay ' + s)),
      btns: [...document.querySelectorAll('#endOverlay .end-actions > button')].map((b) => ({ id: b.id, label: b.getAttribute('aria-label'), svg: !!b.querySelector('svg'), text: b.textContent.trim() })),
      img: !!q('#endShareImg') && (q('#endShareImg').getAttribute('src') || '').startsWith('data:image/png'),
    };
  });
  const want = L[lang];
  check(`③ ${lang}：整窗、中间那一块不滑（overflow hidden），遮罩自己也不滑`, r.overflow.every((v) => v === 'hidden'), r.overflow.join(' '));
  check(`③ ${lang}：手指拖不动（touch-action: none，窗和中间那一块）`, r.touch.every((v) => v === 'none'), r.touch.join(' '));
  check(`③ ${lang}：里面什么都没被裁（窗、抬头、中间那一块都没有藏起来的内容）`, r.clipped.length === 0, r.clipped.join(' '));
  check(`④ ${lang}：标题就是「${want.title}」`, r.title === want.title, r.title);
  check(`④ ${lang}：徽章在抬头里自己那一格；「该玩法您的均分」是明细最后一行；「综合分」那一行挂着粗的那个类`,
    r.badgesHost && r.avgLast && r.total === 1, JSON.stringify({ badgesHost: r.badgesHost, avgLast: r.avgLast, total: r.total }));
  check(`④ ${lang}：旧的那几样都撤了（#endAvg、小标题、滚动段、横线、「长按保存」）`, r.oldBits.length === 0, r.oldBits.join(' '));
  check(`④ ${lang}：三颗键：再来 · 分享 · 主页，记号、没有字、读屏名是「${want.again} / ${want.share} / ${want.home}」`,
    r.btns.map((b) => b.id).join(',') === 'restartBtn,shareBtn,endBackBtn' && r.btns.every((b) => b.svg && b.text === '') &&
      r.btns.map((b) => b.label).join('/') === `${want.again}/${want.share}/${want.home}`,
    r.btns.map((b) => `${b.id}:${b.label}${b.text ? '「' + b.text + '」' : ''}`).join(' '));
  check(`④ ${lang}：战绩图画出来了`, r.img);
  check(`④ ${lang}：零报错`, errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// ⑤ 六种屏幕 × 四种语言：装得下、谁也不压谁、键点得到
// ---------------------------------------------------------------------------
const SIZES = [[402, 875, true], [390, 844, true], [360, 640, true], [320, 568, true], [844, 390, true], [1280, 800, false]];
for (const [w, h, touch] of SIZES) {
  for (const lang of Object.keys(L)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
    await ctx.addInitScript(SEED, lang);
    const page = await ctx.newPage();
    await endARun(page);
    const bad = await page.evaluate((landscape) => {
      const out = [];
      const m = document.querySelector('#endOverlay .modal').getBoundingClientRect();
      const box = (s) => (document.querySelector(s) || document.querySelector('#endOverlay')).getBoundingClientRect();
      for (const s of ['#endOverlay .end-head', '#endOverlay .end-body', '#endOverlay .end-actions']) if (!document.querySelector(s)) out.push('没有 ' + s);
      const head = box('#endOverlay .end-head'), body = box('#endOverlay .end-body'), btns = box('#endOverlay .end-actions'), img = box('#endShareImg');
      const inside = (r) => r.left >= m.left - 0.5 && r.right <= m.right + 0.5 && r.top >= m.top - 0.5 && r.bottom <= m.bottom + 0.5;
      if (m.top < -0.5 || m.left < -0.5 || m.bottom > innerHeight + 0.5 || m.right > innerWidth + 0.5) out.push('窗出屏');
      for (const [k, r] of [['抬头', head], ['图那一块', body], ['键', btns], ['图', img]]) if (!inside(r)) out.push(k + '出窗');
      const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      // 抬头盒子在横屏是左边那一整栏的宽，量它里面的东西：明细和分数不压图、不压键。
      for (const s of ['#endBreakdown', '#endScore', '#endTitle']) {
        const r = box(s);
        if (overlap(r, img)) out.push(s + '压图');
        if (overlap(r, btns)) out.push(s + '压键');
      }
      if (overlap(img, btns)) out.push('图压键');
      if (!landscape && body.top < head.bottom - 0.5) out.push('图那一块压抬头');
      for (const row of document.querySelectorAll('#endBreakdown .end-row')) {
        const r = row.getBoundingClientRect();
        if (r.right > m.right - 4 || r.left < m.left + 4) out.push('明细贴边');
      }
      const clipped = [...document.querySelectorAll('#endOverlay .modal, #endOverlay .end-head, #endOverlay .end-body')].filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
      if (clipped.length) out.push('有内容被裁');
      for (const id of ['restartBtn', 'shareBtn', 'endBackBtn']) {
        const r = document.getElementById(id).getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !hit.closest('#' + id)) out.push(id + '点不到');
      }
      if (img.width < 100) out.push(`图只剩 ${img.width.toFixed(0)} 宽`);
      return out;
    }, w > h && h <= 560);
    check(`⑤ ${w}×${h} ${lang}：装得下、谁也不压谁、三颗键点得到、图不小于 100 宽`, bad.length === 0, bad.join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// ⑥ 唯一放开滑的那一种：屋主中途散场、这一局转成单人打完，结算页上多一份小屋的（ui/roomLeftover.ts）
//
// 那一份是另一张榜加一张图，人多就是十几行，装不进固定的高度——只有这时候中间那一块放开上下滑
// （roomLeftover 挂 .end-body--room），图回到文档流里排在榜后面。屋主散场那条路要两台浏览器加一台
// 真服务器（check-room-leave-card），它在走到结算页之前就有旧红；这儿照 mountRoomLeftover 摆出来的
// 样子摆一份二十人的榜，量排版。
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(SEED, 'zhHans');
  const page = await ctx.newPage();
  await endARun(page);
  const before = await page.evaluate(() => document.querySelector('#endOverlay .end-actions').getBoundingClientRect().top);
  const r = await page.evaluate(async () => {
    const host = document.getElementById('endRoomBlock');
    host.innerHTML =
      '<div class="end-room-head"><div class="end-score-label">全屋总分</div><div class="big-score">12345</div></div>' +
      '<div class="mp-players end-room-rows">' +
      Array.from({ length: 20 }, (_, i) => `<div class="mp-player"><span class="mp-final-rank">${i + 1}</span><span class="mp-player-name">玩家 ${i + 1}</span><span class="mp-player-total">${900 - i * 10}</span></div>`).join('') +
      '</div>';
    host.hidden = false;
    host.closest('.end-body').classList.add('end-body--room');
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const body = document.querySelector('#endOverlay .end-body');
    const cs = getComputedStyle(body);
    const fig = document.getElementById('endShare').getBoundingClientRect();
    const room = host.getBoundingClientRect();
    const m = document.querySelector('#endOverlay .modal').getBoundingClientRect();
    const btn = document.querySelector('#endOverlay .end-actions').getBoundingClientRect();
    return {
      overflowY: cs.overflowY, touch: cs.touchAction,
      scrolls: body.scrollHeight > body.clientHeight + 10,
      figAfterRoom: fig.top >= room.bottom - 1,
      btnTop: btn.top, btnIn: btn.bottom <= m.bottom + 0.5 && btn.bottom <= innerHeight,
    };
  });
  check('⑥ 小屋那一份在的时候：中间那一块放开上下滑（overflow-y auto、touch-action pan-y），真的长到要滑',
    r.overflowY === 'auto' && r.touch === 'pan-y' && r.scrolls, JSON.stringify(r));
  check('⑥ 小屋那一份在的时候：这一局的图排在小屋那张榜后面（回到文档流里）', r.figAfterRoom, JSON.stringify(r));
  check('⑥ 小屋那一份在的时候：三颗键不挪、还在窗里', Math.abs(r.btnTop - before) <= 1 && r.btnIn, `${before.toFixed(1)} → ${r.btnTop.toFixed(1)}`);
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
