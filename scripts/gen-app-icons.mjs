/**
 * Rasterises the icon in src/ui/appIcons.ts into the PNG sizes a phone
 * actually installs from, and writes its web app manifest.
 *
 * The tab favicon can be an inline SVG data URI, which is why applyAppIcon
 * could get away with building one on the fly. A home-screen install cannot:
 * iOS reads <link rel="apple-touch-icon"> and wants a real PNG at a real
 * URL, and Android installs whatever the linked manifest names. So the icon
 * has to exist on disk, and this is what puts it there.
 *
 * 从前这儿是十一个图标各出一套（玩家在《图示》里挑），10-08 方案 3-C-4 删了那个入口，
 * 只剩一个。
 *
 * Run after changing the icon's artwork:  node scripts/gen-app-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const OUT = 'public/icons/app';
const SIZES = [180, 192, 512];

/**
 * manifest 的颜色从 style.css 现读，不在这儿写死（10-08 方案第五批第 10 条）。
 *
 * 原先这儿写死 background_color '#FAF9F5'、theme_color '#BE5762'。页面底色后来照玩家给的稿子
 * 往暗黄挪了一档（--bg 现在是 #F5EDDA），这儿没跟：装到桌面上的那一版，启动画面的底色还是旧
 * 的米白，和随后亮出来的页面对不上。现在读 style.css 第一个 :root（浅色那一套）里的 --bg——改
 * 色只改 style.css 一处，重跑这个脚本就跟上了；门 check-manifest-colors 盯着生成出来的那一份和
 * style.css、index.html 对不对得上。
 *
 * **两个键都取 --bg**（10-09 补充方案第一部分第 8 条，玩家选乙）。theme_color 原先取的是强调色
 * --accent（玫红）：装到桌面上那一版，状态栏和任务切换器里的那一条是玫红的，而浏览器里打开时
 * index.html 的 <meta name="theme-color"> 写的是底色——同一个站两种顶条。现在三处是同一个颜色。
 */
async function rootTokens(...names) {
  const css = await readFile('src/style.css', 'utf8');
  const at = css.indexOf(':root {');
  const block = css.slice(at, css.indexOf('\n}', at));
  return names.map((n) => {
    const m = block.match(new RegExp(`^\\s*${n}:\\s*(#[0-9A-Fa-f]{6})\\s*;`, 'm'));
    if (!m) throw new Error(`style.css 第一个 :root 里没找到 ${n}`);
    return m[1];
  });
}
const [BG] = await rootTokens('--bg');

// appIcons.ts imports from homeIcons.ts, so bundle it rather than parsing it.
const tmp = path.resolve('node_modules/.cache/app-icons');
await build({
  logLevel: 'error',
  build: {
    lib: { entry: path.resolve('src/ui/appIcons.ts'), formats: ['es'], fileName: 'appIcons' },
    outDir: tmp,
    emptyOutDir: true,
    minify: false,
  },
});
const { APP_ICON } = await import(pathToFileURL(path.join(tmp, 'appIcons.js')).href);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();

for (const { id, svg } of [APP_ICON]) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const shot = await page.locator('svg').screenshot({ omitBackground: false });
    await writeFile(path.join(OUT, `${id}-${size}.png`), shot);
  }
  await writeFile(
    path.join(OUT, `${id}.webmanifest`),
    JSON.stringify(
      {
        id: '/',
        name: 'Slides',
        short_name: 'Slides',
        description: 'Slides：拖动整行整列或整条斜线，拼出同色图案的益智消除游戏。',
        lang: 'zh-Hans',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: BG,
        theme_color: BG,
        icons: [
          { src: `/icons/app/${id}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `/icons/app/${id}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `/icons/app/${id}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('wrote', id);
}

await browser.close();
await rm(tmp, { recursive: true, force: true });
console.log(`\n1 icon x ${SIZES.length} sizes + manifest -> ${OUT}`);
