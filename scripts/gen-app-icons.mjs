/**
 * Rasterises every icon in src/ui/appIcons.ts into the PNG sizes a phone
 * actually installs from, and writes one web app manifest per icon.
 *
 * The tab favicon can be an inline SVG data URI, which is why applyAppIcon
 * could get away with building one on the fly. A home-screen install cannot:
 * iOS reads <link rel="apple-touch-icon"> and wants a real PNG at a real
 * URL, and Android installs whatever the linked manifest names. So the
 * player's choice has to exist on disk, and this is what puts it there.
 *
 * Run after changing any icon's artwork:  node scripts/gen-app-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const OUT = 'public/icons/app';
const SIZES = [180, 192, 512];

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
const { APP_ICONS } = await import(pathToFileURL(path.join(tmp, 'appIcons.js')).href);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();

for (const { id, svg } of APP_ICONS) {
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
        background_color: '#FAF9F5',
        theme_color: '#BE5762',
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
console.log(`\n${APP_ICONS.length} icons x ${SIZES.length} sizes + manifests -> ${OUT}`);
