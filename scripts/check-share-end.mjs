/**
 * 战绩图里「结束」那一格画的是不是真正剩下的东西。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-share-end.mjs http://localhost:8817/
 *
 * 玩家报的：方块那一档可以消到只剩一枚，而分享出去的图里这一枚缩在左上角
 * 自己那格里，看着像是没打完。原因是存下来的那份快照包含消掉的格子（画成
 * 一圈淡淡的空框），包围盒于是永远是整副棋盘。
 *
 * 现在剩下的按它们自己的范围重新铺满那一格。这里就照这个量：往本地记录里
 * 塞三份造好的结局——只剩一枚、横着剩三枚、一枚不剩——点开战绩图，把导出的
 * PNG 解回画布，数「结束」那一格里那个颜色占了多大、落在哪儿。
 *
 * 量像素而不是量代码：这张图是画出来的，画错位置代码照样跑得通。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 方块那一档的存档键，和 square.ts 里写的是同一个。
const BEST_KEY = 'sugarcube_best';
const MARK = '#B23A3A'; // 造的那几枚用这一支，好在图里认出来

/** 一份 6×6 的方块结局：alive 里的格子是活的，其余全是消掉的空框。 */
function makeRun(alive) {
  const cells = [];
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++) {
      const live = alive.some(([ar, ac]) => ar === r && ac === c);
      cells.push({
        kind: 'rect',
        cx: (c + 0.5) / 6,
        cy: (r + 0.5) / 6,
        half: 0.5 / 6 - 0.006,
        face: live ? 'flavor' : 'blank',
        color: MARK,
      });
    }
  return {
    at: Date.now(),
    data: {
      shapeId: 'square', shapeFallback: '方块', modeKey: 'base',
      totalScore: 1234, score: 900, ratePercent: 72, bonusMult: 1.2,
      elapsedSec: 61, moves: 12, best: 1234, reason: 'cleared',
      neverFlipped: 0, unflippedScale: 1, timeMult: 1.1,
      patternPoints: 700, comboBonusPoints: 120, linePoints: 80,
      extraPenalty: 0, extraPenaltyReason: '', hazardEnd: false, at: Date.now(),
    },
    start: { cells: cells.map((c) => ({ ...c, face: 'flavor' })) },
    end: { cells },
  };
}

/** 导出的那张 PNG 里，「结束」那一格的样子。坐标照 shareCard 里那几个常数。 */
const SAMPLE = () => {
  const img = document.querySelector('.overlay--top .share-modal img');
  if (!img) return Promise.resolve(null);
  return new Promise((res) => {
    const probe = new Image();
    probe.onload = () => {
      const k = probe.naturalWidth / 720; // 卡片的逻辑宽度是 720
      const c = document.createElement('canvas');
      c.width = probe.naturalWidth;
      c.height = probe.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(probe, 0, 0);
      const PAD = 80, gap = 28, boardY = 300;
      const panel = (720 - PAD * 2 - gap) / 2;
      const x = Math.round((PAD + panel + gap) * k);
      const y = Math.round(boardY * k);
      const w = Math.round(panel * k);
      const d = g.getImageData(x, y, w, w).data;
      let hits = 0, dark = 0;
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % w;
        const py = Math.floor((i / 4) / w);
        // 造的那一支是 #B23A3A
        if (Math.abs(d[i] - 0xB2) < 12 && Math.abs(d[i + 1] - 0x3A) < 12 && Math.abs(d[i + 2] - 0x3A) < 12) {
          hits++;
          if (px < l) l = px; if (px > r) r = px;
          if (py < t) t = py; if (py > b) b = py;
        }
        // 底是 #f0ece4，字是 #8b8680——比底暗一大截的就算字
        if (d[i] < 0xB0 && d[i + 1] < 0xB0 && d[i + 2] < 0xB0) dark++;
      }
      const R = (n) => Math.round(n * 1000) / 1000;
      res({
        size: w,
        fill: R(hits / (w * w)),
        dark: R(dark / (w * w)),
        box: hits ? { l, t, r, b } : null,
        // 左右、上下的留白差：居中的话两边一样
        offX: hits ? R((l - (w - 1 - r)) / w) : null,
        offY: hits ? R((t - (w - 1 - b)) / w) : null,
      });
    };
    probe.onerror = () => res(null);
    probe.src = img.getAttribute('src');
  });
};

async function cardFor(page, run) {
  await page.addInitScript(
    ([key, r]) => {
      for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
        localStorage.setItem(k, '1');
      localStorage.setItem('slides_lang', 'zhHans');
      localStorage.setItem(key, '1234');
      localStorage.setItem(key + '::runs', JSON.stringify([r]));
    },
    [BEST_KEY, run],
  );
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navRecords', { timeout: 20000 });
  await page.click('#navRecords');
  await page.waitForSelector('#recordsPanel', { timeout: 10000 });
  await page.click('#recordsPanel');
  await page.waitForTimeout(500);
  // 展开的面板里，每条记录点开就是那张图
  await page.click('.center-pick .records-row');
  await page.waitForSelector('.overlay--top .share-modal img', { timeout: 10000 });
  await page.waitForTimeout(400);
  return page.evaluate(SAMPLE);
}

const CASES = [
  { name: '只剩一枚', alive: [[0, 0]], minFill: 0.55 },
  { name: '横着剩三枚', alive: [[2, 1], [2, 2], [2, 3]], minFill: 0.2 },
  { name: '一枚不剩', alive: [], minFill: 0 },
];

for (const cs of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const m = await cardFor(page, makeRun(cs.alive)).catch((e) => ({ err: String(e).slice(0, 120) }));
  await ctx.close();
  if (!m || m.err) {
    check(`${cs.name}：出得了图`, false, m?.err || '没拿到图');
    continue;
  }
  if (!cs.alive.length) {
    check('一枚不剩：那一格里没有棋子', m.fill < 0.001, `占了 ${(m.fill * 100).toFixed(1)}%`);
    check('一枚不剩：写上了《全部消除》', m.dark > 0.002, `深色像素 ${(m.dark * 100).toFixed(2)}%`);
    continue;
  }
  check(`${cs.name}：铺满了那一格`, m.fill >= cs.minFill, `占了 ${(m.fill * 100).toFixed(1)}%`);
  check(`${cs.name}：左右居中`, Math.abs(m.offX) <= 0.02, `偏 ${(m.offX * 100).toFixed(1)}%`);
  check(`${cs.name}：上下居中`, Math.abs(m.offY) <= 0.02, `偏 ${(m.offY * 100).toFixed(1)}%`);
  if (cs.alive.length === 3) {
    const wide = (m.box.r - m.box.l) / (m.box.b - m.box.t);
    check('横着剩三枚：画出来就是横着三枚', wide > 2.4 && wide < 3.6, `宽高比 ${wide.toFixed(2)}`);
  }
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);
