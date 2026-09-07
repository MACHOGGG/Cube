/**
 * 把开场动画录成一段视频。
 *
 *   node tools/splash/record.mjs          # 1080 见方
 *   node tools/splash/record.mjs 2160     # 换个边长
 *
 * 出的是 splash-<边长>.webm：Chromium 自己录的，浏览器和大多数剪辑软件都认。
 *
 * 为什么不是 mp4：这台机器上没有 ffmpeg，装不上（源里那两个依赖 404）。要
 * mp4 的话把 webm 丢进任何转码工具都能转，画质不会掉——webm 本身就是这一段
 * 的原始录像。
 *
 * 为什么不出逐帧 PNG：试过了，走不通。想让每一帧之间正好差 1/30 秒，就得用
 * Chrome 的虚拟时钟（Emulation.setVirtualTimePolicy）把时间按住；可时间一按
 * 住，合成器也跟着停，截图这一步就永远等不到画面，卡死在那儿。要更高画质的
 * 素材，直接开 splash.html 用录屏软件录——那一份是矢量的，多大都清楚。
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SIZE = Number(process.argv[2]) || 1080;
const FPS = Number(process.argv[3]) || 30;
/** 整段 2.8 秒（TOTAL_MS ÷ SPEED），前后各留一点余量。 */
const DURATION_MS = 3400;
const CHROME = '/opt/pw-browsers/chromium';
const page_url = `file://${join(here, 'splash.html')}?size=${SIZE}&loop=0&bare=1`;

const framesDir = join(here, `frames-${SIZE}`);
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const videoDir = join(here, '.video');
rmSync(videoDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 一、视频：让它按真实时间放一遍，Chromium 自己录
// ---------------------------------------------------------------------------
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({
    viewport: { width: SIZE, height: SIZE },
    recordVideo: { dir: videoDir, size: { width: SIZE, height: SIZE } },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(page_url, { waitUntil: 'load' });
  await page.waitForTimeout(DURATION_MS + 300);
  await ctx.close();
  await browser.close();
  const [file] = readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
  renameSync(join(videoDir, file), join(here, `splash-${SIZE}.webm`));
  rmSync(videoDir, { recursive: true, force: true });
  console.log(`视频出好了：tools/splash/splash-${SIZE}.webm`);
}
