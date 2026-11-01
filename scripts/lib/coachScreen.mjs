/**
 * 教学呼吸灯那几道浏览器门共用的读屏、对照和走子（从 check-coach-aim.mjs 原样抽出来，10-31 方案推15 Z-C06：check-coach-budget、
 * check-coach-sync 都要「照 check-coach-aim 的读屏走子法」走）。一个字没改，只把两样原先直接引的外部东西改成先交进来：
 *
 *   initCoachScreen({ outerEdges, EDGE_MIN, tutorialRules })   // 外边几何（engine/outerEdge.ts）和五条的字（i18n.ts），门当场打包
 *   setOnRead((o, shape) => …)                                 // settle / waitLit 每读一次屏顺手调一下（check-coach-aim 拿它记「读到过 C」）
 *
 * 读屏只读屏幕上有的东西（位置、正反面、颜色、亮没亮），不读 data-id、不问游戏状态；对照是门这边独立写的，不借游戏的
 * findMatches 和搜索——借了就是拿被测的东西量它自己。
 */
let outerEdges = null;
let EDGE_MIN = 3;
let tutorialRules = null;
export function initCoachScreen(deps) {
  ({ outerEdges, EDGE_MIN, tutorialRules } = deps);
}
let onRead = null;
export function setOnRead(fn) {
  onRead = fn;
}

/** ui/coachBar.ts 的 HINT_OF：第几条要灯做什么。 */
export const HINT_OF = ['group', 'group', 'group', 'edge', 'best'];

/**
 * 读屏（在页面里跑）：每一枚的位置、正反面、颜色、亮没亮，外加两种线、此刻几枚一组、条子上摆的是哪一句、HUD 那块
 * 《得分图案》亮没亮。算法在 node 这头。
 */
export const ORACLE = ({ shape }) => {
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
export const OR_CAP = 60000;
/** 最多看几步：和游戏一样（engine/coachHint.ts 的 HINT_MAX_DEPTH）。 */
export const OR_DEPTH = 8;
export const lineA = (d) => Array.from({ length: 7 - d }, (_, k) => [d + k, k]);
export const lineB = (e) => Array.from({ length: 7 - e }, (_, k) => [e + k, e]);
export const lineRow = (r) => Array.from({ length: r + 1 }, (_, c) => [r, c]);
export const CIRCLE_EDGE_LINES = [
  ...Array.from({ length: 7 }, (_, d) => ({ fam: 'A', offset: d, cells: lineA(d) })),
  ...Array.from({ length: 7 }, (_, e) => ({ fam: 'B', offset: e, cells: lineB(e) })),
  ...Array.from({ length: 7 }, (_, r) => ({ fam: 'R', offset: r, cells: lineRow(r) })),
];

/**
 * 把读屏结果下标化：格 0…M−1，S[格] = 此刻在这一格上的是开局（读屏那一刻）哪一格的那一枚。
 */
export function model(o, shape) {
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
export function shift(m, S, li, s) {
  const line = m.slide[li];
  const L = line.length;
  const old = line.map((c) => S[c]);
  for (let i = 0; i < L; i++) S[line[i]] = old[(((i - s) % L) + L) % L];
}
export const colorOf = (m, S, c) => m.P[S[c]].color;
export const faceOf = (m, S, c) => m.P[S[c]].face;
/** 此刻会得分的那几组：同色连着 ≥ N（按整条几何线，中间离场一格就断开）、碰到这一步滑过的线、至少一枚色块。 */
export function scoring(m, S, moved) {
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
export function clearing(m, S) {
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
export function idaOnce(m, S, { bound, h, verdict, budget, collect = null }) {
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
export function minDepthsOracle(m, colors, hOf, verdictOf, budget) {
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
export function planGroupOracle(o, shape) {
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
export function planEdgeOracle(o, shape) {
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

export const litOf = (o) => o.at.filter(([, v]) => v.lit).map(([k]) => k).sort();
export const ruleOf = (o, shape) => tutorialRules('zhHans', shape).indexOf(o.text);
export const nameOf = (i) => (i < 0 ? '（没有条子）' : 'ABCDE'[i]);

/**
 * 真的拖一下：从那条线上的一枚出发，沿着线的方向拖 shift 格（取近的那一头）。
 *
 * 起点挑得让终点还落在这条线上的另一枚棋子上——拖到盘外去，有的棋盘会把手指当成离开了。
 */
export async function dragMove(page, o, line, shift) {
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
export async function settle(page, shape, quietMs = 450) {
  let last = '';
  let since = Date.now();
  for (let k = 0; k < 160; k++) {
    await page.waitForTimeout(150);
    const o = await page.evaluate(ORACLE, { shape });
    onRead?.(o, shape);
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
export const QUIET_FULL_MS = 1700;
/**
 * 灯是分段在空闲时算的，**算完才亮**（10-11 方案 D-4）：盘面安静了、这一条该亮灯却还黑着的话，再等一会儿（最多
 * LIT_WAIT_MS，盘面和条子都不许变）。量的是「亮得对不对」；多久之内必须亮是 check-coach-budget 的事（D-5 第 2 条，
 * CPU 降速六倍、一秒之内）。
 */
export const LIT_WAIT_MS = 4000;
/**
 * 等的时候条子换了档（C 摆满时间换到 D），**照新的那一条接着等**，不是立刻交回去（10-16 修，门自己的毛病）：原先这一下
 * 直接返回，读到的是「D 已经出来、D 的灯还没算完」那一瞬间——一枚都不亮，judge 判成「D 亮错了」。10-16 P1 那一推的 CI
 * 上真红过一次（小球第 4 步：C 在两次读屏之间整个过去，读到 D 时灯还黑着；第 5 步起同一色全对）。换档最多跟两次。
 */
export async function waitLit(page, shape, o, memo = {}, hops = 0) {
  const rule = ruleOf(o, shape);
  if (!(rule >= 0 && HINT_OF[rule]) || litOf(o).length) return o;
  const sig = (x) => JSON.stringify(x.at.map(([k, v]) => [k, v.face, v.color]));
  const s0 = sig(o);
  const t0 = Date.now();
  while (Date.now() - t0 < LIT_WAIT_MS) {
    await page.waitForTimeout(200);
    const o2 = await page.evaluate(ORACLE, { shape });
    onRead?.(o2, shape);
    if (ruleOf(o2, shape) !== rule && sig(o2) === s0 && hops < 2) return waitLit(page, shape, o2, memo, hops + 1);
    if (sig(o2) !== s0 || ruleOf(o2, shape) !== rule || litOf(o2).length) return o2;
  }
  return page.evaluate(ORACLE, { shape });
}

/**
 * 顺着对照给的路走一步：B / C 是最少步数那一色的第一步（随便哪一条最优的路），D 是最少步数那一色填外边的第一步。
 * 没有就回 null（随手滑）。
 */
export function firstStepOf(o, shape, kind) {
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

/**
 * D、E（判成外边那一种）也要能多步顺着走（10-31 整合版 Z-C01；只改门，不改游戏）：firstStepOf 对外边只找「一步就能
 * 填满」的那种，一步不行就随手滑——模拟过，那样 500 局里 0 局在 60 轮内读到 E。这里：① 先找一步填满的；② 没有就取
 * 对照给的那一色 k（对照超上限、或步数为 0 就回 null）；③ h(盘面) = 所有长度 ≤「k 色星星总数」的外边里「边长 − 这条边
 * 上已有的 k 色星星数」的最小值；④ 逐个试走法表里的每一步，取第一步「之后盘上没有可消的边、这一步不得分、h 变小」的；
 * ⑤ 都不满足回 null（照旧随手滑）。写法照方案附带的 sim-coach1029/run1029.mjs 的 edgeStepOf。
 */
export function edgeStepOf(o, shape) {
  const one = firstStepOf(o, shape, 'edge');
  if (one) return one;
  const r = planEdgeOracle(o, shape);
  if (!r || r.capped || !r.depth || !r.colors?.length) return null;
  const k = r.colors[0];
  const m = model(o, shape);
  const S = m.keys.map((_, i) => i);
  const stars = m.P.filter((p) => p.face === 'dot' && p.color === k).length;
  const h = (T) => {
    let best = Infinity;
    for (const e of m.edges) {
      if (!e.length || e.length > stars) continue;
      let cnt = 0;
      for (const c of e) if (m.P[T[c]].face === 'dot' && m.P[T[c]].color === k) cnt++;
      best = Math.min(best, e.length - cnt);
    }
    return best;
  };
  const h0 = h(S);
  for (const [li, sh] of m.moves) {
    shift(m, S, li, sh);
    const ok = !clearing(m, S).length && !scoring(m, S, m.movedSets[li]).length && h(S) < h0;
    shift(m, S, li, m.slide[li].length - sh);
    if (ok) return { line: li, shift: sh };
  }
  return null;
}
