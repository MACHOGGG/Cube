/**
 * 全站只有一种勾（10-09 补充方案 6-5：「勾的形状 = 甲：直接用游戏里《完成》键那枚」）。
 *
 *   node scripts/check-one-check.mjs
 *
 * 纯 node，只读源码，不打包、不开浏览器（在 CI 的 check 那一条里）。帐号窗那一颗开窗时描一笔，在真浏览器
 * 里量的那一半归 check-redesign-fit。
 *
 * ── 守的是哪件事 ──────────────────────────────────────────────────────────────
 *
 * 同一个意思「好了 / 对了」，从前画成了六个样子：游戏里《完成》键那一枚、uiIcons 的 ICON_CHECK（一枚细勾，
 * 24 格）、结算页通关章里照设计图另画的一枚、规则书配图和教学分镜里得分时闪的白勾、规则书配图最后那个「完
 * 成」、小屋名单上交了卷的小勾。玩家定了只留一种：ctlIcons.ts 的 CHECK_PATH，凡是画勾的地方都取它。
 *
 * 这种事不白屏、不报错：哪天谁顺手又画一枚「差不多」的勾，屏幕上就又是两个样子。所以这道门两头都钉：
 *
 *   ① CHECK_PATH 就是《完成》键那一枚（方案原文 M29 51.5 L44 66 L72 35），只定义这一处（ui/checkMark.ts，
 *      ctlIcons.ts 原样导出）；缩到通关章的 40 格正好是方案写的 M11.6 20.6 L17.6 26.4 L28.8 14。checkMark.ts
 *      一个 import 都不许有、规则书配图和小屋名单也不许去 ctlIcons 取——check-coach、check-rule-art 拿 esbuild
 *      打包它们在 node 里跑，customIcons 的 import.meta.glob 跟进来门就跑不起来（头一版就这样）。
 *   ② 每一处画勾的都取它（点名的那七处，一处一处查）。
 *   ③ 全仓（src、xhs/src、api、scripts、index.html、public/xhs/app.js）搜不到从前那几枚的路径。
 *   ④ 描一笔的数：帐号窗那颗 dasharray 63（两笔 20.9 ＋ 41.8）、240ms、晚 150ms、减弱动态时一开始就是画好的；
 *      通关章那一枚 dasharray 26（×0.4 之后两笔 25.1，取整往上）。dasharray 比路径短，勾的末端会在描之前先
 *      露出一个小圆头。
 *
 * 每一条都带反面尺子：拿一份改坏的文字喂同一个判断，它得认得出来。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① CHECK_PATH ─────────────────────────────────────────────────────────────
const PLAN_PATH = 'M29 51.5 L44 66 L72 35';
const PLAN_40 = 'M11.6 20.6 L17.6 26.4 L28.8 14';
const mark = read('src/ui/checkMark.ts');
const ctl = read('src/ui/ctlIcons.ts');
const defs = [...mark.matchAll(/export const CHECK_PATH = '([^']+)'/g)].map((m) => m[1]);
check('① CHECK_PATH 在 checkMark.ts 里定义一次，就是《完成》键那一枚（方案原文）', defs.length === 1 && defs[0] === PLAN_PATH, defs.join(' | '));
check('① ctlIcons.ts 原样导出它（「勾在 ctlIcons 里」）', /export \{ CHECK_PATH, CHECK_TIGHT_VIEWBOX, checkPathAt \} from '\.\/checkMark';/.test(ctl));
const importsOf = (text) => [...text.matchAll(/^\s*import\b[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
check('① checkMark.ts 一个 import 都没有', !/^\s*import\b/m.test(mark), importsOf(mark).join(' '));
const heavy = ['src/ui/ruleArt.ts', 'src/ui/roomNotices.ts'].filter((f) => importsOf(read(f)).some((m) => /\/(ctlIcons|customIcons)$/.test(m) && !(f.endsWith('roomNotices.ts') && /customIcons$/.test(m))));
check('① 规则书配图不去 ctlIcons / customIcons 取勾（esbuild 打的包里不能有 import.meta.glob）；小屋名单不去 ctlIcons 取', heavy.length === 0, heavy.join(' '));
check('① （反面尺子）一份从 ctlIcons 取勾的 ruleArt，这个判断认得出来',
  importsOf(`import { CHECK_PATH } from './ctlIcons';`).some((m) => /\/(ctlIcons|customIcons)$/.test(m)));
// checkPathAt 的缩放照源码里那一句算一遍：两位小数、只缩不挪。
const scaleSrc = /CHECK_PATH\.replace\(\/\\d\+\(\?:\\\.\\d\+\)\?\/g, \(n\) => String\(Math\.round\(Number\(n\) \* k \* 100\) \/ 100\)\)/;
check('① checkPathAt 是「每个数 × k、留两位小数」那一种缩放', scaleSrc.test(mark));
const scale = (d, k) => d.replace(/\d+(?:\.\d+)?/g, (n) => String(Math.round(Number(n) * k * 100) / 100));
check('① 缩到 40 格（×0.4）正好是方案写的那一串', scale(defs[0] || '', 0.4) === PLAN_40, scale(defs[0] || '', 0.4));
check('① （反面尺子）换一枚别的勾，缩出来就对不上', scale('M29 52 L44 66 L72 36', 0.4) !== PLAN_40);
const otherDefs = [];
for (const f of ['src/ui/ctlIcons.ts', 'src/ui/uiIcons.ts', 'src/ui/roomNotices.ts', 'src/ui/ruleArt.ts', 'src/ui/storyTutorial.ts', 'src/engine/gameController.ts', 'src/ui/subscribe.ts'])
  if (/CHECK_PATH\s*=/.test(read(f))) otherDefs.push(f);
check('① 别的文件不另定义一份 CHECK_PATH（只 import）', otherDefs.length === 0, otherDefs.join(' '));

// ── ② 每一处画勾的都取它 ──────────────────────────────────────────────────────
const SITES = [
  ['游戏里《完成》键 CTL_FINISH（ctlIcons.ts）', 'src/ui/ctlIcons.ts', /export const CTL_FINISH = custom\('ctl-finish'\) \?\? ctlGlyph\(\s*`<path class="ctl-check" d="\$\{CHECK_PATH\}"/],
  ['帐号窗《完成》用的就是 CTL_FINISH（subscribe.ts）', 'src/ui/subscribe.ts', /pillIcon\('statusDone', s\.doneBtn, CTL_FINISH\)/],
  ['改昵称保存键 ICON_CHECK：100 格、线宽 8.3（uiIcons.ts）', 'src/ui/uiIcons.ts', /export const ICON_CHECK =\s*'<svg viewBox="0 0 100 100"[^']*stroke-width="8\.3"[^;]*`<path d="\$\{CHECK_PATH\}"\/><\/svg>`;/],
  ['结算页通关章：checkPathAt(0.4)（gameController.ts）', 'src/engine/gameController.ts', /`<path class="end-stamp-tick" d="\$\{checkPathAt\(0\.4\)\}"/],
  ['小屋交卷的小勾 TICK（roomNotices.ts）', 'src/ui/roomNotices.ts', /export const TICK = `<svg viewBox="\$\{CHECK_TIGHT_VIEWBOX\}"[^`]*<path d="\$\{CHECK_PATH\}"/],
  ['规则书配图里得分时闪的白勾（ruleArt.ts）', 'src/ui/ruleArt.ts', /class="ra-check"[^`]*viewBox="\$\{CHECK_TIGHT_VIEWBOX\}"[\s\S]{0,80}<path d="\$\{CHECK_PATH\}"/],
  ['规则书配图最后那个「完成」（ruleArt.ts）', 'src/ui/ruleArt.ts', /class="ra-end"[\s\S]{0,160}<path d="\$\{CHECK_PATH\}"/],
  ['教学分镜里得分时闪的勾（storyTutorial.ts）', 'src/ui/storyTutorial.ts', /const CHECK_SVG = \(color: string\) =>\s*`<svg viewBox="\$\{CHECK_TIGHT_VIEWBOX\}"><path d="\$\{CHECK_PATH\}"/],
];
for (const [name, file, re] of SITES) check(`② ${name}`, re.test(read(file)));
check('② （反面尺子）从前那一版 ICON_CHECK 过不了这一条',
  !SITES[2][2].test(`export const ICON_CHECK = svg24('<path d="M5 12.5l4.5 4.5L19 7.5"/>');`));
check('② 帐号窗《完成》不再用线描的 ICON_CHECK', !/statusDone[^\n]*ICON_CHECK/.test(read('src/ui/subscribe.ts')));

// ── ③ 全仓搜不到从前那几枚 ────────────────────────────────────────────────────
// 这几串是从前的路径——门自己的文件不扫（不然它永远在这儿找到自己）。
const OLD = [
  'M5 12.5l4.5 4.5L19 7.5', // uiIcons 的 ICON_CHECK
  'M11.3 18.2 L16.6 25.6 L28.6 12.6', // 通关章照设计图另画的那一枚
  'M3 8.6 6.2 12 13 4.6', // 小屋交卷的小勾
  'M12 32 L26 47 L50 12', // 规则书配图、教学分镜里的白勾
  'M29 52 L44 66 L72 36', // 规则书配图最后那个「完成」
];
const SCAN_DIRS = ['src', 'xhs/src', 'api', 'scripts'];
const SCAN_FILES = ['index.html', 'public/xhs/app.js', 'xhs/index.html'];
const TEXT = /\.(ts|js|mjs|css|html|svg|json)$/;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel);
    else if (TEXT.test(name)) files.push(rel);
  }
};
for (const d of SCAN_DIRS) walk(d);
for (const f of SCAN_FILES) {
  try {
    statSync(join(ROOT, f));
    files.push(f);
  } catch {}
}
const found = (text) => OLD.filter((p) => text.includes(p));
const leftovers = [];
for (const f of files) {
  if (join(ROOT, f) === SELF) continue;
  for (const p of found(read(f))) leftovers.push(`${relative(ROOT, join(ROOT, f))}: ${p}`);
}
check(`③ 全仓（${files.length} 个文件）搜不到从前那几枚勾`, leftovers.length === 0, leftovers.join(' | '));
check('③ （尺子）扫到了该扫的地方：checkMark、ctlIcons、gameController、小红书的包都在扫的名单里',
  ['src/ui/checkMark.ts', 'src/ui/ctlIcons.ts', 'src/engine/gameController.ts', 'public/xhs/app.js'].every((f) => files.includes(f)));
check('③ （反面尺子）一段带着旧勾的文字，这个判断认得出来', found('<path d="M11.3 18.2 L16.6 25.6 L28.6 12.6"/>').length === 1);
check('③ 小红书的包里是新的那一枚（重出过，不是旧包）', read('public/xhs/app.js').includes(PLAN_PATH));

// ── ④ 描一笔的数 ─────────────────────────────────────────────────────────────
const css = read('src/style.css');
const rule = (sel) => {
  const i = css.indexOf(sel + ' {');
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};
const draw = rule('.acct-done .ctl-check');
check('④ 帐号窗《完成》那枚勾：dasharray 63、dashoffset 63（两笔 20.9 ＋ 41.8，描之前一点都看不见）',
  /stroke-dasharray: 63;/.test(draw) && /stroke-dashoffset: 63;/.test(draw), draw.replace(/\s+/g, ' '));
check('④ 描一笔：240ms、和通关章同一条曲线、晚 150ms 起笔',
  /transition: stroke-dashoffset 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\) 150ms;/.test(draw));
check('④ 加上 is-drawn 就描到 0', /\.acct-done \.pill-icon\.is-drawn \.ctl-check \{ stroke-dashoffset: 0; \}/.test(css));
check('④ 减弱动态时不描：一开始就是画好的样子',
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.acct-done \.ctl-check \{ stroke-dashoffset: 0; transition: none; \}/.test(css));
// 凡是选到 .ctl-check 的选择器，都得在 .acct-done 底下（同一枚勾在游戏《完成》键、改昵称保存键上不描）。
const selectorsOf = (text) => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
const strayDraw = (text) => selectorsOf(text).filter((sel) => sel.includes('.ctl-check') && !/^\.acct-done\b/.test(sel));
check('④ 只有帐号窗这一颗描：选到 .ctl-check 的规则都挂在 .acct-done 底下', strayDraw(css).length === 0, strayDraw(css).join(' | '));
check('④ （反面尺子）一条挂在游戏《完成》键上的描画规则，这个判断认得出来',
  strayDraw('.app--game .controls .ctl-check { stroke-dasharray: 63; }').length === 1);
const tick = rule('.end-stamp-tick');
check('④ 通关章那一枚：dasharray / dashoffset 26（×0.4 之后两笔 25.1，取整往上）',
  /stroke-dasharray: 26;/.test(tick) && /stroke-dashoffset: 26;/.test(tick), tick.replace(/\s+/g, ' '));
// 尺子：上面那两个数确实比路径长、而且长得不多（多出一整笔就成了「描完还要等一截」）。
const len = (d) => {
  const pts = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
};
const L100 = len(PLAN_PATH);
const L40 = len(PLAN_40);
check('④ （尺子）63 和 26 都比路径长、多出不到 1', L100 < 63 && 63 - L100 < 1 && L40 < 26 && 26 - L40 < 1, `100 格 ${L100.toFixed(2)} / 40 格 ${L40.toFixed(2)}`);

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
