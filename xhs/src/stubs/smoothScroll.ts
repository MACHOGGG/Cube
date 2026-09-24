/**
 * 滚动阻尼的空替身——小红书这一版不接。
 *
 * 网页版用 Lenis 给整页滚动加了一点阻尼（见 src/engine/smoothScroll.ts）。这
 * 一版不接，三个理由：
 *
 *   · 最低内核是 Chrome 61（Android 8.1 的 WebView），Lenis 在那上面没测过；
 *   · 小工具的包有体积门禁，多背一个库不划算；
 *   · 容器自己也在管滚动，再插一层没意义。
 *
 * 和 room.ts / analytics.ts 同一条路：换成替身，调用点（main.ts 的 teardown
 * 和 showGame）一个字都不用改，真正的 lenis 也就不会被打进包里——出包之后搜
 * 「lenis」应该一个字都搜不到。
 */
export function start(): void {
  /* 这一版没有阻尼，原生滚动就挺好 */
}

export function stop(): void {
  /* 同上 */
}
