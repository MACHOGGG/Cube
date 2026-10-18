/**
 * 浅色界面对比度全部达标（10-18 补充 M-1，站长定 R2：只调色值、保留色相）。
 *
 *   node scripts/check-contrast-tokens.mjs            # CI check 那一条跑的就是这一句（纯 node，几十毫秒）
 *
 * 不开浏览器：从 src/style.css 现读 token（**按选择器找，不按行号区间**），合成四套主题，按 WCAG 2.x 相对亮度公式
 * 算对比度。正文 ≥ 4.5:1，大字、图标和界面部件（WCAG 1.4.11）≥ 3:1。
 *
 * 为什么要这一道：三份体验日报（10-16 / 17 / 18）量出浅色界面好几处不达标——电脑端局中牌的白字压琥珀 2.55、结算
 * 徽章 2.06、小屋名字框 2.40、次要按钮 3.16……这些都是改一个色值就会回去的东西，而回去了屏幕上不报错，只是有人看
 * 不清。所以每一对都在这儿钉一个数。
 *
 * 四套主题怎么合（和浏览器一样按层叠的先后）：
 *   浅色 = :root；深色 = :root 再叠 :root[data-theme="dark"]；色盲浅 = :root 再叠 :root[data-cvd='1']；
 *   色盲深 = :root → :root[data-theme="dark"] → :root[data-cvd='1']（写在深色那段后面、特异度相同，所以压过深色）
 *          → :root[data-cvd='1'][data-theme="dark"]。
 *   var() 在叠完之后再解析（例：色盲深的 --end-ok-ink 解析成色盲深自己的 --accent-2）。
 *   《色卡》--card-* 不随深色翻；电脑档的 --play-chip* 写在 .app.app--game 上（那个 @media 里），四套同值。
 * 另外：两段 @media (prefers-color-scheme: dark) 里的每一支 token，都必须等于对应非 @media 段里的值——系统深色、
 * 站内也选深色时它们生效，两边一走样，同一个设置在两台机器上就是两种颜色。
 */
import { readFileSync } from 'node:fs';

const CSS_RAW = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// ---------- 读 CSS ----------
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** 从 start（指向 '{'）起找配对的 '}'，交回块里的文字。 */
function blockAt(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('括号对不上');
}

/**
 * 顶层（不在 @media 里）选择器正好是 sel 的规则块。同一个选择器常常写了不止一条（.mp-page 两条、电脑档的
 * .app.app--game 好几条），按先后接成一块交回——后写的属性在后面，prop() 取最后一条，和层叠的结果一样。
 */
function topRule(css, sel) {
  let depth = 0;
  let start = 0;
  const found = [];
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0 && css.slice(start, i).trim() === sel) found.push(blockAt(css, i));
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (c === ';' && depth === 0) start = i + 1;
  }
  return found.length ? found.join(';\n') : null;
}

/** 某个 @media（条件逐字等于 cond）里、选择器正好是 sel 的那一条规则的块。 */
function mediaRule(css, cond, sel) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@media ' + cond, from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    const body = blockAt(css, open);
    const r = topRule(body, sel);
    if (r !== null) out.push(r);
    from = open + 1;
  }
  return out;
}

/** 一块里的自定义属性。 */
function tokens(block) {
  const t = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) t[m[1]] = m[2].trim();
  return t;
}
/** 一块里某个普通属性的值（取最后一条）。 */
function prop(block, name) {
  let v = null;
  for (const m of block.matchAll(new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`, 'g'))) v = m[1].trim();
  return v;
}

// ---------- 颜色 ----------
function rgba(s) {
  s = s.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)).concat(1);
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error('认不出的颜色：' + s);
}
const over = (fg, bg) => {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
};
const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)).concat(1);
const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// ---------- 合主题 ----------
function themesOf(css) {
  const root = topRule(css, ':root');
  const dark = topRule(css, ':root[data-theme="dark"]');
  const cvd = topRule(css, ":root[data-cvd='1']");
  const cvdDark = topRule(css, ":root[data-cvd='1'][data-theme=\"dark\"]");
  if (!root || !dark || !cvd || !cvdDark) throw new Error('门要跟着改：四段主题里有一段按选择器找不到');
  const T = (...blocks) => Object.assign({}, ...blocks.map(tokens));
  return {
    浅: T(root),
    深: T(root, dark),
    色盲浅: T(root, cvd),
    色盲深: T(root, dark, cvd, cvdDark),
    blocks: { root, dark, cvd, cvdDark },
  };
}
/** 把一个值里的 var() 按这一套主题解析到底。 */
function resolve(theme, value, depth = 0) {
  if (depth > 20) throw new Error('var() 套太深：' + value);
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fb) => {
    if (theme[name] !== undefined) return resolve(theme, theme[name], depth + 1);
    if (fb !== undefined) return resolve(theme, fb.trim(), depth + 1);
    throw new Error('解析不了 ' + name);
  });
}

// ---------- 判 ----------
function run(css, { quiet = false } = {}) {
  css = stripComments(css);
  let fail = 0;
  const failed = [];
  const check = (n, ok, extra = '') => {
    if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
    if (!ok) {
      fail++;
      failed.push(n);
    }
  };
  const th = themesOf(css);
  const NAMES = ['浅', '深', '色盲浅', '色盲深'];
  const C = (name, tok) => rgba(resolve(th[name], `var(${tok})`));
  const fmt = (xs) => xs.map((x) => x.toFixed(2)).join(' / ');
  const four = (label, fgTok, bgTok, min) => {
    const rs = NAMES.map((n) => ratio(C(n, fgTok), C(n, bgTok)));
    check(`${label}（${fgTok} 压 ${bgTok}，四套 ≥ ${min}）`, rs.every((r) => r >= min), fmt(rs));
  };

  // ① 十二条声明：a–k 是 var(--ink-soft)（k 带 currentColor 兜底），l 是 inherit
  const SELS = [
    ['a', '.end-score-label'],
    ['b', '.menu-section-label'],
    ['c', '.mp-cd-title'],
    ['d', '.mp-cd-rank'],
    ['e', '.auth-field > input + span'],
    ['f', '.auth-field input[readonly]'],
    ['g', '.auth-keynote'],
    ['h', '.mp-contest-hint'],
    ['i', '.mp-final-rank'],
    ['j', '.tut-rule-num'],
  ];
  for (const [k, sel] of SELS) {
    const b = topRule(css, sel);
    check(`① ${k} ${sel} 的字是 var(--ink-soft)`, !!b && prop(b, 'color') === 'var(--ink-soft)', b ? prop(b, 'color') : '找不到这一条');
  }
  const rail = topRule(css, '.axis-rail');
  check('① k .axis-rail 是 var(--ink-soft, currentColor)', !!rail && prop(rail, 'color') === 'var(--ink-soft, currentColor)', rail ? prop(rail, 'color') : '找不到');
  const chev = topRule(css, '.pause-chev');
  check('① l .pause-chev 跟着这一行的字（inherit）', !!chev && prop(chev, 'color') === 'inherit', chev ? prop(chev, 'color') : '找不到');
  for (const bg of ['--bg', '--surface', '--board-bg', '--accent-soft']) four('① ink-soft 当正文', '--ink-soft', bg, 4.5);

  // ② 电脑档局中牌的字
  const desk = mediaRule(css, '(min-width: 1000px) and (min-height: 561px)', '.app.app--game');
  const deskTok = Object.assign({}, ...desk.map(tokens));
  const chipInk = deskTok['--play-chip-ink'];
  const chip = deskTok['--play-chip'];
  check('②（尺子）电脑档 .app.app--game 上读得到 --play-chip 和 --play-chip-ink', !!chip && !!chipInk, `${chip} / ${chipInk}`);
  if (chip && chipInk) check('② 电脑档牌面字压牌面 ≥ 4.5', ratio(rgba(chipInk), rgba(chip)) >= 4.5, ratio(rgba(chipInk), rgba(chip)).toFixed(2));

  // ③ 电脑档得分图案牌里的蓝块
  const patSvg = mediaRule(css, '(min-width: 1000px) and (min-height: 561px)', '.app.app--game > .hud .hud-block--pattern .pat-icon > svg');
  const blue = patSvg.length ? prop(patSvg[patSvg.length - 1], 'color') : null;
  check('③ 电脑档蓝块是 #374F96，压牌面 ≥ 3（图形）', blue === '#374F96' && !!chip && ratio(rgba(blue), rgba(chip)) >= 3,
    blue && chip ? `${blue} ${ratio(rgba(blue), rgba(chip)).toFixed(2)}` : String(blue));

  // ④ 结算徽章的字
  four('④ 结算徽章的字', '--end-ok-ink', '--end-ok-soft', 4.5);

  // ⑤ 小屋名字框：白字、白 α0.72 的占位字
  const mpPage = topRule(css, '.mp-page');
  const warm = mpPage ? tokens(mpPage)['--mp-warm'] : null;
  if (warm) {
    const w = rgba(warm);
    const r1 = ratio([255, 255, 255, 1], w);
    const r2 = ratio(over([255, 255, 255, 0.72], w), w);
    check('⑤ 小屋名字框：白字、白 α0.72 占位字压 --mp-warm 都 ≥ 4.5', r1 >= 4.5 && r2 >= 4.5, `${r1.toFixed(2)} / ${r2.toFixed(2)}`);
  } else check('⑤ 读得到 .mp-page 的 --mp-warm', false);

  // ⑥ 次要按钮 ⑦ 主键
  four('⑥ 次要按钮的字', '--accent-2', '--accent-2-soft', 4.5);
  four('⑦ 主键上的字', '--on-accent', '--accent', 4.5);

  // ⑨《开小屋》大键
  const create = topRule(css, '.mp-create');
  const createBg = create ? prop(create, 'background') : null;
  check('⑨《开小屋》白字压底 ≥ 4.5', !!createBg && ratio([255, 255, 255, 1], rgba(createBg)) >= 4.5,
    createBg ? `${createBg} ${ratio([255, 255, 255, 1], rgba(createBg)).toFixed(2)}` : '找不到');

  // ⑩ 结算《主页》键：白盘配深一档的橙
  const deep = th['浅']['--card-orange-deep'];
  check('⑩ 白盘对 --card-orange-deep ≥ 3（图标）', !!deep && ratio([255, 255, 255, 1], rgba(deep)) >= 3,
    deep ? ratio([255, 255, 255, 1], rgba(deep)).toFixed(2) : '没有这支 token');
  const home = topRule(css, '.overlay--end .modal .end-act--home');
  check('⑩ 结算《主页》键的底和记号都是 --card-orange-deep', !!home && prop(home, 'background') === 'var(--card-orange-deep)' && home.includes('--ctl-mark: var(--card-orange-deep)'));

  // ⑪ 另外五处（e 在小红书那一端，xhs/src/pages.css，不在这道门里）
  const cta = topRule(css, '.genius-cta');
  const ctaCvd = topRule(css, ":root[data-cvd='1'] .genius-cta");
  if (cta && ctaCvd) {
    const fg = rgba(resolve(th['浅'], prop(cta, 'color')));
    const bg = rgba(prop(cta, 'background'));
    const fgC = rgba(resolve(th['色盲浅'], prop(ctaCvd, 'color')));
    const bgC = rgba(prop(ctaCvd, 'background'));
    check('⑪a .genius-cta 字压橙 ≥ 4.5，色盲那一条也是', ratio(fg, bg) >= 4.5 && ratio(fgC, bgC) >= 4.5,
      `${ratio(fg, bg).toFixed(2)} / ${ratio(fgC, bgC).toFixed(2)}`);
  } else check('⑪a 读得到 .genius-cta 和它的色盲那一条', false);
  const lock = topRule(css, '.rank-lock');
  const lockLine = topRule(css, '.rank-lock-line');
  if (lock && lockLine) {
    const veil = rgba(prop(lock, 'background'));
    const fg = rgba(resolve(th['浅'], prop(lockLine, 'color')));
    const onWhite = over(veil, [255, 255, 255, 1]);
    const onPanel = over(veil, rgba(th['浅']['--card-periwinkle']));
    check('⑪b 排名锁那一句压半透明罩（白行上、面板缝里）≥ 4.5', ratio(fg, onWhite) >= 4.5 && ratio(fg, onPanel) >= 4.5,
      `${ratio(fg, onWhite).toFixed(2)} / ${ratio(fg, onPanel).toFixed(2)}`);
  } else check('⑪b 读得到 .rank-lock 和 .rank-lock-line', false);
  const start = topRule(css, '.slot-demo-btn--start');
  const startBg = start ? prop(start, 'background') : null;
  check('⑪c 老虎机介绍页《开始》白字 ≥ 4.5', !!startBg && ratio([255, 255, 255, 1], rgba(startBg)) >= 4.5,
    startBg ? ratio([255, 255, 255, 1], rgba(startBg)).toFixed(2) : '找不到');
  {
    const rs = NAMES.map((n) => ratio([255, 255, 255, 1], C(n, '--warn')));
    check('⑪d 最后 10 秒：白字压 --warn，四套 ≥ 4.5', rs.every((r) => r >= 4.5), fmt(rs));
  }

  // ⑫ 色盲深的描边
  check('⑫ 色盲深 --mark-edge 压 --surface ≥ 3', ratio(C('色盲深', '--mark-edge'), C('色盲深', '--surface')) >= 3,
    ratio(C('色盲深', '--mark-edge'), C('色盲深', '--surface')).toFixed(2));

  // ⑬ 淡掉的行：整行压透明度之后，字和行底（都和页底混过）
  const op = (sel) => {
    const b = topRule(css, sel);
    return b ? Number(prop(b, 'opacity')) : NaN;
  };
  {
    const a = op('.mp-cd-row--left');
    const rs = NAMES.map((n) => {
      const page = C(n, '--bg');
      return ratio(mix(C(n, '--ink-soft'), page, a), mix(C(n, '--surface'), page, a));
    });
    check(`⑬ 小屋倒数页离场那一行（opacity ${a}）四套 ≥ 4.5`, rs.every((r) => r >= 4.5), fmt(rs));
  }
  {
    const a = op('.mp-player--left');
    const rs = NAMES.map((n) => {
      const page = C(n, '--bg');
      return ratio(mix(C(n, '--ink-soft'), page, a), mix(C(n, '--surface'), page, a));
    });
    check(`⑬ 散场榜离场那一行（opacity ${a}）四套 ≥ 4.5`, rs.every((r) => r >= 4.5), fmt(rs));
    check('⑬ 「自己 ＋ 离场」那一行不压透明度', op('.mp-player--me.mp-player--left') === 1);
  }
  {
    // 局中名单：字是牌面字、底是牌面（手机三套 + 电脑那一档）；名次再叠一层自己的透明度
    const row = op('.mp-board-row--left');
    const rank = op('.mp-board-rank');
    const gap = op('.mp-board-row--gap');
    const pairs = [
      ...NAMES.map((n) => [n, C(n, '--play-chip-ink'), C(n, '--play-chip')]),
      ...(chip && chipInk ? [['电脑', rgba(chipInk), rgba(chip)]] : []),
    ];
    const worst = (a) => Math.min(...pairs.map(([, fg, bg]) => ratio(mix(fg, bg, a), bg)));
    check(`⑬ 局中名单离场那一行（opacity ${row}）≥ 4.5`, worst(row) >= 4.5, worst(row).toFixed(2));
    check(`⑬ 局中名单的名次（opacity ${rank}）≥ 4.5`, worst(rank) >= 4.5, worst(rank).toFixed(2));
    check('⑬ 离场那一行里的名次不再叠一层（不然 0.81）', op('.mp-board-row--left .mp-board-rank') === 1);
    check(`⑬ 名次接不上那一截的省略号（opacity ${gap}）≥ 4.5`, worst(gap) >= 4.5, worst(gap).toFixed(2));
  }

  // 两段 @media (prefers-color-scheme: dark) 和非 @media 那两段逐支一样
  const norm = (v) => v.replace(/\s+/g, ' ').trim();
  for (const [label, sel, plain] of [
    ['深色', ':root:not([data-theme="light"])', th.blocks.dark],
    ['色盲深', ":root[data-cvd='1']:not([data-theme=\"light\"])", th.blocks.cvdDark],
  ]) {
    const med = mediaRule(css, '(prefers-color-scheme: dark)', sel);
    const mt = Object.assign({}, ...med.map(tokens));
    const pt = tokens(plain);
    const diff = Object.keys(mt).filter((k) => norm(mt[k]) !== norm(pt[k] ?? ''));
    check(`@media（系统深色）里的${label}那一段和非 @media 那一段逐支一样`, med.length === 1 && diff.length === 0,
      diff.map((k) => `${k}: ${mt[k]} ≠ ${pt[k]}`).join(' | ') || `${Object.keys(mt).length} 支`);
  }
  return { fail, failed };
}

const { fail } = run(CSS_RAW);

// 尺子：在内存里改回旧值再算一次，必须红
console.log('\n—— 尺子 ——');
let ruler = 0;
const mutants = [
  ['--accent 换回 #BE5762', (s) => s.replace('--accent: #BD5560;', '--accent: #BE5762;'), '⑦'],
  ['① a 换回 ink-faint', (s) => s.replace(/(\.end-score-label \{[^}]*?)color: var\(--ink-soft\)/, '$1color: var(--ink-faint)'), '① a'],
];
for (const [name, edit, want] of mutants) {
  const s = edit(CSS_RAW);
  const r = run(s, { quiet: true });
  const ok = s !== CSS_RAW && r.failed.some((n) => n.startsWith(want));
  console.log(`${ok ? 'PASS' : 'FAIL'}  （尺子）${name}：${want} 那一条红了  ${s === CSS_RAW ? '没改到源码' : r.failed.join(' / ')}`);
  if (!ok) ruler++;
}

console.log(fail + ruler ? `\n${fail + ruler} 条没过` : '\n全部通过');
process.exit(fail + ruler ? 1 : 0);
