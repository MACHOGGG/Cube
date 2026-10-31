/**
 * 拍序：先图案、后星星；一拍只交一组整线（10-31 方案推14 Z-B09 R1 / R2′，站长 10-21：「方块优先结算后翻面，随后是星星结算后消除」）。
 *
 *   node scripts/check-cascade-order.mjs     # CI check 那一条跑的就是这一句（纯 node，虚拟时钟）
 *
 * 打包＋假 DOM＋虚拟时钟用 scripts/lib/endDetectBundle.mjs（和 check-end-detect、check-endgame-oneby 共用）；控制器里插一处只记账的桩：
 * 每一拍 stepper.next() 交出来的那一拍（几组整线、几组图案、几分、哪几格）。
 *
 *   ① E7（小球：底边 7 颗红星；左边 (3,0)(4,0)(5,0) 三枚红色块 + (6,0) 那颗红星成 1×4）：第 0 拍图案（翻 3 枚、+6）、第 1 拍底边
 *      （+49）、第 2 拍左边（+9）、清盘、拼出分 64。尺子：同一包把 R1 撤掉（先问整线），+49 之后判死——这道门分得出两种拍序。
 *   ② 每一拍的整线组数全部 ≤ 1；E4 方块一行 [红 红 蓝]：先蓝（1 分）、再红红（4 分），共 5 分（原先一拍 3 分）；E5 方块一行全红：
 *      一拍 16 分（原先 20，同一格算了两次）。
 *   ③ 只有整线、只有图案的局，和撤掉 R1 的同一包逐拍一样（拍序只在「同一拍里两样都有」时起作用，别的局不许被带歪）。
 *   ④ 10-18 M-4 ⑨ 第 8 条欠的那一节：色盲友好配色开着，方块消一行，淡出替身带 data-tex、星缩到 0.84、有 halo（square.ts 那一段）；
 *      关着时三样都没有（尺子）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSim, star, tile, BLANK_TILE } from './lib/endDetectBundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GC = 'src/engine/gameController.ts';
const SC = 'src/engine/scoring.ts';
const ALL = '全部方块已翻成点面';
const STUCK = '无法继续匹配';

const sub = (file, from, to) => (rel, src) => {
  if (rel !== file) return src;
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`门要跟着改：${file} 里「${from.slice(0, 60).replace(/\n/g, '⏎')}」出现 ${n} 次`);
  return src.replace(from, to);
};
const chain = (...fs) => (rel, src) => fs.filter(Boolean).reduce((s, f) => f(rel, s), src);
const INSTR = sub(GC, '      const s = stepper.next();\n      if (!s) {\n', '      const s = stepper.next();\n      (globalThis as any).__ORDER?.(s);\n      if (!s) {\n');
/** 撤掉 R1：把「这一拍一组图案都没有，才问整线」那一段挪回 findMatches 之前（原先的拍序：先问整线）。 */
const R1_START = '    // 这一拍一组图案都没有，才问整线（10-31 方案推14 Z-B09 R1，见上面那段说明）。';
const LINE_FIRST = (rel, src) => {
  if (rel !== SC) return src;
  const a = src.indexOf(R1_START);
  const endMark = '        commit: () => 0,\n      };\n    }\n';
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error('门要跟着改：scoring.ts 里认不出 R1 那一段');
  const block = src.slice(a, b + endMark.length);
  const rest = src.slice(0, a) + src.slice(b + endMark.length);
  const at = rest.indexOf('    const matches = dedupe(');
  if (at < 0) throw new Error('门要跟着改：scoring.ts 里认不出 const matches = dedupe(');
  return rest.slice(0, at) + block + rest.slice(at);
};

const tri7 = () => { const gr = []; for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE())); return gr; };
const FIX = {
  E7: ['circle', (g) => { const gr = tri7(); for (let c = 0; c < 7; c++) gr[6][c] = star(0); gr[3][0] = tile(0, 2); gr[4][0] = tile(0, 2); gr[5][0] = tile(0, 2); g.tap.setGrid(gr); return ['3,0', '4,0', '5,0', '6,0']; }],
  E4: ['square', (g) => { g.tap.setGrid([[star(0), star(0), star(1)]]); return ['0,0', '0,1', '0,2']; }],
  E5: ['square', (g) => { g.tap.setGrid([[star(1), star(1), star(1), star(1)]]); return ['0,0', '0,1', '0,2', '0,3']; }],
  // 只有图案：方块一行四枚同色色块（反面四种颜色，翻过去凑不成一条同色），图案一拍；之后剩下的星星散边收尾——每一拍都只有一样。
  P4: ['square', (g) => { g.tap.setGrid([[tile(0, 1), tile(0, 2), tile(0, 3), tile(0, 4)]]); return ['0,0', '0,1', '0,2', '0,3']; }],
  // 只有整线：小球底边三颗同色星星。
  L3: ['circle', (g) => { const gr = tri7(); gr[6][0] = star(1); gr[6][1] = star(1); gr[6][2] = star(1); g.tap.setGrid(gr); return ['6,0', '6,1', '6,2']; }],
};

function play(sim, key) {
  const [board, lay] = FIX[key];
  const beats = [];
  let ghostsAtLine = null;
  const g = sim.open(board, {});
  globalThis.__ORDER = (s) => {
    if (!s) return;
    beats.push({ at: sim.now, lines: s.lineBonusGroups.map((gp) => gp.length), match: s.matchGroups.length, points: s.points, flips: s.flips });
  };
  localStorage.removeItem(g.bestKey + '::runs');
  const cells = lay(g);
  g.hooks.render();
  const t0 = sim.now;
  g.ctl.resolveMove(new Set(cells), 0);
  for (let w = 0; w < 2000 && !g.ends.length; w++) {
    sim.tick(10);
    if (ghostsAtLine === null && beats.some((b) => b.lines.length) && sim.now >= beats.find((b) => b.lines.length).at + 30) {
      ghostsAtLine = [...g.refs.boardEl.children].filter((el) => el.style.pointerEvents === 'none' && /<svg/.test(el.innerHTML))
        .map((el) => ({ tex: el.dataset.tex ?? null, halo: /data-halo="1"/.test(el.innerHTML), size: parseFloat(el.style.width), svg: parseFloat((/<svg[^>]*\swidth="([\d.]+)"/.exec(el.innerHTML) || [])[1]) }));
    }
  }
  sim.settle(3000);
  let run = null;
  try { run = JSON.parse(localStorage.getItem(g.bestKey + '::runs'))?.[0]?.data ?? null; } catch { run = null; }
  const out = { beats, ends: g.ends.map((e) => ({ reason: e.reason, at: e.at - t0 })), run, ghostsAtLine, uncaught: sim.uncaught.map(String) };
  globalThis.__ORDER = null;
  g.close();
  return out;
}
const sig = (r) => JSON.stringify({ b: r.beats.map((x) => [x.at - (r.beats[0]?.at ?? 0), x.lines, x.match, x.points]), e: r.ends, s: r.run?.score });

const bad = [];
const lines = [];
const t0 = Date.now();
const cur = await makeSim(ROOT, { motion: true, mutate: INSTR });
cur.B.setFlipStep(4);

// ① E7
{
  const r = play(cur, 'E7');
  const desc = r.beats.map((b) => (b.match ? `图案（翻 ${b.flips}、+${b.points}）` : `整线 ${b.lines.join('+')} 格（+${b.points}）`)).join(' → ');
  lines.push(`① E7：${desc} →「${r.ends[0]?.reason}」，拼出分 ${r.run?.score}`);
  const ok = r.beats.length === 3 && r.beats[0].match === 1 && r.beats[0].flips === 3 && r.beats[0].points === 6 &&
    r.beats[1].lines.join() === '7' && r.beats[1].points === 49 && r.beats[2].lines.join() === '3' && r.beats[2].points === 9;
  if (!ok) bad.push(`① E7 拍序不对：${desc}（要 图案 翻 3 +6 → 底边 7 格 +49 → 左边 3 格 +9）`);
  if (r.ends[0]?.reason !== ALL || r.run?.score !== 64) bad.push(`① E7 要清盘、拼出分 64：「${r.ends[0]?.reason}」${r.run?.score}`);
}
// ② 一拍一组；E4、E5
{
  const multi = [];
  for (const k of ['E7', 'E4', 'E5', 'L3', 'P4']) {
    const r = play(cur, k);
    for (const b of r.beats) if (b.lines.length > 1) multi.push(`${k}: 一拍 ${b.lines.length} 组`);
    if (r.uncaught.length) bad.push(`② ${k} 有没接住的错：${r.uncaught[0]}`);
    if (k === 'E4') {
      const pts = r.beats.map((b) => `${b.lines.join('+')}格+${b.points}`).join(' → ');
      lines.push(`② E4 [红 红 蓝]：${pts}，拼出分 ${r.run?.score}`);
      if (!(r.beats.length === 2 && r.beats[0].lines.join() === '1' && r.beats[0].points === 1 && r.beats[1].lines.join() === '2' && r.beats[1].points === 4 && r.run?.score === 5)) {
        bad.push(`② E4 要先蓝（1 分）再红红（4 分）、共 5 分：${pts}（${r.run?.score}）`);
      }
    }
    if (k === 'E5') {
      lines.push(`② E5 一行全红：${r.beats.length} 拍、${r.beats.map((b) => b.points).join(' + ')} 分`);
      if (!(r.beats.length === 1 && r.beats[0].points === 16 && r.run?.score === 16)) bad.push(`② E5 要一拍 16 分：${r.beats.map((b) => b.points).join(' + ')}`);
    }
  }
  if (multi.length) bad.push(`② 有一拍交了不止一组整线：${multi.join(' · ')}`);
}
// ①′ 尺子、③ 只有一样的局和撤掉 R1 的同一包一样
{
  const old = await makeSim(ROOT, { motion: true, mutate: chain(LINE_FIRST, INSTR) });
  old.B.setFlipStep(4);
  const r = play(old, 'E7');
  lines.push(`①（尺子）撤掉 R1：E7 → ${r.beats.map((b) => (b.match ? '图案' : `整线 +${b.points}`)).join(' → ')} →「${r.ends[0]?.reason}」`);
  if (!(r.beats[0]?.lines.join() === '7' && r.beats[0]?.points === 49 && r.ends[0]?.reason === STUCK)) bad.push(`①（尺子）撤掉 R1 之后 E7 该是「+49 之后判死」：${JSON.stringify(r.beats)} ${JSON.stringify(r.ends)}`);
  for (const k of ['L3', 'E5', 'P4']) {
    const a = play(cur, k);
    const b = play(old, k);
    if (sig(a) !== sig(b)) bad.push(`③ ${k}（只有一样）和撤掉 R1 的同一包不一样：${sig(a)} ≠ ${sig(b)}`);
  }
  lines.push('③ 只有整线（L3、E5）、只有图案（P4）的局：和撤掉 R1 的同一包逐拍一样');
}
// ④ 色盲纹理的淡出替身（方块消一行）
{
  cur.B.setColorblind(true);
  const on = play(cur, 'E5');
  cur.B.setColorblind(false);
  const off = play(cur, 'E5');
  const g1 = on.ghostsAtLine ?? [];
  const g0 = off.ghostsAtLine ?? [];
  lines.push(`④ 色盲开：${g1.length} 个替身，${g1.map((x) => `tex=${x.tex} halo=${x.halo} 星 ${(x.svg / x.size).toFixed(2)}`).slice(0, 1).join('')}；关：${g0.length} 个，${g0.map((x) => `tex=${x.tex} halo=${x.halo} 星 ${(x.svg / x.size).toFixed(2)}`).slice(0, 1).join('')}`);
  if (g1.length !== 4 || !g1.every((x) => x.tex && x.halo && Math.abs(x.svg / x.size - 0.84) < 0.01)) bad.push(`④ 色盲开着：方块消一行的 4 个淡出替身都要带 data-tex、halo、星 0.84：${JSON.stringify(g1)}`);
  if (g0.length !== 4 || !g0.every((x) => !x.tex && !x.halo && Math.abs(x.svg / x.size - 0.95) < 0.01)) bad.push(`④（尺子）色盲关着：替身不带纹理、不带 halo、星 0.95：${JSON.stringify(g0)}`);
}

for (const l of lines) console.log(l);
if (bad.length) {
  console.log(`\n✗ 拍序：${bad.length} 处不对（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  for (const b of bad) console.log('  ' + b);
  process.exit(1);
}
console.log(`\n✓ 拍序：先图案后星星、一拍一组、只有一样的局不受影响、色盲替身带纹理（${Math.round((Date.now() - t0) / 1000)} 秒）`);
process.exit(0);
