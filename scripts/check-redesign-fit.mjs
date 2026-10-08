/**
 * 四页改版（第 17 推）：战绩页、个人主页、帐号窗、邀请窗。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8981 dist
 *   node scripts/check-redesign-fit.mjs http://localhost:8981/
 *
 * 方案给这道门定的单子，一条不少：
 *
 *   在 4 个尺寸 × 4 种语言 × 浅色、深色、色盲三种模式下检查——
 *     · 不溢出、不重叠、不被底栏盖住；
 *     · 等距误差 ≤ 1px，居中误差 ≤ 1px；
 *     · 对比度：正文 ≥ 4.5，大字和图标 ≥ 3；
 *     · 免邮箱帐号的第一串默认遮住，并且没有「更换」按钮；
 *     · Esc 能关窗；
 *     · 图标按钮都有 aria-label；
 *     · 这四页的样式里没有写死的颜色值。
 *
 * 四个尺寸是方案点名的那一组：1512×982、1280×800（电脑两档，两栏）、390×844、360×740（手机
 * 两档，单列）。两种排布都量到，电脑端那几条按「宽 ≥ 1000」走，不按某一个宽度。
 *
 * ── 几件量法上的事 ───────────────────────────────────────────────
 *
 * 「没有写死的颜色值」量的是**浏览器里真的作用在这四页上的每一条规则**（document.styleSheets
 * 逐条过，选择器能匹配页里任何一个元素才算数，@media 只算此刻生效的），不是去 grep 源文件：
 * 源文件里一条规则属于哪一页，只有浏览器说得清（`.profile-row` 全站好几处在用）。共用的招牌
 * （`.home-head`，七页都有）不在这四页的改版范围里，跳过。
 *
 * 模式不靠重开页面，靠在 <html> 上盖属性（`data-theme="dark"`、`data-cvd="1"`）——全站的深色
 * 和色盲就是这么挂上去的（engine/themePref.ts、engine/palettePref.ts），这几页的样式只认这两
 * 个属性。深色本来是天才才挑得动的，门里直接盖，量的是「挑了之后长什么样」。
 *
 * 对比度只量**看得见、读屏念得到**的字：aria-hidden 的（邀请窗末尾那行「……」、补位的空格子）
 * 是装饰，不算。图标量的是只放图标的那几颗键里画出来的那一笔对它的底色。
 *
 * 每一条都有尺子（「真的量到了东西」），不然「一个都没有」在「这一页根本没画出来」的时候也会
 * 全绿。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8981/';
const ALL_SIZES = [
  { n: '360×740', w: 360, h: 740 },
  { n: '390×844', w: 390, h: 844 },
  { n: '1280×800', w: 1280, h: 800 },
  { n: '1512×982', w: 1512, h: 982 },
];
// 本地调试可以只跑一部分：ONLY_SIZE=390 ONLY_LANG=fr node scripts/check-redesign-fit.mjs …
// CI 里一个都不设，四个尺寸四种语言全跑。
const SIZES = ALL_SIZES.filter((z) => !process.env.ONLY_SIZE || String(z.w) === process.env.ONLY_SIZE);
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'].filter((l) => !process.env.ONLY_LANG || l === process.env.ONLY_LANG);
const MODES = ['浅色', '深色', '色盲'];
const TOL = 1;

const VERSION = /SCORING_RULES_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8'),
)[1];
const RUNS_KEY = `sugarcube_best_${VERSION}::runs`;
const HANDLE = 'UiProbey6pq9';
const handleSeed = {
  active: true, channel: 'code', until: Date.UTC(2999, 0, 1),
  email: 'hdl:' + 'a'.repeat(64), handle: HANDLE, token: 'probe-token',
};
const mailSeed = {
  active: true, channel: 'code', until: Date.UTC(2999, 0, 1),
  email: 'someone-with-a-long-address@example.com', token: 'probe-token',
};

let fail = 0;
let pass = 0;
const fails = [];
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    return;
  }
  fail++;
  const line = `FAIL  ${name}${extra ? '  ' + extra : ''}`;
  fails.push(line);
  console.log(line);
};
const sec = (t) => console.log('\n' + t);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 三个模式：只动 <html> 上那两个属性。 */
async function setMode(page, mode) {
  await page.evaluate((m) => {
    const h = document.documentElement;
    h.setAttribute('data-theme', m === '深色' ? 'dark' : 'light');
    if (m === '色盲') h.setAttribute('data-cvd', '1');
    else h.removeAttribute('data-cvd');
  }, mode);
  await page.waitForTimeout(60);
}

/**
 * 一页（或一扇窗）在当前模式下的全部量值。在页面里跑，回一个纯数据的对象。
 * `spec` 说清楚这一页有哪几组东西要比（等高、等距、居中……）。
 */
const MEASURE = ({ rootSel, groups, centered, scrollToEnd }) => {
  const root = document.querySelector(rootSel);
  if (!root) return { missing: rootSel };
  const W = innerWidth;
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    return true;
  };
  const head = root.querySelector('.home-head');
  const inScope = (el) => !(head && head.contains(el));

  // ── 颜色：解析、合成、对比度 ──
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let base = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };

  const out = { texts: [], icons: [], clipped: [], groups: {}, overflowX: document.documentElement.scrollWidth - W, outside: [] };

  // ── 字：每一个直接带字的可见元素 ──
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!inScope(el) || !visible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const bg = bgOf(el);
    const fg = over(parse(cs.color) || [0, 0, 0, 1], bg);
    const text = el.textContent.trim().slice(0, 24);
    out.texts.push({ text, ratio: +ratio(fg, bg).toFixed(2), need: large ? 3 : 4.5, size: +size.toFixed(1), bold });
    if (cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') {
      out.clipped.push(text);
    }
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.right > W + 0.5) out.outside.push(text);
  }
  // ── 键里的东西不许溢出键（药丸默认 overflow: visible，字长了会漫出去压到隔壁）──
  for (const btn of root.querySelectorAll('button, a[href]')) {
    if (!inScope(btn) || !visible(btn)) continue;
    if (btn.closest('.records-panel') && btn.matches('.records-panel')) continue; // 整块面板本身是键，量它里面的行
    if (btn.scrollWidth > btn.clientWidth + 1 || btn.scrollHeight > btn.clientHeight + 1) {
      out.clipped.push(`[键] ${(btn.id || btn.textContent.trim()).slice(0, 24)} ${btn.scrollWidth}×${btn.scrollHeight} > ${btn.clientWidth}×${btn.clientHeight}`);
    }
  }
  // ── 左右外边距相等：页里第一层那几块合起来，离外框左右一样远 ──
  // 外框：页是视口，窗是窗自己。`display: contents` 的那一层（电脑端成绩页的
  // .records-panels）自己没有盒子，往里拆一层；绝对定位的（窗右上角那颗 ✕）不算
  // 「一块内容」，跳过。
  {
    const modal = root.classList.contains('modal');
    const fr = modal ? root.getBoundingClientRect() : { left: 0, right: W };
    const pad = modal ? parseFloat(getComputedStyle(root).paddingLeft) - parseFloat(getComputedStyle(root).paddingRight) : 0;
    const kids = [];
    const take = (list) => {
      for (const kid of list) {
        if (getComputedStyle(kid).display === 'contents') take(kid.children);
        else kids.push(kid);
      }
    };
    take(root.children);
    let l = Infinity, r = -Infinity;
    for (const kid of kids) {
      if (!inScope(kid) || !visible(kid) || kid.classList.contains('home-head')) continue;
      const pos = getComputedStyle(kid).position;
      if (pos === 'absolute' || pos === 'fixed') continue;
      const b = kid.getBoundingClientRect();
      l = Math.min(l, b.left);
      r = Math.max(r, b.right);
    }
    if (Number.isFinite(l)) out.margins = +Math.abs(l - fr.left - (fr.right - r) - pad).toFixed(2);
  }
  // ── 图标：只放图标的键里画出来的那一笔，对它的底色 ──
  for (const btn of root.querySelectorAll('button, a[href]')) {
    if (!inScope(btn) || !visible(btn)) continue;
    const words = btn.textContent.trim();
    const svg = btn.querySelector('svg');
    if (!svg || words) continue;
    const bg = bgOf(btn);
    let best = 0;
    for (const shape of svg.querySelectorAll('path, rect, circle, line, polyline, polygon, ellipse')) {
      const cs = getComputedStyle(shape);
      for (const c of [cs.stroke, cs.fill]) {
        const p = parse(c);
        if (!p || p[3] === 0) continue;
        best = Math.max(best, ratio(over(p, bg), bg));
      }
    }
    out.icons.push({ id: btn.id || btn.className, ratio: +best.toFixed(2), label: btn.getAttribute('aria-label') || '' });
  }
  // ── 每一组东西的方框 ──
  for (const [name, sel] of Object.entries(groups)) {
    out.groups[name] = [...root.querySelectorAll(sel)].filter(visible).map(rect);
  }
  // ── 居中：这几个盒子左右离视口（或指定的外框）一样远 ──
  out.centered = {};
  for (const [name, [sel, frameSel]] of Object.entries(centered || {})) {
    const el = root.matches(sel) ? root : root.querySelector(sel);
    if (!el || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const f = frameSel ? (root.matches(frameSel) ? root : root.closest(frameSel) || root.querySelector(frameSel)) : null;
    const fl = f ? f.getBoundingClientRect().left : 0;
    const fr = f ? f.getBoundingClientRect().right : W;
    out.centered[name] = +Math.abs(r.left - fl - (fr - r.right)).toFixed(2);
  }
  // ── 底栏：滑到底，最后那一块离底栏还有多远 ──
  const nav = document.querySelector('.home-nav-dock');
  if (scrollToEnd && nav) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const navTop = nav.getBoundingClientRect().top;
    let lowest = -Infinity;
    for (const el of root.querySelectorAll('button, .records-panel, .genius-panel, .total-card, .legal-pair')) {
      if (!visible(el) || !inScope(el)) continue;
      lowest = Math.max(lowest, el.getBoundingClientRect().bottom);
    }
    out.navClear = +(navTop - lowest).toFixed(1);
    window.scrollTo(0, 0);
  }
  return out;
};

/** 一组方框：两两不相交（容 0.5px 的亚像素）。 */
const overlaps = (boxes) => {
  const hits = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const x = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (x > 0.5 && y > 0.5) hits.push(`${i}×${j}`);
    }
  return hits;
};
const spread = (vals) => (vals.length ? Math.max(...vals) - Math.min(...vals) : 0);
/** 竖着排的一组：相邻两个之间的缝。 */
const vgaps = (boxes) => {
  const s = [...boxes].sort((a, b) => a.t - b.t);
  return s.slice(1).map((b, i) => b.t - s[i].b);
};

/** 一页量下来的东西，逐条判。`where` 只是印出来好找。 */
function judge(where, m, rules) {
  if (m.missing) {
    check(`${where}：（尺子）页面在`, false, m.missing);
    return;
  }
  check(`${where}：（尺子）量到了字`, m.texts.length >= (rules.minTexts ?? 3), String(m.texts.length));
  check(`${where}：整页不横着溢出`, m.overflowX <= 0.5, `多 ${m.overflowX}px`);
  check(`${where}：没有字跑出屏幕`, m.outside.length === 0, m.outside.join(' / '));
  check(`${where}：没有字被裁掉`, m.clipped.length === 0, m.clipped.join(' / '));
  const badText = m.texts.filter((t) => t.ratio < t.need);
  check(
    `${where}：字的对比度（正文 ≥ 4.5，大字 ≥ 3）`,
    badText.length === 0,
    badText.slice(0, 4).map((t) => `「${t.text}」${t.ratio}<${t.need}`).join(' / '),
  );
  const badIcon = m.icons.filter((i) => i.ratio < 3);
  check(`${where}：图标的对比度 ≥ 3`, badIcon.length === 0, badIcon.map((i) => `${i.id} ${i.ratio}`).join(' / '));
  const noLabel = m.icons.filter((i) => !i.label.trim());
  check(`${where}：只放图标的键都有 aria-label`, noLabel.length === 0, noLabel.map((i) => i.id).join(' / '));
  if (m.margins !== undefined) check(`${where}：左右外边距相等（误差 ≤ ${TOL}px）`, m.margins <= TOL, `${m.margins}px`);
  for (const [name, gap] of Object.entries(m.centered)) {
    check(`${where}：${name} 居中（误差 ≤ ${TOL}px）`, gap <= TOL, `${gap}px`);
  }
  for (const [name, boxes] of Object.entries(m.groups)) {
    const r = rules.groups?.[name] || {};
    if (r.min) check(`${where}：（尺子）${name} 量到 ${r.min} 个以上`, boxes.length >= r.min, String(boxes.length));
    if (r.count) check(`${where}：${name} 正好 ${r.count} 个`, boxes.length === r.count, String(boxes.length));
    if (r.noOverlap) {
      const o = overlaps(boxes);
      check(`${where}：${name} 两两不重叠`, o.length === 0, o.join(' '));
    }
    if (r.sameH) check(`${where}：${name} 一样高`, spread(boxes.map((b) => b.h)) <= TOL, boxes.map((b) => b.h.toFixed(1)).join('/'));
    if (r.sameW) check(`${where}：${name} 一样宽`, spread(boxes.map((b) => b.w)) <= TOL, boxes.map((b) => b.w.toFixed(1)).join('/'));
    if (r.evenV && boxes.length > 2) {
      const g = vgaps(boxes);
      check(`${where}：${name} 竖着等距（误差 ≤ ${TOL}px）`, spread(g) <= TOL, g.map((x) => x.toFixed(1)).join('/'));
    }
  }
  if (rules.navClear) {
    check(`${where}：滑到底，最后一块离底栏 ≥ 16px（不被盖住）`, m.navClear >= 15.5, `${m.navClear}px`);
  }
}

// ═════════════════════════════════════════════════════════════════
const RECORDS = {
  rootSel: '.records-page',
  scrollToEnd: true,
  groups: {
    '三块': ':scope > .total-card, .records-panel--records, .records-panel--ranks',
    '最近战绩的六格': '.records-panel--records > .records-row, .records-panel--records > .records-rule',
    '排名的六格': '.records-panel--ranks > .rank-row',
  },
  centered: { '整页': ['.records-page'] },
};
const PROFILE = {
  rootSel: '.profile-page',
  scrollToEnd: true,
  groups: {
    '左栏那一列药丸': '.profile-col--main > .profile-pill',
    'Pro 和声音': '.profile-col--main .profile-pill-row > .profile-pill',
    '天才面板的十二格': '.genius-grid > .profile-row',
    '两颗法务键': '.legal-pair > .profile-row',
    '整页的块': '.profile-col--main > *, .genius-panel, .legal-pair',
  },
  centered: {
    '整页': ['.profile-page'],
    '徽章（在面板里）': ['.genius-badge', '.genius-panel'],
    '吉祥物（在面板里）': ['.genius-crest .genius-logo', '.genius-panel'],
  },
};
const PROFILE_RULES = {
  navClear: true,
  groups: {
    // 没登录时是登录、色盲、语言、完整规则、教学五颗（原先还有一颗《图示》，10-08 方案 3-C-4 删了）。
    '左栏那一列药丸': { min: 5, sameH: true, evenV: true, noOverlap: true },
    'Pro 和声音': { count: 2, sameH: true, noOverlap: true },
    '天才面板的十二格': { count: 12, sameH: true, noOverlap: true },
    '两颗法务键': { count: 2, sameH: true, sameW: true, noOverlap: true },
    // 左栏六块（五颗药丸 ＋ Pro 和声音那一排）＋ 天才面板 ＋ 法务那一对 ＝ 8。原先是 9：左栏
    // 还有一颗《图示》，10-08 方案 3-C-4 删了。
    '整页的块': { min: 8, noOverlap: true },
  },
};
const RECORDS_RULES = {
  navClear: true,
  groups: {
    '三块': { count: 3, noOverlap: true },
    '最近战绩的六格': { count: 6, sameH: true, evenV: true, noOverlap: true },
    '排名的六格': { count: 6, sameH: true, evenV: true, noOverlap: true },
  },
};
const ACCT = {
  rootSel: '.acct-modal',
  groups: {
    '三颗键': '.acct-actions > .pill-icon',
    // 10-08 方案 3-C-6：最底下多了一颗 ✅（.acct-done），它也是窗里的一块，而且和上面那几颗同一
    // 族——一样宽、一样高。
    '窗里的块': '.acct-modal > h2, .acct-field, .acct-actions, .acct-done',
    '✅ 和上面那几颗': '.acct-actions > .pill-icon, .acct-done > .pill-icon',
  },
  centered: {
    '窗': ['.acct-modal'],
    '那一列键（在窗里）': ['.acct-actions .pill-icon', '.acct-modal'],
    '✅（在窗里）': ['.acct-done .pill-icon', '.acct-modal'],
  },
};
/** 那颗 ✅ 的读屏名：i18n 的 doneBtn。 */
const DONE_LABEL = { zhHans: '完成', zhHant: '完成', en: 'Done', fr: 'Terminé' };
const INVITE = {
  rootSel: '.invite-modal',
  groups: {
    '两颗键': '.invite-actions > .pill-icon',
    '窗里的块': '.invite-modal > h2, .invite-body, .invite-actions',
    '吉祥物和货单': '.invite-mascot, .invite-perks',
  },
  centered: { '窗': ['.invite-modal'], '那一对键（在窗里）': ['.invite-actions', '.invite-modal'] },
};

async function openCtx(size, lang, seed, scores) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, reducedMotion: 'reduce' });
  if (scores) {
    await ctx.route('**/api/scores', async (route) => {
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || '{}');
      } catch {}
      if (body.action === 'board') {
        if (scores.status !== 200) return route.fulfill({ status: scores.status, body: '{}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scores.page) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, runs: 0, best: {}, archive: [] }) });
    });
  }
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  // 开机那一次清档（engine/wipeOldRules.ts）跑完之后再放局进去，不然会被它一起清掉。
  await page.evaluate(
    ([l, s, key, runs]) => {
      localStorage.setItem('slides_lang', l);
      if (s) localStorage.setItem('slides_genius', JSON.stringify(s));
      else localStorage.removeItem('slides_genius');
      if (runs) localStorage.setItem(key, JSON.stringify(runs));
    },
    [lang, seed, RUNS_KEY, seed ? fakeRuns(3) : null],
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  return { ctx, page };
}

function fakeRuns(n) {
  return Array.from({ length: n }, (_, i) => ({
    at: Date.now() - i * 3600e3, start: null, end: null,
    data: { shapeId: i % 2 ? 'circle' : 'square', shapeFallback: '方块', modeKey: 'base', totalScore: 120 + i * 37, at: Date.now() - i * 3600e3 },
  }));
}
const okBoard = {
  status: 200,
  page: {
    mode: '', players: 9, me: { rank: 2, score: 940 },
    rows: [
      { rank: 1, name: 'Zoey', score: 1200, mode: 'square' },
      { rank: 2, name: 'me', score: 940, mode: 'circle', me: true },
      { rank: 3, name: 'Dray', score: 610, mode: 'square' },
    ],
  },
};

const literalHits = new Set();
const FIND_LITERALS = (rootSel) => {
  const root = document.querySelector(rootSel);
  if (!root) return null;
  const skip = root.querySelector('.home-head');
  const els = [root, ...root.querySelectorAll('*')].filter((e) => !(skip && skip.contains(e)));
  const DYN = /::?(?:hover|active|focus-visible|focus-within|focus|visited|link|target|before|after|placeholder|selection|marker|first-letter|first-line|-webkit-[a-z-]+|-moz-[a-z-]+)(?:\([^()]*\))?/g;
  const splitSel = (t) => {
    const outS = [];
    let depth = 0, cur = '';
    for (const ch of t) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        outS.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) outS.push(cur.trim());
    return outS;
  };
  const COLOR_PROP = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration(-color)?|column-rule(-color)?|filter|-webkit-text-fill-color|-webkit-text-stroke(-color)?|accent-color|--[\w-]+)$/;
  const NAMED = /(^|[\s,(])(white|black|red|green|blue|gray|grey|orange|purple|yellow|pink|brown|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia|beige|ivory|tan|salmon|coral|crimson|indigo|violet|khaki|plum|orchid|wheat|linen|snow)(?=$|[\s,;)])/i;
  const literal = (v) => {
    const t = v.replace(/rgba?\(\s*var\([^)]*\)[^)]*\)/g, '');
    return /#[0-9a-f]{3,8}\b/i.test(t) || /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(t) || NAMED.test(t);
  };
  const hits = [];
  const visit = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !(r instanceof CSSStyleRule)) {
        let ok = true;
        try {
          if (r instanceof CSSMediaRule) ok = matchMedia(r.media.mediaText).matches;
          else if (typeof CSSSupportsRule !== 'undefined' && r instanceof CSSSupportsRule) ok = CSS.supports(r.conditionText);
        } catch {
          ok = false;
        }
        if (ok) visit(r.cssRules);
        continue;
      }
      if (!(r instanceof CSSStyleRule)) continue;
      let applies = false;
      for (const s0 of splitSel(r.selectorText)) {
        const s1 = s0.replace(DYN, '').trim() || '*';
        try {
          if (els.some((e) => e.matches(s1))) {
            applies = true;
            break;
          }
        } catch {}
      }
      if (!applies) continue;
      for (const decl of r.style.cssText.split(/;(?![^(]*\))/)) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim();
        const val = decl.slice(i + 1).trim();
        if (COLOR_PROP.test(prop) && literal(val)) hits.push(`${r.selectorText} {${prop}: ${val}}`);
      }
    }
  };
  for (const sh of document.styleSheets) {
    try {
      visit(sh.cssRules);
    } catch {}
  }
  for (const e of els) {
    const st = e.getAttribute('style');
    if (st && literal(st)) hits.push(`[style] ${e.tagName.toLowerCase()}.${e.className}: ${st}`);
  }
  return hits;
};
let literalScans = 0;
async function scanLiterals(page, rootSel) {
  const hits = await page.evaluate(FIND_LITERALS, rootSel);
  if (hits === null) return;
  literalScans++;
  for (const h of hits) literalHits.add(`${rootSel}  ${h}`);
}

/** 卡片在色盲模式下颜色不变（方案：「色盲模式下这几张卡片的颜色不变」）。 */
const CARD_BG = (sels) =>
  sels.map((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).backgroundColor : 'missing';
  });
const CARDS = [
  '.total-card', '.records-panel--records', '.records-panel--ranks',
];
const PROFILE_CARDS = [
  '#loginBtn', '#cvdRow', '#langRow', '#rulesRow', '#howToRow', '#proRow', '#soundRow',
  '.genius-panel', '.genius-badge',
];

// ═════════════════════════════════════════════════════════════════
for (const size of SIZES) {
  for (const lang of LANGS) {
    const tag = `${size.n} ${lang}`;
    // ── 没登录：战绩页、个人主页、邀请窗 ──
    {
      const { ctx, page } = await openCtx(size, lang, null, null);
      await page.click('#navRecords');
      await page.waitForSelector('.records-page .records-rule, .records-page .records-row', { timeout: 10000 });
      await page.waitForFunction(() => document.querySelectorAll('.records-panel--ranks > .rank-row').length >= 6, null, { timeout: 8000 }).catch(() => {});
      for (const mode of MODES) {
        await setMode(page, mode);
        judge(`${tag} ${mode} 战绩页（空）`, await page.evaluate(MEASURE, RECORDS), RECORDS_RULES);
      }
      // 色盲下卡片不换色
      await setMode(page, '浅色');
      const light = await page.evaluate(CARD_BG, CARDS);
      await setMode(page, '色盲');
      const cvd = await page.evaluate(CARD_BG, CARDS);
      check(`${tag} 战绩页：色盲模式下三块卡片颜色不变`, JSON.stringify(light) === JSON.stringify(cvd), `${light} → ${cvd}`);
      if (size.w >= 1000) {
        // 电脑端两栏：等宽、右栏上下沿和左栏对齐（方案原话）
        const cols = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const t = r('.total-card'), rec = r('.records-panel--records'), rk = r('.records-panel--ranks');
          return { tw: t.width, rw: rec.width, kw: rk.width, top: rk.top - t.top, bottom: rk.bottom - rec.bottom, sameCol: Math.abs(t.left - rec.left) };
        });
        check(`${tag} 战绩页：两栏等宽`, Math.abs(cols.tw - cols.kw) <= TOL && Math.abs(cols.rw - cols.kw) <= TOL, JSON.stringify(cols));
        check(`${tag} 战绩页：左栏是累计分在上、最近战绩在下`, cols.sameCol <= TOL, `${cols.sameCol}px`);
        check(`${tag} 战绩页：右栏上沿对齐左栏`, Math.abs(cols.top) <= TOL, `${cols.top}px`);
        check(`${tag} 战绩页：右栏下沿对齐左栏`, Math.abs(cols.bottom) <= TOL, `${cols.bottom}px`);
      } else {
        const pair = await page.evaluate(() => {
          const a = document.querySelector('.records-panel--records').getBoundingClientRect();
          const b = document.querySelector('.records-panel--ranks').getBoundingClientRect();
          return { h: [a.height, b.height], w: [a.width, b.width], top: a.top - b.top };
        });
        check(`${tag} 战绩页：手机上两块面板一样高、一样宽、并排`, spread(pair.h) <= TOL && spread(pair.w) <= TOL && Math.abs(pair.top) <= TOL, JSON.stringify(pair));
      }
      await setMode(page, '浅色');
      await scanLiterals(page, '.records-page');

      // 个人主页
      await page.click('#navProfile');
      await page.waitForSelector('.profile-page .genius-grid', { timeout: 10000 });
      for (const mode of MODES) {
        await setMode(page, mode);
        judge(`${tag} ${mode} 个人主页`, await page.evaluate(MEASURE, PROFILE), PROFILE_RULES);
      }
      await setMode(page, '浅色');
      const pl = await page.evaluate(CARD_BG, PROFILE_CARDS);
      await setMode(page, '色盲');
      const pc = await page.evaluate(CARD_BG, PROFILE_CARDS);
      check(`${tag} 个人主页：色盲模式下药丸和天才面板颜色不变`, JSON.stringify(pl) === JSON.stringify(pc), `${pl} → ${pc}`);
      await setMode(page, '浅色');
      // 「两个加起来和上面的按钮一样宽」
      const proW = await page.evaluate(() => {
        const row = document.querySelector('.profile-col--main .profile-pill-row').getBoundingClientRect();
        // 「上面那几颗」原先拿《图示》那一颗量；它 10-08 方案 3-C-4 删了，改拿紧挨着的《教学》。
        const above = document.querySelector('#howToRow').getBoundingClientRect();
        return { row: [row.left, row.right], above: [above.left, above.right] };
      });
      // 10-08 方案 3-C-4：《图示》（换标签页图标）那一行连同挑图标那扇窗删了。按 id 查，也按
      // 字查——换个 id 塞回来，字还是那四个字。
      const iconGone = await page.evaluate(() => ({
        row: document.querySelectorAll('#iconRow').length,
        text: [...document.querySelectorAll('.profile-page button')]
          .map((b) => b.textContent.trim())
          .filter((t) => ['图标', '圖示', 'Icon', 'Icône'].includes(t)),
      }));
      check(`${tag} 个人主页：《图示》那一行没了`, iconGone.row === 0 && iconGone.text.length === 0, JSON.stringify(iconGone));
      check(
        `${tag} 个人主页：Pro 和声音两颗加起来和上面那几颗一样宽`,
        Math.abs(proW.row[0] - proW.above[0]) <= TOL && Math.abs(proW.row[1] - proW.above[1]) <= TOL,
        JSON.stringify(proW),
      );
      // 法务两颗和网格的两列对齐
      const align = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.genius-grid > .profile-row')].slice(0, 2).map((e) => e.getBoundingClientRect());
        const legal = [...document.querySelectorAll('.legal-pair > .profile-row')].map((e) => e.getBoundingClientRect());
        return cells.map((c, i) => [c.left - legal[i].left, c.right - legal[i].right].map((x) => +x.toFixed(2)));
      });
      check(`${tag} 个人主页：两颗法务键对着网格的两列`, align.flat().every((x) => Math.abs(x) <= TOL), JSON.stringify(align));
      const gone = await page.evaluate(() => ({
        label: [...document.querySelectorAll('.genius-panel .menu-section-label')].length,
        rule: document.querySelectorAll('.genius-panel hr, .genius-rule').length,
      }));
      check(`${tag} 个人主页：「SLIDES 天才特供」那行标签和分隔线没了`, gone.label === 0 && gone.rule === 0, JSON.stringify(gone));
      if (size.w >= 1000) {
        const two = await page.evaluate(() => {
          const a = document.querySelector('.profile-col--main').getBoundingClientRect();
          const b = document.querySelector('.profile-col--genius').getBoundingClientRect();
          return { w: [a.width, b.width], top: a.top - b.top, side: a.right <= b.left };
        });
        check(`${tag} 个人主页：电脑端两栏等宽、并排、顶端对齐`, spread(two.w) <= TOL && Math.abs(two.top) <= TOL && two.side, JSON.stringify(two));
      }
      await scanLiterals(page, '.profile-page');

      // 邀请窗
      await page.click('#becomeGeniusBtn');
      await page.waitForSelector('.invite-modal', { timeout: 5000 });
      for (const mode of MODES) {
        await setMode(page, mode);
        const m = await page.evaluate(MEASURE, INVITE);
        judge(`${tag} ${mode} 邀请窗`, m, {
          groups: {
            '两颗键': { count: 2, sameH: true, sameW: true, noOverlap: true },
            '窗里的块': { count: 3, noOverlap: true },
            '吉祥物和货单': { count: 2, noOverlap: true },
          },
        });
        const fit = await page.evaluate(() => {
          const r = document.querySelector('.invite-modal').getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, h: innerHeight };
        });
        check(`${tag} ${mode} 邀请窗：整扇窗在屏幕里`, fit.top >= -0.5 && fit.bottom <= fit.h + 0.5, JSON.stringify(fit));
      }
      await setMode(page, '浅色');
      const inv = await page.evaluate(() => ({
        tag: document.querySelectorAll('#geniusTag').length,
        last: document.querySelector('.invite-perks > li:last-child')?.textContent.trim(),
        underline: getComputedStyle(document.querySelector('.invite-title')).borderBottomWidth,
      }));
      check(`${tag} 邀请窗：「注册后免费立即解锁全部内容」那一句没了`, inv.tag === 0, String(inv.tag));
      check(`${tag} 邀请窗：货单以「……」结尾`, inv.last === '……', String(inv.last));
      check(`${tag} 邀请窗：标题底下有下划线`, parseFloat(inv.underline) >= 1, inv.underline);
      await scanLiterals(page, '.invite-modal');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      check(`${tag} 邀请窗：Esc 能关`, (await page.$('.invite-modal')) === null);
      await ctx.close();
    }
    // ── 免邮箱帐号：帐号窗；顺带战绩页上的真名次（锁住的那一屏另起一份） ──
    {
      const { ctx, page } = await openCtx(size, lang, handleSeed, okBoard);
      await page.click('#navRecords');
      await page.waitForFunction(() => document.querySelectorAll('.records-panel--ranks > .rank-row:not(.rank-row--empty)').length >= 3, null, { timeout: 8000 }).catch(() => {});
      judge(`${tag} 战绩页（有记录、有名次）`, await page.evaluate(MEASURE, RECORDS), RECORDS_RULES);
      await scanLiterals(page, '.records-page');
      await page.click('#navProfile');
      await page.waitForSelector('.profile-page', { timeout: 10000 });
      await page.click('#loginBtn');
      await page.waitForSelector('.acct-modal', { timeout: 5000 });
      for (const mode of MODES) {
        await setMode(page, mode);
        judge(`${tag} ${mode} 帐号窗（免邮箱）`, await page.evaluate(MEASURE, ACCT), {
          minTexts: 2,
          groups: {
            '三颗键': { count: 2, sameH: true, sameW: true, evenV: true, noOverlap: true },
            '窗里的块': { count: 4, noOverlap: true },
            '✅ 和上面那几颗': { count: 3, sameH: true, sameW: true, noOverlap: true },
          },
        });
      }
      await setMode(page, '浅色');
      const id = await page.evaluate(() => ({
        shown: document.querySelector('#acctId')?.textContent.trim(),
        change: document.querySelectorAll('#statusChangeEmail').length,
      }));
      check(`${tag} 帐号窗：第一串默认遮住（•••• 加末 4 位）`, id.shown === '••••' + HANDLE.slice(-4), String(id.shown));
      check(`${tag} 帐号窗：免邮箱帐号没有「更换」`, id.change === 0, String(id.change));
      await page.click('#acctEye');
      const open = await page.evaluate(() => document.querySelector('#acctId')?.textContent.trim());
      check(`${tag} 帐号窗：按眼睛露出整串`, open === HANDLE, String(open));
      await scanLiterals(page, '.acct-modal');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      check(`${tag} 帐号窗：Esc 能关`, (await page.$('.acct-modal')) === null);
      // 再开一次：重新遮上
      await page.click('#loginBtn');
      await page.waitForSelector('.acct-modal', { timeout: 5000 });
      const again = await page.evaluate(() => document.querySelector('#acctId')?.textContent.trim());
      check(`${tag} 帐号窗：每次打开都重新遮住`, again === '••••' + HANDLE.slice(-4), String(again));
      // 10-08 方案 3-C-6：最底下那颗 ✅——只放图标、念「完成」、是窗里最后一颗键；按下去和右上角
      // ✕ 一样只关窗：人还登着，背后那一页一个像素都没挪（方案要「从这颗新按钮关闭也不许偏移」）。
      const done = await page.evaluate(() => {
        const b = document.querySelector('#statusDone');
        const keys = [...document.querySelectorAll('.acct-modal button, .acct-modal a')];
        return b ? { label: b.getAttribute('aria-label') || '', svg: !!b.querySelector('svg'), text: b.textContent.trim(), last: keys[keys.length - 1] === b } : null;
      });
      check(`${tag} 帐号窗：最底下一颗 ✅，只放图标、读屏念「${DONE_LABEL[lang]}」`,
        !!done && done.svg && done.text === '' && done.label === DONE_LABEL[lang] && done.last, JSON.stringify(done));
      const behind = () => page.evaluate(() => {
        const r = document.querySelector('.profile-page').getBoundingClientRect();
        return { l: r.left, t: r.top, w: r.width, pad: getComputedStyle(document.body).paddingRight, x: scrollX, y: scrollY };
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const before = await behind();
      const geniusBefore = await page.evaluate(() => localStorage.getItem('slides_genius'));
      await page.click('#loginBtn');
      await page.waitForSelector('.acct-modal', { timeout: 5000 });
      await page.click('#statusDone');
      await page.waitForTimeout(150);
      check(`${tag} 帐号窗：按 ✅ 关得掉`, (await page.$('.acct-modal')) === null);
      const after = await behind();
      const geniusAfter = await page.evaluate(() => localStorage.getItem('slides_genius'));
      check(`${tag} 帐号窗：按 ✅ 只是关窗——人还登着`, geniusAfter !== null && geniusAfter === geniusBefore);
      check(`${tag} 帐号窗：按 ✅ 关掉之后背后那一页没挪`, JSON.stringify(before) === JSON.stringify(after),
        `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      await ctx.close();
    }
  }
}

// ── 第 17 推补的两条：邀请窗在 360×640 上装得下；登录窗两颗键和另外三扇窗一个样子 ──
//
// 方案第 7 条：「在 360×640 实测底部按钮是否在屏内；装不下时先把吉祥物缩小移到列表上方、再收
// 紧行距」——量下来四种语言都装得下（最挤的法语，两颗键底边 586 / 屏高 640），所以吉祥物没挪，
// 这一节把「装得下」钉住：哪天货单多一条、行距松一点，先红在这儿。
//
// 方案第 8 条：「登录窗同样改成 ✕ 和棕色『→』，四扇窗按钮风格一致」——量的是登录窗那两颗键和
// 邀请窗那两颗是不是**同一个零件**：同高、同宽（两颗之间也等宽）、同一个底色、左右对称、只放
// 图标（键上没有字、有 aria-label）、整个在屏幕里。
sec('邀请窗 360×640；登录窗的两颗键');
{
  const SMALL = { n: '360×640', w: 360, h: 640 };
  for (const lang of LANGS) {
    const tag = `${SMALL.n} ${lang}`;
    const { ctx, page } = await openCtx(SMALL, lang, null, null);
    await page.click('#navProfile');
    await page.waitForSelector('.profile-page', { timeout: 10000 });
    await page.click('#becomeGeniusBtn');
    await page.waitForSelector('.invite-modal', { timeout: 5000 });
    const inv = await page.evaluate(() => {
      const box = (q) => {
        const r = document.querySelector(q)?.getBoundingClientRect();
        return r ? { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height } : null;
      };
      const bg = (q) => (document.querySelector(q) ? getComputedStyle(document.querySelector(q)).backgroundColor : '');
      return { vh: innerHeight, vw: innerWidth, modal: box('.invite-modal'), close: box('#geniusClose'), go: box('#geniusRestore'), bg: bg('#geniusClose') };
    });
    check(`（尺子）${tag} 邀请窗：量到了两颗键`, Boolean(inv.close && inv.go), JSON.stringify(inv));
    if (!inv.close || !inv.go) { await ctx.close(); continue; }
    check(`${tag} 邀请窗：整扇窗在屏幕里`, inv.modal.t >= -0.5 && inv.modal.b <= inv.vh + 0.5, `${inv.modal.t} / ${inv.modal.b} / ${inv.vh}`);
    check(`${tag} 邀请窗：底下两颗键整个露在屏幕里`,
      [inv.close, inv.go].every((r) => r.t >= -0.5 && r.b <= inv.vh + 0.5 && r.l >= -0.5 && r.r <= inv.vw + 0.5),
      `${inv.close.b} / ${inv.go.b} / ${inv.vh}`);

    // 从邀请窗点《登录》→ 登录窗。
    await page.click('#geniusRestore');
    await page.waitForSelector('#authGo', { timeout: 10000 });
    await page.waitForTimeout(200);
    const au = await page.evaluate(() => {
      const one = (q) => {
        const el = document.querySelector(q);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height,
          bg: getComputedStyle(el).backgroundColor,
          pill: el.classList.contains('pill-icon'),
          text: el.textContent.trim(),
          svg: Boolean(el.querySelector('svg')),
          aria: el.getAttribute('aria-label') || '',
        };
      };
      const card = document.querySelector('.auth-modal .modal, .auth-modal')?.getBoundingClientRect();
      return { vh: innerHeight, vw: innerWidth, close: one('#authClose'), go: one('#authGo'),
        card: card ? { l: card.left, r: card.right } : null };
    });
    check(`（尺子）${tag} 登录窗：量到了两颗键`, Boolean(au.close && au.go), JSON.stringify(au));
    if (!au.close || !au.go) { await ctx.close(); continue; }
    check(`${tag} 登录窗：两颗都是 .pill-icon（和邀请窗、帐号窗同一个零件）`, au.close.pill && au.go.pill);
    check(`${tag} 登录窗：只放图标——键上没有字、有图标、有 aria-label`,
      [au.close, au.go].every((k) => k.text === '' && k.svg && k.aria.length > 0), JSON.stringify([au.close.aria, au.go.aria, au.close.text, au.go.text]));
    check(`${tag} 登录窗：两颗一样宽、一样高`, Math.abs(au.close.w - au.go.w) <= TOL && Math.abs(au.close.h - au.go.h) <= TOL,
      `${au.close.w}×${au.close.h} / ${au.go.w}×${au.go.h}`);
    check(`${tag} 登录窗：和邀请窗那两颗一样高、一样颜色`, Math.abs(au.close.h - inv.close.h) <= TOL && au.close.bg === inv.bg && au.go.bg === inv.bg,
      `${au.close.h}/${inv.close.h} ${au.close.bg} ${au.go.bg} vs ${inv.bg}`);
    if (au.card) {
      const left = au.close.l - au.card.l;
      const right = au.card.r - au.go.r;
      check(`${tag} 登录窗：两颗键左右对称（离窗边一样远）`, Math.abs(left - right) <= TOL, `${left.toFixed(1)} / ${right.toFixed(1)}`);
    }
    check(`${tag} 登录窗：两颗键整个在屏幕里`,
      [au.close, au.go].every((r) => r.t >= -0.5 && r.b <= au.vh + 0.5 && r.l >= -0.5 && r.r <= au.vw + 0.5),
      `${au.close.b} / ${au.go.b} / ${au.vh}`);
    await ctx.close();
  }
}

// ── 邮箱帐号：三颗键（更换 / 登出 / 联络）、锁着的排名那一屏 ──
sec('邮箱帐号与锁着的排名');
for (const size of [ALL_SIZES[0], ALL_SIZES[3]]) {
  const tag = `${size.n} zhHans`;
  const { ctx, page } = await openCtx(size, 'zhHans', mailSeed, { status: 403 });
  await page.click('#navRecords');
  await page.waitForFunction(() => document.querySelectorAll('.records-panel--ranks > .rank-row--ghost').length >= 6, null, { timeout: 8000 }).catch(() => {});
  judge(`${tag} 战绩页（排名锁着）`, await page.evaluate(MEASURE, RECORDS), RECORDS_RULES);
  await scanLiterals(page, '.records-page');
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 10000 });
  await page.click('#loginBtn');
  await page.waitForSelector('.acct-modal', { timeout: 5000 });
  judge(`${tag} 帐号窗（邮箱）`, await page.evaluate(MEASURE, ACCT), {
    minTexts: 2,
    groups: {
      '三颗键': { count: 3, sameH: true, sameW: true, evenV: true, noOverlap: true },
      // 抬头、字段、三颗键那一列，加最底下那颗 ✅（10-08 方案 3-C-6）。
      '窗里的块': { count: 4, noOverlap: true },
      '✅ 和上面那几颗': { count: 4, sameH: true, sameW: true, noOverlap: true },
    },
  });
  const ids = await page.evaluate(() => [...document.querySelectorAll('.acct-actions > *')].map((e) => e.id));
  check(`${tag} 帐号窗：邮箱帐号是 更换 / 登出 / 联络 三颗`, ids.join() === 'statusChangeEmail,statusSignOut,statusMail', ids.join());
  const mail = await page.evaluate(() => document.querySelector('#statusMail')?.getAttribute('href'));
  check(`${tag} 帐号窗：联络那颗是 mailto:`, /^mailto:/.test(mail || ''), String(mail));
  const old = await page.evaluate(() => document.querySelectorAll('.order-row, .gift-row, #statusManage').length);
  check(`${tag} 帐号窗：有效期、礼物码、Creem 那几行都没了`, old === 0, String(old));
  await scanLiterals(page, '.acct-modal');
  await ctx.close();
}

sec('这四页的样式里没有写死的颜色');
check(
  `（尺子）扫过的页面 / 状态不少于 ${SIZES.length * LANGS.length * 5}`,
  literalScans >= SIZES.length * LANGS.length * 5,
  String(literalScans),
);
check('写死的颜色一条都没有', literalHits.size === 0, [...literalHits].slice(0, 8).join('\n      '));

console.log(`\n${pass} 条通过，${fail} 条没过`);
await browser.close();
process.exit(fail ? 1 : 0);
