/**
 * 死后散边（10-31 方案推14 Z-B04）：判死时最外边上还剩几颗星星、凑不成同色一条，就一颗一颗削掉（looseEnd），不再 1.4 秒判死。
 *
 *   node scripts/check-tri-endgame.mjs             # CI check 那一条跑的就是这一句（纯 node，虚拟时钟）
 *   node scripts/check-tri-endgame.mjs --mutants   # 门自己的验证：撤掉 loose.pick() 的接线，第 1、2 条要红
 *
 * 打包＋假 DOM＋虚拟时钟用 scripts/lib/endDetectBundle.mjs（和 check-end-detect、check-endgame-oneby 共用）。插两处只记账的桩：
 * 控制器每一拍交出来的整线组（哪几格）；looseEnd 每一次 pick() 回了什么。
 *
 *   1. 六边三角小六边形（(3,7) 星3、(3,8) 星1、(3,9) 星0、(4,6) 星2、(4,7) 星1、(4,8) 星4，其余离场）：走一步、结算完——盘上 0 枚、
 *      拼出分 +6、6 拍每拍 1 颗、理由「全部消完了」、推荐档 5570 ms（±10；rerun-f5 D.3 E6）。
 *   2. 六边圆球中心一圈：6 色各一颗、都是星星 → 逐颗削完，「全部消完了」。
 *   3. 活着的盘不动：pick() 第一句就是「没判死回空」（读源码）；小球 50 局随机走子（固定种子、整盘随机发），和「pick() 永远回空」
 *      的同一包逐步对账（分数、步数、盘上色块数、结算），对到这一局第一次真散边为止，一字不差。
 *   4. 和推02 的修法 C 一起：小球零手残局还有色块（10-19 复现 7）→ 不散边，1.4 秒后「无法继续匹配」；同样的几何全换成星星 → 散边削完。
 *   5. 炸弹：菱形方块进阶炸弹局，最外边上有一枚活炸弹、其余星星 → 削掉的每一组都不含那枚炸弹；盘上只剩活炸弹 →「全部消完了」。
 *   6. 一份：五副外边族棋盘都 import { createLooseEnd } from '../engine/looseEnd'，都没有自己的 function looseEnd、也没有自己的
 *      outerEdges(edgeBoard, EDGE_MIN_ENDGAME) 挑边循环。
 *   方案第 7 条（进 CI 之前对 b43f86a 跑一遍、第 1、2 条要红）：那一版没有这道门用的打包件，改用 --mutants 里「撤掉 loose.pick()
 *   的接线」代替——同样是「没有散边」，第 1、2 条照样要红。
 */
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSim, star, tile, BLANK_TILE } from './lib/endDetectBundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = process.argv.includes('--mutants');
const GC = 'src/engine/gameController.ts';
const LE = 'src/engine/looseEnd.ts';
const ALL = '全部方块已翻成点面';
const STUCK = '无法继续匹配';

const sub = (file, from, to) => (rel, src) => {
  if (rel !== file) return src;
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`门要跟着改：${file} 里「${from.slice(0, 60).replace(/\n/g, '⏎')}」出现 ${n} 次`);
  return src.replace(from, to);
};
const chain = (...fs) => (rel, src) => fs.filter(Boolean).reduce((s, f) => f(rel, s), src);

const INSTR = chain(
  sub(GC, '      const s = stepper.next();\n      if (!s) {\n', '      const s = stepper.next();\n      (globalThis as any).__TRI?.beat?.(s);\n      if (!s) {\n'),
  sub(LE, '  function pick(): Cell[][] {\n    if (!b.stuck()) return [];\n',
    '  function pick(): Cell[][] {\n    const out = pick0();\n    (globalThis as any).__TRI?.pick?.(out);\n    return out;\n  }\n  function pick0(): Cell[][] {\n    if (!b.stuck()) return [];\n'),
);
/** 「pick() 永远回空」：第 3 条的对照包。 */
const NO_LOOSE = sub(LE, '  function pick(): Cell[][] {\n    if (!b.stuck()) return [];\n', '  function pick(): Cell[][] {\n    if (b) return [];\n');

const tri7 = () => { const gr = []; for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE())); return gr; };
const blankOf = (g) => g.tap.grid().map((row) => row.map((t) => (t == null ? t : BLANK_TILE())));
const liveCount = (g) => g.tap.grid().flat().filter((t) => t != null && !g.tap.isBlank(t)).length;
const frontCount = (g) => g.tap.grid().flat().filter((t) => t != null && !g.tap.isBlank(t) && t.face === 'flavor').length;

/** 开一局、摆盘、走这一手、走到结算。回这一局的账。 */
function play(sim, board, opts, lay) {
  const rec = { beats: [], picks: [] };
  globalThis.__TRI = {
    beat: (s) => { if (s) rec.beats.push({ at: sim.now, lines: s.lineBonusGroups.map((gp) => gp.map(([r, c]) => `${r},${c}`)), match: s.matchGroups.length }); },
    pick: (out) => rec.picks.push(out.map((gp) => gp.map(([r, c]) => `${r},${c}`))),
  };
  const g = sim.open(board, opts);
  localStorage.removeItem(g.bestKey + '::runs');
  const cells = lay(g);
  g.hooks.render();
  const t0 = sim.now;
  g.ctl.resolveMove(new Set(cells), 0);
  let settled = t0;
  for (let w = 0; w < 2500 && !g.ends.length; w++) { if (g.ctl.resolving) settled = sim.now; sim.tick(10); }
  sim.settle(3000);
  rec.ends = g.ends.map((e) => ({ reason: e.reason, at: e.at - t0, after: e.at - settled }));
  rec.left = liveCount(g);
  rec.grid = g.tap.grid();
  try { rec.run = JSON.parse(localStorage.getItem(g.bestKey + '::runs'))?.[0]?.data ?? null; } catch { rec.run = null; }
  rec.uncaught = sim.uncaught.map(String);
  globalThis.__TRI = null;
  g.close();
  return rec;
}

const E6 = [[3, 7, 3], [3, 8, 1], [3, 9, 0], [4, 6, 2], [4, 7, 1], [4, 8, 4]];
const layE6 = (g) => { const ng = blankOf(g); for (const [r, c, d] of E6) ng[r][c] = star(d); g.tap.setGrid(ng); return ['3,7']; };
// 六边圆球：7 行 4/5/6/7/6/5/4，正中 (3,3) 本来就是空格。中心一圈 = 它的 6 个邻格（上一行 c−1、c，同一行左右，下一行 c−1、c）。
const RING = [[2, 2], [2, 3], [3, 2], [3, 4], [4, 2], [4, 3]];
const layRing = (g) => { const ng = blankOf(g); RING.forEach(([r, c], i) => { ng[r][c] = star(i); }); g.tap.setGrid(ng); return ['3,2']; };

async function sections(extra = null, only = null) {
  const bad = [];
  const lines = [];
  const sim = await makeSim(ROOT, { motion: true, mutate: chain(extra, INSTR) });
  sim.B.setFlipStep(4);
  const want = (n) => !only || only.includes(n);

  if (want(1)) {
    const r = play(sim, 'triangleBig', {}, layE6);
    const per = r.beats.map((b) => b.lines.length === 1 ? b.lines[0].length : `线${b.lines.length}·图案${b.match}`);
    lines.push(`1. 六边三角小六边形：${r.beats.length} 拍（每拍 ${per.join(' ')} 颗）、盘上剩 ${r.left} 枚、拼出分 ${r.run?.score}、「${r.ends[0]?.reason}」于 ${r.ends[0]?.at} ms`);
    if (r.left !== 0) bad.push(`1. 盘上还剩 ${r.left} 枚（要 0）`);
    if (r.run?.score !== 6) bad.push(`1. 拼出分 ${r.run?.score}（要 +6）`);
    if (r.beats.length !== 6 || !per.every((x) => x === 1)) bad.push(`1. ${r.beats.length} 拍、每拍 ${per.join(' ')}（要 6 拍、每拍 1 颗）`);
    if (r.ends.length !== 1 || r.ends[0].reason !== ALL) bad.push(`1. 理由 ${JSON.stringify(r.ends.map((e) => e.reason))}（要「${ALL}」，不是「${STUCK}」）`);
    if (r.ends[0] && Math.abs(r.ends[0].at - 5570) > 10) bad.push(`1. 推荐档结算于 ${r.ends[0].at} ms（要 5570 ±10）`);
  }
  if (want(2)) {
    const r = play(sim, 'circleHex', {}, layRing);
    lines.push(`2. 六边圆球中心一圈：${r.beats.length} 拍、盘上剩 ${r.left} 枚、「${r.ends[0]?.reason}」`);
    if (r.left !== 0 || r.ends.length !== 1 || r.ends[0].reason !== ALL) bad.push(`2. 中心一圈没削完：剩 ${r.left} 枚、理由 ${JSON.stringify(r.ends.map((e) => e.reason))}（要逐颗削完、「${ALL}」）`);
    if (!r.beats.every((b) => b.lines.length === 1 && b.lines[0].length === 1)) bad.push(`2. 不是逐颗削：${JSON.stringify(r.beats.map((b) => b.lines))}`);
  }
  if (want(4)) {
    // 10-19 复现 7：小球封底 1×2，两枚互不同色的孤儿色块 + 两颗互不同线的星星，滑一下两颗星星对调。
    const rep7 = (allStar) => (g) => {
      g.ero.spend(999);
      const gr = tri7();
      gr[1][0] = allStar ? star(0) : tile(0, 1); gr[6][3] = allStar ? star(2) : tile(2, 1); gr[4][0] = star(1); gr[4][2] = star(3);
      g.tap.setGrid(gr);
      const t = gr[4][0]; gr[4][0] = gr[4][2]; gr[4][2] = t;
      return ['4,0', '4,2'];
    };
    const a = play(sim, 'circle', {}, rep7(false));
    lines.push(`4. 复现 7（还有色块）：「${a.ends[0]?.reason}」盘面停下后 ${a.ends[0]?.after} ms、剩余色块系数 ${a.run?.unflippedScale}`);
    if (a.ends[0]?.reason !== STUCK || Math.abs(a.ends[0].after - 1410) > 20) bad.push(`4. 复现 7 要盘面停下后 1.4 秒「${STUCK}」：${JSON.stringify(a.ends)}`);
    if (frontCount({ tap: { grid: () => a.grid, isBlank: (t) => t.color === -1 } }) !== 2) bad.push('4. 复现 7：两枚孤儿色块要还在（判死之前没被散边掉）');
    const b = play(sim, 'circle', {}, rep7(true));
    lines.push(`4. 同样的几何全换成星星：「${b.ends[0]?.reason}」、盘上剩 ${b.left} 枚、散边 ${b.picks.filter((p) => p.length).length} 次`);
    if (b.ends[0]?.reason !== ALL || b.left !== 0) bad.push(`4. 全换成星星要散边削完、「${ALL}」：${JSON.stringify(b.ends)} 剩 ${b.left}`);
  }
  if (want(5)) {
    // 菱形方块进阶炸弹局：顶角 (0,0) 一枚活炸弹（红色块），旁边三颗星星；最外边（行 0、列 0、ROW 那一族 d=0）都碰着炸弹。
    const layBomb = (g) => {
      const ng = blankOf(g);
      ng[0][0] = tile(0, 1); ng[0][1] = star(1); ng[1][0] = star(2); ng[1][1] = star(3);
      g.tap.setGrid(ng);
      return ['0,1', '1,1'];
    };
    const r = play(sim, 'squareDiamond', { bomb: true }, layBomb);
    const shaved = r.beats.flatMap((b) => b.lines.flat());
    lines.push(`5. 菱形方块 · 进阶炸弹：削掉 ${shaved.join(' ')}、盘上剩 ${r.left} 枚、「${r.ends[0]?.reason}」`);
    if (shaved.includes('0,0')) bad.push('5. 削掉的组里有那枚活炸弹（带活炸弹的边不该被选）');
    if (r.ends[0]?.reason !== ALL || r.left !== 1) bad.push(`5. 盘上只剩活炸弹要「${ALL}」：${JSON.stringify(r.ends.map((e) => e.reason))}、剩 ${r.left} 枚`);
    if (!shaved.length) bad.push('5.（尺子）一组都没削（星星没被收掉，量不出「不选带炸弹的边」）');
  }
  return { bad, lines, sim };
}

/** 3. 活着的盘不动：小球 50 局随机走子，和「pick() 永远回空」的同一包对账，对到第一次真散边为止。 */
async function liveWalk() {
  const bad = [];
  const ROWS = 7;
  const CL = [];
  for (let d = 0; d < ROWS; d++) { const cells = []; for (let r = d; r < ROWS; r++) cells.push([r, r - d]); CL.push(cells); }
  for (let e = 0; e < ROWS; e++) { const cells = []; for (let r = e; r < ROWS; r++) cells.push([r, e]); CL.push(cells); }
  for (let r = 0; r < ROWS; r++) { const cells = []; for (let c = 0; c <= r; c++) cells.push([r, c]); CL.push(cells); }
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const walk = async (mutate) => {
    const sim = await makeSim(ROOT, { motion: false, mutate });
    const out = [];
    for (let i = 0; i < 50; i++) {
      const rand = mulberry(20261031 + i * 7919);
      const ledger = [];
      let firstLoose = -1;
      globalThis.__TRI = { pick: (o) => { if (o.length && firstLoose < 0) firstLoose = ledger.length; } };
      const g = sim.open('circle', {});
      const gr = tri7().map((row) => row.map(() => tile(Math.floor(rand() * 4), Math.floor(rand() * 4))));
      g.tap.setGrid(gr);
      g.hooks.render();
      for (let k = 0; k < 80 && !g.ctl.gameOver; k++) {
        const grid = g.tap.grid();
        const moves = [];
        for (const line of CL) {
          const cells = line.filter(([r, c]) => !g.tap.isBlank(grid[r][c]));
          for (let s = 1; s < cells.length; s++) if (sim.B.slideLine(cells.map(([r, c]) => grid[r][c]), s)) moves.push({ cells, s });
        }
        if (!moves.length) break;
        const m = moves[Math.floor(rand() * moves.length)];
        const shifted = sim.B.slideLine(m.cells.map(([r, c]) => grid[r][c]), m.s);
        m.cells.forEach(([r, c], j) => { grid[r][c] = shifted[j]; });
        g.ctl.resolveMove(new Set(m.cells.map(([r, c]) => `${r},${c}`)), 0);
        sim.settle(30000);
        ledger.push([g.ctl.score, g.ctl.moves, frontCount(g), g.ends.map((e) => e.reason).join('|')].join(' '));
      }
      out.push({ ledger, firstLoose });
      globalThis.__TRI = null;
      g.close();
    }
    return out;
  };
  const real = await walk(INSTR);
  const ref = await walk(chain(NO_LOOSE, sub(GC, '      const s = stepper.next();\n      if (!s) {\n', '      const s = stepper.next();\n      if (!s) {\n')));
  let compared = 0;
  let diff = 0;
  for (let i = 0; i < real.length; i++) {
    const upto = real[i].firstLoose < 0 ? real[i].ledger.length : real[i].firstLoose;
    for (let k = 0; k < upto; k++) {
      compared++;
      if (real[i].ledger[k] !== ref[i].ledger[k]) { diff++; if (diff <= 3) bad.push(`3. 第 ${i} 局第 ${k} 步和「不散边」的同一包不一样：${real[i].ledger[k]} ≠ ${ref[i].ledger[k]}`); }
    }
  }
  if (compared < 500) bad.push(`3.（尺子）只对了 ${compared} 步（随机走子太短，量不出东西）`);
  const src = readFileSync(resolve(ROOT, LE), 'utf8');
  if (!/function pick\(\): Cell\[\]\[\] \{\n {4}if \(!b\.stuck\(\)\) return \[\];/.test(src)) bad.push('3. looseEnd.pick() 第一句不是「没判死回空」');
  return { bad, line: `3. 小球 50 局随机走子：对了 ${compared} 步（到每局第一次散边为止），不一样 ${diff} 步；散边过的局 ${real.filter((x) => x.firstLoose >= 0).length} 局` };
}

/** 6. 一份。 */
function oneCopy() {
  const bad = [];
  for (const f of ['circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle']) {
    const src = readFileSync(resolve(ROOT, `src/shapes/${f}.ts`), 'utf8');
    if (!/import \{ createLooseEnd \} from '\.\.\/engine\/looseEnd';/.test(src)) bad.push(`6. shapes/${f}.ts 没有 import { createLooseEnd } from '../engine/looseEnd'`);
    if (/function looseEnd\b/.test(src)) bad.push(`6. shapes/${f}.ts 自己写了一个 function looseEnd`);
    const loops = (src.match(/outerEdges\(edgeBoard, EDGE_MIN_ENDGAME\)/g) || []).length;
    if (loops) bad.push(`6. shapes/${f}.ts 自己有 ${loops} 处 outerEdges(edgeBoard, EDGE_MIN_ENDGAME) 挑边循环`);
    if (!/loose\.reset\(\);/.test(src)) bad.push(`6. shapes/${f}.ts 的 resetBoard 没有 loose.reset()`);
  }
  return bad;
}

if (MUTANTS) {
  const unwire = (f) => chain(
    sub(`src/shapes/${f}.ts`, '        if (endgameOpen) return loose.pick();\n', '        if (endgameOpen) return [];\n'),
    sub(`src/shapes/${f}.ts`, '        return opened.length ? opened : loose.pick();\n', '        return opened;\n'),
  );
  const V = {
    '撤掉六边三角 loose.pick() 两处接线 → 第 1 条红': [unwire('triangle'), [1]],
    '撤掉六边圆球 loose.pick() 两处接线 → 第 2 条红': [unwire('circleHex'), [2]],
  };
  let ok = true;
  for (const [what, [m, only]] of Object.entries(V)) {
    const r = await sections(m, only);
    const red = r.bad.length > 0;
    console.log(`${red ? 'ok  ' : 'BAD '} ${what}：${red ? `红了 ${r.bad.length} 处，例 ${r.bad[0]}` : '居然全绿'}`);
    if (!red) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

const t0 = Date.now();
const s = await sections();
const w = await liveWalk();
const one = oneCopy();
for (const l of [...s.lines, w.line]) console.log(l);
const all = [...s.bad, ...w.bad, ...one];
if (all.length) {
  console.log(`\n✗ 死后散边：${all.length} 处不对（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  for (const b of all) console.log('  ' + b);
  process.exit(1);
}
console.log(`\n✓ 死后散边：小六边形 / 中心一圈逐颗削完、活着的盘不动、修法 C 照旧、炸弹边不选、五副只用一份（${Math.round((Date.now() - t0) / 1000)} 秒）`);
process.exit(0);
