/**
 * 出「开场动画单独版」：tools/splash/splash.html，一个自带一切的文件。
 *
 *   npm run build:splash
 *
 * 和主站那份配置的差别只有两处：入口在这个目录，产物压成一个文件（字体、
 * JS、CSS 全内嵌）。为什么要内嵌：这一份是给人拿走用的——贴进 keynote、发
 * 给合作方、丢在桌面上双击——一旦离开目录，相对路径就断了。
 */
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    // 一个文件里不能有另开的资源请求，所以字体也一起转成 data:。
    assetsInlineLimit: 1024 * 1024,
  },
  plugins: [viteSingleFile()],
});
