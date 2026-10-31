/**
 * check-puzzle-end 的那一包和夹具（10-31 方案推02 Z-A02；草稿是方案附带的 sim-puzzle/bundle.mjs ＋ harness.mjs，合成这一份）。
 *
 * 和 scripts/lib/endDetectBundle.mjs 分开两份、不合并（方案原话）：那一份接管时钟、插故障桩，量「装饰抛错照常结算」；
 * 这一份用 fakeDom 自己的定时器（pump 一把跑完），量「清盘必结算、走不动必结算」，两份各改各的不互相牵连。
 *
 * 写法照 scripts/lib/seedGoldenBundle.mjs：esbuild 把 `src` 打成一包，**只在这一包里**插只读口子，源码和产物一字不动：
 *   · 六个棋盘文件：`let grid: Tile[][] = [];` 后面露出 grid 的读写、isBlank（方块另露 rows/cols）；
 *   · engine/gameController.ts：createGameController 外面包一层，记下 refs、hooks 和返回的 controller；
 *     endGame 一进门报一声理由（外层那一个：它是幂等的门，叫两次就记两次——门要的是「恰好一次」）；侵蚀阶梯露出来。
 * **认不出插口子的那几句就当场 throw「门要跟着改」**，不静默跳过。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { installFakeDom } from './fakeDom.mjs';

export const BOARD_FILES = ['square', 'circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle'];

const must = (file, ok, what) => {
  if (!ok) throw new Error(`门要跟着改：${file} 里认不出「${what}」（check-puzzle-end 只在自己那一包里插口子，见 scripts/lib/puzzleEndBundle.mjs）`);
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
  const eg = 'function endGame(reason: string, extraPenalty = 0, extraPenaltyLabel = s.defaultPenaltyLabel) {';
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

/** 打一包，返回路径。`mutate(rel, src)` 在插口子之前改一遍源码（门自己的变异、⑥ 的两种故意改坏都走它）。 */
export async function bundlePuzzleEnd(root, { mutate } = {}) {
  const outdir = mkdtempSync(join(tmpdir(), 'puzzle-end-'));
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
    export { ALL_FLIPPED_REASON, PUZZLE_STEPS_OUT_REASON, setPro, slideLine, outerEdges, liveOn, EDGE_MIN, EDGE_MIN_ENDGAME };
  `;
  const srcDir = join(root, 'src');
  let sawController = false;
  await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts', sourcefile: 'puzzle-end-entry.ts' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    logLevel: 'silent',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_GA_ID': '""', 'import.meta.env.MODE': '"production"' },
    plugins: [
      {
        name: 'puzzle-end',
        setup(b) {
          b.onResolve({ filter: /\?(raw|inline)$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?(raw|inline)$/, '')), namespace: 'pe-text' }));
          b.onLoad({ filter: /.*/, namespace: 'pe-text' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
          b.onLoad({ filter: /\.ts$/ }, (a) => {
            if (!a.path.startsWith(srcDir)) return undefined;
            const rel = relative(root, a.path).replace(/\\/g, '/');
            let src = readFileSync(a.path, 'utf8');
            if (mutate) src = mutate(rel, src);
            const name = rel.replace(/^src\/shapes\//, '').replace(/\.ts$/, '');
            if (rel.startsWith('src/shapes/') && BOARD_FILES.includes(name)) src = tapBoard(rel, name, src);
            else if (rel === 'src/engine/gameController.ts') { src = tapController(rel, src); sawController = true; }
            if (/import\.meta\.glob\(/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''))) src = globTable(a.path, src);
            return { contents: src, loader: 'ts' };
          });
        },
      },
    ],
  });
  must('src/engine/gameController.ts', sawController, '（这一包里根本没有打进控制器）');
  return outfile;
}

const PLAYED = { slides_lang: 'zhHans', slides_intro_seen: '1' };
for (const k of ['square', 'circle', 'finished', 'bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout']) PLAYED['slides_played_' + k] = '1';

let installed = null;

/**
 * 装假 DOM、打一包、交回 open() / pump()。`motion=true`：「减弱动态效果」答假（真玩家多半是这样），高亮 550ms、
 * 整线 1250ms 那几拍都真的排上。一个进程里 makeSim 好几次时假 DOM 只装一次（动态效果开关照这一次的）。
 */
export async function makeSim(root, { mutate, motion = false, storage = {} } = {}) {
  const file = await bundlePuzzleEnd(root, { mutate });
  if (!installed) {
    installed = { motion };
    const media = (q) => {
      const s = q.toLowerCase();
      if (/prefers-reduced-motion/.test(s)) return !installed.motion;
      if (/orientation:\s*portrait/.test(s)) return true;
      if (/pointer:\s*coarse|hover:\s*none/.test(s)) return true;
      const maxW = /max-width:\s*(\d+)/.exec(s);
      if (maxW) return 390 <= +maxW[1];
      const minW = /min-width:\s*(\d+)/.exec(s);
      if (minW) return 390 >= +minW[1];
      return false;
    };
    installed.dom = installFakeDom({ storage: { ...PLAYED, ...storage }, media });
    // 假 DOM 的 canvas.getContext 回 null；补一个什么都不画的 2d 上下文，免得结算页那张图抛错把输出弄乱（和「进没进结算」无关）。
    const proto = Object.getPrototypeOf(document.createElement('canvas'));
    const noop = () => {};
    const ctx = new Proxy({}, {
      get: (_, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
        : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop: noop })
        : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) })
        : k === 'canvas' ? null : noop),
      set: () => true,
    });
    proto.getContext = () => ctx;
  }
  const dom = installed.dom;
  const SIM = {
    boards: [], ctl: null, hooks: null, ends: [], errors: [],
    board(b) { this.boards.push(b); },
    controller(refs, hooks, ctl) { this.ctl = ctl; this.hooks = hooks; this.refs = refs; },
    ended(reason, info) { this.ends.push({ reason, ...info }); },
    erosion(e) { this.ero = e; },
  };
  globalThis.__SIM = SIM;
  const B = await import(pathToFileURL(file).href);
  rmSync(dirname(file), { recursive: true, force: true });

  /** 跑掉排着的定时器和动画帧，直到队列空了或者跑够 n 轮。定时器里抛的错记下来、不中断。 */
  function pump(rounds = 400) {
    for (let i = 0; i < rounds; i++) {
      const before = dom.pendingTimers();
      try { dom.runTimers(1e9); } catch (e) { SIM.errors.push(e); }
      try { dom.flushFrames(1); } catch (e) { SIM.errors.push(e); }
      if (!before && !dom.pendingTimers()) break;
    }
  }

  function open(id, opts) {
    globalThis.__SIM = SIM;
    installed.motion = motion;
    const game = B.games.find((g) => g.card.id === id);
    if (!game) throw new Error('没有这副棋盘 ' + id);
    const host = document.createElement('div');
    document.body.appendChild(host);
    SIM.boards = []; SIM.ctl = null; SIM.ends = []; SIM.errors = [];
    const destroy = game.mount(host, () => {}, { lang: 'zhHans', noCountdown: true, ...opts });
    dom.flushFrames(1);
    const tap = SIM.boards[SIM.boards.length - 1];
    return {
      tap, ctl: SIM.ctl, hooks: SIM.hooks, refs: SIM.refs, ero: SIM.ero, ends: SIM.ends, errors: SIM.errors,
      close() {
        try { destroy(); } catch { /* 假 DOM 拆不干净不要紧 */ }
        host.remove();
        dom.dropPending();
      },
    };
  }
  return { B, dom, SIM, pump, open };
}

let seq = 100000;
/** 造一枚棋子（和棋盘 newTile 同形：{ id, color, face, dotColor }）。 */
export const tile = (color, dotColor, face = 'flavor') => ({ id: seq++, color, face, dotColor });
export const star = (dotColor, color = (dotColor + 1) % 3) => tile(color, dotColor, 'dot');
export const BLANK_TILE = () => ({ id: seq++, color: -1, face: 'dot', dotColor: -1 });
