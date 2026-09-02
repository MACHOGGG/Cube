/**
 * 自定义属性里不许写「新函数」。
 *
 *   npm run build
 *   node scripts/check-css-fallbacks.mjs
 *
 * 这个坑踩过三次了，每次的样子都不一样，机制是同一个：
 *
 *   · color(display-p3 …) 写在 SVG 的 fill 上 → 安卓上图标整个不见；
 *   · color-mix() 写在 --score-wash 上 → 安卓上得分的三角涂成一块纯黑；
 *
 * 普通属性可以靠「写两行」兜底：
 *
 *     background: var(--bg);
 *     background: color-mix(in srgb, var(--bg) 55%, transparent);
 *
 * 浏览器解析第二行时发现不认识那个函数，整条声明作废，第一行留下。这是有效
 * 的，也是这份样式表里别处正在用的办法。
 *
 * 但自定义属性不吃这一套。`--x: 什么都行` —— CSS 规定自定义属性在解析阶段
 * 根本不做语法检查，任何记号串都收下。于是不认识 color-mix 的浏览器照样把第
 * 二行存进 --x、盖掉第一行；等到 `fill: var(--x)` 去取它，这时才发现算不出
 * 来，而这个阶段的规则是「退回初始值」——fill 的初始值是不透明的纯黑。
 *
 * 量过：把函数名换成一个浏览器不认识的词，getComputedStyle 读到的 fill 是
 * rgb(0, 0, 0)。
 *
 * 所以自定义属性里只准写老写法（#rgb、rgba()、hsl()）。要用新函数，就直接写
 * 在用它的那条普通属性上，并且在它前面垫一行老写法。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 查源文件而不是打包结果：构建会把样式塞进 JS 里，而且这条规矩本来就该在
// 写下去的那一刻就拦住，不用等到构建完。
const DIR = process.argv[2] || 'src';

/** 2020 年以后才有的颜色函数——老一点的安卓 WebView 都不认。 */
const YOUNG = /\b(color-mix|color|oklch|oklab|lab|lch|light-dark)\s*\(/;

/**
 * 一条 `--名字: 值;` 声明。值里可能有括号（rgba(...)），所以不能只找分号，
 * 但自定义属性的值里不会有分号，所以找到第一个分号就是结尾。
 */
const DECL = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g;

const cssUnder = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssUnder(full));
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
};

let fail = 0;
const files = cssUnder(DIR);
if (!files.length) {
  console.error(`FAIL  ${DIR} 底下一个 .css 都没有`);
  process.exit(2);
}

for (const f of files) {
  const css = readFileSync(f, 'utf8');
  for (const [, name, value] of css.matchAll(DECL)) {
    const m = YOUNG.exec(value);
    if (!m) continue;
    // color(srgb …) 之类同样不老，一并算进来；var() 里嵌的也算，因为最终
    // 替换出来的还是那一串。
    console.log(`FAIL  ${f}  ${name} 里写了 ${m[1]}()：${value.trim().slice(0, 60)}`);
    fail++;
  }
}

console.log(
  fail
    ? `\n${fail} 处。自定义属性里只能写 #rgb / rgba() / hsl()；新函数要直接写在用它的普通属性上，前面垫一行老写法。`
    : `PASS  ${files.length} 份样式表，没有哪个自定义属性里藏着新函数`,
);
process.exit(fail ? 1 : 0);
