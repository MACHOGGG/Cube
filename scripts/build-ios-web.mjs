/**
 * iOS 包里装的那一份网页：`dist/` 去掉只属于网站的两样，放进 `dist-ios/`（10-08 方案第五批第 11 条）。
 *
 *   npm run ios:sync      # = npm run build && node scripts/build-ios-web.mjs && cap sync ios
 *
 * 方案原话：「iOS 包剔除 mint.html 与 public/xhs 副本：构建按目标过滤」。
 *
 * 原先 capacitor.config.ts 的 webDir 直接指 `dist/`，于是网站上有什么，App 里就装什么：
 *
 *   · `mint.html` —— 管理员发码、重建榜单的那一页。它本身不含令牌（令牌在网址 # 后面），可它没理由
 *     装进每一个玩家的手机里：一个后台入口跟着 App 发出去，审核的人和拆包的人都看得见。
 *   · `xhs/` —— 小红书小工具的那一份副本（网站上留着它，是为了真机上开 /xhs/ 调试）。App 里一行代
 *     码都不会去读它，白占几百 KB。
 *
 * 做法是按目标过滤，不动网站：`dist/` 照旧是 Vercel 发的那一份、一个字不改；这儿把它整份复制成
 * `dist-ios/`，再删掉 IOS_EXCLUDE 里那几样，capacitor.config.ts 的 webDir 指 `dist-ios/`。门：
 * check-ios-web（不开浏览器，进 CI 的 check 那一条）。
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 只属于网站、不进 App 的几样（相对 dist/ 的路径）。 */
export const IOS_EXCLUDE = ['mint.html', 'xhs'];

/** 把 src（默认 dist/）复制成 out（默认 dist-ios/），去掉 IOS_EXCLUDE。回去掉了哪几样。 */
export function buildIosWeb(src, out) {
  if (!existsSync(join(src, 'index.html'))) {
    throw new Error(`${src} 里没有 index.html——先跑 npm run build`);
  }
  rmSync(out, { recursive: true, force: true });
  cpSync(src, out, { recursive: true });
  const removed = [];
  for (const p of IOS_EXCLUDE) {
    const at = join(out, p);
    if (existsSync(at)) {
      rmSync(at, { recursive: true, force: true });
      removed.push(p);
    }
  }
  return removed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const removed = buildIosWeb(join(root, 'dist'), join(root, 'dist-ios'));
  console.log(`dist-ios/ 写好了（去掉了：${removed.join('、') || '没有要去的'}）——cap sync 拿的是它。`);
}
