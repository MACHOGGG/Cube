/**
 * 装到桌面上的那一版（PWA manifest）的两个颜色，和 style.css 现行的底色、强调色是同一个
 * （10-08 方案第五批第 10 条）。
 *
 *   node scripts/check-manifest-colors.mjs
 *
 * 纯读文件，零点几秒，进得了 CI。
 *
 * 方案原话：「PWA manifest 色值（gen-app-icons.mjs）：theme_color/background_color 对齐 style.css
 * 现行 --bg/主色，重新生成。」
 *
 * 原先 gen-app-icons.mjs 里写死 background_color '#FAF9F5'。页面底色后来往暗黄挪了一档
 * （--bg 现在是 #F5EDDA），它没跟：装到桌面上的那一版启动画面还是旧的米白，和随后亮出来的页面
 * 对不上——屏幕上不报任何错，只是每次打开闪一下。现在那个脚本从 style.css 现读，这道门盯着
 * 「生成出来、真正发出去的那一份」：
 *
 *   ① index.html 链的那一份 manifest 找得到、读得出来；
 *   ② background_color ＝ style.css 第一个 :root（浅色那一套）的 --bg；
 *   ③ theme_color 也是 --bg，并且和 index.html 的 <meta name="theme-color"> 是同一个颜色；
 *   ④ gen-app-icons.mjs 里这两个键不再写死颜色（改了 style.css 却忘了重跑脚本，②③ 会红；
 *      有人又在脚本里写回字面量，这一条红）。
 *
 * ③ 原先量的是「theme_color ＝ --accent（主色）」。10-09 补充方案第一部分第 8 条玩家选了乙：
 * theme_color 也取底色。原先装到桌面上那一版，状态栏和任务切换器里那一条是玫红的，而浏览器里
 * 打开时 index.html 的 meta 写的是底色——同一个站两种顶条。
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── style.css 第一个 :root ─────────────────────────────────────────────────
const css = read('src/style.css');
const at = css.indexOf(':root {');
const block = at >= 0 ? css.slice(at, css.indexOf('\n}', at)) : '';
const token = (n) => (block.match(new RegExp(`^\\s*${n}:\\s*(#[0-9A-Fa-f]{6})\\s*;`, 'm')) || [])[1];
const bg = token('--bg');
const accent = token('--accent');
check('（尺子）style.css 第一个 :root 里读到了 --bg 和 --accent', Boolean(bg && accent), `--bg ${bg} · --accent ${accent}`);

// ── index.html 链的那一份 manifest ─────────────────────────────────────────
const html = read('index.html');
const href = (html.match(/<link rel="manifest" href="\/([^"]+)"/) || [])[1];
let mf = null;
try {
  mf = JSON.parse(read(`public/${href}`));
} catch {
  /* 下面那条尺子会红 */
}
check('① index.html 链的 manifest 找得到、是合法 JSON', Boolean(href && mf), href ? `public/${href}` : '没找到 <link rel="manifest">');

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
check('② background_color 是现行的底色 --bg', same(mf?.background_color, bg), `${mf?.background_color} vs ${bg}`);
const metaTheme = (html.match(/<meta name="theme-color" content="([^"]+)"/) || [])[1];
check('（尺子）index.html 里读到了 <meta name="theme-color">', Boolean(metaTheme), String(metaTheme));
check('③ theme_color 也是底色 --bg', same(mf?.theme_color, bg), `${mf?.theme_color} vs ${bg}`);
check('③ theme_color 和 index.html 的 <meta name="theme-color"> 是同一个颜色', same(mf?.theme_color, metaTheme),
  `${mf?.theme_color} vs ${metaTheme}`);
// 反向对照：原先那个主色和底色不是同一个——③ 真的分得出「取了主色」和「取了底色」
check('（反向对照）主色 --accent 和底色不一样，③ 拦得住改回主色', Boolean(accent) && !same(accent, bg), `${accent} / ${bg}`);

// ── 生成脚本不再写死 ───────────────────────────────────────────────────────
const gen = read('scripts/gen-app-icons.mjs');
const literal = gen.match(/(background_color|theme_color):\s*['"]#[0-9A-Fa-f]{3,8}['"]/g) || [];
check('④ gen-app-icons.mjs 里这两个键不写死颜色（从 style.css 现读）', literal.length === 0 && /rootTokens\(/.test(gen),
  literal.join(' / ') || '读 style.css');

// 反向对照：原先写死的那个旧底色，和现行的 --bg 不是同一个——②真的分得出新旧
check('（反向对照）旧底色 #FAF9F5 和现行 --bg 不一样，② 拦得住它', Boolean(bg) && !same('#FAF9F5', bg), String(bg));

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
