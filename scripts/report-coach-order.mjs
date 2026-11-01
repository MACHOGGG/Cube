/**
 * 体检台：教学条五条在真局里是按什么节奏走过去的（10-11 方案 D-1 那份蒙特卡洛固定成脚本；10-31 方案推15 Z-C06 第 5 条）。
 *
 *   node scripts/report-coach-order.mjs                  # 方块、小球各 1000 局 × 四种走法（约一小时）
 *   node scripts/report-coach-order.mjs --games=200      # 抽检
 *
 * **不是门**：永远返回 0，只把数字摆出来（和 report-cvd-sim 一样）。数字写进提交说明；和 rerun-f5 §C 对不上（差 2 个百分点以上）
 * 停下回报。
 *
 * 打包的是真引擎（scripts/lib/endDetectBundle.mjs 那一包：真棋盘、真控制器、真教学条 coachBar、F5 阶梯、散边、收尾逐一，
 * 假 DOM ＋ 虚拟时钟），开的是真教学局（coach: true，coachPlan: 'first'——第一副基础棋盘从 A 讲起）。每一步之前钟往前走
 * THINK_MS（想一想的时间：A 那 10 秒、C 至少 5 秒都按真钟算），滑完把连锁走完再读条子。呼吸灯的搜索（createCoachGlow 的
 * start）在这一包里关掉：条子换档不看它（C→D 看的是「某色星星够最短外边」，starClearHintFor），关掉只省时间。
 *
 * 四种走法（从随手到贪心，10-11 那份的口径）：
 *   随手   每一步随便滑一条线；
 *   新手   一半的时候挑一步当下就得分的（有的话），否则随手；
 *   普通   八成五挑当下得分最多的那一步（平手随机），一成五随手；
 *   贪心   永远挑当下得分最多的那一步。
 * 「当下得分」= 这一步滑完连锁第一拍：图案里的色块每枚 2 分 ＋ 整条消掉的外边（星星数²）。
 *
 * 打出来的：C 出现在第一次消外边之前的比例；C 出现时盘上已经没有色块的比例；B 持续几步（中位、0 步的比例）；C→D 用了
 * 几轮（中位、95%、99.8%、最多）；从开局到见到 D 一共几轮（同上——D77 的口径：F5 下方块 95% 见到 D 要 33 轮、样本最大 59，
 * check-coach-aim 第 ② 节的轮数因此 44 → 60）。方案要拿来对照的 rerun-f5 §C 报告没随方案附带，只有 D77 这一组数可对。
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSim } from './lib/endDetectBundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const GAMES = Number(arg('games', 1000));
const BOARDS = arg('boards', 'square,circle').split(',');
const BOTS = arg('bots', '随手,新手,普通,贪心').split(',');
const MAX_STEPS = Number(arg('steps', 120));
const THINK_MS = Number(arg('think', 1500));
// 一种组合（一副棋盘 × 一种走法）一个子进程：同一个进程里连打几千局，假 DOM 那一包的内存一路涨（10-31 实测连跑五种组合、
// 五千局时堆到 8GB 被 V8 掐掉，EXIT 134）。子进程只打印它那一行。
const CHILD = process.argv.includes('--child');
const HEAD = '棋盘   走法  局数  C早于消外边  C时无色块  B步数中位  B=0步   C→D中位  95%   99.8%  最多  没到D   见到D：中位  95%  99.8%  最多';
if (!CHILD) {
  const t0 = Date.now();
  console.log(`教学条五条的节奏（真教学局，coachPlan 'first'；每步想 ${THINK_MS}ms；每局最多 ${MAX_STEPS} 步）\n`);
  console.log(HEAD);
  for (const board of BOARDS) {
    for (const bot of BOTS) {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--boards=${board}`, `--bots=${bot}`, `--games=${GAMES}`, `--steps=${MAX_STEPS}`, `--think=${THINK_MS}`, '--child'], { encoding: 'utf8', maxBuffer: 1 << 26 });
      const row = (r.stdout || '').split('\n').find((l) => l.startsWith(board));
      console.log(row ?? `${board.padEnd(6)} ${bot}  这一种没跑完（退出码 ${r.status}${r.signal ? '，' + r.signal : ''}）：${(r.stderr || '').trim().split('\n').slice(-1)[0] ?? ''}`);
    }
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} 秒。体检台，永远返回 0。`);
  process.exit(0);
}

/** 只在这一包里：露出 glowView（走法要它），关掉呼吸灯的搜索（只省时间）。 */
const mutate = (rel, src) => {
  if (rel === 'src/shapes/square.ts' || rel === 'src/shapes/circle.ts') {
    const a = 'let grid: Tile[][] = [];';
    if (src.split(a).length !== 2) throw new Error(`report-coach-order 要跟着改：${rel} 认不出 grid`);
    return src.replace(a, a + '\n      (globalThis as any).__PLANVIEW = () => glowView();');
  }
  if (rel === 'src/engine/coachHint.ts') {
    const a = '      start(hint);\n';
    if (src.split(a).length !== 2) throw new Error('report-coach-order 要跟着改：coachHint.ts 认不出 start(hint)');
    return src.replace(a, '      void start;\n');
  }
  return src;
};
const sim = await makeSim(ROOT, { motion: false, mutate });
// 教学条要出：把「看过 / 打过」那几把键拿掉（makeSim 默认预设了它们——那几道门量的是结尾，不是教学）。
const clearPlayed = () => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('slides_played_') || k.startsWith('slides_tutorial_seen')) localStorage.removeItem(k);
};

let seed = 20261031;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const movedOf = (b, m) => new Set(m.cells.map((i) => b.step.cells[i][0] + ',' + b.step.cells[i][1]));
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
/** 当下得分：图案里的色块每枚 2 分 ＋ 整条消掉的外边（星星数²）。 */
function pointsOf(v, m) {
  const trial = v.grid.map((r) => r.slice());
  applyMove(trial, v.step, m);
  let p = 0;
  for (const e of v.clearing(trial)) p += e.length ** 2;
  for (const g of v.scoring(trial, movedOf(v, m))) p += 2 * g.filter(([r, c]) => v.isBlock(trial[r][c])).length;
  return p;
}
function choose(bot, v) {
  const moves = v.step.moves;
  if (!moves.length) return null;
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  if (bot === '随手') return pick(moves);
  const pts = moves.map((m) => pointsOf(v, m));
  if (bot === '新手') {
    const scoring = moves.filter((_, i) => pts[i] > 0);
    return scoring.length && rnd() < 0.5 ? pick(scoring) : pick(moves);
  }
  if (bot === '普通' && rnd() < 0.15) return pick(moves);
  const best = Math.max(...pts);
  return pick(moves.filter((_, i) => pts[i] === best));
}
const liveCount = (v) => v.grid.flat().filter((t) => t && (v.isPiece(t) || v.isStar(t) || v.isBlock(t))).length;
const hasBlock = (v) => v.grid.flat().some((t) => t && v.isBlock(t));

async function bundleRules() {
  const { buildSync } = await import('esbuild');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'coach-order-'));
  buildSync({ entryPoints: [join(ROOT, 'src/i18n.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(dir, 'i18n.mjs'), logLevel: 'silent' });
  const m = await import(pathToFileURL(join(dir, 'i18n.mjs')).href);
  rmSync(dir, { recursive: true, force: true });
  return m.tutorialRules;
}
const tutorialRules = await bundleRules();

function playOne(board, bot) {
  clearPlayed();
  const g = sim.open(board, { coach: true, coachPlan: 'first' });
  const texts = tutorialRules('zhHans', board);
  const barNow = () => texts.indexOf(document.querySelector('#coachBar .coach-text')?.textContent ?? '');
  sim.settle(3000);
  const seen = []; // 每一条第一次出现在第几步
  const at = (i, step) => {
    if (i >= 0 && seen[i] === undefined) seen[i] = step;
  };
  at(barNow(), 0);
  let firstEdge = null;
  let cNoBlock = null;
  for (let step = 1; step <= MAX_STEPS; step++) {
    if (g.ctl.gameOver) break;
    sim.tick(THINK_MS);
    const v = globalThis.__PLANVIEW();
    const m = choose(bot, v);
    if (!m) break;
    const before = liveCount(v);
    applyMove(v.grid, v.step, m);
    g.ctl.resolveMove(movedOf(v, m), 0);
    sim.settle(20000);
    const after = globalThis.__PLANVIEW();
    if (firstEdge === null && liveCount(after) < before) firstEdge = step;
    const i = barNow();
    if (i === 2 && seen[2] === undefined) cNoBlock = !hasBlock(after);
    at(i, step);
    if (seen[4] !== undefined) break; // 读到 E 就够了
  }
  g.close();
  return { seen, firstEdge, cNoBlock };
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const quant = (xs, p) => {
  if (!xs.length) return '—';
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
for (const board of BOARDS) {
  for (const bot of BOTS) {
    let cBefore = 0;
    let cSeen = 0;
    let cNo = 0;
    const bSteps = [];
    const cd = [];
    const toD = [];
    let noD = 0;
    for (let i = 0; i < GAMES; i++) {
      const r = playOne(board, bot);
      if (r.seen[2] !== undefined) {
        cSeen++;
        if (r.firstEdge === null || r.seen[2] < r.firstEdge) cBefore++;
        if (r.cNoBlock) cNo++;
        if (r.seen[1] !== undefined) bSteps.push(r.seen[2] - r.seen[1]);
        if (r.seen[3] !== undefined) cd.push(r.seen[3] - r.seen[2]);
        else noD++;
      }
      if (r.seen[3] !== undefined) toD.push(r.seen[3]);
    }
    const bMed = quant(bSteps, 0.5);
    console.log(`${board.padEnd(6)} ${bot}  ${String(GAMES).padStart(4)}  ${pct(cBefore, cSeen).padStart(9)}  ${pct(cNo, cSeen).padStart(8)}  ${String(bMed).padStart(8)}  ${pct(bSteps.filter((x) => x === 0).length, bSteps.length).padStart(6)}   ${String(quant(cd, 0.5)).padStart(5)}  ${String(quant(cd, 0.95)).padStart(4)}  ${String(quant(cd, 0.998)).padStart(5)}  ${String(cd.length ? Math.max(...cd) : '—').padStart(4)}  ${String(noD).padStart(4)}   ${String(quant(toD, 0.5)).padStart(9)}  ${String(quant(toD, 0.95)).padStart(4)}  ${String(quant(toD, 0.998)).padStart(5)}  ${String(toD.length ? Math.max(...toD) : '—').padStart(4)}`);
  }
}
sim.restoreConsole();
process.exit(0);
