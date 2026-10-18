/**
 * 色盲友好配色开着时棋子的格内纹理（10-18 补充 M-4，站长定方案乙；要 dev-server + Chromium）。
 *
 *   node scripts/dev-server.mjs 8938 dist
 *   node scripts/check-cvd-texture.mjs http://localhost:8938/ [--only=1,4]
 *
 * engine/cvdTexture.ts 那张表按色值查：三套色盲配色 21 个色值各对一种纹理（横条 / 竖条 / 网格 / 斜条 / 反斜条 /
 * 圆点 / 无），炸弹红不在表里。这一道量七件事：
 *   1. 色盲开着，六副棋盘的每一枚正面：data-tex 等于表里它那一色的纹理，算出来的背景图有渐变（「无」那一色是
 *      none）；三角量 .fill。炸弹局里炸弹那几枚没有 data-tex。
 *   2. 同一局里同色的两枚正面，算出来的背景图一模一样（同色同纹理、对得齐）。
 *   3. 反面：凑一手得分把几枚翻成星星，量星的大小（方块、小球 0.84，菱形方块 0.76，三角是内切圆直径 × 0.76）、
 *      有 halo（g[data-halo]），而 `svg g[stroke]` 读到的第一组仍是星的颜色；三角有 .tri-tex。紫（「无」）的反
 *      面星照旧、没有 halo。
 *   4. 翻面：翻成星星的那几枚带的是反面的 data-tex 和背景图（线色是星色、0.5）。两层图那两种各翻出过一回：
 *      经典小球的蓝（网格）和黄（圆点），方块 warm 那一套的 #DD344F（网格）。
 *   5. 局中关掉色盲：重画之后盘上没有任何 data-tex、背景图全是 none、没有 .tri-tex 和 halo；再打开又全回来。
 *   6. 方块 warm、cool 两套：data-tex 照表里那一套。
 *   7. 色盲关着（默认）：六副棋盘上没有任何 data-tex、背景图全是 none、没有 .tri-tex、没有 halo；反面星照旧
 *      （方块 0.95、菱形方块 0.86、小球 0.95、三角 0.88）。
 *
 * 方案第 8 条（方块消行那个淡出替身带纹理）要借 P8（J-1）的 check-cascade-order 的夹具，仓库里还没有那一道——
 * 这一道不量，汇报里记一笔。
 *
 * 凑得分那一手的找法是 check-smooth-touch 第 ⑦ 节那一份（照屏幕上的位置和颜色、按《怎么玩》那条规矩在本地算，
 * 不读 data-id、不问游戏自己的状态），多了一个「先挑这一色」。
 */
import { chromium } from 'playwright';
import * as SC from '../api/_seedcode.js';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-cvd-texture.mjs http://localhost:8938/');
  process.exit(2);
}
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',').map(Number);
const want = (n) => !ONLY || ONLY.includes(n);
/** --boards=squareDiamond,triangleBig：第 3–5、7 节只走这几副（本地调用）。 */
const ONLY_BOARDS = process.argv.find((a) => a.startsWith('--boards='))?.slice(9).split(',');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** engine/cvdTexture.ts 那张表——门这一头独立抄一份，不 import 被测的东西。 */
const TEX = {
  '#D55E00': 'h', '#E69F00': 'v', '#F0E442': 'dots', '#009E73': 'd', '#56B4E9': 'a', '#0072B2': 'grid', '#CC79A7': 'none',
  '#DD344F': 'grid', '#E9CF99': 'h', '#EA732F': 'none', '#C181A1': 'd', '#FEB449': 'v', '#B2A972': 'dots', '#A66378': 'a',
  '#8767B7': 'h', '#A0DCB5': 'grid', '#1F8985': 'dots', '#37E6FA': 'd', '#5E8052': 'v', '#9199CE': 'none', '#43B196': 'a',
};
const SETS = {
  std: ['#D55E00', '#E69F00', '#F0E442', '#009E73', '#56B4E9', '#0072B2', '#CC79A7'],
  warm: ['#DD344F', '#E9CF99', '#EA732F', '#C181A1', '#FEB449', '#B2A972', '#A66378'],
  cool: ['#8767B7', '#A0DCB5', '#1F8985', '#37E6FA', '#5E8052', '#9199CE', '#43B196'],
};
const toHex = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
  if (!m) return (rgb || '').toUpperCase();
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
};
const half = (hex) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, 0.5)`;
};

/** 编号表那几行（api/_seedcode.js 的 VARIANTS）：0–5 是六副基础棋盘，8 是炸弹方块。 */
const BOARDS = [
  [0, 'square', '经典方块'], [1, 'circle', '经典小球'], [2, 'squareDiamond', '菱形方块'],
  [3, 'circleHex', '六边形小球'], [4, 'circleSeven', '七色小球'], [5, 'triangleBig', '六边形三角'],
].filter(([, id]) => !ONLY_BOARDS || ONLY_BOARDS.includes(id));
/** 反面星占棋子多大（色盲关 / 色盲开且这一色铺了纹理）。三角按内切圆直径算。 */
const STAR = {
  square: [0.95, 0.84], squareDiamond: [0.86, 0.76], circle: [0.95, 0.84], circleHex: [0.95, 0.84], circleSeven: [0.95, 0.84],
  triangleBig: [0.88, 0.76],
};

async function device({ cvd = true, palette = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(([on, pal]) => {
    if (sessionStorage.getItem('tex_gate') === '1') return;
    sessionStorage.setItem('tex_gate', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries({
      slides_lang: 'zhHans', slides_cvd_offer: '1', slides_intro_seen: '1',
      slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
    })) localStorage.setItem(k, v);
    for (const k of ['square', 'circle', 'finished', 'bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout', 'totaltip']) {
      localStorage.setItem('slides_played_' + k, '1');
    }
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 365 * 864e5 }));
    if (on) localStorage.setItem('slides_colorblind', '1');
    if (pal) localStorage.setItem('slides_cvd_palette', pal);
  }, [cvd, palette]);
  // 每振一下记一笔：控制器每落下一步震 8，得分震 15 或三连（check-smooth-touch 同一套桩）。
  await ctx.addInitScript(() => {
    window.__vib = [];
    try { navigator.vibrate = (p) => (window.__vib.push(p), true); } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  return { ctx, page };
}
async function openSeeded(page, variant, rand) {
  const code = SC.encodeSeed(SC.DEAL_VERSION, variant, rand);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#seedInput', { timeout: 8000 });
  await page.fill('#seedInput', code.slice(0, 4) + '-' + code.slice(4));
  await page.click('#seedGo');
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
}

/** 每一枚：面、颜色、纹理记号、算出来的背景图、反面那颗星的样子。三角的正面读 .fill。 */
const LOOK = () => {
  const CLEAR = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
  return [...document.querySelectorAll('#boardWrap [data-r][data-c]')].map((e) => {
    const fill = e.querySelector(':scope > .fill');
    const face = e.dataset.face || '';
    const front = fill || e;
    const cs = getComputedStyle(front);
    const dotG = e.querySelector('svg g[stroke]');
    const svg = e.querySelector('svg');
    const texDiv = e.querySelector(':scope > .tri-tex');
    // 三角那颗星是摆进一块大 SVG 里的一组（asteriskGroup），大小从它的 scale 里读：24 × k。
    const tr = dotG?.getAttribute('transform') || '';
    const k = /scale\(([\d.]+)\)/.exec(tr);
    return {
      at: `${e.dataset.r},${e.dataset.c}`,
      face,
      tri: !!fill,
      // 版面尺寸，不用 getBoundingClientRect：棋盘消掉一圈之后整体放大是 transform，量出来的是放大后的，而星的
      // width 属性写的是版面像素。也不用 offsetWidth：菱形方块的棋子宽是小数（格子 × 0.92），它会取整。
      w: parseFloat(getComputedStyle(e).width),
      h: parseFloat(getComputedStyle(e).height),
      color: face === 'dot' ? (e.dataset.dotColor || dotG?.getAttribute('stroke') || '') : (CLEAR(cs.backgroundColor) ? '' : cs.backgroundColor),
      tex: (fill ? fill.dataset.tex : e.dataset.tex) ?? null,
      ownTex: e.dataset.tex ?? null,
      img: face === 'dot' && texDiv ? getComputedStyle(texDiv).backgroundImage : face === 'dot' ? getComputedStyle(e).backgroundImage : cs.backgroundImage,
      texDiv: !!texDiv,
      texDivTex: texDiv?.dataset.tex ?? null,
      halo: !!e.querySelector('g[data-halo]'),
      star: k ? 24 * Number(k[1]) : svg ? Number(svg.getAttribute('width')) : 0,
      bomb: !!e.querySelector('.hazard-mark'),
    };
  });
};
const look = async (page) => (await page.evaluate(LOOK)).map((p) => ({ ...p, hex: p.color.startsWith('#') ? p.color.toUpperCase() : toHex(p.color) }));

// ── 凑一手得分（check-smooth-touch ⑦ 那一份，多一个「先挑这一色」）──────────────────────────────────
const fullSnap = (page) =>
  page.evaluate(() => {
    const CLEAR = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
    const colorOf = (el) => {
      if (el.dataset.face === 'dot') {
        // g[stroke]：三角那块 SVG 里第一个带 stroke 的是那圈灰边（var(--ink-faint)），星是后面那一组。
        return el.dataset.dotColor || el.querySelector('svg g[stroke]')?.getAttribute('stroke') || '';
      }
      const own = getComputedStyle(el).backgroundColor;
      if (!CLEAR(own)) return own;
      for (const kid of el.querySelectorAll('*')) {
        const bg = getComputedStyle(kid).backgroundColor;
        if (!CLEAR(bg)) return bg;
      }
      return '';
    };
    const svg = document.querySelector('.hud-block--pattern .pat-icon > svg');
    return {
      need: svg ? [...svg.children].filter((e) => e.tagName !== 'defs').length : 0,
      cells: [...document.querySelectorAll('#boardWrap [data-r][data-c]')].map((e) => {
        const b = e.getBoundingClientRect();
        return {
          at: `${e.dataset.r},${e.dataset.c}`, face: e.dataset.face || '', color: colorOf(e),
          bomb: Boolean(e.querySelector('.hazard-mark')),
          x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width),
        };
      }).sort((a, b) => (a.at < b.at ? -1 : 1)),
    };
  });
const lineThrough = (cells, p, ux, uy) => {
  const tol = Math.max(6, (p.w || 20) * 0.5);
  return cells
    .filter((q) => q.face !== 'blank' && Math.abs((q.x - p.x) * uy - (q.y - p.y) * ux) <= tol)
    .map((q) => ({ q, t: (q.x - p.x) * ux + (q.y - p.y) * uy }))
    .sort((a, b) => a.t - b.t)
    .map((o) => o.q);
};
const neighbours = (cells, p) => {
  const ds = cells.filter((q) => q !== p && q.face !== 'blank').map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) }));
  if (!ds.length) return [];
  const min = Math.min(...ds.map((o) => o.d));
  return ds.filter((o) => o.d < min * 1.05).map(({ q, d }) => ({ ux: (q.x - p.x) / d, uy: (q.y - p.y) / d, d }));
};
/** 此刻成立的得分组的颜色（同色连成一线、长度等于 HUD 那一块的枚数、至少一枚色块、没有活炸弹）。 */
const scoringColors = (cells, lines, need) => {
  const by = new Map(cells.map((p) => [p.at, p]));
  const out = new Set();
  for (const line of lines) {
    const seq = line.map((at) => by.get(at)).filter(Boolean);
    for (let i = 0; i + need <= seq.length; i++) {
      const win = seq.slice(i, i + need);
      if (win.some((p) => p.face === 'blank' || !p.color || p.bomb)) continue;
      if (win.every((p) => p.color === win[0].color) && win.some((p) => p.face === 'flavor')) out.add(win[0].color);
    }
  }
  return out;
};
/** 挑一手「顺着拖的方向挪一格就凑出得分组」的；有 prefer 那一色的先挑它。挑不到回 null。 */
const scoringDrag = (cells, need, prefer = null) => {
  const lines = [];
  const seenLine = new Set();
  for (const p of cells) {
    for (const n of neighbours(cells, p)) {
      const line = lineThrough(cells, p, n.ux, n.uy).map((q) => q.at);
      const k = [...line].sort().join('|');
      if (line.length >= need && !seenLine.has(k)) {
        seenLine.add(k);
        lines.push(line);
      }
    }
  }
  let any = null;
  for (const p of cells) {
    if (p.face === 'blank') continue;
    for (const n of neighbours(cells, p)) {
      const seats = lineThrough(cells, p, n.ux, n.uy);
      if (seats.length < 2) continue;
      const after = cells.map((q) => ({ ...q }));
      const seat = new Map(after.map((q) => [q.at, q]));
      seats.forEach((from, i) => {
        const to = seat.get(seats[(i + 1) % seats.length].at);
        to.face = from.face;
        to.color = from.color;
        to.bomb = from.bomb;
      });
      const got = scoringColors(after, lines, need);
      if (!got.size) continue;
      const move = { x: p.x, y: p.y, dx: n.ux * n.d * 1.15, dy: n.uy * n.d * 1.15, colors: [...got].map(toHex) };
      if (!prefer || move.colors.includes(prefer)) return move;
      any ??= move;
    }
  }
  return prefer ? null : any;
};
async function drag(page, d) {
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(d.x + (d.dx * i) / 8, d.y + (d.dy * i) / 8);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}
/** 等盘面静下来：隔 250ms 读两次一模一样（最多等 5 秒）。翻面、连锁、放大都走完才算。 */
async function still(page) {
  const sig = (s) => s.cells.map((q) => `${q.at}:${q.face}:${q.color}`).join('|');
  let prev = await fullSnap(page);
  for (let t = 0; t < 20; t++) {
    await page.waitForTimeout(250);
    const cur = await fullSnap(page);
    if (sig(cur) === sig(prev) && !(await page.$('#boardWrap [data-flipping]'))) return cur;
    prev = cur;
  }
  return prev;
}
/**
 * 凑出一手得分，翻出几枚星星（有 prefer 就要翻出那一色）。挑得到就照着拖，挑不到就随手滑一格换个局面再找。
 * 回翻出来的那几枚星星的颜色（大写 hex）。
 *
 * 怎么认「这一手结算完了」：控制器每落下一步震 8，得分再震 15 或三连（gameController 的 resolveMove）。8 要等松手
 * 之后那一小段收尾走完才来（实测约 0.45 秒），那一段盘面一动不动——只看「盘面两次一样」会在它之前就收工。所以先
 * 等到 8；得分那一震和 8 同一刻到（实测相差不到 1 毫秒），留 0.4 秒足够；震了，就等翻面走完、盘面静下来。
 */
async function scoreOnce(page, prefer = null, maxMoves = prefer ? 30 : 25) {
  for (let t = 0; t < maxMoves; t++) {
    const s0 = await still(page);
    if (await page.$('#endOverlay.show')) return [];
    const want = scoringDrag(s0.cells, s0.need, prefer);
    // 每一色此刻有几颗星：翻出了哪几色，按数目的增减认（按位置比会把滑走的旧星星也算进去）。
    const tally = (cells) => cells.filter((c) => c.face === 'dot').reduce((m, c) => m.set(toHex(c.color), (m.get(toHex(c.color)) || 0) + 1), new Map());
    const before = tally(s0.cells);
    let move = want;
    if (!move) {
      const pool = s0.cells.filter((q) => q.face === 'flavor');
      const p = pool[(t * 7 + 3) % pool.length];
      const ns = neighbours(s0.cells, p);
      const n = ns[t % ns.length];
      move = { x: p.x, y: p.y, dx: n.ux * n.d * 1.15, dy: n.uy * n.d * 1.15 };
    }
    const v0 = await page.evaluate(() => window.__vib.length);
    await drag(page, move);
    await page.waitForFunction((k) => window.__vib.slice(k).includes(8), v0, { timeout: 3000 }).catch(() => {});
    const scored = await page
      .waitForFunction((k) => window.__vib.slice(k).some((x) => x === 15 || Array.isArray(x)), v0, { timeout: 400 })
      .then(() => true).catch(() => false);
    const s1 = scored ? (await page.waitForTimeout(300), await still(page)) : s0;
    const flipped = [...tally(s1.cells)].filter(([h, k]) => k > (before.get(h) || 0)).map(([h]) => h);
    if (process.env.TEX_DEBUG) console.log(`DEBUG need ${s0.need} 挑到 ${want ? want.colors.join(',') : '（没有）'} 得分 ${scored} 翻出 ${flipped.join(',') || '（没有）'}`);
    if (flipped.length && (!prefer || flipped.includes(prefer))) return flipped;
  }
  return [];
}

/** 一枚正面该是什么纹理、背景图对不对。 */
const frontOk = (p) => {
  const t = TEX[p.hex];
  if (!t) return p.tex == null;
  return p.tex === t && (t === 'none' ? p.img === 'none' : p.img.includes('gradient'));
};

// ── 1 / 2. 正面：每一枚纹理对得上；同色同图 ────────────────────────────────────────────
if (want(1) || want(2)) {
  const { ctx, page } = await device();
  for (const [v, id, name] of BOARDS) {
    await openSeeded(page, v, 2024 + v);
    const P = await look(page);
    const fronts = P.filter((p) => p.face === 'flavor');
    const bad = fronts.filter((p) => !frontOk(p));
    const seen = [...new Set(fronts.map((p) => `${p.hex}→${p.tex}`))].sort();
    check(`1 ${name}：每一枚正面的 data-tex 是表里那一色的纹理，背景图有渐变（「无」那一色是 none）${id === 'triangleBig' ? '——量 .fill' : ''}`,
      fronts.length > 0 && bad.length === 0, bad.length ? `不对 ${bad.length} 枚，例：${JSON.stringify(bad[0])}` : seen.join(' '));
    const byColor = new Map();
    for (const p of fronts) (byColor.get(p.hex) ?? byColor.set(p.hex, []).get(p.hex)).push(p);
    const mismatch = [...byColor].filter(([, ps]) => ps.length > 1 && new Set(ps.map((p) => p.img)).size > 1).map(([h]) => h);
    check(`2 ${name}：同色的几枚正面，背景图一模一样`, mismatch.length === 0 && [...byColor.values()].some((ps) => ps.length > 1),
      mismatch.length ? `不一样的色：${mismatch.join(' ')}` : `${byColor.size} 色`);
  }
  // 炸弹局：炸弹那几枚（炸弹红，不在表里）不打记号。
  await openSeeded(page, 8, 31337);
  const P = await look(page);
  const bombs = P.filter((p) => p.bomb);
  check('1 炸弹局：炸弹那几枚没有 data-tex，别的正面照常', bombs.length > 0 && bombs.every((p) => p.tex == null) &&
    P.filter((p) => p.face === 'flavor' && !p.bomb).every(frontOk), `炸弹 ${bombs.length} 枚`);
  await ctx.close();
}

// ── 3 / 4. 反面与翻面 ─────────────────────────────────────────────────────────────────
/** 量一副盘上的星星：大小、halo、读星色的门读到的第一组、三角的 .tri-tex、背景图的线色。 */
function backChecks(P, id, on, label) {
  const [plain, shrunk] = STAR[id];
  const stars = P.filter((p) => p.face === 'dot');
  const wrong = [];
  for (const p of stars) {
    const t = TEX[p.hex];
    const tex = on && t && t !== 'none';
    // 三角那颗星按内切圆：正三角的内切圆直径 = 边长 / √3，边长就是外框的宽。
    const base = p.tri ? p.w / Math.sqrt(3) : p.w;
    const wantStar = base * (tex ? shrunk : plain);
    const sizeOk = p.tri ? Math.abs(p.star - wantStar) <= 1 : p.star === Math.round(wantStar);
    if (!sizeOk) wrong.push(`${p.at} 星 ${p.star.toFixed(1)} ≠ ${wantStar.toFixed(1)}`);
    if (p.halo !== !!tex) wrong.push(`${p.at} halo ${p.halo}`);
    if (on && t === 'none' && (p.tri ? p.tex : p.ownTex) !== 'none') wrong.push(`${p.at} 紫没打 none`);
    if (tex) {
      if (p.tri && !p.texDiv) wrong.push(`${p.at} 没有 .tri-tex`);
      if (!p.img.includes('gradient') || !p.img.includes(half(p.hex))) wrong.push(`${p.at} 背景图不是星色 0.5`);
      if ((p.tri ? p.texDivTex : p.ownTex) !== t) wrong.push(`${p.at} data-tex ${p.tri ? p.texDivTex : p.ownTex} ≠ ${t}`);
    } else if (p.img !== 'none' || p.texDiv) {
      wrong.push(`${p.at} 不该有纹理`);
    }
  }
  check(`${label}：${stars.length} 枚星星的大小、halo、纹理都对`, stars.length > 0 && wrong.length === 0, wrong.slice(0, 3).join('；'));
  return stars;
}
if (want(3) || want(4)) {
  const { ctx, page } = await device();
  const flippedColors = new Set();
  for (const [v, id, name] of BOARDS) {
    // 种子照 check-smooth-touch ⑦（777000 + 31v）：那一道在这几串码上六副都挑得到得分手。
    await openSeeded(page, v, 777000 + v * 31);
    const before = await look(page);
    const got = await scoreOnce(page);
    const P = await look(page);
    check(`3（尺子）${name}：凑出一手得分，翻出了星星`, got.length > 0, got.join(' '));
    if (!got.length) continue;
    for (const h of got) flippedColors.add(`${id}:${h}`);
    backChecks(P, id, true, `3 ${name}`);
    // 星的颜色仍由 svg g[stroke] 的第一组给出（halo 不带 stroke 属性）。
    const strokeOk = await page.evaluate(() => [...document.querySelectorAll('#boardWrap [data-face="dot"]')].every((e) => {
      const g = e.querySelector('svg g[stroke]');
      return !!g && !g.hasAttribute('data-halo') && (!e.dataset.dotColor || g.getAttribute('stroke').toUpperCase() === e.dataset.dotColor.toUpperCase());
    }));
    check(`3 ${name}：读星色的门（svg g[stroke]）读到的第一组仍是星的颜色`, strokeOk);
    const stillFront = P.filter((p) => p.face === 'flavor');
    check(`4 ${name}：没翻的正面纹理照旧`, stillFront.every(frontOk) && stillFront.length > 0 && before.length > 0);
  }
  // 两层图那两种各翻出过一回：经典小球的蓝（网格）和黄（圆点）。
  for (const [hex, kind] of [['#0072B2', '网格'], ['#F0E442', '圆点']]) {
    let ok = flippedColors.has(`circle:${hex}`);
    for (let r = 0; !ok && r < 6; r++) {
      await openSeeded(page, 1, 5000 + r * 17 + (hex === '#0072B2' ? 0 : 3));
      const got = await scoreOnce(page, hex);
      if (got.includes(hex)) {
        ok = true;
        backChecks(await look(page), 'circle', true, `4 经典小球翻出${kind}（${hex}）`);
      }
    }
    check(`4 经典小球：翻出过${kind}那一色（${hex}）的星星`, ok);
  }
  await ctx.close();
  // 方块 warm 那一套的 #DD344F（网格）。
  const w = await device({ palette: 'warm' });
  let ok = false;
  for (let r = 0; !ok && r < 6; r++) {
    await openSeeded(w.page, 0, 7000 + r * 13);
    const got = await scoreOnce(w.page, '#DD344F');
    if (got.includes('#DD344F')) {
      ok = true;
      backChecks(await look(w.page), 'square', true, '4 经典方块 warm 翻出网格（#DD344F）');
    }
  }
  check('4 经典方块 warm：翻出过 #DD344F（网格）的星星', ok);
  await w.ctx.close();
}

// 紫（「无」）的反面：星照旧、没有 halo、只打 data-tex="none"。经典方块里凑一手紫的得分。
if (want(3)) {
  const { ctx, page } = await device();
  let ok = false;
  for (let r = 0; !ok && r < 8; r++) {
    await openSeeded(page, 0, 9100 + r * 7);
    const got = await scoreOnce(page, '#CC79A7');
    if (got.includes('#CC79A7')) {
      ok = true;
      const P = await look(page);
      const purple = P.filter((p) => p.face === 'dot' && p.hex === '#CC79A7');
      check('3 经典方块：紫（「无」）的反面星照旧 0.95、没有 halo、没有纹理，只打 data-tex="none"',
        purple.length > 0 && purple.every((p) => p.star === Math.round(p.w * 0.95) && !p.halo && p.img === 'none' && p.ownTex === 'none'),
        JSON.stringify(purple[0]));
    }
  }
  check('3（尺子）经典方块：凑出过一手紫的得分', ok);
  await ctx.close();
}

// ── 5. 局中关掉色盲，再打开 ─────────────────────────────────────────────────────────
if (want(5)) {
  const { ctx, page } = await device();
  for (const [v, id, name] of [BOARDS[0], BOARDS[5]]) {
    await openSeeded(page, v, 3030 + v);
    await scoreOnce(page);
    const toggle = async () => {
      await page.click('#stopBtn');
      await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
      await page.click('#cvdBtn');
      await page.click('#continueBtn');
      await page.waitForTimeout(600);
    };
    await toggle();
    const off = await page.evaluate(() => ({
      tex: document.querySelectorAll('#boardWrap [data-tex]').length,
      img: [...document.querySelectorAll('#boardWrap [data-r][data-c], #boardWrap [data-r][data-c] > .fill')]
        .filter((e) => getComputedStyle(e).backgroundImage !== 'none').length,
      triTex: document.querySelectorAll('#boardWrap .tri-tex').length,
      halo: document.querySelectorAll('#boardWrap g[data-halo]').length,
      cvd: document.documentElement.getAttribute('data-cvd'),
    }));
    check(`5 ${name}：局中关掉色盲——没有 data-tex、背景图全是 none、没有 .tri-tex 和 halo`,
      off.tex === 0 && off.img === 0 && off.triTex === 0 && off.halo === 0 && off.cvd !== '1', JSON.stringify(off));
    await toggle();
    const P = await look(page);
    const on = P.filter((p) => p.face === 'flavor');
    check(`5 ${name}：再打开——纹理全回来`, on.length > 0 && on.every(frontOk), `${on.filter(frontOk).length}/${on.length}`);
  }
  await ctx.close();
}

// ── 6. 方块 warm、cool 两套 ──────────────────────────────────────────────────────────
if (want(6)) {
  for (const pal of ['warm', 'cool']) {
    const { ctx, page } = await device({ palette: pal });
    await openSeeded(page, 0, 4040);
    const P = (await look(page)).filter((p) => p.face === 'flavor');
    const inSet = P.every((p) => SETS[pal].includes(p.hex));
    check(`6 经典方块 ${pal}：棋子都是这一套的颜色，data-tex 照表`, P.length > 0 && inSet && P.every(frontOk),
      [...new Set(P.map((p) => `${p.hex}→${p.tex}`))].sort().join(' '));
    await ctx.close();
  }
}

// ── 7. 色盲关着（默认）：一个字节都不变 ────────────────────────────────────────────────
if (want(7)) {
  const { ctx, page } = await device({ cvd: false });
  for (const [v, id, name] of BOARDS) {
    await openSeeded(page, v, 777000 + v * 31);
    await scoreOnce(page);
    const dom = await page.evaluate(() => ({
      tex: document.querySelectorAll('#boardWrap [data-tex]').length,
      img: [...document.querySelectorAll('#boardWrap [data-r][data-c], #boardWrap [data-r][data-c] > .fill')]
        .filter((e) => getComputedStyle(e).backgroundImage !== 'none').length,
      triTex: document.querySelectorAll('#boardWrap .tri-tex').length,
      halo: document.querySelectorAll('#boardWrap g[data-halo]').length,
    }));
    check(`7 ${name}（色盲关）：没有 data-tex、背景图全是 none、没有 .tri-tex、没有 halo`,
      dom.tex === 0 && dom.img === 0 && dom.triTex === 0 && dom.halo === 0, JSON.stringify(dom));
    backChecks(await look(page), id, false, `7 ${name}（色盲关）：反面星照旧`);
  }
  await ctx.close();
}

check('页面没有报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
