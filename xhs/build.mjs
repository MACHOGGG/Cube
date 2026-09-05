/**
 * 打一个能直接传进 Builder Hub 的小工具包。
 *
 *   npm run build:xhs
 *
 * 六步，缺一步都可能在真机上才发现：
 *
 *   1. vite build（xhs/vite.config.ts：iife 经典脚本 + es2017/chrome61 +
 *      把联网模块换成空替身）
 *   2. 改 index.html：Vite 出的是 <script type="module" crossorigin>，容器的
 *      CSP 不认——换成普通的 <script src>。典型症状是「页面渲染出来但 JS 完
 *      全不执行」，所以这一步不能省。
 *   2.5 把 xhs/polyfills.js 拼到产物最前面：补 Chrome 61 缺的那几个接口
 *      （at / flat / matchAll / trimStart / replaceChildren / getAnimations /
 *      ResizeObserver）。语法降级管不着接口，不补的话一拖动就抛错。
 *   3. 禁用能力扫描：按 device-capabilities.md §7 那张清单 grep 产物，命中
 *      就直接失败，不出包。
 *   4. 体积门禁：用小红书那份技能包自带的审计脚本。
 *   5. 打 zip：进到 dist 里压“目录内容”，保证解压后 index.html 就在根上。
 *
 * 规范全文在 .claude/skills/minitool-zip-builder/。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const zip = join(here, 'slides-minitool.zip');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// ---- 1. 构建 ---------------------------------------------------------------
run('npx', ['vite', 'build', '--config', join(here, 'vite.config.ts')], { cwd: join(here, '..') });

// ---- 2. index.html 改成经典脚本 --------------------------------------------
const htmlPath = join(dist, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const before = html;
html = html
  // 把入口那一行从 module 改成普通脚本，并挪到 body 末尾（DOM 先在，脚本再跑）
  .replace(/\s*<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/, '')
  .replace(/\s*crossorigin(?=[ >])/g, '')
  .replace('</body>', '  <script src="./app.js"></script>\n</body>')
  // 开发时那两条注释在产物里没用，去掉省几行
  .replace(/\s*<!--[\s\S]*?-->/g, '');
if (html === before) throw new Error('index.html 没改动——入口那一行的写法变了？');
if (/type="module"/.test(html)) throw new Error('index.html 里还留着 type="module"');
writeFileSync(htmlPath, html);

// ---- 2.5 Chrome 61 能力补丁拼到最前 ----------------------------------------
// xhs/polyfills.js 补的是「语法降级管不着」的那些接口（Array.prototype.at、
// flat/flatMap、matchAll、trimStart、replaceChildren、getAnimations、
// ResizeObserver）。它必须比任何模块的顶层代码先跑——有几个模块在加载时就调
// flatMap——所以不走 Vite，直接拼在产物最前面。
// 拼完再做第 3 步的扫描，保证补丁本身也过一遍禁用清单。
const polyPath = join(here, 'polyfills.js');
const appPath = join(dist, 'app.js');
const poly = readFileSync(polyPath, 'utf8');
writeFileSync(appPath, poly + '\n' + readFileSync(appPath, 'utf8'));

// ---- 3. 禁用能力扫描 -------------------------------------------------------
// 按 device-capabilities.md §7 的清单。只查产物，不查源码——源码里那些调用点
// 是故意留着的（见 xhs/src/stubs/），真正要确认的是它们没被打进包。
const BANNED = [
  'fetch(', 'XMLHttpRequest', 'new WebSocket(', 'new EventSource(', 'new RTCPeerConnection(',
  'navigator.geolocation', 'navigator.clipboard', "execCommand('copy')",
  'navigator.bluetooth', 'navigator.usb', 'navigator.hid', 'navigator.serial',
  'navigator.getBattery', 'navigator.connection', 'navigator.credentials', 'navigator.locks',
  'enumerateDevices', 'getDisplayMedia', 'storage.persist', 'serviceWorker.register',
  'new Worker(', 'new SharedWorker(', 'new Accelerometer(', 'new Gyroscope(', 'new Magnetometer(',
  'DeviceMotionEvent', 'DeviceOrientationEvent', 'requestFullscreen',
  'eval(', 'new Function(', 'WebAssembly.', 'window.open(', 'window.prompt(',
  '<iframe', '<object', 'target="_blank"', 'https://', 'http://',
];
const code = readFileSync(join(dist, 'app.js'), 'utf8');
// 样式是被 injectStyles() 当字符串塞进 JS 的（见 src/injectStyles.ts），
// 所以正常情况下产物里没有独立的 .css；万一以后有了，也一起查。
const cssFiles = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.css'));
const css = cssFiles.map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');
// XML 命名空间不是网址：SVG 里的 xmlns="http://www.w3.org/2000/svg" 只是一
// 个标识符，浏览器从不去下载它。查网址时要把这两个先摘掉，否则四十个
// <svg> 会把扫描淹掉。
const NAMESPACES = /https?:\/\/www\.w3\.org\/[^"')\s]*/g;
const scannable = (text) => text.replace(NAMESPACES, '');
const hits = [];
for (const pat of BANNED) {
  const n = scannable(code).split(pat).length - 1 + scannable(html).split(pat).length - 1;
  if (n > 0) hits.push(`${pat} × ${n}`);
}
if (css.includes('url(http')) hits.push('CSS 里有外链 url(http…)');
if (hits.length) {
  console.error('\n包里还有被禁的能力，没出包：\n  ' + hits.join('\n  '));
  process.exit(1);
}
console.log('禁用能力扫描：干净');

// ---- 3.5 语法门禁：Chrome 61 认不认得这份包 --------------------------------
//
// 这一关是别处补不上的。
//
// 两台体检台（check-oldkernel / check-oldcss）都在**新** Chromium 上跑，只是
// 把接口删掉、把样式降级。删得掉接口，删不掉「这个浏览器认识 ?. 」这件事——
// 包里真混进一个可选链、一个 ??、一个类字段，那两台照跑不误，到了真机上却是
// **解析阶段**就失败：整个 app.js 一行都不执行，白屏，而且没有任何报错能看。
//
// Vite 的 target 已经写了 es2017/chrome61（见 vite.config.ts），esbuild 会把
// 语法降下去。但第 2.5 步拼在最前面的 polyfills.js **不走 Vite**，是原样拼上
// 的；以后要是有人往里写一句 `a?.b`，就这么混进去了。
//
// 所以这里拿一个只认 ES2017 的解析器（acorn）把**拼好之后的整个产物**再读一
// 遍。读得下来，才敢说 Chrome 61 认得它的每一个字。
const acorn = await import('acorn');
try {
  acorn.parse(readFileSync(appPath, 'utf8'), { ecmaVersion: 2017, sourceType: 'script' });
  console.log('语法门禁：整份产物按 ES2017 解析通过');
} catch (e) {
  console.error(
    '\n产物里有 Chrome 61 解析不了的语法，没出包：\n  ' +
      e.message +
      '\n\n  真机上的症状是白屏、没有任何报错。多半出在 xhs/polyfills.js——' +
      '\n  那个文件不走 Vite，写什么就是什么，只能用 ES2017 以内的写法。',
  );
  process.exit(1);
}

// ---- 4. 体积门禁 -----------------------------------------------------------
const audit = join(here, '../.claude/skills/minitool-zip-builder/scripts/audit_artifact.mjs');
if (existsSync(audit)) run('node', [audit, dist]);

// ---- 5. 打包 ---------------------------------------------------------------
// 压的是 dist 的**内容**，不是 dist 这个文件夹——多套一层目录容器就加载不了。
if (existsSync(zip)) rmSync(zip);
run('zip', ['-qr', zip, '.', '-x', '*.DS_Store'], { cwd: dist });
if (existsSync(audit)) run('node', [audit, zip]);
console.log('\n出包了：xhs/slides-minitool.zip —— 传进 Builder Hub 的就是它。');

// ---- 6. 顺手放一份到网站上，给真机测试用 -------------------------------------
//
// BrowserStack 那样的真机服务只能打开网址，装不了 zip。所以把这一版原样复制到
// public/xhs/，跟着网站一起发出去——玩家在真手机上开 play-slides.com/xhs/ 就是
// 这一版本身。
//
// 「原样」是这一步的全部意义：复制的就是刚打好 zip 的那几个文件，一个字节都不
// 改。要是这里再单独构建一次、或者手工维护一份副本，真机上测的就不是要提审的
// 那一份了——那种测试比不测更糟，因为它给的是假的安心。所以这一步钉在出包之
// 后，两者永远同步。
//
// 有一件事真机上和小红书里不一样，测之前要知道：JSBridge（存相册 / 发笔记）在
// 普通浏览器里没有宿主，会老老实实报「要在小红书里才能用」。那不是坏了。
// 整棵树一起复制（dist 里除了 index.html 和 app.js 还有 assets/），先清干净再
// 复制：留着上一次的残file，网站上就会有一份谁也说不清是哪一版的东西。
const webCopy = join(here, '../public/xhs');
if (existsSync(webCopy)) rmSync(webCopy, { recursive: true, force: true });
cpSync(dist, webCopy, { recursive: true });
console.log('也放了一份到 public/xhs/ —— 网站发出去之后，真机上开 /xhs/ 就是它。');
