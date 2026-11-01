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
// 10-09 补充方案第一部分第 5 条起，《游戏规则》里每副棋盘那一条的 term 就是主菜单卡名
// （ui/menuTags.ts），一字不差——那件事由文件末尾第 ⑤ 节钉着。这张表仍然手写一份、不现读
// menuTags：这一节量的是「枚数」，名字查不到就报「措辞改过？」，比跟着一起变更容易看出是哪
// 一头动了。
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
const TERMS = {
  triangleBig:   { zhHans: '六边形三角', zhHant: '六邊形三角', en: 'Hex Triangles', fr: 'Triangles hexagone' },
  circleHex:     { zhHans: '六边形小球', zhHant: '六邊形小球', en: 'Hex Balls',     fr: 'Billes hexagone' },
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
  zhHans: ['连击', '时间系数', '0.95', '2×2', '整组都是星星', '天才特供'],
  zhHant: ['連擊', '時間係數', '0.95', '2×2', '整組都是星星', '天才特供'],
  // 规则书里的名字和界面对齐（10-09 补充方案 7-11）：move factor / shape points / Swept badge 是规则书自己起的
  // 名字，界面上叫 Move multiplier / Build score / Board cleared；法文 facteur de coups / Plateau net 同理。
  // 「made only of stars」原先整句禁（退役的那条「整组都是星星的图案」）。推14 Z-B12 起《消除》那一条（附录甲 §3.1，站长 10-30
  // 已批）要讲「a short outermost edge made only of stars」——那是散边，另一件事，所以只禁退役的那两种说法。
  en: ['Streak', 'time factor', '0.95', '2×2', 'group made only of stars', 'pattern made only of stars', 'move factor', 'shape points', 'Swept badge', 'Slides genius only', 'for Slides geniuses'],
  fr: ['Série', 'facteur temps', '0,95', '2×2', 'entièrement fait d', 'facteur de coups', 'Plateau net', 'génies de Slides'],
};
// 现在这套规则的几件事：每枚 +2、图案 4 → 3 → 2（推14 Z-B02 F5：到 2 为止）、步数系数、剩余色块九折（推14 Z-B08）。
const MUST = {
  zhHans: ['2 分', '4 → 3 → 2', '步数系数', '九折'],
  zhHant: ['2 分', '4 → 3 → 2', '步數係數', '九折'],
  en: ['2 points', '4 → 3 → 2', 'Move multiplier', 'Build score', '×0.9'],
  fr: ['2 points', '4 → 3 → 2', 'Coefficient de coups', '×0,9'],
};
// 推14 起不许再说的：图案降到 1（F5 到 2 为止；MUST 里那个「4 → 3 → 2」是它的前缀，所以另禁整串）、综合分「只此一个乘数」
// （现在有剩余色块九折，不止一个了）。
const MUST_NOT = {
  zhHans: ['4 → 3 → 2 → 1', '只此一个乘数'],
  zhHant: ['4 → 3 → 2 → 1', '只此一個乘數'],
  en: ['4 → 3 → 2 → 1', 'only multiplier'],
  fr: ['4 → 3 → 2 → 1', 'seul multiplicateur'],
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
  check(`${lang}：通用五条讲到了现在这套的几件事（含九折）`, missing.length === 0, missing.join(' / ') || '都讲到了');
  const stale = MUST_NOT[lang].filter((w) => gen.includes(w));
  check(`${lang}：通用五条不再说「降到 1」「只此一个乘数」`, stale.length === 0, stale.join(' / ') || '干净');
}
check('（反面尺子）旧的通用那几句喂进 MUST_NOT 认得出',
  MUST_NOT.zhHans.every((w) => '图案 4 → 3 → 2 → 1 一路变小。步数系数是综合分只此一个乘数。'.includes(w)) &&
    MUST_NOT.en.every((w) => 'shrinks 4 → 3 → 2 → 1. The Move multiplier is the only multiplier.'.includes(w)));
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
// 所以这儿钉住**名单**，不只是数目。表手写（前六行就是主菜单卡名，第 ⑤ 节另有一条直接
// 拿 menuTags 去对）；加一个玩法就得回来加一行，而这正是要的效果——门会说出缺的是哪一
// 个，而不是悄悄放过。
const MODE_TERMS = [
  ['经典方块', '經典方塊', 'Classic Squares', 'Carrés classiques'],
  ['菱形方块', '菱形方塊', 'Diamond Squares', 'Carrés losange'],
  ['经典小球', '經典小球', 'Classic Balls', 'Billes classiques'],
  ['六边形小球', '六邊形小球', 'Hex Balls', 'Billes hexagone'],
  ['菱形小球', '菱形小球', 'Diamond Balls', 'Billes losange'],
  ['六边形三角', '六邊形三角', 'Hex Triangles', 'Triangles hexagone'],
  ['炸弹玩法', '炸彈玩法', 'Bomb modes', 'Modes bombe'],
  ['计时挑战', '計時挑戰', 'Timed modes', 'Modes chronométrés'],
  ['老虎机模式', '老虎機模式', 'Slot machine mode', 'Mode machine à sous'],
  ['无限反转', '無限反轉', 'Endless flip', 'Retournement infini'],
  ['真正解密 · 步步为营', '真正解密 · 步步為營', 'Puzzle · Step by step', 'Énigme · Pas à pas'],
  // 10-15 补充 S10：《Pro》改成单人局的固定翻色之后，规则书里第一次讲它。
  ['Pro', 'Pro', 'Pro', 'Pro'],
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
// `codeSentNote`（「已发送，验证码 30 分钟内有效」）2026-10-03 退役：那扇窗的标题已经写着
// 「已寄到 {email}」，同一拍再说一句「已发送」是把同一件事说两遍；而「30 分钟内有效」是
// 一个**他做不了任何事**的数——码没过期他看不出区别，过期了服务端会直接说。
const DEAD_KEYS = ['labelRun4', 'labelBlock22', 'label121', 'labelBigTriangle', 'perfLabel', 'codeSentNote', 'geniusOnly', 'badgeUnlockedOne', 'rankTotalBoard', 'rankTabLayout', 'rankTabDaily'];
// 只认**真的声明或读取**，不认注释里提到的名字：i18n.ts 里正写着一段注释解释这
// 五个为什么删了（「下一个人会拿 labelBlock22 去标一个凑不出来的图案」）。按
// \bkey\b 去找，那段注释自己就会把门顶红——一条一上来就红的门，最后一定会被人
// 加 continue-on-error。
const declaredOrUsed = (src, k) =>
  new RegExp(`^[ \\t]*${k}\\??:`, 'm').test(src) || new RegExp(`\\.${k}\\b`).test(src);
const back = DEAD_KEYS.filter((k) => declaredOrUsed(i18n, k));
check(`退役的 ${DEAD_KEYS.length} 个 i18n 键没回来`, back.length === 0, back.join(' / ') || '干净');
// 非空的尺子：拿一个还在用的键验一下，证明上面那个匹配器认得出「用着的键」。
check('（尺子）还在用的那个键查得到', declaredOrUsed(i18n, 'labelRunN'), 'labelRunN');
// 反过来的尺子：注释里提到的名字不算数——这正是上一行差点误伤的那件事。
check('（尺子）注释里提到不算「回来了」', !declaredOrUsed('// 拿 labelBlock22 去标\n', 'labelBlock22'));

const hints = [...i18n.matchAll(/flipScoringHint: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
check('flipScoringHint 四种语言都在', hints.length === 4, `${hints.length} 条`);
const STALE = /连击|連擊|Streak|streak|时间|時間|time bonus|bonus de temps|série/;
const bad = hints.filter((h) => STALE.test(h));
check('flipScoringHint 不再讲连击和时间奖励', bad.length === 0, bad.join(' / ') || '干净');

/**
 * ---- 计时那一档**真的乘步数系数**，书上不许写反 --------------------------
 *
 * `usesStepCoef = !flip && !puzzle && !slot`（engine/gameController.ts）——计时不在
 * 那三个里头，所以它**乘**。可《怎么玩》里那一条写的是「这一档不乘步数系数」，四种语
 * 言都写了，而且还替它编了个理由（「一局的长短由钟说了算」）。
 *
 * 规则书是「对代码实际行为的陈述」（rules.ts 开头那段）：玩家照着它以为计时局多走几步
 * 不要紧，而结算页那一行白纸黑字写着 ×0.几。说错就是假话，比没写更糟。
 *
 * 量法是两头对：**代码那头**现读 `usesStepCoef` 那一行（计时不许被排进去），**书那头**
 * 四条计时条目里不许出现「不乘」。
 */
{
  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  const line = (gc.match(/const usesStepCoef = [^;]+;/) || [''])[0];
  check('（尺子）读到了 usesStepCoef 那一行', line.length > 0, line);
  check('计时不在「不乘步数系数」那几档里', line.length > 0 && !/timed/.test(line), line);

  // 四种语言里「计时」那一条。按 term 认，不按下标——条目的次序改过不止一次。
  const TIMED_TERM = /(计时挑战|計時挑戰|Timed modes|Modes chronom\u00e9tr\u00e9s|Modes chronométrés)/;
  const items = [...rules.matchAll(/\{ term: '([^']+)', body: '((?:[^'\\]|\\.)*)' \}/g)]
    .filter((m) => TIMED_TERM.test(m[1]));
  check('（尺子）四种语言的「计时」那一条都找到了', items.length === 4, `${items.length} 条：${items.map((m) => m[1]).join(' / ')}`);
  const NOT_MULT = /不乘步数系数|不乘步數係數|take no move factor|take no Move multiplier|n\u2019ont pas de facteur de coups|n’ont pas de facteur de coups|n’ont pas de Coefficient de coups/;
  const liars = items.filter((m) => NOT_MULT.test(m[2]));
  check('计时那一条不再说「不乘步数系数」', liars.length === 0, liars.map((m) => m[1]).join(' / ') || '干净');
  // 反面尺子：把那句旧话喂进同一条正则，必须抓得到——不然上面那条是空绿。
  check('（反面尺子）旧那句话喂进来会被抓住', NOT_MULT.test('这一档不乘步数系数——一局的长短由钟说了算。'));
}

/**
 * ---- 暂停面板那颗键念的是 `endRunBtn` -----------------------------------
 *
 * 玩家定的名字是《结束游戏》。写死一句中文的话，另外三种语言会在暂停面板里撞见一句中
 * 文；而借别的键（比如《退出》）会让他以为按下去只是离开这一页，分数还在——其实这一局
 * 当场结算。
 */
{
  const shell = readFileSync(new URL('../src/ui/gameShell.ts', import.meta.url), 'utf8');
  // 11-01 补充方案推15B 起药丸里的字包了一层 <span>（暂停面板每一行是 grid，裸文字会被排进图标那一列）。
  const btn = (shell.match(/id="pauseFinishBtn"[^>]*>(?:<span>)?\$\{([^}]+)\}/) || [, ''])[1];
  check('暂停面板那颗键念的是 i18n 的 endRunBtn', btn.trim() === 's.endRunBtn', btn || '（没找到那颗键）');
  const names = [...i18n.matchAll(/endRunBtn: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  check('endRunBtn 四种语言都在', names.length === 4, names.join(' / '));
}

/**
 * ---- 玩家看得见的文案里不许出现「／」 -----------------------------------
 *
 * 玩家 2026-10 第二轮：「带『／』的句子和长句全部改成一句讲一件事」。那个全角斜杠是写
 * 的人图快的记法（「得分图案／消除星星」），读的人要自己拆——而这几句恰恰是讲规则的。
 *
 * 只看**字符串字面量**，不看注释：这个文件里的注释照旧可以用它（上面那一句就在用）。
 */
{
  const strings = [...i18n.matchAll(/^\s{4}(\w+): '((?:[^'\\]|\\.)*)',$/gm)];
  check('（尺子）扫到了一堆文案', strings.length > 400, `${strings.length} 条`);
  const slashed = strings.filter((m) => m[2].includes('／'));
  check('玩家看得见的文案里没有「／」', slashed.length === 0,
    slashed.slice(0, 4).map((m) => `${m[1]}: ${m[2].slice(0, 28)}`).join(' / ') || '干净');
  // 反面尺子：喂一句带「／」的进来，必须抓得到。
  check('（反面尺子）带「／」的句子喂进来会被抓住', '起始 8 步，每次得分图案／消除星星得到 1'.includes('／'));
}

/**
 * ---- ⑤ 一副棋盘一个名字：主菜单那张卡上写什么，别处就叫什么 ----------------------
 *
 * 10-09 补充方案第一部分第 5 条（原 10-08 方案第四批第 9 条）。玩家答复：「全部一起统一，以
 * menuTags.ts 现有名字为准，规则页、成绩页、分享卡等处全改」。
 *
 * 原先同一副棋盘有两三个名字：主菜单卡上写 menuTags 那一套（经典方块 / 经典小球 / 六边形三角 /
 * 菱形小球，Classic Squares / Hex Triangles，Carrés classiques / Triangles hexagone）；结算页、
 * 分享卡、排行榜标签、每一局的标题、**主菜单卡自己的读屏名**走 i18n 里另一套 shapeName*（方块 /
 * 圆球 / 大三角 / 七色圆球，Square / Big Triangle，Carré / Grand triangle）；《游戏规则》又是第三
 * 套（Squares / Big triangle / Carrés en losange）。眼睛看到的和读屏念的都不是同一个词。第四批只
 * 对齐了小球一族的英法，这一次三族四种语言一起。
 *
 *   ⑤a 只剩一份名字：shapeLabels.ts 直接取 menuTag，i18n 里不许再长出 shapeName* 键；
 *   ⑤b 《游戏规则》里每副棋盘那一条的 term 就是卡名（六副 × 四种语言，各在各的语言块里）；
 *   ⑤c 撤掉的旧叫法不许留在界面文案（i18n）、规则书（rules）、法务文本（legal）的字面量里。
 *
 * ⑤c 只扫**字符串字面量**，不扫注释：这几个文件的注释照旧可以讲历史（上面这段就在讲）。
 * 「方块」「圆球」「Square」是常用词，单拿出来禁会误伤「同色方块」，所以分两种：长名字只要出现就
 * 算；短名字整条字面量就是它、或者某一条 term 就是它才算。
 */
{
  const tags = read('src/ui/menuTags.ts');
  const labels = read('src/ui/shapeLabels.ts');
  const legal = read('src/legal.ts');
  // TAGS 里四种语言的次序：en、fr、zhHant、zhHans
  const TAG_LANGS = ['en', 'fr', 'zhHant', 'zhHans'];
  const menu = (key) => [...tags.matchAll(new RegExp(`^\\s+${key}: '([^']*)',$`, 'gm'))].map((m) => m[1]);
  const LIVE = ['square', 'squareDiamond', 'circle', 'circleHex', 'circleSeven', 'triangleBig'];
  // 删掉的那两副：云端旧战绩、别人寄来的旧分享卡里还带着这两个 id，名字也得从同一张表来。
  const RETIRED = ['triangle', 'triangleAdvanced'];

  // ⑤a
  check('⑤a shapeLabels 直接取主菜单卡名（menuTag），不再查第二张表',
    /return BOARD_IDS\.has\(id\) \? menuTag\(lang, id\) \|\| fallback : fallback;/.test(labels));
  const idList = (labels.match(/const BOARD_IDS = new Set\(\[([^\]]*)\]\)/) || [, ''])[1];
  const lostIds = [...LIVE, ...RETIRED].filter((id) => !idList.includes(`'${id}'`));
  check('⑤a 六副棋盘、两个删掉的旧 id 都认得', lostIds.length === 0, lostIds.join(' / ') || idList);
  const KEY = /^[ \t]+(shapeName\w*)\??:/gm;
  const keys = [...i18n.matchAll(KEY)].map((m) => m[1]);
  check('⑤a i18n 里没有 shapeName* 键（名字只有 menuTags 那一份）', keys.length === 0, keys.join(' / ') || '干净');
  check('⑤a（反面尺子）一条 shapeName 键声明喂进来认得出',
    [..."    shapeNameSquare: 'Square',\n".matchAll(KEY)].length === 1);

  // ⑤b
  for (const id of [...LIVE, ...RETIRED]) {
    const m = menu(id);
    check(`⑤b（尺子）${id}：主菜单卡名四种语言都读到了`, m.length === 4 && m.every(Boolean), m.join(' / '));
  }
  for (const id of LIVE) {
    const m = menu(id);
    TAG_LANGS.forEach((lang, i) => {
      check(`⑤b ${lang} ${id}：《游戏规则》里那一条叫「${m[i]}」`,
        BLOCK(lang).includes(`{ term: '${m[i]}', body: '`), m[i]);
    });
  }

  // ⑤c
  const literals = (src) => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .filter((l) => !/^\s*\/\//.test(l)).join('\n');
    return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
      .map((m) => m[1] ?? m[2] ?? m[3]);
  };
  const LONG = ['六边圆球', '七色圆球', '大三角', '进阶三角', '六邊圓球', '七色圓球', '進階三角',
    'Big Triangle', 'Big triangle', 'big triangle', 'Seven-colour', 'seven-colour', 'Hex Circle',
    'Advanced Triangle', 'Grand triangle', 'grand triangle', 'Carrés en losange', 'carrés en losange',
    'Carré losange', 'Triangle avancé', 'Cercle', 'sept couleurs', 'Billes hexagonales', 'billes hexagonales'];
  const SHORT = ['方块', '圆球', '方塊', '圓球', '三角', 'Square', 'Squares', 'Diamond Square', 'Diamond squares',
    'Circle', 'Triangle', 'Carré', 'Carrés'];
  const leftovers = (file, src) => {
    const lits = literals(src);
    const out = [];
    for (const w of LONG) if (lits.some((t) => t.includes(w))) out.push(`${file}:${w}`);
    for (const w of SHORT) if (lits.includes(w) || src.includes(`{ term: '${w}',`)) out.push(`${file}:「${w}」`);
    return out;
  };
  // 排行榜三行筛选的第一行（推14 Z-B15，站长 10-22：「第一栏是 方块、小球、三角」）：rankFamily* 那几颗药丸本来就是**族名**
  // （方块 / 小球 / 三角，Squares / Balls / Triangles），不是某一副棋盘的旧叫法，不算撤掉的名字。只放过这三个键，别的照查。
  const FAMILY_KEY = /^[ \t]+rankFamily(Square|Ball|Tri): '[^']*',$/gm;
  check('⑤c（尺子）排行榜族名药丸四种语言 × 三颗都在（下面放过的就是这十二行）', (i18n.match(FAMILY_KEY) || []).length === 12,
    String((i18n.match(FAMILY_KEY) || []).length));
  const SRC = { 'i18n.ts': i18n.replace(FAMILY_KEY, ''), 'rules.ts': rules, 'legal.ts': legal };
  const lits = Object.fromEntries(Object.entries(SRC).map(([f, s]) => [f, literals(s)]));
  check('⑤c（尺子）三个文件的字面量都读到了',
    lits['i18n.ts'].length > 1500 && lits['rules.ts'].length > 100 && lits['legal.ts'].length > 100,
    Object.entries(lits).map(([f, l]) => `${f} ${l.length}`).join(' / '));
  check('⑤c（尺子）读到的是字面量：一句现成的文案找得到', lits['i18n.ts'].includes('Diamond Balls board'));
  const left = Object.entries(SRC).flatMap(([f, s]) => leftovers(f, s));
  check('⑤c 撤掉的旧叫法一个都不在（界面文案 / 规则书 / 法务）', left.length === 0, left.join(' / ') || '干净');
  // 反面尺子：旧那几句喂进来必须抓得到；注释里提到不算。
  check('⑤c（反面尺子）旧的 term、旧的整条字面量、旧的长名字喂进来都会被抓住',
    leftovers('x', "      { term: 'Big triangle', body: '54' },").length > 0 &&
    leftovers('x', "    shapeNameSquare: '方块',").length > 0 &&
    leftovers('x', "    a: 'les deux autres (billes sept couleurs)',").length > 0);
  check('⑤c（尺子）注释里讲历史不算、「同色方块」这种常用词不算',
    leftovers('x', "// 原先叫「大三角」\n/* 'Big Triangle' */\n    run4: '凑齐 4 个同色方块',").length === 0);
}

// ── ⑥ 规则书和代码的三处对不上（10-11 方案 B-8）────────────────────────────
//
//   · 无限反转按组给分、连续得分再 ×1.5、封顶 10 次（engine/scoring.ts 的 flipStreakDelta / FLIP_STREAK_CAP）：原先
//     这一本整条没写，玩家照「每翻一枚 2 分」去算，算出来和结算页对不上。四种语言那一条都要提到 1.5 和 10。
//   · 「翻过去是一颗其他颜色的星星」是假话：方块每色 6 枚里有 1 枚翻过去还是同色，小球 7 中 1，三角 9 中 4。规则书
//     和教学第 1 条（i18n.ts 的 TUTORIAL_RULES）四种语言里都不许再说星星是别的颜色（玩家 Q5 定案）。
//   · 老虎机「最少剩一枚」：5、6 枚的目标降到底还剩 2、3 枚（engine/targets.ts 的 sizeAtLevel），说法换成「图案越大，
//     最低剩得越多」。
{
  const RULES_SRC = read('src/rules.ts');
  const I18N_SRC = read('src/i18n.ts');
  /** 某一条（term）在规则书里的 body。 */
  const body = (term) => (RULES_SRC.match(new RegExp(`term: '${term}', body: '([^']*)'`)) || [, ''])[1];
  const FLIP = { zhHans: '无限反转', zhHant: '無限反轉', en: 'Endless flip', fr: 'Retournement infini' };
  // 推14 Z-B06：连击封在第 FLIP_STREAK_CAP 次（5）、结算乘反转系数（方块 6、小球 2.5）——两样都从 scoring.ts 现读。
  const SC = read('src/engine/scoring.ts');
  const CAP = Number((SC.match(/export const FLIP_STREAK_CAP = (\d+);/) || [])[1]);
  const COEF = (SC.match(/export const FLIP_COEF[^=]*= Object\.freeze\(\{ square: ([\d.]+), circle: ([\d.]+) \}\)/) || []).slice(1);
  check('⑥（尺子）从 scoring.ts 现读到 FLIP_STREAK_CAP 和 FLIP_COEF', Number.isInteger(CAP) && COEF.length === 2, `${CAP} / ${COEF.join(', ')}`);
  const UPTO = { zhHans: `最多乘 ${CAP} 次`, zhHant: `最多乘 ${CAP} 次`, en: `up to ${CAP} times`, fr: `jusqu’à ${CAP} fois` };
  const COEF_NAME = { zhHans: '反转系数', zhHant: '反轉係數', en: 'Flip multiplier', fr: 'Coefficient de retournement' };
  const flipOk = (lang, b) => b !== '' && /1[.,]5/.test(b) && b.includes(UPTO[lang]) && b.includes(COEF_NAME[lang]) &&
    COEF.every((c) => b.includes('×' + (lang === 'fr' ? c.replace('.', ',') : c)));
  for (const [lang, term] of Object.entries(FLIP)) {
    const b = body(term);
    check(`⑥ ${lang}：「${term}」那一条写着 ×1.5、${UPTO[lang]}、${COEF_NAME[lang]}（×${COEF.join(' / ×')}）`, flipOk(lang, b), b.slice(0, 40));
  }
  check('⑥（反面尺子）旧那句「最多乘 10 次」喂进来要红',
    !flipOk('zhHans', '每连续得分一次再 ×1.5，最多乘 10 次（约 57.7 倍）；不乘步数系数。'));
  // 同一组歇几步（10-15 补充 S6，L-10 ①）：engine/scoring.ts 的 TOGGLE_SCORES_PER_GROUP / TOGGLE_COOLDOWN_MOVES——同一组
  // 不满 5 步得了两次分就停下，从最后那次往后数第 5 步起才又算分。原先规则书四语都没写这一条：玩家拼出来了、不翻也
  // 不给分，屏幕上一句话没有，以为是坏了。两个数从源码现读，规则书里写的「两次」「5 步」要和它对得上。
  const SCORING_SRC = read('src/engine/scoring.ts');
  const per = Number((SCORING_SRC.match(/export const TOGGLE_SCORES_PER_GROUP = (\d+);/) || [])[1]);
  const cool = Number((SCORING_SRC.match(/export const TOGGLE_COOLDOWN_MOVES = (\d+);/) || [])[1]);
  check('⑥（尺子）从 scoring.ts 现读到两个常量', Number.isInteger(per) && Number.isInteger(cool), `${per} / ${cool}`);
  check('⑥ 同一组最多连得两次（规则书写的「两次」就是这个数）', per === 2, String(per));
  const REST = { zhHans: [/两次/, `${cool} 步`], zhHant: [/兩次/, `${cool} 步`], en: [/\btwice\b/, `${cool} moves`], fr: [/deux fois/, `${cool} coups`] };
  for (const [lang, [twice, moves]] of Object.entries(REST)) {
    const b = body(FLIP[lang]);
    check(`⑥ ${lang}：「${FLIP[lang]}」那一条写了同一组歇几步（两次、${moves}）`, twice.test(b) && b.includes(moves), b.slice(-60));
  }
  check('⑥（反面尺子）旧英文那句里找不到「5 moves」',
    !'a move that scores nothing starts the count again. No Move multiplier either.'.includes(`${cool} moves`));
  // 「another colour」后面要是词尾：「flip another coloured piece」（再翻一枚色块）是正常的话，不算。
  const OTHER = /其他颜色|其他顏色|another colou?r\b|autre couleur/;
  const tut = (I18N_SRC.match(/export const TUTORIAL_RULES[\s\S]*?\n\};/) || [''])[0];
  // 10-31 起教学条句末一律不带句号（站长 10-31，附录甲 §18）。
  check('⑥（尺子）读到了 TUTORIAL_RULES 那一段', tut.includes("'Try to clear the whole board'"));
  const tutHits = (tut.match(/'[^']*'/g) || []).filter((t) => OTHER.test(t));
  check('⑥ 教学五条（四种语言）里不再说星星是别的颜色', tutHits.length === 0, tutHits.join(' / '));
  const ruleHits = (RULES_SRC.match(/body: '[^']*'/g) || []).filter((t) => OTHER.test(t));
  check('⑥ 规则书（四种语言）里不再说星星是别的颜色', ruleHits.length === 0, ruleHits.map((t) => t.slice(0, 50)).join(' / '));
  check('⑥（反面尺子）旧的说法喂进同一个匹配器认得出来',
    OTHER.test('翻过去是一颗其他颜色的星星') && OTHER.test('翻過去是一顆其他顏色的星星') && OTHER.test('a star of another colour') &&
      OTHER.test('étoile d’une autre couleur') && !OTHER.test('no slide can flip another coloured piece'));
  const SLOT = { zhHans: '老虎机模式', zhHant: '老虎機模式', en: 'Slot machine mode', fr: 'Mode machine à sous' };
  const ONE = /最少剩一枚|down to a single piece|jusqu’à une seule/;
  for (const [lang, term] of Object.entries(SLOT)) {
    const b = body(term);
    check(`⑥ ${lang}：老虎机那一条不再说「最少剩一枚」`, b !== '' && !ONE.test(b), b.slice(0, 40));
  }

  // ── MODE_TIPS：局中棋盘底下那一句一句话提示也得是实话（10-31 方案推04 Z-K01，debug G01–G03）────────────
  // 规则书早改对了（10-11 P8、10-15 S6），可头一回进老虎机 / 无限反转 / 炸弹时棋盘底下那一句还是旧说法：老虎机说
  // 「最少剩一枚」（实际按图案大小剩，5 枚的目标到底剩 2 枚）、无限反转没写「同一组连得两次后要歇满 5 步」、炸弹说
  // 「会被拆掉」（实际要挨两下）。同一把尺子（ONE、REST）套到 MODE_TIPS 四语上；炸弹那一句的「两下」从 bomb.ts 现读。
  const tips = (I18N_SRC.match(/export const MODE_TIPS[\s\S]*?\n\};/) || [''])[0];
  check('⑥（尺子）读到了 MODE_TIPS 那一段', tips.includes('bomb:') && tips.includes('zhHans: {'));
  const tipOf = (lang, k) => {
    const at = tips.indexOf(`  ${lang}: {`);
    if (at < 0) return '';
    const m = tips.slice(at).match(new RegExp(`\\n    ${k}: '((?:[^'\\\\]|\\\\.)*)'`));
    return m ? m[1] : '';
  };
  for (const lang of Object.keys(SLOT)) {
    const t = tipOf(lang, 'slot');
    check(`⑥ ${lang}：MODE_TIPS.slot 不再说「最少剩一枚」`, t !== '' && !ONE.test(t), t.slice(0, 40));
  }
  check('⑥（反面尺子）旧的 MODE_TIPS.slot 喂进 ONE 认得出来',
    ONE.test('它也会变小：每降一级少一枚，最少剩一枚。') && ONE.test('one piece fewer each time the ladder drops, down to a single piece.') &&
      ONE.test('une pièce de moins à chaque palier, jusqu’à une seule.'));
  for (const [lang, [twice, moves]] of Object.entries(REST)) {
    const t = tipOf(lang, 'flip');
    check(`⑥ ${lang}：MODE_TIPS.flip 写了同一组歇几步（两次、${moves}）`, twice.test(t) && t.includes(moves), t.slice(-70));
  }
  check('⑥（反面尺子）旧的 MODE_TIPS.flip 过不了 REST',
    !(REST.zhHans[0].test('所以同色星星永远不会消除。限时 100 秒。开始吧！') && '所以同色星星永远不会消除。限时 100 秒。开始吧！'.includes(REST.zhHans[1])));
  const BOMB_SRC = read('src/engine/bomb.ts');
  const hits = Number((BOMB_SRC.match(/export const BOMB_HITS_TO_DEFUSE = (\d+);/) || [])[1]);
  check('⑥（尺子）从 bomb.ts 现读到 BOMB_HITS_TO_DEFUSE', Number.isInteger(hits), String(hits));
  const TWO_HITS = { 2: { zhHans: '两下', zhHant: '兩下', en: 'two hits', fr: 'deux coups' } }[hits];
  check(`⑥ 炸弹挨几下才拆有对应的四语写法（现在是 ${hits} 下）`, Boolean(TWO_HITS), String(hits));
  for (const lang of Object.keys(SLOT)) {
    const t = tipOf(lang, 'bomb');
    check(`⑥ ${lang}：MODE_TIPS.bomb 说炸弹要挨${TWO_HITS ? TWO_HITS[lang] : '?'}才拆`, Boolean(TWO_HITS) && t.includes(TWO_HITS[lang]), t.slice(-60));
  }
  check('⑥（反面尺子）旧的 MODE_TIPS.bomb 里找不到「两下」', !'得分图案旁边的炸弹会被拆掉。'.includes('两下'));

  // ── 《消除》和教学第 4 条不许再说「至少 3 枚」（推14 Z-B12：外边多短都能削，门槛放开那一段另讲）─────────────
  const CLEAR = { zhHans: '消除', zhHant: '消除', en: 'Clearing', fr: 'Éliminer' };
  const AT_LEAST_3 = /至少 ?3 ?枚|最少要 ?3 ?枚|不超过 ?3 ?枚|不超過 ?3 ?枚|at least 3|3 stars or fewer|au moins 3|3 étoiles ou moins/;
  const r4 = (I18N_SRC.match(/export const TUTORIAL_RULE4[\s\S]*?\n\};/) || [''])[0];
  // 简繁两条的 term 都叫「消除」：body() 只取第一条，所以这儿逐条全取（四条）。
  const clearBodies = [...new Set(Object.values(CLEAR))].flatMap((t) => [...RULES_SRC.matchAll(new RegExp(`term: '${t}', body: '([^']*)'`, 'g'))].map((m) => m[1]));
  const clearHits = clearBodies.filter((b) => AT_LEAST_3.test(b)).map((b) => b.slice(0, 12));
  check('⑥（尺子）读到了 TUTORIAL_RULE4 和四语《消除》（四条）', r4.includes('squareDiamond') && clearBodies.length === 4 && clearBodies.every((b) => b !== ''),
    clearBodies.map((b) => b.length).join(' '));
  check('⑥《消除》（四语）不再说「至少 3 枚 / 不超过 3 枚」', clearHits.length === 0, clearHits.join(' ') || '干净');
  check('⑥ 教学第 4 条（TUTORIAL_RULE4，四语）不再说「最少要 3 枚」', !AT_LEAST_3.test(r4), (r4.match(AT_LEAST_3) || [''])[0] || '干净');
  check('⑥（反面尺子）旧那几句喂进来认得出',
    AT_LEAST_3.test('最外面一条至少 3 枚同色星星就消除') && AT_LEAST_3.test('at least 3 same-colour stars') && AT_LEAST_3.test('au moins 3 étoiles'));

  // ── 《Pro》推14 版（附录甲 §17.4，Z-B13）────────────────────────────────────────────────
  const PRO = [...RULES_SRC.matchAll(/term: 'Pro', body: '([^']*)'/g)].map((m) => m[1]);
  check('⑥（尺子）四语《Pro》都读到了', PRO.length === 4, String(PRO.length));
  const PRO_MUST = [
    ['排行榜上可以单独看 Pro 的成绩', '教学局'], ['排行榜上可以單獨看 Pro 的成績', '教學局'],
    ['Pro scores on their own', 'tutorial runs'], ['scores Pro à part', 'parties du tutoriel'],
  ];
  const PRO_NOT = /成绩照常进同一张排行榜|成績照常進同一張排行榜|same leaderboards as usual|mêmes classements que d’habitude|只能在个人主页|只能在個人主頁|from your profile only|uniquement depuis votre profil|翻面颜色|翻面顏色/;
  const proOk = (texts) => texts.length === 4 && texts.every((b, i) => PRO_MUST[i].every((w) => b.includes(w)) && !PRO_NOT.test(b));
  check('⑥《Pro》四语是推14 版：末句「排行榜上可以单独看 Pro 的成绩」、提到教学局，不说「同一张排行榜」「只能在个人主页」「翻面颜色」',
    proOk(PRO), PRO.map((b) => b.slice(-30)).join(' / '));
  // 反面尺子：b43f86a 那一版的旧《Pro》（简体那一句）喂进来要红。
  const OLD_PRO = '只在单人局起作用，每日挑战、代号局和小屋局一律照普通规则。开着它开局：色块翻面颜色固定绕一圈……成绩照常进同一张排行榜。只能在个人主页里开关。';
  check('⑥（反面尺子）旧的《Pro》喂进来要红', !proOk([OLD_PRO, ...PRO.slice(1)]));

  // 规则书删「天才特供」（10-31 方案推04 Z-K02，D33 甲）：规则书只给两个玩法标「天才特供」，实际锁了七个，产品又已是
  // 「注册即天才」。只扫 rules.ts——i18n 的 geniusOnly 是主菜单读屏名，一堆门靠它找卡，推12 再处理。
  const GENIUS = ['天才特供', 'Slides genius only', 'for Slides geniuses', 'génies de Slides'];
  const geniusHits = GENIUS.filter((w) => RULES_SRC.includes(w));
  check('⑥ 规则书（rules.ts 全文，四语）里不再出现「天才特供」', geniusHits.length === 0, geniusHits.join(' / '));
}

// ── ⑦ MODE_TIPS 四语（推14 Z-B21，verify-XTZ Z10）────────────────────────────────────────────
//
// 局中棋盘底下那一句提示原先只有 ⑥ 里零星几条在量。这一节打包读 MODE_TIPS（不是读源码），六个键四语一起量：计时按棋盘
// 填秒数（{s}，Z-B05）、反转照旧 100 秒、不讲系数；老虎机不再说「最少剩一枚」；炸弹「两下」；步步为营两个起手步数现读。
{
  const { build } = await import('esbuild');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'rules-counts-'));
  const out = join(dir, 'i18n.mjs');
  await build({ entryPoints: [new URL('../src/i18n.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, logLevel: 'silent' });
  const { MODE_TIPS } = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  const PZ = read('src/engine/puzzleScore.ts');
  const start = (k) => Number((PZ.match(new RegExp(`${k}: (\\d+)`)) || [])[1]);
  const pzSq = start('square');
  const pzCi = start('circle');
  check('⑦（尺子）从 puzzleScore.ts 现读到两个起手步数', Number.isInteger(pzSq) && Number.isInteger(pzCi), `方块 ${pzSq} / 小球 ${pzCi}`);
  const KEYS = ['bomb', 'flip', 'slot', 'timed', 'layout', 'puzzle'];
  const LANGS4 = ['zhHans', 'zhHant', 'en', 'fr'];
  const TWO = { zhHans: '两下', zhHant: '兩下', en: 'two hits', fr: 'deux coups' };
  const ONE = /最少剩一枚|down to a single piece|jusqu’à une seule/;
  const verdict = (T) => {
    const bad = [];
    for (const l of LANGS4) {
      for (const k of KEYS) if (!(typeof T?.[l]?.[k] === 'string' && T[l][k].trim())) bad.push(`${l}.${k} 缺`);
      const t = T?.[l] ?? {};
      if (!(t.timed?.includes('{s}') && !/\d/.test(t.timed))) bad.push(`${l}.timed`);
      if (!(t.flip?.includes('100') && !t.flip.includes('60') && !/×\s?\d|2[.,]5/.test(t.flip))) bad.push(`${l}.flip`);
      if (!t.slot || ONE.test(t.slot)) bad.push(`${l}.slot`);
      if (!t.bomb?.includes(TWO[l])) bad.push(`${l}.bomb`);
      if (!(t.puzzle?.includes(String(pzSq)) && t.puzzle.includes(String(pzCi)))) bad.push(`${l}.puzzle`);
    }
    return bad;
  };
  const got = verdict(MODE_TIPS);
  check('⑦ MODE_TIPS：六个键四语都在；计时用 {s} 不写数；反转 100 秒、不讲系数；老虎机不说「最少剩一枚」；炸弹「两下」；步步为营两个起手步数对得上',
    got.length === 0, got.join(' / ') || '干净');
  const clone = () => JSON.parse(JSON.stringify(MODE_TIPS));
  const m1 = clone();
  m1.en.timed = '100 seconds on the clock — how many points can you get?';
  check('⑦（反面尺子）计时换回「100 seconds on the clock」那一句要红', verdict(m1).includes('en.timed'));
  const m2 = clone();
  m2.zhHans.flip = m2.zhHans.flip.replace('100', '60');
  check('⑦（反面尺子）反转那一句的 100 换成 60 要红', verdict(m2).includes('zhHans.flip'));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
