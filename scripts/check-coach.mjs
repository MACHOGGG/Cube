/**
 * 棋盘底下那块教学条：五条各在自己的时机出来，呼吸灯亮对那一组（第 15 推重写）。
 *
 *   npx esbuild src/ui/coachBar.ts        --bundle --format=esm --outfile=/tmp/coach.mjs
 *   npx esbuild src/i18n.ts               --bundle --format=esm --outfile=/tmp/i18n.mjs
 *   npx esbuild src/engine/coachHint.ts   --bundle --format=esm --outfile=/tmp/coachhint.mjs
 *   npx esbuild src/engine/outerEdge.ts   --bundle --format=esm --outfile=/tmp/outeredge.mjs
 *   npx esbuild src/engine/erosion.ts     --bundle --format=esm --outfile=/tmp/erosion.mjs
 *   npx esbuild src/engine/residueBoard.ts --bundle --format=esm --outfile=/tmp/resboard.mjs
 *   node scripts/check-coach.mjs /tmp/coach.mjs /tmp/i18n.mjs /tmp/coachhint.mjs \
 *     /tmp/outeredge.mjs /tmp/erosion.mjs /tmp/resboard.mjs
 *
 * ── 第 15 推定的五个时机（玩家 2026-10-03 逐条确认过）──────────────────
 *
 *   第 1 条  开局显示，12 秒后自动换下一条
 *   第 2 条  紧跟第 1 条
 *   第 3 条  当前一级剩下的段数 ≤ 4 时
 *   第 4 条  场上第一次出现「某一种颜色的星星枚数 ≥ 最短外边的长度」时（方块用较短那条边）
 *   第 5 条  第一次真的消掉一条外边之后，一直保留到这一局结束
 *
 * 一次只显示一条、按顺序；轮到某一条时如果条件已满足，立刻显示。第二副基础棋盘只讲第 4
 * 条，触发条件同上。进度条 5 格。
 *
 * 这道门**用模拟盘面**把五个触发条件依次走一遍：段数来自真的侵蚀阶梯（erosion.ts 照小球
 * 那张表扣段），「星星够不够一条外边」来自真的外边几何（outerEdge.ts 的 shortestEdge）加
 * 棋盘真用的那个数法（coachHint.ts 的 starsReach），盘面是这儿手摆的。所以量的不是「条子
 * 收到一个 true 会不会换」，而是「盘面走到那一步，条子才换；差一枚都不换」。
 *
 * 时钟是假的（12 秒、6 秒的读够都要量准到毫秒），DOM 也是这儿自己搭的一份够用的——比
 * 起开一个 Chromium 跑一局真游戏，这一版几十毫秒、跑得进 CI，而且能把时钟拨快。真浏览器
 * 里的那一半（灯真的亮在一步能成的那组上、字号、不压棋盘、拖得动）在 check-coach-aim。
 *
 * 呼吸灯的零件（一层穷举、映射回此刻的位置、挑组）也在这儿用模拟盘面验：认组那一步用的
 * 是这儿手写的一把 1×N 尺子，**不是**棋盘真的 findMatches——那一把只有在真棋盘里才拿得
 * 到，所以「灯亮的正好是一步能成的那组」那一条在 check-coach-aim 里拿真棋盘对照。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [coachBundle, i18nBundle, hintBundle, edgeBundle, erosionBundle, resBundle] = process.argv.slice(2);
if (!resBundle) {
  console.log('用法: node scripts/check-coach.mjs <coachBar.mjs> <i18n.mjs> <coachHint.mjs> <outerEdge.mjs> <erosion.mjs> <residueBoard.mjs>');
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const head = (t) => console.log('\n── ' + t);

// ===========================================================================
// 小 DOM：只做 coachBar 真的用到的那几样
// ===========================================================================
function makeEl(tag) {
  const node = {
    tag,
    _cls: new Set(),
    _attrs: new Map(),
    _text: '',
    _html: '',
    _handlers: new Map(),
    childNodes: [],
    parent: null,
    hidden: false,
    style: {},
    offsetWidth: 0,
  };
  node.classList = {
    add: (c) => node._cls.add(c),
    remove: (c) => node._cls.delete(c),
    contains: (c) => node._cls.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !node._cls.has(c) : !!force;
      if (on) node._cls.add(c);
      else node._cls.delete(c);
      return on;
    },
  };
  Object.defineProperty(node, 'children', { get: () => node.childNodes });
  Object.defineProperty(node, 'innerHTML', {
    get: () => node._html,
    set: (html) => {
      node._html = String(html);
      node.childNodes = parseHTML(node._html, node);
    },
  });
  Object.defineProperty(node, 'textContent', {
    get: () => node._text,
    set: (t) => {
      node._text = String(t);
    },
  });
  node.setAttribute = (k, v) => node._attrs.set(k, String(v));
  node.getAttribute = (k) => (node._attrs.has(k) ? node._attrs.get(k) : null);
  node.addEventListener = (type, fn) => {
    if (!node._handlers.has(type)) node._handlers.set(type, []);
    node._handlers.get(type).push(fn);
  };
  node.fire = (type) => (node._handlers.get(type) || []).forEach((fn) => fn());
  node.querySelector = (sel) => walk(node, sel)[0] ?? null;
  node.querySelectorAll = (sel) => walk(node, sel);
  node.closest = (sel) => {
    const want = sel.replace(/^\./, '');
    for (let p = node; p; p = p.parent) if (p._cls && p._cls.has(want)) return p;
    return null;
  };
  return node;
}

/** 只认 `.class` 这一种选择器——coachBar 用到的全是这一种。 */
function walk(root, sel) {
  const want = sel.replace(/^\./, '');
  const out = [];
  const visit = (n) => {
    for (const c of n.childNodes) {
      if (c._cls.has(want)) out.push(c);
      visit(c);
    }
  };
  visit(root);
  return out;
}

/** frame() 吐出来的那点标签：div / span / p / button，class 和光秃秃的 hidden。 */
function parseHTML(html, parent) {
  const out = [];
  const stack = [{ childNodes: out, _isRoot: true }];
  const tagRe = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, close, tag, attrStr, selfClose] = m;
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = makeEl(tag);
    for (const a of attrStr.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
      const [, name, val] = a;
      if (name === 'class') String(val || '').split(/\s+/).filter(Boolean).forEach((c) => node._cls.add(c));
      else if (name === 'hidden') node.hidden = true;
      else node.setAttribute(name, val ?? '');
    }
    const top = stack[stack.length - 1];
    top.childNodes.push(node);
    node.parent = top._isRoot ? parent : top;
    if (!selfClose) stack.push(node);
  }
  return out;
}

// ===========================================================================
// 假时钟：想拨多快拨多快，而且数得出「这一步到底等了几毫秒」
// ===========================================================================
let now = 0;
let nextTimer = 1;
let timers = new Map();
const fakeWindow = {
  setTimeout(fn, ms) {
    const id = nextTimer++;
    timers.set(id, { at: now + (Number(ms) || 0), fn });
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
};
/** 把时钟往前拨 ms，一路上到点的定时器按先后顺序跑掉（跑的时候新排的也算）。 */
function advance(ms) {
  const target = now + ms;
  for (;;) {
    let best = null;
    for (const [id, t] of timers) {
      if (t.at <= target && (!best || t.at < best.t.at)) best = { id, t };
    }
    if (!best) break;
    timers.delete(best.id);
    now = best.t.at;
    best.t.fn();
  }
  now = target;
}
function resetClock() {
  now = 0;
  timers = new Map();
}

const memStore = new Map();
globalThis.window = fakeWindow;
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
};

const { mountCoachBar, HINT_OF } = await import(coachBundle);
const { tutorialRules } = await import(i18nBundle);
const { oneStepGroups, pickGroup, matchKind, starsReach, createCoachGlow, HINT_BUDGET_MS } = await import(hintBundle);
const { shortestEdge, EDGE_MIN } = await import(edgeBundle);
const { createErosion, tableFor } = await import(erosionBundle);
const { oneStepMoves, gridLines } = await import(resBundle);

/** 去掉注释——注释里点名「从前那样东西」是这个仓库的习惯，不能算它还在。 */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
function allTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allTs(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const TS = [...allTs(join(root, 'src')), ...allTs(join(root, 'xhs/src'))];
const src = read('src/ui/coachBar.ts');

// ===========================================================================
// 静态：词表、调用点、接线、拆掉的那几样
// ===========================================================================
head('静态：词表、调用点、接线');
{
  const vocab = (code(src).match(/export type CoachSignal =([^;]+);/) || [, ''])[1]
    .split('|')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  check('（尺子）读得到信号的词表', vocab.length > 0, vocab.join(' '));
  const called = new Map();
  for (const file of TS) {
    for (const m of code(readFileSync(file, 'utf8')).matchAll(/\bsignal\(\s*'([a-z]+)'\s*\)/g)) {
      const rel = file.slice(root.length + 1);
      if (!called.has(m[1])) called.set(m[1], []);
      if (!called.get(m[1]).includes(rel)) called.get(m[1]).push(rel);
    }
  }
  check('每一处 signal() 报的都是词表里的词（没有写错的字符串）',
    [...called.keys()].every((c) => vocab.includes(c)),
    [...called.keys()].filter((c) => !vocab.includes(c)).join(',') || [...called.keys()].join(' '));
  const orphan = vocab.filter((v) => !called.has(v));
  check('词表里的词都有人报（第 5 条等的「消掉一条外边」、第 3 条兜底的「降了一级」）',
    orphan.length === 0, orphan.length ? `没人报：${orphan.join(',')}` : vocab.map((v) => `${v}←${called.get(v).join('/')}`).join(' '));

  const gc = code(read('src/engine/gameController.ts'));
  check('每一步结算完，gameController 把段数和「星星够不够一条外边」交给条子（observe）',
    /coach\.observe\(\{\s*segLeft: erosion\.segLeft\(\),\s*starsReachEdge: hooks\.coachStarsReachEdge\?\.\(\) \?\? false\s*\}\)/.test(gc));
  check('一步开始结算时灯先熄（resolveMove 里 coachGlow(null)），结算完再点（refreshCoachGlow）',
    /resolving = true;[\s\S]{0,200}hooks\.coachGlow\?\.\(null\)/.test(gc) && /coach\.observe\([\s\S]{0,200}refreshCoachGlow\(\)/.test(gc));
  for (const f of ['square', 'circle']) {
    const t = code(read(`src/shapes/${f}.ts`));
    check(`${f}.ts：接了呼吸灯、第 4 条按 starsReach 数、走法来自 residueBoard 的 oneStepMoves`,
      /coachGlow: \(kind\) =>/.test(t) && /\bcoachStarsReachEdge,/.test(t) && /starsReach\(grid,/.test(t) && /oneStepMoves\(/.test(t));
  }

  const plan = (name) => {
    const m = code(src).match(new RegExp(`\\b${name}: \\[([^\\]]*)\\]`));
    return m ? m[1].split(',').map((x) => Number(x.trim())) : null;
  };
  check('头一局：五条按顺序，一次一条', JSON.stringify(plan('first')) === '[0,1,2,3,4]', JSON.stringify(plan('first')));
  check('第二副基础棋盘：只讲第 4 条', JSON.stringify(plan('second')) === '[3]', JSON.stringify(plan('second')));
  check('灯：第 1、3 条亮色块，第 2 条亮星星＋色块，第 4 条亮外边的星星，第 5 条不亮',
    JSON.stringify(HINT_OF) === '["front","mixed","front","edge",null]', JSON.stringify(HINT_OF));
}

head('静态：第 15 推拆掉的那几样，一样都不许留着');
{
  const ts = TS.map((f) => [f.slice(root.length + 1), code(readFileSync(f, 'utf8'))]);
  const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const hit = (re) => ts.filter(([, t]) => re.test(t)).map(([f]) => f);
  const demo = hit(/\bonDemo\b|\.demo\(|\bdemo\(on/);
  check('E24 的演示（onDemo、patternBlock 的 demo）拆了', demo.length === 0, demo.join(' '));
  check('样式里的演示（.pat-block--demo）拆了', !/pat-block--demo/.test(css));
  const store = hit(/setCoachStoreKey|erosionTaught|MAKEUP_EROSION|slides_coach_ero|coach\.ero/);
  check('「做到过才算讲过」那格存档拆了（第二副棋盘不再补讲第 3 条）', store.length === 0, store.join(' '));
  const aim = hit(/coach-aim/);
  check('得分图案块和外边带子不再参与教学亮灯：源码里没有 coach-aim', aim.length === 0, aim.join(' '));
  check('样式里也没有 coach-aim（HUD 那一块、外边带子、方块的第 3 行第 3 列）', !/coach-aim/.test(css));
  const nudge = hit(/coachNudge/);
  check('「22 秒后换一句」那句文案四种语言一起删了（coachNudge）', nudge.length === 0, nudge.join(' '));
  check('（尺子）新的灯在样式里：.coach-glow 挂的是加亮一档的 glow-pulse-coach，只动 filter',
    /\.coach-glow:not\(\.piece-grabbed\)\s*\{[^}]*animation:\s*glow-pulse-coach/.test(css) &&
      /@keyframes glow-pulse-coach\s*\{[^@]*drop-shadow/.test(css));
  // 不加任何热区：凡是选择器里带 coach-glow 的规则，只许是那一条（和它减弱动态效果那一份），
  // 只许动 filter / animation / will-change / --glow。伪元素（::after 往外伸一圈）、outline、
  // pointer-events……一样都不许——那些都会让手指按到的东西变多。
  const glowRules = [...css.matchAll(/([^{}]*coach-glow[^{}]*)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const badSel = glowRules.filter(([sel]) => sel !== '.app--game .board .coach-glow:not(.piece-grabbed)');
  check('（尺子）读得到灯的那几条规则', glowRules.length >= 2, String(glowRules.length));
  check('带 coach-glow 的选择器只有那一个（不许伪元素、不许换个写法另加一条）', badSel.length === 0,
    badSel.map(([sel]) => sel).join(' | '));
  const props = glowRules.flatMap(([, body]) => [...body.matchAll(/([-\w]+)\s*:/g)].map((m) => m[1]));
  const extra = props.filter((p) => !['filter', 'animation', 'will-change', '--glow'].includes(p));
  check('灯那几条规则只动 filter（animation / will-change / --glow 之外一样都没有）', extra.length === 0 && props.includes('animation'),
    extra.join(',') || props.join(','));
  // 小球外边带子的呼吸：时长在两处（样式表的 animation、edgeBand.ts 接相位用的那个数），
  // 两处差一点，每走一步重画时带子就会跳一下。
  const bandMs = Number((code(read('src/ui/edgeBand.ts')).match(/BAND_BREATHE_MS = (\d+)/) || [])[1]);
  const cssS = Number((css.match(/\.edge-band \{ animation: edge-band-breathe ([\d.]+)s/) || [])[1]);
  check('外边带子呼吸的时长：样式表和 edgeBand.ts 的 BAND_BREATHE_MS 是同一个数', bandMs > 0 && Math.abs(cssS * 1000 - bandMs) < 1,
    `${cssS}s / ${bandMs}ms`);
  check('那条呼吸只给小球（[data-shape="circle"]）', /\.app--game\[data-shape="circle"\] \.edge-band \{ animation: edge-band-breathe/.test(css));
  check('减弱动态效果时：静止光晕，不跑动画',
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.app--game \.board \.coach-glow:not\(\.piece-grabbed\)\s*\{\s*animation: none;\s*filter: drop-shadow/.test(css));
}

// ===========================================================================
// 五条文案：玩家的原话，一个字不许动（E23）
// ===========================================================================
//
// 《侵蚀阶梯决策》§8「教学（玩家 2026-09-27 定稿五条）」逐字抄在下面。这五句是**玩家
// 自己写的**，不是我们润色过的说法——E23 把这一条单独点了名（「五条玩家原话文案」）。
//
// 为什么要钉死：这几句读起来「不太像文案」（「尝试全部消除吧～」带着一个波浪号），下
// 一个人很容易顺手改成更书面的说法，而那正是玩家不要的。改一个字，这儿当场红。
// 要改先回决策文档改 §8，两边一起动。
{
  const SAID = [
    '色块拼出得分图案会得分翻面，变成其他颜色的星星。',
    '星星可以与色块一同再次拼出得分图案。',
    '得分图案会随着游戏解锁而变化。',
    '同色星星在整体的外边会得分并消除。',
    '尝试全部消除吧～',
  ];
  // 第 4 条按棋盘换一句（i18n 的 TUTORIAL_RULE4），所以这儿用通稿那一份：
  // tutorialRules 的第 4 条只有在知道 shape 的时候才替换，而 SAID 记的是底稿。
  const base = tutorialRules('zhHans', 'circle');
  check('（尺子）中文那一份正好五条', base.length === 5, `${base.length} 条`);
  for (let i = 0; i < SAID.length; i++) {
    // 第 4 条（下标 3）按棋盘换过，这儿只比另外四条逐字；它自己那四副棋盘的说法由
    // check-howto 和 ruleArt 那两道门管。
    if (i === 3) continue;
    check(`第 ${i + 1} 条和玩家原话逐字一致`, base[i] === SAID[i], `「${base[i]}」`);
  }
  // 四种语言条数都要对得上：少一条的话，那一种语言的玩家会少学一条规矩，而且不报错。
  for (const lang of ['en', 'fr', 'zhHans', 'zhHant']) {
    const n = tutorialRules(lang, 'circle').length;
    check(`${lang} 也是五条`, n === 5, `${n} 条`);
  }
}

// ===========================================================================
// 源码里不许再写「六条」（E23 之前那一版的条数）
// ===========================================================================
//
// 教学 2026-09 从六条改成五条（《侵蚀阶梯》v1.2），可**注释跟了半年都没跟上**：
// 2026-10 清的时候，`src/` 和 `xhs/src/` 底下还有二十来处写着「六条规则 / 六条规矩」，
// 分散在十二个文件里。
//
// 这不是吹毛求疵。这个仓库的注释是**当真的**——「棋盘底下那块教学条把六条规矩一条一条
// 讲完」是下一个人判断「这块条子该走几步」的依据，而它是错的。一条说错了的注释比没有
// 注释贵：没有注释的人会去读代码，读到错注释的人直接照着做。
//
// 只拦这两个固定说法，不拦所有「六条」：讲历史的那两处（ruleArt 的「把规则从六条改成
// 五条」、i18n 的「从前那六条讲的是上一套规则」）是对的，不该被拦。
{
  const walk = (dir) => {
    const out = [];
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walk(join(dir, e.name)));
      else if (e.name.endsWith('.ts')) out.push(join(dir, e.name));
    }
    return out;
  };
  const files = [...walk('src'), ...walk('xhs/src')];
  check('（尺子）扫到了源码', files.length > 40, `${files.length} 个 .ts`);
  const stale = files.filter((f) => /六条规则|六条规矩/.test(readFileSync(join(root, f), 'utf8')));
  check('源码里没有哪处还写着「六条规则 / 六条规矩」（现在是五条）',
    stale.length === 0, stale.join(' '));
  // 反面尺子：那两处讲历史的「六条」还在（这一条不是把「六条」两个字赶尽杀绝）。
  const hist = files.filter((f) => /从六条改成五条|从前那六条/.test(readFileSync(join(root, f), 'utf8')));
  check('（尺子）讲历史的那两处「六条」没被误伤', hist.length >= 2, hist.join(' '));
}

// ===========================================================================
// 模拟盘面
// ===========================================================================
//
// 小球那一副的线：和 src/shapes/circle.ts 的 lineA / lineB / lineRow 同一个摆法（七行的三角
// 形，三族线各七条）。外边几何用的是真的 outerEdge.ts，所以「最短外边」不是这儿说了算。
const ROWS = 7;
const lineA = (d) => { const c = []; for (let r = d; r < ROWS; r++) c.push([r, r - d]); return c; };
const lineB = (e) => { const c = []; for (let r = e; r < ROWS; r++) c.push([r, e]); return c; };
const lineRow = (r) => { const c = []; for (let k = 0; k <= r; k++) c.push([r, k]); return c; };
const CIRCLE_LINES = [
  ...Array.from({ length: ROWS }, (_, d) => ({ fam: 'A', offset: d, cells: lineA(d) })),
  ...Array.from({ length: ROWS }, (_, e) => ({ fam: 'B', offset: e, cells: lineB(e) })),
  ...Array.from({ length: ROWS }, (_, r) => ({ fam: 'R', offset: r, cells: lineRow(r) })),
];
let nextId = 1;
const tile = (color, dot = false, blank = false) => ({ id: nextId++, color, dotColor: color, face: dot ? 'dot' : 'flavor', blank });
/** 一副小球：四色各七枚，任何一条线上都没有连着三枚同色（开局本来就不许有现成的组）。 */
function circleBoard() {
  const g = [];
  for (let r = 0; r < ROWS; r++) {
    g.push([]);
    for (let c = 0; c <= r; c++) g[r].push(tile((c + ((r * r + c) % 3)) % 4));
  }
  return g;
}
/**
 * 一副「谁都配不上谁」的小球：每一枚一个独有的颜色。呼吸灯那几节在它上面**只摆想要的那几
 * 组**——四色的盘面上随手一滑就能凑出七八组，「挑的是不是那一组」就量不清了。
 */
function uniqueBoard() {
  const g = [];
  for (let r = 0; r < ROWS; r++) {
    g.push([]);
    for (let c = 0; c <= r; c++) g[r].push(tile(100 + r * ROWS + c));
  }
  return g;
}
const isStar = (t) => !t.blank && t.face === 'dot';
const circleEdgeBoard = (g) => ({ lines: CIRCLE_LINES, isLive: (r, c) => r >= 0 && r < ROWS && c >= 0 && c <= r && !g[r][c].blank });
/** 棋盘那头真用的那一句（circle.ts 的 coachStarsReachEdge）：最短的可削外边 + starsReach。 */
const circleReach = (g) => starsReach(g, shortestEdge(circleEdgeBoard(g), EDGE_MIN), isStar);
/** 一副方块：6×6，六色各六枚。 */
function squareBoard(rows = 6, cols = 6) {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => tile((r * 2 + c) % 6)));
}
/** square.ts 的 coachStarsReachEdge：较短的那条边。 */
const squareReach = (g) => starsReach(g, Math.min(g.length, g[0]?.length ?? 0), isStar);
/** 把某一色的前 n 枚翻成星星。 */
function flipColor(g, color, n) {
  let k = 0;
  for (const row of g) for (const t of row) if (k < n && !t.blank && t.color === color && t.face === 'flavor') { t.face = 'dot'; k++; }
  return k;
}

// ===========================================================================
// 跑起来那一半：条子
// ===========================================================================
const LANG = 'zhHans';
const num = (name) => Number((code(src).match(new RegExp(`const ${name} = (\\d+)`)) || [])[1]);
const RULE1_MS = num('RULE1_MS');
const MIN_READ_MS = num('MIN_READ_MS');
const NEAR_SEGS = num('NEAR_SEGS');
const PEEK_MS = num('PEEK_MS');
head('几个数');
check('第 1 条摆 12 秒（玩家的字面值）', RULE1_MS === 12000, String(RULE1_MS));
check('第 3 条：段数 ≤ 4（玩家的字面值）', NEAR_SEGS === 4, String(NEAR_SEGS));
check('（尺子）读得到「至少读多久」', MIN_READ_MS > 0 && MIN_READ_MS < RULE1_MS, String(MIN_READ_MS));

function mount(plan, shape = 'circle') {
  resetClock();
  const texts = tutorialRules(LANG, shape);
  const stage = makeEl('div');
  stage._cls.add('app--game');
  const host = makeEl('div');
  host.parent = stage;
  stage.childNodes.push(host);
  let changes = 0;
  const bar = mountCoachBar(host, { lang: LANG, shape, plan, onChange: () => changes++ });
  return {
    host,
    bar,
    changes: () => changes,
    /** 这一刻条子上摆的是第几条（tutorialRules 的下标）；藏着回 -1。 */
    rule: () => (host.hidden ? -1 : texts.indexOf(host.querySelector('.coach-text').textContent)),
    segs: () => host.querySelector('.coach-prog').children.length,
    on: () => host.querySelector('.coach-prog').children.filter((c) => c._cls.has('on')).length,
  };
}

head('① 头一局：五个时机依次走一遍（小球的模拟盘面 + 真的侵蚀阶梯）');
{
  const m = mount('first');
  const g = circleBoard();
  const ero = createErosion(tableFor('circle', 28, 4));
  const view = () => ({ segLeft: ero.segLeft(), starsReachEdge: circleReach(g) });
  check('（尺子）条子上的字认得出来', m.rule() >= 0, m.host.querySelector('.coach-text').textContent);
  check('开局就是第 1 条', m.rule() === 0, `第 ${m.rule() + 1} 条`);
  check('进度条五格，亮第一格', m.segs() === 5 && m.on() === 1, `${m.on()} / ${m.segs()}`);
  check('第 1 条的灯：一步能拼出的那几枚色块', m.bar.hint() === 'front', String(m.bar.hint()));
  check('开口那一下喊过一次 onChange（呼吸灯要跟着点）', m.changes() === 1, String(m.changes()));

  // ── 第 2 条：12 秒，不等任何事
  m.bar.observe(view());
  advance(RULE1_MS - 1);
  m.bar.observe(view());
  check('差 1 毫秒满 12 秒：还是第 1 条', m.rule() === 0, `第 ${m.rule() + 1} 条`);
  advance(1);
  check('满 12 秒：自己换到第 2 条（紧跟第 1 条，不等盘面）', m.rule() === 1, `第 ${m.rule() + 1} 条`);
  check('第 2 条的灯：一步能拼出的「星星＋色块」那一组', m.bar.hint() === 'mixed', String(m.bar.hint()));

  // ── 第 3 条：段数 ≤ 4
  // 翻到这一级还剩 NEAR_SEGS + 1 段：从阶梯自己报的段数算，不写死第一级有几段——这儿原先写的
  // 是 25（一版小球那一行），2026-10 二版换表（10-08 方案 3-A）之后第一级是 12 段，写死的数
  // 一换表就把模拟盘面翻过了头，下面那把尺子才是这一节真正量的东西。
  ero.spend(ero.segLeft() - (NEAR_SEGS + 1));
  advance(MIN_READ_MS + 500);
  m.bar.observe(view());
  check(`（尺子）模拟盘面翻到还剩 ${NEAR_SEGS + 1} 段`, ero.segLeft() === NEAR_SEGS + 1 && ero.level() === 4, `第 ${ero.level()} 级剩 ${ero.segLeft()} 段`);
  check(`还剩 ${NEAR_SEGS + 1} 段：第 3 条不出来`, m.rule() === 1, `第 ${m.rule() + 1} 条`);
  ero.spend(1);
  m.bar.observe(view());
  check(`再翻一枚，剩 ${NEAR_SEGS} 段：第 3 条出来`, m.rule() === 2, `第 ${m.rule() + 1} 条（剩 ${ero.segLeft()} 段）`);
  check('第 3 条的灯：一步能拼出的那几枚色块', m.bar.hint() === 'front', String(m.bar.hint()));

  // ── 第 4 条：某色星星 ≥ 最短外边
  const need = shortestEdge(circleEdgeBoard(g), EDGE_MIN);
  check('（尺子）整副小球的最短外边是 7 枚（三条边各 7）', need === 7, String(need));
  flipColor(g, 0, need - 1);
  flipColor(g, 1, need - 1);
  advance(MIN_READ_MS + 500);
  m.bar.observe(view());
  check(`两种颜色各 ${need - 1} 颗星星（都差一颗）：第 4 条不出来`, m.rule() === 2, `第 ${m.rule() + 1} 条`);
  flipColor(g, 0, 1);
  m.bar.observe(view());
  check(`某一色凑够 ${need} 颗：第 4 条出来`, m.rule() === 3, `第 ${m.rule() + 1} 条`);
  check('第 4 条的灯：一步能填满一条外边的那几颗同色星星', m.bar.hint() === 'edge', String(m.bar.hint()));

  // ── 第 5 条：第一次真的消掉一条外边之后
  advance(MIN_READ_MS + 500);
  m.bar.signal('line');
  check('消边那一拍（连锁里）：只记下，不当场换条', m.rule() === 3, `第 ${m.rule() + 1} 条`);
  m.bar.observe(view());
  check('那一步结算完：第 5 条出来', m.rule() === 4, `第 ${m.rule() + 1} 条`);
  check('第 5 条不亮灯', m.bar.hint() === null, String(m.bar.hint()));
  check('进度条走到第五格', m.on() === 5, `${m.on()} / ${m.segs()}`);
  const before = m.changes();
  advance(10 * 60 * 1000);
  m.bar.signal('line');
  m.bar.observe(view());
  check('第 5 条一直留到这一局结束（十分钟后、再消几条都不走）', m.rule() === 4 && m.changes() === before, `第 ${m.rule() + 1} 条`);
  m.bar.destroy();
}

head('② 条件早就满足了：轮到它立刻出来——但上一条要读得完');
{
  const m = mount('first');
  // 开局第一步就把第 3、4、5 条的条件全满足了。
  m.bar.observe({ segLeft: 3, starsReachEdge: true });
  m.bar.signal('line');
  m.bar.observe({ segLeft: 3, starsReachEdge: false }); // 「第一次出现」：之后没了也算出现过
  advance(RULE1_MS - 1);
  check('第 1 条照样摆满 12 秒', m.rule() === 0, `第 ${m.rule() + 1} 条`);
  advance(1);
  check('第 2 条照样出来（它没有条件）', m.rule() === 1, `第 ${m.rule() + 1} 条`);
  advance(MIN_READ_MS - 1);
  check(`第 2 条至少摆 ${MIN_READ_MS}ms（读得完），哪怕第 3 条早就满足了`, m.rule() === 1, `第 ${m.rule() + 1} 条`);
  advance(1);
  check('读够了：第 3 条立刻接上（不用等下一次结算）', m.rule() === 2, `第 ${m.rule() + 1} 条`);
  advance(MIN_READ_MS);
  check('第 4 条：星星早就够过一次（后来没了也算），读够第 3 条立刻接上', m.rule() === 3, `第 ${m.rule() + 1} 条`);
  advance(MIN_READ_MS);
  check('第 5 条：同上', m.rule() === 4, `第 ${m.rule() + 1} 条`);
  check('总共正好 12 秒 + 三段读够', now === RULE1_MS + 3 * MIN_READ_MS, `${now}ms`);
  m.bar.destroy();
}

head('③ 一步之内跨过「剩 4 段」：降级那一声也算');
{
  const m = mount('first');
  advance(RULE1_MS + MIN_READ_MS);
  m.bar.observe({ segLeft: 6, starsReachEdge: false });
  check('（尺子）还剩 6 段：第 3 条不出来', m.rule() === 1);
  // 一步翻了八枚：6 段扣光、降一级，新的一级满格——结算之后看段数，看不出来跨过了 4。
  m.bar.signal('erosion');
  m.bar.observe({ segLeft: 27, starsReachEdge: false });
  check('降了一级（signal erosion）：第 3 条照样出来', m.rule() === 2, `第 ${m.rule() + 1} 条`);
  m.bar.destroy();
}

head('④ 第二副基础棋盘：只讲第 4 条，条件同上（方块的模拟盘面）');
{
  const m = mount('second', 'square');
  const g = squareBoard();
  check('开局不出声，也不亮灯', m.rule() === -1 && m.bar.hint() === null, `${m.rule()} / ${m.bar.hint()}`);
  check('（尺子）方块的最短外边按较短那条边：6×6 是 6', Math.min(g.length, g[0].length) === 6);
  flipColor(g, 2, 5);
  m.bar.observe({ segLeft: 30, starsReachEdge: squareReach(g) });
  advance(5 * 60 * 1000);
  m.bar.observe({ segLeft: 2, starsReachEdge: squareReach(g) });
  check('同色星星 5 颗（差一颗）：五分钟、段数见底都不出声', m.rule() === -1, `${m.rule()}`);
  flipColor(g, 2, 1);
  m.bar.observe({ segLeft: 2, starsReachEdge: squareReach(g) });
  check('凑够 6 颗：开口，讲的是第 4 条', m.rule() === 3, `第 ${m.rule() + 1} 条`);
  check('这一路不画进度条（只讲一条）', m.segs() === 0, `${m.segs()} 格`);
  check('第 4 条的灯：外边那一排星星', m.bar.hint() === 'edge', String(m.bar.hint()));
  m.bar.signal('line');
  advance(60 * 1000);
  m.bar.observe({ segLeft: 2, starsReachEdge: true });
  check('只讲这一条：消了边也不往下走', m.rule() === 3, `第 ${m.rule() + 1} 条`);
  m.bar.destroy();
  // 消掉一行之后盘子变小，门槛跟着变小：5×6 只要 5 颗。
  const g5 = squareBoard(5, 6);
  flipColor(g5, 1, 5);
  check('方块消掉一行（5×6）：门槛跟着变成 5', squareReach(g5) === true);
  const g5b = squareBoard(5, 6);
  flipColor(g5b, 1, 4);
  check('（反面尺子）5×6 上 4 颗不够', squareReach(g5b) === false);
}

head('⑤ 「最短外边」跟着盘面变：小球削掉最外一圈之后');
{
  const g = circleBoard();
  for (let c = 0; c < ROWS; c++) g[ROWS - 1][c].blank = true; // 底下那一排削掉了
  const need = shortestEdge(circleEdgeBoard(g), EDGE_MIN);
  check('（尺子）削掉底下那一排，最短外边变成 6', need === 6, String(need));
  // 挑剩下那几行里最多的那一色（四色各七枚，削掉一排之后各色剩几枚不一样）。
  const left = [0, 1, 2, 3].map((k) => g.flat().filter((t) => !t.blank && t.color === k).length);
  const color = left.indexOf(Math.max(...left));
  check('（尺子）剩下的盘面上有一色至少 6 枚', flipColor(g, color, 6) === 6, `各色剩 ${left.join('/')}`);
  check('同色 6 颗星星就够了', circleReach(g) === true);
  const h = circleBoard();
  for (let c = 0; c < ROWS; c++) h[ROWS - 1][c].blank = true;
  flipColor(h, color, 5);
  check('（反面尺子）5 颗不够', circleReach(h) === false);
  // 两种颜色加起来够、单一种不够：不算。
  const k = circleBoard();
  flipColor(k, 0, 4);
  flipColor(k, 1, 3);
  check('两种颜色加起来 7 颗、单一种不够 7：不算（玩家说的是「某一种颜色」）', circleReach(k) === false);
  // 空位不是星星。
  const b = circleBoard();
  flipColor(b, 0, 6);
  const extra = b[0][0];
  extra.face = 'dot';
  extra.dotColor = 0;
  extra.blank = true;
  check('离场的格子不算星星（哪怕它身上还记着星星那一面）', circleReach(b) === false);
}

head('⑥ 《<》回头看、重开、拆掉');
{
  const m = mount('first');
  advance(RULE1_MS);
  const peek = m.host.querySelector('.coach-peek');
  check('（尺子）第 2 条上有《<》', peek && !peek.hidden);
  peek.fire('click');
  check('按《<》：摆回第 1 条', m.rule() === 0, `第 ${m.rule() + 1} 条`);
  check('回头看不动进度', m.on() === 2, `${m.on()} 格`);
  advance(PEEK_MS);
  check(`${PEEK_MS}ms 不动它：自己回到现在`, m.rule() === 1, `第 ${m.rule() + 1} 条`);
  // 重开：见过的全忘掉。
  m.bar.observe({ segLeft: 1, starsReachEdge: true });
  m.bar.reset();
  check('重开：回到第 1 条、亮第一格', m.rule() === 0 && m.on() === 1, `第 ${m.rule() + 1} 条 / ${m.on()} 格`);
  advance(RULE1_MS + MIN_READ_MS * 3);
  check('重开之后，上一局见过的条件不算数（停在第 2 条）', m.rule() === 1, `第 ${m.rule() + 1} 条`);
  m.bar.destroy();
  check('拆掉之后：不亮灯、条子藏起来', m.bar.hint() === null && m.host.hidden === true);
  advance(10 * 60 * 1000);
  m.bar.observe({ segLeft: 0, starsReachEdge: true });
  check('拆掉之后再报什么都不复活', m.host.hidden === true);
}

// ===========================================================================
// 呼吸灯的零件（engine/coachHint.ts），模拟盘面
// ===========================================================================
//
// 认组那一步在真棋盘里是棋盘自己的 findMatches；这儿换成一把手写的 1×N 尺子（同色连着
// ≥ N 枚、至少一枚是色块、碰到这一步动过的那条线），量的是**接线**：走法是不是残局穷举
// 那一套、组是不是映射回了此刻的位置（要滑过去的那一枚在不在里面）、同一组是不是只算一
// 次、超时是不是真的放弃、挑组是不是「保留 → 最近 → 熄灭」。
const eff = (t) => (t.face === 'dot' ? t.dotColor : t.color);
function runsOn(lines, n) {
  return (trial, moved) => {
    const out = [];
    for (const { cells } of lines) {
      let i = 0;
      while (i < cells.length) {
        const [r0, c0] = cells[i];
        const t0 = trial[r0][c0];
        if (t0.blank) { i++; continue; }
        let j = i + 1;
        while (j < cells.length && !trial[cells[j][0]][cells[j][1]].blank && eff(trial[cells[j][0]][cells[j][1]]) === eff(t0)) j++;
        const run = cells.slice(i, j);
        if (run.length >= n && run.some(([r, c]) => trial[r][c].face === 'flavor') && run.some(([r, c]) => moved.has(r + ',' + c))) out.push(run);
        i = j;
      }
    }
    return out;
  };
}
const keyOf = (ids) => ids.slice().sort((a, b) => a - b).join(',');
const cellsKey = (cells) => cells.map(([r, c]) => r + ',' + c).sort().join(' ');

head('⑦ 一层穷举：找到那一组、映射回此刻的位置');
{
  const g = uniqueBoard();
  // 第 3 列（lineB(3)）上面三枚摆成红色，底下那一格摆蓝色；红色那一枚放在它右边隔壁——底
  // 下那一行往左滑一格，它就补进那个空当，竖着连成四枚。
  for (const [r, c] of [[3, 3], [4, 3], [5, 3], [6, 4]]) g[r][c] = tile(0);
  g[6][3] = tile(1);
  const judge = runsOn(CIRCLE_LINES, 4);
  const noMove = judge(g, new Set(CIRCLE_LINES.flatMap((l) => l.cells.map(([r, c]) => r + ',' + c))));
  check('（尺子）摆好的这副盘面上此刻没有现成的组', noMove.length === 0, noMove.map(cellsKey).join(' | '));
  const step = oneStepMoves(CIRCLE_LINES.map((l) => l.cells), (r, c) => !g[r][c].blank);
  check('（尺子）走法来自 residueBoard：21 条线、每条线 1…n−1 格', step.moves.length === CIRCLE_LINES.reduce((a, l) => a + l.cells.length - 1, 0),
    `${step.moves.length} 种`);
  const cands = oneStepGroups(g, step, judge, 1e9);
  const want = [[3, 3], [4, 3], [5, 3], [6, 4]];
  const wantIds = keyOf(want.map(([r, c]) => g[r][c].id));
  const found = cands.find((x) => keyOf(x.ids) === wantIds);
  check('找到了那一组（四枚红色），而且只有这一组', !!found && cands.length === 1, `${cands.length} 组`);
  check('映射回此刻的位置：要滑过去的那一枚（6,4）在里面，它要去的那一格（6,3）不在',
    !!found && cellsKey(found.cells) === cellsKey(want), found ? cellsKey(found.cells) : '');
  check('ids 和 cells 一一对应（同一个顺序）', !!found && found.ids.every((id, i) => g[found.cells[i][0]][found.cells[i][1]].id === id));
  const keys = cands.map((x) => keyOf(x.ids));
  check('同一组被几种滑法凑出来只算一次', new Set(keys).size === keys.length, `${keys.length} 组 / ${new Set(keys).size} 种`);
  check('它是一组色块（第 1、3 条那一种）', !!found && matchKind(found.cells.map(([r, c]) => g[r][c].face)) === 'front');
  // 把上面那三枚里的一枚换成同色星星：同一步凑出来的就是「星星＋色块」。
  g[4][3].face = 'dot';
  const mixed = oneStepGroups(g, step, judge, 1e9).find((x) => keyOf(x.ids) === wantIds);
  check('换一枚成同色星星：同一组变成「星星＋色块」（第 2 条那一种）',
    !!mixed && matchKind(mixed.cells.map(([r, c]) => g[r][c].face)) === 'mixed');
  check('全是星星的一组不算任何一种（§1.1：图案里至少要有一枚色块）', matchKind(['dot', 'dot', 'dot']) === null);
  // 盘面原样没动。
  check('试走不改盘面（g 里那几枚还在原处）', g[6][3].color === 1 && g[6][4].color === 0);
}

head('⑧ 单次超过 8ms 就跳过这一次');
{
  check('预算是玩家定的 8ms', HINT_BUDGET_MS === 8, String(HINT_BUDGET_MS));
  const g = circleBoard();
  const step = oneStepMoves(CIRCLE_LINES.map((l) => l.cells), () => true);
  let t = 0;
  const slow = () => (t += 3); // 每问一次钟走 3ms
  check('算到一半超时：回 null（不是半截结果）', oneStepGroups(g, step, runsOn(CIRCLE_LINES, 4), HINT_BUDGET_MS, slow) === null);
  t = 0;
  check('（反面尺子）钟不走就算得完', Array.isArray(oneStepGroups(g, step, runsOn(CIRCLE_LINES, 4), HINT_BUDGET_MS, () => 0)));
  // 灯那一层：超时就熄，不留上一副盘面的那一组。
  let clock = 0;
  let tick = 0;
  const board = {
    grid: () => g,
    moves: () => step,
    groupsFor: () => runsOn(CIRCLE_LINES, 3),
    centerOf: ([r, c]) => [c * 10 - r * 5, r * 10],
    boardCenter: () => [0, 30],
  };
  const glow = createCoachGlow(board, () => (clock += tick));
  glow.update('front');
  const litBefore = g.flat().filter((x) => glow.lit(x.id)).length;
  check('（尺子）钟不走：亮了一组', litBefore >= 3, `${litBefore} 枚`);
  tick = 5;
  glow.update('front');
  check('这一次超时：熄灯，不留上一组', g.flat().filter((x) => glow.lit(x.id)).length === 0);
}

head('⑨ 挑组：仍然有效就保留 → 离手指最近 → 一组都没有就熄');
{
  const A = { ids: [1, 2, 3], cells: [[0, 0], [0, 1], [0, 2]] };
  const B = { ids: [7, 8, 9], cells: [[5, 0], [5, 1], [5, 2]] };
  const at = ([r, c]) => [c * 10, r * 10];
  check('手指在下面：挑下面那一组', pickGroup([A, B], null, [10, 50], at) === B);
  check('手指在上面：挑上面那一组', pickGroup([A, B], null, [10, 0], at) === A);
  check('正在亮的那一组仍然有效：保留它（哪怕手指离另一组更近）', pickGroup([A, B], new Set([1, 2, 3]), [10, 50], at) === A);
  check('正在亮的那一组失效了：换成离手指最近的一组', pickGroup([A, B], new Set([1, 2, 4]), [10, 50], at) === B);
  check('一组都没有：熄灭', pickGroup([], new Set([1, 2, 3]), [0, 0], at) === null);
  check('「离手指多远」量的是最近的那一枚，不是一组的中心',
    pickGroup([{ ids: [1, 2, 3, 4, 5], cells: [[0, 0], [0, 10], [0, 20], [0, 30], [0, 40]] }, { ids: [6], cells: [[2, 2]] }], null, [0, 0], at).ids[0] === 1);
  // 灯那一层：熄了之后（结算期间）也记着刚才那一组，下一次重算先认它。只摆两组：右下一组
  // 红色（底下那一行往左一格）、左上一组绿色（第 3 行往左一格）。
  const g = uniqueBoard();
  for (const [r, c] of [[3, 3], [4, 3], [5, 3], [6, 4]]) g[r][c] = tile(0);
  g[6][3] = tile(1);
  for (const [r, c] of [[0, 0], [1, 0], [2, 0]]) g[r][c] = tile(2);
  g[3][1] = tile(2); // 左上角那一组：第 0 列再补一枚就是四枚
  const step = oneStepMoves(CIRCLE_LINES.map((l) => l.cells), (r, c) => !g[r][c].blank);
  const both = oneStepGroups(g, step, runsOn(CIRCLE_LINES, 4), 1e9);
  check('（尺子）这副盘面一步之内正好两组：一组红、一组绿',
    both.length === 2 && new Set(both.map((x) => eff(g[x.cells[0][0]][x.cells[0][1]]))).size === 2, `${both.length} 组`);
  const centers = ([r, c]) => [c * 20 - r * 10 + 100, r * 18];
  const board = { grid: () => g, moves: () => step, groupsFor: () => runsOn(CIRCLE_LINES, 4), centerOf: centers, boardCenter: () => [100, 60] };
  const glow = createCoachGlow(board, () => 0);
  glow.touch(...centers([6, 4]));
  glow.update('front');
  const red = [[3, 3], [4, 3], [5, 3], [6, 4]].map(([r, c]) => g[r][c].id);
  check('（尺子）手指在右下：亮的是右下那一组红色', red.every((id) => glow.lit(id)), g.flat().filter((x) => glow.lit(x.id)).map((x) => x.id).join(','));
  glow.update(null);
  check('熄灯（一步正在结算）：一枚都不亮', g.flat().every((x) => !glow.lit(x.id)));
  glow.touch(...centers([0, 0]));
  glow.update('front');
  check('结算完那组仍然有效：接着亮它（哪怕手指已经挪到左上）', red.every((id) => glow.lit(id)));
  const lit = g.flat().filter((x) => glow.lit(x.id));
  check('同一时间只亮一组、一种颜色', new Set(lit.map(eff)).size === 1 && lit.length === 4, lit.map((x) => eff(x)).join(','));
  // 那一组失效（底下那枚红色被别的颜色换掉）：换成离手指最近的。
  g[6][4] = tile(3);
  glow.update('front');
  const now2 = g.flat().filter((x) => glow.lit(x.id));
  check('那一组失效：换成离手指最近的那一组', now2.length >= 4 && now2.every((x) => eff(x) === 2), now2.map((x) => eff(x)).join(','));
  glow.reset();
  check('重开一局：灯和记性一起清掉', g.flat().every((x) => !glow.lit(x.id)));
}

head('⑩ 一盏灯亮的是这一步结算时动到的全部，格子 + 星星（10-08 方案 3-E-2）');
{
  // 按种类分的三把尺子，和真棋盘一个口径（square.ts / circle.ts 的 groupsFor：front、mixed 是同一
  // 套认组再按 matchKind 分开，edge 另一把）。这儿只摆 front、mixed 两种组，edge 那把回空。
  const kindRuler = (n) => (kind) =>
    kind === 'edge'
      ? () => []
      : (trial, moved) =>
          runsOn(CIRCLE_LINES, n)(trial, moved).filter((cells) => matchKind(cells.map(([r, c]) => trial[r][c].face)) === kind);
  const g = uniqueBoard();
  // 右边：第 3 列那一组红色（同 ⑦）——底下那一行往左一格，(6,4) 补进 (6,3)。
  for (const [r, c] of [[3, 3], [4, 3], [5, 3], [6, 4]]) g[r][c] = tile(0);
  g[6][3] = tile(1);
  // 左边：第 1 列那一组绿色，中间那一枚是星星——**同一步**里 (6,2) 补进 (6,1)。
  for (const [r, c] of [[3, 1], [5, 1], [6, 2]]) g[r][c] = tile(2);
  g[4][1] = tile(2, true);
  g[6][1] = tile(3);
  const step = oneStepMoves(CIRCLE_LINES.map((l) => l.cells), (r, c) => !g[r][c].blank);
  const centers = ([r, c]) => [c * 20 - r * 10 + 100, r * 18];
  const board = { grid: () => g, moves: () => step, groupsFor: kindRuler(4), centerOf: centers, boardCenter: () => [100, 60] };
  const red = [[3, 3], [4, 3], [5, 3], [6, 4]].map(([r, c]) => g[r][c].id);
  const green = [[3, 1], [4, 1], [5, 1], [6, 2]].map(([r, c]) => g[r][c].id);
  const litIds = (glow) => g.flat().filter((x) => glow.lit(x.id)).map((x) => x.id);
  // 尺子：两组各是一种（红的全是色块、绿的带星星），一层之内各只有这一组。
  const fronts = oneStepGroups(g, step, kindRuler(4)('front'), 1e9);
  const mixeds = oneStepGroups(g, step, kindRuler(4)('mixed'), 1e9);
  check('（尺子）一步之内：红的那组全是色块、绿的那组带星星，各只有一组',
    fronts.length === 1 && keyOf(fronts[0].ids) === keyOf(red) && mixeds.length === 1 && keyOf(mixeds[0].ids) === keyOf(green),
    `front ${fronts.length} 组 / mixed ${mixeds.length} 组`);
  const glow = createCoachGlow(board, () => 0);
  glow.update('front');
  const lit = litIds(glow);
  // 改坏法：灯只认这一条讲的那一种组（从前那样），这里只亮红的四枚。
  check('讲第 1 条：同一步顺带凑出的那组带星星的也亮——八枚全亮', keyOf(lit) === keyOf([...red, ...green]), `亮了 ${lit.length} 枚`);
  check('亮的里头有星星（格子 + 星星）', lit.some((id) => g.flat().find((x) => x.id === id).face === 'dot'));
  check('要滑过去的那两枚 (6,4)、(6,2) 都在里面（映射回此刻的位置）', [g[6][4].id, g[6][2].id].every((id) => glow.lit(id)));
  glow.reset();
  glow.update('mixed');
  check('讲第 2 条：同一步里那组全是色块的红色也亮', keyOf(litIds(glow)) === keyOf([...red, ...green]), `亮了 ${litIds(glow).length} 枚`);
  // 「哪些步算数」照旧按条认：拆掉红的那一组（底下那一枚红色换成别的），这一步只凑得出带星星
  // 的那一组——讲第 1 条时它不算数，一枚都不亮；讲第 2 条时只亮绿的四枚。
  g[6][4] = tile(4);
  glow.reset();
  glow.update('front');
  check('这一步凑不出全是色块的组：讲第 1 条一枚都不亮（哪几步算数没变）', g.flat().every((x) => !glow.lit(x.id)));
  glow.update('mixed');
  check('讲第 2 条：只亮绿的那四枚', keyOf(litIds(glow)) === keyOf(green), `亮了 ${litIds(glow).length} 枚`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
