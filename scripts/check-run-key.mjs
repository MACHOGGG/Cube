/**
 * 存档键那一套的门——纯 node，不碰 DOM，几十毫秒，进 CI。
 *
 *   npx esbuild src/engine/runKey.ts --bundle --format=esm --outfile=/tmp/runkey.mjs
 *   node scripts/check-run-key.mjs /tmp/runkey.mjs
 *
 * 它盯的是一件**已经发生过两次、而且两次都不报错**的事：规则升了版本，写存档的
 * 那一头没跟着改。后果是新规则的局落进上一版规则的归档里——记录页上不出现、累计
 * 得分里不算、结算页那个「本机最佳」还钉在一个现行规则下打不出来的旧数字上。
 *
 * 所以这道门分两半：
 *   前一半量**行为**——后缀必须由版本常量生成，不是写死的字面量；
 *   后一半量**位置**——八副棋盘里谁都不许再手写后缀。第二半才是真正的保险：它拦
 *   的不是这一次的错字，是「又有人在棋盘里手写后缀」这件事本身。
 */
import { readFileSync, readdirSync } from 'node:fs';

const [src] = process.argv.slice(2);
if (!src) {
  console.error('用法: node scripts/check-run-key.mjs <打包好的 runKey.mjs>');
  process.exit(2);
}
const { modeKeyOf, suffixFor } = await import(src);
// 版本常量从源码里读，不从打包产物里读：这道门的整个意思就是「后缀跟着这两个数
// 走」，两边都从同一个模块 import 的话，改错了数两边一起错、门照样绿。
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const numOf = (file, name) => {
  const line = read(file).split('\n').find((l) => l.startsWith('export const ' + name + ' = '));
  const n = line && Number(line.slice(('export const ' + name + ' = ').length).replace(/\D.*$/, ''));
  if (!n) throw new Error(`读不到 ${name}`);
  return n;
};
const BOMB_V = numOf('src/engine/bomb.ts', 'BOMB_RULES_VERSION');
const FLIP_V = numOf('src/engine/scoring.ts', 'FLIP_RULES_VERSION');

let fail = 0;
let ran = 0;
const check = (name, ok, extra = '') => {
  ran++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── 一、模式名：八副棋盘从前各写一条三元链 ──────────────────────────
{
  const cases = [
    [{}, 'base'],
    [{ timed: true }, 'timed'],
    [{ bomb: true }, 'bomb'],
    [{ bomb: true, timed: true }, 'bombTimed'],
    [{ flip: true, timed: true }, 'flip'],
    [{ steps: true }, 'puzzle'],
    // 优先级：步步为营压过一切，反转压过炸弹，炸弹压过计时。三条都是原来那八条
    // 三元链里的顺序——换了顺序不会报错，只是某些局归到别的榜上去。
    [{ steps: true, bomb: true, flip: true, timed: true }, 'puzzle'],
    [{ flip: true, bomb: true, timed: true }, 'flip'],
  ];
  const bad = cases.filter(([f, want]) => modeKeyOf(f) !== want);
  check(`模式名：${cases.length} 种开关组合都对`, bad.length === 0,
    bad.map(([f, w]) => `${JSON.stringify(f)}→${modeKeyOf(f)} 应为 ${w}`).join('；'));
  // 「炸弹压过计时」单独钉一条：定时炸弹局存的是炸弹那张榜，不是计时那张。反过来
  // 写不会报错，只是九十秒炸弹局的分全跑去和普通计时局比。
  check('定时炸弹归炸弹，不归计时', modeKeyOf({ bomb: true, timed: true }) === 'bombTimed');
}

// ── 二、后缀：必须跟着版本常量走 ────────────────────────────────────
{
  check('炸弹后缀跟着 BOMB_RULES_VERSION 走',
    suffixFor('bomb') === '_bomb' + BOMB_V, `${suffixFor('bomb')} / 版本 ${BOMB_V}`);
  check('定时炸弹和炸弹同一个后缀', suffixFor('bombTimed') === suffixFor('bomb'));
  check('无限反转后缀跟着 FLIP_RULES_VERSION 走',
    suffixFor('flip') === '_flip' + FLIP_V, `${suffixFor('flip')} / 版本 ${FLIP_V}`);
  // 第 1 版不带数字——这条规律不是新定的，是现有那几个键本来就长这样，所以旧档
  // 一个都不用动。写错这一条的后果是所有老局一夜之间「消失」（它们还在，只是没人
  // 再按那个键去找）。
  check('第 1 版不带数字', suffixFor('bomb', { bomb: 1 }) === '_bomb' && suffixFor('flip', { flip: 1 }) === '_flip');
  check('第 2 版起带上版本号', suffixFor('bomb', { bomb: 2 }) === '_bomb2' && suffixFor('bomb', { bomb: 7 }) === '_bomb7');
  check('没有版本号的两档照旧', suffixFor('timed') === '_timed' && suffixFor('puzzle') === '_puzzle');
  check('基础那一档没有后缀', suffixFor('base') === '');
  // 版本号是具名的，所以「给炸弹的版本号」影响不到无限反转，反之亦然。位置参数那
  // 一版正是在这儿栽的：suffixFor('flip', 1) 把 1 填给了炸弹，反转仍取现行版本，于
  // 是迁移那段「把第 1 版挪到第 2 版」变成了从自己挪到自己，一局都不动、也不报错。
  check('两个版本号互不串台',
    suffixFor('flip', { bomb: 1 }) === '_flip' + FLIP_V && suffixFor('bomb', { flip: 1 }) === '_bomb' + BOMB_V,
    `${suffixFor('flip', { bomb: 1 })} / ${suffixFor('bomb', { flip: 1 })}`);
  // 读的那一头从前写的是 `bombRules >= 现行版本 ? '_bomb3' : …`——把当前版本的后缀
  // 写死在条件里。等版本升到第 4 版，第 3 版的旧局会掉进第 2 版那一档。这一条量的
  // 就是那个坑补上了没有。
  check('每一版旧局都认回自己那个键（不会掉进上一档）',
    [1, 2, 3, 4, 5].every((v) => suffixFor('bomb', { bomb: v }) === (v >= 2 ? '_bomb' + v : '_bomb')),
    [1, 2, 3, 4, 5].map((v) => suffixFor('bomb', { bomb: v })).join(' '));
}

// ── 三、八副棋盘里谁都不许再手写后缀 ────────────────────────────────
{
  const dir = new URL('../src/shapes/', import.meta.url);
  const boards = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'registry.ts');
  check('八副棋盘都在（下面几条才有意义）', boards.length === 8, boards.join(' '));
  const handwritten = [];
  const notUsing = [];
  for (const f of boards) {
    const s = read('src/shapes/' + f);
    if (/'_bomb\d*'|'_flip\d*'|'_timed'|'_puzzle'/.test(s)) handwritten.push(f);
    if (!s.includes('suffixFor(')) notUsing.push(f);
  }
  check('没有一副棋盘手写存档后缀', handwritten.length === 0, handwritten.join(' '));
  check('八副棋盘都走 suffixFor', notUsing.length === 0, notUsing.join(' '));
}

// ── 四、读的那两头也不手写 ──────────────────────────────────────────
{
  const main = read('src/main.ts');
  // recordSources 那张表和 runKeyFor 都在这个文件里。它们是「读」的那一头——从前
  // 写死 '_bomb3' / '_flip2'，棋盘那头写死上一版，两头就这么分了家。
  const lits = main.match(/'_bomb\d*'|'_flip\d*'/g) || [];
  check('main.ts 不手写带版本号的后缀', lits.length === 0, lits.join(' '));
  check('main.ts 走 suffixFor', main.includes('suffixFor('), '');
}

console.log(fail ? `\n${fail} 条没过（共 ${ran} 条）` : `\n全部通过（${ran} 条）`);
process.exit(fail ? 1 : 0);
