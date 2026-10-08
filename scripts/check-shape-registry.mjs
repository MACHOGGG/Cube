/**
 * 六副棋盘的「归哪一族、按哪一套规则讲」——只有一个答案，而且是棋盘自己说的。
 *
 *   node scripts/check-shape-registry.mjs
 *
 * 不起服务器、不开浏览器、不打包：读的是**源码本身**。理由是这件事的要害在源码里
 * ——四个函数从前各按 id 前缀猜一遍，而且对不认识的 id 给出三种不同的静默默认值
 * （`'square'` / `null` / `'triangle'`）。下一副新棋盘只要 id 不以 square / circle /
 * triangle 开头，就会在三个地方被分进三个不同的家族，**不报任何错**：老虎机给它转错
 * 族的图案、《怎么玩》念错那一条、教学配图配错一族，三样各错各的，屏幕上看不出是同
 * 一个原因。
 *
 * 前缀之所以一直没出事是**运气**：两个三角 2026-09 对调过内容，恰好两个 id 都以
 * triangle 开头。
 *
 * **2026-09（《侵蚀阶梯》v1.2 PR-6）从八副删到六副**：原《三角》（id `triangle`，代码
 * 在 triangleBig.ts）和 V 形（`triangleAdvanced`）删了。留下的那一副三角是六边蜂窝 54
 * ——它的 card id 是 `triangleBig`，代码在 `shapes/triangle.ts`，名实还是交叉的。
 * 下面那张 RETIRED 表把删掉的两个 id 钉住：它们不许再出现在任何一副棋盘的名片上，也
 * 不许有人把文件加回来。
 *
 * 这道门量五件事：
 *   ① 六副都声明了（`npm run typecheck` 本来就保证这一条，这儿再数一遍，顺便当尺子）；
 *   ② 值对得上那张表，尤其 `squareDiamond` 的两位**故意不一样**；
 *   ③ **和旧的前缀规则逐一对齐**——这次收敛不许顺手改掉任何一副的归属；
 *   ④ 那四个函数里不许再留下按前缀猜家族的写法（不然哪天有人「顺手」改回去）；
 *   ⑤ 删掉的那两副没有偷偷回来（文件不在、id 不在名片上、也不在 main.ts 的注册表里）。
 */
import { existsSync, readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const FILES = [
  'square', 'squareDiamond', 'circle', 'circleHex', 'circleSeven', 'triangle',
];
/** 删掉的那两副：文件和 id 都不许再出现（《侵蚀阶梯》v1.2 PR-6）。 */
const RETIRED_FILES = ['triangleBig', 'triangleAdvanced'];
const RETIRED_IDS = ['triangle', 'triangleAdvanced'];
/** 期望的那张表：id → [family, ruleShape]。改这儿之前先想清楚是不是真要换归属。 */
const WANT = {
  square: ['square', 'square'],
  squareDiamond: ['square', 'squareDiamond'],
  circle: ['circle', 'circle'],
  circleHex: ['circle', 'circle'],
  circleSeven: ['circle', 'circle'],
  // 留下的那一副三角：文件名 shapes/triangle.ts，card.id 是 **triangleBig**
  // （六边蜂窝 54）。名实是对调的，这是这个仓库最老的一个坑。
  triangleBig: ['triangle', 'triangle'],
};

/** 从一副棋盘的源码里把那张 card 上的三样读出来。 */
function readCard(name) {
  const src = readFileSync(`src/shapes/${name}.ts`, 'utf8');
  const id = /card:\s*\{[\s\S]*?\bid:\s*'([^']+)'/.exec(src)?.[1];
  if (!id) return null;
  const after = src.slice(src.indexOf(`id: '${id}'`));
  const family = /\bfamily:\s*'([^']+)'/.exec(after)?.[1];
  const ruleShape = /\bruleShape:\s*'([^']+)'/.exec(after)?.[1];
  return { file: name, id, family, ruleShape };
}

const cards = FILES.map(readCard);
// ① 尺子：六副都读到了，而且都声明了这两位。
check('六副棋盘的名片都读到了（下面几条才有意义）',
  cards.every(Boolean) && cards.length === 6,
  `${cards.filter(Boolean).length}/6`);
check('六副都声明了 family 和 ruleShape',
  cards.every((c) => c && c.family && c.ruleShape),
  cards.map((c) => `${c?.file}:${c?.family ?? '缺'}/${c?.ruleShape ?? '缺'}`).join(' '));

// ② 值对得上那张表。
const FAMILIES = ['square', 'circle', 'triangle'];
const RULES = ['square', 'squareDiamond', 'circle', 'triangle'];
let bad = [];
for (const c of cards) {
  if (!c) continue;
  const want = WANT[c.id];
  if (!want) { bad.push(`${c.file} 的 id '${c.id}' 不在表里`); continue; }
  if (c.family !== want[0] || c.ruleShape !== want[1]) {
    bad.push(`${c.id}：声明 ${c.family}/${c.ruleShape}，该是 ${want[0]}/${want[1]}`);
  }
}
check('每一副的归属都对得上那张表', bad.length === 0, bad.join('；'));
check('family 只用那三个族名', cards.every((c) => FAMILIES.includes(c?.family)),
  [...new Set(cards.map((c) => c?.family))].join(' '));
check('ruleShape 只用那四个值', cards.every((c) => RULES.includes(c?.ruleShape)),
  [...new Set(cards.map((c) => c?.ruleShape))].join(' '));
// 菱形方块那一对**故意不一样**，这是《怎么玩》念错过的那件事。
const dia = cards.find((c) => c?.id === 'squareDiamond');
check('菱形方块：长得像方块，规则却自成一套（两位故意不一样）',
  dia?.family === 'square' && dia?.ruleShape === 'squareDiamond',
  `${dia?.family} / ${dia?.ruleShape}`);

// ③ 和旧的前缀规则逐一对齐：这次收敛不许顺手改掉任何一副的归属。
const byPrefix = (id) => (id.startsWith('circle') ? 'circle' : id.startsWith('triangle') ? 'triangle' : 'square');
const moved = cards.filter((c) => c && byPrefix(c.id) !== c.family);
check('六副的家族和旧的前缀规则一模一样（这次只换判法，没换归属）',
  moved.length === 0,
  moved.map((c) => `${c.id}：前缀说 ${byPrefix(c.id)}，声明是 ${c.family}`).join('；'));

// ④ 那四处不许再留下按前缀猜家族的写法。
//
// 只看这四个文件：ui/homeIcons.ts 的 gameIcon 也按前缀猜，但它收的是服务器发来的
// mode、猜错只影响摆哪张图标，而且必须容得下脏数据——那一处是有意留着的。
const GUESS = /startsWith\(\s*'(circle|triangle|square)'/;
for (const f of ['src/ui/gameShell.ts', 'src/ui/multiplayer.ts', 'src/main.ts', 'src/shapes/registry.ts']) {
  const src = readFileSync(f, 'utf8');
  // 注释里提到这件事是好事（那是出处），所以只看代码行。
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  check(`${f} 里不再按前缀猜家族`, !GUESS.test(code),
    (GUESS.exec(code) || [''])[0]);
}

// ⑤ 删掉的那两副没有偷偷回来。
//
// 三头一起钉：文件不在了、六副名片上没有那两个 id、main.ts 的 registerCards 里也没有
// 它们。只钉文件不够——把文件加回来却不注册，这道门照样绿；只钉 id 也不够，删了 id
// 却留着文件，下一个人会照着那个文件以为它还在。
for (const f of RETIRED_FILES) {
  check(`删掉的 shapes/${f}.ts 没有回来`, !existsSync(`src/shapes/${f}.ts`));
}
const liveIds = cards.map((c) => c?.id);
check('删掉的那两个 id 不在任何一副棋盘的名片上',
  RETIRED_IDS.every((id) => !liveIds.includes(id)),
  liveIds.join(' '));
{
  // registerCards([...]) 里那一串变量名：删掉的两副对应 triangleGame 和
  // triangleAdvancedGame（变量名和文件名是交叉的，见 main.ts）。
  const main = readFileSync('src/main.ts', 'utf8');
  const reg = /registerCards\(\[([\s\S]*?)\]/.exec(main)?.[1] ?? '';
  const names = reg.split(/[,\s]+/).filter(Boolean);
  check('main.ts 注册的正好是六副', names.length === 6, `${names.length} 副：${names.join(' ')}`);
  check('main.ts 里不再 import 删掉的那两个工厂',
    !/createTriangleBigGame|createTriangleAdvancedGame/.test(main));
}

// ⑥ **每一个建棋盘的入口，都得自己喊一声 registerCards。**
//
// 这张表由入口注册，不由 registry.ts 直接 import 工厂（成环，见那个文件头）。代价
// 是：多一个入口就多一处要记得喊，而漏喊**不是编译错，是运行时抛**——`cardOf` 查
// 不到就扔，gameShell 每开一局查一次。
//
// 真出过：2026-09 加这套注册时只改了 src/main.ts，小红书那个入口（xhs/src/main.ts，
// 它自己 createSquareGame() / createCircleGame()）漏了，于是那一版一开局就报「不认
// 识的玩法 id：square」。check-vsweb 逮到，可那是一道要开浏览器、跑十几分钟的门；
// 这一条是静态扫描，几毫秒，进得了快档。
{
  /** 去掉 // 行注释和 /* *\/ 块注释——只看真的会跑的那些字。 */
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const ENTRIES = ['src/main.ts', 'xhs/src/main.ts'];
  let scanned = 0;
  for (const f of ENTRIES) {
    if (!existsSync(f)) { check(`${f} 在`, false, '入口清单该跟着改了'); continue; }
    // 先把注释剥掉再找。第一版没剥，于是把那一句整行注释掉之后这道门照样绿——
    // 反控当场把它照出来了：`// registerCards([` 里也有这个词。
    const src = stripComments(readFileSync(f, 'utf8'));
    const builds = [...src.matchAll(/\bcreate\w*Game\(\)/g)].length;
    if (!builds) continue;   // 这个入口不建棋盘，不归这一条管
    scanned++;
    const ok = /\bregisterCards\s*\(/.test(src);
    check(`${f} 建了 ${builds} 副棋盘，也喊了 registerCards`, ok,
      ok ? '' : '漏了——这一版一开局就会抛「不认识的玩法 id」');
  }
  // 非空的尺子：清单里至少要有两个入口真的在建棋盘，不然上面那个循环一圈都不转。
  check('扫到的入口不止一个（不然上面那一条是空的）', scanned >= 2, `${scanned} 个`);
}

// ---- 每副棋盘的终局快照都经 packSnapshot 摆正（第 14 推）---------------------
//
// 分享卡、结算页、记录页上那张终局图是 snapshotBoard() 的产物。方块那一副原先原样返回：格
// 子位置按整块 6 × 6 的底板算，消掉几行几列之后剩下的那一块缩在图的左上角，右边和下面空着
// 一大片。别的五副从来都是交给 engine/shareCard.ts 的 packSnapshot 摆正、放大。这一条钉住
// 「六副都是」——下回新加一副棋盘忘了这一步，这儿就红。
{
  const FILES = ['square', 'squareDiamond', 'circle', 'circleHex', 'circleSeven', 'triangle'];
  const bad = [];
  let seen = 0;
  for (const f of FILES) {
    const src = readFileSync(`src/shapes/${f}.ts`, 'utf8');
    const at = src.indexOf('function snapshotBoard(');
    if (at < 0) continue;
    seen++;
    const body = src.slice(at, src.indexOf('\n      }\n', at));
    if (!/return packSnapshot\(/.test(body)) bad.push(f);
  }
  check('（尺子）六副棋盘的 snapshotBoard 都找得到', seen === FILES.length, `${seen} 副`);
  check('每副棋盘的终局快照都经 packSnapshot 摆正（方块那一副原先缩在左上角）', bad.length === 0, bad.join('、'));
}

// ⑦ CLAUDE.md 讲棋盘的那一节和 src/shapes/ 对得上（10-08 方案第四批第 10 条）。
//
// 那一节原先写着「`src/shapes/` 下八个模块（… `triangleBig` `triangleAdvanced`）」——PR-6 删到六副之后一直没人改，
// 读的人照着去找 triangleBig.ts，找不到。这儿钉住：小节标题说的副数、列出来的玩法文件，都等于目录里真有的那几个
// （registry.ts、types.ts 不算玩法文件）。门数那一处同理：CLAUDE.md 里不许再写死「scripts/ 下 N 个」。
{
  const { readdirSync } = await import('node:fs');
  const md = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
  const real = readdirSync(new URL('../src/shapes/', import.meta.url))
    .filter((f) => f.endsWith('.ts') && !['registry.ts', 'types.ts'].includes(f))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
  const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const head = md.match(/^### (\S)副棋盘，一个循环$/m);
  check('⑦（尺子）CLAUDE.md 里找得到讲棋盘的那一节', Boolean(head), head ? head[0] : '没找到「### N副棋盘，一个循环」');
  if (head) {
    check('⑦ 小节标题说的副数就是 src/shapes/ 里玩法文件的个数', head[1] === CN[real.length], `${head[1]} / ${real.length}（${real.join(' ')}）`);
    const body = md.slice(head.index, md.indexOf('\n### ', head.index + 4));
    const listed = (body.match(/下[一二三四五六七八九十]+个玩法文件（([^）]*)）/) || [, ''])[1]
      .match(/`([A-Za-z]+)`/g)?.map((x) => x.slice(1, -1)).sort() || [];
    check('⑦ 那一节列出来的玩法文件和目录里的一个不差', JSON.stringify(listed) === JSON.stringify(real),
      `列的：${listed.join(' ')} ／ 真有：${real.join(' ')}`);
    check('⑦ 那一节提到了 registry.ts', /registry\.ts/.test(body));
  }
  const hard = md.match(/`scripts\/` 下 \d+ 个/);
  check('⑦ CLAUDE.md 不再写死门的个数（「scripts/ 下 N 个」）', !hard, hard ? hard[0] : '');
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
