/**
 * 小红书降级层的求值器：哪些算式算得掉，算不掉的有没有退路。
 *
 *   npx esbuild xhs/src/oldKernel.ts --bundle --format=esm --outfile=/tmp/oldkernel.mjs
 *   node scripts/check-downlevel.mjs /tmp/oldkernel.mjs
 *
 * 为什么要有这道门——这是它存在的全部理由：
 *
 *   `downlevel()` 把整份样式表里的 clamp/min/max **当场算成 px**，因为 Chrome 61
 *   不认这三个函数。算不掉的原样留着，而留着就等于在 Chrome 61 上**整条声明被
 *   丢掉**（不是退回上一条，是那条声明没有了）。所以「哪几条算不掉、它们各自还
 *   有没有退路」是一份必须钉住的名单：多出来一条没退路的，就是某处排版在老内核
 *   上无声地塌了。
 *
 *   这件事出过事故：`--home-card-cap` 那条算式在 2026-09 从两项改成三项、里面
 *   多了一个 `var(--home-row-gap)`，求值器算不动，整条 min() 留下来，Chrome 61
 *   上 max-width 退回 none，主菜单的卡片撑满整列（横屏 844×390 量出来第一张卡
 *   的位置差 69px）。而当时唯一能验证这件事的 `xhs/check-oldcss.mjs` 要开浏览器、
 *   还要有人先跑 `npm run preview:xhs`——那一次预览页是旧的，门读的是上一版的
 *   样式，于是报了「全部通过」。**假绿比没有门更坏。**
 *
 *   这道门不开浏览器、不看预览页，直接 esbuild 打包真的 `downlevel()`，把真的
 *   `src/style.css` 喂进去，几十毫秒，进得了 CI，每次推送都跑。
 *
 * 它钉的不是「某一条算式」，是**那份算不掉的名单里没有一条是裸的**。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.argv[2];
if (!mod) {
  console.error('用法: node scripts/check-downlevel.mjs <打包好的 oldKernel.mjs>');
  process.exit(2);
}

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 假窗口。
 *
 * `downlevel` 只碰三样东西：window.innerWidth/innerHeight（视口单位换 px）、
 * getComputedStyle(documentElement).fontSize（rem 换 px）。markGaps 和 resolveFns
 * 都是纯文本变换。所以喂这三样就够，不需要 jsdom。
 */
function stubWindow(width, height) {
  globalThis.window = { innerWidth: width, innerHeight: height };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ fontSize: '16px' });
}
stubWindow(844, 390);

const { downlevel } = await import(pathToFileURL(mod).href);

/** 老内核：什么都不支持。这是这道门要量的那一档。 */
const OLD = {
  gap: false, clamp: false, minmax: false, ratio: false,
  svh: false, env: false, inset: false, has: false, colormix: false,
};
/** 新内核：什么都支持。downlevel 在这一档必须一个字都不改。 */
const NEW = {
  gap: true, clamp: true, minmax: true, ratio: true,
  svh: true, env: true, inset: true, has: true, colormix: true,
};

const CSS = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const BASELINE = readFileSync(new URL('../xhs/src/baseline.css', import.meta.url), 'utf8');

/**
 * 扫描前先把 CSS 注释剥掉。
 *
 * 这个仓库的注释密度很高，而且注释里**天天在写算式**——「max(72px, …)」
 * 「min(…, 400px)」「clamp(...)」这种散文式的引用到处都是。不剥注释，这道门
 * 第一次跑就报了 25 条「没有正当理由」，其中 9 条全是注释里的白话。
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** 标识符字符。和 oldKernel 的 IDENT 同一套：前一个字符是标识符就不算函数开头。 */
const IDENT = /[A-Za-z0-9_-]/;
const FN_NAMES = ['clamp', 'min', 'max'];

/** 从 `pos`（左括号）往后找配对的右括号。 */
function matchParen(s, pos) {
  let depth = 0;
  for (let i = pos; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * 把一段 CSS 里**最外层**的 clamp/min/max 整条抠出来（嵌在里面的不单独算）。
 * 返回 [{ name, text }]。
 */
function scanFns(rawCss) {
  const css = stripComments(rawCss);
  const out = [];
  let i = 0;
  while (i < css.length) {
    let hit = '';
    for (const name of FN_NAMES) {
      if (css.startsWith(name + '(', i)) {
        const before = i === 0 ? '' : css[i - 1];
        if (!before || !IDENT.test(before)) hit = name;
        break;
      }
    }
    if (!hit) { i++; continue; }
    const close = matchParen(css, i + hit.length);
    if (close < 0) { i++; continue; }
    out.push({ name: hit, text: css.slice(i, close + 1) });
    i = close + 1;
  }
  return out;
}

/** 这段值里还剩没算掉的 clamp/min/max 吗。 */
const stillHasFn = (value) => scanFns(value).length > 0;

/**
 * 把样式表拆成「一条条声明」，每条带上它的选择器和外面套着的 @规则。
 *
 * 为什么要连 @规则一起记：判断「有没有兜底」的时候，兜底那一行必须站在**同样
 * 或更外面**的作用域里。一条写在 `@media (min-width: 786px)` 里的兜底，管不了
 * 窄屏上那条裸声明。
 */
function declarations(rawCss) {
  const css = stripComments(rawCss);
  const out = [];
  const stack = [];
  let segStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(css.slice(segStart, i).trim().replace(/\s+/g, ' '));
      segStart = i + 1;
    } else if (ch === '}') {
      stack.pop();
      segStart = i + 1;
    } else if (ch === ';' && stack.length) {
      const text = css.slice(segStart, i);
      const c = text.indexOf(':');
      if (c > 0) {
        out.push({
          at: stack.filter((s) => s.startsWith('@')),
          // 最内层那个不是 @ 开头的前奏就是选择器列表。
          sel: [...stack].reverse().find((s) => !s.startsWith('@')) ?? '',
          prop: text.slice(0, c).trim(),
          value: text.slice(c + 1).trim(),
          i: out.length,
        });
      }
      segStart = i + 1;
    }
  }
  return out;
}

/** 把一份 CSS 拆成「一条条规则」：选择器列表 + 它写了哪些属性 + 外面套着什么。 */
function rules(rawCss) {
  const byBlock = new Map();
  for (const d of declarations(rawCss)) {
    const key = d.at.join('|') + '||' + d.sel;
    if (!byBlock.has(key)) {
      byBlock.set(key, {
        at: d.at,
        sels: d.sel.split(',').map((s) => s.trim()).filter(Boolean),
        props: [],
      });
    }
    byBlock.get(key).props.push(d.prop);
  }
  return [...byBlock.values()];
}

const BASE_RULES = rules(BASELINE);

// ---- 退路一：同一处自己写了两行 ---------------------------------------------
/**
 * 同一个选择器、同一个属性、排在它前面、而且那一行**不含** clamp/min/max
 * （老内核吃得下）。
 *
 * 为什么这才是真正该钉的不变量：算不掉不等于坏。算不掉的那条声明在 Chrome 61
 * 上会被**整条丢掉**，但只要前面还有一行老内核认得的同属性声明，页面就退回那
 * 一行，只是少了新内核上的那点精细——那是可以接受的降级。没有那一行，属性就退
 * 回初始值，那才是坏。
 *
 * 仓库里这个两行写法已经成型（.home-nav 的 padding、.slot-page .start-stage 的
 * padding-bottom，都带注释解释为什么要两行），这道门把它变成硬性要求。
 *
 * 按「选择器原文相同」认，不按「同一个 { } 块」认：`.slot-page .start-stage`
 * 那一对就是分开两条规则写的，CSS 里效果一样。at 那一串要求兜底站在同样或更外
 * 面的作用域（前缀关系）。
 */
function inlineFallback(all, d) {
  const scope = d.at.join('|');
  for (let i = d.i - 1; i >= 0; i--) {
    const x = all[i];
    if (x.sel !== d.sel || x.prop !== d.prop) continue;
    if (!scope.startsWith(x.at.join('|'))) continue;
    if (!stillHasFn(x.value)) return true;
  }
  return false;
}

// ---- 退路二：baseline.css 里手写了一条等价规则 --------------------------------
/**
 * 有些算式**物理上**算不掉——带 `%` 的要看容器多宽，那是排版排到一半才知道的
 * 事。这一类只能在 `xhs/src/baseline.css` 里按屏手写一条等价的，用 downlevel
 * 钉在 <html> 上的 `no-*` 类当开关（横屏游戏页那三条纵栏就是这么兜的）。
 *
 * 这道门不维护白名单，它去 baseline.css 里**核**：真有那么一条 `html.no-* 同一
 * 个选择器 { 同一个属性 }` 才算。谁哪天把 baseline 里那条删了，这儿立刻红。
 *
 * 只认没有 @ 包着的那些。Chrome 61 上九个 no-* 类是**一起**钉上的（gap 84、
 * clamp/min/max 79、aspect-ratio 88、env 69、inset 87、svh 108、:has 105、
 * color-mix 111——一个都没有），所以是哪个类不重要，重要的是它无条件生效。
 *
 * 选择器允许后面多一段伪类：`.app.app--game.pattern-sides` 对上
 * `html.no-minmax .app.app--game.pattern-sides:not(.has-coach)`——baseline 故意
 * 把带不带教学条的两半拆开写（那一段注释讲了为什么），但兜的是同一条。只允许
 * `:` 开头的后缀，不允许 `.`：否则 `.app` 会被 `.app.app--game` 那条冒领。
 */
function baselineFallback(sel, prop) {
  return BASE_RULES.some(
    (r) =>
      r.at.length === 0 &&
      r.props.includes(prop) &&
      r.sels.some((s) => {
        const m = /^html\.no-[a-z]+\s+(.+)$/.exec(s);
        if (!m) return false;
        const rest = m[1].trim();
        return rest === sel || (rest.startsWith(sel) && rest[sel.length] === ':');
      }),
  );
}

// ---- 退路三：这段代码 Chrome 61 根本走不到 -----------------------------------
/**
 * `@supports` 的条件它不认得，整段对它就不存在——里面的声明算不掉也没关系。
 *
 * 表里没有的条件一律当**不知道**处理并且报红：新写一个 @supports 就得回来做一
 * 次判断，不能默默当成安全。
 */
const SUPPORTS_ON_61 = new Map([
  ['(display: contents)', false],            // Chrome 65 才有
  ['(backdrop-filter: blur(1px))', false],   // 不带前缀的到 Chrome 76 才有
]);

/** 返回 { reachable } 或 { unknown: 条件原文 }。 */
function reach61(at) {
  for (const a of at) {
    if (!a.startsWith('@supports')) continue;
    const raw = a.replace(/^@supports\s*/, '').trim();
    const neg = /^not\s/.test(raw);
    const cond = raw.replace(/^not\s+/, '').trim();
    if (!SUPPORTS_ON_61.has(cond)) return { unknown: cond };
    const holds = neg ? !SUPPORTS_ON_61.get(cond) : SUPPORTS_ON_61.get(cond);
    if (!holds) return { reachable: false, why: a };
  }
  return { reachable: true };
}

/**
 * 算不掉是**应该**的那几种变量。
 *
 * 共同点：它们的值在跑起来之前根本不存在，静态算不出来，硬算就是错。
 *
 *  · `--safe-area-inset-*`：**小红书宿主注入的**。样式表里 0 处声明。把它烘成
 *    一个数，宿主给的刘海高度就永远生效不了。
 *  · `--marks`：**JS 逐元素内联设的**（startStage.ts、roomNotices.ts 里
 *    `style="--marks:N"`）。样式表里 0 处声明。烘死就等于所有开局页的标志都按
 *    同一个数量排版。
 *  · `--rank-line`：样式表里声明了，但它自己依赖一个 JS 会覆盖的变量——
 *    `--rank-line: calc((var(--rank-h) - 15px) / var(--rank-rows))`，而
 *    scoreboard.ts:257 会按真实人数 setProperty('--rank-rows')。
 *  · `--narrow-gap`：`xhs/src/menuFit.ts` 按「这一排装得下装不下」当场
 *    setProperty / removeProperty（375×667 就是靠它才排得开），而且 `xhs/src/
 *    pages.css:238` 把它又声明了一遍，和 `src/style.css:1013` 不是一个值。
 *  · `--home-row-gap`：`src/style.css:1224` 是一条 clamp，可 1282 行在横屏那段
 *    媒体查询里把它改成 14px。文本级替换挑不了作用域，照外面那条烘，844×390
 *    上算出 118px，而对的是 124px——错的正好是最需要它算准的那批屏幕。
 *
 *    ⚠️ 后三条是陷阱：「只替换样式表里声明过的变量」这条安全边界**拦不住它们**。
 *    今天挡住它们的是另一条规则——「值里还含 var( 的一律跳过」。谁以后想把求值
 *    器「改进」成支持变量套变量，先去读 oldKernel.ts 里 evalExpr 上面那一段。
 */
const OK_VARS = [
  '--safe-area-inset-',
  '--marks',
  '--rank-line',
  '--narrow-gap',
  '--home-row-gap',
];

/**
 * 另一类合法的算不掉：**算式里带 `%`（或 em/ch/ex）**。
 *
 * 百分比要看容器多宽，那是排版排到一半才知道的事，静态求值器不可能算出来——
 * `toPx()` 对它返回 null 正是这个意思。这一类不是 bug，是物理限制。消灭不了，
 * 只能给退路（见上面三条）。
 */
// 注意 `%` 后面不能加 \b：`100%)` 里 `%` 和 `)` 都是非词字符，中间没有词边界，
// 加了 \b 这条正则就永远不匹配百分比（第一版就是这么写的，结果 15 条带 % 的
// 算式全被当成「没有正当理由」）。em/ch/ex 是字母结尾，那几个要 \b。
const UNRESOLVABLE_UNIT = /\d\s*%|\d\s*(em|ch|ex)\b/;

/** 这一条算不掉，理由是什么？没有理由就是这道门要抓的那一条。 */
function leftBecause(text) {
  const v = OK_VARS.find((k) => text.includes(k));
  if (v) return v;
  if (UNRESOLVABLE_UNIT.test(text)) return '带 % / em（要看布局，静态算不出）';
  return null;
}

const oneLine = (s, n = 96) => s.replace(/\s+/g, ' ').slice(0, n);

// ---- 1. 算不掉的那一组，每一条都得有正当理由 --------------------------------
//
// 它不点名「哪一行」——行号会变，而且样式表天天在改；它要的是「每一条剩下来的
// 算式，算不掉的原因都是一件静态求值器**本来就办不到**的事」。谁写了一条新的、
// 求值器算不掉、又说不出原因的算式，这里当场红。
{
  const left = scanFns(downlevel(CSS, OLD));
  const bad = left.filter((f) => !leftBecause(f.text));
  check(
    '算不掉的算式，每一条都说得出为什么算不掉',
    bad.length === 0,
    bad.length
      ? `\n      说不出原因的 ${bad.length} 条：\n${bad.map((f) => '        ' + oneLine(f.text, 110)).join('\n')}`
      : `共 ${left.length} 条，都有原因`,
  );

  // 把名单打出来，方便人看一眼「现在到底剩哪些」。不算断言。
  const byVar = new Map();
  for (const f of left) {
    const k = leftBecause(f.text) ?? '（说不出原因）';
    byVar.set(k, (byVar.get(k) ?? 0) + 1);
  }
  console.log('      留下来的（按挡住它的东西分）：');
  for (const [k, n] of [...byVar].sort()) console.log(`        ${k}  ×${n}`);
}

// ---- 2. 算不掉的每一条，都得有一条退路 --------------------------------------
//
// **这一条才是真正要钉的不变量。** 第 1 条只说「算不掉是有原因的」，可有原因也
// 照样会在 Chrome 61 上被整条丢掉；真正决定页面坏不坏的，是它有没有退得回去的
// 地方。三种退路都算（写两行 / baseline.css 手写 / 这段它根本走不到），三种都
// 没有就是裸的。
{
  const all = declarations(downlevel(CSS, OLD));
  const stuck = all.filter((d) => stillHasFn(d.value));

  const unknownSupports = [];
  const naked = [];
  const tally = { 写两行: 0, baseline: 0, 走不到: 0 };
  for (const d of stuck) {
    const r = reach61(d.at);
    if (r.unknown) { unknownSupports.push({ d, cond: r.unknown }); continue; }
    if (r.reachable === false) { tally.走不到++; continue; }
    if (inlineFallback(all, d)) { tally.写两行++; continue; }
    if (baselineFallback(d.sel, d.prop)) { tally.baseline++; continue; }
    naked.push(d);
  }

  check(
    '算不掉的每一条都有退路：写了两行 / baseline.css 手写 / Chrome 61 走不到',
    naked.length === 0,
    naked.length
      ? `\n      裸着的 ${naked.length} 条（在 Chrome 61 上整条丢掉，属性退回初始值）：\n${naked
          .map((d) => `        ${d.sel}\n          ${d.prop}: ${oneLine(d.value, 90)}`)
          .join('\n')}`
      : `${stuck.length} 条算不掉：写两行 ${tally.写两行} / baseline ${tally.baseline} / 走不到 ${tally.走不到}`,
  );

  // 新写的 @supports 必须回来做一次判断，不能默默当成安全。
  check(
    '每一个 @supports 条件都判过 Chrome 61 认不认得',
    unknownSupports.length === 0,
    unknownSupports.length
      ? `\n      没判过的条件：\n${[...new Set(unknownSupports.map((u) => u.cond))]
          .map((c) => `        @supports ${c}   ——去 SUPPORTS_ON_61 里补一行`)
          .join('\n')}`
      : `${SUPPORTS_ON_61.size} 个条件在表里`,
  );
}

// ---- 3. 主菜单那条卡片上限 ---------------------------------------------------
//
// 就是出过事故的那一条：--home-card-cap。
//
// 这一条**不要求它算成 px**。求值器认识 var() 那个增强被否掉了，理由写在
// oldKernel.ts 的 evalExpr 上面：--home-row-gap 在横屏媒体查询里是另一个值，
// 文本级替换挑不了作用域，844×390 上会算出 118px 而正确值是 124px——错的正好
// 是最需要它算对的那批屏幕。
//
// 所以这儿只钉「它有退路」：--home-card-cap: 255px 那一行写在 min(...) 前面，
// Chrome 61 上卡片退回 255px 的上限，不会变成 none 撑满整列。
{
  const all = declarations(downlevel(CSS, OLD));
  const caps = all.filter((d) => d.prop === '--home-card-cap');
  const stuck = caps.filter((d) => stillHasFn(d.value));
  check(
    '主菜单卡片上限：算不掉，但前面有一行写死的兜底',
    stuck.length > 0 && stuck.every((d) => inlineFallback(all, d)),
    `${caps.length} 条声明，其中 ${stuck.length} 条算不掉`,
  );
}

// ---- 4 / 5. 两条绝对不能被换掉的 --------------------------------------------
{
  const out = downlevel(CSS, OLD);
  check(
    '宿主注入的 var(--safe-area-inset-*) 原样还在',
    out.includes('var(--safe-area-inset-bottom'),
    '换掉就等于把宿主给的刘海高度永久丢掉',
  );
  check(
    'JS 逐元素设的 var(--marks) 原样还在',
    out.includes('var(--marks'),
    '换掉就等于所有开局页标志按同一个数量排版',
  );
}

// ---- 6. 新内核上这个文件等于不存在 -------------------------------------------
check('新内核（全支持）下 downlevel 一个字都不改', downlevel(CSS, NEW) === CSS);

// ---- 7. 换三种窗口，前两条都得成立 -------------------------------------------
//
// 视口单位换了算出来的数当然不同，但「算不算得掉」「有没有退路」不该跟着变。
// 568×320 是横屏里最窄的一档，390×844 是竖屏，844×390 是横屏——三种都走一遍。
for (const [w, h, name] of [[568, 320, '老横屏'], [390, 844, '竖屏'], [844, 390, '横屏']]) {
  stubWindow(w, h);
  const all = declarations(downlevel(CSS, OLD));
  const left = scanFns(downlevel(CSS, OLD));
  const noReason = left.filter((f) => !leftBecause(f.text));
  const naked = all.filter(
    (d) =>
      stillHasFn(d.value) &&
      reach61(d.at).reachable === true &&
      !inlineFallback(all, d) &&
      !baselineFallback(d.sel, d.prop),
  );
  check(
    `${name} ${w}×${h}：算不掉的说得出原因，而且都有退路`,
    noReason.length === 0 && naked.length === 0,
    `剩 ${left.length} 条算不掉，说不出原因 ${noReason.length}、裸着 ${naked.length}`,
  );
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
