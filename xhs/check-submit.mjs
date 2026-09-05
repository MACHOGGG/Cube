/**
 * 提审前自查——把 zip-artifact-spec.md §6 那张清单一条条跑一遍。
 *
 *   npm run check:submit
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一台
 *
 * 那张清单有二十几条，全是「看一眼就知道」的事——index.html 在不在根、有没有
 * 内联脚本、有没有外链。人看一遍要十分钟，而且每改一次包都得重看一遍，第三次
 * 就开始跳着看了。跳着看的那一条正是会被打回来的那一条。
 *
 * 所以让机器看。它读的是**真正要传上去的那个 zip**，不是 dist/——两者理论上
 * 一样，但「理论上」正是出事的地方。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 有一条只有跑起来才知道
 *
 * 「不联网」这一条，静态扫描只能证明「代码里没写 fetch」。证明不了的是：某个
 * 库在初始化时自己去拉了点什么、某张图的 src 是空字符串于是浏览器回头去请求
 * 页面本身、某个 @font-face 落到了一个不存在的相对路径上。
 *
 * 这些都要**真的把它跑起来、盯着每一条出去的请求**才看得见。所以最后一关是把
 * 解压出来的包用 file:// 打开，打一局完整的，把浏览器发出的每一条请求记下来
 * ——只允许 file:// 和 data:，出现别的就是没过。
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const zip = join(here, 'slides-minitool.zip');
const work = join(here, '.submit-check');

let fails = 0;
let warns = 0;
const say = (ok, text, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? '  ✓  ' : '  ✗  ') + text + (extra ? '   ' + extra : ''));
};
const warn = (text) => {
  warns++;
  console.log('  !  ' + text);
};
const head = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length)));

if (!existsSync(zip)) {
  console.error('没找到 xhs/slides-minitool.zip —— 先跑 npm run build:xhs');
  process.exit(1);
}

// ---- 解压到一个干净的地方 --------------------------------------------------
// 读 zip 本身而不是 dist/：要传上去的是 zip，两者理论上一样，但「理论上」正是
// 出事的地方（打包命令写错一个参数就多套一层目录）。
if (existsSync(work)) rmSync(work, { recursive: true });
mkdirSync(work, { recursive: true });
execFileSync('unzip', ['-q', zip, '-d', work]);

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(relative(work, p));
  }
  return out;
};
const files = walk(work);

// ---- 1. 包结构 -------------------------------------------------------------
head('包结构');

say(existsSync(join(work, 'index.html')), 'index.html 在 zip 根目录');

// 「多套一层目录」是这一条最常见的死法：压缩了文件夹本身而不是它的内容。
const topLevel = readdirSync(work);
const nested = topLevel.length === 1 && statSync(join(work, topLevel[0])).isDirectory();
say(!nested, '解压后顶层直接是文件，没多套一层目录', nested ? `顶层只有一个目录 ${topLevel[0]}/` : '');

const ALLOWED = ['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json'];
const badType = files.filter((f) => !ALLOWED.includes(extname(f).toLowerCase()));
say(badType.length === 0, '只含规范允许的文件类型', badType.join(' '));

const JUNK = [/(^|\/)node_modules\//, /(^|\/)\.git\//, /\.DS_Store$/, /\.map$/, /(vite|webpack|rollup)\.config\./, /(^|\/)package(-lock)?\.json$/];
const junk = files.filter((f) => JUNK.some((re) => re.test(f)));
say(junk.length === 0, '没有开发垃圾文件（node_modules / *.map / 构建配置）', junk.join(' '));

const htmls = files.filter((f) => extname(f) === '.html');
say(htmls.length === 1 && htmls[0] === 'index.html', '有且只有一个 index.html', htmls.join(' '));

console.log('     包内 ' + files.length + ' 个文件：' + files.join('、'));

// ---- 2. index.html ---------------------------------------------------------
head('index.html');

const html = readFileSync(join(work, 'index.html'), 'utf8');

say(/^\s*<!DOCTYPE html>/i.test(html), '有 <!DOCTYPE html>');
say(/<html[^>]+lang="zh-CN"/i.test(html), 'lang="zh-CN"');
say(/charset="?UTF-8"?/i.test(html), 'charset=UTF-8');
for (const need of ['width=device-width', 'initial-scale=1.0', 'viewport-fit=cover']) {
  say(html.includes(need), `viewport 含 ${need}`);
}
say(!/<base\b/i.test(html), '没有 <base href>');
say(!/<iframe\b/i.test(html) && !/<object\b/i.test(html), '没有 <iframe> / <object>');
say(!/http-equiv="Content-Security-Policy"/i.test(html), '没有自建 CSP <meta>');

// 内联脚本：<script> 后面直接跟内容（没有 src）就是内联。
const inlineScript = /<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/i.test(html);
say(!inlineScript, '没有内联 <script>…</script>');
say(!/\son[a-z]+\s*=/i.test(html), '没有 onclick= 这类行内事件');
say(!/javascript:/i.test(html), '没有 javascript: URI');
say(!/<script[^>]*type=["']module["']/i.test(html), '脚本不是 type="module"（容器只认经典脚本）');

const srcs = [...html.matchAll(/<(?:script|link|img)[^>]*(?:src|href)="([^"]+)"/gi)].map((m) => m[1]);
const abs = srcs.filter((s) => /^(https?:)?\/\//.test(s) || s.startsWith('/'));
say(abs.length === 0, 'index.html 里的资源全是相对路径', abs.join(' '));
const missing = srcs.filter((s) => !/^(data:|https?:|\/\/)/.test(s) && !existsSync(join(work, s.replace(/^\.\//, ''))));
say(missing.length === 0, 'index.html 引的每个文件都在包里', missing.join(' '));

// ---- 3. app.js -------------------------------------------------------------
head('脚本');

const code = readFileSync(join(work, 'app.js'), 'utf8');

// 语法：只认 ES2017 的解析器读一遍。这一关出包时已经跑过，这里对着**zip 里
// 那一份**再跑，确保打包这一步没把别的东西塞进来。
const acorn = await import('acorn');
let parseErr = '';
try {
  acorn.parse(code, { ecmaVersion: 2017, sourceType: 'script' });
} catch (e) {
  parseErr = e.message;
}
say(!parseErr, 'zip 里的 app.js 按 ES2017 解析通过（Chrome 61 认得）', parseErr);

// 顶层 import / export：经典脚本里出现就是语法错误，上面那一关本来就会拦住，
// 但单独报一句，出问题时不用去猜解析错在哪。
say(!/^\s*(import|export)\s/m.test(code), '没有顶层 import / export');
say(!/\beval\s*\(/.test(code), '没有 eval(');
say(!/new\s+Function\s*\(/.test(code), '没有 new Function(');
say(!/WebAssembly\./.test(code), '没有 WebAssembly');

// 外链：SVG 的 xmlns 不是网址，先摘掉，否则四十个 <svg> 会把结果淹掉。
const noNs = code.replace(/https?:\/\/www\.w3\.org\/[^"')\s]*/g, '');
const urls = [...noNs.matchAll(/https?:\/\/[^"'`)\s]{4,60}/g)].map((m) => m[0]);
const uniq = [...new Set(urls)];
if (uniq.length) {
  // play-slides.com 那一行是**介绍页上的一句文字**，不是链接（小工具里不能开
  // 外链，所以它只是印在那儿让人自己去输）。带协议头的才要紧。
  say(false, '产物里出现了 http(s) 网址', uniq.slice(0, 5).join(' '));
} else {
  say(true, '产物里没有任何 http(s) 网址');
}

// ---- 4. 体积 ---------------------------------------------------------------
head('体积');

const zipSize = statSync(zip).size;
const unpacked = files.reduce((n, f) => n + statSync(join(work, f)).size, 0);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
say(zipSize <= 10 * 1024 * 1024, `zip ${mb(zipSize)} ≤ 10 MB`, '');
console.log(`     解压后 ${mb(unpacked)}；app.js ${(statSync(join(work, 'app.js')).size / 1024).toFixed(0)} KB`);

// ---- 5. 真的跑起来，盯着每一条请求 ------------------------------------------
head('离线：真的跑一局，看有没有请求出去');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await ctx.addInitScript(`try {
  // 教学那两处都先填上「看过了」，否则体检台点开方块 / 小球会落在分镜动画上，
  // 等不到棋盘。教学本身另有专门的脚本测（check-story）和 check-oldcss 的
  // 「方块分镜动画」那一屏。
  localStorage.setItem('slides.xhs.story.square', '1');
  localStorage.setItem('slides.xhs.story.circle', '1');
} catch (e) {}`);
const page = await ctx.newPage();

const outbound = [];
const errs = [];
page.on('request', (r) => {
  const u = r.url();
  // file: 是包内文件，data: 是内嵌的图和字体，about:blank 是浏览器自己。
  // 别的一律记下来。
  if (!/^(file:|data:|about:|blob:)/.test(u)) outbound.push(r.method() + ' ' + u.slice(0, 90));
});
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120));
});

await page.goto(pathToFileURL(join(work, 'index.html')).href);
await page.waitForSelector('.home-icon-btn', { timeout: 40000 });
await page.waitForTimeout(900);

// 打一局完整的：主菜单 → 开局 → 拖八下 → 完成 → 结算 → 分享战绩图。
// 战绩图那一步最值得走完——它要现画一张 PNG，是整个包里最重的一段代码。
await page.$$eval('.home-icon-btn', (e) => e[0].click());
await page.waitForTimeout(900);
const startBtn = await page.$('#startBtn');
if (startBtn) await page.$eval('#startBtn', (e) => e.click());
await page.waitForFunction(
  () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
  { timeout: 30000 },
);
await page.waitForTimeout(1200);

const box = await page.$eval('.board', (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
for (let i = 0; i < 8; i++) {
  const row = 0.12 + (i % 6) * 0.15;
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * row);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.5 + (i % 2 ? 62 : -62), box.y + box.h * row, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(260);
}
const ended = await page.$eval('#endOverlay', (e) => e.classList.contains('show')).catch(() => false);
if (!ended) await page.click('#finishBtn');
await page.waitForTimeout(2800);

const gotEnd = !!(await page.$('#shareBtn'));
say(gotEnd, '一局从主菜单打到结算页');
if (gotEnd) {
  await page.click('#shareBtn');
  await page.waitForTimeout(2500);
  const img = await page.evaluate(() => {
    const i = document.querySelector('#shareImage');
    return { src: (i && i.getAttribute('src') || '').slice(0, 22), h: i ? i.naturalHeight : 0 };
  });
  say(
    img.src.indexOf('data:image/png') === 0 && img.h > 100,
    '战绩图画得出来（现画的 PNG，不是外链的图）',
    img.src.indexOf('data:image/png') === 0 && img.h > 100 ? '' : JSON.stringify(img),
  );
}

// 成绩与说明页也走一趟：它读存档、画记录行、画战绩详情，是另一条独立的路。
// 先从分享窗口退回结算页，再按结算页上那颗《回主菜单》。按名字找而不是按位置
// ——位置会变，名字不会。
// 先关掉分享窗口——它盖在结算页上面，不关掉的话底下那颗《回主菜单》点不着
// （《发笔记》在容器外是禁用的，但禁用不等于不挡路）。
if (await page.$('#shareCloseBtn')) {
  await page.click('#shareCloseBtn');
  await page.waitForTimeout(900);
}
// 再按结算页上那颗回主菜单。按名字找而不是按位置——位置会变，名字不会；
// 范围也限死在结算页里，别再摸到别的窗口上去。
for (const b of await page.$$('.overlay--end .btn-row button')) {
  const t = ((await b.getAttribute('aria-label')) || (await b.textContent()) || '').trim();
  if (/菜单|返回|主页/.test(t)) {
    await b.click();
    break;
  }
}
await page.waitForTimeout(1800);
const toProfile = await page.$('#xhsProfile');
say(!!toProfile, '结算页退得回主菜单');
if (toProfile) {
  await toProfile.click();
  await page.waitForTimeout(1400);
  say(!!(await page.$('.xhs-about')), '成绩与说明页打得开');
  const rows = await page.$$('.records-row');
  say(rows.length > 0, '刚打完那一局记进了成绩栏', rows.length + ' 条');
  if (rows.length) {
    await rows[0].click();
    await page.waitForTimeout(1800);
    say(!!(await page.$('.xhs-run-img')), '点开一局，战绩详情页打得开');
  }
}

say(outbound.length === 0, '全程零对外请求', outbound.slice(0, 5).join(' | '));
say(errs.length === 0, '全程零报错', errs.slice(0, 3).join(' | '));

// 字体真的用上了没有——包里带着三个 woff2，要是路径错了，浏览器会静静地
// 回落到系统字体，看不出报错，但真机上字全变样。
const fontsOk = await page.evaluate(() =>
  document.fonts && document.fonts.status === 'loaded'
    ? [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)
    : [],
);
const uniqFonts = [...new Set(fontsOk)];
say(uniqFonts.length >= 2, '包里的字体真的加载上了', uniqFonts.join('、') || '一个都没加载');

await ctx.close();
await browser.close();
rmSync(work, { recursive: true });

console.log('\n' + '═'.repeat(60));
if (fails) console.log(`${fails} 项没过——先修再传。`);
else console.log(`全部通过${warns ? `（${warns} 条提醒）` : ''}。这个 zip 可以传进 Builder Hub。`);
process.exit(fails ? 1 : 0);
