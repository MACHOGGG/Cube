/**
 * 小红书小工具那一版的构建——**只属于这一版**。
 *
 * 网页版的 vite.config.ts 一个字不动；这份配置只被 `npm run build:xhs`
 * （见 xhs/build.mjs）用到。
 *
 * 三件事和网页版不一样，每一件都是小红书容器的硬性要求（规范见
 * .claude/skills/minitool-zip-builder/references/）：
 *
 *   1. 打成一个 **iife 经典脚本**，不是 ES module。容器的 CSP 不认
 *      type="module"，离线包里 module 的相对 import 也解析不可靠——典型症
 *      状是「页面渲染出来但 JS 完全不执行」。
 *   2. 语法降到 **es2017 / chrome61**。最低内核是 Android 8.1 出场的
 *      WebView 61，语法不兼容会在解析阶段就失败，运行时 if 兜不住。
 *   3. 把**联网的那几个模块换成空替身**（见 src/stubs/）。小工具禁止任何网
 *      络请求，包里连 fetch( 这个词都不该出现。
 *
 * 第 3 件用的是「按解析后的路径换」而不是 Vite 的 alias：那几个模块是被
 * src/engine 里的文件用相对路径（'./analytics'）引进去的，alias 匹配的是
 * import 写下来的那个字符串，对相对路径不好使。
 */
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stub = (name: string) => resolve(here, 'src/stubs', name);

/** 打包时把左边那个文件换成右边那个。键是文件路径的结尾。 */
const SWAP: Record<string, string> = {
  'src/engine/analytics.ts': stub('analytics.ts'),
  'src/engine/cloudScores.ts': stub('cloudScores.ts'),
  'src/engine/room.ts': stub('room.ts'),
};

function swapModules(): Plugin {
  return {
    name: 'xhs-swap-modules',
    // 要抢在 Vite 自己的解析之前跑，否则那几个模块已经被解析掉了，换不成。
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const path = resolved.id.split('\\').join('/');
      for (const tail of Object.keys(SWAP)) {
        if (path.endsWith(tail)) return SWAP[tail];
      }
      return null;
    },
  };
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [swapModules()],
  build: {
    target: ['es2017', 'chrome61'],
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    // 字体和小图直接内嵌成 data: URI——规范允许，而且少几个文件少几处出错。
    // 太大的（三个可变字体一共 140KB）还是单独出文件，包里带着就行。
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
