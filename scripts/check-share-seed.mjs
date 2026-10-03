/**
 * 分享卡上那一行「种子 XXXX-XXXX」（第 19 推）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8975 dist
 *   node scripts/check-share-seed.mjs http://localhost:8975/
 *
 * 方案原话：「二维码说明下方加『种子 XXXX-XXXX』（JetBrains Mono），每日挑战再加『· 每日 MM/DD』……
 * 旧记录没有种子就不画」。
 *
 * 这张卡是画在画布上再导出成 PNG 的，所以照 check-share-end 的办法量像素：往本机存档里塞三份造
 * 好的局（带种子、带种子又是每日挑战、老档没有种子），从成绩页点开那张图，把 PNG 解回画布，看右
 * 上角二维码说明底下那一带：
 *
 *   · 那一行用的是 #5b5650（和二维码说明同一个深灰），明细那一列是更浅的 #8b8680——按颜色就分
 *     得开「这一行」和「明细第一行」，不用猜字形；
 *   · 带种子：二维码说明底下有一行深灰的字，而且它整个在明细第一行**上面**（明细往下让了一行，
 *     两行不叠）；
 *   · 每日挑战：同一行更长（多了「· 每日 10/03」）；
 *   · 老档：那一带一个深灰像素都没有。
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8975/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const SCORING_VER = (readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8')
  .match(/SCORING_RULES_VERSION\s*=\s*'([^']+)'/) || [, ''])[1];
if (!SCORING_VER) {
  console.error('读不出 SCORING_RULES_VERSION——存档键会落空，先修这儿。');
  process.exit(2);
}
const BEST_KEY = 'sugarcube_best_' + SCORING_VER;

function makeRun(extra) {
  const cells = [];
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++) {
      cells.push({ kind: 'rect', cx: (c + 0.5) / 6, cy: (r + 0.5) / 6, half: 0.5 / 6 - 0.006, face: 'flavor', color: '#4461B8' });
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
      ...extra,
    },
    start: { cells },
    end: { cells },
  };
}

/**
 * 卡上右上角那一带（卡片坐标 x 340–640、y 140–260）切成一行一行的字，每一行报它的上下沿、左沿，
 * 和它主要是哪个颜色。
 *
 * 不按「哪个像素是什么颜色」直接下结论：字的边缘抗锯齿出来的过渡色里，深灰那一行也有不少像素落
 * 在浅灰的范围里——一行字有七百多像素宽，每一排像素上的过渡色加起来能有几十个（第一版就这样把
 * 种子那一行当成了明细第一行）。所以先按「有墨」把一行一行切出来，再看每一行里**字身**（离两种
 * 颜色都很近的那些像素）哪一种多。
 */
const SAMPLE = () => {
  const img = document.querySelector('.overlay--top .share-modal img');
  if (!img) return Promise.resolve(null);
  return new Promise((res) => {
    const probe = new Image();
    probe.onload = () => {
      const k = probe.naturalWidth / 720;
      const c = document.createElement('canvas');
      c.width = probe.naturalWidth;
      c.height = probe.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(probe, 0, 0);
      const X0 = Math.round(340 * k), X1 = Math.round(640 * k) + 2;
      const Y0 = Math.round(140 * k), Y1 = Math.round(260 * k);
      const w = X1 - X0, h = Y1 - Y0;
      const d = g.getImageData(X0, Y0, w, h).data;
      const near = (i, r, gg, b, tol) => Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - gg) <= tol && Math.abs(d[i + 2] - b) <= tol;
      // 底色 #faf9f5：离它远的就是墨。
      const ink = (i) => Math.abs(d[i] - 0xfa) + Math.abs(d[i + 1] - 0xf9) + Math.abs(d[i + 2] - 0xf5) > 60;
      const rows = [];
      for (let y = 0; y < h; y++) {
        let n = 0, dark = 0, light = 0, left = Infinity;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (!ink(i)) continue;
          n++;
          left = Math.min(left, x);
          if (near(i, 0x5b, 0x56, 0x50, 18)) dark++;
          else if (near(i, 0x8b, 0x86, 0x80, 10)) light++;
        }
        rows.push({ n, dark, light, left });
      }
      // 连着有墨的那几排像素算一行字（中间空一两排也算同一行——汉字上下两笔之间会断开）。
      const lines = [];
      let cur = null, gap = 0;
      for (let y = 0; y < h; y++) {
        const r = rows[y];
        if (r.n >= 2) {
          if (!cur) cur = { top: y, bottom: y, dark: 0, light: 0, left: Infinity };
          cur.bottom = y;
          cur.dark += r.dark;
          cur.light += r.light;
          cur.left = Math.min(cur.left, r.left);
          gap = 0;
        } else if (cur) {
          gap++;
          if (gap > 3) { lines.push(cur); cur = null; }
        }
      }
      if (cur) lines.push(cur);
      const u = (v, o) => Math.round(((v + o) / k) * 10) / 10;
      res(lines.map((l) => ({
        top: u(l.top, Y0), bottom: u(l.bottom, Y0), left: u(l.left, X0),
        tone: l.dark > l.light ? 'dark' : 'light', dark: l.dark, light: l.light,
      })));
    };
    probe.onerror = () => res(null);
    probe.src = img.getAttribute('src');
  });
};

async function cardFor(run) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
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
  await page.click('.center-pick .records-row');
  await page.waitForSelector('.overlay--top .share-modal img', { timeout: 10000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(SAMPLE);
  await ctx.close();
  return m;
}

const plain = await cardFor(makeRun({ seed: '4A4TYZXZ', seedSource: 'entered' }));
const daily = await cardFor(makeRun({ seed: '4A4TYZXZ', seedSource: 'daily', daily: '20261003' }));
const old = await cardFor(makeRun({}));
const show = (ls) => (ls ? ls.map((l) => `${l.tone}@${l.top}-${l.bottom}(左 ${l.left})`).join(' ') : '没拿到图');

/** 二维码说明（第一行深灰）之后的那几行：种子那一行（深灰）、明细第一行（浅灰）。 */
const parts = (ls) => {
  if (!ls || ls.length < 2) return null;
  const [caption, ...rest] = ls;
  const seed = rest[0]?.tone === 'dark' ? rest[0] : null;
  const firstRow = rest.find((l) => l.tone === 'light') ?? null;
  return { caption, seed, firstRow };
};
const P = parts(plain), D = parts(daily), O = parts(old);
check('（尺子）三张图都切得出字：第一行是二维码说明（深灰），后面有明细（浅灰）',
  !!P && !!D && !!O && [P, D, O].every((x) => x.caption.tone === 'dark' && !!x.firstRow),
  `带种子 ${show(plain)} ｜ 每日 ${show(daily)} ｜ 老档 ${show(old)}`);
check('带种子：二维码说明底下是一行深灰的字（种子那一行）', !!P?.seed, show(plain));
check('带种子：那一行整个在明细第一行上面（两行不叠）', !!P?.seed && P.firstRow.top > P.seed.bottom + 2,
  P?.seed ? `种子那一行 ${P.seed.top}–${P.seed.bottom} / 明细第一行顶 ${P.firstRow.top}` : '');
check('老档没有种子：二维码说明底下直接是明细（没有那一行）', !!O && !O.seed, show(old));
check('老档的明细比带种子那张高一行（带种子时明细整列往下让了 ≥ 20）', !!O && !!P && P.firstRow.top - O.firstRow.top >= 20,
  `老档 ${O?.firstRow.top} / 带种子 ${P?.firstRow.top}`);
check('每日挑战：同一行更长（多了「· 每日 10/03」，左沿往左伸出一截）', !!D?.seed && !!P?.seed && P.seed.left - D.seed.left >= 40,
  `普通 ${P?.seed?.left} / 每日 ${D?.seed?.left}`);
check('每日挑战：那一行同样整个在明细上面', !!D?.seed && D.firstRow.top > D.seed.bottom + 2, D?.seed ? `${D.seed.bottom} / ${D.firstRow.top}` : '');

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
