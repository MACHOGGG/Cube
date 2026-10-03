/**
 * SVG 里的 `<title>` 嵌进页面之前去掉（第 14 推）。
 *
 *   npx esbuild src/ui/svgTitle.ts --bundle --format=esm --outfile=/tmp/svgtitle.mjs
 *   node scripts/check-svg-title.mjs /tmp/svgtitle.mjs
 *
 * 设计软件导出的 SVG 几乎个个带一行 `<title>编组</title>`。嵌进页面以后它就是悬停提示：鼠标
 * 停在图标上冒一个「编组」，读屏也念「编组」。第 17 推手工删过一轮，下一个导出的文件照样会
 * 带进来——所以改成在嵌进页面的那一处统一去掉（svgTitle.ts），图标和天才标志两条路都走它。
 *
 *   ① 玩家给的炸弹图标原件（带着那一行）：去掉 `<title>`，别的一个字节都不动。
 *   ② 导出文件里见过的几种写法都去得掉，名字里碰巧带 title 的东西不误伤。
 *   ③ 两条路都接上了：customIcons.ts 的 trim()、geniusLogo.ts 嵌进页面的那两处。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-svg-title.mjs <打包好的 svgTitle.mjs>');
  process.exit(2);
}
const { stripSvgTitle } = await import(src);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① 玩家给的那颗炸弹图标，原样 ───────────────────────────────────
const BOMB = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="121px" height="122px" viewBox="0 0 121 122" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <title>编组</title>
    <g id="其他develop？" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="画框-5" transform="translate(-30353, -5292)">
            <g id="编组" transform="translate(30353.0061, 5292.5)">
                <rect id="矩形-3" fill="color(display-p3 0.690 0.290 0.161)" x="0" y="0" width="121" height="121" rx="22"></rect>
                <polygon id="星形" fill="color(display-p3 1.000 1.000 1.000)" points="50.6149176 62.5914782 5.71301566 84.7709299 43.837272 55.8194913 13.9516849 35.3159687 50.6149176 42.2661279 58.8045727 4.7511217 66.9764346 46.0828875 103.65746 35.3159687 76.4480643 53.319544 118.024397 62.5914782 79.0742123 60.2434447 103.65746 84.7709299 65.2998164 73.4344024 54.6852381 115.735768"></polygon>
            </g>
        </g>
    </g>
</svg>`;
{
  check('① （尺子）原件里真的有那一行 <title>编组</title>', BOMB.includes('<title>编组</title>'));
  const out = stripSvgTitle(BOMB);
  check('① 去掉之后一个 <title 都不剩', !/<title/i.test(out));
  check('① 别的一个字节都没动（只少了那一行）', out === BOMB.replace('<title>编组</title>', ''), `${BOMB.length} → ${out.length}`);
  check('① 画的东西都在：底板、星形、id="编组" 那一组', out.includes('<rect id="矩形-3"') && out.includes('<polygon id="星形"') && out.includes('<g id="编组"'));
}

// ── ② 几种写法 ──────────────────────────────────────────────────────
{
  const cases = [
    ['带属性的', '<svg><title id="t1" lang="zh">编组</title><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['大写的', '<svg><TITLE>Group</TITLE><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['自闭合的', '<svg><title/><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['跨行的', '<svg><title>\n  编组\n</title ><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>'],
    ['每一组各带一行的（Sketch 有时这样导）', '<svg><title>a</title><g><title>b</title><circle r="1"/></g></svg>', '<svg><g><circle r="1"/></g></svg>'],
  ];
  for (const [name, input, want] of cases) {
    const got = stripSvgTitle(input);
    check(`② ${name}：去得掉`, got === want, got);
  }
  // 不误伤：名字里带 title 的 id、<text> 里写着 title、<titlebar> 这种别的标签。
  const keep = '<svg><g id="title-bar"><text>title</text><titlebar>x</titlebar></g></svg>';
  check('② 名字里碰巧带 title 的东西一个不动', stripSvgTitle(keep) === keep, stripSvgTitle(keep));
  // 两行 <title> 之间隔着图形：不许一口气吞到第二行的 </title>（不贪婪）。
  const two = '<svg><title>a</title><rect width="1"/><title>b</title></svg>';
  check('② 不贪婪：两行中间那块图形留着', stripSvgTitle(two) === '<svg><rect width="1"/></svg>', stripSvgTitle(two));
}

// ── ③ 两条路都接上了 ────────────────────────────────────────────────
{
  const ci = readFileSync(join(ROOT, 'src/ui/customIcons.ts'), 'utf8');
  const trimBody = ci.match(/function trim\(svg: string\): string \{([\s\S]*?)\n\}/);
  check('③ （尺子）customIcons.ts 里找得到 trim()', Boolean(trimBody));
  check('③ trim() 先过 stripSvgTitle', Boolean(trimBody) && /return stripSvgTitle\(svg\)/.test(trimBody[1]));
  check('③ custom() 里每个文件都过 trim()', /sRGBOnly\(unsize\(trim\(raw\)\)\)/.test(ci));

  const gl = readFileSync(join(ROOT, 'src/ui/geniusLogo.ts'), 'utf8');
  check('③ 天才标志：嵌进页面的是去过 <title> 的那一份', /const LOGO = stripSvgTitle\(GENIUS_LOGO\);/.test(gl));
  const raw = (gl.match(/>\$\{GENIUS_LOGO\}</g) ?? []).length;
  const clean = (gl.match(/>\$\{LOGO\}</g) ?? []).length;
  check('③ 天才标志：两处嵌进页面的模板都用 LOGO，没有一处直接嵌原件', raw === 0 && clean === 2, `原件 ${raw} 处 / 去过的 ${clean} 处`);
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
