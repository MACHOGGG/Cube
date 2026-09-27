/**
 * 「四个连起来得分，连得更多得更多分」——这条规矩到底有没有在跑。
 *
 *   npx esbuild src/engine/matchGrowth.ts --bundle --format=esm --outfile=/tmp/g.mjs
 *   node scripts/check-match-growth.mjs /tmp/g.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 每副棋盘的 findMatches 都是同一个套路：先找到一个「刚好合格的种子」（一条
 * 正好 n 连，n 是当前侵蚀级别），再沿着同一条线往两头长到同色为止，最后按
 * 「这一拍真的翻了几枚 × 2」给分。所以「连得更多得更多分」这件事全落在这个长
 * 大的函数身上——它要是长不动，n 连永远只值 n×2 分；要是长过头，一颗隔着空位
 * 的同色也会被算进来，那就是白送分。
 *
 * 这个文件把它单独拎出来喂假棋盘，两头都查：该长的长到哪儿，不该长的一格都不
 * 许多。
 *
 * 《侵蚀阶梯》v1.2 §1.1 之后**只剩这一条扩张规则**：2×2 那一族图案退役了，
 * `growParallelogram` 和方块那副的 `extendRect` 一起删掉了，本文件末尾有两条
 * 反向断言钉住「它们没有偷偷回来」。
 *
 * 方块那副不走 extendRunInLine（它是规整网格，行列有更省事的写法，就是同一个
 * 文件里的 squareGrowth），最后一段把它那两个也喂一遍。
 * ─────────────────────────────────────────────────────────────────────────
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-match-growth.mjs <打包好的 matchGrowth.mjs>');
  process.exit(2);
}
const mod = await import(src);
const { extendRunInLine, squareGrowth } = mod;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---------------------------------------------------------------------------
// 一条线：四连长成五连、六连
// ---------------------------------------------------------------------------
//
// 线上的格子写成一排 (0,0) (0,1) …，颜色用一串数字给。dead 里的是空位（小球
// 和三角消过的行会留空球 / 空洞，那种格子不能算进得分里）。
const line = (n) => Array.from({ length: n }, (_, i) => [0, i]);
const runOf = (colors, dead = new Set()) => ({
  cells: line(colors.length),
  eff: (_r, c) => colors[c],
  live: (_r, c) => !dead.has(c),
});

{
  // 七格里前五格同色：种子是头四格，该长到第五格为止。
  const { cells, eff, live } = runOf([1, 1, 1, 1, 1, 2, 3]);
  const got = extendRunInLine(cells, 0, 3, eff, live);
  check('四连长成五连（第五格同色）', got.length === 5, `${got.length} 格`);
}
{
  // 种子在中间，两头都还有同色：两头都要长。
  const { cells, eff, live } = runOf([1, 1, 1, 1, 1, 1, 2]);
  const got = extendRunInLine(cells, 1, 4, eff, live);
  check('两头都同色就两头都长（六连）', got.length === 6, `${got.length} 格`);
}
{
  // 整条七格全同色：长满整条。
  const { cells, eff, live } = runOf([1, 1, 1, 1, 1, 1, 1]);
  const got = extendRunInLine(cells, 2, 5, eff, live);
  check('整条同色就长满整条（七连）', got.length === 7, `${got.length} 格`);
}
{
  // 第五格是别的颜色：停在四连，不多拿一格。
  const { cells, eff, live } = runOf([1, 1, 1, 1, 2, 1, 1]);
  const got = extendRunInLine(cells, 0, 3, eff, live);
  check('撞上别的颜色就停（还是四连）', got.length === 4, `${got.length} 格`);
}
{
  // 第五格同色，但那格是空的（消过的空位）：也要停。
  const { cells, eff, live } = runOf([1, 1, 1, 1, 1, 1, 1], new Set([4]));
  const got = extendRunInLine(cells, 0, 3, eff, live);
  check('撞上空位就停（空位不算数）', got.length === 4, `${got.length} 格`);
}

// ---------------------------------------------------------------------------
// 方块那副：它自己那两个长大的函数（import 真件，不是抄本）
// ---------------------------------------------------------------------------
//
// squareGrowth 就在 matchGrowth.ts 里，shapes/square.ts 用的是同一份——这里喂
// 一块假棋盘进去量。从前这一段是照着那几行抄的副本：抄本永远是过的，真件改了
// 抄本没跟上，这道体检还照样报「全部通过」。
//
// rows/cols 传的是函数，跟真局一样：方块消掉整行整列时棋盘会当场变小。
function squareHelpers(grid) {
  const { extendRunHoriz, extendRunVert } = squareGrowth({
    rows: () => grid.length,
    cols: () => (grid[0] ? grid[0].length : 0),
    effColorAt: (r, c) => grid[r][c],
  });
  // 真件返回的是格子清单，这里只关心长出来几格。
  return {
    extendRunHoriz: (r, a, b) => extendRunHoriz(r, a, b).length,
    extendRunVert: (c, a, b) => extendRunVert(c, a, b).length,
  };
}

{
  const { extendRunHoriz } = squareHelpers([
    [1, 1, 1, 1, 1, 2],
    [2, 2, 2, 2, 2, 2],
  ]);
  check('方块：一行四连长成五连', extendRunHoriz(0, 0, 3) === 5, `${extendRunHoriz(0, 0, 3)} 格`);
}
{
  // 种子在中间，两头都还有同色：两头都要长。上一条的种子贴着最左边，往左长的
  // 那半边量不到——把它拆掉这道体检照样是绿的，所以这一条必须在。
  const { extendRunHoriz } = squareHelpers([
    [2, 1, 1, 1, 1, 1, 1, 2],
    [2, 2, 2, 2, 2, 2, 2, 2],
  ]);
  check('方块：两头都同色就两头都长（六连）', extendRunHoriz(0, 2, 5) === 6, `${extendRunHoriz(0, 2, 5)} 格`);
}
{
  const { extendRunHoriz } = squareHelpers([
    [1, 1, 1, 1, 2, 2],
    [2, 2, 2, 2, 2, 2],
  ]);
  check('方块：撞上别的颜色就停（还是四连）', extendRunHoriz(0, 0, 3) === 4, `${extendRunHoriz(0, 0, 3)} 格`);
}
{
  // 竖的那一半：2×2 退役之后，方块除了横连就只剩它了，而上面那三条一条都量不
  // 到它——把 extendRunVert 整个拆掉，这道门从前照样是绿的。
  const { extendRunVert } = squareHelpers([
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [2, 2],
  ]);
  check('方块：一列四连长成五连', extendRunVert(0, 0, 3) === 5, `${extendRunVert(0, 0, 3)} 格`);
}
{
  // 种子在中间：往上长的那半边只有这一条量得到。
  const { extendRunVert } = squareHelpers([
    [2, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [2, 2],
  ]);
  check('方块：一列两头都同色就两头都长（五连）', extendRunVert(0, 2, 4) === 5, `${extendRunVert(0, 2, 4)} 格`);
}
{
  const { extendRunVert } = squareHelpers([
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [2, 2],
  ]);
  check('方块：一列撞上别的颜色就停（还是四连）', extendRunVert(0, 0, 3) === 4, `${extendRunVert(0, 0, 3)} 格`);
}

// ---------------------------------------------------------------------------
// 反向：2×2 那一族的扩张规则不许回来
// ---------------------------------------------------------------------------
//
// 《侵蚀阶梯》v1.2 §1.1 只认同色 1×N。这两个函数留着不会编译报错（一个是模块
// 导出、一个是工厂返回的字段，noUnusedLocals 两个都管不到），但会骗下一个人照
// 着它们以为 2×2 还在算分——而上面每一条断言都不会因此变红。所以在这儿钉死。
check('growParallelogram 已经删掉（2×2 图案退役）',
  mod.growParallelogram === undefined, typeof mod.growParallelogram);
{
  const g = squareGrowth({ rows: () => 2, cols: () => 2, effColorAt: () => 1 });
  check('squareGrowth 不再交出 extendRect', g.extendRect === undefined, typeof g.extendRect);
  check('squareGrowth 只剩横竖两条', Object.keys(g).sort().join() === 'extendRunHoriz,extendRunVert',
    Object.keys(g).sort().join());
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
