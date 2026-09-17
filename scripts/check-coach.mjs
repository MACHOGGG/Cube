/**
 * 棋盘底下那块教学条：六条规矩真的跟着玩家的手走完，而不是靠保底一条条熬过去。
 *
 *   npx esbuild src/ui/coachBar.ts --bundle --format=esm --outfile=/tmp/coach.mjs
 *   npx esbuild src/i18n.ts        --bundle --format=esm --outfile=/tmp/i18n.mjs
 *   node scripts/check-coach.mjs /tmp/coach.mjs /tmp/i18n.mjs
 *
 * 为什么要有这道门：这块条子是新玩家**唯一**会读到的说明书，而它坏掉的方式
 * 是**静悄悄**的。
 *
 * 它靠 gameController 在四个点上报进来的四个信号往下走（'move' 'match'
 * 'mixed' 'line'）。哪一步等的那个信号没人报，这一步就只剩 STUCK_MS 的保底：
 * 屏幕上那句话一动不动地挂满四十秒，然后自己翻篇。没有报错、没有白屏，玩家
 * 看到的是「提示卡住了」，而那一条规矩等于没讲。
 *
 * 这不是假想。这个仓库已经栽过一次同一形状的事故：anyDotFace() 靠棋子身上的
 * data-face 认「这一组里有没有反面」，而八个玩法里只有 circle.ts 挂了这个属
 * 性——于是玩方块的新玩家哪怕真的拼出了正反混合的一组，第 2 条也感知不到，只
 * 能干等保底。查出来是靠人一个个文件看过去的。
 *
 * 三条断言，正好对着这个复发机制：
 *
 *   ① 用假时钟把整条教学线走一遍，每一步都靠信号走到下一步，**一次保底都不
 *      用**。走完时钟总共才走了几秒——靠保底的话要几十秒，数字上骗不了人。
 *   ② 信号的词表和 steps 表里出现的 by 必须对得上（没有认不出来的，也没有
 *      挂着没人报的）。
 *   ③ 每一个 by 在 src/ 下至少有一个 `.signal(...)` 的调用点。这一条是静态
 *      扫描，直接抓「新玩法忘了补 signal」——也就是上面那次事故。
 *
 * 顺带还量了「做到过才算讲过」（第 3 条那格存档）：靠信号走过去要记账，靠保底
 * 跳过去**不**记账，下一局才补讲得上。
 *
 * ── 这道门自带一个小 DOM ──────────────────────────────────────────────
 *
 * coachBar 是个挂 DOM 的模块，可它要量的东西（几步、等谁、什么时候走）一点
 * 不碰浏览器的本事：它只用到 innerHTML 摆骨架、querySelector 找回来、
 * classList 标进度、textContent 填字。所以这里自己搭一份够用的——比起开一个
 * Chromium 跑一局真游戏，这一版几十毫秒、跑得进 CI，而且能把时钟拨快。
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [coachBundle, i18nBundle] = process.argv.slice(2);
if (!coachBundle || !i18nBundle) {
  console.log('用法: node scripts/check-coach.mjs <打包好的 coachBar.mjs> <打包好的 i18n.mjs>');
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

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

const { mountCoachBar, setCoachStoreKey, mixedTaught } = await import(coachBundle);
const { tutorialRules } = await import(i18nBundle);

// ===========================================================================
// 静态那一半：词表、steps 表、调用点
// ===========================================================================
const src = readFileSync(join(root, 'src/ui/coachBar.ts'), 'utf8');

const vocab = (src.match(/export type CoachSignal =([^;]+);/) || [, ''])[1]
  .split('|')
  .map((s) => s.trim().replace(/^'|'$/g, ''))
  .filter(Boolean);
const bys = [...new Set([...src.matchAll(/\bby:\s*'([a-z]+)'/g)].map((m) => m[1]))];

/** 全仓（网页 + 小红书）所有 `.signal('X')` 的调用点。 */
function allTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allTs(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const called = new Map(); // signal -> [文件]
for (const file of [...allTs(join(root, 'src')), ...allTs(join(root, 'xhs/src'))]) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bsignal\(\s*'([a-z]+)'\s*\)/g)) {
    const rel = file.slice(root.length + 1);
    if (!called.has(m[1])) called.set(m[1], []);
    if (!called.get(m[1]).includes(rel)) called.get(m[1]).push(rel);
  }
}

console.log(`词表：${vocab.join(' ')}`);
console.log(`steps 表里出现的 by：${bys.join(' ')}`);
console.log(`有调用点的：${[...called.keys()].join(' ')}`);
console.log('');

check('每一步等的那个信号都在词表里', bys.every((b) => vocab.includes(b)),
  bys.filter((b) => !vocab.includes(b)).join(',') || '');
check('每一处 signal() 报的都是词表里的词（没有把字符串写错的）',
  [...called.keys()].every((c) => vocab.includes(c)),
  [...called.keys()].filter((c) => !vocab.includes(c)).join(',') || '');
// 这一条是整道门的重点：有人等，却没人报 —— 教学会静静卡在保底上。
const orphanBy = bys.filter((b) => !called.has(b));
check('每一步等的那个信号，src 里真的有人报（新玩法忘了补 signal 就红在这儿）',
  orphanBy.length === 0,
  orphanBy.length ? `没人报：${orphanBy.join(',')}` : bys.map((b) => `${b}←${called.get(b).length} 处`).join(' '));
const orphanVocab = vocab.filter((v) => !called.has(v));
check('词表里的词都有人报（挂着一个从来没人报过的词，是漏接线）',
  orphanVocab.length === 0, orphanVocab.join(',') || '');
// 「词表里有、却没有任何一步在等」不是错：'move' 就是这样——它只进 hit，
// 用来认「这一条他提前就做过了」。但要看得见，免得哪天是真漏了。
const idle = vocab.filter((v) => !bys.includes(v));
check('词表里没有哪一步在等的词，都在这儿列着（不是错，是要看得见）', true,
  idle.length ? `${idle.join(',')} —— 只记进 hit，没有哪一步以它为条件` : '没有');

// ===========================================================================
// 跑起来那一半
// ===========================================================================
const LANG = 'zhHans';
const SHAPE = 'circle';
const TEXTS = tutorialRules(LANG, SHAPE);

/** 这一刻条子上摆着六条里的哪几条。 */
function shownRules(host) {
  return host
    .querySelectorAll('.coach-row')
    .filter((r) => !r.hidden)
    .map((r) => TEXTS.indexOf(r.querySelector('.coach-text').textContent))
    .filter((i) => i >= 0);
}

/**
 * 挂一块新条子。taught = 存档里那格「第 3 条做到过」事先填不填——它决定第二
 * 个玩法那一路要不要先补讲一次（见 coachBar 的 MAKEUP_MIXED）。
 */
function mount(plan, storeKey, taught = false) {
  resetClock();
  memStore.clear();
  setCoachStoreKey(storeKey);
  if (taught) memStore.set(storeKey, '1');
  const stage = makeEl('div');
  stage._cls.add('app--game');
  const host = makeEl('div');
  host.parent = stage;
  stage.childNodes.push(host);
  return { host, bar: mountCoachBar(host, { lang: LANG, shape: SHAPE, plan }) };
}

// 这几个数要和 coachBar.ts 里的常量对得上；对不上就是那边改了，这里要跟。
const num = (name) => Number((src.match(new RegExp(`const ${name} = (\\d+)`)) || [])[1]);
const STUCK_MS = num('STUCK_MS');
const AFTER_MS = num('AFTER_MS');
check('读得到 STUCK_MS / AFTER_MS', STUCK_MS > 0 && AFTER_MS > 0, `${STUCK_MS} / ${AFTER_MS}`);

// ---------------------------------------------------------------------------
// ① 头一局：整条线靠信号走完，一次保底都不用
// ---------------------------------------------------------------------------
{
  const { host, bar } = mount('first', 'gate_first');
  const segs = host.querySelector('.coach-prog').children.length;
  check('头一局画得出进度条（一步一格）', segs >= 4, `${segs} 格`);

  const path = []; // 走过的每一步：摆了哪几条、靠什么走掉的
  let guard = 0;
  for (;;) {
    if (++guard > 20) break;
    const at = host.querySelector('.coach-prog').children.filter((c) => c._cls.has('on')).length - 1;
    const rules = shownRules(host);
    // 这一步等谁：按下标在 steps 表里找对应的 by。表是按顺序写的，第 n 步就是
    // 第 n 条记录。
    const rec = [...src.matchAll(/\{ rules: \[([^\]]*)\](?:, by: '([a-z]+)')?(?:, times: (\d+))?/g)];
    const step = rec[at];
    if (!step) break;
    const by = step[2];
    const times = Number(step[3] || 1);
    path.push({ at, rules, by, times });
    if (!by) break; // 没有可做的事的那一步（最后一步就是这样）
    const before = now;
    for (let k = 0; k < times; k++) bar.signal(by);
    advance(AFTER_MS + 5);
    const waited = now - before;
    if (waited >= STUCK_MS) {
      check(`第 ${at + 1} 步不是靠保底走的`, false, `等了 ${waited}ms`);
      break;
    }
    const next = host.querySelector('.coach-prog').children.filter((c) => c._cls.has('on')).length - 1;
    if (next === at) break; // 走不动了
  }
  const last = host.querySelector('.coach-prog').children.filter((c) => c._cls.has('on')).length - 1;
  check('整条教学线走得完（最后停在最后一步）', last === segs - 1, `走到第 ${last + 1} / ${segs} 步`);
  check('整条线都靠信号走，一次保底都没用上', now < STUCK_MS,
    `全程假时钟只走了 ${now}ms，保底一次就要 ${STUCK_MS}ms`);
  check('每一步等的都是它自己声明的那个信号',
    path.every((p) => !p.by || vocab.includes(p.by)),
    path.map((p) => `[${p.rules.join('+')}]${p.by ? '←' + p.by + (p.times > 1 ? '×' + p.times : '') : '（摆着）'}`).join(' '));
  check('第 3 条真的做到了，记了账（下一局不用补讲）', mixedTaught() === true);
  bar.destroy();
}

// ---------------------------------------------------------------------------
// ② 保底还在：一个信号都不报，也不会永远卡住
// ---------------------------------------------------------------------------
{
  const { host, bar } = mount('first', 'gate_stuck');
  const segs = host.querySelector('.coach-prog').children.length;
  advance(STUCK_MS * (segs + 1) + 1000);
  const at = host.querySelector('.coach-prog').children.filter((c) => c._cls.has('on')).length - 1;
  check('一个信号都不报，靠保底也走得到最后一步', at === segs - 1, `走到第 ${at + 1} / ${segs} 步`);
  check('靠保底跳过去的那一次**不**记账（下一局要补讲第 3 条）', mixedTaught() === false);
  bar.destroy();
}

// ---------------------------------------------------------------------------
// ③ 第二个基础玩法：先不出声，打够三次得分才开口
// ---------------------------------------------------------------------------
{
  // 上一局第 3 条做到过，所以这一路只剩这一族自己那条（第 4 条）。
  const { host, bar } = mount('second', 'gate_second', true);
  check('还没打够三次得分：条子不出声', host.hidden === true, String(host.hidden));
  bar.signal('match');
  bar.signal('match');
  advance(2000);
  check('打了两次：还是不出声', host.hidden === true, String(host.hidden));
  bar.signal('match');
  advance(AFTER_MS + 5);
  check('第三次得分之后才开口', host.hidden === false, String(host.hidden));
  check('开口讲的是这一族自己那条（第 4 条）', shownRules(host).join(',') === '3', shownRules(host).join(','));
  check('这一路不画进度条（只讲一两条，画了反而像漏了前面几条）',
    host.querySelector('.coach-prog').children.length === 0);
  bar.destroy();
}

// ---------------------------------------------------------------------------
// ④ 上一局第 3 条没做到：这一局补讲一次，摆在第 4 条前面
// ---------------------------------------------------------------------------
{
  // 存档里没有那一格 = 上一局第 3 条没做到。
  const { host, bar } = mount('second', 'gate_makeup');
  bar.signal('match');
  bar.signal('match');
  bar.signal('match');
  advance(AFTER_MS + 5);
  check('补讲的第一条是第 3 条（上一局没做到的那条）',
    shownRules(host).join(',') === '2', shownRules(host).join(','));
  bar.signal('mixed');
  advance(AFTER_MS + 5);
  check('补讲做到之后才轮到第 4 条', shownRules(host).join(',') === '3', shownRules(host).join(','));
  check('补讲这一次也记了账', mixedTaught() === true);
  bar.destroy();
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
