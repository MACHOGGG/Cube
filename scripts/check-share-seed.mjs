/**
 * 分享卡上那一行「代号 XXXX-XXXX」（第 19 推；10-08 方案 3-I 起按设计图摆）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8975 dist
 *   node scripts/check-share-seed.mjs http://localhost:8975/
 *
 * 方案原话（第 19 推）：「二维码说明下方加『种子 XXXX-XXXX』……每日挑战再加『· 每日 MM/DD』……旧记录没有
 * 种子就不画」。10-08 方案 3-I 起单人那张卡照玩家的设计图画：二维码底下一窄条，第一行「扫码来 Slides～」、
 * 第二行「代号 XXXX-XXXX」（设计图上就是这两行）；每日挑战那一局「每日 MM/DD」连在第二行放不下那一窄条，
 * 另起第三行（shareCard.ts 的 seedLinesOf）。明细那一列从卡上撤了（结算弹窗上一行一行摆着），所以从前
 * 「种子那一行要在明细第一行上面、两行不叠」那几条没有对象了。
 *
 * 这张卡是画在画布上再导出成 PNG 的，所以照 check-share-end 的办法量像素：往本机存档里塞三份造好的局
 * （带种子、带种子又是每日挑战、老档没有种子），从成绩页点开那张图，把 PNG 解回画布，看二维码底下那一
 * 窄条（卡片坐标 x 440–700、y 285–400）切出几行字：
 *
 *   · 带种子：两行（说明、代号），第二行在第一行底下、不叠；
 *   · 每日挑战：三行（多出「每日 10/03」那一行）；
 *   · 老档：一行（只有说明）。
 *   · 三张图上那几行都是深红 #943D40（和结算弹窗上的分数同一支），居中在二维码的中线上。
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
 * 二维码底下那一窄条（卡片坐标 x 440–700、y 285–400）切成一行一行的字，每一行报它的上下沿、中线，
 * 和字身是不是那支深红。底色 #FFEDC8，离它远的就是墨；先按「有墨」把一行一行切出来（中间空一两排也
 * 算同一行——汉字上下两笔之间会断开），再看每一行的字身离 #943D40 近不近。
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
      const X0 = Math.round(440 * k), X1 = Math.round(700 * k);
      const Y0 = Math.round(285 * k), Y1 = Math.round(400 * k);
      const w = X1 - X0, h = Y1 - Y0;
      const d = g.getImageData(X0, Y0, w, h).data;
      const ink = (i) => Math.abs(d[i] - 0xff) + Math.abs(d[i + 1] - 0xed) + Math.abs(d[i + 2] - 0xc8) > 60;
      const red = (i) => Math.abs(d[i] - 0x94) <= 24 && Math.abs(d[i + 1] - 0x3d) <= 24 && Math.abs(d[i + 2] - 0x40) <= 24;
      const rows = [];
      for (let y = 0; y < h; y++) {
        let n = 0, r = 0, left = Infinity, right = -Infinity;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (!ink(i)) continue;
          n++;
          if (red(i)) r++;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
        rows.push({ n, r, left, right });
      }
      const lines = [];
      let cur = null, gap = 0;
      for (let y = 0; y < h; y++) {
        const row = rows[y];
        if (row.n >= 2) {
          if (!cur) cur = { top: y, bottom: y, n: 0, r: 0, left: Infinity, right: -Infinity };
          cur.bottom = y;
          cur.n += row.n;
          cur.r += row.r;
          cur.left = Math.min(cur.left, row.left);
          cur.right = Math.max(cur.right, row.right);
          gap = 0;
        } else if (cur) {
          gap++;
          if (gap > 3) { lines.push(cur); cur = null; }
        }
      }
      if (cur) lines.push(cur);
      const u = (v, o) => Math.round(((v + o) / k) * 10) / 10;
      res(lines.map((l) => ({
        top: u(l.top, Y0), bottom: u(l.bottom, Y0), mid: u((l.left + l.right) / 2, X0), width: u(l.right - l.left, 0),
        red: l.r / l.n,
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
const show = (ls) => (ls ? ls.map((l) => `${l.top}-${l.bottom}(中 ${l.mid} 宽 ${l.width} 红 ${(l.red * 100).toFixed(0)}%)`).join(' ') : '没拿到图');
// 二维码在卡片坐标 465–681，中线 573。
const centred = (ls) => !!ls && ls.every((l) => Math.abs(l.mid - 573) <= 4);
const stacked = (ls) => !!ls && ls.every((l, i) => i === 0 || l.top > ls[i - 1].bottom + 2);
const allRed = (ls) => !!ls && ls.every((l) => l.red >= 0.3);

check('（尺子）三张图都切得出字：二维码底下至少有一行（那句说明）', !!plain?.length && !!daily?.length && !!old?.length,
  `带种子 ${show(plain)} ｜ 每日 ${show(daily)} ｜ 老档 ${show(old)}`);
check('带种子：二维码底下两行（说明、代号），上下不叠', plain?.length === 2 && stacked(plain), show(plain));
check('每日挑战：三行（多出「每日 10/03」那一行，「代号」那一行放不下它），上下不叠', daily?.length === 3 && stacked(daily), show(daily));
check('每日挑战：代号那一行和不是每日的那张一样宽（每日那一截没挤进同一行）',
  plain?.length === 2 && daily?.length === 3 && Math.abs(plain[1].width - daily[1].width) <= 2, `${plain?.[1]?.width} / ${daily?.[1]?.width}`);
check('老档没有种子：只有那一行说明', old?.length === 1, show(old));
check('三张图上这几行都居中在二维码的中线上（±4）', centred(plain) && centred(daily) && centred(old), `${show(plain)} ｜ ${show(daily)} ｜ ${show(old)}`);
check('这几行都是那支深红 #943D40（设计图上的颜色）', allRed(plain) && allRed(daily) && allRed(old), `${show(plain)} ｜ ${show(daily)}`);

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
