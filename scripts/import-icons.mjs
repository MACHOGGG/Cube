/**
 * 把一批画好的 SVG 收进 src/assets/icons/。
 *
 *   node scripts/import-icons.mjs <解压出来的文件夹>
 *
 * 只做两件事，都是为了「设计软件导出的东西直接能用」：
 *
 * 1. 只收真的改过的。跟 design/icons/ 里的原件逐字节比，一样的就不收——放进
 *    去只会把那个图标钉死在今天这一版，以后代码里改了图它也不跟。
 *
 * 2. 把 color(display-p3 r g b) 换成普通 HEX。Figma / Sketch 的默认导出带的是
 *    这个格式；Chrome 和 Safari 认，老一点的安卓 WebView 不认，而 CSS 遇到不
 *    认识的颜色函数是整条声明作废——表现为图形变成黑色。换成 HEX 之后哪儿都
 *    一样。转换走的是标准的 P3→sRGB 矩阵，色差肉眼看不出来。
 *
 * .DS_Store 和 __MACOSX 里的 ._ 影子文件一并跳过。
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/import-icons.mjs <文件夹>');
  process.exit(2);
}
const OUT = 'src/assets/icons';
const REF = 'design/icons';

/** sRGB 传递函数的正反两向。P3 的分量和 sRGB 一样是编码过的，不是线性值。 */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** 线性 display-p3 → 线性 sRGB。 */
const M = [
  [1.2249401762805376, -0.2249401762805376, 0],
  [-0.04205697974721013, 1.0420569797472099, 0],
  [-0.019637554590334, -0.07863604555063188, 1.0982736001409658],
];

const hex2 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

function p3ToHex(r, g, b) {
  const lin = [toLinear(r), toLinear(g), toLinear(b)];
  const out = M.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]).map(toGamma);
  return '#' + out.map(hex2).join('').toUpperCase();
}

/** 文件里所有的 color(display-p3 …)，换成 HEX。带 alpha 的换成 rgba()。 */
function stripP3(svg) {
  let n = 0;
  const out = svg.replace(
    /color\(\s*display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)/g,
    (_, r, g, b, a) => {
      n++;
      const hex = p3ToHex(Number(r), Number(g), Number(b));
      if (a === undefined || Number(a) >= 1) return hex;
      const [rr, gg, bb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return `rgba(${rr}, ${gg}, ${bb}, ${Number(a)})`;
    },
  );
  return { out, n };
}

const sameAsRef = async (name, body) => {
  try {
    return (await readFile(path.join(REF, name), 'utf-8')) === body;
  } catch {
    return false; // 没有原件可比，就当是改过的
  }
};

await mkdir(OUT, { recursive: true });
const files = (await readdir(src)).filter((f) => f.endsWith('.svg') && !f.startsWith('._'));

let took = 0;
let skipped = 0;
let converted = 0;
for (const name of files.sort()) {
  const raw = await readFile(path.join(src, name), 'utf-8');
  if (await sameAsRef(name, raw)) {
    skipped++;
    continue;
  }
  const { out, n } = stripP3(raw);
  await writeFile(path.join(OUT, name), out, 'utf-8');
  took++;
  if (n) converted++;
  console.log(`收下 ${name}${n ? `  （${n} 处 display-p3 换成 HEX）` : ''}`);
}
console.log(`\n收下 ${took} 个 · 和原件一样跳过 ${skipped} 个 · 其中 ${converted} 个做过颜色转换`);
console.log(`它们现在在 ${OUT}/，构建之后就是网页上的样子。`);
