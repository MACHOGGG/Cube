/**
 * 小红书那一份产物「只拼了一遍」：index.html 里恰好一行 `<script src="./app.js">`，app.js 里
 * Chrome 61 补丁头恰好一份、而且在最前面。查两处——public/xhs/（网站上的 /xhs/，真机测的是它）
 * 和 xhs/slides-minitool.zip（传 Builder Hub 的就是它）。不开浏览器，零点几秒。
 *
 *   node xhs/check-bundle.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一道
 *
 * 2026-10-08：预览页是旧的，两道小红书的门（check-oldkernel、check-vsweb）同时起跑，各自重出
 * 预览页，两个进程往同一个 xhs/dist/ 里写。后到的那一个读到的是先到的那一个**已经改过**的
 * index.html，于是又补了一行 `<script src="./app.js">`；补丁头也往 app.js 前面拼了两遍。这两
 * 样随后被复制进 public/xhs/、打进 zip——**所有的门照样全绿**，没有任何东西报错。是看到 git
 * status 里 public/xhs/index.html 莫名变了才发现的；要是没看见，它就跟着下一次提交进了仓库。
 *
 * 出包那一头现在有锁、有闸（xhs/ensurePreview.mjs 的锁，xhs/build.mjs 第 2 / 2.5 步的闸）。
 * 这一道量的是**结果**：CI 里排在「重出产物」之前，读的是仓库里提交的那两样。那一步之后的
 * 「能由源码重现」只比 public/xhs/、不比 zip（zip 的字节每次都不同），所以一份拼坏的 zip 提
 * 交上去，从前没有任何一步会红。
 * ─────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const APP_TAG = '<script src="./app.js"></script>';
/** 补丁头：和 xhs/build.mjs 第 2.5 步认的是同一段（补丁文件开头那 120 个字）。 */
const polyHead = readFileSync(join(here, 'polyfills.js'), 'utf8').slice(0, 120);
const count = (text, needle) => text.split(needle).length - 1;

// 尺子：认的那一段真是补丁文件的文件头，而不是一截空白——空串在哪儿都「恰好出现」。
check('（尺子）补丁头那一段认得出来（「Chrome 61 能力补丁」那句文件头）', /Chrome 61 能力补丁/.test(polyHead), JSON.stringify(polyHead.slice(0, 40)));

function judge(label, html, app) {
  const tags = count(html, APP_TAG);
  check(`${label}：index.html 里 <script src="./app.js"> 恰好一行`, tags === 1, `${tags} 行`);
  check(`${label}：index.html 里没有 type="module" 的入口`, !/type="module"/.test(html));
  const heads = count(app, polyHead);
  check(`${label}：app.js 里 Chrome 61 补丁头恰好一份`, heads === 1, `${heads} 份`);
  check(`${label}：补丁头在 app.js 的最前面（它得比任何模块的顶层代码先跑）`, app.startsWith(polyHead));
}

const web = join(root, 'public/xhs');
if (existsSync(join(web, 'index.html')) && existsSync(join(web, 'app.js'))) {
  judge('public/xhs', readFileSync(join(web, 'index.html'), 'utf8'), readFileSync(join(web, 'app.js'), 'utf8'));
} else {
  check('public/xhs 里有 index.html 和 app.js', false, '先跑一次 npm run preview:xhs');
}

const zip = join(here, 'slides-minitool.zip');
if (existsSync(zip)) {
  // 解到标准输出里读，不落盘。zip 里 index.html 必须在根上（多套一层目录容器就打不开首页），
  // 所以这儿按根上的名字取——取不到也是一种红。
  const unzip = (name) => {
    try {
      return execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return null;
    }
  };
  const html = unzip('index.html');
  const app = unzip('app.js');
  check('slides-minitool.zip 的根上有 index.html 和 app.js', html !== null && app !== null);
  if (html !== null && app !== null) judge('slides-minitool.zip', html, app);
} else {
  check('xhs/slides-minitool.zip 在', false, '先跑一次 npm run build:xhs');
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
