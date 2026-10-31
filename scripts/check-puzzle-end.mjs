/**
 * 步步为营：清盘必结算（10-31 方案推02 Z-A02；草稿是方案附带的 sim-puzzle/check-puzzle-end.mjs）。纯 node，不开浏览器
 * （照 check-seed-golden 的做法：esbuild 打包 src、假 DOM；夹具 scripts/lib/puzzleEndBundle.mjs，只在包里插口子）。
 *
 *   node scripts/check-puzzle-end.mjs             # CI check 那一条跑的就是这一句
 *   node scripts/check-puzzle-end.mjs --mutants   # 门自己的验证：故意改坏控制器 / 棋盘的结局判定，每一处都得红
 *
 * 为什么要有这一道：站长 10-19「步步为营在消除没有任何内容后仍然不触发游戏结束判定」；10-19 复现 7（小球收尾放开后
 * 只剩几枚互不同线、一手都滑不动）在所有玩法里都会永远挂着——计数层说「活」，穷举层又被「零手」那一句截成
 * 'unknown'。推02 删了那一句（修法 C）、加了轨道计数层，这一道钉住「盘空 / 走不动」都会结算：
 *
 * ① 六副棋盘「一枚不剩」时 isGameOver 为真、tilesLeft 为 0（方块：rows=0 / cols=0）。
 * ② 步步为营 × 方块 / 小球（基础玩法对照）× 动态效果开 / 关 × 三种时序（直接 / 清盘那一拍中途 hurry / 暂停—继续）：
 *    最后一步把盘清空 → 进 endGame 恰好一次、理由 = ALL_FLIPPED_REASON、结算页露面、gameOver、resolving 归零。
 * ③ 真发的牌滑到余步只剩 1 时那一手清盘：报「全部消完了」不报「步数用完了」，存档 left = 1（排行榜 boardValue 认这两样）。
 * ⑤ 随机残局 × 随机走子（固定种子）：每一步之后「盘空没结束 / isGameOver 真没结束 / 连锁卡住」都不许出现，清盘局数 > 50。
 * ⑥ 收尾动画在空盘那一拍抛错 / 步步为营跳过清盘判定（两种故意改坏）：仍然结算，最迟在下一次碰棋盘时（推01 的兜底接住）。
 * ⑦ 10-19 复现 7：小球收尾后剩三枚互不同线、一手都滑不了 → 步步为营和基础都以「无法继续匹配」收场（修法 C）。
 *
 * 红了照 10-31 方案〇·四第 3 条停下回报，不改这里的期望。认不出插口子 / 变异点的写法 →「门要跟着改」。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSim as makeSim0, star, tile, BLANK_TILE } from './lib/puzzleEndBundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const makeSim = (opts) => makeSim0(ROOT, opts);

const MUTANTS = process.argv.includes('--mutants');
let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  if (!ok || !QUIET) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
let QUIET = false;

function lastLineClear(g, id) {
  if (id === 'square') {
    g.tap.setGrid([Array.from({ length: 6 }, () => star(2))]);
    return new Set(Array.from({ length: 6 }, (_, c) => `0,${c}`));
  }
  const gr = [];
  for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE()));
  gr[6][0] = star(1); gr[6][1] = star(1); gr[6][2] = star(1);
  g.tap.setGrid(gr);
  return new Set(['6,0', '6,1', '6,2']);
}
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROWS7 = 7;
const CLINES = [];
for (let d = 0; d < ROWS7; d++) { const cells = []; for (let r = d; r < ROWS7; r++) cells.push([r, r - d]); CLINES.push({ fam: 'A', offset: d, cells }); }
for (let e = 0; e < ROWS7; e++) { const cells = []; for (let r = e; r < ROWS7; r++) cells.push([r, e]); CLINES.push({ fam: 'B', offset: e, cells }); }
for (let r = 0; r < ROWS7; r++) { const cells = []; for (let c = 0; c <= r; c++) cells.push([r, c]); CLINES.push({ fam: 'R', offset: r, cells }); }
/** 此刻每一手合法的滑动（照两副棋盘的 applyDrag：改网格、回遮罩）。 */
function legal(g, id, B) {
  const out = [];
  const grid = g.tap.grid();
  if (id === 'square') {
    const [rows, cols] = g.tap.dims();
    for (let r = 0; r < rows; r++) for (let k = 1; k < cols; k++) out.push(() => { grid[r] = B.slideLine(grid[r], k); return new Set(Array.from({ length: cols }, (_, c) => `${r},${c}`)); });
    for (let c = 0; c < cols; c++) for (let k = 1; k < rows; k++) out.push(() => { const s = B.slideLine(grid.map((row) => row[c]), k); for (let r = 0; r < rows; r++) grid[r][c] = s[r]; return new Set(Array.from({ length: rows }, (_, r) => `${r},${c}`)); });
  } else {
    for (const line of CLINES) {
      const cells = line.cells.filter(([r, c]) => !g.tap.isBlank(grid[r][c]));
      for (let k = 1; k < cells.length; k++) out.push(() => { const s = B.slideLine(cells.map(([r, c]) => grid[r][c]), k); cells.forEach(([r, c], j) => { grid[r][c] = s[j]; }); return new Set(cells.map(([r, c]) => `${r},${c}`)); });
    }
  }
  return out;
}

async function runGate(opts = {}) {
  fail = 0; pass = 0;
  for (const motion of [false, true]) {
    const sim = await makeSim({ motion, mutate: opts.mutate });
    const { open, pump, B, dom } = sim;

    if (!motion) {
      // ① 六副棋盘一枚不剩
      for (const game of B.games) {
        const id = game.card.id;
        const g = open(id, {});
        const variants = id === 'square'
          ? [['rows=0', []], ['cols=0', Array.from({ length: 6 }, () => [])]]
          : [['全部空位', g.tap.grid().map((row) => row.map((t) => (t == null ? t : BLANK_TILE())))]];
        for (const [label, gg] of variants) {
          g.tap.setGrid(gg);
          check(`① ${id} ${label}：isGameOver 真、tilesLeft 0`, g.hooks.isGameOver() === true && g.hooks.tilesLeft() === 0,
            `isGameOver=${g.hooks.isGameOver()} tilesLeft=${g.hooks.tilesLeft()}`);
        }
        g.close();
      }
    }

    for (const id of ['square', 'circle']) {
      for (const steps of [true, false]) {
        for (const timing of ['直接', 'hurry', '暂停']) {
          const g = open(id, { steps });
          const mask = lastLineClear(g, id);
          g.ctl.resolveMove(mask, 0);
          if (timing === 'hurry') g.ctl.hurry();
          if (timing === '暂停') { g.ctl.pause(); dom.runTimers(1e9); g.ctl.resume(); }
          pump();
          const tag = `② ${motion ? '动态' : '减弱'} ${id} ${steps ? '步步为营' : '基础'} ${timing}`;
          check(`${tag}：清盘 → 结算`, g.ctl.gameOver && !g.ctl.resolving && g.ends.length === 1 && g.ends[0].reason === B.ALL_FLIPPED_REASON
            && g.refs.endOverlay.classList.contains('show'),
            `gameOver=${g.ctl.gameOver} resolving=${g.ctl.resolving} ends=${JSON.stringify(g.ends.map((e) => e.reason))} 结算页=${g.refs.endOverlay.classList.contains('show')} errors=${g.errors.map((e) => e.message).join('/')}`);
          g.close();
        }
      }
      if (!motion) {
        // ③ 余步只剩 1 时那一手清盘：先在真发的牌上随手滑（滑到余步剩 1），再摆一副最后一手能清盘的残局
        const g = open(id, { steps: true });
        const start = Number(g.refs.hudTimeEl?.textContent);
        const r3 = mulberry(7 + (id === 'square' ? 1 : 2));
        for (let k = 0; k < 400 && !g.ctl.gameOver && Number(g.refs.hudTimeEl?.textContent) > 1; k++) {
          const ms = legal(g, id, B);
          g.ctl.resolveMove(ms[Math.floor(r3() * ms.length)](), 0);
          pump();
        }
        const leftBefore = Number(g.refs.hudTimeEl?.textContent);
        g.ctl.resolveMove(lastLineClear(g, id), 0);
        pump();
        check(`③ ${id} 余步 ${leftBefore} 时清盘：报「全部消完了」、余步不扣`, leftBefore === 1 && g.ends.length === 1 && g.ends[0].reason === B.ALL_FLIPPED_REASON
          && Number(g.refs.hudTimeEl?.textContent) === 1,
          `起手=${start} 清盘前余步=${leftBefore} 清盘后余步=${g.refs.hudTimeEl?.textContent} ends=${JSON.stringify(g.ends.map((e) => e.reason))}`);
        g.close();
      }
    }

    if (!motion) {
      // ⑤ 随机残局不变量
      const ROWS = 7;
      const CL = [];
      for (let d = 0; d < ROWS; d++) { const cells = []; for (let r = d; r < ROWS; r++) cells.push([r, r - d]); CL.push({ fam: 'A', offset: d, cells }); }
      for (let e = 0; e < ROWS; e++) { const cells = []; for (let r = e; r < ROWS; r++) cells.push([r, e]); CL.push({ fam: 'B', offset: e, cells }); }
      for (let r = 0; r < ROWS; r++) { const cells = []; for (let c = 0; c <= r; c++) cells.push([r, c]); CL.push({ fam: 'R', offset: r, cells }); }
      let bad = 0, ran = 0, cleared = 0;
      let firstBad = '';
      for (let i = 0; i < 120; i++) {
        for (const id of ['square', 'circle']) {
          const rand = mulberry(20261019 + i * 31 + (id === 'square' ? 1 : 2));
          const level = [1, 1, 2, 3, 4][Math.floor(rand() * 5)];
          const allStar = level === 1;
          let start;
          if (id === 'square') {
            const R = 1 + Math.floor(rand() * 4), C = 1 + Math.floor(rand() * 4), K = 2 + Math.floor(rand() * 3);
            start = Array.from({ length: R }, () => Array.from({ length: C }, () => (allStar || rand() < 0.6 ? star(Math.floor(rand() * K)) : tile(Math.floor(rand() * K), Math.floor(rand() * K)))));
          } else {
            const live = new Set();
            for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) live.add(`${r},${c}`);
            const board = { lines: CL, isLive: (r, c) => live.has(`${r},${c}`) };
            const keep = Math.floor(rand() * 21);
            let thr = B.EDGE_MIN;
            while (live.size > keep) {
              let edges = B.outerEdges(board, thr);
              if (!edges.length && thr === B.EDGE_MIN) { thr = B.EDGE_MIN_ENDGAME; edges = B.outerEdges(board, thr); }
              if (!edges.length) break;
              for (const [r, c] of edges[Math.floor(rand() * edges.length)].live) live.delete(`${r},${c}`);
            }
            start = [];
            for (let r = 0; r < ROWS; r++) start.push(Array.from({ length: r + 1 }, (_, c) => (!live.has(`${r},${c}`) ? BLANK_TILE()
              : allStar || rand() < 0.55 ? star(Math.floor(rand() * 4)) : tile(Math.floor(rand() * 4), Math.floor(rand() * 4)))));
          }
          for (const steps of [true, false]) {
            const g = open(id, { steps });
            if (level < 4) g.ero.spend(id === 'square' ? { 3: 15, 2: 26, 1: 999 }[level] : { 3: 12, 2: 20, 1: 999 }[level]);
            g.tap.setGrid(start.map((row) => row.map((t) => ({ ...t }))));
            const r2 = mulberry(i * 7 + (steps ? 3 : 5));
            const moves = () => {
              const out = [];
              const grid = g.tap.grid();
              if (id === 'square') {
                const [rows, cols] = g.tap.dims();
                for (let r = 0; r < rows; r++) for (let k = 1; k < cols; k++) out.push(() => { grid[r] = B.slideLine(grid[r], k); return new Set(Array.from({ length: cols }, (_, c) => `${r},${c}`)); });
                for (let c = 0; c < cols; c++) for (let k = 1; k < rows; k++) out.push(() => { const s = B.slideLine(grid.map((row) => row[c]), k); for (let r = 0; r < rows; r++) grid[r][c] = s[r]; return new Set(Array.from({ length: rows }, (_, r) => `${r},${c}`)); });
              } else {
                for (const line of CL) {
                  const cells = line.cells.filter(([r, c]) => !g.tap.isBlank(grid[r][c]));
                  for (let k = 1; k < cells.length; k++) out.push(() => { const s = B.slideLine(cells.map(([r, c]) => grid[r][c]), k); cells.forEach(([r, c], j) => { grid[r][c] = s[j]; }); return new Set(cells.map(([r, c]) => `${r},${c}`)); });
                }
              }
              return out;
            };
            // 摆出来就已经空了 / 走不了的不算（那一副是摆的，不是走出来的）
            if (g.hooks.tilesLeft() === 0 || !moves().length) { g.close(); continue; }
            ran++;
            for (let m = 0; m < 60 && !g.ctl.gameOver; m++) {
              const ms = moves();
              if (!ms.length) break;
              g.ctl.resolveMove(ms[Math.floor(r2() * ms.length)](), 0);
              pump();
              const why = (!g.ctl.gameOver && g.hooks.tilesLeft() === 0) ? 'A1' : (!g.ctl.gameOver && g.hooks.isGameOver()) ? 'A2' : g.ctl.resolving ? 'A3' : '';
              if (why) { bad++; if (!firstBad) firstBad = `${why} #${i} ${id} ${steps ? '步步为营' : '基础'} 第 ${m + 1} 步`; break; }
            }
            if (g.ends[0] === B.ALL_FLIPPED_REASON || g.ends[0]?.reason === B.ALL_FLIPPED_REASON) cleared++;
            g.close();
          }
        }
      }
      check(`⑤ 随机残局 ${ran} 局（其中清盘 ${cleared} 局）：没有「盘空 / isGameOver 真 / 连锁卡住」却没结束`, bad === 0 && cleared > 50, firstBad);
    }
  }
  return fail;
}

/** ⑥ 的两种故意改坏（草稿原在 repro8-watchdog.mjs 里，搬进来只留这两个变异）。 */
const CTL = 'src/engine/gameController.ts';
const THROW_ON_EMPTY = (rel, src) => {
  if (rel === 'src/shapes/square.ts') {
    const a = '        onCascadeStepRendered: ({ lineBonusGroups }) => {\n';
    if (!src.includes(a)) throw new Error('门要跟着改：认不出方块 onCascadeStepRendered');
    return src.replace(a, a + "          if (rows === 0 || cols === 0) throw new Error('模拟：收尾动画在空盘上抛错');\n");
  }
  if (rel === 'src/shapes/circle.ts') {
    const a = '        onCascadeStepRendered: ({ lineBonusGroups, matchGroups }) => {\n';
    if (!src.includes(a)) throw new Error('门要跟着改：认不出小球 onCascadeStepRendered');
    return src.replace(a, a + "          if (grid.every((row) => row.every((t) => isBlank(t)))) throw new Error('模拟：收尾动画在空盘上抛错');\n");
  }
  return src;
};
const SKIP_CLEAR = (rel, src) => {
  if (rel !== CTL) return src;
  // finish() 里那一句（推01 起 checkEnd 里也有一句 `if (hooks.isGameOver())`，所以连着下一行认）
  const a = '      if (hooks.isGameOver()) {\n        resolving = false;';
  if (src.split(a).length !== 2) throw new Error('门要跟着改：认不出控制器 finish() 里的清盘判定');
  return src.replace(a, '      if (!bank && hooks.isGameOver()) {\n        resolving = false;');
};

/**
 * ⑥ 连锁在空盘那一拍抛错 / 清盘判定被跳过，两种改坏下仍然结算（推01 的结尾兜底接住）。
 * ⑦ 小球收尾放开后剩下互不同线的几枚、一手都滑不了 → 1.4 秒后「无法继续匹配」（推02 修法 C）。
 */
async function runFixSections(extra) {
  const both = (...fs) => (rel, src) => fs.reduce((x, f) => (f ? f(rel, x) : x), src);
  // 这两种改坏下兜底本来就会出声（[slides:end-guard] 那一行），是预期的；收起来，别把门的输出刷满堆栈。
  const origErr = console.error;
  console.error = (...a) => { if (!String(a[0]).startsWith('[slides:end-guard]')) origErr(...a); };
  for (const [name, mut] of [['空盘那一拍抛错', THROW_ON_EMPTY], ['清盘判定被跳过', SKIP_CLEAR]]) {
    const sim = await makeSim({ motion: true, mutate: both(mut, extra) });
    for (const id of ['square', 'circle']) {
      const g = sim.open(id, { steps: true });
      const mask = lastLineClear(g, id);
      try { g.ctl.resolveMove(mask, 0); } catch { /* 模拟的那一下抛错 */ }
      sim.pump();
      if (!g.ctl.gameOver) { try { g.ctl.hurry(); } catch { /* 同上 */ } sim.pump(); }
      check(`⑥ ${id} ${name}：仍然结算（最迟下一次碰棋盘）`, g.ctl.gameOver && g.ends.length === 1 && g.ends[0].reason === sim.B.ALL_FLIPPED_REASON,
        `gameOver=${g.ctl.gameOver} resolving=${g.ctl.resolving} ends=${JSON.stringify(g.ends.map((e) => e.reason))}`);
      g.close();
    }
  }
  console.error = origErr;
  const sim = await makeSim({ mutate: extra });
  for (const steps of [true, false]) {
    const g = sim.open('circle', { steps });
    g.ero.spend(20);
    const gr = []; for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE()));
    gr[1][0] = tile(0, 1); gr[6][3] = tile(2, 1); gr[4][0] = star(1); gr[4][2] = star(3);
    g.tap.setGrid(gr);
    const cells = [[4, 0], [4, 2]];
    const sh = sim.B.slideLine(cells.map(([r, c]) => gr[r][c]), 1);
    cells.forEach(([r, c], i) => { gr[r][c] = sh[i]; });
    g.ctl.resolveMove(new Set(['4,0', '4,2']), 0);
    sim.pump();
    check(`⑦ 小球 ${steps ? '步步为营' : '基础'} 收尾后剩三枚互不同线、一手都滑不了 → 无法继续匹配`, g.ctl.gameOver && g.ends[0]?.reason === '无法继续匹配',
      `gameOver=${g.ctl.gameOver} ends=${JSON.stringify(g.ends.map((e) => e.reason))}`);
    g.close();
  }
}

if (!MUTANTS) {
  const t0 = Date.now();
  await runGate({});
  await runFixSections(null);
  console.log(`\n${fail ? 'FAIL' : 'PASS'}  ${pass} 过 / ${fail} 红（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  process.exit(fail ? 1 : 0);
} else {
  QUIET = true;
  const ctl = 'src/engine/gameController.ts';
  const mutants = [
    ['步步为营跳过清盘判定', ctl, '      if (hooks.isGameOver()) {\n        resolving = false;', '      if (!bank && hooks.isGameOver()) {\n        resolving = false;'],
    // （「余步判定排到清盘前面」是等价变异，不列：第 3 版清盘那一手一定有整线分 → totalRaw > 0 → 不扣步，余步不会在那一手见底。）
    ['方块清空不算终局', 'src/shapes/square.ts', 'return allGone || rows === 0 || cols === 0;', 'return allGone;'],
    // 推01 起 runBeat 跑完一拍会补收尾（settleIfBroken），单改这一处已经挂不住了（那正是推01 要的）；所以连那一层兜底
    // 一起拆，量的是「两层都漏了」时这道门还看不看得出来。
    ['小球最后一拍不收尾（finish 前 return，连锁兜底也拆掉）', ctl, ['      if (!s) {\n        finish();', '    settleIfBroken();\n  }\n  /** 连锁断了'], ['      if (!s) {\n        if (hooks.puzzle) { return; }\n        finish();', '  }\n  /** 连锁断了']],
  ];
  let ok = true;
  for (const [name, file, from, to] of mutants) {
    const f = await runGate({
      mutate: (rel, src) => {
        if (rel !== file) return src;
        const froms = [].concat(from);
        const tos = [].concat(to);
        froms.forEach((a, i) => {
          if (src.split(a).length !== 2) throw new Error(`门要跟着改：变异点认不出：${name}`);
          src = src.replace(a, tos[i]);
        });
        return src;
      },
    });
    console.log(`${f ? 'PASS' : 'FAIL'}  变异「${name}」${f ? `红了 ${f} 条` : '没红——门咬不住'}`);
    if (!f) ok = false;
  }
  process.exit(ok ? 0 : 1);
}
