/**
 * 打一个能直接传进 Builder Hub 的小工具包。
 *
 *   npm run build:xhs
 *
 * 五步，缺一步都可能在真机上才发现：
 *
 *   1. vite build（xhs/vite.config.ts：iife 经典脚本 + es2017/chrome61 +
 *      把联网模块换成空替身）
 *   2. 改 index.html：Vite 出的是 <script type="module" crossorigin>，容器的
 *      CSP 不认——换成普通的 <script src>。典型症状是「页面渲染出来但 JS 完
 *      全不执行」，所以这一步不能省。
 *   3. 禁用能力扫描：按 device-capabilities.md §7 那张清单 grep 产物，命中
 *      就直接失败，不出包。
 *   4. 体积门禁：用小红书那份技能包自带的审计脚本。
 *   5. 打 zip：进到 dist 里压“目录内容”，保证解压后 index.html 就在根上。
 *
 * 规范全文在 .claude/skills/minitool-zip-builder/。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
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

// ---- 4. 体积门禁 -----------------------------------------------------------
const audit = join(here, '../.claude/skills/minitool-zip-builder/scripts/audit_artifact.mjs');
if (existsSync(audit)) run('node', [audit, dist]);

// ---- 5. 打包 ---------------------------------------------------------------
// 压的是 dist 的**内容**，不是 dist 这个文件夹——多套一层目录容器就加载不了。
if (existsSync(zip)) rmSync(zip);
run('zip', ['-qr', zip, '.', '-x', '*.DS_Store'], { cwd: dist });
if (existsSync(audit)) run('node', [audit, zip]);
console.log('\n出包了：xhs/slides-minitool.zip —— 传进 Builder Hub 的就是它。');
