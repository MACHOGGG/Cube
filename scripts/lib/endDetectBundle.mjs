/**
 * check-end-detect 的那一包和夹具（10-31 方案推01 Z-A01；草稿是方案附带的 sim-enddet/harness.mjs ＋ bundle.mjs，合成这一份）。
 *
 * 写法照 scripts/lib/seedGoldenBundle.mjs：esbuild 把 `src` 打成一包，**只在这一包里**插只读口子和故障开关，
 * 源码和产物一字不动：
 *
 *   · 六个棋盘文件：`let grid: Tile[][] = [];` 后面露出 grid 的读写、isBlank（方块另露 rows/cols）；
 *   · engine/gameController.ts：createGameController 外面包一层，记下 refs、hooks 和返回的 controller；
 *     endGame0（真正结算的那一段，外层 endGame 是幂等的门）一进门报一声理由；侵蚀阶梯露出来；
 *   · engine/analytics.ts：trackEndGuard 一进门报一声（门数「每个标签最多报一次」）；
 *   · engine/residueBoard.ts（推02 起）：轨道计数层说死、而且可用 ≤12 枚（穷举走得完）时，同一副再照常穷举一遍，
 *     把两个答案一起报给门（⑤「轨道说死 ⇒ 穷举说死」的尺子）；
 *   · 故障开关：调用方传 `mutate`（check-end-detect 的 POINTS 插桩、逻辑变异）在插口子之前改源码。
 *
 * **认不出插口子的那几句就当场 throw「门要跟着改」**，不静默跳过——静默跳过的门在一张空表上全绿。
 *
 * 夹具：假 DOM（scripts/lib/fakeDom.mjs）、虚拟毫秒时钟（setTimeout / setInterval / rAF / performance.now
 * 全接管，tick(ms) 往前走）、三种画布（stub 什么都不画 / null 是 WebKit 画布内存超限时 getContext 回 null /
 * taint 是 toDataURL 抛 SecurityError）、console.error 收进 logs（`[slides:end-guard]` 那一行门要数）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { installFakeDom } from './fakeDom.mjs';

export const BOARD_FILES = ['square', 'circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle'];

const must = (file, ok, what) => {
  if (!ok) throw new Error(`门要跟着改：${file} 里认不出「${what}」（check-end-detect 只在自己那一包里插口子，见 scripts/lib/endDetectBundle.mjs）`);
};

function tapBoard(file, name, src) {
  const anchor = 'let grid: Tile[][] = [];';
  must(file, src.split(anchor).length === 2, anchor);
  must(file, /function isBlank\(t: Tile\): boolean \{/.test(src), 'function isBlank(t: Tile): boolean');
  const id = /\n\s+id: '([A-Za-z]+)',\n/.exec(src)?.[1];
  must(file, !!id, "card 里的 id: '…'");
  const isSquare = name === 'square';
  const extra = isSquare
    ? `setGrid: (g: Tile[][]) => { grid = g; rows = g.length; cols = g[0] ? g[0].length : 0; }, dims: () => [rows, cols],`
    : `setGrid: (g: Tile[][]) => { grid = g; },`;
  const tap = `\n      (globalThis as any).__SIM?.board({ id: '${id}', grid: () => grid, ${extra} isBlank: (t: Tile) => isBlank(t) });`;
  return src.replace(anchor, anchor + tap);
}

function tapController(file, src) {
  const sig = 'export function createGameController(refs: ShellRefs, hooks: GameControllerHooks): GameController {';
  must(file, src.split(sig).length === 2, sig);
  const eg = 'function endGame0(reason: string, extraPenalty = 0, extraPenaltyLabel = s.defaultPenaltyLabel) {';
  must(file, src.split(eg).length === 2, eg);
  const er = '  const scoreReel = createScoreReel(refs.scoreReelEl, refs.gainBadgeEl);';
  must(file, src.split(er).length === 2, er);
  return (
    src
      .replace(er, '  (globalThis as any).__SIM?.erosion?.(erosion);\n' + er)
      .replace(eg, eg + '\n    (globalThis as any).__SIM?.ended?.(reason, { practice: !!hooks.practice });')
      .replace(sig, 'function __simInnerController(refs: ShellRefs, hooks: GameControllerHooks): GameController {') +
    '\nexport function createGameController(refs: ShellRefs, hooks: GameControllerHooks): GameController {\n' +
    '  const ctl = __simInnerController(refs, hooks);\n  (globalThis as any).__SIM?.controller(refs, hooks, ctl);\n  return ctl;\n}\n'
  );
}

function tapAnalytics(file, src) {
  const sig = 'export function trackEndGuard(kind: string, mode: string): void {';
  must(file, src.split(sig).length === 2, sig);
  return src.replace(sig, sig + '\n  (globalThis as any).__SIM?.endGuard?.(kind, mode);');
}

function tapResidue(file, src) {
  // 认的是「if (…orbitDead(built, moves, opts.matchLen, bonusLines)) return 'dead';」那一行（前缀照抄，门的变异会改它）。
  const re = /\n  if \((.*)orbitDead\(built, moves, opts\.matchLen, bonusLines\)\) return 'dead';\n/;
  const m = re.exec(src);
  must(file, m && src.split(m[0]).length === 2, "if (!opts.slot && orbitDead(built, moves, opts.matchLen, bonusLines)) return 'dead';");
  return src.replace(m[0],
    `\n  const __od = ${m[1]}orbitDead(built, moves, opts.matchLen, bonusLines);` +
    `\n  if (__od && (globalThis as any).__SIM?.probe && usable <= 12) (globalThis as any).__SIM.probe(residueSearch({ start: built.start, moves, scanLines: built.scanLines, matchLen: opts.matchLen, bonusLines }));` +
    `\n  if (__od) return 'dead';\n`);
}

function globTable(file, src) {
  const re = /import\.meta\.glob\(\s*'([^']+)'\s*,\s*\{[^}]*\}\s*\)/g;
  return src.replace(re, (_, pattern) => {
    const dir = resolve(dirname(file), dirname(pattern));
    const ext = pattern.slice(pattern.lastIndexOf('*') + 1);
    const table = {};
    for (const f of readdirSync(dir).filter((x) => x.endsWith(ext)).sort()) {
      table['./' + relative(dirname(file), join(dir, f)).replace(/\\/g, '/').replace(/^\.\//, '')] = readFileSync(join(dir, f), 'utf8');
    }
    const fixed = {};
    for (const [k, v] of Object.entries(table)) fixed[k.replace(/^\.\/(\.\.\/)/, '$1')] = v;
    return JSON.stringify(fixed);
  });
}

/** 打一包，返回路径。`mutate(rel, src)` 在插口子之前改一遍源码（插桩、逻辑变异、拆 guard 都走它）。 */
export async function bundleEndDetect(root, { mutate } = {}) {
  const outdir = mkdtempSync(join(tmpdir(), 'end-detect-'));
  const outfile = join(outdir, 'bundle.mjs');
  const entry = `
    import { createSquareGame } from './src/shapes/square';
    import { createCircleGame } from './src/shapes/circle';
    import { createCircleHexGame } from './src/shapes/circleHex';
    import { createSquareDiamondGame } from './src/shapes/squareDiamond';
    import { createTriangleGame } from './src/shapes/triangle';
    import { createCircleSevenGame } from './src/shapes/circleSeven';
    import { registerCards } from './src/shapes/registry';
    import { ALL_FLIPPED_REASON } from './src/engine/kinetics';
    import { PUZZLE_STEPS_OUT_REASON } from './src/engine/puzzleScore';
    export const games = [
      createSquareGame(), createCircleGame(), createCircleHexGame(),
      createSquareDiamondGame(), createTriangleGame(), createCircleSevenGame(),
    ];
    registerCards(games.map((g) => g.card));
    import { setPro } from './src/engine/proMode';
    import { slideLine } from './src/engine/slideLine';
    import { outerEdges, liveOn, EDGE_MIN, EDGE_MIN_ENDGAME } from './src/engine/outerEdge';
    // 拉杆（推14 Z-B09 D29：收尾那几拍跟着拉杆快慢）：check-endgame-oneby 拿它量 2× / 0.5× 两档。
    import { setFlipStep, FLIP_STEPS, FLIP_DEFAULT_STEP, flipRate } from './src/engine/flipSpeed';
    // 色盲友好配色（check-cascade-order 量淡出替身的纹理）。
    import { setColorblind } from './src/engine/palettePref';
    export { setColorblind };
    export { ALL_FLIPPED_REASON, PUZZLE_STEPS_OUT_REASON, setPro, slideLine, outerEdges, liveOn, EDGE_MIN, EDGE_MIN_ENDGAME, setFlipStep, FLIP_STEPS, FLIP_DEFAULT_STEP, flipRate };
  `;
  const srcDir = join(root, 'src');
  let sawController = false;
  let sawAnalytics = false;
  await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts', sourcefile: 'end-detect-entry.ts' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    logLevel: 'silent',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_GA_ID': '""', 'import.meta.env.MODE': '"production"' },
    plugins: [
      {
        name: 'end-detect',
        setup(b) {
          b.onResolve({ filter: /\?(raw|inline)$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?(raw|inline)$/, '')), namespace: 'ed-text' }));
          b.onLoad({ filter: /.*/, namespace: 'ed-text' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
          b.onLoad({ filter: /\.ts$/ }, (a) => {
            if (!a.path.startsWith(srcDir)) return undefined;
            const rel = relative(root, a.path).replace(/\\/g, '/');
            let src = readFileSync(a.path, 'utf8');
            if (mutate) src = mutate(rel, src);
            const name = rel.replace(/^src\/shapes\//, '').replace(/\.ts$/, '');
            if (rel.startsWith('src/shapes/') && BOARD_FILES.includes(name)) src = tapBoard(rel, name, src);
            else if (rel === 'src/engine/gameController.ts') { src = tapController(rel, src); sawController = true; }
            else if (rel === 'src/engine/analytics.ts') { src = tapAnalytics(rel, src); sawAnalytics = true; }
            else if (rel === 'src/engine/residueBoard.ts') src = tapResidue(rel, src);
            if (/import\.meta\.glob\(/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''))) src = globTable(a.path, src);
            return { contents: src, loader: 'ts' };
          });
        },
      },
    ],
  });
  must('src/engine/gameController.ts', sawController, '（这一包里根本没有打进控制器）');
  must('src/engine/analytics.ts', sawAnalytics, '（这一包里根本没有打进统计层）');
  return outfile;
}

// 打过一局了（教学条、分镜、首玩提示都不出来，量的是结尾判定，不是教学）。
const PLAYED = { slides_lang: 'zhHans', slides_intro_seen: '1' };
for (const k of ['square', 'circle', 'finished', 'bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout']) PLAYED['slides_played_' + k] = '1';

let fakeInstalled = null;

/**
 * 打一包、装假 DOM、接管时钟，交回开局用的 open() 和走时钟的 tick() / settle()。
 * 一个进程里可以 makeSim 好几次（每次一包），假 DOM 和时钟只装一次、之后复用。
 */
export async function makeSim(root, { mutate, motion = true, storage = {} } = {}) {
  const file = await bundleEndDetect(root, { mutate });
  const MOTION = (fakeInstalled ??= { motion }).motion = motion;
  void MOTION;
  if (!fakeInstalled.dom) {
    const media = (q) => {
      const s = q.toLowerCase();
      if (/prefers-reduced-motion/.test(s)) return !fakeInstalled.motion;
      if (/orientation:\s*portrait/.test(s)) return true;
      if (/pointer:\s*coarse|hover:\s*none/.test(s)) return true;
      const maxW = /max-width:\s*(\d+)/.exec(s);
      if (maxW) return 390 <= +maxW[1];
      const minW = /min-width:\s*(\d+)/.exec(s);
      if (minW) return 390 >= +minW[1];
      return false;
    };
    fakeInstalled.dom = installFakeDom({ storage: { ...PLAYED, ...storage }, media });
    globalThis.NodeList ??= class NodeList {};
    globalThis.HTMLCollection ??= class HTMLCollection {};
    const S = 360;
    const proto = Object.getPrototypeOf(document.createElement('div'));
    proto.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: S, bottom: S, width: S, height: S });
    // ── 画布 ──
    const noop = () => {};
    const ctx = new Proxy({}, {
      get: (_, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
        : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop: noop })
        : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) })
        : k === 'canvas' ? null : noop),
      set: () => true,
    });
    const CANVAS = { mode: 'stub' };
    fakeInstalled.CANVAS = CANVAS;
    proto.getContext = function () { return CANVAS.mode === 'null' ? null : ctx; };
    proto.toDataURL = function () {
      if (CANVAS.mode === 'taint') { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; }
      return 'data:image/png;base64,AAAA';
    };
    // ── 虚拟时钟 ──
    const clock = { now: 1, seq: 1, timers: new Map(), frames: [], uncaught: [] };
    fakeInstalled.clock = clock;
    globalThis.setTimeout = (fn, ms = 0, ...args) => { const id = clock.seq++; clock.timers.set(id, { due: clock.now + (Number(ms) || 0), fn, args, id }); return id; };
    globalThis.clearTimeout = (id) => { clock.timers.delete(id); };
    globalThis.setInterval = (fn, ms = 0, ...args) => { const id = clock.seq++; clock.timers.set(id, { due: clock.now + (Number(ms) || 1), fn, args, id, every: Number(ms) || 1 }); return id; };
    globalThis.clearInterval = (id) => { clock.timers.delete(id); };
    for (const k of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']) if (globalThis.window && globalThis.window !== globalThis) globalThis.window[k] = globalThis[k];
    globalThis.requestAnimationFrame = (fn) => { clock.frames.push(fn); return clock.frames.length; };
    globalThis.cancelAnimationFrame = () => {};
    Object.defineProperty(globalThis, 'performance', { value: { now: () => clock.now, mark() {}, measure() {}, getEntriesByName: () => [], timeOrigin: 0 }, configurable: true, writable: true });
    // ── console.error 收起来（[slides:end-guard] 那一行门要数）──
    fakeInstalled.logs = [];
    fakeInstalled.origErr = console.error;
    console.error = (...a) => { fakeInstalled.logs.push(a.map(String).join(' ')); };
  }
  const { clock, CANVAS, logs } = fakeInstalled;
  function runDue() {
    for (;;) {
      let next = null;
      for (const t of clock.timers.values()) if (t.due <= clock.now && (!next || t.due < next.due || (t.due === next.due && t.id < next.id))) next = t;
      if (!next) break;
      if (next.every) next.due += next.every; else clock.timers.delete(next.id);
      try { next.fn(...next.args); } catch (e) { clock.uncaught.push(e); }
    }
  }
  function flushFrames() { const f = clock.frames; clock.frames = []; for (const fn of f) if (fn) try { fn(clock.now); } catch (e) { clock.uncaught.push(e); } }
  /** 虚拟时间往前走 ms 毫秒（10ms 一格），途中跑到点的定时器和动画帧。 */
  function tick(ms) { const end = clock.now + ms; while (clock.now < end) { clock.now += 10; runDue(); flushFrames(); } }
  /** 把一次性定时器全跑完（最多 maxMs 虚拟时间），interval 照走。 */
  function settle(maxMs = 60000) {
    const end = clock.now + maxMs;
    while (clock.now < end) {
      clock.now += 10; runDue(); flushFrames();
      if (![...clock.timers.values()].some((t) => !t.every)) { clock.now += 300; runDue(); return; }
    }
  }

  // ── 故障开关：包里插的桩都调 globalThis.__F(名字)；armFault 让它在第 n 次命中时抛 ──
  const FAULT = { name: null, left: 0, hits: 0, when: null };
  globalThis.__F = (n) => {
    if (FAULT.name !== n || FAULT.left <= 0) return;
    if (FAULT.when && !FAULT.when()) return;
    FAULT.left--;
    FAULT.hits++;
    throw new Error('FAULT:' + n);
  };

  const SIM = {
    boards: [], ctl: null, hooks: null, ends: [], guards: [],
    board(b) { this.boards.push(b); },
    controller(refs, hooks, ctl) { this.ctl = ctl; this.hooks = hooks; this.refs = refs; },
    ended(reason, info) { this.ends.push({ reason, at: clock.now, ...info }); },
    erosion(e) { this.ero = e; },
    endGuard(kind, mode) { this.guards.push({ kind, mode }); },
  };
  globalThis.__SIM = SIM;
  const B = await import(pathToFileURL(file).href);
  rmSync(dirname(file), { recursive: true, force: true });
  // 下一次 makeSim 会把 __SIM 换掉；这一包里的口子认的是 globalThis.__SIM，所以 open() 时重新挂回来。
  function open(id, opts) {
    globalThis.__SIM = SIM;
    fakeInstalled.motion = motion;
    const game = B.games.find((g) => g.card.id === id);
    if (!game) throw new Error('没有这副棋盘 ' + id);
    const host = document.createElement('div');
    document.body.appendChild(host);
    SIM.boards = []; SIM.ctl = null; SIM.ends = []; SIM.guards = [];
    clock.uncaught.length = 0; logs.length = 0;
    FAULT.name = null; FAULT.left = 0; FAULT.hits = 0; FAULT.when = null;
    const destroy = game.mount(host, () => {}, { lang: 'zhHans', noCountdown: true, ...opts });
    for (let i = 0; i < 5; i++) { flushFrames(); runDue(); }
    const tap = SIM.boards[SIM.boards.length - 1];
    const bestKey = SIM.hooks.bestKey;
    return {
      tap, ctl: SIM.ctl, hooks: SIM.hooks, refs: SIM.refs, ero: SIM.ero, ends: SIM.ends, guards: SIM.guards, bestKey,
      shown: () => SIM.refs.endOverlay.classList.contains('show'),
      saved: () => { try { const raw = localStorage.getItem(bestKey + '::runs'); return raw ? JSON.parse(raw).filter((r) => r && typeof r === 'object').length : 0; } catch { return -1; } },
      close() {
        try { destroy(); } catch { /* 假 DOM 拆不干净不要紧 */ }
        host.remove();
        clock.timers.clear(); clock.frames = [];
      },
    };
  }
  function armFault(name, { times = 1, when = null } = {}) { FAULT.name = name; FAULT.left = times; FAULT.hits = 0; FAULT.when = when; }
  return {
    B, SIM, open, tick, settle, armFault, FAULT, CANVAS,
    get uncaught() { return clock.uncaught; },
    get logs() { return logs; },
    get now() { return clock.now; },
    restoreConsole() { if (fakeInstalled.origErr) console.error = fakeInstalled.origErr; },
  };
}

let seqT = 100000;
export const tile = (color, dotColor, face = 'flavor') => ({ id: seqT++, color, face, dotColor });
export const star = (dotColor, color = (dotColor + 1) % 3) => tile(color, dotColor, 'dot');
export const BLANK_TILE = () => ({ id: seqT++, color: -1, face: 'dot', dotColor: -1 });
