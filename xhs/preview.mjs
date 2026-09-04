/**
 * 把出好的包压成**一个 HTML 文件**，用来在没有小红书容器的地方看效果。
 *
 *   npm run build:xhs        # 先出包
 *   node xhs/preview.mjs     # 再出预览
 *
 * 为什么要单独一份：Builder Hub 审核要排队，排队的时候玩家也想看看长什么
 * 样。真正的包是「index.html + app.js + 三个字体文件」四个文件，靠相对路径
 * 互相找；一旦离开那个目录（贴进 Artifact、发微信、丢桌面上），相对路径就
 * 断了，字体不见、页面变形。所以这里把字体转成 data: 内嵌进 JS，再把 JS 内
 * 嵌进 HTML——出来的 preview.html 拆不散，双击就能玩。
 *
 * 出的是**片段**（<title> + <style> + <div id="app"> + <script>），没有
 * <html>/<head>/<body> 外壳：浏览器会自己补上，而 Artifact 那边本来就要
 * 求不能自带外壳。两边都能直接用。
 *
 * 这个文件只服务于「看效果」，不参与出包——xhs/build.mjs 一个字都不引用它，
 * 传进 Builder Hub 的还是 slides-minitool.zip。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const out = join(here, 'preview.html');

if (!existsSync(join(dist, 'app.js'))) {
  throw new Error('xhs/dist 里没有 app.js——先跑一次 npm run build:xhs');
}

// ---- 字体转 data: ----------------------------------------------------------
// 三个可变字体一共 140KB，转成 base64 之后约 187KB。包大了三成，但换来的是
// 「这一个文件走到哪都长得对」，预览要的就是这个。
let code = readFileSync(join(dist, 'app.js'), 'utf8');
let inlined = 0;
code = code.replace(/(\.?\/)?assets\/([\w-]+\.woff2)/g, (whole, _prefix, file) => {
  const path = join(dist, 'assets', file);
  if (!existsSync(path)) return whole;
  inlined += 1;
  return `data:font/woff2;base64,${readFileSync(path).toString('base64')}`;
});

// ---- 拼成一个文件 ----------------------------------------------------------
// </script> 出现在 JS 字符串里会把 <script> 提前收尾。现在的产物里没有，但
// 以后加一段带 HTML 的代码就会有，所以先挡住。
const safe = code.split('</script').join('<\\/script');

// <meta viewport> 必须有，而且必须在最前面：文件开头的 <meta>/<title> 会被
// 浏览器自动收进它补出来的 <head> 里。少了这一条，手机浏览器按默认的 980px
// 排版再整体缩小——主菜单会按电脑版的「五张一排」画出来，看着就不是手机上
// 该有的样子。参数照搬真包的 xhs/index.html。
const html = `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<title>方糖谜题 小工具版</title>
<style>
  /* 小红书容器里页面是满屏的，这里照做：不留边。
     底色写成和游戏一样的米白（src/style.css 的 --bg）。之前这儿是一个近黑
     的占位色，而 <html> 的底色就是浏览器画整个画布用的那个——body 盖不到的
     地方（回弹、安全区、内容不满一屏）会露出黑边。
     也不写 overflow: hidden：主菜单和成绩页本来就要能往下滑。 */
  html, body { margin: 0; padding: 0; background: #FAF6EC; }
</style>
<div id="app"></div>
<script>${safe}</script>
`;

writeFileSync(out, html);
const kb = (n) => `${Math.round(n / 1024)}KB`;
console.log(`预览出好了：xhs/preview.html（${kb(Buffer.byteLength(html))}，内嵌了 ${inlined} 个字体）`);
console.log('双击就能在浏览器里玩；手机上看效果最准。');
