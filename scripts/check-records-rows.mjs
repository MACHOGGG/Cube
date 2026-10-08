/**
 * 成绩页两块面板一套行高、一套行距（2026-10-08 方案 3-C-2）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8979 dist
 *   node scripts/check-records-rows.mjs http://localhost:8979/
 *
 * 方案原话：「成绩/排行榜行距统一：行高、行间距收敛为共用 CSS 变量（--rec-row-h、--rec-row-gap），
 * 两板块一套数值；行高现值 ×1.3 起步，行间距压到 0–4px，字体随行高等比放大居中。」
 *
 * 从前两块的六格高度是共用的（--slot-h，30px），缝却各算各的：手机上 space-between 摊出来，
 * 390×844 上一道缝 29px；电脑上右栏也摊开。字号也是两块各写各的。这道门量的就是这几样，两块
 * 面板放在一起量：
 *
 *   ① 十二格一样高，而且就是 --rec-row-h 那个数（变量真的在管它，不是另有一条规则顶着）；
 *   ② 行高是原来 30px 的 1.3 倍（39）——360×740 那一档除外：39 的话六格装不下，整页要往下滑，
 *      而「一屏不滑」是第 18 推定的、check-page-exit 守着的。那一档退到 1.1 倍（33），⑥ 量它真
 *      的没滑；
 *   ③ 每一道缝都在 0–4px，两块面板的缝一样（≤0.5px）；
 *   ④ 字跟着行高等比放大：每一格里的名字、分数、名次、行首小图形，量到的大小 ＝ 原来的大小 ×
 *      （行高 ÷ 30），±0.3px；
 *   ⑤ 居中：每一格里的字和小图形，竖着的中线和这一格的中线差不过 1px；
 *   ⑥ 手机三档一屏装得下（scrollHeight ≤ innerHeight）。
 *
 * 两种状态都量：没登录（左边六道空格子、右边六格只写名次的灰杠）和登录了、有三局、榜上有三个人
 * （左右各三格真东西 ＋ 三格补位）。量字号和居中只看真东西那几格——空格子里没有字。两种语言：
 * 简体和法文（法文那句脚注三行，最长）。
 *
 * 每一条都带尺子：六格真的量到了、真东西那几格真的有字，不然「一格都没有」也会全绿。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8979/';
const SIZES = [
  { n: '360×740', w: 360, h: 740, phone: true },
  { n: '390×844', w: 390, h: 844, phone: true },
  { n: '430×932', w: 430, h: 932, phone: true },
  { n: '1280×800', w: 1280, h: 800, phone: false },
  { n: '1512×982', w: 1512, h: 982, phone: false },
].filter((z) => !process.env.ONLY_SIZE || String(z.w) === process.env.ONLY_SIZE);
const LANGS = ['zhHans', 'fr'];

/** 改之前的那一格：30px。 */
const OLD_ROW = 30;
/**
 * 改之前每样东西在 30px 那一格里的大小（style.css 缩略牌那一段，16px 根字号）。④ 量的是「现在 ＝
 * 这个 × 行高 / 30」。
 */
const OLD_SIZE = {
  'records-row-name': 0.76 * 16,
  'records-row-score': 0.78 * 16,
  'rank-name': 0.78 * 16,
  'rank-score': 0.78 * 16,
  'rank-place': 0.72 * 16,
  'records-row-glyph': 18,
  'rank-glyph': 16,
};
/** 哪一档量 1.3 倍、哪一档量 1.1 倍（见文件头 ②）。 */
const wantRow = (size) => (size.h <= 772 ? OLD_ROW * 1.1 : OLD_ROW * 1.3);

const VERSION = /SCORING_RULES_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8'),
)[1];
const RUNS_KEY = `sugarcube_best_${VERSION}::runs`;
const SEED = {
  active: true, channel: 'code', until: Date.UTC(2999, 0, 1),
  email: 'hdl:' + 'b'.repeat(64), handle: 'RowProbe7k2m', token: 'probe-token',
};
const runs = () => Array.from({ length: 3 }, (_, i) => ({
  at: Date.now() - i * 3600e3, start: null, end: null,
  data: { shapeId: i % 2 ? 'circle' : 'square', shapeFallback: '方块', modeKey: 'base', totalScore: 120 + i * 37, at: Date.now() - i * 3600e3 },
}));
const BOARD = {
  mode: '', players: 9, me: { rank: 2, score: 940 },
  rows: [
    { rank: 1, name: 'Zoey', score: 1200, mode: 'square' },
    { rank: 2, name: 'me', score: 940, mode: 'circle', me: true },
    { rank: 3, name: 'Dray', score: 610, mode: 'square' },
  ],
};

let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  — ${extra}` : ''}`);
};
const spread = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function openRecords(size, lang, signedIn) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, reducedMotion: 'reduce' });
  // 榜和云端战绩都在浏览器里拦下来：门量的是排版，不是服务器。
  await ctx.route('**/api/scores', async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || '{}');
    } catch {}
    if (body.action === 'board') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, runs: 0, best: {}, archive: [] }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  // 开机那一次清档（engine/wipeOldRules.ts）跑完之后再放局进去，不然会被它一起清掉。
  await page.evaluate(([l, s, key, r]) => {
    localStorage.setItem('slides_lang', l);
    localStorage.setItem('slides_intro_seen', '1');
    if (s) localStorage.setItem('slides_genius', JSON.stringify(s));
    else localStorage.removeItem('slides_genius');
    if (r) localStorage.setItem(key, JSON.stringify(r));
  }, [lang, signedIn ? SEED : null, RUNS_KEY, signedIn ? runs() : null]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  await page.click('#navRecords');
  await page.waitForSelector('.records-page .records-rule, .records-page .records-row', { timeout: 10000 });
  if (signedIn) {
    await page.waitForFunction(() => document.querySelectorAll('.records-panel--ranks > .rank-row:not(.rank-row--empty)').length >= 3, null, { timeout: 8000 }).catch(() => {});
  } else {
    await page.waitForFunction(() => document.querySelectorAll('.records-panel--ranks > .rank-row').length >= 6, null, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

const MEASURE = () => {
  const box = (e) => {
    const b = e.getBoundingClientRect();
    return { t: b.top, b: b.bottom, h: b.height, w: b.width, cy: (b.top + b.bottom) / 2 };
  };
  const PARTS = '.records-row-name, .records-row-score, .records-row-glyph, .rank-place, .rank-name, .rank-score, .rank-glyph';
  const rows = (sel) => [...document.querySelectorAll(sel)].map((row) => ({
    ...box(row),
    real: row.classList.contains('records-row') || (row.classList.contains('rank-row') && !row.classList.contains('rank-row--empty') && !row.classList.contains('rank-row--ghost')),
    parts: [...row.querySelectorAll(PARTS)]
      .filter((e) => e.getBoundingClientRect().height > 0.5)
      .map((e) => {
        const cls = [...e.classList].find((c) => /^(records-row-|rank-)/.test(c));
        const glyph = /glyph/.test(cls);
        // 小图形量它画出来的那块（svg），字量它那一行的框。
        const g = glyph ? (e.querySelector('svg') || e) : e;
        return { cls, size: glyph ? box(g).h : parseFloat(getComputedStyle(e).fontSize), ...box(g), text: e.textContent.trim() };
      }),
  }));
  const host = document.querySelector('.records-panel--records');
  const cs = host ? getComputedStyle(host) : null;
  return {
    rec: rows('.records-panel--records > .records-row, .records-panel--records > .records-rule'),
    rank: rows('.records-panel--ranks > .rank-row'),
    varH: cs ? parseFloat(cs.getPropertyValue('--rec-row-h')) : NaN,
    varGap: cs ? parseFloat(cs.getPropertyValue('--rec-row-gap')) : NaN,
    scrollH: document.documentElement.scrollHeight, vh: innerHeight,
  };
};

for (const size of SIZES) {
  console.log(`\n━━ ${size.n} ━━`);
  for (const lang of LANGS) {
    for (const signedIn of [false, true]) {
      const tag = `${size.n} ${lang} ${signedIn ? '有三局、榜上三人' : '没登录'}`;
      const { ctx, page, errors } = await openRecords(size, lang, signedIn);
      const m = await page.evaluate(MEASURE);
      const all = [...m.rec, ...m.rank];
      check(`${tag}：（尺子）两块各量到六格`, m.rec.length === 6 && m.rank.length === 6, `${m.rec.length} / ${m.rank.length}`);
      if (m.rec.length !== 6 || m.rank.length !== 6) {
        await ctx.close();
        continue;
      }
      // ① 十二格一样高，就是 --rec-row-h
      const hs = all.map((r) => r.h);
      check(`${tag}：① 十二格一样高（≤0.5px）`, spread(hs) <= 0.5, hs.map((h) => h.toFixed(1)).join(' '));
      check(`${tag}：① 行高就是 --rec-row-h`, Number.isFinite(m.varH) && Math.abs(hs[0] - m.varH) <= 0.5, `${hs[0].toFixed(1)} / 变量 ${m.varH}`);
      // ② 1.3 倍（矮屏 1.1 倍）
      const want = wantRow(size);
      check(`${tag}：② 行高 ≥ ${want.toFixed(0)}px（原来 ${OLD_ROW} 的 ${(want / OLD_ROW).toFixed(1)} 倍）`, hs[0] >= want - 0.5, `${hs[0].toFixed(1)}px`);
      // ③ 缝 0–4px，两块一样
      const gaps = (rs) => rs.slice(1).map((r, i) => r.t - rs[i].b);
      const gRec = gaps(m.rec);
      const gRank = gaps(m.rank);
      const gAll = [...gRec, ...gRank];
      check(`${tag}：③ 每道缝都在 0–4px`, gAll.every((g) => g >= -0.5 && g <= 4.5), `左 ${gRec.map((g) => g.toFixed(1)).join('/')}；右 ${gRank.map((g) => g.toFixed(1)).join('/')}`);
      check(`${tag}：③ 两块面板的缝一样（≤0.5px）`, spread(gAll) <= 0.5, `差 ${spread(gAll).toFixed(2)}px`);
      check(`${tag}：③ 缝就是 --rec-row-gap`, Number.isFinite(m.varGap) && Math.abs(gAll[0] - m.varGap) <= 0.5, `${gAll[0].toFixed(1)} / 变量 ${m.varGap}`);
      // ④ ⑤ 只看真东西那几格
      if (signedIn) {
        const real = all.filter((r) => r.real);
        const parts = real.flatMap((r) => r.parts.map((p) => ({ ...p, row: r })));
        const kinds = new Set(parts.map((p) => p.cls));
        check(`${tag}：（尺子）真东西有六格，名字、分数、名次、小图形都量到了`,
          real.length === 6 && ['records-row-name', 'records-row-score', 'records-row-glyph', 'rank-place', 'rank-name', 'rank-score', 'rank-glyph'].every((k) => kinds.has(k)) &&
            parts.filter((p) => !/glyph/.test(p.cls)).every((p) => p.text.length > 0),
          `${real.length} 格；${[...kinds].join(' ')}`);
        const k = hs[0] / OLD_ROW;
        const off = parts
          .filter((p) => OLD_SIZE[p.cls] !== undefined)
          .map((p) => ({ cls: p.cls, got: p.size, want: OLD_SIZE[p.cls] * k }))
          .filter((x) => Math.abs(x.got - x.want) > (x.cls.includes('glyph') ? 0.6 : 0.3));
        check(`${tag}：④ 字和小图形跟着行高等比放大（× ${k.toFixed(2)}）`, off.length === 0,
          off.slice(0, 4).map((x) => `${x.cls} ${x.got.toFixed(2)} / 应为 ${x.want.toFixed(2)}`).join('；'));
        const skew = parts.map((p) => ({ cls: p.cls, d: Math.abs(p.cy - p.row.cy) })).filter((x) => x.d > 1);
        check(`${tag}：⑤ 每一格里的字和小图形竖着居中（≤1px）`, skew.length === 0,
          skew.slice(0, 4).map((x) => `${x.cls} 偏 ${x.d.toFixed(1)}px`).join('；'));
      }
      // ⑥ 手机一屏装下
      if (size.phone) {
        check(`${tag}：⑥ 一屏装下，不用滑`, m.scrollH <= m.vh, `${m.scrollH} / ${m.vh}`);
      }
      check(`${tag}：没有报错`, errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
  }
}

await browser.close();
console.log(`\n${pass} 过，${fail} 红`);
process.exit(fail ? 1 : 0);
