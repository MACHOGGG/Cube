/**
 * 一组图案值几分：《星星跟随色块消除》那套算法。
 *
 *   npx esbuild src/engine/groupScore.ts --bundle --format=esm --outfile=/tmp/group.mjs
 *   node scripts/check-star-score.mjs /tmp/group.mjs
 *
 * 为什么要有这道门：
 *
 *   这条规则原先是 `Math.max(4, region.length)`，八副棋盘里各自抄了一遍，一共
 *   十六处。星星要单独一套算法，十六处各改一遍必漏——而漏掉的那一副棋盘不会
 *   崩、不会白屏，只会安安静静地按旧尺子给分，最后混进同一张排行榜。
 *
 *   所以这道门量两件事：
 *     ① 那个函数算得对（玩家拍板的那几个数，一个一个钉住）
 *     ② 八副棋盘都走它，而且**没有任何一副又抄了一份** `Math.max(4, …)`
 *
 *   第 ② 条是这道门真正的价值。这个仓库已经栽过三次「门只认字面量、不认成
 *   效」的跟头（check-perk-pages / check-outer-edges / check-bomb-rules），所以
 *   这里反过来：不猜某一行长什么样，只查「旧写法在棋盘里绝迹了没有」。
 *
 * 纯算术，不开浏览器，几十毫秒，进得了 CI。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mod = process.argv[2];
if (!mod) {
  console.error('用法: node scripts/check-star-score.mjs <打包好的 groupScore.mjs>');
  process.exit(2);
}

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { groupPoints, MIN_GROUP_POINTS } = await import(pathToFileURL(mod).href);

/**
 * 摆一组格子：blocks 枚色块（face 'flavor'）+ stars 枚星星（face 'dot'）。
 *
 * 坐标随便给，groupPoints 只拿它去问 face，不看位置。
 */
function group(blocks, stars) {
  const cells = [];
  const faces = [];
  for (let i = 0; i < blocks; i++) { cells.push([0, cells.length]); faces.push('flavor'); }
  for (let i = 0; i < stars; i++) { cells.push([0, cells.length]); faces.push('dot'); }
  return groupPoints(cells, (_r, c) => ({ face: faces[c] }));
}

// ---- 1. 玩家拍板的那几个数 ---------------------------------------------------
//
// 「乙」案：max(4, 色块枚数) + 星星枚数²，一组全是星星时色块那部分是 0。
// 每一行都是玩家亲口确认过、或者从他确认的那两个端点推出来的。
{
  const table = [
    // [色块, 星星, 应得, 这一行在守什么]
    [4, 0, 4, '4 色块：和从前一模一样（老玩家的手感一分不动）'],
    [5, 0, 5, '5 色块：和从前一模一样'],
    [6, 0, 6, '6 色块：和从前一模一样'],
    [0, 4, 16, '4 星星：0 + 4²'],
    [0, 5, 25, '5 星星：0 + 5²（玩家点名的那个例子）'],
    [0, 6, 36, '6 星星：0 + 6²'],
    [2, 3, 13, '2 色 3 星：max(4,2) + 3²（「乙」和「甲」的分水岭，甲是 11）'],
    [1, 4, 20, '1 色 4 星：max(4,1) + 4²（地板算在色块头上，这是乙的选择）'],
    [3, 1, 5, '3 色 1 星：max(4,3) + 1²'],
    [4, 2, 8, '4 色 2 星：max(4,4) + 2²'],
  ];
  for (const [b, s, want, why] of table) {
    const got = group(b, s);
    check(`${why}`, got === want, `色块 ${b} + 星星 ${s} → ${got}（应 ${want}）`);
  }
}

// ---- 2. 「全是星星」那一路，色块部分必须是 0 而不是 4 ------------------------
//
// `max(4, 0)` 照字面写下去是 4，于是 5 颗星星会算成 29。可玩家确认的数是 25。
// 那个 4 是「能得分的最小图案就是 4 格」的地板，说的是整组，不是说色块。
check(
  '全是星星时不套那个 4 的地板（否则 5 颗星星会变成 29）',
  group(0, 5) === 25 && group(0, 1) === 1 && group(0, 2) === 4,
  `1/2/5 颗星星 → ${group(0, 1)} / ${group(0, 2)} / ${group(0, 5)}`,
);
check('那个地板本身还是 4', MIN_GROUP_POINTS === 4, String(MIN_GROUP_POINTS));

// ---- 3. 没有断崖：多一颗星星，分只增不减 -------------------------------------
//
// 这一条是「丙」案被否掉的理由，钉在这儿免得哪天又被改回去：丙（只要有星星就整
// 组平方）在 `●●●★` 上从 4 分跳到 16 分，玩家只要往任何图案里塞进一颗星星，分
// 就翻四倍——那是个刷分入口。乙没有跳变。
{
  let smooth = true;
  const jumps = [];
  for (let blocks = 0; blocks <= 6; blocks++) {
    for (let stars = 0; stars < 8; stars++) {
      const a = group(blocks, stars);
      const b = group(blocks, stars + 1);
      if (b < a) { smooth = false; jumps.push(`${blocks}色${stars}星 ${a} → ${b}`); }
    }
  }
  check('往一组里多加一颗星星，分数只增不减', smooth, jumps.slice(0, 3).join('；') || '扫了 56 种组合');
}

// ---- 4. 拿不到棋子的格子按「不是星星」算 -------------------------------------
//
// 越界、空位（circle / triangleBig 已经有 isBlank）都会让 tileAt 回 null。宁可
// 少算一颗星星，也不能在这儿抛错——它跑在得分那一拍的正中间。
check(
  'tileAt 回 null 的格子不抛错、按色块算',
  groupPoints([[0, 0], [0, 1], [0, 2], [0, 3]], () => null) === 4,
  String(groupPoints([[0, 0], [0, 1], [0, 2], [0, 3]], () => null)),
);
check('空组是 0 分', groupPoints([], () => null) === 0);

// ---- 5. 八副棋盘都走这一处，没有谁又抄了一份 --------------------------------
//
// 这一条才是这道门存在的主要理由。旧写法在棋盘里必须绝迹；八副都要 import 它。
{
  const dir = new URL('../src/shapes/', import.meta.url);
  const SHAPES = [
    'square', 'squareDiamond', 'circle', 'circleHex',
    'circleSeven', 'triangle', 'triangleBig', 'triangleAdvanced',
  ];
  const present = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''));
  // 名单自己也要对：哪天多一副棋盘，这道门得知道。types.ts 不是棋盘。
  const boards = present.filter((n) => n !== 'types');
  check(
    '棋盘名单没变（多一副就回来把它加进这道门）',
    boards.length === SHAPES.length && SHAPES.every((n) => boards.includes(n)),
    `现在有 ${boards.length} 副：${boards.join(' ')}`,
  );

  const stale = [];
  const missing = [];
  for (const name of SHAPES) {
    const src = readFileSync(new URL(`${name}.ts`, dir), 'utf8');
    // 注释里提一句不算——只看代码。先把块注释剥掉。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    if (/Math\.max\(\s*4\s*,/.test(code)) stale.push(name);
    if (!code.includes('groupPoints(')) missing.push(name);
  }
  check(
    '没有哪副棋盘还留着旧写法 Math.max(4, …)',
    stale.length === 0,
    stale.length ? `还留着的：${stale.join(' ')}` : '八副都干净',
  );
  check(
    '八副棋盘都在调 groupPoints',
    missing.length === 0,
    missing.length ? `没调的：${missing.join(' ')}` : '八副都调了',
  );
}

// ---- 6. 老虎机那套不受影响 ---------------------------------------------------
//
// 老虎机模式（targets）的图案分走 targets.ts 的 scoreOf（ceil(n²/2)），是另一条
// 路。规则改动不许把它一起卷进来——它的分早就印在玩家的记录里了。
{
  const src = readFileSync(new URL('../src/engine/targets.ts', import.meta.url), 'utf8');
  check(
    '老虎机的 scoreOf 还是 ceil(n²/2)，没被这次改动碰到',
    /Math\.ceil\(\(p\.cells\.length \*\* 2\) \/ 2\)/.test(src),
  );
}

console.log(fail ? `\n${fail} 项没过` : '\nALL PASS');
process.exit(fail ? 1 : 0);
