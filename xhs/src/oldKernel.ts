/**
 * Chrome 61 的样式降级层——只有小红书这一版加载。
 *
 * ===========================================================================
 * 为什么要有这一层
 *
 * 打包时 esbuild 能把 JS 的**语法**降到 es2017，缺的接口也在 xhs/polyfills.js
 * 里补了。CSS 没有这一步：浏览器遇到不认识的**声明**会把整条丢掉，遇到不认识
 * 的**选择器**会把整条规则丢掉——不报错、不留痕，页面只是散架。src/ 里这样的
 * 地方有三百多处（括号里是它真正落地的 Chrome 版本）：
 *
 *   gap            133 处  (flex 要 84；grid 那边 57 起是 grid-gap，66 才认 gap)
 *   clamp()         38 处  (79)
 *   min() / max()   42 处  (79)
 *   aspect-ratio    26 处  (88)
 *   inset           19 处  (87)
 *   svh / dvh       15 处  (108)
 *   env()           13 处  (69)
 *   :has()           9 处  (105，整条规则)
 *
 * ===========================================================================
 * 分两路补
 *
 * 一、能算出来的，在这里**当场算**（下面的 downlevel）。
 *
 *    clamp/min/max 的参数全是长度，而这一刻窗口多大是知道的，所以可以直接算
 *    成 px 写回样式表。svh/dvh 换成 vh，env() 换成它自己带的那个默认值。
 *
 *    为什么不另写一份「手抄一遍的降级样式表」：那等于把三百多个数字抄第二遍，
 *    以后网页版改一个数、这一版没跟着改，两边就悄悄漂开——规范里明说了不要维
 *    护两套。当场算是同一份数字的两种读法，改一次两边都跟着变。
 *
 *    有一处是非算不可的，不是好看不好看的问题：
 *
 *      .home-page--wide {
 *        --home-card-cap: 255px;                              ← 兜底
 *        --home-card-cap: min(255px, max(72px, ...));          ← 新写法
 *      }
 *
 *    「先写兜底、后写新写法」这条老规矩对**自定义属性不成立**：自定义属性的
 *    值在声明时不做校验，min(...) 会被原样收下，等到 max-width: var(--home-
 *    card-cap) 用它的时候才发现是无效值，那时的结果不是回退到 255px，而是整
 *    个属性变成初始值——max-width: none。也就是说主菜单的卡片在 Chrome 61 上
 *    **完全不受限制**，撑满整列。玩家报的「主菜单大小、间距要改」就是这个。
 *
 *    窗口一变要重算（横竖屏一转，vh 全变），所以 resize / orientationchange
 *    上挂了重跑，节流到一帧。
 *
 * 二、算不出来的（gap 要改成子项的外边距、aspect-ratio 要换成内边距百分比、
 *    :has 要换等价选择器），靠 baseline.css 按屏手写，用这里钉在 <html> 上
 *    的那几个类当开关——认得的内核上那些规则一条也不生效。
 *
 * ===========================================================================
 * 新内核上这个文件等于不存在：探测全过就一个类也不钉，downlevel 直接返回原文，
 * 连一次字符串扫描都不做。
 */

/** 这一版关心的能力。钉在 <html> 上的类名就是 'no-' + 键名。 */
export interface KernelSupport {
  gap: boolean;
  clamp: boolean;
  minmax: boolean;
  ratio: boolean;
  svh: boolean;
  env: boolean;
  inset: boolean;
  has: boolean;
  colormix: boolean;
}

const supportsDecl = (prop: string, value: string): boolean => {
  try {
    return typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports(prop, value);
  } catch {
    return false;
  }
};

const supportsSelector = (sel: string): boolean => {
  try {
    // selector() 这个查询函数本身是 84 才有的，所以 61 上必然 false。
    // 那正好——把 :has 当作没有来处理，等价规则是无害的（见 baseline.css）。
    return typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports(`selector(${sel})`);
  } catch {
    return false;
  }
};

/**
 * flex 的 gap 没法用 CSS.supports 问准：Chrome 61 认得 gap 这个属性名（grid
 * 那边 66 起就认），但它在 flex 容器上不起作用，而 supports 只回答「这个属性
 * 这个值解析得了吗」。所以量一次：两个 10px 的块夹一道 10px 的缝，量出来 30
 * 就算有。
 */
function probeFlexGap(): boolean {
  if (typeof document === 'undefined' || !document.body) return true;
  const box = document.createElement('div');
  box.setAttribute(
    'style',
    'display:flex;gap:10px;position:absolute;left:-9999px;top:0;visibility:hidden;',
  );
  for (let i = 0; i < 2; i++) {
    const kid = document.createElement('div');
    kid.setAttribute('style', 'width:10px;height:1px;flex:none');
    box.appendChild(kid);
  }
  document.body.appendChild(box);
  const w = box.getBoundingClientRect().width;
  document.body.removeChild(box);
  return w >= 29;
}

export function probeKernel(): KernelSupport {
  return {
    gap: probeFlexGap(),
    clamp: supportsDecl('width', 'clamp(1px, 2px, 3px)'),
    minmax: supportsDecl('width', 'min(1px, 2px)'),
    ratio: supportsDecl('aspect-ratio', '1 / 1'),
    svh: supportsDecl('height', '1svh'),
    env: supportsDecl('padding-bottom', 'env(safe-area-inset-bottom, 0px)'),
    inset: supportsDecl('inset', '0px'),
    has: supportsSelector(':has(*)'),
    colormix: supportsDecl('color', 'color-mix(in srgb, red, blue)'),
  };
}

/** 把探测结果钉成 <html> 上的类，给 baseline.css 当开关。 */
export function stampKernel(s: KernelSupport): void {
  const root = document.documentElement;
  const set = (name: string, ok: boolean) => {
    if (ok) root.classList.remove(name);
    else root.classList.add(name);
  };
  set('no-gap', s.gap);
  set('no-clamp', s.clamp);
  set('no-minmax', s.minmax);
  set('no-ratio', s.ratio);
  set('no-svh', s.svh);
  set('no-env', s.env);
  set('no-inset', s.inset);
  set('no-has', s.has);
  set('no-colormix', s.colormix);
}

// ---- 把算得出来的当场算掉 ---------------------------------------------------

/** 一个长度换成 px。换不了（%、em、未知单位）返回 null，整条式子就放弃。 */
function toPx(token: string, rootFont: number): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(token.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const vw = window.innerWidth / 100;
  const vh = window.innerHeight / 100;
  switch (unit) {
    case '':
      return n; // 纯数字当倍数用：(100svh - 356px) / 3.11 里的那个 3.11
    case 'px':
      return n;
    case 'rem':
      return n * rootFont;
    case 'vw':
    case 'svw':
    case 'dvw':
    case 'lvw':
      return n * vw;
    case 'vh':
    case 'svh':
    case 'dvh':
    case 'lvh':
      return n * vh;
    case 'vmin':
      return n * Math.min(vw, vh);
    case 'vmax':
      return n * Math.max(vw, vh);
    default:
      // %、em、ch、ex 都要看上下文，这里算不了，整条式子原样留着。
      return null;
  }
}

/**
 * 算一段 CSS 算式，例如 `(100vh - 356px) / 3.11`、`8vw`、`100% - 2px`（最后
 * 这个会放弃）。只认 + - * / 和圆括号。算不出来返回 null。
 */
function evalExpr(src: string, rootFont: number): number | null {
  const tokens = src.match(/[()+\-*/]|[\d.]+[a-z%]*/gi);
  if (!tokens) return null;
  let i = 0;
  let bad = false;

  const peek = () => tokens[i];
  const eat = () => tokens[i++];

  const primary = (): number => {
    const t = eat();
    if (t === undefined) {
      bad = true;
      return 0;
    }
    if (t === '(') {
      const v = sum();
      if (peek() === ')') eat();
      else bad = true;
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    const px = toPx(t, rootFont);
    if (px === null) {
      bad = true;
      return 0;
    }
    return px;
  };
  const product = (): number => {
    let v = primary();
    for (;;) {
      const t = peek();
      if (t === '*') {
        eat();
        v *= primary();
      } else if (t === '/') {
        eat();
        const d = primary();
        if (!d) {
          bad = true;
          return 0;
        }
        v /= d;
      } else return v;
    }
  };
  const sum = (): number => {
    let v = product();
    for (;;) {
      const t = peek();
      if (t === '+') {
        eat();
        v += product();
      } else if (t === '-') {
        eat();
        v -= product();
      } else return v;
    }
  };

  const out = sum();
  if (bad || i !== tokens.length || !isFinite(out)) return null;
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
const IDENT = /[A-Za-z0-9_-]/;
const FN_NAMES = ['clamp', 'min', 'max'];

/**
 * 把一段 CSS 里的 clamp() / min() / max() 换成算好的 px。
 *
 * 一遍扫过去，遇到一个就先递归处理它的参数（里面可能还嵌着一个，
 * `min(255px, max(72px, ...))` 就是），再算外面这层。算不动的
 * （参数里有 % 或 em）原样写回去——留着总比换错好。
 */
function resolveFns(css: string, rootFont: number): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    let hit = '';
    for (const name of FN_NAMES) {
      if (css.startsWith(name + '(', i)) {
        // minmax( 里的 max(、-webkit-min- 之类都不算：前一个字符是标识符就跳过
        const before = i === 0 ? '' : css[i - 1];
        if (!before || !IDENT.test(before)) hit = name;
        break;
      }
    }
    if (!hit) {
      out += css[i++];
      continue;
    }
    const open = i + hit.length;
    const close = matchParen(css, open);
    if (close < 0) {
      out += css[i++];
      continue;
    }
    const inner = resolveFns(css.slice(open + 1, close), rootFont);
    const nums = inner.split(',').map((a) => evalExpr(a, rootFont));
    let done: string | null = null;
    if (!nums.some((n) => n === null)) {
      const v = nums as number[];
      if (hit === 'clamp' && v.length === 3) done = String(round(Math.min(Math.max(v[1], v[0]), v[2])));
      else if (hit === 'min' && v.length >= 1) done = String(round(Math.min.apply(null, v)));
      else if (hit === 'max' && v.length >= 1) done = String(round(Math.max.apply(null, v)));
    }
    out += done === null ? `${hit}(${inner})` : `${done}px`;
    i = close + 1;
  }
  return out;
}

/** 从 `pos`（左括号的位置）往后找配对的右括号。找不到返回 -1。 */
function matchParen(text: string, pos: number): number {
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 一整份样式表的降级。顺序有讲究：先把 svh/dvh 换成 vh（这样 clamp 里含 svh
 * 的也算得出来），再算函数，最后处理 env()。
 */
export function downlevel(css: string, s: KernelSupport): string {
  let out = css;
  if (!s.gap) out = markGaps(out);
  if (!s.svh) {
    // 100svh / 100dvh / 50lvh 都换成 vh 那一套：视口单位的三个变体老内核不认。
    out = out.replace(/(\d[\d.]*)(s|d|l)(vh|vw|vmin|vmax)\b/g, '$1$3');
  }
  if (!s.env) {
    // env(safe-area-inset-bottom, 118px) 换成 118px；没写默认值的当 0。
    // 这一版跑在 2017 年前后那批安卓上，没有刘海也没有底部横杠，所以「当 0」
    // 不是将就，就是正确答案。
    //
    // 这一步要排在下面算 clamp/min/max **之前**：像
    // `max(24px, calc(10px + env(safe-area-inset-top, 0px)))` 这样的式子，
    // env 还在里面的时候算不出来，整条 max() 就会原样留着——留着就等于在
    // Chrome 61 上被丢掉。顺序反了一次，漏掉的正是页面顶上让开刘海那几道。
    out = out.replace(/env\(\s*safe-area-inset-[a-z]+\s*,\s*([^()]*?)\s*\)/g, '$1');
    out = out.replace(/env\(\s*safe-area-inset-[a-z]+\s*\)/g, '0px');
  }
  if (!s.clamp || !s.minmax) {
    const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    out = resolveFns(out, rootFont);
  }
  return out;
}

// ---- gap：改成子项的外边距 --------------------------------------------------
//
// gap 没法靠改文本解决：它要的是「每个子项加多少外边距」，而加在哪一边取决于
// 这个容器是横排还是竖排、正着还是反着、会不会折行——这些写在别的规则里，光看
// 这一条规则的文本看不出来。
//
// 所以分两步：
//
//   1. 改文本时，把每一条 `gap: X` 旁边**再抄一份**到自定义属性上
//      （--sg / --scg / --srg）。自定义属性 Chrome 49 就有，而且不做校验，
//      所以老内核收得下，getComputedStyle 也读得出来——原来那条 gap 它读不
//      出来，因为它压根没解析。顺手补一条 grid-gap：网格那边 Chrome 57 就认
//      这个名字，网格容器一行就补齐了，不用走下面这一步。
//
//   2. 跑起来之后遍历 DOM：谁身上有 --sg，就按它当时的 flex-direction /
//      flex-wrap 给子项加外边距。
//
// 自定义属性是会继承的，所以第 1 步还会在表头钉一条 `* { --sg: none; ... }`：
// 每个元素都有了自己的声明，继承就断了；真正设了 gap 的那些规则权重更高，照旧
// 生效。代价是每个元素多算三个自定义属性，可以忽略。
//
// 这条路的好处是**一个数字只写一遍**：网页版改 gap，这一版跟着变，没有第二份
// 要同步的数字。

const GAP_RESET = '*{--sg:none;--scg:none;--srg:none}\n';

/**
 * 把每条 gap 声明**换成**一份自定义属性。
 *
 * 是「换成」不是「补上」：老内核上那条 gap 本来就不起作用，留不留一个样；
 * 而拿掉它，这一层在新浏览器上强制跑起来（oldKernel 的那个后门）才和真的
 * Chrome 61 一模一样——不然新浏览器会把 gap 和这里加的外边距一起算，量出来
 * 的间距是双份的，对照台会当成「降级层错了」。第一次跑出来就是这个，两边
 * 差 25px。
 *
 * 网格容器不在这条路上：它的间距在下面那支代码里用 grid-gap 补，那个名字
 * Chrome 57 就认。
 */
function markGaps(css: string): string {
  const out = css.replace(
    /(^|[;{])(\s*)(gap|column-gap|row-gap)(\s*):([^;}]+)/g,
    (_all, pre: string, ws: string, prop: string, _ws2: string, val: string) => {
      const varName = prop === 'gap' ? '--sg' : prop === 'column-gap' ? '--scg' : '--srg';
      return `${pre}${ws}${varName}:${val}`;
    },
  );
  return GAP_RESET + out;
}

const px = (v: string): number => {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

/**
 * 哪些元素身上有 `auto` 外边距——那几道不能碰。
 *
 * 弹性布局里的 auto 外边距是「把多出来的空白平分给我」的意思，游戏页正是靠
 * 它把图示和棋盘匀在读数和按键之间（src/style.css 的
 * `.app--game > .pattern-hint--a { margin-top: auto }`，还有 boardResize.ts
 * 给棋盘那一格钉的 `style.margin = 'auto'`）。上面那套「给子项加边距」的补法
 * 一写就把 auto 顶掉，整页往上缩一大截——第一次跑对照台就是这个，棋盘高了
 * 100px。
 *
 * getComputedStyle 读不出「这是 auto」：它给的是算完之后的那个像素数。所以
 * 从样式表的文本里把写着 auto 的选择器摘出来，配上 Element.matches 用。
 * 行内那一路（boardResize 钉的）直接看 el.style 就有。
 */
interface AutoRule {
  sel: string;
  sides: string[];
}
const SIDES = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'];
/** 一道缝写在这一侧不行，就写到上一个子项的对面那一侧。 */
const MIRROR: Record<string, string> = {
  marginTop: 'marginBottom',
  marginBottom: 'marginTop',
  marginLeft: 'marginRight',
  marginRight: 'marginLeft',
};

function collectAutoMargins(css: string): AutoRule[] {
  const out: AutoRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel || sel.charAt(0) === '@') continue;
    const body = m[2];
    const sides: string[] = [];
    // 简写：margin: a b c d —— 按 CSS 的补齐规则摊成四个
    const short = /(^|[;{\s])margin\s*:\s*([^;}]+)/.exec(body);
    if (short && short[2].indexOf('auto') >= 0) {
      const p = short[2].trim().split(/\s+/);
      const four = [
        p[0],
        p[1] !== undefined ? p[1] : p[0],
        p[2] !== undefined ? p[2] : p[0],
        p[3] !== undefined ? p[3] : (p[1] !== undefined ? p[1] : p[0]),
      ];
      for (let i = 0; i < 4; i++) if (four[i] === 'auto') sides.push(SIDES[i]);
    }
    // 长写：margin-top: auto 之类
    for (let i = 0; i < 4; i++) {
      const name = SIDES[i].replace(/([A-Z])/g, (c) => '-' + c.toLowerCase());
      if (new RegExp('(^|[;{\\s])' + name + '\\s*:\\s*auto').test(body)) {
        if (sides.indexOf(SIDES[i]) < 0) sides.push(SIDES[i]);
      }
    }
    if (sides.length) out.push({ sel, sides });
  }
  return out;
}

let AUTO_RULES: AutoRule[] = [];

/** 这个元素这一侧的外边距是 auto 吗（写在样式表里的，或者行内钉的）。 */
function isAutoSide(el: HTMLElement, side: string): boolean {
  const inline = (el.style as unknown as Record<string, string>)[side];
  if (inline === 'auto') return true;
  for (let i = 0; i < AUTO_RULES.length; i++) {
    const r = AUTO_RULES[i];
    if (r.sides.indexOf(side) < 0) continue;
    try {
      if (el.matches(r.sel)) return true;
    } catch {
      /* 选择器里有这个内核不认的写法（:has 之类），当作不匹配 */
    }
  }
  return false;
}

/**
 * 把 --sg 变成子项的外边距。
 *
 * 不折行的：除第一个以外每个子项，在「上一个的那一侧」加一道。row-reverse 加
 * 在右边、column-reverse 加在下边——反向排布里，视觉上挨着上一个的是这一边。
 *
 * 会折行的：每个子项四周各加一半。四周对称，所以居中的一排还是居中的（只在
 * 一侧加会把整排推歪半道缝）；折下来的第二行也跟着有了行距。
 */
export function applyGapFallback(root: ParentNode): void {
  const all = root.querySelectorAll<HTMLElement>('*');
  const wrapHosts: [HTMLElement, number, number][] = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const cs = getComputedStyle(el);
    const g = cs.getPropertyValue('--sg').trim();
    if (!g || g === 'none') continue;
    const disp = cs.display;

    const parts = g.split(/\s+/);
    const rowRaw = (cs.getPropertyValue('--srg').trim() || '').replace('none', '');
    const colRaw = (cs.getPropertyValue('--scg').trim() || '').replace('none', '');
    const rg = px(rowRaw || parts[0]);
    const cg = px(colRaw || parts[1] || parts[0]);

    // 网格容器一行就够：grid-gap 这个名字 Chrome 57 就认。
    if (disp.indexOf('grid') >= 0) {
      el.style.gridGap = `${rg}px ${cg}px`;
      continue;
    }
    if (disp.indexOf('flex') < 0) continue;
    // 缝是 0 的容器不碰：给子项钉一条 margin: 0 会把它自己 CSS 里写的外边距
    // 顶掉（.home-page 就是 gap: 0，而它的子项各有各的边距）。
    if (!rg && !cg) continue;

    const dir = cs.flexDirection || 'row';
    const rowish = dir.indexOf('row') === 0;

    // 真正参与排布的那些子项：display:none 的不算（它不是弹性项，缝也不会
    // 加在它两边），绝对定位的也不算（它不占位，给它加边距只会把它挪走）。
    const live: HTMLElement[] = [];
    const kidsAll = el.children;
    for (let k = 0; k < kidsAll.length; k++) {
      const kid = kidsAll[k] as HTMLElement;
      if (!kid.style) continue;
      const kc = getComputedStyle(kid);
      if (kc.display === 'none' || kc.position === 'absolute') continue;
      live.push(kid);
    }
    if (!live.length) continue;

    // 「写着可以折行」和「这一屏真的折了行」是两回事。《暂停》《完成》那一排
    // 写着 flex-wrap: wrap，可两颗键从来排得下——真按折行那套补（子项四周各
    // 半道、容器四周各减半道），这一排会整体左移半道缝。所以量一下：都在同
    // 一条线上就走简单那条路。
    let wraps = false;
    if ((cs.flexWrap || 'nowrap') !== 'nowrap' && live.length > 1) {
      const first = live[0].getBoundingClientRect();
      for (let k = 1; k < live.length; k++) {
        const r = live[k].getBoundingClientRect();
        if (Math.abs((rowish ? r.top - first.top : r.left - first.left)) > 1) {
          wraps = true;
          break;
        }
      }
    }

    for (let k = 0; k < live.length; k++) {
      const kid = live[k];
      const put = (side: string, value: string): boolean => {
        // auto 的那一侧不碰：那是「把空白平分给我」，写死就把它顶掉了。
        if (isAutoSide(kid, side)) return false;
        (kid.style as unknown as Record<string, string>)[side] = value;
        return true;
      };
      if (wraps) {
        put('marginTop', rg / 2 + 'px');
        put('marginBottom', rg / 2 + 'px');
        put('marginLeft', cg / 2 + 'px');
        put('marginRight', cg / 2 + 'px');
        wrapHosts.push([el, rg, cg]);
        continue;
      }
      const first = k === 0;
      const side =
        dir === 'row' ? 'marginLeft'
          : dir === 'row-reverse' ? 'marginRight'
            : dir === 'column-reverse' ? 'marginBottom'
              : 'marginTop';
      const amount = rowish ? cg : rg;
      // 每次都写绝对值（第一个写 0），所以反复跑不会越加越多。
      if (put(side, first ? '0px' : amount + 'px') || first) continue;
      // 这一侧是 auto，加不上去。可这一道缝还是得有——它是**两个**子项之间的
      // 空当，写在谁身上都行，所以改写到上一个的另一侧去。
      //
      // 游戏页正是这样：图示和棋盘的上边都写着 auto（那三道 auto 负责把空当
      // 均分），直接跳过的话四个子项之间只剩一道缝，另外两道被 auto 悄悄吸收
      // 掉——总高度不变，但三段空当不再一样大，棋盘整个往上挪一截（对照台量
      // 出来 9px）。
      const back = MIRROR[side];
      const prev = live[k - 1];
      if (!isAutoSide(prev, back)) {
        (prev.style as unknown as Record<string, string>)[back] = amount + 'px';
      }
    }
  }
  for (let i = 0; i < wrapHosts.length; i++) {
    trimWrapHost(wrapHosts[i][0], wrapHosts[i][1], wrapHosts[i][2]);
  }
}

/**
 * 会折行那种容器的收边。
 *
 * 子项四周各加了半道缝，所以整块比原来大了一整道：左右各半、上下各半。gap
 * 只在**中间**加空，边上不加，所以要把多出来的这一圈从容器身上减回去
 * （第一次跑对照台，得分图案那一排就因为这个高了 20px）。
 *
 * 减的是「它本来的外边距」减半道缝，所以原值得先记下来——不记的话第二次跑
 * 读到的是上一次写进去的值，会一路减下去。写在 data 属性上，重画也带得走。
 * auto 的那几侧照旧不碰。
 */
function trimWrapHost(el: HTMLElement, rg: number, cg: number): void {
  const KEY = 'sgOrig';
  const data = el.dataset as unknown as Record<string, string | undefined>;
  if (data[KEY] === undefined) {
    const cs = getComputedStyle(el);
    data[KEY] = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join('|');
  }
  const orig = (data[KEY] as string).split('|');
  // 一根轴上一共要收掉一整道缝（子项在两头各多出半道）。两边都能收就一边
  // 一半；有一边是 auto 收不了，就把整道都放到另一边——不然这一块会比原来
  // 高出半道，而它上面那个 auto 外边距会把这半道从空当里让出来，看着就是
  // 棋盘整体往上跳了一截（对照台量出来 9px）。
  const cut = [0, 0, 0, 0];
  const axis = (a: number, b: number, total: number) => {
    const okA = !isAutoSide(el, SIDES[a]);
    const okB = !isAutoSide(el, SIDES[b]);
    if (okA && okB) {
      cut[a] = total / 2;
      cut[b] = total / 2;
    } else if (okA) cut[a] = total;
    else if (okB) cut[b] = total;
  };
  axis(0, 2, rg); // 上下
  axis(1, 3, cg); // 左右
  for (let i = 0; i < 4; i++) {
    if (isAutoSide(el, SIDES[i])) continue;
    (el.style as unknown as Record<string, string>)[SIDES[i]] = px(orig[i]) - cut[i] + 'px';
  }
}

/** 要降级的那几张表：injectStyles() 装的那张，和这一版自己那张。 */
const SHEETS = ['slides-styles', 'xhs-styles'];

/**
 * 装上降级层：探测 → 钉类 → 把已经装好的样式表就地改写，之后窗口一变重来
 * 一遍（vh 变了，算好的 px 得跟着变）。
 *
 * 要在 injectStyles() 和这一版自己那块样式都装好之后调用。
 */
export function installOldKernel(): KernelSupport {
  const s = forced() || probeKernel();
  stampKernel(s);

  const allOk = s.clamp && s.minmax && s.svh && s.env && s.gap;
  // 全都认得就什么也不做——一次字符串扫描都不值当。
  if (allOk) return s;

  const originals = new Map<string, string>();
  const rewrite = () => {
    if (!AUTO_RULES.length) {
      AUTO_RULES = collectAutoMargins(
        SHEETS.map((id) => document.getElementById(id)?.textContent || '').join('\n'),
      );
    }
    for (const id of SHEETS) {
      const tag = document.getElementById(id);
      if (!tag) continue;
      if (!originals.has(id)) originals.set(id, tag.textContent || '');
      const next = downlevel(originals.get(id) as string, s);
      if (next !== tag.textContent) tag.textContent = next;
    }
  };
  const regap = () => {
    if (!s.gap) applyGapFallback(document);
  };

  rewrite();
  regap();

  let queued = 0;
  const soon = (alsoRewrite: boolean) => () => {
    if (queued) return;
    queued = window.requestAnimationFrame(() => {
      queued = 0;
      if (alsoRewrite) rewrite();
      regap();
    });
  };
  const onResize = soon(true);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // 换屏就要重来一遍：外边距是钉在元素身上的，新画出来的元素身上没有。
  // 盯 <body> 的子树，比在每个 render 后手动叫一次可靠——这一版的屏是各处
  // 各画各的（menu.ts / profile.ts / 网页版那几支 render），漏一个就是一屏
  // 挤在一起。
  if (!s.gap && typeof MutationObserver !== 'undefined') {
    const bump = soon(false);
    new MutationObserver(bump).observe(document.body, { childList: true, subtree: true });
  }
  return s;
}

/**
 * 测试用的后门：把 window.__SLIDES_OLD_KERNEL__ 设成 true，就当所有能力都
 * 缺——新浏览器上也能把这一层整个跑一遍。
 *
 * 手边没有 Chrome 61 的真机，而 CSS 这一层没法像 JS 那样「把接口删掉」来模拟
 * （删不掉浏览器认得 gap 这件事）。所以反过来：强制走降级路径，再和正常渲染
 * 逐项对比——两边量出来一样，就说明降级层给出的排版和原来是同一个。
 * 见 xhs/check-oldkernel.mjs。
 */
function forced(): KernelSupport | null {
  const w = window as unknown as { __SLIDES_OLD_KERNEL__?: boolean };
  if (!w.__SLIDES_OLD_KERNEL__) return null;
  return {
    gap: false, clamp: false, minmax: false, ratio: false,
    svh: false, env: false, inset: false, has: false, colormix: false,
  };
}
