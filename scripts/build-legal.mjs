/**
 * 把 src/legal.ts 里那五份文档摊成五张静态网页，摆进 dist/。
 *
 *   node scripts/build-legal.mjs           # vite build 之后自动跑（见 package.json）
 *
 * 为什么要有这一步
 * ────────────────
 * 那五份文档本来只活在个人主页底下那五行里：点开是个弹窗，地址栏一动不动。
 * 对玩家没问题，对收单方的审核就不行——他们要能直接打开这几页，也要能把网
 * 址填进后台的表格里，而「先点底排的小人、再滚到最底下、再点第三行」不是一
 * 个能填进表格的东西。play-slides.com/terms 从前是 404。
 *
 * 为什么是生成，不是手写五个 html
 * ────────────────────────────────
 * 手抄一定分叉。四种语言 × 两套渠道变体（`only: 'web'` / `'store'`），一共
 * 一百多条，改一次条款要在五个地方同步——这正是「网站陈述与实际不符」的温
 * 床，而那恰恰是这次要治的病。所以只有一份底稿（src/legal.ts），网页版弹窗
 * 和这五张静态页都从它长出来。以后条款一改，重新构建就同步了。
 *
 * 怎么读到 legal.ts
 * ─────────────────
 * 它是 TypeScript，还 import 了别的模块，Node 直接 import 不了。用 esbuild
 * （Vite 自带的那份）先打成一个 .mjs 再动态 import——不另装依赖，也不去正则
 * 解析源码（那种做法在字符串里有个引号就会崩）。
 *
 * 渠道固定成 'web'
 * ────────────────
 * 这五张页是网站的页，读它的人站在网页这个柜台前：价格是美元、收款的是
 * Creem、退款按 14 天那条走。App Store / Google Play 那半边的条款不属于这里，
 * legalDoc() 本来就会把它们滤掉——这里只是把「站在哪个柜台」这件事写死，因
 * 为静态页没有 window.Capacitor 可以问。
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = process.argv[2] ? join(root, process.argv[2]) : join(root, 'dist');

// ---- 读 legal.ts ------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), 'slides-legal-'));
const bundled = join(tmp, 'legal.mjs');
esbuild.buildSync({
  entryPoints: [join(root, 'src', 'legal.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundled,
  logLevel: 'silent',
});
const L = await import(pathToFileURL(bundled).href);
rmSync(tmp, { recursive: true, force: true });

const { LEGAL, LEGAL_ORDER, LEGAL_PATH, CONTACT_EMAIL, LEGAL_UPDATED } = L;

/** 四种语言，英文排头——审核员读的是英文，别让他先撞上中文。 */
const LANGS = [
  { id: 'en', tag: 'en', label: 'English' },
  { id: 'zhHans', tag: 'zh-Hans', label: '简体中文' },
  { id: 'zhHant', tag: 'zh-Hant', label: '繁體中文' },
  { id: 'fr', tag: 'fr', label: 'Français' },
];

/** 「回到游戏」那句，各语言一句。 */
const BACK = { en: 'Back to Slides', zhHans: '回到 Slides', zhHant: '回到 Slides', fr: 'Retour à Slides' };

const esc = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 这一份、这一种语言，在网页这个柜台上该有哪几条。
 *
 * 和 legalDoc() 同一条规矩：`only` 指名了另一个柜台的条款根本不摆出来——不是
 * 灰掉，是不在这一页上。`{store}` 在网页版就是 Creem。
 */
function webDoc(lang, key) {
  const doc = LEGAL[lang][key];
  const name = (t) => String(t).replace(/\{store\}/g, 'Creem');
  return {
    title: name(doc.title),
    intro: name(doc.intro),
    items: doc.items
      .filter((it) => !it.only || it.only === 'web')
      .map((it) => ({ term: name(it.term), body: name(it.body) })),
  };
}

// ---- 样式 -------------------------------------------------------------------
//
// 全部内联。这五张页要在任何情况下都打得开、读得清——包括审核员挂着代理、
// 资源没加载完的那一刻。配色照 style.css 的底子（米白纸、深褐字、砖红点缀），
// 深色模式给一套等价的，两边都painted，不借宿主的底。
const CSS = `
:root{--paper:#faf9f5;--ink:#3d3128;--soft:#6f6459;--line:#e6e0d6;--accent:#be5762;--chip:#f1ece2}
@media (prefers-color-scheme:dark){:root{--paper:#1c1815;--ink:#efe8de;--soft:#b3a89b;--line:#3a332c;--accent:#e2828c;--chip:#272119}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.7 "Karla",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  padding:0 20px 72px}
.wrap{max-width:44rem;margin:0 auto}
header{padding:34px 0 8px;border-bottom:1px solid var(--line);margin-bottom:26px}
.brand{display:inline-block;font-weight:800;font-size:1.5rem;letter-spacing:.01em;color:var(--ink);text-decoration:none}
.brand span{color:var(--accent)}
h1{font-size:1.85rem;line-height:1.25;margin:16px 0 6px;text-wrap:balance}
.meta{color:var(--soft);font-size:.86rem;margin:0 0 18px}
nav.langs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}
nav.langs a,nav.langs button{border:1px solid var(--line);background:var(--chip);color:var(--ink);
  border-radius:999px;padding:5px 13px;font-size:.83rem;text-decoration:none;cursor:pointer;font-family:inherit}
nav.langs .on{background:var(--accent);border-color:var(--accent);color:#fff}
.doc{margin:0 0 44px}
.doc h2{font-size:1.05rem;color:var(--soft);font-weight:600;margin:0 0 10px;letter-spacing:.04em;text-transform:uppercase}
.intro{margin:0 0 20px}
dl{margin:0}
dt{font-weight:700;margin:20px 0 4px}
dd{margin:0;color:var(--soft)}
footer{border-top:1px solid var(--line);padding-top:22px;margin-top:10px;font-size:.9rem}
footer ul{list-style:none;display:flex;flex-wrap:wrap;gap:8px 18px;padding:0;margin:0 0 14px}
footer a{color:var(--accent)}
.contact{color:var(--soft);margin:0}
`.trim();

/**
 * 一小段脚本：有 JS 就一次只显示一种语言，没 JS 就四种全摊着。
 *
 * 顺序是有意的——页面发出去时四段都在 DOM 里、都是可见的，脚本跑起来才收起
 * 三段。所以关掉 JS、脚本没加载、或者是个只读 HTML 的爬虫，读到的都是完整的
 * 四种语言，而不是一片空白。
 */
const JS = `
(function(){
  var secs=[].slice.call(document.querySelectorAll('.doc'));
  // 只找导航里的那几颗按钮。语言段自己也带 data-lang，一起选上的话，下面
  // 那行 className= 会把 class="doc" 抹掉，样式和后续的选择器一起失效。
  var btns=[].slice.call(document.querySelectorAll('nav.langs [data-lang]'));
  if(!secs.length||!btns.length)return;
  function show(id){
    for(var i=0;i<secs.length;i++)secs[i].hidden=secs[i].getAttribute('data-lang')!==id;
    for(var j=0;j<btns.length;j++)btns[j].className=btns[j].getAttribute('data-lang')===id?'on':'';
    document.documentElement.lang=id==='zhHans'?'zh-Hans':id==='zhHant'?'zh-Hant':id;
  }
  for(var k=0;k<btns.length;k++)(function(b){
    b.addEventListener('click',function(){show(b.getAttribute('data-lang'));});
  })(btns[k]);
  // 网址里点名了就听它的（?lang=fr），否则跟浏览器的偏好，都不认就英文。
  var want=(location.search.match(/[?&]lang=([\\w-]+)/)||[])[1]||'';
  var nav=(navigator.language||'').toLowerCase();
  var pick=want==='fr'||nav.indexOf('fr')===0?'fr'
    :want==='zhHant'||/^zh-(hant|tw|hk|mo)/.test(nav)?'zhHant'
    :want==='zhHans'||nav.indexOf('zh')===0?'zhHans':'en';
  show(pick);
})();
`.trim();

// ---- 生成 -------------------------------------------------------------------

function page(key) {
  const en = webDoc('en', key);
  const docs = LANGS.map((l) => ({ ...l, doc: webDoc(l.id, key) }));

  const langNav =
    '<nav class="langs">' +
    docs.map((d) => `<button type="button" data-lang="${d.id}">${esc(d.label)}</button>`).join('') +
    '</nav>';

  const body = docs
    .map(
      (d) => `      <section class="doc" data-lang="${d.id}" lang="${d.tag}">
        <h2>${esc(d.label)}</h2>
        <p class="intro">${esc(d.doc.intro)}</p>
        <dl>
${d.doc.items.map((it) => `          <dt>${esc(it.term)}</dt>\n          <dd>${esc(it.body)}</dd>`).join('\n')}
        </dl>
      </section>`,
    )
    .join('\n');

  const others = LEGAL_ORDER.map(
    (k) => `<li><a href="${LEGAL_PATH[k]}">${esc(LEGAL[('en')][k].title)}</a></li>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#BE5762" />
<meta name="description" content="${esc(en.intro)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<title>${esc(en.title)} · Slides</title>
<!--
  这一页是生成出来的，别直接改：底稿在 src/legal.ts，改那儿再重新构建
  （scripts/build-legal.mjs，跟在 npm run build 后面自动跑）。
-->
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="/">Slide<span>s</span></a>
    <h1>${esc(en.title)}</h1>
    <p class="meta">${esc(LEGAL_UPDATED)}</p>
    ${langNav}
  </header>
${body}
  <footer>
    <ul>${others}<li><a href="/">${esc(BACK.en)} &rsaquo;</a></li></ul>
    <p class="contact">${esc(CONTACT_EMAIL)}</p>
  </footer>
</div>
<script>${JS}</script>
</body>
</html>
`;
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const made = [];
for (const key of LEGAL_ORDER) {
  // cleanUrls 把 /terms 映到 terms.html（见 vercel.json），所以文件名就是
  // 网址去掉那条斜杠。
  const file = LEGAL_PATH[key].replace(/^\//, '') + '.html';
  writeFileSync(join(outDir, file), page(key), 'utf8');
  made.push(`${LEGAL_PATH[key]}  ←  ${file}`);
}
console.log('法务静态页出好了（' + made.length + ' 张）：');
for (const m of made) console.log('  ' + m);
