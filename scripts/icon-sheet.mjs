/**
 * 图标清单：把现在用着的每一个图标，按它该有的文件名导出成一个 .svg，
 * 再拼成一张对照表。
 *
 *   node scripts/icon-sheet.mjs
 *
 * 出两样东西到 design/icons/：
 *   · 44 个 .svg —— 就是现在网页上那一版，文件名已经是对的。要换哪个，
 *     用设计软件打开同名那个文件改，存回 src/assets/icons/ 就生效。
 *   · sheet.html / sheet.png —— 一张全家福，每个图标底下写着它的文件名。
 *
 * 为什么导出的是「现在这一版」而不是空白模板：照着现有的改，画布尺寸、
 * 出血、图形占多大一块都是对的；从零开一张 1024×1024 画的图，放上去多半
 * 会因为四周留白而显小。
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const OUT = 'design/icons';
const SHAPES = ['square', 'circle', 'triangle'];
const TIERS = ['basic', 'timed', 'advanced'];
const LAYOUTS = ['squareDiamond', 'circleHex', 'circleSeven', 'triangleBig', 'triangleAdvanced'];

const tmp = path.resolve('node_modules/.cache/icon-sheet');
await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: {
        homeIcons: path.resolve('src/ui/homeIcons.ts'),
        appIcons: path.resolve('src/ui/appIcons.ts'),
        gameShell: path.resolve('src/ui/gameShell.ts'),
      },
      formats: ['es'],
    },
    outDir: tmp,
    emptyOutDir: true,
    minify: false,
  },
});
const H = await import(pathToFileURL(path.join(tmp, 'homeIcons.js')).href);
const A = await import(pathToFileURL(path.join(tmp, 'appIcons.js')).href);
const G = await import(pathToFileURL(path.join(tmp, 'gameShell.js')).href);

/** 一组图标：分组标题 + [文件名, SVG, 说明] 三元组。 */
const GROUPS = [
  ['主菜单 · 三个基础玩法', [
    ['base-square', H.ICON_BASE_SQUARE, '方块'],
    ['base-circle', H.ICON_BASE_CIRCLE, '圆球'],
    ['base-triangle', H.ICON_BASE_TRIANGLE, '三角'],
  ]],
  ['计时挑战', [
    ['timed-combined', H.ICON_TIMED_COMBINED, '手机主菜单上的合体秒表'],
    ...SHAPES.map((sh) => [`timed-${sh}`, H.timedCard(sh), `电脑端 / 弹窗里的 ${sh}`]),
  ]],
  ['炸弹挑战', [
    ['bomb-90s', H.ICON_BOMB_90S, '90s 星爆（画布是 260×100，不是正方形）'],
    ...TIERS.flatMap((t) => SHAPES.map((sh) => [`bomb-${t}-${sh}`, H.bombChip(sh, t), `${t} · ${sh}`])),
  ]],
  ['更多布局', [
    ...SHAPES.map((sh) => [`more-${sh}`, H.moreLayoutCard(sh), `${sh} 的「+」卡`]),
    ...LAYOUTS.map((id) => [`layout-${id}`, H.layoutIcon(id, 'square'), id]),
  ]],
  ['底部导航与开关', [
    ['nav-profile', H.ICON_NAV_PROFILE, '个人主页'],
    ['nav-records', H.ICON_NAV_RECORDS, '记录与排名'],
    ['sound-on', H.ICON_SOUND_ON, '声音开（跟随按钮颜色）'],
    ['sound-off', H.ICON_SOUND_OFF, '声音关（跟随按钮颜色）'],
    ['lock', H.ICON_LOCK, '锁（跟随文字颜色）'],
  ]],
  ['游戏进行中的两颗按钮', [
    ['ctl-pause', G.CTL_PAUSE, '暂停（跟随按钮颜色，按下会反色）'],
    ['ctl-finish', G.CTL_FINISH, '完成（跟随按钮颜色，按下会反色）'],
  ]],
  ['App 图标（标签页 + 手机主屏幕）', A.APP_ICONS.map(({ id, svg }) => [`app-${id}`, svg, id])],
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let count = 0;
for (const [, items] of GROUPS) {
  for (const [name, svg] of items) {
    await writeFile(path.join(OUT, `${name}.svg`), svg + '\n', 'utf-8');
    count++;
  }
}

// ---- 对照表 ---------------------------------------------------------------
const cell = ([name, svg, note]) => `
  <figure>
    <div class="art">${svg}</div>
    <figcaption><code>${name}.svg</code><span>${note}</span></figcaption>
  </figure>`;

const html = `<!doctype html><meta charset="utf-8"><title>Slides 图标清单</title>
<style>
  /* 暂停/完成是用 var(--ctl-disc)/var(--ctl-mark) 画的，页面上由按钮给值；
     对照表里得自己给一份，不然它们是透明的。 */
  :root { --ctl-disc: #BE5762; --ctl-mark: #FFFFFF; }
  body { margin: 0; padding: 40px; background: #F7F5F2; color: #2C2926;
         font: 15px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .lede { color: #6B6560; margin: 0 0 32px; max-width: 62ch; }
  h2 { font-size: 17px; margin: 34px 0 14px; padding-bottom: 8px; border-bottom: 1px solid #E2DCD5; }
  .row { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 18px; }
  figure { margin: 0; background: #fff; border: 1px solid #E8E2DB; border-radius: 14px;
           padding: 14px; text-align: center; }
  .art { height: 88px; display: flex; align-items: center; justify-content: center; }
  .art svg { max-width: 88px; max-height: 88px; width: auto; height: auto; }
  figcaption { margin-top: 10px; display: flex; flex-direction: column; gap: 3px; }
  code { font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color: #A0522D; word-break: break-all; }
  figcaption span { font-size: 11px; color: #8A837C; }
</style>
<h1>Slides 图标清单</h1>
<p class="lede">共 ${count} 个。要换哪个，就把你画的那版存成同名的 .svg 放进
  <code>src/assets/icons/</code>——放进去就生效，删掉就变回这里画的这版。
  <code>design/icons/</code> 里已经导出了下面每一个的现有版本，可以直接打开来改。</p>
${GROUPS.map(([title, items]) => `<h2>${title}</h2><div class="row">${items.map(cell).join('')}</div>`).join('')}
`;

await writeFile(path.join(OUT, 'sheet.html'), html, 'utf-8');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1400 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'sheet.png'), fullPage: true });
await browser.close();

console.log(`${count} 个图标 -> ${OUT}/*.svg`);
console.log(`对照表 -> ${OUT}/sheet.html + sheet.png`);
