/**
 * 把跑起来的真实界面抓成设计画布的 artboard。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/ui-snapshot.mjs http://localhost:8815 design/
 *
 * 为什么要抓而不是照着重画：重画出来的永远是「差不多」，而这块画布的用处
 * 恰恰是让人对着真东西调尺寸和文案。所以这里用真浏览器把页面跑起来，把
 * #app 连同 <body> 上那些兄弟节点（底部导航、弹窗）整段端走，再把页面上
 * 所有 CSS 规则原样抄一份——类名、数值、媒体查询全都是代码里的那一份。
 *
 * 画布的 iframe 宽度就是画框宽度，所以媒体查询照样按手机/电脑分流，不用
 * 为两种版式各写一套。字体要内嵌成 data URI：画布不许对外发请求，不嵌进去
 * 拉丁字母会掉回系统字体，标题的字形就不对了。
 *
 * 反过来读的时候：我给出去的 artboard 里没有一个行内 style，所以之后从画布
 * 上读回来的任何 style="..." 都是人手动调的那一处，对着改代码就行。
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = (process.argv[2] || 'http://localhost:8815').replace(/\/$/, '');
const outDir = process.argv[3] || 'design';

const FONTS = [
  ['Fraunces', '100 900', 'src/assets/fonts/fraunces-latin-var.woff2'],
  ['Karla', '200 800', 'src/assets/fonts/karla-latin-var.woff2'],
  ['JetBrains Mono', '100 800', 'src/assets/fonts/jetbrains-mono-latin-var.woff2'],
];

/** 三个字体文件塞成 @font-face，画布里不许联网，只能这样带着走。 */
async function fontFaces() {
  const out = [];
  for (const [family, weight, path] of FONTS) {
    const b64 = (await readFile(path)).toString('base64');
    out.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2-variations');}`,
    );
  }
  return out.join('\n');
}

/**
 * 要抓的页面。`go` 负责从主菜单走到那一屏；不写就是主菜单本身。
 * `w` 是画框宽度，高度按页面真实内容算——设计稿要的是整页，不是一屏。
 */
const SCREENS = [
  { file: 'Main', title: '主菜单 · 手机', w: 390, h: 844 },
  { file: 'MenuDesktop', title: '主菜单 · 电脑', w: 1440, h: 900 },
  {
    file: 'Account', title: '个人主页 · 手机', w: 390, h: 844,
    go: async (page) => {
      await page.click('#navProfile');
      await page.waitForTimeout(600);
    },
  },
  {
    file: 'Records', title: '记录与排名 · 手机', w: 390, h: 844,
    go: async (page) => {
      await page.click('#navRecords');
      await page.waitForTimeout(600);
    },
  },
  {
    file: 'Genius', title: '成为 Slides 天才 · 手机', w: 390, h: 844,
    go: async (page) => {
      await page.click('#navProfile');
      await page.waitForTimeout(500);
      await page.click('#becomeGeniusBtn');
      await page.waitForTimeout(800);
    },
  },
  {
    file: 'Insider', title: 'Slides 天才内部码 · 手机', w: 390, h: 844,
    go: async (page) => {
      await page.click('#navProfile');
      await page.waitForTimeout(500);
      await page.click('#insiderRow');
      await page.waitForTimeout(800);
    },
  },
  {
    file: 'Multiplayer', title: '多人游玩 · 手机', w: 390, h: 844,
    go: async (page) => {
      await page.click('#navProfile');
      await page.waitForTimeout(500);
      await page.click('#multiRow');
      await page.waitForTimeout(900);
      // 开局那一下会去问一次服务器有没有旧座位，本地没有就留下一句
      // 「没有这个房间号」。那是抓取的副产品，不是这一屏该有的样子。
      await page.evaluate(() => {
        const msg = document.querySelector('#mpMsg');
        if (msg) msg.textContent = '';
      });
    },
  },
];

/** 页面上所有能读到的 CSS 规则，原样抄一份。 */
const collectCss = () =>
  Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');

/**
 * 把「按钮套按钮」拆开：里层的换成同样属性的 <div>。
 *
 * DOM 里 appendChild 一个 button 进另一个 button 是能放进去的，浏览器不拦；
 * 但序列化成 HTML 再解析回来时，解析器按规范把里层的按钮提出去当兄弟——
 * 于是炸弹卡片里的三个小图标跳到了 #app 底下，整页的 flex 链条一起塌。
 * 这里在抓之前先把里层换掉，结构就跟屏幕上看到的一致了。
 */
const unnestButtons = () => {
  // 从最深的开始换，不然换完外层，里层就找不到自己的祖先了。
  const nested = Array.from(document.querySelectorAll('button button')).reverse();
  for (const btn of nested) {
    const div = document.createElement('div');
    for (const a of btn.attributes) div.setAttribute(a.name, a.value);
    div.setAttribute('role', 'button');
    div.setAttribute('data-was-button', '');
    div.innerHTML = btn.innerHTML;
    btn.replaceWith(div);
  }
  return nested.length;
};

/**
 * 换成 div 之后，`button { ... }` 这类按元素名写的规则就落不到它们身上了。
 * 所以把所有提到 button 的规则再抄一份，选择器换成 [data-was-button]。
 * 抄的是页面上真实的规则，以后 style.css 怎么改，这里跟着变，不用维护。
 */
const mirrorButtonRules = () => {
  const out = [];
  // 包一层 :where()，把权重压到 0。不压的话 `button { padding: 11px 18px }`
  // 的镜像版本会和 `.home-icon-btn { padding: 0 }` 打成平手，又排在后面，
  // 于是赢了——炸弹卡里的小图标被左右各 18px 的内边距挤成 0 宽。
  const swap = (sel) => sel.replace(/\bbutton\b/g, ':where([data-was-button])');
  const walk = (rules) => {
    for (const r of rules) {
      if (r.selectorText) {
        if (/\bbutton\b/.test(r.selectorText)) {
          out.push(r.cssText.replace(r.selectorText, swap(r.selectorText)));
        }
      } else if (r.cssRules) {
        // @media / @supports 之类：留着外壳，只抄里面提到 button 的那几条。
        const prelude = r.cssText.slice(0, r.cssText.indexOf('{'));
        const inner = [];
        for (const c of r.cssRules) {
          if (c.selectorText && /\bbutton\b/.test(c.selectorText)) {
            inner.push(c.cssText.replace(c.selectorText, swap(c.selectorText)));
          }
        }
        if (inner.length) out.push(`${prelude}{\n${inner.join('\n')}\n}`);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch { /* 读不到就算了 */ }
  }
  return out.join('\n');
};

/** <body> 的内容，去掉脚本和开屏动画。 */
const collectBody = () => {
  const clone = document.body.cloneNode(true);
  for (const el of clone.querySelectorAll('script, .splash, .loading-screen, #loadingScreen')) el.remove();
  return {
    html: clone.innerHTML,
    height: Math.ceil(
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    ),
    bodyClass: document.body.className,
    rootClass: document.documentElement.className,
  };
};

const faces = await fontFaces();
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const made = [];

for (const screen of SCREENS) {
  const ctx = await browser.newContext({
    viewport: { width: screen.w, height: screen.h },
    deviceScaleFactor: 2,
  });
  // 语言定成简体中文，教学标成看过——不然每次抓到的都是第一次访问的那两屏。
  await ctx.addInitScript(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_tutorial_seen', '1');
    localStorage.setItem('slides_tutorial_seen_circle', '1');
    localStorage.setItem('slides_tutorial_seen_triangle', '1');
  });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.home-page', { timeout: 15000 });
  await page.waitForTimeout(1200); // 开屏动画收尾
  if (screen.go) await screen.go(page);

  const unnested = await page.evaluate(unnestButtons);
  const css = await page.evaluate(collectCss);
  const mirrored = await page.evaluate(mirrorButtonRules);
  const { html, height } = await page.evaluate(collectBody);
  await ctx.close();

  const frameH = Math.max(screen.h, height);
  const dc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
${faces}
${css}
/* 「按钮套按钮」被拆成 div 之后，按元素名写的规则的镜像版本。 */
${mirrored}
/* <x-dc> 和 <helmet> 是画布自己的包装标签，浏览器默认按 inline 排。
   不摘掉它们，body 和真正的页面之间就多了一层行内盒子，整页的 flex/高度
   链条会断——第一次抓出来的图标散成一片就是这个原因。 */
x-dc, helmet { display: contents; }
/* 画框本身：让这一屏在 artboard 里占满、不滚动。 */
html, body { margin: 0; width: ${screen.w}px; }
a { color: #BE5762; }
a:hover { color: #9c4450; }
  </style>
</helmet>
${html}
</x-dc>
</body>
</html>
`;
  await writeFile(join(outDir, `${screen.file}.dc.html`), dc, 'utf-8');
  made.push({ ...screen, frameH, bytes: dc.length });
  console.log(`${screen.file}.dc.html  ${screen.w}×${frameH}  ${(dc.length / 1024).toFixed(0)} KB`
    + (unnested ? `  （拆开 ${unnested} 个嵌套按钮）` : ''));
}

await browser.close();

// canvas.json：手机一排，电脑单独一排，间距按画布的规矩留够。
let x = 0;
const artboards = [];
for (const m of made.filter((m) => m.w <= 500)) {
  artboards.push({ file: `${m.file}.dc.html`, title: m.title, x, y: 0, w: m.w, h: m.frameH });
  x += m.w + 120;
}
const tallest = Math.max(...artboards.map((a) => a.h), 0);
let y2 = tallest + 200;
for (const m of made.filter((m) => m.w > 500)) {
  artboards.push({ file: `${m.file}.dc.html`, title: m.title, x: 0, y: y2, w: m.w, h: m.frameH });
  y2 += m.frameH + 200;
}
await writeFile(
  join(outDir, 'canvas.json'),
  JSON.stringify({ artboards, launch: { view: 'canvas' } }, null, 2),
  'utf-8',
);
console.log(`\ncanvas.json  ${artboards.length} 个画框`);
