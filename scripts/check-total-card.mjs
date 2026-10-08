/**
 * 成绩页上那张累计得分卡（2026-10-08 方案 3-C-3）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8978 dist
 *   node scripts/check-total-card.mjs http://localhost:8978/
 *
 * 方案原话：「累计得分：数字放大（重测长数字自动缩写阈值）；点开大卡不出底部退出按钮；成绩与
 * 排名两板块下方固定一颗居中《退出》，尺寸用 3-F 的统一 token；两板块整体上移微收给它留位。」
 *
 * 后两件（《退出》的尺寸和位置、点开的大卡底下没有它、面板底贴着它上沿 16px）由
 * check-page-exit 量。这道门量另外三件：
 *
 *   ① 数字放大：短数字的字号是 48px（3rem，原来 2.3rem 的 1.3 倍），卡片本身不长高（76px 上
 *      下，和放大之前一样——不然底下两块面板就得往下让，360×740 上六格装不下）；
 *   ② 重测缩写阈值：卡上那个数先经 engine/compactScore 缩写，再由 recordsPage 的 scoreFontSize
 *      按字数挑字号。放大之后挑一串真会出现的总分——0、几百、十万上下、一亿上下、一千多亿、
 *      Number.MAX_SAFE_INTEGER——在 320 到 1280 宽、四种语言下各摆一遍：**一行、不出卡**。
 *      哪一档在哪个宽度上折了行或伸出卡外，这儿就红，那就是阈值或字号该动了；
 *   ③ 两块面板整体上移：手机上面板的上沿比从前（239）高 12px——招牌底下那道空收了。
 *
 * 尺子：最长那一串真的有 8 个字以上（不然「都装得下」是白给的），而且十万以上的真的缩写了。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8978/';
const SIZES = [
  { n: '320×700', w: 320, h: 700, phone: true },
  { n: '360×740', w: 360, h: 740, phone: true },
  { n: '390×844', w: 390, h: 844, phone: true },
  { n: '430×932', w: 430, h: 932, phone: true },
  { n: '1280×800', w: 1280, h: 800, phone: false },
].filter((z) => !process.env.ONLY_SIZE || String(z.w) === process.env.ONLY_SIZE);
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
const TOTALS = [0, 471, 99999, 100000, 999999, 99999999, 100000000, 123456789012, Number.MAX_SAFE_INTEGER];

/** 放大之后短数字的字号（3rem）和从前的（2.3rem）。 */
const FONT_NOW = 48;
const FONT_OLD = 2.3 * 16;
/** 放大之前量到的卡高、面板上沿（手机三档一样）。 */
const CARD_H_OLD = 76.3;
const PANEL_TOP_OLD = 239;

const VERSION = /SCORING_RULES_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8'),
)[1];
const RUNS_KEY = `sugarcube_best_${VERSION}::runs`;
const run = (score) => [{
  at: Date.now() - 3600e3, start: null, end: null,
  data: { shapeId: 'square', shapeFallback: '方块', modeKey: 'base', totalScore: score, at: Date.now() - 3600e3 },
}];

let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  — ${extra}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const MEASURE = () => {
  const card = document.querySelector('.records-page .total-card');
  const v = document.querySelector('.records-page .total-card-value');
  if (!card || !v) return null;
  const cb = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const inner = { l: cb.left + parseFloat(cs.paddingLeft), r: cb.right - parseFloat(cs.paddingRight) };
  const range = document.createRange();
  range.selectNodeContents(v);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
  const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
  const tb = range.getBoundingClientRect();
  const panel = document.querySelector('.records-panel--records')?.getBoundingClientRect();
  return {
    text: v.textContent, font: parseFloat(getComputedStyle(v).fontSize),
    lines: tops.length, textL: tb.left, textR: tb.right, textW: tb.width, innerL: inner.l, innerR: inner.r,
    cardH: cb.height, panelTop: panel ? panel.top : null,
  };
};

for (const size of SIZES) {
  console.log(`\n━━ ${size.n} ━━`);
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
    await page.evaluate((l) => {
      localStorage.setItem('slides_lang', l);
      localStorage.setItem('slides_intro_seen', '1');
    }, lang);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
    const seen = [];
    for (const total of TOTALS) {
      // 开机那一次清档（engine/wipeOldRules.ts）跑完之后才塞。「上次看到的总分」每次清掉：变了
      // 才滚的那个里程表一滚，量到的就是滚到一半的数（reducedMotion 下它本来也不滚，两道保险）。
      await page.evaluate(([key, r]) => {
        localStorage.setItem(key, JSON.stringify(r));
        localStorage.removeItem('slides_total_seen');
      }, [RUNS_KEY, run(total)]);
      await page.click('#navRecords');
      await page.waitForSelector('.records-page .total-card-value', { timeout: 10000 });
      await page.waitForTimeout(120);
      const m = await page.evaluate(MEASURE);
      const tag = `${size.n} ${lang} 总分 ${total}`;
      check(`${tag}：（尺子）量到了那张卡`, !!m);
      if (!m) break;
      seen.push({ total, ...m });
      check(`${tag}：② 一行（「${m.text}」）`, m.lines === 1, `${m.lines} 行，字号 ${m.font}px`);
      check(`${tag}：② 不出卡（字宽 ${m.textW.toFixed(0)} / 卡里 ${(m.innerR - m.innerL).toFixed(0)}）`,
        m.textL >= m.innerL - 0.5 && m.textR <= m.innerR + 0.5, `「${m.text}」字号 ${m.font}px`);
      if (total >= 1e5) {
        check(`${tag}：（尺子）十万以上真的缩写了`, /[万萬亿億KMB]$/.test(m.text), `「${m.text}」`);
      }
      if (String(total).length <= 7 && total < 1e5) {
        // ① 短数字：放大到 48px，卡不长高
        check(`${tag}：① 短数字的字号是 ${FONT_NOW}px（原来 ${FONT_OLD.toFixed(1)}px 的 ${(FONT_NOW / FONT_OLD).toFixed(2)} 倍）`, Math.abs(m.font - FONT_NOW) <= 0.2, `${m.font}px`);
        check(`${tag}：① 卡片没长高（${CARD_H_OLD} 上下）`, Math.abs(m.cardH - CARD_H_OLD) <= 1.5, `${m.cardH.toFixed(1)}px`);
      }
      // ③ 只在短数字（≤ 7 个字，48px 那一档）上量：再长的一档字号小一号，卡跟着矮一截，面板
      // 还会再往上挪——那是从前就有的（scoreFontSize 按字数挑字号），不是这一条要守的。
      if (size.phone && m.panelTop !== null && m.text.length <= 7) {
        check(`${tag}：③ 两块面板整体上移（上沿比从前的 ${PANEL_TOP_OLD} 高 12px）`, Math.abs(m.panelTop - (PANEL_TOP_OLD - 12)) <= 1, `${m.panelTop.toFixed(1)}`);
      }
      await page.click('#recordsBack');
      await page.waitForSelector('.home-icon-btn', { timeout: 10000 });
    }
    const longest = seen.reduce((a, b) => (b.text.length > a.text.length ? b : a), seen[0] || { text: '' });
    check(`${size.n} ${lang}：（尺子）最长那一串有 8 个字以上`, longest.text.length >= 8, `「${longest.text}」`);
    check(`${size.n} ${lang}：没有报错`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${pass} 过，${fail} 红`);
process.exit(fail ? 1 : 0);
