/**
 * 收尾逐一消除（10-31 方案推14 Z-B09；站长 10-21：「在可结束的局中仍需要逐一消除直到最后……方块优先结算后翻面，随后是
 * 星星结算后消除」「星星消除时一对对按照顺序消除……剩下的放大，然后再消除……直到最后的也需要放大呈现之后再消除」）。
 *
 *   node scripts/check-endgame-oneby.mjs             # CI check 那一条跑的就是这一句（纯 node，虚拟时钟）
 *   node scripts/check-endgame-oneby.mjs --mutants   # 门自己的验证：撤掉定格 / 一拍一组 / R1 / D29 的 pace，各自要红
 *
 * 打包＋假 DOM＋虚拟毫秒时钟用 scripts/lib/endDetectBundle.mjs（推01 合成，和 check-end-detect、check-tri-endgame 共用）。
 * 控制器里插两处桩（只记账、不改行为）：每一拍 stepper.next() 交出来的那一拍有几组；freezeClock() 那一下的时刻。
 *
 * 量的是：
 *   ① 时间线：十六副夹具（方案 Z-B09 门那张表的 E1–E16，夹具的摆法就是表里第一栏那一句）× 推荐档 1× / 最快 2× / 最慢 0.5× /
 *      减弱动态，结算时刻 ±10 ms、理由、九折、拼出分。和表差 >10 ms 就是红——**不改表**（方案原话：停下回报）。
 *   ② 每一拍的组数全部是 1；定格只出现在清盘前一拍、时长 1400（下一拍 = 定格 + 1400）；非清盘局 0 次定格；玩家亲手一下清光
 *      （第 0 拍）不定格。
 *   ③ 三档间隔：自动消线拍 round(0.4 × 1250 / r) + 70；玩家那一拍是消线时 round(1250 / r) + 70；图案拍 550/r ＋ max(350/r,
 *      翻面那一截)（D29 新加，减弱动态时 0）。
 *   ④ 碰一下（hurry）：定格中碰 → 当场结算「全部消完了」；定格中暂停 3 秒 → 晚 3 秒、用时不含定格；计时局定格中钟不动。
 *   ⑤ 最后一拍的淡出替身和那一颗一样大、在 #board 里；方块行列为 0 那一拍框不塌；整线那一拍 render() 之后 boardWrap 下的粒子
 *      还在（≥3 颗，Z-B11）。
 *   ⑥ 源码：FINALE_HOLD_MS = STUCK_END_MS；bigMoment / playClear / playLineClear 的个数（Z-B26）。
 */
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSim, star, tile, BLANK_TILE } from './lib/endDetectBundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = process.argv.includes('--mutants');
const GC = 'src/engine/gameController.ts';

/** 一处源码替换：锚点必须恰好一次（认不出就是「门要跟着改」，当场抛）。 */
const sub = (file, from, to) => (rel, src) => {
  if (rel !== file) return src;
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`门要跟着改：${file} 里「${from.slice(0, 60).replace(/\n/g, '⏎')}」出现 ${n} 次`);
  return src.replace(from, to);
};
const chain = (...fs) => (rel, src) => fs.filter(Boolean).reduce((s, f) => f(rel, s), src);

// ── 插桩：只记账 ──
const INSTR = chain(
  sub(GC, '      const s = stepper.next();\n      if (!s) {\n', '      const s = stepper.next();\n      (globalThis as any).__ONEBY?.beat?.(s);\n      if (!s) {\n'),
  sub(GC, '  function freezeClock(): void {\n    finaleFrozen = true;\n', '  function freezeClock(): void {\n    (globalThis as any).__ONEBY?.freeze?.();\n    finaleFrozen = true;\n'),
);

// ── 十六副夹具（方案 Z-B09 门那张表）──
const ALL = '全部方块已翻成点面'; // engine/kinetics.ts 的 ALL_FLIPPED_REASON
const STUCK = '无法继续匹配';
const MANUAL = '手动结束';
const TIMEUP = '时间到';
const tri = () => { const gr = []; for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE())); return gr; };
const blankOf = (g) => g.tap.grid().map((row) => row.map((t) => (t == null ? t : BLANK_TILE())));
const ROW6 = Array.from({ length: 7 }, (_, c) => `6,${c}`);
const e1 = (g) => { const gr = tri(); gr[6][0] = star(0); gr[6][1] = star(1); gr[6][2] = star(2); g.tap.setGrid(gr); return ['6,0', '6,1', '6,2']; };
const live4 = (g) => { const gr = tri(); gr[6][0] = tile(0, 1); gr[6][1] = tile(1, 2); gr[6][2] = tile(2, 3); gr[6][3] = tile(3, 0); g.tap.setGrid(gr); return null; };
/**
 * [名字, 棋盘, 开局选项, 摆盘（回这一手动过的格子；null = 不走这一手）, 这一手之后做什么, 结算时刻 [1×, 2×, 0.5×, 减弱],
 *  理由（0.5× 那一格另写的放在 reason05）, 期望（拼出分 / 九折 / 用时）]
 */
const FIX = [
  ['E1 小球底边 [红 蓝 绿]', 'circle', {}, e1, null, [3860, 2740, 6110, 3650], ALL, {}],
  ['E2 (6,0)红 (6,1)红 (5,0)蓝', 'circle', {}, (g) => { const gr = tri(); gr[6][0] = star(0); gr[6][1] = star(0); gr[5][0] = star(1); g.tap.setGrid(gr); return ['6,0', '6,1']; }, null, [3290, 2420, 5040, 3150], ALL, { score: 5 }],
  ['E3 方块一行 [红 蓝 绿 黄]', 'square', {}, (g) => { g.tap.setGrid([[star(0), star(1), star(2), star(3)]]); return ['0,0', '0,1', '0,2', '0,3']; }, null, [4430, 3060, 7180, 4150], ALL, {}],
  ['E4 方块一行 [红 红 蓝]', 'square', {}, (g) => { g.tap.setGrid([[star(0), star(0), star(1)]]); return ['0,0', '0,1', '0,2']; }, null, [3290, 2420, 5040, 3150], ALL, { score: 5 }],
  ['E5 方块一行全红', 'square', {}, (g) => { g.tap.setGrid([[star(0), star(0), star(0), star(0)]]); return ['0,0', '0,1', '0,2', '0,3']; }, null, [890, 480, 1710, 820], ALL, { score: 16, ownClear: true }],
  ['E6 六边三角小六边形（散边逐枚 6 拍）', 'triangleBig', {}, (g) => { const ng = blankOf(g); for (const [r, c, d] of [[3, 7, 3], [3, 8, 1], [3, 9, 0], [4, 6, 2], [4, 7, 1], [4, 8, 4]]) ng[r][c] = star(d); g.tap.setGrid(ng); return ['3,7']; }, null, [5570, 3700, 9320, 5150], ALL, { score: 6, lines: 6 }],
  ['E7 先图案后星星', 'circle', {}, (g) => { const gr = tri(); for (let c = 0; c < 7; c++) gr[6][c] = star(0); gr[3][0] = tile(0, 2); gr[4][0] = tile(0, 2); gr[5][0] = tile(0, 2); g.tap.setGrid(gr); return ['3,0', '4,0', '5,0', '6,0']; }, null, [3790, 2705, 5960, 2400], ALL, { score: 64, patternFirst: 3 }],
  ['E8 计时 100 秒 + E1', 'circle', { timeLimitSec: 100 }, e1, null, [3860, 2740, 6110, 3650], ALL, { elapsed1x: 2 }],
  ['E9 计时 3 秒 + E1', 'circle', { timeLimitSec: 3 }, e1, null, [3860, 2740, 3000, 3650], ALL, {}],
  ['E10 小球两颗红星 + 1 枚孤儿', 'circle', {}, (g) => { const gr = tri(); gr[6][0] = star(0); gr[6][6] = star(0); gr[6][3] = tile(1, 2); g.tap.setGrid(gr); return ROW6; }, null, [3290, 2420, 5040, 3150], STUCK, { scale: 0.9 }],
  ['E11 方块一行 [红星 红星 孤儿]', 'square', {}, (g) => { g.tap.setGrid([[star(0), star(0), tile(1, 2)]]); return ['0,0', '0,1', '0,2']; }, null, [3290, 2420, 5040, 3150], STUCK, { scale: 0.9 }],
  ['E12 小球 1×2 封底剩两枚不同色色块', 'circle', {}, (g) => { g.ero.spend(999); const gr = tri(); gr[6][0] = tile(0, 1); gr[5][0] = tile(1, 2); g.tap.setGrid(gr); return ['6,0']; }, null, [1400, 1400, 1400, 1400], STUCK, { scale: 0.81 }],
  ['E13 活局手动结束剩 4 枚', 'circle', {}, live4, (g) => g.ctl.finish(), [0, 0, 0, 0], MANUAL, { scale: 0.6561 }],
  ['E14 计时 3 秒到点剩 4 枚', 'circle', { timeLimitSec: 3 }, live4, null, [3000, 3000, 3000, 3000], TIMEUP, { scale: 1 }],
  ['E15 1×2 封底最后一对同色', 'circle', {}, (g) => { g.ero.spend(999); const gr = tri(); gr[6][0] = tile(0, 1); gr[6][1] = tile(0, 2); g.tap.setGrid(gr); return ['6,0', '6,1']; }, null, [3610, 2615, 5600, 2400], ALL, {}],
  ['E16 零手残局（2 色块 + 2 星）', 'circle', {}, (g) => { g.ero.spend(999); const gr = tri(); gr[6][0] = star(2); gr[6][1] = star(2); gr[5][0] = tile(0, 1); gr[4][0] = tile(1, 2); g.tap.setGrid(gr); return ['6,0', '6,1']; }, null, [2720, 2100, 3970, 2650], STUCK, { scale: 0.81 }],
];
/** 四档：[名字, 动态效果开, 拉杆格（engine/flipSpeed.ts：0 → 0.5×，4 → 1×，9 → 2×）, 倍率 r]。 */
const SETTINGS = [['1×', true, 4, 1], ['2×', true, 9, 2], ['0.5×', true, 0, 0.5], ['减弱', false, 4, 1]];

/** 开一局、摆盘、走这一手、走到结算（最多 20 秒虚拟时间）。回这一局的账。 */
function playOne(sim, fx, { during = null } = {}) {
  const [, board, opts, lay, act] = fx;
  const rec = { beats: [], freezes: [], snapAtFreeze: null };
  const g = sim.open(board, opts);
  globalThis.__ONEBY = {
    // cells：这一拍图案那一组几格（翻面动画按格错开，星星那一格也占一拍位，所以间隔按格数算，不按真翻了几枚）。
    beat: (s) => { if (s) rec.beats.push({ at: sim.now, lines: s.lineBonusGroups.length, match: s.matchGroups.length, cells: s.matchGroups.reduce((a, g) => a + g.length, 0) }); },
    freeze: () => {
      rec.freezes.push(sim.now);
      // 定格那一刻盘上剩下的那几颗（最后一组）：它们的摆位和尺寸，给 ⑤「替身和那一颗一样大」对。
      rec.snapAtFreeze = [...g.refs.boardEl.children].filter((el) => !el.classList.contains('ghost') && el.style.width)
        .map((el) => [el.style.left, el.style.top, el.style.width, el.style.height].join('|'));
    },
  };
  localStorage.removeItem(g.bestKey + '::runs');
  const cells = lay(g);
  g.hooks.render();
  const t0 = sim.now;
  rec.t0 = t0;
  rec.boardW0 = g.refs.boardEl.style.width;
  if (cells) g.ctl.resolveMove(new Set(cells), 0);
  if (act) act(g);
  if (during) during(g, rec);
  for (let w = 0; w < 2000 && !g.ends.length; w++) {
    sim.tick(10);
    if (rec.freezes.length && rec.ghosts === undefined && sim.now >= rec.freezes[0] + 1400 + 20) {
      rec.ghosts = [...g.refs.boardEl.querySelectorAll('.ghost')].map((el) => ({ parent: el.parentNode === g.refs.boardEl, key: [el.style.left, el.style.top, el.style.width, el.style.height].join('|') }));
    }
    if (rec.particles === undefined && rec.beats.some((b) => b.lines > 0) && sim.now >= rec.beats.find((b) => b.lines > 0).at + 50) {
      rec.particles = g.refs.boardWrap.querySelectorAll('.juice-particle').length;
    }
  }
  sim.settle(3000);
  rec.ends = g.ends.map((e) => ({ reason: e.reason, at: e.at - t0 }));
  rec.shown = g.shown();
  rec.boardW1 = g.refs.boardEl.style.width;
  try { rec.run = JSON.parse(localStorage.getItem(g.bestKey + '::runs'))?.[0]?.data ?? null; } catch { rec.run = null; }
  rec.uncaught = sim.uncaught.map(String);
  globalThis.__ONEBY = null;
  g.close();
  return rec;
}

/** 跑全部：回红的那几条和报告。`only` 只跑那几副（变异用）。 */
async function runAll(extra = null, { only = null, settings = SETTINGS } = {}) {
  const bad = [];
  const report = [];
  const table = [];
  let sims = 0;
  for (const [sname, motion, step, r] of settings) {
    const sim = await makeSim(ROOT, { motion, mutate: chain(extra, INSTR) });
    sims++;
    sim.B.setFlipStep(step);
    const col = SETTINGS.findIndex((x) => x[0] === sname);
    const row = [];
    for (const fx of FIX) {
      const [name, , , , , times, reason, want] = fx;
      if (only && !only.includes(name.split(' ')[0])) continue;
      const rec = playOne(sim, fx);
      const at = rec.ends[0]?.at ?? null;
      const wantAt = times[col];
      row.push(`${name.split(' ')[0]} ${at}`);
      const where = `${sname} ${name}`;
      // ① 时间线
      if (rec.ends.length !== 1 || !rec.shown) bad.push(`① ${where}：结算 ${rec.ends.length} 次、结算页 ${rec.shown}`);
      if (at === null || Math.abs(at - wantAt) > 10) bad.push(`① ${where}：结算于 ${at} ms，表上是 ${wantAt}（±10）`);
      if (rec.ends[0]?.reason !== reason) bad.push(`① ${where}：理由 ${rec.ends[0]?.reason}，要「${reason}」`);
      if (want.score !== undefined && rec.run?.score !== want.score) bad.push(`① ${where}：拼出分 ${rec.run?.score}，要 ${want.score}`);
      if (want.lines !== undefined && rec.run?.lines !== want.lines) bad.push(`① ${where}：消线 ${rec.run?.lines} 次，要 ${want.lines}`);
      const scale = rec.run ? Math.round(rec.run.unflippedScale * 10000) / 10000 : null;
      if (want.scale !== undefined && scale !== want.scale) bad.push(`① ${where}：剩余色块系数 ${scale}，要 ${want.scale}`);
      if (reason === ALL && scale !== 1) bad.push(`① ${where}：清盘的局剩余色块系数 ${scale}（该是 1）`);
      if (want.elapsed1x !== undefined && sname === '1×' && rec.run?.elapsedSec !== want.elapsed1x) bad.push(`④ ${where}：用时 ${rec.run?.elapsedSec} 秒，要 ${want.elapsed1x}（定格中钟不动）`);
      if (rec.uncaught.length) bad.push(`① ${where}：有没接住的错：${rec.uncaught[0]}`);
      // ② 一拍一组；定格
      const multi = rec.beats.filter((b) => b.lines + b.match !== 1);
      if (multi.length) bad.push(`② ${where}：有 ${multi.length} 拍不是一组（${multi.map((b) => `线 ${b.lines} 图案 ${b.match}`).join(' / ')}）`);
      const clears = reason === ALL && !(fx[1] === 'circle' && fx[2].timeLimitSec === 3 && sname === '0.5×');
      if (clears && !want.ownClear) {
        const last = rec.beats[rec.beats.length - 1];
        if (rec.freezes.length !== 1) bad.push(`② ${where}：定格 ${rec.freezes.length} 次（清盘局要正好 1 次）`);
        else if (!last || Math.abs(last.at - (rec.freezes[0] + 1400)) > 10) bad.push(`② ${where}：定格在 ${rec.freezes[0] - rec.t0} ms，最后一拍在 ${last ? last.at - rec.t0 : '-'} ms（要正好隔 1400）`);
      } else if (!clears || want.ownClear) {
        if (rec.freezes.length !== 0 && !(sname === '0.5×' && fx[2].timeLimitSec === 3)) bad.push(`② ${where}：不该定格却定格了 ${rec.freezes.length} 次`);
      }
      // ③ 三档间隔。顿帧（hitStop，每一拍后面那 70 ms）只在动态效果开时有（减弱动态「无动画、无顿帧」）。计时 3 秒那一副
      // 在 0.5× 档上钟先到点、剩下的拍子被 hurry 一次跑完（D27），不量间隔。
      const bs = rec.beats;
      const hitStop = motion ? 70 : 0;
      const hurriedByClock = fx[2].timeLimitSec === 3 && reason === ALL && at !== null && at < wantAt + 1 && wantAt === 3000;
      for (let i = 0; i + 1 < bs.length && !hurriedByClock; i++) {
        const gap = bs[i + 1].at - bs[i].at - (rec.freezes.some((f) => f > bs[i].at && f < bs[i + 1].at) ? 1400 : 0);
        let expect = null;
        let what = '';
        if (bs[i].lines === 1 && i === 0) { expect = Math.round(1250 / r) + hitStop; what = '玩家那一拍消线'; }
        else if (bs[i].lines === 1) { expect = Math.round(0.4 * Math.round(1250 / r)) + hitStop; what = '自动消线拍'; }
        else if (bs[i].match === 1) {
          const n = bs[i].cells;
          expect = motion ? Math.round(550 / r) + Math.max(Math.round(350 / r), (n - 1) * Math.round(90 / r) + Math.round(350 / r) + 80) : 0;
          what = `图案拍（${n} 格）`;
        }
        if (expect !== null && Math.abs(gap - expect) > 10) bad.push(`③ ${where}：第 ${i} 拍（${what}）到下一拍 ${gap} ms，要 ${expect}`);
      }
      // ⑤ 替身、框、粒子
      if (rec.freezes.length && rec.snapAtFreeze && motion && !hurriedByClock) {
        const ghosts = rec.ghosts ?? [];
        const lost = ghosts.filter((x) => !x.parent || !rec.snapAtFreeze.includes(x.key));
        if (!ghosts.length && fx[1] !== 'square') bad.push(`⑤ ${where}：最后一拍没有淡出替身`);
        if (lost.length) bad.push(`⑤ ${where}：淡出替身和那一颗不一样大、或不在 #board 里：${lost.map((x) => x.key).join(' ; ')}（定格时 ${rec.snapAtFreeze.join(' ; ')}）`);
      }
      if (fx[1] === 'square' && rec.boardW0 && (parseFloat(rec.boardW1) || 0) <= 0) bad.push(`⑤ ${where}：方块行列为 0 那一拍框塌了（宽 ${rec.boardW0} → ${rec.boardW1}）`);
      if (motion && rec.beats.some((b) => b.lines > 0) && !(rec.particles >= 3)) bad.push(`⑤ ${where}：整线那一拍之后 boardWrap 下的粒子只有 ${rec.particles} 颗（要 ≥3）`);
    }
    table.push(`${sname.padEnd(4)} ${row.join(' · ')}`);
  }
  report.push(...table.map((l) => '① ' + l));
  return { bad, report, sims };
}

/** ④ 碰一下、暂停：拿 E1（推荐档、动态效果开）。 */
async function hurryPause(extra = null) {
  const bad = [];
  const lines = [];
  const sim = await makeSim(ROOT, { motion: true, mutate: chain(extra, INSTR) });
  sim.B.setFlipStep(4);
  const fx = FIX[0];
  const base = playOne(sim, fx);
  const f0 = base.freezes[0] - base.t0;
  // 定格中碰一下：当场结算「全部消完了」。
  const at = f0 + 300;
  const hurried = playOne(sim, fx, { during: (g) => { sim.tick(at); g.ctl.hurry(); } });
  lines.push(`④ E1 定格在 ${f0} ms；定格中 ${at} ms 碰一下 → 结算于 ${hurried.ends[0]?.at} ms「${hurried.ends[0]?.reason}」`);
  if (hurried.ends[0]?.reason !== ALL || Math.abs(hurried.ends[0].at - at) > 10) bad.push(`④ 定格中碰一下要当场以「${ALL}」结算：${JSON.stringify(hurried.ends)}`);
  // 定格中暂停 3 秒：晚 3 秒，用时不含定格和暂停。
  const paused = playOne(sim, fx, { during: (g) => { sim.tick(at); g.ctl.pause(); sim.tick(3000); g.ctl.resume(); } });
  const lateBy = (paused.ends[0]?.at ?? 0) - (base.ends[0]?.at ?? 0);
  lines.push(`④ 定格中暂停 3 秒：结算于 ${paused.ends[0]?.at} ms（晚 ${lateBy}），用时 ${paused.run?.elapsedSec} 秒（不暂停 ${base.run?.elapsedSec} 秒）`);
  if (Math.abs(lateBy - 3000) > 10 || paused.ends[0]?.reason !== ALL) bad.push(`④ 定格中暂停 3 秒要晚 3 秒结算「${ALL}」：晚 ${lateBy}、${paused.ends[0]?.reason}`);
  if (paused.run?.elapsedSec !== base.run?.elapsedSec) bad.push(`④ 定格中暂停：用时 ${paused.run?.elapsedSec} 秒，不暂停是 ${base.run?.elapsedSec}（定格、暂停都不计）`);
  if (base.freezes.length !== 1) bad.push(`④（尺子）E1 定格 ${base.freezes.length} 次`);
  return { bad, lines };
}

/** ⑥ 源码。 */
function sourceChecks() {
  const bad = [];
  const gc = readFileSync(resolve(ROOT, GC), 'utf8');
  if (!/const FINALE_HOLD_MS = STUCK_END_MS;/.test(gc)) bad.push('⑥ FINALE_HOLD_MS 不是从 STUCK_END_MS 读的');
  if (!/const STUCK_END_MS = 1400;/.test(gc)) bad.push('⑥ STUCK_END_MS 不是 1400');
  const n = (re) => (gc.match(re) || []).length;
  if (n(/bigMoment\(/g) !== 3 || n(/playClear\(\)/g) !== 1 || n(/playLineClear\(\)/g) !== 1) {
    bad.push(`⑥ bigMoment( ${n(/bigMoment\(/g)} 处（要 3）、playClear() ${n(/playClear\(\)/g)} 处（要 1）、playLineClear() ${n(/playLineClear\(\)/g)} 处（要 1）`);
  }
  if (!/if \(!hooks\.flip && safeFinalGroupNext\(\)\) \{/.test(gc)) bad.push('⑥ 定格那一句（!hooks.flip && safeFinalGroupNext()）找不到');
  return bad;
}

if (MUTANTS) {
  // 门自己的验证（方案 Z-B09 门：撤掉定格、撤掉一拍一组、撤掉 R1、把 D29 的 * pace 去掉，各自要红）。
  const SC = 'src/engine/scoring.ts';
  const R1_BLOCK_START = '    // 这一拍一组图案都没有，才问整线（10-31 方案推14 Z-B09 R1，见上面那段说明）。';
  const moveLineFirst = (rel, src) => {
    if (rel !== SC) return src;
    const a = src.indexOf(R1_BLOCK_START);
    const endMark = '        commit: () => 0,\n      };\n    }\n';
    const b = src.indexOf(endMark, a);
    if (a < 0 || b < 0) throw new Error('门要跟着改：scoring.ts 里认不出 R1 那一段');
    const block = src.slice(a, b + endMark.length);
    const rest = src.slice(0, a) + src.slice(b + endMark.length);
    const at = rest.indexOf('    const matches = dedupe(');
    return rest.slice(0, at) + block + rest.slice(at);
  };
  const V = {
    '撤掉定格（SKIP=hold）→ ② 红': [sub(GC, '        if (!hooks.flip && safeFinalGroupNext()) {', '        if (false) {'), { only: ['E1', 'E6'], settings: [SETTINGS[0]] }],
    '撤掉一拍一组（小球外边一拍交全部够格的边）→ ② 红': [sub('src/shapes/circle.ts', '        bonusedSignatures.add(edgeSig(cands[i]));\n        return [cands[i]];', '        for (const x of cands) bonusedSignatures.add(edgeSig(x));\n        return cands;'), { only: ['E1', 'E2', 'E10'], settings: [SETTINGS[0]] }],
    '撤掉 R1（先问整线）→ E7 红': [moveLineFirst, { only: ['E7'], settings: [SETTINGS[0]] }],
    '把 D29 的 * pace 去掉 → E7 / E15 两档红': [chain(sub(GC, 'Math.round(550 * pace)', '550'), sub(GC, 'Math.round(350 * pace)', '350')), { only: ['E7', 'E15'], settings: [SETTINGS[1], SETTINGS[2]] }],
    // 门自己的尺子（方案没点名）：⑤「替身和那一颗一样大」不是空绿——把小球的淡出替身改小一圈，那一条要红。
    '（尺子）小球的淡出替身改小 → ⑤ 红': [sub('src/shapes/circle.ts', "            ghost.classList.add('ghost');\n            ghost.style.pointerEvents = 'none';\n            ghost.style.opacity = '1';\n", "            ghost.classList.add('ghost');\n            ghost.style.pointerEvents = 'none';\n            ghost.style.opacity = '1';\n            ghost.style.width = '1px';\n"), { only: ['E1', 'E15'], settings: [SETTINGS[0]] }],
  };
  let ok = true;
  for (const [what, [m, opt]] of Object.entries(V)) {
    const r = await runAll(m, opt);
    const red = r.bad.length > 0;
    console.log(`${red ? 'ok  ' : 'BAD '} ${what}：${red ? `红了 ${r.bad.length} 处，例 ${r.bad[0]}` : '居然全绿'}`);
    if (!red) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

const t0 = Date.now();
const { bad, report } = await runAll();
const hp = await hurryPause();
const src = sourceChecks();
for (const line of [...report, ...hp.lines]) console.log(line);
const all = [...bad, ...hp.bad, ...src];
if (all.length) {
  console.log(`\n✗ 收尾逐一消除：${all.length} 处不对（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  for (const b of all.slice(0, 40)) console.log('  ' + b);
  if (all.length > 40) console.log(`  ……另有 ${all.length - 40} 处`);
  process.exit(1);
}
console.log(`\n✓ 收尾逐一消除：十六副 × 四档时间线、一拍一组、定格、间隔、碰一下 / 暂停、替身、源码都对（${Math.round((Date.now() - t0) / 1000)} 秒）`);
process.exit(0);
