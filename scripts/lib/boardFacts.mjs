/**
 * 从源码当场推出 api/_maxscore.js 那几张手抄表该是多少（10-11 方案 A-3）。
 *
 *   import { deriveFacts } from './lib/boardFacts.mjs';
 *   const facts = await deriveFacts();
 *   facts.boards.square   // { N, d, Lmax, par, lines }
 *   facts.slotP.square    // 老虎机：「经过某一格的不同摆法数 × ⌈k²/2⌉」的最大值
 *   facts.flipStep.circle // 无限反转：一步之内各拍原始分之和、拍数的上界
 *   facts.consts          // MODE_SECONDS、连击封顶、每枚几分……
 *
 * api/ 是纯 .js，import 不进 src 里的 ts，所以服务器那几张表只能手抄；手抄的东西没人对就会悄悄走样
 * ——改了棋盘、阶梯、计分，服务器还拿旧尺子量，真玩家打出来的分就被当成「打不出来」拒掉。门
 * （scripts/check-scores-guard.mjs）拿这儿推出来的数逐项对一遍。
 *
 * ── 几样数从哪儿来 ───────────────────────────────────────────────────────
 *
 *   · N（全盘几枚）：棋盘文件里 `boardTiles:` 那个式子（客户端的 hooks.boardTiles 就是它）。
 *   · 线：外边族五副是各自文件里的 `LINES`；方块是 `BOARD_DIM` 行加 `BOARD_DIM` 列
 *     （engine/residueBoard.ts 的 gridLines，方块那一副自己也是这么交出它的线的）。
 *   · d（一枚最多同时在几条线上）、Lmax（一条线上最多几枚活格）：照线数出来。六边圆球中心那个永久
 *     空位（`CENTER_CELL`）在线上占一格，可它不是棋子——不算进 Lmax。
 *   · par：engine/erosion.ts 的 EROSION_TABLE。
 *   · 老虎机的 P：engine/targetMatch.ts 的 erodedShapes + orientationsOf + findTargetAt，在真棋盘的格子
 *     上把每一级、每一个子形、每一种摆法都摆一遍，数「经过同一格的不同摆法」最多几种。
 *   · 无限反转一步的上界：照线数「每条线上每一段 ≥ 4 枚的连续段」（图案冻结在 1×4：engine/erosion.ts
 *     给 frozen 就永不降级——这里真的扣一千段看它降不降），一组的分是它的枚数（groupScore.ts 的
 *     groupPoints，不低于 MIN_GROUP_POINTS），同一组一步最多给 TOGGLE_SCORES_PER_GROUP 次分。
 *
 * ── 为什么不整份 import 棋盘文件 ────────────────────────────────────────────
 *
 * 棋盘文件挂着界面、动画、Vite 专有的 `import.meta.glob`，在 node 里整份跑不起来。所以只取**几何那
 * 一小段**：用 TypeScript 的语法树找出 `LINES`、`boardTiles:` 那个式子、`BOARD_DIM`、`CENTER_CELL`，
 * 连同它们引用到的顶层常量和函数（传递闭包），原样拼成一个小模块跑一遍。几何那一段哪天引用了 import
 * 进来的东西，这里当场抛错、写明是哪一个——不猜，也不悄悄给一个默认值。
 *
 * 棋盘的 id 也从文件里读（`card: { id: … }`），不认文件名：`shapes/triangle.ts` 里画的是 triangleBig
 * （CLAUDE.md「两个陷阱」那一条）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHAPES_DIR = ROOT + 'src/shapes/';

/** 打一份 engine 那几个纯模块的包，import 进来。 */
async function loadEngine() {
  const entry = `
    export { EROSION_TABLE, createErosion } from './src/engine/erosion';
    export { MODE_SECONDS } from './src/engine/modeClock';
    export { FLIP_STREAK_BASE, FLIP_STREAK_CAP, POINTS_PER_FLIP, TOGGLE_SCORES_PER_GROUP } from './src/engine/scoring';
    export { MIN_GROUP_POINTS } from './src/engine/groupScore';
    export { BOMB_HAZARD_PENALTY } from './src/engine/bomb';
    export { PUZZLE_CLEARED_POINTS, PUZZLE_STAR_POINTS, PUZZLE_START_STEPS } from './src/engine/puzzleScore';
    export { stepCoefFor } from './src/engine/stepCoef';
    export { erodedShapes, orientationsOf, findTargetAt } from './src/engine/targetMatch';
    export { targetsOf, sizeAtLevel, scoreForSize } from './src/engine/targets';
    export { gridLines } from './src/engine/residueBoard';
    export { VARIANTS } from './src/engine/seedCode';
  `;
  const out = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'error',
  });
  return importText(out.outputFiles[0].text);
}

const importText = (code) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

/**
 * 一副棋盘文件里几何那一段：`{ id, tiles, lines, center }`。
 * lines 是 `[r, c][]` 的数组；方块那一副没有 `LINES`，回 null，由调用方按 `dim` 拼行列。
 */
async function shapeGeometry(path) {
  const src = readFileSync(path, 'utf8');
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const decls = new Map();
  /** import 进来的名字 → 那一句 import 该怎么写（只认具名导入；默认导入、整包导入用到了就抛）。 */
  const imported = new Map();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const nb = st.importClause?.namedBindings;
      if (st.importClause?.isTypeOnly) continue;
      const from = st.moduleSpecifier.text;
      if (st.importClause?.name) imported.set(st.importClause.name.text, null);
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (el.isTypeOnly) continue;
          imported.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
        }
      }
      if (nb && ts.isNamespaceImport(nb)) imported.set(nb.name.text, null);
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      decls.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) decls.set(d.name.text, st);
    }
  }

  // 一段语法树里引用到的名字。类型那一层不算（esbuild 会把它们整个擦掉）；`a.b` 的 b、`{ b: … }` 的 b
  // 不是引用。
  const refsOf = (node) => {
    const out = new Set();
    const walk = (n) => {
      if (ts.isTypeNode(n)) return;
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isMemberName = p && ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n));
        if (!isMemberName) out.add(n.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return out;
  };

  // `card: { id: '…' }` 和 `boardTiles: <式子>`。
  let id = null;
  let tilesExpr = null;
  const find = (n) => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) {
      if (n.name.text === 'card' && ts.isObjectLiteralExpression(n.initializer) && id === null) {
        for (const p of n.initializer.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'id' && ts.isStringLiteral(p.initializer)) id = p.initializer.text;
        }
      }
      if (n.name.text === 'boardTiles' && tilesExpr === null) tilesExpr = n.initializer;
    }
    ts.forEachChild(n, find);
  };
  find(sf);
  if (!id) throw new Error(`boardFacts：${path} 里找不到 card.id`);
  if (!tilesExpr) throw new Error(`boardFacts：${path} 里找不到 boardTiles`);

  const wanted = ['LINES', 'BOARD_DIM', 'CENTER_CELL'].filter((n) => decls.has(n));
  const need = new Set();
  const imports = new Map();
  const queue = [...wanted, ...refsOf(tilesExpr)];
  while (queue.length) {
    const name = queue.pop();
    if (need.has(name) || imports.has(name)) continue;
    if (!decls.has(name)) {
      if (imported.has(name)) {
        // 几何那一段用到的 import 一并带上（三角那一副的 assignOffsets 就是）。被带进来的模块得是纯的——
        // 挂着界面的那种在 node 里跑不起来，下面 import 那一步会当场抛，不会悄悄给一个默认值。
        const spec = imported.get(name);
        if (!spec) throw new Error(`boardFacts：${id} 的几何那一段用到了默认导入或整包导入的 ${name}——推不出来，门得跟着改`);
        imports.set(name, spec);
      }
      continue; // 局部变量、参数、全局（Math、Array……）
    }
    need.add(name);
    for (const r of refsOf(decls.get(name))) if (!need.has(r)) queue.push(r);
  }
  const head = [...imports].map(([alias, { from, name }]) => `import { ${name} as ${alias} } from ${JSON.stringify(from)};`);
  const body = sf.statements.filter((st) => [...need].some((n) => decls.get(n) === st)).map((st) => st.getText(sf));
  const exportsOf = wanted.map((n) => `${n}: ${n}`).join(', ');
  const code = `${head.join('\n')}\n${body.join('\n')}\nexport const __geo = { tiles: (${tilesExpr.getText(sf)}), ${exportsOf} };\n`;
  const out = await build({
    stdin: { contents: code, resolveDir: SHAPES_DIR, loader: 'ts', sourcefile: `${id}-geometry.ts` },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'error',
  });
  const { __geo } = await importText(out.outputFiles[0].text);
  const lines = __geo.LINES ? __geo.LINES.map((l) => (Array.isArray(l) ? l : l.cells).map(([r, c]) => [r, c])) : null;
  return { id, tiles: __geo.tiles, lines, dim: __geo.BOARD_DIM ?? null, center: __geo.CENTER_CELL ?? null, rawLines: __geo.LINES ?? null };
}

/**
 * 一副棋盘文件里的 `LINES` 原样（外边族那几副是 EdgeLine：带族名和法向偏移，outerEdges 要用）。check-endgame-residue
 * 拿它在 node 里摆一副真棋盘的残局（10-15 补充 L-7）。方块那一副没有 LINES，回 null。
 */
export async function shapeEdgeLines(file) {
  return (await shapeGeometry(SHAPES_DIR + file)).rawLines;
}

const key = (r, c) => `${r},${c}`;

/** 一副棋盘的 N、d、Lmax，连同它的线和格子（洞不在格子里）。 */
function geometryFacts(geo, engine) {
  const lines = geo.lines ?? (geo.dim ? engine.gridLines(geo.dim, geo.dim) : null);
  if (!lines) throw new Error(`boardFacts：${geo.id} 既没有 LINES 也没有 BOARD_DIM`);
  const all = new Set(lines.flat().map(([r, c]) => key(r, c)));
  const holes = new Set(geo.center && all.has(key(...geo.center)) ? [key(...geo.center)] : []);
  const cells = [...all].filter((k) => !holes.has(k));
  if (cells.length !== geo.tiles) {
    throw new Error(`boardFacts：${geo.id} 线上的格子去掉洞是 ${cells.length} 枚，boardTiles 却是 ${geo.tiles}——认不出哪几格是洞`);
  }
  const through = new Map(cells.map((k) => [k, 0]));
  let Lmax = 0;
  for (const line of lines) {
    const live = line.filter(([r, c]) => !holes.has(key(r, c)));
    Lmax = Math.max(Lmax, live.length);
    for (const [r, c] of live) through.set(key(r, c), through.get(key(r, c)) + 1);
  }
  return { N: geo.tiles, d: Math.max(...through.values()), Lmax, lines, cells, holes };
}

/** 老虎机的 P：这一族每个目标、每一级，在这副棋盘上「经过同一格的不同摆法数 × 那一级一次拼成的分」的最大值。 */
function slotP(family, g, engine) {
  const on = new Set(g.cells);
  const anchors = g.cells.map((k) => k.split(',').map(Number));
  const face = { face: 'flavor', color: 0, dotColor: 0 };
  const view = { has: (r, c) => on.has(key(r, c)), tileAt: (r, c) => (on.has(key(r, c)) ? face : null), cells: () => anchors };
  let best = 0;
  for (const target of engine.targetsOf(family)) {
    for (let level = 1; level <= 4; level++) {
      const k = engine.sizeAtLevel(target, level);
      const seen = new Set();
      const through = new Map();
      for (const shape of engine.erodedShapes(target, k)) {
        for (const o of engine.orientationsOf(shape)) {
          for (const a of anchors) {
            const hit = engine.findTargetAt(view, o, a);
            if (!hit) continue;
            const id = hit.map(([r, c]) => key(r, c)).sort().join(' ');
            if (seen.has(id)) continue;
            seen.add(id);
            for (const [r, c] of hit) through.set(key(r, c), (through.get(key(r, c)) || 0) + 1);
          }
        }
      }
      best = Math.max(best, Math.max(0, ...through.values()) * engine.scoreForSize(k));
    }
  }
  return best;
}

/** 无限反转一步：每条线上每一段 ≥ minLen 枚的连续段，raw = 次数 × Σ 段的分，beats = 次数 × 段数。 */
function flipStep(g, minLen, engine) {
  let raw = 0;
  let segs = 0;
  for (const line of g.lines) {
    const L = line.filter(([r, c]) => !g.holes.has(key(r, c))).length;
    for (let len = minLen; len <= L; len++) {
      const count = L - len + 1;
      segs += count;
      raw += count * Math.max(engine.MIN_GROUP_POINTS, len);
    }
  }
  return { raw: engine.TOGGLE_SCORES_PER_GROUP * raw, beats: engine.TOGGLE_SCORES_PER_GROUP * segs };
}

export async function deriveFacts() {
  const engine = await loadEngine();
  const boards = {};
  const files = readdirSync(SHAPES_DIR).filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'registry.ts');
  for (const f of files) {
    const geo = await shapeGeometry(SHAPES_DIR + f);
    const g = geometryFacts(geo, engine);
    const table = engine.EROSION_TABLE[geo.id];
    if (!table) throw new Error(`boardFacts：engine/erosion.ts 的 EROSION_TABLE 里没有 ${geo.id}`);
    boards[geo.id] = { ...g, par: table.par, file: f };
  }

  // 无限反转的图案冻结在开局那一级（1×4）：真的扣一千段，看它降不降。
  const ero = engine.createErosion(engine.EROSION_TABLE.square, true);
  ero.spend(1000);
  const flipFrozenAt = ero.level();

  // 哪几副棋盘有老虎机、无限反转：照客户端的编号表（engine/seedCode.ts 的 VARIANTS）。
  const familyOf = { square: 'square', circle: 'circle' };
  const slotBoards = [...new Set(engine.VARIANTS.filter((v) => v.mode === 'slot').map((v) => v.board))];
  const flipBoards = [...new Set(engine.VARIANTS.filter((v) => v.mode === 'flip').map((v) => v.board))];
  const P = {};
  for (const b of slotBoards) {
    if (!familyOf[b]) throw new Error(`boardFacts：老虎机开在了 ${b} 上，这里不知道它是哪一族`);
    P[b] = slotP(familyOf[b], boards[b], engine);
  }
  const F = {};
  for (const b of flipBoards) F[b] = flipStep(boards[b], flipFrozenAt, engine);

  return {
    boards,
    slotP: P,
    flipStep: F,
    consts: {
      MODE_SECONDS: engine.MODE_SECONDS,
      FLIP_MULT_CAP: engine.FLIP_STREAK_BASE ** engine.FLIP_STREAK_CAP,
      POINTS_PER_FLIP: engine.POINTS_PER_FLIP,
      BOMB_HAZARD_PENALTY: engine.BOMB_HAZARD_PENALTY,
      PUZZLE_CLEARED_POINTS: engine.PUZZLE_CLEARED_POINTS,
      PUZZLE_STAR_POINTS: engine.PUZZLE_STAR_POINTS,
      PUZZLE_START_STEPS: engine.PUZZLE_START_STEPS,
      flipFrozenAt,
    },
    stepCoefFor: engine.stepCoefFor,
  };
}
