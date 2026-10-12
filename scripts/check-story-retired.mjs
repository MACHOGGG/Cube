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
 *   · 小屋里答「我还不会玩」——从前放的就是那一族的分镜，现在开规则窗（10-11 方案 C-5 起
 *     开在等待页上：轮询不停，关窗只收窗）；
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
}

/*
 * 小屋里答「我还不会玩」（10-11 方案 C-5）。从前那一扇窗由 main.ts 的 onLearnTutorial 开：小屋页先 stopAll()
 * 停掉轮询、向服务器报「我在学」把整屋的开局挂起来，关窗时 showMultiplayer() 整页重进。新流程里他坐在场边，
 * 轮询一下都不能停——sideline 靠它每次替他交「这一局不打」，不交的话 roundOver 要等他满 90 秒，等于还是整屋
 * 在等他。所以这一段量的是新那条路：开的是规则窗、开在等待页上面、不停轮询、不报「我在学」、关窗只收窗；
 * 老那条路（onLearnTutorial / onPractice / learnHeartbeat）在 main.ts 里一行代码都不剩。
 */
{
  /** 去掉注释——这个仓库的注释天天在点名「从前那条路」，不能拿它当代码量。 */
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const mp = code(readFileSync(join(ROOT, 'src/ui/multiplayer.ts'), 'utf8'));
  const between = (src, from, to) => {
    const a = src.indexOf(from);
    const b = a < 0 ? -1 : src.indexOf(to, a + from.length);
    return a < 0 || b < 0 ? '' : src.slice(a, b);
  };
  const notYet = between(mp, 'const notYet = () => {', "addEventListener('click', notYet)");
  const rules = between(mp, 'function openRoomRules(', '\n  }\n');
  check('（尺子）切得到「我还不会玩」那一下和开规则窗那一段', notYet.length > 200 && rules.length > 100,
    `${notYet.length} / ${rules.length} 字`);
  check('「我还不会玩」那颗键接的就是这一段', /#mpKnowNo'\)!?\.addEventListener\('click', notYet\)/.test(mp));
  check('小屋里答「我还不会玩」：开的是规则窗', /openRoomRules\(/.test(notYet) && /openRulesModal\(/.test(rules));
  check('规则窗开在等待页上面（top：等待页是 z-index 100 那一档）', /top: true/.test(rules));
  check('不停轮询、不报「我在学」、不走整页重进那条老路',
    !/stopAll\(|setLearning\(true|onLearnTutorial|showMultiplayer|renderLobby\(/.test(notYet + rules));
  check('记成看过、只报看过（learning: false + seen），这一局记成打过、坐到场边',
    /markTutorialSeen\(family\)/.test(notYet) && /setLearning\(false, seenTutorials\(\)\)/.test(notYet)
      && /markRoundPlayed\(state\.round\)/.test(notYet) && /bench\(/.test(notYet));
  const onClose = between(rules, 'onClose: () => {', '}');
  check('关窗只收窗（onClose 里不再报、不再重进、不走人）', onClose.length > 0 && !/\w\(/.test(onClose),
    onClose.replace(/\s+/g, ' ').trim());
  const main = code(readFileSync(join(ROOT, 'src/main.ts'), 'utf8'));
  check('main.ts 里老那条路一行代码都不剩（onLearnTutorial / onPractice / learnHeartbeat）',
    !/onLearnTutorial|onPractice|learnHeartbeat/.test(main));
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
