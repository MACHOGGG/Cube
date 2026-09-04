/**
 * 「这台设备要求少动画吗」——单独一个文件，只为它没有别的依赖。
 *
 * 这一句本来长在 juice.ts 里（手感工具箱：顿帧、震屏、粒子、音效）。问题是
 * juice 一加载就会去读本地存档（声音开关）、还要拉 cuelume 那套音频——在微
 * 信小游戏里既没有 localStorage 也没有那套 API，一碰就炸。而小游戏要用的
 * dragChain（拖动时那套弹簧）只需要这一句话。
 *
 * 所以把它单拎出来：dragChain 只依赖这个文件，网页那边照旧从 juice 里拿
 * （juice 原样再导出一次），两处用的是同一份判断。
 */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // 没有 window（小游戏、服务端渲染、单元测试）就当作「照常动画」。
    return false;
  }
}
