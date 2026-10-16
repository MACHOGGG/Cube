/**
 * 教学的呼吸灯，和手机端那条教学条。
 *
 *   node scripts/dev-server.mjs 8xxx dist &
 *   node scripts/check-coach-aim.mjs http://localhost:8xxx/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 亮灯的规矩是 10-11 方案 D-1 ～ D-4 定的（按玩家规格重做，替换 10-09 补充方案 6-2 那一版），这一道逐条量：
 *
 *   · A、E 不亮。A 那一幅是一段动画（本局三种颜色的 1×N 依次慢翻过去再翻回来），手机上也摆出来。
 *   · B、C：目标是当前 N 的**任意一组**（同色连着 ≥ N、至少一枚色块、碰到最后滑过的线）。每一色单独算**精确的最少
 *     步数**；亮最少步数那一色、最后一步成组的**那 N 枚**。中间哪一步自己就会得分或消边，那一支不算。
 *   · 挑色：步数最少；平手先留正在亮的那一色（不跳色），再平留含星星的组，再平按盘面哈希（这一道不验哈希，只验「挑
 *     的是平手那几色之一」）。
 *   · C 只在刚出来那一下算一次，HUD 那块《得分图案》一起亮；D 亮那一色**在场的所有星星**，色块一枚不亮。
 *   · 只动 filter，不加任何热区——真的拖一枚，拖动照常。
 *   · 手机端（≤999px）教学文字：字号比原来大一截（10-09 补充方案：28/15 倍），最多两行，不压住棋盘。
 *
 * ── 对照怎么算 ──────────────────────────────────────────────────────────
 *
 * 这一道自带一份**对照**：从屏幕上读出每一枚的位置、正反面、颜色（不读任何 data-id，也不问游戏自己的状态），自己
 * 按同一份规格搜一遍——每一色 IDA*（估值和规格写的一样：一条线上这一色还差几枚 / 一条外边上还差几颗这一色的星星，
 * 都不高估），求出最少步数、那一步数里能成的每一组（映射回此刻的位置）。对照是这儿独立写的，不借游戏的 findMatches
 * 和搜索——借了就是拿被测的东西量它自己。它和游戏只共享规则本身（《侵蚀阶梯》§1.1）和外边几何（engine/outerEdge.ts，
 * 那是规则，不是被测的东西）。
 *
 * 10-11 方案 D-5 第 5 条拆掉的两条宽容：从前「一步没有、两步有，不亮也对」（两步那一层手机上未必在 15ms 里算得完），
 * 「两步都没有，亮不亮都对」（第 3 步这一道不走）。现在搜索没有时间上限、分段算完才亮，所以：对照算得出来的，灯就
 * 必须亮、而且亮对。对照自己也有上限（OR_CAP 个盘面）：比游戏那一道（十五万）低得多，超了这一副跳过、记一笔——
 * 游戏在那种盘面上会退回估值（标「估计」），这一道不替估值做主。
 *
 * 随机地真的滑几十步（小球、方块各一局），每一步结算完都对一次。灯亮着的时候多半照着灯滑（顺着对照给的那条路走第
 * 一步），这样 B 那一条几步之内就降级、走到 C、再走到 D——每一条都量得到。
 *
 * ⚠️ 这一道**什么键都不许预设**（除了语言）。CLAUDE.md 里那五个坑的第四个说的就是它：预设
 * `slides_tutorial_seen` 会让 `firstTimeIn` 认成「玩过了」，教学条整个不出现——而这一道要
 * 验的正是它，屏幕上却什么都不报。
 */
import { chromium } from 'playwright';
import esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = process.argv[2];
if (!BASE) {
  console.log('用法: node scripts/check-coach-aim.mjs <dev-server 地址>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const head = (t) => console.log('\n── ' + t);
/**
 * 只跑其中几节：`COACH_AIM_ONLY=1,3 node scripts/check-coach-aim.mjs …`。反向验证（故意改坏一处、看它红不红）一次
 * 只需要那一节。CI 不设，全跑。
 */
const ONLY = (process.env.COACH_AIM_ONLY || '').split(',').filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(String(n));

// 五条的字从 i18n.ts 现读（和 build-legal.mjs 同一个法子）：门里抄一份的话，改了文案这儿量的就是旧字。外边几何
// 从 outerEdge.ts 现读（那是规则：哪几条算「此刻削得动的外边」）。
const tmp = mkdtempSync(join(tmpdir(), 'slides-coach-aim-'));
for (const [name, entry] of [['i18n', 'i18n.ts'], ['edge', 'engine/outerEdge.ts']]) {
  esbuild.buildSync({
    entryPoints: [join(root, 'src', entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: join(tmp, name + '.mjs'),
    logLevel: 'silent',
  });
}
const { tutorialRules } = await import(pathToFileURL(join(tmp, 'i18n.mjs')).href);
const { outerEdges, EDGE_MIN } = await import(pathToFileURL(join(tmp, 'edge.mjs')).href);
rmSync(tmp, { recursive: true, force: true });
/** ui/coachBar.ts 的 HINT_OF：第几条要灯做什么。 */
const HINT_OF = [null, 'group', 'groupOnce', 'edge', null];
/** A 摆多久（ui/coachBar.ts 的 A_MS）：B 要等它过去。 */
const A_MS = 10000;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];

/** 头一回打开（什么键都不设，除了语言）→ 点轴上第 idx 张 → 开局。 */
async function openFirst({ idx, lang = 'zhHans', reduce = false, width = 390, height = 844 }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 1000,
    hasTouch: width < 1000,
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((l) => {
    try {
      localStorage.clear();
      localStorage.setItem('slides_lang', l);
    } catch (e) { /* 无痕模式 */ }
  }, lang);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mode-axis .home-icon-btn', { timeout: 30000 });
  await page.waitForTimeout(600);
  // 跳过最上面那张《每日挑战》（第 19 推）：这儿按下标点的是玩法卡，下标从方块数起（idx 1 是小球）。
  await page.evaluate(
    (i) => document.querySelectorAll('.mode-axis > .home-icon-btn:not(.home-icon-btn--daily)')[i].click(),
    idx,
  );
  await page.waitForTimeout(900);
  if (await page.$('#startBtn')) await page.evaluate(() => document.querySelector('#startBtn').click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 25000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}

/**
 * 读屏（在页面里跑）：每一枚的位置、正反面、颜色、亮没亮，外加两种线、此刻几枚一组、条子上摆的是哪一句、HUD 那块
 * 《得分图案》亮没亮。算法在 node 这头。
 */
const ORACLE = ({ shape }) => {
  const els = [...document.querySelectorAll('#boardWrap .ball[data-r][data-c], #boardWrap .tile[data-r][data-c]')];
  const probe = document.createElement('i');
  document.body.appendChild(probe);
  const norm = (c) => {
    probe.style.color = '';
    probe.style.color = c;
    return getComputedStyle(probe).color;
  };
  const at = new Map();
  for (const el of els) {
    const face = el.dataset.face;
    if (face === 'blank') continue;
    // 星星的颜色：方块挂在 data-dot-color 上，小球画在那三笔的 stroke 上。
    const color = face === 'dot'
      ? norm(el.dataset.dotColor || el.querySelector('g[stroke]')?.getAttribute('stroke') || '')
      : getComputedStyle(el).backgroundColor;
    const b = el.getBoundingClientRect();
    at.set(`${el.dataset.r},${el.dataset.c}`, {
      r: +el.dataset.r, c: +el.dataset.c, face, color,
      lit: el.classList.contains('coach-glow'),
      anim: getComputedStyle(el).animationName,
      filter: getComputedStyle(el).filter,
      x: b.left + b.width / 2, y: b.top + b.height / 2,
    });
  }
  probe.remove();
  // 线：几何上的整条（判「连着」用——中间离场了一格就断开），和此刻还在盘上的那一串（滑用——离场的格子不在线
  // 上，剩下的首尾相接）。
  const full = [];
  if (shape === 'circle') {
    const R = 7;
    for (let d = 0; d < R; d++) full.push(Array.from({ length: R - d }, (_, k) => `${d + k},${k}`));
    for (let e = 0; e < R; e++) full.push(Array.from({ length: R - e }, (_, k) => `${e + k},${e}`));
    for (let r = 0; r < R; r++) full.push(Array.from({ length: r + 1 }, (_, c) => `${r},${c}`));
  } else {
    const vals = [...at.values()];
    const rows = Math.max(...vals.map((v) => v.r)) + 1;
    const cols = Math.max(...vals.map((v) => v.c)) + 1;
    for (let r = 0; r < rows; r++) full.push(Array.from({ length: cols }, (_, c) => `${r},${c}`));
    for (let c = 0; c < cols; c++) full.push(Array.from({ length: rows }, (_, r) => `${r},${c}`));
  }
  const slide = full.map((l) => l.filter((k) => at.has(k))).filter((l) => l.length >= 2);
  const pb = document.querySelector('.hud-block--pattern');
  const label = pb?.getAttribute('aria-label') || '';
  const n = Number((label.match(/\d+/) || [4])[0]);
  const text = document.querySelector('.coach-bar .coach-text')?.textContent ?? '';
  return {
    at: [...at.entries()], full, slide, n, text,
    block: pb ? { cls: pb.className, anim: getComputedStyle(pb).animationName, filter: getComputedStyle(pb).filter } : null,
  };
};

// ===========================================================================
// 对照：按规格自己搜一遍（10-11 方案 D-2 / D-3）
// ===========================================================================
/** 对照自己最多看几个盘面（一副盘面，所有颜色加起来）。比游戏那一道（十五万）低得多：超了就跳过这一副。 */
const OR_CAP = 60000;
/** 最多看几步：和游戏一样（engine/coachHint.ts 的 HINT_MAX_DEPTH）。 */
const OR_DEPTH = 8;
const lineA = (d) => Array.from({ length: 7 - d }, (_, k) => [d + k, k]);
const lineB = (e) => Array.from({ length: 7 - e }, (_, k) => [e + k, e]);
const lineRow = (r) => Array.from({ length: r + 1 }, (_, c) => [r, c]);
const CIRCLE_EDGE_LINES = [
  ...Array.from({ length: 7 }, (_, d) => ({ fam: 'A', offset: d, cells: lineA(d) })),
  ...Array.from({ length: 7 }, (_, e) => ({ fam: 'B', offset: e, cells: lineB(e) })),
  ...Array.from({ length: 7 }, (_, r) => ({ fam: 'R', offset: r, cells: lineRow(r) })),
];

/**
 * 把读屏结果下标化：格 0…M−1，S[格] = 此刻在这一格上的是开局（读屏那一刻）哪一格的那一枚。
 */
function model(o, shape) {
  const at = new Map(o.at);
  const keys = [...at.keys()];
  const idx = new Map(keys.map((k, i) => [k, i]));
  const P = keys.map((k) => at.get(k));
  const slide = o.slide.map((l) => l.map((k) => idx.get(k)));
  const full = o.full.map((l) => l.map((k) => (idx.has(k) ? idx.get(k) : -1)));
  let edges;
  if (shape === 'square') {
    edges = full.filter((l) => l.every((c) => c >= 0));
  } else {
    edges = outerEdges({ lines: CIRCLE_EDGE_LINES, isLive: (r, c) => at.has(`${r},${c}`) }, EDGE_MIN).map((e) =>
      e.live.map(([r, c]) => idx.get(`${r},${c}`)),
    );
  }
  const moves = [];
  slide.forEach((line, li) => {
    for (let s = 1; s < line.length; s++) moves.push([li, s]);
  });
  const movedSets = slide.map((line) => new Set(line));
  return { keys, idx, P, slide, full, edges, moves, movedSets, n: o.n };
}
/** 走一步（就地）：第 li 条线转 s 格（新位置 i 的那一枚来自旧位置 i − s，和 check-coach-aim 一直以来的 stepOn 同一个方向）。 */
function shift(m, S, li, s) {
  const line = m.slide[li];
  const L = line.length;
  const old = line.map((c) => S[c]);
  for (let i = 0; i < L; i++) S[line[i]] = old[(((i - s) % L) + L) % L];
}
const colorOf = (m, S, c) => m.P[S[c]].color;
const faceOf = (m, S, c) => m.P[S[c]].face;
/** 此刻会得分的那几组：同色连着 ≥ N（按整条几何线，中间离场一格就断开）、碰到这一步滑过的线、至少一枚色块。 */
function scoring(m, S, moved) {
  const out = [];
  for (const line of m.full) {
    let i = 0;
    while (i < line.length) {
      if (line[i] < 0) {
        i++;
        continue;
      }
      const col = colorOf(m, S, line[i]);
      let j = i + 1;
      while (j < line.length && line[j] >= 0 && colorOf(m, S, line[j]) === col) j++;
      if (j - i >= m.n) {
        const run = line.slice(i, j);
        if (run.some((c) => moved.has(c)) && run.some((c) => faceOf(m, S, c) === 'flavor')) out.push({ run, color: col });
      }
      i = j;
    }
  }
  return out;
}
/** 此刻会整条消掉的外边（整条同一色的星星）。 */
function clearing(m, S) {
  const out = [];
  for (const e of m.edges) {
    if (!e.length) continue;
    const col = colorOf(m, S, e[0]);
    if (e.every((c) => faceOf(m, S, c) === 'dot' && colorOf(m, S, c) === col)) out.push({ edge: e, color: col });
  }
  return out;
}
/**
 * 一种目标、一种颜色，在 bound 以内深搜一遍（IDA* 的一遍）。回 { found（碰到目标的那一步数，0 = 没碰到）, next（下一遍的
 * 界）}；超了 OR_CAP 抛 'cap'。`collect` 给了就不停：把这一遍碰到的每一个目标盘面都交给它。
 */
function idaOnce(m, S, { bound, h, verdict, budget, collect = null }) {
  let next = Infinity;
  let found = 0;
  const dfs = (g) => {
    for (const [li, s] of m.moves) {
      if (++budget.nodes > OR_CAP) throw new Error('cap');
      shift(m, S, li, s);
      const moved = m.movedSets[li];
      const v = verdict(S, moved);
      let stop = false;
      if (v === 'goal') {
        found = found || g;
        if (collect) collect(S, moved);
        else stop = true;
      } else if (v === 'open') {
        const hh = h(S);
        if (g < bound && g + hh <= bound) stop = dfs(g + 1);
        else {
          const f = g >= bound ? g + Math.max(1, hh) : g + hh;
          if (f < next) next = f;
        }
      }
      shift(m, S, li, m.slide[li].length - s);
      if (stop) return true;
    }
    return false;
  };
  dfs(1);
  return { found, next };
}
/**
 * 几种颜色各自的最少步数，只算到最少的那一档（和规格说的「挑最少步数的那一色」同一件事：别的颜色比这一档多多少用
 * 不着知道）。回 Map：颜色 → 步数（只有最少那一档的颜色在里面）。超了 OR_CAP 抛 'cap'。
 */
function minDepthsOracle(m, colors, hOf, verdictOf, budget) {
  const S = m.keys.map((_, i) => i);
  const lower = new Map();
  for (const k of colors) {
    const h0 = hOf(k)(S);
    if (Number.isFinite(h0)) lower.set(k, Math.max(1, h0));
  }
  const depth = new Map();
  for (let bound = 1; bound <= OR_DEPTH && !depth.size; bound++) {
    for (const k of colors) {
      const lb = lower.get(k);
      if (lb === undefined || lb > bound) continue;
      const r = idaOnce(m, S, { bound, h: hOf(k), verdict: verdictOf(k), budget });
      if (r.found) depth.set(k, r.found);
      else if (Number.isFinite(r.next)) lower.set(k, r.next);
      else lower.delete(k);
    }
  }
  return depth;
}

/**
 * B / C 的对照：每一色最少几步，最少的那几色在那一步数里能成的每一组（N 枚的那一段，映射回此刻的位置——「位置」
 * 就是读屏那一刻那一枚在哪一格）。
 */
function planGroupOracle(o, shape) {
  const m = model(o, shape);
  const S = m.keys.map((_, i) => i);
  const budget = { nodes: 0 };
  // 候选：盘上至少一枚这一色的色块，而且这一色一共够 N 枚。
  const blocks = new Map();
  const pieces = new Map();
  for (const p of m.P) {
    pieces.set(p.color, (pieces.get(p.color) ?? 0) + 1);
    if (p.face === 'flavor') blocks.set(p.color, (blocks.get(p.color) ?? 0) + 1);
  }
  const colors = [...blocks.keys()].filter((k) => pieces.get(k) >= m.n);
  const hOf = (k) => (T) => {
    let best = Infinity;
    for (const line of m.slide) {
      if (line.length < m.n) continue;
      let cnt = 0;
      for (const c of line) if (colorOf(m, T, c) === k) cnt++;
      const need = m.n - cnt;
      if (need <= 0) return 0;
      if (need < best) best = need;
    }
    return best;
  };
  const verdictOf = (k) => (T, moved) => {
    if (clearing(m, T).length) return 'dead';
    const g = scoring(m, T, moved);
    if (!g.length) return 'open';
    return g.some((x) => x.color === k) ? 'goal' : 'dead';
  };
  let depth;
  try {
    depth = minDepthsOracle(m, colors, hOf, verdictOf, budget);
  } catch (e) {
    if (e.message !== 'cap') throw e;
    return { capped: true, nodes: budget.nodes };
  }
  if (!depth.size) return { capped: false, best: 0, tied: [], windows: new Map(), nodes: budget.nodes };
  const best = Math.min(...depth.values());
  const tied = [...depth.keys()].filter((k) => depth.get(k) === best);
  // 那一步数里能成的每一组：每一段连着 N 枚、碰到滑过的线、至少一枚色块。
  const windows = new Map();
  try {
    for (const k of tied) {
      const list = new Map();
      idaOnce(m, S, {
        bound: best,
        h: hOf(k),
        verdict: verdictOf(k),
        budget,
        collect: (T, moved) => {
          for (const g of scoring(m, T, moved)) {
            if (g.color !== k) continue;
            for (let i = 0; i + m.n <= g.run.length; i++) {
              const win = g.run.slice(i, i + m.n);
              if (!win.some((c) => moved.has(c)) || !win.some((c) => faceOf(m, T, c) === 'flavor')) continue;
              const key = win.map((c) => m.keys[T[c]]).sort().join(' ');
              list.set(key, { star: win.some((c) => faceOf(m, T, c) === 'dot') });
            }
          }
        },
      });
      windows.set(k, list);
    }
  } catch (e) {
    if (e.message !== 'cap') throw e;
    return { capped: true, nodes: budget.nodes };
  }
  return { capped: false, best, tied, windows, nodes: budget.nodes };
}

/** D 的对照：那一色的星星填满一条此刻能消的外边，每一色最少几步；一色都填不满时「还差的最少」那几色。 */
function planEdgeOracle(o, shape) {
  const m = model(o, shape);
  const S = m.keys.map((_, i) => i);
  const budget = { nodes: 0 };
  const stars = new Map();
  for (const p of m.P) if (p.face === 'dot') stars.set(p.color, (stars.get(p.color) ?? 0) + 1);
  const lens = m.edges.filter((e) => e.length).map((e) => e.length);
  if (!stars.size || !lens.length) return { capped: false, colors: [], nodes: 0 };
  const shortest = Math.min(...lens);
  const all = [...stars.keys()];
  const able = all.filter((k) => stars.get(k) >= shortest);
  const fallback = (pool) => {
    const need = (k) => Math.min(...m.edges.filter((e) => e.length).map((e) => Math.max(0, e.length - stars.get(k))));
    const low = Math.min(...pool.map(need));
    return { capped: false, colors: pool.filter((k) => need(k) === low), depth: 0, nodes: budget.nodes };
  };
  if (!able.length) return fallback(all);
  const hOf = (k) => (T) => {
    let best = Infinity;
    for (const e of m.edges) {
      if (!e.length || e.length > stars.get(k)) continue;
      let cnt = 0;
      for (const c of e) if (faceOf(m, T, c) === 'dot' && colorOf(m, T, c) === k) cnt++;
      const need = e.length - cnt;
      if (need <= 0) return 0;
      if (need < best) best = need;
    }
    return best;
  };
  const verdictOf = (k) => (T, moved) => {
    const cl = clearing(m, T);
    if (cl.length) return cl.some((x) => x.color === k) ? 'goal' : 'dead';
    return scoring(m, T, moved).length ? 'dead' : 'open';
  };
  let depth;
  try {
    depth = minDepthsOracle(m, able, hOf, verdictOf, budget);
  } catch (e) {
    if (e.message !== 'cap') throw e;
    return { capped: true, nodes: budget.nodes };
  }
  if (!depth.size) return fallback(all);
  const best = Math.min(...depth.values());
  return { capped: false, colors: [...depth.keys()].filter((k) => depth.get(k) === best), depth: best, nodes: budget.nodes };
}

const litOf = (o) => o.at.filter(([, v]) => v.lit).map(([k]) => k).sort();
const ruleOf = (o, shape) => tutorialRules('zhHans', shape).indexOf(o.text);
const nameOf = (i) => (i < 0 ? '（没有条子）' : 'ABCDE'[i]);

/**
 * 一种盘面上量一次（10-11 方案 D-1 ～ D-3，逐条）。回它属于哪一类，好数尺子；`memo` 记着上一次的条和亮的那一色、
 * 那一组（「不跳色」「沿用上一组」要它）、C 刚出来那一下亮的那几枚。
 *
 * 「不跳色」只在同一条之内比：条子是按时间换的（A 的 10 秒、C 的 10 秒 / 5 秒），换的那一下控制器在两步之间就按新
 * 的一条重算过一次灯（onChange → refreshCoachGlow），这道门只在每一步结算完才读，看不到那一次。
 */
function judge(o, shape, where, memo = {}) {
  const rule = ruleOf(o, shape);
  const kind = rule >= 0 ? HINT_OF[rule] : null;
  const lit = litOf(o);
  const at = new Map(o.at);
  const colors = [...new Set(lit.map((k) => at.get(k).color))];
  const same = memo.rule === rule;
  const prev = same ? memo.color ?? null : null;
  memo.rule = rule;
  memo.color = colors.length === 1 ? colors[0] : null;
  const blockLit = /\bcoach-glow-block\b/.test(o.block?.cls || '');
  if (kind === 'groupOnce') {
    check(`${where}（C）：HUD 那块《得分图案》亮着（coach-glow-block，跑 glow-pulse-coach 或静止光晕）`, blockLit &&
      (o.block.anim === 'glow-pulse-coach' || /drop-shadow/.test(o.block.filter)), JSON.stringify(o.block));
  } else {
    check(`${where}（${nameOf(rule)}）：HUD 那块《得分图案》不亮`, !blockLit, o.block?.cls);
  }
  if (!kind) {
    check(`${where}（${nameOf(rule)}）：这一条不亮灯`, lit.length === 0, lit.join(' '));
    return 'skip';
  }
  check(`${where}（${nameOf(rule)}）：只亮一种颜色（色块、星星一起算）`, colors.length <= 1, colors.join(' / '));

  if (kind === 'edge') {
    const r = planEdgeOracle(o, shape);
    if (r.capped) return 'heavy';
    if (!r.colors.length) {
      check(`${where}（D）：场上一颗星星都没有，不亮`, lit.length === 0, lit.join(' '));
      return 'none';
    }
    const c = colors[0];
    const stars = o.at.filter(([, v]) => v.face === 'dot' && v.color === c).map(([k]) => k).sort();
    check(`${where}（D）：亮的是那一色在场的所有星星，一枚色块都不亮`, lit.length > 0 && lit.every((k) => at.get(k).face === 'dot') &&
      lit.join(' ') === stars.join(' '), `亮 [${lit.join(' ')}]，那一色的星星 [${stars.join(' ')}]`);
    check(`${where}（D）：挑的是${r.depth ? ` ${r.depth} 步就能填满一条外边` : '「还差的最少」'}的那几色之一`, r.colors.includes(c),
      `亮 ${c}；该是 ${r.colors.join(' / ')}`);
    if (prev !== null && r.colors.includes(prev)) check(`${where}（D）：上一次亮的那一色还是最少的——不跳色`, c === prev, `这一次亮 ${c}`);
    return r.depth ? 'edge' : 'edge0';
  }

  // C 只算一次：刚出来那一下照 B 一样量；之后灯跟着那几枚走，被翻掉、离场就熄——这一道认不出「那几枚」挪到哪儿去了
  // （小球没有 data-id），只量「要么熄着，要么还是那么多枚、那一色」。
  if (kind === 'groupOnce' && same) {
    const first = memo.once ?? { n: 0, color: null };
    check(`${where}（C）：之后要么熄着，要么还是刚出来那一下那几枚（同样多、同一色）`,
      lit.length === 0 || (lit.length === first.n && colors[0] === first.color), `亮 ${lit.length} 枚（${colors[0]}）；刚出来 ${first.n} 枚（${first.color}）`);
    return 'once';
  }
  const r = planGroupOracle(o, shape);
  if (kind === 'groupOnce') memo.once = { n: lit.length, color: colors[0] ?? null };
  if (r.capped) return 'heavy';
  if (!r.best) {
    check(`${where}（${nameOf(rule)}）：哪一色都拼不出（${OR_DEPTH} 步之内），不亮`, lit.length === 0, lit.join(' '));
    return 'none';
  }
  if (!lit.length) {
    check(`${where}（${nameOf(rule)}）：${r.best} 步就有颜色能拼出一组——灯必须亮（不再「没算完就不亮」）`, false,
      `${r.best} 步能成的颜色 ${r.tied.join(' / ')}`);
    return 'bad';
  }
  const c = colors[0];
  check(`${where}（${nameOf(rule)}）：亮的是最少步数（${r.best} 步）那几色之一`, r.tied.includes(c), `亮 ${c}；该是 ${r.tied.join(' / ')}`);
  const options = r.windows.get(c) ?? new Map();
  const key = lit.join(' ');
  check(`${where}（${nameOf(rule)}）：亮的正好是那一步成组的那 ${o.n} 枚`, lit.length === o.n && options.has(key),
    `亮 [${key}]；这一色的候选 ${[...options.keys()].slice(0, 2).map((x) => '[' + x + ']').join(' ')}${options.size > 2 ? ` …共 ${options.size} 组` : ''}`);
  if (prev !== null && r.tied.includes(prev)) {
    // 「同一色里先沿用上一组」这一道量不了：两次读屏之间滑过一步，上一组那几枚挪到了别的格子，而小球没有 data-id，
    // 认不出谁是谁。check-coach 第 ⑩ 节拿手摆的盘面钉着它。
    check(`${where}（${nameOf(rule)}）：上一次亮的那一色（${prev}）还是最少的——不跳色`, c === prev, `这一次亮 ${c}`);
  } else {
    const starry = r.tied.filter((k) => [...(r.windows.get(k) ?? new Map()).values()].some((w) => w.star));
    if (starry.length) check(`${where}（${nameOf(rule)}）：平手的那几色里有带星星的组——挑带星星的那一色`, starry.includes(c), `亮 ${c}；带星星的 ${starry.join(' / ')}`);
  }
  return r.best === 1 ? 'lit1' : 'litN';
}

/**
 * 真的拖一下：从那条线上的一枚出发，沿着线的方向拖 shift 格（取近的那一头）。
 *
 * 起点挑得让终点还落在这条线上的另一枚棋子上——拖到盘外去，有的棋盘会把手指当成离开了。
 */
async function dragMove(page, o, line, shift) {
  const at = new Map(o.at);
  const cells = o.slide[line];
  const L = cells.length;
  const s = shift > L / 2 ? shift - L : shift;
  const i0 = s > 0 ? 0 : L - 1;
  const p0 = at.get(cells[i0]);
  const p1 = at.get(cells[i0 + Math.sign(s)]);
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const steps = Math.abs(s);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let k = 1; k <= 14; k++) await page.mouse.move(p0.x + (vx * steps * k) / 14, p0.y + (vy * steps * k) / 14);
  await page.mouse.up();
}
/**
 * 等这一步结算完：盘面（每一枚的面、颜色、亮不亮）和条子连着 quietMs 一动不动。
 *
 * 正常动效下这个数要比连锁里最长的那一拍停顿还长：得分那一拍先亮 550ms 才翻（HIGHLIGHT_LEAD_MS），消边之后停
 * 1250ms（BONUS_GAP_MS）——安静 450ms 就收工的话，会在「已经滑过去、还没翻面」那一段把盘面读走，量到的是连锁中间
 * （灯在结算期间是熄的）。减弱动态效果时这几段都是 0，450ms 够了——搜索是分段在空闲时算的，算完才亮，也在这一段里。
 */
async function settle(page, shape, quietMs = 450) {
  let last = '';
  let since = Date.now();
  for (let k = 0; k < 160; k++) {
    await page.waitForTimeout(150);
    const o = await page.evaluate(ORACLE, { shape });
    noteC(o, shape);
    const sig = JSON.stringify([o.at.map(([key, v]) => [key, v.face, v.color, v.lit]), o.text, o.block?.cls]);
    if (sig !== last) {
      last = sig;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return o;
    }
  }
  return page.evaluate(ORACLE, { shape });
}
/** 正常动效那一局用的安静时长（见 settle）。 */
const QUIET_FULL_MS = 1700;
/**
 * C 那一条可能只摆 5 秒（降级那一步结算完时某色星星已经够一条外边），机器忙的时候一步「滑 + 等安静」就能把它整个
 * 跨过去——这一道只在每一步结算完才读，会一次都看不到 C，「C 期间图案块必须亮」就没量到。所以 settle / waitLit 每读
 * 一次屏都顺手看一眼：读到过 C 就记下那一副（seenC），第 ② 节拿它补量图案块。
 */
let seenC = null;
const noteC = (o, shape) => {
  if (ruleOf(o, shape) === 2 && !seenC) seenC = o;
};
/**
 * 灯是分段在空闲时算的，**算完才亮**（10-11 方案 D-4）：盘面安静了、这一条该亮灯却还黑着的话，再等一会儿（最多
 * LIT_WAIT_MS，盘面和条子都不许变）。量的是「亮得对不对」；多久之内必须亮是 check-coach-budget 的事（D-5 第 2 条，
 * CPU 降速六倍、一秒之内）。C 那一条刚出来之后不等：那时候熄着可能就是该熄（那几枚被翻掉了）。
 */
const LIT_WAIT_MS = 4000;
/**
 * 等的时候条子换了档（C 摆满时间换到 D），**照新的那一条接着等**，不是立刻交回去（10-16 修，门自己的毛病）：原先这一下
 * 直接返回，读到的是「D 已经出来、D 的灯还没算完」那一瞬间——一枚都不亮，judge 判成「D 亮错了」。10-16 P1 那一推的 CI
 * 上真红过一次（小球第 4 步：C 在两次读屏之间整个过去，读到 D 时灯还黑着；第 5 步起同一色全对）。换档最多跟两次。
 */
async function waitLit(page, shape, o, memo = {}, hops = 0) {
  const rule = ruleOf(o, shape);
  if (!(rule >= 0 && HINT_OF[rule]) || litOf(o).length) return o;
  if (HINT_OF[rule] === 'groupOnce' && memo.rule === rule) return o;
  const sig = (x) => JSON.stringify(x.at.map(([k, v]) => [k, v.face, v.color]));
  const s0 = sig(o);
  const t0 = Date.now();
  while (Date.now() - t0 < LIT_WAIT_MS) {
    await page.waitForTimeout(200);
    const o2 = await page.evaluate(ORACLE, { shape });
    noteC(o2, shape);
    if (ruleOf(o2, shape) !== rule && sig(o2) === s0 && hops < 2) return waitLit(page, shape, o2, memo, hops + 1);
    if (sig(o2) !== s0 || ruleOf(o2, shape) !== rule || litOf(o2).length) return o2;
  }
  return page.evaluate(ORACLE, { shape });
}

/**
 * 顺着对照给的路走一步：B / C 是最少步数那一色的第一步（随便哪一条最优的路），D 是最少步数那一色填外边的第一步。
 * 没有就回 null（随手滑）。
 */
function firstStepOf(o, shape, kind) {
  const m = model(o, shape);
  const S = m.keys.map((_, i) => i);
  for (const [li, s] of m.moves) {
    shift(m, S, li, s);
    const moved = new Set(m.slide[li]);
    const ok = kind === 'edge' ? clearing(m, S).length > 0 : scoring(m, S, moved).length > 0;
    shift(m, S, li, m.slide[li].length - s);
    if (ok) return { line: li, shift: s };
  }
  // 一步成不了：找一步「不得分、不消边、让最好那一色的估值变小」的。
  const r = kind === 'edge' ? null : planGroupOracle(o, shape);
  if (!r || r.capped || !r.best) return null;
  const k = r.tied[0];
  const h = (T) => {
    let best = Infinity;
    for (const line of m.slide) {
      if (line.length < m.n) continue;
      let cnt = 0;
      for (const c of line) if (colorOf(m, T, c) === k) cnt++;
      best = Math.min(best, Math.max(0, m.n - cnt));
    }
    return best;
  };
  const h0 = h(S);
  for (const [li, s] of m.moves) {
    shift(m, S, li, s);
    const moved = new Set(m.slide[li]);
    const ok = !clearing(m, S).length && !scoring(m, S, moved).length && h(S) < h0;
    shift(m, S, li, m.slide[li].length - s);
    if (ok) return { line: li, shift: s };
  }
  return null;
}

// ===========================================================================
// ① 头一局小球：A 那一段动画、A 不亮；B 的灯真的在亮、只动 filter、拖得动
// ===========================================================================
if (want(1)) {
  head('① 头一局小球（正常动效）：A 不亮、A 的动画手机上也摆；B 的灯在亮、只动 filter、拖得动');
  const { ctx, page } = await openFirst({ idx: 1 });
  let o = await settle(page, 'circle', QUIET_FULL_MS);
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.coach-bar');
    const art = b?.querySelector('.coach-art');
    const cyc = [...(art?.querySelectorAll('.ra-cyc') ?? [])];
    return b ? {
      cls: b.className, hidden: b.hidden,
      art: art ? getComputedStyle(art).display : null,
      cyc: cyc.length,
      anim: [...new Set(cyc.map((e) => getComputedStyle(e).animationName))],
      rows: [0, 1, 2].map((k) => art.querySelectorAll('.ra-cyc' + k).length),
    } : null;
  });
  check('头一回玩就有那块教学条，摆的是五条那一种（coach-bar--rules）', !!bar && !bar.hidden && /coach-bar--rules/.test(bar.cls), bar?.cls);
  check('开局摆的是 A', ruleOf(o, 'circle') === 0, o.text);
  check('（尺子）得分图案此刻是 4 枚（对照按 1×4 认组）', o.n === 4, String(o.n));
  check('A：手机上也摆配图（coach-bar--anim，那一格不收起）', !!bar && /coach-bar--anim/.test(bar.cls) && bar.art !== 'none', `${bar?.art}`);
  check('A 的配图是那段动画：三行、每行四枚，真的在跑（ra-cyc）', !!bar && bar.cyc === 12 && bar.rows.join() === '4,4,4' && bar.anim.join() === 'ra-cyc',
    JSON.stringify(bar && { cyc: bar.cyc, rows: bar.rows, anim: bar.anim }));
  judge(o, 'circle', '开局');

  // 得分图案块、外边带子：A、B 都不亮；带子轻微闪烁。
  const deco = await page.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      return el ? { anim: getComputedStyle(el).animationName, filter: getComputedStyle(el).filter } : null;
    };
    // 那条闪烁的关键帧，从样式表里读出来：只认 opacity，两头 1、中间 0.85。
    let frames = null;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'edge-band-breathe') {
          frames = [...r.cssRules].map((f) => ({ at: f.keyText, style: f.style.cssText }));
        }
      }
    }
    return { band: cs('.edge-band'), frames };
  });
  check('外边带子不亮灯（没有 filter）', !!deco.band && deco.band.filter === 'none', JSON.stringify(deco.band));
  check('外边带子轻微闪烁（edge-band-breathe）', !!deco.band && deco.band.anim === 'edge-band-breathe', deco.band?.anim);
  const ops = (deco.frames || []).map((f) => Number((f.style.match(/opacity:\s*([\d.]+)/) || [])[1]));
  const onlyOpacity = (deco.frames || []).every((f) => /^opacity:\s*[\d.]+;?$/.test(f.style.trim()));
  check('闪烁只动透明度，只在 0.85 到 1 之间', !!deco.frames && onlyOpacity && Math.min(...ops) === 0.85 && Math.max(...ops) === 1,
    JSON.stringify(deco.frames));

  // ── A 摆满 10 秒，换到 B（不滑也换）。B 那一盏灯要亮在最少步数那一组上。
  await page.waitForTimeout(A_MS + 300);
  o = await waitLit(page, 'circle', await settle(page, 'circle', QUIET_FULL_MS));
  check('A 摆满 10 秒：换到 B', ruleOf(o, 'circle') === 1, nameOf(ruleOf(o, 'circle')));
  const after = await page.evaluate(() => ({
    cls: document.querySelector('.coach-bar').className,
    art: getComputedStyle(document.querySelector('.coach-bar .coach-art')).display,
  }));
  check('B 起手机上配图收起来（只留字）', !/coach-bar--anim/.test(after.cls) && after.art === 'none', `${after.art}`);
  // 拖完那一步要拿这一份对「不跳色」：同一条 B 里，拖之前亮的那一色要是还在最少步数那几色里，App 就该留着它——不传的话
  // 门把拖完那一下当成头一回亮，错套「平手挑带星星的」那一条（随机发牌撞上「拖之前亮的那一色没有星星、平手的别色有」就红）。
  const memoB = {};
  const res = judge(o, 'circle', 'B 刚出来', memoB);
  const lit = new Map(o.at.filter(([, v]) => v.lit));
  check('（尺子）B 刚出来这一副上灯亮着（对照算得出最少步数）', lit.size > 0, res);
  check('亮着的那几枚真的在动（glow-pulse-coach）', lit.size > 0 && [...lit.values()].every((v) => v.anim === 'glow-pulse-coach'),
    [...new Set([...lit.values()].map((v) => v.anim))].join(','));
  check('没亮的那几枚一枚都没在动', o.at.filter(([, v]) => !v.lit).every(([, v]) => v.anim === 'none'));

  // ── 那道光真的看得见：逐帧量亮度 ─────────────────────────────────────
  //
  // 「在动画」不等于「看得见」：玩家 2026-10 第二轮报过「呼吸灯看不清」，那一版动画照样在跑。所以量像素：把动画
  // 停在最暗（0%）和最亮（一半）两帧，各截一张亮着的那一枚外扩 26px 的一圈，算平均每通道差。门槛的来历见 MEAN_MIN。
  const first = [...lit.keys()][0];
  if (first) {
    const clip = await page.evaluate((key) => {
      const [r, c] = key.split(',');
      const el = document.querySelector(`#boardWrap [data-r="${r}"][data-c="${c}"]`);
      const b = el.getBoundingClientRect();
      const M = 26;
      return { x: Math.max(0, Math.round(b.left - M)), y: Math.max(0, Math.round(b.top - M)), width: Math.round(b.width + M * 2), height: Math.round(b.height + M * 2) };
    }, first);
    const seek = (t) => page.evaluate(([ms]) => {
      let info = null;
      for (const el of document.querySelectorAll('#boardWrap .coach-glow')) {
        for (const a of el.getAnimations ? el.getAnimations() : []) {
          a.pause();
          a.currentTime = ms === null ? (a.effect.getTiming().duration || 2200) / 2 : ms;
          info = { name: a.animationName, dur: a.effect.getTiming().duration };
        }
      }
      return info;
    }, [t]);
    const px = async () => (await page.screenshot({ clip })).toString('base64');
    const info = await seek(0);
    check('（尺子）抓得到那条光的动画，停得住', !!info, info ? `${info.name} / ${info.dur}ms` : '（没抓到）');
    const dark = await px();
    await seek(null);
    const bright = await px();
    const delta = await page.evaluate(async ([a, b]) => {
      const load = (b64) => new Promise((res2, rej) => {
        const img = new Image();
        img.onload = () => res2(img);
        img.onerror = rej;
        img.src = 'data:image/png;base64,' + b64;
      });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const data = (img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      const da = data(ia);
      const db = data(ib);
      if (da.length !== db.length) return null;
      let sum = 0;
      let n = 0;
      let worst = 0;
      for (let i = 0; i < da.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(da[i + k] - db[i + k]);
          sum += d;
          n++;
          if (d > worst) worst = d;
        }
      }
      return { mean: sum / n, worst };
    }, [dark, bright]);
    /*
     * 门槛 **15**（平均每通道差）。两头都量过（390×844，亮着的那一枚外扩 26px，换几副开局各量一次）：
     *
     *   · 现在这版（三层 7 / 13 / 22，奶油色）：24.7–37.0；
     *   · 从前「看不清」的那一版（单层 10px，--glow 那支微红）：5.4–8.5；
     *   · 三层但不换奶油色（浅色主题那支微红糊在暗托盘上）：1.3–2.0——几乎看不见，这正是 style.css 里那一条要就地
     *     换 --glow 的原因。
     *
     * 门槛卡在两头中间、离坏值宽出一截。⚠️ 第 8 推那一道的教训照旧：门槛压在坏值底下就一条都拦不住。这个数跟着截图
     * 那一圈（外扩 26px）走，那一圈改了要重新两头量。
     */
    const MEAN_MIN = 15;
    check(`那道光真的看得见（最暗 ↔ 最亮，平均每通道差 ≥ ${MEAN_MIN}）`, !!delta && delta.mean >= MEAN_MIN,
      delta ? `平均 ${delta.mean.toFixed(2)} / 最大 ${delta.worst}（量了 ${clip.width}×${clip.height}）` : '（没量到）');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('#boardWrap .coach-glow')) for (const a of el.getAnimations ? el.getAnimations() : []) a.play();
    });

    // ── 不加任何热区：手指落在亮着的那一枚上，碰到的就是那一枚 ─────────────
    const hit = await page.evaluate((key) => {
      const [r, c] = key.split(',');
      const el = document.querySelector(`#boardWrap [data-r="${r}"][data-c="${c}"]`);
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { same: !!top && (top === el || el.contains(top)), tag: top ? top.tagName + '.' + String(top.className.baseVal ?? top.className) : null };
    }, first);
    check('手指落在亮着的那一枚上，碰到的就是那一枚（灯没有盖一层）', hit.same, hit.tag);
    // 也不许**变大**：亮着的那几枚，紧贴着外沿（半径 + 3px）一圈八个点，一个都不许还按得到它。
    const ring = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#boardWrap .coach-glow')) {
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        const rr = b.width / 2 + 3;
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const top = document.elementFromPoint(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
          if (top && (top === el || el.contains(top))) bad.push(`${el.dataset.r},${el.dataset.c}@${k * 45}°`);
        }
      }
      return bad;
    });
    check('亮着的那几枚可按的范围没有变大（外沿一圈按不到它）', ring.length === 0, ring.slice(0, 4).join(' '));
  }

  // ── 真的拖：顺着对照给的路滑一步（拖动照常，灯不拦手），盘面真的变了 ──────────
  const stepTo = firstStepOf(o, 'circle', 'group');
  check('（尺子）对照给得出下一步', !!stepTo);
  if (stepTo) {
    const before = JSON.stringify(o.at.map(([k, v]) => [k, v.face, v.color]));
    await dragMove(page, o, stepTo.line, stepTo.shift);
    const o2 = await waitLit(page, 'circle', await settle(page, 'circle', QUIET_FULL_MS));
    check('真的拖那一步：盘面变了（拖动照常，灯不拦手）', JSON.stringify(o2.at.map(([k, v]) => [k, v.face, v.color])) !== before);
    judge(o2, 'circle', '拖完那一步', memoB);
  }
  await ctx.close();
}

// ===========================================================================
// ② 真滑几十步，每一步结算完对一次（小球、方块各一局；减弱动态效果，结算快）
// ===========================================================================
for (const [idx, shape, name] of want(2) ? [[1, 'circle', '小球'], [0, 'square', '方块']] : []) {
  head(`② ${name}：真滑几十步，每一步结算完对一次（B → C → D）`);
  const { ctx, page } = await openFirst({ idx, reduce: true });
  check(`（尺子）这一局真的是${name}`, await page.evaluate(() => document.querySelector('.app--game').getAttribute('data-shape')) === shape);
  // A 不亮，等它过去（或者头一下得分）。这儿等满 10 秒：B 那一条从开局那副盘面就量得到。
  let o = await settle(page, shape);
  judge(o, shape, `${name}开局`);
  await page.waitForTimeout(A_MS + 300);
  o = await settle(page, shape);
  const tally = { lit1: 0, litN: 0, none: 0, heavy: 0, bad: 0, skip: 0, once: 0, edge: 0, edge0: 0, moved: 0, stat: 0, blockStat: 0 };
  seenC = null;
  const seen = new Set();
  const memo = {};
  // 种子固定，同一副盘面每次走同一串（盘面本身是随机发的）。
  let seed = 20261011 + idx;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let step = 0; step < 44; step++) {
    o = await waitLit(page, shape, o, memo);
    const rule = ruleOf(o, shape);
    seen.add(rule);
    // C 在两次读屏之间整个过去了：拿读到过的那一副补量图案块（见 seenC）。
    if (seenC && rule !== 2 && !seen.has(2)) {
      seen.add(2);
      const b = seenC.block;
      check(`${name}（C，两步之间读到的那一副）：HUD 那块《得分图案》亮着`, /\bcoach-glow-block\b/.test(b?.cls || '') &&
        (b.anim === 'glow-pulse-coach' || /drop-shadow/.test(b.filter)), JSON.stringify(b));
    }
    seenC = null;
    const res = judge(o, shape, `${name}第 ${step} 步`, memo);
    tally[res] = (tally[res] ?? 0) + 1;
    // 减弱动态效果：亮着的那几枚是静止光晕（不跑动画，filter 上有 drop-shadow）；C 那一条图案块也是。
    const litCells = o.at.filter(([, v]) => v.lit).map(([, v]) => v);
    if (litCells.length && !tally.stat) {
      tally.stat++;
      check(`${name}：减弱动态效果时是静止光晕（animation: none，filter 里有 drop-shadow）`,
        litCells.every((v) => v.anim === 'none' && /drop-shadow/.test(v.filter)), `${litCells[0].anim} / ${litCells[0].filter.slice(0, 60)}`);
    }
    if (HINT_OF[rule] === 'groupOnce' && !tally.blockStat) {
      tally.blockStat++;
      check(`${name}（C）：减弱动态效果时图案块也是静止光晕`, o.block?.anim === 'none' && /drop-shadow/.test(o.block?.filter || ''), JSON.stringify(o.block));
    }
    if (rule === 4) break;
    // 下一步：多半顺着对照给的路走（B → 降级 → C → D 要快），别的时候随手滑一条线。
    const kind = HINT_OF[rule];
    const follow = kind && rnd() < 0.8 ? firstStepOf(o, shape, kind === 'edge' ? 'edge' : 'group') : null;
    let line;
    let sh;
    if (follow) {
      ({ line, shift: sh } = follow);
    } else {
      line = Math.floor(rnd() * o.slide.length);
      sh = 1 + Math.floor(rnd() * Math.min(2, o.slide[line].length - 1));
      if (rnd() < 0.5) sh = o.slide[line].length - sh;
    }
    const before = JSON.stringify(o.at.map(([k, v]) => [k, v.face, v.color]));
    await dragMove(page, o, line, sh);
    o = await settle(page, shape);
    if (JSON.stringify(o.at.map(([k, v]) => [k, v.face, v.color])) !== before) tally.moved++;
    if (await page.evaluate(() => !!document.querySelector('.overlay--end.show'))) break;
  }
  const summary = `B/C 一步亮对 ${tally.lit1} 次 / 多步亮对 ${tally.litN} 次 / 拼不出、不亮 ${tally.none} 次 / C 之后跟着走 ${tally.once} 次 / ` +
    `D 亮对 ${tally.edge + tally.edge0} 次 / 对照跳过（盘面太多）${tally.heavy} 次 / 不亮的那一条 ${tally.skip} 次 / 走到过 ${[...seen].sort().map(nameOf).join('')}`;
  console.log('      ' + summary);
  check(`${name}：（尺子）真的滑动了（每一步之后盘面变了）`, tally.moved >= 10, `${tally.moved} 步动了`);
  check(`${name}：（尺子）B 那一条亮灯的盘面量到过好几次`, tally.lit1 + tally.litN >= 3, summary);
  check(`${name}：（尺子）走到过 C（图案真的降了一级）`, seen.has(2), summary);
  check(`${name}：（尺子）走到过 D`, seen.has(3), summary);
  check(`${name}：（尺子）对照跳过的盘面不多（≤ 三分之一）`, tally.heavy * 3 <= Object.values(tally).reduce((a, b) => a + b, 0), summary);
  check(`${name}：一次都没亮错`, tally.bad === 0, `${tally.bad} 次`);
  await ctx.close();
}

// ===========================================================================
// ③ 手机端：字号是放大的那一档、最多两行、不压住棋盘；A 那一幅动画也摆得下
// ===========================================================================
//
// 「原来」是第 14 推那一版的字号，照它的两条规则算：竖屏 clamp(12.5px, 1.95vh, 15px)，横屏（矮于 560）
// clamp(11.5px, 2.9vh, 14px)。写死在这儿当尺子——哪天有人把那两条规则也改大了，「两倍」就跟着水涨船高。
const baseOf = (w, h) => (w > h && h <= 560 ? Math.min(14, Math.max(11.5, 0.029 * h)) : Math.min(15, Math.max(12.5, 0.0195 * h)));
const MEASURE = async ([texts]) => {
  const bar = document.querySelector('.coach-bar');
  const txt = bar.querySelector('.coach-text');
  const art = bar.querySelector('.coach-art');
  const out = [];
  for (const t of texts) {
    txt.textContent = t;
    // 条子自己在 resize 时重量一次（ui/coachBar.ts 的 refit）——换了字之后借这一下。
    window.dispatchEvent(new Event('resize'));
    // 条子一变高，棋盘那一格就变矮，而棋盘的大小是 ResizeObserver 回头再量、再画的（不是同一拍）——当场量会把「棋盘
    // 还没缩回去」的那一帧当成压住了。等两帧再量。
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60))));
    const board = document.querySelector('#boardWrap').getBoundingClientRect();
    const cs = getComputedStyle(txt);
    const b = bar.getBoundingClientRect();
    const a = art.getBoundingClientRect();
    // 几行：数字，不数盒子（手机端那一格垫了两行的最小高度，盒子永远至少两行高）。
    const count = () => {
      const range = document.createRange();
      range.selectNodeContents(txt);
      const tops = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.top).sort((x, y) => x - y);
      let n = 0;
      let last = -Infinity;
      for (const t0 of tops) {
        if (t0 - last > parseFloat(getComputedStyle(txt).fontSize) / 2) n++;
        last = t0;
      }
      return n;
    };
    const lines = count();
    const font = parseFloat(cs.fontSize);
    // 收没收过头：字号是被收小了的，那就再大 1px 量一次——必须摆不进两行了才对。
    let bigger = null;
    if (txt.style.fontSize) {
      const keep = txt.style.fontSize;
      txt.style.fontSize = font + 1 + 'px';
      bigger = count();
      txt.style.fontSize = keep;
    }
    out.push({
      font,
      lines,
      bigger,
      barH: Math.round(b.height),
      rowH: Math.round(bar.querySelector('.coach-row').getBoundingClientRect().height),
      overlap: !(b.top >= board.bottom - 0.5 || b.bottom <= board.top + 0.5 || b.left >= board.right - 0.5 || b.right <= board.left + 0.5),
      inView: b.top >= 0 && b.bottom <= innerHeight + 0.5 && b.left >= -0.5 && b.right <= innerWidth + 0.5,
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)],
      boardRect: [Math.round(board.left), Math.round(board.top), Math.round(board.right), Math.round(board.bottom)],
      art: getComputedStyle(art).display,
      artIn: a.width > 0 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5,
    });
  }
  return out;
};
if (want(3)) {
  head('③ 手机端（≤999px）：字号是放大的那一档、最多两行、不压住棋盘；A 那一幅动画摆得下');
  const zhCircle = tutorialRules('zhHans', 'circle');
  const zhSquare = tutorialRules('zhHans', 'square');
  const VIEWS = [[390, 844], [360, 640], [375, 667], [414, 896], [430, 932], [844, 390], [667, 375]];
  const { ctx, page } = await openFirst({ idx: 1 });
  // A 那一条（开局就是它）：配图那段动画手机上也摆，条子不变高、不压棋盘、动画整块在条子里，字两行以内。
  // A 那一条的条子量的是「字和图那一行」（.coach-row）的高：条子顶上那一行（进度 + 那颗《<》）在 A 上没有《<》，
  // B 起才有，那一行本来就高出 11px 左右——那是第 15 推起就有的事，和这一幅动画无关（见下面印出来的那一句）。
  const aHeights = new Map();
  const aBars = new Map();
  for (const [w, h] of VIEWS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const [a] = await page.evaluate(MEASURE, [[zhCircle[0]]]);
    aHeights.set(`${w}×${h}`, a.rowH);
    aBars.set(`${w}×${h}`, a.barH);
    check(`${w}×${h}：A 那一条配图摆出来、整块在条子里，字两行以内、不压棋盘`, a.art !== 'none' && a.artIn && a.lines <= 2 && !a.overlap && a.inView,
      `配图 ${a.art}${a.artIn ? '' : '（出了条子）'} / ${a.font}px ${a.lines} 行 / 条子 ${a.rect} 棋盘 ${a.boardRect}`);
    check(`${w}×${h}：A 那一条字收小了的话，是两行放得下的最大一号（没收过头）`, a.bigger === null || a.bigger > 2, `${a.font}px，再大 1px 是 ${a.bigger} 行`);
  }
  // 别的四条：等 A 摆满 10 秒、换到 B（手机上只留字）再量。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(A_MS + 300);
  check('（尺子）换到了 B', ruleOf(await page.evaluate(ORACLE, { shape: 'circle' }), 'circle') === 1);
  // 中文这几句，两倍放得进两行，必须做到（小球第 4 条见下面）。
  const must = [['第 2 条', zhCircle[1]], ['第 3 条', zhCircle[2]], ['第 5 条', zhCircle[4]], ['第 4 条（方块）', zhSquare[3]]];
  for (const [w, h] of VIEWS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const base = baseOf(w, h);
    const got = await page.evaluate(MEASURE, [must.map(([, t]) => t)]);
    // 10-09 补充方案第一部分第 2 条：手机端这一档比「两倍」小一档——clamp(25px, 3.9vh, 30px) 换成 clamp(23px, 3.6vh, 28px)。
    const wantFont = Math.min(28, Math.max(23, 0.036 * h));
    const was = Math.min(30, Math.max(25, 0.039 * h));
    const bad = got.map((g, i) => [must[i][0], g]).filter(([, g]) => !(Math.abs(g.font - wantFont) <= 0.1 && g.font <= was - 1 && g.lines <= 2));
    check(`${w}×${h}：中文四句（小球第 4 条除外）字号 = ${wantFont.toFixed(1)}px（原来那一档 ${base.toFixed(1)}px 的 ${(wantFont / base).toFixed(2)} 倍），最多两行`,
      bad.length === 0,
      bad.length ? bad.map(([n, g]) => `${n} ${g.font}px ${g.lines} 行`).join('；') : got.map((g) => `${g.font}px/${g.lines}行`).join(' '));
    check(`${w}×${h}：条子不压住棋盘、整块在屏幕里`, got.every((g) => !g.overlap && g.inView),
      got.filter((g) => g.overlap || !g.inView).map((g) => `条子 ${g.rect} 棋盘 ${g.boardRect}`).join('；'));
    check(`${w}×${h}：A 之外这几条配图收起来（两倍的字和图摆不下）`, got.every((g) => g.art === 'none'), got[0].art);
    // 一行的、两行的，条子一样高：棋盘是开局量一次就钉住的，条子换条时往上长，就会长进棋盘里。A 那一幅动画摆在字那一
    // 行里，那一行也不许比别的几条高（矮也不行：换到 B 的时候它就往上长）。
    const hs = got.map((g) => g.barH);
    check(`${w}×${h}：B 起换哪一条，条子都一样高（换条时不往棋盘里长）`, Math.max(...hs) - Math.min(...hs) <= 1, hs.join(' / '));
    const rows = [...got.map((g) => g.rowH), aHeights.get(`${w}×${h}`)];
    check(`${w}×${h}：A 那一幅动画不让字那一行变高、也不变矮（和别的几条一样高）`, Math.max(...rows) - Math.min(...rows) <= 1, rows.join(' / '));
    console.log(`      ${w}×${h}：整条条子 A ${aBars.get(`${w}×${h}`)}px → B 起 ${hs[0]}px（顶上那一行 B 起多出那颗《<》，第 15 推起如此）`);
    // 小球第 4 条：两倍摆不进两行。两行优先，字号能大多少大多少，至少不比原来小。
    const [long] = await page.evaluate(MEASURE, [[zhCircle[3]]]);
    check(`${w}×${h}：小球第 4 条两行之内、不比原来小、不压棋盘`, long.lines <= 2 && long.font >= base - 0.05 && !long.overlap && long.inView,
      `${long.font}px（原来的 ${(long.font / base).toFixed(2)} 倍）/ ${long.lines} 行 / 条子 ${long.rect} 棋盘 ${long.boardRect}`);
    check(`${w}×${h}：小球第 4 条收到的是两行放得下的最大一号（没收过头）`,
      long.bigger === null || long.bigger > 2, `${long.font}px，再大 1px 是 ${long.bigger} 行`);
  }
  // 外语：只量「不压棋盘」；两倍与两行做到几成，印出来给玩家看。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  for (const lang of ['en', 'fr', 'zhHant']) {
    const texts = [...tutorialRules(lang, 'circle').slice(1), tutorialRules(lang, 'square')[3]];
    const got = await page.evaluate(MEASURE, [texts]);
    check(`390×844 ${lang}：每一句都不压住棋盘、整块在屏幕里`, got.every((g) => !g.overlap && g.inView));
    const over = got.filter((g) => g.bigger !== null && g.bigger <= 2);
    check(`390×844 ${lang}：收小了的那几句都是两行放得下的最大一号（没收过头）`, over.length === 0,
      over.map((g) => `${g.font}px 再大 1px 才 ${g.bigger} 行`).join('；'));
    console.log(`      ${lang}：` + got.map((g, i) => `${i === 4 ? '方块4' : i + 2}=${(g.font / baseOf(390, 844)).toFixed(2)}倍/${g.lines}行`).join(' '));
  }
  await ctx.close();
}
if (want(3)) {
  head('③′ 电脑端三栏不动：那一档不放大、配图还在');
  // 电脑端的主菜单不是那条轴，开局照手机那样点，再把窗口拉成电脑那么大。
  const { ctx, page } = await openFirst({ idx: 1 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const d = await page.evaluate(() => {
    const t = document.querySelector('.coach-bar .coach-text');
    return { font: parseFloat(getComputedStyle(t).fontSize), art: getComputedStyle(document.querySelector('.coach-bar .coach-art')).display };
  });
  // 电脑端那一条是 clamp(17px, 2.5vh, 23px)：900 高是 22.5px。
  check('1440×900：教学字号还是电脑端那一档（没被手机端的两倍盖掉）', Math.abs(d.font - 22.5) < 0.1, `${d.font}px`);
  check('1440×900：配图还在', d.art !== 'none', d.art);
  await ctx.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
check('全程零报错', errs.length === 0);
await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
