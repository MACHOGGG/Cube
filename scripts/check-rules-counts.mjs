/**
 * 《游戏规则》（src/rules.ts）写的东西，要和引擎真的在做的事一致。
 *
 * 两件事：**枚数**对不对得上棋盘，**通用那五条**有没有跟着规则改。
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
 *   const triangleBigGame = createTriangleGame();      // 菜单「大三角」← triangle.ts
 * 照文件名推断会正好推反（文件叫 triangle.ts，菜单上的名字是《大三角》，card id 是
 * `triangleBig`），所以下面从 main.ts 现读这层映射，不写死。
 *
 * 另外两副三角 2026-09 删了（《侵蚀阶梯》v1.2 PR-6：原《三角》id `triangle`，代码在
 * triangleBig.ts；V 形 `triangleAdvanced`），所以「对调」现在只剩半边——下面那一条
 * 断言跟着改成「留下的这一副的名实仍然是交叉的」。
 *
 * 只量声明了 ROW_LENS 的那几副（六边三角、六边小球）——方块和小球是规则的网格，不走
 * ROW_LENS。量不到的那几副会打印出来，不假装查过。
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
// 名实交叉的那一半还在：card id `triangleBig`（菜单上的《大三角》，六边蜂窝 54）跑
// 的是 shapes/triangle.ts。下面按文件名查 ROW_LENS，查错文件就会去核错一副棋盘的枚数
// ——那正是这道门当年逮到的事故。
check('留下的那一副三角，名实仍然是交叉的（id triangleBig ← triangle.ts）',
  ID_FILE.triangleBig === 'triangle',
  `triangleBig→${ID_FILE.triangleBig}`);
// 删掉的那两副不许回来（和 check-shape-registry 那一条对照着看）。
check('删掉的那两副三角不在 main.ts 的清单里',
  ID_FILE.triangle === undefined && ID_FILE.triangleAdvanced === undefined,
  `triangle→${ID_FILE.triangle} / triangleAdvanced→${ID_FILE.triangleAdvanced}`);

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
  triangleBig:   { zhHans: '大三角',   zhHant: '大三角',   en: 'Big triangle',     fr: 'Grand triangle' },
  circleHex:     { zhHans: '六边圆球', zhHant: '六邊圓球', en: 'Hex balls',        fr: 'Billes hexagonales' },
};
// 删掉的那两副（原《三角》id `triangle`、V 形 `triangleAdvanced`）从表里也撤了：
// 上面那条断言已经钉住「它们不在 main.ts 的清单里」，这张表再留着两行，读的人会
// 以为《游戏规则》里还该有那两条。

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

// ── 通用那五条：规则改了，这本书得跟着改 ──────────────────────────────
//
// 这一节量的不是枚数，是**这本书还在不在讲现在这套规则**。
//
// 它守的是一次真事故的形状：《侵蚀阶梯》v1.2 把计分整套换掉（1×N 图案会一路变小、
// 每翻一枚 +2、综合分只剩步数系数一个乘数），而 rules.ts 里整本还写着上一套——连击
// 倍率、时间系数、2×2 块状图案、0.95^未翻面。那些字不会崩、不会红，只会让每个点开
// 《游戏规则》的玩家读到假话，而支付审核把「网站陈述与实际不符」直接归为 false
// information。四种语言一起量：上一次挂反的那回，也是四种语言全错。
//
// 正反两把尺子都要：只禁退役的词，把整段删空也能过；只查新词在不在，旧词留在旁边
// 照样过。
const BLOCK = (lang) => {
  const i = rules.indexOf(`\n  ${lang}: {`);
  if (i < 0) return '';
  const j = rules.indexOf('\n  },', i);
  return rules.slice(i, j < 0 ? rules.length : j);
};
/** 一段语言块里 general/modes 各有几条。 */
const countItems = (block, key) => {
  const i = block.indexOf(`${key}: [`);
  if (i < 0) return -1;
  const j = block.indexOf('\n    ],', i);
  return (block.slice(i, j).match(/\{ term: /g) || []).length;
};
const generalOf = (block) => {
  const i = block.indexOf('general: [');
  const j = block.indexOf('\n    ],', i);
  return i < 0 ? '' : block.slice(i, j);
};

// 退役的说法，一个都不许留在通用那五条里。('有效得分率' 不在其中——步步为营那一
// 档的公式里它还真在用，只是不在通用规则里了，所以只禁 general 段。)
const GONE = {
  zhHans: ['连击', '时间系数', '0.95', '2×2', '整组都是星星'],
  zhHant: ['連擊', '時間係數', '0.95', '2×2', '整組都是星星'],
  en: ['Streak', 'time factor', '0.95', '2×2', 'made only of stars'],
  fr: ['Série', 'facteur temps', '0,95', '2×2', 'entièrement fait d'],
};
// 现在这套规则的三件事：每枚 +2、图案一路降到 1、综合分那唯一一个乘数。
const MUST = {
  zhHans: ['2 分', '4 → 3 → 2 → 1', '步数系数'],
  zhHant: ['2 分', '4 → 3 → 2 → 1', '步數係數'],
  en: ['2 points', '4 → 3 → 2 → 1', 'move factor'],
  fr: ['2 points', '4 → 3 → 2 → 1', 'facteur de coups'],
};
const counts = {};
for (const lang of LANGS) {
  const block = BLOCK(lang);
  check(`${lang}：读得到这一段`, block.length > 200, `${block.length} 字符`);
  const g = countItems(block, 'general');
  const m = countItems(block, 'modes');
  counts[lang] = { g, m };
  check(`${lang}：通用规则正好五条`, g === 5, `${g} 条`);
  const gen = generalOf(block);
  const left = GONE[lang].filter((w) => gen.includes(w));
  check(`${lang}：通用五条里没有退役的说法`, left.length === 0, left.join(' / ') || '干净');
  const missing = MUST[lang].filter((w) => !gen.includes(w));
  check(`${lang}：通用五条讲到了现在这套的三件事`, missing.length === 0, missing.join(' / ') || '都讲到了');
}
// 四种语言条数一致——少译一条是这本书的老毛病，而少的那一条屏幕上只是「短一截」。
const gs = LANGS.map((l) => counts[l].g).join(',');
const ms = LANGS.map((l) => counts[l].m).join(',');
check('四种语言条数一致（通用）', new Set(LANGS.map((l) => counts[l].g)).size === 1, gs);
check('四种语言条数一致（各玩法）', new Set(LANGS.map((l) => counts[l].m)).size === 1, ms);

// ── 每一个玩法都得在书里有一条（四种语言都要）──────────────────────────
//
// **上面那条「四种语言条数一致」拦不住少一个玩法**：四种语言一起少，它照样绿。
// 这不是假想——《侵蚀阶梯》v1.2 那一轮整本重写，老虎机那一条四种语言一起漏掉了，
// 一直到玩家问起来才发现。「一致」只说明四个译本互相对得上，不说明它们对得上游戏。
//
// 所以这儿钉住**名单**，不只是数目。表只能手写（这本书的措辞和主菜单上的卡片名从
// 来不是同一句，见上面 TERMS 那段的理由）；加一个玩法就得回来加一行，而这正是要
// 的效果——门会说出缺的是哪一个，而不是悄悄放过。
const MODE_TERMS = [
  ['方块', '方塊', 'Squares', 'Carrés'],
  ['菱形方块', '菱形方塊', 'Diamond squares', 'Carrés en losange'],
  ['圆球', '圓球', 'Balls', 'Billes'],
  ['六边圆球', '六邊圓球', 'Hex balls', 'Billes hexagonales'],
  ['七色圆球', '七色圓球', 'Seven-colour balls', 'Billes sept couleurs'],
  ['大三角', '大三角', 'Big triangle', 'Grand triangle'],
  ['炸弹玩法', '炸彈玩法', 'Bomb modes', 'Modes bombe'],
  ['计时挑战', '計時挑戰', 'Timed modes', 'Modes chronométrés'],
  ['老虎机模式', '老虎機模式', 'Slot machine mode', 'Mode machine à sous'],
  ['无限反转', '無限反轉', 'Endless flip', 'Retournement infini'],
  ['真正解密 · 步步为营', '真正解密 · 步步為營', 'Puzzle · Step by step', 'Énigme · Pas à pas'],
];
{
  const hasTerm = (block, name) => block.includes(`{ term: '${name}',`);
  const missing = [];
  for (const row of MODE_TERMS) {
    LANGS.forEach((lang, i) => {
      if (!hasTerm(BLOCK(lang), row[i])) missing.push(`${lang}:${row[i]}`);
    });
  }
  check('每个玩法在四种语言里都有一条', missing.length === 0, missing.join(' ') || `${MODE_TERMS.length} 个玩法 × 4 语`);
  // 名单的长度要和真的条数对得上：表里少列一个，上面那一条照样全绿。
  check('这张表列全了（条数 = 表的行数）',
    LANGS.every((l) => counts[l].m === MODE_TERMS.length),
    `书里 ${ms} / 表里 ${MODE_TERMS.length}`);
  // 尺子：一个不存在的名字必须查不到，不然上面两条是空的。
  check('（尺子）书里没有的名字查不到', !hasTerm(BLOCK('zhHans'), '老虎机模式（不存在）'));
}

// ── 这本书是直接塞进 innerHTML 的，所以正文里不能有标记 ─────────────────
//
// ui/accountPage.ts 的 openRules 把 body 原样拼进 innerHTML，没有 Markdown、也没有
// 转义。写一个 ** 想加粗，屏幕上就是两个星号；写一个 < 会当标签吃掉后面一截。
// 这一版写初稿时真的用 ** 圈了几个重点，截图之前没人看得出来。
{
  const bodies = [...rules.matchAll(/body: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  check('读得到每一条的正文（下面两条才有意义）', bodies.length >= 50, `${bodies.length} 条`);
  const marked = bodies.filter((b) => b.includes('**'));
  check('正文里没有 Markdown 的 **（渲染器不认，屏幕上就是两个星号）', marked.length === 0,
    marked.map((b) => b.slice(0, 20)).join(' / ') || '干净');
  const tagged = bodies.filter((b) => /[<>]/.test(b));
  check('正文里没有尖括号（直接进 innerHTML，会被当标签）', tagged.length === 0,
    tagged.map((b) => b.slice(0, 20)).join(' / ') || '干净');
}

// ── i18n 那一头：退役的说法不许留着，也不许回来 ────────────────────────
//
// rules.ts 干净了，界面上照样可能挂着上一套的字。两条：
//
// ① 五个退役的键不许回来。它们描述的东西这一版里不存在了（2×2 / 1-2-1 / 大三角那
//    三种块状图案、HUD 上的《行动有效率》），可四种语言都是现成的，下一个人拿
//    labelBlock22 去标一个凑不出来的图案时，看着完全像是对的。
// ② 小屋里那句 flipScoringHint。它从前写着「连击加成减弱 · 没有时间奖励」——这一版
//    连击整个没有了，时间奖励**谁都没有**，说一个别人有、你没有的东西比不说更糟。
const i18n = read('src/i18n.ts');
const DEAD_KEYS = ['labelRun4', 'labelBlock22', 'label121', 'labelBigTriangle', 'perfLabel'];
// 只认**真的声明或读取**，不认注释里提到的名字：i18n.ts 里正写着一段注释解释这
// 五个为什么删了（「下一个人会拿 labelBlock22 去标一个凑不出来的图案」）。按
// \bkey\b 去找，那段注释自己就会把门顶红——一条一上来就红的门，最后一定会被人
// 加 continue-on-error。
const declaredOrUsed = (src, k) =>
  new RegExp(`^[ \\t]*${k}\\??:`, 'm').test(src) || new RegExp(`\\.${k}\\b`).test(src);
const back = DEAD_KEYS.filter((k) => declaredOrUsed(i18n, k));
check('退役的五个 i18n 键没回来', back.length === 0, back.join(' / ') || '干净');
// 非空的尺子：拿一个还在用的键验一下，证明上面那个匹配器认得出「用着的键」。
check('（尺子）还在用的那个键查得到', declaredOrUsed(i18n, 'labelRunN'), 'labelRunN');
// 反过来的尺子：注释里提到的名字不算数——这正是上一行差点误伤的那件事。
check('（尺子）注释里提到不算「回来了」', !declaredOrUsed('// 拿 labelBlock22 去标\n', 'labelBlock22'));

const hints = [...i18n.matchAll(/flipScoringHint: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
check('flipScoringHint 四种语言都在', hints.length === 4, `${hints.length} 条`);
const STALE = /连击|連擊|Streak|streak|时间|時間|time bonus|bonus de temps|série/;
const bad = hints.filter((h) => STALE.test(h));
check('flipScoringHint 不再讲连击和时间奖励', bad.length === 0, bad.join(' / ') || '干净');

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
