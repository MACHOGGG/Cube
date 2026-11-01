/**
 * 教学呼吸灯的搜索：拿**真棋盘**、几百个**真局面**，和一份不带估值的逐层加深逐个对（10-14 方案 D-5 第 1 条；
 * 10-31 方案推15 Z-C06 建门）。
 *
 *   node scripts/check-coach-plan.mjs            # 读真局面、逐个对
 *   node scripts/check-coach-plan.mjs --mutants  # 另把搜索改坏四处（只在这一份打包里改），对应那几条必须红
 *
 * 纯 node，不开浏览器。check-coach 用的是手摆的盘面、手写的一把 1×N 尺子；这道门问的是棋盘**自己交给搜索的那一份**
 * （square.ts / circle.ts 的 glowView：走法、线、外边、认组、消边全是棋盘的），局面也是真的：
 *
 *   · 局面从金标那几副开局牌来（check-seed-golden 那张表：编号表二十行 × 三个随机数，加一周的每日挑战），只取有教学条
 *     的两族——经典方块、经典小球，玩法取基础、计时、炸弹、定时炸弹、步步为营（老虎机换了得分图案、无限反转会翻回来，
 *     这两档从来不讲教学）。每副按固定种子走 0–30 步（一半的步子挑一步会得分的，好把阶梯推下去），每隔一步取一个局面；
 *     走子照棋盘拖完一步那样：线上换位置、把动过的格子交给控制器的 resolveMove，连锁走完再取下一步。
 *   · 门里自带的参考只用 PlanBoard 的 step.moves / scoring / clearing，不带估值、逐层加深（同一条线连着滑两次 = 一次，
 *     这一支剪掉——它只省时间，不改答案）。
 *
 * 逐个局面断言：
 *   ① planGroup：最少步数、挑的色、亮的那 N 枚，和参考一致。平手规则照搜索那一套挑：保留正在亮的色 → 含星星 → 盘面
 *      哈希（门里另拿「上一次亮的是另一个平手的色」再问一遍，要留住它）；亮的那 N 枚必须是参考在最少步数那一层碰到的
 *      某一组里连着的 N 枚、至少一枚色块。
 *   ② planEdge 的估值版和 h≡0 版（同一份打包，只把 edgeH 换成 0）逐个一致；参考也独立算一遍。亮的是那一色在场的
 *      全部星星，一枚色块都不亮（站长 10-30「D 只亮星星」）。
 *   ③ 估值从不高估：每一色只要参考知道它的最少步数，groupH / edgeH 就不许比它大。
 *   ④ planBest（E）：挑出来那一种的步数 = 两个参考值的较小者；两者相等时挑的是外边（站长 10-30）。
 *   ⑤ 退回估值（estimate）的局面单独计数，超过 1% 就红——那说明 HINT_NODE_CAP 不够。
 *
 * 尺子：两族各 ≥ 200 个局面；里头要有降过级的、盘上没有色块的、有活炸弹的（各至少一个，不然那一种情形没验到）。
 *
 * 变异（--mutants）：估值 +1、平手不保留上一色、D 改成亮色块、planBest 平手回到取图案（<= 改成 <），各自要红。
 */
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeSim } from './lib/endDetectBundle.mjs';
import * as SC from '../api/_seedcode.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = process.argv.includes('--mutants');
const VERBOSE = process.env.VERBOSE === '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── 打包：搜索（几份变体）和发牌 ─────────────────────────────────────────────
const HINT_SRC = readFileSync(join(ROOT, 'src/engine/coachHint.ts'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'coach-plan-'));
async function hintBundle(name, edit) {
  const src = edit ? edit(HINT_SRC) : HINT_SRC;
  if (edit && src === HINT_SRC) throw new Error(`门要跟着改：变体「${name}」没改到 coachHint.ts`);
  const out = join(tmp, `${name}.mjs`);
  buildSync({
    stdin: { contents: src, resolveDir: join(ROOT, 'src/engine'), loader: 'ts', sourcefile: 'coachHint.ts' },
    bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent',
  });
  return await import(pathToFileURL(out).href);
}
const one = (src, from, to) => {
  if (src.split(from).length !== 2) throw new Error(`门要跟着改：coachHint.ts 里认不出「${from.slice(0, 60)}」`);
  return src.replace(from, to);
};
const H = await hintBundle('base');
/** ② 的 h≡0 版：edgeH 一律回 0（IDA* 退成逐层加深），别的一字不动。 */
const H0 = await hintBundle('h0', (s) => one(s, 'export function edgeH<T extends { id: number }>(b: PlanBoard<T>, k: number, stars: number): number {\n',
  'export function edgeH<T extends { id: number }>(b: PlanBoard<T>, k: number, stars: number): number {\n  if (b) return 0;\n'));
const MUT = MUTANTS
  ? {
      估值加一: await hintBundle('m1', (s) => one(s, 'export function groupH<T extends { id: number }>(b: PlanBoard<T>, k: number): number {\n',
        'export function groupH<T extends { id: number }>(b: PlanBoard<T>, k: number): number {\n  return groupH0(b, k) + 1;\n}\nfunction groupH0<T extends { id: number }>(b: PlanBoard<T>, k: number): number {\n')),
      平手不留上一色: await hintBundle('m2', (s) => one(s, '  if (prev.color !== null && ready.includes(prev.color)) color = prev.color;\n  else {', '  {')),
      D亮色块: await hintBundle('m3', (s) => one(s, `      if (!t || !b.isStar(t)) continue;
      const k = b.colorOf(t);
      const list = stars.get(k);`, `      if (!t || !b.isPiece(t)) continue;
      const k = b.colorOf(t);
      const list = stars.get(k);`)),
      平手取图案: await hintBundle('m4', (s) => one(s, 'return e.depth <= g.depth ? e : g;', 'return e.depth < g.depth ? e : g;')),
    }
  : {};
buildSync({ entryPoints: [join(ROOT, 'src/engine/seedDeal.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(tmp, 'deal.mjs'), logLevel: 'silent' });
const SD = await import(pathToFileURL(join(tmp, 'deal.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

/** 只在这一包里把两副有教学条的棋盘的 glowView 露出来（源码一字不动）。 */
const tapView = (rel, src) => {
  if (rel !== 'src/shapes/square.ts' && rel !== 'src/shapes/circle.ts') return src;
  const a = 'let grid: Tile[][] = [];';
  if (src.split(a).length !== 2 || !/function glowView\(\): PlanBoard<Tile> \{/.test(src)) throw new Error(`门要跟着改：${rel} 里认不出 grid / glowView`);
  return src.replace(a, a + '\n      (globalThis as any).__PLANVIEW = () => glowView();');
};
const sim = await makeSim(ROOT, { motion: false, mutate: tapView });

// ── 小工具 ────────────────────────────────────────────────────────────────
const drain = (gen) => {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
};
let seed = 20261031;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
function applyMove(grid, step, move) {
  const n = move.cells.length;
  const saved = [];
  for (let i = 0; i < n; i++) {
    const [r, c] = step.cells[move.cells[i]];
    saved[i] = grid[r][c];
  }
  for (let i = 0; i < n; i++) {
    const [r, c] = step.cells[move.cells[i]];
    grid[r][c] = saved[move.src[i]];
  }
  return () => {
    for (let i = 0; i < n; i++) {
      const [r, c] = step.cells[move.cells[i]];
      grid[r][c] = saved[i];
    }
  };
}
const movedOf = (b, m) => new Set(m.cells.map((i) => b.step.cells[i][0] + ',' + b.step.cells[i][1]));
const pickByHash = (items, hash, key) => [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))[hash % items.length];
/** 一组里挑那 N 枚——照搜索那一份的规矩（连着的 N 格：碰到滑过的线、至少一枚色块；退路依次放宽）。 */
function pickWindow(b, grid, cells, moved) {
  const n = b.n;
  if (cells.length <= n) return [...cells];
  const wins = [];
  for (let i = 0; i + n <= cells.length; i++) wins.push(cells.slice(i, i + n));
  const touch = (w) => w.some(([r, c]) => moved.has(r + ',' + c));
  const block = (w) => w.some(([r, c]) => b.isBlock(grid[r][c]));
  return wins.find((w) => touch(w) && block(w)) ?? wins.find(block) ?? wins.find(touch) ?? cells.slice(0, n);
}

const REF_CAP = 400_000;
/**
 * 不带估值的参考一层是几十种滑法，三层就是十几万个盘面、四层上百万——门要进 CI check，所以参考搜不深：
 *   · 搜索说「八步之内没有」时，参考确认这么多步之内确实没有；
 *   · 消外边的解常在四五步（星星要一颗颗挪到一条边上）：参考只全比 ≤ EDGE_REF_DEPTH 步的，更深的只确认这么多步之内
 *     确实没有更短的。两类各多少个照实打出来。
 */
const REF_NONE_DEPTH = 2;
const EDGE_REF_DEPTH = 2;
const HINT_MAX_DEPTH = H.HINT_MAX_DEPTH;

/**
 * 参考：不带估值、逐层加深，所有颜色一起搜，搜到「有颜色成了」的那一层为止、最多 maxDepth 层（搜索也只算到最少的那一档）。
 * kind = 'group' 时目标是「这一步滑完结算认出一组」（中间步得分、消边都是死路），'edge' 时是「这一步滑完连锁第一拍消掉一条
 * 外边」（中间步得分是死路）。回 { depth: Map(色 → 最少步数), best, leaves, capped }；leaves 收最少那一层每一个目标盘面上
 * 的组（group 用）。extraCap > 0 时在 best 那一层之后再多搜一层（只给 ③ 多拿几色的最少步数，盘面数另有上限）。
 */
function refSearch(b, kind, { maxDepth, extraCap = 0 }) {
  const moves = b.step.moves;
  const moved = moves.map((m) => movedOf(b, m));
  const lineKey = moves.map((m) => m.cells.join(' '));
  const grid = b.grid.map((r) => r.slice());
  const depth = new Map();
  const leaves = new Map();
  let nodes = 0;
  let best = Infinity;
  const searchTo = (d, cap, collect) => {
    const found = new Set();
    const go = (g, last) => {
      for (let mi = 0; mi < moves.length; mi++) {
        if (last >= 0 && lineKey[last] === lineKey[mi]) continue;
        const undo = applyMove(grid, b.step, moves[mi]);
        if (++nodes > cap) {
          undo();
          throw new Error('cap');
        }
        let open = true;
        const clears = b.clearing(grid);
        if (clears.length) {
          open = false;
          if (kind === 'edge' && g === d) for (const e of clears) found.add(b.colorOf(grid[e[0][0]][e[0][1]]));
        } else {
          const gs = b.scoring(grid, moved[mi]);
          if (gs.length) {
            open = false;
            if (kind === 'group' && g === d) {
              for (const cells of gs) {
                const k = b.colorOf(grid[cells[0][0]][cells[0][1]]);
                found.add(k);
                if (collect) {
                  const win = pickWindow(b, grid, cells, moved[mi]);
                  const list = leaves.get(k) ?? [];
                  list.push({
                    ids: win.map(([r, c]) => grid[r][c].id).sort((x, y) => x - y),
                    star: win.some(([r, c]) => b.isStar(grid[r][c])),
                    all: cells.map(([r, c]) => grid[r][c].id),
                    blocks: new Set(cells.filter(([r, c]) => b.isBlock(grid[r][c])).map(([r, c]) => grid[r][c].id)),
                  });
                  leaves.set(k, list);
                }
              }
            }
          }
        }
        if (open && g < d) go(g + 1, mi);
        undo();
      }
    };
    go(1, -1);
    return found;
  };
  try {
    for (let d = 1; d <= maxDepth; d++) {
      const found = searchTo(d, REF_CAP, true);
      if (found.size) {
        best = d;
        for (const k of found) depth.set(k, d);
        break;
      }
    }
  } catch {
    return { depth, best, leaves, capped: true, nodes };
  }
  if (extraCap && Number.isFinite(best) && best < HINT_MAX_DEPTH) {
    try {
      const more = searchTo(best + 1, nodes + extraCap, false);
      for (const k of more) if (!depth.has(k)) depth.set(k, best + 1);
    } catch {
      /* 多搜一层超了上限：就只知道最少那一档 */
    }
  }
  return { depth, best, leaves, capped: false, nodes };
}

// ── 局面 ──────────────────────────────────────────────────────────────────
/** 金标那张表的码（编号表每一行 × 三个随机数）＋ 一周的每日挑战里有教学条的那几族。 */
const RANDS = [0, 20261014, 134217727];
const DAILY_CODES = ['43VZ0M21', '5095JZ7K', '5A4NRSQ7', '6ABK40FX'];
const MODES = new Set(['base', 'timed', 'bomb', 'bombTimed', 'puzzle']);
const codes = [];
SC.VARIANTS.forEach((v, i) => {
  if (MODES.has(v.mode) && (v.board === 'square' || v.board === 'circle')) for (const r of RANDS) codes.push(SC.encodeSeed(SC.DEAL_VERSION, i, r));
});
codes.push(...DAILY_CODES);

const tally = { square: { n: 0, eroded: 0, noBlock: 0, bomb: 0 }, circle: { n: 0, eroded: 0, noBlock: 0, bomb: 0 } };
const bad = { one: [], two: [], three: [], four: [], lit: [] };
const skipped = { group: 0, edge: 0, starCap: 0 };
const edgeCover = { full: 0, shallowOnly: 0 };
let estimates = 0;
let positions = 0;
let ties = { group: 0, best: 0 };
const mutantHits = Object.fromEntries(Object.keys(MUT).map((k) => [k, 0]));
const t0 = Date.now();

function judge(code, step, b, family) {
  const tj = Date.now();
  try {
    judge0(code, step, b, family);
  } finally {
    const ms = Date.now() - tj;
    if (VERBOSE && ms > 300) console.log(`      慢：${code} 第 ${step} 步 ${family} N=${b.n} ${ms}ms`);
  }
}
function judge0(code, step, b, family) {
  positions++;
  const t = tally[family];
  t.n++;
  let blocks = 0;
  let liveBomb = false;
  for (const row of b.grid) {
    for (const tile of row) {
      if (!tile) continue;
      if (b.isBlock(tile)) blocks++;
      // 活炸弹：不是空位（空位两面都是 -1），可又不算一枚能进组的棋子（棋盘的 isPiece 把红色炸弹除外）。
      if (!b.isPiece(tile) && (tile.color >= 0 || tile.dotColor >= 0)) liveBomb = true;
    }
  }
  if (b.n < 4) t.eroded++;
  if (!blocks) t.noBlock++;
  if (liveBomb) t.bomb++;
  const where = `${code} 第 ${step} 步（${family}，N=${b.n}）`;
  const none = { color: null, ids: [] };
  const hash = H.boardHash(b.grid, (x) => (b.isStar(x) ? 1 : 0));

  // ① planGroup —— 搜索给出最少步数 d，参考搜到第 d 层：更浅的那几层一组都没有、第 d 层成的就是平手那几色。搜索说「没有」，
  // 参考确认 REF_NONE_DEPTH 步之内确实没有。
  const g = drain(H.planGroup(b, none));
  if (g.estimate) estimates++;
  const rg = g.estimate ? null : refSearch(b, 'group', { maxDepth: g.color !== null ? g.depth : REF_NONE_DEPTH, extraCap: g.depth === 1 ? 20_000 : 0 });
  if (rg?.capped) skipped.group++;
  else if (rg) {
    const tied = [...rg.depth.keys()].filter((k) => rg.depth.get(k) === rg.best).sort((x, y) => x - y);
    if (g.color === null) {
      if (Number.isFinite(rg.best)) bad.one.push(`${where}：搜索说八步之内没有一组，参考 ${rg.best} 步就有（[${tied}]）`);
    } else if (rg.best !== g.depth) {
      bad.one.push(`${where}：最少步数 参考 ${Number.isFinite(rg.best) ? rg.best : `${g.depth} 步之内没有`}、搜索 ${g.depth}（色 ${g.color}）`);
    } else {
      // 挑色：含星星 → 盘面哈希（这一次没有「正在亮的」）。
      const starry = tied.filter((k) => (rg.leaves.get(k) ?? []).some((x) => x.star));
      const want = pickByHash(starry.length ? starry : tied, hash, String);
      const over64 = tied.some((k) => new Set((rg.leaves.get(k) ?? []).map((x) => x.ids.join(','))).size > 64);
      if (g.color !== want) {
        if (over64) skipped.starCap++;
        else bad.one.push(`${where}：平手 [${tied}] 该挑 ${want}，搜索挑了 ${g.color}`);
      }
      // 亮的那 N 枚：参考那一层碰到的某一组里连着的 N 枚，至少一枚色块。
      const ids = [...g.ids].sort((x, y) => x - y);
      const ok = (rg.leaves.get(g.color) ?? []).some((leaf) => {
        if (ids.length !== b.n || !ids.some((id) => leaf.blocks.has(id))) return false;
        for (let i = 0; i + b.n <= leaf.all.length; i++) {
          if ([...leaf.all.slice(i, i + b.n)].sort((x, y) => x - y).join(',') === ids.join(',')) return true;
        }
        return false;
      });
      if (!ok) bad.lit.push(`${where}：亮的 [${ids}] 不是最少那一层 ${g.color} 色某一组里连着的 ${b.n} 枚`);
      if (tied.length > 1) {
        ties.group++;
        // 保留正在亮的色：上一次亮的是另一个平手的色，这一次要留住它。
        const other = tied.find((k) => k !== g.color);
        const again = drain(H.planGroup(b, { color: other, ids: [] }));
        if (again.color !== other) bad.one.push(`${where}：上一次亮的是 ${other}（平手），这一次跳成了 ${again.color}`);
        if (MUT.平手不留上一色) {
          const m = drain(MUT.平手不留上一色.planGroup(b, { color: other, ids: [] }));
          if (m.color !== other) mutantHits.平手不留上一色++;
        }
      }
    }
    // ③ 估值不高估（group）：参考知道最少步数的那几色
    for (const [k, d] of rg.depth) {
      if (H.groupH(b, k) > d) bad.three.push(`${where}：groupH(${k}) = ${H.groupH(b, k)} > 参考最少步数 ${d}`);
      if (MUT.估值加一 && MUT.估值加一.groupH(b, k) > d) mutantHits.估值加一++;
    }
  }

  // ② planEdge：估值版 = h≡0 版；参考也独立算一遍；亮的是那一色全部星星
  const e = drain(H.planEdge(b, none));
  if (e.estimate) estimates++;
  const eReal = !e.estimate && e.color !== null && e.depth > 0;
  const eFull = eReal && e.depth <= EDGE_REF_DEPTH;
  if (eReal) edgeCover[eFull ? 'full' : 'shallowOnly']++;
  if (eFull) {
    const e0 = drain(H0.planEdge(b, none));
    if (e0.estimate) skipped.edge++;
    else if (e.color !== e0.color || e.depth !== e0.depth || e.ids.join(',') !== e0.ids.join(',')) {
      bad.two.push(`${where}：planEdge 估值版 ${e.color}/${e.depth} 步，h≡0 版 ${e0.color}/${e0.depth} 步`);
    }
  }
  const re = e.estimate ? null : refSearch(b, 'edge', { maxDepth: eFull ? e.depth : Math.min(REF_NONE_DEPTH, EDGE_REF_DEPTH) });
  if (re?.capped) skipped.edge++;
  else if (re) {
    const tied = [...re.depth.keys()].filter((k) => re.depth.get(k) === re.best);
    if (eFull && (re.best !== e.depth || !tied.includes(e.color))) bad.two.push(`${where}：消外边 参考 ${Number.isFinite(re.best) ? re.best : `${e.depth} 步之内没有`} [${tied}]，搜索 ${e.depth} 步、${e.color} 色`);
    if (eReal && !eFull && Number.isFinite(re.best)) bad.two.push(`${where}：搜索说消外边要 ${e.depth} 步，参考 ${re.best} 步就能（[${tied}]）`);
    if (!eReal && Number.isFinite(re.best)) bad.two.push(`${where}：搜索说消不了外边，参考 ${re.best} 步就能（[${tied}]）`);
    for (const [k, d] of re.depth) {
      const stars = b.grid.flat().filter((x) => x && b.isStar(x) && b.colorOf(x) === k).length;
      if (H.edgeH(b, k, stars) > d) bad.three.push(`${where}：edgeH(${k}) = ${H.edgeH(b, k, stars)} > 参考最少步数 ${d}`);
    }
  }
  const litOk = (r) => {
    if (r.color === null) return true;
    const want = b.grid.flat().filter((x) => x && b.isStar(x) && b.colorOf(x) === r.color).map((x) => x.id).sort((x, y) => x - y);
    return [...r.ids].sort((x, y) => x - y).join(',') === want.join(',');
  };
  if (!litOk(e)) bad.two.push(`${where}：D 亮的不是 ${e.color} 色在场的全部星星（或者亮了色块）`);
  // 变异那一份把色块也当星星，「能消外边的色」一下子多出好几色、一路搜到上限——它亮了什么一眼就看得出，给一个小上限。
  if (MUT.D亮色块 && !litOk(drain(MUT.D亮色块.planEdge(b, none, { nodes: 0 }, 3000)))) mutantHits.D亮色块++;

  // ④ planBest：步数 = 两个参考值的较小者；相等时挑外边。两样都有参考值（或者确认过没有）才判。
  if (rg && !rg.capped && re && !re.capped && (g.color !== null || eReal) && (!eReal || eFull)) {
    const best = drain(H.planBest(b, none));
    const gd = g.color !== null ? rg.best : Infinity; // 搜索说没有、参考确认过：当没有
    const ed = eReal ? re.best : Infinity;
    const low = Math.min(gd, ed);
    const tookEdge = eReal && best.color === e.color && best.ids.join(',') === e.ids.join(',') && best.depth === ed;
    if (best.depth !== low) bad.four.push(`${where}：E 亮了 ${best.depth} 步那一样，参考图案 ${gd}、外边 ${ed}`);
    if (gd === ed) {
      ties.best++;
      if (!tookEdge) bad.four.push(`${where}：平手（都是 ${gd} 步），E 该亮外边`);
      if (MUT.平手取图案) {
        const m = drain(MUT.平手取图案.planBest(b, none));
        if (!(m.color === e.color && m.ids.join(',') === e.ids.join(','))) mutantHits.平手取图案++;
      }
    }
  }
}

let tieCandidates = 0;
/** 这一刻是不是 E 的平手局面（拼图案、消外边都是一步）：两样都给一个小上限，便宜。是就加进来判一遍。 */
function maybeTie(code, step, v, family) {
  if (tieCandidates >= 40) return;
  const e1 = drain(H.planEdge(v, { color: null, ids: [] }, { nodes: 0 }, 20_000));
  if (e1.estimate || e1.color === null || e1.depth !== 1) return;
  const g1 = drain(H.planGroup(v, { color: null, ids: [] }, { nodes: 0 }, 20_000));
  if (g1.estimate || g1.color === null || g1.depth !== 1) return;
  tieCandidates++;
  judge(code, `${step}（E 平手）`, v, family);
}
/** 让某一色星星离填满一条外边更近的那几步（照教学灯 D / E 的意思走；只给走法挑步子，不当答案用）。 */
function edgeward(v, moves) {
  const trial = { ...v, grid: v.grid.map((r) => r.slice()) };
  const stars = new Map();
  for (const row of trial.grid) for (const t of row) if (t && v.isStar(t)) stars.set(v.colorOf(t), (stars.get(v.colorOf(t)) ?? 0) + 1);
  const hOf = () => Math.min(Infinity, ...[...stars].map(([k, n]) => H.edgeH(trial, k, n)));
  const now = hOf();
  const better = [];
  for (const m of moves) {
    const undo = applyMove(trial.grid, v.step, m);
    if (hOf() < now) better.push(m);
    undo();
  }
  return better;
}

for (const code of codes) {
  const sg = SD.seedGameOf(code, 'entered');
  if (!sg) throw new Error(`门要跟着改：码 ${code} 解不出一局`);
  const g = sim.open(sg.board, { ...sg.opts });
  sim.settle(3000);
  for (let step = 0; step <= 30; step++) {
    if (g.ctl.gameOver) break;
    const v = globalThis.__PLANVIEW();
    if (step % 2 === 0) judge(code, step, v, sg.board);
    else maybeTie(code, step, v, sg.board);
    if (step === 30) break;
    const moves = v.step.moves;
    if (!moves.length) break;
    let pick = moves[Math.floor(rnd() * moves.length)];
    if (rnd() < 0.5) {
      const trial = v.grid.map((r) => r.slice());
      const scoring = moves.filter((m) => {
        const undo = applyMove(trial, v.step, m);
        const s = v.scoring(trial, movedOf(v, m)).length;
        undo();
        return s;
      });
      if (scoring.length) pick = scoring[Math.floor(rnd() * scoring.length)];
    }
    applyMove(v.grid, v.step, pick);
    g.ctl.resolveMove(movedOf(v, pick), 0);
    sim.settle(20000);
  }
  g.close();
}
// 盘上没有色块的局面：随机走 30 步碰不到（阶梯要先翻掉三十来枚），另从几副基础局一路挑得分的走下去，走到色块翻光为止，
// 那一刻取一个（参考和搜索都该说「没有一组」）。一路上星星越攒越多，E 的平手（拼图案、消外边都是一步）就出在这一段：
// 逐步找，碰到就加进来（随机走那 30 步里外边一步就能消的局面太少，④ 的平手那一条量不到）。
for (const code of codes.filter((c) => SD.seedGameOf(c, 'entered').variant.mode === 'base')) {
  const sg = SD.seedGameOf(code, 'entered');
  const g = sim.open(sg.board, { ...sg.opts });
  sim.settle(3000);
  for (let step = 0; step < 400 && !g.ctl.gameOver; step++) {
    const v = globalThis.__PLANVIEW();
    maybeTie(code, `${step}（一路走下去）`, v, sg.board);
    if (!v.grid.flat().some((x) => x && v.isBlock(x))) {
      judge(code, `${step}（一路走下去）`, v, sg.board);
      break;
    }
    const moves = v.step.moves;
    const trial = v.grid.map((r) => r.slice());
    const scoring = moves.filter((m) => {
      const undo = applyMove(trial, v.step, m);
      const s = v.scoring(trial, movedOf(v, m)).length;
      undo();
      return s;
    });
    const toward = rnd() < 0.5 ? edgeward(v, moves) : [];
    const pool = toward.length ? toward : scoring.length ? scoring : moves;
    const pick = pool[Math.floor(rnd() * pool.length)];
    applyMove(v.grid, v.step, pick);
    g.ctl.resolveMove(movedOf(v, pick), 0);
    sim.settle(20000);
  }
  g.close();
}
sim.restoreConsole();

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${positions} 个局面，${secs} 秒；参考超上限跳过：图案 ${skipped.group}、外边 ${skipped.edge}；平手：图案 ${ties.group}、E ${ties.best}`);
console.log(`      消外边有解的局面：≤ ${EDGE_REF_DEPTH} 步逐个全比 ${edgeCover.full} 个；更深的 ${edgeCover.shallowOnly} 个只确认 ${EDGE_REF_DEPTH} 步之内没有更短的`);
for (const f of ['square', 'circle']) {
  const t = tally[f];
  check(`（尺子）${f === 'square' ? '经典方块' : '经典小球'}：≥ 200 个真局面`, t.n >= 200, `${t.n} 个（降过级 ${t.eroded}、没有色块 ${t.noBlock}、有活炸弹 ${t.bomb}）`);
  check(`（尺子）${f === 'square' ? '经典方块' : '经典小球'}：降过级的、盘上没有色块的、有活炸弹的局面各至少一个`, t.eroded > 0 && t.noBlock > 0 && t.bomb > 0);
}
const show = (list) => list.slice(0, 3).join(' / ') + (list.length > 3 ? ` …共 ${list.length} 处` : '');
check('① planGroup：最少步数、挑的色（含「保留正在亮的那一色」）和参考一致', bad.one.length === 0, show(bad.one));
check('① planGroup：亮的那 N 枚是最少那一层某一组里连着的 N 枚、至少一枚色块', bad.lit.length === 0, show(bad.lit));
check('② planEdge：估值版和 h≡0 版逐个一致、和参考一致；亮的是那一色在场的全部星星', bad.two.length === 0, show(bad.two));
check('③ 估值从不高估（groupH、edgeH ≤ 参考最少步数）', bad.three.length === 0, show(bad.three));
check('④ planBest：步数 = 两个参考值的较小者，平手亮外边', bad.four.length === 0, show(bad.four));
check('④（尺子）真局面里碰到过 E 的平手', ties.best > 0, `${ties.best} 个`);
const rate = estimates / (positions * 2);
check('⑤ 退回估值的局面 ≤ 1%（HINT_NODE_CAP 够用）', rate <= 0.01, `${estimates} / ${positions * 2} 次搜索（${(rate * 100).toFixed(2)}%）`);
if (skipped.starCap) console.log(`      注：${skipped.starCap} 个局面一色的组超过 64 个（搜索只收前 64 个），「含星星」那一条没判`);

if (MUTANTS) {
  console.log('\n—— 尺子（变异）——');
  check('变异「估值 +1」：③ 红了', mutantHits.估值加一 > 0, `${mutantHits.估值加一} 处`);
  check('变异「平手不保留上一色」：① 红了', mutantHits.平手不留上一色 > 0, `${mutantHits.平手不留上一色} 处`);
  check('变异「D 改成亮色块」：② 红了', mutantHits.D亮色块 > 0, `${mutantHits.D亮色块} 处`);
  check('变异「planBest 平手回到取图案（<= 改成 <）」：④ 红了', mutantHits.平手取图案 > 0, `${mutantHits.平手取图案} 处`);
}
console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);
