/**
 * 棋盘底下那块教学条：五条各在自己的时机出来，呼吸灯亮对那一组（10-11 方案 D-1 ～ D-4 重写）。
 *
 *   npx esbuild src/ui/coachBar.ts          --bundle --format=esm --outfile=/tmp/coach.mjs
 *   npx esbuild src/i18n.ts                 --bundle --format=esm --outfile=/tmp/i18n.mjs
 *   npx esbuild src/engine/coachHint.ts     --bundle --format=esm --outfile=/tmp/coachhint.mjs
 *   npx esbuild src/engine/outerEdge.ts     --bundle --format=esm --outfile=/tmp/outeredge.mjs
 *   npx esbuild src/engine/erosion.ts       --bundle --format=esm --outfile=/tmp/erosion.mjs
 *   npx esbuild src/engine/residueBoard.ts  --bundle --format=esm --outfile=/tmp/resboard.mjs
 *   npx esbuild src/engine/scoreOutline.ts  --bundle --format=esm --outfile=/tmp/scoreoutline.mjs
 *   node scripts/check-coach.mjs /tmp/coach.mjs /tmp/i18n.mjs /tmp/coachhint.mjs \
 *     /tmp/outeredge.mjs /tmp/erosion.mjs /tmp/resboard.mjs /tmp/scoreoutline.mjs
 *
 * ── 10-11 方案 D-1 定的五条（玩家规格 ＋ 10-11 答复）─────────────────────────
 *
 *   A  开局就讲，配一段动画（本局三种颜色的 1×N 依次慢翻过去再翻回来），不亮灯   10 秒，或第一次得分
 *   B  呼吸灯：当前 N 的任意一组                                                 图案第一次真的降级那一步结算完
 *   C  呼吸灯：按新图案亮一组，只算一次；HUD 那块《得分图案》一起亮              默认 10 秒；「某色星星 ≥ 最短外边」
 *                                                                               成立起 5 秒，总长不超过 10 秒
 *   D  呼吸灯：那一色在场的所有星星                                             从它出现起消掉两次整条外边
 *   E  不亮                                                                     留到这一局结束
 *
 * 所有计时随暂停冻结。第二副基础棋盘只讲 D，场上第一次出现「某色星星 ≥ 最短外边」时开口。
 *
 * 这道门**用模拟盘面**把五个时机依次走一遍：「星星够不够一条外边」来自真的外边几何（outerEdge.ts 的
 * outerEdges）加棋盘真用的那个判法（coachHint.ts 的 starClearHintFor），降级来自真的侵蚀阶梯（erosion.ts）。
 * 时钟是假的（10 秒、5 秒都要量准到毫秒），DOM 也是这儿自己搭的一份够用的——几十毫秒、跑得进 CI。
 *
 * 呼吸灯（⑦–⑪）：IDA* 按颜色算精确的最少步数、挑色（不跳色 → 含星星 → 盘面哈希）、亮哪几枚（B / C 正好 N 枚，
 * D 是那一色所有的星星、一枚色块都不亮）、中间得分就剪掉、超了上限退回估值、分段跑、算完才亮、C 只算一次，在
 * 手摆的盘面上钉住。认组那一步用的是这儿手写的一把 1×N 尺子，**不是**棋盘真的 findMatches——拿真棋盘、两百副
 * 真局面逐个比对的是 check-coach-plan（10-11 方案 D-5 第 1 条），真浏览器里那一半在 check-coach-aim。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [coachBundle, i18nBundle, hintBundle, edgeBundle, erosionBundle, resBundle, outlineBundle] = process.argv.slice(2);
if (!outlineBundle) {
  console.log(
    '用法: node scripts/check-coach.mjs <coachBar.mjs> <i18n.mjs> <coachHint.mjs> <outerEdge.mjs> <erosion.mjs> <residueBoard.mjs> <scoreOutline.mjs>',
  );
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
    add: (...cs) => cs.forEach((c) => node._cls.add(c)),
    remove: (...cs) => cs.forEach((c) => node._cls.delete(c)),
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

/** frame() 吐出来的那点标签：div / span / p / button，class 和光秃秃的 hidden。配图里的 svg 也照这样收。 */
function parseHTML(html, parent) {
  const out = [];
  const stack = [{ childNodes: out, _isRoot: true }];
  const tagRe = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, close, tag, attrStr, selfClose] = m;
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = makeEl(tag);
    for (const a of attrStr.matchAll(/([a-zA-Z:-]+)(?:="([^"]*)")?/g)) {
      const [, name, val] = a;
      if (name === 'class') String(val || '').split(/\s+/).filter(Boolean).forEach((c) => node._cls.add(c));
      else if (name === 'hidden') node.hidden = true;
      else node.setAttribute(name, val ?? '');
    }
    const top = stack[stack.length - 1];
    top.childNodes.push(node);
    node.parent = top._isRoot ? parent : top;
    if (!selfClose && !/^(path|circle|rect|line|polygon|polyline|ellipse|use|stop)$/i.test(tag)) stack.push(node);
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
  addEventListener() {},
  removeEventListener() {},
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

const coachMod = await import(coachBundle);
const { mountCoachBar, HINT_OF, A_MS, C_MS, C_AFTER_REACH_MS, D_LINES } = coachMod;
const { tutorialRules, STRINGS } = await import(i18nBundle);
// 教学条那颗《<》的读屏名，四语各一个专用的（10-08 方案第四批第 8 条：上一条 / Previous / Précédent / 上一條）
{
  // 英法 10-09 补充方案 7-14 补全了：光念「Previous / Précédent」不知道是上一个什么。
  const want = { zhHans: '上一条', en: 'Previous tip', fr: 'Conseil précédent', zhHant: '上一條' };
  const got = Object.fromEntries(Object.keys(want).map((l) => [l, STRINGS[l]?.coachPrev]));
  const bad = Object.keys(want).filter((l) => got[l] !== want[l]);
  check('四语都有教学条《<》专用的读屏名（coachPrev）', bad.length === 0, JSON.stringify(got));
}
const hint = await import(hintBundle);
const {
  planGroup,
  planEdge,
  groupH,
  edgeH,
  boardHash,
  createSliceRunner,
  createCoachGlow,
  starClearHintFor,
  HINT_NODE_CAP,
  HINT_MAX_DEPTH,
  SLICE_MS,
} = hint;
const { outerEdges, shortestEdge, EDGE_MIN } = await import(edgeBundle);
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
  check('信号就是 D-1 要的那三件事：第一次得分（A）、降级（B）、消边（D）', vocab.slice().sort().join() === 'erosion,line,score', vocab.join(' '));
  const called = new Map();
  for (const file of TS) {
    for (const m of code(readFileSync(file, 'utf8')).matchAll(/\bsignal\(\s*'([a-z]+)'\s*(?:,[^)]*)?\)/g)) {
      const rel = file.slice(root.length + 1);
      if (!called.has(m[1])) called.set(m[1], []);
      if (!called.get(m[1]).includes(rel)) called.get(m[1]).push(rel);
    }
  }
  check('每一处 signal() 报的都是词表里的词（没有写错的字符串）',
    [...called.keys()].every((c) => vocab.includes(c)),
    [...called.keys()].filter((c) => !vocab.includes(c)).join(',') || [...called.keys()].join(' '));
  const orphan = vocab.filter((v) => !called.has(v));
  check('词表里的词都有人报', orphan.length === 0,
    orphan.length ? `没人报：${orphan.join(',')}` : vocab.map((v) => `${v}←${called.get(v).join('/')}`).join(' '));

  const gc = code(read('src/engine/gameController.ts'));
  check('每一步结算完，gameController 把「星星够不够一条外边」交给条子（observe），段数不再交（B 等的是降级那一声）',
    /coach\.observe\(\{\s*starsReachEdge: hooks\.coachStarsReachEdge\?\.\(\) \?\? false\s*\}\)/.test(gc) && !/segLeft: erosion\.segLeft\(\),\s*starsReachEdge/.test(gc));
  check('一步开始结算时作废没算完的那一份、灯先熄（resolveMove 里 coachGlowCancel），结算完再点（refreshCoachGlow）',
    /resolving = true;[\s\S]{0,300}hooks\.coachGlowCancel\?\.\(\)/.test(gc) && /coach\.observe\([\s\S]{0,200}refreshCoachGlow\(\)/.test(gc));
  check('得分那一拍报 score、消边那一拍报 line（带条数）、降级那一下报 erosion',
    /coach\?\.signal\('score'\)/.test(gc) && /coach\?\.signal\('line', s\.lineBonusGroups\.length\)/.test(gc) && /coach\?\.signal\('erosion'\)/.test(gc));
  check('暂停 / 继续时条子的计时一起停、一起走（doPause → coach.pause，doResume → coach.resume）',
    /function doPause\(\)[\s\S]{0,400}coach\?\.pause\(\)/.test(gc) && /function doResume\(\)[\s\S]{0,300}coach\?\.resume\(\)/.test(gc));
  check('C 那一条 HUD 那块《得分图案》一起亮（refreshCoachGlow 按 groupOnce 挂 coach-glow-block），局终摘掉',
    /classList\.toggle\('coach-glow-block', hint === 'groupOnce'\)/.test(gc) && /classList\.remove\('coach-glow-block'\)/.test(gc));
  check('开局倒数时预热一遍（coachPrewarm），离开时还没开跑的预热也撤掉',
    /window\.setTimeout\(\(\) => hooks\.coachPrewarm\?\.\(\), 0\)/.test(gc) && /window\.clearTimeout\(prewarmTimer\)/.test(gc));
  check('从前「没算完过 300ms 再试」那一套拆了（GLOW_RETRY_MS / glowRetryTimer）', !/GLOW_RETRY|glowRetry/.test(gc));
  for (const f of ['square', 'circle']) {
    const t = code(read(`src/shapes/${f}.ts`));
    check(`${f}.ts：接了呼吸灯（request / cancel / prewarm / 三种颜色）、D 讲不讲按 starClearHintFor、颜色按 effColor、走法来自 oneStepMoves、预热盘面不碰发牌那串随机数`,
      /coachGlow: \(kind\) => glow\.request\(kind\)/.test(t) && /coachGlowCancel: \(\) => glow\.cancel\(\)/.test(t) &&
        /coachPrewarm: \(\) => glow\.prewarm\(\)/.test(t) && /coachColors: \(\) =>/.test(t) && /\bcoachStarsReachEdge,/.test(t) &&
        /starClearHintFor<Tile>\(\{/.test(t) && /return coachStarClear\(\) !== null;/.test(t) && /colorOf: effColor,/.test(t) &&
        /oneStepMoves\(/.test(t) && /scratch: \(\) => withGrid\(withScratchRandom\('coach-prewarm', generateCleanBoard\), glowView\)/.test(t));
  }

  const plan = (name) => {
    const m = code(src).match(new RegExp(`\\b${name}: \\[([^\\]]*)\\]`));
    return m ? m[1].split(',').map((x) => Number(x.trim())) : null;
  };
  check('头一局：五条按顺序，一次一条', JSON.stringify(plan('first')) === '[0,1,2,3,4]', JSON.stringify(plan('first')));
  check('第二副基础棋盘：只讲 D', JSON.stringify(plan('second')) === '[3]', JSON.stringify(plan('second')));
  check('灯：A 不亮，B 拼一组，C 拼一组只算一次，D 外边，E 不亮',
    JSON.stringify(HINT_OF) === '[null,"group","groupOnce","edge",null]', JSON.stringify(HINT_OF));
  check('几个数是玩家的字面值：A 10 秒、C 10 秒、C 条件满足后 5 秒、D 消两次', A_MS === 10000 && C_MS === 10000 && C_AFTER_REACH_MS === 5000 && D_LINES === 2,
    `${A_MS} / ${C_MS} / ${C_AFTER_REACH_MS} / ${D_LINES}`);
  check('从前那几样拆了：第 1 条 12 秒（RULE1_MS）、每条至少读 6 秒（MIN_READ_MS）、剩 ≤4 段讲第 3 条（NEAR_SEGS）',
    !/RULE1_MS|MIN_READ_MS|NEAR_SEGS|segLeft/.test(code(src)), '');
  const hintSrc = code(read('src/engine/coachHint.ts'));
  check('搜索的上限是 D-4 的数：十几万个盘面（不再有 15ms 的硬上限）、每段 ≤ 3ms',
    HINT_NODE_CAP >= 100000 && HINT_NODE_CAP < 200000 && SLICE_MS === 3 && !/HINT_BUDGET_MS/.test(hintSrc), `${HINT_NODE_CAP} / ${SLICE_MS}ms`);
  check('从前那套（reachByColor / pickColor / matchKind：一次只看 3 步、超了 15ms 就不亮）整个拆了',
    !/\breachByColor\b|\bpickColor\b|\bmatchKind\b/.test(hintSrc) && !('reachByColor' in hint) && !('pickColor' in hint) && !('matchKind' in hint));
}

head('静态：拆掉的那几样，一样都不许留着；灯只动 filter');
{
  const ts = TS.map((f) => [f.slice(root.length + 1), code(readFileSync(f, 'utf8'))]);
  const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const hit = (re) => ts.filter(([, t]) => re.test(t)).map(([f]) => f);
  const demo = hit(/\bonDemo\b|\.demo\(|\bdemo\(on/);
  check('E24 的演示（onDemo、patternBlock 的 demo）拆了', demo.length === 0, demo.join(' '));
  check('样式里的演示（.pat-block--demo）拆了', !/pat-block--demo/.test(css));
  const store = hit(/setCoachStoreKey|erosionTaught|MAKEUP_EROSION|slides_coach_ero|coach\.ero/);
  check('「做到过才算讲过」那格存档拆了（第二副棋盘不再补讲降级那一条）', store.length === 0, store.join(' '));
  const aim = hit(/coach-aim/);
  check('从前那一版的「讲到哪条点亮哪样东西」（coach-aim）没回来：源码里没有', aim.length === 0, aim.join(' '));
  check('样式里也没有 coach-aim', !/coach-aim/.test(css));
  const nudge = hit(/coachNudge/);
  check('「22 秒后换一句」那句文案四种语言一起删了（coachNudge）', nudge.length === 0, nudge.join(' '));
  check('（尺子）灯在样式里：.coach-glow 挂的是加亮一档的 glow-pulse-coach，只动 filter',
    /\.coach-glow:not\(\.piece-grabbed\)\s*\{[^}]*animation:\s*glow-pulse-coach/.test(css) &&
      /@keyframes glow-pulse-coach\s*\{[^@]*drop-shadow/.test(css));
  // 不加任何热区：凡是选择器里带 coach-glow 的规则，只许是下面这几条（棋子那一条、C 那一条的图案块，和它们减弱
  // 动态效果那一份），只许动 filter / animation / will-change / --glow。伪元素（::after 往外伸一圈）、outline、
  // pointer-events……一样都不许——那些都会让手指按到的东西变多。
  const ALLOWED = new Set([
    '.app--game .board .coach-glow:not(.piece-grabbed)',
    '.app--game .hud-block--pattern.coach-glow-block',
    '.app--game .hud-block--pattern.coach-glow-block.hud-block--punch',
  ]);
  const glowRules = [...css.matchAll(/([^{}]*coach-glow[^{}]*)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const sels = glowRules.flatMap(([sel]) => sel.split(',').map((x) => x.trim()));
  const badSel = sels.filter((sel) => !ALLOWED.has(sel));
  check('（尺子）读得到灯的那几条规则', glowRules.length >= 4, String(glowRules.length));
  check('带 coach-glow 的选择器只有那几个（不许伪元素、不许换个写法另加一条）', badSel.length === 0, badSel.join(' | '));
  const props = glowRules.flatMap(([, body]) => [...body.matchAll(/([-\w]+)\s*:/g)].map((m) => m[1]));
  const extra = props.filter((p) => !['filter', 'animation', 'will-change', '--glow'].includes(p));
  check('灯那几条规则只动 filter（animation / will-change / --glow 之外一样都没有）', extra.length === 0 && props.includes('animation'),
    extra.join(',') || props.join(','));
  check('C 那一条的图案块：挂上 coach-glow-block 就跑 glow-pulse-coach；和降级那一下弹（pat-punch）同时在时写成一张列表，弹不被掐掉',
    /\.app--game \.hud-block--pattern\.coach-glow-block\s*\{[^}]*animation:\s*glow-pulse-coach/.test(css) &&
      /\.app--game \.hud-block--pattern\.coach-glow-block\.hud-block--punch\s*\{[^}]*animation:\s*pat-punch[^;]*,\s*glow-pulse-coach/.test(css));
  // 小球外边带子的呼吸：时长在两处（样式表的 animation、edgeBand.ts 接相位用的那个数），
  // 两处差一点，每走一步重画时带子就会跳一下。
  const bandMs = Number((code(read('src/ui/edgeBand.ts')).match(/BAND_BREATHE_MS = (\d+)/) || [])[1]);
  const cssS = Number((css.match(/\.edge-band \{ animation: edge-band-breathe ([\d.]+)s/) || [])[1]);
  check('外边带子呼吸的时长：样式表和 edgeBand.ts 的 BAND_BREATHE_MS 是同一个数', bandMs > 0 && Math.abs(cssS * 1000 - bandMs) < 1,
    `${cssS}s / ${bandMs}ms`);
  check('那条呼吸只给小球（[data-shape="circle"]）', /\.app--game\[data-shape="circle"\] \.edge-band \{ animation: edge-band-breathe/.test(css));
  check('减弱动态效果时：静止光晕，不跑动画（棋子、图案块都是）',
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.app--game \.board \.coach-glow:not\(\.piece-grabbed\)\s*\{\s*animation: none;\s*filter: drop-shadow/.test(css) &&
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.app--game \.hud-block--pattern\.coach-glow-block,\s*\.app--game \.hud-block--pattern\.coach-glow-block\.hud-block--punch\s*\{\s*animation: none;\s*filter: drop-shadow/.test(css));
  check('A 那一段动画：三行轮流翻（ra-cyc，三行各错开三分之一），手机上也摆出来（coach-bar--anim 那一档 coach-art 不收）',
    /@keyframes ra-cyc\s*\{/.test(css) && /\.ra-cyc1\s*\{[^}]*animation-delay/.test(css) && /\.ra-cyc2\s*\{[^}]*animation-delay/.test(css) &&
      /\.coach-bar\.coach-bar--rules\.coach-bar--anim \.coach-art\s*\{[^}]*display:\s*flex/.test(css));
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
//
// 第 1 条 10-11 改过一次（方案 B-8.2，玩家 Q5 定案）：「…会得分翻面，变成其他颜色的星星」→「…就翻面，变成星星」。
// 星星不一定是别的颜色——方块每色 6 枚里有 1 枚翻过去还是同色，小球 7 中 1，三角 9 中 4。§8 一起改了。
{
  const SAID = [
    '色块拼出得分图案就翻面，变成星星。',
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
  const walkTs = (dir) => {
    const out = [];
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walkTs(join(dir, e.name)));
      else if (e.name.endsWith('.ts')) out.push(join(dir, e.name));
    }
    return out;
  };
  const files = [...walkTs('src'), ...walkTs('xhs/src')];
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
/** 棋盘那头真用的那一句（circle.ts 的 coachStarClear）：此刻削得动的那几条外边交给 starClearHintFor。 */
const circleReach = (g) =>
  starClearHintFor({ grid: g, edges: outerEdges(circleEdgeBoard(g), EDGE_MIN).map((e) => e.live), isStar, colorOf: (t) => t.dotColor }) !== null;
/** 一副方块：6×6，六色各六枚。 */
function squareBoard(rows = 6, cols = 6) {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => tile((r * 2 + c) % 6)));
}
/** square.ts 的 coachStarClear：每一整行、每一整列都是「外边」（最短的那条就是较短的那条边）。 */
const squareReach = (g) => {
  const rows = g.length;
  const cols = g[0]?.length ?? 0;
  const edges = [
    ...Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => [r, c])),
    ...Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => [r, c])),
  ];
  return starClearHintFor({ grid: g, edges, isStar, colorOf: (t) => t.dotColor }) !== null;
};
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
const PEEK_MS = Number((code(src).match(/const PEEK_MS = (\d+)/) || [])[1]);

function mount(plan, shape = 'circle', colors) {
  resetClock();
  const texts = tutorialRules(LANG, shape);
  const stage = makeEl('div');
  stage._cls.add('app--game');
  const host = makeEl('div');
  host.parent = stage;
  stage.childNodes.push(host);
  let changes = 0;
  const bar = mountCoachBar(host, { lang: LANG, shape, plan, colors, onChange: () => changes++, now: () => now });
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
const nameOf = (i) => (i < 0 ? '（藏着）' : 'ABCDE'[i]);

head('① 头一局：五条依次走一遍（小球的模拟盘面 + 真的侵蚀阶梯）');
{
  const COLORS3 = ['#aa0000', '#00aa00', '#0000aa'];
  const m = mount('first', 'circle', COLORS3);
  const g = circleBoard();
  const ero = createErosion(tableFor('circle', 28, 4));
  const view = () => ({ starsReachEdge: circleReach(g) });
  check('（尺子）条子上的字认得出来', m.rule() >= 0, m.host.querySelector('.coach-text').textContent);
  check('开局就是 A', m.rule() === 0, nameOf(m.rule()));
  check('进度条五格，亮第一格', m.segs() === 5 && m.on() === 1, `${m.on()} / ${m.segs()}`);
  check('A 不亮灯', m.bar.hint() === null, String(m.bar.hint()));
  check('开口那一下喊过一次 onChange（呼吸灯要跟着重算）', m.changes() === 1, String(m.changes()));
  // A 那一幅：本局三种颜色、三行各四枚、轮流翻（ra-cyc0 / 1 / 2），手机上也摆（coach-bar--anim）。
  const art = m.host.querySelector('.coach-art');
  const cyc = art.querySelectorAll('.ra-cyc');
  const rowsOf = [0, 1, 2].map((k) => art.querySelectorAll('.ra-cyc' + k).length);
  check('A 的配图是那段动画：三行、每行四枚（开局 N = 4）', cyc.length === 12 && rowsOf.every((n) => n === 4), `${cyc.length} 枚 / 每行 ${rowsOf.join(',')}`);
  check('A 的配图用的是本局的颜色（交进来的那三种）', COLORS3.every((c) => art.innerHTML.includes(c)), '');
  check('A 那一条挂着 coach-bar--anim（手机上也摆配图）', m.host._cls.has('coach-bar--anim'));

  // ── A → B：10 秒
  m.bar.observe(view());
  advance(A_MS - 1);
  m.bar.observe(view());
  check('差 1 毫秒满 10 秒：还是 A', m.rule() === 0, nameOf(m.rule()));
  advance(1);
  check('满 10 秒：自己换到 B', m.rule() === 1, nameOf(m.rule()));
  check('B 的灯：拼出当前 N 的一组（group）', m.bar.hint() === 'group', String(m.bar.hint()));
  check('换到 B，A 那一档动画的类摘掉（B 起手机上只留字）', !m.host._cls.has('coach-bar--anim'));

  // ── B → C：图案第一次真的降级，不看段数
  ero.spend(ero.segLeft() - 3);
  advance(10 * 60 * 1000);
  for (let k = 0; k < 5; k++) m.bar.observe(view());
  check(`（尺子）模拟盘面翻到这一级只剩 ${ero.segLeft()} 段（从前「剩 ≤ 4 段」就换的那个时候）`, ero.segLeft() === 3 && ero.level() === 4, `第 ${ero.level()} 级剩 ${ero.segLeft()} 段`);
  check('剩 ≤ 4 段、十分钟、结算五次：B 都不换（它等的是真的降级）', m.rule() === 1, nameOf(m.rule()));
  ero.spend(3);
  check('（尺子）再翻三枚：真的降了一级', ero.level() === 3, `第 ${ero.level()} 级`);
  m.bar.signal('erosion');
  check('降级那一拍（连锁里）：只记下，不当场换条', m.rule() === 1, nameOf(m.rule()));
  m.bar.observe(view());
  check('那一步结算完：C 出来', m.rule() === 2, nameOf(m.rule()));
  check('C 的灯：按新图案亮一组、只算一次（groupOnce）', m.bar.hint() === 'groupOnce', String(m.bar.hint()));

  // ── C → D：默认 10 秒
  advance(C_MS - 1);
  m.bar.observe(view());
  check('C 差 1 毫秒满 10 秒：还是 C', m.rule() === 2, nameOf(m.rule()));
  advance(1);
  check('C 满 10 秒：D 出来', m.rule() === 3, nameOf(m.rule()));
  check('D 的灯：外边（edge）', m.bar.hint() === 'edge', String(m.bar.hint()));

  // ── D → E：从 D 出现起消掉两次整条外边
  m.bar.signal('line');
  m.bar.observe(view());
  check('D 之后消掉第一条外边：还是 D', m.rule() === 3, nameOf(m.rule()));
  advance(10 * 60 * 1000);
  m.bar.observe(view());
  check('D 不按时间走（十分钟还是 D）', m.rule() === 3, nameOf(m.rule()));
  m.bar.signal('line');
  check('第二条消边那一拍（连锁里）：只记下，不当场换条', m.rule() === 3, nameOf(m.rule()));
  m.bar.observe(view());
  check('那一步结算完：E 出来', m.rule() === 4, nameOf(m.rule()));
  check('E 不亮灯', m.bar.hint() === null, String(m.bar.hint()));
  check('进度条走到第五格', m.on() === 5, `${m.on()} / ${m.segs()}`);
  const before = m.changes();
  advance(10 * 60 * 1000);
  m.bar.signal('line');
  m.bar.signal('score');
  m.bar.observe(view());
  check('E 一直留到这一局结束（十分钟后、再消几条都不走）', m.rule() === 4 && m.changes() === before, nameOf(m.rule()));
  m.bar.destroy();
}

head('② A 等的另一件事：第一次得分（不到 10 秒就换）');
{
  const m = mount('first');
  advance(2500);
  m.bar.signal('score');
  check('得分那一拍（连锁里）：只记下', m.rule() === 0, nameOf(m.rule()));
  m.bar.observe({ starsReachEdge: false });
  check('那一步结算完：2.5 秒就换到 B', m.rule() === 1, nameOf(m.rule()));
  // A 的钟撤掉了：原来那个 10 秒的定时器不会再把 B 往前推一格。
  advance(A_MS);
  check('A 那个 10 秒的钟跟着撤了（B 没被它推走）', m.rule() === 1, nameOf(m.rule()));
  m.bar.destroy();
  // 同一步里又得分又降级（不会真的发生在头一步，但条子不该卡在半路）：一路换到 C。
  const n = mount('first');
  n.bar.signal('score');
  n.bar.signal('erosion');
  n.bar.observe({ starsReachEdge: false });
  check('同一步里得分又降级：A、B 都做到了，一路换到 C', n.rule() === 2, nameOf(n.rule()));
  n.bar.destroy();
}

head('③ C 的 10 秒 / 5 秒');
{
  const toC = (m) => {
    m.bar.signal('score');
    m.bar.observe({ starsReachEdge: false });
    m.bar.signal('erosion');
    m.bar.observe({ starsReachEdge: false });
  };
  // C 出来 3 秒时「某色星星 ≥ 最短外边」成立：从那一刻起 5 秒（第 8 秒）换。
  {
    const m = mount('first');
    toC(m);
    check('（尺子）到了 C', m.rule() === 2, nameOf(m.rule()));
    advance(3000);
    m.bar.observe({ starsReachEdge: true });
    advance(C_AFTER_REACH_MS - 1);
    check('条件满足后差 1 毫秒满 5 秒：还是 C', m.rule() === 2, nameOf(m.rule()));
    advance(1);
    check('条件满足后满 5 秒（C 出来第 8 秒）：换到 D', m.rule() === 3, `${nameOf(m.rule())}，第 ${now}ms`);
    m.bar.destroy();
  }
  // C 出来 7 秒时才成立：7 + 5 = 12 > 10，总长不超过 10 秒——第 10 秒换。
  {
    const m = mount('first');
    toC(m);
    const t0 = now;
    advance(7000);
    m.bar.observe({ starsReachEdge: true });
    advance(C_MS - 7000 - 1);
    check('条件第 7 秒才成立：第 10 秒差 1 毫秒还是 C', m.rule() === 2, nameOf(m.rule()));
    advance(1);
    check('总长不超过 10 秒：第 10 秒换到 D', m.rule() === 3 && now - t0 === C_MS, `${nameOf(m.rule())}，C 摆了 ${now - t0}ms`);
    m.bar.destroy();
  }
  // C 一出来条件就已经成立（降级那一步结算完时星星就够了）：5 秒换。
  {
    const m = mount('first');
    m.bar.signal('score');
    m.bar.observe({ starsReachEdge: true });
    m.bar.signal('erosion');
    m.bar.observe({ starsReachEdge: true });
    check('（尺子）到了 C', m.rule() === 2, nameOf(m.rule()));
    advance(C_AFTER_REACH_MS - 1);
    check('C 一出来星星就够：差 1 毫秒满 5 秒还是 C', m.rule() === 2, nameOf(m.rule()));
    advance(1);
    check('满 5 秒换到 D', m.rule() === 3, nameOf(m.rule()));
    m.bar.destroy();
  }
  // 条件成立之后又不成立了：5 秒照算（「从条件满足起」）。
  {
    const m = mount('first');
    toC(m);
    advance(1000);
    m.bar.observe({ starsReachEdge: true });
    m.bar.observe({ starsReachEdge: false });
    advance(C_AFTER_REACH_MS);
    check('条件成立过一次、后来又没了：5 秒照算', m.rule() === 3, nameOf(m.rule()));
    m.bar.destroy();
  }
  // D 只数「从它出现起」消的边：C 期间消的不算；一拍消两条算两次。
  {
    const m = mount('first');
    toC(m);
    m.bar.signal('line');
    m.bar.observe({ starsReachEdge: false });
    advance(C_MS);
    check('（尺子）到了 D', m.rule() === 3, nameOf(m.rule()));
    m.bar.signal('line');
    m.bar.observe({ starsReachEdge: false });
    check('C 期间消的那一条不算：D 之后消一条还是 D', m.rule() === 3, nameOf(m.rule()));
    m.bar.destroy();
    const n = mount('first');
    toC(n);
    advance(C_MS);
    n.bar.signal('line', 2);
    n.bar.observe({ starsReachEdge: false });
    check('一拍消掉两条整条外边：算两次，换到 E', n.rule() === 4, nameOf(n.rule()));
    n.bar.destroy();
  }
}

head('④ 暂停：A 的 10 秒、C 的 10 秒 / 5 秒全冻住');
{
  const m = mount('first');
  advance(4000);
  m.bar.pause();
  advance(60 * 1000);
  check('A 摆了 4 秒、暂停一分钟：还是 A', m.rule() === 0, nameOf(m.rule()));
  m.bar.resume();
  advance(A_MS - 4000 - 1);
  check('继续之后再摆 5.999 秒：还是 A（暂停那一分钟不算）', m.rule() === 0, nameOf(m.rule()));
  advance(1);
  check('继续之后满 6 秒（真在打的时间满 10 秒）：换到 B', m.rule() === 1, nameOf(m.rule()));
  // 暂停两次、继续两次也只算真在打的时间；暂停里连按两下暂停不多扣。
  m.bar.signal('erosion');
  m.bar.observe({ starsReachEdge: false });
  check('（尺子）到了 C', m.rule() === 2, nameOf(m.rule()));
  advance(2000);
  m.bar.pause();
  m.bar.pause();
  advance(30 * 1000);
  m.bar.resume();
  advance(1000);
  m.bar.observe({ starsReachEdge: true });
  m.bar.pause();
  advance(30 * 1000);
  m.bar.resume();
  advance(C_AFTER_REACH_MS - 1);
  check('C：第 3 秒条件成立，中间两次暂停——条件满足后真在打的时间差 1 毫秒满 5 秒：还是 C', m.rule() === 2, nameOf(m.rule()));
  advance(1);
  check('满 5 秒换到 D', m.rule() === 3, nameOf(m.rule()));
  m.bar.destroy();
}

head('⑤ 第二副基础棋盘：只讲 D，条件同上（方块的模拟盘面）');
{
  const m = mount('second', 'square');
  const g = squareBoard();
  check('开局不出声，也不亮灯', m.rule() === -1 && m.bar.hint() === null, `${m.rule()} / ${m.bar.hint()}`);
  check('（尺子）方块的最短外边按较短那条边：6×6 是 6', Math.min(g.length, g[0].length) === 6);
  flipColor(g, 2, 5);
  m.bar.observe({ starsReachEdge: squareReach(g) });
  advance(5 * 60 * 1000);
  m.bar.signal('erosion');
  m.bar.observe({ starsReachEdge: squareReach(g) });
  check('同色星星 5 颗（差一颗）：五分钟、降过级都不出声', m.rule() === -1, `${m.rule()}`);
  flipColor(g, 2, 1);
  m.bar.observe({ starsReachEdge: squareReach(g) });
  check('凑够 6 颗：开口，讲的是 D', m.rule() === 3, nameOf(m.rule()));
  check('这一路不画进度条（只讲一条）', m.segs() === 0, `${m.segs()} 格`);
  check('D 的灯：外边', m.bar.hint() === 'edge', String(m.bar.hint()));
  m.bar.signal('line');
  m.bar.signal('line');
  advance(60 * 1000);
  m.bar.observe({ starsReachEdge: true });
  check('只讲这一条：消了两条边也不往下走', m.rule() === 3, nameOf(m.rule()));
  m.bar.destroy();
  // 消掉一行之后盘子变小，门槛跟着变小：5×6 只要 5 颗。
  const g5 = squareBoard(5, 6);
  flipColor(g5, 1, 5);
  check('方块消掉一行（5×6）：门槛跟着变成 5', squareReach(g5) === true);
  const g5b = squareBoard(5, 6);
  flipColor(g5b, 1, 4);
  check('（反面尺子）5×6 上 4 颗不够', squareReach(g5b) === false);
}

head('⑥ 「最短外边」跟着盘面变：小球削掉最外一圈之后');
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

head('⑦ 《<》回头看、重开、拆掉');
{
  const m = mount('first');
  advance(A_MS);
  const peek = m.host.querySelector('.coach-peek');
  check('（尺子）B 上有《<》', peek && !peek.hidden);
  // 读屏名（10-08 方案第四批第 8 条）：《<》念「上一条」——专用的 coachPrev，不借《返回》（那颗键不退出任何东西）
  check('《<》读屏念「上一条」（coachPrev），不是「返回」',
    peek.getAttribute('aria-label') === STRINGS[LANG].coachPrev && peek.getAttribute('aria-label') !== STRINGS[LANG].back,
    String(peek.getAttribute('aria-label')));
  peek.fire('click');
  check('按《<》：摆回 A', m.rule() === 0, nameOf(m.rule()));
  check('回头看 A 的时候那段动画也摆回来（coach-bar--anim）', m.host._cls.has('coach-bar--anim'));
  check('回头看的时候那颗键念「下一条」', peek.getAttribute('aria-label') === STRINGS[LANG].next, String(peek.getAttribute('aria-label')));
  check('回头看不动进度', m.on() === 2, `${m.on()} 格`);
  check('回头看不动灯（还是 B 那一种）', m.bar.hint() === 'group', String(m.bar.hint()));
  advance(PEEK_MS);
  check(`${PEEK_MS}ms 不动它：自己回到现在`, m.rule() === 1, nameOf(m.rule()));
  // 重开：见过的全忘掉。
  m.bar.signal('erosion');
  m.bar.reset();
  check('重开：回到 A、亮第一格', m.rule() === 0 && m.on() === 1, `${nameOf(m.rule())} / ${m.on()} 格`);
  advance(A_MS);
  m.bar.observe({ starsReachEdge: true });
  check('重开之后，上一局降过的级不算数（停在 B）', m.rule() === 1, nameOf(m.rule()));
  m.bar.destroy();
  check('拆掉之后：不亮灯、条子藏起来', m.bar.hint() === null && m.host.hidden === true);
  advance(10 * 60 * 1000);
  m.bar.signal('erosion');
  m.bar.observe({ starsReachEdge: true });
  check('拆掉之后再报什么都不复活', m.host.hidden === true);
}

// ===========================================================================
// 呼吸灯的零件（engine/coachHint.ts），模拟盘面
// ===========================================================================
//
// 认组那一步在真棋盘里是棋盘自己的 findMatches；这儿换成一把手写的 1×N 尺子（同色连着
// ≥ N 枚、至少一枚是色块、碰到这一步动过的那条线）。量的是搜索本身：最少步数、挑色、亮哪几枚、剪枝、上限、分段。
const eff = (t) => (t.face === 'dot' ? t.dotColor : t.color);
function runsOn(lines, n) {
  return (trial, moved) => {
    const out = [];
    for (const cells of lines) {
      let i = 0;
      while (i < cells.length) {
        const [r0, c0] = cells[i];
        const t0 = trial[r0][c0];
        if (!t0 || t0.blank) { i++; continue; }
        let j = i + 1;
        while (j < cells.length && trial[cells[j][0]][cells[j][1]] && !trial[cells[j][0]][cells[j][1]].blank && eff(trial[cells[j][0]][cells[j][1]]) === eff(t0)) j++;
        const run = cells.slice(i, j);
        if (run.length >= n && run.some(([r, c]) => trial[r][c].face === 'flavor') && run.some(([r, c]) => moved.has(r + ',' + c))) out.push(run);
        i = j;
      }
    }
    return out;
  };
}
/** 整条同色星星（方块：任意一整行一整列；这儿给小球用的是交进来的那几条外边）。 */
const fullStars = (edges) => (trial) =>
  edges.filter((e) => e.length && e.every(([r, c]) => trial[r][c] && !trial[r][c].blank && trial[r][c].face === 'dot' && eff(trial[r][c]) === eff(trial[e[0][0]][e[0][1]])));
const CL = CIRCLE_LINES.map((l) => l.cells);
/** 一份 PlanBoard（engine/coachHint.ts）：小球的线，认组用 runsOn。 */
function circlePlan(g, { n = 4, edges = [], scoring = null } = {}) {
  const live = (r, c) => !g[r][c].blank;
  return {
    grid: g,
    step: oneStepMoves(CL, live),
    lines: CL.map((l) => l.filter(([r, c]) => live(r, c))),
    edges,
    n,
    scoring: scoring ?? runsOn(CL, n),
    clearing: fullStars(edges),
    colorOf: eff,
    isPiece: (t) => !t.blank,
    isStar: (t) => !t.blank && t.face === 'dot',
    isBlock: (t) => !t.blank && t.face === 'flavor',
  };
}
/** 把一个 generator 一口气跑完（门里不分段）。 */
const drain = (gen) => {
  for (;;) {
    const s = gen.next();
    if (s.done) return s.value;
  }
};
const keyOf = (ids) => ids.slice().sort((a, b) => a - b).join(',');
const idsAt = (g, cells) => cells.map(([r, c]) => g[r][c].id);
const snap = (g) => JSON.stringify(g.map((row) => row.map((t) => t.id)));

head('⑧ B / C 的搜索：每一色精确的最少步数，亮的正好是最后一步成组的那 N 枚（10-11 方案 D-2）');
{
  const g = uniqueBoard();
  // 红：第 3 列（lineB(3)）上面三枚红色，底下那一格蓝色；红色那一枚在它右边隔壁——底下那一行往左
  // 滑一格就补进去，竖着连成四枚。**一步**。
  for (const [r, c] of [[3, 3], [4, 3], [5, 3], [6, 4]]) g[r][c] = tile(0);
  g[6][3] = tile(1);
  const all = new Set(CL.flat().map(([r, c]) => r + ',' + c));
  check('（尺子）摆好的这副盘面上此刻没有现成的组', runsOn(CL, 4)(g, all).length === 0);
  const step = oneStepMoves(CL, (r, c) => !g[r][c].blank);
  check('（尺子）走法来自 residueBoard：21 条线、每条线 1…n−1 格', step.moves.length === CIRCLE_LINES.reduce((a, l) => a + l.cells.length - 1, 0),
    `${step.moves.length} 种`);
  const before = snap(g);
  const r1 = drain(planGroup(circlePlan(g), { color: null, ids: [] }));
  const red = idsAt(g, [[3, 3], [4, 3], [5, 3], [6, 4]]);
  check('红色一步就成：挑红色、最少 1 步', r1.color === 0 && r1.depth === 1 && !r1.estimate, JSON.stringify({ c: r1.color, d: r1.depth }));
  check('亮的正好是那 4 枚（要滑过去的 (6,4) 在里面，它要去的那一格上的蓝色 (6,3) 不在）', keyOf(r1.ids) === keyOf(red), keyOf(r1.ids));
  check('试走不改盘面（搜索在副本上走）', snap(g) === before);
  // 绿：第 0 列上面三枚绿色，第四枚在 (4,2)——第 2 列往上一格到 (3,2)，第 3 行再往左两格到 (3,0)：
  // **两步**。只有第 0 列上有三枚，一步怎么滑都凑不出四枚。
  for (const [r, c] of [[0, 0], [1, 0], [2, 0], [4, 2]]) g[r][c] = tile(2);
  const r2 = drain(planGroup(circlePlan(g), { color: null, ids: [] }));
  check('一步的红色压过两步的绿色', r2.color === 0 && r2.depth === 1, JSON.stringify({ c: r2.color, d: r2.depth }));
  g[6][4] = tile(5); // 拆掉红色那一组
  const r3 = drain(planGroup(circlePlan(g), { color: null, ids: [] }));
  const green = idsAt(g, [[0, 0], [1, 0], [2, 0], [4, 2]]);
  check('红色拆掉之后：绿色最少 2 步（从前「两步没算完就不亮」的那种盘面，现在必须算出来）', r3.color === 2 && r3.depth === 2, JSON.stringify({ c: r3.color, d: r3.depth }));
  check('两步那一色亮的是参与的那四枚（按棋子认，此刻还在原处）', keyOf(r3.ids) === keyOf(green), keyOf(r3.ids));
  // 一组凑出来比 N 长：第 0 列（七格）是 ·红红蓝红红·，红色那一枚 (3,1) 在蓝色右边隔壁——第 3 行往左滑一格，第 0
  // 列五枚连着。只亮 N 枚。（第 0 列整条转怎么转都凑不出四枚连着：两头那两格不是红的，所以这是唯一的一步。）
  const h = uniqueBoard();
  for (const [r, c] of [[1, 0], [2, 0], [4, 0], [5, 0], [3, 1]]) h[r][c] = tile(0);
  h[3][0] = tile(1);
  const r5 = drain(planGroup(circlePlan(h), { color: null, ids: [] }));
  check('（尺子）五枚那一组也是一步', r5.color === 0 && r5.depth === 1, JSON.stringify({ c: r5.color, d: r5.depth }));
  const run5 = idsAt(h, [[1, 0], [2, 0], [4, 0], [5, 0], [3, 1]]);
  check('凑出来五枚连着：只亮 N（4）枚，都是那一组里的，要滑过去的那一枚在里面', r5.ids.length === 4 &&
    r5.ids.every((id) => run5.includes(id)) && r5.ids.includes(h[3][1].id), keyOf(r5.ids));
  const r0 = drain(planGroup(circlePlan(uniqueBoard()), { color: null, ids: [] }));
  check('一枚都配不上谁的盘面：不亮', r0.color === null && r0.ids.length === 0, JSON.stringify(r0));
  // 全是星星凑不成组：那一色一枚色块都没有，不算。
  const s = uniqueBoard();
  for (const [r, c] of [[3, 3], [4, 3], [5, 3], [6, 4]]) s[r][c] = tile(0, true);
  s[6][3] = tile(1);
  const rs = drain(planGroup(circlePlan(s), { color: null, ids: [] }));
  check('全是星星的一组不算（§1.1：图案里至少要有一枚色块）', rs.color === null, JSON.stringify({ c: rs.color }));
  // 估值：一条线上这一色几枚——h 不高估（这一色每多一枚在线上，h 少 1）。
  const p = circlePlan(g);
  check('估值 groupH：绿色在第 0 列已有三枚 → 还差 1', groupH(p, 2) === 1, String(groupH(p, 2)));
}

head('⑨ 中间那一步自己就会得分 / 消边：那一支剪掉；超了上限退回估值');
{
  // 三格一条「线」：a、b、c。两种滑法：a↔b、b↔c。要把 T 从 a 送到 c 得走两步，中间那一步 T 在 b 上——这一副盘面
  // 自己就会得分（认组那把尺子说的），真滑下去连锁就动了，后面那一步不成立。所以 T 那一色「两步之内到不了」。
  const g = [[tile(0), tile(50), tile(51)]];
  const T = g[0][0];
  const cells = [[0, 0], [0, 1], [0, 2]];
  const step = { cells, moves: [{ cells: [0, 1], src: [1, 0] }, { cells: [1, 2], src: [1, 0] }] };
  const at = (trial, rc) => trial[rc[0]][rc[1]];
  // 50 那一枚是一颗星星：它那一色不在候选里（一组至少一枚色块）。下面「T 到了 b 就得分」那一组认的是它——所以那一
  // 下只拦路，不另成一个答案。
  const star50 = g[0][1];
  // 一条一格长的「外边」（就是 b 那一格）：盘上有一颗星星（50），够填满它——「会不会消边」这一问才有意义（搜索在一
  // 色星星都不够最短那条边时整个不问，见 coachHint.ts 的 canClearAny）。
  const base = {
    grid: g, step, lines: [cells], edges: [[[0, 1]]], n: 1,
    clearing: () => [], colorOf: (t) => t.color, isPiece: () => true, isStar: (t) => t === star50, isBlock: (t) => t !== star50,
  };
  const goalOnly = (trial) => (at(trial, [0, 2]) === T ? [[[0, 2]]] : []);
  // T 走到 b 的那一副：50 那一枚（别的颜色）凑成了一组——中间这一步自己就得分。
  const where50 = (trial) => cells.find((rc) => at(trial, rc) === star50);
  const withTrap = (trial) => (at(trial, [0, 1]) === T ? [[where50(trial)]] : goalOnly(trial));
  const open = drain(planGroup({ ...base, scoring: goalOnly }, { color: null, ids: [] }));
  check('（尺子）中间那一步不得分时：T 两步到 c', open.color === 0 && open.depth === 2, JSON.stringify({ c: open.color, d: open.depth }));
  const cut = drain(planGroup({ ...base, scoring: withTrap }, { color: null, ids: [] }));
  check('中间那一步自己就得分（别的颜色凑成了一组）：那一支剪掉——T 那一色到不了，不亮', cut.color === null, JSON.stringify({ c: cut.color, d: cut.depth }));
  const viaEdge = drain(planGroup({ ...base, scoring: goalOnly, clearing: (trial) => (at(trial, [0, 1]) === T ? [[[0, 1]]] : []) }, { color: null, ids: [] }));
  check('中间那一步会消边：一样剪掉', viaEdge.color === null, JSON.stringify({ c: viaEdge.color, d: viaEdge.depth }));

  // 上限：盘面数压到很小，算不完——退回按估值排，标 estimate（不卡住，也不至于一盏都不亮）。
  const u = uniqueBoard();
  for (const [r, c] of [[0, 0], [1, 0], [2, 0], [4, 2]]) u[r][c] = tile(2);
  const stats = { nodes: 0 };
  const capped = drain(planGroup(circlePlan(u), { color: null, ids: [] }, stats, 10));
  check('盘面数超了上限：退回估值、标「估计」，亮的是那一色离成组最近的那条线上的那几枚', capped.estimate === true && capped.color === 2 &&
    capped.ids.length === 3 && capped.ids.every((id) => idsAt(u, [[0, 0], [1, 0], [2, 0]]).includes(id)), JSON.stringify(capped));
  check('（尺子）上限是真的闸：走了 11 个盘面就停', stats.nodes === 11, String(stats.nodes));
  const full = { nodes: 0 };
  const exact = drain(planGroup(circlePlan(u), { color: null, ids: [] }, full));
  check('（反面尺子）不压上限就算得出精确的 2 步，不是估计', exact.estimate === false && exact.depth === 2, `${exact.depth} 步 / ${full.nodes} 个盘面`);
  check('最多看几步（HINT_MAX_DEPTH）是 8：真正的闸是盘面数', HINT_MAX_DEPTH === 8, String(HINT_MAX_DEPTH));
}

head('⑩ 挑色：不跳色 → 含星星 → 盘面哈希（同一副盘面每次一样，不同盘面之间随机）');
{
  /** 红（右边，第 3 列）和黄（左边，第 1 列），都是一步就成。 */
  const twoColors = (yellowStar = false) => {
    const g = uniqueBoard();
    for (const [r, c] of [[3, 3], [4, 3], [5, 3], [6, 4]]) g[r][c] = tile(0);
    g[6][3] = tile(1);
    for (const [r, c] of [[3, 1], [4, 1], [5, 1], [6, 2]]) g[r][c] = tile(6);
    g[6][1] = tile(7);
    if (yellowStar) g[4][1] = tile(6, true);
    return g;
  };
  const g = twoColors();
  const first = drain(planGroup(circlePlan(g), { color: null, ids: [] }));
  check('（尺子）两色都是一步，挑了其中一色', first.depth === 1 && (first.color === 0 || first.color === 6), String(first.color));
  const again = Array.from({ length: 10 }, () => drain(planGroup(circlePlan(g), { color: null, ids: [] })).color);
  check('同一副盘面重算十次，挑的都是同一色（灯不闪）', again.every((c) => c === first.color), again.join(','));
  const picks = new Set();
  for (let k = 0; k < 24; k++) picks.add(drain(planGroup(circlePlan(twoColors()), { color: null, ids: [] })).color);
  check('换 24 副盘面（棋子不同、两组一样快）：两色都被挑中过（平手是随机的，不是总挑前一色）', picks.size === 2, [...picks].join(','));
  const other = first.color === 0 ? 6 : 0;
  check('正在亮的那一色还在最少那几色里：接着亮它（不跳色）',
    drain(planGroup(circlePlan(g), { color: other, ids: [] })).color === other && drain(planGroup(circlePlan(g), { color: first.color, ids: [] })).color === first.color);
  check('正在亮的那一色不在了：从最少那几色里换（不认它）', [0, 6].includes(drain(planGroup(circlePlan(g), { color: 99, ids: [] })).color));
  // 含星星的优先（B 那句话讲的就是星星和色块一起拼）：黄色那一组里一枚是黄色的星星。
  const starPicks = new Set();
  for (let k = 0; k < 12; k++) starPicks.add(drain(planGroup(circlePlan(twoColors(true)), { color: null, ids: [] })).color);
  check('两色一样快、只有黄色那一组带星星：每一副都挑黄色', starPicks.size === 1 && starPicks.has(6), [...starPicks].join(','));
  // 盘面哈希：同一副盘面同一个数，翻一枚就是另一个数。
  const face = (t) => (t.face === 'dot' ? 1 : 0);
  const h1 = boardHash(g, face);
  const h2 = boardHash(g, face);
  g[0][0].face = 'dot';
  check('盘面哈希：同一副盘面同一个数，翻一枚就变', h1 === h2 && boardHash(g, face) !== h1, `${h1} / ${boardHash(g, face)}`);
}

head('⑪ D 的搜索：那一色在场的所有星星，一枚色块都不亮（10-11 方案 D-3）');
{
  // 方块 6×6、每一枚一个颜色。第 0 行前五格是红色星星，第六格是别的；红色星星 (1,5) 在它正下方——第 5 列往上
  // 滑一格，第 0 行就整条红色星星：一步。另外场上还有一颗红色星星 (4,2) 和一枚红色色块 (3,3)。
  const sq = () => Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => tile(200 + r * 6 + c)));
  const g = sq();
  for (let c = 0; c < 5; c++) g[0][c] = tile(0, true);
  g[1][5] = tile(0, true);
  g[4][2] = tile(0, true);
  g[3][3] = tile(0);
  const lines = gridLines(6, 6);
  const plan = (grid, n = 99) => ({
    grid,
    step: oneStepMoves(lines, () => true),
    lines,
    edges: lines,
    n,
    scoring: runsOn(lines, n),
    clearing: fullStars(lines),
    colorOf: eff,
    isPiece: () => true,
    isStar: (t) => t.face === 'dot',
    isBlock: (t) => t.face === 'flavor',
  });
  const r = drain(planEdge(plan(g), { color: null, ids: [] }));
  const redStars = idsAt(g, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [4, 2]]);
  check('红色一步填满第 0 行：挑红色、1 步', r.color === 0 && r.depth === 1 && !r.estimate, JSON.stringify({ c: r.color, d: r.depth }));
  check('亮的是红色在场的所有星星（7 颗，连不在那条边上的 (4,2) 也亮）', keyOf(r.ids) === keyOf(redStars), keyOf(r.ids));
  check('红色色块 (3,3) 一枚都不亮', !r.ids.includes(g[3][3].id));
  // 估值：边长 − 这条边上这一色的星星数，只看够得着的边（边长 ≤ 这一色的星星数）。
  check('估值 edgeH：第 0 行已有五颗红色星星 → 还差 1', edgeH(plan(g), 0, 7) === 1, String(edgeH(plan(g), 0, 7)));
  // 一色都填不满（星星不够最短那条边）：亮「还差的枚数」最少的那一色的所有星星。
  const f = sq();
  for (const [rr, cc] of [[0, 0], [2, 2], [4, 4]]) f[rr][cc] = tile(0, true);
  for (const [rr, cc] of [[1, 1], [1, 3], [3, 1], [5, 5]]) f[rr][cc] = tile(1, true);
  const fb = drain(planEdge(plan(f), { color: null, ids: [] }));
  check('星星都不够一条边：亮还差得最少的那一色（蓝 4 颗，差 2；红 3 颗，差 3）的所有星星',
    fb.color === 1 && keyOf(fb.ids) === keyOf(idsAt(f, [[1, 1], [1, 3], [3, 1], [5, 5]])) && fb.depth === 0, JSON.stringify(fb));
  // 填满外边的那一步同时也凑出了一组：照样算填满——连锁第一拍问的就是整线消除（engine/scoring.ts 的 next），这条边
  // 先消。认组那把尺子在「第 0 行满了」的那一副上也说得分。
  const both = drain(planEdge({ ...plan(g), scoring: (trial) => (fullStars(lines)(trial).length ? [[[0, 0]]] : []) }, { color: null, ids: [] }));
  check('填满外边的那一步同时也凑出一组：照样算一步填满（连锁第一拍先认整线消除）', both.color === 0 && both.depth === 1,
    JSON.stringify({ c: both.color, d: both.depth }));
  // 中间那一步自己就得分：那一支剪掉。第 0 行四颗红色星星，(1,4)、(2,5) 各一颗——第 4 列、第 5 列各往上滑，两步填满；
  // 可第 0 行到 5 颗的那一副（不管先滑哪一列都要经过）认组那把尺子说得分。任何一条路都得经过它（滑一列只让第 0
  // 行多一颗），所以红色两步之内填不满：退回「还差的最少」那一色（红色 6 颗、够一条边，差 0），步数记 0。
  const t = sq();
  for (let c = 0; c < 4; c++) t[0][c] = tile(0, true);
  t[1][4] = tile(0, true);
  t[2][5] = tile(0, true);
  const five = (trial) => trial[0].filter((x) => x.face === 'dot' && eff(x) === 0).length === 5;
  const clean = drain(planEdge(plan(t), { color: null, ids: [] }));
  check('（尺子）中间那一步不得分时：红色两步填满第 0 行', clean.color === 0 && clean.depth === 2, JSON.stringify({ c: clean.color, d: clean.depth }));
  // N 压到 5：第 0 行到 5 颗红色的那一副，「这一步之后有没有可能凑出一组」那道先筛（mayScore）才放它过去问认组。
  const cut = drain(planEdge({ ...plan(t, 5), scoring: (trial) => (five(trial) ? [[[5, 5]]] : []) }, { color: null, ids: [] }));
  check('中间那一步自己就得分：那一支剪掉（不是两步；亮的照样是红色的所有星星、步数记 0）',
    cut.color === 0 && cut.depth === 0 && keyOf(cut.ids) === keyOf(idsAt(t, [[0, 0], [0, 1], [0, 2], [0, 3], [1, 4], [2, 5]])), JSON.stringify(cut));
}

head('⑫ 那盏灯：一份状态、分段跑、算完才亮、C 只算一次、预热不动状态（10-11 方案 D-4）');
{
  // 绿色两步那一副（⑧）：两层要走几千个盘面，拆得出好几段。
  const g = uniqueBoard();
  for (const [r, c] of [[0, 0], [1, 0], [2, 0], [4, 2]]) g[r][c] = tile(2);
  const want = idsAt(g, [[0, 0], [1, 0], [2, 0], [4, 2]]);
  // 假钟：每问一次走 1ms；让出控制权 = 排进队里，门自己一段段放。
  let clock = 0;
  const queue = [];
  const slices = [];
  const runner = createSliceRunner(() => ++clock, (fn) => queue.push(fn), (t0, t1) => slices.push(t1 - t0));
  const flush = () => {
    let n = 0;
    while (queue.length) {
      queue.shift()();
      n++;
    }
    return n;
  };
  let views = 0;
  let paints = 0;
  let scratchViews = 0;
  const board = {
    view: () => {
      views++;
      return circlePlan(g);
    },
    still: (id, face) => g.flat().some((t) => t.id === id && (t.face === 'dot' ? 1 : 0) === face),
    faceOf: (id) => (g.flat().find((t) => t.id === id)?.face === 'dot' ? 1 : 0),
    paint: () => paints++,
    scratch: () => {
      scratchViews++;
      return circlePlan(uniqueBoard());
    },
  };
  const glow = createCoachGlow(board, runner);
  const lit = () => g.flat().filter((t) => glow.lit(t.id)).map((t) => t.id);
  glow.request('group');
  check('刚开始算：一枚都还没亮（算完才亮，不先亮一个次优的再跳）', lit().length === 0 && glow.state().hint === 'group', JSON.stringify(glow.state()));
  const n = flush();
  check('分段跑：一次重算拆成好几段让出去', n >= 2, `${n + 1} 段`);
  check(`每一段都不超过 SLICE_MS（${SLICE_MS}ms，假钟）`, slices.length >= 2 && slices.every((ms) => ms <= SLICE_MS + 1), slices.join(','));
  check('算完：亮的正好是绿色那 4 枚', keyOf(lit()) === keyOf(want), keyOf(lit()));
  check('状态只有一份：哪一种、哪一色、哪几枚、几步', glow.state().color === 2 && glow.state().depth === 2 && keyOf(glow.state().ids) === keyOf(want));
  glow.cancel();
  check('一步开始结算（cancel）：熄', lit().length === 0);
  // 作废：一次没算完就来了下一次，前一次的结果不许落地。
  glow.request('group');
  const v1 = glow.state().version;
  glow.request('edge');
  flush();
  check('前一次没算完就来了新的一次：只有新的那一次落地（版本号）', glow.state().hint === 'edge' && glow.state().version > v1 && lit().length === 0,
    JSON.stringify({ hint: glow.state().hint, ids: glow.state().ids }));
  glow.request(null);
  check('request(null)：熄', lit().length === 0 && glow.state().hint === null);
  // C：只算一次。之后每次结算完只问「那几枚还在不在」——不再重算（view 不再被叫）。
  glow.request('groupOnce');
  flush();
  check('C 第一次：算一次，亮绿色那 4 枚', keyOf(lit()) === keyOf(want), keyOf(lit()));
  const v = views;
  glow.cancel();
  check('C：这一步结算期间熄着', lit().length === 0);
  glow.request('groupOnce');
  check('C：结算完那几枚都还在、还是那一面——接回来，不重算', keyOf(lit()) === keyOf(want) && views === v, `重算了 ${views - v} 次`);
  g[1][0].face = 'dot';
  glow.request('groupOnce');
  check('C：其中一枚翻了面——整组熄掉', lit().length === 0);
  g[1][0].face = 'flavor';
  glow.request('groupOnce');
  check('C：熄了就这一条剩下的时间都不再亮（不另算一组）', lit().length === 0 && views === v, `重算了 ${views - v} 次`);
  // 换到别的条再回来（新的一条 C 不会再有，但 reset 之后是新的一局）：重开全忘。
  glow.reset();
  check('重开一局：灯和记性一起清掉', lit().length === 0 && glow.state().hint === null && glow.state().color === null);
  // 不跳色要的「上一色」是跨着熄灯记着的：cancel 之后再算，平手时留它。
  check('（尺子）paint 跟着状态走（每一次变都重挂）', paints > 5, String(paints));
  // 预热：不动状态、不亮，用的是临时那一副；真的那一次一来就作废它。
  const vs = views;
  glow.prewarm();
  check('预热：用的是临时那一副（scratch），不读此刻的盘面', scratchViews === 1 && views === vs, `scratch ${scratchViews} / view ${views - vs}`);
  check('预热：不动状态、一枚都不亮', glow.state().hint === null && lit().length === 0);
  glow.request('group');
  flush();
  check('预热之后来了真的一次：真的那一次照常算完、亮对', keyOf(lit()) === keyOf(want), keyOf(lit()));
}

head('⑬ 刚翻面那一枚的光不被行内动画盖掉；减弱动态效果时不写行内动画（D-0 根因 4）');
{
  const { applyScoreAnimations, setCoachLit, COACH_GLOW_ANIM } = await import(outlineBundle);
  check('（尺子）呼吸灯那一条和样式表的 .coach-glow 是同一句', COACH_GLOW_ANIM === 'glow-pulse-coach 2.2s ease-in-out infinite', COACH_GLOW_ANIM);
  const el = () => {
    const e = makeEl('div');
    e.style = { animation: '', animationDelay: '' };
    return e;
  };
  let reduce = false;
  globalThis.window.matchMedia = () => ({ matches: reduce });
  const a = el();
  applyScoreAnimations(a, true, 300, true, true);
  check('刚翻面＋脉冲＋亮着：行内动画列表最后一条是呼吸灯', /, glow-pulse-coach 2\.2s ease-in-out infinite$/.test(a.style.animation) && a._cls.has('coach-glow'),
    a.style.animation);
  check('三条动画三个延迟，一一对上', a.style.animation.split(/,(?![^(]*\))/).length === a.style.animationDelay.split(',').length, a.style.animationDelay);
  const b = el();
  applyScoreAnimations(b, true, undefined, true, true);
  check('只是刚翻面、亮着：也写成列表（翻面 + 呼吸灯），不是只挂 flip-in 那个类（会盖掉灯）',
    /^flip-in .*, glow-pulse-coach/.test(b.style.animation), b.style.animation);
  const c = el();
  applyScoreAnimations(c, false, undefined, true, true);
  check('没有别的动画、亮着：不写行内的，只挂 coach-glow 类（样式表那一条管）', !c.style.animation && c._cls.has('coach-glow'), c.style.animation);
  // 结算之后就地点亮 / 熄掉（不重画）：身上有列表的，接到最后 / 摘掉。
  const d = el();
  applyScoreAnimations(d, true, 300, true, false);
  setCoachLit(d, true);
  check('就地点亮一枚身上带着列表的：呼吸灯接到列表最后', /glow-pulse-coach 2\.2s ease-in-out infinite$/.test(d.style.animation) && d._cls.has('coach-glow'), d.style.animation);
  setCoachLit(d, false);
  check('就地熄掉：从列表里摘掉，别的动画留着', !/glow-pulse-coach/.test(d.style.animation) && /flip-in/.test(d.style.animation) && !d._cls.has('coach-glow'),
    d.style.animation);
  reduce = true;
  const e = el();
  applyScoreAnimations(e, true, 300, true, true);
  check('减弱动态效果：一条行内动画都不写（只挂类，样式表那一档自己关掉、给静止光晕）', !e.style.animation && e._cls.has('coach-glow') && e._cls.has('flip-in'),
    `${e.style.animation} / ${[...e._cls].join(' ')}`);
  const f = el();
  f.style.animation = 'flip-in 300ms ease-out both';
  setCoachLit(f, true);
  check('减弱动态效果：就地点亮也只挂类，不往列表里接', f.style.animation === 'flip-in 300ms ease-out both' && f._cls.has('coach-glow'), f.style.animation);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
