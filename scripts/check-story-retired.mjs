/**
 * 还在教旧规则的分镜动画：入口都下线了（第 14 推）。
 *
 *   node scripts/check-story-retired.mjs
 *
 * 那两段分镜（src/ui/tutorial.ts 方块、src/ui/circleTutorial.ts 小球，底下共用
 * storyTutorial.ts）比《侵蚀阶梯》早，讲的还是旧规则。方案定的是「直接下线入口，不重
 * 做」，入口有三处：
 *
 *   · 个人主页《如何滑？》那一页，五条规则上头的两颗分镜键（.tut-shape-btn）；
 *   · 小屋里答「我不会」——从前放的就是那一族的分镜，现在开规则窗；
 *   · 小红书《怎么玩》那一屏，五条上头的两颗分镜键（.howto-story，onStory）。
 *
 * 文件本身先留着（不重做，也不急着删），所以这道门量的不是「文件还在不在」，而是
 * **从入口走不走得到**：从 src/main.ts、xhs/src/main.ts 顺着 import 走一遍，分镜那三个
 * 模块一个都不许在路上。只删按钮、不断接线的话，哪天有人顺手把按钮加回来，分镜就又
 * 活了——这一条盯的是接线。
 *
 * 读源码、不打包、不开浏览器。按钮在 DOM 里还在不在，由 check-perk-pages /
 * check-back（网页）、xhs/check-story（小红书）在浏览器里量。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const rel = (p) => p.slice(ROOT.length + 1);

/** 一个模块里 import / export … from / import('…') 的相对路径。 */
function importsOf(file) {
  const src = readFileSync(file, 'utf8')
    // 注释里提到的路径不算（这个仓库的注释天天在点名文件）。
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2];
    if (spec.startsWith('.')) out.push(spec);
  }
  return out;
}

/** 相对路径落到哪个文件（.ts / /index.ts；带 ?raw、?inline 的是资源，不是模块）。 */
function resolveSpec(from, spec) {
  if (spec.includes('?')) return null;
  const base = resolve(dirname(from), spec);
  for (const cand of [base, base + '.ts', join(base, 'index.ts')]) {
    if (existsSync(cand) && cand.endsWith('.ts')) return cand;
  }
  return null;
}

/** 从入口顺着 import 走，回走得到的全部模块。 */
function reachable(entries) {
  const seen = new Set();
  const stack = entries.map((e) => join(ROOT, e));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(f)) {
      const to = resolveSpec(f, spec);
      if (to && !seen.has(to)) stack.push(to);
    }
  }
  return seen;
}

const STORY = ['src/ui/tutorial.ts', 'src/ui/circleTutorial.ts', 'src/ui/storyTutorial.ts'].map((f) => join(ROOT, f));

// 尺子：这把「顺着 import 走」的尺子真的量得到东西——从分镜自己出发，走得到它底下那一个；
// 从网页入口出发，走得到规则窗和《如何滑？》那一页。
{
  const fromStory = reachable(['src/ui/tutorial.ts']);
  check('（尺子）从方块分镜出发，走得到它底下的 storyTutorial.ts', fromStory.has(STORY[2]));
}
for (const [name, entry] of [['网页', 'src/main.ts'], ['小红书', 'xhs/src/main.ts']]) {
  const got = reachable([entry]);
  const must = name === '网页'
    ? ['src/ui/rulesModal.ts', 'src/ui/tutorialPicker.ts', 'src/ui/multiplayer.ts']
    : ['src/ui/rulesModal.ts', 'xhs/src/tutorial.ts', 'src/shapes/square.ts'];
  const missing = must.filter((f) => !got.has(join(ROOT, f)));
  check(`${name}：（尺子）走得到 ${got.size} 个模块，规则窗那几个都在路上`, got.size > 40 && missing.length === 0, missing.join(' / '));
  const hit = STORY.filter((f) => got.has(f)).map(rel);
  check(`${name}：分镜那三个模块一个都走不到`, hit.length === 0, hit.join(' / '));
}

// 按钮本身：两处的标记都不在源码里了。
{
  const picker = readFileSync(join(ROOT, 'src/ui/tutorialPicker.ts'), 'utf8');
  check('《如何滑？》那一页不再画分镜键（.tut-shape-btn / .tut-pick-shapes）',
    !/class="tut-shape-btn|class="tut-pick-shapes/.test(picker));
  const modal = readFileSync(join(ROOT, 'src/ui/rulesModal.ts'), 'utf8');
  check('《怎么玩》那一屏不再画分镜键（.howto-story），也不再收 onStory',
    !/class="howto-story/.test(modal) && !/onStory\?:/.test(modal));
  const main = readFileSync(join(ROOT, 'src/main.ts'), 'utf8');
  const learn = main.slice(main.indexOf('onLearnTutorial:'), main.indexOf('onPractice:'));
  check('小屋里答「我不会」：开的是规则窗', /openRulesModal\(/.test(learn));
  check('小屋里答「我不会」：关窗之后报「学完了」、回小屋',
    /onClose: \(\) => \{[\s\S]*setLearning\(false, seenTutorials\(\)\)[\s\S]*showMultiplayer\(\)/.test(learn));
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
