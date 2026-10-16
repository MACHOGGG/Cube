/**
 * 法文标点前后的空格要是不换行空格 U+00A0（10-15 补充 S6，L-10 ④）。
 *
 *   node scripts/check-fr-spacing.mjs
 *
 * 法文排版：`:` `;` `?` `!` `»` 前面、`«` 后面各空一格（Imprimerie nationale 规定 `; ? !` 前是窄不换行空格，用
 * U+00A0 代替是通行做法）。原先这些地方写的是普通空格：实测（Chromium、仓库里的 Karla 字体、16px、宽度 60–600 逐像素）
 * `: ; ? ! »` 分别在 8、8、11、9、13 个宽度上被甩到下一行行首，`«` 在 88 个宽度上被留在行尾——一行字以「? 」开头，
 * 是法文读者一眼就看出来的排错。U+00A0 时 0 次；自带三支字体都有这个字形，宽度和普通空格一样。
 *
 * 不在出口统一处理：代码里没有统一的 t()，读文案是八十多处直接 `STRINGS[lang]`，规则书、法务、MODE_TIPS、TUTORIAL_*、
 * build-legal 各走各的路。所以就在底稿里写对，这道门量底稿。
 *
 * 量的是：esbuild 打包 src/i18n.ts、src/rules.ts、src/legal.ts、src/changelog.ts，把每个导出里**键叫 fr 的那一支**下面
 * 所有字符串挑出来（法务那张表是 LEGAL.fr，规则书是 RULES.fr，界面是 STRINGS.fr，MODE_TIPS 这种是更深一层的 fr），
 * 不许出现 `/ [:;?!»]|« /`。尺子：挑出来的法文字符串 > 400 条；反面尺子：这个正则抓得到 'Partir ?'、'« Sans'，放过
 * 'Partir ?'。
 *
 * 法务那一半（legal.ts 95 处）在 10-14 方案 P3 那一推改完（S6 那一推先改了界面和规则书，法务暂时只报数）。
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const BAD = / [:;?!»]|« /;
const load = async (rel) => {
  const out = await build({
    entryPoints: [fileURLToPath(new URL('../' + rel, import.meta.url))],
    bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'error',
    loader: { '.svg': 'text', '.css': 'text', '.png': 'dataurl' },
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};

/** 挑出某个值底下所有键叫 fr 的那一支里的字符串。路径一并带上，红的时候好找。 */
function frStrings(value, path, inFr, out, seen) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [k, v] of Object.entries(value)) frStrings(v, `${path}.${k}`, inFr || k === 'fr', out, seen);
  } else if (typeof value === 'string' && inFr) {
    out.push([path, value]);
  }
}

const FILES = ['src/i18n.ts', 'src/rules.ts', 'src/legal.ts', 'src/changelog.ts'];
const all = [];
for (const file of FILES) {
  const mod = await load(file);
  const got = [];
  for (const [name, v] of Object.entries(mod)) frStrings(v, `${file}:${name}`, false, got, new Set());
  all.push(...got.map(([p, s]) => ({ file, path: p, s })));
}

check('（尺子）挑出来的法文字符串 > 400 条', all.length > 400, `${all.length} 条（${FILES.map((f) => `${f.split('/').pop()} ${all.filter((x) => x.file === f).length}`).join('、')}）`);
check('（尺子）界面、规则书、法务三张表都挑到了',
  ['src/i18n.ts', 'src/rules.ts', 'src/legal.ts'].every((f) => all.some((x) => x.file === f)));

const hits = all.filter((x) => BAD.test(x.s));
const show = (list) => list.slice(0, 6).map((x) => `${x.path}「${x.s.slice(Math.max(0, x.s.search(BAD) - 12), x.s.search(BAD) + 6)}」`).join(' · ');
for (const file of FILES) {
  const mine = hits.filter((x) => x.file === file);
  check(`${file}：法文标点前后没有普通空格（要 U+00A0）`, mine.length === 0, mine.length ? `${mine.length} 条：${show(mine)}` : '干净');
}

// 反面尺子：同一个正则，该抓的抓得到、该放的放过
check('（反面尺子）抓得到「Partir ?」「« Sans」，放过「Partir\\u00a0?」「«\\u00a0Sans»」',
  BAD.test('Partir ?') && BAD.test('« Sans') && !BAD.test('Partir ?') && !BAD.test('« Sans »'));

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
