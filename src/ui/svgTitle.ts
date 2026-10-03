/**
 * 去掉 SVG 里的 `<title>`（第 14 推）。
 *
 * 设计软件导出的 SVG 几乎个个带一行 `<title>编组</title>`（Sketch 给图层起的默认名）。
 * 嵌进页面以后，它就是这颗图标的悬停提示：鼠标停在任何一颗图标上，冒出一个写着「编组」
 * 的小框；读屏也会把它念出来，按钮自己的名字前面多了「编组」两个字。
 *
 * 第 17 推把当时那几个文件里的这一行手工删掉了，可下一个导出的文件照样会带进来（玩家给的
 * 炸弹图标就带着）。所以改在**嵌进页面的那一处**统一去掉：图标走 customIcons.ts 的
 * `trim()`，天才标志走 geniusLogo.ts，两处都调这一个函数——不指望每次换图都记得删。
 *
 * 单独一个文件，是因为 customIcons.ts 里有 `import.meta.glob`：拿 esbuild 打成 node 能跑
 * 的东西会当场炸。门（scripts/check-svg-title.mjs）直接打包这一个来喂。
 */
export function stripSvgTitle(svg: string): string {
  return svg.replace(/<title\b[^>]*\/>/gi, '').replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');
}
