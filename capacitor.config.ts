import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell around the same web build the site serves.
 *
 * Capacitor does not change the web app at all: `webDir` points at the very
 * bundle `npm run build` already produces for Vercel, and the iOS project
 * just loads those files from inside the app instead of over the network.
 * Nothing here is imported by src/, so the browser build is byte-for-byte
 * what it was before — the two targets stay in step by construction.
 *
 * To refresh the app after a code change:  npm run ios:sync
 *
 * `appId` is the App Store bundle identifier. It can be changed later in
 * Xcode (App target → Signing & Capabilities → Bundle Identifier), but it
 * must be globally unique before the app is ever submitted.
 */
const config: CapacitorConfig = {
  appId: 'com.slides.game',
  appName: 'Slides',
  webDir: 'dist',
  // 和 style.css 里的 `--bg` 同一个值，也和 index.html 的 theme-color 同一个值：第一帧
  // 画出来之前那一下，玩家看到的是这张纸本身的颜色，不是一道白闪。
  //
  // ⚠️ 它曾经是 `#FAF9F5`，而上面那句注释写着「Matches --bg」——那是 2026-09 把纸色从
  // 米白挪到米黄（`--bg: #F5EDDA`）之前的值，挪的时候这儿漏了。于是 iOS 上每次冷启都
  // 先闪一下更白的那张纸，而注释还在说两处是一样的。**这三处必须一起改**（style.css 的
  // `--bg`、index.html 的 theme-color、这儿）。
  backgroundColor: '#F5EDDA',
};

export default config;
