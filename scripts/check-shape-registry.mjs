/**
 * 八副棋盘的「归哪一族、按哪一套规则讲」——只有一个答案，而且是棋盘自己说的。
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
 * 这道门量四件事：
 *   ① 八副都声明了（`npm run typecheck` 本来就保证这一条，这儿再数一遍，顺便当尺子）；
 *   ② 值对得上那张表，尤其 `squareDiamond` 的两位**故意不一样**；
 *   ③ **和旧的前缀规则逐一对齐**——这次收敛不许顺手改掉任何一副的归属；
 *   ④ 那四个函数里不许再留下按前缀猜家族的写法（不然哪天有人「顺手」改回去）。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const FILES = [
  'square', 'squareDiamond', 'circle', 'circleHex',
  'circleSeven', 'triangle', 'triangleBig', 'triangleAdvanced',
];
/** 期望的那张表：id → [family, ruleShape]。改这儿之前先想清楚是不是真要换归属。 */
const WANT = {
  square: ['square', 'square'],
  squareDiamond: ['square', 'squareDiamond'],
  circle: ['circle', 'circle'],
  circleHex: ['circle', 'circle'],
  circleSeven: ['circle', 'circle'],
  // 两个三角的 id 和文件名是**对调**的（main.ts 那两行有意交叉）：
  // shapes/triangle.ts 的 card.id 是 'triangleBig'，shapes/triangleBig.ts 的是 'triangle'。
  triangle: ['triangle', 'triangle'],
  triangleBig: ['triangle', 'triangle'],
  triangleAdvanced: ['triangle', 'triangle'],
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
// ① 尺子：八副都读到了，而且都声明了这两位。
check('八副棋盘的名片都读到了（下面几条才有意义）',
  cards.every(Boolean) && cards.length === 8,
  `${cards.filter(Boolean).length}/8`);
check('八副都声明了 family 和 ruleShape',
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
check('八副的家族和旧的前缀规则一模一样（这次只换判法，没换归属）',
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

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
