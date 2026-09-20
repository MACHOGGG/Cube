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

// ---- 1. 玩家给的那几个数 -----------------------------------------------------
//
// 规则：一组里有色块 → max(4, 整组枚数)（和从前完全一样）；一组全是星星 →
// 星星枚数²。每一行都是玩家亲口给的，或者从他给的那几条直接推出来的。
{
  const table = [
    // [色块, 星星, 应得, 这一行在守什么]
    [4, 0, 4, '4 色块 → 4（玩家给的）'],
    [5, 0, 5, '5 色块 → 5（和从前一样）'],
    [6, 0, 6, '6 色块 → 6（和从前一样）'],
    [3, 1, 4, '3 色 1 星 → 4（玩家给的：混合组一分不变，星星不消除）'],
    [2, 3, 5, '2 色 3 星 → 5（玩家给的：混合组一分不变）'],
    [1, 4, 5, '1 色 4 星 → 5（混合就是 max(4, 5)，星星不因为多就值钱）'],
    [4, 2, 6, '4 色 2 星 → 6（混合，整组 6 枚）'],
    [0, 4, 16, '纯 4 星 → 4²（玩家给的：1×4 是 4²）'],
    [0, 5, 25, '纯 5 星 → 5²（玩家给的：1×5 是 5²）'],
    [0, 6, 36, '纯 6 星 → 6²（玩家给的：2×3 那一块是 6²，平方的是枚数不是边长）'],
  ];
  for (const [b, s2, want, why] of table) {
    const got = group(b, s2);
    check(`${why}`, got === want, `色块 ${b} + 星星 ${s2} → ${got}（应 ${want}）`);
  }
}

// ---- 2. 混合组必须和从前**逐个数**一样 --------------------------------------
//
// 这一条是这道门的定海神针。规则的全部新意只在「整组都是星星」那一支；混合组
// 一分都不许变。旧写法是 `Math.max(4, region.length)`，所以只要组里还有一枚色
// 块，groupPoints 就得和它给出同一个数——一枚不差。
//
// 为什么专门钉它：中间上线过一版「乙」（max(4, 色块枚数) + 星星²），把
// `●●★★★` 从 5 分改成了 13 分，线上跑了几分钟才退回来。这条断言就是那次的
// 疤，它在的时候那种改动进不来。
{
  const bad = [];
  for (let blocks = 1; blocks <= 8; blocks++) {
    for (let stars = 0; stars <= 8; stars++) {
      const got = group(blocks, stars);
      const old = Math.max(4, blocks + stars);   // 从前那一行，原样抄在这儿
      if (got !== old) bad.push(`${blocks}色${stars}星 新 ${got} / 旧 ${old}`);
    }
  }
  check(
    '只要组里还有一枚色块，分数就和从前一模一样（扫了 72 种组合）',
    bad.length === 0,
    bad.slice(0, 4).join('；') || '72 种全部对上',
  );
}

// ---- 3. 单调：色块数不变、多一颗星星，分只增不减 ----------------------------
//
// 注意这条只在「色块数固定」这个方向上成立，而且**故意**如此：往一组纯星星里加
// 进一枚色块，分是会掉的（纯 5 星 25 分 → 1 色 5 星 max(4,6)=6 分）。那不是
// bug，是这条规则的用意——星星只在自己单独成图案的时候才值钱，所以玩家该去凑
// 纯星星的图案。这里把它写明白，免得哪天有人当成 bug「修」掉。
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
  check('色块数不变、多一颗星星，分数只增不减', smooth, jumps.slice(0, 3).join('；') || '扫了 56 种组合');
}

// 往纯星星组里塞一枚色块，分数确实会掉——这是规则要的，钉住它。
check(
  '纯星星组里塞进一枚色块，分数从平方掉回老公式（这是规则要的）',
  group(0, 5) === 25 && group(1, 5) === 6,
  `纯 5 星 ${group(0, 5)} → 1 色 5 星 ${group(1, 5)}`,
);

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
