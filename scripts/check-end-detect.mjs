/**
 * 结尾：任何装饰抛错都照常结算（10-31 方案推01 Z-A01；草稿是方案附带的 sim-enddet/inject、run-faults、mut、equiv 四份）。
 *
 *   node scripts/check-end-detect.mjs             # CI check 那一条跑的就是这一句（纯 node）
 *   node scripts/check-end-detect.mjs --mutants   # 门自己的验证：拆掉兜底的三处，各自那一节得红
 *   ONLY=名字 / VERBOSE=1 / SECTION=④              # 只跑一个故障点 / 每一格都印 / 只跑一节
 *
 * 为什么要有这一道：站长 10-21 报「全部消完了仍然没有触发自动结算」。故障注入复现了三种挂法——最后一拍和
 * finish() 之间任何一个装饰钩子抛错，resolving 永远是真、之后每一下触摸都被拒（形态 R）；endGame 置了 gameOver
 * 之后、结算页露面之前抛错，结算页不出、不存档、暂停键不理（形态 L）；露面之后、存档之前抛错（形态 S）。真浏览器
 * 里是哪一句抛的查不到，所以改法不靠找到根因（gameController.ts 的 guardFn / guardHooks / runBeat / watch /
 * endGame 的 finally），而这一道量「随便哪一处装饰抛错，都照常结算」：
 *
 *   ① 故障矩阵：43 个故障点 × 3 种最后一手（sqRow 方块整行、ciEdge 小球削底边、ciMatch 小球先翻再削）× 5 种玩法
 *      × 动态效果开 / 关。每一格（这一手根本走不到那个点的除外）都必须**当场**露出结算页、存进本机、理由和时刻
 *      都和不出错时一样（动态效果开时 snapFlipFaces × ciMatch 那几格翻面那一拍被跳过，允许早到约 170ms）；
 *      `end.logicBeforeRun`（endGame 记账逻辑本身抛错）那一格露出最低限度的结算页就算过。endGame 只结算一次。
 *      注入故障的格子里，end_guard 统计每个标签最多报一次、kind 只是标签（不带错误原文）、mode 是这一局的玩法。
 *   ② 逻辑变异（不靠抛错、靠「逻辑漏了」造出来的挂法）：M1 finish 不问 isGameOver、M2 最后一拍不进 finish、
 *      M3 判死后 1.4 秒那个定时器被撤掉——各自 3 秒内结算（守望 watch 兜住）。
 *   ③ 等价：随机残局 600 局、随机走子（中途碰一下、暂停再继续），不注入故障时逐局结局 / 分数 / 步数 / 结算页 /
 *      存档都和「去掉兜底的同一包」相同；兜底一次都没出声（没有 [slides:end-guard]、没有 end_guard）。
 *   ④ 判死夹具（10-31 方案推02 Z-A02）：六边三角门槛 3、12 / 13 / 14 颗全是星星的残局（穷举在 20000 个盘面内走不完，
 *      推02 之前永远不结束）→ 3 秒内「无法继续匹配」；10-19 复现 7（小球 1×2、收尾放开后只剩三枚互不同线、一手都
 *      滑不了）→ 同上；方块 1×N 只剩活炸弹 → 「全部消完了」（判死层不许抢在清盘判定前面）。基础、步步为营各一遍。
 *   ⑤ 轨道层的尺子：六副棋盘的随机残局，轨道计数层说死、而且 ≤12 枚（穷举走得完）时，同一副照常穷举一遍——
 *      穷举说「还能得分」就是反例，一例就红。
 *
 * 红了：红在哪一格、报什么，照 10-31 方案〇·四第 3 条停下回报，不要改这里的期望去迁就。
 * 认不出插桩的锚点（源码改写了那一句）→「门要跟着改」：改这里的 POINTS / 变异 / 拆兜底那几句的锚点，期望不动。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSim, star, tile, BLANK_TILE } from './lib/endDetectBundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = process.argv.includes('--mutants');
const ONLY = process.env.ONLY;
const VERBOSE = process.env.VERBOSE === '1';
const GC = 'src/engine/gameController.ts';

const failures = [];
const fail = (msg) => { failures.push(msg); };

// ─────────────────────────── 插桩 ───────────────────────────
// 故障都插在「被叫的那一方」体内（棋盘钩子、装饰模块、控制器里装饰函数的本体 xxx0），guard 包在调用处——
// 和真出错时一样。锚点必须恰好出现一次，否则当场 throw（不静默漏插）。
const F = (n) => `(globalThis as any).__F?.('${n}');`;
export const POINTS = [
  // ── 控制器里的装饰函数（本体）──
  [GC, '  function bigMoment(originCell: Cell | undefined): void {\n    // 装饰件：抛错只记一笔，不拦连锁（10-31 方案推01 Z-A01 ②）。原地包一层，不改名——check-erosion 按名字切这一段。\n    try {\n', 'ctl.bigMoment', 'after'],
  [GC, '  const syncProWheel0 = () => {\n', 'ctl.syncProWheel', 'after'],
  [GC, '  function paintSteps0(left: number) {\n', 'ctl.paintSteps', 'after'],
  [GC, '  function bumpSteps0(scored: boolean) {\n', 'ctl.bumpSteps', 'after'],
  [GC, '  function stampEndCheck0(reason: string, total: number): void {\n', 'end.stamp', 'after'],
  // ── 控制器自己的逻辑（不是装饰）：模拟「控制器代码本身有 bug」，量兜底，不量 guard ──
  [GC, '      if (!totalRaw) hooks.render();\n      syncProWheel();\n      if (!totalRaw) flipChain = 0;\n', 'ctl.finishLogic', 'before'],
  [GC, '    const statusPercent = perf.valuePercent();\n', 'end.logicBeforeRun', 'before'],
  // ── 声音、手感 ──
  ['src/engine/juice.ts', 'function cue(name: Parameters<typeof play>[0], volume: number): void {\n  if (!sound) return;\n', 'juice.cue', 'after'],
  ['src/engine/juice.ts', 'export function playSettle(): void {\n', 'juice.playSettle', 'after'],
  ['src/engine/juice.ts', 'export function screenShake(el: HTMLElement, tier: ShakeTier): void {\n', 'juice.screenShake', 'after'],
  ['src/engine/juice.ts', 'export function spawnParticles(container: HTMLElement, x: number, y: number, opts: ParticleOpts): void {\n', 'juice.spawnParticles', 'after'],
  ['src/engine/juice.ts', 'export function punch(el: HTMLElement): void {\n', 'juice.punch', 'after'],
  ['src/engine/haptics.ts', '    navigator.vibrate?.(pattern);\n', 'haptics.vibrate', 'before'],
  // ── 翻面、分数滚筒、图案块 ──
  ['src/engine/plankFlip.ts', 'export function snapFlipFaces(boardEl: HTMLElement, cells: readonly (readonly [number, number])[]): Map<string, HTMLElement> {\n', 'plank.snap', 'after'],
  ['src/engine/scoreReel.ts', '  function showGain(amount: number, source?: string) {\n', 'reel.showGain', 'after'],
  ['src/ui/patternBlock.ts', '  function update(view: ErosionView): void {\n', 'pattern.update', 'after'],
  // ── 放大、取景 ──
  ['src/ui/boardZoom.ts', '    play(fit) {\n', 'zoom.play', 'after'],
  ['src/engine/liveFit.ts', 'export function fitLive(input: FitInput): Fit {\n', 'liveFit.fit', 'after'],
  // ── 教学条、Pro 轮盘 ──
  ['src/ui/coachBar.ts', '    signal(sig, count = 1) {\n', 'coach.signal', 'after'],
  ['src/ui/coachBar.ts', '    observe(view) {\n', 'coach.observe', 'after'],
  ['src/ui/proWheel.ts', '    sync(v) {\n', 'proWheel.sync', 'after'],
  // ── 结算页的内容 ──
  ['src/engine/runRecord.ts', 'export function runBreakdown(d: RunData, lang: Lang): [label: string, value: string][] {\n', 'record.breakdown', 'after'],
  ['src/engine/runRecord.ts', 'export function runBadges(d: RunData, lang: Lang): string[] {\n', 'record.badges', 'after'],
  ['src/engine/odometer.ts', 'export function rollOdometer(host: HTMLElement, value: number, display?: string): void {\n', 'odometer.roll', 'after'],
  ['src/engine/shareCard.ts', 'export function renderShareCard(\n', 'share.render', 'fnbody'],
  ['src/ui/roomLeftover.ts', 'export function mountRoomLeftover(host: HTMLElement | null, lang: Lang): void {\n', 'end.roomLeftover', 'after'],
  // ── 棋盘自己的钩子（方块、小球）──
  ['src/shapes/square.ts', '      function render() {\n', 'square.render', 'after'],
  ['src/shapes/square.ts', '        onCascadeStep: ({ matchGroups, lineBonusGroups }) => {\n', 'square.onCascadeStep', 'after'],
  ['src/shapes/square.ts', '        onCascadeStepRendered: ({ lineBonusGroups }) => {\n', 'square.onCascadeStepRendered', 'after'],
  ['src/shapes/square.ts', '      function countRemainingTiles() {\n', 'square.countRemaining', 'after'],
  ['src/shapes/square.ts', '      function snapshotBoard(): BoardSnapshot {\n', 'square.snapshot', 'after'],
  ['src/shapes/circle.ts', '      function render() {\n', 'circle.render', 'after'],
  ['src/shapes/circle.ts', '        onCascadeStep: ({ matchGroups }) => {\n', 'circle.onCascadeStep', 'after'],
  ['src/shapes/circle.ts', '        onCascadeStepRendered: ({ lineBonusGroups, matchGroups }) => {\n', 'circle.onCascadeStepRendered', 'after'],
  ['src/shapes/circle.ts', '      function countRemainingTiles() {\n', 'circle.countRemaining', 'after'],
  ['src/shapes/circle.ts', '      function snapshotBoard(): BoardSnapshot {\n', 'circle.snapshot', 'after'],
  ['src/shapes/circle.ts', '        coachGlow: (kind) => glow.request(kind),\n', 'circle.coachGlow', 'glowarrow'],
  // ── 炸弹四连收场 ──
  ['src/engine/bomb.ts', '  if (!hasRedCluster(g, adj, isLive)) return false;\n  try { end.render(); } catch { /* 重画失败不拦结算 */ }\n', 'bomb.render', 'bomb'],
];

function inject(rel, src) {
  for (const [file, anchor, name, where] of POINTS) {
    if (file !== rel) continue;
    const n = src.split(anchor).length - 1;
    if (n !== 1) throw new Error(`门要跟着改：插桩锚点在 ${file} 里出现 ${n} 次：${name}`);
    let rep;
    if (where === 'after') rep = anchor + F(name) + '\n';
    else if (where === 'before') rep = F(name) + '\n' + anchor;
    else if (where === 'bomb') rep = anchor.replace('  try { end.render(); }', '  try { ' + F(name) + ' end.render(); }');
    else if (where === 'glowarrow') rep = '        coachGlow: (kind) => { ' + F(name) + ' glow.request(kind); },\n';
    else if (where === 'fnbody') {
      const at = src.indexOf(anchor);
      const brace = src.indexOf('{\n', at);
      src = src.slice(0, brace + 2) + '  ' + F(name) + '\n' + src.slice(brace + 2);
      continue;
    }
    src = src.replace(anchor, rep);
  }
  return src;
}
const chain = (...fs) => (rel, src) => fs.filter(Boolean).reduce((s, f) => f(rel, s), src);
/** 一处源码替换：锚点必须恰好一次。 */
const sub = (file, from, to) => (rel, src) => {
  if (rel !== file) return src;
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`门要跟着改：${file} 里「${from.slice(0, 60).replace(/\n/g, '⏎')}」出现 ${n} 次`);
  return src.replace(from, to);
};

// ─────────────────────────── 三种最后一手 ───────────────────────────
const SCEN = {
  // 方块：只剩一行 6 颗同色星星，滑一下 → 整行消（只有消线拍）
  sqRow(g) {
    g.tap.setGrid([Array.from({ length: 6 }, () => star(2))]);
    return new Set(Array.from({ length: 6 }, (_, c) => `0,${c}`));
  },
  // 小球：只剩底边 3 颗同色星星 → 削底边（消线拍 + 放大）
  ciEdge(g) {
    const gr = [];
    for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE()));
    gr[6][0] = star(1); gr[6][1] = star(1); gr[6][2] = star(1);
    g.tap.setGrid(gr);
    return new Set(['6,0', '6,1', '6,2']);
  },
  // 小球：图案 1 枚级，底边 [星1 星1 色块(背面 1)] → 先翻色块（图案拍：翻面、滚筒、图案块）再削底边
  ciMatch(g) {
    g.ero.spend(999);
    const gr = [];
    for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE()));
    gr[6][0] = star(1); gr[6][1] = star(1); gr[6][2] = tile(0, 1, 'flavor');
    g.tap.setGrid(gr);
    return new Set(['6,0', '6,1', '6,2']);
  },
};
const BOARD = { sqRow: 'square', ciEdge: 'circle', ciMatch: 'circle' };
const HOOKS = {
  onLive: () => globalThis.__F?.('hook.onLive'),
  shouldLeadOut: () => { globalThis.__F?.('hook.shouldLeadOut'); return false; },
};
const MODES = {
  base: { ...HOOKS },
  puzzle: { steps: true, ...HOOKS },
  timed: { timeLimitSec: 60, ...HOOKS },
  coach: { coach: true, ...HOOKS },
  pro: { proAllowed: true, ...HOOKS },
};
// 伪故障：不靠插桩，靠环境
const PSEUDO = {
  'canvas.null': { setup: (s) => { s.CANVAS.mode = 'null'; }, undo: (s) => { s.CANVAS.mode = 'stub'; } },
  'canvas.taint': { setup: (s) => { s.CANVAS.mode = 'taint'; }, undo: (s) => { s.CANVAS.mode = 'stub'; } },
  'storage.nullRun': { setup: (s, g) => { localStorage.setItem(g.bestKey + '::runs', '[null]'); }, undo: () => {} },
};
const NAMES = ['(none)', ...POINTS.map((p) => p[2]), 'hook.onLive', 'hook.shouldLeadOut', ...Object.keys(PSEUDO)].filter((n, i, a) => a.indexOf(n) === i);
const LOGIC_ONLY = 'end.logicBeforeRun'; // endGame 记账逻辑本身抛错：lastRun 还没拼出来，只能露最低限度的结算页
const EARLY_OK = { name: 'plank.snap', scen: 'ciMatch', ms: 250 }; // 动态效果开：翻面那一拍被跳过，早到约 170ms

function stateOf(g) {
  return { shown: g.shown(), over: g.ctl.gameOver, res: g.ctl.resolving, empty: g.hooks.isGameOver(), ends: g.ends.map((e) => e.reason), saved: g.saved() };
}

/** ① 一种动态效果下跑整张矩阵；交回每一格的结果。 */
async function faultMatrix(motion, extraMutate) {
  const sim = await makeSim(ROOT, { motion, mutate: chain(extraMutate, inject) });
  const rows = [];
  for (const name of NAMES) {
    if (ONLY && name !== ONLY && name !== '(none)') continue;
    for (const scen of Object.keys(SCEN)) {
      for (const mode of Object.keys(MODES)) {
        sim.B.setPro(mode === 'pro');
        const g = sim.open(BOARD[scen], MODES[mode]);
        const mask = SCEN[scen](g);
        g.hooks.render();
        const ps = PSEUDO[name];
        localStorage.removeItem(g.bestKey + '::runs');
        if (ps) ps.setup(sim, g);
        else if (name !== '(none)') sim.armFault(name, { times: 1 });
        const t0 = sim.now;
        let sync = '';
        try { g.ctl.resolveMove(mask, 0); } catch (e) { sync = String(e?.message ?? e); }
        sim.settle(8000);
        const hit = ps ? true : name === '(none)' ? true : sim.FAULT.hits > 0;
        const A = stateOf(g);
        const guards = [...g.guards];
        const guardLines = sim.logs.filter((l) => l.startsWith('[slides:end-guard]')).length;
        if (ps) ps.undo(sim, g);
        rows.push({ name, scen, mode, hit, A, endAt: g.ends[0] ? g.ends[0].at - t0 : null, endCalls: g.ends.length, guards, guardLines, modeKey: g.hooks.modeKey, sync });
        g.close();
      }
    }
  }
  sim.B.setPro(false);
  return rows;
}

function judgeMatrix(rows, motion, tag) {
  const base = new Map(rows.filter((r) => r.name === '(none)').map((r) => [r.scen + '/' + r.mode, r]));
  let hitCells = 0;
  let okCells = 0;
  const bad = [];
  for (const r of rows) {
    if (!r.hit) continue;
    hitCells++;
    const b = base.get(r.scen + '/' + r.mode);
    const where = `${tag} ${r.name} × ${r.scen} × ${r.mode}`;
    const problems = [];
    if (!b || !b.A.shown || b.A.saved !== 1) { problems.push('不出错时这一格自己就没结算（夹具坏了）'); }
    if (!r.A.shown) problems.push(`结算页没露面（over=${r.A.over} resolving=${r.A.res} 盘空=${r.A.empty}）`);
    if (r.endCalls !== 1) problems.push(`endGame0 结算了 ${r.endCalls} 次`);
    if (r.name !== LOGIC_ONLY) {
      if (r.A.saved !== 1) problems.push(`本机存档 ${r.A.saved} 局（该是 1）`);
      if (b && r.A.ends.join('|') !== b.A.ends.join('|')) problems.push(`理由 ${JSON.stringify(r.A.ends)}，不出错时是 ${JSON.stringify(b.A.ends)}`);
      if (b && r.endAt !== null && b.endAt !== null && r.endAt !== b.endAt) {
        const early = b.endAt - r.endAt;
        const allowed = motion && r.name === EARLY_OK.name && r.scen === EARLY_OK.scen && early > 0 && early <= EARLY_OK.ms;
        if (!allowed) problems.push(`结算于 ${r.endAt}ms，不出错时是 ${b.endAt}ms`);
      }
    }
    // end_guard：每个标签最多一次、kind 不带错误原文、mode 是这一局的玩法
    const kinds = r.guards.map((x) => x.kind);
    const dup = kinds.filter((k, i) => kinds.indexOf(k) !== i);
    if (dup.length) problems.push(`end_guard 同一个标签报了不止一次：${[...new Set(dup)].join(', ')}`);
    for (const x of r.guards) {
      if (/FAULT|Error|insecure|null|\s/.test(x.kind)) problems.push(`end_guard 的 kind 带了错误原文：${JSON.stringify(x.kind)}`);
      if (x.mode !== r.modeKey) problems.push(`end_guard 的 mode=${x.mode}，这一局是 ${r.modeKey}`);
    }
    if (r.name === '(none)' && (r.guards.length || r.guardLines)) problems.push(`不出错时兜底出了声：${JSON.stringify(r.guards)}`);
    if (problems.length) bad.push(`${where}：${problems.join('；')}`);
    else okCells++;
    if (VERBOSE) console.log(`  ${where}: ${problems.length ? 'RED ' + problems.join('；') : 'ok'} 结算于 ${r.endAt}ms guards=${JSON.stringify(r.guards.map((x) => x.kind))}`);
  }
  const notHit = rows.filter((r) => !r.hit).length;
  return { hitCells, okCells, notHit, bad };
}

// ─────────────────────────── ② 逻辑变异 ───────────────────────────
const MUT = {
  M1: sub(GC, '      if (hooks.isGameOver()) {\n        resolving = false;', '      if (false && hooks.isGameOver()) {\n        resolving = false;'),
  M2: sub(GC, '      if (!s) {\n        finish();\n        return;\n      }', '      if (!s) {\n        return;\n      }'),
  M3: sub(GC, "    stuckTimer = window.setTimeout(() => {\n      stuckTimer = 0;\n      if (!gameOver) endGame('无法继续匹配');\n    }, ms);", '    stuckTimer = 0;'),
};
const MSC = {
  sqRow: ['square', (g) => { g.tap.setGrid([Array.from({ length: 6 }, () => star(2))]); return new Set(Array.from({ length: 6 }, (_, c) => `0,${c}`)); }],
  ciEdge: ['circle', (g) => { const gr = []; for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE())); gr[6][0] = star(1); gr[6][1] = star(1); gr[6][2] = star(1); g.tap.setGrid(gr); return new Set(['6,0', '6,1', '6,2']); }],
  // 方块 2×2：图案 4 枚级，四色各一（凑不出任何东西）→ 滑一下 → 判死
  sqDead: ['square', (g) => { g.tap.setGrid([[tile(0, 1), tile(1, 2)], [tile(2, 3), tile(3, 0)]]); return new Set(['0,0', '0,1']); }],
};
async function mutantSection(extraMutate) {
  const bad = [];
  const lines = [];
  for (const [mk, mf] of Object.entries(MUT)) {
    const sim = await makeSim(ROOT, { motion: true, mutate: chain(extraMutate, mf) });
    for (const [sk, [id, set]] of Object.entries(MSC)) {
      if ((mk === 'M3') !== (sk === 'sqDead')) continue;
      for (const opts of [{}, { steps: true }]) {
        const g = sim.open(id, opts);
        const mask = set(g);
        g.hooks.render();
        const t0 = sim.now;
        if (sk === 'sqDead') { const gr = g.tap.grid(); const r0 = gr[0]; gr[0] = [r0[1], r0[0]]; }
        g.ctl.resolveMove(mask, 0);
        sim.tick(3000);
        const at = g.ends[0] ? g.ends[0].at - t0 : null;
        const line = `${mk} ${sk} ${opts.steps ? '步步为营' : '基础'}：结算页=${g.shown()} 理由=${JSON.stringify(g.ends.map((e) => e.reason))} 于=${at === null ? '-' : at + 'ms'}`;
        lines.push(line);
        // 理由也要对：M3 走的是守望那一句（和 armStuckEnd 里的字面值一字不差，两边写走样了就在这儿红）。
        const want = mk === 'M3' ? '无法继续匹配' : sim.B.ALL_FLIPPED_REASON;
        if (!g.shown() || at === null || at > 3000 || g.ends.length !== 1 || g.ends[0].reason !== want) bad.push(`② ${line}（要 3 秒内以「${want}」结算、只结算一次）`);
        g.close();
      }
    }
  }
  return { bad, lines };
}

// ─────────────────────────── ③ 等价 ───────────────────────────
/** 「去掉兜底的同一包」：guard 全部直通、连锁不兜、守望不起、endGame 不包 finally。正常打的局里兜底一句都不该执行。 */
const STRIP = chain(
  sub(GC, 'function guardFn<A extends unknown[], R>(tag: string, f: (...a: A) => R, fallback: (...a: A) => R): (...a: A) => R {\n',
    'function guardFn<A extends unknown[], R>(tag: string, f: (...a: A) => R, fallback: (...a: A) => R): (...a: A) => R {\n  if (tag || fallback) return f;\n'),
  sub(GC, 'function guardObj<T extends object>(tag: string, o: T): T {\n', 'function guardObj<T extends object>(tag: string, o: T): T {\n  if (tag || o) return o;\n'),
  sub(GC, '  hooks = guardHooks(hooks);\n', ''),
  sub(GC, "    try { run(); } catch (e) { guardLog('beat', e); }\n    settleIfBroken();\n", '    run();\n'),
  sub(GC, "    checkEnd('touch');\n", ''),
  sub(GC, "    checkEnd('resume');\n", ''),
  sub(GC, '    guardTimer = window.setInterval(watch, 500);\n', ''),
  sub(GC, '    lastRun = null;\n    try {\n      endGame0(reason, extraPenalty, extraPenaltyLabel);\n', '    lastRun = null;\n    if (lastRun === null) { endGame0(reason, extraPenalty, extraPenaltyLabel); return; }\n    try {\n      endGame0(reason, extraPenalty, extraPenaltyLabel);\n'),
  (rel, src) => (rel === GC ? src.replace(/try \{ (\w+0\([^)]*\)); \} catch \(e\) \{ guardLog\('\w+', e\); \}/g, '$1;') : src),
);

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const ROWS = 7;
const CLines = [];
for (let d = 0; d < ROWS; d++) { const cells = []; for (let r = d; r < ROWS; r++) cells.push([r, r - d]); CLines.push(cells); }
for (let e = 0; e < ROWS; e++) { const cells = []; for (let r = e; r < ROWS; r++) cells.push([r, e]); CLines.push(cells); }
for (let r = 0; r < ROWS; r++) { const cells = []; for (let c = 0; c <= r; c++) cells.push([r, c]); CLines.push(cells); }
function circleStart(B, rand, allStar) {
  const live = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) live.add(`${r},${c}`);
  const board = { lines: CLines.map((cells, i) => ({ fam: i < 7 ? 'A' : i < 14 ? 'B' : 'R', offset: i % 7, cells })), isLive: (r, c) => live.has(`${r},${c}`) };
  const target = 28 - (8 + Math.floor(rand() * 20));
  let thr = B.EDGE_MIN;
  while (live.size > Math.max(0, target)) {
    let edges = B.outerEdges(board, thr);
    if (!edges.length && thr === B.EDGE_MIN) { thr = B.EDGE_MIN_ENDGAME; edges = B.outerEdges(board, thr); }
    if (!edges.length) break;
    for (const [r, c] of pick(rand, edges).live) live.delete(`${r},${c}`);
  }
  const spec = [];
  for (let r = 0; r < ROWS; r++) { const row = []; for (let c = 0; c <= r; c++) row.push(!live.has(`${r},${c}`) ? null : rand() < (allStar ? 2 : 0.55) ? ['d', Math.floor(rand() * 4)] : ['f', Math.floor(rand() * 4), Math.floor(rand() * 4)]); spec.push(row); }
  return spec;
}
function squareStart(rand, allStar) {
  const R = 1 + Math.floor(rand() * 4), C = 1 + Math.floor(rand() * 4), K = 2 + Math.floor(rand() * 3);
  return Array.from({ length: R }, () => Array.from({ length: C }, () => (rand() < (allStar ? 2 : 0.6) ? ['d', Math.floor(rand() * K)] : ['f', Math.floor(rand() * K), Math.floor(rand() * K)])));
}
const buildGrid = (spec) => spec.map((row) => row.map((x) => (x === null ? BLANK_TILE() : x[0] === 'd' ? star(x[1]) : tile(x[1], x[2]))));

const EQUIV_N = 150; // × 两副 × 基础 / 步步为营 = 600 局
async function equivRun(mutate) {
  const sim = await makeSim(ROOT, { motion: true, mutate });
  const { B } = sim;
  const out = [];
  let guardLines = 0;
  let guards = 0;
  for (let i = 0; i < EQUIV_N; i++) {
    for (const id of ['square', 'circle']) {
      for (const mode of ['base', 'puzzle']) {
        const rand = mulberry(7 * 1000003 + i * 13 + (id === 'square' ? 1 : 2));
        const level = pick(rand, [1, 1, 2, 3, 4]);
        const spec = id === 'square' ? squareStart(rand, level === 1) : circleStart(B, rand, level === 1);
        const g = sim.open(id, mode === 'puzzle' ? { steps: true } : {});
        localStorage.removeItem(g.bestKey + '::runs');
        if (level < 4) g.ero.spend(id === 'square' ? { 3: 15, 2: 26, 1: 999 }[level] : { 3: 12, 2: 20, 1: 999 }[level]);
        g.tap.setGrid(buildGrid(spec));
        if (g.hooks.isGameOver()) { g.close(); out.push({ i, id, mode, skip: true }); continue; }
        g.hooks.render();
        const mr = mulberry(7 + i * 31 + (id === 'square' ? 5 : 9));
        let k = 0;
        while (!g.ctl.gameOver && k < 60) {
          const grid = g.tap.grid();
          const moves = [];
          if (id === 'square') {
            const [rows, cols] = g.tap.dims();
            for (let r = 0; r < rows; r++) for (let s = 1; s < cols; s++) if (B.slideLine(grid[r], s)) moves.push({ cells: Array.from({ length: cols }, (_, c) => [r, c]), s });
            for (let c = 0; c < cols; c++) for (let s = 1; s < rows; s++) if (B.slideLine(grid.map((row) => row[c]), s)) moves.push({ cells: Array.from({ length: rows }, (_, r) => [r, c]), s });
          } else {
            for (const line of CLines) { const cells = line.filter(([r, c]) => !g.tap.isBlank(grid[r][c])); for (let s = 1; s < cells.length; s++) if (B.slideLine(cells.map(([r, c]) => grid[r][c]), s)) moves.push({ cells, s }); }
          }
          if (!moves.length) break;
          const m = pick(mr, moves);
          const shifted = B.slideLine(m.cells.map(([r, c]) => grid[r][c]), m.s);
          m.cells.forEach(([r, c], j) => { grid[r][c] = shifted[j]; });
          g.ctl.resolveMove(new Set(m.cells.map(([r, c]) => `${r},${c}`)), 0);
          // 一部分的步在连锁中途碰一下（hurry）、一部分中途暂停再继续
          sim.tick(Math.floor(mr() * 900));
          if (mr() < 0.3) g.ctl.hurry(); else if (mr() < 0.5) { g.ctl.pause(); sim.tick(500); g.ctl.resume(); }
          for (let w = 0; w < 6000 && !g.ctl.gameOver; w++) sim.tick(10);
          sim.settle(8000);
          k++;
        }
        sim.settle(60000);
        guardLines += sim.logs.filter((l) => l.startsWith('[slides:end-guard]')).length;
        guards += g.guards.length;
        out.push({ i, id, mode, over: g.ctl.gameOver, res: g.ctl.resolving, ends: g.ends.map((e) => e.reason).join('|'), total: g.refs.endOverlay.dataset.total ?? '', moves: g.ctl.moves, shown: g.shown(), saved: g.saved(), empty: g.hooks.isGameOver() });
        g.close();
      }
    }
  }
  return { out, guardLines, guards };
}

// ─────────────────────────── ④ 判死夹具 ───────────────────────────
const TRI12 = '1,2:d3 2,2:d3 2,3:d2 2,4:d3 3,1:d2 3,2:d5 3,3:d1 3,4:d0 4,0:d4 4,1:d0 4,2:d5 5,0:d3';
// 13、14 枚那两副是在 12 枚那一副上各加一颗星星（推02 落地时挑的：推01 上永远不结束、推02 上判死）。
const TRI = { 12: TRI12, 13: TRI12 + ' 1,3:d1', 14: TRI12 + ' 1,3:d1 4,3:d4' };
function triBoard(g, spec) {
  const ng = g.tap.grid().map((row) => row.map((t) => (t == null ? t : BLANK_TILE())));
  for (const it of spec.split(' ')) { const [rc, v] = it.split(':'); const [r, c] = rc.split(',').map(Number); ng[r][c] = star(Number(v.slice(1))); }
  g.tap.setGrid(ng);
  return new Set([spec.split(' ')[0].split(':')[0]]);
}
const DEAD_FIXTURES = [
  ...Object.entries(TRI).map(([n, spec]) => [`六边三角 ${n} 颗全是星星`, 'triangleBig', {}, (g) => triBoard(g, spec), '无法继续匹配']),
  ['10-19 复现 7（小球 1×2、收尾放开后剩三枚互不同线）', 'circle', {}, (g) => {
    g.ero.spend(20);
    const gr = []; for (let r = 0; r < 7; r++) gr.push(Array.from({ length: r + 1 }, () => BLANK_TILE()));
    gr[1][0] = tile(0, 1); gr[6][3] = tile(2, 1); gr[4][0] = star(1); gr[4][2] = star(3);
    g.tap.setGrid(gr);
    // 滑一下 (4,0)(4,2)：两颗星星对调，滑完之后谁也凑不成
    const t = gr[4][0]; gr[4][0] = gr[4][2]; gr[4][2] = t;
    return new Set(['4,0', '4,2']);
  }, '无法继续匹配'],
  ['方块 1×N 只剩活炸弹', 'square', { bomb: true }, (g) => { g.tap.setGrid([[star(2), star(2), star(2), tile(0, 1)]]); return new Set(['0,0', '0,1', '0,2', '0,3']); }, null],
];
async function deadSection(extraMutate) {
  const sim = await makeSim(ROOT, { motion: true, mutate: extraMutate });
  const bad = [];
  const lines = [];
  for (const [label, id, opts, set, reason] of DEAD_FIXTURES) {
    for (const steps of [false, true]) {
      const g = sim.open(id, { ...opts, ...(steps ? { steps: true } : {}) });
      const mask = set(g);
      g.hooks.render();
      const t0 = sim.now;
      g.ctl.resolveMove(mask, 0);
      // 判死之后盘子会「收尾放开」、把还削得掉的外边削掉（带动画），削完才轮到那 1.4 秒。所以量的是「盘面停下来
      // （连锁走完）之后 1.4 秒内结算」，不是从这一手起算——最多等 8 秒。
      let settled = t0;
      for (let w = 0; w < 800 && !g.ends.length; w++) { if (g.ctl.resolving) settled = sim.now; sim.tick(10); }
      sim.tick(500);
      const want = reason ?? sim.B.ALL_FLIPPED_REASON;
      const at = g.ends[0] ? g.ends[0].at - t0 : null;
      const after = g.ends[0] ? g.ends[0].at - settled : null;
      const line = `${label} ${steps ? '步步为营' : '基础'}：理由=${JSON.stringify(g.ends.map((e) => e.reason))} 于=${at === null ? '-' : at + 'ms'}（停下后 ${after === null ? '-' : after + 'ms'}） 结算页=${g.shown()}`;
      lines.push(line);
      if (!g.shown() || g.ends.length !== 1 || g.ends[0].reason !== want || after > 1400 + 100) bad.push(`④ ${line}（要在盘面停下后 1.4 秒内以「${want}」结算）`);
      g.close();
    }
  }
  return { bad, lines };
}

// ─────────────────────────── ⑤ 轨道层的尺子 ───────────────────────────
const RULER_BOARDS = ['square', 'circle', 'circleHex', 'squareDiamond', 'triangleBig', 'circleSeven'];
const RULER_N = 400; // 每副
async function rulerSection(extraMutate) {
  const sim = await makeSim(ROOT, { motion: false, mutate: extraMutate });
  const verdicts = { dead: 0, scores: 0, unknown: 0 };
  const bad = [];
  sim.SIM.probe = (v) => {
    verdicts[v] = (verdicts[v] ?? 0) + 1;
    if (v === 'scores' && bad.length < 5) bad.push(`⑤ 轨道层说死、穷举说还能得分：${JSON.stringify(sim.SIM.__cur)}`);
  };
  for (const id of RULER_BOARDS) {
    for (let i = 0; i < RULER_N; i++) {
      const rand = mulberry(20261031 + i * 97 + RULER_BOARDS.indexOf(id) * 7919);
      const g = sim.open(id, {});
      const K = g.hooks.boardColors;
      const level = pick(rand, [1, 2, 3, 4]);
      if (level < 4) g.ero.spend({ 3: 15, 2: 26, 1: 999 }[level]);
      let grid;
      if (id === 'square') {
        const R = 1 + Math.floor(rand() * 4), C = 1 + Math.floor(rand() * 4);
        grid = Array.from({ length: R }, () => Array.from({ length: C }, () => null));
      } else grid = g.tap.grid().map((row) => row.map((t) => (t == null ? null : BLANK_TILE())));
      const cells = [];
      grid.forEach((row, r) => row.forEach((t, c) => { if (id === 'square' || t !== null) cells.push([r, c]); }));
      const n = Math.min(cells.length, 2 + Math.floor(rand() * 11));
      for (let j = cells.length - 1; j > 0; j--) { const k = Math.floor(rand() * (j + 1)); [cells[j], cells[k]] = [cells[k], cells[j]]; }
      const allStar = rand() < 0.4;
      const spec = [];
      cells.forEach(([r, c], j) => {
        let t;
        if (j >= n) t = BLANK_TILE();
        else if (allStar || rand() < 0.5) { const d = Math.floor(rand() * K); t = star(d); spec.push(`${r},${c}:d${d}`); }
        else { const a = Math.floor(rand() * K), b = Math.floor(rand() * K); t = tile(a, b); spec.push(`${r},${c}:f${a}/${b}`); }
        grid[r][c] = t;
      });
      g.tap.setGrid(grid);
      sim.SIM.__cur = { id, level, spec: spec.join(' ') };
      try { g.hooks.findStuckGroups?.(); } catch (e) { bad.push(`⑤ ${id} findStuckGroups 抛错：${e?.message ?? e}`); }
      g.close();
    }
  }
  const lines = [`⑤ 轨道层说死、可穷举的 ${verdicts.dead + verdicts.scores + verdicts.unknown} 副：穷举也说死 ${verdicts.dead}、说还能得分 ${verdicts.scores}、走不完 ${verdicts.unknown}`];
  if (verdicts.dead < 100) bad.push(`⑤ 轨道层说死的随机残局只有 ${verdicts.dead} 副（尺子太空，夹具坏了）`);
  return { bad, lines };
}

// ─────────────────────────── 跑 ───────────────────────────
async function runAll(extra = null, { only = null } = {}) {
  const bad = [];
  const report = [];
  if (!only || only === '①') {
    for (const motion of [true, false]) {
      const rows = await faultMatrix(motion, extra);
      const j = judgeMatrix(rows, motion, motion ? '动态开' : '动态关');
      report.push(`① 故障矩阵（动态效果${motion ? '开' : '关'}）：命中 ${j.hitCells} 格，当场结算并存档 ${j.okCells} 格，走不到的 ${j.notHit} 格`);
      bad.push(...j.bad.map((x) => '① ' + x));
    }
  }
  if (!only || only === '②') {
    const m = await mutantSection(extra);
    report.push(...m.lines.map((l) => '② ' + l));
    bad.push(...m.bad);
  }
  if (!only || only === '④') {
    const d = await deadSection(extra);
    report.push(...d.lines.map((l) => '④ ' + l));
    bad.push(...d.bad);
  }
  if (!only || only === '⑤') {
    const r = await rulerSection(extra);
    report.push(...r.lines);
    bad.push(...r.bad);
  }
  if (!only || only === '③') {
    const cur = await equivRun(extra);
    const ref = await equivRun(chain(extra, STRIP));
    let diff = 0;
    const tally = {};
    for (let j = 0; j < cur.out.length; j++) {
      const x = ref.out[j], y = cur.out[j];
      const kx = JSON.stringify(x), ky = JSON.stringify(y);
      if (kx !== ky) { diff++; if (diff <= 5) bad.push(`③ 第 ${j} 局和去掉兜底的同一包不同：\n      去掉兜底 ${kx}\n      现行     ${ky}`); }
      const key = y.skip ? '(摆出来就是空盘，跳过)' : `${y.id}/${y.mode} ${y.over ? y.ends : y.empty ? '盘空没结束' : y.res ? '卡在连锁' : '60 步没结束'}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    if (diff > 5) bad.push(`③ 一共 ${diff} 局不同（只印了前 5 局）`);
    if (cur.guardLines || cur.guards) bad.push(`③ 不出错时兜底出了声：[slides:end-guard] ${cur.guardLines} 行、end_guard ${cur.guards} 次（正常打的局里兜底一句都不该执行）`);
    const played = cur.out.filter((x) => !x.skip).length;
    if (played < 400) bad.push(`③ 只打了 ${played} 局（摆出来就是空盘的太多，夹具坏了）`);
    report.push(`③ 等价：${cur.out.length} 局（实打 ${played}），逐局不同 ${diff}；兜底出声 ${cur.guardLines + cur.guards} 次`);
    if (VERBOSE) report.push(Object.entries(tally).sort().map(([k, v]) => `      ${String(v).padStart(4)}  ${k}`).join('\n'));
  }
  return { bad, report };
}

if (MUTANTS) {
  // 门自己的验证：拆掉兜底的三处，各自那一节得红（10-31 方案推01「变异（手跑，写进提交说明）」）。
  const V = {
    '去掉 runBeat 的 catch → ① 红': [sub(GC, "    try { run(); } catch (e) { guardLog('beat', e); }\n", '    run();\n'), '①'],
    '去掉守望 → ② M1 红': [sub(GC, '    guardTimer = window.setInterval(watch, 500);\n', ''), '②'],
    // 方案原写「canvas.null 红」；实测 canvas.null 另有两层接住（shareCard 判空、renderCard 自己的 try），拆掉 finally
    // 只剩记账逻辑本身抛错的那一格露不出结算页——这正是 finally 独自兜着的那一格。
    // 推02（Z-A02）的两条：
    '去掉轨道层 → ④ 三角那几副红': [sub('src/engine/residueBoard.ts', '  if (!opts.slot && orbitDead(', '  if (!opts.slot && false && orbitDead('), '④'],
    '加回零手那一句 → ④ 复现 7 红': [sub('src/engine/residueBoard.ts', '  const bonusLines = toBonus(built, opts.bonusLines);\n  const moves =', "  if (!built.moveLines.length) return 'unknown';\n  const bonusLines = toBonus(built, opts.bonusLines);\n  const moves ="), '④'],
    '去掉 endGame 的 finally → end.logicBeforeRun 红': [sub(GC, '    } finally {\n      if (gameOver && !hooks.practice) {\n', '    } finally {\n      if (false) {\n'), '①'],
  };
  let ok = true;
  for (const [what, [m, only]] of Object.entries(V)) {
    const r = await runAll(m, { only });
    const red = r.bad.length > 0;
    console.log(`${red ? 'ok  ' : 'BAD '} ${what}：${red ? `红了 ${r.bad.length} 处，例 ${r.bad[0].split('\n')[0]}` : '居然全绿'}`);
    if (!red) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

const t0 = Date.now();
const { bad, report } = await runAll(null, { only: process.env.SECTION ?? null }); // SECTION=① … ⑤：只跑那一节（手跑查问题用）
for (const line of report) console.log(line);
if (bad.length) {
  console.log(`\n✗ 结尾兜底：${bad.length} 处不对（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  for (const b of bad.slice(0, 40)) console.log('  ' + b);
  if (bad.length > 40) console.log(`  ……另有 ${bad.length - 40} 处`);
  process.exit(1);
}
console.log(`\n✓ 结尾兜底：任何装饰抛错都照常结算（${Math.round((Date.now() - t0) / 1000)} 秒）`);
process.exit(0);
