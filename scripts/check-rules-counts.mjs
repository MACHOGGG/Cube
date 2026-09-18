/**
 * 《游戏规则》里写的枚数，要和棋盘真的有几枚一致。
 *
 *   node scripts/check-rules-counts.mjs
 *
 * 起因是一次真事故：src/rules.ts 里「三角」和「大三角」两条的 body 整段挂反
 * 了，四种语言全错，而且错了不止枚数——「25 枚拼成一个实心大三角」那句被贴到
 * 了 54 枚那副盘上，形状也不对（那副的 ROW_LENS 是 7-9-11-11-9-7，上下对称，
 * 轮廓是六边形）。这种错不会崩、不会红，只会让每个点开《怎么玩》的玩家读到
 * 假话，而人工巡检看一百遍也容易放过去。
 *
 * **这道门必须自己解开那个陷阱**（CLAUDE.md《家族按 id 前缀认，但有一个陷阱》）：
 * 两个三角文件在 2026-09 对调过内容，所以 main.ts 里是
 *   const triangleGame     = createTriangleBigGame();   // 菜单「三角」  ← triangleBig.ts
 *   const triangleBigGame  = createTriangleGame();      // 菜单「大三角」← triangle.ts
 * 照文件名推断会正好推反，所以下面从 main.ts 现读这层映射，不写死。
 *
 * 只量声明了 ROW_LENS 的那几副（三角两副、六边小球、进阶三角）——方块和小球是
 * 规则的网格，不走 ROW_LENS。量不到的那几副会打印出来，不假装查过。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ── 菜单 id → 实现文件（从 main.ts 现读，别信文件名）────────────────────
const main = read('src/main.ts');
const FACTORY_FILE = {};           // createXGame → 文件名
for (const m of main.matchAll(/import \{ (create\w+Game) \} from '\.\/shapes\/(\w+)'/g)) {
  FACTORY_FILE[m[1]] = m[2];
}
const ID_FILE = {};                // 菜单 id → 文件名
for (const m of main.matchAll(/const (\w+)Game = (create\w+Game)\(\)/g)) {
  const file = FACTORY_FILE[m[2]];
  if (file) ID_FILE[m[1]] = file;
}
check('从 main.ts 读出了菜单 id 到实现文件的映射', Object.keys(ID_FILE).length >= 6,
  JSON.stringify(ID_FILE));
check('那个对调的陷阱还在（菜单「三角」跑的是 triangleBig.ts）',
  ID_FILE.triangle === 'triangleBig' && ID_FILE.triangleBig === 'triangle',
  `triangle→${ID_FILE.triangle} / triangleBig→${ID_FILE.triangleBig}`);

// ── 文件 → 枚数（ROW_LENS 求和）──────────────────────────────────────
const countOf = (file) => {
  const m = read(`src/shapes/${file}.ts`).match(/const ROW_LENS = \[([^\]]*)\]/);
  if (!m) return null;
  return m[1].split(',').map((x) => Number(x.trim())).reduce((a, b) => a + b, 0);
};

// ── 菜单 id → 《游戏规则》里那一条的 term ─────────────────────────────
//
// 这张表只能手写，不能从 i18n 的 shapeName* 推：《游戏规则》用的是自己一套措
// 辞（英文是复数，而且圆球那几副叫 balls 不叫 Circle），和主菜单上的卡片名从
// 来就不是同一句。所以表写在这儿，而下面那条「表里的 term 必须找得到」是这张
// 表的保险——哪天谁改了措辞，这道门会红，而不是悄悄跳过不查。
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
const TERMS = {
  triangle:      { zhHans: '三角',     zhHant: '三角',     en: 'Triangles',        fr: 'Triangles' },
  triangleBig:   { zhHans: '大三角',   zhHant: '大三角',   en: 'Big triangle',     fr: 'Grand triangle' },
  circleHex:     { zhHans: '六边圆球', zhHant: '六邊圓球', en: 'Hex balls',        fr: 'Billes hexagonales' },
  triangleAdvanced: { zhHans: '进阶三角', zhHant: '進階三角', en: 'Advanced triangle', fr: 'Triangle avancé' },
};

const rules = read('src/rules.ts');
/** 一条 body 里第一个数字——就是枚数那个。 */
const firstNum = (body) => {
  const m = body.match(/(\d+)/);
  return m ? Number(m[1]) : null;
};
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let measured = 0;
const skipped = [];
for (const [id, file] of Object.entries(ID_FILE)) {
  const want = countOf(file);
  if (want === null) { skipped.push(`${id}(${file})`); continue; }
  const terms = TERMS[id];
  if (!terms) { skipped.push(`${id}(表里没列)`); continue; }
  for (const lang of LANGS) {
    const name = terms[lang];
    const hit = rules.match(new RegExp(`\\{ term: '${esc(name)}', body: '([^']*)'`));
    if (!hit) {
      check(`${lang} 的《${name}》在 rules.ts 里找得到`, false, '措辞改过？改了就把这张表跟上');
      continue;
    }
    const got = firstNum(hit[1]);
    check(`${lang} 《${name}》写的枚数 = 棋盘真的枚数`, got === want,
      `写 ${got} / 真 ${want}（${file}）`);
    measured++;
  }
}
console.log(`\n量到 ${measured} 条；ROW_LENS 量不到、没查的：${skipped.join(' ') || '（无）'}`);
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
