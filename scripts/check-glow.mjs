/**
 * 会呼吸的光：模糊半径一整圈都不许变。
 *
 *   node scripts/check-glow.mjs            # 收目录，不收 URL；不用起服务器
 *
 * 盯着 2026-09 玩家实拍到的那一次：iPhone 上打开主菜单，头两张发光的卡外面
 * 罩着一个发光的**透明方块**，方块里面本该贴着图形的那圈光全没了。同一份
 * 代码在 Chrome 上一直是对的——所以只看电脑端永远看不出来。
 *
 * 根子在「滤镜区域」：drop-shadow 的模糊半径决定了这团光最远画到哪儿，浏览
 * 器按这个尺寸开一块画布。半径要是写在 @keyframes 的两头（`0 0 0` → `0 0
 * 10px`），这块画布每一帧都在变大变小；iOS 的 Safari 碰上这种会把挨着的几
 * 个发光元素并进同一块画布、按**不透明**处理，于是那圈光贴的就不是图形，是
 * 这块画布的方框了。
 *
 * 所以规矩是：**要明灭就改颜色的浓淡，不要改半径。**（颜色从 transparent 淡
 * 进来不会发灰——CSS 的颜色插值走预乘 alpha。）
 *
 * 这支门把整份 style.css 里每一段 @keyframes 都读一遍，逐个 filter 声明里的
 * drop-shadow 取出半径，同一段里对不上就报红。它不开浏览器、不起服务器，跑
 * 完不到一秒，所以进 CI。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || join(import.meta.dirname, '..');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 把 `@keyframes 名字 { ... }` 一段段切出来（大括号配对，不用正则硬啃）。 */
function keyframeBlocks(text) {
  const out = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    out.push({ name: m[1], body: text.slice(re.lastIndex, i - 1) });
  }
  return out;
}

/**
 * 一条 `filter:` 声明里的每个 drop-shadow，取它的几何参数（偏移 + 模糊）。
 * 颜色故意不取——变的就该是它。
 *
 * drop-shadow 的写法是 `drop-shadow(<颜色>? <x> <y> <模糊>?)`，颜色可前可后，
 * 所以这里的做法是：把括号里的东西按空格拆开，只留「像 长度 的那些」。
 * `rgba(...)` / `var(--x)` 里的逗号和空格会干扰拆分，先整个抠掉。
 */
function shadowGeometry(decl) {
  const out = [];
  const re = /drop-shadow\(/g;
  let m;
  while ((m = re.exec(decl))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < decl.length && depth > 0) {
      if (decl[i] === '(') depth++;
      else if (decl[i] === ')') depth--;
      i++;
    }
    const inner = decl.slice(re.lastIndex, i - 1);
    const bare = inner.replace(/[\w-]+\([^()]*\)/g, ' '); // rgba(…) / var(…) 拿掉
    const lens = bare.split(/\s+/).filter((t) => /^-?[\d.]+(px|em|rem|%)?$/.test(t));
    out.push(lens.join(' '));
    re.lastIndex = i;
  }
  return out;
}

for (const { name, body } of keyframeBlocks(css)) {
  const decls = [...body.matchAll(/filter\s*:\s*([^;}]+)/g)].map((d) => d[1].trim());
  const withShadow = decls.filter((d) => d.includes('drop-shadow('));
  if (!withShadow.length) continue;

  const shapes = withShadow.map(shadowGeometry);
  const first = JSON.stringify(shapes[0]);
  const odd = shapes.findIndex((s) => JSON.stringify(s) !== first);
  check(
    `@keyframes ${name}：每一帧的光，大小和位置都一样`,
    odd < 0,
    odd < 0 ? `${shapes.length} 帧 · ${first}` : `第 ${odd + 1} 帧是 ${JSON.stringify(shapes[odd])}，第 1 帧是 ${first}`,
  );
}

console.log(fail ? `\n${fail} 处对不上` : '\n全部通过');
process.exit(fail ? 1 : 0);
