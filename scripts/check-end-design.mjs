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
 *   卡里      （卡内坐标）Slides 32–119 × 32–62；「圆球」33–75；横杠 72–76；炸弹标志 93–113 × 62–82
 *             （名字那一行 10-09 起只比起点和间距，见 ② 那一段）；
 *             分数 26–124 × 91–138；两块棋盘 4–135.5 / 144.5–276 × 177–309（#EAD3AE，圆角 18）；
 *             全部消完只摆一块 42–238 × 166–362；二维码那一块中心 (222, 70)；说明两行墨顶 114 / 127
 *   三颗键    91×36、相隔 9、y723.5、圆角 15；#C05B5C / #4461B8 / 橙（色卡那支 #F7821B，图上取样 #F27F1C）
 *
 * ── 10-09 补充方案 6-4 / 6-7 之后 ──────────────────────────────────────────────────────────────
 *
 * 玩家说字「又小又细根本看不清」，定了「放大一档、窗不变」（6-7）：标题 24/500、明细 14/21/500（综合分那一行
 * 800）、均分和说明 13/19、徽章 13px 至少 78×30，抬头那一栏的垫块 132 → 120。三颗键改成同构的「彩色药丸里一
 * 枚白圆盘、盘里是药丸同色的记号」，高 36 → 44、圆角 15 → 17（6-4）。所以 ① 量的变了：窗、分数、勾、卡里那几
 * 样照旧照上面那张表；字那几样量方案给的新数，位置改量几块之间的关系（徽章在分数右边、明细在分数底下 / 勾的
 * 右边、两两不相交）；卡宽比方案实测的 254 / 238；三颗键量高 44、三枚白盘一样大、记号和药丸同色。
 *
 * ── 这道门怎么量 ──────────────────────────────────────────────────────────────────────
 *
 * 那两种结局（真通关盖勾、解锁 1 枚）一局里打不出来，所以 ① ② 先真打一局方块、按《结束游戏》拿到真的
 * 结算弹窗，再按 gameController 拼的那几种结构把设计图上那一局填进去（我们自己的文案）；卡是从成绩页
 * 那条路画的（存档里塞一局「圆球 · 炸弹 · 代号 57GY-N5W8」，和图上那张一样），再挂到弹窗上。然后
 * 402×875、一倍像素截图，按上面那张表逐块扫墨的外框比。容差 3px；分数宽另说（见 ①）。
 *
 * ④ 不填东西：真打一局四种语言，看 gameController 拼出来的结构就是 ① 量的那一种。⑤ 方案那五个尺寸加横屏
 * 四档 × 四种语言 × 三种样子（头一局带「综合分是怎么来的」那一句 / 没勾 / 有勾）：整窗在屏里、每一块在窗
 * 里、谁也不压谁、抬头没被裁、三颗键的正中点得到、明细 14px。
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
/**
 * 通关章里那枚勾：全站那一枚（ui/checkMark.ts 的 CHECK_PATH，10-09 补充方案 6-5）缩到 40 格画布，×0.4——和
 * gameController 的 stampEndCheck 用 checkPathAt(0.4) 摆出来的一模一样。从源码现算，不在门里另抄一份：
 * 从前这儿抄的是照设计图另画的那一枚，勾一换形状，门量的就是一枚屏幕上早就没有的勾。
 */
const CHECK_PATH = (readFileSync(new URL('../src/ui/checkMark.ts', import.meta.url), 'utf8').match(/CHECK_PATH = '([^']+)'/) || [, ''])[1];
if (!CHECK_PATH) {
  console.error('读不出 ui/checkMark.ts 的 CHECK_PATH——先修这儿。');
  process.exit(2);
}
const STAMP_SVG =
  '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="end-stamp-ring" cx="20" cy="20" r="17" fill="none" stroke="var(--end-ok)" stroke-width="5.9"/>' +
  `<path class="end-stamp-tick" d="${CHECK_PATH.replace(/\d+(?:\.\d+)?/g, (n) => String(Math.round(Number(n) * 0.4 * 100) / 100))}" fill="none" stroke="var(--end-ok)" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** 两枚徽章（清盘 / 解锁 1 枚）四种语言的字，从 i18n.ts 现读：⑤ 摆「有勾」那一种要用当地的字。 */
const I18N = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
const badgeText = (lang) => {
  const i = I18N.indexOf(`\n  ${lang}: {`);
  const pick = (k) => (I18N.slice(i).match(new RegExp(`\\n\\s+${k}: '([^']+)'`)) || [, ''])[1];
  return [pick('badgeSwept'), pick('badgeUnlockedOne')];
};

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
    (els.find((e) => /^(经典方块|經典方塊|Classic Squares|Carrés classiques)$/i.test(e.getAttribute('aria-label') || '')) || els[0]).click());
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
/**
 * 一条横带里的墨按列切成一段一段：某一列有墨就算这一段的，连着空出 `gap` 列以上就断开。回每一段的外框
 * （从左到右）。名字那一行用它：名字、横杠、标志三样之间的空比字和字之间的空大得多。
 */
async function inkRuns(png, x0, y0, x1, y1, thr, bgHex, scaleTo, gap = 6) {
  return lab.evaluate(async ({ src, x0, y0, x1, y1, thr, bgHex, scaleTo, gap }) => {
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
    const bg = [1, 3, 5].map((k) => parseInt(bgHex.slice(k, k + 2), 16));
    const inkAt = (x, y) => { const i = (y * w + x) * 4; return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > thr; };
    const runs = [];
    let cur = null;
    let blank = 0;
    for (let x = x0; x <= x1; x++) {
      let top = -1, bot = -1;
      for (let y = y0; y <= y1; y++) if (inkAt(x, y)) { if (top < 0) top = y; bot = y; }
      if (top < 0) {
        blank++;
        if (cur && blank > gap) { runs.push(cur); cur = null; }
        continue;
      }
      blank = 0;
      if (!cur) cur = { x0: x, x1: x, y0: top, y1: bot };
      else { cur.x1 = x; cur.y0 = Math.min(cur.y0, top); cur.y1 = Math.max(cur.y1, bot); }
    }
    if (cur) runs.push(cur);
    return runs;
  }, { src: 'data:image/png;base64,' + png.toString('base64'), x0, y0, x1, y1, thr, bgHex, scaleTo, gap });
}

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
    await page.evaluate(([src, stamp, stampSvg]) => {
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
      st.innerHTML = stamp ? stampSvg : '';
      st.classList.toggle('end-stamp--drawn', stamp);
      document.getElementById('endShare').removeAttribute('hidden');
      const img = document.getElementById('endShareImg');
      img.src = src;
      return img.decode();
    }, [cards[stamp ? 1 : 0], stamp, STAMP_SVG]);
    await page.waitForTimeout(500);

    const dom = await page.evaluate(() => {
      const bb = (s) => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
      const cs = (s) => getComputedStyle(document.querySelector(s));
      const badges = [...document.querySelectorAll('#endBadges .end-badge')].map((e) => { const c = getComputedStyle(e); return { ...bb(e), bg: c.backgroundColor, fg: c.color, rad: c.borderRadius, fs: c.fontSize, fw: c.fontWeight }; });
      const btns = [...document.querySelectorAll('#endOverlay .end-actions > button')].map((e) => {
        const c = getComputedStyle(e);
        const k = e.getBoundingClientRect();
        const svg = e.querySelector('svg');
        const sr = svg ? svg.getBoundingClientRect() : null;
        // 圆盘是 ctlGlyph 里那一枚直接挂在 <svg> 底下的 <circle>；别的形状都是记号。
        const disc = svg ? [...svg.children].find((n) => n.tagName.toLowerCase() === 'circle') : null;
        const marks = svg ? [...svg.querySelectorAll('path, rect, polygon, polyline, line, circle, ellipse')].filter((m) => m !== disc) : [];
        const paints = marks.flatMap((m) => { const mc = getComputedStyle(m); return [mc.fill, mc.stroke].filter((v) => v && v !== 'none'); });
        return {
          id: e.id, ...bb(e), bg: c.backgroundColor, rad: c.borderRadius, text: e.textContent.trim(),
          svg: sr ? { w: sr.width, h: sr.height, cx: sr.left + sr.width / 2 - (k.left + k.width / 2), cy: sr.top + sr.height / 2 - (k.top + k.height / 2) } : null,
          disc: disc ? { d: disc.getBoundingClientRect().width, fill: getComputedStyle(disc).fill } : null,
          paints,
        };
      });
      const rows = [...document.querySelectorAll('#endBreakdown .end-row:not(.end-row--avg):not(.end-row--tip)')];
      const ring = document.querySelector('#endStamp .end-stamp-ring');
      const avg = document.querySelector('#endBreakdown .end-row--avg');
      return {
        modal: bb('#endOverlay .modal'), img: bb('#endShareImg'), stamp: bb('#endStamp'),
        title: bb('#endTitle'), breakdown: bb('#endBreakdown'), scoreBox: bb('#endScore'),
        modalRadius: cs('#endOverlay .modal').borderTopLeftRadius,
        imgRadius: cs('#endShareImg').borderTopLeftRadius,
        titleCss: { fs: cs('#endTitle').fontSize, fw: cs('#endTitle').fontWeight, color: cs('#endTitle').color },
        score: { fs: cs('#endScore').fontSize, color: cs('#endScore').color },
        rowsCss: { fs: cs('#endBreakdown').fontSize, lh: cs('#endBreakdown').lineHeight, fw: cs('#endBreakdown').fontWeight, color: cs('#endBreakdown').color,
          total: getComputedStyle(document.querySelector('#endBreakdown .end-row--total')).fontWeight,
          built: getComputedStyle(document.querySelector('#endBreakdown .end-row--sum:not(.end-row--total)')).fontWeight },
        avgCss: avg ? { fs: getComputedStyle(avg).fontSize, lh: getComputedStyle(avg).lineHeight } : null,
        avg: avg ? bb(avg) : null,
        labels: rows.map((r) => bb(r.firstElementChild)), values: rows.map((r) => bb(r.lastElementChild)),
        ring: ring ? { stroke: getComputedStyle(ring).stroke, sw: ring.getAttribute('stroke-width') } : null,
        badges, btns,
        lines: [...document.querySelectorAll('#endOverlay .end-rule, #endOverlay hr')].length,
        actionsBorder: cs('#endOverlay .end-actions').borderTopWidth,
      };
    });
    const shot = await page.screenshot();
    // 扫墨的只剩分数和勾：分数要量「滚筒版比设计图宽多少」，勾要量那一圈的外框。字的位置 10-09 起量盒子的
    // 相对位置（字放大一档之后，设计图上那几个绝对坐标本来就不成立了，见文件头）。范围就是它们自己的盒子，
    // 不放宽：字一放大，旁边的标题、徽章会挪进一个写死的范围里；放宽一两像素，分数那个盒子的底边就挨上通关
    // 勾那一圈的顶（两个盒子上下紧贴），扫到的就是勾了。
    const around = (b) => [Math.max(0, Math.round(b.x)), Math.max(0, Math.round(b.y)), Math.round(b.r) - 1, Math.round(b.b) - 1];
    const R = [['score', ...around(dom.scoreBox), 120, '#ffffff'], ...(stamp ? [['check', ...around(dom.stamp), 60, '#ffffff']] : [])];
    const ink = await inkBoxes(shot, R);
    const sc = ink.score;
    const apart = (a, b) => !!a && !!b && (a.r <= b.x + 0.5 || b.r <= a.x + 0.5 || a.b <= b.y + 0.5 || b.b <= a.y + 0.5);

    check(`${tag}：窗 334×695 在 (34, 90)，圆角 44（窗不变）`,
      near(dom.modal.x, 34, 1) && near(dom.modal.y, 90, 1) && near(dom.modal.w, 334, 1) && near(dom.modal.h, 695, 1) && dom.modalRadius === '44px',
      `${dom.modal.x.toFixed(1)},${dom.modal.y.toFixed(1)} ${dom.modal.w.toFixed(1)}×${dom.modal.h.toFixed(1)} r${dom.modalRadius}`);
    check(`${tag}：没有横线（设计图上没有线；键上面那道边也撤了）`, dom.lines === 0 && dom.actionsBorder === '0px', `${dom.lines} 道，键上边 ${dom.actionsBorder}`);
    check(`${tag}：标题 24px、500、黑（6-7：22/400 放大一档）`, dom.titleCss.fs === '24px' && dom.titleCss.fw === '500' && dom.titleCss.color === 'rgb(0, 0, 0)', JSON.stringify(dom.titleCss));
    // 分数：滚筒一位一格（engine/odometer.ts），格宽装得下最宽那个 0 就比设计图上比例宽的数字宽 6。
    check(`${tag}：分数 63px、#943D40，墨宽不超过 108（分数不动）`, dom.score.fs === '63px' && dom.score.color === 'rgb(148, 61, 64)' && !!sc && sc.x1 - sc.x0 + 1 <= 108,
      `${JSON.stringify(dom.score)} 墨 ${fmt(sc)}`);
    check(`${tag}：标题在分数上面，不相交`, !!sc && dom.title.b <= sc.y0 + 0.5, `标题底 ${dom.title.b.toFixed(1)} / 分数墨顶 ${sc ? sc.y0 : '—'}`);
    const wantN = stamp ? 2 : 1;
    check(`${tag}：徽章 ${wantN} 枚，至少 78 宽、30 高、圆角 8（6-7：70×28 放大一档）`,
      dom.badges.length === wantN && dom.badges.every((b) => b.w >= 78 - 0.5 && near(b.h, 30, 0.5) && b.rad === '8px'),
      dom.badges.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(1)}×${b.h.toFixed(1)} r${b.rad}`).join(' | '));
    check(`${tag}：徽章底 #93E7A3、字 #00AC00、13px 粗`,
      dom.badges.every((b) => b.bg === 'rgb(147, 231, 163)' && b.fg === 'rgb(0, 172, 0)' && b.fs === '13px' && Number(b.fw) >= 700),
      dom.badges.map((b) => `${b.bg} ${b.fg} ${b.fs} ${b.fw}`).join(' | '));
    check(`${tag}：徽章在分数右边，底边压在分数墨的下半截（±6）`,
      !!sc && dom.badges.every((b) => b.x >= sc.x1 + 10 && b.b >= (sc.y0 + sc.y1) / 2 && b.b <= sc.y1 + 6),
      `分数墨 ${fmt(sc)} / 徽章 ${dom.badges.map((b) => `${b.x.toFixed(1)}–${b.r.toFixed(1)} 底 ${b.b.toFixed(1)}`).join(' ')}`);
    check(`${tag}：明细 14px、行距 21、500、#943D40；「综合分」那一行 800，「拼出分」不加粗（6-7）`,
      dom.rowsCss.fs === '14px' && dom.rowsCss.lh === '21px' && dom.rowsCss.fw === '500' && dom.rowsCss.color === 'rgb(148, 61, 64)' && dom.rowsCss.total === '800' && Number(dom.rowsCss.built) < 600,
      JSON.stringify(dom.rowsCss));
    check(`${tag}：「该玩法您的均分」13px、行距 19，是明细最后一行、左沿和明细抬头一齐（±1）`,
      !!dom.avgCss && dom.avgCss.fs === '13px' && dom.avgCss.lh === '19px' && !!dom.avg && near(dom.avg.x, dom.labels[0].x, 1) && dom.labels.every((l) => l.b <= dom.avg.y + 0.5),
      JSON.stringify({ css: dom.avgCss, x: dom.avg?.x.toFixed(1), label: dom.labels[0]?.x.toFixed(1) }));
    check(`${tag}：数那一栏上下对齐，离抬头左沿至少 128（垫块 120 ＋ 间隔 8）`,
      dom.values.every((v) => Math.abs(v.x - dom.values[0].x) < 0.5) && dom.values[0].x - dom.labels[0].x >= 128 - 0.5,
      `数 ${dom.values.map((v) => v.x.toFixed(1)).join(' ')} / 抬头左沿 ${dom.labels[0].x.toFixed(1)}`);
    if (stamp) {
      const ck = ink.check;
      check(`${tag}：通关勾墨 88 见方（±2）、在分数底下`, !!ck && !!sc && near(ck.x1 - ck.x0 + 1, 88, 2) && near(ck.y1 - ck.y0 + 1, 88, 2) && ck.y0 >= sc.y1 + 4, `勾 ${fmt(ck)} / 分数 ${fmt(sc)}`);
      check(`${tag}：勾的环宽 13（画布 40 格里 5.9）、颜色 #00AC00`, !!dom.ring && dom.ring.sw === '5.9' && dom.ring.stroke === 'rgb(0, 172, 0)', JSON.stringify(dom.ring));
      check(`${tag}：明细在勾的右边（抬头左沿离勾 ≥ 10），第一行在勾的高度里`,
        !!ck && dom.labels[0].x >= ck.x1 + 10 && dom.labels[0].y >= ck.y0 - 2 && dom.labels[0].y <= ck.y1,
        `明细 ${dom.labels[0].x.toFixed(1)},${dom.labels[0].y.toFixed(1)} / 勾 ${fmt(ck)}`);
    } else {
      check(`${tag}：明细在分数底下（第一行离分数墨底 ≥ 10）`, !!sc && dom.labels[0].y >= sc.y1 + 10, `明细顶 ${dom.labels[0].y.toFixed(1)} / 分数墨底 ${sc ? sc.y1 : '—'}`);
    }
    // 战绩图：照现有规则在中间那一块里按比例缩（6-7 作废了「宽度贴满内容区」）。方案实测 402×875：没勾时
    // 约 254 宽、有勾时约 238 宽——字放大一档让出去的就是这一截。
    const wantImg = stamp ? 238 : 254;
    check(`${tag}：卡宽约 ${wantImg}（±3，方案实测）、在窗里居中，圆角 10% / 7.4%（设计图 28px）`,
      near(dom.img.w, wantImg, 3) && near(dom.img.x + dom.img.w / 2, 201, 1) && dom.imgRadius.startsWith('10%'),
      `${dom.img.x.toFixed(1)},${dom.img.y.toFixed(1)} ${dom.img.w.toFixed(1)}×${dom.img.h.toFixed(1)} r${dom.imgRadius}`);
    const blocks = [['标题', dom.title], ['分数', sc && { x: sc.x0, y: sc.y0, r: sc.x1 + 1, b: sc.y1 + 1 }], ['明细', dom.breakdown], ['卡', dom.img],
      ...dom.badges.map((b, i) => ['徽章' + (i + 1), b]), ...dom.btns.map((b) => [b.id, b]),
      ...(stamp ? [['勾', ink.check && { x: ink.check.x0, y: ink.check.y0, r: ink.check.x1 + 1, b: ink.check.y1 + 1 }]] : [])];
    const hits = [];
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) if (!apart(blocks[i][1], blocks[j][1])) hits.push(`${blocks[i][0]}×${blocks[j][0]}`);
    check(`${tag}：标题、分数、徽章、${stamp ? '勾、' : ''}明细、卡、三颗键两两不相交`, hits.length === 0, hits.join(' '));

    const wantBg = ['rgb(192, 91, 92)', 'rgb(68, 97, 184)', 'rgb(247, 130, 27)'];
    check(`${tag}：三颗键依次是再来 · 分享 · 主页，只有记号没有字`,
      dom.btns.map((b) => b.id).join(',') === 'restartBtn,shareBtn,endBackBtn' && dom.btns.every((b) => !!b.svg && b.text === ''),
      dom.btns.map((b) => `${b.id}${b.text ? '「' + b.text + '」' : ''}`).join(' '));
    check(`${tag}：三颗键 91.3×44、圆角 17、相隔 9，在 x55 / 155.3 / 255.7、y715.5（±1.5）（6-4：高 36 → 44）`,
      dom.btns.length === 3 && dom.btns.every((b, i) => near(b.x, 55 + i * 100.33, 1.5) && near(b.y, 715.5, 1.5) && near(b.w, 91.33, 1) && near(b.h, 44, 0.5) && b.rad === '17px'),
      dom.btns.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(1)}×${b.h.toFixed(1)} r${b.rad}`).join(' | '));
    check(`${tag}：键的颜色是色卡那三支（玫红 / 蓝 / 橙）`, dom.btns.every((b, i) => b.bg === wantBg[i]), dom.btns.map((b) => b.bg).join(' | '));
    // 6-4：三颗同构——彩色药丸里一枚白圆盘（ctlGlyph：100 格里半径 46，图 34px → 盘径 31.28），盘在键正中。
    check(`${tag}：三颗都有白盘，盘径一样（31.3 ±0.5），盘在键正中（±1）`,
      dom.btns.every((b) => !!b.disc && b.disc.fill === 'rgb(255, 255, 255)' && near(b.disc.d, 31.28, 0.5) && Math.abs(b.disc.d - dom.btns[0].disc.d) < 0.1 && Math.abs(b.svg.cx) <= 1 && Math.abs(b.svg.cy) <= 1),
      dom.btns.map((b) => `${b.id} ${b.disc ? `${b.disc.fill} ⌀${b.disc.d.toFixed(2)}` : '没有盘'} (${b.svg.cx.toFixed(1)},${b.svg.cy.toFixed(1)})`).join(' | '));
    check(`${tag}：盘里的记号是药丸自己的颜色`,
      dom.btns.every((b) => b.paints.length > 0 && b.paints.every((c) => c === b.bg)),
      dom.btns.map((b) => `${b.id}: ${[...new Set(b.paints)].join(' ')} / 键 ${b.bg}`).join(' | '));
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
    // 「Slides」扫到 61 为止：标志的顶边在 62，名字一长（见下面名字那一行）标志就挪到 Slides 底下，扫到 62
    // 会把标志顶上那一排框进来。
    ['corner', 2, 2, 8, 8, 6, C], ['slides', 20, 25, 140, 61, 120, C],
    ['score', 20, 88, 170, 145, 120, C], ['qr', 170, 20, 275, 112, 60, C],
    ['cap1', 175, 112, 270, 124, 150, C], ['cap2', 175, 125, 270, 140, 150, C],
    ['panelA', 1, 150, 139, 375, 20, C], ['panelB', 140, 150, 278, 375, 20, C], ['one', 20, 150, 260, 375, 20, C],
  ], 279);
  check(`${tag}：底色是 #FFEDC8（四角）`, ink.corner === null, fmt(ink.corner));
  check(`${tag}：「Slides」墨 32–119 × 32–62（±2）`, !!ink.slides && near(ink.slides.x0, 32, 2) && near(ink.slides.x1, 119, 2) && near(ink.slides.y0, 32, 2) && near(ink.slides.y1, 62, 2), fmt(ink.slides));
  /*
   * 名字、横杠、标志那一行：**只比起点和间距**（10-09 补充方案第一部分第 5 条之后）。
   *
   * 设计图那一局叫「圆球」，现在这副棋盘全站只叫一个名字「经典小球」，长了两个字。横杠和标志是代码按「名
   * 字有多宽 + 固定间距」往右排的（shareCard.ts：横杠离名字 31、标志离横杠 44，720 宽的卡上），所以名字一
   * 换，它们的绝对位置跟着挪——这正是设计的意思，不是走样。照图上那几个绝对数比，量的就成了「名字有几个
   * 字」。现在这一行按墨切成一段一段（空出 6 列以上就算断开）：第一段是名字，倒数第二段是横杠，最后一段
   * 是标志。比的是图上不随名字变的那几样：名字从 33 起、66–80 高（±3）；名字到横杠空约 13、横杠到标志空
   * 约 18（卡上是 31、44，折到 279 宽是 12、17，再加上「球」「-」两个字形边上留白的那一两列；量到的是
   * 14、19，图上那一局是 13、17，±3 都收得下）；横杠 4 宽、标志 20 宽、62–82 高（±2）。
   */
  const row = await inkRuns(png, 25, 62, 170, 86, 100, C, 279);
  const name = row[0];
  const dash = row.length >= 3 ? row[row.length - 2] : null;
  const badge = row.length >= 3 ? row[row.length - 1] : null;
  check(`${tag}：（尺子）名字那一行切出了名字、横杠、标志三样（${row.length} 段）`, row.length >= 3, row.map(fmt).join(' | '));
  check(`${tag}：名字墨从 33 起、66–80 高（±3）`, !!name && near(name.x0, 33) && near(name.y0, 66) && near(name.y1, 80), fmt(name));
  check(`${tag}：名字到横杠空约 13、横杠到标志空约 18（±3，和设计图一样，不随名字长短变）`,
    !!name && !!dash && !!badge && near(dash.x0 - name.x1, 13) && near(badge.x0 - dash.x1, 18),
    `名字 ${fmt(name)} / 横杠 ${fmt(dash)} / 标志 ${fmt(badge)}`);
  check(`${tag}：横杠 4 宽、标志 20 宽 × 62–82（±2）`,
    !!dash && !!badge && near(dash.x1 - dash.x0, 4, 2) && near(badge.x1 - badge.x0, 20, 2) && near(badge.y0, 62, 2) && near(badge.y1, 82, 2),
    `横杠 ${fmt(dash)} / 标志 ${fmt(badge)}`);
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
// ⑤ 各种屏幕 × 四种语言 × 三种样子：装得下、谁也不压谁、抬头没被裁、键点得到（10-09 补充方案 6-7）
//
// 方案定的尺寸表：402×875、390×844、360×740、320×568、1440×900；每一种都量「有勾 / 没勾 / 头一局（带说明
// 句）」。真打一局（头一回出综合分，「综合分是怎么来的」那一句就在）——这是「头一局」；拿掉那一句是「没
// 勾」；再摆上通关勾和两枚徽章（当地的字）、分数摆成三位数是「有勾」；分数再摆成四位数（1286，左边那一栏
// 最宽的时候，style.css 的 .end--wide-score）是「有勾·四位数」。明细的每一行都是 gameController 照这一局、
// 这种语言真拼出来的。
//
// 有勾那一种从前（字放大之前）在英法和窄屏上就有东西被窗边裁掉，门一直没量过；字放大之后连 402 宽的英法
// 都裁了。修在 style.css 的 .end--stamp .end-badges（徽章放不下一排就折行）、.end--wide-score 和窄屏那一段，
// 这儿多量一条「每一块都没伸出窗边」。
//
// 另加横屏手机四档（844×390、812×375、740×360、667×375）：字放大一档之后，横屏上头一局那一句一度装不下
// （法语最多差 25px，被键那一排裁掉，什么都不报），修在 style.css 横屏那一段（窗离屏幕上下沿 20 → 8）。
// 更小的两档没收：640×360 上法语头一局还差 10px、568×320 上从前（字放大之前）就装不下——都已报给玩家，
// 等他定。
//
// 图不再要求多宽（方案作废了「宽度贴满内容区」，字放大让出去的高度就是从图那儿来的）；每一档量到的图宽
// 照样印在后面，给人看。
// ---------------------------------------------------------------------------
const SIZES = [
  [402, 875, true], [390, 844, true], [360, 740, true], [320, 568, true], [1440, 900, false],
  [844, 390, true], [812, 375, true], [740, 360, true], [667, 375, true],
];
for (const [w, h, touch] of SIZES) {
  for (const lang of Object.keys(L)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
    await ctx.addInitScript(SEED, lang);
    const page = await ctx.newPage();
    await endARun(page);
    const hasTip = await page.evaluate(() => !!document.querySelector('#endBreakdown .end-row--tip'));
    check(`⑤ ${w}×${h} ${lang}：（尺子）真打的这一局是头一回出综合分，说明那一句在`, hasTip);
    for (const variant of ['头一局', '没勾', '有勾', '有勾·四位数']) {
      const bad = await page.evaluate(async ([variant, landscape, stampSvg, badges]) => {
        const ov = document.getElementById('endOverlay');
        /** 分数摆成滚筒滚完的样子（engine/odometer.ts），一位一格——位数决定左边那一栏多宽。 */
        const setScore = (text) => {
          const host = document.getElementById('endScore');
          host.classList.add('odometer');
          host.textContent = '';
          for (const ch of text) {
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
        };
        if (variant !== '头一局') document.querySelector('#endBreakdown .end-row--tip')?.remove();
        if (variant.startsWith('有勾')) {
          // gameController 的 stampEndCheck 挂的就是这两个类：有勾、四位数以上的综合分。
          ov.classList.add('end--stamp');
          const four = variant === '有勾·四位数';
          ov.classList.toggle('end--wide-score', four);
          setScore(four ? '1286' : '430');
          const st = document.getElementById('endStamp');
          st.innerHTML = stampSvg;
          st.classList.add('end-stamp--drawn');
          document.getElementById('endBadges').innerHTML = badges.map((b) => `<span class="end-badge">${b}</span>`).join('');
        }
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const out = [];
        const m = document.querySelector('#endOverlay .modal').getBoundingClientRect();
        const box = (e) => (typeof e === 'string' ? document.querySelector(e) : e)?.getBoundingClientRect() || null;
        const head = document.querySelector('#endOverlay .end-head');
        const img = box('#endShareImg');
        if (m.top < -0.5 || m.left < -0.5 || m.bottom > innerHeight + 0.5 || m.right > innerWidth + 0.5) out.push('窗出屏');
        const inside = (r) => r.left >= m.left - 0.5 && r.right <= m.right + 0.5 && r.top >= m.top - 0.5 && r.bottom <= m.bottom + 0.5;
        for (const [k, s] of [['抬头', '#endOverlay .end-head'], ['图那一块', '#endOverlay .end-body'], ['键', '#endOverlay .end-actions'], ['图', '#endShareImg']]) if (!inside(box(s))) out.push(k + '出窗');
        // 方案点名的那几样两两不相交：标题、分数、徽章、勾、明细、分享图、三颗键。
        const blocks = [['标题', box('#endTitle')], ['分数', box('#endScore')], ['明细', box('#endBreakdown')], ['图', img],
          ...[...document.querySelectorAll('#endBadges .end-badge')].map((e, i) => ['徽章' + (i + 1), box(e)]),
          ...[...document.querySelectorAll('#endOverlay .end-actions > button')].map((e) => [e.id, box(e)]),
          ...(variant === '有勾' ? [['勾', box('#endStamp')]] : [])];
        const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) if (overlap(blocks[i][1], blocks[j][1])) out.push(`${blocks[i][0]}压${blocks[j][0]}`);
        if (!landscape && box('#endOverlay .end-body').top < head.getBoundingClientRect().bottom - 0.5) out.push('图那一块压抬头');
        // 抬头没被裁：方案原话量的是纵向（scrollHeight ≤ clientHeight + 1）。横向另量「每一块都没伸出窗边」——
        // 有勾那一种右边那一栏会压进窗的右内边距一点（中文两枚徽章并排，见 style.css 的 .end--stamp .end-badges），
        // Chrome 把内边距也算进 scrollWidth，那不是被裁；伸出窗边才是。
        if (head.scrollHeight > head.clientHeight + 1) out.push(`抬头被裁（${head.scrollHeight} / ${head.clientHeight}）`);
        for (const e of head.querySelectorAll('#endScore, #endStamp, .end-badge, .end-row > span')) {
          const r = e.getBoundingClientRect();
          if (r.width > 0 && (r.left < m.left - 0.5 || r.right > m.right + 0.5)) { out.push('伸出窗边：' + (e.id || e.className || e.textContent.trim().slice(0, 12))); break; }
        }
        for (const e of document.querySelectorAll('#endOverlay .modal, #endOverlay .end-body')) if (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) out.push('有内容被裁：' + e.className);
        for (const row of document.querySelectorAll('#endBreakdown .end-row')) {
          const r = row.getBoundingClientRect();
          if (r.right > m.right - 4 || r.left < m.left + 4) out.push('明细贴边');
        }
        for (const id of ['restartBtn', 'shareBtn', 'endBackBtn']) {
          const r = document.getElementById(id).getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !hit.closest('#' + id)) out.push(id + '点不到');
        }
        const fs = getComputedStyle(document.getElementById('endBreakdown')).fontSize;
        if (fs !== '14px') out.push('明细字号 ' + fs);
        return { out, img: Math.round(img.width) };
      }, [variant, w > h && h <= 560, STAMP_SVG, badgeText(lang)]);
      check(`⑤ ${w}×${h} ${lang} ${variant}：装得下、谁也不压谁、抬头没被裁、三颗键点得到、明细 14px`, bad.out.length === 0,
        [...bad.out, `图 ${bad.img} 宽`].join(' | '));
    }
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
