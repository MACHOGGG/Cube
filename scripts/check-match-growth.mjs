/**
 * 「四个连起来得分，连得更多得更多分」——这条规矩到底有没有在跑。
 *
 *   npx esbuild src/engine/matchGrowth.ts --bundle --format=esm --outfile=/tmp/g.mjs
 *   node scripts/check-match-growth.mjs /tmp/g.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 八个玩法的 findMatches 都是同一个套路：先找到一个「刚好合格的种子」（一条
 * 四连、一个 2×2），再把它按自己那一族的规律往外长，最后 points 给的是
 * Math.max(4, 长出来那片有多少格)。所以「更多会更多分」这件事，全落在这两个
 * 长大的函数身上——它们要是长不动，四连永远只值 4 分；要是长过头，一颗歪在
 * 旁边的同色也会被算进来，那就是白送分。
 *
 * 这个文件把这两个函数单独拎出来喂假棋盘，两头都查：该长的长到哪儿，不该长
 * 的一格都不许多。
 *
 * 方块那副没有走这两个函数（它的行、列、矩形有更省事的写法，就是同一个文件里
 * 的 squareGrowth），最后一段把那三个也喂一遍。
 * ─────────────────────────────────────────────────────────────────────────
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-match-growth.mjs <打包好的 matchGrowth.mjs>');
  process.exit(2);
}
const { extendRunInLine, growParallelogram, squareGrowth } = await import(src);

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
// 一块面：2×2 长成 2×3、3×3
// ---------------------------------------------------------------------------
//
// 用一张普通的方格：grid[r][c] 是颜色，null 表示这一格不在棋盘上。
const gridView = (grid) => ({
  at: (u, v) => (grid[u]?.[v] === undefined ? null : [u, v]),
  eff: (r, c) => grid[r][c] ?? -1,
  live: (r, c) => grid[r]?.[c] != null,
});

{
  // 左上 2×2 同色，右边再来一整列同色：该长成 2×3（六格）。
  const { at, eff, live } = gridView([
    [1, 1, 1, 9],
    [1, 1, 1, 9],
    [9, 9, 9, 9],
  ]);
  const got = growParallelogram(at, eff, live);
  check('2×2 长成 2×3（多一整列）', got.length === 6, `${got.length} 格`);
}
{
  // 3×3 全同色：长成九格。
  const { at, eff, live } = gridView([
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ]);
  const got = growParallelogram(at, eff, live);
  check('2×2 长成 3×3（九格）', got.length === 9, `${got.length} 格`);
}
{
  // 多出来的那一列只有半截同色（221）：那一列不完整，不许长。
  const { at, eff, live } = gridView([
    [1, 1, 1],
    [1, 1, 9],
    [9, 9, 9],
  ]);
  const got = growParallelogram(at, eff, live);
  check('多出来的一列只有半截就不长（还是四格）', got.length === 4, `${got.length} 格`);
}
{
  // 斜上方有一颗同色，但它不在这个平行四边形的两个方向上：一格都不许多。
  const { at, eff, live } = gridView([
    [1, 1, 9],
    [1, 1, 9],
    [9, 9, 1],
  ]);
  const got = growParallelogram(at, eff, live);
  check('歪在旁边的同色不算进来（还是四格）', got.length === 4, `${got.length} 格`);
}

// ---------------------------------------------------------------------------
// 方块那副：它自己那三个长大的函数（import 真件，不是抄本）
// ---------------------------------------------------------------------------
//
// squareGrowth 就在 matchGrowth.ts 里，shapes/square.ts 用的是同一份——这里喂
// 一块假棋盘进去量。从前这一段是照着那几行抄的副本：抄本永远是过的，真件改了
// 抄本没跟上，这道体检还照样报「全部通过」。
//
// rows/cols 传的是函数，跟真局一样：方块消掉整行整列时棋盘会当场变小。
function squareHelpers(grid) {
  const { extendRunHoriz, extendRect } = squareGrowth({
    rows: () => grid.length,
    cols: () => (grid[0] ? grid[0].length : 0),
    effColorAt: (r, c) => grid[r][c],
  });
  // 真件返回的是格子清单，这里只关心长出来几格。
  return {
    extendRunHoriz: (r, a, b) => extendRunHoriz(r, a, b).length,
    extendRect: (r0, c0, r1, c1) => extendRect(r0, c0, r1, c1).length,
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
  const { extendRect } = squareHelpers([
    [1, 1, 1, 2],
    [1, 1, 1, 2],
    [2, 2, 2, 2],
  ]);
  check('方块：2×2 长成 2×3（六格）', extendRect(0, 0, 1, 1) === 6, `${extendRect(0, 0, 1, 1)} 格`);
}
{
  const { extendRect } = squareHelpers([
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ]);
  check('方块：2×2 长成 3×3（九格）', extendRect(0, 0, 1, 1) === 9, `${extendRect(0, 0, 1, 1)} 格`);
}
{
  // 种子在右下角：往上、往左长的那两边，只有这一条量得到。
  const { extendRect } = squareHelpers([
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ]);
  check('方块：2×2 往上往左也长（九格）', extendRect(1, 1, 2, 2) === 9, `${extendRect(1, 1, 2, 2)} 格`);
}
{
  const { extendRect } = squareHelpers([
    [1, 1, 2],
    [1, 1, 2],
    [2, 2, 1],
  ]);
  check('方块：歪在旁边的同色不算进来（还是四格）', extendRect(0, 0, 1, 1) === 4, `${extendRect(0, 0, 1, 1)} 格`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
