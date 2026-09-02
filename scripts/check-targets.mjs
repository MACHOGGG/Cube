/**
 * 随机得分目标：图案表和判定的单元测试。
 *
 *   npx esbuild src/engine/targets.ts --bundle --format=esm --outfile=/tmp/t.mjs
 *   npx esbuild src/engine/targetMatch.ts --bundle --format=esm --outfile=/tmp/m.mjs
 *   node scripts/check-targets.mjs /tmp/t.mjs /tmp/m.mjs
 *
 * 不碰 DOM，也不碰八个玩法：只喂一副手搭的棋盘，看该找到的找不找得到、不该
 * 算的算不算。这一层错了，玩法层看起来会「偶尔不给分」，最难查。
 */
const T = await import(process.argv[2]);
const M = await import(process.argv[3]);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const tile = (color, face = 'flavor') => ({ id: 0, color, face, dotColor: color });

/** 方块那样的矩形棋盘：grid[r][c] 是颜色号，null 表示没有这一格。 */
function squareView(grid, flipped = new Set()) {
  return {
    has: (r, c) => grid[r]?.[c] != null,
    tileAt: (r, c) => {
      const v = grid[r]?.[c];
      return v == null ? null : tile(v, flipped.has(`${r},${c}`) ? 'dot' : 'flavor');
    },
    cells: () => grid.flatMap((row, r) => row.map((_, c) => [r, c])),
  };
}

// ---- 方块：36 一条四连 --------------------------------------------------
{
  const g = [
    [0, 0, 0, 0, 1, 1],
    [1, 2, 3, 4, 5, 0],
    [2, 3, 4, 5, 0, 1],
  ];
  const hits = M.findTargets(squareView(g), T.targetById('36'));
  check('方块 36（四连）：顶上那一条找得到', hits.length === 1, JSON.stringify(hits[0]));
  check('而且正好是那四格',
    JSON.stringify(hits[0]) === JSON.stringify([[0, 0], [0, 1], [0, 2], [0, 3]]));
}
// ---- 方块：32 是 36 的一部分，同一条上能找到两处 -----------------------
{
  const g = [[0, 0, 0, 0, 1, 1]];
  const hits = M.findTargets(squareView(g), T.targetById('32'));
  check('方块 32（三连）：四连里含两处三连', hits.length === 2, `${hits.length} 处`);
}
// ---- 方块：颜色不齐就不算 ----------------------------------------------
{
  const g = [[0, 0, 1, 0]];
  check('颜色断了就不算', M.findTargets(squareView(g), T.targetById('32')).length === 0);
}
// ---- 方块：全翻过来了就不算（老规矩：一次得分总要翻掉点什么）-----------
{
  const g = [[0, 0, 0, 0]];
  const allFlipped = new Set(['0,0', '0,1', '0,2', '0,3']);
  check('整条都已经翻过面了就不再计分',
    M.findTargets(squareView(g, allFlipped), T.targetById('36')).length === 0);
  const oneFront = new Set(['0,0', '0,1', '0,2']);
  check('只要还剩一枚正面就算数',
    M.findTargets(squareView(g, oneFront), T.targetById('36')).length === 1);
}
// ---- 方块：37 是 2×2 ----------------------------------------------------
{
  const g = [
    [0, 0, 1],
    [0, 0, 1],
  ];
  check('方块 37（2×2）找得到', M.findTargets(squareView(g), T.targetById('37')).length === 1);
}
// ---- 小球：棋盘是 28 颗的三角，第 r 行 r+1 颗 --------------------------
function circleView(colors) {
  return {
    has: (r, c) => r >= 0 && r < 7 && c >= 0 && c <= r,
    tileAt: (r, c) => (r >= 0 && r < 7 && c >= 0 && c <= r ? tile(colors(r, c)) : null),
    cells: () => {
      const out = [];
      for (let r = 0; r < 7; r++) for (let c = 0; c <= r; c++) out.push([r, c]);
      return out;
    },
  };
}
{
  // 23 = 上面一颗、下面两颗。整副同色时，每一个「上面一颗」都成立。
  const hits = M.findTargets(circleView(() => 0), T.targetById('23'));
  // 行 r 的第 c 颗，下面两颗是 (r+1,c) 和 (r+1,c+1)——r 从 0 到 5，共 21 处。
  check('小球 23（上一下二）：整副同色时 21 处', hits.length === 21, `${hits.length} 处`);
  // 只有最上面三颗同色，别的每一颗都给一个自己的颜色——不然下面那一大片
  // 同色的球自己也能凑出一堆 23 来（第一版就是这么写错的）。
  const one = M.findTargets(circleView((r, c) => (r <= 1 ? 0 : 100 + r * 10 + c)), T.targetById('23'));
  check('只有最上面三颗同色时，正好一处', one.length === 1, JSON.stringify(one[0]));
  check('那一处就是 (0,0)(1,0)(1,1)',
    JSON.stringify(one[0]?.map((x) => x.join(','))) === JSON.stringify(['0,0', '1,0', '1,1']));
}
// ---- 三角：朝向由 p 的奇偶定 -------------------------------------------
function triView(colors, rows = 6) {
  const has = (r, c) => r >= 0 && r < rows && c >= 0 && c < 2 * r + 1;
  return {
    has,
    tileAt: (r, c) => (has(r, c) ? tile(colors(r, c)) : null),
    cells: () => {
      const out = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < 2 * r + 1; c++) out.push([r, c]);
      return out;
    },
  };
}
{
  const hits = M.findTargets(triView(() => 0), T.targetById('14'));
  check('三角 14（一排三个）：整副同色时找得到', hits.length > 0, `${hits.length} 处`);
  const big = M.findTargets(triView(() => 0), T.targetById('15'));
  check('三角 15（大三角）：整副同色时找得到', big.length > 0, `${big.length} 处`);
  // 12（两块的菱形）和 15（大三角）在三角棋盘上摆得下的位置一样多，都是 25：
  // 两者都只要求「这一行有一格、下一行够宽」，卡住它们的是同一个条件。手算
  // 过：r 从 0 到 4，每行 2r+1 格，1+3+5+7+9 = 25。第一版想当然写了「小的
  // 应该更多」，是错的。真正被多卡一道的是横着排四个的 13——它还要求
  // p+3 不出界。
  const rhombus = M.findTargets(triView(() => 0), T.targetById('12')).length;
  const run4 = M.findTargets(triView(() => 0), T.targetById('13')).length;
  check('12（菱形）和 15（大三角）位置一样多，都是 25', rhombus === 25 && big.length === 25,
    `${rhombus} / ${big.length}`);
  check('13（横排四个）被多卡一道，比它们少', run4 < rhombus, `${run4} < ${rhombus}`);
}
// ---- 分值 --------------------------------------------------------------
check('3 枚 5 分', T.scoreOf(T.targetById('14')) === 5);
check('4 枚 8 分', T.scoreOf(T.targetById('13')) === 8);
check('5 枚 13 分', T.scoreOf(T.targetById('11')) === 13);
check('6 枚 18 分', T.scoreOf(T.targetById('26')) === 18);
// ---- 互斥 --------------------------------------------------------------
check('32 和 38 不能同时转出来（三连装得进五连）', !T.compatible('32', '38'));
check('15 和 14 不能同时转出来（几何算出来的）', !T.compatible('15', '14'));
check('31 和 32 可以同时转出来', T.compatible('31', '32'));
for (const fam of ['triangle', 'circle', 'square']) {
  const pair = T.drawPair(fam, () => 0.5);
  check(`${fam} 抽得出一对，而且两个不冲突`,
    pair !== null && T.compatible(pair[0].id, pair[1].id),
    pair ? pair.map((p) => p.id).join('+') : 'null');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
